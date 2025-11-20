// cal.js - 修正版 v5: MaxOver優先度修正 & 天候遡りロジック厳格化

const ET_HOUR_SEC = 175;
const WEATHER_CYCLE_SEC = 1400;
const ET_DAY_SEC = ET_HOUR_SEC * 24;
const MOON_CYCLE_SEC = ET_DAY_SEC * 32;
const MOON_PHASE_DURATION_SEC = ET_DAY_SEC * 4;
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

    if (nextStartSec < startSec) {
        nextStartSec += MOON_CYCLE_SEC;
    }
    return nextStartSec;
}

// --- 探索関数群 ---

function findMoonRanges(mob, pointSec) {
  if (!mob.moonPhase) return [[0, Infinity]];

  const ranges = [];
  let targetPhase = mob.moonPhase === "新月" ? 32.5 : 16.5;

  const startPhase = getEorzeaMoonInfo(new Date(pointSec * 1000)).phase;
  
  // pointSecを含むフェーズの確認
  if (
    (mob.moonPhase === "新月" && (startPhase >= 32.5 || startPhase < 4.5)) ||
    (mob.moonPhase === "満月" && (startPhase >= 16.5 && startPhase < 20.5))
  ) {
    let currentPhaseStart = pointSec - (startPhase - targetPhase) * ET_DAY_SEC;
    // startPhase等の計算誤差補正
    while (currentPhaseStart > pointSec) currentPhaseStart -= MOON_CYCLE_SEC;
    
    // 生データとして追加
    ranges.push([currentPhaseStart, currentPhaseStart + MOON_PHASE_DURATION_SEC]);
  }
  
  // 未来のフェーズ
  let moonStart = calculateNextMoonStart(pointSec, targetPhase);
  for (let i = 0; i < 2; i++) {
    const moonEnd = moonStart + MOON_PHASE_DURATION_SEC;
    if (moonEnd > pointSec) {
      ranges.push([moonStart, moonEnd]);
    }
    moonStart += MOON_CYCLE_SEC;
  }
  
  ranges.sort((a, b) => a[0] - b[0]);
  return ranges.filter((range, index) => {
    if (index === 0) return true;
    return range[0] > ranges[index - 1][0] || range[1] > ranges[index - 1][1];
  });
}

function findWeatherRanges(mob, pointSec, searchLimit) {
  if (!mob.weatherSeedRange && !mob.weatherSeedRanges) return [[0, Infinity]];

  const ranges = [];
  const requiredMinutes = mob.weatherDuration?.minutes || 0;
  const requiredSec = requiredMinutes > 0 ? requiredMinutes * 60 : 0;
  const requiredCycles = Math.ceil(requiredSec / WEATHER_CYCLE_SEC);

  // 1. 基準点の整列
  const currentCycleStart = alignToWeatherCycle(pointSec);
  
  let isActive = false;
  let trueStart = null;

  // 2. アクティブ判定（現在進行形の確認）
  const currentSeed = getEorzeaWeatherSeed(new Date(currentCycleStart * 1000));
  
  if (checkWeatherInRange(mob, currentSeed)) {
      if (requiredCycles === 0) {
          // 単発: 即座に条件成立
          isActive = true;
          trueStart = currentCycleStart;
      } else {
          // 連続: 現在のサイクルを含め、過去に向かって遡りチェック
          // 必要なのは「現在のサイクル」+「過去(requiredCycles - 1)サイクル」
          let consecutiveCycles = 1; // 現在のサイクルで1つ確保
          let scanCursor = currentCycleStart - WEATHER_CYCLE_SEC; // 1つ前から遡る
          let isChainValid = true;

          let iterations = 0;
          // 残りの必要数分だけループ
          while (consecutiveCycles < requiredCycles) {
              if (iterations++ > MAX_SEARCH_ITERATIONS) { isChainValid = false; break; }
              
              const seed = getEorzeaWeatherSeed(new Date(scanCursor * 1000));
              if (checkWeatherInRange(mob, seed)) {
                  consecutiveCycles++;
                  scanCursor -= WEATHER_CYCLE_SEC;
              } else {
                  isChainValid = false;
                  break; 
              }
          }
          
          if (isChainValid) {
              isActive = true;
              // scanCursorはループ終了時に1つ余分に引かれているため、+WEATHER_CYCLE_SECが開始点
              trueStart = scanCursor + WEATHER_CYCLE_SEC;
          }
      }
  }

  // 3. Active（条件成立）時の処理
  if (isActive && trueStart !== null) {
      let extendedEnd = currentCycleStart + WEATHER_CYCLE_SEC;
      let extensionCursor = currentCycleStart + WEATHER_CYCLE_SEC;
      let extIterations = 0;
      
      // 未来へ延長
      while (extensionCursor <= searchLimit && extIterations++ < MAX_SEARCH_ITERATIONS) {
          const seed = getEorzeaWeatherSeed(new Date(extensionCursor * 1000));
          if (checkWeatherInRange(mob, seed)) {
              extendedEnd += WEATHER_CYCLE_SEC;
              extensionCursor += WEATHER_CYCLE_SEC;
          } else {
              break;
          }
      }
      
      // 開始時間を基準点(pointSec)に固定（クリッピング）
      const clippedStart = Math.max(trueStart, pointSec);
      ranges.push([clippedStart, extendedEnd]);
  }

  // 4. 未来探索の処理
  let forwardCursor = ceilToWeatherCycle(pointSec);
  if (ranges.length > 0) {
    // アクティブで見つかった区間の終わりから探索再開
    forwardCursor = Math.max(forwardCursor, ranges[0][1]);
  }
  
  let iterations = 0;
  while (forwardCursor <= searchLimit && iterations++ < MAX_SEARCH_ITERATIONS) {
    let accumulatedCycles = 0;
    let testCursor = forwardCursor;
    let consecutiveStart = forwardCursor;
    let satisfied = false;

    // 連続条件チェック
    while (testCursor <= searchLimit) {
      const seed = getEorzeaWeatherSeed(new Date(testCursor * 1000));
      if (!checkWeatherInRange(mob, seed)) break;
      
      accumulatedCycles++;
      testCursor += WEATHER_CYCLE_SEC;
      
      if ((requiredCycles === 0 && accumulatedCycles >= 1) || 
          (requiredCycles > 0 && accumulatedCycles >= requiredCycles)) {
          satisfied = true;
          break;
      }
    }
    
    if (satisfied) {
      let extendedEnd = testCursor;
      let extensionCursor = extendedEnd;
      let extIterations = 0;

      // 延長
      while (extensionCursor <= searchLimit && extIterations++ < MAX_SEARCH_ITERATIONS) {
        const seed = getEorzeaWeatherSeed(new Date(extensionCursor * 1000));
        if (checkWeatherInRange(mob, seed)) {
          extendedEnd += WEATHER_CYCLE_SEC;
          extensionCursor += WEATHER_CYCLE_SEC;
        } else {
          break;
        }
      }
      
      ranges.push([consecutiveStart, extendedEnd]);
      forwardCursor = extendedEnd;
    } else {
      // 不適合なら次のサイクルへ
      forwardCursor = ceilToWeatherCycle(testCursor);
    }
  }

  ranges.sort((a, b) => a[0] - b[0]);
  return ranges.filter((range, index) => {
    if (index === 0) return true;
    return range[0] >= ranges[index - 1][1] || range[0] > ranges[index - 1][0];
  });
}

function findEtRanges(mob, pointSec, searchLimit) {
  if (!mob.timeRange && !mob.timeRanges && !mob.conditions) return [[0, Infinity]];

  const ranges = [];
  let etCursor = alignToEtHour(pointSec);
  // pointSecを含む区間を拾うため1日戻る
  etCursor = Math.max(0, etCursor - ET_DAY_SEC);
  let iterations = 0;

  while (etCursor < searchLimit && iterations++ < MAX_SEARCH_ITERATIONS) {
    if (checkEtCondition(mob, etCursor)) {
      let etEnd = etCursor + ET_HOUR_SEC;
      let currentCursor = etEnd;
      
      while (currentCursor < searchLimit) {
        if (checkEtCondition(mob, currentCursor)) {
          etEnd = currentCursor + ET_HOUR_SEC;
          currentCursor += ET_HOUR_SEC;
        } else {
          break;
        }
      }
      ranges.push([etCursor, etEnd]);
      etCursor = etEnd;
    } else {
      etCursor += ET_HOUR_SEC;
    }
  }

  ranges.sort((a, b) => a[0] - b[0]);
  return ranges.filter((range, index) => {
    if (index === 0) return true;
    return range[0] >= ranges[index - 1][1] || range[0] > ranges[index - 1][0];
  });
}

function findIntersection(rangesList, pointSec) {
  if (rangesList.some(r => r.length === 0)) return null;

  const [moonRanges, weatherRanges, etRanges] = rangesList;

  for (const [moonStart, moonEnd] of moonRanges) {
    for (const [weatherStart, weatherEnd] of weatherRanges) {
      const intersect1Start = Math.max(moonStart, weatherStart);
      const intersect1End = Math.min(moonEnd, weatherEnd);

      if (intersect1Start >= intersect1End) continue;

      for (const [etStart, etEnd] of etRanges) {
        const intersect2Start = Math.max(intersect1Start, etStart);
        const intersect2End = Math.min(intersect1End, etEnd);

        if (intersect2Start >= intersect2End) continue;

        const spawnStart = intersect2Start; 
        const spawnEnd = intersect2End;
        
        // 有効な区間を返す
        // weatherRanges等はpointSecでクリップされているため、spawnStart >= pointSecになるはず
        // ただし、ET/月齢が過去から始まっている場合、spawnEnd <= pointSec となる過去の区間は除外
        if (spawnEnd <= pointSec) continue;

        return { start: spawnStart, end: spawnEnd };
      }
    }
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

  const pointSec = Math.max(minRepop, now);
  const nextMinRepopDate = new Date(minRepop * 1000);
  // 最大REPOPを超えても20日先までは探索する
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
    const moonRanges = findMoonRanges(mob, pointSec);
    const weatherRanges = findWeatherRanges(mob, pointSec, searchLimit);
    const etRanges = findEtRanges(mob, pointSec, searchLimit);
    
    const conditionResult = findIntersection([moonRanges, weatherRanges, etRanges], pointSec);

    if (conditionResult) {
      const { start, end } = conditionResult;
      const nextSec = start;
      const windowEnd = end;

      nextConditionSpawnDate = new Date(nextSec * 1000);
      conditionWindowEnd = new Date(windowEnd * 1000);
      
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

  let elapsedPercent = 0;
  // ★修正: MaxOverの判定優先度を下げる
  // 条件ありの場合、NextConditionが見つかっている(statusがNextCondition)なら、MaxOverを表示しない
  if (!isInConditionWindow) {
    if (status === "NextCondition") {
        // 何もしない（Next表示を維持）
    } else if (now >= maxRepop) {
      status = "MaxOver";
      elapsedPercent = 100;
      timeRemaining = `Time Over (100%)`;
    } else if (now < minRepop) {
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
  if (mob.moonPhase) {
    const moonInfo = getEorzeaMoonInfo(date);
    if (moonInfo.label !== mob.moonPhase) return false;
  }
  if (mob.weatherSeedRange || mob.weatherSeedRanges) {
    const seed = getEorzeaWeatherSeed(date);
    if (!checkWeatherInRange(mob, seed)) return false;
  }
  if (!checkEtCondition(mob, pointSec)) return false;
  return true;
}

function findNextSpawnTime(mob, pointSec, minRepopSec, limitSec) {
  const hasCondition = !!(
    mob.moonPhase ||
    mob.timeRange ||
    mob.timeRanges ||
    mob.weatherSeedRange ||
    mob.weatherSeedRanges ||
    mob.conditions
  );

  if (!hasCondition) return minRepopSec;
  
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
