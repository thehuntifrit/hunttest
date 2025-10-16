/**
 * uiRenderer.js
 */

let _dataManager = null;
const listContainer = document.getElementById('mob-list-container');
const detailContainer = document.getElementById('detail-view-container');

const formatTime = (totalSeconds) => {
    if (totalSeconds === null) return 'N/A';
    
    const absTotalSeconds = Math.abs(totalSeconds);
    
    const seconds = Math.floor(absTotalSeconds % 60);
    const minutes = Math.floor((absTotalSeconds / 60) % 60);
    const hours = Math.floor(absTotalSeconds / 3600);
    
    return [hours, minutes, seconds]
           .map(v => v < 10 ? '0' + v : v)
           .join(':');
};

export const initialize = (dataManager) => {
    console.log("UIRenderer.initialize called");
    _dataManager = dataManager;
    
    // ロード中メッセージをクリア
    if (listContainer) {
        listContainer.innerHTML = '';
    }
    
    _dataManager.addListener(_renderMobList); 
    _setupGlobalEvents();
};

const _renderMobList = (mobData) => { 
    console.log("UI RENDER: Function started. Count:", Object.keys(mobData).length);
    if (!listContainer) return;
    
    if (Object.keys(mobData).length === 0) {
        listContainer.innerHTML = '<p>Mobデータが設定されていません。</p>';
        return;
    }
    
    listContainer.innerHTML = '';
    
    console.log("UI RENDER: Starting sort.");
    
    const mobArray = Object.values(mobData).sort((a, b) => {
        const rankOrder = { 'S': 1, 'A': 2, 'F': 3 };
        if (rankOrder[a.rank] !== rankOrder[b.rank]) {
            return rankOrder[a.rank] - rankOrder[b.rank];
        }
        if (a.timerState === 'imminent' && b.timerState === 'imminent') {
             return a.timeRemainingSeconds - b.timeRemainingSeconds;
        }
        return 0;
    });

    mobArray.forEach(mob => {
        const card = _createMobCard(mob);
        listContainer.appendChild(card);
        console.log("RENDER DEBUG: Card appended for:", mob.name);
    });
};

const _createMobCard = (mob) => {
    const card = document.createElement('div');
    const timerClass = mob.timerState;
    const displayTime = mob.timeRemainingSeconds;
    
    let timerText = '';
    
    if (mob.currentKillTime === null) {
        timerText = '討伐報告待ち';
    } else if (timerClass === 'imminent') {
        timerText = `湧きまで: ${formatTime(displayTime)}`;
    } else if (timerClass === 'spawned') {
        timerText = `湧き期間中 (残り: ${formatTime(displayTime)})`; 
    } else if (timerClass === 'expired') {
        timerText = `最大湧き時間超過`; 
    } else {
        timerText = '計算不能';
    }

    card.className = `mob-card mob-rank-${mob.rank === 'S' ? 2 : mob.rank === 'A' ? 1 : 3}`;
    card.dataset.mobId = mob.id;

    card.innerHTML = `
        <h3>${mob.name} (${mob.rank})</h3>
        <p>${mob.area}</p>
        <div class="timer-display ${timerClass}">
            ${timerText}
        </div>
        <div class="memo-display">
            最終報告: ${mob.currentKillMemo || 'なし'}
        </div>
        <button class="view-detail-btn">詳細を見る</button>
    `;
    return card;
};

const _setupGlobalEvents = () => {
    listContainer.addEventListener('click', (e) => {
        const button = e.target.closest('.view-detail-btn');
        if (button) {
             const mobId = e.target.closest('.mob-card').dataset.mobId;
             _renderDetailView(mobId);
        }
    });
};

const _showDetailView = () => {
    document.getElementById('mob-list-section').style.display = 'none';
    document.getElementById('detail-section').style.display = 'block';
};

const _hideDetailView = () => {
    document.getElementById('mob-list-section').style.display = 'block';
    document.getElementById('detail-section').style.display = 'none';
};

const _renderDetailView = (mobId) => {
    const mobData = _dataManager.getGlobalMobData()[mobId];
    if (!detailContainer || !mobData) return;
    
    _showDetailView();

    detailContainer.innerHTML = `
        <h2>${mobData.name} (${mobData.area}) 詳細</h2> 
        <button id="back-to-list">一覧に戻る</button>
        
        <section id="report-form-section">
            <h3>討伐報告</h3>
            <p><strong>湧き条件:</strong> ${mobData.condition || '不明'}</p>
            <div id="report-form-status"></div>
            <form id="report-form">
                <input type="hidden" id="report-mob-id" value="${mobId}">
                <label for="memo">メモ (任意):</label>
                <input type="text" id="memo" placeholder="討伐メモ、次回の予想など">
                <button type="submit">討伐を報告</button>
            </form>
        </section>

        <section id="crush-point-section">
            <h3>湧き潰しポイント (${mobData.rank === 'S' ? 'Sランク' : '対象外'})</h3>
            <div class="map-container" id="map-container-${mobId}">
                ${mobData.mapImage ? `<img src="maps/${mobData.mapImage}"` : `<img src="maps/default.webp"`}
                     alt="${mobData.area} マップ" class="hunt-map-image"> 
                
                <div class="point-overlay-container" id="point-overlay-${mobId}">
                </div>
            </div>
            
            <div id="crush-point-list-${mobId}">
            </div>
        </section>
        
        <section id="log-section">
              <h3>過去の報告ログ</h3>
              <p>（このセクションは、将来的に過去ログを表示するために使用されます。）</p>
        </section>
    `;

    _bindDetailEvents(mobId); 

    if (mobData.rank === 'S') {
        _renderCrushPoints(mobData);
    }
};

const _bindDetailEvents = (mobId) => {
    const backButton = document.getElementById('back-to-list');
    if (backButton) {
        backButton.addEventListener('click', _hideDetailView);
    }

    const form = document.getElementById('report-form');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const memo = document.getElementById('memo').value.trim();
            const reporterUIDInput = document.getElementById('reporter-uid-input');
            const reporterUID = reporterUIDInput ? reporterUIDInput.value : null;
            
            if (!reporterUID) {
                 alert('認証情報が見つかりません。匿名認証が完了しているか確認してください。');
                 return;
            }

            try {
                // dataManager.js側で reporterUID は不要になったため、引数から削除
                const reportId = await _dataManager.submitHuntReport(mobId, memo); 
                alert(`討伐を報告しました！ (ID: ${reportId.substring(0, 8)}...)`);
                form.reset();
                document.getElementById('report-form-status').innerHTML = `<p style="color:green;">報告成功!</p>`;
            } catch (error) {
                console.error("報告エラー:", error);
                document.getElementById('report-form-status').innerHTML = `<p style="color:red;">報告に失敗しました。</p>`;
            }
        });
    }
};

const _renderCrushPoints = (mobData) => {
    const staticPoints = mobData.locations;
    const crushStatus = mobData.crushPointsStatus || {}; 
    const overlayContainer = document.getElementById(`point-overlay-${mobData.id}`);
    
    if (!overlayContainer || !staticPoints) return;

    overlayContainer.innerHTML = '';

    staticPoints.forEach(point => {
        const pointElement = document.createElement('div');
        pointElement.className = 'crush-point';
        pointElement.id = `crush-point-${point.id}`;
        
        pointElement.style.left = `${point.x}%`; 
        pointElement.style.top = `${point.y}%`; 

        const isCrushed = crushStatus[point.id] === true;
        if (isCrushed) {
            pointElement.classList.add('crushed');
        }

        pointElement.setAttribute('title', point.name || point.id); 

        pointElement.addEventListener('click', async () => {
            const action = isCrushed ? 'remove' : 'add';
            try {
                await _dataManager.updateCrushStatus(mobData.id, point.id, action);
            } catch (error) {
                console.error("湧き潰し状態の更新に失敗:", error);
                alert('湧き潰し状態の更新に失敗しました。');
            }
        });

        overlayContainer.appendChild(pointElement);
    });
};
