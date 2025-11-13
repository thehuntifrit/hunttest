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
function getEorzeaMoonInfo(input = Date.now()) {
  const unixSeconds = (input instanceof Date)
    ? input.getTime() / 1000
    : (typeof input === "number" ? input : Date.now() / 1000);

  const EORZEA_SPEED_RATIO = 20.57142857142857;
  const eorzeaTotalDays = (unixSeconds * EORZEA_SPEED_RATIO) / 86400;
  const phase = (eorzeaTotalDays % 32) + 1; // 1〜32

  let label = null;
  if (phase >= 32.5 || phase < 4.5) label = "新月";
  else if (phase >= 16.5 && phase < 20.5) label = "満月";

  return { phase, label };
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

function checkTimeRange(timeRange, realSec) {
  const etHour = getEtHourFromRealSec(realSec);
  const { start, end } = timeRange;

  if (start < end) return etHour >= start && etHour < end;
  return etHour >= start || etHour < end; // 日跨ぎ
}

// 夜フェーズ判定（phase は 1〜32 小数）
function isFirstNightPhase(phase) {
  return phase >= 32.5 || phase < 1.5; // 32日12:00〜1日12:00
}
function isOtherNightsPhase(phase) {
  return phase >= 1.5 && phase < 4.5; // 1日12:00〜4日12:00
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

// ===== 補助関数群 =====
// 月齢条件区間列挙
function enumerateMoonRanges(startSec, endSec, phaseLabel) {
  const ranges = [];
  let curSec = startSec;
  while (curSec < endSec) {
    const { label } = getEorzeaMoonInfo(curSec);
    if (!phaseLabel || label === phaseLabel) {
      const windowStart = curSec;
      const windowEnd = curSec + MOON_PHASE_DURATION_SEC;
      ranges.push([windowStart, Math.min(windowEnd, endSec)]);
    }
    curSec += ET_DAY_SEC; // 1 ET日ずつ進める
  }
  return ranges;
}

// 天候条件区間列挙
function enumerateWeatherWindows(startSec, endSec, mob) {
  const ranges = [];
  let curSec = alignToWeatherCycle(startSec);
  while (curSec < endSec) {
    const seed = getEorzeaWeatherSeed(new Date(curSec * 1000));
    if (!mob.weatherSeedRange && !mob.weatherSeedRanges) {
      ranges.push([curSec, Math.min(curSec + WEATHER_CYCLE_SEC, endSec)]);
    } else if (checkWeatherInRange(mob, seed)) {
      ranges.push([curSec, Math.min(curSec + WEATHER_CYCLE_SEC, endSec)]);
    }
    curSec += WEATHER_CYCLE_SEC;
  }
  return ranges;
}

// ET条件区間列挙
// ET条件区間列挙（連続成立対応）
function enumerateETWindows(startSec, endSec, mob) {
  const ranges = [];
  let curSec = ceilToEtHour(startSec);

  while (curSec < endSec) {
    if (!mob.et || checkEtCondition(mob, curSec)) {
      // 成立区間開始
      let windowStart = curSec;
      let windowEnd = curSec + ET_HOUR_SEC;

      // 連続成立を結合（最大 +19 回 = 20 区間）
      let consecutive = 1;
      while (consecutive < 20 && windowEnd < endSec) {
        const nextCursor = windowEnd;
        if (checkEtCondition(mob, nextCursor)) {
          windowEnd += ET_HOUR_SEC;
          consecutive++;
        } else {
          break;
        }
      }

      ranges.push([windowStart, windowEnd]);
      curSec = windowEnd; // 次の探索カーソルを更新
    } else {
      curSec += ET_HOUR_SEC;
    }
  }

  return ranges;
}

// 区間交差
function intersectWindows(listA, listB) {
  const result = [];
  for (const [aStart, aEnd] of listA) {
    for (const [bStart, bEnd] of listB) {
      const start = Math.max(aStart, bStart);
      const end = Math.min(aEnd, bEnd);
      if (start < end) result.push([start, end]);
    }
  }
  return result;
}

// ===== 機関部分 =====
// 次の条件成立区間を探索
function findNextConditionWindow(mob, pointSec, minRepopSec, limitSec) {
  const searchEnd = pointSec + 20 * 24 * 3600; // 20日間探索
  // 特殊条件がない場合は即確定
  if (!mob.moonPhase && !mob.weatherSeedRange && !mob.weatherSeedRanges && !mob.et) {
    return {
      windowStart: Math.max(pointSec, minRepopSec),
      windowEnd: searchEnd,
      repeatCount: Math.floor((searchEnd - pointSec) / ET_HOUR_SEC)
    };
  }
  // 各条件の区間列挙
  let moonRanges = mob.moonPhase ? enumerateMoonRanges(pointSec, searchEnd, mob.moonPhase) : [[pointSec, searchEnd]];
  let weatherRanges = mob.weatherSeedRange || mob.weatherSeedRanges ? enumerateWeatherWindows(pointSec, searchEnd, mob) : [[pointSec, searchEnd]];
  let etRanges = mob.et ? enumerateETWindows(pointSec, searchEnd, mob) : [[pointSec, searchEnd]];
  // 区間交差
  let intersected = intersectWindows(moonRanges, weatherRanges);
  intersected = intersectWindows(intersected, etRanges);
  // 最初の成立区間を返す
  for (const [start, end] of intersected) {
    if (start >= minRepopSec) {
      return {
        windowStart: start,
        windowEnd: end,
        repeatCount: Math.floor((end - start) / ET_HOUR_SEC)
      };
    }
  }
  return null;
}

// 次のスポーン可能時刻を返す
function findNextSpawnTime(mob, pointSec, minRepopSec, limitSec) {
  const nextWindow = findNextConditionWindow(mob, pointSec, minRepopSec, limitSec);
  if (!nextWindow) return null;

  const spawnTime = Math.max(nextWindow.windowStart, minRepopSec);
  if (spawnTime >= nextWindow.windowEnd) return null;

  return spawnTime;
}

// 表示用データをまとめる
function calculateRepop(mob, pointSec, minRepopSec, limitSec) {
  const nextWindow = findNextConditionWindow(mob, pointSec, minRepopSec, limitSec);
  const nowSec = Date.now() / 1000;

  if (!nextWindow) {
    return {
      popTime: null,
      remainingSec: null,
      nextConditionSpawnDate: null,
      status: "Unknown",
      elapsedPercent: 0,
      nextMinRepopDate: null,
      isInConditionWindow: false,
      minRepop: null,
      maxRepop: null
    };
  }

  const minRepop = Math.max(nextWindow.windowStart, minRepopSec);
  const maxRepop = nextWindow.windowEnd;
  const remainingSec = maxRepop > pointSec ? maxRepop - pointSec : 0;

  let status = "Unknown";
  if (nowSec < minRepop) status = "Next";
  else if (nowSec >= minRepop && nowSec < maxRepop) status = "PopWindow";
  else if (nowSec >= maxRepop) status = "MaxOver";

  let elapsedPercent = 0;
  if (status === "PopWindow") elapsedPercent = ((nowSec - minRepop) / (maxRepop - minRepop)) * 100;
  else if (status === "MaxOver") elapsedPercent = 100;

  return {
    popTime: minRepop,
    remainingSec,
    nextConditionSpawnDate: new Date(nextWindow.windowStart * 1000), // Dateで返す
    status,
    elapsedPercent,
    nextMinRepopDate: new Date(minRepop * 1000), // Dateで返す
    isInConditionWindow: status === "PopWindow",
    minRepop,
    maxRepop
  };
}

// 現在時刻での成立判定
function checkMobSpawnCondition(mob, pointSec) {
  if (mob.moonPhase) {
    const { label } = getEorzeaMoonInfo(pointSec);
    if (label !== mob.moonPhase) return false;
  }
  if (mob.weatherSeedRange || mob.weatherSeedRanges) {
    const seed = getEorzeaWeatherSeed(new Date(pointSec * 1000));
    if (!checkWeatherInRange(mob, seed)) return false;
  }
  if (mob.et && !checkEtCondition(mob, pointSec)) return false;

  return true;
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
