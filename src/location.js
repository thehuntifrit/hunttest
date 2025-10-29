// location.js

import { DOM } from "./uiRender.js";
import { toggleCrushStatus } from "./server.js";
import { getState, getMobByNo } from "./dataManager.js"; // getMobByNo は isCulled で使用しないため残すか検討

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

/**
 * 湧き潰し状態を判定する関数
 * @param {object} pointStatus - Mob Locationsから取得した特定の地点の状態 ({ culled_at: Timestamp, uncull_at: Timestamp })
 * @param {Timestamp|null} mobLastKillTime - Mob Locationsドキュメント内のlast_kill_time (Timestampオブジェクト)
 * @returns {boolean} 湧き潰し中であれば true
 */
function isCulled(pointStatus, mobLastKillTime) { // ★ 引数を mobNo から mobLastKillTime に変更
    // 湧き潰し/解除時刻をミリ秒で取得。ない場合は0。
    const culledMs = pointStatus?.culled_at ? pointStatus.culled_at.toMillis() : 0;
    const uncullMs = pointStatus?.uncull_at ? pointStatus.uncull_at.toMillis() : 0;
    
    // Mobの確定時刻(リセット基準)をミリ秒で取得。ない場合は0。
    const lastKillMs = mobLastKillTime && typeof mobLastKillTime.toMillis === 'function' 
                       ? mobLastKillTime.toMillis() : 0; // ★ lastKillTimeを引数から取得

    // データがない場合は湧き潰しではない
    if (culledMs === 0 && uncullMs === 0) return false;
    
    // --- 判定ロジック ---
    
    // 1. 各操作がLKTより新しいかを確認 (リセット判定)
    const isCulledValid = culledMs > lastKillMs;
    const isUnculledValid = uncullMs > lastKillMs;

    // 2. 有効な操作同士で比較
    if (isCulledValid && (!isUnculledValid || culledMs > uncullMs)) {
        // CULL操作がLKTより新しく、かつ、UNCULL操作が無効/LKTより古い/またはCULLより古い
        return true; // 湧き潰し中 (ON)
    }

    // 3. 有効な操作同士で比較
    if (isUnculledValid && (!isCulledValid || uncullMs > culledMs)) {
        // UNCULL操作がLKTより新しく、かつ、CULL操作が無効/LKTより古い/またはUNCULLより古い
        return false; // 湧いている状態 (OFF)
    }
    
    // 4. その他のケース (両方古い=リセットされている)
    return false; // 湧き潰しではない (OFF)
}

function drawSpawnPoint(point, spawnCullStatus, mobNo, rank, isLastOne, isS_LastOne) {
    const pointStatus = spawnCullStatus?.[point.id];
    // ★ Mob Locationsから取得したLKTを、spawnCullStatusに追加されている前提で取得
    // subscribeMobLocations関数で mobLocationsDataMap[mobNo] に last_kill_time が格納されていると仮定
    const state = getState();
    const mobLocationsData = state.mobLocations[mobNo]; 
    const mobLastKillTime = mobLocationsData?.last_kill_time || null; 
    
    const isCulledFlag = isCulled(pointStatus, mobLastKillTime); // ★ LKTを渡すように変更

    const isS_A_Cullable = point.mob_ranks.some(r => r === "S" || r === "A");
// ... (中略、UI描画ロジックは変更なし) ...
    
    // UI描画ロジックは変更なし
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
