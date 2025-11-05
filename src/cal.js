// cal.js

import { loadMaintenance } from "./app.js";

const WEATHER_CYCLE_SEC = 23 * 60 + 20; // 1400

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

function getEorzeaTime(date = new Date()) {
  let unixMs = date.getTime();
  const REAL_MS_PER_ET_HOUR = 175 * 1000;
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

function getEorzeaMoonPhase(date = new Date()) {
  const unixSeconds = date.getTime() / 1000;
  const EORZEA_SPEED_RATIO = 20.57142857142857;
  const eorzeaTotalDays = (unixSeconds * EORZEA_SPEED_RATIO) / 86400;
  return (eorzeaTotalDays % 32) + 1;
}

function getMoonPhaseLabel(phase) {
  if (phase >= 32.5 || phase < 4.5) return "新月";
  if (phase >= 16.5 && phase < 20.5) return "満月";
  return null;
}

function getEorzeaWeatherSeed(date = new Date()) {
  const unixSeconds = Math.floor(date.getTime() / 1000);
  const eorzeanHours = Math.floor(unixSeconds / 175);
  const eorzeanDays = Math.floor(eorzeanHours / 24);

  let timeChunk = (eorzeanHours % 24) - (eorzeanHours % 8);
  timeChunk = (timeChunk + 8) % 24;

  const seed = eorzeanDays * 100 + timeChunk;

  const step1 = (seed << 11) ^ seed;
  const step2 = ((step1 >>> 8) ^ step1) >>> 0;

  return step2 % 100; // 0〜99
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

// 時間帯条件チェック
function checkTimeRange(timeRange, timestamp) {
    const et = getEorzeaTime(new Date(timestamp * 1000));
    const h = Number(et.hours);
    const m = Number(et.minutes);
    const currentMinutes = h * 60 + m; // 0〜1439

    const startMinutes = timeRange.start * 60;
    const endMinutes = timeRange.end * 60;

    if (startMinutes < endMinutes) {
        // 例: 0..3 → 0:00〜2:59
        return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    } else {
        // 例: 17..3 → 17:00〜23:59 または 0:00〜2:59
        return currentMinutes >= startMinutes || currentMinutes < endMinutes;
    }
}

    // 新月開始直後（32.5〜1.5まで）
function isFirstNightPhase(phase) {
    return (phase >= 32.5 || phase < 1.5);
}

    // 新月継続中（1.5〜4.5まで）
function isOtherNightsPhase(phase) {
    return (phase >= 1.5 && phase < 4.5);
}

// 総合条件チェック
function checkMobSpawnCondition(mob, date) {
  const ts = Math.floor(date.getTime() / 1000);
  const et = getEorzeaTime(date);
  const moon = getEorzeaMoonPhase(date); // 数値 (0〜33)
  const seed = getEorzeaWeatherSeed(date);
  // 月齢ラベル条件
  if (mob.moonPhase) {
    const currentLabel = getMoonPhaseLabel(moon);
    if (currentLabel !== mob.moonPhase) return false;
  }
  // 天候条件
  if (mob.weatherSeedRange) {
    const [min, max] = mob.weatherSeedRange;
    if (seed < min || seed > max) return false;
  }
  if (mob.weatherSeedRanges) {
    const ok = mob.weatherSeedRanges.some(([min, max]) => seed >= min && seed <= max);
    if (!ok) return false;
  }
  // conditions を持つモブの時間帯評価（firstNight / otherNights）
  if (mob.conditions) {
    let ok = false;
    const fn = mob.conditions.firstNight;
    const on = mob.conditions.otherNights;
    // 初回夜: 月齢が 32.5〜1.5 の範囲
    if (fn && fn.timeRange && (moon >= 32.5 || moon <= 1.5)) {
      ok = ok || checkTimeRange(fn.timeRange, ts);
    }
    // 以降夜: 月齢が 1.5〜4.5 の範囲
    if (on && on.timeRange && moon > 1.5 && moon < 4.5) {
      ok = ok || checkTimeRange(on.timeRange, ts);
    }

    if (!ok) return false;
  }
  // conditions が無い場合のみ、通常の timeRange / timeRanges を評価
  if (!mob.conditions && mob.timeRange) {
    if (!checkTimeRange(mob.timeRange, ts)) return false;
  }
  if (!mob.conditions && mob.timeRanges) {
    const ok = mob.timeRanges.some((tr) => checkTimeRange(tr, ts));
    if (!ok) return false;
  }

  return true;
}

function alignToCycleBoundary(tSec) {
    const r = tSec % WEATHER_CYCLE_SEC;
    return tSec - r; // 直前のサイクル境界
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

// --- ET hour 揃え ---
function alignToEorzeaHourBoundary(realSec) {
  const ET_HOUR_SEC = 175; // 1 ET hour = 175秒
  return Math.floor(realSec / ET_HOUR_SEC) * ET_HOUR_SEC;
}

// --- 条件探索 ---
function findNextSpawnTime(mob, startDate, repopStartSec, repopEndSec) {
  const startSec = Math.floor(startDate.getTime() / 1000);
  // 1) 天候連続条件あり
  if (mob.weatherDuration?.minutes) {
    const requiredMinutes = Number(mob.weatherDuration.minutes);
    const requiredSec = requiredMinutes * 60;
    const requiredCycles = Math.ceil(requiredSec / WEATHER_CYCLE_SEC);

    const scanStartSec = alignToCycleBoundary(startSec);
    const limitSec = repopEndSec ?? (startSec + 14 * 24 * 3600);
    const minRepopSec = repopStartSec ?? startSec;

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
            const now = Date.now() / 1000;
            return {
              nextConditionSpawnDate: new Date(popSec * 1000),
              nextConditionSpawnDate2: null,
              currentConditionActive: (now >= consecutiveStartSec && now < popSec)
            };
          }
        }
      } else {
        consecutiveCycles = 0;
        consecutiveStartSec = null;
      }
    }
    return { nextConditionSpawnDate: null, nextConditionSpawnDate2: null, currentConditionActive: false };
  }

  // 2) 通常条件は ET hour 単位 (175秒刻み)
  const stepSec = 175;
  const t0 = alignToEorzeaHourBoundary(startSec);
  const limitSec = repopEndSec ?? (startSec + 14 * 24 * 3600);

  const results = [];
  for (let tSec = t0; tSec <= limitSec; tSec += stepSec) {
    const date = new Date(tSec * 1000);
    if (checkMobSpawnCondition(mob, date)) {
      results.push(date);
      if (results.length >= 2) break;
    }
  }

  const nowDate = new Date();
  const currentConditionActive = checkMobSpawnCondition(mob, nowDate);

  return {
    nextConditionSpawnDate: results[0] || null,
    nextConditionSpawnDate2: results[1] || null,
    currentConditionActive
  };
}

// --- repop計算 ---
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
  
  if (isNaN(serverUpDate.getTime()) || isNaN(startDate.getTime())) return baseResult("Unknown");

  const serverUp = serverUpDate.getTime() / 1000;
  const maintenanceStart = startDate.getTime() / 1000;

  let minRepop = 0, maxRepop = 0;
  let elapsedPercent = 0;
  let timeRemaining = "Unknown";
  let status = "Unknown";
  let isMaintenanceStop = false;
  let currentConditionActive = false;

  if (lastKill === 0 || lastKill < serverUp) {
    minRepop = serverUp + (repopSec * 0.6);
    maxRepop = serverUp + (maxSec * 0.6);

    if (now >= maxRepop) {
      status = "MaxOver"; elapsedPercent = 100; timeRemaining = `Time Over (100%)`;
    } else if (now < minRepop) {
      status = "Maintenance"; timeRemaining = `Next: ${formatDurationHM(minRepop - now)}`;
    } else {
      status = "PopWindow";
      elapsedPercent = Math.min(((now - minRepop) / (maxRepop - minRepop)) * 100, 100);
      timeRemaining = `残り ${formatDurationHM(maxRepop - now)} (${elapsedPercent.toFixed(0)}%)`;
    }
  } else if (now < lastKill + repopSec) {
    minRepop = lastKill + repopSec;
    maxRepop = lastKill + maxSec;
    status = "Next"; timeRemaining = `Next: ${formatDurationHM(minRepop - now)}`;
  } else if (now < lastKill + maxSec) {
    minRepop = lastKill + repopSec;
    maxRepop = lastKill + maxSec;
    status = "PopWindow";
    elapsedPercent = Math.min(((now - minRepop) / (maxRepop - minRepop)) * 100, 100);
    timeRemaining = `残り ${formatDurationHM(maxRepop - now)} (${elapsedPercent.toFixed(0)}%)`;
  } else {
    minRepop = lastKill + repopSec;
    maxRepop = lastKill + maxSec;
    status = "MaxOver"; elapsedPercent = 100; timeRemaining = `Time Over (100%)`;
  }

  const nextMinRepopDate = new Date(minRepop * 1000);
  // --- 条件探索 ---
  let nextConditionSpawnDate = null;
  let nextConditionSpawnDate2 = null;
  const hasCondition = !!mob.moonPhase || !!mob.timeRange || !!mob.timeRanges || !!mob.weatherSeedRange || !!mob.weatherSeedRanges;

  if (hasCondition) {
    const nowDate = new Date(now * 1000);

    if (checkMobSpawnCondition(mob, nowDate)) {
      currentConditionActive = true;
    } else {
      const baseSecForConditionSearch = Math.max(minRepop, now, serverUp);
      const { nextConditionSpawnDate: first, nextConditionSpawnDate2: second, currentConditionActive: active } =
        findNextSpawnTime(mob, new Date(baseSecForConditionSearch * 1000));
      nextConditionSpawnDate = first;
      nextConditionSpawnDate2 = second;
      currentConditionActive = active;
    }
  }
  // --- メンテナンス停止判定 ---
  const minRepopAfterMaintenanceStart = minRepop > maintenanceStart;
  const conditionAfterMaintenanceStart = nextConditionSpawnDate 
    ? (nextConditionSpawnDate.getTime() / 1000) > maintenanceStart
    : false;
  isMaintenanceStop = minRepopAfterMaintenanceStart || conditionAfterMaintenanceStart;

  return {
    minRepop,
    maxRepop,
    elapsedPercent,
    timeRemaining,
    status,
    nextMinRepopDate,
    nextConditionSpawnDate,
    nextConditionSpawnDate2,
    isMaintenanceStop,
    currentConditionActive
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
      nextConditionSpawnDate2: null,
      isMaintenanceStop: false,
      currentConditionActive: false
    };
  }
}

function formatLastKillTime(timestamp) {
  if (timestamp === 0) return "未報告";
  // 秒を切り捨てて分単位に揃える
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

export {
  calculateRepop, checkMobSpawnCondition, findNextSpawnTime, getEorzeaTime, getEorzeaMoonPhase, formatDuration,
  getEorzeaWeatherSeed, getEorzeaWeather, getMoonPhaseLabel, formatDurationHM, debounce, formatLastKillTime
};
