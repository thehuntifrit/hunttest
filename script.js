
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-auth.js";
import { getFirestore, collection, onSnapshot, doc, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
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
    modalTimeInput: document.getElementById('report-datetime'),
    modalMemoInput: document.getElementById('report-memo')
};

let userId = localStorage.getItem('user_uuid') || null;
let baseMobData = [];
let globalMobData = [];
let currentFilter = JSON.parse(localStorage.getItem('huntFilterState')) || {
    rank: 'ALL',
    areaSets: { ALL: new Set() }
};
let openMobCardNo = localStorage.getItem('openMobCardNo') ? parseInt(localStorage.getItem('openMobCardNo')) : null;
let lastClickTime = 0;
const DOUBLE_CLICK_TIME = 500; // 0.5秒に設定

let app = initializeApp(FIREBASE_CONFIG);
let db = getFirestore(app);
let auth = getAuth(app);

let functions = getFunctions(app, "asia-northeast2");
const callUpdateCrushStatus = httpsCallable(functions, 'crushStatusUpdater');

let unsubscribeListeners = [];
let progressUpdateInterval = null;
let currentReportMobNo = null;

const toJstAdjustedIsoString = (date) => {
    const offsetMs = date.getTimezoneOffset() * 60000;
    const jstOffsetMs = 9 * 60 * 60 * 1000;
    
    const jstTime = date.getTime() - offsetMs + jstOffsetMs;
    const jstDate = new Date(jstTime);
    
    return jstDate.toISOString().slice(0, 16);
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
    
    const options = {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Tokyo'
    };
    
    const date = new Date(killTimeMs);
    
    return new Intl.DateTimeFormat('ja-JP', options).format(date);
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

function isPointCrushed(point, lastKillTimeSec, prevKillTimeSec) {
    const cullResetSec = Math.max(lastKillTimeSec, prevKillTimeSec || 0);
    const cullResetTime = cullResetSec > 0 ? new Date(cullResetSec * 1000) : new Date(0);

    const crushedTime = point.crushed_at?.toDate ? point.crushed_at.toDate() : point.crushed_at;
    const uncrushedTime = point.uncrushed_at?.toDate ? point.uncrushed_at.toDate() : point.uncrushed_at;

    let effectiveCrushedTime = null;
    let effectiveUncrushedTime = null;

    if (crushedTime instanceof Date && crushedTime > cullResetTime) {
        effectiveCrushedTime = crushedTime;
    }
    if (uncrushedTime instanceof Date && uncrushedTime > cullResetTime) {
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

    const diffToMinRepopSec = minRepop - now; 

    if (lastKill === 0) {
        minRepop = now + repopSec; // LKTがない場合は、現在時刻から推定
        maxRepop = now + maxSec;
        timeRemaining = `Next: ${formatDuration(minRepop - now)}`; // Next: HHh MMm
        status = 'Next';
    } else if (now < minRepop) {
        elapsedPercent = 0;
        
        if (diffToMinRepopSec > 3600) {
            const nextTimeFormat = { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' };
            const nextDate = new Date(minRepop * 1000);
            timeRemaining = `Next: ${new Intl.DateTimeFormat('ja-JP', nextTimeFormat).format(nextDate)}`;
        } else if (diffToMinRepopSec > 0) {
            const minutesLeft = Math.ceil(diffToMinRepopSec / 60);
            timeRemaining = `Next: ${minutesLeft}m Left`;
        } else {
            timeRemaining = `Next: Now`;
        }

        status = 'Next';
    } else if (now >= minRepop && now < maxRepop) {
        elapsedPercent = ((now - minRepop) / (maxRepop - minRepop)) * 100;
        elapsedPercent = Math.min(elapsedPercent, 100);
        timeRemaining = `${elapsedPercent.toFixed(0)}% (${formatDuration(maxRepop - now)} Left)`;
        status = 'PopWindow';
    } else {
        elapsedPercent = 100;
        timeRemaining = `100% (+${formatDuration(now - maxRepop)} over)`;
        status = 'MaxOver';
    }

    const nextMinRepopDate = minRepop > now ? new Date(minRepop * 1000) : null;
    
    return { minRepop, maxRepop, elapsedPercent, timeRemaining, status, nextMinRepopDate };
};

const updateProgressBars = () => {
    globalMobData = globalMobData.map(mob => ({
        ...mob,
        repopInfo: calculateRepop(mob)
    }));

    document.querySelectorAll('.mob-card').forEach(card => {
        const mobNo = parseInt(card.dataset.mobNo);
        const mob = globalMobData.find(m => m.No === mobNo);
        if (!mob || !mob.repopInfo) return;

        const { elapsedPercent, timeRemaining, status } = mob.repopInfo;
        const progressBar = card.querySelector('.progress-bar-bg');
        const progressText = card.querySelector('.progress-text');
        const progressBarWrapper = progressBar ? progressBar.parentElement : null;

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
            prev_kill_time: 0,
            last_kill_memo: '',
            spawn_cull_status: {},
            related_mob_no: mob.Rank.startsWith('B') ? mob.RelatedMobNo : null
        }));

        globalMobData = [...baseMobData];
        filterAndRender();

    } catch (error) {
        displayStatus("ベースモブデータのロードに失敗しました。", 'error');
    }
};

const mergeMobStatusData = (mobStatusDataMap) => {
    const newData = new Map();

    Object.values(mobStatusDataMap).forEach(docData => {
        Object.entries(docData).forEach(([mobId, mobData]) => {
            const mobNo = parseInt(mobId);
            newData.set(mobNo, {
                last_kill_time: mobData.last_kill_time?.seconds || 0,
                prev_kill_time: mobData.prev_kill_time?.seconds || 0,
                last_kill_memo: mobData.last_kill_memo || ''
            });
        });
    });

    globalMobData = globalMobData.map(mob => {
        let mergedMob = { ...mob };

        if (newData.has(mob.No)) {
            const dynamicData = newData.get(mob.No);
            mergedMob.last_kill_time = dynamicData.last_kill_time;
            mergedMob.prev_kill_time = dynamicData.prev_kill_time;
            mergedMob.last_kill_memo = dynamicData.last_kill_memo;
        }

        mergedMob.repopInfo = calculateRepop(mergedMob);
        return mergedMob;
    });
    
    sortAndRedistribute();
};

const mergeMobLocationsData = (locationsMap) => {
    globalMobData = globalMobData.map(mob => {
        let mergedMob = { ...mob };
        const dynamicData = locationsMap[mob.No];

        if (mob.Rank === 'S' && dynamicData) {
            // mob_locations からの last_kill_time, prev_kill_time のマージを削除
            mergedMob.spawn_cull_status = dynamicData.points;
        }
        
        mergedMob.repopInfo = calculateRepop(mergedMob);
        return mergedMob;
    });

    sortAndRedistribute();
};

const startRealtimeListeners = () => {
    clearInterval(progressUpdateInterval);

    unsubscribeListeners.forEach(unsub => unsub());
    unsubscribeListeners = [];
    
    const statusDocs = ['s_latest', 'a_latest', 'f_latest'];
    const mobStatusDataMap = {};

    statusDocs.forEach(docId => {
        const docRef = doc(db, "mob_status", docId);
        const unsubscribe = onSnapshot(docRef, (snapshot) => {
            const data = snapshot.data();
            if (data) {
                mobStatusDataMap[docId] = data;
            }
            mergeMobStatusData(mobStatusDataMap);
            displayStatus("LKT/Memoデータ更新完了。", 'success');
        }, (error) => {
            displayStatus(`MobStatus (${docId}) のリアルタイム同期エラー。`, 'error');
        });
        unsubscribeListeners.push(unsubscribe);
    });

    const unsubscribeLocations = onSnapshot(collection(db, "mob_locations"), (snapshot) => {
        const locationsMap = {};
        snapshot.forEach(doc => {
            const data = doc.data();
            const mobNo = parseInt(doc.id);

            locationsMap[mobNo] = {
                points: data.points || {}
            };
        });
        mergeMobLocationsData(locationsMap);
        displayStatus("湧き潰しデータ更新完了。", 'success');
    }, (error) => {
        displayStatus("MobLocationsのリアルタイム同期エラー。", 'error');
    });
    unsubscribeListeners.push(unsubscribeLocations);

    progressUpdateInterval = setInterval(updateProgressBars, 10000);
};

const setupAuthentication = () => {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            userId = user.uid;
            localStorage.setItem('user_uuid', userId);
            displayStatus(`ユーザー認証成功: ${userId.substring(0, 8)}...`, 'success');
            if (baseMobData.length > 0) {
                startRealtimeListeners();
            } else {
                fetchBaseMobData().then(() => startRealtimeListeners());
            }
        } else {
            signInAnonymously(auth).catch((error) => {
                displayStatus(`認証エラー: ${error.message}`, 'error');
            });
        }
    });
};

const toggleCrushStatus = async (mobNo, locationId, isCurrentlyCulled) => {
    if (!userId) {
        displayStatus("認証が完了していません。", 'error');
        return;
    }

    const action = isCurrentlyCulled ? 'uncrush' : 'crush';
    const mob = globalMobData.find(m => m.No === mobNo);
    if (!mob) return;

    displayStatus(`${mob.Name} (${locationId}) ${action === 'crush' ? '湧き潰し' : '解除'}報告中...`);

    try {
        const result = await callUpdateCrushStatus({
            mob_id: mobNo.toString(),
            point_id: locationId,
            type: action === 'crush' ? 'add' : 'remove', // Cloud Functionの引数名に合わせる
            userId: userId // 検証のために維持
            // timestamp は削除しました
        });

        if (result.data?.success) {
            displayStatus(`${mob.Name} の状態を更新しました。`, 'success');
        } else {
            displayStatus(`更新失敗: ${result.data?.message || '不明なエラー'}`, 'error');
        }
    } catch (error) {
        displayStatus(`湧き潰し報告エラー: ${error.message}`, 'error');
    }
};

const submitReport = async (mobNo, timeISO, memo) => {
    if (!userId) {
        displayStatus("認証が完了していません。ページをリロードしてください。", 'error');
        return;
    }
    
    const mob = globalMobData.find(m => m.No === mobNo);
    if (!mob) {
        displayStatus("モブデータが見つかりません。", 'error');
        return;
    }
    
    const killTimeDate = new Date(timeISO);
    if (isNaN(killTimeDate)) {
        displayStatus("時刻形式が不正です。", 'error');
        return;
    }

    DOMElements.modalStatus.textContent = '送信中...';
    displayStatus(`${mob.Name} 討伐時間報告中...`);

    try {
        await addDoc(collection(db, "reports"), {
            mob_id: mobNo.toString(),
            kill_time: killTimeDate,
            reporter_uid: userId,
            memo: memo,
            repop_seconds: mob.REPOP_s
            // rank: mob.Rank の送信を削除しました
        });

        closeReportModal();
        displayStatus("報告が完了しました。データ反映を待っています。", 'success');
    } catch (error) {
        console.error("レポート送信エラー:", error);
        DOMElements.modalStatus.textContent = "送信エラー: " + (error.message || "通信失敗");
        displayStatus(`LKT報告エラー: ${error.message || "通信失敗"}`, 'error');
    }
};

const drawSpawnPoint = (point, cullPoints, mobNo, mobRank, isLastOne, isS_LastOne, lastKillTimeSec, prevKillTimeSec) => {
    
    const cullData = cullPoints[point.id] || {};
    
    // isPointCrushed は提供されていないため、この呼び出しが正しい前提で進めます
    const isCulled = isPointCrushed({ ...point, ...cullData }, lastKillTimeSec, prevKillTimeSec); 
    
    const isS_A_Cullable = point.mob_ranks.some(r => r === 'S' || r === 'A');
    const isB_Only = point.mob_ranks.every(r => r.startsWith('B'));

    let sizeClass = '';
    let colorClass = '';
    let specialClass = '';
    let isInteractive = false; // 初期値は false
    // ★ 修正後の変数: すべてのデータ属性を格納する
    let dataAttributes = ''; 

    // ★★★ 修正箇所 1: データ属性は常に設定する ★★★
    dataAttributes += ` data-location-id="${point.id}"`;
    dataAttributes += ` data-mob-no="${mobNo}"`;
    dataAttributes += ` data-is-culled="${isCulled ? 'true' : 'false'}"`;

    // ★ 修正箇所 2: isInteractive の判定ロジックは変えない（ラストワンではない S/A 湧き潰し地点のみを true にする）
    if (isS_A_Cullable && !isLastOne) {
        isInteractive = true;
    } 
    // ※ isLastOne の地点は isInteractive = false のままになります

    if (isLastOne) {
        sizeClass = 'spawn-point-lastone';
        colorClass = 'color-lastone';
        specialClass = 'spawn-point-shadow-lastone'; // ラストワン用の新しい濃い影/枠
    } else if (isS_A_Cullable) {
        // Bランク情報を持つS/A湧き潰し地点の処理を維持
        const rank = point.mob_ranks.find(r => r.startsWith('B'));
        colorClass = rank === 'B1' ? 'color-b1' : 'color-b2';
        
        if (isCulled) {
            sizeClass = 'spawn-point-sa'; // 湧き潰し前と同サイズに戻す
            specialClass = 'culled-with-white-border'; // 白枠（押された後の反転色）
        } else {
            sizeClass = 'spawn-point-sa';
            specialClass = 'spawn-point-shadow-sa spawn-point-interactive'; // S/A湧き潰し用の新しい濃い影/枠
        }

    } else if (isB_Only) {
        // Bランクのみの地点の処理を維持
        const rank = point.mob_ranks[0];
        if (isS_LastOne) {
            colorClass = 'color-b-inverted';
        } else {
            colorClass = rank === 'B1' ? 'color-b1-only' : 'color-b2-only';
        }
        
        sizeClass = 'spawn-point-b-only';
        specialClass = 'opacity-75 spawn-point-b-border'; // 透過を下げ、2pxの白枠を追加
    } else {
        sizeClass = 'spawn-point-b-only';
        colorClass = 'color-default';
    }
    
    return `
        <div class="spawn-point absolute rounded-full transform -translate-x-1/2 -translate-y-1/2 ${sizeClass} ${colorClass} ${specialClass}"
            data-is-interactive="${isInteractive}" // ★ ラストワン時は false
            ${dataAttributes}             style="left: ${point.x}%; top: ${point.y}%;"
        ></div>
    `;
};

const createMobCard = (mob) => {
    const rank = mob.Rank;
    const rankConfig = RANK_CONFIG[rank] || { label: '?', bg: 'bg-gray-500' };
    const rankLabel = rankConfig.label;

    const repopInfo = calculateRepop(mob);
    const nextTimeDisplay = repopInfo.nextMinRepopDate 
        ? new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }).format(repopInfo.nextMinRepopDate)
        : '不明';

    // last_kill_timeが前回表示に使用されていた場合は、それを適切に処理
    const prevTimeDisplay = formatLastKillTime(mob.last_kill_time); // 項目6では使用しないが、定義は残す

    const lastKillDisplay = formatLastKillTime(mob.last_kill_time);
    
    // ★変更箇所：項目5: 詳細展開はSランクのみ
    const isExpandable = rank === 'S'; 
    const isOpen = isExpandable && mob.No === openMobCardNo;
    
    // --- 項目2: カードの横幅調整のため、max-w-xsなどの制限を削除/調整 ---
    return `
        <div class="mob-card bg-gray-700 rounded-lg shadow-xl overflow-hidden cursor-pointer border border-gray-700 transition duration-150"
             data-mob-no="${mob.No}" data-rank="${rank}">
            
            <div class="p-1.5 space-y-1 bg-gray-800/70" data-toggle="card-header">
                
                <div class="flex justify-between items-start space-x-2">
                    
                    <div class="flex flex-col flex-shrink min-w-0">
                        <div class="flex items-center space-x-2">
                            <span class="rank-icon ${rankConfig.bg} text-white text-xs font-bold px-2 py-0.5 rounded-full">${rankLabel}</span>
                            <span class="mob-name text-lg font-bold text-outline truncate" 
                                  style="max-width: ${mob.Name.length > 16 ? '200px' : 'none'};">${mob.Name}</span>
                        </div>
                        <span class="text-xs text-gray-400 mt-0.5">${mob.Area} (${mob.Expansion})</span>
                    </div>

                    <div class="flex-shrink-0 flex flex-col space-y-1 items-end" style="min-width: 120px;">
                        ${rank === 'A' || rank === 'F'
                            ? `<button data-report-type="instant" data-mob-no="${mob.No}" class="px-2 py-0.5 text-xs rounded bg-yellow-500 hover:bg-yellow-400 text-white font-semibold transition">即時<br>報告</button>`
                            : `<button data-report-type="modal" data-mob-no="${mob.No}" class="px-2 py-0.5 text-xs rounded bg-green-500 hover:bg-green-400 text-white font-semibold transition">報告<br>する</button>`
                        }
                    </div>
                </div>

                <div class="progress-bar-wrapper h-4 rounded-full relative overflow-hidden transition-all duration-100 ease-linear">
                    <div class="progress-bar-bg absolute left-0 top-0 h-full rounded-full transition-all duration-100 ease-linear" style="width: 0;"></div>
                    <div class="progress-text absolute inset-0 flex items-center justify-center text-sm font-semibold" style="line-height: 1;">
                        Calculating...
                    </div>
                </div>
            </div>

            ${isExpandable ? `
            <div class="expandable-panel ${isOpen ? 'open' : ''}">
                <div class="px-2 py-1 text-sm space-y-1.5">
                    
                    <div class="flex justify-between items-start flex-wrap">
                        <div class="w-full font-semibold text-yellow-300">抽選条件</div>
                        <div class="w-full text-gray-300 mb-2">${processText(mob.Condition)}</div>

                        <div class="w-full text-right text-sm font-mono text-blue-300">次回: ${nextTimeDisplay}</div>

                        <div class="w-full text-left text-sm text-gray-300 mb-2">Memo: ${mob.last_kill_memo || 'なし'}</div>

                        <div class="w-full text-left text-xs text-gray-400 border-t border-gray-600 pt-1">最終討伐報告: ${lastKillDisplay}</div>
                    </div>
                </div>
            </div>
            ` : ''}

        </div>
    `;
};

const distributeCards = () => {
    const numCards = DOMElements.masterContainer.children.length;
    const windowWidth = window.innerWidth;
    // Tailwind CSSのデフォルト値
    const mdBreakpoint = 768; 
    const lgBreakpoint = 1024;


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

const filterAndRender = (isInitialLoad = false) => {
    // Mob card filtering logic
    const targetDataRank = FILTER_TO_DATA_RANK_MAP[currentFilter.rank] || currentFilter.rank;
    
    const filteredData = globalMobData.filter(mob => {
        if (targetDataRank === 'ALL') {
            // --- ★変更箇所：項目8: ALLタブの挙動変更ロジック ---
            const currentAreaSet = currentFilter.areaSets[currentFilter.rank] instanceof Set
                ? currentFilter.areaSets[currentFilter.rank]
                : new Set();
            
            // areaSetが空（＝フィルタなし）なら全てのランク・エリアを表示
            if (!currentAreaSet || currentAreaSet.size === 0) return true;

            // areaSetがあれば、そのエリアに属するモブのみ表示
            return currentAreaSet.has(mob.Expansion);
            // --- ★変更ここまで★

        }
        
        if (targetDataRank === 'A') {
            // A, B-X-A, B-X-F をフィルタリング
            if (mob.Rank !== 'A' && !mob.Rank.startsWith('B')) return false;
        } else if (targetDataRank === 'F') {
            // F, B-X-F をフィルタリング
            if (mob.Rank !== 'F' && !mob.Rank.startsWith('B')) return false;
        } else if (mob.Rank !== targetDataRank) {
            return false;
        }

        // Area filtering
        const currentAreaSet = currentFilter.areaSets[targetDataRank] instanceof Set
            ? currentFilter.areaSets[targetDataRank]
            : new Set();
        
        if (currentAreaSet.size > 0 && !currentAreaSet.has(mob.Expansion)) {
            return false;
        }

        // Name filtering
        if (currentFilter.name.length > 0) {
            if (!mob.Name.toLowerCase().includes(currentFilter.name.toLowerCase())) {
                return false;
            }
        }

        return true;
    });

    // Sort data
    filteredData.sort(sortMobData);

    // Render cards
    const fragment = document.createDocumentFragment();

    filteredData.forEach(mob => {
        const tempDiv = document.createElement('div');
        // createMobCard(mob) はHTML文字列を返す前提
        tempDiv.innerHTML = createMobCard(mob); 
        fragment.appendChild(tempDiv.firstElementChild);
    });

    // DOM Manipulation
    DOMElements.masterContainer.innerHTML = '';
    DOMElements.masterContainer.appendChild(fragment);

    // Re-distribute cards into columns
    distributeCards();

    // After initial load, update UI and save state
    if (!isInitialLoad) {
        updateFilterUI();
        saveFilterState();
    }
    
    // 展開状態のMob Cardを再展開
    if (openMobCardNo) {
        const cardElement = DOMElements.masterContainer.querySelector(`[data-mob-no="${openMobCardNo}"]`);
        if (cardElement) {
            const expandablePanel = cardElement.querySelector('.expandable-panel');
            if (expandablePanel) {
                expandablePanel.classList.add('open');
            }
        }
    }
};

const renderAreaFilterPanel = () => {
    DOMElements.areaFilterPanel.innerHTML = '';
    
    const targetDataRank = FILTER_TO_DATA_RANK_MAP[currentFilter.rank] || currentFilter.rank;

    const areas = globalMobData
        .filter(m => {
            if (targetDataRank === 'A' || targetDataRank === 'F') {
                return m.Rank === targetDataRank || m.Rank.startsWith('B');
            }
            return m.Rank === targetDataRank;
        })
        .reduce((set, mob) => {
            const mobExpansion = mob.Rank.startsWith('B') 
                ? globalMobData.find(m => m.No === mob.related_mob_no)?.Expansion || mob.Expansion
                : mob.Expansion;
            if (mobExpansion) set.add(mobExpansion);
            return set;
        }, new Set());

    const currentAreaSet = currentFilter.areaSets[currentFilter.rank] instanceof Set
        ? currentFilter.areaSets[currentFilter.rank]
        : new Set();

    const allButton = document.createElement('button');
    const isAllSelected = areas.size > 0 && currentAreaSet.size === areas.size;
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

const openReportModal = (mobNo) => {
    const mob = globalMobData.find(m => m.No === mobNo);
    if (!mob) return;

    const isoString = toJstAdjustedIsoString(new Date());

    DOMElements.reportForm.dataset.mobNo = mobNo;
    DOMElements.modalMobName.textContent = `対象: ${mob.Name} (${mob.Area})`;
    DOMElements.modalTimeInput.value = isoString;
    DOMElements.modalMemoInput.value = mob.last_kill_memo || '';
    DOMElements.modalMemoInput.placeholder = `LKTとして記録されます。例: ${mob.Area} (X:00.0, Y:00.0) // ログアウトします`;
    DOMElements.modalStatus.textContent = '';

    DOMElements.reportModal.classList.remove('hidden');
    DOMElements.reportModal.classList.add('flex');
};

const closeReportModal = () => {
    DOMElements.reportModal.classList.add('hidden');
    DOMElements.reportModal.classList.remove('flex');
};

const setupEventListeners = () => {
    
    // イベントリスナーはDOM全体に対して委譲 (Delegation)
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
                // ランクタブの連続クリック: 1回目(開く) -> 2回目(フィルターパネル表示) -> 3回目(閉じる)
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
            const allAreas = Array.from(globalMobData.filter(m => {
                if (dataRank === 'A' || dataRank === 'F') {
                    return m.Rank === dataRank || m.Rank.startsWith('B');
                }
                return m.Rank === dataRank;
            }).reduce((set, mob) => {
                const mobExpansion = mob.Rank.startsWith('B') 
                    ? globalMobData.find(m => m.No === mob.related_mob_no)?.Expansion || mob.Expansion
                    : mob.Expansion;
                if (mobExpansion) set.add(mobExpansion);
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
        renderAreaFilterPanel();
        sortAndRedistribute();
    });

    // ==============================================================
    // 統合された DOMElements.colContainer のリスナー (湧き潰し機能維持版)
    // ==============================================================
    DOMElements.colContainer.addEventListener('click', (e) => {
        const card = e.target.closest('.mob-card');
        if (!card) return;

        const mobNo = parseInt(card.dataset.mobNo);
        const rank = card.dataset.rank;
        
        // 1. 報告ボタンのクリック
        const reportBtn = e.target.closest('button[data-report-type]');
        if (reportBtn) {
            e.stopPropagation();
            const reportType = reportBtn.dataset.reportType;

            if (reportType === 'modal') {
                openReportModal(mobNo);
            } else if (reportType === 'instant') {
                const timeISO = toJstAdjustedIsoString(new Date());
                submitReport(mobNo, timeISO, `${rank}ランク即時報告`);
            }
            return;
        }

        // 2. スポーンポイントのクリック処理 (シングルクリックで湧き潰し/解除)
        const point = e.target.closest('.spawn-point');
        // data-is-interactive="true" のポイント（＝ラストワンではない湧き潰しポイント）のみ処理
        if (point && point.dataset.isInteractive === 'true') { 
            e.preventDefault(); 
            e.stopPropagation();

            const locationId = point.dataset.locationId;
            const isCurrentlyCulled = point.dataset.isCulled === 'true';
            
            toggleCrushStatus(mobNo, locationId, isCurrentlyCulled);
            return;
        }

        // 3. カードヘッダーのクリックで展開/格納
        if (e.target.closest('[data-toggle="card-header"]')) {
            if (rank === 'S' || rank === 'A' || rank === 'F') {
                const panel = card.querySelector('.expandable-panel');
                if (panel) {
                    if (!panel.classList.contains('open')) {
                        document.querySelectorAll('.expandable-panel.open').forEach(openPanel => {
                            // クリックされたカード以外を閉じる
                            if (openPanel.closest('.mob-card') !== card) {
                                openPanel.classList.remove('open');
                            }
                        });
                        panel.classList.add('open');
                        openMobCardNo = mobNo;
                    } else {
                        panel.classList.remove('open');
                        openMobCardNo = null;
                    }
                    localStorage.setItem('openMobCardNo', openMobCardNo);
                }
            }
        }
    });
  
    document.getElementById('cancel-report').addEventListener('click', closeReportModal);
    DOMElements.reportForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const mobNo = parseInt(DOMElements.reportForm.dataset.mobNo);
        const datetime = DOMElements.modalTimeInput.value;
        const memo = DOMElements.modalMemoInput.value;

        submitReport(mobNo, datetime, memo);
    });

    window.addEventListener('resize', sortAndRedistribute);
};

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
    setupAuthentication(); 
    
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
