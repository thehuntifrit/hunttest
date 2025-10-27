// location.js

import { DOM } from "./uiRender.js";
import { toggleCrushStatus } from "./server.js";
import { getState, getMobByNo } from "./dataManager.js";

function handleCrushToggle(e) {
    const point = e.target.closest(".spawn-point");
    if (point && point.dataset.isInteractive === "true") {
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
    return false;
}

function updateCrushUI(mobNo, locationId, isCulled) {
    const marker = document.querySelector(
        `.spawn-point[data-mob-no="${mobNo}"][data-location-id="${locationId}"]`
    );
    if (marker) {
        marker.dataset.isCulled = isCulled.toString();
        marker.classList.toggle("spawn-point-culled", isCulled);
        marker.title = `湧き潰し: ${isCulled ? "済" : "未"}`;
    }
}

function drawSpawnPoint(point, spawnCullStatus, mobNo, rank, isLastOne, isS_LastOne) {
    const pointStatus = spawnCullStatus?.[point.id];
    const culledTimeMs = pointStatus?.culled_at?.toMillis() || 0;
    const uncullTimeMs = pointStatus?.uncull_at?.toMillis() || 0;
    const isCulled = culledTimeMs > uncullTimeMs;

    const isS_A_Cullable = point.mob_ranks.some(r => r === "S" || r === "A");
    const isB_Only = point.mob_ranks.every(r => r.startsWith("B"));

    let sizeClass = "";
    let colorClass = "";
    let specialClass = "";
    let dataIsInteractive = "false";

    if (isLastOne) {
        sizeClass = "spawn-point-lastone";
        colorClass = "color-lastone";
        specialClass = "spawn-point-shadow-lastone spawn-point-interactive";
        dataIsInteractive = "true";
    } else if (isS_A_Cullable) {
        const rankB = point.mob_ranks.find(r => r.startsWith("B"));
        colorClass = rankB === "B1" ? "color-b1" : "color-b2";
        sizeClass = "spawn-point-sa";
        if (isCulled) {
            specialClass = "culled-with-white-border spawn-point-culled";
            dataIsInteractive = "false";
        } else {
            specialClass = "spawn-point-shadow-sa spawn-point-interactive";
            dataIsInteractive = "true";
        }
    } else if (isB_Only) {
        const rankB = point.mob_ranks[0];
        sizeClass = "spawn-point-b-only";
        if (isS_LastOne) {
            colorClass = "color-b-inverted";
        } else {
            colorClass = rankB === "B1" ? "color-b1-only" : "color-b2-only";
        }
        specialClass = "spawn-point-b-border";
        dataIsInteractive = "false";
    }

    return `
    <div class="spawn-point ${sizeClass} ${colorClass} ${specialClass}"
         style="left:${point.x}%; top:${point.y}%;"
         data-location-id="${point.id}"
         data-mob-no="${mobNo}"
         data-rank="${rank}"
         data-is-culled="${isCulled}"
         data-is-interactive="${dataIsInteractive}"
         tabindex="0">
    </div>
  `;
}

function attachLocationEvents() {
    const overlayContainers = document.querySelectorAll(".map-overlay");
    if (!overlayContainers.length) return;

    overlayContainers.forEach(overlay => {
        overlay.removeEventListener("click", handleCrushToggle);
        overlay.addEventListener("click", handleCrushToggle);
    });
}

export { drawSpawnPoint, handleCrushToggle, updateCrushUI, attachLocationEvents };
