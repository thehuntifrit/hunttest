// modal.js
import { DOM } from "./uiShared.js";
import { displayStatus, toJstAdjustedIsoString } from "./utils.js";
import { addDoc, collection } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";
import { db } from "./firebase.js";
import { getState } from "./store.js";

function toLocalIsoString(date) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// モーダルを開く
function openReportModal(mobNo) {
  const mob = getState().mobs.find(m => m.No === mobNo);
  if (!mob) return;

  const iso = toLocalIsoString(new Date()); // JST補正ではなくローカル時刻をそのまま
  DOM.reportForm.dataset.mobNo = String(mobNo);
  DOM.modalMobName.textContent = `対象: ${mob.Name} (${mob.Area})`;
  DOM.modalTimeInput.value = iso;
  DOM.modalMemoInput.value = mob.last_kill_memo || "";
  DOM.modalMemoInput.placeholder = `任意`;
  DOM.modalStatus.textContent = "";
  DOM.reportModal.classList.remove("hidden");
  DOM.reportModal.classList.add("flex");
}

// モーダルを閉じる
function closeReportModal() {
  DOM.reportModal.classList.add("hidden");
  DOM.modalTimeInput.value = "";
  DOM.modalMemoInput.value = "";
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

export { openReportModal, closeReportModal, submitReport, toJstAdjustedIsoString };
