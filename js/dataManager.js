/**
 * dataManager.js - Firestoreデータの読み込みと更新、静的データの管理
 */

import { MOB_DATA_JSON_PATH, DEFAULT_REPOP_SECONDS } from './config.js'; 
import { db, firestore as fs, functions } from './firebaseConfig.js'; 
import { collection, onSnapshot } from 'firebase/firestore'; 
import { httpsCallable } from 'firebase/functions'; 

let _globalMobData = {}; 
let _listeners = [];
let _isInitialized = false;     // 🔥 修正点1: 初期化フラグ
let _unsubscribeFirestore = null; // 🔥 修正点2: Firestoreの購読解除関数

// --- 初期化とリスナー管理 ---

export const initialize = async () => {
    // 🔥 修正点3: 多重初期化防止ガード
    if (_isInitialized) {
        // console.warn('dataManager is already initialized. Skipping.'); // ログは削除
        return;
    }
    
    try {
        await _loadStaticData();
        _setupFirestoreListeners(); // 購読を開始し、購読解除関数を保持
        _isInitialized = true;
        _notifyListeners(); // 静的データロード後、即座に一度リストを描画する（空の状態を解消）
    } catch (error) {
        throw error;
    }
};

/**
 * リスナーを登録し、解除関数を返す (重複登録防止機能付き)
 */
export const addListener = (listener) => {
    // 🔥 修正点4: リスナーの重複登録を防止
    if (!_listeners.includes(listener)) {
        _listeners.push(listener);
    }
    
    // 🔥 修正点5: リスナーの解除関数を返す
    return () => { 
        _listeners = _listeners.filter(l => l !== listener); 
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
    _globalMobData = {};
    _isInitialized = false;
};

const _notifyListeners = () => {
    _listeners.forEach(listener => listener(_globalMobData));
};

// --- 静的データの処理 ---

const _loadStaticData = async () => {
    try {
        const response = await fetch(MOB_DATA_JSON_PATH); 
        
        // 🔥 修正点6: エラーハンドリングを詳細化
        if (!response.ok) {
            // パスとステータスをログに残す
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
        // 既に詳細なエラーメッセージになっているため、そのまま投げる
        throw error;
    }
};

// --- 動的データの処理 (Firestore) ---

const _setupFirestoreListeners = () => {
    const q = collection(db, 'mob_status'); 
    
    // 🔥 修正点7: onSnapshot の返り値（購読解除関数）を保持
    _unsubscribeFirestore = onSnapshot(q, (snapshot) => {
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
    const killTimeSeconds = dynamicStatus.currentKillTime 
                            ? dynamicStatus.currentKillTime.toMillis() / 1000 
                            : null;

    const repopSeconds = staticMob.repopSeconds || DEFAULT_REPOP_SECONDS; 
    const maxRepopSeconds = staticMob.maxRepopSeconds || repopSeconds;

    const nextMinSeconds = killTimeSeconds ? killTimeSeconds + repopSeconds : null;
    const nextMaxSeconds = killTimeSeconds ? killTimeSeconds + maxRepopSeconds : null;
    
    let timeRemaining = null;
    let timerState = 'initial';

    if (killTimeSeconds === null) {
        timerState = 'initial';
        timeRemaining = null;
    } else if (nowSeconds < nextMinSeconds) {
        timerState = 'imminent';
        timeRemaining = nextMinSeconds - nowSeconds; // 最短まで残り
    } else if (nowSeconds >= nextMinSeconds && nowSeconds < nextMaxSeconds) {
        // 🔥 修正点8: spawned 状態では、最長湧きまでの残り時間を返す
        timerState = 'spawned';
        timeRemaining = nextMaxSeconds - nowSeconds; // 最長まで残り
    } else { // nowSeconds >= nextMaxSeconds
        timerState = 'expired';
        // 🔥 修正点9: expired 状態では、負値の計算を避けるため、UI側で処理できるよう0を返す（またはnull/負値を許可する設計）
        // UI側が負値を扱うことに慣れているため、ここではexpiredの経過時間として負値を返します
        timeRemaining = nextMaxSeconds - nowSeconds; 
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
