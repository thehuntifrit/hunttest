/**
 * firebaseAuth.js - 匿名認証の管理
 */
// 修正点: firebaseConfig.jsからエクスポートされた関数をインポート
import { auth, signInAnonymously, onAuthStateChanged } from './firebaseConfig.js';

let currentReporterUID = null;

const updateUIWithUID = (uid) => {
    const uidDisplay = document.getElementById('reporter-uid-display');
    const uidInput = document.getElementById('reporter-uid-input');
    
    if (uidDisplay) uidDisplay.textContent = `認証済み: ${uid.substring(0, 8)}...`;
    if (uidInput) uidInput.value = uid;
};

export const initialize = () => {
    return new Promise((resolve) => {
        onAuthStateChanged(auth, (user) => {
            if (user) {
                // 認証済み
                currentReporterUID = user.uid;
                updateUIWithUID(user.uid);
                resolve(user.uid);
            } else {
                // 未認証の場合、匿名認証を実行
                signInAnonymously(auth)
                    .then((userCredential) => {
                        const user = userCredential.user;
                        currentReporterUID = user.uid;
                        updateUIWithUID(user.uid);
                        resolve(user.uid);
                    })
                    .catch((error) => {
                        console.error("Anonymous sign-in failed:", error);
                        alert("認証に失敗しました。アプリケーションが正しく動作しない可能性があります。");
                        resolve(null);
                    });
            }
        });
    });
};

export const getCurrentReporterUID = () => currentReporterUID;
