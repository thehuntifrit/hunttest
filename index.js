// Firebase Admin SDKとFunctions v1の初期化
const functions = require('firebase-functions/v1'); 
const admin = require('firebase-admin');
const Tasks = require('@google-cloud/tasks');

// Firebase Admin SDKの初期化
admin.initializeApp();
const db = admin.firestore();
// Cloud Tasksクライアントの初期化
const tasksClient = new Tasks.CloudTasksClient();


// --- 共通定数とユーティリティ ---
const COOL_DOWN_TIMES = {
    '1': 3 * 3600,       // Aモブ: 3時間
    '2': 24 * 3600,      // Sモブ: 24時間
    '3': 24 * 3600       // FATEモブ: 24時間
};

/**
 * MobIDからMobランク（千の位）を取得し、ターゲットドキュメントIDとCD時間（秒）を返します
 * MobIDの4桁目（千の位、インデックス1）の値でランクを判定します。
 * @param {string} mobId
 * @returns {{ rank: string, docId: string, cdSeconds: number }}
 */
function getMobMetadata(mobId) {
    const rank = mobId.charAt(1); 
    
    let docId = 'a_latest';
    if (rank === '2') {
        docId = 's_latest';
    } else if (rank === '3') {
        docId = 'f_latest';
    }
    
    const cdSeconds = COOL_DOWN_TIMES[rank] || 3 * 3600; 
    return { rank, docId, cdSeconds };
}

/**
 * 報告者のキャラクター名を取得
 * @param {string} reporterUID
 * @returns {Promise<string>}
 */
async function getReporterName(reporterUID) {
    let reporterName = '名無し';
    if (reporterUID) {
        try {
            const userDoc = await db.collection('users').doc(reporterUID).get();
            if (userDoc.exists) {
                reporterName = userDoc.data().character_name || '名無し';
            }
        } catch (e) {
            console.warn(`Failed to retrieve user name for UID ${reporterUID}: ${e.message}`);
        }
    }
    return reporterName;
}


// --- 1. processHuntReport (新規報告時の即時処理とキューイング) ---
exports.processHuntReport = functions
    .region('asia-northeast2')
    .firestore
    .document('reports/{reportId}')
    .onCreate(async (snap, context) => {
        const reportData = snap.data();
        const mobId = reportData.mob_id.toString();
        
        let transactionSucceeded = false;

        // --- 1. kill_time のデータ型変換ロジック ---
        let killTimeData = reportData.kill_time; 
        let finalDate;

        if (killTimeData && typeof killTimeData.toDate === 'function') {
            finalDate = killTimeData.toDate();
        } 
        else if (typeof killTimeData === 'string' || typeof killTimeData === 'number') {
            finalDate = new Date(killTimeData);
        }
        else if (killTimeData instanceof Date) {
            finalDate = killTimeData;
        }
        else {
            console.error("ERROR: kill_timeのデータ型が不正です。処理を中止します。", typeof killTimeData, killTimeData);
            return null;
        }

        const reportTimestamp = admin.firestore.Timestamp.fromDate(finalDate);
        const reportTime = finalDate; 
        
        const memo = reportData.memo || '討伐報告';
        const reporterUID = reportData.reporter_uid;
        
        const { rank, docId, cdSeconds } = getMobMetadata(mobId);
        const mobStatusRef = db.collection('mob_status').doc(docId);
        const mobLocationsRef = db.collection('mob_locations').doc(mobId);
        
        const reporterName = await getReporterName(reporterUID);
        const finalMemo = `[${reporterName}] ${memo}`;

        // --- 2. トランザクションによるMobStatusの読み込みと更新 ---
        try {
            await db.runTransaction(async (t) => {
                const mobStatusSnap = await t.get(mobStatusRef);
                const statusData = mobStatusSnap.data() || {}; 
                const mobData = statusData[mobId] || {};
                
                const prevKillTime = mobData.prev_kill_time ? mobData.prev_kill_time.toDate() : new Date(0);
                
                const minAllowedTime = new Date(prevKillTime.getTime() + cdSeconds * 1000);

                // クールダウンチェック: CDを満たさない場合はスキップ
                if (reportTime < minAllowedTime) {
                    console.log(`SKIP: Mob ${mobId} の報告時刻は最小湧き時間 (${cdSeconds}秒) を満たしていません。`);
                    return; 
                }

                // 時刻チェック: current_kill_timeよりも新しくない場合はスキップ
                const currentKillTime = mobData.current_kill_time ? mobData.current_kill_time.toDate() : new Date(0);

                if (reportTime <= currentKillTime) {
                    console.log(`SKIP: Mob ${mobId} の報告時刻は現在の記録時刻以下です。`);
                    return; 
                }

                // MobStatusの即時更新
                const newMobData = {
                    current_kill_time: reportTimestamp,
                    current_kill_memo: finalMemo,
                    current_reporter_uid: reporterUID,
                    prev_kill_time: mobData.current_kill_time || null, 
                    prev_kill_memo: mobData.current_kill_memo || '',
                };
                
                t.set(mobStatusRef, {
                    [mobId]: newMobData 
                }, { merge: true });
                console.log(`UPDATE: Mob ${mobId} status updated instantly.`);

                // Sモブ処理: mob_locations の削除期限と「即時リセット」タイムスタンプを更新
                if (rank === '2') {
                    const killTimeMs = reportTimestamp.toMillis();
                    const deleteAfterMs = killTimeMs + (7 * 24 * 3600 * 1000); 
                    
                    t.set(mobLocationsRef, {
                        delete_after_timestamp: deleteAfterMs,
                        // 即時の見た目リセット用に最初の報告時刻を書き込む
                        last_kill_time: reportTimestamp, 
                    }, { merge: true }); 
                }
                
                transactionSucceeded = true; 
            });
        } catch (error) {
            console.error("Firestore Transaction Failed in processHuntReport:", error);
        }
        
        // --- 3. Cloud Tasks キューイング ---
        
        if (!transactionSucceeded) {
            console.log("SKIP: Cloud Tasks Queueing. Transaction failed or mob time was invalid.");
            return null; 
        }

        const projectId = process.env.GCP_PROJECT; 
        if (!projectId) {
            console.error("ERROR: GCP_PROJECT environment variable is not set.");
            return null;
        }
        
        const serviceAccountEmail = `${projectId}@appspot.gserviceaccount.com`;
        const queueName = 'mob-averaging-queue'; 
        const location = 'asia-northeast2';
        const url = `https://${location}-${projectId}.cloudfunctions.net/calculateAveragedStatus`;
        const payload = { mobId, reportTime: reportTime.toISOString() }; 
        const eta = Math.floor(reportTime.getTime() / 1000) + (10 * 60); // 10分後に設定

        const task = {
            httpRequest: {
                httpMethod: 'POST',
                url,
                body: Buffer.from(JSON.stringify(payload)).toString('base64'),
                headers: { 'Content-Type': 'application/json' },
                oidcToken: { serviceAccountEmail },
            },
            scheduleTime: { seconds: eta },
            name: tasksClient.taskPath(projectId, location, queueName, `mob-${mobId}-${eta}`) // 多重実行防止用のタスク名
        };

        try {
            await tasksClient.createTask({
                parent: tasksClient.queuePath(projectId, location, queueName),
                task,
            });
            console.log(`Task to average ${mobId} scheduled for 10 minutes later.`);
        } catch (error) {
            if (!error.message.includes('already exists')) {
                 console.error("Error scheduling task:", error);
            } else {
                 console.log(`SKIP: Task for ${mobId} already exists in the queue.`);
            }
        }
    });

// --- 4. updateCrushStatus (座標タップによる湧き潰し状態の更新 - 効率化済み) ---
exports.updateCrushStatus = functions
    .region('asia-northeast2')
    .https.onCall(async (data, context) => {
        
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', '認証されていません。');
        }

        const { s_mob_id, point, action } = data; // point: { id: string, x: number, y: number }
        
        if (!s_mob_id || !point || !point.id || !action) {
            throw new functions.https.HttpsError('invalid-argument', 'SモブID、座標ID、または操作が不足しています。');
        }
        if (action !== 'add' && action !== 'remove') {
            throw new functions.https.HttpsError('invalid-argument', '無効な操作です (add/removeのみ有効)。');
        }
        
        const mobLocationsRef = db.collection('mob_locations').doc(s_mob_id.toString());
        const timestamp = admin.firestore.Timestamp.now();
        
        // 更新対象のフィールドパスを動的に決定
        const targetTimestampPath = action === 'add' ? `points.${point.id}.crushed_at` : `points.${point.id}.uncrushed_at`;

        try {
            await db.runTransaction(async (t) => {
                const docSnap = await t.get(mobLocationsRef);
                const docData = docSnap.data() || {};
                
                // 座標が未登録の場合、静的データとして構築
                if (!docData.points || !docData.points[point.id]) {
                    console.log(`INFO: New point ${point.id} discovered. Initializing.`);

                    // 初期データには座標情報と、今回の操作時刻のみを含める (nullは書き込まれない)
                    const newPointData = {
                        id: point.id, 
                        x: point.x, 
                        y: point.y, 
                        [targetTimestampPath.split('.').pop()]: timestamp, // crushed_at または uncrushed_at
                    };

                    t.set(mobLocationsRef, {
                        points: { [point.id]: newPointData }
                    }, { merge: true });

                } else {
                    // 既存のポイントの時刻を上書き更新（対抗側の時刻は削除せず残す）
                    const updates = {
                        [targetTimestampPath]: timestamp
                    };
                    
                    t.update(mobLocationsRef, updates);
                }
            });

            return { status: 'success', message: `${point.id} の湧き潰し状態を ${action === 'add' ? '追加' : '解除'} しました。` };

        } catch (error) {
            console.error("湧き潰し状態のトランザクションに失敗しました:", error);
            throw new functions.https.HttpsError('internal', 'サーバー側の処理中にエラーが発生しました。');
        }
    });


// --- 5. resetCrushStatus (全湧き潰し状態の手動リセット) ---
exports.resetCrushStatus = functions
    .region('asia-northeast2')
    .https.onCall(async (data, context) => {
        
        // 認証チェック (管理者権限チェックを追加することを推奨)
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', '認証されていません。');
        }

        const { s_mob_id } = data;
        if (!s_mob_id) {
            throw new functions.https.HttpsError('invalid-argument', 'SモブIDが不足しています。');
        }

        const mobLocationsRef = db.collection('mob_locations').doc(s_mob_id.toString());

        try {
            await db.runTransaction(async (t) => {
                const docSnap = await t.get(mobLocationsRef);
                const docData = docSnap.data();

                if (!docData || !docData.points) {
                    console.log(`WARN: S-Mob ${s_mob_id} has no points to reset.`);
                    return;
                }

                const updates = {};
                let resetCount = 0;

                // pointsマップ内の全要素の時刻フィールドを削除 (=真のリセット)
                for (const key of Object.keys(docData.points)) {
                    updates[`points.${key}.crushed_at`] = admin.firestore.FieldValue.delete();
                    updates[`points.${key}.uncrushed_at`] = admin.firestore.FieldValue.delete();
                    resetCount++;
                }

                if (resetCount > 0) {
                    t.update(mobLocationsRef, updates);
                    console.log(`SUCCESS: S-Mob ${s_mob_id} の湧き潰し状態を ${Object.keys(docData.points).length} 点リセットしました。`);
                }
            });

            return { status: 'success', message: `S-Mob ${s_mob_id} の湧き潰し情報をリセットしました。` };

        } catch (error) {
            console.error("湧き潰しリセットのトランザクションに失敗しました:", error);
            throw new functions.https.HttpsError('internal', 'サーバー側の処理中にエラーが発生しました。');
        }
    });


// --- 6. calculateAveragedStatus (Cloud Tasksによる遅延平均化) ---
exports.calculateAveragedStatus = functions
    .region('asia-northeast2')
    .https.onRequest(async (req, res) => {
    
    // Cloud TasksからのPOSTリクエストのみを処理
    if (req.method !== 'POST' || !req.body) {
        return res.status(405).send('Method Not Allowed or Missing Body');
    }

    const { mobId, reportTime: reportTimeISO } = req.body;
    if (!mobId || !reportTimeISO) {
        return res.status(400).send('Missing mobId or reportTime in payload');
    }
    
    const reportTime = new Date(reportTimeISO);
    const { docId, cdSeconds } = getMobMetadata(mobId);
    const mobStatusRef = db.collection('mob_status').doc(docId);
    const mobLocationsRef = db.collection('mob_locations').doc(mobId); 

    const windowStart = new Date(reportTime.getTime() - (5 * 60 * 1000)); 
    const windowEnd = new Date(reportTime.getTime() + (5 * 60 * 1000)); 
    
    // 前後10分間のレポートをクエリ
    const reportsSnap = await db.collection('reports')
        .where('mob_id', '==', mobId)
        .where('kill_time', '>=', admin.firestore.Timestamp.fromDate(windowStart))
        .where('kill_time', '<=', admin.firestore.Timestamp.fromDate(windowEnd))
        .get();

    if (reportsSnap.empty) {
        return res.status(200).send('No reports to process in the window.');
    }

    let totalTimeMs = 0;
    reportsSnap.forEach(doc => {
        totalTimeMs += doc.data().kill_time.toMillis(); 
    });
    const avgTimeMs = totalTimeMs / reportsSnap.size;
    const avgTimestamp = admin.firestore.Timestamp.fromMillis(Math.round(avgTimeMs));
    const avgTimeDate = new Date(avgTimeMs);
    
    try {
        await db.runTransaction(async (t) => {
            const mobStatusSnap = await t.get(mobStatusRef);
            const statusData = mobStatusSnap.data() || {};
            const mobData = statusData[mobId] || {};
            const prevKillTime = mobData.prev_kill_time ? mobData.prev_kill_time.toDate() : new Date(0);
            
            const minAllowedTime = new Date(prevKillTime.getTime() + cdSeconds * 1000);

            // クールダウンチェックを再度実行
            if (avgTimeDate < minAllowedTime) {
                console.log(`SKIP: Averaged time for ${mobId} is too early (CD check failed).`);
                return; 
            }

            const currentKillTime = mobData.current_kill_time ? mobData.current_kill_time.toDate() : new Date(0);

            // 既に新しい時間が更新されていた場合はスキップ
            if (avgTimeDate <= currentKillTime) {
                console.log(`SKIP: Averaged time for ${mobId} is not newer than current record.`);
                return; 
            }

            // 1. MobStatusを平均時刻で更新
            t.update(mobStatusRef, {
                [`${mobId}.current_kill_time`]: avgTimestamp,
            });
            
            // 2. mob_locations の last_kill_time を正確な平均時刻で上書き更新
            t.update(mobLocationsRef, {
                last_kill_time: avgTimestamp 
            });

            console.log(`SUCCESS: Mob ${mobId} averaged time updated to ${avgTimeDate.toISOString()}`);
        });

        return res.status(200).send('Averaging complete.');
    } catch (error) {
        console.error("Transaction failed during averaging:", error);
        return res.status(500).send('Transaction failed.');
    }
});


// --- 7. cleanOldReports (ログ削除 - 毎日実行) ---
exports.cleanOldReports = functions
    .region('asia-northeast2')
    .pubsub.schedule('0 0 * * *') // 毎日 JST 午前9時 (UTC 00:00) 実行
    .timeZone('Asia/Tokyo')
    .onRun(async (context) => {
        const retentionDays = 7;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - retentionDays); 

        const oldReportsQuery = db.collection('reports')
            .where('kill_time', '<', admin.firestore.Timestamp.fromDate(cutoff))
            .limit(500); // 処理がタイムアウトしないようバッチサイズを設定

        const snapshot = await oldReportsQuery.get();
        
        if (snapshot.size === 0) {
            console.log("No old reports found to delete.");
            return null;
        }
        
        const batch = db.batch();
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });

        await batch.commit();
        console.log(`Deleted ${snapshot.size} old report documents.`);
        return null;
    });


// --- 8. cleanOldLocations (座標バックアップ削除 - 毎日実行) ---
exports.cleanOldLocations = functions
    .region('asia-northeast2')
    .pubsub.schedule('0 0 * * *')
    .timeZone('Asia/Tokyo')
    .onRun(async (context) => {
        const nowMs = Date.now();

        const expiredLocations = await db.collection('mob_locations')
            .where('delete_after_timestamp', '<', nowMs)
            .get();

        if (expiredLocations.empty) {
            console.log('No expired mob_locations found.');
            return null;
        }

        const batch = db.batch();
        expiredLocations.docs.forEach(doc => {
            // prev_locations と delete_after_timestamp を削除
            batch.update(doc.ref, {
                prev_locations: admin.firestore.FieldValue.delete(),
                delete_after_timestamp: admin.firestore.FieldValue.delete()
            });
        });

        await batch.commit();
        console.log(`Successfully cleared prev_locations for ${expiredLocations.size} documents.`);
        return null;
    });
