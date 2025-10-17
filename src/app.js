// app.js
import { setupApp } from "./dataManager.js";
import { attachEventListeners } from "./uiEvents.js";
import { DOM } from "./uiShared.js";

document.addEventListener("DOMContentLoaded", () => {
  attachEventListeners();

  // 初期タブのclickCount整備（localStorage復元に合わせる）
  DOM.rankTabs.querySelectorAll(".tab-button").forEach(btn => {
    // 復元rankと一致するものは1、それ以外は0
    const currentRank = JSON.parse(localStorage.getItem("huntFilterState"))?.rank || "ALL";
    btn.dataset.clickCount = btn.dataset.rank === currentRank ? "1" : "0";
  });

  setupApp();
});
