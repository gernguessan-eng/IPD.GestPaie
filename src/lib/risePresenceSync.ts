// ─────────────────────────────────────────────────────────────────────────
// Synchronisation de présence avec RISE Presence (riseappli-prod)
// ─────────────────────────────────────────────────────────────────────────
// Fait apparaître les connexions à "RH-Paie" dans le tableau de bord RISE
// Presence (menu "Historique des connexions" / "Utilisateurs connectés"),
// aux côtés des autres applications de RISE SASU (FleetGest, AtelierGest...).
//
// Schéma respecté (collection "presence" de riseappli-prod) :
//   { uid, displayName, email, role, statut: "Connecté"|"Déconnecté",
//     connexion: Timestamp, deconnexion: Timestamp|null, application: string }
// Un document = UNE session (créé à la connexion, mis à jour à la déconnexion),
// pour conserver un historique complet plutôt que d'écraser la ligne précédente.
import { doc, addDoc, updateDoc, setDoc, collection, serverTimestamp } from 'firebase/firestore';
import { riseDb, ensureRiseAnonymousAuth } from './riseFirebase';

// Nom affiché dans RISE Presence pour distinguer cette application des autres.
const APPLICATION_NAME = 'RH-Paie';

let currentSessionId: string | null = null;
let closing = false;

// À appeler juste après une connexion réussie dans l'app (identifiant/mot de
// passe internes). N'importe quelle erreur réseau est avalée silencieusement :
// le suivi RISE Presence est un "plus", il ne doit jamais bloquer ni ralentir
// la connexion réelle de l'utilisateur à son application de paie.
export async function startRiseSession(user: { username: string; role: string }) {
  try {
    const uid = await ensureRiseAnonymousAuth();

    // Profil "users" (facultatif pour l'affichage mais attendu par le schéma RISE)
    await setDoc(doc(riseDb, 'users', uid), {
      uid,
      displayName: user.username,
      email: '',
      role: 'Client',
      fonction: user.role,
      updatedAt: serverTimestamp(),
    }, { merge: true });

    const sessionRef = await addDoc(collection(riseDb, 'presence'), {
      uid,
      displayName: user.username,
      email: '',
      role: 'Client',
      application: APPLICATION_NAME,
      statut: 'Connecté',
      connexion: serverTimestamp(),
      deconnexion: null,
    });
    currentSessionId = sessionRef.id;
    closing = false;

    // Best-effort : marque la session "Déconnecté" si l'onglet se ferme sans
    // passer par le bouton de déconnexion (fermeture d'onglet, actualisation...).
    window.addEventListener('beforeunload', handleUnload);
  } catch (err) {
    console.error('RISE Presence : impossible de démarrer la session (ignoré) :', err);
  }
}

function handleUnload() {
  if (!currentSessionId || closing) return;
  // sendBeacon ne fonctionne pas directement avec Firestore ; on tente une
  // dernière écriture asynchrone "au mieux" — non garantie mais inoffensive.
  void endRiseSession();
}

// À appeler lors d'une déconnexion explicite (bouton "Déconnexion").
export async function endRiseSession() {
  if (!currentSessionId || closing) return;
  closing = true;
  const sessionId = currentSessionId;
  currentSessionId = null;
  window.removeEventListener('beforeunload', handleUnload);
  try {
    await updateDoc(doc(riseDb, 'presence', sessionId), {
      statut: 'Déconnecté',
      deconnexion: serverTimestamp(),
    });
  } catch (err) {
    console.error('RISE Presence : impossible de clôturer la session (ignoré) :', err);
  }
}
