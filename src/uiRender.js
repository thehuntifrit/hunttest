// uiRender.js
import { state, getState } from "./store.js";
import { calculateRepop, findNextSpawnTime } from "./cal.js";
import { drawSpawnPoint, processText, formatDuration, formatLastKillTime } from "./utils.js";
import { RANK_COLORS, PROGRESS_CLASSES, FILTER_TO_DATA_RANK_MAP, DOM } from "./uiShared.js";
import { updateFilterUI } from "./filter.js";

function createMobCard(mob) {
    const rank = mob.Rank;
    const rankConfig = RANK_COLORS[rank] || RANK_COLORS.A;
    const rankLabel = rankConfig.label || rank;

    const progressText = mob.repopInfo?.timeRemaining || "Calculating...";
    const lastKillDisplay = formatLastKillTime(mob.last_kill_time);
    const absFmt = { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' };

    // リポップ計算による最小再出現時間
    const nextTimeDisplay = mob.repopInfo?.nextMinRepopDate
        ? new Intl.DateTimeFormat('ja-JP', absFmt).format(mob.repopInfo.nextMinRepopDate)
        : '未確定';

    // 天候シード方式による「次回条件成立時間」
    const nextConditionTime = findNextSpawnTime(mob);
    const nextConditionDisplay = nextConditionTime
        ? new Intl.DateTimeFormat('ja-JP', absFmt).format(nextConditionTime)
        : '未確定';

    const prevTimeDisplay = mob.last_kill_time > 0
        ? new Intl.DateTimeFormat('ja-JP', absFmt).format(new Date(mob.last_kill_time * 1000))
        : '未報告';

    const isExpandable = rank === "S";
    const { openMobCardNo } = getState();
    const isOpen = isExpandable && mob.No === openMobCardNo;

    const isS_LastOne = rank === "S" && mob.spawn_points && mob.spawn_points.some(
        p => p.is_last_one && (p.mob_ranks.includes("S") || p.mob_ranks.includes("A"))
    );

    const spawnPointsHtml = (rank === "S" && mob.Map)
        ? (mob.spawn_points ?? []).map(point => drawSpawnPoint(
            point,
            mob.spawn_cull_status,
            mob.No,
            mob.Rank,
            point.is_last_one,
            isS_LastOne,
            mob.last_kill_time,
            mob.prev_kill_time
        )).join("")
        : "";

    const cardHeaderHTML = `
<div class="px-2 py-1 space-y-1 bg-gray-800/70" data-toggle="card-header">
  <!-- 上段：ランク・モブ名・報告ボタン -->
  <div class="grid grid-cols-[auto_1fr_auto] items-center w-full gap-2">
    <!-- 左：ランク -->
    <span class="w-6 h-6 flex items-center justify-center rounded-full text-white text-xs font-bold ${rankConfig.bg}">
      ${rankLabel}
    </span>

    <!-- 中央：モブ名＋エリア名 -->
    <div class="flex flex-col min-w-0">
      <span class="text-base font-bold truncate">${mob.Name}</span>
      <span class="text-xs text-gray-400 truncate">${mob.Area} (${mob.Expansion})</span>
    </div>

    <!-- 右端：報告ボタン（即時報告と同じ構造） -->
    <div class="flex-shrink-0 flex items-center justify-end">
      <button data-report-type="${rank === 'A' || rank === 'F' ? 'instant' : 'modal'}" data-mob-no="${mob.No}"
        class="w-8 h-8 flex items-center justify-center text-[12px] rounded bg-${rank === 'A' || rank === 'F' ? 'green' : 'green'}-600 
        hover:bg-${rank === 'A' || rank === 'F' ? 'green' : 'green'}-800 selected:bg-${rank === 'A' || rank === 'F' ? 'red' : 'green'}-400 
        text-white font-semibold transition text-center leading-tight whitespace-pre-line">${rank === 'A' || rank === 'F' ? '報告<br>する' : '報告<br>する'}</button>
    </div>
  </div>

  <!-- 下段：プログレスバー -->
  <div class="progress-bar-wrapper h-6 rounded-full relative overflow-hidden transition-all duration-100 ease-linear">
    <div class="progress-bar-bg absolute left-0 top-0 h-full rounded-full transition-all duration-100 ease-linear"
         style="width: ${mob.repopInfo?.elapsedPercent || 0}%"></div>
    <div class="progress-text absolute inset-0 flex items-center justify-center text-sm font-semibold"
         style="line-height: 1;">
      ${progressText}
    </div>
  </div>
</div>
`;

    const expandablePanelHTML = isExpandable ? `
<div class="expandable-panel ${isOpen ? 'open' : ''}">
  <div class="px-2 py-1 text-sm space-y-0.5">
    <div class="flex justify-between items-start flex-wrap">
      <div class="w-full text-right text-sm font-mono text-green-300">次回: ${nextTimeDisplay}</div>
      <div class="w-full text-right text-xs text-gray-400 pt-1">前回: ${lastKillDisplay}</div>
      <div class="w-full text-left text-sm text-gray-300 mb-2">Memo: ${mob.last_kill_memo || 'なし'}</div>
      <div class="w-full font-semibold text-yellow-300 border-t border-gray-600">抽出条件</div>
      <div class="w-full text-gray-300 mb-2">${processText(mob.Condition)}</div>
    </div>
    ${mob.Map && rank === 'S' ? `
    <div class="map-content py-0.5 flex justify-center relative"><img src="./maps/${mob.Map}" alt="${mob.Area} Map"
           class="mob-crush-map w-full h-auto rounded shadow-lg border border-gray-600" data-mob-no="${mob.No}">
      <div class="map-overlay absolute inset-0" data-mob-no="${mob.No}">${spawnPointsHtml}</div>
    </div>
    ` : ''}
  </div>
</div>
` : '';

    return `
<div class="mob-card bg-gray-700 rounded-lg shadow-xl overflow-hidden cursor-pointer border border-gray-700 transition duration-150"
     data-mob-no="${mob.No}" data-rank="${rank}">
  ${cardHeaderHTML}
  ${expandablePanelHTML}
</div>
`;
}

function filterAndRender({ isInitialLoad = false } = {}) {
    const state = getState();
    const uiRank = state.filter.rank;
    const dataRank = FILTER_TO_DATA_RANK_MAP[uiRank] || uiRank;
    const areaSets = state.filter.areaSets; // ランクごとのエリア選択を保持している想定

    const filtered = state.mobs.filter(mob => {
        // --- ALL の場合 ---
        if (dataRank === "ALL") {
            // mob のランクに対応するエリアセットを取得
            const mobRank = mob.Rank.startsWith("B")
                ? (mob.Rank.includes("A") ? "A" : "F") // B系はA/Fに寄せる
                : mob.Rank;
            if (!["S", "A", "F"].includes(mobRank)) return false;

            const areaSetForRank = areaSets[mobRank];
            const mobExpansion = mob.Rank.startsWith("B")
                ? state.mobs.find(m => m.No === mob.related_mob_no)?.Expansion || mob.Expansion
                : mob.Expansion;

            // そのランクでエリア選択が無ければ表示対象
            if (!areaSetForRank || !(areaSetForRank instanceof Set) || areaSetForRank.size === 0) {
                return true;
            }
            // 選択されているエリアに含まれていれば表示
            return areaSetForRank.has(mobExpansion);
        }

        // --- A/F/S 単独ランクの場合 ---
        if (dataRank === "A") {
            if (mob.Rank !== "A" && !mob.Rank.startsWith("B")) return false;
        } else if (dataRank === "F") {
            if (mob.Rank !== "F" && !mob.Rank.startsWith("B")) return false;
        } else if (mob.Rank !== dataRank) {
            return false;
        }

        const mobExpansion = mob.Rank.startsWith("B")
            ? state.mobs.find(m => m.No === mob.related_mob_no)?.Expansion || mob.Expansion
            : mob.Expansion;

        const areaSet = areaSets[uiRank];
        if (!areaSet || !(areaSet instanceof Set) || areaSet.size === 0) return true;
        return areaSet.has(mobExpansion);
    });

    // ソート復活（表示の安定性のため、No昇順に統一。必要ならelapsedPercent優先へ切替可能）
    filtered.sort((a, b) => a.No - b.No);

    // DOM構築（文字列→要素）＋平文問題の回避
    const frag = document.createDocumentFragment();
    filtered.forEach(mob => {
        const temp = document.createElement("div");
        temp.innerHTML = createMobCard(mob);
        frag.appendChild(temp.firstElementChild);
    });

    DOM.masterContainer.innerHTML = "";
    DOM.masterContainer.appendChild(frag);
    distributeCards();
    updateFilterUI(); // タブ強調/クリックカウントの反映

    if (isInitialLoad) {
        // 初期レンダリング後に進捗バーを一度更新
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

function updateProgressBars() {
    const state = getState();
    state.mobs = state.mobs.map(m => ({ ...m, repopInfo: calculateRepop(m) }));

    document.querySelectorAll(".mob-card").forEach(card => {
        const mobNo = parseInt(card.dataset.mobNo, 10);
        const mob = state.mobs.find(m => m.No === mobNo);
        if (!mob?.repopInfo) return;

        const { elapsedPercent, status, nextMinRepopDate, maxRepop } = mob.repopInfo;
        const bar = card.querySelector(".progress-bar-bg");
        const text = card.querySelector(".progress-text");
        const wrapper = bar?.parentElement;
        if (!bar || !text || !wrapper) return;

        // --- 条件成立時間と比較 ---
        const conditionTime = findNextSpawnTime(mob);
        let displayTime = null;
        if (nextMinRepopDate && conditionTime) {
            displayTime = conditionTime > nextMinRepopDate ? conditionTime : nextMinRepopDate;
        } else {
            displayTime = nextMinRepopDate || conditionTime;
        }

        const absFmt = { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' };
        const nextTimeStr = displayTime
            ? new Intl.DateTimeFormat('ja-JP', absFmt).format(displayTime)
            : "未確定";

        const remainingStr = maxRepop
            ? `残り ${formatDuration(maxRepop - Date.now() / 1000)}`
            : "";

        // --- プログレスバー更新 ---
        bar.style.width = `${elapsedPercent}%`;

        text.innerHTML = `
          <span class="percent">${elapsedPercent.toFixed(0)}%</span>
          <span class="next-time">次回 ${nextTimeStr}</span>
          <span class="remaining">${remainingStr}</span>
        `;

        // --- 色・クラス制御 ---
        bar.classList.remove(PROGRESS_CLASSES.P0_60, PROGRESS_CLASSES.P60_80, PROGRESS_CLASSES.P80_100);
        text.classList.remove(PROGRESS_CLASSES.TEXT_NEXT, PROGRESS_CLASSES.TEXT_POP);
        wrapper.classList.remove(PROGRESS_CLASSES.MAX_OVER_BLINK);

        if (status === "PopWindow") {
            if (elapsedPercent <= 60) bar.classList.add(PROGRESS_CLASSES.P0_60);
            else if (elapsedPercent <= 80) bar.classList.add(PROGRESS_CLASSES.P60_80);
            else bar.classList.add(PROGRESS_CLASSES.P80_100);
            text.classList.add(PROGRESS_CLASSES.TEXT_POP);
        } else if (status === "MaxOver") {
            bar.classList.add(PROGRESS_CLASSES.P80_100);
            text.classList.add(PROGRESS_CLASSES.TEXT_POP);
            wrapper.classList.add(PROGRESS_CLASSES.MAX_OVER_BLINK);
        } else {
            text.classList.add(PROGRESS_CLASSES.TEXT_NEXT);
        }
    });
}

export { filterAndRender, distributeCards, updateProgressBars, createMobCard };
