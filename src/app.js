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

// エオルゼア時間 (Eorzea Time)
function getEorzeaTime(date = new Date()) {
  const unixSeconds = Math.floor(date.getTime() / 1000);
  // 1 ET秒 = 20.571428571 リアル秒
  const eorzeaTotalSeconds = Math.floor(unixSeconds * 20.571428571);
  const eorzeaDaySeconds = eorzeaTotalSeconds % 86400; // 1日 = 86400秒
  const hours = Math.floor(eorzeaDaySeconds / 3600);
  const minutes = Math.floor((eorzeaDaySeconds % 3600) / 60);
  return { hours, minutes };
}

// 月齢 (Moon Phase)
function getEorzeaMoonPhase(date = new Date()) {
  const unixSeconds = Math.floor(date.getTime() / 1000);
  const eorzeaDays = Math.floor(unixSeconds * 20.571428571 / 86400);
  const phase = eorzeaDays % 32; // 0=新月, 16=満月
  return phase;
}

// 天候シード計算
function getEorzeaWeatherSeed(date = new Date()) {
  const unixSeconds = Math.floor(date.getTime() / 1000);
  const bell = Math.floor(unixSeconds / 175) % 24; // ETの時刻
  const increment = (Math.floor(unixSeconds / 175 / 24) * 100) + bell;
  const step1 = (increment << 11) ^ increment;
  const step2 = (step1 >>> 8) ^ step1;
  return step2 % 100; // 0〜99 の値
}

// 天候決定（エリアごとのテーブルを渡す）
function getEorzeaWeather(date = new Date(), weatherTable) {
  const seed = getEorzeaWeatherSeed(date);
  let cumulative = 0;
  for (const entry of weatherTable) {
    cumulative += entry.rate;
    if (seed < cumulative) return entry.weather;
  }
  return "Unknown";
}

/**
 * モブの出現条件を判定する（天候シード専用）
 * @param {Object} mob - JSONで定義されたモブ
 * @param {Date} date - 判定対象のリアル時間
 * @returns {Boolean} 条件を満たしているか
 */
function checkMobSpawnCondition(mob, date) {
  const et = getEorzeaTime(date);          // { hours, minutes }
  const moon = getEorzeaMoonPhase(date);   // 0〜31 の数値
  const seed = getEorzeaWeatherSeed(date); // 0〜99

  if (mob.moonPhase) {
    const phases = Array.isArray(mob.moonPhase) ? mob.moonPhase : [mob.moonPhase];
    // 要素を数値に変換してから比較を行う
    const numericPhases = phases.map(p => Number(p));
    if (!numericPhases.includes(moon)) return false;
  }

  // 天候シード範囲（単一）
  if (mob.weatherSeedRange) {
    const [min, max] = mob.weatherSeedRange;
    if (seed < min || seed > max) return false;
  }

  // 複数天候シード範囲（Fog または Rain など）
  if (mob.weatherSeedRanges) {
    const ok = mob.weatherSeedRanges.some(([min, max]) => seed >= min && seed <= max);
    if (!ok) return false;
  }

  // 時間帯条件
  if (mob.timeRange) {
    const { start, end } = mob.timeRange;
    const h = et.hours;
    if (start < end) {
      if (h < start || h >= end) return false;
    } else {
      // 跨ぎ (例: 17〜3)
      if (h < start && h >= end) return false;
    }
  }

  // 複数時間帯条件
  if (mob.timeRanges) {
    const h = et.hours;
    const ok = mob.timeRanges.some(({ start, end }) => {
      if (start < end) return h >= start && h < end;
      return h >= start || h < end; // 跨ぎ
    });
    if (!ok) return false;
  }

  return true;
}

/**
 * 次回条件成立時刻を探索する（天候シード専用）
 * @param {Object} mob - JSONで定義されたモブ
 * @param {Date} now - 基準時刻
 * @returns {Date|null} 条件が揃うリアル時間
 */
function findNextSpawnTime(mob, now = new Date()) {
  let date = new Date(now.getTime());
  const limit = now.getTime() + 7 * 24 * 60 * 60 * 1000; // 最大7日先まで探索

  while (date.getTime() < limit) {
    if (checkMobSpawnCondition(mob, date)) {
      return date;
    }
    // 効率化: 天候が変わるタイミングごとに進める（23分20秒 = 1400秒）
    date = new Date(date.getTime() + 1400 * 1000);
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
    // 初回未討伐
    minRepop = now + repopSec;
    maxRepop = now + maxSec;
    timeRemaining = `Next: ${formatDuration(minRepop - now)}`;
    status = "Next";
  } else if (now < minRepop) {
    // リポップ待ち中
    timeRemaining = `Next: ${formatDuration(minRepop - now)}`;
    status = "Next";
  } else if (now >= minRepop && now < maxRepop) {
    // ポップウィンドウ中
    elapsedPercent = ((now - minRepop) / (maxRepop - minRepop)) * 100;
    elapsedPercent = Math.min(elapsedPercent, 100);
    timeRemaining = `${elapsedPercent.toFixed(0)}% (${formatDuration(maxRepop - now)})`;
    status = "PopWindow";
  } else {
    // 最大時間経過後
    elapsedPercent = 100;
    timeRemaining = `100% (+${formatDuration(now - maxRepop)})`;
    status = "MaxOver";
  }

  // 次回出現可能時刻（条件付きモブは findNextSpawnTime で補正）
  let nextMinRepopDate = null;
  
  // 条件付きモブ（moonPhase, timeRange, weather など）がある場合の補正
  if (mob.moonPhase || mob.timeRange || mob.weatherSeedRange || mob.weatherSeedRanges) {
    // 探索開始点を minRepop の時刻に固定する
    const searchStart = new Date(minRepop * 1000);
    nextMinRepopDate = findNextSpawnTime(mob, searchStart);
  } else if (minRepop > now) {
    // 条件がないモブで、まだリポップウィンドウに入っていない場合
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
        getEorzeaWeatherSeed, getEorzeaWeather, formatDuration, debounce, toJstAdjustedIsoString, formatLastKillTime };
