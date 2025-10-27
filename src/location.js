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

function updateCrushUI(mobNo, locationId, isCulled) {
  const marker = document.querySelector(
    `.spawn-point[data-mob-no="${mobNo}"][data-location-id="${locationId}"]`
  );
  if (!marker) return;

  if (marker.dataset.isLastone === "true") {
    // ラストワンは湧き潰し対象外
    marker.dataset.isCulled = "false";
    marker.classList.remove("spawn-point-culled");
    marker.title = "ラストワン（湧き潰し不可）";
    return;
  }

  marker.dataset.isCulled = isCulled.toString();
  marker.classList.toggle("spawn-point-culled", isCulled);
  marker.title = `湧き潰し: ${isCulled ? "済" : "未"}`;
}

function drawSpawnPoint(point, spawnCullStatus, mobNo, rank, isLastOne, isS_LastOne) {
  const pointStatus = spawnCullStatus?.[point.id];
  const isCulledFlag = isCulled(pointStatus);

  const isS_A_Cullable = point.mob_ranks.some(r => r === "S" || r === "A");
  const isB_Only = point.mob_ranks.every(r => r.startsWith("B"));

  let sizeClass = "";
  let colorClass = "";
  let extraClass = "";
  let dataIsInteractive = "false";

  if (isLastOne) {
    sizeClass = "spawn-point-lastone";
    colorClass = "color-lastone";
    dataIsInteractive = "false";

  } else if (isS_A_Cullable) {
    const rankB = point.mob_ranks.find(r => r.startsWith("B"));
    colorClass = rankB === "B1" ? "color-b1" : "color-b2";
    sizeClass = "spawn-point-sa";
    if (isCulledFlag) extraClass = "spawn-point-culled";
    dataIsInteractive = "true";

  } else if (isB_Only) {
    const rankB = point.mob_ranks[0];
    sizeClass = "spawn-point-b-only";
    colorClass = rankB === "B1" ? "color-b1-only" : "color-b2-only";
    dataIsInteractive = "false";
  }

  return `
    <div class="spawn-point ${sizeClass} ${colorClass} ${extraClass}"
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

function attachLocationEvents() {
    const overlayContainers = document.querySelectorAll(".map-overlay");
    if (!overlayContainers.length) return;

    overlayContainers.forEach(overlay => {
        overlay.removeEventListener("click", handleCrushToggle);
        overlay.addEventListener("click", handleCrushToggle);
    });
}

export { isCulled, drawSpawnPoint, handleCrushToggle, updateCrushUI, attachLocationEvents };
