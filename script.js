// =========================================================================
// The Hunt Tracker - Client-side JavaScript (script.js)
// =========================================================================

// Firebase SDKのインポート（モジュールとして扱う）
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { getFirestore, collection, onSnapshot, doc, getDoc, setDoc, addDoc } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

// FunctionsのSDKをインポート
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-functions.js";

// --- 1. 定数とグローバル変数 ---
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDAYv5Qm0bfqbHhCLeNp6zjKMty2y7xIIY",
  authDomain: "the-hunt-49493.firebaseapp.com",
  projectId: "the-hunt-49493",
  storageBucket: "the-hunt-49493.firebasestorage.app",
  messagingSenderId: "465769826017",
  appId: "1:465769826017:web:74ad7e62f3ab139cb359a0",
  measurementId: "G-J1KGFE15XP"
};

const MOB_DATA_URL = "./mob_data.json"; // mob_data.jsonのパス

const EXPANSION_MAP = {
    1: "新生", 2: "蒼天", 3: "紅蓮", 4: "漆黒", 5: "暁月", 6: "黄金"
};
const RANK_COLORS = {
    S: { bg: 'bg-red-600', text: 'text-red-600', hex: '#dc2626' },
    A: { bg: 'bg-yellow-600', text: 'text-yellow-600', hex: '#ca8a04' },
    FATE: { bg: 'bg-indigo-600', text: 'text-indigo-600', hex: '#4f46e5' },
    B1: { bg: 'bg-green-500', text: 'text-green-500', hex: '#10b981' }, // Bランク点用
    B2: { bg: 'bg-blue-500', text: 'text-blue-500', hex: '#3b82f6' }
};

// DOM参照
const DOMElements = {
    masterContainer: document.getElementById('master-mob-container'),
    colContainer: document.getElementById('column-container'),
    cols: [document.getElementById('column-1'), document.getElementById('column-2'), document.getElementById('column-3')],
    rankTabs: document.getElementById('rank-tabs'),
    areaFilterWrapper: document.getElementById('area-filter-wrapper'),
    areaFilterPanel: document.getElementById('area-filter-panel'),
    statusMessage: document.getElementById('status-message'),
    reportModal: document.getElementById('report-modal'),
    reportForm: document.getElementById('report-form'),
    modalMobName: document.getElementById('modal-mob-name'),
    modalStatus: document.getElementById('modal-status'),
};

// グローバル状態
let userId = localStorage.getItem('user_uuid') || null;
let baseMobData = []; // mob_data.jsonの内容
let globalMobData = []; // baseMobData + Firebaseデータ
let currentFilter = JSON.parse(localStorage.getItem('huntFilterState')) || {
    rank: 'ALL',
    areaSets: { ALL: new Set() }
};
let openMobCardNo = localStorage.getItem('openMobCardNo') ? parseInt(localStorage.getItem('openMobCardNo')) : null;
let cullStatusMap = JSON.parse(localStorage.getItem('hunt_spawn_status')) || {}; // 湧き潰し状態

// Firebaseインスタンスの初期化 (グローバルスコープで一度だけ実行)
let app = initializeApp(FIREBASE_CONFIG);
let db = getFirestore(app);
let auth = getAuth(app);

// 💡 【重要修正】Functionsの初期化とリージョン指定
let functions = getFunctions(app, "asia-northeast2"); // ★リージョンをasia-northeast2に指定
// 💡 【重要修正】Functions呼び出し名をサーバー側の関数名に合わせる
const callHuntReport = httpsCallable(functions, 'processHuntReport'); 

// Firestoreリスナー解除用変数
let unsubscribeMobStatus = null;
let unsubscribeActiveCoords = null;


// --- 2. ユーティリティとフォーマッタ ---

/** ローカルISOからJSTに調整したISO文字列を生成 */
const toJstAdjustedIsoString = (date) => {
    // JST (UTC+9) へのオフセットを考慮
    const offset = date.getTimezoneOffset() * 60000;
    const jstTime = date.getTime() - offset + (9 * 60 * 60 * 1000);
    return new Date(jstTime).toISOString().slice(0, 19);
};

/** 秒数を HHh MMm にフォーマット */
const formatDuration = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
};

/** テキスト整形 (POP条件の//を<br>に) */
const processText = (text) => text.replace(/\/\//g, '<br>');

/** デバウンス関数 */
const debounce = (func, wait) => {
    let timeout;
    return function executed(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};

/** エラー/ステータスメッセージ表示 */
const displayStatus = (message, type = 'loading') => {
    DOMElements.statusMessage.textContent = message;
    DOMElements.statusMessage.className = 'fixed top-16 left-0 right-0 z-50 text-center py-1 text-sm transition-colors duration-300';
    if (type === 'error') {
        DOMElements.statusMessage.classList.add('bg-red-700/80', 'text-white');
    } else if (type === 'success') {
        DOMElements.statusMessage.classList.add('bg-green-700/80', 'text-white');
        setTimeout(() => DOMElements.statusMessage.textContent = '', 3000); // 成功は3秒で消す
    } else {
        DOMElements.statusMessage.classList.add('bg-blue-700/80', 'text-white');
    }
};


// --- 3. Repop計算と進捗描画 ---

/** Repop時間と進捗を計算 */
const calculateRepop = (mob) => {
    const now = Date.now() / 1000; // UNIX秒
    const lastKill = mob.last_kill_time || 0;
    const repopSec = mob.REPOP_s;
    const maxSec = mob.MAX_s;

    let minRepop = lastKill + repopSec;
    let maxRepop = lastKill + maxSec;
    let elapsedPercent = 0;
    let timeRemaining = 'Unknown';
    let status = 'Unknown'; // Next, PopWindow, MaxOver

    if (lastKill === 0) {
        // 未報告時: Nextを現在時刻+minRepopとして扱う (あくまで目安)
        minRepop = now + repopSec;
        maxRepop = now + maxSec; // 使わないが定義
        timeRemaining = `Next: ${formatDuration(minRepop - now)}`;
        status = 'Next';
    } else if (now < minRepop) {
        // POPウィンドウ前
        elapsedPercent = 0;
        timeRemaining = `Next: ${formatDuration(minRepop - now)}`;
        status = 'Next';
    } else if (now >= minRepop && now < maxRepop) {
        // POPウィンドウ中
        elapsedPercent = ((now - minRepop) / (maxRepop - minRepop)) * 100;
        elapsedPercent = Math.min(elapsedPercent, 100);
        timeRemaining = `${elapsedPercent.toFixed(0)}% (${formatDuration(maxRepop - now)} Left)`;
        status = 'PopWindow';
    } else {
        // MAX超過
        elapsedPercent = 100;
        timeRemaining = `POP済み (+${formatDuration(now - maxRepop)} over)`;
        status = 'MaxOver';
    }

    return { minRepop, maxRepop, elapsedPercent, timeRemaining, status };
};

/** 進捗バーの色とテキストを更新 */
const updateProgressBars = () => {
    document.querySelectorAll('.mob-card').forEach(card => {
        const mobNo = parseInt(card.dataset.mobNo);
        const mob = globalMobData.find(m => m.No === mobNo);
        if (!mob || !mob.repopInfo) return;
        
        const { elapsedPercent, timeRemaining, status } = mob.repopInfo;
        const progressBar = card.querySelector('.progress-bar-bg');
        const progressText = card.querySelector('.progress-text');

        progressBar.style.width = `${elapsedPercent}%`;
        progressText.textContent = timeRemaining;

        let colorStart = '#16a34a'; // Next: green-600
        let colorEnd = '#16a34a';

        if (status === 'PopWindow') {
            // 青 (0%) から赤 (100%) のグラデーション
            const h_start = 240; // Blue
            const h_end = 0; // Red
            const h = h_start + ((h_end - h_start) * (elapsedPercent / 100));
            colorStart = `hsl(${h_start}, 80%, 50%)`;
            colorEnd = `hsl(${h}, 80%, 50%)`;
            
            progressText.classList.remove('text-gray-400');
            progressText.classList.add('text-white', 'text-outline');
            progressBar.parentElement.classList.remove('animate-pulse');

        } else if (status === 'MaxOver') {
            // 赤色で点滅
            colorStart = '#ef4444'; // Red-500
            colorEnd = '#b91c1c'; // Red-700
            progressText.classList.add('text-white', 'text-outline');
            progressBar.parentElement.classList.add('animate-pulse');
        } else {
            // Next (初期)
            progressText.classList.add('text-gray-400');
            progressText.classList.remove('text-white', 'text-outline');
            progressBar.parentElement.classList.remove('animate-pulse');
        }
        
        progressBar.parentElement.style.setProperty('--progress-color-start', colorStart);
        progressBar.parentElement.style.setProperty('--progress-color-end', colorEnd);
    });
};


// --- 4. Firebase/データ取得とマージ ---

/** mob_data.jsonを読み込み、拡張名などを付与 */
const fetchBaseMobData = async () => {
    try {
        const response = await fetch(MOB_DATA_URL);
        if (!response.ok) throw new Error('Mob data failed to load.');
        const data = await response.json();
        
        baseMobData = data.mobConfig.map(mob => ({
            ...mob,
            // 拡張名の付与
            Expansion: EXPANSION_MAP[Math.floor(mob.No / 10000)] || "Unknown",
            REPOP_s: mob.REPOP * 3600, // JSONのREPOPを秒に変換
            MAX_s: mob.MAX * 3600,      // JSONのMAXを秒に変換
            // 動的情報用の初期値
            last_kill_time: 0,
            last_kill_memo: '',
            spawn_cull_status: {}, // active_coordsからマージされる
        }));
        
        // 初回は素のデータで描画開始 (データが揃うまでのフォールバック)
        globalMobData = [...baseMobData];
        filterAndRender(); 
        
    } catch (error) {
        console.error("Error loading base mob data:", error);
        displayStatus("ベースモブデータのロードに失敗しました。", 'error');
    }
};

/** Firebaseリスナーを設定 */
const startRealtimeListeners = () => {
    if (!db) return;
    
    // mob_status リスナー
    if (unsubscribeMobStatus) unsubscribeMobStatus();
    unsubscribeMobStatus = onSnapshot(collection(db, "mob_status"), (snapshot) => {
        const mobStatusMap = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            mobStatusMap[parseInt(doc.id)] = {
                // last_kill_timeがFirestoreのTimestampオブジェクトの場合の処理
                last_kill_time: data.last_kill_time?.seconds || 0, 
                last_kill_memo: data.last_kill_memo || ''
            };
        });
        mergeMobData(mobStatusMap, 'mob_status');
        displayStatus("データ更新完了。", 'success');
    }, (error) => {
        console.error("Mob status real-time error:", error);
        displayStatus("モブステータスのリアルタイム同期エラー。", 'error');
    });
    
    // active_coords リスナー (S/Aモブの湧き潰し状態を反映)
    if (unsubscribeActiveCoords) unsubscribeActiveCoords();
    unsubscribeActiveCoords = onSnapshot(collection(db, "active_coords"), (snapshot) => {
        const coordsMap = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            coordsMap[parseInt(doc.id)] = data.coords || [];
        });
        mergeMobData(coordsMap, 'active_coords');
    }, (error) => {
        console.error("Active coords real-time error:", error);
        // エラー表示はmob_statusで代表させる
    });
};

/** Firebaseから取得したデータをベースデータにマージ */
const mergeMobData = (dataMap, type) => {
    const newGlobalData = baseMobData.map(mob => {
        let mergedMob = { ...mob };
        const dynamicData = dataMap[mob.No];

        if (dynamicData) {
            if (type === 'mob_status') {
                mergedMob.last_kill_time = dynamicData.last_kill_time;
                mergedMob.last_kill_memo = dynamicData.last_kill_memo;
            } else if (type === 'active_coords') {
                 // spawn_pointsがJSONにある場合、coordsをマージして利用
                if (mob.spawn_points) {
                    mergedMob.spawn_cull_status = dynamicData.reduce((map, point) => {
                        map[point.id] = point.culled || false;
                        return map;
                    }, {});
                }
            }
        }
        
        // Repop計算はマージ後に行う
        mergedMob.repopInfo = calculateRepop(mergedMob);
        return mergedMob;
    });

    globalMobData = newGlobalData;
    sortAndRedistribute();
};


// --- 5. UI描画とイベント ---

/** モブカードHTMLを生成 */
const createMobCard = (mob) => {
    const rank = mob.Rank;
    const rankColor = RANK_COLORS[rank] || RANK_COLORS.A;
    const isOpen = mob.No === openMobCardNo;
    const lastKillDisplay = mob.last_kill_time > 0 
        ? new Date(mob.last_kill_time * 1000).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '未報告';
    
    // ヘッダー（Flexbox）
    const cardHTML = `
    <div class="mob-card bg-gray-700 rounded-lg shadow-xl overflow-hidden cursor-pointer border border-gray-700 hover:border-gray-500 transition duration-150" 
         data-mob-no="${mob.No}" data-rank="${rank}">
        
        <div class="p-4 flex items-center justify-between space-x-2 bg-gray-800/70" data-toggle="card-header">
            
            <div class="flex flex-col flex-shrink min-w-0">
                <div class="flex items-center space-x-2">
                    <span class="rank-icon ${rankColor.bg} text-white text-xs font-bold px-2 py-0.5 rounded-full">${rank}</span>
                    <span class="mob-name text-lg font-bold text-outline truncate max-w-xs md:max-w-[150px] lg:max-w-full">${mob.Name}</span>
                </div>
                <span class="text-xs text-gray-400 mt-0.5">${mob.Area} (${mob.Expansion})</span>
            </div>

            <div class="progress-bar flex-grow mx-2 h-6 rounded-full relative" style="min-width: 80px;">
                <div class="progress-bar-bg absolute left-0 top-0 rounded-full" style="width: 0;"></div>
                <div class="progress-text absolute inset-0 flex items-center justify-center text-xs font-semibold">
                    Calculating...
                </div>
            </div>

            <div class="flex-shrink-0">
                ${rank === 'A' 
                    ? `<button data-report-type="instant" data-mob-no="${mob.No}" class="px-3 py-1 text-xs rounded bg-yellow-500 hover:bg-yellow-400 text-gray-900 font-semibold transition">即時報告</button>`
                    : `<button data-report-type="modal" data-mob-no="${mob.No}" class="px-3 py-1 text-xs rounded bg-green-500 hover:bg-green-400 text-gray-900 font-semibold transition">報告する</button>`
                }
            </div>
        </div>

        <div class="expandable-panel ${isOpen ? 'open' : ''}">
            <div class="px-4 py-3 text-sm space-y-3">
                
                <div class="grid grid-cols-2 gap-x-4">
                    <div class="col-span-2 font-semibold text-yellow-300">抽選条件</div>
                    <div class="col-span-2 text-gray-300">${processText(mob.Condition)}</div>
                    
                    <div class="col-span-1 text-sm text-gray-400 mt-2">最短リポップ開始</div>
                    <div class="col-span-1 text-sm text-right font-mono mt-2">${mob.repopInfo?.minRepop ? new Date(mob.repopInfo.minRepop * 1000).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '未確定'}</div>
                    
                    <div class="col-span-1 text-sm text-gray-400">前回討伐時刻</div>
                    <div class="col-span-1 text-sm text-right font-mono">${lastKillDisplay}</div>
                </div>

                ${mob.last_kill_memo ? `<div class="p-2 rounded bg-gray-600/50"><span class="font-semibold text-gray-300">メモ: </span>${mob.last_kill_memo}</div>` : ''}

                ${mob.Map ? `
                    <div class="map-content py-2 flex justify-center relative">
                        <img src="./maps/${mob.Map}" alt="${mob.Area} Map" class="w-full h-auto rounded shadow-lg border border-gray-600">
                        <div class="map-overlay absolute inset-0" data-mob-no="${mob.No}">
                            ${mob.spawn_points ? mob.spawn_points.map(point => drawSpawnPoint(point, mob.spawn_cull_status, mob.No)).join('') : ''}
                        </div>
                    </div>
                ` : ''}

            </div>
        </div>
    </div>
    `;
    return cardHTML;
};

/** スポーン点DOM生成 */
const drawSpawnPoint = (point, cullStatus, mobNo) => {
    const isS_A = point.mob_ranks.some(r => r === 'S' || r === 'A');
    const isCulled = cullStatus[point.id] || false;
    const rankClass = point.mob_ranks.some(r => r === 'B1') ? 'rank-B1' : point.mob_ranks.some(r => r === 'B2') ? 'rank-B2' : 'rank-A';
    const interactiveClass = isS_A ? 'cursor-pointer' : 'rank-B'; 

    let specialClass = '';
    // 最後の未処理の点強調ロジックはJSのイベント/描画関数で処理する
    
    const color = RANK_COLORS[point.mob_ranks[0]]?.hex || '#ccc'; // 色は最初のランクで決定

    return `
        <div class="spawn-point ${rankClass} ${isCulled ? 'culled' : ''} ${specialClass} ${isS_A ? 'spawn-point-interactive' : ''}"
             data-point-id="${point.id}"
             data-mob-no="${mobNo}"
             data-is-interactive="${isS_A}"
             style="left: ${point.x}%; top: ${point.y}%; background-color: ${color};"
        ></div>
    `;
};

/** カラム数を決定し、カードを分配 */
const distributeCards = () => {
    const numCards = DOMElements.masterContainer.children.length;
    const windowWidth = window.innerWidth;
    // HTMLからブレークポイントを取得 (未設定ならデフォルト値)
    const mdBreakpoint = DOMElements.colContainer.dataset.breakpointMd ? parseInt(DOMElements.colContainer.dataset.breakpointMd) : 768;
    const lgBreakpoint = DOMElements.colContainer.dataset.breakpointLg ? parseInt(DOMElements.colContainer.dataset.breakpointLg) : 1024;


    let numColumns = 1;
    if (windowWidth >= lgBreakpoint) {
        numColumns = 3;
        DOMElements.cols[2].classList.remove('hidden');
    } else if (windowWidth >= mdBreakpoint) {
        numColumns = 2;
        DOMElements.cols[2].classList.add('hidden'); // 3列目を非表示
    } else {
        numColumns = 1;
        DOMElements.cols[2].classList.add('hidden');
    }

    // カラムをクリア
    DOMElements.cols.forEach(col => col.innerHTML = '');

    // ソート済みのカードDOMを分配
    const cards = Array.from(DOMElements.masterContainer.children);
    cards.forEach((card, index) => {
        const targetColIndex = index % numColumns;
        DOMElements.cols[targetColIndex].appendChild(card);
    });
    
    updateProgressBars(); // 分配後、進捗バーを更新して色を確定
};

/** フィルタリング、ソート、分配を一括実行 */
const filterAndRender = () => {
    // 1. フィルタリング
    const filteredData = globalMobData.filter(mob => {
        if (currentFilter.rank === 'ALL') return true;
        if (mob.Rank !== currentFilter.rank) return false;
        
        const areaSet = currentFilter.areaSets[currentFilter.rank];
        if (!areaSet || areaSet.size === 0) return true; // フィルタ未設定なら全て表示
        
        return areaSet.has(mob.Expansion);
    });
    
    // 2. ソート (Repop進捗降順)
    filteredData.sort((a, b) => b.repopInfo?.elapsedPercent - a.repopInfo?.elapsedPercent);
    
    // 3. masterContainerのDOMをソート
    const existingCards = new Map(Array.from(DOMElements.masterContainer.children).map(c => [c.dataset.mobNo, c]));
    const fragment = document.createDocumentFragment();

    filteredData.forEach(mob => {
        let card = existingCards.get(mob.No.toString());
        if (!card) {
            // カードが存在しない場合は作成
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = createMobCard(mob);
            card = tempDiv.firstChild;
        } 
        // 既存のカードには、データ更新時に再描画が必要な要素（進捗、メモ、開閉状態など）を更新するロジックが必要ですが、
        // ここではシンプルに「ソートのためのDOM入れ替え」のみに留めます。
        // updateProgressBars() で進捗は更新されます。
        
        fragment.appendChild(card);
    });
    
    // 既存のものをクリアし、ソート済みのカードを再挿入
    DOMElements.masterContainer.innerHTML = '';
    DOMElements.masterContainer.appendChild(fragment);

    // 4. カラム分配
    distributeCards();
    
    // 5. フィルタUIの更新
    updateFilterUI();
    
    // 状態の保存
    localStorage.setItem('huntFilterState', JSON.stringify({
        ...currentFilter,
        areaSets: Object.keys(currentFilter.areaSets).reduce((acc, key) => {
            // SetをArrayに変換して保存
            if (currentFilter.areaSets[key] instanceof Set) {
                acc[key] = Array.from(currentFilter.areaSets[key]);
            } else {
                acc[key] = currentFilter.areaSets[key];
            }
            return acc;
        }, {})
    }));
    localStorage.setItem('openMobCardNo', openMobCardNo);
};

/** フィルタUIの状態を更新 */
const updateFilterUI = () => {
    // タブの色更新
    DOMElements.rankTabs.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('bg-blue-800', 'bg-red-800', 'bg-yellow-800', 'bg-indigo-800');
        btn.classList.add('bg-gray-600');
        if (btn.dataset.rank === currentFilter.rank) {
            btn.classList.remove('bg-gray-600');
            const rank = btn.dataset.rank;
            // アクティブなタブの色を濃くする
            btn.classList.add(rank === 'ALL' ? 'bg-blue-800' : rank === 'S' ? 'bg-red-800' : rank === 'A' ? 'bg-yellow-800' : 'bg-indigo-800');
        }
    });
    
    // エリアパネルの再描画
    renderAreaFilterPanel();
};

/** エリアフィルタパネルを生成 */
const renderAreaFilterPanel = () => {
    DOMElements.areaFilterPanel.innerHTML = ''; // クリア
    if (currentFilter.rank === 'ALL') return; // ALLの時はエリアフィルタなし
    
    // 該当ランクの拡張エリアを抽出
    const areas = globalMobData
        .filter(m => m.Rank === currentFilter.rank)
        .reduce((set, mob) => {
            if (mob.Expansion) set.add(mob.Expansion);
            return set;
        }, new Set());
    
    const currentAreaSet = currentFilter.areaSets[currentFilter.rank] || new Set();
    
    // 全選択/解除ボタン
    const allButton = document.createElement('button');
    const isAllSelected = areas.size === currentAreaSet.size;
    allButton.textContent = isAllSelected ? '全解除' : '全選択';
    allButton.className = `area-filter-btn px-3 py-1 text-xs rounded font-semibold transition ${isAllSelected ? 'bg-red-500' : 'bg-gray-500 hover:bg-gray-400'}`;
    allButton.dataset.area = 'ALL';
    DOMElements.areaFilterPanel.appendChild(allButton);
    
    // 各拡張エリアボタン
    Array.from(areas).sort().forEach(area => {
        const btn = document.createElement('button');
        const isSelected = currentAreaSet.has(area);
        btn.textContent = area;
        btn.className = `area-filter-btn px-3 py-1 text-xs rounded font-semibold transition ${isSelected ? 'bg-green-500' : 'bg-gray-500 hover:bg-gray-400'}`;
        btn.dataset.area = area;
        DOMElements.areaFilterPanel.appendChild(btn);
    });
};

/** エリアフィルタパネルの開閉 */
const toggleAreaFilterPanel = (forceClose = false) => {
    if (forceClose || DOMElements.areaFilterWrapper.classList.contains('open')) {
        DOMElements.areaFilterWrapper.classList.remove('open');
        DOMElements.areaFilterWrapper.classList.add('max-h-0', 'opacity-0', 'pointer-events-none');
    } else {
        DOMElements.areaFilterWrapper.classList.add('open');
        DOMElements.areaFilterWrapper.classList.remove('max-h-0', 'opacity-0', 'pointer-events-none');
        renderAreaFilterPanel();
    }
};

/** ソートと分配をデバウンスして実行 */
const sortAndRedistribute = debounce(filterAndRender, 200);


// --- 6. 報告とモーダル操作 ---

/** モーダルを開く */
const openReportModal = (mobNo) => {
    const mob = globalMobData.find(m => m.No === mobNo);
    if (!mob) return;
    
    // 現在時刻をJST調整して設定
    const now = new Date();
    // UTCからJST (UTC+9) への調整
    const jstNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + (9 * 60 * 60 * 1000));
    const isoString = jstNow.toISOString().slice(0, 16);
    
    DOMElements.reportForm.dataset.mobNo = mobNo;
    DOMElements.modalMobName.textContent = `対象: ${mob.Name} (${mob.Area})`;
    document.getElementById('report-datetime').value = isoString;
    document.getElementById('report-memo').value = '';
    DOMElements.modalStatus.textContent = '';
    
    DOMElements.reportModal.classList.remove('hidden');
    DOMElements.reportModal.classList.add('flex');
};

/** モーダルを閉じる */
const closeReportModal = () => {
    DOMElements.reportModal.classList.add('hidden');
    DOMElements.reportModal.classList.remove('flex');
};

/** 討伐報告送信（reportsコレクションへの書き込み）*/
const submitReport = async (mobNo, timeISO, memo) => {
    if (!userId) {
        displayStatus("認証が完了していません。ページをリロードしてください。", 'error');
        return;
    }
    
    DOMElements.modalStatus.textContent = '送信中...';
    
    try {
        const killTime = new Date(timeISO).getTime() / 1000; // UNIX秒
        
        // Firestoreに直接書き込むことでCloud Functionsをトリガー
        await addDoc(collection(db, "reports"), {
            mob_id: mobNo,
            kill_time: killTime,
            reporter_uid: userId,
            memo: memo,
        });

        closeReportModal();
        displayStatus("報告が完了しました。データ反映を待っています。", 'success');
    } catch (error) {
        console.error("Report submission failed:", error);
        DOMElements.modalStatus.textContent = "送信エラー: " + (error.message || "通信失敗");
    }
};


// --- 7. イベントリスナー設定 ---

const setupEventListeners = () => {
    // Tab切り替え (イベント委譲)
    DOMElements.rankTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('.tab-button');
        if (!btn) return;
        
        const newRank = btn.dataset.rank;
        if (newRank === currentFilter.rank) {
            // 同ランクを再クリック -> エリアフィルタトグル
            toggleAreaFilterPanel();
        } else {
            // 異なるランクを選択
            currentFilter.rank = newRank;
            toggleAreaFilterPanel(true); // パネルは閉じる
            
            // 該当ランクのエリアセットを初期化（存在しない場合）
            if (!currentFilter.areaSets[newRank]) {
                currentFilter.areaSets[newRank] = new Set();
            }
            filterAndRender();
        }
    });
    
    // エリアフィルタボタン (イベント委譲)
    DOMElements.areaFilterPanel.addEventListener('click', (e) => {
        const btn = e.target.closest('.area-filter-btn');
        if (!btn) return;
        
        const rank = currentFilter.rank;
        let areaSet = currentFilter.areaSets[rank] || new Set();
        
        if (btn.dataset.area === 'ALL') {
            const allAreas = Array.from(globalMobData.filter(m => m.Rank === rank).reduce((set, mob) => {
                if (mob.Expansion) set.add(mob.Expansion);
                return set;
            }, new Set()));
            
            if (areaSet.size === allAreas.length) {
                // 全解除
                currentFilter.areaSets[rank] = new Set();
            } else {
                // 全選択
                currentFilter.areaSets[rank] = new Set(allAreas);
            }
        } else {
            const area = btn.dataset.area;
            if (areaSet.has(area)) {
                areaSet.delete(area);
            } else {
                areaSet.add(area);
            }
            currentFilter.areaSets[rank] = areaSet;
        }
        
        filterAndRender();
    });

    // モブカード全体 (イベント委譲)
    DOMElements.colContainer.addEventListener('click', (e) => {
        const card = e.target.closest('.mob-card');
        if (!card) return;
        const mobNo = parseInt(card.dataset.mobNo);

        // 1. 詳細パネル開閉
        if (e.target.closest('[data-toggle="card-header"]')) {
            const panel = card.querySelector('.expandable-panel');
            if (panel) {
                panel.classList.toggle('open');
                openMobCardNo = panel.classList.contains('open') ? mobNo : null;
            }
        }
        
        // 2. 報告ボタン
        const reportBtn = e.target.closest('button[data-report-type]');
        if (reportBtn) {
            e.stopPropagation(); // パネル開閉を防ぐ
            const reportType = reportBtn.dataset.reportType;
            
            if (reportType === 'modal') {
                openReportModal(mobNo);
            } else if (reportType === 'instant') {
                // Aランク即時報告
                const now = new Date();
                const timeISO = toJstAdjustedIsoString(now);
                submitReport(mobNo, timeISO, 'Aランク即時報告');
            }
        }
    });
    
    // モーダル操作
    document.getElementById('cancel-report').addEventListener('click', closeReportModal);
    DOMElements.reportForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const mobNo = parseInt(DOMElements.reportForm.dataset.mobNo);
        const datetime = document.getElementById('report-datetime').value;
        const memo = document.getElementById('report-memo').value;
        
        submitReport(mobNo, datetime, memo);
    });
    
    // マップ点クリック (湧き潰しトグル)
    DOMElements.colContainer.addEventListener('click', (e) => {
        const point = e.target.closest('.spawn-point-interactive');
        if (!point) return;
        
        const pointId = point.dataset.pointId;
        const mobNo = parseInt(point.dataset.mobNo);
        
        // ローカルストレージの状態をトグル
        cullStatusMap[pointId] = !cullStatusMap[pointId];
        localStorage.setItem('hunt_spawn_status', JSON.stringify(cullStatusMap));
        
        // DOMを即時更新
        point.classList.toggle('culled');
        
        // TODO: 最後の未処理の強調表示ロジックの再計算（ここでは省略）
    });

    // ウィンドウリサイズによるカラム再分配
    window.addEventListener('resize', sortAndRedistribute);
    
    // 定期的な進捗バー更新 (60秒ごと)
    setInterval(updateProgressBars, 60000);
};


// --- 8. 初期化と認証フロー ---

// 匿名認証後のユーザーID確定とリアルタイムリスナーの開始
onAuthStateChanged(auth, (user) => {
    if (user) {
        // 認証成功時
        userId = user.uid;
        localStorage.setItem('user_uuid', userId);
        
        // 認証が完了したらリアルタイムリスナーを開始
        startRealtimeListeners(); 
        
    } else {
        // 認証されていない場合、匿名認証を試みる
        signInAnonymously(auth).catch(e => console.error("Anonymous sign-in failed:", e));
    }
});

document.addEventListener('DOMContentLoaded', () => {
    // 認証と並行して、静的データ（mob_data.json）のロードを開始
    fetchBaseMobData();
    
    // localStorageからフィルタセットを復元 (Array -> Setに変換)
    if (currentFilter.areaSets[currentFilter.rank] && Array.isArray(currentFilter.areaSets[currentFilter.rank])) {
        currentFilter.areaSets[currentFilter.rank] = new Set(currentFilter.areaSets[currentFilter.rank]);
    } else {
        currentFilter.areaSets[currentFilter.rank] = new Set();
    }
    
    // イベントリスナー設定
    setupEventListeners();

    // 初回描画 (データが揃う前の骨組み表示)
    updateFilterUI();
    sortAndRedistribute();
    
    displayStatus("アプリを初期化中...", 'loading');
});
