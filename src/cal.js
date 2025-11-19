// cal.js - 区間モデル + 175秒/1400秒グリッド探索 + 終了時刻返却 + 後方互換ユーティリティ

// ===== 定数 =====
const ET_HOUR_SEC = 175;                 // 1 ET時間 = 175秒
const WEATHER_CYCLE_SEC = 1400;          // 天候サイクル = 1400秒 (23分20秒)
const ET_DAY_SEC = ET_HOUR_SEC * 24;     // 1 ET日 = 4200秒 (1 phase 変化にかかる秒数)
const MOON_CYCLE_SEC = ET_DAY_SEC * 32;  // 月齢サイクル = 134400秒 (37時間20分)
const MOON_PHASE_DURATION_SEC = ET_DAY_SEC * 4; // 新月/満月 = 4 ET日 (16800秒)
const MAX_CONSECUTIVE_CYCLES = 20;       // 最大継続結合サイクル数 (+19回分)

// ===== 表示ユーティリティ (変更なし) =====
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

// ===== ET時間関連 (変更なし) =====
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
  return ticks % 24; // 0..23
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

// ===== 月齢関連 (変更なし) =====
function getEorzeaMoonInfo(date = new Date()) {
  const unixSeconds = date.getTime() / 1000;
  const EORZEA_SPEED_RATIO = 20.57142857142857;
  const eorzeaTotalDays = (unixSeconds * EORZEA_SPEED_RATIO) / 86400;
  const phase = (eorzeaTotalDays % 32) + 1; // 1〜33 の連続値として扱われる

  let label = null;
  if (phase >= 32.5 |

| phase < 4.5) label = "新月"; // 32日12:00〜4日12:00
  else if (phase >= 16.5 && phase < 20.5) label = "満月"; // 16日12:00〜20日12:00

  return { phase, label };
}

// 厳密な月齢開始時刻を直接計算 (phase = 32.5)
function calculateNextNewMoonStart(startSec) {
  const startPhase = getEorzeaMoonInfo(new Date(startSec * 1000)).phase;
  const targetPhase = 32.5;

  let phaseDiff = targetPhase - startPhase;
  if (phaseDiff < 0) phaseDiff += 32; // サイクルを跨ぐ

  // 1 phase = 4200 秒 (ET_DAY_SEC)
  let nextStartSec = startSec + phaseDiff * ET_DAY_SEC;
  
  // 探索範囲の限界を超えた場合の次のサイクルへ
  if (nextStartSec > startSec + MOON_CYCLE_SEC) {
    nextStartSec -= MOON_CYCLE_SEC;
  } else if (nextStartSec < startSec) {
    nextStartSec += MOON_CYCLE_SEC;
  }
  
  return nextStartSec;
}

// 厳密な月齢開始時刻を直接計算 (phase = 16.5)
function calculateNextFullMoonStart(startSec) {
  const startPhase = getEorzeaMoonInfo(new Date(startSec * 1000)).phase;
  const targetPhase = 16.5;

  let phaseDiff = targetPhase - startPhase;
  if (phaseDiff < 0) phaseDiff += 32; // サイクルを跨ぐ

  // 1 phase = 4200 秒 (ET_DAY_SEC)
  let nextStartSec = startSec + phaseDiff * ET_DAY_SEC;
  
  if (nextStartSec > startSec + MOON_CYCLE_SEC) {
    nextStartSec -= MOON_CYCLE_SEC;
  } else if (nextStartSec < startSec) {
    nextStartSec += MOON_CYCLE_SEC;
  }

  return nextStartSec;
}

// 月齢区間列挙（開始→4ET日）
function enumerateMoonRanges(startSec, endSec, moonPhase) {
  if (!moonPhase) return];
  const ranges =;
  let moonStart = null;

  if (moonPhase === "新月") moonStart = calculateNextNewMoonStart(startSec);
  else if (moonPhase === "満月") moonStart = calculateNextFullMoonStart(startSec);
  else return];

  // 探索開始点以前の moonStart は無視する
  while (moonStart < startSec) {
    moonStart += MOON_CYCLE_SEC;
  }

  while (moonStart && moonStart < endSec) {
    const moonEnd = moonStart + MOON_PHASE_DURATION_SEC; // 4 ET日
    ranges.push();
    moonStart += MOON_CYCLE_SEC; // 次の同フェーズ
  }
  return ranges;
}
// 夜フェーズ判定（phase は 1〜32 小数）
function isFirstNightPhase(phase) {
  return phase >= 32.5 |

| phase < 1.5; // 32日12:00〜1日12:00
}
function isOtherNightsPhase(phase) {
  return phase >= 1.5 && phase < 4.5; // 1日12:00〜4日12:00
}

// ===== 天候関連 (変更なし) =====
function getEorzeaWeatherSeed(date = new Date()) {
  const unixSeconds = Math.floor(date.getTime() / 1000);
  const eorzeanHours = Math.floor(unixSeconds / ET_HOUR_SEC);
  const eorzeanDays = Math.floor(eorzeanHours / 24);

  let timeChunk = (eorzeanHours % 24) - (eorzeanHours % 8);
  timeChunk = (timeChunk + 8) % 24;

  const seed = eorzeanDays * 100 + timeChunk;
  const step1 = (seed << 11) ^ seed;
  const step2 = ((step1 >>> 8) ^ step1) >>> 0;
  return step2 % 100; // 0〜99
}

// 天候テーブルからラベル決定（累積率）
function getEorzeaWeather(date = new Date(), weatherTable) {
  const seed = getEorzeaWeatherSeed(date);
  let cumulative = 0;
  for (const entry of weatherTable) {
    cumulative += entry.rate;
    if (seed < cumulative) return entry.weather;
  }
  return "Unknown";
}

// weatherSeedRange(s) 判定
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

// ===== ET時間帯関連 (変更なし) =====
function checkTimeRange(timeRange, realSec) {
  const etHour = getEtHourFromRealSec(realSec);
  const { start, end } = timeRange;

  if (start < end) return etHour >= start && etHour < end;
  return etHour >= start |

| etHour < end; // 日跨ぎ
}

// ET条件判定（複数レンジ対応）
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

  return true; // ET条件なし
}

// 現在ETレンジ終端を計算（複数レンジ中の当該レンジ終端）
function getEtWindowEnd(mob, windowStart) {
  let ranges =;

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
      // 日跨ぎ
      if (startEtHour >= start |

| startEtHour < end) {
        const hoursToEnd = startEtHour >= start
         ? (24 - startEtHour) + end
          : (end - startEtHour);
        return windowStart + hoursToEnd * ET_HOUR_SEC;
      }
    }
  }
  // 当該レンジが特定できない場合は1ET時間デフォルト
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
  const requiredMinutes = mob.weatherDuration?.minutes |

| 0;
  const requiredSec = requiredMinutes > 0? requiredMinutes * 60 : WEATHER_CYCLE_SEC;
  const backSec = requiredSec; 

  // --- A. 巻き戻し探索 (基準点の包含チェック) ---
  // pointSecが属する天候サイクル境界から遡る
  let currentCursor = alignToWeatherCycle(pointSec);
  let currentWindowEnd = currentCursor + WEATHER_CYCLE_SEC; 

  // 探索を始める安全な過去の境界 
  const scanStart = ceilToWeatherCycle(pointSec - backSec); 
  
  let consecutiveCycles = 0;
  let lastHitStart = null; 

  while (currentCursor >= scanStart) {
    const seed = getEorzeaWeatherSeed(new Date(currentCursor * 1000));
    
    if (checkWeatherInRange(mob, seed)) {
      consecutiveCycles++;
      lastHitStart = currentCursor; 
    } else {
      consecutiveCycles = 0; 
      lastHitStart = null;
    }
    
    // 連続がbackSec分成立しているかチェック
    if (lastHitStart!== null && consecutiveCycles * WEATHER_CYCLE_SEC >= backSec) {
      // pointSecが成立区間内にあることを確認
      if (pointSec >= lastHitStart && pointSec < currentWindowEnd) {
        
        // pointSecを含む、backSecが成立した最小の区間の開始点を計算
        const initialWindowEnd = lastHitStart + consecutiveCycles * WEATHER_CYCLE_SEC;
        const trueWindowStart = initialWindowEnd - backSec;

        // pointSecがこの真のウィンドウに含まれるか確認
        if (pointSec >= trueWindowStart && pointSec < trueWindowStart + backSec) {
            
          // 継続結合の適用
          const windowEnd = extendWeatherWindow(mob, trueWindowStart, trueWindowStart + backSec, limitSec);
          
          const remainingSec = windowEnd - pointSec;
          return {
            windowStart: trueWindowStart,
            windowEnd,
            popTime: pointSec, // ★ 基準点 pointSec を採用
            remainingSec
          };
        }
      }
    }
    
    currentCursor -= WEATHER_CYCLE_SEC;
    currentWindowEnd -= WEATHER_CYCLE_SEC;
  }

  // --- B. 前方探索 ---
  // ロジック: minRepopSec か pointSec の次の天候境界から探索開始
  // let forwardCursor = alignToWeatherCycle(Math.max(minRepopSec, pointSec));
  // 【修正点1】探索開始を ceil に戻す: pointSec 以降の未来の天候条件を正しく拾うため
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
      // 連続成立: windowStart は currentCursor
      const windowStart = consecutiveStart;
      const initialWindowEnd = windowStart + accumulated;
      
      // 継続結合の適用
      const windowEnd = extendWeatherWindow(mob, windowStart, initialWindowEnd, limitSec);

      return {
        windowStart,
        windowEnd,
        // 連続条件を満たした時刻 (windowStart + backSec) を popTime に採用
        popTime: windowStart + backSec, 
        remainingSec: 0
      };
    }

    // 不成立の場合、不成立サイクル境界 (testCursor) の次の天候境界から探索再開
    forwardCursor = ceilToWeatherCycle(testCursor); 
    
    // 無限ループ回避のガード 
    if (forwardCursor <= consecutiveStart) {
      forwardCursor = consecutiveStart + WEATHER_CYCLE_SEC;
    }
  }

  return null;
}

// ===== 条件ウィンドウ探索 =====
function findNextConditionWindow(mob, pointSec, minRepopSec, limitSec) {
  // 月齢の探索開始を pointSec の MOON_PHASE_DURATION_SEC 前から開始する
  const moonScanStart = Math.max(minRepopSec, pointSec) - MOON_PHASE_DURATION_SEC;
  const moonRanges = enumerateMoonRanges(moonScanStart, limitSec, mob.moonPhase);

  for (const of moonRanges) {
          
    let intersectStart = moonStart;
    let intersectEnd = moonEnd;
    
    // --- 1. 天候条件チェックと交差 ---
    if (mob.weatherSeedRange |

| mob.weatherSeedRanges) {
      // 月齢区間内での天候ウィンドウを探索 
      // pointSec は minRepopSec を超えるため、天候の minRepop も考慮される
      const weatherResult = findWeatherWindow(mob, pointSec, minRepopSec, moonEnd);
      
      if (!weatherResult) {
        continue; 
      }

      // 天候ウィンドウと月齢区間の交差
      intersectStart = Math.max(weatherResult.popTime, moonStart); 
      intersectEnd = Math.min(weatherResult.windowEnd, moonEnd);
      
      if (intersectStart >= intersectEnd) continue;
    
      // 【修正点2】不要なクリップ処理を削除。
      // 未来の天候条件が pointSec で切り捨てられる問題を解消
      // intersectStart = Math.max(intersectStart, pointSec);  <-- 削除

      // ET条件なし（天候/月齢条件のみ）の場合の処理
      if (!mob.timeRange &&!mob.timeRanges &&!mob.conditions) {
        
        // pointSec が成立区間に含まれている場合 (現在成立中)
        if (pointSec >= intersectStart && pointSec < intersectEnd) {
          const remainingSec = intersectEnd - pointSec;
          return {
            windowStart: intersectStart,
            windowEnd: intersectEnd,
            popTime: pointSec, // ★ 基準点 pointSec を採用
            remainingSec
          };
        } 
        // pointSec が成立区間より前にある場合 (未来のウィンドウ開始)
        else if (intersectStart > pointSec) {
          // popTimeは windowStart をそのまま採用 (月齢はリアルタイム時刻)
          return {
            windowStart: intersectStart,
            windowEnd: intersectEnd,
            popTime: intersectStart, 
            remainingSec: 0
          };
        }
      }
    } else {
      // 天候条件がない場合でも、pointSec 以降にクリップ
      // 【修正点2】天候条件なしの場合のクリップ処理も削除し、ロジックを統一
      // intersectStart = Math.max(intersectStart, pointSec);  <-- 削除
    }
    
    // --- 2. ET条件の走査 (ETロジック維持) ---
    
    // 探索起点を pointSec の 次の ET 時間境界とし、それが intersectEnd 内にあるかを検証する

    // 1. pointSec を満たす最も早い ET 境界 (C1, C3) を計算
    let earliestEtFloor = ceilToEtHour(pointSec);

    // 2. 厳密な包含性チェック: earliestEtFloor が intersectEnd を超えていないか検証 (C2)
    if (earliestEtFloor >= intersectEnd) {
        // 境界を飛び越した場合、現在のウィンドウは pointSec 以降では利用不可。
        // 次のサイクルを探索するため、失敗を通知する。
        continue; // 次の moonRanges に進む
    }

    // 3. 最終的な探索開始カーソルを設定 (T_E_Floor と intersectStart の遅い方)
    // T_E_Floor が既に intersectEnd 内にあることを保証済み。
    let etCursor = Math.max(earliestEtFloor, intersectStart); 

    while (etCursor < intersectEnd) {
      if (checkEtCondition(mob, etCursor)) {
        const etEndRaw = getEtWindowEnd(mob, etCursor);
        const etEnd = Math.min(etEndRaw, intersectEnd);
        
        const windowStart = etCursor;
        const windowEnd = etEnd;

        // pointSec が成立ウィンドウ内にいるかチェック (現在成立中/基準点跨ぎ)
        if (pointSec >= windowStart && pointSec < windowEnd) {
          const remainingSec = windowEnd - pointSec;
          return {
            windowStart,
            windowEnd,
            popTime: pointSec, // ★ 基準点 pointSec を採用
            remainingSec
          };
        }

        // 未来の成立開始点を返す 
        // windowStart (etCursor) は pointSec 以降の ET 境界
        return {
          windowStart,
          windowEnd,
          popTime: windowStart, // ★ ユーザーの要望に従い、ET境界のまま維持
          remainingSec: 0
        };
      }

      etCursor += ET_HOUR_SEC;
    }
  }

  return null;
}

// ===== メイン REPOP 計算 (変更なし) =====
function calculateRepop(mob, maintenance) {
  const now = Date.now() / 1000;
  const lastKill = mob.last_kill_time |

| 0;
  const repopSec = mob.REPOP_s;
  const maxSec = mob.MAX_s;

  let maint = maintenance;
  if (maint && typeof maint === "object" && "maintenance" in maint && maint.maintenance) {
    maint = maint.maintenance;
  }
  if (!maint ||!maint.serverUp ||!maint.start) return baseResult("Unknown");

  const serverUp = new Date(maint.serverUp).getTime() / 1000;
  const maintenanceStart = new Date(maint.start).getTime() / 1000;

  let minRepop, maxRepop;
  if (lastKill === 0 |

| lastKill <= serverUp) {
    minRepop = serverUp + repopSec * 0.6;
    maxRepop = serverUp + maxSec * 0.6;
  } else {
    minRepop = lastKill + repopSec;
    maxRepop = lastKill + maxSec;
  }

  const pointSec = Math.max(minRepop, now);
  const nextMinRepopDate = new Date(minRepop * 1000);

  let status = "Unknown";
  let elapsedPercent = 0;
  let timeRemaining = "Unknown";

  let nextConditionSpawnDate = null;
  let conditionWindowEnd = null;
  let isInConditionWindow = false;

  const hasCondition =!!(
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
      isInConditionWindow = (pointSec >= windowStart && pointSec < windowEnd);

      const nextSec = popTime;

      nextConditionSpawnDate = new Date(nextSec * 1000);
      conditionWindowEnd = new Date(windowEnd * 1000);

      if (isInConditionWindow) {
        timeRemaining = `残り ${formatDurationHM(remainingSec)}`;
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
      nextConditionSpawnDate: null,
      conditionWindowEnd: null,
      isInConditionWindow: false,
      isMaintenanceStop: false
    };
  }
}

// ===== 後方互換：点判定関数 (変更なし) =====
function checkMobSpawnCondition(mob, date) {
  const pointSec = Math.floor(date.getTime() / 1000);
  // 月齢条件
  if (mob.moonPhase) {
    const moonInfo = getEorzeaMoonInfo(date);
    if (moonInfo.label!== mob.moonPhase) return false;
  }
  // 天候条件
  if (mob.weatherSeedRange |

| mob.weatherSeedRanges) {
    const seed = getEorzeaWeatherSeed(date);
    if (!checkWeatherInRange(mob, seed)) return false;
  }
  // ET時間帯条件
  if (!checkEtCondition(mob, pointSec)) return false;
  // すべての条件を満たしている
  return true;
}

// ===== 後方互換：次スポーン時刻（修正版） =====
function findNextSpawnTime(mob, pointSec, minRepopSec, limitSec) {
  const hasCondition =!!(
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

// ===== エクスポート (変更なし) =====
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
