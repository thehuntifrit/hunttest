// firestore.js
import { db } from "./firebase.js";
import { getState } from "./store.js";
import { collection, addDoc, onSnapshot, doc } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

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
  const state = getState(); // ← store.js の state を参照
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

  const killTimeDate = new Date(timeISO);
  if (isNaN(killTimeDate)) {
    displayStatus("時刻形式が不正です。", "error");
    return;
  }

  DOMElements.modalStatus.textContent = "送信中...";
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
    DOMElements.modalStatus.textContent =
      "送信エラー: " + (error.message || "通信失敗");
    displayStatus(`LKT報告エラー: ${error.message || "通信失敗"}`, "error");
  }
};

// 湧き潰し報告
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

export {submitReport, toggleCrushStatus, subscribeMobStatusDocs, subscribeMobLocations};
