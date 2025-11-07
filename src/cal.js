// cal.js - ハイブリッド改善版
// 175秒刻み探索 + 区間判定 + 区間終了時刻返却

import { loadMaintenance } from "./app.js";

// ===== 定数 =====
const ET_HOUR_SEC = 175;           // 1 ET時間 = 175秒
const WEATHER_CYCLE_SEC = 1400;    // 天候サイクル = 1400秒 (23分20秒)
const ET_DAY_SEC = ET_HOUR_SEC * 24; // 1 ET日 = 4200秒
const MOON_CYCLE_SEC = ET_DAY_SEC * 32; // 月齢サイクル = 134400秒 (37時間20分)
const MOON_PHASE_DURATION_SEC = ET_DAY_SEC * 4; // 新月/満月の持続時間 = 16800秒 (4時間40分)

// ===== ユーティリティ関数 =====
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
  return ticks % 24; // 0~23
}

function alignToEtHour(realSec) {
  return Math.floor(realSec / ET_HOUR_SEC) * ET_HOUR_SEC;
}

function alignToWeatherCycle(realSec) {
  return Math.floor(realSec / WEATHER_CYCLE_SEC) * WEATHER_CYCLE_SEC;
}

// ===== 月齢関連 (0~31に変更) =====
function getEorzeaMoonInfo(date = new Date()) {
  const unixSeconds = date.getTime() / 1000;
  const EORZEA_SPEED_RATIO = 20.57142857142857;
  const eorzeaTotalDays = (unixSeconds * EORZEA_SPEED_RATIO) / 86400;
  
  const phase = Math.floor(eorzeaTotalDays % 32); // 0~31
  
  let label = null;
  if (phase >= 28 || phase <= 3) {  // 28日~3日 = 新月 (4日間)
    label = "新月";
  } else if (phase >= 14 && phase <= 17) {  // 14日~17日 = 満月 (4日間)
    label = "満月";
  }
  
  return { phase, label };
}

// 新月の開始時刻を探索 (phase=28のET12:00)
function findNextNewMoonStart(startSec) {
  let t = alignToEtHour(startSec);
  const limit = startSec + MOON_CYCLE_SEC * 2; // 最大2サイクル先まで
  
  while (t < limit) {
    const etHour = getEtHourFromRealSec(t);
    const moonInfo = getEorzeaMoonInfo(new Date(t * 1000));
    
    // phase=28 かつ ET12:00
    if (moonInfo.phase === 28 && etHour === 12) {
      return t;
    }
    t += ET_HOUR_SEC;
  }
  return null;
}

// 満月の開始時刻を探索 (phase=14のET12:00)
function findNextFullMoonStart(startSec) {
  let t = alignToEtHour(startSec);
  const limit = startSec + MOON_CYCLE_SEC * 2;
  
  while (t < limit) {
    const etHour = getEtHourFromRealSec(t);
    const moonInfo = getEorzeaMoonInfo(new Date(t * 1000));
    
    if (moonInfo.phase === 14 && etHour === 12) {
      return t;
    }
    t += ET_HOUR_SEC;
  }
  return null;
}

// 月齢区間を列挙
function enumerateMoonRanges(startSec, endSec, moonPhase) {
  if (!moonPhase) return [[startSec, endSec]];
  
  const ranges = [];
  let moonStart;
  
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

  return step2 % 100; // 0~99
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

// ===== ET時間帯条件チェック =====
function checkTimeRange(timeRange, realSec) {
  const etHour = getEtHourFromRealSec(realSec);
  const { start, end } = timeRange;
  
  if (start < end) {
    return etHour >= start && etHour < end;
  } else {
    // 日跨ぎ (例: 17~3)
    return etHour >= start || etHour < end;
  }
}

function checkEtCondition(mob, realSec) {
  const moonInfo = getEorzeaMoonInfo(new Date(realSec * 1000));
  
  // conditions がある場合 (firstNight / otherNights)
  if (mob.conditions) {
    const { firstNight, otherNights } = mob.conditions;
    const { phase } = moonInfo;
    
    // 初回夜: phase 28~0
    if (firstNight?.timeRange && (phase >= 28 || phase <= 0)) {
      return checkTimeRange(firstNight.timeRange, realSec);
    }
    
    // 以降夜: phase 1~3
    if (otherNights?.timeRange && phase >= 1 && phase <= 3) {
      return checkTimeRange(otherNights.timeRange, realSec);
    }
    
    return false;
  }
  
  // 通常の timeRange / timeRanges
  if (mob.timeRange) {
    return checkTimeRange(mob.timeRange, realSec);
  }
  
  if (mob.timeRanges) {
    return mob.timeRanges.some(tr => checkTimeRange(tr, realSec));
  }
  
  return true; // ET条件なし
}

// ===== ET時間の区間計算 =====
function getEtWindowEnd(mob, windowStart) {
  // 指定されたET時間帯の終了時刻を計算
  let ranges = [];
  
  if (mob.conditions) {
    const moonInfo = getEorzeaMoonInfo(new Date(windowStart * 1000));
    const { phase } = moonInfo;
    
    if (phase >= 28 || phase <= 0) {
      ranges.push(mob.conditions.firstNight?.timeRange);
    } else if (phase >= 1 && phase <= 3) {
      ranges.push(mob.conditions.otherNights?.timeRange);
    }
  } else if (mob.timeRange) {
    ranges.push(mob.timeRange);
  } else if (mob.timeRanges) {
    ranges = mob.timeRanges;
  }
  
  // 該当する時間帯の終了時刻を計算
  const startEtHour = getEtHourFromRealSec(windowStart);
  
  for (const range of ranges) {
    if (!range) continue;
    const { start, end } = range;
    
    if (start < end) {
      if (startEtHour >= start && startEtHour < end) {
        // 終了ET時刻までの秒数を計算
        const hoursToEnd = (end - startEtHour + 24) % 24;
        return windowStart + (hoursToEnd * ET_HOUR_SEC);
      }
    } else {
      // 日跨ぎ
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
  
  return windowStart + ET_HOUR_SEC; // デフォルト: 1時間後
}

// ===== 連続天候探索 (既存ロジック維持) =====
function findConsecutiveWeather(mob, startSec, minRepopSec, limitSec) {
  const requiredMinutes = mob.weatherDuration.minutes;
  const requiredSec = requiredMinutes * 60;
  const requiredCycles = Math.ceil(requiredSec / WEATHER_CYCLE_SEC);

  let scanStartSec = alignToWeatherCycle(startSec);
  let consecutiveCycles = 0;
  let consecutiveStartSec = null;

  for (let tSec = scanStartSec; tSec <= limitSec; tSec += WEATHER_CYCLE_SEC) {
    const seed = getEorzeaWeatherSeed(new Date(tSec * 1000));
    const inRange = checkWeatherInRange(mob, seed);

    if (inRange) {
      if (consecutiveCycles === 0) consecutiveStartSec = tSec;
      consecutiveCycles++;

      if (consecutiveCycles >= requiredCycles) {
        const popSec = consecutiveStartSec + requiredSec;
        if (popSec >= minRepopSec && popSec <= limitSec) {
          return {
            windowStart: consecutiveStartSec,
            windowEnd: popSec,
            popTime: popSec
          };
        }
      }
    } else {
      consecutiveCycles = 0;
      consecutiveStartSec = null;
    }
  }
  
  return null;
}

// ===== 単発天候 + ET条件の区間探索 (新ロジック) =====
function findNextConditionWindow(mob, startSec, minRepopSec, limitSec) {
  // 月齢区間を列挙
  const moonRanges = enumerateMoonRanges(startSec, limitSec, mob.moonPhase);
  
  for (const [moonStart, moonEnd] of moonRanges) {
    // 天候条件がある場合
    if (mob.weatherSeedRange || mob.weatherSeedRanges) {
      // 天候サイクルごとに探索
      let cycleStart = alignToWeatherCycle(moonStart) - WEATHER_CYCLE_SEC;
      if (cycleStart < moonStart) cycleStart = moonStart;
      
      for (let tSec = cycleStart; tSec < moonEnd; tSec += WEATHER_CYCLE_SEC) {
        const seed = getEorzeaWeatherSeed(new Date(tSec * 1000));
        if (!checkWeatherInRange(mob, seed)) continue;
        
        const cycleEnd = Math.min(tSec + WEATHER_CYCLE_SEC, moonEnd);
        
        // サイクル内でET条件を175秒刻みで探索
        let etStart = alignToEtHour(Math.max(tSec, minRepopSec));
        
        for (let etSec = etStart; etSec < cycleEnd; etSec += ET_HOUR_SEC) {
          if (etSec < minRepopSec) continue;
          
          if (checkEtCondition(mob, etSec)) {
            const windowEnd = Math.min(
              getEtWindowEnd(mob, etSec),
              cycleEnd
            );
            
            return {
              windowStart: etSec,
              windowEnd: windowEnd,
              popTime: etSec
            };
          }
        }
      }
    } else {
      // 天候条件なし: ET条件のみ
      let etStart = alignToEtHour(Math.max(moonStart, minRepopSec));
      
      for (let etSec = etStart; etSec < moonEnd; etSec += ET_HOUR_SEC) {
        if (etSec < minRepopSec) continue;
        
        if (checkEtCondition(mob, etSec)) {
          const windowEnd = Math.min(
            getEtWindowEnd(mob, etSec),
            moonEnd
          );
          
          return {
            windowStart: etSec,
            windowEnd: windowEnd,
            popTime: etSec
          };
        }
      }
    }
  }
  
  return null;
}

// ===== メインのREPOP計算 =====
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

  const serverUpDate = new Date(maint.serverUp);
  const startDate = new Date(maint.start);
  
  if (isNaN(serverUpDate.getTime()) || isNaN(startDate.getTime())) {
    return baseResult("Unknown");
  }

  const serverUp = serverUpDate.getTime() / 1000;
  const maintenanceStart = startDate.getTime() / 1000;

  // 基本REPOP計算
  let minRepop = 0, maxRepop = 0;
  let elapsedPercent = 0;
  let timeRemaining = "Unknown";
  let status = "Unknown";

  if (lastKill === 0 || lastKill < serverUp) {
    minRepop = serverUp + (repopSec * 0.6);
    maxRepop = serverUp + (maxSec * 0.6);
  } else {
    minRepop = lastKill + repopSec;
    maxRepop = lastKill + maxSec;
  }

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
    const searchStart = Math.max(minRepop, now, serverUp);
    const searchLimit = searchStart + 14 * 24 * 3600;

    let conditionResult = null;

    // 連続天候の場合
    if (mob.weatherDuration?.minutes) {
      conditionResult = findConsecutiveWeather(mob, searchStart, minRepop, searchLimit);
    } else {
      // 単発天候 + ET条件
      conditionResult = findNextConditionWindow(mob, searchStart, minRepop, searchLimit);
    }

    if (conditionResult) {
      nextConditionSpawnDate = new Date(conditionResult.popTime * 1000);
      conditionWindowEnd = new Date(conditionResult.windowEnd * 1000);
      
      // 現在が条件区間内かチェック
      isInConditionWindow = now >= conditionResult.windowStart && now <= conditionResult.windowEnd;
      
      // 区間内の場合、時間表示を調整
      if (isInConditionWindow) {
        const remainingSec = conditionResult.windowEnd - now;
        timeRemaining = `条件達成中 残り ${formatDurationHM(remainingSec)}`;
        status = "ConditionActive";
      }
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
    conditionWindowEnd,        // 🆕 条件終了時刻
    isInConditionWindow,       // 🆕 現在区間内フラグ
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

// ===== その他のユーティリティ =====
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

// 後方互換用のダミー関数
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
    return findConsecutiveWeather(mob, startSec, minRepopSec, limitSec)?.popTime 
      ? new Date(findConsecutiveWeather(mob, startSec, minRepopSec, limitSec).popTime * 1000)
      : null;
  }
  
  const result = findNextConditionWindow(mob, startSec, minRepopSec, limitSec);
  return result ? new Date(result.popTime * 1000) : null;
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
