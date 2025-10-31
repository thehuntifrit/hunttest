// cal.js

import { loadMaintenance } from "./app.js";

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

// サイクル境界に揃える（FFXIV天候は1400秒周期）
const WEATHER_CYCLE_SEC = 23 * 60 + 20; // 1400秒

function alignToCycleBoundary(tSec) {
    const r = tSec % WEATHER_CYCLE_SEC;
    return r === 0 ? tSec : (tSec - r + WEATHER_CYCLE_SEC);
}

// 時間帯条件チェック
function checkTimeRange(timeRange, timestamp) {
    const et = getEorzeaTime(new Date(timestamp * 1000));
    const h = Number(et.hours);
    const { start, end } = timeRange;

    if (start < end) {
        return h >= start && h < end;
    } else {
        return h >= start || h < end; // 日付跨ぎ
    }
}

// 総合条件チェック
function checkMobSpawnCondition(mob, date) {
    const et = getEorzeaTime(date);
    const moon = getEorzeaMoonPhase(date);
    const seed = getEorzeaWeatherSeed(date);

    if (mob.moonPhase) {
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

    if (mob.timeRange && !checkTimeRange(mob.timeRange, date.getTime() / 1000)) return false;

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

function findNextSpawnTime(mob, startDate) {
    if (!startDate || !(startDate instanceof Date) || isNaN(startDate.getTime())) {
        return null;
    }
    let tSec = Math.floor(startDate.getTime() / 1000);
    // --- 連続天候条件あり ---
    if (mob.weatherDuration?.minutes) {
        const requiredMinutes = mob.weatherDuration.minutes;
        const requiredCycles = Math.ceil((requiredMinutes * 60) / WEATHER_CYCLE_SEC);

        let consecutive = 0;
        let conditionStartSec = null;
        // 天候は1400秒刻みで探索
        tSec = alignToCycleBoundary(tSec);

        for (let end = tSec + 14 * 24 * 3600; tSec < end; tSec += WEATHER_CYCLE_SEC) {
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
                    // 連続成立 → 条件開始＋minutes が出現可能時刻
                    const popSec = conditionStartSec + requiredMinutes * 60;
                    return new Date(popSec * 1000);
                }
            } else {
                consecutive = 0;
                conditionStartSec = null;
            }
        }
        return null;
    }
    // --- 瞬間条件（天候以外: 月齢・時間帯） ---
    tSec = Math.floor(tSec / 60) * 60;

    for (let end = tSec + 14 * 24 * 3600; tSec < end; tSec += 60) {
        const date = new Date(tSec * 1000);
        if (checkMobSpawnCondition(mob, date)) {
            return date;
        }
    }

    return null;
}

// repop計算
function calculateRepop(mob, maintenance) {
    const now = Date.now() / 1000;
    const lastKill = mob.last_kill_time || 0;
    const repopSec = mob.REPOP_s;
    const maxSec = mob.MAX_s;
    // --- maintenance 正規化 ---
    let maint = maintenance;
    if (maint && typeof maint === "object" && "maintenance" in maint && maint.maintenance) {
        maint = maint.maintenance;
    }
    if (!maint || !maint.serverUp) return baseResult("Unknown");

    const serverUpDate = new Date(maint.serverUp);
    if (isNaN(serverUpDate.getTime())) return baseResult("Unknown");

    const serverUp = serverUpDate.getTime() / 1000;

    let minRepop = 0, maxRepop = 0;
    let elapsedPercent = 0;
    let timeRemaining = "Unknown";
    let status = "Unknown";

    if (lastKill === 0 || lastKill < serverUp) {
        minRepop = serverUp + repopSec;
        maxRepop = serverUp + maxSec;
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
    const hasCondition = !!mob.moonPhase || !!mob.timeRange || !!mob.weatherSeedRange || !!mob.weatherSeedRanges;

    if (hasCondition) {
        if (mob.weatherDuration?.minutes) {
            // 連続天候条件専用ロジック
            const requiredMinutes = mob.weatherDuration.minutes;
            const requiredCycles = Math.ceil((requiredMinutes * 60) / WEATHER_CYCLE_SEC);
            // 基準時刻の決定
            let baseSec = (lastKill === 0 || lastKill < serverUp)
                ? serverUp + repopSec
                : lastKill + repopSec;

            if (now > baseSec || now > maxRepop) {
                baseSec = now;
            }
            // 探索開始点 = 基準時刻 - 必要サイクル分
            let scanStartSec = baseSec - requiredCycles * WEATHER_CYCLE_SEC;
            if (scanStartSec < serverUp) scanStartSec = serverUp;
            scanStartSec = alignToCycleBoundary(scanStartSec);
            // 連続天候探索
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
                            // 内部は秒精度のまま返す（切り捨て不要）
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
            // 月齢・時間帯条件は従来通りの探索
            const baseSec = Math.max(minRepop, now, serverUp);
            // 内部は秒精度のまま返す
            nextConditionSpawnDate = findNextSpawnTime(mob, new Date(baseSec * 1000));
        }
    }

    return {
        minRepop,
        maxRepop,
        elapsedPercent,
        timeRemaining,
        status,
        nextMinRepopDate,
        nextConditionSpawnDate
    };

    function baseResult(status) {
        return {
            minRepop: null,
            maxRepop: null,
            elapsedPercent: 0,
            timeRemaining: "未確定",
            status,
            nextMinRepopDate: null,
            nextConditionSpawnDate: null
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
