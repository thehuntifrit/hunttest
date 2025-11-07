// cal.js

import { loadMaintenance } from "./app.js";

// ===== Time constants =====
const ET_HOUR_SEC = 175;           // 1 ET hour in real seconds
const WEATHER_CYCLE_SEC = 1400;    // 1 weather cycle in real seconds (23m20s)
const ET_DAY_HOURS = 24;           // 24 ET hours per ET day
const MOON_PHASE_DAYS = 4;         // 4 ET days per phase step
const MOON_INTERVAL_DAYS = 4;      // new/full moon active window = 4 ET days
const MOON_INTERVAL_SEC = MOON_INTERVAL_DAYS * ET_DAY_HOURS * ET_HOUR_SEC; // 16800 sec

// ===== Eorzea time helpers =====
function toEtTimestamp(realSec) {
  // Eorzea time runs 20.571428... times faster; here we work on hour boundaries only.
  // We will use ET-hour alignment by stepping realSec to nearest ET hour via modulo 175s.
  return realSec; // operate in real seconds space; ET hour alignment via floorToEtHour()
}

function floorToEtHour(realSec) {
  // Align down to ET hour boundary (175s grid in real time)
  return Math.floor(realSec / ET_HOUR_SEC) * ET_HOUR_SEC;
}

function ceilToEtHour(realSec) {
  return Math.ceil(realSec / ET_HOUR_SEC) * ET_HOUR_SEC;
}

function floorToWeatherCycle(realSec) {
  // Align down to weather cycle boundary (1400s grid)
  return Math.floor(realSec / WEATHER_CYCLE_SEC) * WEATHER_CYCLE_SEC;
}

// ET hour extraction from realSec aligned to ET-hour grid
function getEtHourFromReal(realSecAligned) {
  // Assuming we track only hour modulo 24; we derive ET hour by counting 175s ticks.
  const ticks = Math.floor(realSecAligned / ET_HOUR_SEC);
  return ticks % ET_DAY_HOURS; // 0..23
}

// ===== Interval helpers =====
function intersect2(a, b) {
  // a: [start,end], b: [start,end]
  const start = Math.max(a[0], b[0]);
  const end = Math.min(a[1], b[1]);
  if (end <= start) return null;
  return [start, end];
}

function intersectMany(base, intervals) {
  const out = [];
  for (const it of intervals) {
    const v = intersect2(base, [it.start, it.end]);
    if (v) {
      out.push({ ...it, start: v[0], end: v[1] });
    }
  }
  return out;
}

function clampToLowerBound(intervals, lowerBoundSec) {
  // Intersect with [lowerBoundSec, +inf)
  const out = [];
  for (const it of intervals) {
    if (it.end <= lowerBoundSec) continue;
    const start = Math.max(it.start, lowerBoundSec);
    out.push({ ...it, start });
  }
  return out;
}

function mergeAdjacents(intervals, toleranceSec = 0) {
  // Merge intervals that touch or overlap (optional tolerance)
  const a = [...intervals].sort((x, y) => x.start - y.start);
  const out = [];
  for (const it of a) {
    if (out.length === 0) {
      out.push({ ...it });
    } else {
      const last = out[out.length - 1];
      if (it.start <= last.end + toleranceSec && sameLabels(last.labels, it.labels)) {
        last.end = Math.max(last.end, it.end);
        // sustain: if both have sustain, keep max/aggregate
        last.sustain = aggregateSustain(last.sustain, it.sustain);
      } else {
        out.push({ ...it });
      }
    }
  }
  return out;
}

function sameLabels(a = {}, b = {}) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function aggregateSustain(a, b) {
  if (!a && !b) return undefined;
  const x = { cycles: 0, seconds: 0 };
  if (a) { x.cycles = Math.max(x.cycles, a.cycles || 0); x.seconds = Math.max(x.seconds, a.seconds || 0); }
  if (b) { x.cycles = Math.max(x.cycles, b.cycles || 0); x.seconds = Math.max(x.seconds, b.seconds || 0); }
  return x;
}

// ===== Moon info and intervals =====
// Note: We assume caller provides enough context to compute ET day/hour from real time.
// For this implementation, we provide interfaces that accept a realSec timestamp and
// a function that maps to ET calendar anchors if needed.

function getEorzeaMoonInfo(realSec) {
  // Returns current phase label and, if new/full moon, its active interval in realSec.
  // Model per spec:
  // - 32 ET days per full cycle; 4 ET days per phase step.
  // - New moon: ET day 32 12:00 -> day 4 12:00
  // - Full moon: ET day 16 12:00 -> day 20 12:00
  // Implementation detail:
  // We don't reconstruct absolute ET calendar here; instead we require a helper or precomputed schedule.
  // For practical integration, expose a planner that yields upcoming moon windows from 'startSec'.

  return { phase: -1, label: "その他", interval: null };
}

// Generate upcoming moon intervals starting from searchStartSec up to searchEndSec.
// If mob requires moon phase ("新月" or "満月"), we will construct intervals accordingly.
// We align interval starts to ET12:00 and we optionally include ET8:00 pre-roll for weather alignment.
function buildMoonIntervals(searchStartSec, searchEndSec, requiredLabel) {
  // Placeholder planner: In production, replace with real ET calendar mapping.
  // Here we synthesize windows by stepping ET-hour grid and locating ET12 anchors,
  // then constructing 4 ET-day windows for new/full alternately.
  // For correctness, you should plug the actual ET moon phase schedule you already use.
  const intervals = [];
  const step = ET_HOUR_SEC; // 175s
  let t = floorToEtHour(searchStartSec);

  // We will generate a reasonable number of windows forward until searchEndSec.
  // For demonstration, assume rolling pattern every 16 ET days between new and full.
  // Real system must use canonical seed/calendar.
  const MAX_WINDOWS = 128; // safeguard
  let windows = 0;

  while (t < searchEndSec && windows < MAX_WINDOWS) {
    const etHour = getEtHourFromReal(t);
    // Use ET12:00 anchors
    if (etHour === 12) {
      // Alternate windows: full at cycle index mod 2 == 0, new at == 1 (placeholder)
      const label = chooseMoonLabelByAnchorHeuristic(t);
      if (!requiredLabel || requiredLabel === label) {
        // interval is 4 ET days from ET12
        const start = t;
        const end = t + MOON_INTERVAL_SEC;
        // Include optional ET8 pre-roll for weather cycle alignment:
        const startForWeather = start - (4 * ET_HOUR_SEC); // ET8 => minus 4 hours
        intervals.push({
          start: Math.max(startForWeather, searchStartSec),
          end: Math.min(end, searchEndSec),
          labels: { moon: label },
          sustain: { seconds: end - start, cycles: Math.round((end - start) / WEATHER_CYCLE_SEC) }
        });
      }
      windows++;
      // Jump ahead approx one ET day to next ET12 (24 ET hours)
      t += ET_DAY_HOURS * ET_HOUR_SEC;
      continue;
    }
    t += step;
  }

  return mergeAdjacents(intervals);
}

function chooseMoonLabelByAnchorHeuristic(anchorSec) {
  // Placeholder: Replace with real moon phase computation (new vs full determination).
  // For now, pseudo toggling based on anchorSec bucket parity for demonstration.
  const bucket = Math.floor(anchorSec / (MOON_INTERVAL_SEC)); // 4 ET-day buckets
  return bucket % 2 === 0 ? "満月" : "新月";
}

// ===== Weather computation =====
// These stubs expect you to wire in your existing Eorzea weather seed logic.
// Replace getEorzeaWeatherAt with your actual implementation.

function getEorzeaWeatherAt(realSec) {
  // Return weather label at the start of the weather cycle containing realSec.
  // Align to cycle boundary first.
  const s = floorToWeatherCycle(realSec);
  // Placeholder: deterministic pseudo-weather label
  const idx = Math.floor(s / WEATHER_CYCLE_SEC) % 5;
  const labels = ["晴れ", "曇り", "雨", "風", "雷"];
  return labels[idx];
}

// Build weather intervals for a required weather label,
// performing sustain exploration up to 20 cycles starting within [searchStartSec, searchEndSec].
function buildWeatherIntervals(searchStartSec, searchEndSec, requiredWeatherLabel, sustainMaxCycles = 20) {
  const intervals = [];
  let t = floorToWeatherCycle(searchStartSec);

  while (t < searchEndSec) {
    const label = getEorzeaWeatherAt(t);
    if (!requiredWeatherLabel || label === requiredWeatherLabel) {
      // Found a matching cycle; explore sustain forward up to sustainMaxCycles
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
        labels: { weather: label },
        sustain: { cycles, seconds: (Math.min(end, searchEndSec) - t) }
      });

      // Jump to end of this matched sustain block for next search
      t = end;
      continue;
    }

    // If not matched, move to next cycle
    t += WEATHER_CYCLE_SEC;
  }

  return mergeAdjacents(intervals);
}

// ===== ET time ranges =====
function normalizeTimeRanges(timeRange, timeRanges) {
  if (Array.isArray(timeRanges) && timeRanges.length) return timeRanges;
  if (timeRange && typeof timeRange.start === "number" && typeof timeRange.end === "number") {
    return [timeRange];
  }
  return [];
}

// Build ET range intervals within [searchStartSec, searchEndSec]
function buildEtIntervals(searchStartSec, searchEndSec, timeRange, timeRanges) {
  const ranges = normalizeTimeRanges(timeRange, timeRanges);
  if (!ranges.length) return [];

  // We will iterate ET hour grid from start to end, and include hours inside any range.
  const out = [];
  let t = floorToEtHour(searchStartSec);

  while (t < searchEndSec) {
    const etHour = getEtHourFromReal(t);
    const inAny = ranges.some(r => etHourInRange(etHour, r.start, r.end));
    if (inAny) {
      // Grow contiguous ET-hour block inside ranges
      let end = t + ET_HOUR_SEC;
      while (end < searchEndSec) {
        const h = getEtHourFromReal(end);
        if (!ranges.some(r => etHourInRange(h, r.start, r.end))) break;
        end += ET_HOUR_SEC;
      }

      out.push({
        start: t,
        end,
        labels: { et: etLabelsFromRanges(ranges) }
      });

      t = end;
      continue;
    }
    t += ET_HOUR_SEC;
  }

  return mergeAdjacents(out);
}

function etHourInRange(hour, start, end) {
  if (start < end) return hour >= start && hour < end;
  // day wrap
  return hour >= start || hour < end;
}

function etLabelsFromRanges(ranges) {
  // Provide a compact descriptor
  return ranges.map(r => ({ startHour: r.start, endHour: r.end }));
}

// ===== Special condition orchestrator =====
function findNextSpawnIntervals(mob, startSec, endSec) {
  // Orchestrate month → weather → ET in order
  let baseIntervals = [{ start: startSec, end: endSec, labels: {} }];

  // 1) Moon (if specified)
  if (mob?.moonPhaseLabel) {
    const moonIntervals = buildMoonIntervals(startSec, endSec, mob.moonPhaseLabel);
    baseIntervals = intersectManyEnvelope(baseIntervals, moonIntervals);
    if (!baseIntervals.length) return [];
  }

  // 2) Weather (if specified)
  if (mob?.weatherLabel) {
    const weatherIntervals = buildWeatherIntervals(startSec, endSec, mob.weatherLabel, 20);
    baseIntervals = intersectManyEnvelope(baseIntervals, weatherIntervals);
    if (!baseIntervals.length) return [];
  }

  // 3) ET ranges (if specified)
  if (mob?.timeRange || (mob?.timeRanges && mob.timeRanges.length)) {
    const etIntervals = buildEtIntervals(startSec, endSec, mob.timeRange, mob.timeRanges);
    baseIntervals = intersectManyEnvelope(baseIntervals, etIntervals);
    if (!baseIntervals.length) return [];
  }

  // Merge adjacents with identical labels
  return mergeAdjacents(baseIntervals);
}

// Intersect each base interval with all candidate intervals; preserve labels and sustain
function intersectManyEnvelope(baseIntervals, candidateIntervals) {
  const out = [];
  for (const base of baseIntervals) {
    const parts = intersectMany([base.start, base.end], candidateIntervals);
    for (const p of parts) {
      out.push({
        start: p.start,
        end: p.end,
        labels: { ...base.labels, ...(p.labels || {}) },
        sustain: aggregateSustain(base.sustain, p.sustain)
      });
    }
  }
  return out;
}

// ===== Main: calculateRepop =====
function calculateRepop({ lastKill, serverUp, REPOP_s, MAX_s, now, mob }) {
  // 1) Baseline times
  const base = typeof lastKill === "number" && lastKill > 0 ? lastKill : (serverUp || 0);
  const minRepop = base + (REPOP_s || 0);
  const maxRepop = base + (MAX_s || 0);

  // 2) Status
  let status = "BeforeRepop";
  if (now >= minRepop && now < maxRepop) status = "PopWindow";
  else if (now >= maxRepop) status = "GuaranteedPop";

  // 3) Build special-condition intervals within [minRepop, Infinity) first
  const searchStart = ceilToEtHour(minRepop);  // align up to ET hour for exploration
  const searchEnd = Math.max(searchStart, maxRepop); // use maxRepop as upper bound
  const specials = findNextSpawnIntervals(mob || {}, searchStart, searchEnd);

  // 4) Clamp to [minRepop, ∞) and [now, ∞) for display/interaction
  const intervalsAfterMin = clampToLowerBound(specials, minRepop);
  const intervalsAfterNow  = clampToLowerBound(specials, now);

  // 5) First interval (next actionable window)
  const firstIntervalStart = intervalsAfterNow.length ? intervalsAfterNow[0].start : null;

  return {
    status,
    minRepop,
    maxRepop,
    intervals: intervalsAfterMin,
    intervalsFromNow: intervalsAfterNow,
    firstIntervalStart
  };
}

module.exports = {
  calculateRepop,
  findNextSpawnIntervals,
  buildMoonIntervals,
  buildWeatherIntervals,
  buildEtIntervals,
  getEorzeaMoonInfo,
  getEorzeaWeatherAt,
  floorToEtHour,
  ceilToEtHour,
  floorToWeatherCycle,
  getEtHourFromReal,
  ET_HOUR_SEC,
  WEATHER_CYCLE_SEC
};

export { calculateRepop, checkMobSpawnCondition, findNextSpawnTime, getEorzeaTime,  formatDuration, formatDurationHM, debounce, formatLastKillTime };
