// cal.js

// formatDuration
function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h.toString().padStart(2, "0")}h ${m.toString().padStart(2, "0")}m`;
}

// debounce
function debounce(func, wait) {
  let timeout;
  return function executed(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

function toJstAdjustedIsoString(date) {
  const offsetMs = date.getTimezoneOffset() * 60000;
  const jstOffsetMs = 9 * 60 * 60 * 1000;
  const jstTime = date.getTime() - offsetMs + jstOffsetMs;
  return new Date(jstTime).toISOString().slice(0, 16);
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
  // 小数位相を 1.00〜33.00 の範囲で返す
  return (eorzeaTotalDays % 32) + 1;
}

/**
 * 月齢値に基づいてフェーズ名を取得
 */
function getMoonPhaseLabel(phase) {
  if (phase >= 32.5 || phase < 4.5) return "新月";
  if (phase >= 16.5 && phase < 20.5) return "満月";
  return null; // その他のフェーズ
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

function checkMobSpawnCondition(mob, date) {
  const et = getEorzeaTime(date);
  const moon = getEorzeaMoonPhase(date);
  const seed = getEorzeaWeatherSeed(date);

  if (mob.moonPhase) {
    // mob.moonPhaseが文字列（例："満月"）の場合のみを想定
    const currentLabel = getMoonPhaseLabel(moon);
    if (currentLabel !== mob.moonPhase) return false;
  }

  if (mob.weatherSeedRange) {
    const [min, max] = mob.weatherSeedRange;
    if (seed < min || seed > max) return false;
  }

  if (mob.weatherSeedRanges) {
    const ok = mob.weatherSeedRanges.some(([min, max]) => seed >= min && seed <= max);
    if (!ok) return false;
  }

  if (mob.timeRange) {
    const { start, end } = mob.timeRange;
    const h = Number(et.hours); 

    if (start < end) {
      if (h < start || h >= end) return false;
    } else {
      if (h < start && h >= end) return false;
    }
  }

  if (mob.timeRanges) {
    const h = Number(et.hours);
    const ok = mob.timeRanges.some(({ start, end }) => {
      if (start < end) return h >= start && h < end;
      return h >= start || h < end;
    });
    if (!ok) return false;
  }

  return true;
}

function findNextSpawnTime(mob, now = new Date()) {
  let date = new Date(now.getTime());
  const limit = now.getTime() + 7 * 24 * 60 * 60 * 1000;

  // 月齢条件の精度を上げるため、探索ステップをリアル1分（60秒）刻みに変更
  const REAL_SECONDS_STEP = 60; 

  while (date.getTime() < limit) {
    if (checkMobSpawnCondition(mob, date)) {
      return date;
    }
    date = new Date(date.getTime() + REAL_SECONDS_STEP * 1000);
  }

  return null;
}

function calculateRepop(mob) {
  const now = Date.now() / 1000;
  const lastKill = mob.last_kill_time || 0;
  const repopSec = mob.REPOP_s;
  const maxSec = mob.MAX_s;

  let minRepop = lastKill + repopSec;
  let maxRepop = lastKill + maxSec;
  let elapsedPercent = 0;
  let timeRemaining = "Unknown";
  let status = "Unknown";

  if (lastKill === 0) {
    minRepop = now + repopSec;
    maxRepop = now + maxSec;
    timeRemaining = `Next: ${formatDuration(minRepop - now)}`;
    status = "Next";
  } else if (now < minRepop) {
    timeRemaining = `Next: ${formatDuration(minRepop - now)}`;
    status = "Next";
  } else if (now >= minRepop && now < maxRepop) {
    elapsedPercent = ((now - minRepop) / (maxRepop - minRepop)) * 100;
    elapsedPercent = Math.min(elapsedPercent, 100);
    timeRemaining = `${elapsedPercent.toFixed(0)}% (${formatDuration(maxRepop - now)})`;
    status = "PopWindow";
  } else {
    elapsedPercent = 100;
    timeRemaining = `100% (+${formatDuration(now - maxRepop)})`;
    status = "MaxOver";
  }

  let nextMinRepopDate = null;
  
  if (mob.moonPhase || mob.timeRange || mob.weatherSeedRange || mob.weatherSeedRanges) {
    const searchStart = new Date(minRepop * 1000);
    nextMinRepopDate = findNextSpawnTime(mob, searchStart);
  } else if (minRepop > now) {
    nextMinRepopDate = new Date(minRepop * 1000);
  }

  return {
    minRepop,
    maxRepop,
    elapsedPercent,
    timeRemaining,
    status,
    nextMinRepopDate
  };
}

function formatLastKillTime(timestamp) {
  if (timestamp === 0) return "未報告";
  const killTimeMs = timestamp * 1000;
  const nowMs = Date.now();
  const diffSeconds = Math.floor((nowMs - killTimeMs) / 1000);
  if (diffSeconds < 3600) {
    if (diffSeconds < 60) return `Just now`;
    const minutes = Math.floor(diffSeconds / 60);
    return `${minutes}m ago`;
  }
  const options = { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" };
  const date = new Date(killTimeMs);
  return new Intl.DateTimeFormat("ja-JP", options).format(date);
}

export { calculateRepop, checkMobSpawnCondition, findNextSpawnTime, getEorzeaTime, getEorzeaMoonPhase, 
         getEorzeaWeatherSeed, getEorzeaWeather, getMoonPhaseLabel, formatDuration, debounce, toJstAdjustedIsoString, formatLastKillTime };
