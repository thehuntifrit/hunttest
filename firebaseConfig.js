/**
 * firebaseConfig.js - Firebaseサービス設定とエクスポート
 * 責務: 初期化されたFirestoreとFunctionsのインスタンスを他のモジュールに提供
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

// config.jsからFirebase設定をインポート
import { firebaseConfig } from './config';

// 1. Firebaseアプリケーションの初期化 (initializeAppは一度だけ実行される)
const app = initializeApp(firebaseConfig);

// 2. サービスインスタンスの取得
export const db = getFirestore(app);

// Cloud Functionsのリージョンを指定 (サーバー側の設定 'asia-northeast2' と一致させる)
export const functions = getFunctions(app, 'asia-northeast2'); 

// 3. Firestore SDKのオブジェクト全体のエクスポート (TimestampやFieldValueへのアクセス用)
// firestore.Timestamp や firestore.FieldValue の形式で使用されます。
export const firestore = {
    Timestamp,
    FieldValue,
};
