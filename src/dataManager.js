// filterUI.js

import { getState, FILTER_TO_DATA_RANK_MAP, setFilter } from "./dataManager.js";
import { EXPANSION_MAP } from "./dataManager.js";
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

    const storedState = JSON.parse(localStorage.getItem('huntFilterState')) || {};

    rankList.forEach(rank => {
        const isSelected = state.filter.rank === rank;
        const btn = document.createElement("button");
        btn.dataset.rank = rank;
        btn.textContent = rank;

        btn.className = `tab-button px-2 py-1 text-sm rounded font-semibold text-white text-center transition ${isSelected ? "bg-green-500" : "bg-gray-500 hover:bg-gray-400"}`;

        const clickCount = (rank === state.filter.rank) ? (storedState.clickCount || '1') : '1';
        btn.dataset.clickCount = clickCount;

        container.appendChild(btn);
    });
};

const renderAreaFilterPanel = () => {
    const state = getState();
    const uiRank = state.filter.rank;

    if (uiRank === 'ALL') return;

    const targetRankKey = uiRank === 'FATE' ? 'F' : uiRank;
    const areas = getAllAreas();

    const currentSet = state.filter.areaSets[targetRankKey] instanceof Set ? state.filter.areaSets[targetRankKey] : new Set();
    const isAllSelected = areas.length > 0 && currentSet.size === areas.length;

    const sortedAreas = areas.sort((a, b) => {
        const indexA = Object.values(EXPANSION_MAP).indexOf(a);
        const indexB = Object.values(EXPANSION_MAP).indexOf(b);
        return indexB - indexA;
    });

    const createButton = (area, isAll, isSelected) => {
        const btn = document.createElement("button");
        btn.textContent = area;

        const btnClass = 'py-1 px-2 text-sm rounded font-semibold text-white text-center transition w-auto';

        if (isAll) {
            btn.className = `area-filter-btn ${btnClass} ${isAllSelected ? "bg-red-500" : "bg-gray-500 hover:bg-gray-400"}`;
            btn.dataset.area = "ALL";
        } else {
            btn.className = `area-filter-btn ${btnClass} ${isSelected ? "bg-green-500" : "bg-gray-500 hover:bg-gray-400"}`;
            btn.dataset.area = area;
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

        sortedAreas.forEach(area => {
            const isSelected = currentSet.has(area);
            panel.appendChild(createButton(area, false, isSelected));
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
    const currentRankKeyForColor = FILTER_TO_DATA_RANK_MAP[state.filter.rank] || state.filter.rank;
    const rankTabs = DOM.rankTabs;
    if (!rankTabs) return;

    const storedFilterState = JSON.parse(localStorage.getItem('huntFilterState')) || {};
    const prevRank = storedFilterState.rank; 

    rankTabs.querySelectorAll(".tab-button").forEach(btn => {
        const btnRank = btn.dataset.rank;
        const isCurrentRank = btnRank === state.filter.rank;

        btn.classList.remove("bg-blue-800", "bg-red-800", "bg-yellow-800", "bg-indigo-800", "bg-gray-500", "hover:bg-gray-400", "bg-green-500");
        
        let clickCount = parseInt(btn.dataset.clickCount, 10) || 1;

        if (isCurrentRank) {
            
            if (prevRank !== btnRank) {
                clickCount = 1; 
            } else {
                if (clickCount === 1) {
                    clickCount = 2; 
                } else {
                    clickCount = (clickCount === 2) ? 3 : 2; 
                }
            }
            
            btn.classList.remove("bg-gray-500", "hover:bg-gray-400");
            btn.classList.add(
                btnRank === "ALL" ? "bg-blue-800"
                    : currentRankKeyForColor === "S" ? "bg-red-800"
                        : currentRankKeyForColor === "A" ? "bg-yellow-800"
                            : currentRankKeyForColor === "F" ? "bg-indigo-800"
                                : "bg-gray-800"
            );

            const panels = [DOM.areaFilterPanelMobile, DOM.areaFilterPanelDesktop];
            
            if (btnRank === 'ALL' || clickCount !== 2) {
                panels.forEach(p => p?.classList.add('hidden'));
            } else if (clickCount === 2) {
                renderAreaFilterPanel();
                panels.forEach(p => p?.classList.remove('hidden'));
            }

            const newFilterState = { ...storedFilterState, rank: btnRank, clickCount: clickCount };
            localStorage.setItem("huntFilterState", JSON.stringify(newFilterState));

        } else {
          
            clickCount = 1; 
            btn.classList.add("bg-gray-500", "hover:bg-gray-400");
            
            const panels = [DOM.areaFilterPanelMobile, DOM.areaFilterPanelDesktop];
            panels.forEach(p => p?.classList.add('hidden'));
        }

        btn.dataset.clickCount = String(clickCount);
    });
};

function handleAreaFilterClick(e) {
    const btn = e.target.closest(".area-filter-btn");
    if (!btn) return;

    const state = getState();
    const uiRank = state.filter.rank;
    const targetRankKey = uiRank === 'FATE' ? 'F' : uiRank;
    const allAreas = getAllAreas();

    if (uiRank === 'ALL') return;

    const currentSet = state.filter.areaSets[targetRankKey] instanceof Set ? state.filter.areaSets[targetRankKey] : new Set();
    const nextAreaSets = { ...state.filter.areaSets };

    if (btn.dataset.area === "ALL") {
        if (currentSet.size === allAreas.length) {
            nextAreaSets[targetRankKey] = new Set();
        } else {
            nextAreaSets[targetRankKey] = new Set(allAreas);
        }
    } else {
        const area = btn.dataset.area;
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
            
            const targetSet = areaSets[filterKey];

            if (!(targetSet instanceof Set) || targetSet.size === 0) return true;
            if (targetSet.size === allExpansions) return true;

            return targetSet.has(mobExpansion);

        } 
        else {

            const isRankMatch = (uiRank === 'S' && mobRank === 'S') ||
                (uiRank === 'A' && (mobRank === 'A' || mobRank.startsWith('B'))) ||
                (uiRank === 'FATE' && mobRank === 'F');

            if (!isRankMatch) return false;

            const targetSet = areaSets[filterKey];

            if (!(targetSet instanceof Set) || targetSet.size === 0) return true;
            if (targetSet.size === allExpansions) return true;

            return targetSet.has(mobExpansion);
        }
    });
}

export { renderRankTabs, renderAreaFilterPanel, updateFilterUI, handleAreaFilterClick, filterMobsByRankAndArea };
