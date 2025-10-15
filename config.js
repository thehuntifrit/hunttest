/**
 * config.js - アプリケーション設定と定数管理
 * 責務: Firebase接続情報、静的データパス、デフォルト値の提供
 */

// --- Firebase 接続情報 ---
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

// --- 静的データパス ---
// **注意**: JSONファイルの配置場所に合わせてパスを調整してください。
// dataManager.js が fetch で読み込むことを想定しています。
export const MOB_DATA_JSON_PATH = '/static/mob_data.json';
export const MOB_LOCATIONS_POINTS_JSON_PATH = '/static/mob_locations_points.json';

// --- アプリケーション定数 ---
// データ欠損時のフォールバック値など
export const DEFAULT_REPOP_SECONDS = 21600; // 6時間 (データ検証用)
