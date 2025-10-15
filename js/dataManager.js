/**
 * dataManager.js
 */

import { db, functions, firestore as fs } from './firebaseConfig'; 
import { MOB_DATA_JSON_PATH, DEFAULT_REPOP_SECONDS } from './config'; 

const COLLECTIONS = {
    REPORTS: 'reports',
    MOB_STATUS: 'mob_status',
    MOB_LOCATIONS: 'mob_locations',
    USERS: 'users',
};

let globalMobData = {}; 
let _listeners = []; 

const getStatusDocId = (mobId) => {
    return `mob-${mobId}`; 
};

export const addListener = (listenerCallback) => {
    _listeners.push(listenerCallback);
    listenerCallback(globalMobData);
};

const _notifyListeners = () => {
    const calculatedData = _calculateNextSpawn(globalMobData);
    _listeners.forEach(listener => listener(calculatedData));
};

export const getGlobalMobData = () => {
    return _calculateNextSpawn(globalMobData);
};

const _mergeStatusData = (statusData) => {
    let changed = false;
    for (const mobId in statusData) {
        if (globalMobData[mobId]) {
            const newStatus = statusData[mobId];
            globalMobData[mobId] = {
                ...globalMobData[mobId],
                current_kill_time: newStatus.current_kill_time || null,
                current_kill_memo: newStatus.current_kill_memo || '',
                current_reporter_uid: newStatus.current_reporter_uid || '',
            };
            changed = true;
        }
    }
    if (changed) {
        _notifyListeners();
    }
};

const _mergeLocationsData = (mobId, locationData) => {
    if (globalMobData[mobId]) {
        globalMobData[mobId] = {
            ...globalMobData[mobId],
            crush_points_status: locationData.points || {}, 
        };
        _notifyListeners();
    }
};

const _loadStaticData = async () => {
    try {
        const response = await fetch(MOB_DATA_JSON_PATH);
        if (!response.ok) throw new Error('Failed to load mob_data.json');
        
        const mobArray = await response.json();
        const mobMap = {};
        
        mobArray.forEach(mob => {
            const mobId = String(mob.No); 

            mobMap[mobId] = {
                id: mobId,
                name: mob.NAME, 
                rank: mob.RANK, 
                
                map_area_name: mob.AREA, 
                map_image_filename: mob.MAP_IMAGE, 
                condition: mob.CONDITION, 
                
                repop_seconds: mob.REPOP || DEFAULT_REPOP_SECONDS,
                max_seconds: mob.MAX || (mob.REPOP + 7200),
                
                locations: mob.LOCATIONS || [],
                
                current_kill_time: null, 
                crush_points_status: null, 
            };
        });
        return mobMap;
    } catch (error) {
        console.error("Error loading static mob data:", error);
        return {};
    }
};

const _setupFirestoreListeners = () => {
    db.collection(COLLECTIONS.MOB_STATUS).onSnapshot(snapshot => {
        const statusData = {};
        snapshot.docs.forEach(doc => {
            const mobId = doc.id.replace('mob-', ''); 
            statusData[mobId] = doc.data();
        });
        _mergeStatusData(statusData);
    }, error => {
        console.error("Error subscribing to Mob Status:", error);
    });

    Object.keys(globalMobData).forEach(mobId => {
        db.collection(COLLECTIONS.MOB_LOCATIONS).doc(mobId).onSnapshot(snapshot => {
            if (snapshot.exists) {
                _mergeLocationsData(mobId, snapshot.data());
            } else {
                _mergeLocationsData(mobId, {});
            }
        }, error => {
            console.error(`Error subscribing to Mob Locations ${mobId}:`, error);
        });
    });
};

export const initialize = async () => {
    const mobMap = await _loadStaticData();
    globalMobData = mobMap;
    
    _setupFirestoreListeners();
    
    _notifyListeners(); 
};

export const submitHuntReport = async (mobId, memo, reporterUID) => {
    const mobData = globalMobData[mobId];
    if (!mobData) {
        throw new Error(`Mob ID ${mobId} not found in static data.`);
    }

    const reportData = {
        mob_id: String(mobId), 
        kill_time: fs.Timestamp.now(), 
        reporter_uid: reporterUID, 
        memo: memo,
        repop_seconds: mobData.repop_seconds, 
        max_seconds: mobData.max_seconds, 
    };

    try {
        const docRef = await db.collection(COLLECTIONS.REPORTS).add(reportData);
        return docRef.id;
    } catch (error) {
        console.error("Error submitting hunt report:", error);
        throw new Error("Failed to submit hunt report to server.");
    }
};

export const updateCrushStatus = async (mobId, pointId, action) => {
    if (globalMobData[mobId].rank !== 'S') {
        throw new Error("Only S-rank mobs support crush status updates.");
    }
    
    const docRef = db.collection(COLLECTIONS.MOB_LOCATIONS).doc(mobId);
    const fieldPath = `points.${pointId}`;

    const updateData = {};
    if (action === 'add') {
        updateData[fieldPath] = true;
    } else {
        updateData[fieldPath] = fs.FieldValue.delete();
    }

    try {
        await docRef.set(updateData, { merge: true });
    } catch (error) {
        console.error("Error updating crush status:", error);
        throw new Error("Failed to update crush status.");
    }
};

const _calculateNextSpawn = (data) => {
    const nowTimestamp = fs.Timestamp.now().toMillis() / 1000;

    for (const mobId in data) {
        const mob = data[mobId];
        let nextSpawnTime = null;
        let timeRemaining = null;
        let timerState = 'unknown';

        if (mob.current_kill_time) {
            const killTimeSeconds = mob.current_kill_time.toMillis() / 1000;
            const minRepopTime = killTimeSeconds + mob.repop_seconds;
            const maxRepopTime = killTimeSeconds + mob.max_seconds;
            
            nextSpawnTime = minRepopTime;

            if (nowTimestamp < minRepopTime) {
                timeRemaining = minRepopTime - nowTimestamp;
                timerState = 'imminent';
            } else if (nowTimestamp >= minRepopTime && nowTimestamp < maxRepopTime) {
                timeRemaining = nowTimestamp - minRepopTime;
                timerState = 'spawned';
            } else {
                timeRemaining = nowTimestamp - maxRepopTime;
                timerState = 'expired';
            }
        }

        data[mobId] = {
            ...mob,
            next_spawn_time_unix: nextSpawnTime,
            time_remaining_seconds: timeRemaining,
            timer_state: timerState,
        };
    }

    return data;
};
