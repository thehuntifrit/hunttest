// Cloud Functions for Firebase - 第2世代 (v2)

const admin = require('firebase-admin');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const logger = require('firebase-functions/logger');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

// Firestore Collection Names
const COLLECTIONS = {
    REPORTS: 'reports',
    MOB_STATUS: 'mob_status',
    MOB_LOCATIONS: 'mob_locations',
    MOB_STATUS_LOGS: 'mob_status_logs',
    MOB_LOCATIONS_LOGS: 'mob_locations_logs'
};

// Functions Configuration
const DEFAULT_REGION = 'asia-northeast1';
const PROJECT_ID = process.env.GCLOUD_PROJECT;
if (!PROJECT_ID) {
    logger.error("GCLOUD_PROJECT環境変数が設定されていません。プロジェクトIDをコード内で定義する必要があります。");
}

// Time Constants
const FIVE_MINUTES_IN_SECONDS = 5 * 60;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
* Mob IDからMOB_STATUSのドキュメントIDを決定します。
*/
const getStatusDocId = (mobId) => {
    if (typeof mobId !== 'string' || mobId.length < 2) return null;
    const rankCode = mobId[1];
    switch (rankCode) {
        case '2': return 's_latest';
        case '1': return 'a_latest';
        case '3': return 'f_latest';
        default: return null;
    }
};

/**
* Mob IDからランク文字を取得します。
*/
const getRankFromMobId = (mobId) => {
    if (typeof mobId !== 'string' || mobId.length < 2) return null;
    const rankCode = mobId[1];
    switch (rankCode) {
        case '2': return 'S';
        case '1': return 'A';
        case '3': return 'F';
        default: return null;
    }
}

// =====================================================================
// 1. reportProcessor: 討伐報告の検証と即時ステータス最終確定（平均化）
// =====================================================================

exports.reportProcessor = onDocumentCreated({
    document: `${COLLECTIONS.REPORTS}/{reportId}`,
    region: DEFAULT_REGION
}, async (event) => {

    const snap = event.data;
    if (!snap) return null;

    const reportRef = snap.ref;
    const reportData = snap.data();

    const {
        mob_id: mobId,
        kill_time: reportTimeData,
        reporter_uid: reporterUID,
        memo: reportMemo,
        repop_seconds: repopSeconds
    } = reportData;

    if (!mobId || !reportTimeData || !repopSeconds) {
        logger.error('SKIP: 必須データが不足。');
        return null;
    }

    const reportTime = reportTimeData.toDate();
    const rank = getRankFromMobId(mobId);
    const statusDocId = getStatusDocId(mobId);

    if (!rank || !statusDocId) {
        logger.error(`SKIP: 無効なMob ID (${mobId})。`);
        return null;
    }

    const rankStatusRef = db.collection(COLLECTIONS.MOB_STATUS).doc(statusDocId);

    let transactionResult = false;
    let existingDataToLog = null;
    let finalUpdateField = {}; // トランザクション外部でログ記録のために使用するフィールド

    try {
        transactionResult = await db.runTransaction(async (t) => {
            const rankStatusSnap = await t.get(rankStatusRef);

            const rankStatusData = rankStatusSnap.data() || {};
            const existingMobData = rankStatusData[`${mobId}`] || {};

            const currentLKT = existingMobData.last_kill_time || null;
            const currentPrevLKT = existingMobData.prev_kill_time || null;
            const reportWindowEndTime = existingMobData.report_window_end_time ?
                existingMobData.report_window_end_time.toDate() : null; // 連続報告受付終了時刻

            let isNewCycle = true;
            let finalReportWindowEndTime = existingMobData.report_window_end_time || null; // 最終的に書き込む report_window_end_time

            // --- 1. 連続報告の判定ロジック ---
            if (reportWindowEndTime) {
                if (reportTime < reportWindowEndTime) {
                    isNewCycle = false;
                }
            }

            // --- 2. 新しい Mob 討伐サイクル開始時の妥当性判定 (isNewCycle = true の場合のみ) ---
            if (isNewCycle) {
                if (currentPrevLKT) {
                    const prevLKTTime = currentPrevLKT.toDate();

                    // (A) 前々回時刻以前の報告はスキップ
                    if (reportTime <= prevLKTTime) {
                        logger.warn(`SKIP: Mob ${mobId} の報告(${reportTime.toISOString()})は前々回討伐時刻以下です。`);
                        return false;
                    }

                    // (B) REPOP-5分よりも早すぎる報告はスキップ (新しいサイクルの厳密な判定)
                    const minAllowedTimeSec = prevLKTTime.getTime() / 1000 + repopSeconds - FIVE_MINUTES_IN_SECONDS;
                    const minAllowedTime = new Date(minAllowedTimeSec * 1000);

                    if (reportTime < minAllowedTime) {
                        logger.warn(`SKIP: Mob ${mobId} の報告はREPOP-5分よりも早すぎます。`);
                        return false;
                    }
                }

                // --- 3. ログ記録の準備 (新しいサイクル開始が認められた場合) ---
                // REPOP判定をクリアした場合のみ、更新前のデータをログ記録用として保持
                existingDataToLog = {
                    mob_id: mobId,
                    // ログに記録する時刻はトランザクション外で付与される
                    last_kill_time: currentLKT || null,
                    prev_kill_time: currentPrevLKT || null,
                    last_kill_memo: existingMobData.last_kill_memo || '',
                    prev_kill_memo: existingMobData.prev_kill_memo || '',
                    report_window_end_time: existingMobData.report_window_end_time || null,
                };
            }

            // --- 平均化ロジックの実行 ---
            // 1. 未処理のすべての報告を取得 
            const reportsQuery = db.collection(COLLECTIONS.REPORTS)
                .where('mob_id', '==', mobId)
                .where('is_averaged', '==', false)
                .orderBy('kill_time', 'asc');

            const reportsSnap = await t.get(reportsQuery);

            if (reportsSnap.empty) {
                logger.warn(`AVG_SKIP_IMMEDIATE: Mob ${mobId} の平均化対象報告なし。`);
                return true;
            }

            // 2. 平均時刻の計算とメモの収集
            let totalTime = 0;
            let memos = [];
            const reportsToUpdate = [];

            reportsSnap.forEach(doc => {
                totalTime += doc.data().kill_time.toMillis();
                reportsToUpdate.push(doc.ref);

                const currentMemo = doc.data().memo;
                if (currentMemo && currentMemo.trim().length > 0) {
                    memos.push(currentMemo.trim());
                }
            });

            const finalAvgTimeMs = totalTime / reportsSnap.size;
            const finalAvgTimestamp = admin.firestore.Timestamp.fromMillis(Math.round(finalAvgTimeMs));
            const finalMemo = memos.join(' / ');

            // 4. report_window_end_time の確定 (初回報告 + 5分で固定)
            if (isNewCycle) {
                const firstReportTimeMs = reportsSnap.docs[0].data().kill_time.toMillis();
                const newWindowEndTimeMs = firstReportTimeMs + FIVE_MINUTES_IN_SECONDS * 1000;
                finalReportWindowEndTime = admin.firestore.Timestamp.fromMillis(newWindowEndTimeMs);

                // 5. Mob Status の最終確定更新
                finalUpdateField = {
                    prev_kill_time: currentLKT || null,
                    prev_kill_memo: existingMobData.last_kill_memo || '',
                    last_kill_time: finalAvgTimestamp, // 計算された平均時刻で更新
                    last_kill_memo: finalMemo,
                    report_window_end_time: finalReportWindowEndTime, // 固定された期間終了時刻を設定
                    is_averaged: true
                };

                t.set(rankStatusRef, { [`${mobId}`]: finalUpdateField }, { merge: true });

                // 6. 平均化に使用したすべての報告のフラグを更新
                reportsToUpdate.forEach(ref => {
                    t.update(ref, { is_averaged: true, is_processed: true });
                });

                return true;
            });

    } catch (e) {
        logger.error(`FATAL_TRANSACTION_FAILURE: Mob ${mobId} のトランザクション失敗: ${e.message}`, e);
        return null;
    }

    // トランザクション結果のチェック
    if (transactionResult !== true) {
        logger.warn(`SKIP_REPORT_COMPLETED: Mob ${mobId} の報告は無効と判断され、スキップ。`);
        return null;
    }

    // --- 7. ログ追記 (新しいサイクル開始時のみ更新前の状態をログに記録) ---
    try {
        if (existingDataToLog && Object.keys(existingDataToLog).length > 0) {
            const logId = `${mobId}_${existingDataToLog.last_kill_time ? existingDataToLog.last_kill_time.toMillis() : '0'}_${admin.firestore.Timestamp.now().toMillis()}`;

            await db.collection(COLLECTIONS.MOB_STATUS_LOGS).doc(logId).set(existingDataToLog);
            logger.info(`LOG_SUCCESS: Mob ${mobId} の更新前ステータスをログに記録しました。`);
        }

        logger.info(`STATUS_UPDATED_FINAL: Mob ${mobId} のステータスを即時平均化により最終確定しました。`);
    } catch (e) {
        logger.error(`LOG_FAILURE: Mob ${mobId} のステータスログ記録失敗: ${e.message}`, e);
    }

    return null;
});

// =====================================================================
// 2. reportCleaner: reportsコレクションから古いデータを削除
// =====================================================================

exports.reportCleaner = onRequest({ region: DEFAULT_REGION }, async (req, res) => {

    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    const now = Date.now();
    const batch = db.batch();
    let deletedCount = 0;

    // 1. Aランク Mob のクリーンアップ: 2日前の報告を削除
    const aRankCutoff = new Date(now - (2 * ONE_DAY_MS));
    const aRankSnaps = await db.collection(COLLECTIONS.REPORTS)
        .where('mob_id', '>=', 't1')
        .where('mob_id', '<', 't2')
        .where('kill_time', '<', aRankCutoff)
        .limit(500)
        .get();

    aRankSnaps.forEach(doc => {
        batch.delete(doc.ref);
        deletedCount++;
    });

    // 2. S/Fランク Mob のクリーンアップ: 7日前の報告を削除
    const sfRankCutoff = new Date(now - (7 * ONE_DAY_MS));

    // Sランク (t2xxx)
    const sRankSnaps = await db.collection(COLLECTIONS.REPORTS)
        .where('mob_id', '>=', 't2')
        .where('mob_id', '<', 't3')
        .where('kill_time', '<', sfRankCutoff)
        .limit(500)
        .get();

    sRankSnaps.forEach(doc => {
        batch.delete(doc.ref);
        deletedCount++;
    });

    // Fランク (t3xxx)
    const fRankSnaps = await db.collection(COLLECTIONS.REPORTS)
        .where('mob_id', '>=', 't3')
        .where('mob_id', '<', 't4')
        .where('kill_time', '<', sfRankCutoff)
        .limit(500)
        .get();

    fRankSnaps.forEach(doc => {
        batch.delete(doc.ref);
        deletedCount++;
    });

    if (deletedCount > 0) {
        await batch.commit();
        logger.info(`CLEANUP_SUCCESS: ${deletedCount} 件の古い報告を削除。`);
    } else {
        logger.info('CLEANUP_INFO: 削除対象なし。');
    }

    return res.status(200).send(`Cleanup finished. Deleted ${deletedCount} reports.`);
});

// =====================================================================
// 3. getServerTime: サーバーの現在UTC時刻を返す (クライアント用)
// =====================================================================

exports.getServerTime = onCall({ region: DEFAULT_REGION }, async (data, context) => {
    const serverTimeMs = admin.firestore.Timestamp.now().toMillis();
    return { serverTimeMs: serverTimeMs };
});


// =====================================================================
// 4. revertStatus: データの巻き戻し処理 (onRequest)
// =====================================================================

exports.revertStatus = onRequest({ region: DEFAULT_REGION }, async (req, res) => {

    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    const mobId = req.body.mob_id;

    if (!mobId) {
        logger.error('INVALID_ARGUMENT: Mob IDが指定されていません。');
        return res.status(400).json({ error: 'Mob IDが指定されていません。' });
    }

    logger.info(`REVERT_REQUEST: Mob ${mobId} の巻き戻しリクエストを受信しました。`);

    // TODO: MOB_STATUS_LOGS および MOB_LOCATIONS_LOGS を使用して
    // MOB_STATUS と MOB_LOCATIONS を巻き戻すロジックを実装する必要があります。

    return res.status(200).json({
        success: true,
        message: `Mob ${mobId} の巻き戻しリクエストを受信しました（ロジックは今後実装予定）。`
    });
});
