// cal.js - 修正版 v8: カスケード探索 + 基準点跨ぎ（バックトレース）対応

const ET_HOUR_SEC = 175;
const WEATHER_CYCLE_SEC = 1400;
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

/**
 * 指定された期間内で、天候条件を満たす区間を返す
 * ★修正点: windowStart 時点での「遡りチェック」を行い、基準点を跨ぐチェーンを特定する
 */
function* getValidWeatherIntervals(mob, windowStart, windowEnd) {
  const requiredMinutes = mob.weatherDuration?.minutes || 0;
  const requiredSec = requiredMinutes > 0 ? requiredMinutes * 60 : 0;
  
  if (!mob.weatherSeedRange && !mob.weatherSeedRanges) {
      yield [windowStart, windowEnd];
      return;
  }

  // 探索カーソル: windowStart のサイクル境界
  let currentCursor = alignToWeatherCycle(windowStart);
  let loopSafety = 0;

  // ★重要: windowStart 時点で天候が合致している場合、
  // それが「いつから続いているか」を過去に遡って特定する（バックトレース）
  // これを行わないと、windowStartからのカウントとなり、連続条件がリセットされてしまう
  
  // 1. 現在位置のバックトレース（跨ぎ判定）
  // ---------------------------------------------------
  const currentSeed = getEorzeaWeatherSeed(new Date(currentCursor * 1000));
  
  // 現在のサイクルが条件に合致する場合のみ、過去を掘る
  if (checkWeatherInRange(mob, currentSeed)) {
      let chainStart = currentCursor;
      
      // 過去へ遡る
      while (true) {
          // 安全装置
          if (currentCursor - chainStart > LIMIT_DAYS * 24 * 3600) break;
          
          const prevTime = chainStart - WEATHER_CYCLE_SEC;
          const seed = getEorzeaWeatherSeed(new Date(prevTime * 1000));
          if (checkWeatherInRange(mob, seed)) {
              chainStart = prevTime;
          } else {
              break; // 途切れた
          }
      }
      
      // ここで chainStart は「現在続いている天候の真の開始点」
      
      // 未来へ伸ばして chainEnd を特定
      let chainEnd = currentCursor + WEATHER_CYCLE_SEC;
      let tempCursor = chainEnd;
      while (tempCursor < windowEnd + LIMIT_DAYS * 24 * 3600) { // 少し余裕を持って伸ばす
           if (loopSafety++ > MAX_SEARCH_ITERATIONS) break;

           const seed = getEorzeaWeatherSeed(new Date(tempCursor * 1000));
           if (checkWeatherInRange(mob, seed)) {
               chainEnd += WEATHER_CYCLE_SEC;
               tempCursor += WEATHER_CYCLE_SEC;
           } else {
               break;
           }
      }
      
      // チェーンの長さ判定
      const duration = chainEnd - chainStart;
      
      // 単発(requiredSec=0)でも最低1サイクル
      if (duration >= Math.max(requiredSec, WEATHER_CYCLE_SEC)) {
          const validPopStart = chainStart + requiredSec;
          
          // クリップ処理:
          // [windowStart, windowEnd] の範囲内で、かつ validPopStart 以降
          // windowStart (基準点) を跨いでいる場合、maxにより windowStart が採用される
          const intersectStart = Math.max(validPopStart, windowStart);
          const intersectEnd = Math.min(chainEnd, windowEnd);
          
          if (intersectStart < intersectEnd) {
              yield [intersectStart, intersectEnd];
          }
      }
      
      // 次の探索はチェーンの終わりから
      currentCursor = chainEnd;
  } else {
      // 現在地点が不一致なら、次のサイクルから探索
      currentCursor += WEATHER_CYCLE_SEC;
  }

  // 2. 未来方向への通常探索
  // ---------------------------------------------------
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
          // 安全装置
          if (cursor - windowStart > LIMIT_DAYS * 24 * 3600) break;
      }
      
      if (activeStart === null) break;

      // 終点を探す
      let activeEnd = activeStart + WEATHER_CYCLE_SEC;
      let tempCursor = activeEnd;
      while (true) {
          const seed = getEorzeaWeatherSeed(new Date(tempCursor * 1000));
          if (checkWeatherInRange(mob, seed)) {
              activeEnd += WEATHER_CYCLE_SEC;
              tempCursor += WEATHER_CYCLE_SEC;
          } else {
              break;
          }
      }
      
      // 長さ判定
      const duration = activeEnd - activeStart;
      if (duration >= Math.max(requiredSec, WEATHER_CYCLE_SEC)) {
          const validPopStart = activeStart + requiredSec;
          const intersectStart = Math.max(validPopStart, windowStart);
          const intersectEnd = Math.min(activeEnd, windowEnd);
          
          if (intersectStart < intersectEnd) {
              yield [intersectStart, intersectEnd];
          }
      }
      
      cursor = activeEnd;
  }
}

/**
 * 指定された期間内で、ET条件を満たす区間を返す
 */
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
        // 天候探索でのバックトレース用に、フェーズ開始まで戻して登録
        if (
            (mob.moonPhase === "新月" && (startPhase >= 32.5 || startPhase < 4.5)) ||
            (mob.moonPhase === "満月" && (startPhase >= 16.5 && startPhase < 20.5))
        ) {
             let currentPhaseStart = pointSec - (startPhase - targetPhase) * ET_DAY_SEC;
             while (currentPhaseStart > pointSec) currentPhaseStart -= MOON_CYCLE_SEC;
             
             const currentPhaseEnd = currentPhaseStart + MOON_PHASE_DURATION_SEC;
             
             if (currentPhaseEnd > pointSec) {
                 // 月齢フェーズ自体は「期間」として渡す
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
        // mStart時点で天候が継続しているかのチェックを含め、有効区間を取得
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
    const result = findNextSpawn(mob, pointSec, searchLimit);

    if (result) {
      const { start, end } = result;
      
      nextConditionSpawnDate = new Date(start * 1000);
      conditionWindowEnd = new Date(end * 1000);
      
      isInConditionWindow = (pointSec >= start && pointSec < end);

      if (isInConditionWindow) {
        const remainingSec = end - pointSec;
        timeRemaining = `残り ${formatDurationHM(remainingSec)}`;
        status = "ConditionActive";
      } else {
        const remainingSec = start - now;
        timeRemaining = `Next: ${formatDurationHM(remainingSec)}`;
        status = "NextCondition";
      }
    }
  }

  let elapsedPercent = 0;
  
  // MaxOver優先度調整
  if (!isInConditionWindow) {
    if (status === "NextCondition") {
        // NextCondition優先
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
