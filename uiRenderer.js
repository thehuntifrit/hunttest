/**
 * uiRenderer.js
 */

// dataManager.js から提供される_dataManagerを介してデータにアクセスするため、
// Firebaseオブジェクトやconfig定数を直接importする必要はありません。

let _dataManager = null;
const listContainer = document.getElementById('mob-list-container');
const detailContainer = document.getElementById('detail-view-container');

const getElement = (id) => document.getElementById(id);

const formatTime = (totalSeconds) => {
    if (totalSeconds === null) return 'N/A';
    const seconds = Math.floor(totalSeconds % 60);
    const minutes = Math.floor((totalSeconds / 60) % 60);
    const hours = Math.floor(totalSeconds / 3600);
    
    const sign = totalSeconds < 0 ? '-' : '';
    const absSeconds = Math.abs(seconds);
    const absMinutes = Math.abs(minutes);
    const absHours = Math.abs(hours);

    return sign + 
           [absHours, absMinutes, absSeconds]
           .map(v => v < 10 ? '0' + v : v)
           .join(':');
};

export const initialize = (dataManager) => {
    _dataManager = dataManager;
    _dataManager.addListener(renderMobList);
};

export const renderMobList = (mobData) => {
    if (!listContainer) return;
    
    if (Object.keys(mobData).length === 0) {
        listContainer.innerHTML = '<p>データをロード中...</p>';
        return;
    }
    
    listContainer.innerHTML = '';
    const mobArray = Object.values(mobData).sort((a, b) => {
        const rankOrder = { 'S': 1, 'A': 2, 'FATE': 3 };
        if (rankOrder[a.rank] !== rankOrder[b.rank]) {
            return rankOrder[a.rank] - rankOrder[b.rank];
        }
        if (a.timer_state === 'imminent' && b.timer_state === 'imminent') {
             return a.time_remaining_seconds - b.time_remaining_seconds;
        }
        return 0;
    });

    mobArray.forEach(mob => {
        const card = _createMobCard(mob);
        listContainer.appendChild(card);
    });

    _bindCardEvents();
};

const _createMobCard = (mob) => {
    const card = document.createElement('div');
    const timerClass = mob.timer_state;
    const displayTime = mob.time_remaining_seconds;
    
    let timerText = '';
    if (mob.current_kill_time === null) {
        timerText = '討伐報告待ち';
    } else if (timerClass === 'imminent') {
        timerText = `湧きまで: ${formatTime(displayTime)}`;
    } else if (timerClass === 'spawned') {
        timerText = `湧き期間中 (経過: ${formatTime(displayTime)})`;
    } else if (timerClass === 'expired') {
        timerText = `最大湧き時間超過 (+${formatTime(displayTime)})`;
    } else {
        timerText = '計算不能';
    }

    card.className = `mob-card mob-rank-${mob.rank === 'S' ? 2 : mob.rank === 'A' ? 1 : 3}`;
    card.dataset.mobId = mob.id;

    card.innerHTML = `
        <h3>${mob.name} (${mob.rank})</h3>
        <p>${mob.map_area_name}</p>
        <div class="timer-display ${timerClass}">
            ${timerText}
        </div>
        <div class="memo-display">
            最終報告: ${mob.current_kill_memo || 'なし'}
        </div>
        <button class="view-detail-btn">詳細を見る</button>
    `;
    return card;
};

const _bindCardEvents = () => {
    document.querySelectorAll('.view-detail-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const mobId = e.target.closest('.mob-card').dataset.mobId;
            renderDetailView(mobId);
        });
    });
};

const showDetailView = () => {
    getElement('mob-list-section').style.display = 'none';
    getElement('detail-section').style.display = 'block';
};

const hideDetailView = () => {
    getElement('mob-list-section').style.display = 'block';
    getElement('detail-section').style.display = 'none';
};

export const renderDetailView = (mobId) => {
    const mobData = _dataManager.getGlobalMobData()[mobId];
    if (!detailContainer || !mobData) return;
    
    showDetailView();

    detailContainer.innerHTML = `
        <h2>${mobData.name} (${mobData.map_area_name}) 詳細</h2>
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
                <img src="maps/${mobData.map_image_filename}" 
                     alt="${mobData.map_area_name} マップ" class="hunt-map-image">
                
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
    const backButton = getElement('back-to-list');
    if (backButton) {
        backButton.addEventListener('click', hideDetailView);
    }

    const form = getElement('report-form');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const memo = getElement('memo').value.trim();
            const reporterUID = getElement('reporter-uid-input').value;
            
            if (!reporterUID) {
                 alert('認証情報が見つかりません。匿名認証が完了しているか確認してください。');
                 return;
            }

            try {
                const reportId = await _dataManager.submitHuntReport(mobId, memo, reporterUID);
                alert(`討伐を報告しました！ (ID: ${reportId})`);
                form.reset();
                getElement('report-form-status').innerHTML = `<p style="color:green;">報告成功!</p>`;
            } catch (error) {
                console.error("報告エラー:", error);
                getElement('report-form-status').innerHTML = `<p style="color:red;">報告に失敗しました。</p>`;
            }
        });
    }
};

const _renderCrushPoints = (mobData) => {
    const staticPoints = mobData.locations;
    const crushStatus = mobData.crush_points_status || {}; 
    const overlayContainer = getElement(`point-overlay-${mobData.id}`);
    
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
