/**
 * config.js - アプリケーション設定と定数管理
 * 責務: Firebase接続情報、静的データパス、デフォルト値の提供
 */
export const firebaseConfig = {
  apiKey: "AIzaSyDAYv5Qm0bfqbHhCLeNp6zjKMty2y7xIIY",
  authDomain: "the-hunt-49493.firebaseapp.com",
  projectId: "the-hunt-49493",
  storageBucket: "the-hunt-49493.firebasestorage.app",
  messagingSenderId: "465769826017",
  appId: "1:465769826017:web:74ad7e62f3ab139cb359a0",
  measurementId: "G-J1KGFE15XP"
};

// static フォルダに mob_data.json がある前提
export const MOB_DATA_JSON_PATH = '../static/mob_data.json';
// データ欠損時のフォールバック値など
export const DEFAULT_REPOP_SECONDS = 21600; // 6時間 (データ検証用)
