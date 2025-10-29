// server.js (修正版)

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getFirestore, collection, onSnapshot, addDoc, doc, setDoc, updateDoc, increment, FieldValue } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-functions.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-analytics.js";

import { getState } from "./dataManager.js";
import { closeReportModal } from "./modal.js";
import { displayStatus } from "./uiRender.js";
import { isCulled, updateCrushUI } from "./location.js"; // isCulled 関数はLKTを受け取るようにlocation.js側も修正済みを想定

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBikwjGsjL_PVFhx3Vj-OeJCocKA_hQOgU",
    authDomain: "the-hunt-ifrit.firebaseapp.com",
    projectId: "the-hunt-ifrit",
    storageBucket: "the-hunt-ifrit.firebasestorage.app",
    messagingSenderId: "285578581189",
    appId: "1:285578581189:web:4d9826ee3f988a7519ccac"
};
import { serverTimestamp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const auth = getAuth(app);
const functionsInstance = getFunctions(app, "asia-northeast1");
const analytics = getAnalytics(app);

const functions = functionsInstance;

// ★ HTTPS Callable の初期化: V1関数名に統一し、湧き潰し関数を追加
const callGetServerTime = httpsCallable(functions, 'getServerTimeV1'); // ★ 関数名変更
const callRevertStatus = httpsCallable(functions, 'revertStatusV1');   // ★ 関数名変更
const callMobCullUpdater = httpsCallable(functions, 'mobCullUpdaterV1'); // ★ 新規追加

// 認証 (変更なし)
async function initializeAuth() {
    return new Promise((resolve) => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            unsubscribe();

            if (user) {
                resolve(user.uid);
            } else {
                signInAnonymously(auth)
                    .then((credential) => {
                        resolve(credential.user.uid);
                    })
                    .catch((error) => {
                        console.error("匿名認証に失敗しました:", error);
                        resolve(null);
                    });
            }
        });
    });
}

onAuthStateChanged(auth, (user) => {
    if (user) {
        console.log("UID:", user.uid);
    } else {
        console.log("まだ認証されていません");
    }
});

// サーバーUTC取得
async function getServerTimeUTC() {
    // const getServerTime = httpsCallable(functionsInstance, "getServerTime"); // 削除
    try {
        const response = await callGetServerTime(); // ★ 定義済みの V1 関数を呼び出し

        if (response.data && typeof response.data.serverTimeMs === 'number') {
            return new Date(response.data.serverTimeMs);
        } else {
            console.error("サーバー時刻取得エラー: serverTimeMs が不正です。", response.data);
            return new Date();
        }
    } catch (error) {
        console.error("サーバー時刻取得のためのFunctions呼び出しに失敗しました:", error);
        return new Date();
    }
}

// データ購読 (Mob Status) (変更なし)
function subscribeMobStatusDocs(onUpdate) {
    const docIds = ["s_latest", "a_latest", "f_latest"];
    const mobStatusDataMap = {};
    const unsubs = docIds.map(id =>
        onSnapshot(doc(db, "mob_status", id), snap => {
            const data = snap.data();
            if (data) mobStatusDataMap[id] = data;
            onUpdate(mobStatusDataMap);
        })
    );
    return () => unsubs.forEach(u => u());
}

// ★ データ購読 (Mob Locations) - LKTの取得と isCulled への引き渡しを修正
function subscribeMobLocations(onUpdate) {
    const unsub = onSnapshot(collection(db, "mob_locations"), snapshot => {
        const map = {};
        snapshot.forEach(docSnap => {
            const mobNo = parseInt(docSnap.id, 10);
            const data = docSnap.data();
            
            // Mob Locations ドキュメント内の確定時刻を取得 (巻き戻し連動値)
            const mobLastKillTime = data.last_kill_time || null; // Timestampオブジェクト
            
            // ★ mapにlast_kill_timeを格納 (location.jsのdrawSpawnPointで使用)
            map[mobNo] = { points: data.points || {}, last_kill_time: mobLastKillTime }; 
            
            // 各地点の UI 更新
            Object.entries(data.points || {}).forEach(([locationId, status]) => {
                // isCulled に Mob Locations ドキュメントの LKT を渡す
                const isCulledFlag = isCulled(status, mobLastKillTime); 
                updateCrushUI(mobNo, locationId, isCulledFlag);
            });
        });
        onUpdate(map);
    });
    return unsub;
}

// 討伐報告 (reportsコレクションへの直接書き込み) (変更なし)
const submitReport = async (mobNo, timeISO, memo) => {
    const state = getState();
    const userId = state.userId;
    const mobs = state.mobs;

    if (!userId) {
        displayStatus("認証が完了していません。ページをリロードしてください。", "error");
        return;
    }

    const mob = mobs.find(m => m.No === mobNo);
    if (!mob) {
        displayStatus("モブデータが見つかりません。", "error");
        return;
    }

    // モーダル入力を優先、未入力や不正ならサーバー時刻を fallback
    let killTimeDate;
    if (timeISO) {
        const modalDate = new Date(timeISO);
        if (!isNaN(modalDate)) {
            killTimeDate = modalDate; // ← モーダル値をそのまま採用
        }
    }
    if (!killTimeDate) {
        killTimeDate = await getServerTimeUTC(); // fallback
    }

    const modalStatusEl = document.querySelector("#modal-status");
    if (modalStatusEl) modalStatusEl.textContent = "送信中...";
    displayStatus(`${mob.Name} 討伐時間報告中...`);

    try {
        await addDoc(collection(db, "reports"), {
            mob_id: mobNo.toString(),
            kill_time: killTimeDate,
            reporter_uid: userId,
            memo: memo,
            repop_seconds: mob.REPOP_s
        });

        closeReportModal();
        displayStatus("報告が完了しました。データ反映を待っています。", "success");
    } catch (error) {
        console.error("レポート送信エラー:", error);
        if (modalStatusEl) modalStatusEl.textContent = "送信エラー: " + (error.message || "通信失敗");
        displayStatus(`討伐報告エラー: ${error.message || "通信失敗"}`, "error");
    }
};

// フォーム送信イベント (変更なし)
document.addEventListener("DOMContentLoaded", () => {
    const reportForm = document.getElementById("report-form");
    if (reportForm) {
        reportForm.addEventListener("submit", (e) => {
            e.preventDefault();

            const mobNo = Number(reportForm.dataset.mobNo);
            const timeISO = document.getElementById("report-datetime").value;
            const memo = document.getElementById("report-memo").value;

            submitReport(mobNo, timeISO, memo);
        });
    }
});

// ★ 湧き潰し報告を Callable に変更
const toggleCrushStatus = async (mobNo, locationId, isCurrentlyCulled) => {
    const state = getState();
    const userId = state.userId;
    const mobs = state.mobs;

    if (!userId) {
        displayStatus("認証が完了していません。", "error");
        return;
    }

    // サーバー関数に合わせてアクション名を大文字に
    const action = isCurrentlyCulled ? "UNCULL" : "CULL"; 
    const mob = mobs.find(m => m.No === mobNo);
    if (!mob) return;

    displayStatus(
        `${mob.Name} (${locationId}) ${action === "CULL" ? "湧き潰し" : "解除"}報告中...`
    );

    // サーバー側が期待するデータ構造
    const data = {
        mob_id: mobNo.toString(),
        location_id: locationId.toString(),
        action: action,
        report_time: new Date().toISOString(), // クライアント時刻をISO形式で送付
    };

    try {
        // await updateDoc(mobLocationsRef, updateData); // Firestore直接更新を削除
        
        const response = await callMobCullUpdater(data); // ★ Callable 関数呼び出しに切り替え
        const result = response.data;
        
        if (result?.success) {
            displayStatus(`${mob.Name} の状態を更新しました。`, "success");
        } else {
             displayStatus(`湧き潰し報告エラー: ${result?.error || "通信失敗"}`, "error");
        }

    } catch (error) {
        console.error("湧き潰し報告エラー:", error);
        displayStatus(`湧き潰し報告エラー: ${error.message}`, "error");
    }
};

// 巻き戻し (revertMobStatus) - Callable 方式に修正済み (関数名とペイロードを最終調整)
const revertMobStatus = async (mobNo) => {
    const state = getState();
    const userId = state.userId;
    const mobs = state.mobs;

    if (!userId) {
        displayStatus("認証が完了していません。ページをリロードしてください。", "error");
        return;
    }

    const mob = mobs.find(m => m.No === mobNo);
    if (!mob) return;

    displayStatus(`${mob.Name} の状態を巻き戻し中...`, "warning");

    const data = {
        mob_id: mobNo.toString(),
        target_report_index: 'prev', // 確定履歴への巻き戻しを明示
    };

    try {
        const response = await callRevertStatus(data); // ★ 定義済みの V1 Callable を使用
        const result = response.data;

        if (result?.success) {
            displayStatus(`${mob.Name} の状態と湧き潰し時刻を直前の記録に巻き戻しました。`, "success");
        } else {
            displayStatus(
                `巻き戻し失敗: ${result?.error || "ログデータが見つからないか、巻き戻しに失敗しました。"}`,
                "error"
            );
        }
    } catch (error) {
        console.error("巻き戻しエラー:", error);
        displayStatus(`巻き戻しエラー: ${error.message}`, "error");
    }
};

export { initializeAuth, subscribeMobStatusDocs, subscribeMobLocations, submitReport, toggleCrushStatus, revertMobStatus, getServerTimeUTC };
