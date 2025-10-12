import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { getFirestore, collection, onSnapshot, doc, setDoc, addDoc } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-functions.js";

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

const RANK_COLORS = {
    S: { bg: 'bg-red-600', text: 'text-red-600', hex: '#dc2626', label: 'S' },
    A: { bg: 'bg-yellow-600', text: 'text-yellow-600', hex: '#ca8a04', label: 'A' },
    F: { bg: 'bg-indigo-600', text: 'text-indigo-600', hex: '#4f46e5', label: 'FATE' },
    B1: { bg: 'bg-blue-500', text: 'text-blue-500', hex: '#3e83c4', label: 'B1' },
    B2: { bg: 'bg-red-500', text: 'text-red-500', hex: '#e16666', label: 'B2' }
};

const PROGRESS_CLASSES = {
    P0_60: 'progress-p0-60', 
    P60_80: 'progress-p60-80', 
    P80_100: 'progress-p80-100', 
    TEXT_NEXT: 'progress-next-text', 
    TEXT_POP: 'progress-pop-text', 
    MAX_OVER_BLINK: 'progress-max-over-blink' 
};

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


let app = initializeApp(FIREBASE_CONFIG);
let db = getFirestore(app);
let auth = getAuth(app);

let functions = getFunctions(app, "asia-northeast2");
const callHuntReport = httpsCallable(functions, 'processHuntReport');
const callUpdateCrushStatus = httpsCallable(functions, 'updateCrushStatus');


let unsubscribeActiveCoords = null; // MobStatusの購読はmob_locationsに統合


// --- ユーティリティとフォーマッタ ---

const toJstAdjustedIsoString = (date) => {
    const offset = date.getTimezoneOffset() * 60000;
    const jstTime = date.getTime() - offset + (9 * 60 * 60 * 1000);
    return new Date(jstTime).toISOString().slice(0, 19);
};

const formatDuration = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h.toString().padStart(2, '0')}h ${m.toString().padStart(2, '0')}m`;
};

const formatLastKillTime = (timestamp) => {
    if (timestamp === 0) return '未報告';

    const killTimeMs = timestamp * 1000;
    const nowMs = Date.now();
    const diffSeconds = Math.floor((nowMs - killTimeMs) / 1000);

    if (diffSeconds < 3600) {
        if (diffSeconds < 60) return `Just now`;
        const minutes = Math.floor(diffSeconds / 60);
        return `${minutes}m ago`;
    }

    const date = new Date(killTimeMs);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    
    return `${month}/${day} ${hours}:${minutes}`;
};


function processText(text) {
    if (typeof text !== 'string' || !text) {
        return '';
    }
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

// --- 湧き潰し状態の判定ロジック (サーバー仕様対応) ---

/**
 * 座標の現在の表示状態を判定するコアロジック
 * @param {object} point - Mobの湧き座標オブジェクト (crushed_at, uncrushed_atを持つ)
 * @param {number} lastKillTimeSec - mob_locations.last_kill_time (秒単位のUnixタイムスタンプ)
 * @returns {boolean} - true: 潰されていると表示 / false: 潰されていないと表示
 */
function isPointCrushed(point, lastKillTimeSec) {
    const displayTime = lastKillTimeSec > 0 ? new Date(lastKillTimeSec * 1000) : new Date(0); 

    const crushedTime = point.crushed_at?.toDate();
    const uncrushedTime = point.uncrushed_at?.toDate();

    let effectiveCrushedTime = null;
    let effectiveUncrushedTime = null;

    if (crushedTime && crushedTime > displayTime) {
        effectiveCrushedTime = crushedTime;
    }
    if (uncrushedTime && uncrushedTime > displayTime) {
        effectiveUncrushedTime = uncrushedTime;
    }

    if (!effectiveCrushedTime && !effectiveUncrushedTime) {
        return false;
    }

    if (effectiveCrushedTime && 
        (!effectiveUncrushedTime || effectiveCrushedTime.getTime() > effectiveUncrushedTime.getTime())) {
        return true;
    }
    
    return false;
}

// --- Repop計算と進捗描画 ---

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

    const nextMinRepopDate = minRepop > now ? new Date(minRepop * 1000) : null;
    
    return { minRepop, maxRepop, elapsedPercent, timeRemaining, status, nextMinRepopDate };
};

const updateProgressBars = () => {
    document.querySelectorAll('.mob-card').forEach(card => {
        const mobNo = parseInt(card.dataset.mobNo);
        const mob = globalMobData.find(m => m.No === mobNo);
        if (!mob || !mob.repopInfo) return;

        const { elapsedPercent, timeRemaining, status } = mob.repopInfo;
        const progressBar = card.querySelector('.progress-bar-bg');
        const progressText = card.querySelector('.progress-text');
        const progressBarWrapper = progressBar.parentElement;

        if (!progressBar || !progressText) return;

        progressBar.style.width = `${elapsedPercent}%`;
        progressText.textContent = timeRemaining;

        let bgColorClass = '';
        let textColorClass = '';
        let blinkClass = '';

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
        } else {
            bgColorClass = '';
            textColorClass = PROGRESS_CLASSES.TEXT_NEXT;
            blinkClass = '';
        }

        if (bgColorClass) {
            progressBar.classList.add(bgColorClass);
        }
        
        progressText.classList.remove(PROGRESS_CLASSES.TEXT_NEXT, PROGRESS_CLASSES.TEXT_POP);
        progressText.classList.add(textColorClass);

        progressBarWrapper.classList.remove(PROGRESS_CLASSES.MAX_OVER_BLINK);
        if (blinkClass) {
            progressBarWrapper.classList.add(blinkClass);
        }
    });
};

// --- Firebase/データ取得とマージ ---

const fetchBaseMobData = async () => {
    try {
        const response = await fetch(MOB_DATA_URL);
        if (!response.ok) throw new Error('Mob data failed to load.');
        const data = await response.json();

        baseMobData = data.mobConfig.map(mob => ({
            ...mob,
            Expansion: EXPANSION_MAP[Math.floor(mob.No / 10000)] || "Unknown",
            REPOP_s: mob.REPOP,
            MAX_s: mob.MAX,
            last_kill_time: 0,
            last_kill_memo: '',
            spawn_cull_status: {}, // 湧き潰し座標データ (pointsオブジェクト全体)
        }));

        globalMobData = [...baseMobData];
        filterAndRender();

    } catch (error) {
        displayStatus("ベースモブデータのロードに失敗しました。", 'error');
    }
};

const startRealtimeListeners = () => {
    if (unsubscribeActiveCoords) unsubscribeActiveCoords();
    
    // mob_locationsコレクション全体を購読し、Sモブデータを一括取得
    unsubscribeActiveCoords = onSnapshot(collection(db, "mob_locations"), (snapshot) => {
        const locationsMap = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            const mobNo = parseInt(doc.id);

            locationsMap[mobNo] = {
                last_kill_time: data.last_kill_time?.seconds || 0, 
                points: data.points || {} 
            };
        });
        mergeMobData(locationsMap, 'mob_locations'); 
        displayStatus("データ更新完了。", 'success');
    }, (error) => {
        displayStatus("Mob情報のリアルタイム同期エラー。", 'error');
    });
};

const mergeMobData = (dataMap, type) => {
    if (type !== 'mob_locations') return;
    
    const newGlobalData = baseMobData.map(mob => {
        let mergedMob = { ...mob };
        const dynamicData = dataMap[mob.No];

        if (dynamicData) {
            if (mob.Rank === 'S') {
                mergedMob.last_kill_time = dynamicData.last_kill_time; 
                mergedMob.spawn_cull_status = dynamicData.points;
            }
            // A, FATEモブは last_kill_time = 0 のまま維持
        }
        
        mergedMob.repopInfo = calculateRepop(mergedMob);
        return mergedMob;
    });

    globalMobData = newGlobalData;
    sortAndRedistribute();
};


// --- UI描画とイベント ---

const createMobCard = (mob) => {
    const rank = mob.Rank;
    const rankConfig = RANK_COLORS[rank] || RANK_COLORS.A;
    const rankLabel = rankConfig.label || rank;
    
    const lastKillDisplay = formatLastKillTime(mob.last_kill_time);
    
    const absTimeFormat = { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
    const nextTimeDisplay = mob.repopInfo?.nextMinRepopDate ? mob.repopInfo.nextMinRepopDate.toLocaleString('ja-JP', absTimeFormat) : '未確定';
    const prevTimeDisplay = mob.last_kill_time > 0 ? new Date(mob.last_kill_time * 1000).toLocaleString('ja-JP', absTimeFormat) : '未報告';

    const isS_LastOne = rank === 'S' && mob.spawn_points && mob.spawn_points.some(p => p.is_last_one && (p.mob_ranks.includes('S') || p.mob_ranks.includes('A')));
    
    const isExpandable = rank === 'S';
    const isOpen = isExpandable && mob.No === openMobCardNo;
    
    const spawnPointsHtml = (isExpandable && mob.Map) ? 
        (mob.spawn_points ?? []).map(point => drawSpawnPoint(
            point, 
            mob.spawn_cull_status, 
            mob.No, 
            mob.Rank, 
            point.is_last_one, 
            isS_LastOne,
            mob.last_kill_time
        )).join('')
        : '';

    const cardHeaderHTML = `
        <div class="p-1.5 space-y-1 bg-gray-800/70" data-toggle="card-header">
            
            <div class="flex justify-between items-start space-x-2">
                
                <div class="flex flex-col flex-shrink min-w-0">
                    <div class="flex items-center space-x-2">
                        <span class="rank-icon ${rankConfig.bg} text-white text-xs font-bold px-2 py-0.5 rounded-full">${rankLabel}</span>
                        <span class="mob-name text-lg font-bold text-outline truncate max-w-xs md:max-w-[150px] lg:max-w-full">${mob.Name}</span>
                    </div>
                    <span class="text-xs text-gray-400 mt-0.5">${mob.Area} (${mob.Expansion})</span>
                </div>

                <div class="flex-shrink-0 flex flex-col space-y-1 items-end" style="min-width: 120px;">
                    ${rank === 'A'
                        ? `<button data-report-type="instant" data-mob-no="${mob.No}" class="px-2 py-0.5 text-xs rounded bg-yellow-500 hover:bg-yellow-400 text-gray-900 font-semibold transition">即時<br>報告</button>`
                        : `<button data-report-type="modal" data-mob-no="${mob.No}" class="px-2 py-0.5 text-xs rounded bg-green-500 hover:bg-green-400 text-gray-900 font-semibold transition">報告<br>する</button>`
                    }
                </div>
            </div>

            <div class="progress-bar-wrapper h-4 rounded-full relative overflow-hidden transition-all duration-100 ease-linear">
                <div class="progress-bar-bg absolute left-0 top-0 h-full rounded-full transition-all duration-100 ease-linear" style="width: 0;"></div>
                <div class="progress-text absolute inset-0 flex items-center justify-center text-xs font-semibold" style="line-height: 1;">
                    Calculating...
                </div>
            </div>
        </div>
    `;

    const expandablePanelHTML = isExpandable ? `
        <div class="expandable-panel ${isOpen ? 'open' : ''}">
            <div class="px-2 py-1 text-sm space-y-1.5">
                
                <div class="flex justify-between items-start flex-wrap">
                    <div class="w-full font-semibold text-yellow-300">抽出条件</div>
                    <div class="w-full text-gray-300 mb-2">${processText(mob.Condition)}</div>

                    <div class="w-full text-right text-sm font-mono text-blue-300">次回: ${nextTimeDisplay}</div>

                    <div class="w-full text-right text-xs text-gray-400 mb-2">前回: ${prevTimeDisplay}</div>
                    
                    <div class="w-full text-left text-sm text-gray-300 mb-2">Memo: ${mob.last_kill_memo || 'なし'}</div>

                    <div class="w-full text-left text-xs text-gray-400 border-t border-gray-600 pt-1">最終討伐報告: ${lastKillDisplay}</div>
                </div>

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
    ` : '';


    const cardHTML = `
    <div class="mob-card bg-gray-700 rounded-lg shadow-xl overflow-hidden cursor-pointer border border-gray-700 transition duration-150"
        data-mob-no="${mob.No}" data-rank="${rank}">
        
        ${cardHeaderHTML}
        ${expandablePanelHTML}
    </div>
    `;
    return cardHTML;
};

const drawSpawnPoint = (point, cullPoints, mobNo, mobRank, isLastOne, isS_LastOne, lastKillTimeSec) => {
    
    const cullData = cullPoints[point.id] || {};
    
    const isCulled = isPointCrushed({ ...point, ...cullData }, lastKillTimeSec);
    
    const isS_A_Cullable = point.mob_ranks.some(r => r === 'S' || r === 'A');
    const isB_Only = point.mob_ranks.every(r => r.startsWith('B'));

    let sizeClass = '';
    let colorClass = '';
    let specialClass = '';
    let isInteractive = false;
    let locationIdAttribute = '';

    if (isS_A_Cullable || isLastOne) {
        isInteractive = true;
        locationIdAttribute = `data-location-id="${point.id}"`;
        locationIdAttribute += ` data-mob-no="${mobNo}"`;
        locationIdAttribute += ` data-is-culled="${isCulled ? 'true' : 'false'}"`;
    }

    if (isLastOne) {
        sizeClass = 'spawn-point-lastone';
        colorClass = 'color-lastone';
        specialClass = 'spawn-point-shadow';
    } else if (isS_A_Cullable) {
        const rank = point.mob_ranks.find(r => r.startsWith('B'));
        colorClass = rank === 'B1' ? 'color-b1' : 'color-b2';
        
        if (isCulled) {
            sizeClass = 'spawn-point-culled';
            specialClass = 'culled';
        } else {
            sizeClass = 'spawn-point-sa';
            specialClass = 'spawn-point-shadow spawn-point-interactive';
        }

    } else if (isB_Only) {
        const rank = point.mob_ranks[0];
        if (isS_LastOne) {
            colorClass = 'color-b-inverted';
        } else {
            colorClass = rank === 'B1' ? 'color-b1-only' : 'color-b2-only';
        }
        
        sizeClass = 'spawn-point-b-only';
        specialClass = 'opacity-50';
    } else {
        sizeClass = 'spawn-point-b-only';
        colorClass = 'color-default';
    }
    
    return `
        <div class="spawn-point absolute rounded-full transform -translate-x-1/2 -translate-y-1/2 ${sizeClass} ${colorClass} ${specialClass}"
            data-is-interactive="${isInteractive}"
            ${locationIdAttribute}
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

    const fragment = document.createDocumentFragment();

    filteredData.forEach(mob => {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = createMobCard(mob);
        fragment.appendChild(tempDiv.firstElementChild);
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
        
        if (btn.dataset.rank !== currentFilter.rank) {
            btn.dataset.clickCount = 0;
        }

        if (btn.dataset.rank === currentFilter.rank) {
            btn.classList.remove('bg-gray-600');
            const rank = btn.dataset.rank;
            
            btn.classList.add(rank === 'ALL' ? 'bg-blue-800' : currentRankKeyForColor === 'S' ? 'bg-red-800' : currentRankKeyForColor === 'A' ? 'bg-yellow-800' : currentRankKeyForColor === 'F' ? 'bg-indigo-800' : 'bg-gray-800');
        }
    });
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

    Array.from(areas).sort((a, b) => {
        const indexA = Object.values(EXPANSION_MAP).indexOf(a);
        const indexB = Object.values(EXPANSION_MAP).indexOf(b);
        return indexB - indexA;
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

// --- 報告とモーダル操作 ---

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
        const killTimeDate = new Date(timeISO);
        
        await addDoc(collection(db, "reports"), {
            mob_id: mobNo,
            kill_time: killTimeDate,
            reporter_uid: userId,
            memo: memo,
        });

        closeReportModal();
        displayStatus("報告が完了しました。データ反映を待っています。", 'success');
    } catch (error) {
        DOMElements.modalStatus.textContent = "送信エラー: " + (error.message || "通信失敗");
    }
};

// --- 湧き潰し状態の更新（Cloud Function 呼び出し） ---

/**
 * 湧き潰し状態をサーバーに送信します。
 * @param {number} mobNo MobのNo (SモブID)
 * @param {string} locationId スポーンポイントのID
 * @param {boolean} isCurrentlyCulled 現在の表示状態 (true: 潰されている / false: 潰されていない)
 */
const sendCrushStatusUpdate = async (mobNo, locationId, isCurrentlyCulled) => {
    if (!userId) {
        displayStatus("認証が完了していません。ページをリロードしてください。", 'error');
        return;
    }
    
    const action = isCurrentlyCulled ? 'remove' : 'add';
    const actionText = isCurrentlyCulled ? '解除' : '追加';

    displayStatus(`湧き潰し状態を${actionText}中...`, 'loading');

    try {
        const mob = globalMobData.find(m => m.No === mobNo);
        const pointData = mob?.spawn_points?.find(p => p.id === locationId);

        if (!pointData) {
            throw new Error('ポイントデータが見つかりません。');
        }

        await callUpdateCrushStatus({
            s_mob_id: mobNo,
            point: { 
                id: locationId, 
                x: pointData.x, 
                y: pointData.y 
            },
            action: action
        });

        displayStatus(`湧き潰し状態を${actionText}しました。`, 'success');
    } catch (error) {
        console.error("湧き潰し更新エラー:", error);
        displayStatus(`湧き潰し更新エラー: ${error.message || "通信失敗"}`, 'error');
    }
};

// --- イベントリスナー設定 ---

let lastClickTime = 0;
const DOUBLE_CLICK_TIME = 300;

const setupEventListeners = () => {
    DOMElements.rankTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('.tab-button');
        if (!btn) return;

        const newRank = btn.dataset.rank;
        let clickCount = parseInt(btn.dataset.clickCount || 0);

        if (newRank !== currentFilter.rank) {
            currentFilter.rank = newRank;
            clickCount = 1;
            toggleAreaFilterPanel(true);

            if (!currentFilter.areaSets[newRank] || !(currentFilter.areaSets[newRank] instanceof Set)) {
                currentFilter.areaSets[newRank] = new Set();
            }
            filterAndRender();
        } else {
            if (newRank === 'ALL') {
                toggleAreaFilterPanel(true);
                clickCount = 0;
            } else {
                clickCount = (clickCount % 3) + 1;

                if (clickCount === 2) {
                    toggleAreaFilterPanel(false);
                } else if (clickCount === 3) {
                    toggleAreaFilterPanel(true);
                    clickCount = 0;
                }
            }
        }
        
        btn.dataset.clickCount = clickCount;
        updateFilterUI();
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
        const rank = card.dataset.rank;

        if (rank === 'S' && e.target.closest('[data-toggle="card-header"]')) {
            const panel = card.querySelector('.expandable-panel');
            if (panel) {
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

    // スポーンポイントのクリック処理 (湧き潰し/解除)
    DOMElements.colContainer.addEventListener('click', (e) => {
        const point = e.target.closest('.spawn-point');
        if (!point) return;
        
        if (point.dataset.isInteractive !== 'true') return;

        const currentTime = Date.now();
        const mobNo = parseInt(point.dataset.mobNo);
        const locationId = point.dataset.locationId;
        const isCurrentlyCulled = point.dataset.isCulled === 'true';

        // ダブルクリック (討伐報告) 検出
        if (currentTime - lastClickTime < DOUBLE_CLICK_TIME) {
            e.preventDefault(); 
            e.stopPropagation(); 

            // Sモブのラストワンポイントのみ報告モーダルを開く
            if (point.classList.contains('spawn-point-lastone')) {
                openReportModal(mobNo);
            }
            
            lastClickTime = 0; 
            return;
        }

        lastClickTime = currentTime;

        // シングルクリック (湧き潰し/解除)
        e.preventDefault(); 
        e.stopPropagation();

        // Sモブの湧き潰しポイント (ラストワン以外) のみ処理
        if (!point.classList.contains('spawn-point-lastone')) {
             sendCrushStatusUpdate(mobNo, locationId, isCurrentlyCulled);
        }
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

    setInterval(updateProgressBars, 60000); // 1分毎に再計算
    setInterval(updateProgressBars, 1000); // 1秒毎にプログレスバーアニメーション更新
};

// --- 初期化と認証フロー ---

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
    
    DOMElements.rankTabs.querySelectorAll('.tab-button').forEach(btn => {
        if (btn.dataset.rank === currentFilter.rank) {
             btn.dataset.clickCount = 1;
        } else {
             btn.dataset.clickCount = 0;
        }
    });

    updateFilterUI();
    sortAndRedistribute();

    displayStatus("アプリを初期化中...", 'loading');
});
