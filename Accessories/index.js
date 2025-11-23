const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');
const logger = require('firebase-functions/logger');
const cors = require('cors')({ origin: true });

admin.initializeApp();

const db = admin.firestore();

const COLLECTIONS = {
    REPORTS: 'reports',
    MOB_STATUS: 'mob_status',
    MOB_LOCATIONS: 'mob_locations',
    SHARED_DATA: 'shared_data',
};

const DEFAULT_REGION = 'us-central1';
const FUNCTIONS_OPTIONS = {
    region: DEFAULT_REGION,
    runtime: 'nodejs20',
};

const FIVE_MINUTES_IN_SECONDS = 5 * 60;
const MAX_REPORT_HISTORY = 5;

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

exports.reportProcessorV1 = functions.runWith(FUNCTIONS_OPTIONS)
    .firestore.document(`${COLLECTIONS.REPORTS}/{reportId}`)
    .onCreate(async (snap, context) => {

        const reportRef = snap.ref;
        const reportData = snap.data();

        if (reportData.is_processed === true) {
            logger.info(`SKIP: Mob ${reportData.mob_id || 'Unknown'} のレポートは既に処理済みです。`);
            return null;
        }

        const {
            mob_id: mobId,
            kill_time: reportTimeData,
            repop_seconds: repopSeconds,
        } = reportData;

        if (!mobId || !reportTimeData || !repopSeconds) {
            logger.error('SKIP: 必須データが不足。');
            return null;
        }

        const reportTime = reportTimeData.toDate();
        const statusDocId = getStatusDocId(mobId);

        if (!statusDocId) {
            logger.error(`SKIP: 無効なMob ID (${mobId})。`);
            return null;
        }

        const rankStatusRef = db.collection(COLLECTIONS.MOB_STATUS).doc(statusDocId);
        const mobLocationRef = db.collection(COLLECTIONS.MOB_LOCATIONS).doc(mobId); 

        let transactionResult = false;
        
        try {
            transactionResult = await db.runTransaction(async (t) => {
                const rankStatusSnap = await t.get(rankStatusRef); 
                const rankStatusData = rankStatusSnap.data() || {};
                const existingMobData = rankStatusData[`${mobId}`] || {};

                const currentLKT = existingMobData.last_kill_time || null;
                
                if (currentLKT) {
                    const lastLKTTime = currentLKT.toDate();
                    
                    if (reportTime <= lastLKTTime) {
                        t.update(reportRef, { is_processed: true, skip_reason: 'Time too old or duplicated' });
                        return false; 
                    }

                    const minAllowedTimeSec = lastLKTTime.getTime() / 1000 + repopSeconds - FIVE_MINUTES_IN_SECONDS;
                    const minAllowedTime = new Date(minAllowedTimeSec * 1000);

                    if (reportTime < minAllowedTime) {
                        t.update(reportRef, { is_processed: true, skip_reason: 'Time too early' });
                        return false; 
                    }
                }

                let history = [];
                for (let i = 0; i < MAX_REPORT_HISTORY; i++) {
                    const reportKey = `report_${i}`;
                    if (existingMobData[reportKey]) {
                        const { time, memo, repop, ...rest } = existingMobData[reportKey];
                        history.push({ time, ...rest });
                    }
                }
                const newReportEntry = {
                    time: reportTimeData,
                };
                history.unshift(newReportEntry);
                history = history.slice(0, MAX_REPORT_HISTORY);
                
                let mobUpdateFields = {};
                for (let i = 0; i < history.length; i++) {
                    mobUpdateFields[`report_${i}`] = history[i];
                }
                
                const finalStatusUpdate = {
                    prev_kill_time: currentLKT || null,
                    last_kill_time: reportTimeData,
                    is_reverted: false,
                    ...mobUpdateFields,
                };

                t.set(rankStatusRef, { [`${mobId}`]: finalStatusUpdate }, { merge: true }); 

                t.update(reportRef, { is_processed: true, is_averaged: false });
                
                return true; 
            });

        } catch (e) {
            logger.error(`FATAL_TRANSACTION_FAILURE: Mob ${mobId} のトランザクション失敗: ${e.message}`, e);
            return null;
        }
        
        logger.info(`STATUS_UPDATED_FINAL: Mob ${mobId} のステータスを更新しました (Mob Locations LKT同期なし)。`);
        return null;
    });

exports.getServerTimeV1 = functions.runWith(FUNCTIONS_OPTIONS).https.onCall(async (data, context) => {
    const serverTimeMs = admin.firestore.Timestamp.now().toMillis();
    return { serverTimeMs: serverTimeMs };
});

exports.revertStatusV1 = functions.runWith(FUNCTIONS_OPTIONS).https.onRequest((req, res) => {
    return cors(req, res, async () => {

        if (req.method !== 'POST') {
            return res.status(405).send('Method Not Allowed. Use POST.');
        }

        const callData = req.body.data;
        if (!callData) {
            return res.status(400).json({ data: { success: false, error: 'Request data missing.' } });
        }
        
        const { mob_id: mobId, target_report_index: targetIndex } = callData; 

        if (!mobId) {
            return res.status(200).json({ data: { success: false, error: 'Mob IDが指定されていません。' } });
        }
        
        if (targetIndex !== undefined && targetIndex !== 'prev') {
             return res.status(200).json({ data: { success: false, error: '現在、確定履歴への巻き戻しのみ対応しています。' } });
        }
        
        const statusDocId = getStatusDocId(mobId);
        if (!statusDocId) {
            return res.status(200).json({ data: { success: false, error: '無効なMob IDが指定されました。' } });
        }
        
        const rankStatusRef = db.collection(COLLECTIONS.MOB_STATUS).doc(statusDocId);
        const mobLocationRef = db.collection(COLLECTIONS.MOB_LOCATIONS).doc(mobId); 

        let success = false;
        let errorMessage = '';
        let newMessage = '';

        try {
            await db.runTransaction(async (t) => {
                const rankStatusSnap = await t.get(rankStatusRef); 
                
                const rankStatusData = rankStatusSnap.data() || {};
                const existingMobData = rankStatusData[`${mobId}`] || {};

                const newLKT = existingMobData.prev_kill_time;
                
                if (!newLKT) {
                    throw new Error('確定履歴（prev_kill_time）が存在しないため、巻き戻しできません。');
                }
                
                const finalStatusUpdate = {
                    last_kill_time: newLKT,
                    prev_kill_time: null, 
                    is_reverted: true, 
                };
                t.set(rankStatusRef, { [`${mobId}`]: finalStatusUpdate }, { merge: true });

                newMessage = `Mob ${mobId} のステータスを前回の記録に巻き戻しました (Mob Locations LKT更新なし)。`;
                success = true;

            });

        } catch (e) {
            logger.error(`REVERT_TRANSACTION_FAILURE: Mob ${mobId} の巻き戻し失敗: ${e.message}`, e);
            errorMessage = e.message;
        }

        if (success) {
            return res.status(200).json({ data: { success: true, message: newMessage } });
        } else {
            return res.status(200).json({ data: { success: false, error: errorMessage || '予期せぬエラーが発生しました。' } });
        }
    });
});

exports.mobCullUpdaterV1 = functions.runWith(FUNCTIONS_OPTIONS).https.onRequest((req, res) => {
    return cors(req, res, async () => {

        if (req.method !== 'POST') {
            return res.status(405).send('Method Not Allowed. Use POST.');
        }

        const callData = req.body.data;
        if (!callData) {
            return res.status(400).json({ data: { success: false, error: 'Request data missing.' } });
        }

        const { mob_id: mobId, location_id: locationId, action, report_time: clientTime } = callData; 

        if (!mobId || !locationId || (action !== 'CULL' && action !== 'UNCULL') || !clientTime) {
            return res.status(200).json({ data: { success: false, error: '必須データ (Mob ID, Location ID, Action: CULL/UNCULL, Time) が不正です。' } });
        }
        
        const mobLocationRef = db.collection(COLLECTIONS.MOB_LOCATIONS).doc(mobId);
        
        const timestamp = new Date(clientTime);
        const firestoreTimestamp = admin.firestore.Timestamp.fromDate(timestamp);

        let success = false;
        let errorMessage = '';
        let message = '';

        try {
            const fieldToUpdate = action === 'CULL' ? `points.${locationId}.culled_at` : `points.${locationId}.uncull_at`;
            message = `Mob ${mobId} の地点 ${locationId} の湧き潰し${action === 'CULL' ? '時刻' : '解除時刻'}を記録しました。`;
            
            const updateFields = {
                [fieldToUpdate]: firestoreTimestamp
            };
            
            await mobLocationRef.set(updateFields, { merge: true }); 

            logger.info(`CULL_STATUS_UPDATED: Mob ${mobId} の地点 ${locationId} の ${action} 時刻を記録。`);
            success = true;

        } catch (e) {
            logger.error(`CULL_FAILURE: Mob ${mobId} の地点時刻更新失敗: ${e.message}`, e);
            errorMessage = e.message;
        }

        if (success) {
            return res.status(200).json({ data: { success: true, message: message } });
        } else {
            return res.status(200).json({ data: { success: false, error: errorMessage || '予期せぬエラーが発生しました。' } });
        }
    });
});

const MEMO_DOC_ID = 'memo';

exports.postMobMemoV1 = functions.runWith(FUNCTIONS_OPTIONS).https.onCall(async (data, context) => {
    const { mob_id: mobId, memo_text: memoText } = data;

    if (!mobId || !memoText) {
        throw new functions.https.HttpsError('invalid-argument', 'Mob IDまたはメモの内容が不足しています。');
    }
    
    const memoRef = db.collection(COLLECTIONS.SHARED_DATA).doc(MEMO_DOC_ID);

    try {
        await db.runTransaction(async (t) => {
            const memoSnap = await t.get(memoRef);
            const memoData = memoSnap.data() || {};
            
            const currentEntries = memoData[mobId] || [];
            
            const newEntry = {
                memo_text: memoText,
                created_at: admin.firestore.Timestamp.now(),
            };
            currentEntries.unshift(newEntry);
            
            t.set(memoRef, { [mobId]: currentEntries }, { merge: true });
        });

        return { success: true, message: `Mob ${mobId} にメモを正常に投稿しました。` };
    } catch (e) {
        logger.error(`POST_MEMO_FAILURE: Mob ${mobId} へのメモ投稿失敗: ${e.message}`, e);
        throw new functions.https.HttpsError('internal', 'メモ投稿中にサーバーエラーが発生しました。');
    }
});

exports.getMobMemosV1 = functions.runWith(FUNCTIONS_OPTIONS).https.onCall(async (data, context) => {
    const { mob_id: mobId } = data;

    if (!mobId) {
        throw new functions.https.HttpsError('invalid-argument', 'Mob IDが不足しています。');
    }

    const memoRef = db.collection(COLLECTIONS.SHARED_DATA).doc(MEMO_DOC_ID);

    try {
        const memoSnap = await memoRef.get();
        const memoData = memoSnap.data();

        if (!memoData || !memoData[mobId]) {
            return { memos: [] };
        }

        let memos = memoData[mobId];

        memos.sort((a, b) => b.created_at.toMillis() - a.created_at.toMillis());

        return { memos: memos };
    } catch (e) {
        logger.error(`GET_MEMOS_FAILURE: Mob ${mobId} のメモ取得失敗: ${e.message}`, e);
        throw new functions.https.HttpsError('internal', 'メモ取得中にサーバーエラーが発生しました。');
    }
});
