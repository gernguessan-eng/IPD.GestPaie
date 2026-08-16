import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

// Configuration du projet Firebase "ipd-rh-gest" (client I.P & D Sarl)
const firebaseConfig = {
  apiKey: "AIzaSyDWGXh-ZQqf6bbIbvFAFF6U-TI23HjYRUE",
  authDomain: "ipd-rh-gest.firebaseapp.com",
  projectId: "ipd-rh-gest",
  storageBucket: "ipd-rh-gest.firebasestorage.app",
  messagingSenderId: "390425455948",
  appId: "1:390425455948:web:17949f17cf28ce8c9b33e9"
};

export const firebaseApp = initializeApp(firebaseConfig);
export const db = getFirestore(firebaseApp);
export const auth = getAuth(firebaseApp);

// Authentification anonyme : nécessaire pour satisfaire les règles de sécurité
// Firestore (qui exigent un utilisateur authentifié), sans imposer de vraie
// connexion Firebase à l'utilisateur final (qui utilise l'identifiant/mot de
// passe internes de l'app, gérés séparément dans Firestore).
let authReadyPromise: Promise<void> | null = null;

export function ensureAnonymousAuth(): Promise<void> {
  if (authReadyPromise) return authReadyPromise;
  authReadyPromise = new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        if (user) {
          unsubscribe();
          resolve();
        }
      },
      (err) => { unsubscribe(); reject(err); }
    );
    signInAnonymously(auth).catch((err) => { unsubscribe(); reject(err); });
  });
  return authReadyPromise;
}
