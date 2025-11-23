// server.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getFirestore, collection, onSnapshot, addDoc, doc } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-functions.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-analytics.js";

import { getState } from "./dataManager.js";
import { closeReportModal } from "./modal.js";
import { displayStatus } from "./uiRender.js";
import { updateCrushUI } from "./location.js";

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBikwjGsjL_PVFhx3Vj-OeJCocKA_hQOgU",
    authDomain: "the-hunt-ifrit.firebaseapp.com",
    projectId: "the-hunt-ifrit",
    storageBucket: "the-hunt-ifrit.firebasestorage.app",
    messagingSenderId: "285578581189",
    appId: "1:285578581189:web:4d9826ee3f988a7519ccac"
};

const app = initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);
const auth = getAuth(app);
const DEFAULT_FUNCTIONS_REGION = "us-central1";
const functionsInstance = getFunctions(app, DEFAULT_FUNCTIONS_REGION);
const analytics = getAnalytics(app);

const callGetServerTime = httpsCallable(functionsInstance, 'getServerTimeV1');
const callMobCullUpdater = httpsCallable(functionsInstance, 'mobCullUpdaterV1');
const callPostMobMemo = httpsCallable(functionsInstance, 'postMobMemoV1');

// 認証
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

// サーバーUTC取得
async function getServerTimeUTC() {
    try {
        const response = await callGetServerTime();
        if (response.data && typeof response.data.serverTimeMs === 'number') {
            return new Date(response.data.serverTimeMs);
        } else {
            console.error("サーバー時刻取得エラー: serverTimeMs が不正です。", response.data);
            return new Date();
        }
    } catch (error) {
        console.error("サーバー時刻取得失敗:", error);
        return new Date();
    }
}

// データ購読 (Mob Status)
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

// データ購読 (shared_data/memo)
function subscribeMobMemos(onUpdate) {
    const memoDocRef = doc(db, "shared_data", "memo");
    const unsub = onSnapshot(memoDocRef, snap => {
        const data = snap.data() || {};
        onUpdate(data);
    });
    return unsub;
}

// Mob Location関連
function normalizePoints(data) {
    const result = {};
    for (const [key, value] of Object.entries(data)) {
        if (key.startsWith("points.")) {
            const [, locId, field] = key.split(".");
            if (!result[locId]) result[locId] = {};
            result[locId][field] = value;
        }
    }
    return result;
}

// データ購読 (Mob Locations)
function subscribeMobLocations(onUpdate) {
    const unsub = onSnapshot(collection(db, "mob_locations"), snapshot => {
        const map = {};
        snapshot.forEach(docSnap => {
            const mobNo = parseInt(docSnap.id, 10);
            const data = docSnap.data();
            const normalized = normalizePoints(data);
            map[mobNo] = normalized;
        });
        onUpdate(map);
    });
    return unsub;
}

// 討伐報告
const submitReport = async (mobNo, timeISO) => {
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

    let killTimeDate;
    if (timeISO && typeof timeISO === "string") {
        const m = timeISO.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
        if (m) {
            const [, y, mo, d, h, mi, s] = m;
            killTimeDate = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), s ? Number(s) : 0, 0);
        } else {
            const modalDate = new Date(timeISO);
            if (!isNaN(modalDate.getTime())) {
                killTimeDate = modalDate;
            }
        }
    }

    if (!killTimeDate) {
        killTimeDate = await getServerTimeUTC();
    }

    const modalStatusEl = document.querySelector("#modal-status");
    if (modalStatusEl) modalStatusEl.textContent = "送信中...";
    displayStatus(`${mob.Name} 討伐時間報告中...`);

    try {
        await addDoc(collection(db, "reports"), {
            mob_id: mobNo.toString(),
            kill_time: killTimeDate,
            reporter_uid: userId,
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

// メモの投稿
const submitMemo = async (mobNo, memoText) => {
    const state = getState();
    const userId = state.userId;
    const mobs = state.mobs;

    if (!userId) {
        displayStatus("認証が完了していません。", "error");
        return { success: false, error: "認証エラー" };
    }

    const mob = mobs.find(m => m.No === mobNo);
    if (!mob) {
        displayStatus("モブデータが見つかりません。", "error");
        return { success: false, error: "Mobデータエラー" };
    }

    displayStatus(`${mob.Name} のメモを投稿中...`, "warning");

    const data = {
        mob_id: mobNo.toString(),
        memo_text: memoText
    };

    try {
        const response = await callPostMobMemo(data);
        const result = response.data;

        if (result?.success) {
            displayStatus(`メモを正常に投稿しました。`, "success");
            return { success: true };
        } else {
            const errorMessage = result?.error || "Functions内部でエラーが発生しました。";
            console.error("メモ投稿エラー:", result);
            displayStatus(`メモ投稿エラー: ${errorMessage}`, "error");
            return { success: false, error: errorMessage };
        }
    } catch (error) {
        console.error("メモ投稿エラー:", error);
        const userFriendlyError = error.message || "通信または認証に失敗しました。";
        displayStatus(`致命的な通信エラー: ${userFriendlyError}`, "error");
        return { success: false, error: userFriendlyError };
    }
};

// 湧き潰し報告
const toggleCrushStatus = async (mobNo, locationId, nextCulled) => {
    const state = getState();
    const userId = state.userId;
    const mobs = state.mobs;

    if (!userId) {
        displayStatus("認証が完了していません。", "error");
        return;
    }
    const action = nextCulled ? "CULL" : "UNCULL";
    const mob = mobs.find(m => m.No === mobNo);
    if (!mob) return;

    displayStatus(
        `${mob.Name} (${locationId}) ${nextCulled ? "湧き潰し" : "解除"}報告中...`,
        "warning"
    );

    const reportTimeDate = new Date();
    const data = {
        mob_id: mobNo.toString(),
        location_id: locationId.toString(),
        action: action,
        report_time: reportTimeDate.toISOString(),
    };

    try {
        const response = await callMobCullUpdater(data);
        const result = response.data;

        if (result?.success) {
            displayStatus(`${mob.Name} の状態を更新しました。`, "success");
            updateCrushUI(mobNo, locationId, nextCulled);
        } else {
            const errorMessage = result?.error || "Functions内部でエラーが発生しました。";
            console.error("湧き潰し報告エラー:", errorMessage);
            displayStatus(`湧き潰し報告エラー: ${errorMessage}`, "error");
        }

    } catch (error) {
        console.error("湧き潰し報告エラー:", error);
        const userFriendlyError = error.message || "通信または認証に失敗しました。";
        displayStatus(`致命的な通信エラー: ${userFriendlyError}`, "error");
    }
};

export {
    initializeAuth,
    subscribeMobStatusDocs,
    subscribeMobLocations,
    subscribeMobMemos,
    submitReport,
    submitMemo,
    toggleCrushStatus,
    getServerTimeUTC
};
