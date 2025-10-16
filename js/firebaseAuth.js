/**
 * firebaseAuth.js - 匿名認証の管理
 */
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
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            
            if (user) {
                unsubscribe();
                
                console.log("AUTH DEBUG: ✅ User is signed in. UID:", user.uid);
                currentReporterUID = user.uid;
                updateUIWithUID(user.uid);
                
                resolve(user.uid);
                
            } else {
                signInAnonymously(auth)
                    .then(() => {
                        console.log("AUTH DEBUG: 🟡 Signed in anonymously. Waiting for next onAuthStateChanged.");
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
