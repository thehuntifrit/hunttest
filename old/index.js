/**
 * FF14 Hunt Tracker - Firebase Cloud Functions (index.js) v2
 */
const admin = require('firebase-admin');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onTaskDispatched } = require('firebase-functions/v2/tasks');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFunctions } = require('firebase-admin/functions');

admin.initializeApp();
const db = admin.firestore();

// --- 1. 定数とコレクション定義 ---------------------------------------------------
const DEFAULT_REGION = 'asia-northeast2';
const TASK_QUEUE_CONFIG = {
    queue: 'mob-averaging-queue-new',
    region: DEFAULT_REGION,
};

const COLLECTIONS = {
    REPORTS: 'reports',
    MOB_STATUS: 'mob_status', // docId: a_latest, s_latest, f_latest
    MOB_LOCATIONS: 'mob_locations', // docId: mobId (e.g., '62061')
    MOB_STATUS_LOG: 'mob_status_logs',
    MOB_LOCATIONS_LOG: 'mob_locations_logs',
    USERS: 'users',
};

const REPORT_GRACE_PERIOD_SEC = 5 * 60;
const AVERAGE_WINDOW_SEC = 5 * 60;
const AVERAGE_TASK_DELAY_SEC = 10 * 60;

const MobRankMap = { '1': 'a', '2': 's', '3': 'f' };

const LOCATION_EXPIRY_MS = {
    '1': 48 * 60 * 60 * 1000,
    '2': 168 * 60 * 60 * 1000,
    '3': 168 * 60 * 60 * 1000,
};

// --- 2. ユーティリティ関数 --------------------------------------------------

/**
 * Mob IDからランク、ステータスドキュメントID、ログドキュメントIDを取得
 */
const getMobMetadata = (mobId) => {
    const mobStr = String(mobId);
    const rankId = mobStr.charAt(1); 
    const rank = MobRankMap[rankId] || 'u';
    
    const latestDocId = `${rank}_latest`; 
    const logDocId = mobStr;

    return { rankId, rank: rank.toUpperCase(), latestDocId, logDocId };
};

/**
 * Firestore users/{uid} を参照し、character_name を返す
 */
const getReporterName = async (reporterUID) => {
    if (!reporterUID) return '名無し';
    
    try {
        const doc = await db.collection(COLLECTIONS.USERS).doc(reporterUID).get();
        if (doc.exists) {
            return doc.data().character_name || '名無し';
        }
    } catch (error) {
        console.warn(`Failed to fetch reporter name for ${reporterUID}: ${error.message}`);
    }
    return '名無し';
};

// --- 3. Cloud Functions (コアロジック) ---------------------------------------

/**
 * 3.1 reportProcessor: 討伐報告を受け付け、即時更新し、平均化タスクをキューイング
 * トリガー: Firestore reports/{reportId} onCreate (v2)
 */
exports.reportProcessor = onDocumentCreated({
    document: `${COLLECTIONS.REPORTS}/{reportId}`,
    region: DEFAULT_REGION
}, async (event) => {
    const snap = event.data;
    if (!snap) return null;

    const reportData = snap.data();
    const reportId = snap.id;

    const {
        mob_id: mobId,
        kill_time: killTime,
        reporter_uid: reporterUID,
        memo: reportMemo,
        repop_seconds: mobRepopSec,
    } = reportData;

    if (!mobId || !killTime || !mobRepopSec) {
        console.error('SKIP: 必須データが不足しています。');
        return null;
    }

    const mobStr = String(mobId);
    const { rankId, latestDocId, logDocId } = getMobMetadata(mobStr);

    if (!LOCATION_EXPIRY_MS[rankId]) {
        console.error(`SKIP: 無効なMob ID (${mobId}) またはランクが特定できません。`);
        return null;
    }
    
    const reportTimestamp = killTime.toMillis() / 1000;
    const reporterName = await getReporterName(reporterUID);
    const finalMemo = `[${reporterName}] ${reportMemo}`;

    try {
        await db.runTransaction(async (t) => {
            const mobStatusRef = db.collection(COLLECTIONS.MOB_STATUS).doc(latestDocId);
            const mobLocationsRef = db.collection(COLLECTIONS.MOB_LOCATIONS).doc(logDocId); 
            
            const mobStatusDoc = await t.get(mobStatusRef);
            const mobLocationsDoc = await t.get(mobLocationsRef);

            const now = admin.firestore.Timestamp.now();
            const existingStatusData = mobStatusDoc.exists ? mobStatusDoc.data() : {};
            const existingMobStatus = existingStatusData[mobStr] || {}; 
            
            const prevKillTimeSec = existingMobStatus.prev_kill_time ? existingMobStatus.prev_kill_time.toMillis() / 1000 : 0;
            const currentKillTimeSec = existingMobStatus.current_kill_time ? existingMobStatus.current_kill_time.toMillis() / 1000 : 0;
            
            // REPOP期間の検証
            const minAllowedTimeSec = prevKillTimeSec + mobRepopSec - REPORT_GRACE_PERIOD_SEC;
            
            if (prevKillTimeSec !== 0 && reportTimestamp < minAllowedTimeSec) {
                console.warn(`[REJECTED] Report ID ${reportId} is too early.`);
                return;
            }

            // 古い報告の検証
            if (reportTimestamp < currentKillTimeSec) {
                console.warn(`[REJECTED] Report ID ${reportId} is older than current status.`);
                return;
            }

            // --- ログ記録 ---
            const logEntry = { timestamp: now, report_id: reportId };

            if (existingMobStatus.current_kill_time) {
                 const statusLogRef = db.collection(COLLECTIONS.MOB_STATUS_LOG).doc(logDocId); 
                 t.set(statusLogRef, { logs: admin.firestore.FieldValue.arrayUnion({ ...logEntry, data: existingMobStatus }) }, { merge: true });
            }

            const hasLocationsData = mobLocationsDoc.exists && mobLocationsDoc.data().points && Object.keys(mobLocationsDoc.data().points).length > 0;
            if (hasLocationsData) {
                const locationsLogRef = db.collection(COLLECTIONS.MOB_LOCATIONS_LOG).doc(logDocId); 
                t.set(locationsLogRef, { logs: admin.firestore.FieldValue.arrayUnion({ ...logEntry, data: mobLocationsDoc.data() }) }, { merge: true });
            }
            // ----------------

            // mob_status への初回リアルタイム更新
            const newMobStatusField = {
                current_kill_time: killTime,
                current_kill_memo: finalMemo,
                current_reporter_uid: reporterUID,
                prev_kill_time: existingMobStatus.current_kill_time || admin.firestore.Timestamp.fromMillis(0),
                prev_kill_memo: existingMobStatus.current_kill_memo || '',
                last_report_id: reportId,
            };

            // t.update()を t.set(..., { merge: true }) に修正
            t.set(mobStatusRef, { [mobStr]: newMobStatusField }, { merge: true }); 

            // mob_locations の delete_after_timestamp と last_kill_time の設定
            const expiryMs = LOCATION_EXPIRY_MS[rankId];
            if (expiryMs) {
                const deleteAfterTimestamp = killTime.toMillis() + expiryMs;
                t.set(mobLocationsRef, { 
                    delete_after_timestamp: deleteAfterTimestamp,
                    last_kill_time: killTime,
                }, { merge: true });

                console.log(`Set location expiry for ${mobStr}`);
            }

            console.log(`[UPDATED] Mob ${mobStr} status updated with initial report ID ${reportId}.`);
        });

        // Cloud Tasks へのジョブ投入
        const functions = getFunctions();
        const queue = functions.taskQueue(TASK_QUEUE_CONFIG.queue, DEFAULT_REGION);

        const scheduleTimeMs = killTime.toMillis() + (AVERAGE_TASK_DELAY_SEC * 1000);
        const scheduleTime = new Date(scheduleTimeMs);

        await queue.enqueue({
            mobId: mobStr,
            initialReportTime: killTime.toMillis(),
        }, {
            scheduleTime: scheduleTime,
        });

        console.log(`Cloud Task queued for Mob ${mobStr}`);

    } catch (error) {
        console.error(`[Mob ${mobId}] reportProcessor トランザクション失敗`, error);
        throw error;
    }
    return null;
});

/**
 * 3.2 averageStatusCalculator: キューから呼び出され、平均討伐時間を算出
 * トリガー: Cloud Tasks からのディスパッチ (v2)
 */
exports.averageStatusCalculator = onTaskDispatched(TASK_QUEUE_CONFIG, async (request) => {

    const { mobId, initialReportTime } = request.data;
    const centerTime = new Date(initialReportTime);
    
    const mobStr = String(mobId);
    const { latestDocId } = getMobMetadata(mobStr);

    const startTime = new Date(centerTime.getTime() - (AVERAGE_WINDOW_SEC * 1000));
    const endTime = new Date(centerTime.getTime() + (AVERAGE_WINDOW_SEC * 1000));

    try {
        // ウィンドウ内の報告をクエリ
        const reportsQuerySnap = await db.collection(COLLECTIONS.REPORTS)
            .where('mob_id', '==', mobStr)
            .where('kill_time', '>=', admin.firestore.Timestamp.fromDate(startTime))
            .where('kill_time', '<=', admin.firestore.Timestamp.fromDate(endTime))
            .orderBy('kill_time', 'asc')
            .get();

        if (reportsQuerySnap.empty) {
            console.log(`[Mob ${mobStr}] このウィンドウの報告は見つかりませんでした。`);
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

        // 最新のメモとUIDを採用
        const latestReport = reportsQuerySnap.docs[reportsQuerySnap.size - 1].data();
        const latestReporterUid = latestReport.reporter_uid;
        const reporterName = await getReporterName(latestReporterUid);
        const finalMemo = `[${reporterName}] ${latestReport.memo}`;

        await db.runTransaction(async (t) => {
            const mobStatusRef = db.collection(COLLECTIONS.MOB_STATUS).doc(latestDocId);
            const mobLocationsRef = db.collection(COLLECTIONS.MOB_LOCATIONS).doc(mobStr);

            const mobStatusDoc = await t.get(mobStatusRef);
            const existingMobStatus = (mobStatusDoc.exists ? mobStatusDoc.data()[mobStr] : {}) || {};
            
            const prevLKT = existingMobStatus.prev_kill_time || admin.firestore.Timestamp.fromMillis(0);
            
            if (avgTimeMs <= prevLKT.toMillis()) { 
                console.warn(`[REJECTED(AVG)] Averaged time is older than or equal to prev_kill_time. Aborting.`);
                return;
            }

            // Mobステータスを更新
            const newMobData = {
                ...existingMobStatus,
                current_kill_time: avgTimestamp,
                current_kill_memo: finalMemo,
                current_reporter_uid: latestReporterUid,
            };

            // t.update()を t.set(..., { merge: true }) に修正
            t.set(mobStatusRef, { [mobStr]: newMobData }, { merge: true });

            // mob_locations の last_kill_time も平均値で更新
            t.set(mobLocationsRef, { last_kill_time: avgTimestamp }, { merge: true });

            console.log(`[Mob ${mobStr}] 最終LKTを平均に設定。${reportsQuerySnap.size}件の報告を処理済み。`);
        });
    } catch (error) {
        console.error(`[Mob ${mobStr}] averageStatusCalculator 処理失敗`, error);
        throw error;
    }
});

// --- 4. HTTPS Callable Functions -------------------------------------------

/**
 * 4.1 updateCrushStatus: 湧き潰し座標のON/OFF時刻を更新
 */
exports.updateCrushStatus = onCall({ region: DEFAULT_REGION }, async (data, context) => {
    if (!context.auth) {
        throw new HttpsError('unauthenticated', '認証が必要です。');
    }

    const { mob_id, point, action } = data;
    const mobStr = String(mob_id);
    const now = admin.firestore.Timestamp.now();

    if (action !== 'add' && action !== 'remove') {
        throw new HttpsError('invalid-argument', 'Action must be "add" or "remove".');
    }
    
    if (getMobMetadata(mobStr).rankId !== '2') {
        throw new HttpsError('invalid-argument', '湧き潰しポイントの更新はSランクモブでのみ許可されています。');
    }

    const mobLocationsRef = db.collection(COLLECTIONS.MOB_LOCATIONS).doc(mobStr);
    const updateFieldKey = `points.${point.id}.${(action === 'add' ? 'crushed_at' : 'uncrushed_at')}`; 

    try {
        await db.runTransaction(async (t) => {
            const mobLocationsSnap = await t.get(mobLocationsRef);
            
            if (!mobLocationsSnap.exists) {
                const newPointData = {
                    points: {
                        [point.id]: {
                            id: point.id,
                            [action === 'add' ? 'crushed_at' : 'uncrushed_at']: now
                        }
                    }
                };
                t.set(mobLocationsRef, newPointData, { merge: true });
            } else {
                const update = {
                    [updateFieldKey]: now,
                };
                
                if (action === 'add') {
                    update[`points.${point.id}.uncrushed_at`] = admin.firestore.FieldValue.delete();
                } else if (action === 'remove') {
                    update[`points.${point.id}.crushed_at`] = admin.firestore.FieldValue.delete();
                }

                t.update(mobLocationsRef, update);
            }
        });

        return { status: 'success', message: `Point ${point.id} crush status updated to ${action}.` };

    } catch (error) {
        console.error(`updateCrushStatus トランザクション失敗 (${mobStr})`, error);
        throw new HttpsError('internal', 'Internal server error during status update.', error.message);
    }
});

/**
 * 4.2 resetCrushStatus: 湧き潰し座標のON/OFF時刻をリセット
 */
exports.resetCrushStatus = onCall({ region: DEFAULT_REGION }, async (data, context) => {
    if (!context.auth) {
        throw new HttpsError('unauthenticated', '認証が必要です。');
    }

    const { mob_id } = data;
    const mobStr = String(mob_id);
    const mobLocationsRef = db.collection(COLLECTIONS.MOB_LOCATIONS).doc(mobStr);

    try {
        await db.runTransaction(async (t) => {
            const doc = await t.get(mobLocationsRef);
            if (!doc.exists || !doc.data().points) {
                console.warn(`Mob Locations document ${mobStr} not found or no points to reset.`);
                return;
            }

            const locationsData = doc.data();
            let resetCount = 0;
            const updates = {};
            
            for (const key in locationsData.points) {
                if (locationsData.points[key].crushed_at || locationsData.points[key].uncrushed_at) {
                    updates[`points.${key}.crushed_at`] = admin.firestore.FieldValue.delete();
                    updates[`points.${key}.uncrushed_at`] = admin.firestore.FieldValue.delete();
                    resetCount++;
                }
            }
            
            if (resetCount > 0) {
                 t.update(mobLocationsRef, updates);
                 console.log(`Successfully reset ${resetCount} points for Mob ${mobStr}.`);
            } else {
                 console.log(`No points required reset for Mob ${mobStr}.`);
            }
        });

        return { status: 'success', message: `Reset complete for ${mob_id}.` };
    } catch (error) {
        console.error(`resetCrushStatus トランザクション失敗 (${mobStr})`, error);
        throw new HttpsError('internal', 'Internal server error during status reset.', error.message);
    }
});

// --- 5. PubSub (Scheduled) Functions ---------------------------------------

/**
 * 5.1 cleanOldReports: 古い報告を削除 (7日前以前)
 */
const { pubsub } = require('firebase-functions/v1');

exports.cleanOldReports = pubsub.schedule('0 9 * * *')
    .timeZone('Asia/Tokyo')
    .onRun(async (context) => {
        const sevenDaysAgo = admin.firestore.Timestamp.fromMillis(Date.now() - (7 * 24 * 60 * 60 * 1000));
        const reportsRef = db.collection(COLLECTIONS.REPORTS);
        
        const snapshot = await reportsRef
            .where('kill_time', '<', sevenDaysAgo)
            .limit(500)
            .get();

        if (snapshot.empty) {
            console.log('No old reports to clean.');
            return null;
        }

        const batch = db.batch();
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });

        await batch.commit();
        console.log(`Cleaned ${snapshot.size} old reports.`);

        return null;
    });

/**
 * 5.2 cleanOldLocations: 古い mob_locations のTTL情報を削除 (delete_after_timestamp 期限切れ)
 */
exports.cleanOldLocations = pubsub.schedule('0 9 * * *')
    .timeZone('Asia/Tokyo')
    .onRun(async (context) => {
        const now = Date.now();
        
        const locationsRef = db.collection(COLLECTIONS.MOB_LOCATIONS);
        const snapshot = await locationsRef
            .where('delete_after_timestamp', '<', now)
            .limit(500)
            .get();

        if (snapshot.empty) {
            console.log('No expired mob_locations to clean.');
            return null;
        }

        const batch = db.batch();
        snapshot.docs.forEach(doc => {
            batch.update(doc.ref, { 
                delete_after_timestamp: admin.firestore.FieldValue.delete(),
                last_kill_time: admin.firestore.FieldValue.delete(), 
            });
        });

        await batch.commit();
        console.log(`Cleaned delete_after_timestamp from ${snapshot.size} mob_locations documents.`);

        return null;
    });
