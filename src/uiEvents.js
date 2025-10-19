// uiEvents.js
import { state, getState, setFilter, setOpenMobCardNo } from "./store.js";
import { renderRankTabs, renderAreaFilterPanel, sortAndRedistribute, toggleAreaFilterPanel } from "./filter.js";
import { DOMElements, openReportModal, closeReportModal, toJstAdjustedIsoString } from "./modal.js";
import { DOM, FILTER_TO_DATA_RANK_MAP } from "./uiShared.js";
import { submitReport, toggleCrushStatus } from "./firestore.js";
import { debounce } from "./utils.js";
import { filterAndRender } from "./uiRender.js";

renderRankTabs(); // 初期化時に呼び出し

function attachEventListeners() {
  // Rank tabs
  DOM.rankTabs.addEventListener("click", e => {
    const btn = e.target.closest(".tab-button");
    if (!btn) return;
    const newRank = btn.dataset.rank.toUpperCase();
    const state = getState();
    let clickCount = parseInt(btn.dataset.clickCount || 0, 10);

    if (newRank !== state.filter.rank) {
      setFilter({
        rank: newRank,
        areaSets: {
          ...state.filter.areaSets,
          [newRank]: state.filter.areaSets[newRank] instanceof Set ? state.filter.areaSets[newRank] : new Set()
        }
      });
      clickCount = 1;
      toggleAreaFilterPanel(true);
      filterAndRender({ isInitialLoad: true });
    } else {
      if (newRank === "ALL") {
        toggleAreaFilterPanel(true);
        clickCount = 0;
      } else {
        clickCount = (clickCount % 3) + 1;
        if (clickCount === 2) toggleAreaFilterPanel(false);
        else if (clickCount === 3) {
          toggleAreaFilterPanel(true);
          clickCount = 0;
        }
      }
    }
    btn.dataset.clickCount = String(clickCount);
  });

  // Area filter
  DOM.areaFilterPanel.addEventListener("click", e => {
    const btn = e.target.closest(".area-filter-btn");
    if (!btn) return;
    const state = getState();
    const uiRank = state.filter.rank;
    const dataRank = FILTER_TO_DATA_RANK_MAP[uiRank] || uiRank;
    const currentSet = state.filter.areaSets[uiRank] instanceof Set ? state.filter.areaSets[uiRank] : new Set();

    if (btn.dataset.area === "ALL") {
      const allAreas = Array.from(
        state.mobs
          .filter(m => (dataRank === "A" || dataRank === "F") ? (m.Rank === dataRank || m.Rank.startsWith("B")) : (m.Rank === dataRank))
          .reduce((set, m) => {
            const mobExpansion = m.Rank.startsWith("B")
              ? state.mobs.find(x => x.No === m.related_mob_no)?.Expansion || m.Expansion
              : m.Expansion;
            if (mobExpansion) set.add(mobExpansion);
            return set;
          }, new Set())
      );
      const nextSet = (currentSet.size === allAreas.length) ? new Set() : new Set(allAreas);
      setFilter({ areaSets: { ...state.filter.areaSets, [uiRank]: nextSet } });
    } else {
      const area = btn.dataset.area;
      if (currentSet.has(area)) currentSet.delete(area);
      else currentSet.add(area);
      setFilter({ areaSets: { ...state.filter.areaSets, [uiRank]: new Set(currentSet) } });
    }

    renderAreaFilterPanel();
    sortAndRedistribute(); // debounce内でfilterAndRenderが呼ばれる
  });

  // Column container delegation (report/map/card header)
  DOM.colContainer.addEventListener("click", e => {
    const card = e.target.closest(".mob-card");
    if (!card) return;
    const mobNo = parseInt(card.dataset.mobNo, 10);
    const rank = card.dataset.rank;

    // Report buttons
    const reportBtn = e.target.closest("button[data-report-type]");
    if (reportBtn) {
      e.stopPropagation();
      const type = reportBtn.dataset.reportType;
      if (type === "modal") {
        openReportModal(mobNo);
      } else if (type === "instant") {
        const iso = toJstAdjustedIsoString(new Date());
        submitReport(mobNo, iso, `${rank}ランク即時報告`);
      }
      return;
    }

    // 湧き潰しボタンのクリック処理
    const point = e.target.closest(".spawn-point");
    if (point && point.dataset.isInteractive === "true") {
      e.preventDefault();
      e.stopPropagation();
      const locationId = point.dataset.locationId;
      const isCurrentlyCulled = point.dataset.isCulled === "true";
      toggleCrushStatus(mobNo, locationId, isCurrentlyCulled);
      return;
    }

    // Expand/collapse
    if (e.target.closest("[data-toggle='card-header']")) {
      if (rank === "S" || rank === "A" || rank === "F") {
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
    }
  });

  // Modal cancel and submit
  document.getElementById("cancel-report").addEventListener("click", closeReportModal);
  DOM.reportForm.addEventListener("submit", e => {
    e.preventDefault();
    const mobNo = parseInt(DOM.reportForm.dataset.mobNo, 10);
    const datetime = DOM.modalTimeInput.value;
    const memo = DOM.modalMemoInput.value;
    submitReport(mobNo, datetime, memo);
  });

  // Resize
  window.addEventListener("resize", debounce(() => sortAndRedistribute(), 200));
}

// 討伐報告モーダルの送信ボタン
document.addEventListener("DOMContentLoaded", () => {
    const DOM = DOMElements;
  DOM.reportSubmitBtn?.addEventListener("click", () => {
    const mobNo = parseInt(DOM.reportModal.dataset.mobNo, 10);
    const timeISO = DOM.reportTimeInput.value;
    const memo = DOM.reportMemoInput.value;

    submitReport(mobNo, timeISO, memo)
      .then(() => closeReportModal())
      .catch(err => console.error("報告送信エラー:", err));
  });

  // 湧き潰しボタンのクリック処理
  DOM.mobList?.addEventListener("click", e => {
    if (e.target.classList.contains("crush-toggle")) {
      const mobNo = parseInt(e.target.dataset.mobNo, 10);
      const locationId = e.target.dataset.locationId;
      const isCurrentlyCulled = e.target.classList.contains("culled");

      toggleCrushStatus(mobNo, locationId, isCurrentlyCulled)
        .catch(err => console.error("湧き潰し更新エラー:", err));
    }
  });
});

export { attachEventListeners };
