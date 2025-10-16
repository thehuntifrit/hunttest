/**
 * dataManager.js - Firestoreデータの読み込みと更新、静的データの管理
 */

import { MOB_DATA_JSON_PATH, DEFAULT_REPOP_SECONDS } from './config.js'; 
import { db, firestore as fs, functions } from './firebaseConfig.js'; 
import { collection, onSnapshot } from 'firebase/firestore'; 
import { httpsCallable } from 'firebase/functions'; 

let _globalMobData = {}; 
let _listeners = [];
let _errorListeners = []; 
let _isInitialized = false;     
let _unsubscribeFirestore = null; 

// --- 初期化とリスナー管理 ---

export const initialize = async () => {
    if (_isInitialized) {
        return;
    }
    
    try {
        await _loadStaticData();
        _notifyListeners(); 
        _setupFirestoreListeners(); 
        _isInitialized = true;
    } catch (error) {
        console.error("Initialization Error:", error);
        _notifyErrorListeners(error); 
    }
};

/**
 * 通常のデータ変更リスナーを登録し、解除関数を返す
 */
export const addListener = (listener) => {
    if (!_listeners.includes(listener)) {
        _listeners.push(listener);
    }
    
    return () => { 
        _listeners = _listeners.filter(l => l !== listener); 
    };
};

/**
 * エラー通知リスナーを登録し、解除関数を返す
 */
export const addErrorListener = (listener) => {
    if (!_errorListeners.includes(listener)) {
        _errorListeners.push(listener);
    }
    
    return () => { 
        _errorListeners = _errorListeners.filter(l => l !== listener); 
    };
};

/**
 * Firestore購読とすべてのリスナーを解除するクリーンアップ関数
 */
export const cleanup = () => {
    if (_unsubscribeFirestore) {
        _unsubscribeFirestore();
        _unsubscribeFirestore = null;
    }
    _listeners = [];
    _errorListeners = []; 
    _globalMobData = {};
    _isInitialized = false;
};

const _notifyListeners = () => {
    // データ不変性を保証するため、ディープコピーをリスナーに渡す
    const snapshot = JSON.parse(JSON.stringify(_globalMobData));
    _listeners.forEach(listener => listener(snapshot));
};

const _notifyErrorListeners = (error) => {
    _errorListeners.forEach(listener => listener(error));
};

// --- 静的データの処理 ---

const _loadStaticData = async () => {
    try {
        const response = await fetch(MOB_DATA_JSON_PATH); 
        
        if (!response.ok) {
            throw new Error(`Failed to load mob_data.json from path: ${MOB_DATA_JSON_PATH}. Status: ${response.status}`);
        }
        
        const staticData = await response.json();
        
        const mobConfigs = staticData.mobs || staticData;
        
        Object.keys(mobConfigs).forEach(id => {
            _globalMobData[id] = {
                ...mobConfigs[id],
                id: id, 
                currentKillTime: null,
                nextRespawnMin: null,
                nextRespawnMax: null,
                timeRemainingSeconds: 0,
                timerState: 'initial', 
                crushPointsStatus: {},
                lastUpdatedReportId: null,
                currentKillMemo: null,
            };
        });

    } catch (error) {
        // エラー通知の一貫性を保つため、エラーリスナーに通知してから再 throw
        _notifyErrorListeners(error); 
        throw error;
    }
};

// --- 動的データの処理 (Firestore) ---

const _setupFirestoreListeners = () => {
    if (_unsubscribeFirestore) {
        _unsubscribeFirestore();
    }
    
    const q = collection(db, 'mob_status'); 
    
    _unsubscribeFirestore = onSnapshot(q, (snapshot) => {
        let changed = false;
        const now = fs.Timestamp.now().toMillis() / 1000; 

        snapshot.docChanges().forEach(change => {
            const mobId = change.doc.id;

            if (change.type === 'added' || change.type === 'modified') {
                const status = change.doc.data();

                if (_globalMobData[mobId]) {
                    _globalMobData[mobId] = _calculateMobState(_globalMobData[mobId], status, now);
                    changed = true;
                }
            } else if (change.type === 'removed') { 
                if (_globalMobData[mobId]) {
                    delete _globalMobData[mobId];
                    changed = true;
                }
            }
        });

        if (changed) {
            _notifyListeners();
        }
    }, (error) => {
        console.error("Firestore data listener error:", error);
        _notifyErrorListeners(error); 
    });
};

/**
 * Mobの状態を計算し、時間情報を付加する
 */
const _calculateMobState = (staticMob, dynamicStatus, nowSeconds) => {
    let killTimeSeconds = null;

    if (dynamicStatus.currentKillTime && typeof dynamicStatus.currentKillTime.toMillis === 'function') {
        killTimeSeconds = dynamicStatus.currentKillTime.toMillis() / 1000;
    }

    const repopSeconds = staticMob.repopSeconds || DEFAULT_REPOP_SECONDS; 
    const maxRepopSeconds = staticMob.maxRepopSeconds || repopSeconds;

    const nextMinSeconds = killTimeSeconds ? killTimeSeconds + repopSeconds : null;
    const nextMaxSeconds = killTimeSeconds ? killTimeSeconds + maxRepopSeconds : null;
    
    let timeRemaining = null;
    let timerState = 'initial';
    
    // timeRemainingSeconds の意味：
    // - imminent: 最短リポップまでの残り秒数
    // - spawned: 最長リポップまでの残り秒数
    // - expired: 0

    if (killTimeSeconds === null) {
        timerState = 'initial';
        timeRemaining = null;
    } else if (nowSeconds < nextMinSeconds) {
        timerState = 'imminent';
        timeRemaining = nextMinSeconds - nowSeconds; 
    } else if (nowSeconds >= nextMinSeconds && nowSeconds < nextMaxSeconds) {
        timerState = 'spawned';
        timeRemaining = nextMaxSeconds - nowSeconds; 
    } else { 
        timerState = 'expired';
        timeRemaining = 0; 
    }

    return {
        ...staticMob,
        ...dynamicStatus,
        currentKillTime: killTimeSeconds,
        nextRespawnMin: nextMinSeconds,
        nextRespawnMax: nextMaxSeconds,
        timeRemainingSeconds: timeRemaining, 
        timerState: timerState,
    };
};

// --- パブリックインターフェース (API) ---

export const getGlobalMobData = () => {
    // データ不変性を保証するため、ディープコピーを返す
    return JSON.parse(JSON.stringify(_globalMobData));
};

export const getMobList = () => {
    // Mobデータを配列として返すユーティリティ。ディープコピーを適用
    const mobArray = Object.values(_globalMobData);
    return JSON.parse(JSON.stringify(mobArray));
};

export const submitHuntReport = async (mobId, memo, reporterUID) => {
    const reportProcessor = httpsCallable(functions, 'reportProcessor');

    const reportData = {
        mobId: mobId,
        memo: memo,
        reporterUID: reporterUID,
        reportTime: fs.Timestamp.now(), 
    };

    const result = await reportProcessor(reportData);
    
    if (result.data && result.data.reportId) {
        return result.data.reportId;
    }
    throw new Error('Report submission failed or returned no ID.');
};

export const updateCrushStatus = async (mobId, crushPointId, action) => {
    const crushStatusUpdater = httpsCallable(functions, 'crushStatusUpdater');
    
    await crushStatusUpdater({
        mobId: mobId,
        pointId: crushPointId,
        action: action
    });
};
