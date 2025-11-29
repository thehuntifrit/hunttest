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
// コスト削減のための徹底的なリソース制限
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

// Time Constants
const MAX_REPORT_HISTORY = 5;

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
    const { mob_id: mobId, kill_time: killTimeIso } = request.data;

    // 最低限の入力チェック
    if (!mobId || !killTimeIso) {
        throw new HttpsError('invalid-argument', 'Mob IDまたは討伐時刻が不足しています。');
    }

    const reportTime = new Date(killTimeIso);
    if (isNaN(reportTime.getTime())) {
        throw new HttpsError('invalid-argument', '無効な日付形式です。');
    }

    // 未来日付の簡易チェック (サーバー時刻 + 5分以上の未来は弾く)
    const now = new Date();
    if (reportTime > new Date(now.getTime() + 5 * 60 * 1000)) {
        throw new HttpsError('out-of-range', '未来の時刻は登録できません。');
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
                last_update: Timestamp.now(), // デバッグ用更新時刻
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

        await db.runTransaction(async (t) => {
            const memoSnap = await t.get(memoRef);
            const memoData = memoSnap.data() || {};
            const currentEntries = memoData[mobId] || [];

            const newEntry = {
                memo_text: memoText,
                created_at: Timestamp.now(),
            };
            currentEntries.unshift(newEntry);

            // 最大件数制限 (例: 20件)
            if (currentEntries.length > 20) {
                currentEntries.length = 20;
            }

            t.set(memoRef, { [mobId]: currentEntries }, { merge: true });
        });

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
        // 日付順ソート (新しい順)
        memos.sort((a, b) => b.created_at.toMillis() - a.created_at.toMillis());

        // Timestampをミリ秒数値に変換して返す (クライアントで扱いやすくするため)
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
