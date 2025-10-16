/**
 * firebaseConfig.js - Firebaseサービス設定とエクスポート
 * 責務: 初期化されたFirestoreとFunctionsのインスタンスを他のモジュールに提供
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, Timestamp } from 'firebase/firestore'; // FieldValueを削除
import { getFunctions } from 'firebase/functions';

import { firebaseConfig } from './config.js';

// 1. Firebaseアプリケーションの初期化
const app = initializeApp(firebaseConfig);

// 2. サービスインスタンスの取得
export const db = getFirestore(app);

// Cloud Functionsのリージョンを指定 (必要に応じて変更)
export const functions = getFunctions(app, 'asia-northeast2'); 

// 3. Firestore SDKのオブジェクト全体のエクスポート 
export const firestore = {
    // Timestampのみをエクスポート (FieldValueを削除)
    Timestamp,
};

export { app };
