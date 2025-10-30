// location.js

import { DOM } from "./uiRender.js";
import { toggleCrushStatus } from "./server.js";
import { getState } from "./dataManager.js"; 

function handleCrushToggle(e) {
    console.log("handleCrushToggle called", e.target); 
    const point = e.target.closest(".spawn-point");
    
    if (!point) return; 
    if (point.dataset.isInteractive !== "true") return;

    const card = e.target.closest(".mob-card"); 
    
    if (!card) {
        console.error("FATAL: Mob card (.mob-card) not found for interactive spawn point click.");
        return;
    }
    
    e.preventDefault();
    e.stopPropagation();

    const mobNo = parseInt(card.dataset.mobNo, 10);
    const locationId = point.dataset.locationId;
    const isCurrentlyCulled = point.dataset.isCulled === "true";
    
    console.log(`Cull action detected for Mob: ${mobNo}, Location: ${locationId}, Action: ${isCurrentlyCulled ? 'UNCULL' : 'CULL'}`);

    toggleCrushStatus(mobNo, locationId, isCurrentlyCulled);
}

function isCulled(pointStatus, mobNo) {
    const state = getState();
    const mob = state.mobs.find(m => m.No === mobNo); 
    const mobLastKillTime = mob?.last_kill_time || 0;

    const culledMs = pointStatus?.culled_at && typeof pointStatus.culled_at.toMillis === 'function' 
                         ? pointStatus.culled_at.toMillis() : 0;
    const uncullMs = pointStatus?.uncull_at && typeof pointStatus.uncull_at.toMillis === 'function' 
                         ? pointStatus.uncull_at.toMillis() : 0;
    
    const lastKillMs = typeof mobLastKillTime === 'number' ? mobLastKillTime * 1000 : 0;
    
    if (culledMs === 0 && uncullMs === 0) return false;
    
    const isCulledValid = culledMs > lastKillMs;
    const isUnculledValid = uncullMs > lastKillMs;
    if (isCulledValid && (!isUnculledValid || culledMs > uncullMs)) {
        return true;
    }
    if (isUnculledValid && (!isCulledValid || uncullMs > culledMs)) {
        return false;
    }
    return false;
}

function drawSpawnPoint(point, spawnCullStatus, mobNo, rank, isLastOne, isS_LastOne) {
    const pointStatus = spawnCullStatus?.[point.id];
    const isCulledFlag = isCulled(pointStatus, mobNo); 
    const isS_A_Cullable = point.mob_ranks.some(r => r === "S" || r === "A");
    const isB_Only = point.mob_ranks.every(r => r.startsWith("B"));

    let colorClass = "";
    let dataIsInteractive = "false";

    if (isLastOne) {
        colorClass = "color-lastone";
        dataIsInteractive = "false";

    } else if (isS_A_Cullable) {
        const rankB = point.mob_ranks.find(r => r.startsWith("B"));
        if (isCulledFlag) {
            colorClass = rankB === "B1" ? "color-b1-culled" : "color-b2-culled";
        } else {
            colorClass = rankB === "B1" ? "color-b1" : "color-b2";
        }
        dataIsInteractive = "true";

    } else if (isB_Only) {
        const rankB = point.mob_ranks[0];
        colorClass = rankB === "B1" ? "color-b1-only" : "color-b2-only";
        dataIsInteractive = "false";
    }

    return `
    <div class="spawn-point ${colorClass}"
        style="left:${point.x}%; top:${point.y}%;"
        data-location-id="${point.id}"
        data-mob-no="${mobNo}"
        data-rank="${rank}"
        data-is-culled="${isCulledFlag}"
        data-is-lastone="${isLastOne ? "true" : "false"}"
        data-is-interactive="${dataIsInteractive}"
        tabindex="0">
    </div>
  `;
}

function updateCrushUI(mobNo, locationId, isCulled) {
    const marker = document.querySelector(
        `.spawn-point[data-mob-no="${mobNo}"][data-location-id="${locationId}"]`
    );
    if (!marker) return;

    if (marker.dataset.isLastone === "true") {
        marker.dataset.isCulled = "false";
        marker.title = "ラストワン（湧き潰し不可）";
        return;
    }

    const rank = marker.dataset.rank;
    const isS_A_Cullable = marker.dataset.isInteractive === "true" && !marker.dataset.isLastone;

    if (isS_A_Cullable) {
         if (isCulled) {
             marker.classList.remove("color-b1", "color-b2");
             marker.classList.add(rank === "B1" ? "color-b1-culled" : "color-b2-culled");
         } else {
             marker.classList.remove("color-b1-culled", "color-b2-culled");
             marker.classList.add(rank === "B1" ? "color-b1" : "color-b2");
         }
    }
    
    marker.dataset.isCulled = isCulled.toString();
    marker.title = `湧き潰し: ${isCulled ? "済" : "未"}`;
}


function attachLocationEvents() {
    const overlayContainers = document.querySelectorAll(".map-overlay");
    if (!overlayContainers.length) return;

    overlayContainers.forEach(overlay => {
        overlay.removeEventListener("click", handleCrushToggle, { capture: true });
        overlay.addEventListener("click", handleCrushToggle, { capture: true });
    });
}

export { isCulled, drawSpawnPoint, handleCrushToggle, updateCrushUI, attachLocationEvents };
