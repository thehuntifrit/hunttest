const admin = require('firebase-admin');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onTaskDispatched } = require('firebase-functions/v2/tasks');
const { onCall } = require('firebase-functions/v2/https');
const { getFunctions } = require('firebase-admin/functions');

admin.initializeApp();

const db = admin.firestore();

const COLLECTIONS = {
    REPORTS: 'reports',
    MOB_STATUS: 'mob_status',
    MOB_LOCATIONS: 'mob_locations',
    MOB_STATUS_LOG: 'mob_status_log',
    MOB_LOCATIONS_LOG: 'mob_locations_log',
    MOB_DEFINITIONS: 'mob_definitions',
};

const DEFAULT_REGION = 'asia-northeast2';

const TASK_QUEUE_CONFIG = {
    queue: 'mob-report-queue'
};

const AVERAGE_WINDOW_MIN = 5;
const AVG_WINDOW_HALF_MS = AVERAGE_WINDOW_MIN * 60 * 1000;
const FIVE_MINUTES_IN_SECONDS = 5 * 60;

/**
 * モブのランクに基づいて討伐報告ドキュメントの生存時間（TTL）を計算します。
 * @param {string} rank モブのランク（'S', 'A', 'F'）
 * @returns {number} TTL期間（ミリ秒）
 */
function getTtlMs(rank) {
    if (rank === 'A') return 2 * 24 * 60 * 60 * 1000;
    return 7 * 24 * 60 * 60 * 1000;
}

/**
 * モブID文字列（例: '42042'）をモブステータスドキュメントIDに変換します。
 * @param {string} mobId - モブID（例: '42042'）
 * @returns {string | null} モブステータスドキュメントID（'s_latest', 'a_latest', 'f_latest'）または null
 */
const getStatusDocId = (mobId) => {
    if (typeof mobId !== 'string' || mobId.length < 2) {
        return null;
    }
    const rankCode = mobId[1];
    switch (rankCode) {
        case '2': return 's_latest';
        case '1': return 'a_latest';
        case '3': return 'f_latest';
        default: return null;
    }
};

/**
 * モブID文字列（例: '42042'）からランクコード（S, A, F）を取得します。
 * @param {string} mobId - モブID（例: '42042'）
 * @returns {string | null} ランクコード（'S', 'A', 'F'）または null
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


// ====================================================================
// reportProcessor: 討伐報告を受け付け、即時Mob Statusを更新し、平均化タスクをキューイング
// ====================================================================

/**
 * 討伐報告を処理し、Mobステータスを即時更新し、平均化タスクをキューイングします。
 */
exports.reportProcessor = onDocumentCreated({
    document: `${COLLECTIONS.REPORTS}/{reportId}`,
    region: DEFAULT_REGION
}, async (event) => {

    const snap = event.data;
    if (!snap) return null;

    const reportData = snap.data();

    const {
        mob_id: mobId,
        kill_time: reportTimeData,
        reporter_uid: reporterUID,
        memo: reportMemo,
        repop_seconds: repopSeconds,
    } = reportData;

    // 必須データ（mob_id, kill_time, repop_seconds）を検証します。
    if (!mobId || !reportTimeData || repopSeconds === undefined || repopSeconds === null) {
        console.error('SKIP: 必須データ（mob_id, kill_time, repop_seconds）が不足しています。');
        return null;
    }

    const rank = getRankFromMobId(mobId);
    const statusDocId = getStatusDocId(mobId);

    if (!rank || !statusDocId) {
        console.error(`SKIP: 無効なMob ID (${mobId}) またはランクが特定できません。`);
        return null;
    }

    const reportTimestamp = reportTimeData;
    const reportTime = reportTimestamp.toDate();
    const rankStatusRef = db.collection(COLLECTIONS.MOB_STATUS).doc(statusDocId);
    const mobStatusLogRef = db.collection(COLLECTIONS.MOB_STATUS_LOG).doc(mobId);
    const mobLocationsLogRef = db.collection(COLLECTIONS.MOB_LOCATIONS_LOG).doc(mobId);

    const repopMinSeconds = repopSeconds;
    const repopMinTimeMs = repopMinSeconds * 1000;

    // mob_statusの即時更新とロギングのためのトランザクション
    try {
        await db.runTransaction(async (t) => {
            const rankStatusSnap = await t.get(rankStatusRef);
            const mobLocationsRef = db.collection(COLLECTIONS.MOB_LOCATIONS).doc(mobId);
            const mobLocationsSnap = await t.get(mobLocationsRef);

            const rankStatusData = rankStatusSnap.data() || {};
            const locationsData = mobLocationsSnap.data() || {};

            const existingMobData = rankStatusData[mobId] || {};
            const currentLKT = existingMobData.last_kill_time || null;
            const currentPrevLKT = existingMobData.prev_kill_time || null;

            const currentLKTTime = currentLKT ? currentLKT.toDate() : new Date(0);
            const prevLKTTime = currentPrevLKT ? currentPrevLKT.toDate() : new Date(0);

            let isUpdateValid = false;
            let logMemo = existingMobData.last_kill_memo || '';

            // リポップ時間の検証
            if (currentLKT) {
                const timeDiff = reportTime.getTime() - currentLKTTime.getTime();

                // LKT巻き戻し（PrevLKTより古い報告）をチェック
                if (reportTime <= prevLKTTime) {
                     console.warn(`[Mob ${mobId}] LKT巻き戻しを検知。更新をスキップし、ログのみ記録します。報告時間: ${reportTime.toISOString()}`);
                }
                // 最小リポップ時間をチェック
                else if (timeDiff < repopMinTimeMs) {
                    const minRepopHours = (repopMinSeconds / 3600).toFixed(1);
                    console.warn(`[Mob ${mobId}] 報告時間が短すぎます。更新をスキップします。LKT: ${currentLKTTime.toISOString()}, New Report: ${reportTime.toISOString()}, Min Repop: ${minRepopHours} hours.`);
                }
                else if (reportTime.getTime() > currentLKTTime.getTime()) {
                    isUpdateValid = true;
                    console.log(`[Mob ${mobId}] mob_statusを即時更新します。`);
                }
            } else {
                isUpdateValid = true;
                console.log(`[Mob ${mobId}] 初回報告としてmob_statusを更新します。`);
            }

            if (isUpdateValid) {
                const newMobData = {
                    prev_kill_time: currentLKT,
                    prev_kill_memo: existingMobData.last_kill_memo || '',
                    last_kill_time: reportTimestamp,
                    last_kill_memo: reportMemo,
                    current_reporter_uid: reporterUID,
                };

                t.update(rankStatusRef, { [mobId]: newMobData });
                logMemo = newMobData.last_kill_memo;
            }

            // Mobステータスをログに記録（巻き戻し保護のため）
            t.set(mobStatusLogRef, {
                last_kill_time: reportTimestamp,
                prev_kill_time: currentLKT,
                memo: logMemo,
                last_reported_at: admin.firestore.FieldValue.serverTimestamp(),
                last_report_id: snap.id,
            }, { merge: true });

            // Mob位置のスナップショットをログに記録（Sランクのみ）
            if (rank === 'S') {
                t.set(mobLocationsLogRef, {
                    locations_snapshot: locationsData.points || {},
                    reported_at: admin.firestore.FieldValue.serverTimestamp(),
                    report_id: snap.id,
                }, { merge: true });
            }
        });

        // Cloud TasksのキューイングとTTL設定
        const functions = getFunctions();
        const queue = functions.taskQueue(TASK_QUEUE_CONFIG.queue, DEFAULT_REGION);

        const ttlMs = getTtlMs(rank);
        const deleteAt = new Date(reportTime.getTime() + ttlMs);

        await snap.ref.update({
            delete_at_date: admin.firestore.Timestamp.fromDate(deleteAt),
            is_averaged: false,
        });

        const scheduleTimeMs = reportTime.getTime() + AVG_WINDOW_HALF_MS;
        const scheduleTime = new Date(scheduleTimeMs);

        await queue.enqueue({
            data: { mobId, rank, initialReportTime: reportTime.getTime() },
            scheduleTime: scheduleTime,
        });
        console.log(`Cloud Task queued for Mob ${mobId} (Report ID: ${snap.id}) at ${scheduleTime.toISOString()}`);

    } catch (error) {
        console.error(`[Mob ${mobId}] reportProcessor トランザクション失敗 (reports ID: ${snap.id})`, error);
        throw error;
    }
    return null;
});

// ====================================================================
// averageStatusCalculator: キューから呼び出され、平均討伐時間を算出
// ====================================================================

/**
 * ウィンドウ内の平均討伐時間を計算するCloud Taskエンドポイント。
 * @type {CloudFunction<{ mobId: string, rank: string, initialReportTime: number }>}
 */
exports.averageStatusCalculator = onTaskDispatched({
    queue: TASK_QUEUE_CONFIG.queue,
    region: DEFAULT_REGION
}, async (request) => {

    const { mobId, rank, initialReportTime } = request.data;
    const centerTime = new Date(initialReportTime);
    const mobStatusRef = db.collection(COLLECTIONS.MOB_STATUS).doc(getStatusDocId(mobId));

    const startTime = new Date(centerTime.getTime() - AVG_WINDOW_HALF_MS);
    const endTime = new Date(centerTime.getTime() + AVG_WINDOW_HALF_MS);

    // ウィンドウ内の未平均化報告をクエリ
    const reportsQuerySnap = await db.collection(COLLECTIONS.REPORTS)
        .where('mob_id', '==', parseInt(mobId, 10))
        .where('is_averaged', '==', false)
        .where('kill_time', '>=', admin.firestore.Timestamp.fromDate(startTime))
        .where('kill_time', '<=', admin.firestore.Timestamp.fromDate(endTime))
        .get();

    if (reportsQuerySnap.empty) {
        console.log(`[Mob ${mobId}] このウィンドウの未平均化報告は見つかりませんでした。`);
        return;
    }

    // 平均時間を計算
    let totalTime = 0;
    reportsQuerySnap.docs.forEach(doc => {
        totalTime += doc.data().kill_time.toMillis();
    });
    const avgTimeMs = totalTime / reportsQuerySnap.size;
    const avgTimestamp = admin.firestore.Timestamp.fromMillis(avgTimeMs);
    const avgTime = avgTimestamp.toDate();

    await db.runTransaction(async (t) => {
        const rankStatusSnap = await t.get(mobStatusRef);
        const rankStatusData = rankStatusSnap.data() || {};
        const existingMobData = rankStatusSnap.data()[mobId] || {};

        const currentLKT = existingMobData.last_kill_time || null;
        const newPrevLKT = currentLKT;

        // 過去時刻巻き戻し保護（PrevLKTに対する）
        const prevLKTTime = existingMobData.prev_kill_time ? existingMobData.prev_kill_time.toDate() : new Date(0);
        if (avgTime <= prevLKTTime) {
             console.warn(`SKIP(AVG): 平均時刻 (${avgTime.toISOString()}) はPrevLKT (${prevLKTTime.toISOString()}) より古いです。`);
             return;
        }

        // 平均化されたLKTでMobステータスを更新
        const newMobData = {
            ...existingMobData,
            last_kill_time: avgTimestamp,
            prev_kill_time: newPrevLKT,
        };

        t.update(mobStatusRef, {
            [`${mobId}`]: newMobData
        });

        // 報告を平均化済みとしてマーク
        reportsQuerySnap.docs.forEach(doc => {
            t.update(doc.ref, { is_averaged: true });
        });

        console.log(`[Mob ${mobId}] 最終LKTを平均 ${avgTime.toISOString()} に設定。${reportsQuerySnap.size}件の報告を処理済み。`);
    });
});

// ====================================================================
// crushStatusUpdater: 湧き潰し座標の状態を更新
// ====================================================================

/**
 * モブ位置の湧き潰しステータスを更新します。
 * @returns {Object} 成功メッセージ
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

    // Sランクのみの検証
    if (getRankFromMobId(mobId) !== 'S') {
         throw new functions.https.HttpsError('invalid-argument', '湧き潰しポイントの更新はSランクモブでのみ許可されています。');
    }

    const mobLocationsRef = db.collection(COLLECTIONS.MOB_LOCATIONS).doc(mobId);

    // ネストされたフィールドを更新するためにドット記法を使用（例: points.LM_101.crushed_at）
    const updateFieldKey = `points.${pointId}.${(type === 'add' ? 'crushed_at' : 'uncrushed_at')}`;

    await db.runTransaction(async (t) => {
        const mobLocationsSnap = await t.get(mobLocationsRef);

        if (!mobLocationsSnap.exists) {
            const newPointData = {
                points: {
                    [pointId]: {
                        [type === 'add' ? 'crushed_at' : 'uncrushed_at']: nowTimestamp
                    }
                }
            };
            t.set(mobLocationsRef, newPointData, { merge: true });
        } else {
            t.update(mobLocationsRef, {
                [updateFieldKey]: nowTimestamp
            });
        }
    });

    return { success: true, message: `Point ${pointId} crush status updated to ${type}.` };
});
