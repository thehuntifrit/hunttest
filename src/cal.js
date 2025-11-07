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

// 総合条件チェック
function checkMobSpawnCondition(mob, date) {
  const ts = Math.floor(date.getTime() / 1000);
  const moonInfo = getEorzeaMoonInfo(date); // { phase, label }
  const seed = getEorzeaWeatherSeed(date);

  // 月齢ラベル条件
  if (mob.moonPhase) {
    if (moonInfo.label !== mob.moonPhase) return false;
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

  // conditions を持つモブの時間帯評価
  if (mob.conditions) {
    let ok = false;
    const fn = mob.conditions.firstNight;
    const on = mob.conditions.otherNights;
    const phase = moonInfo.phase;
    if (fn && fn.timeRange && (phase >= 32.5 || phase <= 1.5)) {
      ok = ok || checkTimeRange(fn.timeRange, ts);
    }
    if (on && on.timeRange && phase > 1.5 && phase < 4.5) {
      ok = ok || checkTimeRange(on.timeRange, ts);
    }
    if (!ok) return false;
  }

  // conditions が無い場合のみ通常の timeRange / timeRanges を評価
  if (!mob.conditions && mob.timeRange) {
    if (!checkTimeRange(mob.timeRange, ts)) return false;
  }
  if (!mob.conditions && mob.timeRanges) {
    const ok = mob.timeRanges.some((tr) => checkTimeRange(tr, ts));
    if (!ok) return false;
  }

  return true;
}

// 天候サイクル境界へ丸め
function alignToCycleBoundary(tSec) {
  const r = tSec % WEATHER_CYCLE_SEC;
  return tSec - r; // 直前のサイクル境界
}

// ET時間境界（175秒刻み）へ丸め
function alignToEtHourBoundary(tSec) {
  const step = 175; // 1 ET 時間 = 175 秒
  return Math.floor(tSec / step) * step;
}

// 天候レンジ判定
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

// サイクル内の ET/月齢成立区間を算出（区間の配列を返す）
function getEtMoonRangesWithinCycle(mob, cycleStart, cycleEnd) {
  const etRanges = [];

  // 基本 ET時間帯
  if (!mob.conditions && mob.timeRange) {
    etRanges.push(normalizeEtRangeToReal(mob.timeRange, cycleStart, cycleEnd));
  }
  if (!mob.conditions && mob.timeRanges && mob.timeRanges.length) {
    for (const tr of mob.timeRanges) {
      etRanges.push(normalizeEtRangeToReal(tr, cycleStart, cycleEnd));
    }
  }
  // conditions: firstNight / otherNights の時間帯を月齢条件と併せて区間化
  if (mob.conditions) {
    const phaseAtStart = getEorzeaMoonInfo(new Date(cycleStart * 1000)).phase;
    // 初回夜（32.5〜1.5）
    const fn = mob.conditions.firstNight;
    if (fn && fn.timeRange && (phaseAtStart >= 32.5 || phaseAtStart <= 1.5)) {
      etRanges.push(normalizeEtRangeToReal(fn.timeRange, cycleStart, cycleEnd));
    }
    // 以降夜（1.5〜4.5）
    const on = mob.conditions.otherNights;
    if (on && on.timeRange && phaseAtStart > 1.5 && phaseAtStart < 4.5) {
      etRanges.push(normalizeEtRangeToReal(on.timeRange, cycleStart, cycleEnd));
    }
  }

  // ET指定が無い場合は「サイクル全体」
  if (etRanges.length === 0) etRanges.push([cycleStart, cycleEnd]);

  // 月齢ラベル（mob.moonPhase）がある場合は交差を取る
  let result = [];
  if (mob.moonPhase) {
    // サイクル内は月齢ラベルが変化しない前提なら、ラベル一致なら全区間維持
    const labelAtStart = getEorzeaMoonInfo(new Date(cycleStart * 1000)).label;
    if (labelAtStart === mob.moonPhase) {
      result = etRanges;
    } else {
      result = []; // ラベル不一致なら区間なし
    }
  } else {
    result = etRanges;
  }
  return result;
}

// ETレンジをリアル秒区間に変換
function normalizeEtRangeToReal(tr, cycleStart, cycleEnd) {
  const step = 175;
  const baseEt = alignToEtHourBoundary(cycleStart);
  const startSec = Math.max(cycleStart, baseEt + (tr.start * step));
  const endSec = Math.min(cycleEnd, baseEt + (tr.end * step));
  return [startSec, endSec];
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

// ET条件探索（175秒刻み）
function findNextEtSpawnTime(mob, baseSec, repopStartSec, repopEndSec) {
  const stepSec = 175;
  const t0 = alignToEtHourBoundary(baseSec);
  const limitSec = repopEndSec ?? (baseSec + 14 * 24 * 3600);
  const minRepopSec = repopStartSec ?? baseSec;

  for (let tSec = t0; tSec <= limitSec; tSec += stepSec) {
    if (tSec < minRepopSec) continue;

    let ranges = [];
    if (mob.timeRange) {
      ranges.push(normalizeEtRangeToReal(mob.timeRange, tSec, tSec + stepSec));
    }
    if (mob.timeRanges) {
      for (const tr of mob.timeRanges) {
        ranges.push(normalizeEtRangeToReal(tr, tSec, tSec + stepSec));
      }
    }

    for (const [winStart, winEnd] of ranges) {
      const candidateSec = Math.max(minRepopSec, tSec, winStart);
      if (candidateSec <= winEnd) {
        return new Date(candidateSec * 1000);
      }
    }
  }
  return null;
}

// 連続天候専用（既存のまま）
function findNextSpawnTime(mob, startDate, repopStartSec, repopEndSec) {
  const startSec = Math.floor(startDate.getTime() / 1000);

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
            return new Date(popSec * 1000);
          }
        }
      } else {
        consecutiveCycles = 0;
        consecutiveStartSec = null;
      }
    }
    return null;
  }

  return null;
}

// repop計算（単発天候を区間判定へ切替）
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
  const hasCondition = !!mob.moonPhase || !!mob.timeRange || !!mob.timeRanges || !!mob.weatherSeedRange || !!mob.weatherSeedRanges;

  if (hasCondition) {
    const baseSecForConditionSearch = Math.max(minRepop, now, serverUp);

    if (mob.weatherDuration?.minutes) {
      // 連続天候条件（従来通り）
      const requiredMinutes = mob.weatherDuration.minutes;
      const requiredCycles = Math.ceil((requiredMinutes * 60) / WEATHER_CYCLE_SEC);

      let baseSec = (lastKill === 0 || lastKill < serverUp)
        ? serverUp + (repopSec * 0.6)
        : lastKill + repopSec;

      if (now > baseSec || now > maxRepop) {
        baseSec = now;
      }

      let scanStartSec = baseSec - requiredCycles * WEATHER_CYCLE_SEC;
      if (scanStartSec < serverUp) scanStartSec = serverUp;
      scanStartSec = alignToCycleBoundary(scanStartSec);

      let consecutive = 0;
      let conditionStartSec = null;
      for (let tSec = scanStartSec; tSec < baseSec + 14 * 24 * 3600; tSec += WEATHER_CYCLE_SEC) {
        const date = new Date(tSec * 1000);
        const seed = getEorzeaWeatherSeed(date);
        const inRange =
          mob.weatherSeedRange
            ? (seed >= mob.weatherSeedRange[0] && seed <= mob.weatherSeedRange[1])
            : mob.weatherSeedRanges
              ? mob.weatherSeedRanges.some(([min, max]) => seed >= min && seed <= max)
              : false;

        if (inRange) {
          if (consecutive === 0) conditionStartSec = tSec;
          consecutive++;
          if (consecutive >= requiredCycles) {
            const popSec = conditionStartSec + requiredMinutes * 60;
            if (popSec >= minRepop) {
              nextConditionSpawnDate = new Date(popSec * 1000);
              break;
            }
          }
        } else {
          consecutive = 0;
          conditionStartSec = null;
        }
      }
    } else {
      // 単発天候：サイクルごとの区間判定へ切替
      if (mob.weatherSeedRange || mob.weatherSeedRanges) {
        const cycleBase = alignToCycleBoundary(baseSecForConditionSearch);
        const shiftedStartSec = cycleBase - WEATHER_CYCLE_SEC; // -1400秒で直前サイクルから含める
        const limitSec = baseSecForConditionSearch + 14 * 24 * 3600;

        for (let cycleStart = shiftedStartSec; cycleStart <= limitSec; cycleStart += WEATHER_CYCLE_SEC) {
          const cycleEnd = cycleStart + WEATHER_CYCLE_SEC;
          const seed = getEorzeaWeatherSeed(new Date(cycleStart * 1000));
          if (!checkWeatherInRange(mob, seed)) continue;

          const ranges = getEtMoonRangesWithinCycle(mob, cycleStart, cycleEnd);
          for (const [winStart, winEnd] of ranges) {
            const candidateSec = Math.max(minRepop, now, winStart);
            if (candidateSec <= winEnd) {
              nextConditionSpawnDate = new Date(candidateSec * 1000);
              cycleStart = limitSec + 1; // 外側ループ終了
              break;
            }
          }
        }
      } else {
        // ET/月齢のみ（従来通り：ET境界に丸めた上で 175秒刻みの点検はあなたの既存ロジックに準拠）
        // ここでは最短/現在との整合だけ確保
        const baseEt = alignToEtHourBoundary(baseSecForConditionSearch);
        const limitSec = baseSecForConditionSearch + 14 * 24 * 3600;
        for (let tSec = baseEt; tSec <= limitSec; tSec += 175) {
          if (tSec < minRepop) continue;
          const d = new Date(tSec * 1000);
          if (checkMobSpawnCondition(mob, d)) {
            nextConditionSpawnDate = d;
            break;
          }
        }
      }
    }
  }

  // --- メンテナンス停止判定ロジック ---
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
