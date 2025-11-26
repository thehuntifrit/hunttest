// uiRender.js

import { calculateRepop, formatDurationHM, formatLastKillTime, debounce, getEorzeaTime } from "./cal.js";
import { drawSpawnPoint, isCulled, attachLocationEvents } from "./location.js";
import { getState, RANK_COLORS, PROGRESS_CLASSES } from "./dataManager.js";
import { filterMobsByRankAndArea } from "./filterUI.js";

const DOM = {
  masterContainer: document.getElementById('master-mob-container'),
  colContainer: document.getElementById('column-container'),
  cols: [document.getElementById('column-1'), document.getElementById('column-2'), document.getElementById('column-3')],
  rankTabs: document.getElementById('rank-tabs'),
  areaFilterWrapper: document.getElementById('area-filter-wrapper'),
  areaFilterPanel: document.getElementById('area-filter-panel'),
  statusMessage: document.getElementById('status-message'),
  reportModal: document.getElementById('report-modal'),
  reportForm: document.getElementById('report-form'),
  modalMobName: document.getElementById('modal-mob-name'),
  modalStatus: document.getElementById('modal-status'),
  modalTimeInput: document.getElementById('report-datetime'),
};

function updateEorzeaTime() {
  const et = getEorzeaTime(new Date());
  const el = document.getElementById("eorzea-time");
  if (el) {
    el.textContent = `ET ${et.hours}:${et.minutes}`;
  }
}
updateEorzeaTime();
setInterval(updateEorzeaTime, 2917);

function processText(text) {
  if (typeof text !== "string" || !text) return "";
  return text.replace(/\/\//g, "<br>");
}

function createMobCard(mob) {
  const template = document.getElementById('mob-card-template');
  const clone = template.content.cloneNode(true);
  const card = clone.querySelector('.mob-card');

  const rank = mob.Rank;
  const rankLabel = rank;
  const isExpandable = rank === "S";
  const { openMobCardNo } = getState();
  const isOpen = isExpandable && mob.No === openMobCardNo;

  const state = getState();
  const mobLocationsData = state.mobLocations?.[mob.No];
  const spawnCullStatus = mobLocationsData || mob.spawn_cull_status;

  // --- Data Preparation (Same as before) ---
  let isLastOne = false;
  let validSpawnPoints = [];
  let displayCountText = "";

  if (mob.Map && mob.spawn_points) {
    validSpawnPoints = (mob.spawn_points ?? []).filter(point => {
      const isS_SpawnPoint = point.mob_ranks.includes("S");
      if (!isS_SpawnPoint) return false;
      const pointStatus = spawnCullStatus?.[point.id];
      return !isCulled(pointStatus, mob.No);
    });

    const remainingCount = validSpawnPoints.length;

    if (remainingCount === 1) {
      isLastOne = true;
      const pointId = validSpawnPoints[0]?.id || "";
      const pointNumber = pointId.slice(-2);
      displayCountText = ` <span class="text-xs text-yellow-400 font-bold text-glow">${pointNumber}番</span>`;
    } else if (remainingCount > 1) {
      isLastOne = false;
      displayCountText = ` <span class="text-xs text-gray-400 relative -top-[0.09rem]">@</span><span class="text-sm text-gray-400 font-stretch-condensed relative top-[0.02rem]">${remainingCount}</span>`;
    }
    isLastOne = remainingCount === 1;
  }

  const isS_LastOne = rank === "S" && isLastOne;
  const spawnPointsHtml = (rank === "S" && mob.Map)
    ? (mob.spawn_points ?? []).map(point => {
      const isThisPointTheLastOne = isLastOne && point.id === validSpawnPoints[0]?.id;
      return drawSpawnPoint(
        point,
        spawnCullStatus,
        mob.No,
        point.mob_ranks.includes("B2") ? "B2"
          : point.mob_ranks.includes("B1") ? "B1"
            : point.mob_ranks[0],
        isThisPointTheLastOne,
        isS_LastOne
      );
    }).join("")
    : "";

  const hasMemo = mob.memo_text && mob.memo_text.trim() !== "";
  const isMemoNewer = (mob.memo_updated_at || 0) > (mob.last_kill_time || 0);
  const shouldShowMemo = hasMemo && (isMemoNewer || (mob.last_kill_time || 0) === 0);

  const memoIcon = shouldShowMemo
    ? ` <span data-tooltip="${mob.memo_text}" class="cursor-help">📝</span>`
    : "";

  // --- Populate Template ---

  // Card Attributes
  card.dataset.mobNo = mob.No;
  card.dataset.rank = rank;
  const repopInfo = calculateRepop(mob, state.maintenance);
  if (repopInfo.isMaintenanceStop) {
    card.classList.add("opacity-50", "grayscale", "pointer-events-none");
  }

  // Rank Badge
  const rankBadge = card.querySelector('.rank-badge');
  rankBadge.classList.add(`rank-${rank.toLowerCase()}`);
  rankBadge.textContent = rankLabel;

  // Mob Name
  const mobNameEl = card.querySelector('.mob-name');
  mobNameEl.textContent = mob.Name;

  const memoIconContainer = card.querySelector('.memo-icon-container');
  memoIconContainer.innerHTML = memoIcon;

  // Area Info
  const areaInfoContainer = card.querySelector('.area-info-container');
  let areaInfoHtml = `<span class="flex items-center gap-1"><span>${mob.Area}</span><span class="opacity-50">|</span><span>${mob.Expansion}</span>`;
  if (mob.Map && mob.spawn_points) {
    areaInfoHtml += `<span class="flex items-center ml-1">📍 ${displayCountText}</span>`;
  }
  areaInfoHtml += `</span>`;
  areaInfoContainer.innerHTML = areaInfoHtml;

  // Report Button
  const reportBtn = card.querySelector('.report-btn');
  reportBtn.dataset.reportType = rank === 'A' ? 'instant' : 'modal';
  reportBtn.dataset.mobNo = mob.No;

  // Expandable Panel
  const expandablePanel = card.querySelector('.expandable-panel');
  if (isExpandable) {
    if (isOpen) {
      expandablePanel.classList.add('open');
    }

    // Memo Input
    const memoInput = card.querySelector('.memo-input');
    memoInput.value = mob.memo_text || "";
    memoInput.dataset.mobNo = mob.No;

    // Condition
    const conditionText = card.querySelector('.condition-text');
    conditionText.innerHTML = processText(mob.Condition);

    // Map
    const mapContainer = card.querySelector('.map-container');
    if (mob.Map && rank === 'S') {
      const mapImg = mapContainer.querySelector('.mob-map-img');
      mapImg.src = `./maps/${mob.Map}`;
      mapImg.alt = `${mob.Area} Map`;
      const mapOverlay = mapContainer.querySelector('.map-overlay');
      mapOverlay.innerHTML = spawnPointsHtml;
    } else {
      mapContainer.remove();
    }

  } else {
    expandablePanel.remove();
  }

  return card;
}

function rankPriority(rank) {
  switch (rank) {
    case "S": return 0;
    case "A": return 1;
    case "F": return 2;
    default: return 99;
  }
}

function getExpansionPriority(expansionName) {
  switch (expansionName) {
    case "黄金": return 6;
    case "暁月": return 5;
    case "漆黒": return 4;
    case "紅蓮": return 3;
    case "蒼天": return 2;
    case "新生": return 1;
    default: return 0;
  }
}

function parseMobIdParts(no) {
  const str = String(no).padStart(5, "0");
  return {
    mobNo: parseInt(str.slice(2, 4), 10),
    instance: parseInt(str[4], 10),
  };
}

function baseComparator(a, b) {
  // 1. Rank (S > A > F)
  const rankDiff = rankPriority(a.Rank) - rankPriority(b.Rank);
  if (rankDiff !== 0) return rankDiff;
  // 2. Expansion (Descending: Golden > ... > ARR)
  const expA = getExpansionPriority(a.Expansion);
  const expB = getExpansionPriority(b.Expansion);
  if (expA !== expB) return expB - expA;
  // 3. MobNo (Ascending)
  const pa = parseMobIdParts(a.No);
  const pb = parseMobIdParts(b.No);
  if (pa.mobNo !== pb.mobNo) return pa.mobNo - pb.mobNo;
  // 4. Instance (Ascending)
  if (pa.instance !== pb.instance) return pa.instance - pb.instance;
  // 5. % Rate (Descending)
  const aInfo = a.repopInfo || {};
  const bInfo = b.repopInfo || {};
  const aPercent = aInfo.elapsedPercent || 0;
  const bPercent = bInfo.elapsedPercent || 0;

  if (Math.abs(aPercent - bPercent) > 0.001) {
    return bPercent - aPercent;
  }
  // 6. Time (Ascending - sooner is smaller timestamp)
  const aTime = aInfo.minRepop || 0;
  const bTime = bInfo.minRepop || 0;
  return aTime - bTime;
}

function allTabComparator(a, b) {
  const aInfo = a.repopInfo || {};
  const bInfo = b.repopInfo || {};
  const aStatus = aInfo.status;
  const bStatus = bInfo.status;
  // Special handling for MaxOver
  const isAMaxOver = aStatus === "MaxOver";
  const isBMaxOver = bStatus === "MaxOver";

  if (isAMaxOver && isBMaxOver) {
    // Both are MaxOver: Sort by Rank (S > F > A) > Expansion > MobNo > Instance

    // Helper for MaxOver Rank Priority (S=0, F=1, A=2)
    const getMaxOverRankPriority = (r) => {
      if (r === 'S') return 0;
      if (r === 'F') return 1;
      if (r === 'A') return 2;
      return 99;
    };

    // 1. Rank (S > F > A)
    const rankDiff = getMaxOverRankPriority(a.Rank) - getMaxOverRankPriority(b.Rank);
    if (rankDiff !== 0) return rankDiff;
    // 2. Expansion (Descending: Golden > ... > ARR)
    const expA = getExpansionPriority(a.Expansion);
    const expB = getExpansionPriority(b.Expansion);
    if (expA !== expB) return expB - expA;
    // 3. MobNo (Ascending)
    const pa = parseMobIdParts(a.No);
    const pb = parseMobIdParts(b.No);
    if (pa.mobNo !== pb.mobNo) return pa.mobNo - pb.mobNo;
    // 4. Instance (Ascending)
    return pa.instance - pb.instance;
  }

  // If one is MaxOver and the other isn't, MaxOver should come first (highest %)
  if (isAMaxOver && !isBMaxOver) return -1;
  if (!isAMaxOver && isBMaxOver) return 1;

  // 1. % Rate (Descending)
  const aPercent = aInfo.elapsedPercent || 0;
  const bPercent = bInfo.elapsedPercent || 0;

  if (Math.abs(aPercent - bPercent) > 0.001) {
    return bPercent - aPercent;
  }
  // 2. Time (Ascending - sooner is smaller timestamp)
  const aTime = aInfo.minRepop || 0;
  const bTime = bInfo.minRepop || 0;
  if (aTime !== bTime) return aTime - bTime;
  // 3. Rank (S > A > F)
  const rankDiff = rankPriority(a.Rank) - rankPriority(b.Rank);
  if (rankDiff !== 0) return rankDiff;
  // 4. Expansion (Descending: Golden > ... > ARR)
  const expA = getExpansionPriority(a.Expansion);
  const expB = getExpansionPriority(b.Expansion);
  if (expA !== expB) return expB - expA;
  // 5. MobNo (Ascending)
  const pa = parseMobIdParts(a.No);
  const pb = parseMobIdParts(b.No);
  if (pa.mobNo !== pb.mobNo) return pa.mobNo - pb.mobNo;
  // 6. Instance (Ascending)
  return pa.instance - pb.instance;
}

function filterAndRender({ isInitialLoad = false } = {}) {
  const state = getState();
  const filtered = filterMobsByRankAndArea(state.mobs);

  let sortedMobs;
  if (state.filter.rank === 'ALL') {
    sortedMobs = filtered.sort(allTabComparator);
  } else {
    sortedMobs = filtered.sort(baseComparator);
  }

  const existingCards = new Map();
  DOM.masterContainer.querySelectorAll('.mob-card').forEach(card => {
    const mobNo = card.getAttribute('data-mob-no');
    existingCards.set(mobNo, card);
    card.remove();
  });

  const frag = document.createDocumentFragment();

  sortedMobs.forEach(mob => {
    const mobNoStr = String(mob.No);
    let card = existingCards.get(mobNoStr);

    if (card) {
      updateProgressText(card, mob);
      updateProgressBar(card, mob);
      updateExpandablePanel(card, mob);

      const repopInfo = calculateRepop(mob, state.maintenance);
      if (repopInfo.isMaintenanceStop) {
        card.classList.add("opacity-50", "grayscale", "pointer-events-none");
      } else {
        card.classList.remove("opacity-50", "grayscale", "pointer-events-none");
      }

    } else {
      card = createMobCard(mob);
      updateProgressText(card, mob);
      updateProgressBar(card, mob);
      updateExpandablePanel(card, mob);
    }

    if (card) {
      frag.appendChild(card);
    }
  });

  DOM.masterContainer.appendChild(frag);

  distributeCards();
  attachLocationEvents();

  if (isInitialLoad) updateProgressBars();
}

function distributeCards() {
  const width = window.innerWidth;
  const md = 768;
  const lg = 1024;
  let cols = 1;
  if (width >= lg) {
    cols = 3;
    DOM.cols[2].classList.remove("hidden");
  } else if (width >= md) {
    cols = 2;
    DOM.cols[2].classList.add("hidden");
  } else {
    cols = 1;
    DOM.cols[2].classList.add("hidden");
  }

  DOM.cols.forEach(col => (col.innerHTML = ""));
  const cards = Array.from(DOM.masterContainer.children);
  cards.forEach((card, idx) => {
    const target = idx % cols;
    DOM.cols[target].appendChild(card);
  });
}

function updateProgressBar(card, mob) {
  const bar = card.querySelector(".progress-bar-bg");
  const wrapper = bar?.parentElement;
  const text = card.querySelector(".progress-text");
  if (!bar || !wrapper || !text) return;

  const { elapsedPercent, status } = mob.repopInfo;

  bar.style.transition = "width linear 60s";
  bar.style.width = `${elapsedPercent}%`;

  bar.classList.remove(
    PROGRESS_CLASSES.P0_60,
    PROGRESS_CLASSES.P60_80,
    PROGRESS_CLASSES.P80_100,
    PROGRESS_CLASSES.MAX_OVER
  );
  text.classList.remove(
    PROGRESS_CLASSES.TEXT_NEXT,
    PROGRESS_CLASSES.TEXT_POP
  );
  wrapper.classList.remove(PROGRESS_CLASSES.BLINK_WHITE);

  if (status === "PopWindow" || status === "ConditionActive") {
    if (elapsedPercent > 90) {
      wrapper.classList.add(PROGRESS_CLASSES.BLINK_WHITE);
    }
    text.classList.add(PROGRESS_CLASSES.TEXT_POP);

  } else if (status === "MaxOver") {
    bar.classList.add(PROGRESS_CLASSES.MAX_OVER);
    text.classList.add(PROGRESS_CLASSES.TEXT_POP);

    // Fix: Add white border if MaxOver AND in condition window
    if (mob.repopInfo.isInConditionWindow) {
      wrapper.classList.add(PROGRESS_CLASSES.BLINK_WHITE);
    }
  } else {
    text.classList.add(PROGRESS_CLASSES.TEXT_NEXT);
  }
}

function updateProgressText(card, mob) {
  const text = card.querySelector(".progress-text");
  if (!text) return;

  const { elapsedPercent, nextMinRepopDate, nextConditionSpawnDate, minRepop, maxRepop, status, isInConditionWindow, timeRemaining, isBlockedByMaintenance
  } = mob.repopInfo || {};

  const nowSec = Date.now() / 1000;
  let leftStr = timeRemaining || "未確定";
  // Removed status === "NextCondition"
  const percentStr = (status === "PopWindow" || status === "ConditionActive")
    ? ` (${Number(elapsedPercent || 0).toFixed(0)}%)`
    : "";

  // Visual Styles
  // 1. Dim Pre-Repop (Next / NextCondition)
  if (status === "Next" || status === "NextCondition") {
    card.classList.add("opacity-60");
  } else {
    card.classList.remove("opacity-60");
  }

  // 2. Gray out if blocked by maintenance
  if (isBlockedByMaintenance) {
    card.classList.add("grayscale", "opacity-50");
  } else {
    card.classList.remove("grayscale", "opacity-50");
  }

  let rightStr = "未確定";
  let isNext = false;

  if (isInConditionWindow && mob.repopInfo.conditionRemaining) {
    rightStr = mob.repopInfo.conditionRemaining;
  } else if (nextConditionSpawnDate) {
    try {
      const dateStr = new Intl.DateTimeFormat("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" }).format(nextConditionSpawnDate);
      rightStr = `🔔 ${dateStr}`;
      isNext = true;
    } catch {
      rightStr = "未確定";
    }
  } else if (nextMinRepopDate) {
    try {
      const dateStr = new Intl.DateTimeFormat("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" }).format(nextMinRepopDate);
      rightStr = `in ${dateStr}`;
    } catch {
      rightStr = "未確定";
    }
  }

  let rightContent = `<span>${rightStr}</span>`;

  text.innerHTML = `
    <div class="w-full h-full grid grid-cols-2 items-center text-sm font-bold">
      <div class="pl-2 text-left truncate">${leftStr}${percentStr}</div>
      <div class="pr-2 text-right truncate">${rightContent}</div>
    </div>
  `;

  if (status === "MaxOver") text.classList.add("max-over");
  else text.classList.remove("max-over");

  if (minRepop - nowSec >= 3600) text.classList.add("long-wait");
  else text.classList.remove("long-wait");

  if (status === "ConditionActive" || (status === "MaxOver" && isInConditionWindow)) {
    card.classList.add("blink-border-white");
  } else {
    card.classList.remove("blink-border-white");
  }
}

function updateExpandablePanel(card, mob) {
  const elNext = card.querySelector("[data-next-time]");
  const elLast = card.querySelector("[data-last-kill]");
  const elMemoInput = card.querySelector("input[data-action='save-memo']");

  const lastStr = formatLastKillTime(mob.last_kill_time);
  if (elLast) elLast.textContent = `前回: ${lastStr}`;

  if (elMemoInput) {
    // Only update if not currently focused to avoid overwriting user input while typing
    if (document.activeElement !== elMemoInput) {
      elMemoInput.value = mob.memo_text || "";
    }
  }
}

function updateProgressBars() {
  const state = getState();
  state.mobs.forEach((mob) => {
    mob.repopInfo = calculateRepop(mob, state.maintenance);

    const card = document.querySelector(`.mob-card[data-mob-no="${mob.No}"]`);
    if (card) {
      updateProgressText(card, mob);
      updateProgressBar(card, mob);
    }
  });
}

const sortAndRedistribute = debounce(() => filterAndRender(), 200);

function onKillReportReceived(mobId, kill_time) {
  const mob = getState().mobs.find(m => m.No === mobId);
  if (!mob) return;

  mob.last_kill_time = Number(kill_time);
  mob.repopInfo = calculateRepop(mob, getState().maintenance);

  const card = document.querySelector(`.mob-card[data-mob-no="${mob.No}"]`);
  if (card) {
    updateProgressText(card, mob);
    updateProgressBar(card, mob);
  }
}

setInterval(() => {
  updateProgressBars();
}, 2917);

export {
  filterAndRender, distributeCards, updateProgressText, updateProgressBar,
  createMobCard, DOM, sortAndRedistribute, onKillReportReceived, updateProgressBars
};
