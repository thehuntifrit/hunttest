/**
 * firebaseConfig.js - Firebaseサービス設定とエクスポート
 * 責務: 初期化されたFirestoreとFunctionsのインスタンスを他のモジュールに提供
 */
// import { initializeApp } from 'firebase/app';
// import { getFirestore, Timestamp, FieldValue } from 'firebase/firestore';
// import { getFunctions } from 'firebase/functions';

// config.jsからFirebase設定をインポート
import { firebaseConfig } from './config';

// 1. Firebaseアプリケーションの初期化 (グローバルな initializeApp を使用)
const app = initializeApp(firebaseConfig);

// 2. サービスインスタンスの取得
export const db = getFirestore(app);

export const functions = getFunctions(app, 'asia-northeast2'); 

// 3. Firestore SDKのオブジェクト全体のエクスポート (TimestampやFieldValueへのアクセス用)
export const firestore = {
    Timestamp,
    FieldValue,
};

export { app };
