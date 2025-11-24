// modal.js

import { DOM as UiDOM } from "./uiRender.js";
import { getState } from "./dataManager.js";


async function openReportModal(mobNo) {
    const mob = getState().mobs.find(m => m.No === mobNo);
    if (!mob) return;

    // 現在時刻（クライアント）を取得
    const now = new Date();
    const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16); // "YYYY-MM-DDTHH:mm"

    UiDOM.reportForm.dataset.mobNo = String(mobNo);
    UiDOM.modalMobName.textContent = `${mob.Name}`;
    UiDOM.modalTimeInput.value = localIso;

    UiDOM.reportModal.classList.remove("hidden");
    UiDOM.reportModal.classList.add("flex");
}

function closeReportModal() {
    UiDOM.reportModal.classList.add("hidden");
    UiDOM.reportModal.classList.remove("flex");
    UiDOM.modalTimeInput.value = "";
    UiDOM.modalStatus.textContent = "";
}

function initModal() {
    // Report Modal Handlers
    const cancelReportBtn = document.getElementById("cancel-report");
    if (cancelReportBtn) {
        cancelReportBtn.addEventListener("click", closeReportModal);
    }
    UiDOM.reportModal.addEventListener("click", (e) => {
        if (e.target === UiDOM.reportModal) {
            closeReportModal();
        }
    });

    // Global Keydown
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            if (!UiDOM.reportModal.classList.contains("hidden")) closeReportModal();
        }
    });
}

export { openReportModal, closeReportModal, initModal };
