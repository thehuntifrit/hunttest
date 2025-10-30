// location.js

import { DOM } from "./uiRender.js";
import { toggleCrushStatus } from "./server.js";
import { getState } from "./dataManager.js"; 

function handleCrushToggle(e) {
    // ★ デバッグログ (1): 関数が呼ばれているか確認
    console.log("handleCrushToggle called", e.target); 
    
    const point = e.target.closest(".spawn-point");
    // 湧き地点マーカーがクリックされていなければ処理しない
    if (!point) return; 

    // 湧き潰し非インタラクティブな地点なら処理しない
    if (point.dataset.isInteractive !== "true") return;

    // Mob Cardを取得（spawn-pointはmob-card内にある想定）
    const card = e.target.closest(".mob-card"); 
    
    // ★ Mob Cardが取得できない場合（予期せぬDOM構造）はエラーとして停止
    if (!card) {
        console.error("FATAL: Mob card (.mob-card) not found for interactive spawn point click.");
        return;
    }
    
    // イベントの伝播とデフォルト動作を停止
    e.preventDefault();
    e.stopPropagation();

    const mobNo = parseInt(card.dataset.mobNo, 10);
    const locationId = point.dataset.locationId;
    const isCurrentlyCulled = point.dataset.isCulled === "true";
    
    // ★ デバッグログ (2): サーバー送信関数が呼ばれる直前
    console.log(`Cull action detected for Mob: ${mobNo}, Location: ${locationId}, Culling: ${!isCurrentlyCulled}`);

    // サーバーへの送信
    toggleCrushStatus(mobNo, locationId, isCurrentlyCulled);
}

function isCulled(pointStatus, mobLastKillTime) {
    const culledMs = pointStatus?.culled_at ? pointStatus.culled_at.toMillis() : 0;
    const uncullMs = pointStatus?.uncull_at ? pointStatus.uncull_at.toMillis() : 0;
    const lastKillMs = mobLastKillTime && typeof mobLastKillTime.toMillis === 'function' 
                         ? mobLastKillTime.toMillis() : 0;
    
    if (culledMs === 0 && uncullMs === 0) return false;
    
    // --- 判定ロジック ---
    // 1. 各操作がLKTより新しいかを確認 (リセット判定)
    const isCulledValid = culledMs > lastKillMs;
    const isUnculledValid = uncullMs > lastKillMs;
    // 2. 有効な操作同士で比較
    if (isCulledValid && (!isUnculledValid || culledMs > uncullMs)) {
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
    const state = getState();
    const mobLocationsData = state.mobLocations?.[mobNo];
    const mobLastKillTime = mobLocationsData?.last_kill_time || null; 
    
    const isCulledFlag = isCulled(pointStatus, mobLastKillTime); 
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
    const isS_A_Cullable = marker.dataset.isInteractive === "true" && !marker.dataset.isLastone;

    // S/Aランクの湧き潰しマーカーの色変更ロジック
    if (isS_A_Cullable) {
         if (isCulled) {
             marker.classList.remove("color-b1", "color-b2");
             marker.classList.add(rank === "B1" ? "color-b1-culled" : "color-b2-culled");
         } else {
             marker.classList.remove("color-b1-culled", "color-b2-culled");
             marker.classList.add(rank === "B1" ? "color-b1" : "color-b2");
         }
    }
    
    // Bランク単独マーカーは湧き潰し対象外のため、ここはS/Aランクの処理と見なす
    
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
