// tooltip.js

let tooltip = null;
let currentTarget = null;

export function initTooltip() {
    tooltip = document.createElement("div");
    tooltip.id = "custom-tooltip";
    tooltip.className = "custom-tooltip hidden";
    document.body.appendChild(tooltip);

    document.addEventListener("mousemove", (e) => {
        if (!currentTarget) return;

        const offset = 15;
        const x = e.clientX;
        const y = e.clientY - offset;

        tooltip.style.left = `${x}px`;
        tooltip.style.top = `${y}px`;
    });

    document.addEventListener("mouseover", (e) => {
        const target = e.target.closest("[data-tooltip]");
        if (!target) return;

        const text = target.getAttribute("data-tooltip");
        if (!text) return;

        currentTarget = target;
        tooltip.textContent = text;
        tooltip.classList.remove("hidden");

        const offset = 15;
        tooltip.style.left = `${e.clientX}px`;
        tooltip.style.top = `${e.clientY - offset}px`;
    });

    document.addEventListener("mouseout", (e) => {
        const target = e.target.closest("[data-tooltip]");
        if (target && target === currentTarget) {
            currentTarget = null;
            tooltip.classList.add("hidden");
        }
    });
}

export function hideTooltip() {
    if (tooltip) {
        tooltip.classList.add("hidden");
    }
    currentTarget = null;
}
