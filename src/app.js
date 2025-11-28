// app.js

import { loadBaseMobData, startRealtime, setOpenMobCardNo, getState, setUserId } from "./dataManager.js";
import { initializeAuth, submitReport, submitMemo } from "./server.js";
import { openReportModal, initModal } from "./modal.js";
import { renderRankTabs, handleAreaFilterClick, updateFilterUI } from "./filterUI.js";
import { DOM, sortAndRedistribute } from "./uiRender.js";
import { debounce } from "./cal.js";
import { initTooltip } from "./tooltip.js";

async function initializeApp() {
    try {
        initTooltip();
        await loadBaseMobData();
        console.log("Mob Data Loaded.");

        const userId = await initializeAuth();
        if (userId) {
            console.log("Authenticated:", userId);
            setUserId(userId);
            startRealtime();
        } else {
            console.warn("Authentication failed or anonymous.");
        }

        const storedUI = JSON.parse(localStorage.getItem("huntUIState")) || {};
        if (storedUI.clickStep !== 1) {
            storedUI.clickStep = 1;
            localStorage.setItem("huntUIState", JSON.stringify(storedUI));
        }

        renderRankTabs();
        updateFilterUI();
        initModal();
        renderMaintenanceStatus();
        attachGlobalEventListeners();
        initHeaderObserver();

    } catch (e) {
        console.error("App initialization failed:", e);
    }
}

function initHeaderObserver() {
    const header = document.getElementById("main-header");
    const main = document.querySelector("main");
    if (!header || !main) return;

    const adjustPadding = () => {
        const headerHeight = header.offsetHeight;
        main.style.paddingTop = `${headerHeight + 10}px`;
    };
    adjustPadding();
    const resizeObserver = new ResizeObserver(() => {
        adjustPadding();
    });
    resizeObserver.observe(header);
}

function renderMaintenanceStatus() {
    const maintenance = getState().maintenance;
    if (!maintenance) return;

    const start = new Date(maintenance.start);
    const end = new Date(maintenance.end);
    const serverUp = new Date(maintenance.serverUp);
    const now = new Date();

    const showFrom = new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000);
    const showUntil = new Date(end.getTime() + 4 * 24 * 60 * 60 * 1000);

    if (now >= showFrom && now <= showUntil) {
        const el = document.getElementById("status-message-maintenance");
        if (el) {
            el.innerHTML = `
           <div class="font-semibold text-yellow-300">
            メンテナンス予定: ${formatDate(start)} ～ ${formatDate(end)}
           </div>
          `;
            document.getElementById("status-message")?.classList.remove("hidden");
        }
    }
}

function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}/${m}/${d} ${h}:${min}`;
}

function attachGlobalEventListeners() {
    let prevWidth = window.innerWidth;
    window.addEventListener("resize", debounce(() => {
        const currentWidth = window.innerWidth;
        if (currentWidth !== prevWidth) {
            prevWidth = currentWidth;
            sortAndRedistribute();
        }
    }, 200));

    document.addEventListener("click", (e) => {
        if (e.target.closest(".tab-button")) {
            return;
        }
        if (e.target.closest(".area-filter-btn")) {
            handleAreaFilterClick(e);
            return;
        }
    });

    DOM.colContainer.addEventListener("click", (e) => {
        const card = e.target.closest(".mob-card");
        if (!card) return;

        const mobNo = parseInt(card.dataset.mobNo, 10);
        const rank = card.dataset.rank;

        const reportBtn = e.target.closest("button[data-report-type]");
        if (reportBtn) {
            e.stopPropagation();
            const type = reportBtn.dataset.reportType;
            if (type === "modal") {
                openReportModal(mobNo);
            } else if (type === "instant") {
                handleInstantReport(mobNo, rank);
            }
            return;
        }

        if (e.target.closest("[data-toggle='card-header']")) {
            if (rank === "S") {
                toggleCardExpand(card, mobNo);
            }
        }
    });

    if (DOM.reportForm) {
        DOM.reportForm.addEventListener("submit", handleReportSubmit);
    }

    document.addEventListener("change", async (e) => {
        if (e.target.matches("input[data-action='save-memo']")) {
            const input = e.target;
            const mobNo = parseInt(input.dataset.mobNo, 10);
            const text = input.value;

            await submitMemo(mobNo, text);
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.target.matches("input[data-action='save-memo']")) {
            if (e.key === "Enter") {
                e.target.blur();
            }
            e.stopPropagation();
        }
    });

    document.addEventListener("click", (e) => {
        if (e.target.matches("input[data-action='save-memo']")) {
            e.stopPropagation();
        }
    });
}

function toggleCardExpand(card, mobNo) {
    const panel = card.querySelector(".expandable-panel");
    if (panel) {
        if (!panel.classList.contains("open")) {
            document.querySelectorAll(".expandable-panel.open").forEach(p => {
                if (p.closest(".mob-card") !== card) p.classList.remove("open");
            });
            panel.classList.add("open");
            setOpenMobCardNo(mobNo);
        } else {
            panel.classList.remove("open");
            setOpenMobCardNo(null);
        }
    }
}

async function handleInstantReport(mobNo, rank) {
    try {
        const now = new Date();
        const iso = now.toISOString();
        await submitReport(mobNo, iso);
    } catch (err) {
        console.error("Instant report failed:", err);
        const fallbackIso = new Date().toISOString();
        await submitReport(mobNo, fallbackIso);
    }
}

async function handleReportSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const mobNo = parseInt(form.dataset.mobNo, 10);
    const timeISO = form.elements["kill-time"].value;

    await submitReport(mobNo, timeISO);
}

document.addEventListener('DOMContentLoaded', initializeApp);

export { initializeApp };
