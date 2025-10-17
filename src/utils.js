// utils.js
function drawSpawnPoint(point, spawnCullStatus, mobNo, rank, isLastOne, isS_LastOne, lastKillTime, prevKillTime) {
  const culled = spawnCullStatus?.[point.id] === true;
  const classes = [
    "spawn-point",
    culled ? "culled" : "active",
    isLastOne ? "last-one" : "",
    isS_LastOne ? "s-last-one" : ""
  ].join(" ");

  return `
    <div class="${classes}"
         data-location-id="${point.id}"
         data-mob-no="${mobNo}"
         data-rank="${rank}"
         data-is-interactive="true"
         data-is-culled="${culled}">
      <span class="point-label">${point.label || ""}</span>
    </div>
  `;
}

function toJstAdjustedIsoString(date) {
  const offsetMs = date.getTimezoneOffset() * 60000;
  const jstOffsetMs = 9 * 60 * 60 * 1000;
  const jstTime = date.getTime() - offsetMs + jstOffsetMs;
  return new Date(jstTime).toISOString().slice(0, 16);
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h.toString().padStart(2, "0")}h ${m.toString().padStart(2, "0")}m`;
}

function formatLastKillTime(timestamp) {
  if (timestamp === 0) return "未報告";
  const killTimeMs = timestamp * 1000;
  const nowMs = Date.now();
  const diffSeconds = Math.floor((nowMs - killTimeMs) / 1000);
  if (diffSeconds < 3600) {
    if (diffSeconds < 60) return `Just now`;
    const minutes = Math.floor(diffSeconds / 60);
    return `${minutes}m ago`;
  }
  const options = { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" };
  const date = new Date(killTimeMs);
  return new Intl.DateTimeFormat("ja-JP", options).format(date);
}

function processText(text) {
  if (typeof text !== "string" || !text) return "";
  return text.replace(/\/\/\//g, "<br>");
}

function debounce(func, wait) {
  let timeout;
  return function executed(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

function displayStatus(message, type = "info") {
  const el = document.getElementById("status-message");
  if (!el) return;
  el.textContent = message;
  el.className = `status ${type}`;
  setTimeout(() => { el.textContent = ""; }, 5000);
}

export { drawSpawnPoint, displayStatus, toJstAdjustedIsoString, formatDuration, formatLastKillTime, processText, debounce };
