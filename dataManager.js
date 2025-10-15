/**
 * dataManager.js - クライアント側 データ管理モジュール
 * 責務: Mob静的データ/Firestoreリアルタイムデータの取得・マージ・状態管理 (Storeパターン)
 */

import { db, functions, firestore as fs } from './firebaseConfig'; // Firebase初期化設定をインポートすると仮定
import { MOB_DATA_JSON_PATH, MOB_LOCATIONS_POINTS_JSON_PATH } from './config'; // 定数ファイルをインポートすると仮定

// --- 内部状態と定数 ---
const COLLECTIONS = {
    REPORTS: 'reports',
    MOB_STATUS: 'mob_status', // a_latest, s_latest, f_latest
    MOB_LOCATIONS: 'mob_locations', // Mob ID
    USERS: 'users',
};

// 内部ストア: Mob IDをキーとする、統合されたMobデータ
let globalMobData = {}; 
let _listeners = []; // 購読者リスト

// Mob IDの2桁目によるランクとドキュメントIDへの変換
const MobRankMap = { '1': 'a', '2': 's', '3': 'f' };

/**
 * Mob IDからMob StatusのドキュメントIDを取得
 * @param {string} mobId - Mob固有の識別番号 (e.g., '62061')
 * @returns {string} latestDocId (e.g., 's_latest')
 */
const getStatusDocId = (mobId) => {
    const rankId = String(mobId).charAt(1); 
    const rank = MobRankMap[rankId] || 'u';
    return `${rank}_latest`;
};

// --- Storeパターン実装 ---

/**
 * 状態変更時に通知するリスナーを登録する
 * @param {Function} callback - 状態変更時に呼び出されるコールバック
 * @returns {Function} 購読解除関数
 */
export const addListener = (callback) => {
    _listeners.push(callback);
    return () => {
        _listeners = _listeners.filter(listener => listener !== callback);
    };
};

/**
 * 全てのリスナーに状態変更を通知する
 */
const _notifyListeners = () => {
    _listeners.forEach(callback => callback());
};

/**
 * 現在の Mob データ全体を返す
 * @returns {Object} globalMobData
 */
export const getGlobalMobData = () => {
    return globalMobData;
};

// --- リアルタイムデータ統合（マージ）ロジック ---

/**
 * Firestore mob_status の変更を globalMobData にマージする (Mob Statusのリアルタイムリスナー)
 * @param {Object} rankStatusData - Mob Status ドキュメント (例: a_latest) 全体
 */
const _mergeStatusData = (rankStatusData) => {
    let changed = false;
    
    // statusData (例: { '62061': {...}, '62062': {...} }) を反復処理
    for (const mobId in rankStatusData) {
        if (globalMobData[mobId]) {
            const newStatus = rankStatusData[mobId];
            
            // prev_kill_time, current_kill_time, memo などを上書き
            globalMobData[mobId] = {
                ...globalMobData[mobId],
                current_kill_time: newStatus.current_kill_time,
                current_kill_memo: newStatus.current_kill_memo,
                prev_kill_time: newStatus.prev_kill_time,
                prev_kill_memo: newStatus.prev_kill_memo,
                current_reporter_uid: newStatus.current_reporter_uid,
            };
            changed = true;
        }
    }
    
    if (changed) {
        _notifyListeners();
    }
};

/**
 * Firestore mob_locations の変更を globalMobData にマージする (Mob Locationsのリアルタイムリスナー)
 * @param {string} mobId - 更新された Mob の ID
 * @param {Object} locationData - Mob Locations ドキュメント全体
 */
const _mergeLocationsData = (mobId, locationData) => {
    if (globalMobData[mobId]) {
        // last_kill_time, delete_after_timestamp, points を上書き
        globalMobData[mobId] = {
            ...globalMobData[mobId],
            last_kill_time: locationData.last_kill_time || null,
            delete_after_timestamp: locationData.delete_after_timestamp || null,
            crush_points: locationData.points || {}, // 湧き潰し状態
        };
        _notifyListeners();
    }
};

// --- 初期化とリスナー設定 ---

/**
 * Mob静的データ（mob_data.json）を読み込む
 * @returns {Promise<Object>} Mob IDをキーとする静的データ
 */
const _loadStaticData = async () => {
    try {
        const response = await fetch(MOB_DATA_JSON_PATH);
        if (!response.ok) throw new Error('Failed to load mob_data.json');
        
        const mobArray = await response.json();
        const mobMap = {};
        
        // Mob IDをキーとするマップに変換し、globalMobDataのベースとする
        mobArray.forEach(mob => {
            const mobId = String(mob.No);
            mobMap[mobId] = {
                id: mobId,
                name: mob.NAME,
                map: mob.MAP,
                repop_seconds: mob.REPOP,
                max_seconds: mob.MAX,
                // ... その他静的データ ...
                current_kill_time: null, // リアルタイムデータ用プレースホルダ
                crush_points: null,
            };
        });
        return mobMap;
    } catch (error) {
        console.error("Error loading static mob data:", error);
        return {};
    }
};

/**
 * Firestoreのリアルタイムリスナーを設定する
 */
const _setupFirestoreListeners = () => {
    // 1. Mob Status リスナー (A, S, FATEの3つのドキュメント)
    ['a_latest', 's_latest', 'f_latest'].forEach(docId => {
        db.collection(COLLECTIONS.MOB_STATUS).doc(docId).onSnapshot(snapshot => {
            if (snapshot.exists) {
                _mergeStatusData(snapshot.data());
            } else {
                // ドキュメントが存在しない場合は空オブジェクトとして処理
                _mergeStatusData({}); 
            }
        }, error => {
            console.error(`Error subscribing to Mob Status ${docId}:`, error);
        });
    });

    // 2. Mob Locations リスナー (Mob IDごとのドキュメント)
    // 注意: 全MobのLocationsリスナーを一括で設定するのは非効率なため、
    // 静的データが読み込まれた後に、Sモブや重要なモブのみを設定するか、
    // または全モブに設定する場合、Firestoreの読み取り回数に注意が必要。
    
    // ここでは、全ての Mob ID を取得し、それらの Location ドキュメントを購読すると仮定
    Object.keys(globalMobData).forEach(mobId => {
        // Mob IDが Locations のキーとして使用されている
        db.collection(COLLECTIONS.MOB_LOCATIONS).doc(mobId).onSnapshot(snapshot => {
            if (snapshot.exists) {
                _mergeLocationsData(mobId, snapshot.data());
            } else {
                // ドキュメントが存在しない場合は空オブジェクトとしてマージ（状態リセット）
                _mergeLocationsData(mobId, {});
            }
        }, error => {
            console.error(`Error subscribing to Mob Locations ${mobId}:`, error);
        });
    });
};

/**
 * dataManagerを初期化し、データロードとリスナー設定を行う
 */
export const initialize = async () => {
    // 1. 静的データロード
    globalMobData = await _loadStaticData();

    // 2. Firestore リスナー設定
    _setupFirestoreListeners(); 

    // 初期通知 (静的データと初回Firestore読み込み後)
    _notifyListeners(); 
};

// --- サーバー連携（書き込み）ロジック ---

/**
 * 討伐報告を Firestore に書き込む
 * @param {string} mobId 報告対象のMob ID
 * @param {string} memo 任意のメモ
 * @param {string} reporterUID 報告者のFirebase UID
 * @returns {Promise<string>} Reports ID
 */
export const submitHuntReport = async (mobId, memo, reporterUID) => {
    const mobData = globalMobData[mobId];
    if (!mobData) {
        throw new Error(`Mob ID ${mobId} not found in static data.`);
    }

    // Reports スキーマに合わせてデータを整形
    const reportData = {
        mob_id: String(mobId), // Mob ID
        kill_time: fs.Timestamp.now(), // Firestore Timestamp
        reporter_uid: reporterUID, 
        memo: memo,
        // サーバー側検証に必須のデータ
        repop_seconds: mobData.repop_seconds, 
        // max_seconds はサーバー検証には不要だが、Reportsに含めても問題はない（現在のサーバー仕様には影響しない）
        max_seconds: mobData.max_seconds, 
    };

    try {
        const docRef = await db.collection(COLLECTIONS.REPORTS).add(reportData);
        return docRef.id;
    } catch (error) {
        console.error("Error submitting hunt report:", error);
        throw new Error("Failed to submit hunt report to server.");
    }
};

/**
 * 湧き潰し状態の更新をサーバーに送信する (HTTPS Callable)
 * @param {string} mobId SモブID
 * @param {string} pointId 湧き潰しポイントID
 * @param {'add'|'remove'} action アクション
 * @returns {Promise<void>}
 */
export const updateCrushStatus = async (mobId, pointId, action) => {
    const updateCrushStatusCallable = functions.httpsCallable('updateCrushStatus');
    
    try {
        await updateCrushStatusCallable({ 
            mob_id: mobId, 
            point: { id: pointId }, // サーバー仕様に合わせて ID のみ送信
            action: action 
        });
    } catch (error) {
        console.error("Error calling updateCrushStatus:", error);
        throw new Error("Failed to update crush status on server.");
    }
};

// --- クライアント側計算ロジック ---

/**
 * 現在の討伐時刻に基づき、次の最小/最大リポップ時刻を計算する
 * @param {string} mobId - Mob ID
 * @returns {{min: Date, max: Date}} 予測湧き時刻オブジェクト
 */
export const calculateNextSpawn = (mobId) => {
    const mobData = globalMobData[mobId];
    
    if (!mobData || !mobData.current_kill_time || !mobData.repop_seconds || !mobData.max_seconds) {
        return { min: null, max: null };
    }

    const killTimeMs = mobData.current_kill_time.toMillis();
    const repopSec = mobData.repop_seconds;
    const maxSec = mobData.max_seconds;

    const minSpawnMs = killTimeMs + (repopSec * 1000);
    const maxSpawnMs = killTimeMs + (maxSec * 1000);

    return { 
        min: new Date(minSpawnMs), 
        max: new Date(maxSpawnMs) 
    };
};

// --- その他（必要に応じて追加） ---

// mob_locations の湧き潰しポイント情報 (x, y座標) は静的データとして
// クライアント側でのみ保持されるため、_loadStaticData() の中で処理するか、
// 別途読み込む必要があります。ここでは JSON_PATH が別の場所にあると仮定し、
// 必要に応じて globalMobData に統合するものとします。

/*
// 例: Mob Locationsの静的データをロードし、globalMobDataに統合する関数
const _loadLocationPoints = async () => { ... }; 
*/
