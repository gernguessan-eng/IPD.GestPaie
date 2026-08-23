// ─────────────────────────────────────────────────────────────────────────
// Connexion secondaire au projet Firebase "riseappli-prod"
// ─────────────────────────────────────────────────────────────────────────
// Ce fichier n'a AUCUN lien avec les données de l'application (employés,
// présences, paie...), qui continuent d'utiliser exclusivement le projet
// "ipd-rh-gest" (voir ./firebase.ts). Il sert uniquement à signaler les
// connexions/déconnexions au tableau de bord RISE Presence (application
// interne de suivi utilisée pour toutes les applications de RISE SASU),
// afin que "RH-Paie" apparaisse dans son historique des connexions.
//
// On utilise ici initializeApp avec un second nom ("rise-presence") car
// l'app principale a déjà initialisé Firebase par défaut pour "ipd-rh-gest" —
// deux projets différents ne peuvent pas partager la même instance nommée.
import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

const RISE_APP_NAME = 'rise-presence';

const riseFirebaseConfig = {
  apiKey: "AIzaSyAdjUYlswy-rfk0cwVs2Qly5-iViNrhKqk",
  authDomain: "riseappli-prod.firebaseapp.com",
  projectId: "riseappli-prod",
  storageBucket: "riseappli-prod.firebasestorage.app",
  messagingSenderId: "404378933325",
  appId: "1:404378933325:web:881815792a58b529346404",
};

const riseApp = getApps().find(a => a.name === RISE_APP_NAME) || initializeApp(riseFirebaseConfig, RISE_APP_NAME);
export const riseDb = getFirestore(riseApp);
const riseAuth = getAuth(riseApp);

let riseAuthReadyPromise: Promise<string> | null = null;

// Authentification anonyme sur le projet riseappli-prod (indépendante de celle
// utilisée pour ipd-rh-gest). Résout avec l'uid anonyme une fois prêt.
export function ensureRiseAnonymousAuth(): Promise<string> {
  if (riseAuthReadyPromise) return riseAuthReadyPromise;
  riseAuthReadyPromise = new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      riseAuth,
      (user) => {
        if (user) { unsubscribe(); resolve(user.uid); }
      },
      (err) => { unsubscribe(); riseAuthReadyPromise = null; reject(err); }
    );
    signInAnonymously(riseAuth).catch((err) => { unsubscribe(); riseAuthReadyPromise = null; reject(err); });
  });
  return riseAuthReadyPromise;
}
