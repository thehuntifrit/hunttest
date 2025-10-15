/**
 * firebaseConfig.js - Firebaseサービス設定とエクスポート
 * 責務: 初期化されたFirestoreとFunctionsのインスタンスを他のモジュールに提供
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, Timestamp, FieldValue } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getFunctions } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';

import { firebaseConfig } from './config.js';

// 1. Firebaseアプリケーションの初期化 (initializeAppは一度だけ実行される)
const app = initializeApp(firebaseConfig);

// 2. サービスインスタンスの取得
export const db = getFirestore(app);

// Cloud Functionsのリージョンを指定
export const functions = getFunctions(app, 'asia-northeast2'); 

// 3. Firestore SDKのオブジェクト全体のエクスポート 
export const firestore = {
    Timestamp,
    FieldValue,
};

export { app };
