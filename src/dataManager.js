// dataManager.js
import { setUserId, getState, setBaseMobData, setMobs } from "./store.js";
import { filterAndRender, updateProgressBars } from "./uiRender.js";
import { subscribeMobStatusDocs, subscribeMobLocations } from "./firestore.js";
import { initializeAuth } from "./firebase.js";
import { displayStatus } from "./utils.js";

const MOB_DATA_URL = "./mob_data.json";
let progressInterval = null;
let unsubscribes = [];

async function loadBaseMobData() {
  const resp = await fetch(MOB_DATA_URL);
  if (!resp.ok) throw new Error("Mob data failed to load.");
  const data = await resp.json();

  const { EXPANSION_MAP } = await import("./store.js");
  const baseMobData = Object.entries(data.mobs).map(([no, mob]) => ({
    No: parseInt(no, 10),
    Rank: mob.rank,
    Name: mob.name,
    Area: mob.area,
    Condition: mob.condition,
    Expansion: EXPANSION_MAP[Math.floor(no / 10000)] || "Unknown",
    REPOP_s: mob.repopSeconds,
    MAX_s: mob.maxRepopSeconds,
    Map: mob.mapImage,
    spawn_points: mob.locations,
    last_kill_time: 0,
    prev_kill_time: 0,
    last_kill_memo: "",
    spawn_cull_status: {},
    related_mob_no: mob.rank.startsWith("B") ? mob.relatedMobNo : null
  }));

  setBaseMobData(baseMobData);
  setMobs([...baseMobData]);
  filterAndRender({ isInitialLoad: true });
}

function startRealtime() {
  // Clear previous
  if (progressInterval) clearInterval(progressInterval);
  unsubscribes.forEach(fn => fn && fn());
  unsubscribes = [];

  // Subscribe mob_status docs
  const unsubStatus = subscribeMobStatusDocs(mobStatusDataMap => {
    const current = getState().mobs;
    const map = new Map();
    Object.values(mobStatusDataMap).forEach(docData => {
      Object.entries(docData).forEach(([mobId, mobData]) => {
        const mobNo = parseInt(mobId, 10);
        map.set(mobNo, {
          last_kill_time: mobData.last_kill_time?.seconds || 0,
          prev_kill_time: mobData.prev_kill_time?.seconds || 0,
          last_kill_memo: mobData.last_kill_memo || ""
        });
      });
    });
    const merged = current.map(m => {
      const dyn = map.get(m.No);
      return dyn ? { ...m, ...dyn } : m;
    });
    setMobs(merged);
    filterAndRender();
    displayStatus("LKT/Memoデータ更新完了。", "success");
  });
  unsubscribes.push(unsubStatus);

  // Subscribe mob_locations
  const unsubLoc = subscribeMobLocations(locationsMap => {
    const current = getState().mobs;
    const merged = current.map(m => {
      const dyn = locationsMap[m.No];
      if (m.Rank === "S" && dyn) {
        return { ...m, spawn_cull_status: dyn.points || {} };
      }
      return m;
    });
    setMobs(merged);
    filterAndRender();
    displayStatus("湧き潰しデータ更新完了。", "success");
  });
  unsubscribes.push(unsubLoc);

  progressInterval = setInterval(updateProgressBars, 10000);
}

async function setupApp() {
  displayStatus("アプリを初期化中...", "loading");
  await loadBaseMobData();
  const uid = await initializeAuth();
  setUserId(uid);
  startRealtime();
}

export { setupApp };
