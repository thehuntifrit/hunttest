/**
 * firebaseConfig.js - Firebaseサービスの初期化
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, Timestamp as fsTimestamp } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import { getAuth, connectAuthEmulator, onAuthStateChanged, signInAnonymously } from 'firebase/auth'; 

import { firebaseConfig } from './config.js';

// 1. Firebase アプリの初期化
const app = initializeApp(firebaseConfig);

// 2. サービスインスタンスの取得
export const db = getFirestore(app);
export const auth = getAuth(app);
export const functions = getFunctions(app, "asia-northeast2"); // Cloud Functionsのリージョンを指定

// 3. Auth SDKの関数をエクスポート
export { onAuthStateChanged, signInAnonymously };

// 4. エクスポート用エイリアス
export const firestore = {
    Timestamp: fsTimestamp
};

// --- エミュレータ接続 (ローカル開発用) ---
// if (window.location.hostname === "localhost") {
//     connectFirestoreEmulator(db, "127.0.0.1", 8080);
//     connectFunctionsEmulator(functions, "127.0.0.1", 5001);
//     connectAuthEmulator(auth, "http://127.0.0.1:9099");
//     console.log("Firebase Emulator Connected.");
// }
