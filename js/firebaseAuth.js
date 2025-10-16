/**
 * firebaseAuth.js
 */
import { auth, signInAnonymously, onAuthStateChanged } from './firebaseConfig.js';

let currentReporterUID = null;

const updateUIWithUID = (uid) => {
    const authStatusElement = document.getElementById('auth-status'); 
    const uidDisplay = document.getElementById('reporter-uid-display');
    const uidInput = document.getElementById('reporter-uid-input');
    
    if (authStatusElement) authStatusElement.textContent = `認証状態: 認証済み`; 
    
    if (uidDisplay) uidDisplay.textContent = `認証済み: ${uid.substring(0, 8)}...`;
    if (uidInput) uidInput.value = uid;
};

export const initialize = () => {
    return new Promise((resolve) => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            
            if (user) {
                unsubscribe();
                
                currentReporterUID = user.uid;
                updateUIWithUID(user.uid);
                
                resolve(user.uid);
                
            } else {
                signInAnonymously(auth)
                    .then(() => {
                    })
                    .catch((error) => {
                        unsubscribe(); 
                        console.error("Anonymous sign-in failed:", error);
                        alert("認証に失敗しました。アプリケーションが正しく動作しない可能性があります。");
                        resolve(null);
                    });
            }
        });
    });
};

export const getCurrentReporterUID = () => currentReporterUID;
