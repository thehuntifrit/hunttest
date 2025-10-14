import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
    getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { 
    getFirestore, doc, setDoc, onSnapshot, collection, query, updateDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore-lite.js";


const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

let app, db, auth;
let userId = null;

let globalMobData = [];
let lktData = {};
let cullStatusData = {};

let openMobCardNo = localStorage.getItem('openMobCardNo') ? parseInt(localStorage.getItem('openMobCardNo'), 10) : null;


const DOMElements = {
    masterContainer: document.getElementById('master-card-container'),
    colContainer: document.getElementById('col-container'),
    cols: [
        document.getElementById('col-1'),
        document.getElementById('col-2'),
        document.getElementById('col-3'),
    ],
    rankTabs: document.getElementById('rank-tabs'),
    areaFilterWrapper: document.getElementById('area-filter-wrapper'),
    areaFilterPanel: document.getElementById('area-filter-panel'),
    reportModal: document.getElementById('report-modal'),
    reportForm: document.getElementById('report-form'),
    modalMobName: document.getElementById('modal-mob-name'),
    modalTimeInput: document.getElementById('modal-time-input'),
    modalMemoInput: document.getElementById('modal-memo-input'),
    modalStatus: document.getElementById('modal-status'),
    authStatus: document.getElementById('auth-status'),
    userIdDisplay: document.getElementById('user-id-display'),
    statusDisplay: document.getElementById('app-status'),
};

const EXPANSION_MAP = {
    'ARR': '新生エオルゼア',
    'HW': '蒼天のイシュガルド',
    'SB': '紅蓮のリベレーター',
    'SHB': '漆黒のヴィランズ',
    'EW': '暁月のフィナーレ',
    'DT': '黄金のレガシー',
};

const RANK_COLORS = {
    'S': { label: 'S', bg: 'bg-red-600', text: 'text-red-300' },
    'A': { label: 'A', bg: 'bg-yellow-600', text: 'text-yellow-300' },
    'F': { label: 'F', bg: 'bg-indigo-600', text: 'text-indigo-300' },
    'B': { label: 'B', bg: 'bg-green-600', text: 'text-green-300' },
    'ALL': { label: 'ALL', bg: 'bg-blue-600', text: 'text-blue-300' },
};

const FILTER_TO_DATA_RANK_MAP = {
    'S_RANK': 'S',
    'A_RANK': 'A',
    'F_RANK': 'F',
    'ALL': 'ALL',
};

const savedFilter = localStorage.getItem('huntFilterState');
let currentFilter = savedFilter ? JSON.parse(savedFilter) : {
    rank: 'S_RANK',
    areaSets: {
        'S_RANK': new Set(),
        'A_RANK': new Set(),
        'F_RANK': new Set(),
        'ALL': new Set(),
    }
};


const debounce = (func, delay) => {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
};

const toJstAdjustedIsoString = (date) => {
    const offset = date.getTimezoneOffset() * 60000;
    const jstOffset = 9 * 60 * 60000;
    const adjustedDate = new Date(date.getTime() - offset + jstOffset);

    const year = adjustedDate.getFullYear();
    const month = String(adjustedDate.getMonth() + 1).padStart(2, '0');
    const day = String(adjustedDate.getDate()).padStart(2, '0');
    const hours = String(adjustedDate.getHours()).padStart(2, '0');
    const minutes = String(adjustedDate.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const formatLastKillTime = (timestamp) => {
    if (!timestamp || timestamp === 0) return '未報告';
    
    const now = Date.now() / 1000;
    const elapsedSeconds = now - timestamp;
    
    if (elapsedSeconds < 60) return `${Math.floor(elapsedSeconds)}秒前`;

    const elapsedMinutes = elapsedSeconds / 60;
    if (elapsedMinutes < 60) return `${Math.floor(elapsedMinutes)}分前`;

    const elapsedHours = elapsedMinutes / 60;
    if (elapsedHours < 24) return `${Math.floor(elapsedHours)}時間前`;

    const elapsedDays = elapsedHours / 24;
    return `${Math.floor(elapsedDays)}日前`;
};

const processText = (text) => {
    if (!text) return '条件なし';
    return text.replace(/([XY]):(\d{1,2}\.\d)/g, '<span class="text-blue-400 font-mono font-bold">$1:$2</span>');
};

const displayStatus = (message, type = 'info') => {
    DOMElements.statusDisplay.textContent = message;
    DOMElements.statusDisplay.className = 'py-1 px-2 text-sm font-semibold rounded-full ';
    
    if (type === 'loading') {
        DOMElements.statusDisplay.classList.add('bg-blue-600', 'text-white');
    } else if (type === 'success') {
        DOMElements.statusDisplay.classList.add('bg-green-600', 'text-white');
    } else if (type === 'error') {
        DOMElements.statusDisplay.classList.add('bg-red-600', 'text-white');
    } else {
        DOMElements.statusDisplay.classList.add('bg-gray-600', 'text-white');
    }
};

const toggleCrushStatus = async (mobNo, locationId, isCurrentlyCulled) => {
    if (!userId) {
        displayStatus("認証が完了していません。", 'error');
        return;
    }

    const mobKey = mobNo.toString();
    const newStatus = isCurrentlyCulled ? 'NOT_CULLED' : 'CULLED';
    const culledAt = newStatus === 'CULLED' ? serverTimestamp() : null;
    const culledBy = newStatus === 'CULLED' ? userId : null;
    
    // ユーザー固有の湧き潰し状態ドキュメントパス
    const cullDocPath = `/artifacts/${appId}/users/${userId}/hunt_cull_status/cull_data`;
    const cullDocRef = doc(db, cullDocPath);

    const updateData = {
        [locationId]: {
            status: newStatus,
            culledAt: culledAt,
            culledBy: culledBy,
            mobNo: mobNo // どのモブに関連するか保存
        }
    };

    try {
        await updateDoc(cullDocRef, updateData);
        displayStatus(`湧き潰し状態を更新しました: ${locationId} -> ${newStatus}`, 'success');
    } catch (error) {
        if (error.code === 'not-found') {
             try {
                // ドキュメントが存在しない場合はsetDocで作成
                await setDoc(cullDocRef, updateData, { merge: true });
                displayStatus(`湧き潰し状態を初期作成し、更新しました: ${locationId} -> ${newStatus}`, 'success');
             } catch (e) {
                console.error("湧き潰し状態の初期作成に失敗:", e);
                displayStatus("湧き潰し状態の更新に失敗しました (Firestore初期作成エラー)", 'error');
             }
        } else {
            console.error("湧き潰し状態の更新に失敗:", error);
            displayStatus("湧き潰し状態の更新に失敗しました (Firestoreエラー)", 'error');
        }
    }
};

const setupAuthentication = async () => {
    try {
        app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
        setLogLevel('Debug');

        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        } else {
            await signInAnonymously(auth);
        }

        onAuthStateChanged(auth, (user) => {
            if (user) {
                userId = user.uid;
                DOMElements.authStatus.textContent = '認証済み';
                DOMElements.userIdDisplay.textContent = `User ID: ${userId}`;
                
                setupDataListeners(userId);
                
                displayStatus("認証完了。データ監視中...", 'info');

            } else {
                userId = null;
                DOMElements.authStatus.textContent = '未認証 (匿名)';
                DOMElements.userIdDisplay.textContent = 'User ID: N/A';
                displayStatus("匿名認証に失敗しました。", 'error');
            }
        });

    } catch (e) {
        console.error("Firebase初期化または認証に失敗:", e);
        displayStatus("初期化エラー。コンソールを確認してください。", 'error');
    }
};

const setupDataListeners = (currentUserId) => {
    if (!db) return;

    // LKT (Last Kill Time) データの監視 (パブリックデータ)
    const lktQuery = query(collection(db, `/artifacts/${appId}/public/data/hunt_lkt_records`));
    onSnapshot(lktQuery, (snapshot) => {
        const newLktData = {};
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            newLktData[doc.id] = {
                last_kill_time: data.last_kill_time || 0,
                prev_kill_time: data.prev_kill_time || 0,
                last_kill_memo: data.last_kill_memo || '',
                reporter_id: data.reporter_id || '',
            };
        });
        lktData = newLktData;
        calculateAndRender();
    }, (error) => {
        console.error("LKTデータ監視エラー:", error);
        displayStatus("LKTデータ取得エラー。", 'error');
    });

    // 湧き潰し状態データの監視 (ユーザー個別のプライベートデータ)
    const cullDocRef = doc(db, `/artifacts/${appId}/users/${currentUserId}/hunt_cull_status/cull_data`);
    onSnapshot(cullDocRef, (doc) => {
        if (doc.exists()) {
            cullStatusData = doc.data() || {};
        } else {
            cullStatusData = {};
        }
        calculateAndRender();
    }, (error) => {
        console.error("湧き潰しデータ監視エラー:", error);
        displayStatus("湧き潰しデータ取得エラー。", 'error');
    });
};

const submitReport = async (mobNo, datetime, memo) => {
    if (!userId) {
        displayStatus("認証が完了していません。報告できません。", 'error');
        return;
    }
    
    const killDate = new Date(datetime);

    if (isNaN(killDate.getTime())) {
        DOMElements.modalStatus.textContent = '無効な日時形式です。';
        DOMElements.modalStatus.classList.add('text-red-500');
        return;
    }

    const mobKey = mobNo.toString();
    const docRef = doc(db, `/artifacts/${appId}/public/data/hunt_lkt_records`, mobKey);

    const lktRecord = lktData[mobKey] || {};
    const currentLktTime = lktRecord.last_kill_time || 0;
    
    // UTC秒単位のタイムスタンプ
    const newKillTimeSeconds = Math.floor(killDate.getTime() / 1000);

    const dataToSet = {
        last_kill_time: newKillTimeSeconds,
        prev_kill_time: currentLktTime,
        last_kill_memo: memo,
        reporter_id: userId,
        updated_at: serverTimestamp(),
    };

    try {
        await setDoc(docRef, dataToSet, { merge: true });
        closeReportModal();
        displayStatus(`${mobNo} (${mobKey}) の討伐時刻を報告しました。`, 'success');
    } catch (e) {
        console.error("報告の送信に失敗:", e);
        DOMElements.modalStatus.textContent = '報告の送信に失敗しました。';
        DOMElements.modalStatus.classList.add('text-red-500');
        displayStatus("報告送信エラー。", 'error');
    }
};

const calculateRepopInfo = () => {
    const now = Date.now() / 1000;

    globalMobData.forEach(mob => {
        const lkt = lktData[mob.No] || {};
        const lastKillTime = lkt.last_kill_time || 0;
        const prevKillTime = lkt.prev_kill_time || 0;
        
        mob.last_kill_time = lastKillTime;
        mob.prev_kill_time = prevKillTime;
        mob.last_kill_memo = lkt.last_kill_memo || '';

        mob.spawn_cull_status = cullStatusData;

        let repopInfo = {};
        
        const minRepopSeconds = mob.MinRepopTime * 60;
        const maxRepopSeconds = mob.MaxRepopTime * 60;

        if (lastKillTime > 0) {
            const minRepopTime = lastKillTime + minRepopSeconds;
            const maxRepopTime = lastKillTime + maxRepopSeconds;

            const elapsedSeconds = now - lastKillTime;
            const repopWindowLength = maxRepopSeconds - minRepopSeconds;

            if (elapsedSeconds < minRepopSeconds) {
                repopInfo.status = 'WAITING';
                repopInfo.percent = 0;
                repopInfo.nextMinRepopDate = new Date(minRepopTime * 1000);
            } else if (elapsedSeconds >= minRepopSeconds && elapsedSeconds <= maxRepopSeconds) {
                repopInfo.status = 'WINDOW';
                const windowElapsed = elapsedSeconds - minRepopSeconds;
                repopInfo.percent = (windowElapsed / repopWindowLength) * 100;
                repopInfo.nextMinRepopDate = new Date(minRepopTime * 1000);
                repopInfo.nextMaxRepopDate = new Date(maxRepopTime * 1000);
            } else {
                repopInfo.status = 'OVERDUE';
                repopInfo.percent = 100;
                repopInfo.nextMinRepopDate = new Date(minRepopTime * 1000);
            }
            repopInfo.elapsedPercent = elapsedSeconds / maxRepopSeconds * 100;
        } else {
            repopInfo.status = 'UNKNOWN';
            repopInfo.percent = 0;
            repopInfo.elapsedPercent = 0;
            repopInfo.nextMinRepopDate = null;
        }

        mob.repopInfo = repopInfo;
    });
};

const calculateAndRender = () => {
    calculateRepopInfo();
    filterAndRender();
    updateProgressBars();
};

const updateProgressBars = () => {
    const now = Date.now() / 1000;

    document.querySelectorAll('.mob-card').forEach(card => {
        const mobNo = parseInt(card.dataset.mobNo);
        const mob = globalMobData.find(m => m.No === mobNo);
        if (!mob || !mob.repopInfo) return;

        const info = mob.repopInfo;
        const progressBarBg = card.querySelector('.progress-bar-bg');
        const progressBarWrapper = card.querySelector('.progress-bar-wrapper');
        const progressText = card.querySelector('.progress-text');
        
        if (!progressBarBg || !progressBarWrapper || !progressText) return;

        let width = 0;
        let bgColor = 'bg-gray-500';
        let text = 'N/A';
        
        const minRepopMinutes = mob.MinRepopTime;
        const maxRepopMinutes = mob.MaxRepopTime;

        if (info.status === 'WAITING' && mob.last_kill_time > 0) {
            const minRepopTimeSeconds = mob.last_kill_time + (minRepopMinutes * 60);
            const remainingSeconds = minRepopTimeSeconds - now;
            const totalWaitSeconds = minRepopMinutes * 60;
            
            width = 100 - (remainingSeconds / totalWaitSeconds) * 100;
            bgColor = 'bg-blue-500';
            
            const hours = Math.floor(remainingSeconds / 3600);
            const minutes = Math.floor((remainingSeconds % 3600) / 60);
            const seconds = Math.floor(remainingSeconds % 60);
            
            text = remainingSeconds > 0 ? `湧き窓まで ${hours}h ${minutes}m ${seconds}s` : `湧き窓突入`;

        } else if (info.status === 'WINDOW') {
            width = info.percent;
            bgColor = 'bg-yellow-500';
            
            const maxRepopTimeSeconds = mob.last_kill_time + (maxRepopMinutes * 60);
            const remainingSeconds = maxRepopTimeSeconds - now;
            
            const hours = Math.floor(remainingSeconds / 3600);
            const minutes = Math.floor((remainingSeconds % 3600) / 60);
            const seconds = Math.floor(remainingSeconds % 60);

            text = `窓終了まで ${hours}h ${minutes}m ${seconds}s (${Math.floor(info.percent)}%)`;

        } else if (info.status === 'OVERDUE') {
            width = 100;
            bgColor = 'bg-red-500';
            text = `【${formatLastKillTime(mob.last_kill_time)}】 湧き窓超過`;
            
        } else if (info.status === 'UNKNOWN') {
            width = 0;
            bgColor = 'bg-gray-600';
            text = 'LKT未報告';
        }
        
        progressBarBg.style.width = `${Math.min(100, width)}%`;
        progressBarBg.className = `progress-bar-bg absolute left-0 top-0 h-full rounded-full transition-all duration-100 ease-linear ${bgColor}`;
        progressBarWrapper.classList.toggle('opacity-50', info.status === 'UNKNOWN');
        progressText.textContent = text;
        
        const rank = mob.Rank;
        card.classList.remove('border-red-500', 'border-yellow-500', 'border-indigo-500', 'border-gray-700', 'border-green-500');

        if (rank === 'S' && info.status === 'WINDOW') {
            card.classList.add('border-red-500');
        } else if (rank === 'S' && info.status === 'OVERDUE') {
             card.classList.add('border-red-500', 'border-4');
        } else if (rank === 'A' && info.status === 'WINDOW') {
             card.classList.add('border-yellow-500');
        } else if (rank === 'A' && info.status === 'OVERDUE') {
             card.classList.add('border-yellow-500', 'border-4');
        } else if (rank === 'F' && info.status === 'WINDOW') {
             card.classList.add('border-indigo-500');
        } else if (rank === 'F' && info.status === 'OVERDUE') {
             card.classList.add('border-indigo-500', 'border-4');
        } else {
             card.classList.add('border-gray-700');
        }
    });

    // 1秒ごとに再実行
    setTimeout(updateProgressBars, 1000);
};

const fetchBaseMobData = async () => {
    const mockMobData = [
        { No: 1, Name: 'アグリッパ', Area: 'モードゥナ', Expansion: 'ARR', Rank: 'S', MinRepopTime: 48, MaxRepopTime: 72, Condition: '未確定。要報告。', Map: 'moduna.jpg', spawn_points: [{ id: 'p1', x: 50, y: 50, is_last_one: false, mob_ranks: ['A'] }, { id: 'p2', x: 20, y: 80, is_last_one: false, mob_ranks: ['A'] }] },
        { No: 2, Name: 'レドロネット', Area: 'クルザス中央高地', Expansion: 'ARR', Rank: 'A', MinRepopTime: 3, MaxRepopTime: 5, Condition: 'F.A.T.E.「邪念を追う者」を成功させる', Map: 'coerthas_central.jpg', spawn_points: [{ id: 'p3', x: 30, y: 60, is_last_one: false, mob_ranks: ['A'] }, { id: 'p4', x: 70, y: 40, is_last_one: false, mob_ranks: ['A'] }] },
        { No: 3, Name: 'ケロゲロス', Area: 'アバラシア雲海', Expansion: 'HW', Rank: 'S', MinRepopTime: 48, MaxRepopTime: 72, Condition: '未確定。要報告。', Map: 'sea_of_clouds.jpg', spawn_points: [{ id: 'p5', x: 10, y: 10, is_last_one: false, mob_ranks: ['A'] }, { id: 'p6', x: 90, y: 90, is_last_one: false, mob_ranks: ['A'] }] },
        { No: 4, Name: 'ラーヴァナ', Area: 'アジス・ラー', Expansion: 'HW', Rank: 'A', MinRepopTime: 3, MaxRepopTime: 5, Condition: '敵を討伐する (X: 18.2, Y: 18.2)', Map: 'azys_lla.jpg', spawn_points: [{ id: 'p7', x: 80, y: 20, is_last_one: false, mob_ranks: ['A'] }, { id: 'p8', x: 20, y: 80, is_last_one: false, mob_ranks: ['A'] }] },
        { No: 5, Name: 'ガンマ', Area: 'ギラバニア山岳地帯', Expansion: 'SB', Rank: 'S', MinRepopTime: 48, MaxRepopTime: 72, Condition: '未確定。要報告。', Map: 'peaks.jpg', spawn_points: [{ id: 'p9', x: 50, y: 50, is_last_one: false, mob_ranks: ['A'] }, { id: 'p10', x: 50, y: 70, is_last_one: false, mob_ranks: ['A'] }] },
        { No: 6, Name: 'オルガナ', Area: 'アム・アレーン', Expansion: 'SHB', Rank: 'F', MinRepopTime: 0, MaxRepopTime: 12, Condition: 'F.A.T.E.「アム・アレーンの異変」を成功させる', Map: 'am_ahren.jpg', spawn_points: [] },
        { No: 7, Name: 'オメガ', Area: 'ラケティカ大森林', Expansion: 'SHB', Rank: 'A', MinRepopTime: 3, MaxRepopTime: 5, Condition: '敵を討伐する (X: 20.0, Y: 20.0)', Map: 'raketika.jpg', spawn_points: [{ id: 'p11', x: 40, y: 30, is_last_one: false, mob_ranks: ['A'] }, { id: 'p12', x: 60, y: 60, is_last_one: false, mob_ranks: ['A'] }] },
        { No: 8, Name: 'エンケドラス', Area: 'ガレマルド', Expansion: 'EW', Rank: 'S', MinRepopTime: 48, MaxRepopTime: 72, Condition: '未確定。要報告。', Map: 'garlemald.jpg', spawn_points: [{ id: 'p13', x: 30, y: 30, is_last_one: false, mob_ranks: ['A'] }, { id: 'p14', x: 70, y: 70, is_last_one: false, mob_ranks: ['A'] }] },
        { No: 9, Name: 'ゾディアック', Area: 'サベネア島', Expansion: 'EW', Rank: 'A', MinRepopTime: 3, MaxRepopTime: 5, Condition: '敵を討伐する (X: 10.0, Y: 10.0)', Map: 'thavnair.jpg', spawn_points: [{ id: 'p15', x: 10, y: 50, is_last_one: false, mob_ranks: ['A'] }, { id: 'p16', x: 90, y: 50, is_last_one: false, mob_ranks: ['A'] }] },
        { No: 101, Name: '湧き潰しB-1', Area: 'モードゥナ', Expansion: 'ARR', Rank: 'B-CULL', MinRepopTime: 0, MaxRepopTime: 0, Condition: 'アグリッパの湧き潰し対象', related_mob_no: 1, Map: 'moduna.jpg', spawn_points: [{ id: 'p1', x: 50, y: 50, is_last_one: false, mob_ranks: ['B'] }, { id: 'p2', x: 20, y: 80, is_last_one: false, mob_ranks: ['B'] }] },
        { No: 102, Name: '湧き潰しB-2', Area: 'クルザス中央高地', Expansion: 'ARR', Rank: 'B-CULL', MinRepopTime: 0, MaxRepopTime: 0, Condition: 'レドロネットの湧き潰し対象', related_mob_no: 2, Map: 'coerthas_central.jpg', spawn_points: [{ id: 'p3', x: 30, y: 60, is_last_one: false, mob_ranks: ['B'] }, { id: 'p4', x: 70, y: 40, is_last_one: false, mob_ranks: ['B'] }] },
    ];
    
    globalMobData = mockMobData;
    calculateAndRender();
    displayStatus("ベースデータ取得完了。", 'success');
};


const drawSpawnPoint = (point, cullStatus, mobNo, rank, isLastOne, isS_LastOne, lastKillTime, prevKillTime) => {
    const locationId = point.id;
    // cullStatusは全体オブジェクトとして渡されるため、locationIdでアクセス
    const status = cullStatus[locationId]?.status || 'NOT_CULLED';
    const isCulled = status === 'CULLED';

    const isLastOneApplicable = isLastOne && (rank === 'S' || rank === 'A');
    const isLastOneVisible = isLastOneApplicable && lastKillTime === 0;

    let size = 'w-3 h-3';
    let color = 'bg-gray-400';
    let ring = 'ring-2 ring-gray-600';
    let label = '';
    let isInteractive = 'true';

    if (rank === 'S' && isLastOneApplicable) {
        size = 'w-4 h-4';
        color = 'bg-purple-500';
        ring = 'ring-4 ring-purple-300 ring-offset-1 ring-offset-gray-700';
        label = 'L';
        isInteractive = 'false';

        if (!isLastOneVisible) {
             return '';
        }

    } else if (isCulled) {
        color = 'bg-green-500';
        ring = 'ring-4 ring-green-300 ring-offset-1 ring-offset-gray-700';
        label = 'C';
        size = 'w-4 h-4';
    } else {
        color = 'bg-yellow-500';
        ring = 'ring-4 ring-yellow-300 ring-offset-1 ring-offset-gray-700';
        size = 'w-3 h-3';
    }

    const tooltip = isCulled ? '湧き潰し済み (クリックで解除)' : '未湧き潰し (クリックで湧き潰し)';
    
    const x = point.x - (isInteractive === 'true' ? 1.5 : 2);
    const y = point.y - (isInteractive === 'true' ? 1.5 : 2);

    return `
        <div class="spawn-point absolute rounded-full ${size} ${color} ${ring} flex items-center justify-center text-[8px] font-bold text-gray-900 cursor-pointer transition transform hover:scale-125 duration-100"
            style="left: ${x}%; top: ${y}%;"
            data-location-id="${locationId}"
            data-is-culled="${isCulled}"
            data-is-interactive="${isInteractive}"
            title="${tooltip}">
            ${label}
        </div>
    `;
};


const createMobCard = (mob) => {
    const rank = mob.Rank;
    const rankConfig = RANK_COLORS[rank] || RANK_COLORS.A;
    const rankLabel = rankConfig.label || rank;
    
    const lastKillDisplay = formatLastKillTime(mob.last_kill_time);
    
    const absTimeFormat = { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' };
    
    const nextTimeDisplay = mob.repopInfo?.nextMinRepopDate ? new Intl.DateTimeFormat('ja-JP', absTimeFormat).format(mob.repopInfo.nextMinRepopDate) : '未確定';
    
    const prevTimeDisplay = mob.last_kill_time > 0 ? new Intl.DateTimeFormat('ja-JP', absTimeFormat).format(new Date(mob.last_kill_time * 1000)) : '未報告';

    const isS_LastOne = rank === 'S' && mob.spawn_points && mob.spawn_points.some(p => p.is_last_one && (p.mob_ranks.includes('S') || p.mob_ranks.includes('A')));
    
    const isExpandable = rank === 'S' || rank === 'A' || rank === 'F';
    const isOpen = isExpandable && mob.No === openMobCardNo;
    
    const spawnPointsHtml = (rank === 'S' && mob.Map) ?
        (mob.spawn_points ?? []).map(point => drawSpawnPoint(
            point,
            mob.spawn_cull_status,
            mob.No,
            mob.Rank,
            point.is_last_one,
            isS_LastOne,
            mob.last_kill_time,
            mob.prev_kill_time
        )).join('')
        : '';

    const cardHeaderHTML = `
        <div class="p-1.5 space-y-1 bg-gray-800/70" data-toggle="card-header">
            
            <div class="flex justify-between items-start space-x-2">
                
                <div class="flex flex-col flex-shrink min-w-0">
                    <div class="flex items-center space-x-2">
                        <span class="rank-icon ${rankConfig.bg} text-white text-xs font-bold px-2 py-0.5 rounded-full">${rankLabel}</span>
                        <span class="mob-name text-lg font-bold text-white text-outline truncate max-w-xs md:max-w-[150px] lg:max-w-full">${mob.Name}</span>
                    </div>
                    <span class="text-xs text-gray-400 mt-0.5">${mob.Area} (${mob.Expansion})</span>
                </div>

                <div class="flex-shrink-0 flex flex-col space-y-1 items-end" style="min-width: 120px;">
                    ${rank === 'A' || rank === 'F'
                        ? `<button data-report-type="instant" data-mob-no="${mob.No}" class="px-2 py-0.5 text-xs rounded bg-yellow-500 hover:bg-yellow-400 text-gray-900 font-semibold transition">即時<br>報告</button>`
                        : `<button data-report-type="modal" data-mob-no="${mob.No}" class="px-2 py-0.5 text-xs rounded bg-green-500 hover:bg-green-400 text-gray-900 font-semibold transition">報告<br>する</button>`
                    }
                </div>
            </div>

            <div class="progress-bar-wrapper h-4 rounded-full relative overflow-hidden transition-all duration-100 ease-linear bg-gray-600">
                <div class="progress-bar-bg absolute left-0 top-0 h-full rounded-full transition-all duration-100 ease-linear" style="width: 0;"></div>
                <div class="progress-text absolute inset-0 flex items-center justify-center text-xs font-semibold text-white" style="line-height: 1;">
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

                ${mob.Map && rank === 'S' ? `
                    <div class="map-content py-1.5 flex justify-center relative">
                        <img src="https://placehold.co/400x400/1f2937/ffffff?text=${mob.Area}+Map+Placeholder" alt="${mob.Area} Map" class="w-full h-auto rounded shadow-lg border border-gray-600">
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

const distributeCards = () => {
    const windowWidth = window.innerWidth;
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
        btn.classList.remove('bg-blue-800', 'bg-red-800', 'bg-yellow-800', 'bg-indigo-800', 'bg-gray-800');
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

const filterAndRender = () => {
    const targetDataRank = FILTER_TO_DATA_RANK_MAP[currentFilter.rank] || currentFilter.rank;
    
    const filteredData = globalMobData.filter(mob => {
        if (targetDataRank !== 'ALL') {
            if (targetDataRank === 'A' || targetDataRank === 'F') {
                if (mob.Rank !== targetDataRank && !mob.Rank.startsWith('B')) return false;

                if (mob.Rank.startsWith('B')) {
                     const relatedMob = globalMobData.find(m => m.No === mob.related_mob_no);
                     if (!relatedMob || relatedMob.Rank !== targetDataRank) return false;
                }

            } else if (mob.Rank !== targetDataRank) {
                return false;
            }
        }

        const areaSet = currentFilter.areaSets[currentFilter.rank];
        
        const mobExpansion = mob.Rank.startsWith('B') 
            ? globalMobData.find(m => m.No === mob.related_mob_no)?.Expansion || mob.Expansion
            : mob.Expansion;
            
        if (!areaSet || !(areaSet instanceof Set) || areaSet.size === 0) return true;

        return areaSet.has(mobExpansion);
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
    allButton.className = `area-filter-btn px-3 py-1 text-xs rounded font-semibold transition ${isAllSelected ? 'bg-red-500 hover:bg-red-400' : 'bg-gray-500 hover:bg-gray-400'}`;
    allButton.dataset.area = 'ALL';
    DOMElements.areaFilterPanel.appendChild(allButton);

    Array.from(areas).sort((a, b) => {
        const expansionOrder = Object.values(EXPANSION_MAP);
        const indexA = expansionOrder.indexOf(a);
        const indexB = expansionOrder.indexOf(b);
        return indexA - indexB; 
    }).forEach(area => {
        const btn = document.createElement('button');
        const isSelected = currentAreaSet.has(area);
        btn.textContent = area;
        btn.className = `area-filter-btn px-3 py-1 text-xs rounded font-semibold transition ${isSelected ? 'bg-green-500 hover:bg-green-400' : 'bg-gray-500 hover:bg-gray-400'}`;
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
    
    // ランクタブのリスナー (3クリック動作ロジック)
    DOMElements.rankTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('.tab-button');
        if (!btn) return;

        const newRank = btn.dataset.rank;
        let currentClickCount = parseInt(btn.dataset.clickCount || 0, 10);
        const isSameRank = newRank === currentFilter.rank;

        if (!isSameRank) {
            const prevButton = DOMElements.rankTabs.querySelector(`[data-rank="${currentFilter.rank}"]`);
            if (prevButton) {
                prevButton.dataset.clickCount = 0;
            }

            currentFilter.rank = newRank;

            if (newRank === 'ALL') {
                toggleAreaFilterPanel(true);
                btn.dataset.clickCount = 0;
            } else {
                toggleAreaFilterPanel(true);
                btn.dataset.clickCount = 1; 
            }

            if (!currentFilter.areaSets[newRank] || !(currentFilter.areaSets[newRank] instanceof Set)) {
                currentFilter.areaSets[newRank] = new Set();
            }
            filterAndRender();

        } else if (newRank !== 'ALL') {
            currentClickCount = (currentClickCount + 1) % 3;

            if (currentClickCount === 1) {
                toggleAreaFilterPanel(false);
            } else {
                toggleAreaFilterPanel(true);
            }
            
            btn.dataset.clickCount = currentClickCount.toString();
        } else {
            toggleAreaFilterPanel(true);
            btn.dataset.clickCount = 0;
        }
        
        updateFilterUI();
    });

    // エリアフィルターボタンのクリック処理
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
        filterAndRender();
    });

    // カードとスポーンポイントのイベントリスナー
    DOMElements.colContainer.addEventListener('click', (e) => {
        const card = e.target.closest('.mob-card');
        if (!card) return;

        const mobNo = parseInt(card.dataset.mobNo);
        const rank = card.dataset.rank;
        
        // 報告ボタンのクリック
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

        // スポーンポイントのクリック処理
        const point = e.target.closest('.spawn-point');
        if (point && point.dataset.isInteractive === 'true') { 
            e.preventDefault(); 
            e.stopPropagation();

            const locationId = point.dataset.locationId;
            const isCurrentlyCulled = point.dataset.isCulled === 'true';
            
            toggleCrushStatus(mobNo, locationId, isCurrentlyCulled);
            return;
        }

        // カードヘッダーのクリックで展開/格納
        if (e.target.closest('[data-toggle="card-header"]')) {
            if (rank === 'S' || rank === 'A' || rank === 'F') {
                const panel = card.querySelector('.expandable-panel');
                if (panel) {
                    if (!panel.classList.contains('open')) {
                        document.querySelectorAll('.expandable-panel.open').forEach(openPanel => {
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

// 初期化
document.addEventListener('DOMContentLoaded', () => {
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
            if (currentFilter.rank !== 'ALL') {
                btn.dataset.clickCount = 1;
            } else {
                 btn.dataset.clickCount = 0;
            }
        } else {
            btn.dataset.clickCount = 0;
        }
    });

    updateFilterUI();
    fetchBaseMobData();
    displayStatus("アプリを初期化中...", 'loading');
});
