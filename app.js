/**
 * app.js - アプリケーションのエントリポイント
 * 責務: 全モジュールの初期化と連携の統括
 */

import { initializeApp, getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth'; // Firebase Authの関数をインポート
import * as DataManager from './dataManager'; // dataManager.js をインポート
import * as UIRenderer from './uiRenderer';   // uiRenderer.js をインポート
import { firebaseConfig } from './config'; // Firebase設定オブジェクトをインポート

let _auth = null;

// --- 認証処理 (簡易版) ---

/**
 * Firebase Authenticationを初期化し、認証状態を監視します。
 * 匿名認証を試み、成功したユーザーオブジェクトを返します。
 * @returns {Promise<Object | null>} Firebase Userオブジェクト
 */
const _setupUserAuthentication = async () => {
    // Firebaseアプリが既に初期化されている前提（またはここで実施）
    const app = initializeApp(firebaseConfig);
    _auth = getAuth(app);

    return new Promise((resolve) => {
        // 既存の認証状態を監視
        onAuthStateChanged(_auth, (user) => {
            if (user) {
                console.log('User is authenticated:', user.uid);
                resolve(user);
            } else {
                // ユーザーがいない場合、匿名認証を試みる
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
            // 報告者UIDをdataManagerに設定する（dataManagerで管理しない場合は、
            // submitHuntReport時に直接渡すことになるため、ここではUI側で一時保持させる）
            
            // 例: UIの隠しフィールドにUIDをセットする（uiRendererの責務だが、ここでは連携処理として扱う）
            const uidInput = document.getElementById('reporter-uid-input');
            if (uidInput) {
                 uidInput.value = reporterUID;
            }
        }
        
        // 2. DataManagerの初期化 (静的データのロードとFirestoreリスナー設定)
        console.log('Initializing DataManager...');
        await DataManager.initialize();
        console.log('DataManager initialized successfully.');

        // 3. UIRendererの初期化と連携
        console.log('Initializing UIRenderer...');
        UIRenderer.initialize(DataManager);
        console.log('UIRenderer initialized successfully.');

        // 最終的なUIの初期描画（リスナーによって行われるが、念のため）
        UIRenderer.renderMobList(DataManager.getGlobalMobData());

    } catch (error) {
        console.error('Application failed to start during main sequence:', error);
        // ユーザーにエラーを通知するUI処理
        alert('アプリケーションの初期化に失敗しました。コンソールを確認してください。');
    }
};

/**
 * DOMが完全にロードされた後にメイン関数を実行する
 */
const startApp = () => {
    // DOMContentLoaded イベントを待ってから main 関数を実行
    document.addEventListener('DOMContentLoaded', main);
};

// --- アプリケーションの実行 ---
startApp();
