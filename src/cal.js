// cal.js - 修正版 v3: 独立探索と生区間データ交差ロジック

const ET_HOUR_SEC = 175;
const WEATHER_CYCLE_SEC = 1400;
const ET_DAY_SEC = ET_HOUR_SEC * 24;
const MOON_CYCLE_SEC = ET_DAY_SEC * 32;
const MOON_PHASE_DURATION_SEC = ET_DAY_SEC * 4;
// 制限は探索時の安全装置として使用。実質無限（数週間分）
const MAX_SEARCH_ITERATIONS = 4000; 
const LIMIT_DAYS = 20;

function formatDuration(seconds) {
  const totalMinutes = Math.floor(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatDurationHM(seconds) {
  if (seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${String(h).padStart(2, "0")}h${String(m).padStart(2, "0")}m`;
}

function debounce(func, wait) {
  let timeout;
  return function executed(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

function formatLastKillTime(timestamp) {
  if (timestamp === 0) return "未報告";
  const aligned = Math.floor(timestamp / 60) * 60;
  const killTimeMs = aligned * 1000;
  const nowMs = Date.now();
  const diffSeconds = Math.floor((nowMs - killTimeMs) / 1000);

  if (diffSeconds < 3600) {
    if (diffSeconds < 60) return `Just now`;
    const minutes = Math.floor(diffSeconds / 60);
    return `${minutes}m ago`;
  }

  const options = {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo"
  };
  const date = new Date(killTimeMs);
  return new Intl.DateTimeFormat("ja-JP", options).format(date);
}

// --- ユーティリティ関数 ---
function getEorzeaTime(date = new Date()) {
  const unixMs = date.getTime();
  const REAL_MS_PER_ET_HOUR = ET_HOUR_SEC * 1000;
  const ET_HOURS_PER_DAY = 24;

  const eorzeaTotalHours = Math.floor(unixMs / REAL_MS_PER_ET_HOUR);
  const hours = eorzeaTotalHours % ET_HOURS_PER_DAY;

  const remainingMs = unixMs % REAL_MS_PER_ET_HOUR;
  const REAL_MS_PER_ET_MINUTE = REAL_MS_PER_ET_HOUR / 60;
  const minutes = Math.floor(remainingMs / REAL_MS_PER_ET_MINUTE);

  return {
    hours: hours.toString().padStart(2, "0"),
    minutes: minutes.toString().padStart(2, "0")
  };
}

function getEtHourFromRealSec(realSec) {
  const ticks = Math.floor(realSec / ET_HOUR_SEC);
  return ticks % 24;
}

function alignToEtHour(realSec) {
  return Math.floor(realSec / ET_HOUR_SEC) * ET_HOUR_SEC;
}

function alignToWeatherCycle(realSec) {
  return Math.floor(realSec / WEATHER_CYCLE_SEC) * WEATHER_CYCLE_SEC;
}

function ceilToWeatherCycle(realSec) {
  return Math.ceil(realSec / WEATHER_CYCLE_SEC) * WEATHER_CYCLE_SEC;
}

function getEorzeaMoonInfo(date = new Date()) {
  const unixSeconds = date.getTime() / 1000;
  const EORZEA_SPEED_RATIO = 20.57142857142857;
  const eorzeaTotalDays = (unixSeconds * EORZEA_SPEED_RATIO) / 86400;
  const phase = (eorzeaTotalDays % 32) + 1;

  let label = null;
  if (phase >= 32.5 || phase < 4.5) label = "新月";
  else if (phase >= 16.5 && phase < 20.5) label = "満月";

  return { phase, label };
}

function getEorzeaWeatherSeed(date = new Date()) {
  const unixSeconds = Math.floor(date.getTime() / 1000);
  const eorzeanHours = Math.floor(unixSeconds / ET_HOUR_SEC);
  const eorzeanDays = Math.floor(eorzeanHours / 24);

  let timeChunk = (eorzeanHours % 24) - (eorzeanHours % 8);
  timeChunk = (timeChunk + 8) % 24;

  const seed = eorzeanDays * 100 + timeChunk;
  const step1 = (seed << 11) ^ seed;
  const step2 = ((step1 >>> 8) ^ step1) >>> 0;
  return step2 % 100;
}

function checkWeatherInRange(mob, seed) {
  if (mob.weatherSeedRange) {
    const [min, max] = mob.weatherSeedRange;
    return seed >= min && seed <= max;
  }
  if (mob.weatherSeedRanges) {
    return mob.weatherSeedRanges.some(([min, max]) => seed >= min && seed <= max);
  }
  return false;
}

function checkTimeRange(timeRange, realSec) {
  const etHour = getEtHourFromRealSec(realSec);
  const { start, end } = timeRange;

  if (start < end) return etHour >= start && etHour < end;
  return etHour >= start || etHour < end;
}

function checkEtCondition(mob, realSec) {
  const { phase } = getEorzeaMoonInfo(new Date(realSec * 1000));

  if (mob.conditions) {
    const { firstNight, otherNights } = mob.conditions;
    if (firstNight?.timeRange && (isFirstNightPhase(phase) || mob.moonPhase === "新月")) {
      return checkTimeRange(firstNight.timeRange, realSec);
    }
    if (otherNights?.timeRange && (isOtherNightsPhase(phase) || mob.moonPhase === "満月")) {
      return checkTimeRange(otherNights.timeRange, realSec);
    }
    return false;
  }

  if (mob.timeRange) return checkTimeRange(mob.timeRange, realSec);
  if (mob.timeRanges) return mob.timeRanges.some(tr => checkTimeRange(tr, realSec));

  // 時間条件がない場合、常にTrue
  return true;
}

function isFirstNightPhase(phase) {
  return phase >= 32.5 || phase < 1.5;
}

function isOtherNightsPhase(phase) {
  return phase >= 1.5 && phase < 4.5;
}

function calculateNextMoonStart(startSec, targetPhase) {
    const startPhase = getEorzeaMoonInfo(new Date(startSec * 1000)).phase;
    let phaseDiff = targetPhase - startPhase;
    if (phaseDiff < 0) phaseDiff += 32;

    let nextStartSec = startSec + phaseDiff * ET_DAY_SEC;

    // 現在時刻より過去になる場合は次のサイクルへ
    if (nextStartSec < startSec) {
        nextStartSec += MOON_CYCLE_SEC;
    }
    return nextStartSec;
}

// --- 新設：各条件の「生区間データ」抽出関数 ---

/**
 * 月齢の生区間データを抽出する
 * @param {object} mob
 * @param {number} pointSec
 * @returns {Array<[number, number]>} [start, end] の配列
 */
function findMoonRanges(mob, pointSec) {
  if (!mob.moonPhase) return [[0, Infinity]]; // 月齢条件がない場合は無制限区間を返す

  const ranges = [];
  let moonStart = pointSec;
  let targetPhase = mob.moonPhase === "新月" ? 32.5 : 16.5;

  // pointSecを含む現在の月齢フェーズの開始点を計算
  const startPhase = getEorzeaMoonInfo(new Date(pointSec * 1000)).phase;
  let phaseDiff = targetPhase - startPhase;
  // 現在のフェーズが targetPhase に含まれていれば、そのフェーズの開始点を計算
  if (
    (mob.moonPhase === "新月" && (startPhase >= 32.5 || startPhase < 4.5)) ||
    (mob.moonPhase === "満月" && (startPhase >= 16.5 && startPhase < 20.5))
  ) {
    let currentPhaseStart = pointSec - (startPhase - targetPhase) * ET_DAY_SEC;
    while (currentPhaseStart > pointSec) currentPhaseStart -= MOON_CYCLE_SEC;
    
    ranges.push([currentPhaseStart, currentPhaseStart + MOON_PHASE_DURATION_SEC]);
  }
  
  // pointSec より未来の最初のターゲット月齢の開始点を計算
  moonStart = calculateNextMoonStart(pointSec, targetPhase);
  
  // 最大で2サイクル分探索
  for (let i = 0; i < 2; i++) {
    const moonEnd = moonStart + MOON_PHASE_DURATION_SEC;
    if (moonEnd > pointSec) {
      ranges.push([moonStart, moonEnd]);
    }
    moonStart += MOON_CYCLE_SEC;
  }
  
  // 重複・順序を整理
  ranges.sort((a, b) => a[0] - b[0]);
  return ranges.filter((range, index) => {
    if (index === 0) return true;
    // 完全に重複する区間を削除
    return range[0] > ranges[index - 1][0] || range[1] > ranges[index - 1][1];
  });
}

/**
 * 天候の生区間データを抽出する
 * @param {object} mob
 * @param {number} pointSec
 * @param {number} searchLimit
 * @returns {Array<[number, number]>} [start, end] の配列
 */
function findWeatherRanges(mob, pointSec, searchLimit) {
  if (!mob.weatherSeedRange && !mob.weatherSeedRanges) return [[0, Infinity]];

  const ranges = [];
  const requiredMinutes = mob.weatherDuration?.minutes || 0;
  const requiredSec = requiredMinutes > 0 ? requiredMinutes * 60 : WEATHER_CYCLE_SEC;

  // 1. 後方スキャン: pointSecを含むアクティブな天候を探す
  let scanStart = alignToWeatherCycle(pointSec) - requiredSec;
  // scanStartを天候サイクル境界に揃える
  scanStart = alignToWeatherCycle(scanStart);
  
  // pointSecを含むサイクル境界までをチェック
  let checkCursor = scanStart;
  let lastHitStart = null;
  let consecutiveCycles = 0;
  let currentWindowStart = null;
  let found = false;

  while (checkCursor <= alignToWeatherCycle(pointSec)) {
    const seed = getEorzeaWeatherSeed(new Date(checkCursor * 1000));
    if (checkWeatherInRange(mob, seed)) {
      if (currentWindowStart === null) currentWindowStart = checkCursor;
      consecutiveCycles++;
      lastHitStart = checkCursor;
    } else {
      currentWindowStart = null;
      consecutiveCycles = 0;
    }
    
    // 連続条件を満たしたら、現在の有効区間を確定させる
    if (consecutiveCycles * WEATHER_CYCLE_SEC >= requiredSec) {
        found = true;
    }
    checkCursor += WEATHER_CYCLE_SEC;
  }
  
  // pointSecの時点でアクティブであった場合、その区間を延長して追加
  if (found && lastHitStart !== null) {
      // 連続条件を満たした最も早い開始点 (start = lastHitStart) から延長
      let extendedEnd = lastHitStart + consecutiveCycles * WEATHER_CYCLE_SEC;
      let extensionCursor = extendedEnd;
      let iterations = 0;
      
      // 無限延長（安全装置としてMAX_SEARCH_ITERATIONSを使用）
      while (extensionCursor <= searchLimit && iterations < MAX_SEARCH_ITERATIONS) {
          const seed = getEorzeaWeatherSeed(new Date(extensionCursor * 1000));
          if (checkWeatherInRange(mob, seed)) {
              extendedEnd += WEATHER_CYCLE_SEC;
              extensionCursor += WEATHER_CYCLE_SEC;
          } else {
              break;
          }
          iterations++;
      }
      
      // 天候条件の真の開始点 (lastHitStart) と延長終了点
      ranges.push([lastHitStart, extendedEnd]);
  }

  // 2. 前方スキャン: pointSec以降の未来の天候を探す
  let forwardCursor = ceilToWeatherCycle(pointSec);
  let iterations = 0;

  while (forwardCursor <= searchLimit && iterations < MAX_SEARCH_ITERATIONS) {
    let accumulated = 0;
    let testCursor = forwardCursor;
    let consecutiveStart = forwardCursor;

    // 連続条件を満たすまで探索
    while (accumulated < requiredSec) {
      const seed = getEorzeaWeatherSeed(new Date(testCursor * 1000));
      if (!checkWeatherInRange(mob, seed)) break;
      accumulated += WEATHER_CYCLE_SEC;
      testCursor += WEATHER_CYCLE_SEC;
    }

    if (accumulated >= requiredSec) {
      // 条件を満たしたら、そこから更に延長
      let initialEnd = consecutiveStart + accumulated;
      let extendedEnd = initialEnd;
      let extensionCursor = extendedEnd;
      
      let extIterations = 0;
      while (extensionCursor <= searchLimit && extIterations < MAX_SEARCH_ITERATIONS) {
        const seed = getEorzeaWeatherSeed(new Date(extensionCursor * 1000));
        if (checkWeatherInRange(mob, seed)) {
          extendedEnd += WEATHER_CYCLE_SEC;
          extensionCursor += WEATHER_CYCLE_SEC;
        } else {
          break;
        }
        extIterations++;
      }
      
      ranges.push([consecutiveStart, extendedEnd]);
      forwardCursor = extendedEnd; // 延長した終了時刻から次を探索
    } else {
      forwardCursor = ceilToWeatherCycle(testCursor); // 途切れた次のサイクルから再開
    }
    
    if (forwardCursor <= consecutiveStart) {
      forwardCursor = consecutiveStart + WEATHER_CYCLE_SEC;
    }
    iterations++;
  }

  // 重複を排除してソート
  ranges.sort((a, b) => a[0] - b[0]);
  return ranges.filter((range, index) => {
    if (index === 0) return true;
    return range[0] >= ranges[index - 1][1] || range[0] > ranges[index - 1][0];
  });
}


/**
 * ET（時間）の生区間データを抽出する
 * @param {object} mob
 * @param {number} pointSec
 * @param {number} searchLimit
 * @returns {Array<[number, number]>} [start, end] の配列
 */
function findEtRanges(mob, pointSec, searchLimit) {
  if (!mob.timeRange && !mob.timeRanges && !mob.conditions) return [[0, Infinity]];

  const ranges = [];
  // pointSecを含む過去のET境界まで戻す
  let etCursor = alignToEtHour(pointSec); 
  
  // pointSecより最大1日分過去からスキャンを開始（アクティブウィンドウを確実に捕捉）
  etCursor = Math.max(0, etCursor - ET_DAY_SEC);
  
  let iterations = 0;

  while (etCursor < searchLimit && iterations < MAX_SEARCH_ITERATIONS) {
    if (checkEtCondition(mob, etCursor)) {
      const startEtHour = getEtHourFromRealSec(etCursor);
      let etEnd = etCursor + ET_HOUR_SEC; // 最初の1時間区間の終わり

      // ET時間のウィンドウ終点を計算（次の不適合時間まで延長）
      let currentCursor = etEnd;
      while (currentCursor < searchLimit) {
        if (checkEtCondition(mob, currentCursor)) {
          etEnd = currentCursor + ET_HOUR_SEC;
          currentCursor += ET_HOUR_SEC;
        } else {
          break;
        }
      }

      // 区間をプッシュし、次の検索カーソルをETウィンドウの終了時刻に設定
      ranges.push([etCursor, etEnd]);
      etCursor = etEnd;

    } else {
      etCursor += ET_HOUR_SEC;
    }
    iterations++;
  }

  // 重複を排除してソート
  ranges.sort((a, b) => a[0] - b[0]);
  return ranges.filter((range, index) => {
    if (index === 0) return true;
    return range[0] >= ranges[index - 1][1] || range[0] > ranges[index - 1][0];
  });
}

/**
 * 複数の区間配列を突き合わせ、共通の交差区間を見つける
 * @param {Array<Array<[number, number]>>} rangesList [月齢範囲, 天候範囲, ET範囲] のリスト
 * @param {number} pointSec
 * @returns {{start: number, end: number} | null} 最初の有効な交差区間
 */
function findIntersection(rangesList, pointSec) {
  if (rangesList.some(r => r.length === 0)) return null;

  const [moonRanges, weatherRanges, etRanges] = rangesList;
  let bestIntersection = null;

  // 1. 月齢区間をループ
  for (const [moonStart, moonEnd] of moonRanges) {
    // moonStartがpointSecより後の場合、pointSecを考える必要はない（次以降の探索）
    const effectiveMoonStart = moonStart;

    // 2. 天候区間をループ
    for (const [weatherStart, weatherEnd] of weatherRanges) {
      // 月齢と天候の交差
      const intersect1Start = Math.max(effectiveMoonStart, weatherStart);
      const intersect1End = Math.min(moonEnd, weatherEnd);

      if (intersect1Start >= intersect1End) continue;

      // 3. ET区間をループ
      for (const [etStart, etEnd] of etRanges) {
        // 月齢・天候・ETの交差
        const intersect2Start = Math.max(intersect1Start, etStart);
        const intersect2End = Math.min(intersect1End, etEnd);

        if (intersect2Start >= intersect2End) continue;

        // 4. 最終交差区間がpointSecを考慮して有効な湧き区間となるか
        // 湧き開始時刻: 交差開始とpointSecの遅い方
        const spawnStart = Math.max(intersect2Start, pointSec); 
        
        // 湧き終了時刻: 交差終了
        const spawnEnd = intersect2End;

        // 湧き開始時刻が終了時刻より前であれば有効
        if (spawnStart < spawnEnd) {
          // 最初の有効な交差を見つけたら、それを返す
          return { start: spawnStart, end: spawnEnd };
        }
        
        // 交差終了時刻がpointSecより前の場合（既に過ぎたウィンドウ）、次のET区間へ
        if (spawnEnd <= pointSec) continue;

        // 次のET区間へ
      }
      // 次の天候区間へ
    }
    // 次の月齢区間へ
  }
  
  return null;
}

// --- メイン関数 ---

function calculateRepop(mob, maintenance) {
  const now = Date.now() / 1000;
  const lastKill = mob.last_kill_time || 0;
  const repopSec = mob.REPOP_s;
  const maxSec = mob.MAX_s;

  let maint = maintenance;
  if (maint && typeof maint === "object" && "maintenance" in maint && maint.maintenance) {
    maint = maint.maintenance;
  }
  if (!maint || !maint.serverUp || !maint.start) return baseResult("Unknown");

  const serverUp = new Date(maint.serverUp).getTime() / 1000;
  const maintenanceStart = new Date(maint.start).getTime() / 1000;

  let minRepop, maxRepop;
  if (lastKill === 0 || lastKill <= serverUp) {
    minRepop = serverUp + repopSec * 0.6;
    maxRepop = serverUp + maxSec * 0.6;
  } else {
    minRepop = lastKill + repopSec;
    maxRepop = lastKill + maxSec;
  }

  // 基準点: 最短REPOPまたは現在時間の遅い方
  const pointSec = Math.max(minRepop, now);
  const nextMinRepopDate = new Date(minRepop * 1000);
  
  // 探索リミット (安全装置: 20日分)
  const searchLimit = pointSec + LIMIT_DAYS * 24 * 3600;

  let status = "Unknown";
  let timeRemaining = "Unknown";

  let nextConditionSpawnDate = null;
  let conditionWindowEnd = null;
  let isInConditionWindow = false;

  const hasCondition = !!(
    mob.moonPhase ||
    mob.timeRange ||
    mob.timeRanges ||
    mob.weatherSeedRange ||
    mob.weatherSeedRanges ||
    mob.conditions
  );

  if (hasCondition) {
    // 1. 各条件の生区間データを独立探索
    const moonRanges = findMoonRanges(mob, pointSec);
    const weatherRanges = findWeatherRanges(mob, pointSec, searchLimit);
    const etRanges = findEtRanges(mob, pointSec, searchLimit);
    
    // 2. 生区間データの交差探索
    const conditionResult = findIntersection([moonRanges, weatherRanges, etRanges], pointSec);

    if (conditionResult) {
      const { start, end } = conditionResult;
      
      // 湧き開始時刻は、交差開始時刻とpointSecの遅い方
      const nextSec = start;
      const windowEnd = end;

      nextConditionSpawnDate = new Date(nextSec * 1000);
      conditionWindowEnd = new Date(windowEnd * 1000);
      
      // pointSecがウィンドウ内にあるか判定
      isInConditionWindow = (pointSec >= nextSec && pointSec < windowEnd);

      if (isInConditionWindow) {
        const remainingSec = windowEnd - pointSec;
        timeRemaining = `残り ${formatDurationHM(remainingSec)}`;
        status = "ConditionActive";
      } else {
        const remainingSec = nextSec - now;
        timeRemaining = `Next: ${formatDurationHM(remainingSec)}`;
        status = "NextCondition";
      }
    }
  }

  // --- 条件ロジック後のステータス決定 ---

  let elapsedPercent = 0;
  
  if (!isInConditionWindow) {
    if (now >= maxRepop) {
      status = "MaxOver";
      elapsedPercent = 100;
      timeRemaining = `Time Over (100%)`;
    } else if (now < minRepop) {
      // 条件がNextConditionでない場合
      if (status !== "NextCondition") {
          status = "Next";
          timeRemaining = `Next: ${formatDurationHM(minRepop - now)}`;
      }
    } else if (status === "Unknown") {
      status = "PopWindow";
      elapsedPercent = Math.min(((now - minRepop) / (maxRepop - minRepop)) * 100, 100);
      timeRemaining = `残り ${formatDurationHM(maxRepop - now)} (${elapsedPercent.toFixed(0)}%)`;
    }
  }

  const isMaintenanceStop = (now >= maintenanceStart && now < serverUp);

  return {
    minRepop,
    maxRepop,
    elapsedPercent,
    timeRemaining,
    status,
    nextMinRepopDate,
    nextConditionSpawnDate,
    conditionWindowEnd,
    isInConditionWindow,
    isMaintenanceStop
  };

  function baseResult(status) {
    return {
      minRepop: null,
      maxRepop: null,
      elapsedPercent: 0,
      timeRemaining: "未確定",
      status,
      nextMinRepopDate: null,
      conditionWindowEnd: null,
      isInConditionWindow: false,
      isMaintenanceStop: false
    };
  }
}

function checkMobSpawnCondition(mob, date) {
  const pointSec = Math.floor(date.getTime() / 1000);
  
  // 各条件を満たすかチェック（天候の連続性はここではチェックしない）
  
  // 月齢チェック
  if (mob.moonPhase) {
    const moonInfo = getEorzeaMoonInfo(date);
    if (moonInfo.label !== mob.moonPhase) return false;
  }
  
  // 天候チェック
  if (mob.weatherSeedRange || mob.weatherSeedRanges) {
    const seed = getEorzeaWeatherSeed(date);
    if (!checkWeatherInRange(mob, seed)) return false;
  }
  
  // ETチェック
  if (!checkEtCondition(mob, pointSec)) return false;
  
  // TODO: 天候の連続時間条件チェックはここでは行えない（前後スキャンが必要なため）
  // 最小限の条件チェックのみを行う
  
  return true;
}

function findNextSpawnTime(mob, pointSec, minRepopSec, limitSec) {
  // findNextSpawnTimeは基本的にcalculateRepopと同じロジックで最初の湧き時刻を探す
  
  const hasCondition = !!(
    mob.moonPhase ||
    mob.timeRange ||
    mob.timeRanges ||
    mob.weatherSeedRange ||
    mob.weatherSeedRanges ||
    mob.conditions
  );

  if (!hasCondition) return minRepopSec;
  
  // 探索リミット (安全装置: 20日分)
  const searchLimit = pointSec + LIMIT_DAYS * 24 * 3600;

  const moonRanges = findMoonRanges(mob, pointSec);
  const weatherRanges = findWeatherRanges(mob, pointSec, searchLimit);
  const etRanges = findEtRanges(mob, pointSec, searchLimit);
  
  const conditionResult = findIntersection([moonRanges, weatherRanges, etRanges], pointSec);

  if (conditionResult) {
    return conditionResult.start;
  }

  return null;
}

export {
  calculateRepop,
  checkMobSpawnCondition,
  findNextSpawnTime,
  getEorzeaTime,
  formatDuration,
  formatDurationHM,
  debounce,
  formatLastKillTime
};
