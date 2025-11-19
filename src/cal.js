// cal.js - 修正版 v2: 天候無限延長 + ET境界判定強化 + 進行中ウィンドウ捕捉の徹底

const ET_HOUR_SEC = 175;
const WEATHER_CYCLE_SEC = 1400;
const ET_DAY_SEC = ET_HOUR_SEC * 24;
const MOON_CYCLE_SEC = ET_DAY_SEC * 32;
const MOON_PHASE_DURATION_SEC = ET_DAY_SEC * 4;
// 制限撤廃のため、探索時の安全装置としてのリミットのみ大きく設定
const MAX_SEARCH_ITERATIONS = 1000; 

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

  // 開始点がstartSecよりかなり前になる場合があるため調整
  // startSecより前の直近のmoonStartを探す
  while (moonStart > startSec) {
    moonStart -= MOON_CYCLE_SEC;
  }
  while (moonStart + MOON_CYCLE_SEC < startSec) {
      moonStart += MOON_CYCLE_SEC;
  }

  while (moonStart < endSec) {
    const moonEnd = moonStart + MOON_PHASE_DURATION_SEC;
    // 月齢期間が探索範囲と重なるか
    if (moonEnd > startSec) {
         ranges.push([Math.max(moonStart, startSec), Math.min(moonEnd, endSec)]);
    }
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
  let cursor = currentEnd;
  let iterations = 0;

  // 修正: 連続制限を撤廃し、探索リミットまで継続する
  while (cursor <= limitSec && iterations < MAX_SEARCH_ITERATIONS) {
    const seed = getEorzeaWeatherSeed(new Date(cursor * 1000));
    if (checkWeatherInRange(mob, seed)) {
      currentEnd += WEATHER_CYCLE_SEC;
      cursor += WEATHER_CYCLE_SEC;
    } else {
      break;
    }
    iterations++;
  }
  return currentEnd;
}

function findWeatherWindow(mob, pointSec, minRepopSec, limitSec) {
  const requiredMinutes = mob.weatherDuration?.minutes || 0;
  const requiredSec = requiredMinutes > 0 ? requiredMinutes * 60 : WEATHER_CYCLE_SEC;
  const backSec = requiredSec;  

  // --- 修正: 過去スキャン(現在進行中判定)の強化 ---
  // pointSecを含む、あるいはpointSecの直前から続いているウィンドウを探す
  // 天候サイクル境界まで繰り下げ
  let currentCursor = alignToWeatherCycle(pointSec);
  
  // backSec分戻るが、念のため1サイクル余分に遡ってからチェックする
  const scanStart = ceilToWeatherCycle(pointSec - backSec - WEATHER_CYCLE_SEC);  
   
  let consecutiveCycles = 0;
  let lastHitStart = null;
  let foundActive = null;

  // 過去から現在へ向かってスキャン
  // scanStartからcurrentCursorまでをチェックして、連続性を確認する
  let tempCursor = scanStart;
  while (tempCursor <= currentCursor) {
      const seed = getEorzeaWeatherSeed(new Date(tempCursor * 1000));
      if (checkWeatherInRange(mob, seed)) {
          if (lastHitStart === null) lastHitStart = tempCursor;
          consecutiveCycles++;
      } else {
          // 途切れたらリセット
          lastHitStart = null;
          consecutiveCycles = 0;
      }
      tempCursor += WEATHER_CYCLE_SEC;
  }

  // 直近(currentCursor)でヒットしており、かつ条件時間を満たしているか
  if (lastHitStart !== null && consecutiveCycles > 0) {
      // 継続時間の計算
      // lastHitStartからcurrentCursorまでの時間 + currentCursor自体の長さ(1400)
      // currentCursorはループの最後でチェックされた位置
      const totalDuration = (currentCursor - lastHitStart) + WEATHER_CYCLE_SEC;
      
      if (totalDuration >= backSec) {
          const initialWindowEnd = currentCursor + WEATHER_CYCLE_SEC;
          // backSecを満たす最も遅い開始点 = 現在の終わり - backSec
          // ただし実際の天候開始は lastHitStart
          const trueWindowStart = lastHitStart; 

          const windowEnd = extendWeatherWindow(mob, trueWindowStart, initialWindowEnd, limitSec);
          
          if (pointSec < windowEnd) {
             // pointSecが期間内であれば採用
             return {
                windowStart: pointSec, // 基準点開始
                windowEnd,
                popTime: pointSec,
                remainingSec: windowEnd - pointSec
             };
          }
      }
  }


  // --- 未来方向へスキャン ---
  let forwardCursor = ceilToWeatherCycle(Math.max(minRepopSec, pointSec));
  // もしforwardCursorがpointSecより過去になってしまった場合の補正（念のため）
  if (forwardCursor < pointSec) forwardCursor += WEATHER_CYCLE_SEC;

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
  // 月齢スキャン開始位置：基準点より十分前から
  const moonScanStart = Math.max(minRepopSec, pointSec) - MOON_PHASE_DURATION_SEC;
  const moonRanges = enumerateMoonRanges(moonScanStart, limitSec, mob.moonPhase);

  for (const [moonStart, moonEnd] of moonRanges) {
    let intersectStart = moonStart;
    let intersectEnd = moonEnd;
    
    // 天候条件がある場合
    if (mob.weatherSeedRange || mob.weatherSeedRanges) {
      const weatherResult = findWeatherWindow(mob, pointSec, minRepopSec, moonEnd);
       
      if (!weatherResult) {
        continue;  
      }

      // 天候結果が現在進行形(Active)の場合、popTimeはpointSecになっている
      intersectStart = Math.max(weatherResult.popTime, moonStart);  
      intersectEnd = Math.min(weatherResult.windowEnd, moonEnd);
       
      if (intersectStart >= intersectEnd) continue;
       
      // ET条件がない場合
      if (!mob.timeRange && !mob.timeRanges && !mob.conditions) {
        if (pointSec < intersectEnd) {
          // 既に範囲内なら基準点を開始とする
          const start = Math.max(intersectStart, pointSec);
          return {
            windowStart: start,
            windowEnd: intersectEnd,
            popTime: start,
            remainingSec: intersectEnd - start
          };
        }
      }
    } 
    
    // --- 修正: ET条件の探索ロジックの堅牢化 ---
    // intersectStart地点をET境界まで「繰り下げ(align)」る
    let etCursor = alignToEtHour(intersectStart);  

    while (etCursor < intersectEnd) {
      // 条件チェック
      if (checkEtCondition(mob, etCursor)) {
        const etEndRaw = getEtWindowEnd(mob, etCursor);
        const etEnd = Math.min(etEndRaw, intersectEnd);
        
        // 有効区間: [etCursor, etEnd]
        // 探索開始点(intersectStart)より前の部分は無効なのでクリップ
        const validStart = Math.max(etCursor, intersectStart);
        
        // クリップ後の開始点が終了点より前であること
        if (validStart < etEnd) {
            // 基準点(pointSec)がウィンドウ終了より前であれば有効
            if (pointSec < etEnd) {
                // 開始点は「基準点」か「有効開始点」の遅い方
                const outputStart = Math.max(pointSec, validStart);
                
                return {
                    windowStart: outputStart,
                    windowEnd: etEnd,
                    popTime: outputStart,
                    remainingSec: etEnd - outputStart
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

  // 基準点: 最短REPOPまたは現在時間の遅い方
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
    // 探索範囲を広めに取る(20日)
    const searchLimit = pointSec + 20 * 24 * 3600;

    let conditionResult = null;
    conditionResult = findNextConditionWindow(mob, pointSec, minRepop, searchLimit);

    if (conditionResult) {
      const { windowStart, windowEnd, popTime, remainingSec } = conditionResult;
      
      // 現在(pointSec)がウィンドウ内にあるか判定
      isInConditionWindow = (pointSec >= windowStart && pointSec < windowEnd);

      // 条件結果が「過去の開始」を返してきた場合でも、popTimeはpointSecに補正されている想定
      const nextSec = popTime;

      nextConditionSpawnDate = new Date(nextSec * 1000);
      conditionWindowEnd = new Date(windowEnd * 1000);

      if (isInConditionWindow) {
        timeRemaining = `残り ${formatDurationHM(remainingSec)}`;
        status = "ConditionActive";
      } else {
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
