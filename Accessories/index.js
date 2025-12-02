// Cloud Functions for Firebase - 第2世代 (v2) 対応
// Blazeプラン必須 (無料枠内運用を目指す最適化設定)

const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const logger = require('firebase-functions/logger');

// Admin SDKの初期化
initializeApp();
const db = getFirestore();

// Global Options (全関数共通のデフォルト設定)
setGlobalOptions({
    region: 'asia-northeast1', // 東京リージョン
    memory: '128MiB',          // 最小メモリ
    cpu: 1,                    // メモリに合わせて自動設定
    concurrency: 80,           // 1インスタンスで80リクエストを同時処理 (v2の強み)
    maxInstances: 10,          // 暴走防止の上限
    timeoutSeconds: 60,        // 短めのタイムアウト
});

// Firestore Collection Names
const COLLECTIONS = {
    MOB_STATUS: 'mob_status',
    MOB_LOCATIONS: 'mob_locations',
    SHARED_DATA: 'shared_data',
};

/**
 * Mob IDからMOB_STATUSのドキュメントIDを決定します。
 */
const getStatusDocId = (mobId) => {
    if (typeof mobId !== 'string' || mobId.length < 2) return null;
    const rankCode = mobId[1];
    switch (rankCode) {
        case '2': return 's_latest'; // Sランク
        case '1': return 'a_latest'; // Aランク
        case '3': return 'f_latest'; // FATE
        default: return null;
    }
};

// =====================================================================
// 1. updateMobStatusV2: Mobステータス直接更新 (Callable v2)
// =====================================================================
exports.updateMobStatusV2 = onCall({ cors: true }, async (request) => {
    // 認証チェック: 匿名認証でもOKだが、Firebase Auth経由であることを必須とする
    if (!request.auth) {
        throw new HttpsError('unauthenticated', '認証が必要です。');
    }

    const { mob_id: mobId, kill_time: killTimeIso } = request.data;

    // 最低限の入力チェック
    if (!mobId || !killTimeIso) {
        throw new HttpsError('invalid-argument', 'Mob IDまたは討伐時刻が不足しています。');
    }

    const reportTime = new Date(killTimeIso);
    if (isNaN(reportTime.getTime())) {
        throw new HttpsError('invalid-argument', '無効な日付形式です。');
    }

    const statusDocId = getStatusDocId(mobId);
    if (!statusDocId) {
        throw new HttpsError('invalid-argument', '無効なMob IDです。');
    }

    const rankStatusRef = db.collection(COLLECTIONS.MOB_STATUS).doc(statusDocId);
    const firestoreTime = Timestamp.fromDate(reportTime);

    try {
        const updateData = {
            [mobId]: {
                last_kill_time: firestoreTime,
                last_update: Timestamp.now(),
                is_reverted: false
            }
        };

        await rankStatusRef.set(updateData, { merge: true });

        logger.info(`STATUS_UPDATED_V2_LITE: Mob ${mobId} updated directly (No Read).`);
        return { success: true, message: '更新しました。' };

    } catch (e) {
        logger.error(`UPDATE_FAILURE: Mob ${mobId} error: ${e.message}`, e);
        throw new HttpsError('internal', '更新処理中にエラーが発生しました。');
    }
});

// =====================================================================
// 2. mobCullUpdaterV2: 湧き潰し更新 (Callable v2)
// =====================================================================
exports.mobCullUpdaterV2 = onCall({ cors: true }, async (request) => {
    // 認証チェック
    if (!request.auth) {
        throw new HttpsError('unauthenticated', '認証が必要です。');
    }

    const { mob_id: mobId, location_id: locationId, action, report_time: clientTime } = request.data;

    if (!mobId || !locationId || (action !== 'CULL' && action !== 'UNCULL') || !clientTime) {
        throw new HttpsError('invalid-argument', '必須データが不足しています。');
    }

    const mobLocationRef = db.collection(COLLECTIONS.MOB_LOCATIONS).doc(mobId);
    const timestamp = new Date(clientTime);
    const firestoreTimestamp = Timestamp.fromDate(timestamp);

    try {
        const fieldToUpdate = action === 'CULL' ? `points.${locationId}.culled_at` : `points.${locationId}.uncull_at`;

        await mobLocationRef.set({
            [fieldToUpdate]: firestoreTimestamp
        }, { merge: true });

        logger.info(`CULL_UPDATED_V2: Mob ${mobId} Loc ${locationId} Action ${action}`);
        return { success: true };

    } catch (e) {
        logger.error(`CULL_FAILURE: ${e.message}`, e);
        throw new HttpsError('internal', '湧き潰し更新に失敗しました。');
    }
});

// =====================================================================
// 3. postMobMemoV2: メモ投稿 (Callable v2)
// =====================================================================
const MEMO_DOC_ID = 'memo';

exports.postMobMemoV2 = onCall({ cors: true }, async (request) => {
    // 認証チェック
    if (!request.auth) {
        throw new HttpsError('unauthenticated', '認証が必要です。');
    }

    const { mob_id: mobId, memo_text: memoText } = request.data;

    if (!mobId || memoText === undefined || memoText === null) {
        throw new HttpsError('invalid-argument', 'Mob IDまたはメモ内容が不正です。');
    }

    const memoRef = db.collection(COLLECTIONS.SHARED_DATA).doc(MEMO_DOC_ID);

    try {
        // 空文字ならクリア
        if (memoText.trim() === '') {
            await memoRef.set({ [mobId]: [] }, { merge: true });
            return { success: true, message: 'メモをクリアしました。' };
        }

        const newEntry = {
            memo_text: memoText,
            created_at: Timestamp.now(),
        };

        // 1モブにつき1件のみ保存 (上書き)
        await memoRef.set({ [mobId]: [newEntry] }, { merge: true });

        return { success: true, message: 'メモを投稿しました。' };

    } catch (e) {
        logger.error(`POST_MEMO_FAILURE: ${e.message}`, e);
        throw new HttpsError('internal', 'メモ投稿に失敗しました。');
    }
});

// =====================================================================
// 4. getMobMemosV2: メモ取得 (Callable v2)
// =====================================================================
exports.getMobMemosV2 = onCall({ cors: true }, async (request) => {
    // 認証チェック
    if (!request.auth) {
        throw new HttpsError('unauthenticated', '認証が必要です。');
    }

    const { mob_id: mobId } = request.data;

    if (!mobId) {
        throw new HttpsError('invalid-argument', 'Mob IDが不足しています。');
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

        const serializedMemos = memos.map(m => ({
            ...m,
            created_at: m.created_at.toMillis()
        }));

        return { memos: serializedMemos };

    } catch (e) {
        logger.error(`GET_MEMOS_FAILURE: ${e.message}`, e);
        throw new HttpsError('internal', 'メモ取得に失敗しました。');
    }
});
