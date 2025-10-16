/**
 * app.js - アプリケーションのエントリポイント
 * 責務: 全モジュールの初期化と連携の統括
 */

import { getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth'; 

import { app } from './firebaseConfig.js';
import * as DataManager from './dataManager.js'; 
import * as UIRenderer from './uiRenderer.js'; 

let _auth = null;

// --- 認証処理 (簡易版) ---
const _setupUserAuthentication = async () => {
    // console.log('Auth: Start checking...'); // ログは削除
    _auth = getAuth(app);

    return new Promise((resolve) => {
        onAuthStateChanged(_auth, (user) => {
            if (user) {
                // console.log('Auth: User is authenticated:', user.uid); // ログは削除
                // console.log('User is authenticated:', user.uid); // ログは削除
                resolve(user);
            } else {
                // console.log('No user detected. Signing in anonymously...'); // ログは削除
                signInAnonymously(_auth).then((credentials) => {
                    // console.log('Signed in anonymously:', credentials.user.uid); // ログは削除
                    resolve(credentials.user);
                }).catch((error) => {
                    console.error('Anonymous sign-in failed:', error);
                    resolve(null);
                });
            }
        });
    });
};

// --- アプリケーション起動シーケンス ---
const main = async () => {
    try {
        // 1. 認証処理
        // console.log('Main: Starting authentication...'); // ログは削除
        const user = await _setupUserAuthentication();
        // console.log('Main: Authentication complete. User:', user ? user.uid : 'null'); // ログは削除
        
        let reporterUID = 'anonymous-user';
        if (user) {
            reporterUID = user.uid;
            
            const uidInput = document.getElementById('reporter-uid-input');
            if (uidInput) {
                uidInput.value = reporterUID;
                document.getElementById('auth-status').textContent = `認証済み (UID: ${user.uid.substring(0, 8)}...)`;
            }
        } else {
             document.getElementById('auth-status').textContent = '認証失敗';
        }
        
        // 2. DataManagerの初期化
        // console.log('Initializing DataManager...'); // ログは削除
        await DataManager.initialize();
        // console.log('DataManager initialized successfully.'); // ログは削除

        // 3. UIRendererの初期化と連携
        // console.log('Initializing UIRenderer...'); // ログは削除
        UIRenderer.initialize(DataManager);
        // console.log('UIRenderer initialized successfully.'); // ログは削除

    } catch (error) {
        console.error('Application failed to start during main sequence:', error);
        document.getElementById('auth-status').textContent = '認証失敗';
        alert('アプリケーションの初期化に失敗しました。コンソールを確認してください。');
    }
};

const startApp = () => {
    document.addEventListener('DOMContentLoaded', main);
};

startApp();
