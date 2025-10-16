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
        // 既存の内容を上書きし、クリティカルエラーを表示
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

        // データマネージャーの初期化（成功するとリストが表示される）
        await DataManager.initialize();
        
        // UIレンダラーの初期化（DataManagerからの更新を受け取る）
        UIRenderer.initialize(DataManager); 
        
    } catch (error) {
        // DataManager.initialize() 内の catch ブロックで既にエラーリスナーが呼ばれるため、
        // ここは主に未定義のエラーをキャッチするための場所。
        handleAppError(error);
    }
};

document.addEventListener("DOMContentLoaded", main);
