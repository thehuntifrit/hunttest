// dataManager.js

import { calculateRepop } from "./cal.js";
import { subscribeMobStatusDocs, subscribeMobLocations, subscribeMobMemos } from "./server.js";
import { filterAndRender, updateProgressBars } from "./uiRender.js";

const EXPANSION_MAP = { 1: "新生", 2: "蒼天", 3: "紅蓮", 4: "漆黒", 5: "暁月", 6: "黄金" };

const state = {
    userId: localStorage.getItem("user_uuid") || null,
    baseMobData: [],
    mobs: [],
    mobLocations: {},
    maintenance: null, // メンテナンス情報を保持

    filter: JSON.parse(localStorage.getItem("huntFilterState")) || {
        rank: "ALL",
        areaSets: {
            S: new Set(),
            A: new Set(),
            F: new Set(),
            ALL: new Set()
        },
        allRankSet: new Set() // For ALL tab rank filtering
    },
    openMobCardNo: localStorage.getItem("openMobCardNo")
        ? parseInt(localStorage.getItem("openMobCardNo"), 10)
        : null
};

// Setの復元 (Robust Restoration)
if (state.filter.areaSets) {
    for (const k in state.filter.areaSets) {
        const v = state.filter.areaSets[k];
        if (Array.isArray(v)) {
            state.filter.areaSets[k] = new Set(v);
        } else if (!(v instanceof Set)) {
            // If it's an object (from older JSON stringify) or null/undefined
            state.filter.areaSets[k] = new Set();
        }
    }
} else {
    // Fallback if areaSets is missing entirely
    state.filter.areaSets = {
        S: new Set(),
        A: new Set(),
        F: new Set(),
        ALL: new Set()
    };
}

// allRankSetの復元
if (Array.isArray(state.filter.allRankSet)) {
    state.filter.allRankSet = new Set(state.filter.allRankSet);
} else if (!(state.filter.allRankSet instanceof Set)) {
    state.filter.allRankSet = new Set();
}

const getState = () => state;
const getMobByNo = no => state.mobs.find(m => m.No === no);

function setUserId(uid) {
    state.userId = uid;
    localStorage.setItem("user_uuid", uid);
}

function setMobs(data) {
    state.mobs = data;
}

function setFilter(partial) {
    state.filter = { ...state.filter, ...partial };
    const serialized = {
        ...state.filter,
        areaSets: Object.keys(state.filter.areaSets).reduce((acc, key) => {
            const v = state.filter.areaSets[key];
            acc[key] = v instanceof Set ? Array.from(v) : v;
            return acc;
        }, {}),
        allRankSet: Array.from(state.filter.allRankSet || [])
    };
    localStorage.setItem("huntFilterState", JSON.stringify(serialized));
}

function setOpenMobCardNo(no) {
    state.openMobCardNo = no;
    if (no === null) {
        localStorage.removeItem("openMobCardNo");
    } else {
        localStorage.setItem("openMobCardNo", no);
    }
}

const RANK_COLORS = {
    S: { bg: 'bg-amber-600', hover: 'hover:bg-amber-700', text: 'text-amber-600', rgbaBorder: 'rgba(217, 119, 6, 0.8)', label: 'S' },
    A: { bg: 'bg-green-600', hover: 'hover:bg-green-700', text: 'text-green-600', rgbaBorder: 'rgba(22, 163, 74, 0.8)', label: 'A' },
    F: { bg: 'bg-purple-600', hover: 'hover:bg-purple-700', text: 'text-purple-600', rgbaBorder: 'rgba(147, 51, 234, 0.8)', label: 'F' },
};

const PROGRESS_CLASSES = {
    P0_60: "progress-p0-60",
    P60_80: "progress-p60-80",
    P80_100: "progress-p80-100",
    MAX_OVER: "progress-max-over",
    TEXT_NEXT: "text-next",
    TEXT_POP: "text-pop",
    BLINK_WHITE: "progress-blink-white"
};

const FILTER_TO_DATA_RANK_MAP = { FATE: 'F', ALL: 'ALL', S: 'S', A: 'A' };

const MOB_DATA_URL = "./mob_data.json";
const MAINTENANCE_URL = "./maintenance.json";

const MOB_DATA_CACHE_KEY = "mobDataCache";

async function loadMaintenance() {
    try {
        const res = await fetch(MAINTENANCE_URL);
        if (!res.ok) throw new Error("Maintenance data failed to load.");
        const data = await res.json();
        state.maintenance = (data && data.maintenance) ? data.maintenance : data;
        return state.maintenance;
    } catch (e) {
        console.error("Maintenance load error:", e);
        return null;
    }
}

// Mobデータの加工処理を共通化
function processMobData(rawMobData, maintenance) {
    return Object.entries(rawMobData.mobs).map(([no, mob]) => ({
        No: parseInt(no, 10),
        Rank: mob.rank,
        Name: mob.name,
        Area: mob.area,
        Condition: mob.condition || "",
        Expansion: EXPANSION_MAP[Math.floor(no / 10000)] || "Unknown",
        REPOP_s: mob.repopSeconds,
        MAX_s: mob.maxRepopSeconds,
        moonPhase: mob.moonPhase || null,
        conditions: mob.conditions || null,
        timeRange: mob.timeRange || null,
        timeRanges: mob.timeRanges || null,
        weatherSeedRange: mob.weatherSeedRange || null,
        weatherSeedRanges: mob.weatherSeedRanges || null,
        weatherDuration: mob.weatherDuration || null,
        Map: mob.mapImage || "",
        spawn_points: mob.locations || [],
        last_kill_time: 0,
        prev_kill_time: 0,
        spawn_cull_status: {},
        // メモ機能用フィールド
        memo_text: "",
        memo_updated_at: 0,

        repopInfo: calculateRepop({
            REPOP_s: mob.repopSeconds,
            MAX_s: mob.maxRepopSeconds,
            last_kill_time: 0,
        }, maintenance)
    }));
}

async function loadBaseMobData() {
    // 1. メンテナンス情報の取得 (これは毎回取得するが、軽量なのでOK)
    const maintenance = await loadMaintenance();

    // 2. キャッシュがあれば即座に表示 (Stale-While-Revalidate)
    const cachedDataStr = localStorage.getItem(MOB_DATA_CACHE_KEY);
    let cachedData = null;
    if (cachedDataStr) {
        try {
            cachedData = JSON.parse(cachedDataStr);
            console.log("Using cached mob data");
            const processed = processMobData(cachedData, maintenance);
            state.baseMobData = processed;
            setMobs([...processed]);
            filterAndRender({ isInitialLoad: true });
        } catch (e) {
            console.warn("Cache parse error:", e);
        }
    }

    // 3. ネットワークから最新データを取得
    try {
        const mobRes = await fetch(MOB_DATA_URL);
        if (!mobRes.ok) throw new Error("Mob data failed to load.");

        const freshData = await mobRes.json();

        // 4. キャッシュと異なる場合のみ更新
        const freshDataStr = JSON.stringify(freshData);
        if (freshDataStr !== cachedDataStr) {
            console.log("Updating mob data from network");
            localStorage.setItem(MOB_DATA_CACHE_KEY, freshDataStr);

            const processed = processMobData(freshData, maintenance);
            state.baseMobData = processed;
            setMobs([...processed]);

            // 初回ロード時(キャッシュなし)か、データ更新時のみ再描画
            if (!cachedData) {
                filterAndRender({ isInitialLoad: true });
            } else {
                // 既にキャッシュで表示済みの場合は、静かに更新するだけで良いかも知れないが、
                // データが変わったので再描画する
                filterAndRender();
            }
        } else {
            console.log("Mob data is up to date");
        }

    } catch (e) {
        console.error("Failed to load base data from network:", e);
        // キャッシュもなく、ネットワークも失敗した場合のみエラー表示
        if (!cachedData) {
            console.error("データの読み込みに失敗しました。");
        }
    }
}

let unsubscribes = [];

function startRealtime() {
    // 既存の購読を解除
    unsubscribes.forEach(fn => fn && fn());
    unsubscribes = [];

    // 1. Mob Status (Last Kill Time)
    const unsubStatus = subscribeMobStatusDocs(mobStatusDataMap => {
        const current = state.mobs;
        const map = new Map();

        Object.values(mobStatusDataMap).forEach(docData => {
            Object.entries(docData).forEach(([mobId, mobData]) => {
                const mobNo = parseInt(mobId, 10);
                map.set(mobNo, {
                    last_kill_time: mobData.last_kill_time?.seconds || 0,
                    prev_kill_time: mobData.prev_kill_time?.seconds || 0,
                });
            });
        });

        const merged = current.map(m => {
            const dyn = map.get(m.No);
            if (!dyn) return m;

            const updatedMob = { ...m, ...dyn };
            updatedMob.repopInfo = calculateRepop(updatedMob, state.maintenance);
            return updatedMob;
        });

        setMobs(merged);
        filterAndRender();
        updateProgressBars();
    });
    unsubscribes.push(unsubStatus);

    // 2. Mob Locations (Spawn Cull Status)
    const unsubLoc = subscribeMobLocations(locationsMap => {
        const current = state.mobs;
        state.mobLocations = locationsMap;

        const merged = current.map(m => {
            const dyn = locationsMap[m.No];
            const updatedMob = { ...m };
            updatedMob.spawn_cull_status = dyn || {};
            return updatedMob;
        });

        setMobs(merged);
        filterAndRender();
    });
    unsubscribes.push(unsubLoc);

    // 3. Mob Memos
    const unsubMemo = subscribeMobMemos(memoData => {
        const current = state.mobs;

        const merged = current.map(m => {
            const memos = memoData[m.No] || [];
            const latest = memos[0]; // 最新のメモ

            const updatedMob = { ...m };
            if (latest) {
                updatedMob.memo_text = latest.memo_text;
                updatedMob.memo_updated_at = latest.created_at?.seconds || 0;
            } else {
                updatedMob.memo_text = "";
            }
            return updatedMob;
        });

        setMobs(merged);
        filterAndRender();
    });
    unsubscribes.push(unsubMemo);
}

export {
    state, EXPANSION_MAP, getState, getMobByNo, setUserId, setMobs, loadBaseMobData, startRealtime, setFilter,
    setOpenMobCardNo, RANK_COLORS, PROGRESS_CLASSES, FILTER_TO_DATA_RANK_MAP, loadMaintenance
};
