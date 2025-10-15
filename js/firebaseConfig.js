/**
 * firebaseConfig.js - Firebaseサービス設定とエクスポート
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, Timestamp, FieldValue } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getFunctions } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';

// config.jsからFirebase設定をインポート
import { firebaseConfig } from './config';

// 1. Firebaseアプリケーションの初期化 
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
