// location.js

import { DOM } from "./uiRender.js";
import { toggleCrushStatus } from "./server.js";
import { getState, getMobByNo } from "./dataManager.js";

function handleCrushToggle(e) {
    const point = e.target.closest(".spawn-point");
    if (!point) return false;
    if (point.dataset.isInteractive !== "true") return false;

    e.preventDefault();
    e.stopPropagation();

    const card = e.target.closest(".mob-card");
    if (!card) return true;

    const mobNo = parseInt(card.dataset.mobNo, 10);
    const locationId = point.dataset.locationId;
    const isCurrentlyCulled = point.dataset.isCulled === "true";
    toggleCrushStatus(mobNo, locationId, isCurrentlyCulled);
    return true;
}

function isCulled(pointStatus, mobNo) {
    const culledMs = pointStatus?.culled_at ? pointStatus.culled_at.toMillis() : 0;
    const uncullMs = pointStatus?.uncull_at ? pointStatus.uncull_at.toMillis() : 0;

    if (culledMs === 0 && uncullMs === 0) return false;
    let culled = culledMs > uncullMs;

    if (culled && mobNo) {
        const mob = getMobByNo(mobNo);

        let lastKill = 0;
        if (mob?.last_kill_time) {
            if (typeof mob.last_kill_time.toMillis === 'function') {
                lastKill = mob.last_kill_time.toMillis();
            } else if (typeof mob.last_kill_time === 'number') {
                lastKill = mob.last_kill_time * 1000;
            }
        }

        if (lastKill > culledMs) {
            // 討伐の方が新しい → 見かけ上リセット
            culled = false;
        }
    }
    return culled;
}

function drawSpawnPoint(point, spawnCullStatus, mobNo, rank, isLastOne, isS_LastOne) {
    const pointStatus = spawnCullStatus?.[point.id];
    const isCulledFlag = isCulled(pointStatus, mobNo);

    const isS_A_Cullable = point.mob_ranks.some(r => r === "S" || r === "A");
    const isB_Only = point.mob_ranks.every(r => r.startsWith("B"));

    let colorClass = "";
    let dataIsInteractive = "false";

    if (isLastOne) {
        // ラストワンは固定色・非インタラクティブ
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
        // ラストワンは湧き潰し対象外
        marker.dataset.isCulled = "false";
        marker.title = "ラストワン（湧き潰し不可）";
        return;
    }

    const rank = marker.dataset.rank;
    if (isCulled) {
        marker.classList.remove("color-b1", "color-b2");
        marker.classList.add(rank === "B1" ? "color-b1-culled" : "color-b2-culled");
    } else {
        marker.classList.remove("color-b1-culled", "color-b2-culled");
        marker.classList.add(rank === "B1" ? "color-b1" : "color-b2");
    }
    marker.dataset.isCulled = isCulled.toString();
    marker.title = `湧き潰し: ${isCulled ? "済" : "未"}`;
}

function attachLocationEvents() {
    const overlayContainers = document.querySelectorAll(".map-overlay");
    if (!overlayContainers.length) return;

    overlayContainers.forEach(overlay => {
        overlay.removeEventListener("click", handleCrushToggle);
        overlay.addEventListener("click", handleCrushToggle);
    });
}

export { isCulled, drawSpawnPoint, handleCrushToggle, updateCrushUI, attachLocationEvents };
