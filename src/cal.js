// cal.js
import { formatDuration, getEorzeaTime, getEorzeaMoonPhase, getEorzeaWeather } from "./utils.js";

/**
 * モブの出現条件を判定する
 * @param {Object} mob - JSONで定義されたモブ情報
 * @param {Date} date - 判定対象のリアル時間
 * @param {Array} weatherTable - エリアごとの天候テーブル
 * @param {Function} getPrevWeather - 前の天候を返す関数
 * @param {Function} checkWeatherDuration - 特定天候が継続しているかを判定する関数
 * @returns {Boolean} 条件を満たしているか
 */
function checkMobSpawnCondition(mob, date, weatherTable, getPrevWeather, checkWeatherDuration) {
  const et = getEorzeaTime(date);          // { hours, minutes }
  const moon = getEorzeaMoonPhase(date);   // "new" / "full" / 数値など
  const weather = getEorzeaWeather(date, weatherTable);

  // 月齢条件
  if (mob.moonPhase && mob.moonPhase !== moon) return false;

  // 天候条件
  if (mob.weather && !mob.weather.includes(weather)) return false;
  if (mob.weatherNot && mob.weatherNot.includes(weather)) return false;

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

  // 複数時間帯
  if (mob.timeRanges) {
    const h = et.hours;
    const ok = mob.timeRanges.some(({ start, end }) => {
      if (start < end) return h >= start && h < end;
      return h >= start || h < end; // 跨ぎ
    });
    if (!ok) return false;
  }

  // 天候継続時間条件
  if (mob.weatherDuration) {
    if (!checkWeatherDuration(mob.weather, mob.weatherDuration.minutes, date, weatherTable)) {
      return false;
    }
  }

  // 天候遷移条件
  if (mob.weatherTransition) {
    const prevWeather = getPrevWeather(date, weatherTable);
    if (prevWeather !== mob.weatherTransition.previous || weather !== mob.weatherTransition.current) {
      return false;
    }
  }

  return true;
}

/**
 * 次回条件成立時刻を探索する
 * @param {Object} mob - JSONで定義されたモブ
 * @param {Array} weatherTable - エリアごとの天候テーブル
 * @param {Date} now - 基準時刻
 * @returns {Date|null} 条件が揃うリアル時間
 */
function findNextSpawnTime(mob, weatherTable, now = new Date()) {
  let date = new Date(now.getTime());
  const limit = now.getTime() + 7 * 24 * 60 * 60 * 1000; // 最大7日先まで探索

  while (date.getTime() < limit) {
    if (checkMobSpawnCondition(mob, date, weatherTable, getPrevWeather, checkWeatherDuration)) {
      return date;
    }
    // 効率化: 天候が変わるタイミングごとに進める（23分20秒 = 1400秒）
    date = new Date(date.getTime() + 1400 * 1000);
  }

  return null;
}

// 前の天候を取得
function getPrevWeather(date, weatherTable) {
  const prev = new Date(date.getTime() - 1400 * 1000);
  return getEorzeaWeather(prev, weatherTable);
}

// 特定天候が一定時間続いているかを判定
function checkWeatherDuration(weathers, minutes, date, weatherTable) {
  const target = new Date(date.getTime() - minutes * 60 * 1000);
  const currentWeather = getEorzeaWeather(date, weatherTable);
  const pastWeather = getEorzeaWeather(target, weatherTable);
  return weathers.includes(currentWeather) && currentWeather === pastWeather;
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
    timeRemaining = `${elapsedPercent.toFixed(0)}% (${formatDuration(maxRepop - now)} Left)`;
    status = "PopWindow";
  } else {
    elapsedPercent = 100;
    timeRemaining = `POP済み (+${formatDuration(now - maxRepop)} over)`;
    status = "MaxOver";
  }

  const nextMinRepopDate = minRepop > now ? new Date(minRepop * 1000) : null;
  return { minRepop, maxRepop, elapsedPercent, timeRemaining, status, nextMinRepopDate };
}

export { calculateRepop, checkMobSpawnCondition, findNextSpawnTime };
