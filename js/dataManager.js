/**
 * dataManager.js - Firestoreデータの読み込みと更新、静的データの管理
 * * 責務:
 * 1. 静的データ (mob_data.json) のロードと格納
 * 2. Firestore (mob_status) からのリアルタイム同期
 * 3. 湧き時間タイマー状態 (imminent/spawned/expired) の計算
 * 4. データの外部への安全な提供 (ディープコピーを使用)
 * 5. 多重初期化防止、購読解除 (cleanup) 機能の提供
 */

import { MOB_DATA_JSON_PATH, DEFAULT_REPOP_SECONDS } from './config.js'; 
import { db, firestore as fs, functions } from './firebaseConfig.js'; 
import { collection, onSnapshot } from 'firebase/firestore'; 
import { httpsCallable } from 'firebase/functions'; 

let _globalMobData = {}; 
let _listeners = [];
let _isInitialized = false;     
let _unsubscribeFirestore = null; 

// --- 初期化とリスナー管理 ---

export const initialize = async () => {
    // 初期化ガード
    if (_isInitialized) {
        return;
    }
    
    try {
        await _loadStaticData();
        _notifyListeners(); // 静的データをロードした直後に一度通知
        _setupFirestoreListeners(); 
        _isInitialized = true;
    } catch (error) {
        // 呼び出し元でキャッチし、UIに表示できるようにするため、エラーを再スロー
        throw error;
    }
};

/**
 * リスナーを登録し、解除関数を返す (重複登録防止機能付き)
 */
export const addListener = (listener) => {
    // リスナーの重複登録を防止
    if (!_listeners.includes(listener)) {
        _listeners.push(listener);
    }
    
    // リスナーの解除関数を返す
    return () => { 
        _listeners = _listeners.filter(l => l !== listener); 
    };
};

/**
 * Firestore購読とすべてのリスナーを解除するクリーンアップ関数
 */
export const cleanup = () => {
    // 購読解除
    if (_unsubscribeFirestore) {
        _unsubscribeFirestore();
        _unsubscribeFirestore = null;
    }
    // 内部状態のリセット
    _listeners = [];
    _globalMobData = {};
    _isInitialized = false;
};

const _notifyListeners = () => {
    // 修正点2: リスナーに渡すデータはディープコピーして、外部からの書き換えを防ぐ
    const snapshot = JSON.parse(JSON.stringify(_globalMobData));
    _listeners.forEach(listener => listener(snapshot));
};

// --- 静的データの処理 ---

const _loadStaticData = async () => {
    try {
        const response = await fetch(MOB_DATA_JSON_PATH); 
        
        // エラーハンドリングを詳細化
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
        throw error;
    }
};

// --- 動的データの処理 (Firestore) ---

const _setupFirestoreListeners = () => {
    // 修正点3: 再初期化時に古い購読を確実に解除
    if (_unsubscribeFirestore) {
        _unsubscribeFirestore();
        _unsubscribeFirestore = null; 
    }
    
    const q = collection(db, 'mob_status'); 
    
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
    // timeRemainingSeconds の意味:
    // - initial: null
    // - imminent: 最短リポップまでの残り秒数 (正の値)
    // - spawned: 最長リポップまでの残り秒数 (正の値)
    // - expired: 0 (湧き猶予期間終了)

    let killTimeSeconds = null;
    // 修正点5: Timestampの型チェック
    if (dynamicStatus.currentKillTime && typeof dynamicStatus.currentKillTime.toMillis === 'function') {
        killTimeSeconds = dynamicStatus.currentKillTime.toMillis() / 1000;
    }

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
        timeRemaining = nextMinSeconds - nowSeconds; 
    } else if (nowSeconds >= nextMinSeconds && nowSeconds < nextMaxSeconds) {
        timerState = 'spawned';
        timeRemaining = nextMaxSeconds - nowSeconds; // 最長までの残り時間
    } else { 
        // 修正点1: expired 状態の残り時間を 0 にする
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
    // 修正点1: 外部からの直接変更を防ぐため、ディープコピーを返す
    return JSON.parse(JSON.stringify(_globalMobData));
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
