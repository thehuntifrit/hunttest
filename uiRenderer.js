/**
 * uiRenderer.js - クライアント側 UIレンダリングモジュール
 * 責務: DOM操作、データ表示、イベントリスナーの設定
 */

// 必要なDOM要素のIDを定義 (HTML側でこれらのIDが用意されていることを前提とする)
const DOM_IDS = {
    MOB_LIST_CONTAINER: 'mob-list-container',
    DETAIL_VIEW_CONTAINER: 'detail-view-container',
    REPORT_FORM_ID: 'report-form',
    REPORTER_UID_INPUT: 'reporter-uid-input', // 認証情報がない場合を考慮し、UIDを仮置きする
};

let _dataManager = null;
let _spawnTimerInterval = null; // カウントダウンタイマー用のインターバルID

// --- ユーティリティ関数 ---

/**
 * HTML要素を安全に取得する
 * @param {string} id 要素のID
 * @returns {HTMLElement | null}
 */
const getElement = (id) => document.getElementById(id);

/**
 * タイムスタンプを人が読みやすい形式に整形する
 * @param {Timestamp | null} timestamp Firestore Timestampオブジェクト
 * @returns {string} 整形された日時文字列
 */
const formatKillTime = (timestamp) => {
    if (!timestamp) return '---';
    const date = timestamp.toDate();
    return date.toLocaleString('ja-JP', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        month: '2-digit', day: '2-digit',
    });
};

// --- レンダリングロジック ---

/**
 * 予測湧き時刻に基づき、リポップまでの残り時間を計算・表示する
 * この関数は setInterval で定期的に呼び出される
 */
export const updateSpawnTimer = () => {
    if (!_dataManager) return;
    
    const globalData = _dataManager.getGlobalMobData();

    for (const mobId in globalData) {
        const mobData = globalData[mobId];
        // dataManagerの計算関数を利用
        const { min: minDate, max: maxDate } = _dataManager.calculateNextSpawn(mobId);
        
        const timerElement = getElement(`timer-${mobId}`);
        if (!timerElement || !minDate || !maxDate) continue;

        const now = Date.now();
        
        // 最小湧き時間までの残り時間
        const minRemainingMs = minDate.getTime() - now;
        
        let timerText = '';

        if (minRemainingMs > 0) {
            // 最小湧き前: 残り時間を表示
            const hours = Math.floor(minRemainingMs / (1000 * 60 * 60));
            const minutes = Math.floor((minRemainingMs % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((minRemainingMs % (1000 * 60)) / 1000);
            
            timerText = `湧きまで: ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            timerElement.classList.remove('spawned', 'expired');
            timerElement.classList.add('imminent'); // 湧き前
        } else if (now >= minDate.getTime() && now < maxDate.getTime()) {
            // 湧き期間中: 湧き中メッセージと最大湧き時間までの残り時間を表示
            timerText = '★ 湧き期間中 ★';
            timerElement.classList.add('spawned');
            timerElement.classList.remove('imminent', 'expired');
        } else {
            // 最大湧き時間を超過: 期限切れメッセージ
            timerText = '--- (湧き時間超過) ---';
            timerElement.classList.add('expired');
            timerElement.classList.remove('imminent', 'spawned');
        }

        timerElement.textContent = timerText;
    }
};


/**
 * Mob 一覧内の個別の Mob カードの HTML 要素を生成/更新する
 * @param {Object} mobData 単一 Mob のデータ
 * @returns {HTMLElement} Mob カードのDOM要素
 */
const _renderMobCard = (mobData) => {
    const cardId = `mob-card-${mobData.id}`;
    let card = getElement(cardId);

    if (!card) {
        // 新規作成
        card = document.createElement('div');
        card.id = cardId;
        card.className = `mob-card mob-rank-${mobData.rankId}`; // 例: mob-rank-s
        
        card.innerHTML = `
            <h3>${mobData.name} (${mobData.map})</h3>
            <p>最終討伐: <span id="kill-time-${mobData.id}">${formatKillTime(mobData.current_kill_time)}</span></p>
            <p class="timer-display" id="timer-${mobData.id}">--:--:--</p>
            <p class="memo-display" id="memo-${mobData.id}">${mobData.current_kill_memo || '報告なし'}</p>
            <button class="detail-button" data-mob-id="${mobData.id}">詳細/報告</button>
        `;
        // 詳細ボタンにイベントリスナーを付与
        card.querySelector('.detail-button').addEventListener('click', (e) => {
            renderDetailView(e.target.dataset.mobId);
        });
    } else {
        // 更新 (差分のみ)
        getElement(`kill-time-${mobData.id}`).textContent = formatKillTime(mobData.current_kill_time);
        getElement(`memo-${mobData.id}`).textContent = mobData.current_kill_memo || '報告なし';
        // タイマーは updateSpawnTimer() が担当するためここでは更新しない
    }

    return card;
};

/**
 * Mob 一覧（リストビュー）全体をレンダリングまたは更新する
 * @param {Object} globalMobData 全体のMobデータ
 */
export const renderMobList = (globalMobData) => {
    const container = getElement(DOM_IDS.MOB_LIST_CONTAINER);
    if (!container) return;

    // Mob IDのソート順を定義（例: ランク > ID昇順）
    const sortedMobIds = Object.keys(globalMobData).sort((a, b) => {
        // ランクが低い順 (A<S<FATE) にソートするロジックを仮定
        if (a.charAt(1) !== b.charAt(1)) {
            return a.charAt(1).localeCompare(b.charAt(1));
        }
        return a.localeCompare(b);
    });

    // 既存のカードを保持するためのフラグをリセット
    const existingCards = new Set(Array.from(container.children).map(c => c.id));

    sortedMobIds.forEach(mobId => {
        const card = _renderMobCard(globalMobData[mobId]);
        
        if (!existingCards.has(card.id)) {
            // 新規カードの場合のみ追加 (DOM操作を最小化)
            container.appendChild(card);
        } else {
            // 既に存在する場合は、正しい位置に移動させる（ソート順維持のため）
            container.appendChild(card); // appendChildは要素を移動させる
            existingCards.delete(card.id);
        }
    });
};

/**
 * 詳細画面を開き、関連データを表示する
 * @param {string} mobId Mob ID
 */
export const renderDetailView = (mobId) => {
    const container = getElement(DOM_IDS.DETAIL_VIEW_CONTAINER);
    const mobData = _dataManager.getGlobalMobData()[mobId];
    if (!container || !mobData) return;

    // リストを非表示にし、詳細を表示するUI制御を想定
    getElement(DOM_IDS.MOB_LIST_CONTAINER).style.display = 'none'; 
    container.style.display = 'block';

    // 詳細ビューの内容を構築
    container.innerHTML = `
        <h2>${mobData.name} (${mobData.map}) 詳細</h2>
        <button id="back-to-list">一覧に戻る</button>
        
        <section>
            <h3>討伐報告</h3>
            <form id="${DOM_IDS.REPORT_FORM_ID}">
                <label for="memo">メモ:</label>
                <input type="text" id="memo-input" name="memo" required>
                <input type="hidden" id="report-mob-id" value="${mobId}">
                <button type="submit">報告する</button>
            </form>
        </section>

        <section>
            <h3>湧き潰しポイント (${mobData.rankId === '2' ? 'Sランク' : '対象外'})</h3>
            <div id="crush-map-container-${mobId}">
                </div>
        </section>
        
        <section>
             <h3>過去ログ (サーバーから取得)</h3>
             <ul id="mob-log-list">
                 <li>（ログは別途取得/表示する必要がある）</li>
             </ul>
        </section>
    `;

    // 一覧に戻るボタンのイベントリスナー
    getElement('back-to-list').addEventListener('click', () => {
        container.style.display = 'none';
        getElement(DOM_IDS.MOB_LIST_CONTAINER).style.display = 'block';
    });

    // 湧き潰しマップのレンダリングを呼び出す（ここでは省略）
    // if (mobData.rankId === '2') _renderCrushMap(mobData);
};


// --- イベントハンドリング ---

/**
 * ユーザー操作に対するイベントリスナーを設定する
 * @param {Object} dataManager dataManagerモジュール
 */
export const bindEventListeners = (dataManager) => {
    // 討伐報告フォームの送信イベント
    const form = getElement(DOM_IDS.REPORT_FORM_ID);
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const mobId = getElement('report-mob-id').value;
            const memo = getElement('memo-input').value;
            const reporterUID = getElement(DOM_IDS.REPORTER_UID_INPUT)?.value || 'anonymous-user'; // 仮のUID
            
            try {
                const reportId = await dataManager.submitHuntReport(mobId, memo, reporterUID);
                alert(`討伐報告が完了しました。Reports ID: ${reportId}`);
                // 成功後、フォームをリセットし、詳細ビューを閉じるなどの処理を行う
                form.reset();
                renderMobList(dataManager.getGlobalMobData()); // リストを再表示
            } catch (error) {
                alert(`報告に失敗しました: ${error.message}`);
                console.error('Report submission failed:', error);
            }
        });
    }

    // 湧き潰しトグルのイベントリスナー（湧き潰しマップのレンダリング関数内で設定されることを想定）
};

// --- 初期化 ---

/**
 * UI Rendererを初期化する
 * @param {Object} dataManager dataManagerモジュール
 */
export const initialize = (dataManager) => {
    _dataManager = dataManager;
    
    // 1. データ変更時のコールバックを設定 (Storeパターン購読)
    dataManager.addListener(() => {
        renderMobList(dataManager.getGlobalMobData());
    });
    
    // 2. イベントリスナーを設定
    bindEventListeners(dataManager);

    // 3. スポーンタイマーを起動
    if (_spawnTimerInterval) clearInterval(_spawnTimerInterval);
    _spawnTimerInterval = setInterval(updateSpawnTimer, 1000);
    
    console.log('uiRenderer initialized and subscribed to dataManager.');
};
