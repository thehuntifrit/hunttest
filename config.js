/**
 * config.js - アプリケーション設定と定数管理
 * 責務: Firebase接続情報、静的データパス、デフォルト値の提供
 */

// --- Firebase 接続情報 ---
// **注意**: ここに記載する値は、ご自身の Firebase プロジェクトの値に必ず置き換えてください。
export const firebaseConfig = {
    apiKey: "YOUR_API_KEY_HERE",
    authDomain: "your-project-id.firebaseapp.com",
    projectId: "your-project-id",
    storageBucket: "your-project-id.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID",
    // measurementId: "G-XXXXXXXXXX" // 必要に応じて
};

// --- 静的データパス ---
// **注意**: JSONファイルの配置場所に合わせてパスを調整してください。
// dataManager.js が fetch で読み込むことを想定しています。
export const MOB_DATA_JSON_PATH = '/static/mob_data.json';
export const MOB_LOCATIONS_POINTS_JSON_PATH = '/static/mob_locations_points.json';

// --- アプリケーション定数 ---
// データ欠損時のフォールバック値など
export const DEFAULT_REPOP_SECONDS = 21600; // 6時間 (データ検証用)
