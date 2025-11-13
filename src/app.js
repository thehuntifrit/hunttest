// app.js

import { getState, setFilter, loadBaseMobData, setOpenMobCardNo, FILTER_TO_DATA_RANK_MAP, setUserId, startRealtime, onMemoChange } from "./dataManager.js";
import { openReportModal, closeReportModal, initModal } from "./modal.js";
import { attachLocationEvents } from "./location.js";
import { submitReport, toggleCrushStatus, initializeAuth, getServerTimeUTC, submitMemo } from "./server.js";
import { debounce } from "./cal.js";
import { DOM, filterAndRender, sortAndRedistribute, updateMemoUI } from "./uiRender.js";
import { renderRankTabs, renderAreaFilterPanel, updateFilterUI, handleAreaFilterClick } from "./filterUI.js";

async function loadMaintenance() {
    try {
        const res = await fetch('./maintenance.json', { cache: 'no-store' });
        if (!res.ok) return null;
        const data = await res.json();

        const start = new Date(data.maintenance.start);
        const end = new Date(data.maintenance.end);
        const serverUp = new Date(data.maintenance.serverUp);
        const now = new Date();

        const showFrom = new Date(start.getTime() - 7 * 24 * 60 * 60 * 1000);
        const showUntil = new Date(end.getTime() + 4 * 24 * 60 * 60 * 1000);

        if (now >= showFrom && now <= showUntil) {
            renderStatusBar(start, end, serverUp);
        } else {
            clearStatusBar();
        }

        if (now >= start && now < serverUp) {
            updateMobCards();
        }

        return {
            start,
            end,
            serverUp,
            serverUpSec: serverUp.getTime() / 1000
        };

    } catch (err) {
        console.error('maintenance.json 読み込み失敗:', err);
        return null;
    }
}

function renderStatusBar(start, end, serverUp) {
    const el = document.getElementById("status-message-maintenance");
    if (!el) return;
    el.innerHTML = `
      <div class="font-semibold text-yellow-300">
        メンテナンス予定: ${formatDate(start)} ～ ${formatDate(end)}
      </div>
    `;
    document.getElementById("status-message")?.classList.remove("hidden");
}

function clearStatusBar() {
    const el = document.getElementById("status-message-maintenance");
    if (!el) return;
    el.innerHTML = "";
    const tempEl = document.getElementById("status-message-temp");
    if (!tempEl || tempEl.innerHTML.trim() === "") {
        document.getElementById("status-message")?.classList.add("hidden");
    }
}

function updateMobCards() {
    document.querySelectorAll('.mob-card').forEach(card => {
        card.classList.add('mob-card-disabled');
    });
}

function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}/${m}/${d} ${h}:${min}`;
}

function attachFilterEvents() {
    const tabs = document.getElementById("rank-tabs");
    if (!tabs) return;

    tabs.addEventListener("click", (e) => {
        const btn = e.target.closest(".tab-button");
        if (!btn) return;

        const newRank = btn.dataset.rank.toUpperCase();
        const state = getState();

        const nextAreaSets = { ...state.filter.areaSets };
        if (!(nextAreaSets[newRank] instanceof Set)) {
            nextAreaSets[newRank] = new Set();
        }

        setFilter({
            rank: newRank,
            areaSets: nextAreaSets
        });
        filterAndRender();
    });

    document.getElementById("area-filter-panel-mobile")?.addEventListener("click", handleAreaFilterClick);
    document.getElementById("area-filter-panel-desktop")?.addEventListener("click", handleAreaFilterClick);

}

function attachCardEvents() {
    DOM.colContainer.addEventListener("click", e => {
        const card = e.target.closest(".mob-card");
        if (!card) return;
        const mobNo = parseInt(card.dataset.mobNo, 10);
        const rank = card.dataset.rank;

        // 討伐報告ボタンの処理
        const reportBtn = e.target.closest("button[data-report-type]");
        if (reportBtn) {
            e.stopPropagation();
            const type = reportBtn.dataset.reportType;
            if (type === "modal") {
                openReportModal(mobNo);
            } else if (type === "instant") {
                getServerTimeUTC().then(serverDateUTC => {
                    const iso = serverDateUTC.toISOString();
                    
                    submitReport(mobNo, iso); 
                }).catch(err => {
                    console.error("サーバー時刻取得失敗、ローカル時刻で代用:", err);
                    const fallbackIso = new Date().toISOString();
                    
                    submitReport(mobNo, fallbackIso); 
                });
            }
            return;
        }

        // Sランクメモ表示エリアクリックで編集モードへ
        const memoDisplay = e.target.closest('[data-mob-memo-display][data-action="edit-memo-open"]');
        if (memoDisplay) {
            e.stopPropagation();
            if (rank !== 'S') return;

            const elDisplay = memoDisplay;
            const elEditor = card.querySelector('[data-mob-memo-editor]');
            const elInput = card.querySelector('[data-mob-memo-input]');
            
            // 既に開いている編集モードを閉じる
            document.querySelectorAll('[data-mob-memo-editor]').forEach(editor => {
                if (editor !== elEditor) {
                    editor.style.display = 'none';
                    editor.previousElementSibling.style.display = 'block'; // displayに戻す
                }
            });

            // このカードの編集モードを開く
            elDisplay.style.display = 'none';
            elEditor.style.display = 'block';
            // 入力欄にフォーカス
            elInput.focus();
            return;
        }

        // カードヘッダーの開閉処理
        if (e.target.closest("[data-toggle='card-header']")) {
            if (rank === "S") {
                const panel = card.querySelector(".expandable-panel");
                if (panel) {
                    if (!panel.classList.contains("open")) {
                        document.querySelectorAll(".expandable-panel.open").forEach(p => {
                            if (p.closest(".mob-card") !== card) p.classList.remove("open");
                        });
                        panel.classList.add("open");
                        setOpenMobCardNo(mobNo);
                    } else {
                        panel.classList.remove("open");
                        setOpenMobCardNo(null);
                    }
                }
            }
        }
    });

    // メモ入力欄での Enter キーイベント（送信）と ESC キーイベント（キャンセル）
    DOM.colContainer.addEventListener('keydown', e => {
        const input = e.target.closest('[data-mob-memo-input]');
        if (!input) return;
        const card = input.closest('.mob-card');
        if (!card) return;

        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const submitBtn = card.querySelector('[data-action="edit-memo-submit"]');
            submitBtn?.click();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            const cancelBtn = card.querySelector('[data-action="edit-memo-cancel"]');
            cancelBtn?.click();
        }
    });
}

function attachWindowResizeEvents() {
    window.addEventListener("resize", debounce(() => sortAndRedistribute(), 200));
}

async function handleReportSubmit(e) {
    e.preventDefault();

    const form = e.target;
    const mobNo = parseInt(form.dataset.mobNo, 10);
    const timeISO = form.elements["kill-time"].value;
    
    await submitReport(mobNo, timeISO); 
}

// メモ送信処理
async function handleMemoSubmit(e) {
    e.preventDefault();

    const btn = e.target.closest('[data-action="edit-memo-submit"]');
    if (!btn) return;
    
    const card = btn.closest('.mob-card');
    if (!card) return;
    
    const mobNo = parseInt(card.dataset.mobNo, 10);
    const elInput = card.querySelector('[data-mob-memo-input]');
    const newMemo = elInput.value.trim();

    await submitMemo(mobNo, newMemo);

    const elEditor = card.querySelector('[data-mob-memo-editor]');
    const elDisplay = card.querySelector('[data-mob-memo-display]');
    
    if (elEditor && elDisplay) {
        elEditor.style.display = 'none';
        elDisplay.style.display = 'block';
    }
    
}

// メモ編集キャンセル処理
function handleMemoCancel(e) {
    e.preventDefault();
    
    const btn = e.target.closest('[data-action="edit-memo-cancel"]');
    if (!btn) return;
    
    const card = btn.closest('.mob-card');
    if (!card) return;

    const mobNo = parseInt(card.dataset.mobNo, 10);
    const mob = getState().mobs.find(m => m.No === mobNo);
    
    // updateMemoUI を使って入力内容を破棄し、ディスプレイモードに戻す
    if (mob) updateMemoUI(card, mob);
}

function attachEventListeners() {
    renderRankTabs();
    attachFilterEvents();
    attachCardEvents();
    attachWindowResizeEvents();
    attachLocationEvents();

    if (DOM.reportForm) {
        // 討伐報告フォームのイベント
        DOM.reportForm.addEventListener("submit", handleReportSubmit);
    }
    
    // メモ編集関連のイベントリスナー
    DOM.colContainer.addEventListener('click', e => {
        // 送信ボタン
        if (e.target.closest('[data-action="edit-memo-submit"]')) {
            handleMemoSubmit(e);
        }
        // キャンセルボタン
        if (e.target.closest('[data-action="edit-memo-cancel"]')) {
            handleMemoCancel(e);
        }
    });
}

async function initializeAuthenticationAndRealtime() {
    try {
        const userId = await initializeAuth();
        setUserId(userId);
        startRealtime();
        
        // メモ変更時のリアルタイム購読を開始し、UIを更新する
        onMemoChange((updatedMobMemos) => {
            const state = getState();
            // 全てのモブカードをチェックし、該当するメモを更新
            document.querySelectorAll('.mob-card').forEach(card => {
                const mobNo = parseInt(card.dataset.mobNo, 10);
                const mob = state.mobs.find(m => m.No === mobNo);
                
                // 更新されたメモデータにこのモブが含まれているか確認
                if (mob && updatedMobMemos[mobNo]) {
                    updateMemoUI(card, mob);
                }
            });
        });
        
        console.log("App: 認証とリアルタイム購読を開始しました。");
    } catch (error) {
        console.error("App: 認証処理中にエラーが発生しました。", error);
        setUserId(null);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initializeAuthenticationAndRealtime();
    attachEventListeners?.();
    loadBaseMobData?.();
    initModal?.();
    loadMaintenance();

    const currentRank = JSON.parse(localStorage.getItem('huntFilterState'))?.rank || 'ALL';
    DOM?.rankTabs?.querySelectorAll('.tab-button').forEach(btn => {
        btn.dataset.clickCount = btn.dataset.rank === currentRank ? '1' : '0';
    });
});

export { attachEventListeners, updateMobCards, loadMaintenance };
