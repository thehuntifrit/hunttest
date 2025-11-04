// uiRender.js

import { loadMaintenance } from "./app.js";
import { calculateRepop, findNextSpawnTime, formatDuration, formatDurationHM, formatLastKillTime, debounce, getEorzeaTime } from "./cal.js";
import { drawSpawnPoint, isCulled, attachLocationEvents } from "./location.js";
import { getState, RANK_COLORS, PROGRESS_CLASSES, FILTER_TO_DATA_RANK_MAP } from "./dataManager.js";
import { renderRankTabs, renderAreaFilterPanel, updateFilterUI, filterMobsByRankAndArea } from "./filterUI.js";

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
    modalMemoInput: document.getElementById('report-memo'),
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
        error: "text-red-300"
    }[type] || "text-white";

    el.innerHTML = `<div class="${color}">${message}</div>`;
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
    const rankConfig = RANK_COLORS[rank] || RANK_COLORS.A;
    const rankLabel = rankConfig.label || rank;
    
    const isExpandable = rank === "S";
    const { openMobCardNo } = getState();
    const isOpen = isExpandable && mob.No === openMobCardNo;

    const state = getState();
    const mobLocationsData = state.mobLocations?.[mob.No];
    const spawnCullStatus = mobLocationsData || mob.spawn_cull_status; 

    let isLastOne = false;
    let validSpawnPoints = [];
    let displayCountText = ""; // ★ 追加: 表示用の残り個数テキスト

    if (mob.Map && mob.spawn_points) {
        // Sランクを含む地点 かつ 湧き潰されていない地点 のみをカウント
        validSpawnPoints = (mob.spawn_points ?? []).filter(point => {
            const isS_SpawnPoint = point.mob_ranks.includes("S");
            if (!isS_SpawnPoint) {
                return false; // Sランクを含まない地点は除外
            }
            const pointStatus = spawnCullStatus?.[point.id];
            return !isCulled(pointStatus, mob.No);
        });
        
        const remainingCount = validSpawnPoints.length;
        
        if (remainingCount === 1) {
            isLastOne = true;
            const pointId = validSpawnPoints[0]?.id || "";
            const pointNumber = pointId.slice(-2); // 末尾2桁を抽出
            displayCountText = ` <span class="text-yellow-600">${pointNumber}番</span>`;
        } else if (remainingCount > 1) {
            isLastOne = false;
            displayCountText = ` <span class="text-xs text-gray-400 relative -top-0.5">@</span>&nbsp;${remainingCount}<span class="text-xs relative -top-[0.04rem]">個</span>`;
        }

        isLastOne = remainingCount === 1; // ラスト1点の判定は維持
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
            )
        }).join("")
        : "";

    const mobNameAndCountHtml = `<span class="text-base flex items-baseline font-bold truncate">${mob.Name}</span><span class="text-sm flex items-baseline font-bold">${displayCountText}</span>`;
    const cardHeaderHTML = `
<div class="px-2 py-1 space-y-1 bg-gray-800/70" data-toggle="card-header">
    <!-- 上段：ランク・モブ名・報告ボタン -->
    <div class="grid grid-cols-[auto_1fr_auto] items-center w-full gap-2">
        <!-- 左：ランク -->
        <span
            class="w-6 h-6 flex items-center justify-center rounded-full text-white text-sm font-bold ${rankConfig.bg}">
            ${rankLabel}
        </span>

        <!-- 中央：モブ名＋エリア名 -->
        <div class="flex flex-col min-w-0">
            <div class="flex items-baseline space-x-1">${mobNameAndCountHtml}</div>
            <span class="text-xs text-gray-400 truncate">${mob.Area} (${mob.Expansion})</span>
        </div>

        <!-- 右端：報告ボタン（見た目は統一、動作だけ分岐） -->
        <div class="flex-shrink-0 flex items-center justify-end">
            <button data-report-type="${rank === 'A' ? 'instant' : 'modal'}" data-mob-no="${mob.No}" class="w-8 h-8 flex items-center justify-center text-[12px] rounded 
            bg-green-600 hover:bg-green-400 selected:bg-green-800 text-white font-semibold transition text-center leading-tight whitespace-pre-line">報告<br>する</button>
        </div>
    </div>

    <!-- 下段：プログレスバー（構造のみ） -->
    <div class="progress-bar-wrapper h-5 rounded-lg relative overflow-hidden transition-all duration-100 ease-linear">
        <div class="progress-bar-bg absolute left-0 top-0 h-full rounded-lg transition-all duration-100 ease-linear" style="width: 0%"></div>
        <div class="progress-text absolute inset-0 flex items-center justify-center text-sm font-semibold" style="line-height: 1;"></div>
    </div>
</div>
`;

    const expandablePanelHTML = isExpandable ? `
<div class="expandable-panel bg-gray-800/70 ${isOpen ? 'open' : ''}">
    <div class="px-2 py-0 text-sm space-y-0.5">
        <div class="flex justify-between items-start flex-wrap">
            <div class="w-full text-right text-xs text-gray-400 pt-1" data-last-kill></div>
            <div class="w-full text-left text-sm text-gray-300">Memo: <span data-last-memo></span></div>
            <div class="w-full font-semibold text-yellow-300 border-t border-gray-600">抽選条件</div>
            <div class="w-full text-gray-300 text-xs mt-1">${processText(mob.Condition)}</div>
        </div>
        ${mob.Map && rank === 'S' ? `
        <div class="map-content py-0.5 flex justify-center relative">
            <img src="./maps/${mob.Map}" alt="${mob.Area} Map"
                class="mob-crush-map w-full h-auto rounded shadow-lg border border-gray-600" data-mob-no="${mob.No}">
            <div class="map-overlay absolute inset-0" data-mob-no="${mob.No}">${spawnPointsHtml}</div>
        </div>
        ` : ''}
    </div>
</div>
` : '';

    const repopInfo = calculateRepop(mob, state.maintenance);
    const isStopped = repopInfo.isMaintenanceStop;
    const stoppedClass = isStopped ? "opacity-50 grayscale pointer-events-none" : "";

return `
<div class="mob-card bg-gray-700 rounded-lg shadow-xl overflow-hidden cursor-pointer transition duration-150 ${stoppedClass}" 
style="border: 0.5px solid ${rankConfig.rgbaBorder};" data-mob-no="${mob.No}" data-rank="${rank}">${cardHeaderHTML}${expandablePanelHTML}</div>
`;
}

// ランク優先度: S=2, A=1, F=3 → ソート順 S > A > F
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

// ランク > 拡張降順 > モブNo昇順 > インスタンス昇順
function baseComparator(a, b) {
    const pa = parseMobNo(a.No);
    const pb = parseMobNo(b.No);

    const rankDiff = rankPriority(pa.rankCode) - rankPriority(pb.rankCode);
    if (rankDiff !== 0) return rankDiff;

    if (pa.expansion !== pb.expansion) return pb.expansion - pa.expansion;
    if (pa.mobNo !== pb.mobNo) return pa.mobNo - pb.mobNo;
    return pa.instance - pb.instance;
}

// 時間ソート + baseComparator
function progressComparator(a, b) {
    const nowSec = Date.now() / 1000;
    const aInfo = a.repopInfo || {};
    const bInfo = b.repopInfo || {};

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
    // fallback は baseComparator
    return baseComparator(a, b);
}

function filterAndRender({ isInitialLoad = false } = {}) {
    const state = getState();
    const filtered = filterMobsByRankAndArea(state.mobs);

    if (["S", "A", "FATE"].includes(state.filter.rank)) {
        filtered.sort(progressComparator);
    } else {
        filtered.sort(baseComparator);
    }

    const frag = document.createDocumentFragment();
    filtered.forEach(mob => {
        const temp = document.createElement("div");
        temp.innerHTML = createMobCard(mob);
        const card = temp.firstElementChild;
        frag.appendChild(card);

        updateProgressText(card, mob);
        updateProgressBar(card, mob);
        updateExpandablePanel(card, mob);
    });

    DOM.masterContainer.innerHTML = "";
    DOM.masterContainer.appendChild(frag);
    distributeCards();

    attachLocationEvents();

    if (isInitialLoad) {
        updateProgressBars();
    }
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

    // リセット
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
        if (elapsedPercent <= 40) {
            bar.classList.add(PROGRESS_CLASSES.P0_60);
        } else if (elapsedPercent <= 80) {
            bar.classList.add(PROGRESS_CLASSES.P60_80);
        } else if (elapsedPercent <= 90) {
            bar.classList.add(PROGRESS_CLASSES.P80_100);
        } else {
            bar.classList.add(PROGRESS_CLASSES.P80_100);
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

    const { elapsedPercent, nextMinRepopDate, nextConditionSpawnDate, minRepop, maxRepop, status } = mob.repopInfo;

    const absFmt = {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Tokyo'
    };
    const inTimeStr = nextMinRepopDate
        ? new Intl.DateTimeFormat('ja-JP', absFmt).format(nextMinRepopDate)
        : "未確定";
    const nextTimeStr = nextConditionSpawnDate
        ? new Intl.DateTimeFormat('ja-JP', absFmt).format(nextConditionSpawnDate)
        : null;

    let rightStr = "";
    const nowSec = Date.now() / 1000;
    if (status === "Maintenance" || status === "Next") {
        rightStr = `Next ${formatDurationHM(minRepop - nowSec)}`;
    } else if (status === "PopWindow") {
        rightStr = `残り ${formatDurationHM(maxRepop - nowSec)}`;
    } else if (status === "MaxOver") {
        rightStr = `Time Over (100%)`;
    } else {
        rightStr = `未確定`;
    }
    
    text.innerHTML = `
    <div class="w-full grid grid-cols-2 items-center text-sm font-semibold" style="line-height:1;">
        <div class="pl-2 text-left">
          ${rightStr}${status !== "MaxOver" && status !== "Unknown" ? ` (${elapsedPercent.toFixed(0)}%)` : ""}
        </div>
        <div class="pr-1 text-right toggle-container">
          <span class="label-in">in ${inTimeStr}</span>
          <span class="label-next" style="display:none;">${nextTimeStr ? `Next ${nextTimeStr}` : ""}</span>
        </div>
    </div>
  `;

    // --- 状態に応じたクラス付与 ---
    if (status === "MaxOver") {
        text.classList.add("max-over");
    } else {
        text.classList.remove("max-over");
    }

    if (minRepop - nowSec >= 3600) {
        text.classList.add("long-wait");
    } else {
        text.classList.remove("long-wait");
    }

    const toggleContainer = text.querySelector(".toggle-container");
    if (toggleContainer && !toggleContainer.dataset.toggleStarted) {
        startToggleInNext(toggleContainer);
        toggleContainer.dataset.toggleStarted = "true";
    }
}

function startToggleInNext(container) {
    const inLabel = container.querySelector(".label-in");
    const nextLabel = container.querySelector(".label-next");
    let showingIn = true;

    setInterval(() => {
        if (nextLabel.textContent.trim() === "") return;

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
    if (!elNext && !elLast && !elMemo) return;

    const absFmt = { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' };

    const nextMin = mob.repopInfo?.nextMinRepopDate;
    const conditionTime = findNextSpawnTime(mob, nextMin);
    const displayTime = (nextMin && conditionTime)
        ? (conditionTime > nextMin ? conditionTime : nextMin)
        : (nextMin || conditionTime);

    const nextStr = displayTime
        ? new Intl.DateTimeFormat('ja-JP', absFmt).format(displayTime)
        : "未確定";

    const lastStr = formatLastKillTime(mob.last_kill_time);
    const memoStr = mob.last_kill_memo || "なし";

    if (elLast) elLast.textContent = `前回: ${lastStr}`;
    if (elMemo) elMemo.textContent = memoStr;
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
const areaPanel = document.getElementById("area-filter-panel");

function onKillReportReceived(mobId, kill_time) {
    const mob = getState().mobs.find(m => m.No === mobId);
    if (!mob) return;

    mob.last_kill_time = Number(kill_time);
    mob.repopInfo = calculateRepop(mob);

    const card = document.querySelector(`.mob-card[data-mob-no="${mob.No}"]`);
    if (card) {
        updateProgressText(card, mob);
        updateProgressBar(card, mob);
    }
}

setInterval(() => {
    updateProgressBars();
}, 60000);

export {
    filterAndRender, distributeCards, updateProgressText, updateProgressBar, createMobCard, displayStatus, DOM,
    renderAreaFilterPanel, renderRankTabs, sortAndRedistribute, updateFilterUI, onKillReportReceived, updateProgressBars
};
