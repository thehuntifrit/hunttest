// uiRender.js
import { calculateRepop, findNextSpawnTime, formatDurationHM, formatLastKillTime, debounce, getEorzeaTime } from "./cal.js";
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
setInterval(updateEorzeaTime, 3000);

function displayStatus(message, type = "info", duration = 5000) {
  const el = document.getElementById("status-message-temp");
  if (!el) return;

  const color = {
    info: "text-blue-300",
    success: "text-green-300",
    error: "text-red-300",
    warning: "text-yellow-300"
  }[type] || "text-white";

  el.innerHTML = `<div class="${color} text-glow font-semibold">${message}</div>`;
  document.getElementById("status-message")?.classList.remove("hidden");

  setTimeout(() => {
    el.innerHTML = "";
    const persistent = document.getElementById("status-message-maintenance");
    if (!persistent || persistent.innerHTML.trim() === "") {
      document.getElementById("status-message")?.classList.add("hidden");
    }
  }, duration);
}

function processText(text) {
  if (typeof text !== "string" || !text) return "";
  return text.replace(/\/\//g, "<br>");
}

function createMobCard(mob) {
  const rank = mob.Rank;
  const rankLabel = rank;

  const isExpandable = rank === "S";
  const { openMobCardNo } = getState();
  const isOpen = isExpandable && mob.No === openMobCardNo;

  const state = getState();
  const mobLocationsData = state.mobLocations?.[mob.No];
  const spawnCullStatus = mobLocationsData || mob.spawn_cull_status;

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
      displayCountText = ` <span class="text-yellow-400 font-bold text-glow">${pointNumber}番</span>`;
    } else if (remainingCount > 1) {
      isLastOne = false;
      displayCountText = ` <span class="text-xs text-gray-400 relative -top-0.5">@</span>&nbsp;${remainingCount}<span class="text-xs relative -top-[0.04rem]">個</span>`;
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

  // Memo Icon Logic
  const memoIcon = mob.memo_text && mob.memo_text.trim() !== "" ? " 📋️" : "";

  const mobNameHtml = `<span class="text-base flex items-baseline font-bold truncate text-gray-100">${mob.Name}${memoIcon}</span>`;

  // Area Info HTML (WITH count text if map exists)
  let areaInfoHtml = `${mob.Area} <span class="opacity-50">|</span> ${mob.Expansion}`;
  if (mob.Map && mob.spawn_points) {
    areaInfoHtml += ` <span class="ml-1">📍</span>${displayCountText}`;
  }

  // Magitek Card Header
  const cardHeaderHTML = `
<div class="px-3 py-2 space-y-2 bg-transparent" data-toggle="card-header">
    <div class="grid grid-cols-[auto_1fr_auto] items-center w-full gap-3">
        <!-- Rank Badge -->
        <span class="w-8 h-8 flex items-center justify-center rounded-md text-white text-sm rank-badge rank-${rank.toLowerCase()}">${rankLabel}</span>

        <div class="flex flex-col min-w-0">
            <div class="flex items-baseline">${mobNameHtml}</div>
            <span class="text-xs text-gray-400 truncate font-mono tracking-wide">${areaInfoHtml}</span>
        </div>

        <div class="flex-shrink-0 flex items-center justify-end">
            <button data-report-type="${rank === 'A' ? 'instant' : 'modal'}" data-mob-no="${mob.No}" class="w-8 h-8 flex items-center justify-center rounded transition text-center leading-tight hover:scale-110 active:scale-95">
                <img src="./icon/reports.webp" alt="報告する" class="w-7 h-7 object-contain filter drop-shadow-lg" 
                  onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
                <span style="display:none;" class="w-8 h-8 flex items-center justify-center text-[10px] rounded 
                bg-green-600 hover:bg-green-500 text-white font-bold leading-tight whitespace-pre-line shadow-lg">報告</span>
            </button>
        </div>
    </div>

    <!-- Progress Bar -->
    <div class="progress-bar-wrapper h-4 rounded relative overflow-hidden">
        <div class="progress-bar-bg absolute left-0 top-0 h-full rounded transition-all duration-100 ease-linear" style="width: 0%"></div>
        <div class="progress-text absolute inset-0 flex items-center justify-center text-xs font-bold tracking-wider z-10" style="line-height: 1;"></div>
    </div>
</div>
`;

  const expandablePanelHTML = isExpandable ? `
<div class="expandable-panel ${isOpen ? 'open' : ''}">
    <div class="px-3 py-2 text-sm space-y-2 border-t border-gray-700/50">
        <div class="flex justify-between items-start flex-wrap gap-y-1">
            <div class="w-full text-right text-xs text-gray-400 font-mono" data-last-kill></div>
            <div class="mob-memo-row text-sm text-gray-300 bg-gray-800/50 rounded px-2 py-1 w-full mt-1 border border-gray-700 cursor-pointer hover:bg-gray-700/50 transition" data-action="edit-memo" data-mob-no="${mob.No}">
                <span class="mr-2 text-cyan-400 font-bold">Memo:</span><span data-last-memo class="text-gray-200">${mob.memo_text || ""}</span>
            </div>
            
            <div class="w-full mt-2">
                <div class="font-semibold text-yellow-400 text-xs uppercase tracking-widest mb-1">Condition</div>
                <div class="text-gray-300 text-xs leading-relaxed pl-2 border-l-2 border-yellow-600/50">${processText(mob.Condition)}</div>
            </div>
        </div>
        ${mob.Map && rank === 'S' ? `
        <div class="map-content mt-2 flex justify-center relative rounded overflow-hidden border border-gray-600 shadow-lg">
            <img src="./maps/${mob.Map}" alt="${mob.Area} Map" class="mob-crush-map w-full h-auto opacity-90 hover:opacity-100 transition-opacity">
            <div class="map-overlay absolute inset-0">${spawnPointsHtml}</div>
        </div>
        ` : ''}
    </div>
</div>
` : '';

  const repopInfo = calculateRepop(mob, state.maintenance);
  const isStopped = repopInfo.isMaintenanceStop;
  const stoppedClass = isStopped ? "opacity-50 grayscale pointer-events-none" : "";

  return `
<div class="mob-card rounded-lg shadow-xl cursor-pointer ${stoppedClass}"
    data-mob-no="${mob.No}" data-rank="${rank}">
    ${cardHeaderHTML}${expandablePanelHTML}
</div>
`;
}

function rankPriority(rankCode) {
  switch (rankCode) {
    case 2: return 0; // S
    case 1: return 1; // A
    case 3: return 2; // F
    default: return 99;
  }
}

function parseMobNo(no) {
  const str = String(no).padStart(5, "0");
  return {
    expansion: parseInt(str[0], 10),
    rankCode: parseInt(str[1], 10),
    mobNo: parseInt(str.slice(2, 4), 10),
    instance: parseInt(str[4], 10),
  };
}

function baseComparator(a, b) {
  const pa = parseMobNo(a.No);
  const pb = parseMobNo(b.No);

  const rankDiff = rankPriority(pa.rankCode) - rankPriority(pb.rankCode);
  if (rankDiff !== 0) return rankDiff;

  if (pa.expansion !== pb.expansion) return pb.expansion - pa.expansion;
  if (pa.mobNo !== pb.mobNo) return pa.mobNo - pb.mobNo;
  return pa.instance - pb.instance;
}

function progressComparator(a, b) {
  const nowSec = Date.now() / 1000;
  const aInfo = a.repopInfo || {};
  const bInfo = b.repopInfo || {};

  const aStopped = aInfo.isMaintenanceStop;
  const bStopped = bInfo.isMaintenanceStop;
  if (aStopped && !bStopped) return 1;
  if (!aStopped && bStopped) return -1;

  const aOver = (aInfo.status === "PopWindow" || aInfo.status === "MaxOver");
  const bOver = (bInfo.status === "PopWindow" || bInfo.status === "MaxOver");

  if (aOver && !bOver) return -1;
  if (!aOver && bOver) return 1;

  if (aOver && bOver) {
    const diff = (bInfo.elapsedPercent || 0) - (aInfo.elapsedPercent || 0);
    if (diff !== 0) return diff;
  } else {
    const aRemain = (aInfo.minRepop || 0) - nowSec;
    const bRemain = (bInfo.minRepop || 0) - nowSec;
    if (aRemain !== bRemain) return aRemain - bRemain;
  }

  return baseComparator(a, b);
}

function filterAndRender({ isInitialLoad = false } = {}) {
  const state = getState();
  const filtered = filterMobsByRankAndArea(state.mobs);
  const sortedMobs = (["S", "A", "FATE"].includes(state.filter.rank) ? filtered.sort(progressComparator) : filtered.sort(baseComparator));

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
      // 既存カードの更新
      // DOM全体を書き換えると重いので、必要な部分だけ更新するアプローチもあるが、
      // ここではシンプルに再生成せず、中身の更新を行う
      // ただし、構造が変わる可能性がある（Expandableなど）場合は再生成が安全
      // 今回はcreateMobCardで生成したHTMLで置換するのではなく、
      // 既存要素に対して update 関数を呼ぶ形にする

      // しかし、createMobCardはHTML文字列を返す設計なので、
      // 中身を書き換えるには innerHTML をセットし直すか、
      // update関数群でDOM操作するかのどちらか。
      // パフォーマンスと状態維持（開閉状態など）のバランスを考えると、
      // 既存カードがあるなら update 関数で値を更新し、
      // 構造変化（Sランクの開閉など）は別途ハンドリングが必要。

      // ここではシンプルに、既存カードがある場合は update 関数を呼び、
      // ない場合は新規作成する。
      // ただし、createMobCard の出力と整合性を取るため、
      // 構造的な変更（例: Sランクの地図表示など）がある場合は再生成した方が良いかも知れない。
      // 今回は update 関数で対応できる範囲とする。

      updateProgressText(card, mob);
      updateProgressBar(card, mob);
      updateExpandablePanel(card, mob);

      // メンテナンス状態のクラス更新
      const repopInfo = calculateRepop(mob, state.maintenance);
      if (repopInfo.isMaintenanceStop) {
        card.classList.add("opacity-50", "grayscale", "pointer-events-none");
      } else {
        card.classList.remove("opacity-50", "grayscale", "pointer-events-none");
      }

    } else {
      const temp = document.createElement("div");
      temp.innerHTML = createMobCard(mob);
      card = temp.firstElementChild;
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

  if (status === "PopWindow") {
    if (elapsedPercent > 90) {
      wrapper.classList.add(PROGRESS_CLASSES.BLINK_WHITE);
    }
    text.classList.add(PROGRESS_CLASSES.TEXT_POP);

  } else if (status === "MaxOver") {
    bar.classList.add(PROGRESS_CLASSES.MAX_OVER);
    text.classList.add(PROGRESS_CLASSES.TEXT_POP);
  } else {
    text.classList.add(PROGRESS_CLASSES.TEXT_NEXT);
  }
}

function updateProgressText(card, mob) {
  const text = card.querySelector(".progress-text");
  if (!text) return;

  const { elapsedPercent, nextMinRepopDate, nextConditionSpawnDate, minRepop, maxRepop, status, isInConditionWindow, timeRemaining
  } = mob.repopInfo || {};

  const absFmt = { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" };

  let inTimeStr = "未確定";
  if (nextMinRepopDate) {
    try {
      inTimeStr = new Intl.DateTimeFormat("ja-JP", absFmt).format(nextMinRepopDate);
    } catch {
      inTimeStr = "未確定";
    }
  }

  let nextTimeStr = "";
  const hasCondition =
    !!(mob.moonPhase || mob.timeRange || mob.timeRanges || mob.weatherSeedRange || mob.weatherSeedRanges || mob.conditions);

  if (hasCondition) {
    if (status === "ConditionActive") {
      if (mob.repopInfo.conditionWindowEnd) {
        try {
          nextTimeStr = new Intl.DateTimeFormat("ja-JP", absFmt).format(mob.repopInfo.conditionWindowEnd);
        } catch {
          nextTimeStr = "";
        }
      }
    } else if (status === "NextCondition" && nextConditionSpawnDate) {
      try {
        nextTimeStr = new Intl.DateTimeFormat("ja-JP", absFmt).format(nextConditionSpawnDate);
      } catch {
        nextTimeStr = "";
      }
    }
  }

  const nowSec = Date.now() / 1000;
  let leftStr = timeRemaining || "未確定";
  const percentStr = (status !== "MaxOver" && status !== "Unknown" && status !== "ConditionActive" && status !== "NextCondition")
    ? ` (${Number(elapsedPercent || 0).toFixed(0)}%)`
    : "";

  if (status === "Next") {
    leftStr = `Next ${formatDurationHM(minRepop - nowSec)}`;
  } else if (status === "PopWindow") {
    leftStr = `残り ${formatDurationHM(maxRepop - nowSec)}`;
  }

  text.innerHTML = `
    <div class="w-full grid grid-cols-2 items-center text-xs font-bold" style="line-height:1;">
      <div class="pl-2 text-left truncate text-shadow-sm">${leftStr}${percentStr}</div>
      <div class="pr-2 text-right toggle-container">
        <span class="label-in text-cyan-300">in ${inTimeStr}</span>
        <span class="label-next" style="display:none;">${nextTimeStr}</span>
      </div>
    </div>
  `;

  if (status === "MaxOver") text.classList.add("max-over");
  else text.classList.remove("max-over");

  if (minRepop - nowSec >= 3600) text.classList.add("long-wait");
  else text.classList.remove("long-wait");

  const toggleContainer = text.querySelector(".toggle-container");
  const nextLabel = toggleContainer?.querySelector(".label-next");
  const hasNextDisplay = !!(nextLabel && nextLabel.textContent && nextLabel.textContent.trim().length > 0);

  if (hasNextDisplay && toggleContainer && !toggleContainer.dataset.toggleStarted) {
    startToggleInNext(toggleContainer);
    toggleContainer.dataset.toggleStarted = "true";
  }
}

function startToggleInNext(container) {
  const inLabel = container.querySelector(".label-in");
  const nextLabel = container.querySelector(".label-next");
  let showingIn = true;

  // メモリリーク防止のため、要素がDOMから消えたら停止する仕組みが必要だがここでは簡易的に実装。
  setInterval(() => {
    if (!container.isConnected) return; // DOMから外れていたら何もしない

    const hasNextText = nextLabel && nextLabel.textContent && nextLabel.textContent.trim().length > 0;
    if (!hasNextText) return;

    if (showingIn) {
      inLabel.style.display = "none";
      nextLabel.style.display = "inline";
    } else {
      inLabel.style.display = "inline";
      nextLabel.style.display = "none";
    }
    showingIn = !showingIn;
  }, 5000);
}

function updateExpandablePanel(card, mob) {
  const elNext = card.querySelector("[data-next-time]");
  const elLast = card.querySelector("[data-last-kill]");
  const elMemo = card.querySelector("[data-last-memo]");

  const lastStr = formatLastKillTime(mob.last_kill_time);
  if (elLast) elLast.textContent = `前回: ${lastStr}`;

  if (elMemo) {
    elMemo.textContent = mob.memo_text || "";
  }
}

function updateProgressBars() {
  const state = getState();
  state.mobs.forEach((mob) => {
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
}, 60000);

export { filterAndRender, distributeCards, updateProgressText, updateProgressBar, createMobCard, displayStatus, DOM, sortAndRedistribute, onKillReportReceived, updateProgressBars };
