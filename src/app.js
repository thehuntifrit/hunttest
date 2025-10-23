// app.js
import { getState, setFilter, loadBaseMobData, setOpenMobCardNo, FILTER_TO_DATA_RANK_MAP } from "./dataManager.js"; 
import { openReportModal, closeReportModal, initModal } from "./modal.js"; 
import { attachLocationEvents } from "./location.js"; 
import { submitReport, toggleCrushStatus } from "./server.js"; 
import { debounce, toJstAdjustedIsoString, } from "./cal.js"; 
import { DOM, filterAndRender, renderRankTabs, renderAreaFilterPanel, sortAndRedistribute, toggleAreaFilterPanel } from "./uiRender.js";

async function loadMaintenance() {
  try {
    const res = await fetch('./maintenance.json', { cache: 'no-store' });
    if (!res.ok) return; // JSON 未配置なら何もしない
    const data = await res.json();

    const start = new Date(data.maintenance.start);
    const end = new Date(data.maintenance.end);
    const serverUp = new Date(data.maintenance.serverUp);
    const now = new Date();

    const showFrom = new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000);
    const showUntil = new Date(end.getTime() + 4 * 24 * 60 * 60 * 1000);

    if (now >= showFrom && now <= showUntil) {
      renderStatusBar(start, end, serverUp);
    } else {
      clearStatusBar();
    }

    if (now >= start && now < serverUp) {
      updateMobCards();
    }
  } catch (err) {
    console.error('maintenance.json 読み込み失敗:', err);
  }
}

function renderStatusBar(start, end, serverUp) {
  const el = document.getElementById('status-message');
  if (!el) return;
  el.innerHTML = `
    <div class="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-3">
      <div class="font-semibold">
        メンテナンス予定: ${formatDate(start)} ～ ${formatDate(end)}
      </div>
      <div class="text-gray-300">
        サーバー起動: ${formatDate(serverUp)}
      </div>
    </div>
  `;
  el.classList.remove('hidden');
}

function clearStatusBar() {
  const el = document.getElementById('status-message');
  if (!el) return;
  el.innerHTML = '';
}

function updateMobCards() {
  document.querySelectorAll('.mob-card').forEach(card => {
    card.classList.add('mob-card-disabled');
  });
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${d} ${h}:${min}`;
}

function attachFilterEvents() {
  const tabs = document.getElementById("rank-tabs");
  if (!tabs) return;

  tabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-button");
    if (!btn) return;

    const newRank = btn.dataset.rank.toUpperCase();
    const state = getState();
    const prevRank = state.filter.rank;

    const nextAreaSets = { ...state.filter.areaSets };
    if (!(nextAreaSets[newRank] instanceof Set)) {
      nextAreaSets[newRank] = new Set();
    }

    setFilter({
      rank: newRank,
      areaSets: nextAreaSets
    });

    const isInitialLoad = prevRank !== newRank;
    filterAndRender({ isInitialLoad });

    toggleAreaFilterPanel(newRank !== "ALL");
    renderRankTabs();
    renderAreaFilterPanel();
  });

  document.getElementById("area-filter-panel")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".area-filter-btn");
    if (!btn) return;

    const state = getState();
    const uiRank = state.filter.rank;
    const dataRank = FILTER_TO_DATA_RANK_MAP[uiRank] || uiRank;

    const areas = state.mobs
      .filter((m) =>
        dataRank === "A" || dataRank === "F"
          ? m.Rank === dataRank || m.Rank.startsWith("B")
          : m.Rank === dataRank
      )
      .reduce((set, m) => {
        const mobExpansion =
          m.Rank.startsWith("B")
            ? state.mobs.find((x) => x.No === m.related_mob_no)?.Expansion || m.Expansion
            : m.Expansion;
        if (mobExpansion) set.add(mobExpansion);
        return set;
      }, new Set());

    const currentSet =
      state.filter.areaSets[uiRank] instanceof Set
        ? state.filter.areaSets[uiRank]
        : new Set();

    if (btn.dataset.area === "ALL") {
      if (currentSet.size === areas.size) {
        state.filter.areaSets[uiRank] = new Set();
      } else {
        state.filter.areaSets[uiRank] = new Set(areas);
      }
    } else {
      const area = btn.dataset.area;
      const next = new Set(currentSet);
      if (next.has(area)) next.delete(area);
      else next.add(area);
      state.filter.areaSets[uiRank] = next;
    }

    setFilter({
      rank: uiRank,
      areaSets: state.filter.areaSets
    });

    filterAndRender();
    renderAreaFilterPanel();
  });
}

function attachCardEvents() {
  DOM.colContainer.addEventListener("click", e => {
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
        const iso = toJstAdjustedIsoString(new Date());
        submitReport(mobNo, iso, `${rank}ランク即時報告`);
      }
      return;
    }

    const point = e.target.closest(".spawn-point");
    if (point && point.dataset.isInteractive === "true") {
      e.preventDefault();
      e.stopPropagation();
      const locationId = point.dataset.locationId;
      const isCurrentlyCulled = point.dataset.isCulled === "true";
      toggleCrushStatus(mobNo, locationId, isCurrentlyCulled);
      return;
    }
      
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
}

function attachWindowResizeEvents() {
    window.addEventListener("resize", debounce(() => sortAndRedistribute(), 200));
}

function attachEventListeners() {
  renderRankTabs();
  attachFilterEvents();
  attachCardEvents();
  attachWindowResizeEvents();
  attachLocationEvents();
}

document.addEventListener('DOMContentLoaded', () => {
  attachEventListeners?.();
  loadBaseMobData?.();
  initModal?.();
  loadMaintenance();

  const currentRank = JSON.parse(localStorage.getItem('huntFilterState'))?.rank || 'ALL';
  DOM?.rankTabs?.querySelectorAll('.tab-button').forEach(btn => {
    btn.dataset.clickCount = btn.dataset.rank === currentRank ? '1' : '0';
  });
});

export { attachEventListeners, updateMobCards };
