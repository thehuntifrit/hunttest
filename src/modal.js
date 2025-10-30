import { DOM, displayStatus } from "./uiRender.js";
import { getState } from "./dataManager.js";
import { getServerTimeUTC } from "./server.js";

async function openReportModal(mobNo) {
    const mob = getState().mobs.find(m => m.No === mobNo);
    if (!mob) return;

    // サーバーUTC時刻を取得
    const serverDateUTC = await getServerTimeUTC();
    const localIso = new Date(serverDateUTC.getTime() - serverDateUTC.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16); // "YYYY-MM-DDTHH:mm"

    DOM.reportForm.dataset.mobNo = String(mobNo);
    DOM.modalMobName.textContent = `${mob.Name}`;
    DOM.modalTimeInput.value = localIso;
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
    const cancelButton = document.getElementById("cancel-report");
    if (cancelButton) {
        cancelButton.addEventListener("click", closeReportModal);
    }
    DOM.reportModal.addEventListener("click", (e) => {
        if (e.target === DOM.reportModal) {
            closeReportModal();
        }
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !DOM.reportModal.classList.contains("hidden")) {
            closeReportModal();
        }
    });
}

function initModal() {
    setupModalCloseHandlers();
}

export { openReportModal, closeReportModal, initModal };
