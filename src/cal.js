
// cal.js - 修正版 v9: 単発/連続分離と最適化

const ET_HOUR_SEC = 175;
const WEATHER_CYCLE_SEC = 1400; // 23分20秒
const ET_DAY_SEC = ET_HOUR_SEC * 24;
const MOON_CYCLE_SEC = ET_DAY_SEC * 32;
const MOON_PHASE_DURATION_SEC = ET_DAY_SEC * 4;
const MAX_SEARCH_ITERATIONS = 5000;
const LIMIT_DAYS = 60;

// --- ユーティリティ関数 ---
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
  // 天候サイクル (1400秒) の開始時刻に合わせる
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

// --- カスケード探索用ジェネレータ関数 ---
function* getValidWeatherIntervals(mob, windowStart, windowEnd) {
  const requiredMinutes = mob.weatherDuration?.minutes || 0;
  const requiredSec = requiredMinutes * 60;
  // 連続天候判定: 1サイクル(1400秒)を超える継続時間が必要か
  const isContinuous = requiredSec > WEATHER_CYCLE_SEC;

  if (!mob.weatherSeedRange && !mob.weatherSeedRanges) {
    yield [windowStart, windowEnd];
    return;
  }

  // 探索カーソルを windowStart のサイクル境界に合わせる
  let currentCursor = alignToWeatherCycle(windowStart);
  let loopSafety = 0;

  // 1. 基準点を含む天候サイクルのチェック (跨ぎ判定)
  // 現在のサイクルが条件に合致する場合
  if (checkWeatherInRange(mob, getEorzeaWeatherSeed(new Date(currentCursor * 1000)))) {
    let chainStart = currentCursor;
    let chainEnd = 0;

    if (isContinuous) {
      // --- A. 連続天候 ($T_{Req} > 1400$) ---
      const searchBackLimit = windowStart - LIMIT_DAYS * 24 * 3600;
      while (true) {
        const prevTime = chainStart - WEATHER_CYCLE_SEC;
        if (prevTime < searchBackLimit) break;

        const seed = getEorzeaWeatherSeed(new Date(prevTime * 1000));
        if (checkWeatherInRange(mob, seed)) {
          chainStart = prevTime;
        } else {
          break;
        }
      }

      // 未来へ伸ばして ChainEnd を特定
      let tempCursor = currentCursor;
      while (true) {
        if (loopSafety++ > MAX_SEARCH_ITERATIONS) break;

        const nextTime = tempCursor + WEATHER_CYCLE_SEC;
        const seed = getEorzeaWeatherSeed(new Date(nextTime * 1000));

        if (checkWeatherInRange(mob, seed)) {
          tempCursor = nextTime;
        } else {
          chainEnd = nextTime; // 不一致のサイクルの開始が ChainEnd
          break;
        }
      }

      const duration = chainEnd - chainStart;

      if (duration >= requiredSec) {
        const validPopStart = chainStart + requiredSec;
        // 基準点を跨いでいる場合、maxにより windowStart が採用される
        const intersectStart = Math.max(validPopStart, windowStart);
        const intersectEnd = Math.min(chainEnd, windowEnd);

        if (intersectStart < intersectEnd) {
          yield [intersectStart, intersectEnd];
        }
      }

      // 次の探索はチェーンの終わりから
      currentCursor = chainEnd;

    } else {
      // --- B. 単発天候 ($T_{Req} \le 1400$) ---
      chainStart = currentCursor;
      // 未来へ伸ばして ChainEnd を特定
      let tempCursor = currentCursor;
      while (true) {
        if (loopSafety++ > MAX_SEARCH_ITERATIONS) break;

        const nextTime = tempCursor + WEATHER_CYCLE_SEC;
        const seed = getEorzeaWeatherSeed(new Date(nextTime * 1000));

        if (checkWeatherInRange(mob, seed)) {
          tempCursor = nextTime;
        } else {
          chainEnd = nextTime;
          break;
        }
      }

      // 単発の場合、常に windowStart が開始時間
      const intersectStart = windowStart;
      const intersectEnd = Math.min(chainEnd, windowEnd);

      if (intersectStart < intersectEnd) {
        yield [intersectStart, intersectEnd];
      }

      // 次の探索はチェーンの終わりから
      currentCursor = chainEnd;
    }

  } else {
    // 現在地点が不一致なら、次のサイクルから探索
    currentCursor += WEATHER_CYCLE_SEC;
  }

  // 2. 未来方向への通常探索 (この時点で currentCursor は次の探索開始点)
  let cursor = currentCursor;

  while (cursor < windowEnd) {
    if (loopSafety++ > MAX_SEARCH_ITERATIONS) break;

    // 始点を探す
    let activeStart = null;
    while (cursor < windowEnd + WEATHER_CYCLE_SEC) {
      const seed = getEorzeaWeatherSeed(new Date(cursor * 1000));
      if (checkWeatherInRange(mob, seed)) {
        activeStart = cursor;
        break;
      }
      cursor += WEATHER_CYCLE_SEC;
      if (cursor - windowStart > LIMIT_DAYS * 24 * 3600) break;
    }

    if (activeStart === null) break;

    // 終点を探す
    let activeEnd = activeStart;
    let tempCursor = activeStart;
    while (true) {
      if (loopSafety++ > MAX_SEARCH_ITERATIONS) break;

      const nextTime = tempCursor + WEATHER_CYCLE_SEC;
      const seed = getEorzeaWeatherSeed(new Date(nextTime * 1000));

      if (checkWeatherInRange(mob, seed)) {
        tempCursor = nextTime;
        activeEnd = nextTime;
      } else {
        activeEnd = nextTime; // 不一致のサイクルの開始が ActiveEnd
        break;
      }
    }
    // 長さ判定
    const duration = activeEnd - activeStart;
    if (duration >= requiredSec) {
      const validPopStart = isContinuous ? activeStart + requiredSec : activeStart;

      const intersectStart = Math.max(validPopStart, windowStart);
      const intersectEnd = Math.min(activeEnd, windowEnd);

      if (intersectStart < intersectEnd) {
        yield [intersectStart, intersectEnd];
      }
    }

    cursor = activeEnd;
  }
}

function* getValidEtIntervals(mob, windowStart, windowEnd) {
  if (!mob.timeRange && !mob.timeRanges && !mob.conditions) {
    yield [windowStart, windowEnd];
    return;
  }
  // windowStart を ET時間境界に揃える
  let cursor = alignToEtHour(windowStart);
  let loopSafety = 0;

  while (cursor < windowEnd) {
    if (loopSafety++ > MAX_SEARCH_ITERATIONS) break;

    if (checkEtCondition(mob, cursor)) {
      const start = cursor;
      let end = cursor + ET_HOUR_SEC;
      let tempCursor = end;
      // 連続するET区間を結合
      while (tempCursor < windowEnd + ET_HOUR_SEC) {
        if (checkEtCondition(mob, tempCursor)) {
          end += ET_HOUR_SEC;
          tempCursor += ET_HOUR_SEC;
        } else {
          break;
        }
      }
      // 交差を取る（windowStart以前はカット）
      const intersectStart = Math.max(start, windowStart);
      const intersectEnd = Math.min(end, windowEnd);

      if (intersectStart < intersectEnd) {
        yield [intersectStart, intersectEnd];
      }

      cursor = end;
    } else {
      cursor += ET_HOUR_SEC;
    }
  }
}

// --- メイン探索ロジック（階層型） ---
function findNextSpawn(mob, pointSec, searchLimit) {
  // 1. 月齢探索（第1層）
  let moonPhases = [];
  if (!mob.moonPhase) {
    moonPhases.push([pointSec, searchLimit]);
  } else {
    let targetPhase = mob.moonPhase === "新月" ? 32.5 : 16.5;
    const startPhase = getEorzeaMoonInfo(new Date(pointSec * 1000)).phase;

    // 現在(pointSec)がターゲットフェーズ内か？
    if (
      (mob.moonPhase === "新月" && (startPhase >= 32.5 || startPhase < 4.5)) ||
      (mob.moonPhase === "満月" && (startPhase >= 16.5 && startPhase < 20.5))
    ) {
      let currentPhaseStart = pointSec - (startPhase - targetPhase) * ET_DAY_SEC;
      while (currentPhaseStart > pointSec) currentPhaseStart -= MOON_CYCLE_SEC;

      const currentPhaseEnd = currentPhaseStart + MOON_PHASE_DURATION_SEC;

      if (currentPhaseEnd > pointSec) {
        moonPhases.push([pointSec, currentPhaseEnd]);
      }
    }

    let moonStart = calculateNextMoonStart(pointSec, targetPhase);
    while (moonStart < searchLimit) {
      moonPhases.push([moonStart, moonStart + MOON_PHASE_DURATION_SEC]);
      moonStart += MOON_CYCLE_SEC;
    }
  }
  // 2. 天候探索（第2層：月齢区間内）
  for (const [mStart, mEnd] of moonPhases) {
    const weatherIterator = getValidWeatherIntervals(mob, mStart, mEnd);

    for (const [wStart, wEnd] of weatherIterator) {
      // 3. ET探索（第3層：天候区間内）
      const etIterator = getValidEtIntervals(mob, wStart, wEnd);

      for (const [eStart, eEnd] of etIterator) {
        // 最終チェック
        const finalStart = Math.max(eStart, pointSec);
        const finalEnd = eEnd;

        if (finalStart < finalEnd) {
          return { start: finalStart, end: finalEnd };
        }
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
  const searchLimit = pointSec + LIMIT_DAYS * 24 * 3600;

  let status = "Unknown";
  let timeRemaining = "Unknown"; // Left Side (Standard)
  let conditionRemaining = null; // Right Side (Condition Active)
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
    const result = findNextSpawn(mob, pointSec, searchLimit);

    if (result) {
      const { start, end } = result;

      nextConditionSpawnDate = new Date(start * 1000);
      conditionWindowEnd = new Date(end * 1000);

      isInConditionWindow = (now >= start && now < end);

      if (isInConditionWindow) {
        const remainingSec = end - now; // Use 'now' for accurate remaining time if active
        conditionRemaining = `@ ${Math.ceil(remainingSec / 60)}分`;
      } else {
      }
    }
  }

  let elapsedPercent = 0;

  if (now >= maxRepop) {
    status = "MaxOver";
    elapsedPercent = 100;
    timeRemaining = `Time Over (100％)`;
  } else if (now < minRepop) {
    status = "Next";
    timeRemaining = `@ ${formatDurationHM(minRepop - now)}`;
  } else {
    // In Window
    status = "PopWindow";
    elapsedPercent = Math.min(((now - minRepop) / (maxRepop - minRepop)) * 100, 100);
    timeRemaining = `残り${formatDurationHM(maxRepop - now)}`;
  }

  if (isInConditionWindow && now >= minRepop) {
    status = "ConditionActive";
  } else if (hasCondition && nextConditionSpawnDate && now < nextConditionSpawnDate.getTime() / 1000 && status !== "MaxOver") {
    status = "NextCondition";
  }

  const isMaintenanceStop = (now >= maintenanceStart && now < serverUp);

  return {
    minRepop,
    maxRepop,
    elapsedPercent,
    timeRemaining,
    conditionRemaining,
    status,
    nextMinRepopDate,
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
  const result = findNextSpawn(mob, pointSec, searchLimit);

  if (result) {
    return result.start;
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
