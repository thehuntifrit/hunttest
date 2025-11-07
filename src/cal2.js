// ===== Constants =====
const ET_HOUR_SEC = 175;           // 1 ET hour in real seconds
const WEATHER_CYCLE_SEC = 1400;    // 1 weather cycle in real seconds (23m20s)
const ET_DAY_HOURS = 24;           // 24 ET hours per ET day
const MOON_INTERVAL_SEC = 4 * ET_DAY_HOURS * ET_HOUR_SEC; // 4 ET days = 16800 sec

// ===== Time helpers =====
function floorToEtHour(realSec) {
  return Math.floor(realSec / ET_HOUR_SEC) * ET_HOUR_SEC;
}
function ceilToEtHour(realSec) {
  return Math.ceil(realSec / ET_HOUR_SEC) * ET_HOUR_SEC;
}
function floorToWeatherCycle(realSec) {
  return Math.floor(realSec / WEATHER_CYCLE_SEC) * WEATHER_CYCLE_SEC;
}
function getEtHourFromReal(realSecAligned) {
  const ticks = Math.floor(realSecAligned / ET_HOUR_SEC);
  return ticks % ET_DAY_HOURS; // 0..23
}

// ===== Interval helpers =====
function intersect2(a, b) {
  const start = Math.max(a[0], b[0]);
  const end = Math.min(a[1], b[1]);
  if (end <= start) return null;
  return [start, end];
}
function intersectMany(base, intervals) {
  const out = [];
  for (const it of intervals) {
    const v = intersect2(base, [it.start, it.end]);
    if (v) out.push({ ...it, start: v[0], end: v[1] });
  }
  return out;
}
function clampToLowerBound(intervals, lowerBoundSec) {
  return intervals
    .filter(it => it.end > lowerBoundSec)
    .map(it => ({ ...it, start: Math.max(it.start, lowerBoundSec) }));
}
function mergeAdjacents(intervals) {
  const a = [...intervals].sort((x, y) => x.start - y.start);
  const out = [];
  for (const it of a) {
    if (!out.length) out.push({ ...it });
    else {
      const last = out[out.length - 1];
      if (it.start <= last.end && JSON.stringify(last.labels) === JSON.stringify(it.labels)) {
        last.end = Math.max(last.end, it.end);
      } else out.push({ ...it });
    }
  }
  return out;
}

// ===== Moon intervals =====
function buildMoonIntervals(searchStartSec, searchEndSec, requiredLabel) {
  const intervals = [];
  let t = floorToEtHour(searchStartSec);
  const MAX_WINDOWS = 128;
  let windows = 0;

  while (t < searchEndSec && windows < MAX_WINDOWS) {
    const etHour = getEtHourFromReal(t);
    if (etHour === 12) {
      const label = chooseMoonLabelByAnchorHeuristic(t);
      if (!requiredLabel || requiredLabel === label) {
        const start = t;
        const end = t + MOON_INTERVAL_SEC;
        const startForWeather = start - (4 * ET_HOUR_SEC); // ET8 pre-roll
        intervals.push({
          start: Math.max(startForWeather, searchStartSec),
          end: Math.min(end, searchEndSec),
          labels: { moon: label }
        });
      }
      windows++;
      t += ET_DAY_HOURS * ET_HOUR_SEC;
      continue;
    }
    t += ET_HOUR_SEC;
  }
  return mergeAdjacents(intervals);
}
function chooseMoonLabelByAnchorHeuristic(anchorSec) {
  const bucket = Math.floor(anchorSec / MOON_INTERVAL_SEC);
  return bucket % 2 === 0 ? "満月" : "新月";
}

// ===== Weather intervals =====
function getEorzeaWeatherAt(realSec) {
  const s = floorToWeatherCycle(realSec);
  const idx = Math.floor(s / WEATHER_CYCLE_SEC) % 5;
  const labels = ["晴れ", "曇り", "雨", "風", "雷"];
  return labels[idx];
}
function buildWeatherIntervals(searchStartSec, searchEndSec, requiredWeatherLabel, sustainMaxCycles = 20) {
  const intervals = [];
  let t = floorToWeatherCycle(searchStartSec);
  while (t < searchEndSec) {
    const label = getEorzeaWeatherAt(t);
    if (!requiredWeatherLabel || label === requiredWeatherLabel) {
      let cycles = 1;
      let end = t + WEATHER_CYCLE_SEC;
      while (cycles < sustainMaxCycles) {
        const nextStart = end;
        const nextLabel = getEorzeaWeatherAt(nextStart);
        if (nextLabel !== label || nextStart >= searchEndSec) break;
        end += WEATHER_CYCLE_SEC;
        cycles++;
      }
      intervals.push({
        start: t,
        end: Math.min(end, searchEndSec),
        labels: { weather: label }
      });
      t = end;
      continue;
    }
    t += WEATHER_CYCLE_SEC;
  }
  return mergeAdjacents(intervals);
}

// ===== ET intervals =====
function normalizeTimeRanges(timeRange, timeRanges) {
  if (Array.isArray(timeRanges) && timeRanges.length) return timeRanges;
  if (timeRange && typeof timeRange.start === "number" && typeof timeRange.end === "number") {
    return [timeRange];
  }
  return [];
}
function buildEtIntervals(searchStartSec, searchEndSec, timeRange, timeRanges) {
  const ranges = normalizeTimeRanges(timeRange, timeRanges);
  if (!ranges.length) return [];
  const out = [];
  let t = floorToEtHour(searchStartSec);
  while (t < searchEndSec) {
    const etHour = getEtHourFromReal(t);
    const inAny = ranges.some(r => etHourInRange(etHour, r.start, r.end));
    if (inAny) {
      let end = t + ET_HOUR_SEC;
      while (end < searchEndSec) {
        const h = getEtHourFromReal(end);
        if (!ranges.some(r => etHourInRange(h, r.start, r.end))) break;
        end += ET_HOUR_SEC;
      }
      out.push({ start: t, end, labels: { et: ranges } });
      t = end;
      continue;
    }
    t += ET_HOUR_SEC;
  }
  return mergeAdjacents(out);
}
function etHourInRange(hour, start, end) {
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

// ===== Special condition orchestrator =====
function findNextSpawnIntervals(mob, startSec, endSec) {
  let baseIntervals = [{ start: startSec, end: endSec, labels: {} }];
  if (mob?.moonPhaseLabel) {
    const moonIntervals = buildMoonIntervals(startSec, endSec, mob.moonPhaseLabel);
    baseIntervals = intersectManyEnvelope(baseIntervals, moonIntervals);
    if (!baseIntervals.length) return [];
  }
  if (mob?.weatherLabel) {
    const weatherIntervals = buildWeatherIntervals(startSec, endSec, mob.weatherLabel, 20);
    baseIntervals = intersectManyEnvelope(baseIntervals, weatherIntervals);
    if (!baseIntervals.length) return [];
  }
  if (mob?.timeRange || (mob?.timeRanges && mob.timeRanges.length)) {
    const etIntervals = buildEtIntervals(startSec, endSec, mob.timeRange, mob.timeRanges);
    baseIntervals = intersectManyEnvelope(baseIntervals, etIntervals);
    if (!baseIntervals.length) return [];
  }
  return mergeAdjacents(baseIntervals);
}
function intersectManyEnvelope(baseIntervals, candidateIntervals) {
  const out = [];
  for (const base of baseIntervals) {
    const parts = intersectMany([base.start, base.end], candidateIntervals);
    for (const p of parts) {
      out.push({ start: p.start, end: p.end, labels: { ...base.labels, ...(p.labels || {}) } });
    }
  }
  return out;
}

// ===== Main =====
function calculateRepop({ lastKill, serverUp, REPOP_s, MAX_s, now, mob }) {
  // 1) 基準時刻
  const base = typeof lastKill === "number" && lastKill > 0 ? lastKill : (serverUp || 0);
  const minRepop = base + (REPOP_s || 0);
  const maxRepop = base + (MAX_s || 0);

  // 2) 状態判定
  let status = "BeforeRepop";
  if (now >= minRepop && now < maxRepop) status = "PopWindow";
  else if (now >= maxRepop) status = "GuaranteedPop";

  // 3) 特殊条件探索範囲
  const searchStart = ceilToEtHour(minRepop);   // ET Hourに丸め
  const searchEnd   = Math.max(searchStart, maxRepop);

  // 4) 特殊条件区間の生成
  const specials = findNextSpawnIntervals(mob || {}, searchStart, searchEnd);

  // 5) 最短REPOP以降／現在時刻以降に絞り込み
  const intervalsAfterMin = clampToLowerBound(specials, minRepop);
  const intervalsAfterNow = clampToLowerBound(specials, now);

  // 6) 次に有効な区間開始
  const firstIntervalStart = intervalsAfterNow.length ? intervalsAfterNow[0].start : null;

  // 7) 出力
  return {
    status,
    minRepop,
    maxRepop,
    intervals: intervalsAfterMin,
    intervalsFromNow: intervalsAfterNow,
    firstIntervalStart
  };
}

// ===== Export =====
module.exports = {
  calculateRepop,
  findNextSpawnIntervals,
  buildMoonIntervals,
  buildWeatherIntervals,
  buildEtIntervals,
  getEorzeaWeatherAt,
  floorToEtHour,
  ceilToEtHour,
  floorToWeatherCycle,
  getEtHourFromReal,
  ET_HOUR_SEC,
  WEATHER_CYCLE_SEC
};
