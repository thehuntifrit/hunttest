/**
 * dataManager.js - Firestoreデータの読み込みと更新、静的データの管理
 */

import { MOB_DATA_JSON_PATH, DEFAULT_REPOP_SECONDS } from './config.js'; 
import { db, firestore as fs, functions } from './firebaseConfig.js'; 
import { collection, onSnapshot } from 'firebase/firestore'; 
import { httpsCallable } from 'firebase/functions'; 

let _globalMobData = {}; 
let _listeners = [];      

// --- 初期化とリスナー管理 ---

export const initialize = async () => {
    try {
        await _loadStaticData();
        _setupFirestoreListeners();
    } catch (error) {
        throw error;
    }
};

export const addListener = (listener) => {
    _listeners.push(listener);
};

const _notifyListeners = () => {
    _listeners.forEach(listener => listener(_globalMobData));
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
                // キャメルケースに統一
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
        throw new Error('Failed to load mob_data.json');
    }
};

// --- 動的データの処理 (Firestore) ---

const _setupFirestoreListeners = () => {
    const q = collection(db, 'mob_status'); 
    
    onSnapshot(q, (snapshot) => {
        let changed = false;
        const now = fs.Timestamp.now().toMillis() / 1000; 

        snapshot.docChanges().forEach(change => {
            if (change.type === 'added' || change.type === 'modified') {
                const mobId = change.doc.id;
                const status = change.doc.data();

                if (_globalMobData[mobId]) {
                    _globalMobData[mobId] = _calculateMobState(_globalMobData[mobId], status, now);
                    changed = true;
                }
            }
        });

        if (changed) {
            _notifyListeners();
        }
    }, (error) => {
        console.error("Firestore data listener error:", error);
    });
};

const _calculateMobState = (staticMob, dynamicStatus, nowSeconds) => {
    // Firestoreデータ内のキーをキャメルケース (currentKillTime) に想定
    const killTimeSeconds = dynamicStatus.currentKillTime 
                            ? dynamicStatus.currentKillTime.toMillis() / 1000 
                            : null;

    // JSONからrepSeconds (最短) と maxRepopSeconds (最長) を直接取得
    const repopSeconds = staticMob.repopSeconds || DEFAULT_REPOP_SECONDS; 
    const maxRepopSeconds = staticMob.maxRepopSeconds || repopSeconds;

    const nextMinSeconds = killTimeSeconds ? killTimeSeconds + repopSeconds : null;
    const nextMaxSeconds = killTimeSeconds ? killTimeSeconds + maxRepopSeconds : null;
    
    let timeRemaining = null;
    let timerState = 'initial';

    if (killTimeSeconds === null) {
        timerState = 'initial';
    } else if (nowSeconds < nextMinSeconds) {
        timerState = 'imminent';
        timeRemaining = nextMinSeconds - nowSeconds; 
    } else if (nowSeconds >= nextMinSeconds && nowSeconds < nextMaxSeconds) {
        timerState = 'spawned';
        timeRemaining = nextMinSeconds - nowSeconds;
    } else if (nowSeconds >= nextMaxSeconds) {
        timerState = 'expired';
        timeRemaining = nextMaxSeconds - nowSeconds;
    }

    return {
        ...staticMob,
        ...dynamicStatus,
        // 返却する動的ステータスのキーをキャメルケースに統一
        currentKillTime: killTimeSeconds,
        nextRespawnMin: nextMinSeconds,
        nextRespawnMax: nextMaxSeconds,
        timeRemainingSeconds: timeRemaining, 
        timerState: timerState,
    };
};

// --- パブリックインターフェース (API) ---

export const getGlobalMobData = () => {
    return _globalMobData;
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
