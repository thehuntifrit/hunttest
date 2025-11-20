// cal.js - 修正版 v7: カスケード（階層型）探索ロジック

const ET_HOUR_SEC = 175;
const WEATHER_CYCLE_SEC = 1400;
const ET_DAY_SEC = ET_HOUR_SEC * 24;
const MOON_CYCLE_SEC = ET_DAY_SEC * 32;
const MOON_PHASE_DURATION_SEC = ET_DAY_SEC * 4;
// 探索リミット（カスケードなので回数は少なく済むが、念のため）
const MAX_SEARCH_ITERATIONS = 5000;
const LIMIT_DAYS = 60; // 月齢が絡むと30日以上先もあり得るため拡張

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

// --- カスケード探索用ヘルパー関数 ---

/**
 * 指定された期間内で、天候条件を満たす区間を返す
 * 重要: 期間開始点(windowStart)以前からの連続性もチェックする
 */
function* getValidWeatherIntervals(mob, windowStart, windowEnd) {
  const requiredMinutes = mob.weatherDuration?.minutes || 0;
  const requiredSec = requiredMinutes > 0 ? requiredMinutes * 60 : 0;
  
  // 天候条件がない場合は、期間全体を有効として返す
  if (!mob.weatherSeedRange && !mob.weatherSeedRanges) {
      yield [windowStart, windowEnd];
      return;
  }

  // 探索開始位置: windowStartの直前の天候サイクル境界
  // ただし、連続条件がある場合は、その分だけさらに過去からチェックが必要
  // 「windowStartの時点で既に条件を満たしているか」を確認するため
  let currentCursor = alignToWeatherCycle(windowStart);
  
  // 遡りチェックの起点: 条件時間分 + マージン
  // ここからチェーンを構築していく
  let scanStart = currentCursor;
  
  // もし連続条件があるなら、windowStartより前から続いている可能性があるため
  // windowStart 時点でのチェーンを特定するために過去へ遡る
  let chainStart = currentCursor;
  while (true) {
      const prevTime = chainStart - WEATHER_CYCLE_SEC;
      // 探索しすぎ防止
      if (windowStart - prevTime > LIMIT_DAYS * 24 * 3600) break; 
      
      const seed = getEorzeaWeatherSeed(new Date(prevTime * 1000));
      if (checkWeatherInRange(mob, seed)) {
          chainStart = prevTime;
      } else {
          break; // 途切れた
      }
  }
  
  // チェーン探索のカーソル
  let cursor = chainStart;
  
  while (cursor < windowEnd) {
    // チェーンの開始を探す（chainStart以降で）
    let activeStart = null;
    
    // 非適合区間をスキップ
    while (cursor < windowEnd + WEATHER_CYCLE_SEC) { // windowEndを少し超えてもチェック
        const seed = getEorzeaWeatherSeed(new Date(cursor * 1000));
        if (checkWeatherInRange(mob, seed)) {
            activeStart = cursor;
            break;
        }
        cursor += WEATHER_CYCLE_SEC;
    }
    
    if (activeStart === null) break; // もう適合区間がない

    // チェーンの終了を探す
    let activeEnd = activeStart + WEATHER_CYCLE_SEC;
    let tempCursor = activeEnd;
    while (true) { // 期間を超えても天候が続く限り伸ばす
        const seed = getEorzeaWeatherSeed(new Date(tempCursor * 1000));
        if (checkWeatherInRange(mob, seed)) {
            activeEnd += WEATHER_CYCLE_SEC;
            tempCursor += WEATHER_CYCLE_SEC;
        } else {
            break;
        }
    }
    
    // チェーン確定。条件判定
    const duration = activeEnd - activeStart;
    
    // 単発(requiredSec=0)の場合は最低1サイクルあればOK
    // 連続の場合は duration >= requiredSec
    if (duration >= Math.max(requiredSec, WEATHER_CYCLE_SEC)) {
        // 湧き有効開始時刻 = チェーン開始 + 必要時間
        const validPopStart = activeStart + requiredSec;
        
        // この区間と [windowStart, windowEnd] の交差を取る
        const intersectStart = Math.max(validPopStart, windowStart);
        const intersectEnd = Math.min(activeEnd, windowEnd);
        
        if (intersectStart < intersectEnd) {
            yield [intersectStart, intersectEnd];
        }
    }
    
    // 次の探索はチェーンの終わりから
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

  // windowStart を ET時間境界に揃える（繰り下げ）
  // これにより windowStart が 10:30 とかでも 10:00-12:00 の枠を拾える
  let cursor = alignToEtHour(windowStart);
  
  while (cursor < windowEnd) {
      if (checkEtCondition(mob, cursor)) {
          const start = cursor;
          let end = cursor + ET_HOUR_SEC;
          let tempCursor = end;
          
          // 連続するET区間を結合
          while (tempCursor < windowEnd + ET_HOUR_SEC) { // 少し余分に見る
              if (checkEtCondition(mob, tempCursor)) {
                  end += ET_HOUR_SEC;
                  tempCursor += ET_HOUR_SEC;
              } else {
                  break;
              }
          }
          
          // 交差を取る
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
    // ----------------------
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
             // 過去すぎる開始点はpointSecに補正（探索効率のため）
             moonPhases.push([Math.max(currentPhaseStart, pointSec), currentPhaseStart + MOON_PHASE_DURATION_SEC]);
        }
        
        // 未来のフェーズ
        let moonStart = calculateNextMoonStart(pointSec, targetPhase);
        while (moonStart < searchLimit) {
            moonPhases.push([moonStart, moonStart + MOON_PHASE_DURATION_SEC]);
            moonStart += MOON_CYCLE_SEC;
        }
    }

    // 2. 天候探索（第2層：月齢区間内）
    // ----------------------
    for (const [mStart, mEnd] of moonPhases) {
        // この月齢区間内で有効な天候を探す
        // ※ getValidWeatherIntervals 内部で「mStart以前からの天候継続」も考慮される
        const weatherIterator = getValidWeatherIntervals(mob, mStart, mEnd);
        
        for (const [wStart, wEnd] of weatherIterator) {
            
            // 3. ET探索（第3層：天候区間内）
            // ----------------------
            const etIterator = getValidEtIntervals(mob, wStart, wEnd);
            
            for (const [eStart, eEnd] of etIterator) {
                
                // 最終的な湧き区間: [eStart, eEnd]
                // ただし、pointSec より未来である（または現在進行中である）必要がある
                
                // 湧き開始時刻: 計算上の開始時刻と pointSec の遅い方
                const finalStart = Math.max(eStart, pointSec);
                const finalEnd = eEnd;
                
                // 有効な区間か？
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
  // 探索範囲を広めに
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
    // カスケード探索を実行
    const result = findNextSpawn(mob, pointSec, searchLimit);

    if (result) {
      const { start, end } = result;
      
      nextConditionSpawnDate = new Date(start * 1000);
      conditionWindowEnd = new Date(end * 1000);
      
      isInConditionWindow = (pointSec >= start && pointSec < end);

      if (isInConditionWindow) {
        // Active時
        const remainingSec = end - pointSec;
        timeRemaining = `残り ${formatDurationHM(remainingSec)}`;
        status = "ConditionActive";
      } else {
        // Next時
        const remainingSec = start - now;
        timeRemaining = `Next: ${formatDurationHM(remainingSec)}`;
        status = "NextCondition";
      }
    }
  }

  let elapsedPercent = 0;
  
  // MaxOver判定の優先度調整
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
  // 条件チェックロジックに変更なし
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
