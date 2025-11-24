// filterUI.js

import { getState, EXPANSION_MAP, setFilter } from "./dataManager.js";
import { filterAndRender } from "./uiRender.js";

const DOM = {
  rankTabs: document.getElementById('rank-tabs'),
  areaFilterPanelMobile: document.getElementById('area-filter-panel-mobile'),
  areaFilterPanelDesktop: document.getElementById('area-filter-panel-desktop')
};

const getAllAreas = () => {
  return Array.from(new Set(Object.values(EXPANSION_MAP)));
};

const renderRankTabs = () => {
  const state = getState();
  const rankList = ["ALL", "S", "A", "FATE"];
  const container = DOM.rankTabs;
  if (!container) return;

  container.innerHTML = "";
  container.className = "grid grid-cols-4 gap-2";

  rankList.forEach(rank => {
    const isSelected = state.filter.rank === rank;
    const btn = document.createElement("button");
    btn.dataset.rank = rank;
    btn.textContent = rank;

    btn.className =
      `tab-button px-2 py-1 text-sm rounded font-semibold text-white text-center transition ` +
      (isSelected ? "bg-green-500" : "bg-gray-500 hover:bg-gray-400");

    // イベントリスナー設定
    btn.addEventListener("click", () => {
      handleRankTabClick(rank);
    });

    container.appendChild(btn);
  });
};

const handleRankTabClick = (rank) => {
  const currentState = getState();
  setFilter({
    rank,
    areaSets: currentState.filter.areaSets
  });
  filterAndRender();
  updateFilterUI();
};

const renderAreaFilterPanel = () => {
  const state = getState();
  const uiRank = state.filter.rank;

  // ALL tab now has filters too (Rank filters)
  // if (uiRank === 'ALL') return; // Removed this check

  const targetRankKey = uiRank === 'FATE' ? 'F' : uiRank;

  let items = [];
  let currentSet = new Set();
  let isAllSelected = false;

  if (uiRank === 'ALL') {
    // For ALL tab, items are Ranks
    items = ["S", "A", "F"];
    currentSet = state.filter.allRankSet instanceof Set ? state.filter.allRankSet : new Set();
    isAllSelected = items.length > 0 && currentSet.size === items.length;
  } else {
    // For other tabs, items are Areas
    items = getAllAreas();
    currentSet =
      state.filter.areaSets[targetRankKey] instanceof Set
        ? state.filter.areaSets[targetRankKey]
        : new Set();
    isAllSelected = items.length > 0 && currentSet.size === items.length;

    // Sort areas
    items.sort((a, b) => {
      const indexA = Object.values(EXPANSION_MAP).indexOf(a);
      const indexB = Object.values(EXPANSION_MAP).indexOf(b);
      return indexB - indexA;
    });
  }

  const createButton = (label, isAll, isSelected) => {
    const btn = document.createElement("button");
    btn.textContent = label;

    // Default class
    let btnClass = 'py-1 px-2 text-sm rounded font-semibold text-white text-center transition';

    // Apply width based on context
    if (uiRank === 'ALL' && !isAll) {
      // For S, A, F buttons in ALL tab, make them wider (approx double)
      btnClass += ' w-16';
    } else {
      btnClass += ' w-auto';
    }

    if (isAll) {
      btn.className = `area-filter-btn ${btnClass} ${isAllSelected ? "bg-red-500" : "bg-gray-500 hover:bg-gray-400"}`;
      btn.dataset.value = "ALL"; // Use generic 'value'
    } else {
      btn.className = `area-filter-btn ${btnClass} ${isSelected ? "bg-green-500" : "bg-gray-500 hover:bg-gray-400"}`;
      btn.dataset.value = label; // Use generic 'value'
    }
    return btn;
  };

  const createPanelContent = (isDesktop) => {
    const panel = document.createDocumentFragment();
    const allBtn = createButton(isAllSelected ? "全解除" : "全選択", true, false);
    panel.appendChild(allBtn);

    if (!isDesktop) {
      const dummy = document.createElement("div");
      dummy.className = "w-full";
      panel.appendChild(dummy);
    }

    items.forEach(item => {
      const isSelected = currentSet.has(item);
      panel.appendChild(createButton(item, false, isSelected));
    });

    return panel;
  };

  const mobilePanel = DOM.areaFilterPanelMobile?.querySelector('div');
  const desktopPanel = DOM.areaFilterPanelDesktop?.querySelector('div');

  if (mobilePanel) {
    mobilePanel.innerHTML = "";
    mobilePanel.appendChild(createPanelContent(false));
  }
  if (desktopPanel) {
    desktopPanel.innerHTML = "";
    desktopPanel.appendChild(createPanelContent(true));
  }
};

const updateFilterUI = () => {
  const state = getState();
  const rankTabs = DOM.rankTabs;
  if (!rankTabs) return;

  const stored = JSON.parse(localStorage.getItem("huntUIState")) || {};
  const prevRank = stored.rank;
  let clickStep = stored.clickStep || 1;

  const isMobile = window.matchMedia("(max-width: 1023px)").matches;

  rankTabs.querySelectorAll(".tab-button").forEach(btn => {
    const btnRank = btn.dataset.rank;
    const isCurrent = btnRank === state.filter.rank;

    btn.classList.remove(
      "bg-rose-800", "bg-amber-800", "bg-green-800", "bg-purple-800",
      "bg-gray-500", "hover:bg-gray-400", "bg-green-500", "bg-gray-800",
      "bg-rose-600", "bg-amber-600", "bg-green-600", "bg-purple-600"
    );


    if (isCurrent) {
      if (!prevRank || prevRank !== btnRank) {
        clickStep = 1;
      } else {
        if (clickStep === 1) clickStep = 2;
        else if (clickStep === 2) clickStep = 3;
        else clickStep = 2;
      }

      btn.classList.add(
        btnRank === "ALL" ? "bg-rose-600"
          : btnRank === "S" ? "bg-amber-600"
            : btnRank === "A" ? "bg-green-600"
              : btnRank === "FATE" ? "bg-purple-600"
                : "bg-gray-800"
      );

      const panels = [DOM.areaFilterPanelMobile, DOM.areaFilterPanelDesktop];
      if (clickStep === 1 || clickStep === 3) {
        panels.forEach(p => p?.classList.add("hidden"));
      } else if (clickStep === 2) {
        renderAreaFilterPanel();
        if (isMobile) {
          DOM.areaFilterPanelMobile?.classList.remove("hidden");
          DOM.areaFilterPanelDesktop?.classList.add("hidden");
        } else {
          DOM.areaFilterPanelDesktop?.classList.remove("hidden");
          DOM.areaFilterPanelDesktop?.classList.add("flex");
          DOM.areaFilterPanelMobile?.classList.add("hidden");
        }

      }

      localStorage.setItem("huntUIState", JSON.stringify({
        rank: btnRank,
        clickStep
      }));
    } else {
      btn.classList.add("bg-gray-500", "hover:bg-gray-400");
    }
  });
};

function handleAreaFilterClick(e) {
  const btn = e.target.closest(".area-filter-btn");
  if (!btn) return;

  const state = getState();
  const uiRank = state.filter.rank;

  // Handle ALL tab rank filtering
  if (uiRank === 'ALL') {
    const currentSet = state.filter.allRankSet instanceof Set ? state.filter.allRankSet : new Set();
    const nextSet = new Set(currentSet);
    const val = btn.dataset.value; // Use generic 'value'

    if (val === "ALL") {
      if (currentSet.size === 3) { // S, A, F
        nextSet.clear();
      } else {
        nextSet.add("S").add("A").add("F");
      }
    } else {
      if (nextSet.has(val)) nextSet.delete(val);
      else nextSet.add(val);
    }

    setFilter({
      rank: uiRank,
      allRankSet: nextSet
    });

    filterAndRender();
    renderAreaFilterPanel();
    return;
  }

  // Handle other tabs area filtering
  const targetRankKey = uiRank === 'FATE' ? 'F' : uiRank;
  const allAreas = getAllAreas();

  const currentSet =
    state.filter.areaSets[targetRankKey] instanceof Set
      ? state.filter.areaSets[targetRankKey]
      : new Set();

  const nextAreaSets = { ...state.filter.areaSets };
  const val = btn.dataset.value || btn.dataset.area; // Fallback for safety

  if (val === "ALL") {
    if (currentSet.size === allAreas.length) {
      nextAreaSets[targetRankKey] = new Set();
    } else {
      nextAreaSets[targetRankKey] = new Set(allAreas);
    }
  } else {
    const area = val;
    const next = new Set(currentSet);
    if (next.has(area)) next.delete(area);
    else next.add(area);
    nextAreaSets[targetRankKey] = next;
  }

  setFilter({
    rank: uiRank,
    areaSets: nextAreaSets
  });

  filterAndRender();
  renderAreaFilterPanel();
}

function filterMobsByRankAndArea(mobs) {
  const filter = getState().filter;
  const uiRank = filter.rank;
  const areaSets = filter.areaSets;
  const allRankSet = filter.allRankSet;
  const allExpansions = getAllAreas().length;

  const getMobRankKey = (rank) => {
    if (rank === 'S' || rank === 'A') return rank;
    if (rank === 'F') return 'F';
    if (rank.startsWith('B')) return 'A';
    return null;
  };

  return mobs.filter(m => {
    const mobRank = m.Rank;
    const mobExpansion = m.Expansion;
    const mobRankKey = getMobRankKey(mobRank);

    if (!mobRankKey) return false;

    const filterKey = mobRankKey;

    if (uiRank === 'ALL') {
      if (filterKey !== 'S' && filterKey !== 'A' && filterKey !== 'F') return false;

      // Rank Filter for ALL tab
      if (allRankSet && allRankSet.size > 0 && allRankSet.size < 3) {
        // If allRankSet is empty or full, show all ranks.
        // If it has specific selections, filter by them.
        // Wait, usually if empty -> show all? Or if empty -> show none?
        // Standard behavior: Empty = Show All (or Show None depending on UX).
        // Let's assume: If nothing selected, show ALL. If something selected, show ONLY selected.
        // Actually, in the area filter logic: "if (targetSet.size === 0) return true;" -> Empty means Show All.
        // Let's follow that pattern.

        // However, "S", "A", "F" are the keys.
        // mobRankKey maps B ranks to A.
        // So if 'A' is selected, we show A and B ranks.

        if (!allRankSet.has(filterKey)) return false;
      }

      const targetSet =
        areaSets?.[filterKey] instanceof Set ? areaSets[filterKey] : new Set();

      // For ALL tab, we currently don't filter by area (or do we?)
      // The original code checked areaSets for the specific rank key.
      // "ALL" tab shows everything, but it seems it respected the area filters set in other tabs?
      // Let's check original code:
      // if (uiRank === 'ALL') {
      //   ...
      //   const targetSet = areaSets?.[filterKey] ...
      //   if (targetSet.size === 0) return true;
      //   return targetSet.has(mobExpansion);
      // }
      // Yes, it respected the area filters of the individual ranks!
      // So we must keep that logic.

      if (targetSet.size === 0) return true;
      if (targetSet.size === allExpansions) return true;

      return targetSet.has(mobExpansion);
    } else {
      const isRankMatch =
        (uiRank === 'S' && mobRank === 'S') ||
        (uiRank === 'A' && (mobRank === 'A' || mobRank.startsWith('B'))) ||
        (uiRank === 'FATE' && mobRank === 'F');

      if (!isRankMatch) return false;

      const targetSet =
        areaSets?.[filterKey] instanceof Set ? areaSets[filterKey] : new Set();

      if (targetSet.size === 0) return true;
      if (targetSet.size === allExpansions) return true;

      return targetSet.has(mobExpansion);
    }
  });
}

export { renderRankTabs, renderAreaFilterPanel, updateFilterUI, handleAreaFilterClick, filterMobsByRankAndArea };
