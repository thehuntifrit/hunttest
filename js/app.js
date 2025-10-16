/**
 * app.js - アプリケーションのエントリーポイントと初期化
 */

import * as DataManager from './dataManager.js';
import * as UIRenderer from './uiRenderer.js';
import { initialize as authInitialize } from './firebaseAuth.js'; 

const appContainer = document.getElementById('app-container');

// エラー発生時にUIにメッセージを表示するハンドラ
const handleAppError = (error) => {
    console.error("Critical Application Error:", error);
    if (appContainer) {
        appContainer.innerHTML = `
            <div class="error-message">
                <h2>データのロードに失敗しました</h2>
                <p>時間をおいて再度アクセスするか、設定を確認してください。</p>
                <p>詳細: ${error.message || '不明なエラー'}</p>
            </div>
        `;
    }
};

const main = async () => {
    // 認証情報の初期化
    await authInitialize(); 

    try {
        // DataManagerを初期化する前にエラーリスナーを登録
        DataManager.addErrorListener(handleAppError); 

        // データマネージャーの初期化（静的データロード後、即座にUIに通知が行く）
        await DataManager.initialize();
        
        // UIレンダラーの初期化（DataManagerからの更新を受け取る）
        UIRenderer.initialize(DataManager); 
        
    } catch (error) {
        handleAppError(error);
    }
};

document.addEventListener("DOMContentLoaded", main);
