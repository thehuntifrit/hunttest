// server.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getFirestore, collection, onSnapshot, addDoc, doc } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-functions.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-analytics.js";

import { getState, setFilter, setOpenMobCardNo, FILTER_TO_DATA_RANK_MAP } from "./dataManager.js"; 
import { closeReportModal } from "./modal.js";
import { displayStatus } from "./uiRender.js";

// 初期化と設定
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
const functionsInstance = getFunctions(app, "asia-northeast1");
const analytics = getAnalytics(app);

const functions = functionsInstance;
const callUpdateCrushStatus = httpsCallable(functions, 'crushStatusUpdater');
const callRevertStatus = httpsCallable(functions, 'revertStatus');
const callGetServerTime = httpsCallable(functions, 'getServerTime');

// 認証
async function initializeAuth() {
    return new Promise((resolve) => {
        onAuthStateChanged(auth, (user) => {
            if (user) {
                resolve(user.uid);
            } else {
                signInAnonymously(auth).catch(() => { }).then(() => { });
            }
        });
    });
}

// サーバーUTC取得
async function getServerTimeUTC() {
    const getServerTime = httpsCallable(functionsInstance, "getServerTime");
    const response = await getServerTime();
    return new Date(response.data.utc_now); // UTC基準
}

// データ購読
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

function subscribeMobLocations(onUpdate) {
    const unsub = onSnapshot(collection(db, "mob_locations"), snapshot => {
        const map = {};
        snapshot.forEach(docSnap => {
            const mobNo = parseInt(docSnap.id, 10);
            const data = docSnap.data();
            map[mobNo] = { points: data.points || {} };
        });
        onUpdate(map);
    });
    return unsub;
}

// 討伐報告
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

    const killTimeDate = await getServerTimeUTC();

    const modalStatusEl = document.querySelector("#modal-status");
    if (modalStatusEl) {
        modalStatusEl.textContent = "送信中...";
    }
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
        if (modalStatusEl) {
            modalStatusEl.textContent = "送信エラー: " + (error.message || "通信失敗");
        }
        displayStatus(`LKT報告エラー: ${error.message || "通信失敗"}`, "error");
    }
};

// 湧き潰し報告 (toggleCrushStatus)
const toggleCrushStatus = async (mobNo, locationId, isCurrentlyCulled) => {
    const state = getState();
    const userId = state.userId;
    const mobs = state.mobs;

    if (!userId) {
        displayStatus("認証が完了していません。", "error");
        return;
    }

    const action = isCurrentlyCulled ? "uncrush" : "crush";
    const mob = mobs.find(m => m.No === mobNo);
    if (!mob) return;

    displayStatus(
        `${mob.Name} (${locationId}) ${action === "crush" ? "湧き潰し" : "解除"}報告中...`
    );

    try {
        const result = await callUpdateCrushStatus({
            mob_id: mobNo.toString(),
            point_id: locationId,
            type: action === "crush" ? "add" : "remove",
            userId: userId
        });

        if (result.data?.success) {
            displayStatus(`${mob.Name} の状態を更新しました。`, "success");
        } else {
            displayStatus(
                `更新失敗: ${result.data?.message || "不明なエラー"}`,
                "error"
            );
        }
    } catch (error) {
        displayStatus(`湧き潰し報告エラー: ${error.message}`, "error");
    }
};

// 巻き戻し (revertMobStatus)
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

    try {
        const result = await callRevertStatus({
            mob_id: mobNo.toString(),
        });

        if (result.data?.success) {
            displayStatus(`${mob.Name} の状態を直前のログへ巻き戻しました。`, "success");
        } else {
            displayStatus(
                `巻き戻し失敗: ${result.data?.message || "ログデータが見つからないか、巻き戻しに失敗しました。"}`,
                "error"
            );
        }
    } catch (error) {
        console.error("巻き戻しエラー:", error);
        displayStatus(`巻き戻しエラー: ${error.message}`, "error");
    }
};

export { initializeAuth, subscribeMobStatusDocs, subscribeMobLocations, submitReport, toggleCrushStatus, revertMobStatus, getServerTimeUTC };
