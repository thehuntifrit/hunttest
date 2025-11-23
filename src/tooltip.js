// tooltip.js

export function initTooltip() {
    // ツールチップ要素を作成
    const tooltip = document.createElement("div");
    tooltip.id = "custom-tooltip";
    tooltip.className = "custom-tooltip hidden";
    document.body.appendChild(tooltip);

    let currentTarget = null;

    // マウス移動時の処理
    document.addEventListener("mousemove", (e) => {
        if (!currentTarget) return;

        // マウス位置より上に表示 (オフセット調整)
        const offset = 15;
        const x = e.clientX;
        const y = e.clientY - offset;

        tooltip.style.left = `${x}px`;
        tooltip.style.top = `${y}px`;
    });

    // マウスオーバー時の処理 (委譲)
    document.addEventListener("mouseover", (e) => {
        const target = e.target.closest("[data-tooltip]");
        if (!target) return;

        const text = target.getAttribute("data-tooltip");
        if (!text) return;

        currentTarget = target;
        tooltip.textContent = text;
        tooltip.classList.remove("hidden");

        // 初期位置設定
        const offset = 15;
        tooltip.style.left = `${e.clientX}px`;
        tooltip.style.top = `${e.clientY - offset}px`;
    });

    // マウスアウト時の処理 (委譲)
    document.addEventListener("mouseout", (e) => {
        const target = e.target.closest("[data-tooltip]");
        if (target && target === currentTarget) {
            currentTarget = null;
            tooltip.classList.add("hidden");
        }
    });
}
