/**
 * dataManager.js - Firestoreデータの読み込みと更新、静的データの管理
 */

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
            throw new Error(`Failed to load mob_data.json. Status: ${response.status}`);
        }
        
        const staticData = await response.json();
        
        Object.keys(staticData).forEach(id => {
            _globalMobData[id] = {
                ...staticData[id],
                current_kill_time: null,
                next_respawn_min: null,
                time_remaining_seconds: 0,
                timer_state: 'initial', 
                crush_points_status: {},
                last_updated_report_id: null,
                current_kill_memo: null,
            };
        });

    } catch (error) {
        throw new Error('Failed to load mob_data.json');
    }
};

// --- 動的データの処理 (Firestore) ---

const _setupFirestoreListeners = () => {
    // Firestore v10 構文を使用: db.collection('mob_status') を collection(db, 'mob_status') に変更
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
    const killTimeSeconds = dynamicStatus.current_kill_time 
                            ? dynamicStatus.current_kill_time.toMillis() / 1000 
                            : null;

    const repopSeconds = staticMob.repop_seconds || DEFAULT_REPOP_SECONDS;

    const nextMinSeconds = killTimeSeconds ? killTimeSeconds + repopSeconds : null;
    
    const nextMaxSeconds = (staticMob.rank === 'S' && killTimeSeconds) 
                           ? killTimeSeconds + repopSeconds * 1.5
                           : nextMinSeconds;

    let timeRemaining = null;
    let timerState = 'initial';

    if (killTimeSeconds === null) {
        timerState = 'initial';
    } else if (nowSeconds < nextMinSeconds) {
        timerState = 'imminent';
        timeRemaining = nextMinSeconds - nowSeconds; 
    } else if (nowSeconds >= nextMinSeconds && (!nextMaxSeconds || nowSeconds < nextMaxSeconds)) {
        timerState = 'spawned';
        timeRemaining = nextMinSeconds - nowSeconds; 
    } else if (nextMaxSeconds && nowSeconds >= nextMaxSeconds) {
        timerState = 'expired';
        timeRemaining = nextMaxSeconds - nowSeconds;
    }

    return {
        ...staticMob,
        ...dynamicStatus,
        current_kill_time: killTimeSeconds,
        next_respawn_min: nextMinSeconds,
        next_respawn_max: nextMaxSeconds,
        time_remaining_seconds: timeRemaining, 
        timer_state: timerState,
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
