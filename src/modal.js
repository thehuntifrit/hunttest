// modal.js

import { DOM, displayStatus } from "./uiRender.js";
import { getState } from "./dataManager.js";
import { toJstAdjustedIsoString } from "./cal.js";

function toLocalIsoString(date) {
    const pad = n => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function openReportModal(mobNo) {
    const mob = getState().mobs.find(m => m.No === mobNo);
    if (!mob) return;

    const iso = toLocalIsoString(new Date());
    DOM.reportForm.dataset.mobNo = String(mobNo);
    DOM.modalMobName.textContent = `${mob.Name}`;
    DOM.modalTimeInput.value = iso;
    DOM.modalMemoInput.value = mob.last_kill_memo || "";
    DOM.modalMemoInput.placeholder = `任意`;
    DOM.modalStatus.textContent = "";
    DOM.reportModal.classList.remove("hidden");
    DOM.reportModal.classList.add("flex");
}

function closeReportModal() {
    DOM.reportModal.classList.add("hidden");
    DOM.reportModal.classList.remove("flex");
    DOM.modalTimeInput.value = "";
    DOM.modalMemoInput.value = "";
}

function setupModalCloseHandlers() {
    // 1. キャンセルボタン
    const cancelButton = document.getElementById("cancel-report");
    if (cancelButton) {
        cancelButton.addEventListener("click", closeReportModal);
    }
    // 2. 背景クリック
    DOM.reportModal.addEventListener("click", (e) => {
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
