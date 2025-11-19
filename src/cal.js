// cal.js - 修正版: 基準点ロジック + 繰り下げ判定 + 天候延長包含チェック

const ET_HOUR_SEC = 175;
const WEATHER_CYCLE_SEC = 1400;
const ET_DAY_SEC = ET_HOUR_SEC * 24;
const MOON_CYCLE_SEC = ET_DAY_SEC * 32;
const MOON_PHASE_DURATION_SEC = ET_DAY_SEC * 4;
const MAX_CONSECUTIVE_CYCLES = 20;

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

function ceilToEtHour(realSec) {
  return Math.ceil(realSec / ET_HOUR_SEC) * ET_HOUR_SEC;
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

function calculateNextNewMoonStart(startSec) {
  const startPhase = getEorzeaMoonInfo(new Date(startSec * 1000)).phase;
  const targetPhase = 32.5;

  let phaseDiff = targetPhase - startPhase;
  if (phaseDiff < 0) phaseDiff += 32;

  let nextStartSec = startSec + phaseDiff * ET_DAY_SEC;

  if (nextStartSec > startSec + MOON_CYCLE_SEC) {
    nextStartSec -= MOON_CYCLE_SEC;
  } else if (nextStartSec < startSec) {
    nextStartSec += MOON_CYCLE_SEC;
  }
   
  return nextStartSec;
}

function calculateNextFullMoonStart(startSec) {
  const startPhase = getEorzeaMoonInfo(new Date(startSec * 1000)).phase;
  const targetPhase = 16.5;

  let phaseDiff = targetPhase - startPhase;
  if (phaseDiff < 0) phaseDiff += 32;

  let nextStartSec = startSec + phaseDiff * ET_DAY_SEC;

  if (nextStartSec > startSec + MOON_CYCLE_SEC) {
    nextStartSec -= MOON_CYCLE_SEC;
  } else if (nextStartSec < startSec) {
    nextStartSec += MOON_CYCLE_SEC;
  }

  return nextStartSec;
}

function enumerateMoonRanges(startSec, endSec, moonPhase) {
  if (!moonPhase) return [[startSec, endSec]];
  const ranges = [];
  let moonStart = null;

  if (moonPhase === "新月") moonStart = calculateNextNewMoonStart(startSec);
  else if (moonPhase === "満月") moonStart = calculateNextFullMoonStart(startSec);
  else return [[startSec, endSec]];

  while (moonStart < startSec) {
    moonStart += MOON_CYCLE_SEC;
  }

  while (moonStart && moonStart < endSec) {
    const moonEnd = moonStart + MOON_PHASE_DURATION_SEC;
    // 基準点(startSec)が月齢期間内の場合、基準点を開始とするため maxをとる
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
    if (firstNight?.timeRange && isFirstNightPhase(phase)) {
      return checkTimeRange(firstNight.timeRange, realSec);
    }
    if (otherNights?.timeRange && isOtherNightsPhase(phase)) {
      return checkTimeRange(otherNights.timeRange, realSec);
    }
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
    if (isFirstNightPhase(phase) && mob.conditions.firstNight?.timeRange) {
      ranges.push(mob.conditions.firstNight.timeRange);
    } else if (isOtherNightsPhase(phase) && mob.conditions.otherNights?.timeRange) {
      ranges.push(mob.conditions.otherNights.timeRange);
    }
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
        const hoursToEnd = startEtHour >= start
          ? (24 - startEtHour) + end
          : (end - startEtHour);
        return windowStart + hoursToEnd * ET_HOUR_SEC;
      }
    }
  }
  return windowStart + ET_HOUR_SEC;
}

function extendWeatherWindow(mob, windowStart, initialWindowEnd, limitSec) {
  let currentEnd = initialWindowEnd;
  let accumulatedCycles = Math.ceil((currentEnd - windowStart) / WEATHER_CYCLE_SEC);
   
  if (accumulatedCycles >= MAX_CONSECUTIVE_CYCLES) return currentEnd;

  let cursor = currentEnd;
  while (accumulatedCycles < MAX_CONSECUTIVE_CYCLES && cursor <= limitSec) {
    const seed = getEorzeaWeatherSeed(new Date(cursor * 1000));
    if (checkWeatherInRange(mob, seed)) {
      currentEnd += WEATHER_CYCLE_SEC;
      accumulatedCycles++;
      cursor += WEATHER_CYCLE_SEC;
    } else {
      break;
    }
  }
  return currentEnd;
}

function findWeatherWindow(mob, pointSec, minRepopSec, limitSec) {
  const requiredMinutes = mob.weatherDuration?.minutes || 0;
  const requiredSec = requiredMinutes > 0 ? requiredMinutes * 60 : WEATHER_CYCLE_SEC;
  // backSecは「条件を満たすために必要な過去の継続時間」
  const backSec = requiredSec;  

  // --- 修正: 現在(pointSec)を含む過去のウィンドウを探す ---
  // 基準点(pointSec)を天候サイクル境界まで「繰り下げ(align)」る
  let currentCursor = alignToWeatherCycle(pointSec);
  let currentWindowEnd = currentCursor + WEATHER_CYCLE_SEC;  
  
  // 条件時間分だけ巻き戻した位置から探索開始
  const scanStart = ceilToWeatherCycle(pointSec - backSec);  
   
  let consecutiveCycles = 0;
  let lastHitStart = null;  

  // 過去方向へスキャン (現在が進行中の天候ウィンドウ内か確認)
  while (currentCursor >= scanStart) {
    const seed = getEorzeaWeatherSeed(new Date(currentCursor * 1000));
    
    if (checkWeatherInRange(mob, seed)) {
      consecutiveCycles++;
      lastHitStart = currentCursor;  
    } else {
      consecutiveCycles = 0;  
      lastHitStart = null;
    }
    
    if (lastHitStart !== null && consecutiveCycles * WEATHER_CYCLE_SEC >= backSec) {
      // 条件を満たす天候の開始点を特定
      const initialWindowEnd = lastHitStart + consecutiveCycles * WEATHER_CYCLE_SEC;
      const trueWindowStart = initialWindowEnd - backSec;
      // 修正: 現在時刻(pointSec)が「開始点」から「拡張された終了点」の間にあるかを確認
      // まずウィンドウを最大まで拡張する
      const windowEnd = extendWeatherWindow(mob, trueWindowStart, initialWindowEnd, limitSec);
      
      if (pointSec >= trueWindowStart && pointSec < windowEnd) {
        const remainingSec = windowEnd - pointSec;
        return {
          // 基準点(pointSec)と重なっているので、基準点を開始として返す
          windowStart: pointSec,
          windowEnd,
          popTime: pointSec,
          remainingSec
        };
      }
    }
    
    currentCursor -= WEATHER_CYCLE_SEC;
    currentWindowEnd -= WEATHER_CYCLE_SEC;
  }

  // --- 未来方向へスキャン ---
  let forwardCursor = ceilToWeatherCycle(Math.max(minRepopSec, pointSec));

  while (forwardCursor <= limitSec) {
    let accumulated = 0;
    let testCursor = forwardCursor;
    let consecutiveStart = forwardCursor;  

    while (accumulated < backSec) {
      const seed = getEorzeaWeatherSeed(new Date(testCursor * 1000));
      if (!checkWeatherInRange(mob, seed)) break;
      accumulated += WEATHER_CYCLE_SEC;
      testCursor += WEATHER_CYCLE_SEC;
    }

    if (accumulated >= backSec) {
      const windowStart = consecutiveStart;
      const initialWindowEnd = windowStart + accumulated;
       
      const windowEnd = extendWeatherWindow(mob, windowStart, initialWindowEnd, limitSec);

      return {
        windowStart,
        windowEnd,
        popTime: windowStart + backSec,
        remainingSec: 0
      };
    }

    forwardCursor = ceilToWeatherCycle(testCursor);  
    
    if (forwardCursor <= consecutiveStart) {
      forwardCursor = consecutiveStart + WEATHER_CYCLE_SEC;
    }
  }

  return null;
}

function findNextConditionWindow(mob, pointSec, minRepopSec, limitSec) {
  // 月齢判定用に少し前からスキャン開始 (基準点が月齢期間中の場合を捉えるため)
  const moonScanStart = Math.max(minRepopSec, pointSec) - MOON_PHASE_DURATION_SEC;
  const moonRanges = enumerateMoonRanges(moonScanStart, limitSec, mob.moonPhase);

  for (const [moonStart, moonEnd] of moonRanges) {
    let intersectStart = moonStart;
    let intersectEnd = moonEnd;
    
    // 天候条件がある場合
    if (mob.weatherSeedRange || mob.weatherSeedRanges) {
      // 天候探索は、月齢区間の終了(moonEnd)までをリミットとする
      const weatherResult = findWeatherWindow(mob, pointSec, minRepopSec, moonEnd);
       
      if (!weatherResult) {
        continue;  
      }
      // 天候の湧き時間(popTime)または月齢開始の遅い方を採用
      intersectStart = Math.max(weatherResult.popTime, moonStart);  
      intersectEnd = Math.min(weatherResult.windowEnd, moonEnd);
       
      if (intersectStart >= intersectEnd) continue;
      // ET条件がない場合 (天候+月齢のみ)
      if (!mob.timeRange && !mob.timeRanges && !mob.conditions) {
        
        if (pointSec >= intersectStart && pointSec < intersectEnd) {
          const remainingSec = intersectEnd - pointSec;
          return {
            windowStart: pointSec, // 基準点を開始として返す
            windowEnd: intersectEnd,
            popTime: pointSec,
            remainingSec
          };
        }
        
        else if (intersectStart >= pointSec) {
          return {
            windowStart: intersectStart,
            windowEnd: intersectEnd,
            popTime: intersectStart,
            remainingSec: 0
          };
        }
      }
    } 
    
    // --- ET条件の探索ロジック ---
    // intersectStart(基準点含む)をET境界まで「繰り下げ(align)」る
    // これにより現在進行中のETウィンドウを捕捉可能にする
    let etCursor = alignToEtHour(intersectStart);  

    while (etCursor < intersectEnd) {
      // ET条件を満たしているか
      if (checkEtCondition(mob, etCursor)) {
        const etEndRaw = getEtWindowEnd(mob, etCursor);
        const etEnd = Math.min(etEndRaw, intersectEnd);
        
        // ウィンドウ区間: [etCursor, etEnd]
        // ただし、探索開始地点(intersectStart)より前は無効なのでクリップする
        // intersectStartがウィンドウ内なら、intersectStartから開始
        const validStart = Math.max(etCursor, intersectStart);
        
        if (validStart < etEnd) {
            // 基準点(pointSec)がこの有効区間内にあるか
            if (pointSec >= validStart && pointSec < etEnd) {
                return {
                    windowStart: pointSec, // 基準点を返す
                    windowEnd: etEnd,
                    popTime: pointSec,
                    remainingSec: etEnd - pointSec
                };
            }
            
            // 未来のウィンドウの場合
            if (validStart >= pointSec) {
                return {
                    windowStart: validStart,
                    windowEnd: etEnd,
                    popTime: validStart,
                    remainingSec: 0
                };
            }
        }
      }

      etCursor += ET_HOUR_SEC;
    }
  }

  return null;
}

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

  // 基準点: 最短REPOPまたは現在時間の遅い方 (未来方向へ探索の基点)
  const pointSec = Math.max(minRepop, now);
  const nextMinRepopDate = new Date(minRepop * 1000);

  let status = "Unknown";
  let elapsedPercent = 0;
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
    const searchLimit = pointSec + 20 * 24 * 3600;

    let conditionResult = null;
    conditionResult = findNextConditionWindow(mob, pointSec, minRepop, searchLimit);

    if (conditionResult) {
      const { windowStart, windowEnd, popTime, remainingSec } = conditionResult;
      // 基準点(pointSec)が期間内なら「ConditionActive」
      isInConditionWindow = (pointSec >= windowStart && pointSec < windowEnd);

      const nextSec = popTime;

      nextConditionSpawnDate = new Date(nextSec * 1000);
      conditionWindowEnd = new Date(windowEnd * 1000);

      if (isInConditionWindow) {
        timeRemaining = `残り ${formatDurationHM(remainingSec)}`;
        status = "ConditionActive";
      } else if (windowStart >= pointSec) {
        timeRemaining = `Next: ${formatDurationHM(windowStart - now)}`;
        status = "NextCondition";
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

  let conditionResult = findNextConditionWindow(mob, pointSec, minRepopSec, limitSec);

  if (conditionResult) {
    const { popTime } = conditionResult;
    return popTime;
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
