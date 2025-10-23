// modal.js
import { DOM, displayStatus } from "./uiRender.js"; 
import { getState } from "./dataManager.js";
import { toJstAdjustedIsoString } from "./cal.js";

function toLocalIsoString(date) {
  const pad = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// モーダルを開く (責務: openReportModal)
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

// モーダルを閉じる (責務: closeReportModal)
function closeReportModal() {
  DOM.reportModal.classList.add("hidden");
  DOM.reportModal.classList.remove("flex");
  DOM.modalTimeInput.value = "";
  DOM.modalMemoInput.value = "";
}

// モーダルを閉じるイベントハンドラを設定する
function setupModalCloseHandlers() {
  // 1. キャンセルボタン
  const cancelButton = document.getElementById("cancel-report");
  if (cancelButton) {
    cancelButton.addEventListener("click", closeReportModal);
  }

  // 2. 背景クリック
  DOM.reportModal.addEventListener("click", (e) => {
    // クリックされた要素がモーダルウィンドウ（背景）自体であるかを確認
    if (e.target === DOM.reportModal) {
      closeReportModal();
    }
  });

  // 3. Escapeキー
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !DOM.reportModal.classList.contains("hidden")) {
      closeReportModal();
    }
  });
}

// 初期化関数
function initModal() {
  setupModalCloseHandlers();
}

export { openReportModal, closeReportModal, toLocalIsoString, initModal };
