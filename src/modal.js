// modal.js

import { DOM } from "./uiRender.js";
import { getState } from "./dataManager.js";
import { submitMemo } from "./server.js";

async function openReportModal(mobNo) {
    const mob = getState().mobs.find(m => m.No === mobNo);
    if (!mob) return;

    // 現在時刻（クライアント）を取得
    const now = new Date();
    const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16); // "YYYY-MM-DDTHH:mm"

    DOM.reportForm.dataset.mobNo = String(mobNo);
    DOM.modalMobName.textContent = `${mob.Name}`;
    DOM.modalTimeInput.value = localIso;

    DOM.reportModal.classList.remove("hidden");
    DOM.reportModal.classList.add("flex");
}

function closeReportModal() {
    DOM.reportModal.classList.add("hidden");
    DOM.reportModal.classList.remove("flex");
    DOM.modalTimeInput.value = "";
    DOM.modalStatus.textContent = "";
}

// --- Memo Modal ---
function openMemoModal(mobNo, currentText) {
    const modal = document.getElementById('memo-modal-container');
    const input = document.getElementById('modal-memo-input');
    const mobNoHidden = document.getElementById('modal-mob-no');

    if (!modal || !input || !mobNoHidden) return;

    input.value = currentText;
    mobNoHidden.value = mobNo;

    modal.classList.remove('hidden');

    setTimeout(() => {
        input.focus();
    }, 100);
}

function closeMemoModal() {
    const modal = document.getElementById('memo-modal-container');
    if (modal) modal.classList.add('hidden');
}

function initModal() {
    // Report Modal Handlers
    const cancelReportBtn = document.getElementById("cancel-report");
    if (cancelReportBtn) {
        cancelReportBtn.addEventListener("click", closeReportModal);
    }
    DOM.reportModal.addEventListener("click", (e) => {
        if (e.target === DOM.reportModal) {
            closeReportModal();
        }
    });

    // Memo Modal Handlers
    const memoModal = document.getElementById('memo-modal-container');
    const memoInput = document.getElementById('modal-memo-input');
    const memoSubmitBtn = document.getElementById('modal-memo-submit');
    const memoCancelBtn = document.getElementById('modal-memo-cancel');
    const memoMobNoHidden = document.getElementById('modal-mob-no');

    if (memoModal) {
        memoCancelBtn?.addEventListener('click', closeMemoModal);
        memoModal.addEventListener('click', (e) => {
            if (e.target === memoModal) closeMemoModal();
        });

        const handleMemoSubmit = async () => {
            const mobNo = Number(memoMobNoHidden.value);
            const text = memoInput.value;
            if (mobNo) {
                await submitMemo(mobNo, text);
            }
            closeMemoModal();
        };

        memoSubmitBtn?.addEventListener('click', handleMemoSubmit);

        memoInput?.addEventListener('keydown', (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleMemoSubmit();
            }
        });
    }

    // Global Keydown
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            if (!DOM.reportModal.classList.contains("hidden")) closeReportModal();
            if (memoModal && !memoModal.classList.contains("hidden")) closeMemoModal();
        }
    });
}

export { openReportModal, closeReportModal, initModal, openMemoModal };
