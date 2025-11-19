// server.js (修正版 - PC/スマホ互換性強化 + メモ機能追加)

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getFirestore, collection, onSnapshot, addDoc, doc, setDoc, updateDoc, increment, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-functions.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-analytics.js";

import { getState } from "./dataManager.js";
import { closeReportModal } from "./modal.js";
import { displayStatus } from "./uiRender.js";
import { isCulled, updateCrushUI } from "./location.js";

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
const callRevertStatus = httpsCallable(functionsInstance, 'revertStatusV1');
const callMobCullUpdater = httpsCallable(functionsInstance, 'mobCullUpdaterV1');
const callPostMobMemo = httpsCallable(functionsInstance, 'postMobMemoV1');
const callGetMobMemos = httpsCallable(functionsInstance, 'getMobMemosV1');

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

onAuthStateChanged(auth, (user) => {
    if (user) {
        console.log("UID:", user.uid);
    } else {
        console.log("まだ認証されていません");
    }
});

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
        console.error("サーバー時刻取得のためのFunctions呼び出しに失敗しました:", error);
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
    const memoDocRef = doc(db, "shared_data", "memo"); // 'shared_data/memo' を参照
    
    const unsub = onSnapshot(memoDocRef, snap => {
        const data = snap.data() || {};
        // 取得した MobNoごとのメモ配列をそのまま渡す
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

// 討伐報告 (reportsコレクションへの直接書き込み)
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

    let killTimeDate;

    // 時刻解析ロジック
    if (timeISO && typeof timeISO === "string") {
        const m = timeISO.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
        if (m) {
            const [, y, mo, d, h, mi, s] = m;
            const year = Number(y);
            const monthIndex = Number(mo) - 1; // JS の月は 0 始まり
            const day = Number(d);
            const hour = Number(h);
            const minute = Number(mi);
            const second = s ? Number(s) : 0;
            // ローカルタイムとして Date を生成
            killTimeDate = new Date(year, monthIndex, day, hour, minute, second, 0);
        } else {
            // ISO 完全形式（タイムゾーン付き）の場合はそのまま解釈
            const modalDate = new Date(timeISO);
            if (!isNaN(modalDate.getTime())) {
                killTimeDate = modalDate;
            }
        }
    }

    if (!killTimeDate) {
        // fallback としてサーバー時刻を取得
        killTimeDate = await getServerTimeUTC();
    }

    const modalStatusEl = document.querySelector("#modal-status");
    if (modalStatusEl) modalStatusEl.textContent = "送信中...";
    displayStatus(`${mob.Name} 討伐時間報告中...`);

    try {
        await addDoc(collection(db, "reports"), {
            mob_id: mobNo.toString(),
            kill_time: killTimeDate, // Firestore では Timestamp として保存される
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

// メモの投稿 (postMobMemoV1 Functions への呼び出し)
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
        // Functionsへの呼び出し
        const response = await callPostMobMemo(data);
        const result = response.data;
        
        if (result?.success) {
            displayStatus(`メモを正常に投稿しました。`, "success");
            return { success: true };
        } else {
            const errorMessage = result?.error || "Functions内部でエラーが発生しました。";
            console.error("メモ投稿エラー (Functions内部):", errorMessage);
            displayStatus(`メモ投稿エラー: ${errorMessage}`, "error");
            return { success: false, error: errorMessage };
        }
    } catch (error) {
        console.error("メモ投稿エラー (通信レベル):", error);
        const userFriendlyError = error.message || "通信または認証に失敗しました。";
        displayStatus(`致命的な通信エラー: ${userFriendlyError}`, "error");
        return { success: false, error: userFriendlyError };
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

// MobごとのメモUI制御
function setupMobMemoUI(mobNo, killTime) {
  const card = document.querySelector(`.mob-card[data-mob-no="${mobNo}"]`);
  if (!card) return;

  let memoDiv = card.querySelector("[data-last-memo]");
  if (!memoDiv) return;

  if (card.hasAttribute("data-memo-initialized")) return;
  card.setAttribute("data-memo-initialized", "true");
  // contenteditable を常設
  memoDiv.setAttribute("contenteditable", "true");
  memoDiv.className = "memo-editable text-gray-300 text-sm w-full min-h-[1.5rem] px-2";
  memoDiv.style.outline = "none";
  memoDiv.style.borderRadius = "4px";

  // Firestore購読で最新メモを反映（編集中は更新しない）
  const unsub = subscribeMobMemos((data) => {
    // 【💡修正点：setTimeoutで非同期にし、フォーカス処理が完了するのを待つ】
    setTimeout(() => {
      // 購読データが流れてきた時点で、編集フラグが付与されていれば処理を中断
      if (card.getAttribute("data-editing") === "true") return; 

      const memos = data[mobNo] || [];
      const latest = memos[0];
      const postedAt = latest?.created_at?.toMillis ? latest.created_at.toMillis() : 0;
            // 内容の更新。現在の内容と異なるときのみDOMを更新することで、不要なレンダリングを防ぐ
      const newText = postedAt < killTime.getTime() ? "" : (latest?.memo_text || "");
      if (memoDiv.textContent !== newText) {
        memoDiv.textContent = newText;
      }
      
    }, 50); // 50ミリ秒程度の遅延 (この値は環境によって調整が必要かもしれません)
  });
  // フォーカス時に編集中フラグを付与
  memoDiv.addEventListener("focus", () => {
    card.setAttribute("data-editing", "true");
  });
  // blur では finalize を呼ばず、編集中フラグだけ解除
  memoDiv.addEventListener("blur", () => {
    card.removeAttribute("data-editing");
  });
  // Enterキーで確定（スマホIMEでも安定）
  memoDiv.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      await submitMemo(mobNo, memoDiv.textContent);
      card.removeAttribute("data-editing");
      // 確定後、キーボードを閉じるためにblurを呼ぶ
      memoDiv.blur(); 
    }
  });
}

// 湧き潰し報告 (変更なし)
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
        "warning" // 処理中のステータスを表示
    );
    // report_time にクライアント時刻を使用
    const reportTimeDate = new Date();
    // サーバー側が期待するデータ構造
    const data = {
        mob_id: mobNo.toString(),
        location_id: locationId.toString(),
        action: action,
        report_time: reportTimeDate.toISOString(), // DateオブジェクトをISO形式で送信
    };

    try {
        // Functionsへの呼び出し
        const response = await callMobCullUpdater(data);
        const result = response.data;

        if (result?.success) {
            displayStatus(`${mob.Name} の状態を更新しました。`, "success");
            // 成功時にUIを即時更新
            updateCrushUI(mobNo, locationId, nextCulled);
        } else {
            const errorMessage = result?.error || "Functions内部でエラーが発生しました。";
            console.error("湧き潰し報告エラー (Functions内部):", errorMessage);
            displayStatus(`湧き潰し報告エラー: ${errorMessage}`, "error");
        }

    } catch (error) {
        console.error("湧き潰し報告エラー (通信レベル):", error);
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
    setupMobMemoUI,
    toggleCrushStatus, 
    getServerTimeUTC 
};
