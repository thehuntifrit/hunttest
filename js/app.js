/**
 * app.js
 */

import * as DataManager from './dataManager.js';
import * as UIRenderer from './uiRenderer.js';
import { initialize as authInitialize } from './firebaseAuth.js'; 

const appContainer = document.getElementById('app-container');

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
    let reporterUID = null;
    
    try {
        reporterUID = await authInitialize(); 
        
        if (!reporterUID) {
            throw new Error("ユーザー認証に失敗しました。");
        }

        DataManager.addErrorListener(handleAppError); 

        await DataManager.initialize(reporterUID);
        
        UIRenderer.initialize(DataManager);
        
    } catch (error) {
        handleAppError(error);
    }
};

document.addEventListener("DOMContentLoaded", main);
