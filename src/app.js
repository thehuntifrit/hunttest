// app.js

import { loadBaseMobData, startRealtime, setOpenMobCardNo, getState } from "./dataManager.js";
import { initializeAuth, submitReport, getServerTimeUTC } from "./server.js";
import { openReportModal, initModal, openMemoModal } from "./modal.js";
import { renderRankTabs, handleAreaFilterClick, updateFilterUI } from "./filterUI.js";
import { DOM, sortAndRedistribute } from "./uiRender.js";
import { debounce } from "./cal.js";
import { initTooltip } from "./tooltip.js";

async function initializeApp() {
    try {
        // 0. ツールチップ初期化
        initTooltip();

        // 1. データロード
        await loadBaseMobData();
        console.log("Mob Data Loaded.");

        // 2. 認証 & リアルタイム開始
        const userId = await initializeAuth();
        if (userId) {
            console.log("Authenticated:", userId);
            startRealtime();
        } else {
            console.warn("Authentication failed or anonymous.");
        }

        // 3. UI初期化
        // Reset clickStep to 1 to ensure filters are closed on reload
        const storedUI = JSON.parse(localStorage.getItem("huntUIState")) || {};
        if (storedUI.clickStep !== 1) {
            storedUI.clickStep = 1;
            localStorage.setItem("huntUIState", JSON.stringify(storedUI));
        }

        renderRankTabs();
        updateFilterUI();
        initModal();

        // 4. メンテナンス表示 (dataManagerでロード済み)
        renderMaintenanceStatus();

        // 5. イベントリスナー設定
        attachGlobalEventListeners();

        // 6. ヘッダー高さ監視 (パディング調整)
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
        // 少し余裕を持たせる (+10px)
        main.style.paddingTop = `${headerHeight + 10}px`;
    };

    // 初回実行
    adjustPadding();

    // 監視開始
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
    // 1. Window Resize
    window.addEventListener("resize", debounce(() => sortAndRedistribute(), 200));

    // 2. Filter Clicks (Delegation)
    document.addEventListener("click", (e) => {
        // Rank Tabs
        if (e.target.closest(".tab-button")) {
            return;
        }

        // Area Filter
        if (e.target.closest(".area-filter-btn")) {
            handleAreaFilterClick(e);
            return;
        }
    });

    // 3. Card Clicks (Delegation)
    DOM.colContainer.addEventListener("click", (e) => {
        const card = e.target.closest(".mob-card");
        if (!card) return;

        const mobNo = parseInt(card.dataset.mobNo, 10);
        const rank = card.dataset.rank;

        // A. Report Button
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

        // B. Memo Edit
        const memoRow = e.target.closest("[data-action='edit-memo']");
        if (memoRow) {
            e.stopPropagation();
            const currentText = memoRow.querySelector("[data-last-memo]")?.textContent || "";
            openMemoModal(mobNo, currentText);
            return;
        }

        // C. Card Expand/Collapse (S Rank)
        if (e.target.closest("[data-toggle='card-header']")) {
            if (rank === "S") {
                toggleCardExpand(card, mobNo);
            }
        }
    });

    // 4. Report Form Submit
    if (DOM.reportForm) {
        DOM.reportForm.addEventListener("submit", handleReportSubmit);
    }
}

function toggleCardExpand(card, mobNo) {
    const panel = card.querySelector(".expandable-panel");
    if (panel) {
        if (!panel.classList.contains("open")) {
            // 他を閉じる
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
        const serverDateUTC = await getServerTimeUTC();
        const iso = serverDateUTC.toISOString();
        await submitReport(mobNo, iso, `${rank}ランク即時報告`);
    } catch (err) {
        console.error("Instant report failed:", err);
        const fallbackIso = new Date().toISOString();
        await submitReport(mobNo, fallbackIso, `${rank}ランク即時報告`);
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
