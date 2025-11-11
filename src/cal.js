// cal.js - 区間モデル + 175秒/1400秒グリッド探索 + 終了時刻返却 + 後方互換ユーティリティ

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
// フェーズは 1〜32 の連続値（小数含む）
function getEorzeaMoonInfo(date = new Date()) {
  const unixSeconds = date.getTime() / 1000;
  const EORZEA_SPEED_RATIO = 20.57142857142857;
  const eorzeaTotalDays = (unixSeconds * EORZEA_SPEED_RATIO) / 86400;
  const phase = (eorzeaTotalDays % 32) + 1; // 1〜32

  let label = null;
  if (phase >= 32.5 || phase < 4.5) label = "新月";
  else if (phase >= 16.5 && phase < 20.5) label = "満月";

  return { phase, label };
}

// 近傍判定用（ETグリッドで±0.6日 ≒ ±14.4ET時間程度の緩め判定）
function isNearPhase(phase, target) {
  const diff = Math.abs(((phase - target + 32) % 32));
  return diff < 0.6 || diff > 31.4;
}

// 新月開始（phase ~32 近傍）をETグリッドで探索
function findNextNewMoonStart(startSec) {
  let t = alignToEtHour(startSec);
  const limit = startSec + MOON_CYCLE_SEC * 2;
  while (t < limit) {
    const { phase } = getEorzeaMoonInfo(new Date(t * 1000));
    if (isNearPhase(phase, 32)) return t;
    t += ET_HOUR_SEC;
  }
  return null;
}

// 満月開始（phase ~16 近傍）をETグリッドで探索
function findNextFullMoonStart(startSec) {
  let t = alignToEtHour(startSec);
  const limit = startSec + MOON_CYCLE_SEC * 2;
  while (t < limit) {
    const { phase } = getEorzeaMoonInfo(new Date(t * 1000));
    if (isNearPhase(phase, 16)) return t;
    t += ET_HOUR_SEC;
  }
  return null;
}

// 月齢区間列挙（開始→4ET日）
function enumerateMoonRanges(startSec, endSec, moonPhase) {
  if (!moonPhase) return [[startSec, endSec]];
  const ranges = [];
  let moonStart = null;

  if (moonPhase === "新月") moonStart = findNextNewMoonStart(startSec);
  else if (moonPhase === "満月") moonStart = findNextFullMoonStart(startSec);
  else return [[startSec, endSec]];

  while (moonStart && moonStart < endSec) {
    const moonEnd = moonStart + MOON_PHASE_DURATION_SEC; // 4 ET日
    ranges.push([Math.max(moonStart, startSec), Math.min(moonEnd, endSec)]);
    moonStart += MOON_CYCLE_SEC; // 次の同フェーズ
  }
  return ranges;
}
// 夜フェーズ判定（phase は 1〜32 小数）
function isFirstNightPhase(phase) {
  return phase >= 32.5 || phase < 1.5; // 32日12:00〜1日12:00
}
function isOtherNightsPhase(phase) {
  return phase >= 1.5 && phase < 4.5; // 1日12:00〜4日12:00
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

  if (start < end) return etHour >= start && etHour < end;
  return etHour >= start || etHour < end; // 日跨ぎ
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
  let ranges = [];

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
      if (startEtHour >= start || startEtHour < end) {
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

// ===== 連続天候探索（置き換え） =====
function findConsecutiveWeather(mob, pointSec, minRepopSec, limitSec) {
  const requiredMinutes = mob.weatherDuration?.minutes || 0;
  const requiredSec = requiredMinutes * 60;
  const scanStart = alignToWeatherCycle(pointSec - requiredSec);

  let hitStart = null;

  // 巻き戻し探索：条件が継続していたかを確認
  let backCursor = scanStart;
  let accumulatedBack = 0;
  while (accumulatedBack < requiredSec) {
    const seed = getEorzeaWeatherSeed(new Date(backCursor * 1000));
    if (!checkWeatherInRange(mob, seed)) {
      break;
    }
    hitStart = backCursor;
    backCursor -= WEATHER_CYCLE_SEC;
    accumulatedBack += WEATHER_CYCLE_SEC;
  }
  // 条件が継続していた場合、探索点が条件達成開始点
  if (hitStart && pointSec >= hitStart && pointSec < hitStart + requiredSec) {
    const windowStart = hitStart;
    const windowEnd = windowStart + requiredSec;
    const remainingSec = windowEnd - pointSec;
    return { windowStart, windowEnd, popTime: pointSec, remainingSec };
  }
  // 前方探索：条件が成立する次の開始点を探す
let forwardCursor = alignToWeatherCycle(Math.max(minRepopSec, pointSec));
while (forwardCursor <= limitSec) {
  let accumulated = 0;
  let testCursor = forwardCursor;

  while (accumulated < requiredSec) {
    const seed = getEorzeaWeatherSeed(new Date(testCursor * 1000));
    if (!checkWeatherInRange(mob, seed)) break;
    accumulated += WEATHER_CYCLE_SEC;
    testCursor += WEATHER_CYCLE_SEC;
  }

  if (accumulated >= requiredSec) {
    const windowStart = forwardCursor;
    const windowEnd = windowStart + accumulated;

    if (pointSec >= windowStart && pointSec < windowEnd) {
      const remainingSec = windowEnd - pointSec;
      return { windowStart, windowEnd, popTime: pointSec, remainingSec };
    }
    // 探索点を含まない場合は次の候補を探す
  }

  forwardCursor += WEATHER_CYCLE_SEC;
  }

  return null;
}

// ===== 複合条件探索（置き換え） =====
function findNextConditionWindow(mob, pointSec, minRepopSec, limitSec) {
  const requiredSec = WEATHER_CYCLE_SEC;
  const scanStart = alignToWeatherCycle(pointSec - requiredSec);

  const moonRanges = enumerateMoonRanges(scanStart, limitSec, mob.moonPhase);

  for (const [moonStart, moonEnd] of moonRanges) {
    let weatherCursor = alignToWeatherCycle(Math.max(moonStart, scanStart));
    while (weatherCursor < moonEnd) {
      const seed = getEorzeaWeatherSeed(new Date(weatherCursor * 1000));
      if (!checkWeatherInRange(mob, seed)) {
        weatherCursor += WEATHER_CYCLE_SEC;
        continue;
      }

      const weatherEnd = Math.min(weatherCursor + WEATHER_CYCLE_SEC, moonEnd);
      const intersectStart = Math.max(weatherCursor, moonStart);
      const intersectEnd = Math.min(weatherEnd, moonEnd);
      if (intersectStart >= intersectEnd) {
        weatherCursor += WEATHER_CYCLE_SEC;
        continue;
      }

      let etCursor = ceilToEtHour(Math.max(intersectStart, minRepopSec));
      while (etCursor < intersectEnd) {
        if (checkEtCondition(mob, etCursor)) {
          const etEnd = Math.min(getEtWindowEnd(mob, etCursor), intersectEnd);
          // ✅ 探索点がこの区間に含まれているかを先に判定
          if (pointSec >= etCursor && pointSec < etEnd) {
            let windowStart = etCursor;
            let windowEnd = etEnd;
            // ✅ 継続探索（最大19回）
            let count = 1;
            let nextEt = alignToWeatherCycle(etEnd);

            while (count < 19 && nextEt + ET_HOUR_SEC <= moonEnd) {
              const nextSeed = getEorzeaWeatherSeed(new Date(nextEt * 1000));
              if (!checkWeatherInRange(mob, nextSeed)) break;

              const nextEtStart = ceilToEtHour(nextEt);
              if (!checkEtCondition(mob, nextEtStart)) break;

              const nextEtEnd = getEtWindowEnd(mob, nextEtStart);
              windowEnd = Math.min(nextEtEnd, moonEnd);
              nextEt = alignToWeatherCycle(nextEtEnd);
              count++;
            }

            const remainingSec = windowEnd - pointSec;
            return { windowStart, windowEnd, popTime: pointSec, remainingSec };
          }
        }

        etCursor += ET_HOUR_SEC;
      }

      weatherCursor += WEATHER_CYCLE_SEC;
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

  let maint = maintenance;
  if (maint && typeof maint === "object" && "maintenance" in maint && maint.maintenance) {
    maint = maint.maintenance;
  }
  if (!maint || !maint.serverUp || !maint.start) return baseResult("Unknown");

  const serverUp = new Date(maint.serverUp).getTime() / 1000;       // サーバー再始動（メンテ終了）
  const maintenanceStart = new Date(maint.start).getTime() / 1000;  // メンテ開始

  let minRepop, maxRepop;

  if (lastKill === 0 || lastKill <= serverUp) {
    // メンテ前に倒されたモブ、またはメンテ直後初回 → 0.6倍補正
    minRepop = serverUp + repopSec * 0.6;
    maxRepop = serverUp + maxSec * 0.6;
  } else {
    // メンテ後通常討伐 → 通常計算
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

  const hasCondition = !!(
    mob.moonPhase ||
    mob.timeRange ||
    mob.timeRanges ||
    mob.weatherSeedRange ||
    mob.weatherSeedRanges ||
    mob.conditions
  );

  let conditionResult = null;
  if (hasCondition) {
    const searchLimit = pointSec + 14 * 24 * 3600;

    if (mob.weatherDuration?.minutes) {
      conditionResult = findConsecutiveWeather(mob, pointSec, minRepop, searchLimit);
    } else {
      conditionResult = findNextConditionWindow(mob, pointSec, minRepop, searchLimit);
    }

    if (conditionResult) {
      nextConditionSpawnDate = new Date(conditionResult.popTime * 1000);
      conditionWindowEnd = new Date(conditionResult.windowEnd * 1000);
      isInConditionWindow = conditionResult.remainingSec > 0;

      if (isInConditionWindow) {
        timeRemaining = `残り ${formatDurationHM(conditionResult.remainingSec)}`;
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

// ===== 後方互換：点判定関数 =====
function checkMobSpawnCondition(mob, date) {
  const pointSec = Math.floor(date.getTime() / 1000);
  // 月齢条件
  if (mob.moonPhase) {
    const moonInfo = getEorzeaMoonInfo(date);
    if (moonInfo.label !== mob.moonPhase) return false;
  }
  // 天候条件
  if (mob.weatherSeedRange || mob.weatherSeedRanges) {
    const seed = getEorzeaWeatherSeed(date);
    if (!checkWeatherInRange(mob, seed)) return false;
  }
  // ET時間帯条件
  if (!checkEtCondition(mob, pointSec)) return false;
  // すべての条件を満たしている
  return true;
}

// ===== 後方互換：次スポーン時刻 =====
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

  let conditionResult = null;
  if (mob.weatherDuration?.minutes) {
    conditionResult = findConsecutiveWeather(mob, pointSec, minRepopSec, limitSec);
  } else {
    conditionResult = findNextConditionWindow(mob, pointSec, minRepopSec, limitSec);
  }

  if (conditionResult) {
    const { windowStart, windowEnd } = conditionResult;
    if (pointSec >= windowStart && pointSec < windowEnd) {
      return pointSec;
    }
    if (windowStart > pointSec) {
      return windowStart;
    }
  }

  return null;
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
