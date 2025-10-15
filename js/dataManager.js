/**
 * dataManager.js - Firestoreデータの読み込みと更新、静的データの管理
 * 責務: アプリケーションで使用するすべてのデータの一元管理
 */

// Firebase SDK v10の関数をCDN URLから直接インポート
import { db, firestore as fs, functions } from './firebaseConfig.js'; 
import { collection, onSnapshot, query, where } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { MOB_DATA_JSON_PATH, DEFAULT_REPOP_SECONDS } from './config.js'; 

// Cloud Functionsの呼び出しに必要な関数
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';

// --- グローバル状態 ---
let _globalMobData = {}; // 静的データと動的データをマージした最終的なデータ
let _listeners = [];      // データ更新を購読するコールバック関数

// --- 初期化とリスナー管理 ---

/**
 * データマネージャの初期化。静的データのロードとFirestoreリスナーの設定を行う。
 */
export const initialize = async () => {
    console.log('DataManager: Starting initialization...');
    try {
        await _loadStaticData();
        _setupFirestoreListeners();
        console.log('DataManager: Initialization complete.');
    } catch (error) {
        console.error('DataManager: Initialization failed.', error);
        throw error; // app.jsにエラーを伝播させる
    }
};

/**
 * Mobデータを更新した際に呼び出されるリスナーを登録する。
 * @param {Function} listener - Mobデータを受け取るコールバック関数
 */
export const addListener = (listener) => {
    _listeners.push(listener);
};

/**
 * 登録されたすべてのリスナーに現在のMobデータを通知する。
 */
const _notifyListeners = () => {
    _listeners.forEach(listener => listener(_globalMobData));
};

// --- 静的データの処理 ---

/**
 * mob_data.jsonから静的データをロードし、グローバル状態に設定する。
 */
const _loadStaticData = async () => {
    console.log('DataManager: Loading static mob data...');
    try {
        // config.jsで定義されたパスを使用
        const response = await fetch(MOB_DATA_JSON_PATH); 
        
        if (!response.ok) {
            throw new Error(`Failed to load mob_data.json. Status: ${response.status}`);
        }
        
        const staticData = await response.json();
        
        // 静的データを初期データとして_globalMobDataにコピー
        Object.keys(staticData).forEach(id => {
            _globalMobData[id] = {
                ...staticData[id],
                // 動的データを初期化
                current_kill_time: null,
                next_respawn_min: null,
                time_remaining_seconds: 0,
                timer_state: 'initial', // 'initial', 'imminent', 'spawned', 'expired'
                crush_points_status: {},
                last_updated_report_id: null,
                current_kill_memo: null,
            };
        });
        console.log(`DataManager: Loaded ${Object.keys(staticData).length} static mobs.`);

    } catch (error) {
        console.error('Error loading static mob data:', error);
        throw new Error('Failed to load mob_data.json');
    }
};

// --- 動的データの処理 (Firestore) ---

/**
 * FirestoreからリアルタイムでMobステータスを購読する。
 */
const _setupFirestoreListeners = () => {
    console.log('DataManager: Setting up Firestore listener...');

    // Firestore v10 構文を使用
    const q = collection(db, 'mob_status'); 
    
    // リアルタイムリスナーを設定
    onSnapshot(q, (snapshot) => {
        let changed = false;
        const now = fs.Timestamp.now().toMillis() / 1000; // 現在時刻 (秒)

        snapshot.docChanges().forEach(change => {
            if (change.type === 'added' || change.type === 'modified') {
                const mobId = change.doc.id;
                const status = change.doc.data();

                if (_globalMobData[mobId]) {
                    // 最新の動的データをマージ
                    _globalMobData[mobId] = _calculateMobState(_globalMobData[mobId], status, now);
                    changed = true;
                }
            }
        });

        // データの変動があった場合のみリスナーに通知
        if (changed) {
            _notifyListeners();
        }
    }, (error) => {
        console.error("Firestore data listener error:", error);
    });
};

/**
 * Mobの現在のステータスを計算する。
 * @param {Object} staticMob - 静的Mobデータ
 * @param {Object} dynamicStatus - Firestoreから取得した動的Mobステータス
 * @param {number} nowSeconds - 現在の時刻 (UNIX秒)
 * @returns {Object} 状態が計算されたMobデータ
 */
const _calculateMobState = (staticMob, dynamicStatus, nowSeconds) => {
    // 最終討伐時間をUNIX秒に変換
    const killTimeSeconds = dynamicStatus.current_kill_time 
                            ? dynamicStatus.current_kill_time.toMillis() / 1000 
                            : null;

    // 湧き間隔を取得 (静的データまたはデフォルト値)
    const repopSeconds = staticMob.repop_seconds || DEFAULT_REPOP_SECONDS;

    // 最小湧き時刻 = 討伐時間 + 最小湧き間隔
    const nextMinSeconds = killTimeSeconds ? killTimeSeconds + repopSeconds : null;
    
    // 最大湧き時刻 = 討伐時間 + 最大湧き間隔 (Sランクのみ)
    const nextMaxSeconds = (staticMob.rank === 'S' && killTimeSeconds) 
                           ? killTimeSeconds + repopSeconds * 1.5
                           : nextMinSeconds;

    let timeRemaining = null;
    let timerState = 'initial';

    if (killTimeSeconds === null) {
        timerState = 'initial'; // 討伐報告待ち
    } else if (nowSeconds < nextMinSeconds) {
        // 1. 最小湧き時刻前 (Imminent)
        timerState = 'imminent';
        // 残り時間は最小湧きまでの時間
        timeRemaining = nextMinSeconds - nowSeconds; 
    } else if (nowSeconds >= nextMinSeconds && (!nextMaxSeconds || nowSeconds < nextMaxSeconds)) {
        // 2. 最小湧き時刻後、最大湧き時刻前 (Spawned)
        timerState = 'spawned';
        // 経過時間は最小湧きからの経過時間 (マイナス表示にするため)
        timeRemaining = nextMinSeconds - nowSeconds; // 結果はマイナスになる
    } else if (nextMaxSeconds && nowSeconds >= nextMaxSeconds) {
        // 3. 最大湧き時刻後 (Expired)
        timerState = 'expired';
        // 経過時間は最大湧きからの経過時間 (マイナス表示にするため)
        timeRemaining = nextMaxSeconds - nowSeconds; // 結果はマイナスになる
    }

    // 最終的なオブジェクトを構築
    return {
        ...staticMob,
        ...dynamicStatus,
        current_kill_time: killTimeSeconds,
        next_respawn_min: nextMinSeconds,
        next_respawn_max: nextMaxSeconds,
        // UI表示用の計算結果
        time_remaining_seconds: timeRemaining, 
        timer_state: timerState,
    };
};

// --- パブリックインターフェース (API) ---

/**
 * Mobの全データ (静的 + 動的) を取得する。
 * @returns {Object} Mobデータオブジェクト
 */
export const getGlobalMobData = () => {
    return _globalMobData;
};

/**
 * 討伐報告をCloud Functions経由で送信する。
 * @param {string} mobId - MobのID
 * @param {string} memo - 討伐時のメモ
 * @param {string} reporterUID - 報告者のUID
 * @returns {Promise<string>} 報告ID
 */
export const submitHuntReport = async (mobId, memo, reporterUID) => {
    // FunctionsのreportProcessor関数を呼び出し可能な形式で取得
    const reportProcessor = httpsCallable(functions, 'reportProcessor');

    const reportData = {
        mobId: mobId,
        memo: memo,
        reporterUID: reporterUID,
        reportTime: fs.Timestamp.now(), // FirestoreのTimestampを渡す
    };

    const result = await reportProcessor(reportData);
    
    if (result.data && result.data.reportId) {
        return result.data.reportId;
    }
    throw new Error('Report submission failed or returned no ID.');
};

/**
 * 湧き潰し状態を更新する (Sランクのみ)。
 * @param {string} mobId - MobのID
 * @param {string} crushPointId - 湧き潰しポイントのID
 * @param {'add'|'remove'} action - 実行するアクション
 * @returns {Promise<void>}
 */
export const updateCrushStatus = async (mobId, crushPointId, action) => {
    const crushStatusUpdater = httpsCallable(functions, 'crushStatusUpdater');
    
    await crushStatusUpdater({
        mobId: mobId,
        pointId: crushPointId,
        action: action
    });
    
};
