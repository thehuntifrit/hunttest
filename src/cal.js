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

function getEorzeaMoonInfo(date = new Date()) {
  const unixSeconds = date.getTime() / 1000;
  const EORZEA_SPEED_RATIO = 20.57142857142857;
  const eorzeaTotalDays = (unixSeconds * EORZEA_SPEED_RATIO) / 86400;
  // 月齢（1〜33相当）
  const phase = (eorzeaTotalDays % 32) + 1;
  // ラベル判定
  let label = null;
  if (phase >= 32.5 || phase < 4.5) {
    label = "新月";
  } else if (phase >= 16.5 && phase < 20.5) {
    label = "満月";
  }

  return { phase, label };
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

// ET分以下を切り捨てる関数
function floorToEtHour(date) {
  const unixMs = date.getTime();
  const REAL_MS_PER_ET_HOUR = 175 * 1000;
  const REAL_MS_PER_ET_MINUTE = REAL_MS_PER_ET_HOUR / 60;

  const totalEtMinutes = Math.floor(unixMs / REAL_MS_PER_ET_MINUTE);
  const flooredEtMinutes = Math.floor(totalEtMinutes / 60) * 60;
  const flooredUnixMs = flooredEtMinutes * REAL_MS_PER_ET_MINUTE;
  return new Date(flooredUnixMs);
}

// 総合条件チェック
function checkMobSpawnCondition(mob, date) {
  const ts = Math.floor(date.getTime() / 1000);
  const et = getEorzeaTime(date);
  const moonInfo = getEorzeaMoonInfo(date);
  const seed = getEorzeaWeatherSeed(date);

  // 月齢条件
  if (mob.moonPhase && moonInfo.label !== mob.moonPhase) return false;

  if (mob.conditions) {
    let ok = false;
    const fn = mob.conditions.firstNight;
    const on = mob.conditions.otherNights;
    if (fn && fn.timeRange && (moonInfo.phase >= 32.5 || moonInfo.phase <= 1.5)) {
      ok = ok || checkTimeRange(fn.timeRange, ts);
    }
    if (on && on.timeRange && moonInfo.phase > 1.5 && moonInfo.phase < 4.5) {
      ok = ok || checkTimeRange(on.timeRange, ts);
    }
    if (!ok) return false;
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

  // ET条件
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

function findNextSpawnTime(mob, startDate, repopStartSec, repopEndSec) {
  const startSec = Math.floor(startDate.getTime() / 1000);
  const limitSec = repopEndSec ?? (startSec + 14 * 24 * 3600);
  const minRepopSec = repopStartSec ?? startSec;

  // --- 天候条件あり ---
  if (mob.weatherSeedRange || mob.weatherSeedRanges || mob.weatherDuration) {
    const candidates = [];
    let consecutive = 0;
    let startConsec = null;
    const scanStartSec = alignToCycleBoundary(startSec);

    for (let tSec = scanStartSec; tSec <= limitSec; tSec += WEATHER_CYCLE_SEC) {
      const date = new Date(tSec * 1000);
      const moonInfo = getEorzeaMoonInfo(date);
      if (mob.moonPhase && moonInfo.label !== mob.moonPhase) {
        consecutive = 0; startConsec = null; continue;
      }

      const seed = getEorzeaWeatherSeed(date);
      if (!checkWeatherInRange(mob, seed)) {
        consecutive = 0; startConsec = null; continue;
      }

      if (mob.weatherDuration?.minutes) {
        if (consecutive === 0) startConsec = tSec;
        consecutive++;
        const requiredSec = mob.weatherDuration.minutes * 60;
        const requiredCycles = Math.ceil(requiredSec / WEATHER_CYCLE_SEC);
        if (consecutive >= requiredCycles) {
          const popSec = startConsec + requiredSec;
          if (popSec >= minRepopSec) {
            // 複合条件再評価: popSec の直前 ET 境界で確認
            const etCheckDate = floorToEtHour(new Date(popSec * 1000));
            if (checkMobSpawnCondition(mob, etCheckDate)) {
              candidates.push({
                start: new Date(startConsec * 1000),
                end: new Date(popSec * 1000),
                durationMinutes: mob.weatherDuration.minutes
              });
              if (candidates.length >= 20) break;
            }
          }
        }
      } else {
        // 単発天候
        if (checkMobSpawnCondition(mob, date) && date.getTime()/1000 >= minRepopSec) {
          candidates.push({
            start: date,
            end: new Date(date.getTime() + WEATHER_CYCLE_SEC * 1000),
            durationMinutes: WEATHER_CYCLE_SEC / 60
          });
          if (candidates.length >= 20) break;
        }
      }
    }
    return candidates;
  }

  // --- ET条件のみ ---
  if (mob.timeRange || mob.timeRanges) {
    const candidates = [];
    let etDate = floorToEtHour(startDate);
    while (etDate.getTime() / 1000 <= limitSec && candidates.length < 2) {
      if (checkMobSpawnCondition(mob, etDate) && etDate.getTime()/1000 >= minRepopSec) {
        const et = getEorzeaTime(etDate);
        candidates.push({
          time: etDate,
          etHour: `${et.hours}:00`
        });
      }
      etDate = new Date(etDate.getTime() + 175 * 1000);
    }
    return candidates;
  }

  return [];
}

// repop計算
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

  // --- 状態判定 ---
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
  let conditionCandidates = [];
  const hasCondition = !!mob.moonPhase || !!mob.timeRange || !!mob.timeRanges ||
                       !!mob.weatherSeedRange || !!mob.weatherSeedRanges || !!mob.weatherDuration;

  if (hasCondition) {
    // 開始点を必ず境界に揃える
    const baseSec = Math.max(minRepop, now, serverUp);
    const startDate = new Date(baseSec * 1000);

    // findNextSpawnTime は候補リストを返す
    const candidates = findNextSpawnTime(mob, startDate, minRepop, baseSec + 14 * 24 * 3600);
    if (Array.isArray(candidates) && candidates.length > 0) {
      conditionCandidates = candidates;
      const first = candidates[0];
      nextConditionSpawnDate = first.start ?? first.time ?? null;
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
    conditionCandidates,
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
      conditionCandidates: [],
      isMaintenanceStop: false
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

export { calculateRepop, checkMobSpawnCondition, findNextSpawnTime, getEorzeaTime,  formatDuration, formatDurationHM, debounce, formatLastKillTime };
