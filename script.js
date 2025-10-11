import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { getFirestore, collection, onSnapshot, doc, getDoc, setDoc, addDoc } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

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

const MOB_DATA_URL = "./mob_data.json";

const EXPANSION_MAP = {
    1: "新生", 2: "蒼天", 3: "紅蓮", 4: "漆黒", 5: "暁月", 6: "黄金"
};

const FILTER_TO_DATA_RANK_MAP = {
    'FATE': 'F',
    'ALL': 'ALL',
    'S': 'S',
    'A': 'A',
};

// 修正: B1/B2の色を具体的に定義
const RANK_COLORS = {
    S: { bg: 'bg-red-600', text: 'text-red-600', hex: '#dc2626', label: 'S' },
    A: { bg: 'bg-yellow-600', text: 'text-yellow-600', hex: '#ca8a04', label: 'A' },
    F: { bg: 'bg-indigo-600', text: 'text-indigo-600', hex: '#4f46e5', label: 'FATE' },
    B1: { bg: 'bg-blue-500', text: 'text-blue-500', hex: '#3e83c4', label: 'B1' }, // B1内色
    B2: { bg: 'bg-red-500', text: 'text-red-500', hex: '#e16666', label: 'B2' } // B2内色
};

// 修正: プログレスバーのカスタム色/クラス名定義
const PROGRESS_CLASSES = {
    P0_60: 'progress-p0-60',
    P60_80: 'progress-p60-80',
    P80_100: 'progress-p80-100',
    TEXT_NEXT: 'progress-next-text', // #3e83c4
    TEXT_POP: 'progress-pop-text', // #ffffff
    MAX_OVER_BLINK: 'progress-max-over-blink' // 2秒1サイクル点滅
};

// 修正: CSSの定義を削除
// const setupCustomCSS = () => { /* ... 削除 ... */ };


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

let userId = localStorage.getItem('user_uuid') || null;
let baseMobData = [];
let globalMobData = [];
let currentFilter = JSON.parse(localStorage.getItem('huntFilterState')) || {
    rank: 'ALL',
    areaSets: { ALL: new Set() }
};
let openMobCardNo = localStorage.getItem('openMobCardNo') ? parseInt(localStorage.getItem('openMobCardNo')) : null;
let cullStatusMap = JSON.parse(localStorage.getItem('hunt_spawn_status')) || {};

let app = initializeApp(FIREBASE_CONFIG);
let db = getFirestore(app);
let auth = getAuth(app);

let functions = getFunctions(app, "asia-northeast2");
const callHuntReport = httpsCallable(functions, 'processHuntReport');

let unsubscribeMobStatus = null;
let unsubscribeActiveCoords = null;

// --- 2. ユーティリティとフォーマッタ ---

const toJstAdjustedIsoString = (date) => {
    const offset = date.getTimezoneOffset() * 60000;
    const jstTime = date.getTime() - offset + (9 * 60 * 60 * 1000);
    return new Date(jstTime).toISOString().slice(0, 19);
};

const formatDuration = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
};

function processText(text) {
    if (typeof text !== 'string' || !text) {
        return '';
    }
    // 抽選条件の改行 (// -> <br>)
    text = text.replace(/\/\//g, '<br>');
    return text;
}

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

const displayStatus = (message, type = 'loading') => {
    DOMElements.statusMessage.classList.remove('hidden');

    DOMElements.statusMessage.textContent = message;
    DOMElements.statusMessage.className = 'fixed top-14 left-0 right-0 z-40 text-center py-1 text-sm transition-colors duration-300';

    DOMElements.statusMessage.classList.remove('bg-red-700/80', 'bg-green-700/80', 'bg-blue-700/80', 'text-white');

    if (type === 'error') {
        DOMElements.statusMessage.classList.add('bg-red-700/80', 'text-white');
    } else if (type === 'success') {
        DOMElements.statusMessage.classList.add('bg-green-700/80', 'text-white');
        setTimeout(() => {
            DOMElements.statusMessage.textContent = '';
            DOMElements.statusMessage.classList.add('hidden');
        }, 3000);
    } else {
        DOMElements.statusMessage.classList.add('bg-blue-700/80', 'text-white');
    }
};

// --- 3. Repop計算と進捗描画 ---

const calculateRepop = (mob) => {
    const now = Date.now() / 1000;
    const lastKill = mob.last_kill_time || 0;
    const repopSec = mob.REPOP_s;
    const maxSec = mob.MAX_s;

    let minRepop = lastKill + repopSec;
    let maxRepop = lastKill + maxSec;
    let elapsedPercent = 0;
    let timeRemaining = 'Unknown';
    let status = 'Unknown';

    if (lastKill === 0) {
        minRepop = now + repopSec;
        maxRepop = now + maxSec;
        timeRemaining = `Next: ${formatDuration(minRepop - now)}`;
        status = 'Next';
    } else if (now < minRepop) {
        elapsedPercent = 0;
        timeRemaining = `Next: ${formatDuration(minRepop - now)}`;
        status = 'Next';
    } else if (now >= minRepop && now < maxRepop) {
        elapsedPercent = ((now - minRepop) / (maxRepop - minRepop)) * 100;
        elapsedPercent = Math.min(elapsedPercent, 100);
        timeRemaining = `${elapsedPercent.toFixed(0)}% (${formatDuration(maxRepop - now)} Left)`;
        status = 'PopWindow';
    } else {
        elapsedPercent = 100;
        timeRemaining = `POP済み (+${formatDuration(now - maxRepop)} over)`;
        status = 'MaxOver';
    }

    return { minRepop, maxRepop, elapsedPercent, timeRemaining, status };
};

// 修正: 進捗率に応じた色、テキスト色、点滅アニメーションをクラスとして適用
const updateProgressBars = () => {
    document.querySelectorAll('.mob-card').forEach(card => {
        const mobNo = parseInt(card.dataset.mobNo);
        const mob = globalMobData.find(m => m.No === mobNo);
        if (!mob || !mob.repopInfo) return;

        const { elapsedPercent, timeRemaining, status } = mob.repopInfo;
        const progressBar = card.querySelector('.progress-bar-bg');
        const progressText = card.querySelector('.progress-text');
        const progressBarWrapper = progressBar.parentElement;

        progressBar.style.width = `${elapsedPercent}%`;
        progressText.textContent = timeRemaining;

        let bgColorClass = '';
        let textColorClass = '';
        let blinkClass = '';

        // 進行色クラスの決定
        progressBar.classList.remove(PROGRESS_CLASSES.P0_60, PROGRESS_CLASSES.P60_80, PROGRESS_CLASSES.P80_100);
        
        if (status === 'PopWindow') {
            if (elapsedPercent <= 60) {
                bgColorClass = PROGRESS_CLASSES.P0_60;
            } else if (elapsedPercent <= 80) {
                bgColorClass = PROGRESS_CLASSES.P60_80;
            } else {
                bgColorClass = PROGRESS_CLASSES.P80_100;
            }
            textColorClass = PROGRESS_CLASSES.TEXT_POP;
            blinkClass = '';
        } else if (status === 'MaxOver') {
            bgColorClass = PROGRESS_CLASSES.P80_100; 
            textColorClass = PROGRESS_CLASSES.TEXT_POP;
            blinkClass = PROGRESS_CLASSES.MAX_OVER_BLINK;
        } else { // 'Next' or 'Unknown'
            // Nextステータスの場合、バーの幅は0%だが、テキスト色のみ変更
            bgColorClass = ''; // バーの幅が0なので、バーの色は不要
            textColorClass = PROGRESS_CLASSES.TEXT_NEXT;
            blinkClass = '';
        }

        if (bgColorClass) {
             progressBar.classList.add(bgColorClass);
        }
        
        // テキスト色クラスの適用
        progressText.classList.remove(PROGRESS_CLASSES.TEXT_NEXT, PROGRESS_CLASSES.TEXT_POP);
        progressText.classList.add(textColorClass);

        // 点滅アニメーションの適用/解除
        progressBarWrapper.classList.remove(PROGRESS_CLASSES.MAX_OVER_BLINK);
        if (blinkClass) {
            progressBarWrapper.classList.add(blinkClass);
        }
    });
};

// --- 4. Firebase/データ取得とマージ ---

const fetchBaseMobData = async () => {
    try {
        const response = await fetch(MOB_DATA_URL);
        if (!response.ok) throw new Error('Mob data failed to load.');
        const data = await response.json();

        baseMobData = data.mobConfig.map(mob => ({
            ...mob,
            Expansion: EXPANSION_MAP[Math.floor(mob.No / 10000)] || "Unknown",
            REPOP_s: mob.REPOP * 3600,
            MAX_s: mob.MAX * 3600,
            last_kill_time: 0,
            last_kill_memo: '',
            spawn_cull_status: {},
        }));

        globalMobData = [...baseMobData];
        filterAndRender();

    } catch (error) {
        displayStatus("ベースモブデータのロードに失敗しました。", 'error');
    }
};

const startRealtimeListeners = () => {
    if (!db) return;

    if (unsubscribeMobStatus) unsubscribeMobStatus();
    unsubscribeMobStatus = onSnapshot(collection(db, "mob_status"), (snapshot) => {
        const mobStatusMap = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            mobStatusMap[parseInt(doc.id)] = {
                last_kill_time: data.last_kill_time?.seconds || 0,
                last_kill_memo: data.last_kill_memo || ''
            };
        });
        mergeMobData(mobStatusMap, 'mob_status');
        displayStatus("データ更新完了。", 'success');
    }, (error) => {
        displayStatus("モブステータスのリアルタイム同期エラー。", 'error');
    });

    if (unsubscribeActiveCoords) unsubscribeActiveCoords();
    unsubscribeActiveCoords = onSnapshot(collection(db, "active_coords"), (snapshot) => {
        const coordsMap = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            coordsMap[parseInt(doc.id)] = data.coords || [];
        });
        mergeMobData(coordsMap, 'active_coords');
    }, (error) => {
    });
};

const mergeMobData = (dataMap, type) => {
    const newGlobalData = baseMobData.map(mob => {
        let mergedMob = { ...mob };
        const dynamicData = dataMap[mob.No];

        if (dynamicData) {
            if (type === 'mob_status') {
                mergedMob.last_kill_time = dynamicData.last_kill_time;
                mergedMob.last_kill_memo = dynamicData.last_kill_memo;
            } else if (type === 'active_coords') {
                if (mob.spawn_points) {
                    mergedMob.spawn_cull_status = dynamicData.reduce((map, point) => {
                        map[point.id] = point.culled || false;
                        return map;
                    }, {});
                }
            }
        }

        mergedMob.repopInfo = calculateRepop(mergedMob);
        return mergedMob;
    });

    globalMobData = newGlobalData;
    sortAndRedistribute();
};


// --- 5. UI描画とイベント ---

// 修正: カードの余白調整を反映
const createMobCard = (mob) => {
    const rank = mob.Rank;
    const rankConfig = RANK_COLORS[rank] || RANK_COLORS.A;
    const rankLabel = rankConfig.label || rank;
    
    const isOpen = mob.No === openMobCardNo;
    const lastKillDisplay = mob.last_kill_time > 0
        ? new Date(mob.last_kill_time * 1000).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '未報告';

    const lastOneMob = globalMobData.find(m => m.No === mob.No);
    const isLastOne = lastOneMob?.spawn_points?.length === 1 && lastOneMob.spawn_points[0].is_last_one;

    const spawnPointsHtml = (mob.spawn_points ?? []).map(point => drawSpawnPoint(point, mob.spawn_cull_status, mob.No, mob.Rank, isLastOne)).join('');

    const cardHTML = `
    <div class="mob-card bg-gray-700 rounded-lg shadow-xl overflow-hidden cursor-pointer border border-gray-700 hover:border-gray-500 transition duration-150"
        data-mob-no="${mob.No}" data-rank="${rank}">
        
        <div class="p-1.5 flex items-center justify-between space-x-2 bg-gray-800/70" data-toggle="card-header">
            
            <div class="flex flex-col flex-shrink min-w-0">
                <div class="flex items-center space-x-2">
                    <span class="rank-icon ${rankConfig.bg} text-white text-xs font-bold px-2 py-0.5 rounded-full">${rankLabel}</span>
                    <span class="mob-name text-lg font-bold text-outline truncate max-w-xs md:max-w-[150px] lg:max-w-full">${mob.Name}</span>
            </div>
                <span class="text-xs text-gray-400 mt-0.5">${mob.Area} (${mob.Expansion})</span>
            </div>

            <div class="progress-bar flex-grow mx-2 h-4 rounded-full relative overflow-hidden transition-all duration-100 ease-linear" style="min-width: 80px;">
                <div class="progress-bar-bg absolute left-0 top-0 h-full rounded-full transition-all duration-100 ease-linear" style="width: 0;"></div>
                <div class="progress-text absolute inset-0 flex items-center justify-center text-xs font-semibold" style="line-height: 1;">
                    Calculating...
                </div>
            </div>

            <div class="flex-shrink-0">
                ${rank === 'A'
                    ? `<button data-report-type="instant" data-mob-no="${mob.No}" class="px-2 py-0.5 text-xs rounded bg-yellow-500 hover:bg-yellow-400 text-gray-900 font-semibold transition">即時報告</button>`
                    : `<button data-report-type="modal" data-mob-no="${mob.No}" class="px-2 py-0.5 text-xs rounded bg-green-500 hover:bg-green-400 text-gray-900 font-semibold transition">報告する</button>`
                }
            </div>
        </div>

        <div class="expandable-panel ${isOpen ? 'open' : ''}">
            <div class="px-2 py-1 text-sm space-y-1.5">
                
                <div class="grid grid-cols-2 gap-x-4">
                    <div class="col-span-2 font-semibold text-yellow-300">抽選条件</div>
                    <div class="col-span-2 text-gray-300">${processText(mob.Condition)}</div>
                    
                    <div class="col-span-1 text-xs text-gray-400 mt-1">最短リポップ開始</div>
                    <div class="col-span-1 text-xs text-right font-mono mt-1">${mob.repopInfo?.minRepop ? new Date(mob.repopInfo.minRepop * 1000).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '未確定'}</div>
                    
                    <div class="col-span-1 text-xs text-gray-400">前回討伐時刻</div>
                    <div class="col-span-1 text-xs text-right font-mono">${lastKillDisplay}</div>
                </div>

                ${mob.last_kill_memo ? `<div class="p-1 rounded bg-gray-600/50 text-xs"><span class="font-semibold text-gray-300">メモ: </span>${mob.last_kill_memo}</div>` : ''}

                ${mob.Map ? `
                    <div class="map-content py-1.5 flex justify-center relative">
                        <img src="./maps/${mob.Map}" alt="${mob.Area} Map" class="w-full h-auto rounded shadow-lg border border-gray-600">
                        <div class="map-overlay absolute inset-0" data-mob-no="${mob.No}">
                            ${spawnPointsHtml}
                        </div>
                    </div>
                ` : ''}

            </div>
        </div>
    </div>
    `;
    return cardHTML;
};

// 修正: drawSpawnPoint関数からインラインスタイルを削除し、クラス/データ属性に置き換え
const drawSpawnPoint = (point, cullStatus, mobNo, mobRank, isLastOne) => {
    const isS_A_Cullable = point.mob_ranks.some(r => r === 'S' || r === 'A');
    const isCulled = cullStatus[point.id] || false;
    const isB_Only = point.mob_ranks.every(r => r.startsWith('B'));

    let sizeClass = '';
    let colorClass = '';
    let specialClass = '';
    let isInteractive = isS_A_Cullable;

    // 1. ラストワンの場合
    if (isLastOne) {
        // ラストワンは最優先で固定色とサイズ
        sizeClass = 'spawn-point-lastone'; // 12px, #00ff3c
        colorClass = 'color-lastone';
        specialClass = 'spawn-point-shadow';
        isInteractive = false; 

        // S/Aラストワン時、Bランクポイントをグレーに反転
        if (isB_Only) {
            sizeClass = 'spawn-point-b-only'; // 8px
            colorClass = 'color-b-inverted'; // グレーに反転
            specialClass = 'opacity-50'; 
            isInteractive = false;
        }

    } else if (isS_A_Cullable) {
        // 2. S/A湧き潰し対象ポイント (未選択/選択済み)
        const rank = point.mob_ranks.find(r => r.startsWith('B')); // B1 or B2
        colorClass = rank === 'B1' ? 'color-b1' : 'color-b2';
        
        if (isCulled) {
            // 選択済み (湧き潰し済み)
            sizeClass = 'spawn-point-culled'; // 8px内, 10px外 (グレー内, 白外)
            specialClass = 'culled';
        } else {
            // 未選択
            sizeClass = 'spawn-point-sa'; // 10px内, 12px外 (B1/B2色 + 濃い枠)
            specialClass = 'spawn-point-shadow spawn-point-interactive'; // 影とインタラクティブ
        }

    } else if (isB_Only) {
        // 3. Bランクのみポイント (非湧き潰し対象)
        const rank = point.mob_ranks[0];
        colorClass = rank === 'B1' ? 'color-b1-only' : 'color-b2-only'; // 内径8px
        sizeClass = 'spawn-point-b-only'; 
        isInteractive = false;
        specialClass = '';
    } else {
        // Fallback
        sizeClass = 'spawn-point-b-only';
        colorClass = 'color-default';
        isInteractive = false;
        specialClass = '';
    }
    
    // Bのみポイントが湧き潰し済み状態になるロジックを排除 (湧き潰し対象ではないため)

    return `
        <div class="spawn-point absolute rounded-full transform -translate-x-1/2 -translate-y-1/2 ${sizeClass} ${colorClass} ${specialClass}"
            data-point-id="${point.id}"
            data-mob-no="${mobNo}"
            data-is-interactive="${isInteractive}"
            style="left: ${point.x}%; top: ${point.y}%;"
        ></div>
    `;
};


const distributeCards = () => {
    const numCards = DOMElements.masterContainer.children.length;
    const windowWidth = window.innerWidth;
    const mdBreakpoint = DOMElements.colContainer.dataset.breakpointMd ? parseInt(DOMElements.colContainer.dataset.breakpointMd) : 768;
    const lgBreakpoint = DOMElements.colContainer.dataset.breakpointLg ? parseInt(DOMElements.colContainer.dataset.breakpointLg) : 1024;


    let numColumns = 1;
    if (windowWidth >= lgBreakpoint) {
        numColumns = 3;
        DOMElements.cols[2].classList.remove('hidden');
    } else if (windowWidth >= mdBreakpoint) {
        numColumns = 2;
        DOMElements.cols[2].classList.add('hidden');
    } else {
        numColumns = 1;
        DOMElements.cols[2].classList.add('hidden');
    }

    DOMElements.cols.forEach(col => col.innerHTML = '');

    const cards = Array.from(DOMElements.masterContainer.children);
    cards.forEach((card, index) => {
        const targetColIndex = index % numColumns;
        DOMElements.cols[targetColIndex].appendChild(card);
    });

    updateProgressBars();
};

const filterAndRender = () => {
    const targetDataRank = FILTER_TO_DATA_RANK_MAP[currentFilter.rank] || currentFilter.rank;
    
    const filteredData = globalMobData.filter(mob => {
        if (currentFilter.rank === 'ALL') return true;
        
        if (mob.Rank !== targetDataRank) return false;

        const areaSet = currentFilter.areaSets[currentFilter.rank];
        if (!areaSet || !(areaSet instanceof Set) || areaSet.size === 0) return true;

        return areaSet.has(mob.Expansion);
    });

    filteredData.sort((a, b) => b.repopInfo?.elapsedPercent - a.repopInfo?.elapsedPercent);

    const existingCards = new Map(Array.from(DOMElements.masterContainer.children)
        .filter(c => c.dataset.mobNo)
        .map(c => [c.dataset.mobNo, c])
    );
    const fragment = document.createDocumentFragment();

    filteredData.forEach(mob => {
        let card = existingCards.get(mob.No.toString());
        if (!card) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = createMobCard(mob);
            card = tempDiv.firstElementChild; 
        }

        if (card) { 
             fragment.appendChild(card);
        }
    });

    DOMElements.masterContainer.innerHTML = '';
    DOMElements.masterContainer.appendChild(fragment);

    distributeCards();

    updateFilterUI();

    localStorage.setItem('huntFilterState', JSON.stringify({
        ...currentFilter,
        areaSets: Object.keys(currentFilter.areaSets).reduce((acc, key) => {
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

const updateFilterUI = () => {
    
    const currentRankKeyForColor = FILTER_TO_DATA_RANK_MAP[currentFilter.rank] || currentFilter.rank;

    DOMElements.rankTabs.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('bg-blue-800', 'bg-red-800', 'bg-yellow-800', 'bg-indigo-800');
        btn.classList.add('bg-gray-600');
        if (btn.dataset.rank === currentFilter.rank) {
            btn.classList.remove('bg-gray-600');
            const rank = btn.dataset.rank;
            
            btn.classList.add(rank === 'ALL' ? 'bg-blue-800' : currentRankKeyForColor === 'S' ? 'bg-red-800' : currentRankKeyForColor === 'A' ? 'bg-yellow-800' : currentRankKeyForColor === 'F' ? 'bg-indigo-800' : 'bg-gray-800');
        }
    });

    if (currentFilter.rank !== 'ALL') {
        renderAreaFilterPanel();
    }
};

const renderAreaFilterPanel = () => {
    DOMElements.areaFilterPanel.innerHTML = '';
    
    const targetDataRank = FILTER_TO_DATA_RANK_MAP[currentFilter.rank] || currentFilter.rank;

    const areas = globalMobData
        .filter(m => m.Rank === targetDataRank)
        .reduce((set, mob) => {
            if (mob.Expansion) set.add(mob.Expansion);
            return set;
        }, new Set());

    const currentAreaSet = currentFilter.areaSets[currentFilter.rank] instanceof Set
        ? currentFilter.areaSets[currentFilter.rank]
        : new Set();

    const allButton = document.createElement('button');
    const isAllSelected = areas.size === currentAreaSet.size && areas.size > 0;
    allButton.textContent = isAllSelected ? '全解除' : '全選択';
    allButton.className = `area-filter-btn px-3 py-1 text-xs rounded font-semibold transition ${isAllSelected ? 'bg-red-500' : 'bg-gray-500 hover:bg-gray-400'}`;
    allButton.dataset.area = 'ALL';
    DOMElements.areaFilterPanel.appendChild(allButton);

    // 展開エリアの並び順を維持 (黄金 -> 新生)
    Array.from(areas).sort((a, b) => {
        const indexA = Object.values(EXPANSION_MAP).indexOf(a);
        const indexB = Object.values(EXPANSION_MAP).indexOf(b);
        return indexB - indexA; // 逆順 (5 -> 1)
    }).forEach(area => {
        const btn = document.createElement('button');
        const isSelected = currentAreaSet.has(area);
        btn.textContent = area;
        btn.className = `area-filter-btn px-3 py-1 text-xs rounded font-semibold transition ${isSelected ? 'bg-green-500' : 'bg-gray-500 hover:bg-gray-400'}`;
        btn.dataset.area = area;
        DOMElements.areaFilterPanel.appendChild(btn);
    });
};

const toggleAreaFilterPanel = (forceClose = false) => {
    if (currentFilter.rank === 'ALL') {
        forceClose = true;
    }

    if (forceClose || DOMElements.areaFilterWrapper.classList.contains('open')) {
        DOMElements.areaFilterWrapper.classList.remove('open');
        DOMElements.areaFilterWrapper.classList.add('max-h-0', 'opacity-0', 'pointer-events-none');
    } else {
        DOMElements.areaFilterWrapper.classList.add('open');
        DOMElements.areaFilterWrapper.classList.remove('max-h-0', 'opacity-0', 'pointer-events-none');
        renderAreaFilterPanel();
    }
};

const sortAndRedistribute = debounce(filterAndRender, 200);

// --- 6. 報告とモーダル操作 ---

const openReportModal = (mobNo) => {
    const mob = globalMobData.find(m => m.No === mobNo);
    if (!mob) return;

    const now = new Date();
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

const closeReportModal = () => {
    DOMElements.reportModal.classList.add('hidden');
    DOMElements.reportModal.classList.remove('flex');
};

const submitReport = async (mobNo, timeISO, memo) => {
    if (!userId) {
        displayStatus("認証が完了していません。ページをリロードしてください。", 'error');
        return;
    }

    DOMElements.modalStatus.textContent = '送信中...';

    try {
        const killTime = new Date(timeISO).getTime() / 1000;

        await addDoc(collection(db, "reports"), {
            mob_id: mobNo,
            kill_time: killTime,
            reporter_uid: userId,
            memo: memo,
        });

        closeReportModal();
        displayStatus("報告が完了しました。データ反映を待っています。", 'success');
    } catch (error) {
        DOMElements.modalStatus.textContent = "送信エラー: " + (error.message || "通信失敗");
    }
};


// --- 7. イベントリスナー設定 ---

const setupEventListeners = () => {
    DOMElements.rankTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('.tab-button');
        if (!btn) return;

        const newRank = btn.dataset.rank;

        if (newRank === currentFilter.rank) {
            if (newRank !== 'ALL') {
                toggleAreaFilterPanel();
            } else {
                toggleAreaFilterPanel(true);
            }
        } else {
            currentFilter.rank = newRank;

            if (newRank === 'ALL') {
                toggleAreaFilterPanel(true);
            } else {
                toggleAreaFilterPanel(false);
            }

            if (!currentFilter.areaSets[newRank] || !(currentFilter.areaSets[newRank] instanceof Set)) {
                currentFilter.areaSets[newRank] = new Set();
            }
            filterAndRender();
        }
    });

    DOMElements.areaFilterPanel.addEventListener('click', (e) => {
        const btn = e.target.closest('.area-filter-btn');
        if (!btn) return;

        const uiRank = currentFilter.rank;
        const dataRank = FILTER_TO_DATA_RANK_MAP[uiRank] || uiRank;

        let areaSet = currentFilter.areaSets[uiRank];

        if (btn.dataset.area === 'ALL') {
            const allAreas = Array.from(globalMobData.filter(m => m.Rank === dataRank).reduce((set, mob) => {
                if (mob.Expansion) set.add(mob.Expansion);
                return set;
            }, new Set()));

            if (areaSet.size === allAreas.length) {
                currentFilter.areaSets[uiRank] = new Set();
            } else {
                currentFilter.areaSets[uiRank] = new Set(allAreas);
            }
        } else {
            const area = btn.dataset.area;
            if (areaSet.has(area)) {
                areaSet.delete(area);
            } else {
                areaSet.add(area);
            }
        }

        filterAndRender();
    });

    DOMElements.colContainer.addEventListener('click', (e) => {
        const card = e.target.closest('.mob-card');
        if (!card) return;
        const mobNo = parseInt(card.dataset.mobNo);

        if (e.target.closest('[data-toggle="card-header"]')) {
            const panel = card.querySelector('.expandable-panel');
            if (panel) {
                // 排他的開閉のロジック
                if (!panel.classList.contains('open')) {
                    document.querySelectorAll('.expandable-panel.open').forEach(openPanel => {
                        openPanel.classList.remove('open');
                    });
                    panel.classList.add('open');
                    openMobCardNo = mobNo;
                } else {
                    panel.classList.remove('open');
                    openMobCardNo = null;
                }
            }
        }

        const reportBtn = e.target.closest('button[data-report-type]');
        if (reportBtn) {
            e.stopPropagation();
            const reportType = reportBtn.dataset.reportType;

            if (reportType === 'modal') {
                openReportModal(mobNo);
            } else if (reportType === 'instant') {
                const now = new Date();
                const timeISO = toJstAdjustedIsoString(now);
                submitReport(mobNo, timeISO, 'Aランク即時報告');
            }
        }
    });

    // スポーンポイントのクリック処理
    DOMElements.colContainer.addEventListener('click', (e) => {
        const point = e.target.closest('.spawn-point');
        // data-is-interactive="true" のポイントのみ処理
        if (!point || point.dataset.isInteractive !== 'true') return;

        const pointId = point.dataset.pointId;
        
        cullStatusMap[pointId] = !cullStatusMap[pointId];
        localStorage.setItem('hunt_spawn_status', JSON.stringify(cullStatusMap));

        // 再描画して最新の湧き潰し状態を反映
        filterAndRender();
    });

    document.getElementById('cancel-report').addEventListener('click', closeReportModal);
    DOMElements.reportForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const mobNo = parseInt(DOMElements.reportForm.dataset.mobNo);
        const datetime = document.getElementById('report-datetime').value;
        const memo = document.getElementById('report-memo').value;

        submitReport(mobNo, datetime, memo);
    });

    window.addEventListener('resize', sortAndRedistribute);

    // 1分ごと (60000ms) の更新を維持
    setInterval(updateProgressBars, 60000);
    // 初回ロードと毎秒の補完のために、1秒ごとに updateProgressBars を呼び出す
    setInterval(updateProgressBars, 1000);
};

// --- 8. 初期化と認証フロー ---

onAuthStateChanged(auth, (user) => {
    if (user) {
        userId = user.uid;
        localStorage.setItem('user_uuid', userId);

        startRealtimeListeners();

    } else {
        signInAnonymously(auth).catch(e => {});
    }
});

document.addEventListener('DOMContentLoaded', () => {
    fetchBaseMobData();

    const newAreaSets = {};
    for (const rankKey in currentFilter.areaSets) {
        let savedData = currentFilter.areaSets[rankKey];
        if (Array.isArray(savedData)) {
            newAreaSets[rankKey] = new Set(savedData);
        } else if (savedData instanceof Set) {
            newAreaSets[rankKey] = savedData;
        } else {
            newAreaSets[rankKey] = new Set();
        }
    }
    currentFilter.areaSets = newAreaSets;

    setupEventListeners();
    
    updateFilterUI();
    sortAndRedistribute();

    displayStatus("アプリを初期化中...", 'loading');
});
