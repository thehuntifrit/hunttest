// =====================================================================
// Cloud Functions for Firebase - 第2世代 (v2) スタイル
// =====================================================================

const admin = require('firebase-admin');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onRequest, onCall } = require('firebase-functions/v2/https'); 
admin.initializeApp();

const db = admin.firestore();

// Firestoreコレクションの定数
const COLLECTIONS = {
    REPORTS: 'reports',
    MOB_STATUS: 'mob_status',
    MOB_LOCATIONS: 'mob_locations',
    MOB_LOGS: 'mob_logs' 
};

const DEFAULT_REGION = 'asia-northeast2'; 

// Cloud Tasksの設定 (GCP_PROJECTを固定値に修正)
const TASK_QUEUE_CONFIG = {
    project: 'the-hunt-49493', 
    location: DEFAULT_REGION, 
    queue: 'mob-report-queue' 
};

// 平均化の窓
const AVG_WINDOW_MS = 10 * 60 * 1000; 
const AVG_WINDOW_HALF_MS = AVG_WINDOW_MS / 2; 
const FIVE_MINUTES_IN_SECONDS = 5 * 60; 

/**
 * Mob ID (文字列 e.g., '42042') から Mob Status ドキュメントIDに変換する。
 * Mob IDの2文字目 (インデックス1、千の位) をランクコードとして使用。
 * 1: Aランク (a_latest), 2: Sランク (s_latest), 3: FATEランク (f_latest)
 * @param {string} mobId - MobのID (e.g., '42042')
 * @returns {string | null} Mob Status ドキュメントID ('s_latest', 'a_latest', 'f_latest') または null
 */
const getStatusDocId = (mobId) => {
    if (typeof mobId !== 'string' || mobId.length < 2) {
        return null;
    }
    
    // 2文字目 (インデックス1) を取得（これが千の位に相当）
    const rankCode = mobId[1]; 

    switch (rankCode) {
        case '2': return 's_latest';  // Sランク
        case '1': return 'a_latest';  // Aランク
        case '3': return 'f_latest';  // FATEランク
        default: return null; 
    }
};

/**
 * Mob ID (文字列 e.g., '42042') からランクコード (S, A, F) を取得する。
 * Mob IDの2文字目 (インデックス1、千の位) をランクコードとして使用。
 * @param {string} mobId - MobのID (e.g., '42042')
 * @returns {string | null} ランクコード ('S', 'A', 'F') または null
 */
const getRankFromMobId = (mobId) => {
    if (typeof mobId !== 'string' || mobId.length < 2) {
        return null;
    }
    const rankCode = mobId[1]; 

    switch (rankCode) {
        case '2': return 'S';
        case '1': return 'A';
        case '3': return 'F';
        default: return null; 
    }
}


/**
 * 討伐報告を受け付け、Mob Statusを即時更新し、平均化タスクをキューイングする。
 */
exports.reportProcessor = onDocumentCreated({
    document: `${COLLECTIONS.REPORTS}/{reportId}`,
    region: DEFAULT_REGION 
}, async (event) => {
    
    const tasksClient = require('@google-cloud/tasks').v2;
    const taskQueue = new tasksClient.CloudTasksClient();

    const snap = event.data;
    if (!snap) return null;
    
    const reportData = snap.data();
    
    const {
        mob_id: mobId,
        kill_time: reportTimeData, 
        reporter_uid: reporterUID,
        memo: reportMemo,
        repop_seconds: repopSeconds 
    } = reportData;

    // 必須データの検証
    if (!mobId || !reportTimeData || !repopSeconds) {
        console.error('SKIP: 必須データ（mob_id, kill_time, repop_seconds）が不足しています。');
        return null;
    }

    const rank = getRankFromMobId(mobId);
    const statusDocId = getStatusDocId(mobId);

    if (!rank || !statusDocId) {
        console.error(`SKIP: 無効なMob ID (${mobId}) またはランクが特定できません。解析コード: ${mobId[1]}`);
        return null;
    }

    const reportTimestamp = reportTimeData;
    const reportTime = reportTimestamp.toDate();
    const rankStatusRef = db.collection(COLLECTIONS.MOB_STATUS).doc(statusDocId);

    // トランザクション処理の開始
    await db.runTransaction(async (t) => {
        // --- 必要なスナップショットをトランザクション内で取得 ---
        const rankStatusSnap = await t.get(rankStatusRef);
        const mobLocationsRef = db.collection(COLLECTIONS.MOB_LOCATIONS).doc(mobId);
        const mobLocationsSnap = await t.get(mobLocationsRef); // ★ Mob Locationsを取得

        const rankStatusData = rankStatusSnap.data() || {};
        const locationsData = mobLocationsSnap.data() || {}; // ★ Mob Locationsのデータ
        
        // mobIdをキーとして既存のLKT/PrevLKTを取得
        const existingMobData = rankStatusData[mobId] || {};
        const crushSnapshot = locationsData.points || {}; // ★ 湧き潰しポイントのスナップショットを抽出

        // --- 以下、既存の処理 ---
        
        const currentLKT = existingMobData.last_kill_time || null;
        const currentPrevLKT = existingMobData.prev_kill_time || null;

        const prevLKTTime = currentPrevLKT ? currentPrevLKT.toDate() : new Date(0);
        
        // 1. 過去時刻巻き戻し保護
        if (reportTime <= prevLKTTime) {
            console.warn(`SKIP: Mob ${mobId} の報告(${reportTime.toISOString()})は前々回討伐時刻(${prevLKTTime.toISOString()})以下です。`);
            return;
        }

        // 2. 最小湧き時間（REPOP）検証
        const minAllowedTimeSec = prevLKTTime.getTime() / 1000 + repopSeconds - FIVE_MINUTES_IN_SECONDS;
        const minAllowedTime = new Date(minAllowedTimeSec * 1000);

        if (reportTime < minAllowedTime) {
            console.warn(`SKIP: Mob ${mobId} の報告はREPOP-5分(${minAllowedTime.toISOString()})よりも早すぎます。`);
            return;
        }
        
        // 3. 3ドキュメント方式のMob Status データ更新
        const updateField = {
            prev_kill_time: currentLKT, 
            prev_kill_memo: existingMobData.last_kill_memo || '',
            last_kill_time: reportTimestamp,
            last_kill_memo: reportMemo,
            current_reporter_uid: reporterUID,
        };
        
        // 4. Mob Status の更新
        t.update(rankStatusRef, {
            [`${mobId}`]: updateField
        });


        // 5. Mob Locations への同期（Sモブのみ）
        if (rank === 'S') {
            const deleteAfterSec = reportTime.getTime() / 1000 + (7 * 24 * 3600);
            
            t.set(mobLocationsRef, { 
                delete_after_timestamp: admin.firestore.Timestamp.fromMillis(deleteAfterSec * 1000), 
                last_kill_time: reportTimestamp, 
                prev_kill_time: currentLKT, 
            }, { merge: true });
        }

        // ログ記録（平均化処理用）
        const mobLogRef = db.collection(COLLECTIONS.MOB_LOGS).doc();
        t.set(mobLogRef, {
            mob_id: mobId,
            kill_time: reportTimestamp,
            reporter_uid: reporterUID,
            processed: false,
            rank: rank,
            crush_snapshot: crushSnapshot, // ★ 湧き潰しスナップショットを追加
        });

        // Cloud Task のキューイング (変更なし)
        const taskName = `${mobId}_avg_${reportTime.getTime()}`;
        const url = `https://${TASK_QUEUE_CONFIG.location}-${TASK_QUEUE_CONFIG.project}.cloudfunctions.net/averageStatusCalculator`; 
        const payload = {
            mobId: mobId,
            initialReportTime: reportTime.toISOString(),
            rank: rank
        };

        const task = {
            httpRequest: {
                httpMethod: 'POST',
                url,
                body: Buffer.from(JSON.stringify(payload)).toString('base64'),
                headers: { 'Content-Type': 'application/json' },
            },
            scheduleTime: {
                seconds: reportTime.getTime() / 1000 + AVG_WINDOW_HALF_MS / 1000 
            },
            name: taskQueue.taskPath(
                TASK_QUEUE_CONFIG.project, 
                TASK_QUEUE_CONFIG.location, 
                TASK_QUEUE_CONFIG.queue, 
                taskName
            )
        };
        
        await taskQueue.createTask({
            parent: taskQueue.queuePath(
                TASK_QUEUE_CONFIG.project, 
                TASK_QUEUE_CONFIG.location, 
                TASK_QUEUE_CONFIG.queue
            ),
            task,
        });

    }); 

    return null;
});

/**
 * Cloud Tasksから呼び出され、最初の報告時刻を中心とした10分間の討伐ログを平均化する。
 */
exports.averageStatusCalculator = onRequest({ region: DEFAULT_REGION }, async (req, res) => {
    
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    const { mobId, initialReportTime, rank } = req.body; 
    
    if (!mobId || !initialReportTime || !rank) {
        return res.status(400).send('Missing mobId, initialReportTime, or rank in request body.');
    }

    const centerTime = new Date(initialReportTime);
    
    // 検索窓の決定
    const startTime = new Date(centerTime.getTime() - AVG_WINDOW_HALF_MS);
    const endTime = new Date(centerTime.getTime() + AVG_WINDOW_HALF_MS);

    // ログの取得（平均化窓内のログを検索）
    const logsSnap = await db.collection(COLLECTIONS.MOB_LOGS)
        .where('mob_id', '==', mobId)
        .where('kill_time', '>=', startTime)
        .where('kill_time', '<=', endTime)
        .get();

    if (logsSnap.empty) {
        console.log(`平均化ログなし Mob ID: ${mobId}`);
        return res.status(200).send('No logs to average.');
    }

    // 平均時刻の計算
    let totalTime = 0;
    logsSnap.forEach(doc => {
        totalTime += doc.data().kill_time.toMillis();
    });
    const avgTimeMs = totalTime / logsSnap.size;
    const avgTimestamp = admin.firestore.Timestamp.fromMillis(avgTimeMs);
    const avgTime = avgTimestamp.toDate();
    
    // Mob IDからドキュメントIDを再取得
    const statusDocId = getStatusDocId(mobId); 
    if (!statusDocId) {
        console.error(`SKIP(AVG): Mob ID (${mobId}) からランクドキュメントを特定できません。解析コード: ${mobId[1]}`);
        return res.status(400).send('Invalid mobId.');
    }
    const rankStatusRef = db.collection(COLLECTIONS.MOB_STATUS).doc(statusDocId);

    // 最終更新処理をトランザクションで実行
    await db.runTransaction(async (t) => {
        const rankStatusSnap = await t.get(rankStatusRef);
        const rankStatusData = rankStatusSnap.data() || {};

        const existingMobData = rankStatusData[mobId] || {};
        const currentPrevLKT = existingMobData.prev_kill_time || null;
        const prevLKTTime = currentPrevLKT ? currentPrevLKT.toDate() : new Date(0);
        
        // 1. 過去時刻巻き戻し保護
        if (avgTime <= prevLKTTime) {
            console.warn(`SKIP(AVG): 平均時刻(${avgTime.toISOString()})は前々回討伐時刻(${prevLKTTime.toISOString()})以下です。`);
            return;
        }

        // 2. Mob Status の更新（LKTのみを平均時刻に更新）
        const newMobData = {
            ...existingMobData,
            last_kill_time: avgTimestamp,
        };
        
        t.update(rankStatusRef, {
            [`${mobId}`]: newMobData
        });

        // 3. Mob Locations への同期 (Sモブのみ)
        if (rank === 'S') {
            const mobLocationsRef = db.collection(COLLECTIONS.MOB_LOCATIONS).doc(mobId);
            t.update(mobLocationsRef, {
                last_kill_time: avgTimestamp,
            });
        }

        // 4. ログを processed: true に更新
        logsSnap.docs.forEach(doc => {
            t.update(doc.ref, { processed: true });
        });
    });

    return res.status(200).send(`Averaged status updated for Mob ID: ${mobId}`);
});

/**
 * 湧き潰し座標の状態を更新する
 */
exports.crushStatusUpdater = onCall({ region: DEFAULT_REGION }, async (request) => {
    
    const functions = require('firebase-functions');
    
    if (!request.auth) {
        throw new functions.https.HttpsError('unauthenticated', '認証が必要です。');
    }
    
    const data = request.data;
    const { mob_id: mobId, point_id: pointId, type } = data; 
    const nowTimestamp = admin.firestore.Timestamp.now();

    if (!mobId || !pointId || (type !== 'add' && type !== 'remove')) {
        throw new functions.https.HttpsError('invalid-argument', '必須データ（mob_id, point_id, type）が不足しています。');
    }

    const mobLocationsRef = db.collection(COLLECTIONS.MOB_LOCATIONS).doc(mobId);
    
    await db.runTransaction(async (t) => {
        t.update(mobLocationsRef, { 
            [`points.${pointId}.${(type === 'add' ? 'crushed_at' : 'uncrushed_at')}`]: nowTimestamp 
        });
    });

    return { success: true, message: `Point ${pointId} crush status updated to ${type}.` };
});
