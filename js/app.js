/**
 * app.js - アプリケーションのエントリポイント
 * 責務: 全モジュールの初期化と連携の統括
 */

// import { initializeApp, getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth'; 

import { app } from './firebaseConfig'; 
import * as DataManager from './dataManager'; 
import * as UIRenderer from './uiRenderer';
// config.js の import は不要 (firebaseConfig.js でのみ使用)

let _auth = null;

// --- 認証処理 (簡易版) ---

/**
 * Firebase Authenticationを初期化し、認証状態を監視します。
 * 匿名認証を試み、成功したユーザーオブジェクトを返します。
 * @returns {Promise<Object | null>} Firebase Userオブジェクト
 */
const _setupUserAuthentication = async () => {
    // グローバルな getAuth を使用
    _auth = getAuth(app);

    return new Promise((resolve) => {
        // グローバルな onAuthStateChanged を使用
        onAuthStateChanged(_auth, (user) => {
            if (user) {
                console.log('User is authenticated:', user.uid);
                resolve(user);
            } else {
                // ユーザーがいない場合、匿名認証を試みる (グローバルな signInAnonymously を使用)
                console.log('No user detected. Signing in anonymously...');
                signInAnonymously(_auth).then((credentials) => {
                    console.log('Signed in anonymously:', credentials.user.uid);
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

/**
 * アプリケーションのメイン起動ロジック
 */
const main = async () => {
    try {
        // 1. 認証処理
        const user = await _setupUserAuthentication();
        
        let reporterUID = 'anonymous-user';
        if (user) {
            reporterUID = user.uid;
            
            // UIの隠しフィールドにUIDをセット
            const uidInput = document.getElementById('reporter-uid-input');
            if (uidInput) {
                uidInput.value = reporterUID;
                // 認証ステータスを更新 (index.htmlの #auth-status)
                document.getElementById('auth-status').textContent = `認証済み (UID: ${user.uid.substring(0, 8)}...)`;
            }
        } else {
             document.getElementById('auth-status').textContent = '認証失敗';
        }
        
        // 2. DataManagerの初期化 (静的データのロードとFirestoreリスナー設定)
        console.log('Initializing DataManager...');
        await DataManager.initialize();
        console.log('DataManager initialized successfully.');

        // 3. UIRendererの初期化と連携
        console.log('Initializing UIRenderer...');
        UIRenderer.initialize(DataManager);
        console.log('UIRenderer initialized successfully.');

    } catch (error) {
        console.error('Application failed to start during main sequence:', error);
        document.getElementById('auth-status').textContent = '認証失敗';
        alert('アプリケーションの初期化に失敗しました。コンソールを確認してください。');
    }
};

/**
 * DOMが完全にロードされた後にメイン関数を実行する
 */
const startApp = () => {
    document.addEventListener('DOMContentLoaded', main);
};

// --- アプリケーションの実行 ---
startApp();
