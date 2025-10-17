// modal.js
import { DOM } from "./uiShared.js";
import { displayStatus } from "./utils.js";
import { addDoc, collection } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { db } from "./firebase.js";
import { getState } from "./store.js";

function toJstAdjustedIsoString(date) {
  const offsetMs = date.getTimezoneOffset() * 60000;
  const jstOffsetMs = 9 * 60 * 60 * 1000;
  const jstTime = date.getTime() - offsetMs + jstOffsetMs;
  return new Date(jstTime).toISOString().slice(0, 16);
}

function openReportModal(mobNo) {
  const DOM = getDOMElements();
  const mob = getState().mobs.find(m => m.No === mobNo);
  if (!mob) return;
  const iso = toJstAdjustedIsoString(new Date());
  DOM.reportForm.dataset.mobNo = String(mobNo);
  DOM.modalMobName.textContent = `対象: ${mob.Name} (${mob.Area})`;
  DOM.modalTimeInput.value = iso;
  DOM.modalMemoInput.value = mob.last_kill_memo || "";
  DOM.modalMemoInput.placeholder = `LKTとして記録されます。例: ${mob.Area} (X:00.0, Y:00.0) // ログアウトします`;
  DOM.modalStatus.textContent = "";
  DOM.reportModal.classList.remove("hidden");
  DOM.reportModal.classList.add("flex");
}

async function submitReport(mobNo, timeISO, memo) {
  const DOM = getDOMElements();
  const { userId, mobs } = getState();
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
  DOM.modalStatus.textContent = "送信中...";
  displayStatus(`${mob.Name} 討伐時間報告中...`);
  try {
    await addDoc(collection(db, "reports"), {
      mob_id: mobNo.toString(),
      kill_time: killTimeDate,
      reporter_uid: userId,
      memo,
      repop_seconds: mob.REPOP_s
    });
    closeReportModal();
    displayStatus("報告が完了しました。データ反映を待っています。", "success");
  } catch (err) {
    DOM.modalStatus.textContent = `送信エラー: ${err.message || "通信失敗"}`;
    displayStatus(`LKT報告エラー: ${err.message || "通信失敗"}`, "error");
  }
}

export const DOMElements = {
  reportSubmitBtn: document.getElementById("report-submit"),
  reportModal: document.getElementById("report-modal"),
  reportTimeInput: document.getElementById("report-time"),
  reportMemoInput: document.getElementById("report-memo"),
  mobList: document.getElementById("mob-list")
};

const closeReportModal = () => {
  const DOMElements = getDOMElements();
  DOMElements.reportModal.classList.add("hidden");
  DOMElements.reportTimeInput.value = "";
  DOMElements.reportMemoInput.value = "";
};

export { openReportModal, closeReportModal, submitReport, toJstAdjustedIsoString };
