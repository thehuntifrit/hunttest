// cal.js - 連続天候バグ修正版
// 区間モデル + 175秒/1400秒グリッド探索 + 終了時刻返却 + 後方互換ユーティリティ

// ===== 定数 =====
const ET_HOUR_SEC = 175;                 // 1 ET時間 = 175秒
const WEATHER_CYCLE_SEC = 1400;          // 天候サイクル = 1400秒 (23分20秒)
const ET_DAY_SEC = ET_HOUR_SEC * 24;     // 1 ET日 = 4200秒
const MOON_CYCLE_SEC = ET_DAY_SEC * 32;  // 月齢サイクル = 134400秒 (37時間20分)
const MOON_PHASE_DURATION_SEC = ET_DAY_SEC * 4; // 新月/満月 = 4 ET日 (16800秒)

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

// ===== ET時間関連 =====
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

// ===== 月齢関連 =====
// phase は 1〜32+ の連続値（小数含む）
function getEorzeaMoonInfo(date = new Date()) {
  const unixSeconds = date.getTime() / 1000;
  const EORZEA_SPEED_RATIO = 20.57142857142857;
  const eorzeaTotalDays = (unixSeconds * EORZEA_SPEED_RATIO) / 86400;
  const phase = (eorzeaTotalDays % 32) + 1; // 1〜32.x (小数含む)

  let label = null;
  // 新月: 32日12時(32.5)〜4日12時(4.5) = 4日間
  if (phase >= 32.5 || phase < 4.5) {
    label = "新月";
  } 
  // 満月: 16日12時(16.5)〜20日12時(20.5) = 4日間
  else if (phase >= 16.5 && phase < 20.5) {
    label = "満月";
  }
  
  return { phase, label };
}

// 新月開始（phase >= 32.5 のET12:00）を探索
function findNextNewMoonStart(startSec) {
  let t = alignToEtHour(startSec);
  const limit = startSec + MOON_CYCLE_SEC * 2; // 最大2サイクル先

  while (t < limit) {
    const etHour = getEtHourFromRealSec(t);
    const { phase, label } = getEorzeaMoonInfo(new Date(t * 1000));
    
    // 新月期間中かつ ET12:00 で phase が 32 付近（32.5前後）
    if (label === "新月" && etHour === 12 && phase >= 32) {
      return t;
    }
    
    t += ET_HOUR_SEC;
  }
  
  return null;
}

// 満月開始（phase >= 16.5 のET12:00）を探索
function findNextFullMoonStart(startSec) {
  let t = alignToEtHour(startSec);
  const limit = startSec + MOON_CYCLE_SEC * 2;

  while (t < limit) {
    const etHour = getEtHourFromRealSec(t);
    const { phase, label } = getEorzeaMoonInfo(new Date(t * 1000));
    
    // 満月期間中かつ ET12:00 で phase が 16 付近（16.5前後）
    if (label === "満月" && etHour === 12 && phase >= 16 && phase < 17) {
      return t;
    }
    
    t += ET_HOUR_SEC;
  }
  
  return null;
}

// 月齢区間を列挙（指定がない場合は [start,end] をそのまま返却）
function enumerateMoonRanges(startSec, endSec, moonPhase) {
  if (!moonPhase) return [[startSec, endSec]];
  
  const ranges = [];
  let moonStart = null;

  if (moonPhase === "新月") {
    moonStart = findNextNewMoonStart(startSec);
  } else if (moonPhase === "満月") {
    moonStart = findNextFullMoonStart(startSec);
  } else {
    return [[startSec, endSec]];
  }

  while (moonStart && moonStart < endSec) {
    const moonEnd = moonStart + MOON_PHASE_DURATION_SEC;
    ranges.push([
      Math.max(moonStart, startSec), 
      Math.min(moonEnd, endSec)
    ]);
    moonStart += MOON_CYCLE_SEC; // 次の同月齢へ (32日後)
  }
  
  return ranges;
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

// ===== ET時間帯関連 =====
function checkTimeRange(timeRange, realSec) {
  const etHour = getEtHourFromRealSec(realSec);
  const { start, end } = timeRange;

  if (start < end) {
    // 通常範囲 (例: 0~6)
    return etHour >= start && etHour < end;
  }
  
  // 日跨ぎ (例: 17~3)
  return etHour >= start || etHour < end;
}

// conditions 用フェーズヘルパー（小数対応）
function isFirstNightPhase(phase) {
  // 初回夜: 32日12時(32.5)〜1日12時(1.5)
  return phase >= 32.5 || phase < 1.5;
}

function isOtherNightsPhase(phase) {
  // 以降夜: 1日12時(1.5)〜4日12時(4.5)
  return phase >= 1.5 && phase < 4.5;
}

// ET条件判定（複数レンジ対応 + conditions対応）
function checkEtCondition(mob, realSec) {
  const { phase } = getEorzeaMoonInfo(new Date(realSec * 1000));
  
  // conditions がある場合（firstNight / otherNights）
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
  
  // timeRange 単体
  if (mob.timeRange) {
    return checkTimeRange(mob.timeRange, realSec);
  }
  
  // 複数 timeRanges
  if (mob.timeRanges) {
    return mob.timeRanges.some(tr => checkTimeRange(tr, realSec));
  }

  return true; // ET条件なし
}

// 指定ETレンジの終了時刻を返す（区間終端）
function getEtWindowEnd(mob, windowStart) {
  let ranges = [];

  if (mob.conditions) {
    const { phase } = getEorzeaMoonInfo(new Date(windowStart * 1000));
    if (isFirstNightPhase(phase)) {
      ranges.push(mob.conditions.firstNight?.timeRange);
    } else if (isOtherNightsPhase(phase)) {
      ranges.push(mob.conditions.otherNights?.timeRange);
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
      // 通常範囲
      if (startEtHour >= start && startEtHour < end) {
        const hoursToEnd = end - startEtHour;
        return windowStart + (hoursToEnd * ET_HOUR_SEC);
      }
    } else {
      // 日跨ぎ (例: 17~3)
      if (startEtHour >= start || startEtHour < end) {
        let hoursToEnd;
        if (startEtHour >= start) {
          hoursToEnd = (24 - startEtHour) + end;
        } else {
          hoursToEnd = end - startEtHour;
        }
        return windowStart + (hoursToEnd * ET_HOUR_SEC);
      }
    }
  }
  
  return windowStart + ET_HOUR_SEC; // デフォルト: 1 ET時間後
}

// ===== 連続天候探索（修正版）=====
function findConsecutiveWeather(mob, minRepopSec, limitSec) {
  const requiredMinutes = mob.weatherDuration.minutes;
  const requiredSec = requiredMinutes * 60;
  const requiredCycles = Math.ceil(requiredSec / WEATHER_CYCLE_SEC);

  // minRepopSec から必要サイクル分だけ遡って探索開始
  const lookbackSec = requiredCycles * WEATHER_CYCLE_SEC;
  const scanStartSec = alignToWeatherCycle(minRepopSec - lookbackSec);

  let consecutiveCycles = 0;
  let consecutiveStartSec = null;

  for (let tSec = scanStartSec; tSec <= limitSec; tSec += WEATHER_CYCLE_SEC) {
    const seed = getEorzeaWeatherSeed(new Date(tSec * 1000));
    const inRange = checkWeatherInRange(mob, seed);

    if (inRange) {
      if (consecutiveCycles === 0) consecutiveStartSec = tSec;
      consecutiveCycles++;

      if (consecutiveCycles >= requiredCycles) {
        const windowStart = consecutiveStartSec;
        const windowEnd = consecutiveStartSec + requiredSec;
        
        // minRepopSec が条件区間内にあるかチェック
        if (windowEnd >= minRepopSec) {
          // minRepopSec が区間内なら、minRepopSec が実際の開始点
          const actualStart = Math.max(windowStart, minRepopSec);
          
          // actualStart が windowEnd より前なら有効
          if (actualStart <= windowEnd) {
            return { 
              windowStart: actualStart, 
              windowEnd, 
              popTime: windowEnd 
            };
          }
        }
      }
    } else {
      consecutiveCycles = 0;
      consecutiveStartSec = null;
    }
  }
  
  return null;
}

// ===== 単発条件探索（月齢＋天候＋ET複合）=====
function findNextConditionWindow(mob, startSec, minRepopSec, limitSec) {
  const moonRanges = enumerateMoonRanges(startSec, limitSec, mob.moonPhase);

  for (const [moonStart, moonEnd] of moonRanges) {
    // 天候条件がある場合
    if (mob.weatherSeedRange || mob.weatherSeedRanges) {
      let cycleStart = alignToWeatherCycle(moonStart);
      
      // 天候サイクルごとに探索
      for (let tSec = cycleStart; tSec < moonEnd; tSec += WEATHER_CYCLE_SEC) {
        const seed = getEorzeaWeatherSeed(new Date(tSec * 1000));
        if (!checkWeatherInRange(mob, seed)) continue;

        // 天候サイクルと月齢区間の交差
        const cycleEnd = tSec + WEATHER_CYCLE_SEC;
        const intersectStart = Math.max(tSec, moonStart);
        const intersectEnd = Math.min(cycleEnd, moonEnd);
        
        if (intersectStart >= intersectEnd) continue;

        // 175秒グリッドで統一探索（minRepopSecを考慮）
        let etStart = ceilToEtHour(Math.max(intersectStart, minRepopSec));
        
        for (let etSec = etStart; etSec < intersectEnd; etSec += ET_HOUR_SEC) {
          if (etSec < minRepopSec) continue;
          
          if (checkEtCondition(mob, etSec)) {
            // 実際の開始点は max(etSec, minRepopSec)
            const candidateSec = Math.max(etSec, minRepopSec);
            const windowEnd = Math.min(
              getEtWindowEnd(mob, candidateSec), 
              intersectEnd
            );
            
            return { 
              windowStart: candidateSec, 
              windowEnd, 
              popTime: candidateSec 
            };
          }
        }
      }
    } else {
      // 天候条件なし → 月齢区間と ET条件のみ
      let etStart = ceilToEtHour(Math.max(moonStart, minRepopSec));
      
      for (let etSec = etStart; etSec < moonEnd; etSec += ET_HOUR_SEC) {
        if (etSec < minRepopSec) continue;
        
        if (checkEtCondition(mob, etSec)) {
          const candidateSec = Math.max(etSec, minRepopSec);
          const windowEnd = Math.min(
            getEtWindowEnd(mob, candidateSec), 
            moonEnd
          );
          
          return { 
            windowStart: candidateSec, 
            windowEnd, 
            popTime: candidateSec 
          };
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
  
  // メンテナンス情報正規化
  let maint = maintenance;
  if (maint && typeof maint === "object" && "maintenance" in maint && maint.maintenance) {
    maint = maint.maintenance;
  }
  if (!maint || !maint.serverUp || !maint.start) {
    return baseResult("Unknown");
  }

  const serverUpDate = new Date(maint.serverUp);
  const startDate = new Date(maint.start);
  
  if (isNaN(serverUpDate.getTime()) || isNaN(startDate.getTime())) {
    return baseResult("Unknown");
  }

  const serverUp = serverUpDate.getTime() / 1000;
  const maintenanceStart = startDate.getTime() / 1000;
  
  // 最短/最大 REPOP計算
  let minRepop = 0, maxRepop = 0;
  
  if (lastKill === 0 || lastKill < serverUp) {
    // メンテナンス後の初回（係数 0.6 を適用）
    minRepop = serverUp + (repopSec * 0.6);
    maxRepop = serverUp + (maxSec * 0.6);
  } else {
    minRepop = lastKill + repopSec;
    maxRepop = lastKill + maxSec;
  }
  
  // 初期値
  let status = "Unknown";
  let elapsedPercent = 0;
  let timeRemaining = "Unknown";

  const nextMinRepopDate = new Date(minRepop * 1000);
  
  // 特殊条件探索
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
    const searchStart = Math.max(minRepop, serverUp);
    const searchLimit = searchStart + 14 * 24 * 3600; // 最大14日分探索

    let conditionResult = null;
    
    if (mob.weatherDuration?.minutes) {
      // 連続天候（minRepop から遡って探索）
      conditionResult = findConsecutiveWeather(
        mob, 
        minRepop,
        searchLimit
      );
    } else {
      // 単発条件
      conditionResult = findNextConditionWindow(
        mob, 
        searchStart, 
        minRepop, 
        searchLimit
      );
    }

    if (conditionResult) {
      nextConditionSpawnDate = new Date(conditionResult.popTime * 1000);
      conditionWindowEnd = new Date(conditionResult.windowEnd * 1000);
      isInConditionWindow = (
        now >= conditionResult.windowStart && 
        now <= conditionResult.windowEnd
      );

      // 条件区間内の場合、ステータスを優先更新
      if (isInConditionWindow) {
        const remainingSec = conditionResult.windowEnd - now;
        timeRemaining = `条件達成中 残り ${formatDurationHM(remainingSec)}`;
        status = "ConditionActive";
      }
    }
  }
  
  // 条件区間外の場合は通常判定
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
      elapsedPercent = Math.min(
        ((now - minRepop) / (maxRepop - minRepop)) * 100, 
        100
      );
      timeRemaining = `残り ${formatDurationHM(maxRepop - now)} (${elapsedPercent.toFixed(0)}%)`;
    }
  }
  
  // メンテナンス停止判定
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

  // 内部ユーティリティ
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

// ===== 後方互換：点判定関数 =====
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

// ===== 後方互換：次スポーン時刻 =====
function findNextSpawnTime(mob, startDate, repopStartSec, repopEndSec) {
  const startSec = Math.floor(startDate.getTime() / 1000);
  const minRepopSec = repopStartSec ?? startSec;
  const limitSec = repopEndSec ?? (startSec + 14 * 24 * 3600);

  if (mob.weatherDuration?.minutes) {
    const res = findConsecutiveWeather(mob, minRepopSec, limitSec);
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
