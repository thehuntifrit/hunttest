// cal.js - 完全置き換え版（重複排除・責務分離）

// ===== 定数 =====
const ET_HOUR_SEC = 175;
const WEATHER_CYCLE_SEC = 1400;
const ET_DAY_SEC = ET_HOUR_SEC * 24;
const MOON_CYCLE_SEC = ET_DAY_SEC * 32;
const MOON_PHASE_DURATION_SEC = ET_DAY_SEC * 4;

// ===== 表示ユーティリティ =====
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
  const options = { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" };
  return new Intl.DateTimeFormat("ja-JP", options).format(new Date(killTimeMs));
}

// ===== ET時間関連 =====
function getEorzeaTime(date = new Date()) {
  const unixMs = date.getTime();
  const REAL_MS_PER_ET_HOUR = ET_HOUR_SEC * 1000;
  const eorzeaTotalHours = Math.floor(unixMs / REAL_MS_PER_ET_HOUR);
  const hours = eorzeaTotalHours % 24;
  const remainingMs = unixMs % REAL_MS_PER_ET_HOUR;
  const minutes = Math.floor(remainingMs / (REAL_MS_PER_ET_HOUR / 60));
  return { hours: hours.toString().padStart(2, "0"), minutes: minutes.toString().padStart(2, "0") };
}
function getEtHourFromRealSec(realSec) {
  const ticks = Math.floor(realSec / ET_HOUR_SEC);
  return ticks % 24;
}
function alignToEtHour(realSec) {
  return Math.floor(realSec / ET_HOUR_SEC) * ET_HOUR_SEC;
}
function ceilToEtHour(realSec) {
  return Math.ceil(realSec / ET_HOUR_SEC) * ET_HOUR_SEC;
}
function alignToWeatherCycle(realSec) {
  return Math.floor(realSec / WEATHER_CYCLE_SEC) * WEATHER_CYCLE_SEC;
}

// ===== 月齢関連 =====
function getEorzeaMoonInfo(date = new Date()) {
  const unixSeconds = date.getTime() / 1000;
  const EORZEA_SPEED_RATIO = 20.57142857142857;
  const eorzeaTotalDays = (unixSeconds * EORZEA_SPEED_RATIO) / 86400;
  const phase = (eorzeaTotalDays % 32) + 1; // 1..32 (小数)
  let label = null;
  if (phase >= 32.5 || phase < 4.5) label = "新月";
  else if (phase >= 16.5 && phase < 20.5) label = "満月";
  return { phase, label };
}
function isNearPhase(phase, target) {
  const diff = Math.abs(((phase - target + 32) % 32));
  return diff < 0.6 || diff > 31.4;
}
function findNextNewMoonStart(startSec) {
  let t = alignToEtHour(startSec);
  const limit = startSec + MOON_CYCLE_SEC * 2;
  while (t < limit) {
    const { phase } = getEorzeaMoonInfo(new Date(t * 1000));
    if (isNearPhase(phase, 32)) return t;
    t += ET_HOUR_SEC;
  }
  return null;
}
function findNextFullMoonStart(startSec) {
  let t = alignToEtHour(startSec);
  const limit = startSec + MOON_CYCLE_SEC * 2;
  while (t < limit) {
    const { phase } = getEorzeaMoonInfo(new Date(t * 1000));
    if (isNearPhase(phase, 16)) return t;
    t += ET_HOUR_SEC;
  }
  return null;
}
function enumerateMoonRanges(startSec, endSec, moonPhase) {
  if (!moonPhase) return [[startSec, endSec]];
  const ranges = [];
  let moonStart = null;
  if (moonPhase === "新月") moonStart = findNextNewMoonStart(startSec);
  else if (moonPhase === "満月") moonStart = findNextFullMoonStart(startSec);
  else return [[startSec, endSec]];
  while (moonStart && moonStart < endSec) {
    const moonEnd = moonStart + MOON_PHASE_DURATION_SEC;
    ranges.push([Math.max(moonStart, startSec), Math.min(moonEnd, endSec)]);
    moonStart += MOON_CYCLE_SEC;
  }
  return ranges;
}
function isFirstNightPhase(phase) {
  return phase >= 32.5 || phase < 1.5;
}
function isOtherNightsPhase(phase) {
  return phase >= 1.5 && phase < 4.5;
}

// ===== 天候関連 =====
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
function getEorzeaWeather(date = new Date(), weatherTable) {
  const seed = getEorzeaWeatherSeed(date);
  let cumulative = 0;
  for (const entry of weatherTable) {
    cumulative += entry.rate;
    if (seed < cumulative) return entry.weather;
  }
  return "Unknown";
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

// ===== ET時間帯関連 =====
function checkTimeRange(timeRange, realSec) {
  const etHour = getEtHourFromRealSec(realSec);
  const { start, end } = timeRange;
  if (start < end) return etHour >= start && etHour < end;
  return etHour >= start || etHour < end; // 日跨ぎ
}
function checkEtCondition(mob, realSec) {
  const { phase } = getEorzeaMoonInfo(new Date(realSec * 1000));
  if (mob.conditions) {
    const { firstNight, otherNights } = mob.conditions;
    if (firstNight?.timeRange && isFirstNightPhase(phase)) return checkTimeRange(firstNight.timeRange, realSec);
    if (otherNights?.timeRange && isOtherNightsPhase(phase)) return checkTimeRange(otherNights.timeRange, realSec);
    return false;
  }
  if (mob.timeRange) return checkTimeRange(mob.timeRange, realSec);
  if (mob.timeRanges) return mob.timeRanges.some(tr => checkTimeRange(tr, realSec));
  return true;
}
function getEtWindowEnd(mob, windowStart) {
  let ranges = [];
  if (mob.conditions) {
    const { phase } = getEorzeaMoonInfo(new Date(windowStart * 1000));
    if (isFirstNightPhase(phase) && mob.conditions.firstNight?.timeRange) ranges.push(mob.conditions.firstNight.timeRange);
    else if (isOtherNightsPhase(phase) && mob.conditions.otherNights?.timeRange) ranges.push(mob.conditions.otherNights.timeRange);
  } else if (mob.timeRange) {
    ranges.push(mob.timeRange);
  } else if (mob.timeRanges) {
    ranges = mob.timeRanges;
  }
  const startEtHour = getEtHourFromRealSec(windowStart);
  for (const range of ranges) {
    if (!range) continue;
    const { start, end } = range;
    if (start < end) {
      if (startEtHour >= start && startEtHour < end) {
        const hoursToEnd = end - startEtHour;
        return windowStart + hoursToEnd * ET_HOUR_SEC;
      }
    } else {
      if (startEtHour >= start || startEtHour < end) {
        const hoursToEnd = startEtHour >= start ? (24 - startEtHour) + end : (end - startEtHour);
        return windowStart + hoursToEnd * ET_HOUR_SEC;
      }
    }
  }
  return windowStart + ET_HOUR_SEC;
}

// ===== 連続天候探索（過去継続に対応） =====
function findConsecutiveWeather(mob, startSec, minRepopSec, limitSec, nowSec) {
  const requiredMinutes = mob.weatherDuration?.minutes || 0;
  const requiredSec = requiredMinutes * 60;

  // 後方ルックバック：minRepopを含む連続開始を特定（サイクル単位で遡る）
  const lookbackSec = requiredSec + WEATHER_CYCLE_SEC;
  let backCursor = alignToWeatherCycle(minRepopSec);
  let consecutiveStart = minRepopSec;
  let accumulatedBack = 0;

  while (accumulatedBack < lookbackSec) {
    const prevCycleStart = backCursor - WEATHER_CYCLE_SEC;
    if (prevCycleStart < 0) break;
    const seedPrev = getEorzeaWeatherSeed(new Date(prevCycleStart * 1000));
    if (!checkWeatherInRange(mob, seedPrev)) {
      consecutiveStart = Math.max(minRepopSec, backCursor);
      break;
    }
    consecutiveStart = prevCycleStart;
    accumulatedBack += WEATHER_CYCLE_SEC;
    backCursor = prevCycleStart;
  }
  if (accumulatedBack >= lookbackSec) consecutiveStart = backCursor;

  const windowStartAtMin = consecutiveStart;
  const windowEndAtMin = windowStartAtMin + requiredSec;

  // minRepop時点で既に満了済みなら、その満了時刻（過去）を返す
  if (minRepopSec >= windowEndAtMin) {
    return { windowStart: windowStartAtMin, windowEnd: windowEndAtMin, popTime: windowEndAtMin };
  }

  // 前方探索（部分サイクル許容）
  let scanSec = Math.max(startSec, minRepopSec);
  const hardLimit = limitSec;

  while (scanSec <= hardLimit) {
    const cycleStart = alignToWeatherCycle(scanSec);
    const cycleEnd = cycleStart + WEATHER_CYCLE_SEC;
    const seed = getEorzeaWeatherSeed(new Date(cycleStart * 1000));
    if (!checkWeatherInRange(mob, seed)) { scanSec = cycleEnd; continue; }

    let forwardStart = scanSec;
    let accumulated = cycleEnd - forwardStart;
    let cursor = cycleEnd;

    while (accumulated < requiredSec && cursor <= hardLimit) {
      const nextSeed = getEorzeaWeatherSeed(new Date(cursor * 1000));
      if (!checkWeatherInRange(mob, nextSeed)) break;
      accumulated += WEATHER_CYCLE_SEC;
      cursor += WEATHER_CYCLE_SEC;
    }

    if (accumulated >= requiredSec) {
      const windowStart = forwardStart;
      const windowEnd = forwardStart + requiredSec;
      if (nowSec !== undefined && nowSec >= windowStart && nowSec <= windowEnd) {
        return { windowStart, windowEnd, popTime: windowEnd };
      }
      if (windowEnd >= minRepopSec && windowEnd <= hardLimit) {
        return { windowStart, windowEnd, popTime: windowEnd };
      }
    }
    scanSec = cycleEnd;
  }
  return null;
}

// ===== 単発条件探索（月齢＋天候＋ETの交差） =====
function findNextConditionWindow(mob, startSec, minRepopSec, limitSec) {
  const moonRanges = enumerateMoonRanges(startSec, limitSec, mob.moonPhase);

  for (const [moonStart, moonEnd] of moonRanges) {
    if (mob.weatherSeedRange || mob.weatherSeedRanges) {
      let cycleStart = alignToWeatherCycle(moonStart);
      for (let tSec = cycleStart; tSec < moonEnd; tSec += WEATHER_CYCLE_SEC) {
        const seed = getEorzeaWeatherSeed(new Date(tSec * 1000));
        if (!checkWeatherInRange(mob, seed)) continue;

        const cycleEnd = Math.min(tSec + WEATHER_CYCLE_SEC, moonEnd);
        const intersectStart = Math.max(tSec, moonStart);
        const intersectEnd = Math.min(cycleEnd, moonEnd);
        if (intersectStart >= intersectEnd) continue;

        let etStart = ceilToEtHour(Math.max(intersectStart, minRepopSec));
        for (let etSec = etStart; etSec < intersectEnd; etSec += ET_HOUR_SEC) {
          if (checkEtCondition(mob, etSec)) {
            const windowEnd = Math.min(getEtWindowEnd(mob, etSec), intersectEnd);
            return { windowStart: etSec, windowEnd, popTime: etSec };
          }
        }
      }
    } else {
      let etStart = ceilToEtHour(Math.max(moonStart, minRepopSec));
      for (let etSec = etStart; etSec < moonEnd; etSec += ET_HOUR_SEC) {
        if (checkEtCondition(mob, etSec)) {
          const windowEnd = Math.min(getEtWindowEnd(mob, etSec), moonEnd);
          return { windowStart: etSec, windowEnd, popTime: etSec };
        }
      }
    }
  }
  return null;
}

// ===== メイン REPOP 計算 =====
function calculateRepop(mob, maintenance) {
  const now = Date.now() / 1000;
  const lastKill = mob.last_kill_time || 0;
  const repopSec = mob.REPOP_s;
  const maxSec = mob.MAX_s;

  let maint = maintenance;
  if (maint && typeof maint === "object" && "maintenance" in maint && maint.maintenance) maint = maint.maintenance;
  if (!maint || !maint.serverUp || !maint.start) return baseResult("Unknown");

  const serverUpDate = new Date(maint.serverUp);
  const startDate = new Date(maint.start);
  if (isNaN(serverUpDate.getTime()) || isNaN(startDate.getTime())) return baseResult("Unknown");

  const serverUp = serverUpDate.getTime() / 1000;
  const maintenanceStart = startDate.getTime() / 1000;

  let minRepop = 0, maxRepop = 0;
  if (lastKill === 0 || lastKill < serverUp) {
    minRepop = serverUp + (repopSec * 0.6);
    maxRepop = serverUp + (maxSec * 0.6);
  } else {
    minRepop = lastKill + repopSec;
    maxRepop = lastKill + maxSec;
  }

  let status = "Unknown";
  let elapsedPercent = 0;
  let timeRemaining = "Unknown";

  const nextMinRepopDate = new Date(minRepop * 1000);

  let nextConditionSpawnDate = null;
  let conditionWindowEnd = null;
  let isInConditionWindow = false;

  const hasCondition = !!(mob.moonPhase || mob.timeRange || mob.timeRanges || mob.weatherSeedRange || mob.weatherSeedRanges || mob.conditions);

  if (hasCondition) {
    const searchStart = Math.max(minRepop, serverUp);
    const searchLimit = searchStart + 14 * 24 * 3600;

    let conditionResult = null;
    if (mob.weatherDuration?.minutes) {
      conditionResult = findConsecutiveWeather(mob, searchStart, minRepop, searchLimit, now);
    } else {
      conditionResult = findNextConditionWindow(mob, searchStart, minRepop, searchLimit);
    }

    if (conditionResult) {
      nextConditionSpawnDate = new Date(conditionResult.popTime * 1000);
      conditionWindowEnd = new Date(conditionResult.windowEnd * 1000);
      isInConditionWindow = now >= conditionResult.windowStart && now <= conditionResult.windowEnd;

      if (isInConditionWindow) {
        const remainingSec = conditionResult.windowEnd - now;
        timeRemaining = `条件達成中 残り ${formatDurationHM(remainingSec)}`;
        status = "ConditionActive";
      }
    }
  }

  if (!isInConditionWindow) {
    if (now >= maxRepop) {
      status = "MaxOver";
      elapsedPercent = 100;
      timeRemaining = `Time Over (100%)`;
    } else if (now < minRepop) {
      status = "Next";
      timeRemaining = `Next: ${formatDurationHM(minRepop - now)}`;
    } else {
      status = "PopWindow";
      elapsedPercent = Math.min(((now - minRepop) / (maxRepop - minRepop)) * 100, 100);
      timeRemaining = `残り ${formatDurationHM(maxRepop - now)} (${elapsedPercent.toFixed(0)}%)`;
    }
  }

  const minRepopAfterMaintenance = minRepop > maintenanceStart;
  const conditionAfterMaintenance = nextConditionSpawnDate
    ? (nextConditionSpawnDate.getTime() / 1000) > maintenanceStart
    : false;
  const isMaintenanceStop = minRepopAfterMaintenance || conditionAfterMaintenance;

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
      nextConditionSpawnDate: null,
      conditionWindowEnd: null,
      isInConditionWindow: false,
      isMaintenanceStop: false
    };
  }
}

// ===== 後方互換 =====
function checkMobSpawnCondition(mob, date) {
  const realSec = Math.floor(date.getTime() / 1000);
  const moonInfo = getEorzeaMoonInfo(date);
  if (mob.moonPhase && moonInfo.label !== mob.moonPhase) return false;
  if (mob.weatherSeedRange || mob.weatherSeedRanges) {
    const seed = getEorzeaWeatherSeed(date);
    if (!checkWeatherInRange(mob, seed)) return false;
  }
  return checkEtCondition(mob, realSec);
}
function findNextSpawnTime(mob, startDate, repopStartSec, repopEndSec) {
  const startSec = Math.floor(startDate.getTime() / 1000);
  const minRepopSec = repopStartSec ?? startSec;
  const limitSec = repopEndSec ?? (startSec + 14 * 24 * 3600);
  if (mob.weatherDuration?.minutes) {
    const res = findConsecutiveWeather(mob, startSec, minRepopSec, limitSec);
    return res?.popTime ? new Date(res.popTime * 1000) : null;
  }
  const result = findNextConditionWindow(mob, startSec, minRepopSec, limitSec);
  return result ? new Date(result.popTime * 1000) : null;
}

// ===== エクスポート =====
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
