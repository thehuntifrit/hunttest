// filterUI.js

import { getState, EXPANSION_MAP, setFilter } from "./dataManager.js";
import { filterAndRender } from "./uiRender.js";

const FilterDOM = {
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
  const container = FilterDOM.rankTabs;
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

    btn.addEventListener("click", () => {
      handleRankTabClick(rank);
    });

    container.appendChild(btn);
  });
};

const renderAreaFilterPanel = () => {
  const state = getState();
  const uiRank = state.filter.rank;
  const targetRankKey = uiRank === 'FATE' ? 'F' : uiRank;

  let items = [];
  let currentSet = new Set();
  let isAllSelected = false;

  if (uiRank === 'ALL') {
    items = ["S", "A", "F"];
    currentSet = state.filter.allRankSet instanceof Set ? state.filter.allRankSet : new Set();
    isAllSelected = items.length > 0 && currentSet.size === items.length;
  } else {
    items = getAllAreas();
    currentSet =
      state.filter.areaSets[targetRankKey] instanceof Set
        ? state.filter.areaSets[targetRankKey]
        : new Set();
    isAllSelected = items.length > 0 && currentSet.size === items.length;

    items.sort((a, b) => {
      const indexA = Object.values(EXPANSION_MAP).indexOf(a);
      const indexB = Object.values(EXPANSION_MAP).indexOf(b);
      return indexB - indexA;
    });
  }

  const createButton = (label, isAll, isSelected, isDesktop) => {
    const btn = document.createElement("button");
    btn.textContent = label;

    let btnClass = 'py-1 px-2 text-sm rounded font-semibold text-white text-center transition';

    if (uiRank === 'ALL' && !isAll) {
      if (isDesktop) btnClass += ' w-12';
      else btnClass += ' w-auto';
    } else {
      btnClass += ' w-auto';
    }

    if (isAll) {
      btn.className = `area-filter-btn ${btnClass} ${isAllSelected ? "bg-red-500" : "bg-gray-500 hover:bg-gray-400"}`;
      btn.dataset.value = "ALL";
    } else {
      btn.className = `area-filter-btn ${btnClass} ${isSelected ? "bg-green-500" : "bg-gray-500 hover:bg-gray-400"}`;
      btn.dataset.value = label;
    }
    return btn;
  };

  const createPanelContent = (isDesktop) => {
    const panel = document.createDocumentFragment();
    const allBtn = createButton(isAllSelected ? "全解除" : "全選択", true, false, isDesktop);
    panel.appendChild(allBtn);

    if (!isDesktop) {
      const dummy = document.createElement("div");
      dummy.className = "w-full";
      panel.appendChild(dummy);
    }

    items.forEach(item => {
      const isSelected = currentSet.has(item);
      panel.appendChild(createButton(item, false, isSelected, isDesktop));
    });

    return panel;
  };

  const mobilePanel = FilterDOM.areaFilterPanelMobile?.querySelector('div');
  const desktopPanel = FilterDOM.areaFilterPanelDesktop?.querySelector('div');

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
  const rankTabs = FilterDOM.rankTabs;
  if (!rankTabs) return;

  const stored = JSON.parse(localStorage.getItem("huntUIState")) || {};
  const clickStep = stored.clickStep || 1;
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
      btn.classList.add(
        btnRank === "ALL" ? "bg-rose-600"
          : btnRank === "S" ? "bg-amber-600"
            : btnRank === "A" ? "bg-green-600"
              : btnRank === "FATE" ? "bg-purple-600"
                : "bg-gray-800"
      );

      const panels = [FilterDOM.areaFilterPanelMobile, FilterDOM.areaFilterPanelDesktop];
      if (clickStep === 1 || clickStep === 3) {
        panels.forEach(p => p?.classList.add("hidden"));
      } else if (clickStep === 2) {
        renderAreaFilterPanel();
        if (isMobile) {
          FilterDOM.areaFilterPanelMobile?.classList.remove("hidden");
          FilterDOM.areaFilterPanelDesktop?.classList.add("hidden");
        } else {
          FilterDOM.areaFilterPanelDesktop?.classList.remove("hidden");
          FilterDOM.areaFilterPanelDesktop?.classList.add("flex");
          FilterDOM.areaFilterPanelMobile?.classList.add("hidden");
        }
      }
    } else {
      btn.classList.add("bg-gray-500", "hover:bg-gray-400");
    }
  });
};

const handleRankTabClick = (rank) => {
  const state = getState();
  const prevRank = state.filter.rank;

  const stored = JSON.parse(localStorage.getItem("huntUIState")) || {};
  let clickStep = stored.clickStep || 1;

  if (prevRank !== rank) {
    clickStep = 1;
  } else {
    if (clickStep === 1) clickStep = 2;
    else if (clickStep === 2) clickStep = 3;
    else clickStep = 2;
  }

  setFilter({
    rank,
    areaSets: state.filter.areaSets
  });

  localStorage.setItem("huntUIState", JSON.stringify({
    rank,
    clickStep
  }));

  filterAndRender();
  updateFilterUI();
};

function handleAreaFilterClick(e) {
  const btn = e.target.closest(".area-filter-btn");
  if (!btn) return;

  const state = getState();
  const uiRank = state.filter.rank;

  if (uiRank === 'ALL') {
    const currentSet = state.filter.allRankSet instanceof Set ? state.filter.allRankSet : new Set();
    const nextSet = new Set(currentSet);
    const val = btn.dataset.value;

    if (val === "ALL") {
      if (currentSet.size === 3) {
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

  const targetRankKey = uiRank === 'FATE' ? 'F' : uiRank;
  const allAreas = getAllAreas();

  const currentSet =
    state.filter.areaSets[targetRankKey] instanceof Set
      ? state.filter.areaSets[targetRankKey]
      : new Set();

  const nextAreaSets = { ...state.filter.areaSets };
  const val = btn.dataset.value || btn.dataset.area;

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

      if (allRankSet && allRankSet.size > 0 && allRankSet.size < 3) {
        if (!allRankSet.has(filterKey)) return false;
      }

      const targetSet =
        areaSets?.[filterKey] instanceof Set ? areaSets[filterKey] : new Set();

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
