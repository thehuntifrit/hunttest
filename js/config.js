/**
 * config.js - アプリケーション設定と定数管理
 */
// **注意**: ここに記載する値は、ご自身の Firebase プロジェクトの値に必ず置き換えてください。
export const firebaseConfig = {
  apiKey: "AIzaSyDAYv5Qm0bfqbHhCLeNp6zjKMty2y7xIIY",
  authDomain: "the-hunt-49493.firebaseapp.com",
  projectId: "the-hunt-49493",
  storageBucket: "the-hunt-49493.firebasestorage.app",
  messagingSenderId: "465769826017",
  appId: "1:465769826017:web:74ad7e62f3ab139cb359a0",
  measurementId: "G-J1KGFE15XP"
};

export const MOB_DATA_JSON_PATH = '../mob_data.json';
// データ欠損時のフォールバック値など
export const DEFAULT_REPOP_SECONDS = 21600; // 6時間 (データ検証用)
