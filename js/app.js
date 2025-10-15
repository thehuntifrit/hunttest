/**
 * app.js - アプリケーションのエントリポイント
 */

import { getAuth, onAuthStateChanged, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'; 

import { app } from './firebaseConfig'; // 相対パスは維持
import * as DataManager from './dataManager'; 
import * as UIRenderer from './uiRenderer';

let _auth = null;

// --- 認証処理 (簡易版) ---
const _setupUserAuthentication = async () => {
    // ... (関数の中身は変更なし)
    _auth = getAuth(app);
    return new Promise((resolve) => {
        onAuthStateChanged(_auth, (user) => {
            if (user) {
                // ...
                resolve(user);
            } else {
                // ...
                signInAnonymously(_auth).then((credentials) => {
                    // ...
                    resolve(credentials.user);
                }).catch((error) => {
                    // ...
                    resolve(null);
                });
            }
        });
    });
};

// --- アプリケーション起動シーケンス ---
const main = async () => {
    // ... (関数の中身は変更なし)
    try {
        const user = await _setupUserAuthentication();
        
        // ...
        
        await DataManager.initialize();

        UIRenderer.initialize(DataManager);

    } catch (error) {
        // ...
    }
};

const startApp = () => {
    document.addEventListener('DOMContentLoaded', main);
};

startApp();
