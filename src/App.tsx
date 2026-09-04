import { useState, useMemo, useEffect, useRef, useCallback, useContext, createContext, Component } from 'react';
import { collection, doc, getDoc, getDocs, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { db, ensureAnonymousAuth } from './lib/firebase';
import { startRiseSession, endRiseSession } from './lib/risePresenceSync';
import { ExportModal, applyPrintColumnFilter, exportCSV, type ExportColumn, type ExportRow } from './lib/exportTools';
import logo from './assets/logo.jpg';
import {
  sites, employees, payrollOverrides, computeSalary, OVERTIME_RATES, emptyOvertime,
  FAMILY_SITUATIONS, computeFiscalParts, computeRICF, computeIGRBrut,
  computeAncienneteRate, computeAncienneteAmount, computeCNPSSalarial, computeCNPSPatronal,
  CNPS_PLAFOND, CHARGES_PATRONALES,
  type Employee, type Site, type PayrollOverride, type SalaryComponents, type OvertimeHours, type FamilySituation,
} from './data/mockData';

// Registre de "version des données" partagé par toute l'application : incrémenté à chaque
// ajout/modification/suppression (employé, site, saisie de paie...). Toutes les pages en
// dépendent dans leurs calculs pour se mettre à jour IMMÉDIATEMENT dès qu'une donnée change
// où que ce soit dans l'appli — sans qu'il soit nécessaire d'actualiser la page.
const DataVersionContext = createContext<{ version: number; bump: () => void }>({ version: 0, bump: () => {} });

/* ══════════════════════════════════════════════════════ */
/* TYPES AUTH                                             */
/* ══════════════════════════════════════════════════════ */
type AuthUser = { username: string; password: string; role: string; securityQuestion?: string; securityAnswer?: string };
const registeredUsers: AuthUser[] = [];

// Questions de sécurité proposées à l'inscription, utilisées pour la récupération de mot de passe
const SECURITY_QUESTIONS = [
  'Quel est le prénom de votre mère ?',
  'Quelle est votre ville de naissance ?',
  'Quel est le nom de votre premier animal de compagnie ?',
  'Quel est le nom de votre école primaire ?',
  'Quel est votre plat préféré ?',
];

/* ══════════════════════════════════════════════════════ */
/* PAGE DE CONNEXION                                      */
/* ══════════════════════════════════════════════════════ */
function LoginPage({ onLogin }: { onLogin: (user: AuthUser) => void }) {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('');
  const [securityQuestion, setSecurityQuestion] = useState(SECURITY_QUESTIONS[0]);
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');

  // ── Récupération de mot de passe ──
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotStep, setForgotStep] = useState<1 | 2 | 3>(1);
  const [forgotUsername, setForgotUsername] = useState('');
  const [forgotUser, setForgotUser] = useState<AuthUser | null>(null);
  const [forgotAnswer, setForgotAnswer] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [forgotError, setForgotError] = useState('');
  const [forgotSuccess, setForgotSuccess] = useState(false);

  const handleLogin = () => {
    setError('');
    if (!username.trim() || !password.trim()) { setError('Veuillez remplir tous les champs.'); return; }
    const found = registeredUsers.find(u => u.username === username && u.password === password);
    if (!found) { setError('Identifiant ou mot de passe incorrect.'); return; }
    onLogin(found);
  };

  const handleRegister = () => {
    setError('');
    if (!username.trim() || !password.trim() || !role.trim() || !securityAnswer.trim()) { setError('Tous les champs sont obligatoires, y compris la question de sécurité (elle permettra de récupérer le mot de passe en cas d\'oubli).'); return; }
    if (registeredUsers.find(u => u.username === username)) { setError('Cet identifiant existe déjà.'); return; }
    const newUser: AuthUser = { username, password, role, securityQuestion, securityAnswer };
    registeredUsers.push(newUser);
    persistDoc('users', newUser.username, newUser);
    onLogin(newUser);
  };

  function resetForgotState() {
    setForgotMode(false); setForgotStep(1); setForgotUsername(''); setForgotUser(null);
    setForgotAnswer(''); setNewPassword(''); setNewPasswordConfirm(''); setForgotError(''); setForgotSuccess(false);
  }

  function handleForgotStep1() {
    setForgotError('');
    const u = registeredUsers.find(u => u.username === forgotUsername.trim());
    if (!u) { setForgotError('Aucun compte trouvé avec cet identifiant.'); return; }
    if (!u.securityQuestion || !u.securityAnswer) {
      setForgotError('Aucune question de sécurité n\'a été définie pour ce compte (créé avant cette fonctionnalité). Contactez un administrateur pour réinitialiser votre mot de passe.');
      return;
    }
    setForgotUser(u);
    setForgotStep(2);
  }

  function handleForgotStep2() {
    setForgotError('');
    if (!forgotUser) return;
    if (forgotAnswer.trim().toLowerCase() !== (forgotUser.securityAnswer || '').trim().toLowerCase()) {
      setForgotError('Réponse incorrecte. Réessayez.');
      return;
    }
    setForgotStep(3);
  }

  function handleForgotStep3() {
    setForgotError('');
    if (!newPassword.trim() || newPassword.length < 4) { setForgotError('Le mot de passe doit contenir au moins 4 caractères.'); return; }
    if (newPassword !== newPasswordConfirm) { setForgotError('Les deux mots de passe ne correspondent pas.'); return; }
    if (!forgotUser) return;
    forgotUser.password = newPassword;
    persistDoc('users', forgotUser.username, forgotUser);
    setForgotSuccess(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
      {/* Carte principale split */}
      <div className="w-full max-w-4xl flex rounded-3xl overflow-hidden shadow-2xl shadow-black/60" style={{ minHeight: 520 }}>

        {/* Panneau gauche (sombre, info) */}
        <div className="hidden md:flex flex-col justify-between w-5/12 p-10 relative overflow-hidden"
          style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #0f172a 100%)' }}>
          {/* Effet lumineux décoratif */}
          <div className="absolute -top-20 -left-20 w-64 h-64 rounded-full opacity-10"
            style={{ background: 'radial-gradient(circle, #f97316 0%, transparent 70%)' }} />
          <div className="absolute -bottom-20 -right-10 w-48 h-48 rounded-full opacity-10"
            style={{ background: 'radial-gradient(circle, #6366f1 0%, transparent 70%)' }} />

          <div className="relative z-10">
            {/* Logo */}
            <div className="flex items-center gap-3 mb-8">
              <div className="h-14 w-24 rounded-xl bg-white flex items-center justify-center shadow-lg p-1.5 overflow-hidden">
                <img src={logo} alt="I.P & D Sarl" className="h-full w-full object-contain" />
              </div>
            </div>
            <h1 className="text-3xl font-black text-white leading-tight mb-3">Gestion RH-Paie</h1>
          </div>

          {/* Pied */}
          <div className="relative z-10 flex items-center gap-2 mt-6">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <p className="text-[11px] text-slate-400">Atelier connecté · Données locales sécurisées</p>
          </div>
        </div>

        {/* Panneau droit (blanc, formulaire) */}
        <div className="flex-1 bg-white flex flex-col justify-center px-10 py-10">
          {forgotMode ? (
            /* ═══ Flux de récupération de mot de passe ═══ */
            <div className="space-y-5">
              <button onClick={resetForgotState} className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 mb-1 w-fit">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
                Retour à la connexion
              </button>
              <h2 className="text-lg font-bold text-slate-800">Mot de passe oublié</h2>

              {forgotSuccess ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6L9 17l-5-5" /></svg>
                    Mot de passe réinitialisé avec succès pour « {forgotUser?.username} ».
                  </div>
                  <button onClick={() => { const u = forgotUsername; resetForgotState(); setUsername(u); setTab('login'); }}
                    className="w-full py-3.5 bg-slate-900 hover:bg-slate-700 text-white text-sm font-bold rounded-xl transition-colors shadow-sm shadow-slate-300">
                    Retour à la connexion
                  </button>
                </div>
              ) : (
                <>
                  {forgotStep === 1 && (
                    <div className="space-y-5">
                      <div className="space-y-1.5">
                        <label className="text-sm font-bold text-slate-800">Identifiant</label>
                        <input type="text" value={forgotUsername} onChange={e => setForgotUsername(e.target.value)}
                          placeholder="Votre nom d'utilisateur"
                          className="w-full px-4 py-3 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 placeholder:text-slate-300"
                          onKeyDown={e => e.key === 'Enter' && handleForgotStep1()} />
                      </div>
                      {forgotError && (
                        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                          {forgotError}
                        </div>
                      )}
                      <button onClick={handleForgotStep1}
                        className="w-full py-3.5 bg-slate-900 hover:bg-slate-700 text-white text-sm font-bold rounded-xl transition-colors shadow-sm shadow-slate-300">
                        Continuer
                      </button>
                    </div>
                  )}

                  {forgotStep === 2 && forgotUser && (
                    <div className="space-y-5">
                      <div className="space-y-1.5">
                        <label className="text-sm font-bold text-slate-800">{forgotUser.securityQuestion}</label>
                        <input type="text" value={forgotAnswer} onChange={e => setForgotAnswer(e.target.value)}
                          placeholder="Votre réponse"
                          className="w-full px-4 py-3 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 placeholder:text-slate-300"
                          onKeyDown={e => e.key === 'Enter' && handleForgotStep2()} />
                      </div>
                      {forgotError && (
                        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                          {forgotError}
                        </div>
                      )}
                      <button onClick={handleForgotStep2}
                        className="w-full py-3.5 bg-slate-900 hover:bg-slate-700 text-white text-sm font-bold rounded-xl transition-colors shadow-sm shadow-slate-300">
                        Vérifier la réponse
                      </button>
                    </div>
                  )}

                  {forgotStep === 3 && (
                    <div className="space-y-5">
                      <div className="space-y-1.5">
                        <label className="text-sm font-bold text-slate-800">Nouveau mot de passe</label>
                        <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                          placeholder="••••••••"
                          className="w-full px-4 py-3 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 placeholder:text-slate-300" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-bold text-slate-800">Confirmer le mot de passe</label>
                        <input type="password" value={newPasswordConfirm} onChange={e => setNewPasswordConfirm(e.target.value)}
                          placeholder="••••••••"
                          className="w-full px-4 py-3 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 placeholder:text-slate-300"
                          onKeyDown={e => e.key === 'Enter' && handleForgotStep3()} />
                      </div>
                      {forgotError && (
                        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                          {forgotError}
                        </div>
                      )}
                      <button onClick={handleForgotStep3}
                        className="w-full py-3.5 bg-slate-900 hover:bg-slate-700 text-white text-sm font-bold rounded-xl transition-colors shadow-sm shadow-slate-300">
                        Réinitialiser le mot de passe
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
          <>
          {/* Onglets Connexion / Création */}
          <div className="flex rounded-2xl bg-slate-100 p-1 mb-8">
            <button
              onClick={() => { setTab('login'); setError(''); }}
              className={cn('flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all',
                tab === 'login' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
              Connexion
            </button>
            <button
              onClick={() => { setTab('register'); setError(''); }}
              className={cn('flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all',
                tab === 'register' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
              Création de compte
            </button>
          </div>

          <div className="space-y-5">
            {/* Identifiant */}
            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-800">Identifiant</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Votre nom d'utilisateur"
                className="w-full px-4 py-3 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 placeholder:text-slate-300"
                onKeyDown={e => e.key === 'Enter' && (tab === 'login' ? handleLogin() : handleRegister())}
              />
            </div>

            {/* Mot de passe */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-bold text-slate-800">Mot de passe</label>
                {tab === 'login' && (
                  <button onClick={() => { setForgotMode(true); setForgotUsername(username); setError(''); }}
                    className="text-[11px] font-semibold text-orange-600 hover:text-orange-700 hover:underline">
                    Mot de passe oublié ?
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 pr-12 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 placeholder:text-slate-300"
                  onKeyDown={e => e.key === 'Enter' && (tab === 'login' ? handleLogin() : handleRegister())}
                />
                <button onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {showPwd
                      ? <><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></>
                      : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
                    }
                  </svg>
                </button>
              </div>
            </div>

            {/* Fonction + Question de sécurité (uniquement inscription) */}
            {tab === 'register' && (
              <>
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-slate-800">Fonction</label>
                  <input
                    type="text"
                    value={role}
                    onChange={e => setRole(e.target.value)}
                    placeholder="Ex: Chef d'atelier, Gérant, Réceptionniste..."
                    className="w-full px-4 py-3 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 placeholder:text-slate-300"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-slate-800">Question de sécurité</label>
                  <p className="text-[11px] text-slate-400 -mt-0.5">Utilisée uniquement pour récupérer votre mot de passe en cas d'oubli.</p>
                  <select value={securityQuestion} onChange={e => setSecurityQuestion(e.target.value)}
                    className="w-full px-4 py-3 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-slate-300">
                    {SECURITY_QUESTIONS.map(q => <option key={q} value={q}>{q}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-slate-800">Réponse</label>
                  <input
                    type="text"
                    value={securityAnswer}
                    onChange={e => setSecurityAnswer(e.target.value)}
                    placeholder="Votre réponse"
                    className="w-full px-4 py-3 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-slate-300 placeholder:text-slate-300"
                  />
                </div>
              </>
            )}

            {/* Erreur */}
            {error && (
              <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                {error}
              </div>
            )}

            {/* Bouton principal */}
            <button
              onClick={tab === 'login' ? handleLogin : handleRegister}
              className="w-full py-3.5 bg-slate-900 hover:bg-slate-700 text-white text-sm font-bold rounded-xl transition-colors shadow-sm shadow-slate-300 mt-2">
              {tab === 'login' ? 'Se connecter' : 'Créer le compte et entrer'}
            </button>

            {/* Mention légale */}
            <p className="text-[11px] text-slate-400 text-center leading-relaxed pt-1">
              En accédant à l'application, vous acceptez les{' '}
              <span className="text-orange-500 underline cursor-pointer">conditions d'utilisation interne du garage</span>.
            </p>
          </div>
          </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Utils ─────────────────────────────────────────────── */
const fmt = (d: string) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const initials = (f: string, l: string) => `${f[0]}${l[0]}`.toUpperCase();
const cn = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');
const formatFCFA = (n: number | null | undefined) => (n ?? 0).toLocaleString('fr-FR') + ' FCFA';
// Formate une date ISO (YYYY-MM-DD) en "JJ/MM/AAAA" pour l'affichage "Période du ... au ..."
const formatDateFR = (iso: string) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

/* ─── Icons (inline SVG) ────────────────────────────────── */
const Icon = ({ d, size = 20, stroke = 2, className = '' }: { d: string; size?: number; stroke?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" className={className}><path d={d} /></svg>
);

const icons: Record<string, string> = {
  dashboard: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  employees: 'M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z',
  sites: 'M3 21h18M5 21V7l8-4 8 4v14M9 21v-6h6v6',
  presence: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z',
  leave: 'M20 6h-2.18c.11-.31.18-.65.18-1a2.996 2.996 0 00-5.5-1.65l-.5.67-.5-.68C10.96 2.54 10.05 2 9 2 7.34 2 6 3.34 6 5c0 .35.07.69.18 1H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-5-2c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zM9 4c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm11 15H4v-2h16v2zm0-5H4V8h5.08L7 10.83 8.62 12 11 8.76l1-1.36 1 1.36L15.38 12 17 10.83 14.92 8H20v6z',
  paye: 'M21 18v1c0 1.1-.9 2-2 2H5c-1.11 0-2-.9-2-2V5c0-1.1.89-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.11 0-2 .9-2 2v8c0 1.1.89 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  close: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  trash: 'M6 19a2 2 0 002 2h8a2 2 0 002-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  menu: 'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z',
  bell: 'M12 22a2 2 0 01-2-2h4a2 2 0 01-2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4a1.5 1.5 0 00-3 0v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z',
  calendar: 'M19 3h-1V1h-2v2H8V1H6v2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm0 16H5V8h14v11zM9 10H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm-8 4H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z',
  users: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
  briefcase: 'M20 6h-4V4c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-10 0h4V4h-4v2z',
  download: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
  filter: 'M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z',
  logout: 'M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z',
  save: 'M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z',
  print: 'M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5zm3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6V4h12v3z',
  import: 'M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z',
  exportFile: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM9 11V5h2v6h2v2H9v-4z',
  checkmark: 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  cross: 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  palm: 'M15.49 9.63c-.16-.55-.91-3.44-3.7-3.44-2.03 0-2.84 1.27-3.29 2.06-.46-.79-1.26-2.06-3.29-2.06-2.79 0-3.54 2.89-3.7 3.44 0 0-.51 2.37 1.71 5.88-.75-.53-1.82-.76-2.72-.52-.39.1-.73.31-1 .59-.28.27-.48.61-.58 1-.23.9 0 1.98.52 2.72 3.5 2.22 5.87 1.71 5.87 1.71.56.22 1.18.33 1.79.31.62 0 1.24-.11 1.8-.33 0 0 2.36.51 5.86-1.71.52-.74.75-1.82.52-2.72-.1-.39-.3-.73-.58-1-.27-.28-.61-.49-1-.59-.9-.24-1.97-.01-2.72.52 2.22-3.51 1.71-5.88 1.71-5.88z',
  smiley: 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z',
  books: 'M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z',
  question: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z',
  trendUp: 'M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z',
  shield: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z',
  chevronDown: 'M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z',
  receipt: 'M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1zM8 7h8M8 11h8M8 15h5',
};

function Ico({ name, size = 18, className = '' }: { name: string; size?: number; className?: string }) {
  return <Icon d={icons[name]!} size={size} className={className} />;
}

/* ══════════════════════════════════════════════════════ */
/* SIDEBAR                                               */
/* ══════════════════════════════════════════════════════ */

function Sidebar({
  page,
  setPage,
  mobileOpen,
  setMobileOpen,
  currentUser,
  onLogout,
}: {
  page: string;
  setPage: (p: string) => void;
  mobileOpen: boolean;
  setMobileOpen: (o: boolean) => void;
  currentUser: AuthUser | null;
  onLogout: () => void;
}) {
  const items: { key: string; label: string; icon: string; children?: { key: string; label: string }[] }[] = [
    { key: 'dashboard', label: 'Tableau de bord', icon: 'dashboard' },
    { key: 'sites', label: 'Sites', icon: 'sites' },
    { key: 'employees', label: 'Employés', icon: 'employees' },
    { key: 'paye', label: 'Paie', icon: 'paye' },
    { key: 'livre-fin-annee', label: "Livre de paie (fin d'année)", icon: 'receipt' },
    {
      key: 'charges-sociales', label: 'Charges sociales', icon: 'shield', children: [
        { key: 'cs-mensuelles', label: 'C.S mensuelles' },
        { key: 'cs-semestrielles', label: 'C.S semestrielles' },
        { key: 'cs-annuelles', label: 'C.S annuelles' },
      ]
    },
    { key: 'reconstitution', label: 'Reconstitution', icon: 'search' },
  ];

  const [expandedMenu, setExpandedMenu] = useState<string | null>(null);

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setMobileOpen(false)} />}
      <aside className={cn('fixed top-0 left-0 z-40 h-full w-60 bg-white border-r border-slate-200 flex flex-col transition-transform duration-200 shadow-sm', mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0')}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
          <div className="h-10 w-14 rounded-lg bg-white border border-slate-100 flex items-center justify-center shadow-sm overflow-hidden p-0.5 shrink-0">
            <img src={logo} alt="I.P & D Sarl" className="h-full w-full object-contain" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-800 leading-tight">Gestion RH-Paie</h1>
            <p className="text-[10px] text-slate-400">Gestion RH · Côte d'Ivoire</p>
          </div>
          <button onClick={() => setMobileOpen(false)} className="ml-auto lg:hidden text-slate-400 hover:text-slate-600"><Ico name="close" size={18} /></button>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto mt-1">
          {items.map((it) => {
            const active = page === it.key;

            if (!it.children) {
              return (
                <button key={it.key} onClick={() => { setPage(it.key); setMobileOpen(false); }}
                  className={cn('w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all',
                    active
                      ? 'bg-orange-500 text-white shadow-md shadow-orange-200'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800')}>
                  <Ico name={it.icon} size={17} />
                  {it.label}
                </button>
              );
            }

            // Élément avec sous-menu
            const childActive = it.children.some(c => c.key === page);
            const isOpen = expandedMenu === it.key || childActive;
            return (
              <div key={it.key}>
                <button onClick={() => setExpandedMenu(isOpen && expandedMenu === it.key ? null : it.key)}
                  className={cn('w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all',
                    childActive
                      ? 'bg-orange-50 text-orange-700'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800')}>
                  <Ico name={it.icon} size={17} />
                  <span className="flex-1 text-left">{it.label}</span>
                  <Ico name="chevronDown" size={14} className={cn('transition-transform duration-150', isOpen ? 'rotate-180' : '')} />
                </button>
                {isOpen && (
                  <div className="ml-4 mt-0.5 mb-0.5 space-y-0.5 border-l-2 border-slate-100 pl-3">
                    {it.children.map(sub => {
                      const subActive = page === sub.key;
                      return (
                        <button key={sub.key} onClick={() => { setPage(sub.key); setMobileOpen(false); }}
                          className={cn('w-full text-left px-3 py-2 rounded-lg text-[11px] font-semibold transition-all',
                            subActive
                              ? 'bg-orange-500 text-white shadow-sm shadow-orange-200'
                              : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800')}>
                          {sub.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* User info */}
        <div className="p-3 border-t border-slate-100 space-y-2">
          <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 space-y-0.5">
            <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Connecté</p>
            <p className="text-xs font-bold text-slate-800">{currentUser?.username || 'Utilisateur'}</p>
            <p className="text-[11px] text-slate-500">{currentUser?.role || ''}</p>
          </div>
          <button onClick={onLogout} className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-red-500 hover:bg-red-50 rounded-lg transition-colors">
            <Ico name="logout" size={15} /> Se déconnecter
          </button>
        </div>
      </aside>
    </>
  );
}

/* ══════════════════════════════════════════════════════ */
/* TOP BAR                                                */
/* ══════════════════════════════════════════════════════ */

function TopBar({ title, setMobileOpen, search, setSearch, onAction }: {
  title: string; setMobileOpen: (o: boolean) => void; search: string; setSearch: (s: string) => void;
  onAction: (action: string) => void;
}) {
  return (
    <header className="sticky top-0 z-10 bg-white/90 backdrop-blur-md border-b border-slate-100 px-4 lg:px-6 py-3 flex items-center gap-3">
      <button onClick={() => setMobileOpen(true)} className="lg:hidden text-slate-400 hover:text-slate-600"><Ico name="menu" size={21} /></button>
      <h2 className="text-base font-bold text-slate-800">{title}</h2>

      <div className="ml-auto flex items-center gap-1">
        <div className="relative hidden sm:block mr-2">
          <Ico name="search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-300" />
          <input type="text" placeholder="Rechercher..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="pl-7 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-slate-50 w-52 focus:outline-none focus:ring-2 focus:ring-orange-300" />
        </div>

        {/* Action buttons */}
        <ActionButton icon="save" label="Enregistrer" tooltip="Enregistrer" onClick={() => onAction('save')} />
        <ActionButton icon="print" label="Imprimer" tooltip="Imprimer" onClick={() => onAction('print')} />
        <ActionButton icon="import" label="Importer" tooltip="Importer" onClick={() => onAction('import')} />
        <ActionButton icon="exportFile" label="Exporter" tooltip="Exporter" onClick={() => onAction('export')} />

        <button className="relative ml-1 p-1.5 text-slate-400 hover:text-orange-500 rounded-lg hover:bg-orange-50 transition-colors">
          <Ico name="bell" size={18} /><span className="absolute top-1 right-1 h-2 w-2 bg-red-500 rounded-full border-2 border-white" />
        </button>
      </div>
    </header>
  );
}

function ActionButton({ icon, label, tooltip, onClick }: { icon: string; label: string; tooltip: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title={tooltip}
      className="p-1.5 text-slate-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors flex items-center gap-1"
    >
      <Ico name={icon} size={16} />
      <span className="hidden xl:inline text-[10px]">{label}</span>
    </button>
  );
}

/* ══════════════════════════════════════════════════════ */
/* MODAL                                                  */
/* ══════════════════════════════════════════════════════ */

function Modal({ open, onClose, title, children, actions }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode; actions?: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white px-6 py-4 border-b border-slate-100 flex items-center justify-between rounded-t-2xl z-10">
          <h3 className="text-sm font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1"><Ico name="close" size={18} /></button>
        </div>
        <div className="p-6 space-y-4">{children}</div>
        {actions && <div className="px-6 pb-6 pt-0 flex items-center justify-end gap-2">{actions}</div>}
      </div>
    </div>
  );
}

function InputField({ label, placeholder, value, onChange, type = 'text', className = '', step }: {
  label: string; placeholder?: string; value: string | number; onChange: (v: string) => void; type?: string; className?: string; step?: number;
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <label className="text-[11px] font-medium text-slate-500">{label}</label>
      <input type={type} step={step} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-300" />
    </div>
  );
}

function SelectField({ label, value, onChange, options, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[]; placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-slate-500">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-300">
        <option value="">{placeholder || 'Sélectionner...'}</option>
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </div>
  );
}

/* ══════════════════════════════════════════════════════ */
/* BADGES & AVATARS                                      */
/* ══════════════════════════════════════════════════════ */

function Avatar({ emp }: { emp: Employee }) {
  return (
    <div className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 shadow-sm" style={{ background: emp.avatarColor }}>
      {initials(emp.firstName, emp.lastName)}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Actif: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'En congé': 'bg-amber-100 text-amber-700 border-amber-200',
    Suspendu: 'bg-red-100 text-red-700 border-red-200',
    Accepté: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'En attente': 'bg-amber-100 text-amber-700 border-amber-200',
    Refusé: 'bg-red-100 text-red-700 border-red-200',
  };
  return <span className={cn('inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border', map[status] || 'bg-slate-100 text-slate-600')}>{status}</span>;
}

function ContractBadge({ type }: { type: string }) {
  const m: Record<string, string> = { CDI: 'bg-indigo-100 text-indigo-700', CDD: 'bg-sky-100 text-sky-700', Stage: 'bg-amber-100 text-amber-700', Freelance: 'bg-emerald-100 text-emerald-700' };
  return <span className={cn('inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold', m[type] || '')}>{type}</span>;
}

function formatMoney(n: number | null | undefined): string {
  const v = n ?? 0;
  if (v >= 1000000) return (v / 1000000).toFixed(1) + ' M FCFA';
  if (v >= 1000) return Math.round(v / 1000).toFixed(0) + ' K FCFA';
  return v.toLocaleString() + ' FCFA';
}

/* ══════════════════════════════════════════════════════ */
/* PAGE: DASHBOARD                                        */
/* ══════════════════════════════════════════════════════ */

// Supprime les restes de données de démo dans Firestore, sans toucher aux données réelles :
// - "leaves" et "presences" : collections entièrement héritées de l'ancienne version (plus
//   utilisées par le code actuel) → supprimées en totalité.
// - "payrollOverrides" : seules les entrées dont l'employeeId ne correspond à AUCUN employé
//   actuellement dans la collection "employees" sont supprimées (= anciennes données de démo).
//   Les saisies réelles de vos employés actuels restent intactes.
async function cleanupDemoData(): Promise<{ deletedLeaves: number; deletedPresences: number; deletedOrphanOverrides: number }> {
  const [leavesSnap, presencesSnap, overridesSnap, employeesSnap] = await Promise.all([
    getDocs(collection(db, 'leaves')),
    getDocs(collection(db, 'presences')),
    getDocs(collection(db, 'payrollOverrides')),
    getDocs(collection(db, 'employees')),
  ]);
  const validEmployeeIds = new Set(employeesSnap.docs.map(d => d.id));

  const deletions: Promise<void>[] = [];
  leavesSnap.docs.forEach(d => deletions.push(deleteDoc(d.ref)));
  presencesSnap.docs.forEach(d => deletions.push(deleteDoc(d.ref)));

  let deletedOrphanOverrides = 0;
  overridesSnap.docs.forEach(d => {
    const data = d.data() as { employeeId?: string };
    if (data.employeeId && !validEmployeeIds.has(data.employeeId)) {
      deletions.push(deleteDoc(d.ref));
      deletedOrphanOverrides++;
    }
  });

  await Promise.all(deletions);
  return { deletedLeaves: leavesSnap.size, deletedPresences: presencesSnap.size, deletedOrphanOverrides };
}

// ── Export des employés (CSV/Excel/PDF via le registre partagé) ──
const EMPLOYEE_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'matricule', label: 'Matricule' }, { key: 'prenom', label: 'Prénom' }, { key: 'nom', label: 'Nom' },
  { key: 'poste', label: 'Poste' }, { key: 'departement', label: 'Département' }, { key: 'site', label: 'Site' },
  { key: 'contrat', label: 'Contrat' }, { key: 'statut', label: 'Statut' }, { key: 'dateEmbauche', label: "Date d'embauche" },
  { key: 'salaireBase', label: 'Salaire base' }, { key: 'sursalaire', label: 'Sursalaire' }, { key: 'logement', label: 'Logement' },
  { key: 'transport', label: 'Transport' }, { key: 'primeFonctionImposable', label: 'Indem. représentation' },
  { key: 'primeResponsabilite', label: 'Prime responsabilité' }, { key: 'primeRendement', label: 'Prime rendement' },
  { key: 'primeExceptionnelle', label: 'Prime exceptionnelle' }, { key: 'autrePrime1Nom', label: 'Autre prime 1 — nom' },
  { key: 'autrePrime1Montant', label: 'Autre prime 1 — montant' }, { key: 'autrePrime2Nom', label: 'Autre prime 2 — nom' },
  { key: 'autrePrime2Montant', label: 'Autre prime 2 — montant' }, { key: 'primeFonctionNonImposable', label: 'Prime fonction non imp.' },
  { key: 'indemniteResponsabiliteNonTaxable', label: 'Indem. resp. non taxable' }, { key: 'situationFamiliale', label: 'Situation familiale' },
  { key: 'nombreEnfants', label: "Nombre d'enfants" }, { key: 'cnam', label: 'CNAM' }, { key: 'pret', label: 'Prêt' },
  { key: 'acompte', label: 'Acompte' }, { key: 'assurance', label: 'Assurance' }, { key: 'cnpsNumero', label: 'N° CNPS' },
  { key: 'categorie', label: 'Catégorie' }, { key: 'statutProfessionnel', label: 'Statut professionnel' }, { key: 'email', label: 'Email' },
  { key: 'telephone', label: 'Téléphone' }, { key: 'dateNaissance', label: 'Date de naissance' }, { key: 'nationalite', label: 'Nationalité' },
  { key: 'sexe', label: 'Sexe' }, { key: 'chefDeFamille', label: 'Chef de famille' }, { key: 'congesAnnuelsJours', label: 'Congés annuels (j)' },
];

function buildEmployeesExportRows(list: Employee[]): ExportRow[] {
  return list.map(e => {
    const c = getComponents(e);
    const siteName = sites.find(s => s.id === e.siteId)?.name || '';
    return {
      matricule: e.matricule || '', prenom: e.firstName, nom: e.lastName, poste: e.position, departement: e.department,
      site: siteName, contrat: e.contractType, statut: e.status, dateEmbauche: e.startDate,
      salaireBase: c.baseSalary, sursalaire: c.sursalaire, logement: c.housing, transport: c.transport,
      primeFonctionImposable: c.representation, primeResponsabilite: c.responsibility, primeRendement: c.performance,
      primeExceptionnelle: c.boisson, autrePrime1Nom: c.otherLabel1 || '', autrePrime1Montant: c.otherAmount1,
      autrePrime2Nom: c.otherLabel2 || '', autrePrime2Montant: c.otherAmount2,
      primeFonctionNonImposable: c.primeFonctionNonImposable, indemniteResponsabiliteNonTaxable: c.indemniteResponsabiliteNonTaxable,
      situationFamiliale: e.familySituation || '', nombreEnfants: e.numberOfChildren ?? 0, cnam: e.cnamAmount ?? 0,
      pret: e.pret ?? 0, acompte: e.acompte ?? 0, assurance: e.assurance ?? 0, cnpsNumero: e.cnpsNumber || '',
      categorie: e.category || '', statutProfessionnel: e.professionalStatus, email: e.email || '', telephone: e.phone || '',
      dateNaissance: e.birthDate || '', nationalite: e.nationality || '', sexe: e.gender || '',
      chefDeFamille: e.chefDeFamille ? 'Oui' : 'Non', congesAnnuelsJours: e.congesAnnuelsJours ?? '',
    };
  });
}

// Parseur CSV minimal (séparateur ";", champs entre guillemets) — suffisant pour des fichiers
// employés/Excel classiques, sans dépendance externe.
function parseCSVText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ';') { row.push(field); field = ''; }
    else if (ch === '\r') { /* ignoré */ }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ''));
}

// Importe un fichier CSV (même format que l'export). Met à jour un employé existant si son
// "matricule" correspond à un employé déjà présent, sinon en crée un nouveau.
async function importEmployeesCSV(file: File): Promise<{ created: number; updated: number; errors: string[] }> {
  const raw = await file.text();
  const rows = parseCSVText(raw.replace(/^\uFEFF/, ''));
  if (!rows.length) return { created: 0, updated: 0, errors: ['Fichier vide.'] };
  const header = rows[0].map(h => h.trim());
  const col = (name: string) => header.indexOf(name);
  let created = 0, updated = 0;
  const errors: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = (name: string) => { const j = col(name); return j >= 0 ? (r[j] ?? '').trim() : ''; };
    const num = (name: string) => { const n = Number(get(name).replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? 0 : n; };

    const firstName = get('prenom'), lastName = get('nom');
    if (!firstName && !lastName) { errors.push(`Ligne ${i + 1} : prénom et nom manquants — ignorée.`); continue; }

    const matricule = get('matricule');
    const site = sites.find(s => s.name === get('site'));
    const otherAmount1 = num('autrePrime1Montant');
    const otherAmount2 = num('autrePrime2Montant');
    const components: SalaryComponents = {
      baseSalary: num('salaireBase'), sursalaire: num('sursalaire'), seniority: 0, housing: num('logement'),
      transport: num('transport'), representation: num('primeFonctionImposable'), responsibility: num('primeResponsabilite'),
      performance: num('primeRendement'), boisson: num('primeExceptionnelle'),
      other: otherAmount1 + otherAmount2, otherAmount1, otherAmount2,
      otherLabel1: get('autrePrime1Nom') || undefined, otherLabel2: get('autrePrime2Nom') || undefined,
      primeFonctionNonImposable: num('primeFonctionNonImposable'), indemniteResponsabiliteNonTaxable: num('indemniteResponsabiliteNonTaxable'),
    };

    const existing = matricule ? employees.find(e => e.matricule === matricule) : undefined;
    if (existing) {
      Object.assign(existing, {
        firstName, lastName,
        position: get('poste') || existing.position, department: get('departement') || existing.department,
        siteId: site?.id || existing.siteId,
        contractType: (get('contrat') || existing.contractType) as Employee['contractType'],
        status: (get('statut') || existing.status) as Employee['status'],
        startDate: get('dateEmbauche') || existing.startDate,
        familySituation: (get('situationFamiliale') || existing.familySituation) as FamilySituation,
        numberOfChildren: get('nombreEnfants') !== '' ? num('nombreEnfants') : existing.numberOfChildren,
        cnamAmount: num('cnam'), pret: num('pret'), acompte: num('acompte'), assurance: num('assurance'),
        cnpsNumber: get('cnpsNumero') || existing.cnpsNumber, category: get('categorie') || existing.category,
        professionalStatus: (get('statutProfessionnel') || existing.professionalStatus) as Employee['professionalStatus'],
        email: get('email') || existing.email, phone: get('telephone') || existing.phone,
        birthDate: get('dateNaissance') || existing.birthDate, nationality: get('nationalite') || existing.nationality,
        gender: (get('sexe') || existing.gender) as Employee['gender'],
        chefDeFamille: get('chefDeFamille') ? get('chefDeFamille').toLowerCase() === 'oui' : existing.chefDeFamille,
        congesAnnuelsJours: get('congesAnnuelsJours') !== '' ? num('congesAnnuelsJours') : existing.congesAnnuelsJours,
        components, salary: computeSalary(components),
      });
      persistDoc('employees', existing.id, existing);
      updated++;
    } else {
      const newEmp: Employee = {
        id: `e${Date.now()}_${i}`, firstName, lastName, email: get('email'), phone: get('telephone'),
        position: get('poste'), department: get('departement'), siteId: site?.id || (sites[0]?.id || ''),
        contractType: (get('contrat') || 'CDI') as Employee['contractType'],
        startDate: get('dateEmbauche') || new Date().toISOString().slice(0, 10),
        salary: computeSalary(components), components,
        status: (get('statut') || 'Actif') as Employee['status'],
        professionalStatus: (get('statutProfessionnel') || 'Ouvrier') as Employee['professionalStatus'],
        category: get('categorie'), matricule: matricule || undefined, cnpsNumber: get('cnpsNumero') || undefined,
        familySituation: (get('situationFamiliale') || 'Célibataire') as FamilySituation,
        avatarColor: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
        birthDate: get('dateNaissance') || undefined, nationality: get('nationalite') || undefined,
        gender: (get('sexe') as Employee['gender']) || undefined,
        chefDeFamille: get('chefDeFamille').toLowerCase() === 'oui',
        numberOfChildren: num('nombreEnfants'), congesAnnuelsJours: get('congesAnnuelsJours') !== '' ? num('congesAnnuelsJours') : undefined,
        cnamAmount: num('cnam'), pret: num('pret'), acompte: num('acompte'), assurance: num('assurance'),
      };
      employees.push(newEmp);
      persistDoc('employees', newEmp.id, newEmp);
      created++;
    }
  }
  return { created, updated, errors };
}

function DashboardPage({ filtered }: { filtered: Employee[] }) {
  const acts = filtered.filter((e) => e.status === 'Actif').length;
  const inLeave = employees.filter((e) => e.status === 'En congé').length;
  const totalSalary = filtered.reduce((acc, e) => acc + e.salary, 0);

  const [showMaintenance, setShowMaintenance] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{ deletedLeaves: number; deletedPresences: number; deletedOrphanOverrides: number } | null>(null);
  const [cleanupError, setCleanupError] = useState('');

  async function runCleanup() {
    if (!window.confirm("Supprimer définitivement les anciennes données de démo (collections \"leaves\"/\"presences\" et entrées de paie orphelines) ? Les données de vos employés actuels ne seront pas touchées.")) return;
    setCleaning(true);
    setCleanupError('');
    setCleanupResult(null);
    try {
      const result = await cleanupDemoData();
      setCleanupResult(result);
    } catch (err) {
      setCleanupError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setCleaning(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Employés actifs" value={acts} sub={`${filtered.length} au total`} icon="employees" color="indigo" />
        <StatCard label="Sites actifs" value={sites.length} sub={`${sites.length} localisations`} icon="sites" color="violet" />
        <StatCard label="Employés en congé" value={inLeave} sub={`sur ${filtered.length} au total`} icon="leave" color="amber" />
        <StatCard label="Masse salariale totale" value={formatMoney(totalSalary)} sub={`Mensuel`} icon="paye" color="emerald" />
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <h3 className="text-sm font-bold text-slate-800 mb-4">Employés par département</h3>
        <div className="space-y-3">
          {Array.from(new Set(filtered.map(e => e.department).filter((d): d is string => !!d))).sort().map((dept, i) => {
            const count = filtered.filter((e) => e.department === dept).length;
            const pct = filtered.length ? Math.round((count / filtered.length) * 100) : 0;
            const palette = ['#6366f1', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#e11d48', '#0ea5e9', '#84cc16', '#f97316', '#14b8a6'];
            return (<div key={dept}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-slate-600">{dept}</span>
                <span className="text-[11px] font-semibold text-slate-700">{count} <span className="text-slate-400">({pct}%)</span></span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: palette[i % palette.length] }} />
              </div>
            </div>);
          })}
          {filtered.every(e => !e.department) && <p className="text-xs text-slate-400">Aucun département renseigné pour l'instant.</p>}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <h3 className="text-sm font-bold text-slate-800 mb-4">Vue des sites</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {sites.map((s) => {
            const count = filtered.filter((e) => e.siteId === s.id && e.status === 'Actif').length;
            return (
              <div key={s.id} className="rounded-xl border border-slate-100 p-4 hover:shadow-md transition-all">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-8 w-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500"><Ico name="sites" size={16} /></div>
                  <span className="text-xs font-bold text-slate-700">{s.name}</span>
                </div>
                <p className="text-[10px] text-slate-400 mb-2">{s.address}, {s.city}</p>
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]"><span className="text-slate-500">Effectif</span><span className="font-semibold text-slate-700">{count}/{s.capacity}</span></div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.min((count / s.capacity) * 100, 100)}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Outil de maintenance — nettoyage des restes de données de démo, repliable et discret */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <button onClick={() => setShowMaintenance(v => !v)} className="flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-slate-700">
          <Ico name="chevronDown" size={14} className={cn('transition-transform', showMaintenance ? 'rotate-180' : '')} />
          Outils de maintenance
        </button>
        {showMaintenance && (
          <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
            <div>
              <p className="text-xs font-semibold text-slate-700">Nettoyer les anciennes données de démo</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Supprime les collections "leaves"/"presences" (héritées de l'ancienne version, non utilisées) ainsi que les entrées
                de paie ("payrollOverrides") qui ne correspondent à aucun employé actuel. Vos employés et leurs saisies réelles
                (jours travaillés, heures sup...) ne sont jamais touchés.
              </p>
            </div>
            <button onClick={runCleanup} disabled={cleaning}
              className="px-4 py-2 text-xs font-bold bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-xl transition-colors disabled:opacity-50">
              {cleaning ? 'Nettoyage en cours…' : 'Nettoyer les données de démo'}
            </button>
            {cleanupResult && (
              <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                Terminé : {cleanupResult.deletedLeaves} document(s) "leaves", {cleanupResult.deletedPresences} document(s) "presences"
                et {cleanupResult.deletedOrphanOverrides} entrée(s) de paie orpheline(s) supprimés.
              </p>
            )}
            {cleanupError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">Erreur : {cleanupError}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, icon, color }: { label: string; value: string | number; sub?: string; icon: string; color: string }) {
  const bgs: Record<string, string> = { indigo: 'from-indigo-500 to-indigo-600', violet: 'from-violet-500 to-violet-600', emerald: 'from-emerald-500 to-emerald-600', amber: 'from-amber-500 to-amber-600', sky: 'from-sky-500 to-sky-600' };
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className={cn('h-9 w-9 rounded-xl flex items-center justify-center text-white shadow-sm bg-gradient-to-br', bgs[color] || bgs.indigo)}>
          <Ico name={icon} size={18} className="text-white" />
        </div>
        {sub && <span className="text-[10px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">{sub}</span>}
      </div>
      <p className="text-xl font-bold text-slate-800">{value}</p>
      <p className="text-[11px] text-slate-400 mt-0.5">{label}</p>
    </div>
  );
}


/* ══════════════════════════════════════════════════════ */
/* PAGE: EMPLOYÉS                                         */
/* ══════════════════════════════════════════════════════ */

const emptyComponents = (): SalaryComponents => ({ baseSalary: 0, sursalaire: 0, seniority: 0, housing: 0, transport: 0, representation: 0, responsibility: 0, performance: 0, boisson: 0, other: 0, otherAmount1: 0, otherAmount2: 0, primeFonctionNonImposable: 0, indemniteResponsabiliteNonTaxable: 0 });

// Champ de rubrique de paie
function SalaryLine({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[11px] text-slate-600 flex-1">{label}</label>
      <input type="number" min={0} step={5000} value={value || 0} onChange={(e) => onChange(Number(e.target.value))}
        className="w-32 px-2.5 py-1.5 text-xs text-right border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-300" />
      <span className="text-[9px] text-slate-400 w-8">FCFA</span>
    </div>
  );
}

// Ligne "Autre prime" à nom personnalisable : l'utilisateur saisit lui-même l'intitulé de la
// prime (ex : "Prime de salissure") en plus du montant — contrairement aux autres rubriques,
// dont le libellé est fixe.
function CustomPrimeLine({ index, name, value, onNameChange, onValueChange }: { index: number; name: string; value: number; onNameChange: (v: string) => void; onValueChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="text" value={name} onChange={(e) => onNameChange(e.target.value)}
        placeholder={`Autres primes ${index} — nom de la prime`}
        className="text-[11px] text-slate-600 flex-1 px-2 py-1.5 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-orange-300 placeholder:text-slate-300" />
      <input type="number" min={0} step={5000} value={value || 0} onChange={(e) => onValueChange(Number(e.target.value))}
        className="w-32 px-2.5 py-1.5 text-xs text-right border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-300" />
      <span className="text-[9px] text-slate-400 w-8">FCFA</span>
    </div>
  );
}

// Bloc complet des rubriques de paie (réutilisé add/edit)
function SalaryComponentsForm({ comp, onChange, startDate }: { comp: SalaryComponents; onChange: (c: SalaryComponents) => void; startDate?: string }) {
  const total = computeSalary(comp);
  const set = (k: keyof SalaryComponents, v: number) => onChange({ ...comp, [k]: v });
  // Prime d'ancienneté : calculée automatiquement (jamais saisie manuellement), comme dans "LIVRE DE PAIE"
  const today = new Date().toISOString().split('T')[0];
  const { ratePct } = computeAncienneteRate(startDate, today);
  const ancienneteAuto = computeAncienneteAmount(comp.baseSalary, startDate, today);
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 space-y-2">
      <p className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
        <Ico name="paye" size={13} className="text-orange-500" /> Rubriques de paie
      </p>
      <div className="space-y-2 bg-white rounded-lg p-3 border border-slate-100">
        <SalaryLine label="Salaire de base / échelon" value={comp.baseSalary} onChange={(v) => set('baseSalary', v)} />
        <SalaryLine label="Sursalaire" value={comp.sursalaire} onChange={(v) => set('sursalaire', v)} />
        <div className="flex items-center justify-between py-1">
          <span className="text-[11px] text-slate-500">Prime d'ancienneté <span className="text-slate-300">(auto — {ratePct}% du salaire de base)</span></span>
          <span className="text-xs font-semibold text-slate-600">{formatFCFA(ancienneteAuto)}</span>
        </div>
        <SalaryLine label="Indemnité de logement" value={comp.housing} onChange={(v) => set('housing', v)} />
        <SalaryLine label="Indemnité de transport (non imposable)" value={comp.transport} onChange={(v) => set('transport', v)} />
        <SalaryLine label="Prime de fonction non imposable" value={comp.primeFonctionNonImposable} onChange={(v) => set('primeFonctionNonImposable', v)} />
        <SalaryLine label="Indemnité de responsabilité non taxable" value={comp.indemniteResponsabiliteNonTaxable} onChange={(v) => set('indemniteResponsabiliteNonTaxable', v)} />
        <SalaryLine label="Indemnité de représentation" value={comp.representation} onChange={(v) => set('representation', v)} />
        <SalaryLine label="Prime de responsabilité" value={comp.responsibility} onChange={(v) => set('responsibility', v)} />
        <SalaryLine label="Prime de rendement" value={comp.performance} onChange={(v) => set('performance', v)} />
        <CustomPrimeLine index={1} name={comp.otherLabel1 || ''} value={comp.otherAmount1}
          onNameChange={(v) => onChange({ ...comp, otherLabel1: v })}
          onValueChange={(v) => onChange({ ...comp, otherAmount1: v, other: v + (comp.otherAmount2 || 0) })} />
        <CustomPrimeLine index={2} name={comp.otherLabel2 || ''} value={comp.otherAmount2}
          onNameChange={(v) => onChange({ ...comp, otherLabel2: v })}
          onValueChange={(v) => onChange({ ...comp, otherAmount2: v, other: (comp.otherAmount1 || 0) + v })} />
      </div>
      <div className="flex items-center justify-between px-1 pt-1">
        <span className="text-xs font-bold text-slate-700">SALAIRE BRUT TOTAL</span>
        <span className="text-sm font-extrabold text-orange-600">{formatFCFA(total + ancienneteAuto)}</span>
      </div>
      <p className="text-[9px] text-slate-400 px-1">La prime d'ancienneté est recalculée automatiquement à chaque paie en fonction de la date d'embauche (comme dans le classeur Excel).</p>
    </div>
  );
}

// Bloc commun : statut professionnel, catégorie, état civil, infos administratives,
// congés, retenues fixes (prêt/acompte/assurance/CMU) & logo.
// Reprend les champs de l'onglet "MODE D'EMPLOI" absents jusqu'ici de la fiche employé.
function EmployeeExtraFields({ form, setForm, onLogo }: {
  form: Partial<Employee>; setForm: (f: Partial<Employee>) => void; onLogo: (file: File | undefined) => void;
}) {
  const parts = computeFiscalParts(form.familySituation, form.numberOfChildren);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-[11px] text-slate-500">Statut professionnel</label>
          <select value={form.professionalStatus || 'Ouvrier'} onChange={e => setForm({ ...form, professionalStatus: e.target.value as Employee['professionalStatus'] })}
            className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:ring-2 focus:ring-orange-300">
            <option>Cadre</option>
            <option>Agent de maitrise</option>
            <option>Ouvrier</option>
          </select>
        </div>
        <InputField label="Catégorie" value={form.category || ''} onChange={v => setForm({ ...form, category: v })} placeholder="Ex: M1, 5e A..." />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <InputField label="Matricule" value={form.matricule || ''} onChange={v => setForm({ ...form, matricule: v })} placeholder="003777" />
        <InputField label="N° CNPS" value={form.cnpsNumber || ''} onChange={v => setForm({ ...form, cnpsNumber: v })} placeholder="18001..." />
      </div>

      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pt-1">État civil (fiche "Mode d'emploi")</p>
      <div className="grid grid-cols-2 gap-3">
        <InputField label="Date de naissance" type="date" value={form.birthDate || ''} onChange={v => setForm({ ...form, birthDate: v })} />
        <InputField label="Nationalité" value={form.nationality || ''} onChange={v => setForm({ ...form, nationality: v })} placeholder="Ivoirienne" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-[11px] text-slate-500">Sexe</label>
          <select value={form.gender || 'Homme'} onChange={e => setForm({ ...form, gender: e.target.value as Employee['gender'] })}
            className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:ring-2 focus:ring-orange-300">
            <option>Homme</option>
            <option>Femme</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-slate-500">Chef de famille</label>
          <select value={form.chefDeFamille ? 'Oui' : 'Non'} onChange={e => setForm({ ...form, chefDeFamille: e.target.value === 'Oui' })}
            className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:ring-2 focus:ring-orange-300">
            <option>Oui</option>
            <option>Non</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-[11px] text-slate-500">Situation familiale</label>
          <select value={form.familySituation || 'Célibataire'} onChange={e => setForm({ ...form, familySituation: e.target.value as FamilySituation })}
            className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:ring-2 focus:ring-orange-300">
            {FAMILY_SITUATIONS.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        <InputField label="Nombre d'enfants" type="number" value={form.numberOfChildren ?? 0} onChange={v => setForm({ ...form, numberOfChildren: Number(v) })} />
      </div>
      <div className="flex items-center justify-between px-1 py-1.5 bg-orange-50 rounded-lg">
        <span className="text-[11px] text-orange-700 font-semibold">Nombre de parts fiscales (calculé)</span>
        <span className="text-sm font-extrabold text-orange-700">{parts}</span>
      </div>

      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pt-1">Congés</p>
      <div className="grid grid-cols-2 gap-3">
        <InputField label="Congés annuels (jours)" type="number" value={form.congesAnnuelsJours ?? 27} onChange={v => setForm({ ...form, congesAnnuelsJours: Number(v) })} />
        <InputField label="Date départ en congés" type="date" value={form.dateDepartConges || ''} onChange={v => setForm({ ...form, dateDepartConges: v })} />
      </div>

      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider pt-1">Retenues fixes mensuelles</p>
      <div className="grid grid-cols-3 gap-3">
        <InputField label="CNAM / CMU" type="number" value={form.cnamAmount ?? 0} onChange={v => setForm({ ...form, cnamAmount: Number(v) })} />
        <InputField label="Prêt" type="number" value={form.pret ?? 0} onChange={v => setForm({ ...form, pret: Number(v) })} />
        <InputField label="Acompte" type="number" value={form.acompte ?? 0} onChange={v => setForm({ ...form, acompte: Number(v) })} />
      </div>
      <InputField label="Assurance maladie" type="number" value={form.assurance ?? 0} onChange={v => setForm({ ...form, assurance: Number(v) })} />

      {/* Logo importable */}
      <div className="space-y-1">
        <label className="text-[11px] text-slate-500">Logo de l'entreprise (optionnel)</label>
        <div className="flex items-center gap-3">
          <div className="h-16 w-16 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0">
            {form.logoUrl
              ? <img src={form.logoUrl} alt="logo" className="h-full w-full object-contain" />
              : <span className="text-[9px] text-slate-400 text-center px-1">Logo</span>}
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="px-3 py-1.5 text-[11px] font-semibold bg-orange-50 text-orange-600 rounded-lg cursor-pointer hover:bg-orange-100 transition-colors inline-flex items-center gap-1.5 w-fit">
              <Ico name="import" size={13} /> Importer un logo
              <input type="file" accept="image/*" className="hidden" onChange={e => onLogo(e.target.files?.[0])} />
            </label>
            {form.logoUrl && <button onClick={() => setForm({ ...form, logoUrl: '' })} className="text-[10px] text-red-500 hover:underline w-fit">Retirer le logo</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmployeesPage({ filtered }: { filtered: Employee[] }) {
  const { bump } = useContext(DataVersionContext);
  const [modal, setModal] = useState(false);
  const [editModal, setEditModal] = useState<Employee | null>(null);
  const [form, setForm] = useState<Partial<Employee>>({});
  const [comp, setComp] = useState<SalaryComponents>(emptyComponents());
  const [filterSite, setFilterSite] = useState('');
  const [filterDept, setFilterDept] = useState('');

  let list = filtered;
  if (filterSite) list = list.filter((e) => e.siteId === filterSite);
  if (filterDept) list = list.filter((e) => e.department === filterDept);
  const depts = Array.from(new Set(employees.map((e) => e.department)));

  const buildRows = useCallback(() => buildEmployeesExportRows(list), [list]);
  useEffect(() => {
    exportRegistry['employees'] = { title: 'Employés', tableClass: 'employees-table', columns: EMPLOYEE_EXPORT_COLUMNS, buildRows };
  }, [buildRows]);

  function openAdd() {
    setForm({
      firstName: '', lastName: '', email: '', phone: '', position: '', department: '', siteId: '', contractType: 'CDI',
      startDate: new Date().toISOString().split('T')[0], status: 'Actif', professionalStatus: 'Ouvrier', category: '',
      matricule: '', cnpsNumber: '', familySituation: 'Célibataire', logoUrl: '',
      avatarColor: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
      birthDate: '', nationality: 'Ivoirienne', gender: 'Homme', chefDeFamille: false, numberOfChildren: 0,
      congesAnnuelsJours: 27, dateDepartConges: '', cnamAmount: 0, pret: 0, acompte: 0, assurance: 0,
    });
    setComp(emptyComponents());
    setModal(true);
  }

  function doAdd() {
    const newEmp: Employee = {
      id: `e${Date.now()}`, firstName: form.firstName!, lastName: form.lastName!, email: form.email!, phone: form.phone!,
      position: form.position!, department: form.department!, siteId: form.siteId!, contractType: form.contractType! as Employee['contractType'],
      startDate: form.startDate!, components: comp, salary: computeSalary(comp), status: form.status! as Employee['status'],
      professionalStatus: (form.professionalStatus as Employee['professionalStatus']) || 'Ouvrier', category: form.category || '',
      matricule: form.matricule, cnpsNumber: form.cnpsNumber, familySituation: form.familySituation as FamilySituation, logoUrl: form.logoUrl,
      avatarColor: form.avatarColor!,
      birthDate: form.birthDate, nationality: form.nationality, gender: form.gender, chefDeFamille: form.chefDeFamille,
      numberOfChildren: form.numberOfChildren, congesAnnuelsJours: form.congesAnnuelsJours, dateDepartConges: form.dateDepartConges,
      cnamAmount: form.cnamAmount, pret: form.pret, acompte: form.acompte, assurance: form.assurance,
    };
    employees.push(newEmp);
    persistDoc('employees', newEmp.id, newEmp);
    setModal(false);
    bump();
  }

  function openEdit(emp: Employee) {
    setForm({ ...emp });
    setComp(getComponents(emp));
    setEditModal(emp);
  }
  function doEdit() {
    if (!editModal) return;
    Object.assign(editModal, form, { components: comp, salary: computeSalary(comp) });
    persistDoc('employees', editModal.id, editModal);
    setEditModal(null);
    bump();
  }

  // Import du logo (data URL)
  function handleLogoUpload(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm(f => ({ ...f, logoUrl: reader.result as string }));
    reader.readAsDataURL(file);
  }
  function handleDelete(id: string) { if (confirm('Supprimer cet employé ?')) { const i = employees.findIndex(e => e.id === id); if (i >= 0) employees.splice(i, 1); removeDoc('employees', id); bump(); } }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex flex-wrap gap-3 items-end">
        <Ico name="filter" size={16} className="text-slate-400 mb-2" />
        <div className="min-w-[140px]">
          <label className="text-[10px] text-slate-400 block mb-1">Site</label>
          <select value={filterSite} onChange={(e) => setFilterSite(e.target.value)} className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:ring-2 focus:ring-orange-300"><option value="">Tous les sites</option>{sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </div>
        <div className="min-w-[160px]">
          <label className="text-[10px] text-slate-400 block mb-1">Département</label>
          <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)} className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:ring-2 focus:ring-orange-300"><option value="">Tous</option>{depts.map(d => <option key={d} value={d}>{d}</option>)}</select>
        </div>
        <button onClick={openAdd} className="ml-auto flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white text-xs font-semibold rounded-xl hover:from-orange-600 hover:to-orange-700 shadow-sm shadow-orange-200">
          <Ico name="plus" size={15} /> Ajouter
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left employees-table">
            <thead><tr className="border-b border-slate-100 bg-slate-50/50">
              <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Employé</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Poste</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Site</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Salaire</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Contrat</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Statut</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.map(emp => {
                const site = sites.find(s => s.id === emp.siteId);
                return <tr key={emp.id} className="hover:bg-slate-50/80 cursor-pointer" onClick={() => openEdit(emp)}>
                  <td className="px-4 py-3"><div className="flex items-center gap-3"><Avatar emp={emp} /><div><p className="text-xs font-semibold text-slate-700">{emp.firstName} {emp.lastName}</p><p className="text-[10px] text-slate-400">{emp.email}</p></div></div></td>
                  <td className="px-4 py-3 text-xs text-slate-600">{emp.position}<br /><span className="text-[10px] text-slate-400">{emp.department}</span></td>
                  <td className="px-4 py-3 text-xs text-slate-600">{site?.name || '-'}</td>
                  <td className="px-4 py-3 text-xs font-semibold text-slate-700">{formatFCFA(emp.salary)}</td>
                  <td className="px-4 py-3"><ContractBadge type={emp.contractType} /></td>
                  <td className="px-4 py-3"><StatusBadge status={emp.status} /></td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex gap-1"><button onClick={() => openEdit(emp)} className="p-1.5 text-slate-400 hover:text-orange-600 rounded-lg hover:bg-orange-50"><Ico name="edit" size={14} /></button><button onClick={() => handleDelete(emp.id)} className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50"><Ico name="trash" size={14} /></button></div>
                  </td>
                </tr>;
              })}
              {list.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-slate-400">Aucun résultat</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-slate-100 flex justify-between">
          <span className="text-[11px] text-slate-400">{list.length} employé(s)</span>
        </div>
      </div>

      {/* Add Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="Nouvel employé">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3"><InputField label="Prénom" value={form.firstName || ''} onChange={v => setForm({ ...form, firstName: v })} placeholder="Jean" /><InputField label="Nom" value={form.lastName || ''} onChange={v => setForm({ ...form, lastName: v })} placeholder="Dupont" /></div>
          <InputField label="Email" type="email" value={form.email || ''} onChange={v => setForm({ ...form, email: v })} />
          <InputField label="Téléphone" value={form.phone || ''} onChange={v => setForm({ ...form, phone: v })} />
          <InputField label="Poste" value={form.position || ''} onChange={v => setForm({ ...form, position: v })} />
          <InputField label="Département" value={form.department || ''} onChange={v => setForm({ ...form, department: v })} />
          <div className="grid grid-cols-2 gap-3">
            <SelectField label="Site" value={form.siteId || ''} onChange={v => setForm({ ...form, siteId: v })} options={sites.map(s => ({ v: s.id, l: s.name }))} />
            <div className="space-y-1"><label className="text-[11px] text-slate-500">Contrat</label><select value={form.contractType || 'CDI'} onChange={e => setForm({ ...form, contractType: e.target.value as Employee['contractType'] })} className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50"><option>CDI</option><option>CDD</option><option>Stage</option><option>Freelance</option></select></div>
          </div>
          <InputField label="Date d'embauche" type="date" value={form.startDate || ''} onChange={v => setForm({ ...form, startDate: v })} />
          <EmployeeExtraFields form={form} setForm={setForm} onLogo={handleLogoUpload} />
          <SalaryComponentsForm comp={comp} onChange={setComp} startDate={form.startDate} />
          <div className="space-y-1"><label className="text-[11px] text-slate-500">Statut (présence)</label><select value={form.status || 'Actif'} onChange={e => setForm({ ...form, status: e.target.value as Employee['status'] })} className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50"><option>Actif</option><option>En congé</option><option>Suspendu</option></select></div>
          <button onClick={doAdd} className="w-full py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 text-white text-xs font-bold rounded-xl">Enregistrer</button>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal open={!!editModal} onClose={() => setEditModal(null)} title={`Modifier ${editModal?.firstName || ''} ${editModal?.lastName || ''}`}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3"><InputField label="Prénom" value={form.firstName || ''} onChange={v => setForm({ ...form, firstName: v })} /><InputField label="Nom" value={form.lastName || ''} onChange={v => setForm({ ...form, lastName: v })} /></div>
          <InputField label="Email" type="email" value={form.email || ''} onChange={v => setForm({ ...form, email: v })} />
          <InputField label="Téléphone" value={form.phone || ''} onChange={v => setForm({ ...form, phone: v })} />
          <InputField label="Poste" value={form.position || ''} onChange={v => setForm({ ...form, position: v })} />
          <InputField label="Département" value={form.department || ''} onChange={v => setForm({ ...form, department: v })} />
          <div className="grid grid-cols-2 gap-3">
            <SelectField label="Site" value={form.siteId || ''} onChange={v => setForm({ ...form, siteId: v })} options={sites.map(s => ({ v: s.id, l: s.name }))} />
            <div className="space-y-1"><label className="text-[11px] text-slate-500">Contrat</label><select value={form.contractType || 'CDI'} onChange={e => setForm({ ...form, contractType: e.target.value as Employee['contractType'] })} className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50"><option>CDI</option><option>CDD</option><option>Stage</option><option>Freelance</option></select></div>
          </div>
          <InputField label="Date embauche" type="date" value={form.startDate || ''} onChange={v => setForm({ ...form, startDate: v })} />
          <EmployeeExtraFields form={form} setForm={setForm} onLogo={handleLogoUpload} />
          <SalaryComponentsForm comp={comp} onChange={setComp} startDate={form.startDate} />
          <div className="space-y-1"><label className="text-[11px] text-slate-500">Statut (présence)</label><select value={form.status || 'Actif'} onChange={e => setForm({ ...form, status: e.target.value as Employee['status'] })} className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50"><option>Actif</option><option>En congé</option><option>Suspendu</option></select></div>
          <div className="flex gap-2 pt-2">
            <button onClick={doEdit} className="flex-1 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5"><Ico name="save" size={14} /> Enregistrer</button>
            <button onClick={() => setEditModal(null)} className="px-4 py-2.5 bg-slate-100 text-slate-600 text-xs font-bold rounded-xl hover:bg-slate-200">Annuler</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}


/* ══════════════════════════════════════════════════════ */
/* PAGE: SITES                                             */
/* ══════════════════════════════════════════════════════ */

function SitesPage({ search }: { search: string }) {
  const { bump } = useContext(DataVersionContext);
  const [addModal, setAddModal] = useState(false);
  const [editModal, setEditModal] = useState<Site | null>(null);
  const [mForm, setMForm] = useState<Partial<Site>>({});

  function saveNew() {
    const ns: Site = { id:`s${Date.now()}`, name:mForm.name||'', address:mForm.address||'', city:mForm.city||'', phone:mForm.phone||'', manager:mForm.manager||'', capacity:Number(mForm.capacity)||10, cnpsEmployeur:mForm.cnpsEmployeur||'', numeroContribuable:mForm.numeroContribuable||'' };
    sites.push(ns); persistDoc('sites', ns.id, ns); setAddModal(false); bump();
  }
  function saveEdit() {
    if(!editModal)return;Object.assign(editModal,mForm);persistDoc('sites', editModal.id, editModal);setEditModal(null);bump();
  }

  const q = search.trim().toLowerCase();
  const sitesList = q ? sites.filter(s => `${s.name} ${s.address} ${s.city} ${s.manager} ${s.phone}`.toLowerCase().includes(q)) : sites;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{sitesList.length} site(s)</p>
        <div className="flex items-center gap-2">
          <button onClick={() => exportCSV(`sites_${new Date().toISOString().slice(0, 10)}.csv`,
            [{ key: 'nom', label: 'Nom' }, { key: 'adresse', label: 'Adresse' }, { key: 'ville', label: 'Ville' }, { key: 'telephone', label: 'Téléphone' },
            { key: 'responsable', label: 'Responsable' }, { key: 'capacite', label: 'Capacité' }, { key: 'effectif', label: 'Effectif' },
            { key: 'cnpsEmployeur', label: 'CNPS employeur' }, { key: 'numeroContribuable', label: 'N° contribuable' }],
            sitesList.map(s => ({
              nom: s.name, adresse: s.address, ville: s.city, telephone: s.phone, responsable: s.manager, capacite: s.capacity,
              effectif: employees.filter(e => e.siteId === s.id).length, cnpsEmployeur: s.cnpsEmployeur || '', numeroContribuable: s.numeroContribuable || '',
            })))}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-600 text-xs font-semibold rounded-xl hover:bg-slate-50">
            <Ico name="exportFile" size={14} /> Exporter
          </button>
          <button onClick={()=>{setMForm({capacity:10});setAddModal(true)}} className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white text-xs font-semibold rounded-xl shadow-sm shadow-orange-200">
            <Ico name="plus" size={15} /> Ajouter un site
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {sitesList.map(s=>{
          const cnt = employees.filter(e=>e.siteId===s.id).length;
          return <div key={s.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 hover:shadow-md transition-all group cursor-pointer" onClick={()=>{setMForm({...s});setEditModal(s);}}>
            <div className="flex items-start justify-between mb-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-orange-100 to-orange-200 flex items-center justify-center text-orange-600"><Ico name="sites" size={20}/></div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e=>e.stopPropagation()}>
                <button onClick={()=>{setMForm({...s});setEditModal(s)}} className="p-1.5 text-slate-400 hover:text-orange-600 rounded-lg hover:bg-orange-50"><Ico name="edit" size={13}/></button>
                <button onClick={()=>{if(confirm('Supprimer ce site ?')){const i=sites.findIndex(x=>x.id===s.id);if(i>=0)sites.splice(i,1);removeDoc('sites', s.id);bump();}}} className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50"><Ico name="trash" size={13}/></button>
              </div>
            </div>
            <h4 className="text-sm font-bold text-slate-800">{s.name}</h4>
            <p className="text-[11px] text-slate-400 mt-0.5">{s.address}, {s.city}</p>
            <p className="text-[11px] text-slate-500 mt-1">📞 {s.phone} · 👤 {s.manager}</p>
            <div className="mt-3 pt-3 border-t border-slate-100">
              <div className="flex justify-between text-[11px]"><span className="text-slate-400">Effectif</span><span className="font-semibold text-slate-700">{cnt}/{s.capacity}</span></div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1">
                <div className="h-full bg-orange-500 rounded-full" style={{width:`${Math.min(cnt/s.capacity*100,100)}%`}}/>
              </div>
            </div>
          </div>;
        })}
      </div>

      <Modal open={addModal} onClose={()=>setAddModal(false)} title="Nouveau site">
        <div className="space-y-3">
          <InputField label="Nom du site" value={mForm.name||''} onChange={v=>setMForm({...mForm,name:v})}/>
          <div className="grid grid-cols-2 gap-3"><InputField label="Adresse" value={mForm.address||''} onChange={v=>setMForm({...mForm,address:v})}/><InputField label="Ville" value={mForm.city||''} onChange={v=>setMForm({...mForm,city:v})}/></div>
          <div className="grid grid-cols-2 gap-3"><InputField label="Téléphone" value={mForm.phone||''} onChange={v=>setMForm({...mForm,phone:v})}/><InputField label="Responsable" value={mForm.manager||''} onChange={v=>setMForm({...mForm,manager:v})}/></div>
          <InputField label="Capacité" type="number" value={mForm.capacity||10} onChange={v=>setMForm({...mForm,capacity:Number(v)})}/>
          <div className="grid grid-cols-2 gap-3">
            <InputField label="CNPS Employeur" value={mForm.cnpsEmployeur||''} onChange={v=>setMForm({...mForm,cnpsEmployeur:v})}/>
            <InputField label="Numéro contribuable" value={mForm.numeroContribuable||''} onChange={v=>setMForm({...mForm,numeroContribuable:v})}/>
          </div>
          <button onClick={saveNew} className="w-full py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 text-white text-xs font-bold rounded-xl">Enregistrer</button>
        </div>
      </Modal>

      <Modal open={!!editModal} onClose={()=>setEditModal(null)} title="Modifier le site">
        <div className="space-y-3">
          <InputField label="Nom du site" value={mForm.name||''} onChange={v=>setMForm({...mForm,name:v})}/>
          <div className="grid grid-cols-2 gap-3"><InputField label="Adresse" value={mForm.address||''} onChange={v=>setMForm({...mForm,address:v})}/><InputField label="Ville" value={mForm.city||''} onChange={v=>setMForm({...mForm,city:v})}/></div>
          <div className="grid grid-cols-2 gap-3"><InputField label="Téléphone" value={mForm.phone||''} onChange={v=>setMForm({...mForm,phone:v})}/><InputField label="Responsable" value={mForm.manager||''} onChange={v=>setMForm({...mForm,manager:v})}/></div>
          <InputField label="Capacité" type="number" value={mForm.capacity||10} onChange={v=>setMForm({...mForm,capacity:Number(v)})}/>
          <div className="grid grid-cols-2 gap-3">
            <InputField label="CNPS Employeur" value={mForm.cnpsEmployeur||''} onChange={v=>setMForm({...mForm,cnpsEmployeur:v})}/>
            <InputField label="Numéro contribuable" value={mForm.numeroContribuable||''} onChange={v=>setMForm({...mForm,numeroContribuable:v})}/>
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={saveEdit} className="flex-1 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5"><Ico name="save" size={14}/> Enregistrer</button>
            <button onClick={()=>setEditModal(null)} className="px-4 py-2.5 bg-slate-100 text-slate-600 text-xs font-bold rounded-xl hover:bg-slate-200">Annuler</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}


/* ══════════════════════════════════════════════════════ */
/* PAGE: PAIE                                              */
/* ══════════════════════════════════════════════════════ */

// Nombre moyen de jours ouvrés par mois (base de calcul du taux horaire pour les heures sup.)
const JOURS_OUVRES_MOIS = 22;
// Convention de paie ivoirienne : le salaire mensuel (SALAIRE, SURSALAIRE) est réparti sur
// 30 jours calendaires, comme l'indique l'onglet "ALI" du classeur Excel (colonne NOMBRE = 30,
// gain = base × nombre/30). C'est cette base de 30 jours qui sert à proratiser la paie en
// fonction des jours réellement travaillés saisis dans "Présences".
// ── Réglages généraux persistés (Firestore : parametres/general) ──
// Objet mutable au niveau module (même schéma que les collections employees/leaves...) :
// modifié en place puis explicitement persisté via setAccidentTravailTauxPct, pour que la
// même valeur s'applique partout (bulletin, Livre de paie fin d'année, Charges sociales).
const parametresGeneraux = { accidentTravailTauxPct: (CHARGES_PATRONALES.accidentTravailTaux * 100) };

async function loadParametresGeneraux() {
  try {
    const snap = await getDoc(doc(db, 'parametres', 'general'));
    if (snap.exists()) {
      const data = snap.data() as Partial<typeof parametresGeneraux>;
      if (typeof data.accidentTravailTauxPct === 'number') parametresGeneraux.accidentTravailTauxPct = data.accidentTravailTauxPct;
    }
  } catch (err) {
    console.error('Erreur de chargement Firestore (parametres/general) :', err);
  }
}

function setAccidentTravailTauxPct(pct: number) {
  parametresGeneraux.accidentTravailTauxPct = Math.max(0, pct);
  persistDoc('parametres', 'general', parametresGeneraux);
}

const JOURS_MOIS_PAIE = 30;

// Registre partagé : chaque page "exportable" (Employés, Paie, Livre de paie fin d'année,
// Charges sociales...) y enregistre sa configuration d'export courante (colonnes + données),
// sous sa propre clé de page. La barre d'outils globale (bouton Exporter/Imprimer) lit
// simplement l'entrée correspondant à la page actuellement affichée.
type ExportConfigEntry = { title: string; tableClass: string; columns: ExportColumn[]; buildRows: () => ExportRow[] };
const exportRegistry: Record<string, ExportConfigEntry> = {};

const PAIE_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'n', label: 'N°' }, { key: 'matricule', label: 'Matricule' }, { key: 'nom', label: 'Nom' },
  { key: 'prenoms', label: 'Prénoms' }, { key: 'joursPayes', label: 'Jours payés' }, { key: 'heureSup', label: 'H. sup' },
  { key: 'salaireBase', label: 'Salaire base' }, { key: 'sursalaire', label: 'Sursalaire' }, { key: 'heureSuppl', label: 'Heure suppl.' },
  { key: 'primeAnciennete', label: 'Prime ancienneté' }, { key: 'primeFonctionNonImp', label: 'Prime fonction non imp.' },
  { key: 'indemniteRespNonTax', label: 'Indem. resp. non taxable' }, { key: 'primeFonction', label: 'Prime fonction' },
  { key: 'totalBrut', label: 'Total brut' }, { key: 'brutImposable', label: 'Brut imposable' }, { key: 'brutSocial', label: 'Brut social' },
  { key: 'dateEmbauche', label: 'Date embauche' }, { key: 'dureeMois', label: 'Durée (mois)' }, { key: 'tauxAnc', label: 'Taux% anc.' },
  { key: 'situationFam', label: 'Situation fam.' }, { key: 'enfants', label: 'Enfants' }, { key: 'parts', label: 'Parts' },
  { key: 'impotsBrut', label: 'Impôts brut' }, { key: 'ricf', label: 'RICF' }, { key: 'its', label: 'ITS' }, { key: 'cnps', label: 'CNPS' },
  { key: 'cnam', label: 'CNAM' }, { key: 'prets', label: 'Prêts' }, { key: 'indemniteTransport', label: 'Indem. transport' },
  { key: 'salaireNet', label: 'Salaire net' },
];

// Garde-fou global : un employé créé/importé avec des données de salaire incomplètes ou
// manquantes (ex. document Firestore partiellement écrit par un ancien formulaire) ne doit
// JAMAIS faire planter une page entière — on retombe sur des rubriques à 0 plutôt que de
// lever une exception. Utilisé partout où "emp.components" est lu dans les calculs de paie.
function getComponents(emp: Employee): SalaryComponents {
  const c = emp.components;
  return {
    baseSalary: c?.baseSalary ?? 0,
    sursalaire: c?.sursalaire ?? 0,
    seniority: c?.seniority ?? 0,
    housing: c?.housing ?? 0,
    transport: c?.transport ?? 0,
    representation: c?.representation ?? 0,
    responsibility: c?.responsibility ?? 0,
    performance: c?.performance ?? 0,
    boisson: c?.boisson ?? 0,
    other: c?.other ?? 0,
    otherAmount1: c?.otherAmount1 ?? 0,
    otherAmount2: c?.otherAmount2 ?? 0,
    otherLabel1: c?.otherLabel1,
    otherLabel2: c?.otherLabel2,
    primeFonctionNonImposable: c?.primeFonctionNonImposable ?? 0,
    indemniteResponsabiliteNonTaxable: c?.indemniteResponsabiliteNonTaxable ?? 0,
  };
}

// Retenues sociales & fiscales — calcul fidèle au classeur Excel I.P & D (source unique
// de vérité), utilisée par la page "Paie", le bulletin de paie, "Charges sociales" et le
// "Livre de paie en fin d'année".
type SocialDeductions = {
  brutImposable: number;         // (L) base+sursalaire+heures sup+ancienneté+prime de fonction imposable+autres primes, après déduction des absences non justifiées
  brutNonImposable: number;      // (I) Prime de fonction non imposable — exclue de l'IGR ET de la CNPS
  indemniteRespNonTaxable: number; // Indemnité de responsabilité non taxable — exclue de l'IGR, INCLUSE dans la CNPS
  totalBrut: number;             // (K) = brutImposable + brutNonImposable + indemniteRespNonTaxable
  brut: number;                  // alias de totalBrut — conservé pour compat avec "Charges sociales"
  brutSocial: number;            // (M) base de calcul CNPS/CMU = totalBrut (brut social = brut total)
  parts: number;                 // Nombre de parts fiscales (quotient familial)
  impotsBrut: number;            // Barème IGR progressif appliqué au brut imposable
  ricf: number;                  // Réduction d'Impôt pour Charges de Famille
  its: number;                   // Impôt sur Salaire = max(Impôts brut − RICF, 0)
  cnps: number;                  // CNPS retraite salariale 6,3% (plafonné)
  cnam: number;                  // Cotisation CNAM / CMU (forfaitaire)
  pret: number;                  // Retenue prêt
  acompte: number;               // Retenue acompte sur salaire
  assurance: number;             // Retenue assurance maladie
  totalRetenues: number;         // its + cnps + cnam + pret + acompte + assurance
  transportNonImposable: number; // Indemnité de transport (non imposable, versée hors brut)
  netAPayer: number;             // totalBrut − totalRetenues + transportNonImposable
};

function computeSocialDeductions(emp: Employee, brutImposableAvantAbsence: number, absenceDeduction: number): SocialDeductions {
  const c = getComponents(emp);
  const brutImposable = Math.max(0, brutImposableAvantAbsence - absenceDeduction);
  // "Prime de fonction non imposable" : exclue à la fois de l'IGR et de la CNPS.
  const brutNonImposable = c.primeFonctionNonImposable || 0;
  // "Indemnité de responsabilité non taxable" : exclue de l'IGR (comme ci-dessus) MAIS incluse
  // dans la base CNPS — rubrique distincte, conforme au bulletin de référence (la "Cotisation
  // Retraite" y intègre cette indemnité alors que le "Salaire brut taxable" et l'impôt sur
  // salaires l'excluent).
  const indemniteRespNonTaxable = c.indemniteResponsabiliteNonTaxable || 0;
  const totalBrut = brutImposable + brutNonImposable + indemniteRespNonTaxable;
  const brutSocial = totalBrut;

  const parts = computeFiscalParts(emp.familySituation, emp.numberOfChildren);
  const impotsBrut = computeIGRBrut(brutImposable);
  const ricf = computeRICF(parts);
  const its = Math.max(0, Math.round(impotsBrut - ricf));
  const cnps = computeCNPSSalarial(brutSocial);
  const cnam = emp.cnamAmount || 0;
  const pret = emp.pret || 0;
  const acompte = emp.acompte || 0;
  const assurance = emp.assurance || 0;
  const totalRetenues = its + cnps + cnam + pret + acompte + assurance;
  const transportNonImposable = c.transport || 0;
  const netAPayer = Math.round(totalBrut - totalRetenues + transportNonImposable);

  return { brutImposable, brutNonImposable, indemniteRespNonTaxable, totalBrut, brut: totalBrut, brutSocial, parts, impotsBrut, ricf, its, cnps, cnam, pret, acompte, assurance, totalRetenues, transportNonImposable, netAPayer };
}

type PayrollRow = {
  emp: Employee; dailyRate: number; hourlyRate: number;
  heuresSup: number; ot: OvertimeHours; deduction: number; overtimePay: number; netToPay: number;
  ancienneteAmount: number; ancienneteRatePct: number; joursPayes: number; joursNonPayes: number;
  baseSalaryProrated: number; sursalaireProrated: number;
  social: SocialDeductions; hasData: boolean;
};

// Calcule la paie RÉELLE d'un employé sur une période donnée, à partir de la saisie manuelle
// mensuelle (jours payés + heures sup, module "Paie") ET des formules du classeur Excel
// I.P & D (ancienneté auto-calculée, barème IGR progressif, quotient familial, CNPS
// plafonné...). Fonction unique utilisée par la page "Paie", le bulletin de paie, "Charges
// sociales" et le "Livre de paie en fin d'année", pour garantir des montants identiques partout.
// hasData = true si une saisie manuelle existe pour ce mois (sinon le calcul retombe par
// défaut sur un mois complet, comme si l'employé avait été présent).
function computeEmployeePayrollForPeriod(emp: Employee, periodStart: string, periodEnd: string) {
  // Garde-fou : un employé créé/importé avec des données de salaire incomplètes ou
  // manquantes (ex. document Firestore partiellement écrit) ne doit jamais faire planter
  // toute l'application — on retombe sur des valeurs à 0 plutôt que de lever une exception.
  const c = getComponents(emp);

  const yearMonth = periodStart.slice(0, 7);
  const override = payrollOverrides.find(o => o.employeeId === emp.id && o.yearMonth === yearMonth);
  const hasData = !!override;

  const ot: OvertimeHours = override ? override.overtime : emptyOvertime();
  const heuresSup = ot.h15 + ot.h50 + ot.h75 + ot.h100 + ot.h200;

  // Jours réellement payés sur le mois : saisie manuelle dans "Paie" (0 à 30 j). Sans saisie
  // pour ce mois, l'employé est considéré présent tout le mois (comportement par défaut).
  const joursPayes = Math.max(0, Math.min(override ? override.joursPayes : JOURS_MOIS_PAIE, JOURS_MOIS_PAIE));
  const joursNonPayes = JOURS_MOIS_PAIE - joursPayes;

  // Prime d'ancienneté — calculée automatiquement à la date de fin de période, jamais saisie
  // manuellement (reproduit LIVRE DE PAIE!O:Q — voir computeAncienneteRate/Amount)
  const { ratePct: ancienneteRatePct } = computeAncienneteRate(emp.startDate, periodEnd);
  const ancienneteAmount = computeAncienneteAmount(c.baseSalary, emp.startDate, periodEnd);

  // Garde-fou : si emp.salary est manquant/invalide en base (ex. fiche créée avant une
  // correction antérieure), on le recalcule à partir des rubriques plutôt que de propager un
  // NaN qui casserait silencieusement TOUT le brut/imposable/impôts de cet employé (bug
  // constaté : Total brut, Brut imposable et Impôts brut affichés à 0 malgré un salaire de
  // base et une prime d'ancienneté corrects).
  const hourlyRate = (emp.salary || computeSalary(c)) / (JOURS_OUVRES_MOIS * 8);
  const overtimePay = Math.round(
    OVERTIME_RATES.reduce((acc, r) => acc + ot[r.key] * hourlyRate * (1 + r.rate), 0)
  );

  // Salaire de base et sursalaire proratisés sur les jours réellement payés (formule de
  // l'onglet "ALI" : gain = base × nombre/30). Les autres primes (ancienneté, fonction,
  // logement, transport...) restent à taux plein, non proratisées.
  const baseSalaryProrated = Math.round(c.baseSalary * joursPayes / JOURS_MOIS_PAIE);
  const sursalaireProrated = Math.round(c.sursalaire * joursPayes / JOURS_MOIS_PAIE);
  const dailyRate = (c.baseSalary + c.sursalaire) / JOURS_MOIS_PAIE;
  const deduction = (c.baseSalary + c.sursalaire) - (baseSalaryProrated + sursalaireProrated);

  // Brut imposable avant déduction des jours non payés : base + sursalaire (à taux plein) +
  // heures sup + ancienneté + prime de fonction imposable (représentation + responsabilité) +
  // autres primes imposables — la déduction ci-dessus vient réduire ce total dans
  // computeSocialDeductions, exactement comme fait le prorata directement sur base/sursalaire.
  const primeFonctionImposable = c.representation + c.responsibility;
  const autresPrimesImposables = c.housing + c.performance + c.boisson + c.other;
  const brutImposableAvantAbsence = c.baseSalary + c.sursalaire + overtimePay + ancienneteAmount + primeFonctionImposable + autresPrimesImposables;

  const social = computeSocialDeductions(emp, brutImposableAvantAbsence, deduction);
  const netToPay = social.netAPayer;

  return {
    dailyRate, hourlyRate, heuresSup, ot, deduction, overtimePay, netToPay,
    ancienneteAmount, ancienneteRatePct, joursPayes, joursNonPayes, baseSalaryProrated, sursalaireProrated,
    social, hasData,
  };
}

// Découpe une année/mois en bornes de dates calendaires [1er jour, dernier jour]
function monthRange(year: number, month: number): { start: string; end: string; label: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const start = `${year}-${pad(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${pad(month)}-${pad(lastDay)}`;
  const label = new Date(year, month - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return { start, end, label };
}

/* ── FICHE DE PAIE (Bulletin) ── */
// Ligne du bulletin
function PaySlipRow({ code, label, base, taux, gain, retenue }: {
  code?: string; label: string; base?: number; taux?: string; gain?: number; retenue?: number;
}) {
  return (
    <tr className="border-b border-slate-100">
      <td className="px-2 py-1 text-[10px] text-slate-500 font-mono">{code || ''}</td>
      <td className="px-2 py-1 text-[11px] text-slate-700">{label}</td>
      <td className="px-2 py-1 text-[10px] text-slate-600 text-right">{base != null ? base.toLocaleString('fr-FR') : ''}</td>
      <td className="px-2 py-1 text-[10px] text-slate-500 text-center">{taux || ''}</td>
      <td className="px-2 py-1 text-[11px] text-emerald-700 text-right font-medium">{gain != null && gain !== 0 ? gain.toLocaleString('fr-FR') : ''}</td>
      <td className="px-2 py-1 text-[11px] text-red-600 text-right font-medium">{retenue != null && retenue !== 0 ? retenue.toLocaleString('fr-FR') : ''}</td>
    </tr>
  );
}

// Bulletin de paie individuel — reproduit la mise en page de l'onglet "ALI" du classeur
// Excel I.P & D (bandeau entreprise/CNPS, identité complète du salarié, tableau des
// rubriques avec codes, cotisations salariales détaillées, retenues fixes, indemnité de
// transport non imposable, charges patronales indicatives, signatures).
function PaySlipModal({ row, periodStart, periodEnd, onClose }: { row: PayrollRow; periodStart: string; periodEnd: string; onClose: () => void; }) {
  const { emp, ot, netToPay, ancienneteAmount, ancienneteRatePct, social, joursPayes, joursNonPayes, baseSalaryProrated, sursalaireProrated, hasData } = row;
  const c = getComponents(emp);
  const isCadre = emp.professionalStatus === 'Cadre';

  const { brutImposable, totalBrut, parts, impotsBrut, ricf, its, cnps, cnam, pret, acompte, assurance, totalRetenues, transportNonImposable, netAPayer } = social;
  const primeFonctionImposable = c.representation + c.responsibility;

  // Charges patronales indicatives (part employeur — non déduites du salarié), section
  // "PART PATRONALE" de l'onglet ALI. Mêmes taux que le module "Livre de paie en fin d'année".
  const cnpsPatronal = computeCNPSPatronal(social.brutSocial);
  const pfBase = Math.min(social.brutSocial, CHARGES_PATRONALES.prestationFamilialeBase);
  const prestationFamiliale = Math.round(pfBase * CHARGES_PATRONALES.prestationFamilialeTaux);
  const atBase = Math.min(social.brutSocial, CHARGES_PATRONALES.accidentTravailBase);
  const accidentTravail = Math.round(atBase * (parametresGeneraux.accidentTravailTauxPct / 100));
  const isLocal = Math.round(social.brutSocial * CHARGES_PATRONALES.isLocalTaux);
  const taxeApprentissage = Math.round(social.brutSocial * CHARGES_PATRONALES.taxeApprentissageTaux);
  const taxeFPC = Math.round(social.brutSocial * CHARGES_PATRONALES.taxeFPCTaux);

  const site = sites.find(s => s.id === emp.siteId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto">
        {/* En-tête modale */}
        <div className="sticky top-0 bg-white px-6 py-3 border-b border-slate-100 flex items-center justify-between z-10">
          <h3 className="text-sm font-bold text-slate-800">Bulletin de paie {isCadre ? '— CADRE' : `— ${emp.professionalStatus.toUpperCase()}`}</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()} className="px-3 py-1.5 text-[11px] font-semibold bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 flex items-center gap-1.5"><Ico name="print" size={13} /> Imprimer</button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1"><Ico name="close" size={18} /></button>
          </div>
        </div>

        {/* Corps : Bulletin */}
        <div className="p-6">
          <div className={cn('border-2 rounded-lg overflow-hidden', isCadre ? 'border-indigo-300' : 'border-slate-300')}>
            {/* Bandeau titre + logo */}
            <div className={cn('flex items-start justify-between p-4 border-b-2', isCadre ? 'border-indigo-200 bg-indigo-50/50' : 'border-slate-200 bg-slate-50')}>
              <div className="flex items-start gap-3">
                <div className="h-14 w-14 rounded-lg border border-slate-300 bg-white flex items-center justify-center overflow-hidden shrink-0">
                  <img src={logo} alt="Logo entreprise" className="h-full w-full object-contain" />
                </div>
                <div>
                  <p className="text-xs font-extrabold text-slate-800 uppercase leading-tight">{site?.name || ''}</p>
                  <p className="text-[10px] text-slate-500">{site?.address}, {site?.city}</p>
                  <p className="text-[10px] text-slate-500">Tél : {site?.phone}</p>
                  <p className="text-[10px] text-slate-500">CNPS employeur : {site?.cnpsEmployeur || '—'} · N° Contribuable : {site?.numeroContribuable || '—'}</p>
                </div>
              </div>
              <div className={cn('text-center px-4 py-2 rounded-lg', isCadre ? 'bg-indigo-100' : 'bg-slate-200')}>
                <p className="text-[10px] font-bold text-slate-700 uppercase">Bulletin de paie</p>
                <p className="text-[10px] text-slate-600">Du {fmt(periodStart)}</p>
                <p className="text-[10px] text-slate-600">Au {fmt(periodEnd)}</p>
                <p className="text-[9px] text-slate-500 mt-0.5">Type de paie : Mensuel</p>
              </div>
            </div>

            {/* Infos salarié (fiche complète, comme l'onglet ALI) */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 p-4 border-b border-slate-200 text-[11px]">
              <div className="flex justify-between"><span className="text-slate-500">Matricule :</span><span className="font-semibold text-slate-700">{emp.matricule || '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">N° CNPS :</span><span className="font-semibold text-slate-700">{emp.cnpsNumber || '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Nom & Prénom :</span><span className="font-semibold text-slate-700">{emp.lastName} {emp.firstName}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Nationalité :</span><span className="font-semibold text-slate-700">{emp.nationality || '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Fonction :</span><span className="font-semibold text-slate-700">{emp.position}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Catégorie / Échelon :</span><span className="font-semibold text-slate-700">{emp.category || '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Date d'embauche :</span><span className="font-semibold text-slate-700">{fmt(emp.startDate)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Situation familiale :</span><span className="font-semibold text-slate-700">{emp.familySituation || '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Nombre d'enfants :</span><span className="font-semibold text-slate-700">{emp.numberOfChildren ?? 0}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Nombre de parts :</span><span className="font-semibold text-slate-700">{parts}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Sexe :</span><span className="font-semibold text-slate-700">{emp.gender || '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Chef de famille :</span><span className="font-semibold text-slate-700">{emp.chefDeFamille ? 'Oui' : 'Non'}</span></div>
            </div>

            {/* Bandeau jours payés — reflète la saisie manuelle du mois dans "Paie" */}
            {hasData && joursNonPayes > 0 && (
              <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-[10px] text-amber-800">
                ⚠ Paie calculée sur <b>{joursPayes} jour(s) payé(s) sur {JOURS_MOIS_PAIE}</b> (saisie manuelle du mois) — {joursNonPayes} j non payé(s).
              </div>
            )}
            {!hasData && (
              <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 text-[10px] text-slate-500">
                ℹ Aucune saisie manuelle pour ce mois dans "Paie" — paie calculée sur un mois complet ({JOURS_MOIS_PAIE} j) par défaut.
              </div>
            )}

            {/* Tableau gains / retenues */}
            <table className="w-full">
              <thead>
                <tr className={cn(isCadre ? 'bg-indigo-50' : 'bg-slate-100')}>
                  <th className="px-2 py-1.5 text-[9px] font-bold text-slate-500 uppercase text-left">Code</th>
                  <th className="px-2 py-1.5 text-[9px] font-bold text-slate-500 uppercase text-left">Rubrique</th>
                  <th className="px-2 py-1.5 text-[9px] font-bold text-slate-500 uppercase text-right">Base</th>
                  <th className="px-2 py-1.5 text-[9px] font-bold text-slate-500 uppercase text-center">Taux/Nb</th>
                  <th className="px-2 py-1.5 text-[9px] font-bold text-emerald-600 uppercase text-right">Gains</th>
                  <th className="px-2 py-1.5 text-[9px] font-bold text-red-500 uppercase text-right">Retenue</th>
                </tr>
              </thead>
              <tbody>
                <PaySlipRow code="10" label="SALAIRE" base={c.baseSalary} taux={`${joursPayes} j`} gain={baseSalaryProrated} />
                {c.sursalaire > 0 && <PaySlipRow code="11" label="SURSALAIRE" base={c.sursalaire} taux={`${joursPayes} j`} gain={sursalaireProrated} />}
                {ancienneteAmount > 0 && <PaySlipRow code="15" label="PRIME ANCIENNETÉ" base={c.baseSalary} taux={`${ancienneteRatePct}%`} gain={ancienneteAmount} />}
                {primeFonctionImposable > 0 && <PaySlipRow code="20" label="PRIME DE FONCTION" base={primeFonctionImposable} gain={primeFonctionImposable} />}
                {c.primeFonctionNonImposable > 0 && <PaySlipRow code="21" label="PRIME DE FONCTION NON IMPOSABLE" base={c.primeFonctionNonImposable} gain={c.primeFonctionNonImposable} />}
                {c.indemniteResponsabiliteNonTaxable > 0 && <PaySlipRow code="26" label="INDEMNITÉ DE RESPONSABILITÉ NON TAXABLE" base={c.indemniteResponsabiliteNonTaxable} gain={c.indemniteResponsabiliteNonTaxable} />}
                {c.housing > 0 && <PaySlipRow code="22" label="INDEMNITÉ DE LOGEMENT" base={c.housing} gain={c.housing} />}
                {c.performance > 0 && <PaySlipRow code="23" label="PRIME DE RENDEMENT" base={c.performance} gain={c.performance} />}
                {c.boisson > 0 && <PaySlipRow code="24" label="PRIME DE BOISSON" base={c.boisson} gain={c.boisson} />}
                {c.otherAmount1 > 0 && <PaySlipRow code="76" label={(c.otherLabel1 || 'AUTRE PRIME 1').toUpperCase()} base={c.otherAmount1} gain={c.otherAmount1} />}
                {c.otherAmount2 > 0 && <PaySlipRow code="77" label={(c.otherLabel2 || 'AUTRE PRIME 2').toUpperCase()} base={c.otherAmount2} gain={c.otherAmount2} />}

                {/* Heures supplémentaires par taux */}
                {OVERTIME_RATES.map(r => ot[r.key] > 0 && (
                  <PaySlipRow key={r.key} code="12" label={`HEURE SUPPLÉMENTAIRE +${r.label}`}
                    taux={`${ot[r.key]} h`} gain={Math.round(ot[r.key] * row.hourlyRate * (1 + r.rate))} />
                ))}

                <tr className="bg-slate-50 font-bold border-y border-slate-200">
                  <td colSpan={4} className="px-2 py-1.5 text-[11px] text-slate-700">TOTAL BRUT</td>
                  <td className="px-2 py-1.5 text-[11px] text-emerald-700 text-right">{totalBrut.toLocaleString('fr-FR')}</td>
                  <td></td>
                </tr>

                {/* Cotisations salariales */}
                <PaySlipRow code="401" label="IMPÔTS BRUT (avant RICF)" base={brutImposable} taux="barème IGR" retenue={impotsBrut} />
                <PaySlipRow code="402" label="RICF (réduction charges de famille)" taux={`${parts} parts`} gain={ricf} />
                <PaySlipRow code="400" label="I.T.S (Impôt sur Traitements et Salaires)" base={brutImposable} retenue={its} />
                <PaySlipRow code="38" label="RETRAITE GÉNÉRALE (CNPS)" base={social.brutSocial} taux="6,3%" retenue={cnps} />
                <PaySlipRow code="45" label="CMU / CNAM" retenue={cnam} />
                {pret > 0 && <PaySlipRow code="440" label="PRÊT" retenue={pret} />}
                {acompte > 0 && <PaySlipRow code="441" label="ACOMPTE SUR SALAIRE" retenue={acompte} />}
                {assurance > 0 && <PaySlipRow code="460" label="ASSURANCE MALADIE" retenue={assurance} />}

                <tr className="bg-slate-50 font-bold border-y border-slate-200">
                  <td colSpan={4} className="px-2 py-1.5 text-[11px] text-slate-700">TOTAL DES RETENUES</td>
                  <td></td>
                  <td className="px-2 py-1.5 text-[11px] text-red-600 text-right">{totalRetenues.toLocaleString('fr-FR')}</td>
                </tr>

                {/* Indemnité non imposable, versée hors brut/cotisations */}
                {transportNonImposable > 0 && <PaySlipRow code="655" label="INDEMNITÉ DE TRANSPORT (non imposable)" gain={transportNonImposable} />}
              </tbody>
            </table>

            {/* Net à payer */}
            <div className={cn('flex items-center justify-between p-4 border-t-2', isCadre ? 'border-indigo-300 bg-indigo-50' : 'border-slate-300 bg-slate-100')}>
              <div>
                <p className="text-[10px] text-slate-500 uppercase">Total brut + transport</p>
                <p className="text-xs font-bold text-slate-700">{(totalBrut + transportNonImposable).toLocaleString('fr-FR')} FCFA</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase">Retenues</p>
                <p className="text-xs font-bold text-red-600">{totalRetenues.toLocaleString('fr-FR')} FCFA</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-emerald-600 uppercase font-bold">Net à payer</p>
                <p className="text-lg font-extrabold text-emerald-700">{netAPayer.toLocaleString('fr-FR')} FCFA</p>
              </div>
            </div>

            {/* Charges patronales indicatives — part employeur, non déduite du salarié */}
            <div className="border-t border-slate-200 p-3 bg-slate-50/60">
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Charges patronales (indicatif — part employeur)</p>
              <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-[10px] text-slate-600">
                <div className="flex justify-between"><span>CNPS retraite patronale (7,7%)</span><span className="font-semibold">{formatFCFA(cnpsPatronal)}</span></div>
                <div className="flex justify-between"><span>Prestation familiale (5,75%)</span><span className="font-semibold">{formatFCFA(prestationFamiliale)}</span></div>
                <div className="flex justify-between"><span>Accident du travail ({parametresGeneraux.accidentTravailTauxPct}%)</span><span className="font-semibold">{formatFCFA(accidentTravail)}</span></div>
                <div className="flex justify-between"><span>Part patronale IS local (1,2%)</span><span className="font-semibold">{formatFCFA(isLocal)}</span></div>
                <div className="flex justify-between"><span>Taxe d'apprentissage (0,4%)</span><span className="font-semibold">{formatFCFA(taxeApprentissage)}</span></div>
                <div className="flex justify-between"><span>Taxe FPC (1,2%)</span><span className="font-semibold">{formatFCFA(taxeFPC)}</span></div>
              </div>
            </div>

            {/* Signatures */}
            <div className="grid grid-cols-2 gap-6 p-5 border-t border-slate-200">
              <div className="text-center">
                <div className="h-12"></div>
                <p className="text-[9px] text-slate-400 border-t border-slate-300 pt-1">Signature de l'employé</p>
              </div>
              <div className="text-center">
                <div className="h-12"></div>
                <p className="text-[9px] text-slate-400 border-t border-slate-300 pt-1">Cachet et signature du directeur</p>
              </div>
            </div>
          </div>

          <p className="text-[9px] text-slate-400 text-center mt-3">
            Pour vous aider à faire valoir vos droits, conservez ce bulletin de paie sans limitation de durée. · Net à payer identique au tableau récapitulatif : {formatFCFA(netToPay)}
          </p>
        </div>
      </div>
    </div>
  );
}

// Cellule numérique compacte pour le grand tableau "Livre de paie"
function LP_Td({ value, bold, colorClass }: { value: number; bold?: boolean; colorClass?: string }) {
  return (
    <td className={cn('px-2.5 py-2 text-[11px] text-right whitespace-nowrap', bold ? 'font-bold' : '', colorClass || 'text-slate-600')}>
      {value ? value.toLocaleString('fr-FR') : <span className="text-slate-300">0</span>}
    </td>
  );
}

// Page "Paie" — reproduit intégralement l'onglet "LIVRE DE PAIE" du classeur Excel I.P & D :
// mêmes colonnes (N°, Matricule, Nom, Prénoms, rubriques de gains, brut imposable/social,
// ancienneté, situation familiale/parts, retenues fiscales & sociales, salaire net), avec
// une ligne TOTAUX en pied de tableau. Cliquer sur une ligne ouvre le bulletin de paie.
function PayePage({ filtered }: { filtered: Employee[] }) {
  const { version, bump } = useContext(DataVersionContext);
  // Mois courant par défaut (et non une date figée) : évite les écarts d'ancienneté/durée
  // entre "Paie" et le reste de l'appli quand personne n'a encore changé la période.
  const currentMonth = monthRange(new Date().getFullYear(), new Date().getMonth() + 1);
  const [periodStart, setPeriodStart] = useState(currentMonth.start);
  const [periodEnd, setPeriodEnd] = useState(currentMonth.end);
  const [payslip, setPayslip] = useState<PayrollRow | null>(null);
  const [otEditor, setOtEditor] = useState<{ emp: Employee; overtime: OvertimeHours } | null>(null);
  const [showExport, setShowExport] = useState(false);

  // Enregistre (ou crée) la saisie manuelle de paie variable d'un employé pour le mois de
  // periodStart, et prévient toute l'application que les données ont changé (bump).
  function saveOverride(employeeId: string, patch: Partial<Pick<PayrollOverride, 'joursPayes' | 'overtime'>>) {
    const yearMonth = periodStart.slice(0, 7);
    const id = `${employeeId}::${yearMonth}`;
    let ov = payrollOverrides.find(o => o.id === id);
    if (!ov) {
      ov = { id, employeeId, yearMonth, joursPayes: JOURS_MOIS_PAIE, overtime: emptyOvertime() };
      payrollOverrides.push(ov);
    }
    Object.assign(ov, patch);
    persistDoc('payrollOverrides', id, ov);
    bump();
  }

  const payroll = useMemo(() => {
    return filtered.map(emp => ({ emp, ...computeEmployeePayrollForPeriod(emp, periodStart, periodEnd) }));
  }, [filtered, periodStart, periodEnd, version]);

  const buildPaieExportRows = useCallback((): ExportRow[] => payroll.map((r, i) => {
    const c = getComponents(r.emp);
    const { months } = computeAncienneteRate(r.emp.startDate, periodEnd);
    const primeFonction = c.representation + c.responsibility + c.housing + c.performance + c.boisson + c.other;
    return {
      n: i + 1, matricule: r.emp.matricule || '', nom: r.emp.lastName, prenoms: r.emp.firstName,
      joursPayes: r.joursPayes, heureSup: r.heuresSup, salaireBase: r.baseSalaryProrated, sursalaire: r.sursalaireProrated,
      heureSuppl: r.overtimePay, primeAnciennete: r.ancienneteAmount, primeFonctionNonImp: c.primeFonctionNonImposable,
      indemniteRespNonTax: r.social.indemniteRespNonTaxable, primeFonction, totalBrut: r.social.totalBrut,
      brutImposable: r.social.brutImposable, brutSocial: r.social.brutSocial, dateEmbauche: r.emp.startDate, dureeMois: months,
      tauxAnc: r.ancienneteRatePct, situationFam: r.emp.familySituation || '', enfants: r.emp.numberOfChildren ?? 0,
      parts: r.social.parts, impotsBrut: r.social.impotsBrut, ricf: r.social.ricf, its: r.social.its, cnps: r.social.cnps,
      cnam: r.social.cnam, prets: r.social.pret, indemniteTransport: r.social.transportNonImposable, salaireNet: r.netToPay,
    };
  }), [payroll, periodEnd]);

  useEffect(() => {
    exportRegistry['paye'] = { title: 'Livre de paie', tableClass: 'paie-table', columns: PAIE_EXPORT_COLUMNS, buildRows: buildPaieExportRows };
  }, [buildPaieExportRows]);

  // Dès qu'un employé apparaît dans "Paie" pour la période affichée, on enregistre
  // IMMÉDIATEMENT une saisie par défaut (30 j, 0 h sup) s'il n'en a pas encore — pour que ce
  // qui est visible à l'écran ("30/30") corresponde toujours à une donnée réellement
  // enregistrée, et apparaisse donc correctement dans "Livre de paie fin d'année" et
  // "Charges sociales". Sans ce mécanisme, un employé jamais explicitement modifié restait
  // invisible dans les cumuls malgré un "30/30" affiché ici, ce qui prêtait à confusion.
  useEffect(() => {
    const yearMonth = periodStart.slice(0, 7);
    let created = false;
    filtered.forEach(emp => {
      const exists = payrollOverrides.some(o => o.employeeId === emp.id && o.yearMonth === yearMonth);
      if (!exists) {
        const ov: PayrollOverride = { id: `${emp.id}::${yearMonth}`, employeeId: emp.id, yearMonth, joursPayes: JOURS_MOIS_PAIE, overtime: emptyOvertime() };
        payrollOverrides.push(ov);
        persistDoc('payrollOverrides', ov.id, ov);
        created = true;
      }
    });
    if (created) bump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, periodStart, periodEnd]);

  // Totaux — équivalent de la ligne "TOTAUX" (LIVRE DE PAIE!33)
  const sum = (fn: (r: typeof payroll[number]) => number) => payroll.reduce((a, r) => a + fn(r), 0);
  const T = {
    base: sum(r => r.baseSalaryProrated),
    sursalaire: sum(r => r.sursalaireProrated),
    heureSuppl: sum(r => r.overtimePay),
    anciennete: sum(r => r.ancienneteAmount),
    primeNonImp: sum(r => getComponents(r.emp).primeFonctionNonImposable),
    indemniteRespNonTax: sum(r => r.social.indemniteRespNonTaxable),
    primeFonction: sum(r => { const c = getComponents(r.emp); return c.representation + c.responsibility + c.housing + c.performance + c.boisson + c.other; }),
    totalBrut: sum(r => r.social.totalBrut),
    brutImposable: sum(r => r.social.brutImposable),
    brutSocial: sum(r => r.social.brutSocial),
    enfants: sum(r => r.emp.numberOfChildren || 0),
    parts: sum(r => r.social.parts),
    impotsBrut: sum(r => r.social.impotsBrut),
    ricf: sum(r => r.social.ricf),
    its: sum(r => r.social.its),
    cnps: sum(r => r.social.cnps),
    cnam: sum(r => r.social.cnam),
    pret: sum(r => r.social.pret),
    transport: sum(r => r.social.transportNonImposable),
    net: sum(r => r.netToPay),
  };

  return (
    <div className="space-y-6">
      {/* Sélecteur de période */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <Ico name="calendar" size={18} className="text-orange-500" />
        <span className="text-xs font-bold text-slate-700">Période de paie :</span>
        <span className="text-[10px] text-slate-400 uppercase">Du</span>
        <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)}
          className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-300" />
        <span className="text-[10px] text-slate-400 uppercase">Au</span>
        <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)}
          className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-300" />
        <span className="text-[10px] text-slate-400 ml-2">Jours payés et heures sup. saisis manuellement · cliquez sur une ligne pour ouvrir le bulletin</span>
        <button onClick={() => setShowExport(true)} className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-600 text-xs font-semibold rounded-xl hover:bg-slate-50 ml-auto">
          <Ico name="exportFile" size={14} /> Exporter
        </button>
      </div>

      {showExport && (
        <ExportModal
          title="Livre de paie"
          columns={PAIE_EXPORT_COLUMNS}
          buildRows={buildPaieExportRows}
          onClose={() => setShowExport(false)}
          onPrint={(hidden) => applyPrintColumnFilter('paie-table', PAIE_EXPORT_COLUMNS.map(c => c.key), hidden)}
        />
      )}

      {/* Cartes statistiques globales */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
          <div className="flex items-start justify-between mb-2"><div className="h-9 w-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-sm"><Ico name="briefcase" size={18} className="text-white" /></div></div>
          <p className="text-xl font-bold text-slate-800">{filtered.length}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Total employés (permanents)</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
          <div className="flex items-start justify-between mb-2"><div className="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white shadow-sm"><Ico name="paye" size={18} className="text-white" /></div></div>
          <p className="text-lg font-bold text-slate-800">{formatFCFA(T.totalBrut)}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Total salaire brut (période)</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
          <div className="flex items-start justify-between mb-2"><div className="h-9 w-9 rounded-xl bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center text-white shadow-sm"><Ico name="shield" size={18} className="text-white" /></div></div>
          <p className="text-lg font-bold text-slate-800">{formatFCFA(T.its + T.cnps + T.cnam)}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">ITS + CNPS + CNAM (retenues)</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
          <div className="flex items-start justify-between mb-2"><div className="h-9 w-9 rounded-xl bg-gradient-to-br from-sky-500 to-cyan-500 flex items-center justify-center text-white shadow-sm"><Ico name="calendar" size={18} className="text-white" /></div></div>
          <p className="text-lg font-bold text-slate-800">{formatFCFA(T.net)}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Total salaire net à payer</p>
        </div>
      </div>

      {/* ════ LIVRE DE PAIE — tableau large (colonnes identiques à l'onglet Excel) ════ */}
      <div className="bg-white rounded-2xl border border-orange-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 bg-orange-50 border-b border-orange-100">
          <h3 className="text-sm font-bold text-orange-800">Livre de paie — Permanents — du {fmt(periodStart)} au {fmt(periodEnd)}</h3>
          <p className="text-[11px] text-orange-600 mt-0.5">
            Prime d'ancienneté auto-calculée · Barème IGR progressif · Réduction quotient familial (RICF) · CNPS salariale 6,3% plafonnée à {formatFCFA(CNPS_PLAFOND)}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left paie-table">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70">
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase whitespace-nowrap">N°</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase whitespace-nowrap">Matricule</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase whitespace-nowrap">Nom</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase whitespace-nowrap">Prénoms</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-indigo-500 uppercase text-center whitespace-nowrap" title="Saisie manuelle : jours réellement payés sur le mois">Jours payés</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-indigo-500 uppercase text-center whitespace-nowrap" title="Saisie manuelle : heures supplémentaires du mois">H. sup</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase text-right whitespace-nowrap">Salaire base</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase text-right whitespace-nowrap">Sursalaire</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase text-right whitespace-nowrap">Heure suppl.</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase text-right whitespace-nowrap">Prime ancienneté</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase text-right whitespace-nowrap">Prime fonction non imp.</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-purple-500 uppercase text-right whitespace-nowrap" title="Exclue de l'IGR, incluse dans la base CNPS">Indem. resp. non taxable</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase text-right whitespace-nowrap">Prime fonction</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-emerald-600 uppercase text-right whitespace-nowrap">Total brut</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase text-right whitespace-nowrap">Brut imposable</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase text-right whitespace-nowrap">Brut social</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase whitespace-nowrap">Date embauche</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase text-center whitespace-nowrap">Durée (mois)</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase text-center whitespace-nowrap">Taux% anc.</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase whitespace-nowrap">Situation fam.</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase text-center whitespace-nowrap">Enfants</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase text-center whitespace-nowrap">Parts</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-red-500 uppercase text-right whitespace-nowrap">Impôts brut</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-red-500 uppercase text-right whitespace-nowrap">RICF</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-red-500 uppercase text-right whitespace-nowrap">ITS</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-red-500 uppercase text-right whitespace-nowrap">CNPS</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-red-500 uppercase text-right whitespace-nowrap">CNAM</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-red-500 uppercase text-right whitespace-nowrap">Prêts</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase text-right whitespace-nowrap">Indem. transport</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-emerald-700 uppercase text-right whitespace-nowrap">Salaire net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payroll.map((r, i) => {
                const { emp, social, ancienneteAmount, ancienneteRatePct, netToPay } = r;
                const c = getComponents(emp);
                const { months } = computeAncienneteRate(emp.startDate, periodEnd);
                const primeFonction = c.representation + c.responsibility + c.housing + c.performance + c.boisson + c.other;
                return (
                  <tr key={emp.id} className="hover:bg-orange-50/60 cursor-pointer" onClick={() => setPayslip(r)} title="Cliquez pour voir le bulletin de paie">
                    <td className="px-2.5 py-2 text-[11px] text-slate-500">{i + 1}</td>
                    <td className="px-2.5 py-2 text-[11px] text-slate-600 whitespace-nowrap">{emp.matricule || '—'}</td>
                    <td className="px-2.5 py-2 text-[11px] font-semibold text-slate-700 whitespace-nowrap">{emp.lastName}</td>
                    <td className="px-2.5 py-2 text-[11px] text-slate-700 whitespace-nowrap">{emp.firstName}</td>
                    <td className="px-2.5 py-2 text-center whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <input type="number" min={0} max={JOURS_MOIS_PAIE} value={r.joursPayes}
                        onChange={e => saveOverride(emp.id, { joursPayes: Math.max(0, Math.min(JOURS_MOIS_PAIE, Number(e.target.value))) })}
                        className={cn('w-14 px-1.5 py-1 text-[11px] text-center border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-300',
                          r.joursNonPayes > 0 ? 'border-amber-300 bg-amber-50 text-amber-700 font-semibold' : 'border-slate-200 bg-slate-50')} />
                      <span className="text-slate-300 text-[9px]"> /{JOURS_MOIS_PAIE}</span>
                    </td>
                    <td className="px-2.5 py-2 text-center whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <button onClick={() => setOtEditor({ emp, overtime: r.ot })}
                        className={cn('px-2 py-1 text-[11px] rounded-lg border font-semibold',
                          r.heuresSup > 0 ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-slate-50 text-slate-400')}>
                        {r.heuresSup > 0 ? `${r.heuresSup} h` : '—'}
                      </button>
                    </td>
                    <LP_Td value={r.baseSalaryProrated} />
                    <LP_Td value={r.sursalaireProrated} />
                    <LP_Td value={r.overtimePay} />
                    <LP_Td value={ancienneteAmount} />
                    <LP_Td value={c.primeFonctionNonImposable} />
                    <LP_Td value={social.indemniteRespNonTaxable} colorClass="text-purple-600" />
                    <LP_Td value={primeFonction} />
                    <LP_Td value={social.totalBrut} bold colorClass="text-emerald-700" />
                    <LP_Td value={social.brutImposable} />
                    <LP_Td value={social.brutSocial} />
                    <td className="px-2.5 py-2 text-[11px] text-slate-500 whitespace-nowrap">{fmt(emp.startDate)}</td>
                    <td className="px-2.5 py-2 text-[11px] text-slate-500 text-center">{months}</td>
                    <td className="px-2.5 py-2 text-[11px] text-slate-500 text-center">{ancienneteRatePct}%</td>
                    <td className="px-2.5 py-2 text-[11px] text-slate-600 whitespace-nowrap">{emp.familySituation || '—'}</td>
                    <td className="px-2.5 py-2 text-[11px] text-slate-500 text-center">{emp.numberOfChildren ?? 0}</td>
                    <td className="px-2.5 py-2 text-[11px] text-slate-500 text-center">{social.parts}</td>
                    <LP_Td value={social.impotsBrut} colorClass="text-red-500" />
                    <LP_Td value={social.ricf} colorClass="text-red-500" />
                    <LP_Td value={social.its} colorClass="text-red-600" />
                    <LP_Td value={social.cnps} colorClass="text-red-500" />
                    <LP_Td value={social.cnam} colorClass="text-red-500" />
                    <LP_Td value={social.pret} colorClass="text-red-500" />
                    <LP_Td value={social.transportNonImposable} />
                    <LP_Td value={netToPay} bold colorClass="text-emerald-700" />
                  </tr>
                );
              })}
              {payroll.length === 0 && <tr><td colSpan={30} className="px-4 py-8 text-center text-xs text-slate-400">Aucun employé</td></tr>}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                <td colSpan={6} className="px-2.5 py-2.5 text-[11px] text-slate-700">TOTAUX</td>
                <LP_Td value={T.base} />
                <LP_Td value={T.sursalaire} />
                <LP_Td value={T.heureSuppl} />
                <LP_Td value={T.anciennete} />
                <LP_Td value={T.primeNonImp} />
                <LP_Td value={T.indemniteRespNonTax} colorClass="text-purple-600" />
                <LP_Td value={T.primeFonction} />
                <LP_Td value={T.totalBrut} colorClass="text-emerald-700" />
                <LP_Td value={T.brutImposable} />
                <LP_Td value={T.brutSocial} />
                <td colSpan={4}></td>
                <td className="px-2.5 py-2.5 text-[11px] text-slate-500 text-center">{T.enfants}</td>
                <td className="px-2.5 py-2.5 text-[11px] text-slate-500 text-center">{T.parts}</td>
                <LP_Td value={T.impotsBrut} colorClass="text-red-600" />
                <LP_Td value={T.ricf} colorClass="text-red-600" />
                <LP_Td value={T.its} colorClass="text-red-600" />
                <LP_Td value={T.cnps} colorClass="text-red-600" />
                <LP_Td value={T.cnam} colorClass="text-red-600" />
                <LP_Td value={T.pret} colorClass="text-red-600" />
                <LP_Td value={T.transport} />
                <LP_Td value={T.net} colorClass="text-emerald-700" />
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="px-5 py-3 border-t border-orange-100 flex items-center justify-between bg-orange-50/40">
          <span className="text-[11px] text-slate-500">{filtered.length} employé(s)</span>
          <span className="text-xs font-bold text-slate-700">Net total à payer : {formatFCFA(T.net)}</span>
        </div>
      </div>

      {/* Fiche de paie (bulletin) */}
      {payslip && <PaySlipModal row={payslip} periodStart={periodStart} periodEnd={periodEnd} onClose={() => setPayslip(null)} />}

      {/* Éditeur d'heures supplémentaires (saisie manuelle, 5 taux de majoration) */}
      <Modal open={!!otEditor} onClose={() => setOtEditor(null)} title={otEditor ? `Heures sup. — ${otEditor.emp.firstName} ${otEditor.emp.lastName}` : ''}>
        {otEditor && (
          <div className="space-y-3">
            {OVERTIME_RATES.map(r => (
              <div key={r.key} className="flex items-center gap-2">
                <label className="text-[11px] text-slate-600 flex-1">Heures à +{r.label}</label>
                <input type="number" min={0} step={0.5} value={otEditor.overtime[r.key]}
                  onChange={e => setOtEditor({ ...otEditor, overtime: { ...otEditor.overtime, [r.key]: Math.max(0, Number(e.target.value)) } })}
                  className="w-24 px-2.5 py-1.5 text-xs text-right border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-300" />
                <span className="text-[9px] text-slate-400 w-4">h</span>
              </div>
            ))}
            <button onClick={() => { saveOverride(otEditor.emp.id, { overtime: otEditor.overtime }); setOtEditor(null); }}
              className="w-full py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5">
              <Ico name="save" size={14} /> Enregistrer
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}


/* ══════════════════════════════════════════════════════ */
/* RECONSTITUTION DU SALAIRE DE BASE À PARTIR DU BRUT       */
/* ══════════════════════════════════════════════════════ */
// Calcul INVERSE de celui du bulletin (voir computeSocialDeductions / computeEmployeePayrollForPeriod) :
// on connaît le TOTAL BRUT visé pour un mois complet (30 j, sans absence) et on en déduit le
// "salaire de base" à inscrire, sachant que toutes les autres rubriques ci-dessous restent
// FIXES (indépendantes du salaire de base) SAUF la prime d'ancienneté, qui est un pourcentage
// du salaire de base : TotalBrut = base × (1 + tauxAncienneté) + (somme des rubriques fixes)
// ⇒ base = (TotalBrut − somme des rubriques fixes) / (1 + tauxAncienneté)
// Champ numérique — déclaré au niveau module (et non à l'intérieur de ReconstitutionPage) pour
// que son identité reste stable entre deux rendus. Une fonction composant redéfinie à chaque
// rendu force React à démonter/remonter le <input> à chaque frappe, ce qui fait perdre le focus
// et mélange les caractères saisis — c'est ce qui causait le bug de saisie signalé.
function NumField({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-slate-600">{label}</label>
      <input type="number" value={value || ''} onChange={e => onChange(Number(e.target.value) || 0)}
        placeholder="0"
        className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-orange-300" />
      {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
    </div>
  );
}

// Employé "gabarit" pour les besoins du calcul de Reconstitution : seuls familySituation,
// numberOfChildren, cnamAmount, pret, acompte, assurance et components sont réellement lus par
// computeSocialDeductions — tous les autres champs sont des valeurs neutres sans incidence.
function makeVirtualEmployee(overrides: Partial<Employee>): Employee {
  return {
    id: '__reconstitution__', firstName: '', lastName: '', email: '', phone: '', position: '',
    department: '', siteId: '', contractType: 'CDI', startDate: '', salary: 0,
    components: emptyComponents(), status: 'Actif', professionalStatus: 'Cadre', category: '',
    avatarColor: '#000000',
    ...overrides,
  };
}

// Page "Reconstitution" — calcule le SALAIRE DE BASE à partir du NET À PAYER connu (et non plus
// du brut), en tenant compte de l'IGR progressif, du quotient familial (RICF) et de toutes les
// retenues/indemnités du bulletin réel. L'IGR n'étant pas inversible algébriquement (barème par
// tranches), on procède par recherche dichotomique : on essaie des salaires de base successifs
// avec exactement la même fonction que le bulletin (computeSocialDeductions), jusqu'à obtenir le
// net à payer visé à l'unité près.
function ReconstitutionPage({ filtered }: { filtered: Employee[] }) {
  const { bump } = useContext(DataVersionContext);
  const [employeeId, setEmployeeId] = useState('');
  const [targetNet, setTargetNet] = useState(0);
  const [joursTravailles, setJoursTravailles] = useState(JOURS_MOIS_PAIE);
  const [sursalaire, setSursalaire] = useState(0);
  const [ancienneteRatePct, setAncienneteRatePct] = useState(0);
  const [primeFonctionImposable, setPrimeFonctionImposable] = useState(0);
  const [primeFonctionNonImposable, setPrimeFonctionNonImposable] = useState(0);
  const [autresPrimesImposables, setAutresPrimesImposables] = useState(0);
  const [indemniteRespNonTaxable, setIndemniteRespNonTaxable] = useState(0);
  const [heuresSupFcfa, setHeuresSupFcfa] = useState(0);
  const [transport, setTransport] = useState(0);
  const [familySituation, setFamilySituation] = useState<FamilySituation>('Célibataire');
  const [numberOfChildren, setNumberOfChildren] = useState(0);
  const [cnamAmount, setCnamAmount] = useState(0);
  const [pret, setPret] = useState(0);
  const [acompte, setAcompte] = useState(0);
  const [assurance, setAssurance] = useState(0);
  const [applied, setApplied] = useState(false);

  const selectedEmp = filtered.find(e => e.id === employeeId) || null;

  // Pré-remplissage à partir d'un employé existant (reste ensuite librement modifiable)
  function applyEmployeePreset(id: string) {
    setEmployeeId(id);
    setApplied(false);
    const emp = filtered.find(e => e.id === id);
    if (!emp) return;
    const c = getComponents(emp);
    setSursalaire(c.sursalaire);
    setPrimeFonctionImposable(c.representation + c.responsibility);
    setAutresPrimesImposables(c.housing + c.performance + c.boisson + c.other);
    setPrimeFonctionNonImposable(c.primeFonctionNonImposable);
    setIndemniteRespNonTaxable(c.indemniteResponsabiliteNonTaxable);
    setTransport(c.transport);
    setHeuresSupFcfa(0);
    setFamilySituation(emp.familySituation || 'Célibataire');
    setNumberOfChildren(emp.numberOfChildren ?? 0);
    setCnamAmount(emp.cnamAmount ?? 0);
    setPret(emp.pret ?? 0);
    setAcompte(emp.acompte ?? 0);
    setAssurance(emp.assurance ?? 0);
    const { ratePct } = computeAncienneteRate(emp.startDate, new Date().toISOString().slice(0, 10));
    setAncienneteRatePct(ratePct);
  }

  // Enveloppe chaque setter pour réinitialiser le badge "Enregistré" dès qu'un champ change
  const upd = (setter: (v: number) => void) => (v: number) => { setApplied(false); setter(v); };
  const updJours = (v: number) => { setApplied(false); setJoursTravailles(Math.max(1, Math.min(JOURS_MOIS_PAIE, v))); };

  // Calcule le bulletin complet (exactement comme computeSocialDeductions) pour un salaire de
  // base candidat donné — utilisé à la fois par la recherche dichotomique et par l'affichage final.
  function evaluateForBase(trialBase: number) {
    const joursRatio = joursTravailles / JOURS_MOIS_PAIE;
    const baseSalaryProrated = Math.round(trialBase * joursRatio);
    const sursalaireProrated = Math.round(sursalaire * joursRatio);
    const deduction = (trialBase + sursalaire) - (baseSalaryProrated + sursalaireProrated);
    const ancienneteAmount = Math.floor(trialBase * (ancienneteRatePct / 100));
    const brutImposableAvantAbsence = trialBase + sursalaire + heuresSupFcfa + ancienneteAmount + primeFonctionImposable + autresPrimesImposables;
    const virtualEmp = makeVirtualEmployee({
      familySituation, numberOfChildren, cnamAmount, pret, acompte, assurance,
      components: {
        baseSalary: trialBase, sursalaire, seniority: 0, housing: 0, transport,
        representation: primeFonctionImposable, responsibility: 0, performance: 0, boisson: 0,
        other: autresPrimesImposables, otherAmount1: autresPrimesImposables, otherAmount2: 0,
        primeFonctionNonImposable, indemniteResponsabiliteNonTaxable: indemniteRespNonTaxable,
      },
    });
    const social = computeSocialDeductions(virtualEmp, brutImposableAvantAbsence, deduction);
    return { social, ancienneteAmount, baseSalaryProrated, sursalaireProrated };
  }

  // Recherche dichotomique : le net à payer croît avec le salaire de base (même si l'IGR est
  // progressif par tranches, la fonction reste croissante), donc la bissection converge de façon
  // fiable — contrairement à l'IGR, elle n'a pas besoin d'être inversée analytiquement.
  const { baseReconstitue, result } = useMemo(() => {
    if (targetNet <= 0) return { baseReconstitue: 0, result: evaluateForBase(0) };
    let lo = 0;
    let hi = Math.max(targetNet * 4, 5_000_000);
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const net = evaluateForBase(mid).social.netAPayer;
      if (net < targetNet) lo = mid; else hi = mid;
    }
    const base = Math.round((lo + hi) / 2);
    return { baseReconstitue: base, result: evaluateForBase(base) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetNet, joursTravailles, sursalaire, ancienneteRatePct, primeFonctionImposable, primeFonctionNonImposable, autresPrimesImposables, indemniteRespNonTaxable, heuresSupFcfa, transport, familySituation, numberOfChildren, cnamAmount, pret, acompte, assurance]);

  const { social, ancienneteAmount, baseSalaryProrated, sursalaireProrated } = result;
  const ecart = targetNet - social.netAPayer;
  const valid = targetNet > 0 && baseReconstitue > 0;

  function applyToEmployee() {
    if (!selectedEmp || !valid) return;
    const emp = employees.find(e => e.id === selectedEmp.id);
    if (!emp) return;
    emp.components.baseSalary = baseReconstitue;
    emp.salary = computeSalary(emp.components);
    persistDoc('employees', emp.id, emp);
    bump();
    setApplied(true);
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <h3 className="text-sm font-bold text-slate-800 mb-1">Reconstituer le salaire de base à partir du net à payer</h3>
        <p className="text-xs text-slate-400 mb-5">
          Saisissez le <b>net à payer</b> connu ainsi que les rubriques fixes de l'employé (sursalaire, primes, situation familiale...) —
          l'outil recalcule le <b>salaire de base</b> en reproduisant exactement le bulletin de paie (IGR progressif, RICF, CNPS...), à l'envers.
        </p>

        <div className="space-y-1 mb-5">
          <label className="text-xs font-semibold text-slate-600">Pré-remplir depuis un employé existant (optionnel)</label>
          <select value={employeeId} onChange={e => applyEmployeePreset(e.target.value)}
            className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-300">
            <option value="">— Saisie manuelle —</option>
            {filtered.map(e => <option key={e.id} value={e.id}>{e.firstName} {e.lastName} — {e.position}</option>)}
          </select>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 mb-2">
          <div className="sm:col-span-2 bg-orange-50 border border-orange-200 rounded-xl p-4">
            <NumField label="NET À PAYER visé (connu)" value={targetNet} onChange={upd(setTargetNet)}
              hint="Le montant net que vous connaissez déjà (ex : le montant réellement versé à l'employé)." />
          </div>

          <NumField label="Nombre de jours travaillés" value={joursTravailles} onChange={updJours}
            hint={`Sur ${JOURS_MOIS_PAIE} jours calendaires. Salaire de base et sursalaire sont proratisés en conséquence.`} />
          <NumField label="Sursalaire" value={sursalaire} onChange={upd(setSursalaire)} />
          <NumField label="Taux de prime d'ancienneté (%)" value={ancienneteRatePct} onChange={upd(setAncienneteRatePct)}
            hint={selectedEmp ? "Calculé depuis la date d'embauche de l'employé (modifiable)." : "1% par année de service (2 à 25 ans), 25% max."} />
          <NumField label="Prime de fonction (imposable)" value={primeFonctionImposable} onChange={upd(setPrimeFonctionImposable)}
            hint="Représentation + responsabilité." />
          <NumField label="Prime de fonction (non imposable)" value={primeFonctionNonImposable} onChange={upd(setPrimeFonctionNonImposable)} />
          <NumField label="Indemnité de responsabilité (non taxable)" value={indemniteRespNonTaxable} onChange={upd(setIndemniteRespNonTaxable)} />
          <NumField label="Autres primes imposables" value={autresPrimesImposables} onChange={upd(setAutresPrimesImposables)}
            hint="Logement, performance, prime exceptionnelle, autre." />
          <NumField label="Heures supplémentaires (FCFA)" value={heuresSupFcfa} onChange={upd(setHeuresSupFcfa)} />
          <NumField label="Indemnité de transport (non imposable)" value={transport} onChange={upd(setTransport)}
            hint="Ajoutée après les retenues, comme sur le bulletin." />

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-600">Situation familiale</label>
            <select value={familySituation} onChange={e => { setApplied(false); setFamilySituation(e.target.value as FamilySituation); }}
              className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-orange-300">
              <option value="Célibataire">Célibataire</option>
              <option value="Marié(e)">Marié(e)</option>
              <option value="Divorcé(e)">Divorcé(e)</option>
              <option value="Veuf">Veuf</option>
              <option value="Veuve">Veuve</option>
            </select>
            <p className="text-[10px] text-slate-400">Détermine le nombre de parts fiscales (RICF).</p>
          </div>
          <NumField label="Nombre d'enfants" value={numberOfChildren} onChange={upd(setNumberOfChildren)} />

          <NumField label="CNAM / CMU" value={cnamAmount} onChange={upd(setCnamAmount)} />
          <NumField label="Prêt (retenue)" value={pret} onChange={upd(setPret)} />
          <NumField label="Acompte (retenue)" value={acompte} onChange={upd(setAcompte)} />
          <NumField label="Assurance (retenue)" value={assurance} onChange={upd(setAssurance)} />
        </div>
      </div>

      {targetNet > 0 && (
        <div className="bg-white rounded-2xl border border-orange-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 bg-orange-50 border-b border-orange-100 flex items-center justify-between">
            <h3 className="text-sm font-bold text-orange-800">Résultat de la reconstitution</h3>
            {selectedEmp && <span className="text-[11px] text-orange-600">Pour {selectedEmp.firstName} {selectedEmp.lastName}</span>}
          </div>

          <div className="p-5">
            <div className="flex items-baseline gap-3 mb-5 flex-wrap">
              <span className="text-xs font-semibold text-slate-500">Salaire de base reconstitué :</span>
              <span className="text-2xl font-extrabold text-orange-700">{formatFCFA(baseReconstitue)}</span>
              <span className="text-[11px] text-slate-400">(taux plein — 30 jours ; à inscrire sur la fiche employé)</span>
            </div>

            <table className="w-full text-left mb-4">
              <thead><tr className="border-b border-slate-100">
                <th className="py-2 text-[10px] font-bold text-slate-400 uppercase">Rubrique</th>
                <th className="py-2 text-[10px] font-bold text-slate-400 uppercase text-right">Base</th>
                <th className="py-2 text-[10px] font-bold text-slate-400 uppercase text-right">Taux/Nb</th>
                <th className="py-2 text-[10px] font-bold text-slate-400 uppercase text-right">Montant</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                <tr><td className="py-2 text-xs text-slate-700">SALAIRE (base)</td><td className="py-2 text-xs text-right text-slate-500">{formatFCFA(baseReconstitue)}</td><td className="py-2 text-xs text-right text-slate-500">{joursTravailles} j</td><td className="py-2 text-xs text-right font-bold text-slate-800">{formatFCFA(baseSalaryProrated)}</td></tr>
                {sursalaire > 0 && <tr><td className="py-2 text-xs text-slate-700">SURSALAIRE</td><td className="py-2 text-xs text-right text-slate-500">{formatFCFA(sursalaire)}</td><td className="py-2 text-xs text-right text-slate-500">{joursTravailles} j</td><td className="py-2 text-xs text-right text-slate-600">{formatFCFA(sursalaireProrated)}</td></tr>}
                {ancienneteAmount > 0 && <tr><td className="py-2 text-xs text-slate-700">PRIME ANCIENNETÉ</td><td className="py-2 text-xs text-right text-slate-500">{formatFCFA(baseReconstitue)}</td><td className="py-2 text-xs text-right text-slate-500">{ancienneteRatePct}%</td><td className="py-2 text-xs text-right text-slate-600">{formatFCFA(ancienneteAmount)}</td></tr>}
                {primeFonctionImposable > 0 && <tr><td className="py-2 text-xs text-slate-700">PRIME DE FONCTION</td><td className="py-2 text-xs text-right text-slate-500">—</td><td className="py-2 text-xs text-right text-slate-500">—</td><td className="py-2 text-xs text-right text-slate-600">{formatFCFA(primeFonctionImposable)}</td></tr>}
                {autresPrimesImposables > 0 && <tr><td className="py-2 text-xs text-slate-700">AUTRES PRIMES IMPOSABLES</td><td className="py-2 text-xs text-right text-slate-500">—</td><td className="py-2 text-xs text-right text-slate-500">—</td><td className="py-2 text-xs text-right text-slate-600">{formatFCFA(autresPrimesImposables)}</td></tr>}
                {primeFonctionNonImposable > 0 && <tr><td className="py-2 text-xs text-slate-700">PRIME DE FONCTION NON IMPOSABLE</td><td className="py-2 text-xs text-right text-slate-500">—</td><td className="py-2 text-xs text-right text-slate-500">—</td><td className="py-2 text-xs text-right text-slate-600">{formatFCFA(primeFonctionNonImposable)}</td></tr>}
                {indemniteRespNonTaxable > 0 && <tr><td className="py-2 text-xs text-slate-700">INDEMNITÉ RESPONSABILITÉ (non taxable)</td><td className="py-2 text-xs text-right text-slate-500">—</td><td className="py-2 text-xs text-right text-slate-500">—</td><td className="py-2 text-xs text-right text-slate-600">{formatFCFA(indemniteRespNonTaxable)}</td></tr>}
                {heuresSupFcfa > 0 && <tr><td className="py-2 text-xs text-slate-700">HEURES SUPPLÉMENTAIRES</td><td className="py-2 text-xs text-right text-slate-500">—</td><td className="py-2 text-xs text-right text-slate-500">—</td><td className="py-2 text-xs text-right text-slate-600">{formatFCFA(heuresSupFcfa)}</td></tr>}
                <tr className="border-t border-slate-200 font-bold"><td className="py-2 text-xs text-slate-700">TOTAL BRUT</td><td colSpan={2}></td><td className="py-2 text-xs text-right text-emerald-700">{formatFCFA(social.totalBrut)}</td></tr>
                <tr><td className="py-2 text-xs text-red-600">Impôts brut (barème IGR)</td><td colSpan={2}></td><td className="py-2 text-xs text-right text-red-500">− {formatFCFA(social.impotsBrut)}</td></tr>
                {social.ricf > 0 && <tr><td className="py-2 text-xs text-red-600">RICF ({social.parts} parts)</td><td colSpan={2}></td><td className="py-2 text-xs text-right text-red-500">+ {formatFCFA(social.ricf)}</td></tr>}
                <tr><td className="py-2 text-xs text-red-600">ITS (impôt sur salaires)</td><td colSpan={2}></td><td className="py-2 text-xs text-right text-red-500">− {formatFCFA(social.its)}</td></tr>
                <tr><td className="py-2 text-xs text-red-600">CNPS (6,3%)</td><td colSpan={2}></td><td className="py-2 text-xs text-right text-red-500">− {formatFCFA(social.cnps)}</td></tr>
                {social.cnam > 0 && <tr><td className="py-2 text-xs text-red-600">CNAM / CMU</td><td colSpan={2}></td><td className="py-2 text-xs text-right text-red-500">− {formatFCFA(social.cnam)}</td></tr>}
                {social.pret > 0 && <tr><td className="py-2 text-xs text-red-600">Prêt</td><td colSpan={2}></td><td className="py-2 text-xs text-right text-red-500">− {formatFCFA(social.pret)}</td></tr>}
                {social.acompte > 0 && <tr><td className="py-2 text-xs text-red-600">Acompte</td><td colSpan={2}></td><td className="py-2 text-xs text-right text-red-500">− {formatFCFA(social.acompte)}</td></tr>}
                {social.assurance > 0 && <tr><td className="py-2 text-xs text-red-600">Assurance</td><td colSpan={2}></td><td className="py-2 text-xs text-right text-red-500">− {formatFCFA(social.assurance)}</td></tr>}
                {social.transportNonImposable > 0 && <tr><td className="py-2 text-xs text-slate-700">Indemnité transport</td><td colSpan={2}></td><td className="py-2 text-xs text-right text-slate-600">+ {formatFCFA(social.transportNonImposable)}</td></tr>}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                  <td colSpan={3} className="py-2 text-xs text-slate-700">NET À PAYER RECALCULÉ</td>
                  <td className="py-2 text-sm text-right text-orange-700">{formatFCFA(social.netAPayer)}</td>
                </tr>
              </tfoot>
            </table>

            {!valid && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                Les retenues et rubriques fixes saisies dépassent le net visé — impossible d'obtenir un salaire de base positif. Vérifiez vos montants.
              </p>
            )}
            {valid && Math.abs(ecart) > 1 && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                Écart d'arrondi de {formatFCFA(Math.abs(ecart))} par rapport au net visé (dû aux arrondis à l'unité près) — négligeable en pratique.
              </p>
            )}

            {selectedEmp && valid && (
              <div className="flex items-center gap-3 mt-4 pt-4 border-t border-slate-100">
                <button onClick={applyToEmployee}
                  className="px-4 py-2.5 text-xs font-bold bg-orange-500 hover:bg-orange-600 text-white rounded-xl transition-colors shadow-sm shadow-orange-200">
                  Appliquer ce salaire de base à la fiche de {selectedEmp.firstName}
                </button>
                {applied && <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1"><Ico name="checkmark" size={14} /> Enregistré</span>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}



/* ══════════════════════════════════════════════════════ */
/* CHARGES SOCIALES PATRONALES (CNPS + FDFP — Côte d'Ivoire) */
/* ══════════════════════════════════════════════════════ */
// NB : ces montants correspondent à la PART PATRONALE (coût employeur),
// distincte des retenues salariales déjà affichées sur le bulletin de paie
// (CNPS 6,3%, Contribution nationale 1,2%, ITS 1,5%, IGR 2,5%).

// Plafonds légaux mensuels de cotisation CNPS (source : cnps.ci)
const CNPS_PLAFOND_RETRAITE = 1_647_315; // FCFA / mois — base retraite
const CNPS_PLAFOND_PF_AT = 70_000;       // FCFA / mois — base prestations familiales & accidents du travail

// Taux légaux — part patronale
const TAUX_RETRAITE_PATRONALE = 0.077;     // 7,7% (le total retraite CNPS est de 14% : 7,7% employeur + 6,3% salarié)
const TAUX_PRESTATIONS_FAMILIALES = 0.05;  // 5% dont 0,75% assurance maternité — 100% à la charge de l'employeur
const TAUX_TAXE_APPRENTISSAGE = 0.004;     // 0,4% — FDFP, Taxe d'Apprentissage (TA)
const TAUX_FORMATION_CONTINUE = 0.012;     // 1,2% — FDFP, Taxe additionnelle Formation Professionnelle Continue (TFPC)

// Le taux Accidents du Travail / Maladies Professionnelles est désormais un réglage global
// modifiable et persisté (voir parametresGeneraux / setAccidentTravailTauxPct plus haut),
// partagé entre le bulletin, "Charges sociales" et le "Livre de paie en fin d'année".

type EmployerSocialCharges = {
  baseRetraite: number; baseFamAT: number;
  retraitePatronale: number; prestationsFamiliales: number; accidentsTravail: number; totalCnps: number;
  taxeApprentissage: number; taxeFormationContinue: number; totalFdfp: number;
  totalMensuel: number;
};

function computeEmployerSocialCharges(salary: number, atRate: number): EmployerSocialCharges {
  const baseRetraite = Math.min(salary, CNPS_PLAFOND_RETRAITE);
  const baseFamAT = Math.min(salary, CNPS_PLAFOND_PF_AT);
  const retraitePatronale = Math.round(baseRetraite * TAUX_RETRAITE_PATRONALE);
  const prestationsFamiliales = Math.round(baseFamAT * TAUX_PRESTATIONS_FAMILIALES);
  const accidentsTravail = Math.round(baseFamAT * atRate);
  const totalCnps = retraitePatronale + prestationsFamiliales + accidentsTravail;
  const taxeApprentissage = Math.round(salary * TAUX_TAXE_APPRENTISSAGE);
  const taxeFormationContinue = Math.round(salary * TAUX_FORMATION_CONTINUE);
  const totalFdfp = taxeApprentissage + taxeFormationContinue;
  const totalMensuel = totalCnps + totalFdfp;
  return { baseRetraite, baseFamAT, retraitePatronale, prestationsFamiliales, accidentsTravail, totalCnps, taxeApprentissage, taxeFormationContinue, totalFdfp, totalMensuel };
}

// Page réutilisée pour les 3 sous-menus (mensuelle / semestrielle / annuelle) — seule la période affichée change
type ChargesPeriodMode = 'month' | 'semester' | 'year';

// Cumule, pour un employé, le "brut réel" et les charges patronales sur une liste de mois
// calendaires — chaque mois est calculé séparément à partir des présences réellement
// saisies (comme dans "Paie"), puis les montants mensuels obtenus sont additionnés.
// C'est cette somme "mois après mois" qui alimente ensuite les vues semestrielle et annuelle.
const CHARGES_SOCIALES_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'nom', label: 'Employé' }, { key: 'poste', label: 'Poste' }, { key: 'moisAvecDonnees', label: 'Mois avec données' },
  { key: 'brutCumule', label: 'Brut réel cumulé' }, { key: 'retraitePatronale', label: 'CNPS Retraite (7,7%)' },
  { key: 'prestationsFamiliales', label: 'Prest. familiales (5%)' }, { key: 'accidentsTravail', label: 'Accidents travail' },
  { key: 'totalFdfp', label: 'FDFP (1,6%)' }, { key: 'total', label: 'Total période' },
];

// Map mode ⇄ clé de page (les 3 sous-menus "Charges sociales" partagent ce même composant)
const CHARGES_SOCIALES_PAGE_KEY: Record<ChargesPeriodMode, string> = { month: 'cs-mensuelles', semester: 'cs-semestrielles', year: 'cs-annuelles' };

function cumulateEmployerCharges(emp: Employee, months: { start: string; end: string; label: string }[], atRate: number) {
  let brutCumule = 0;
  let moisAvecDonnees = 0;
  const charges: EmployerSocialCharges = {
    baseRetraite: 0, baseFamAT: 0, retraitePatronale: 0, prestationsFamiliales: 0, accidentsTravail: 0,
    totalCnps: 0, taxeApprentissage: 0, taxeFormationContinue: 0, totalFdfp: 0, totalMensuel: 0,
  };
  const detail: { label: string; brut: number; totalMensuel: number; hasData: boolean }[] = [];

  months.forEach(m => {
    const r = computeEmployeePayrollForPeriod(emp, m.start, m.end);
    if (r.hasData) moisAvecDonnees++;
    // Un mois SANS saisie manuelle dans "Paie" ne doit RIEN ajouter au cumul — sinon les vues
    // "Livre de paie fin d'année" et "Charges sociales" incluraient un mois complet fictif
    // (30 j par défaut) pour chaque mois non encore traité, faussant le total par rapport aux
    // données réellement enregistrées.
    if (!r.hasData) { detail.push({ label: m.label, brut: 0, totalMensuel: 0, hasData: false }); return; }
    // Base des charges patronales = BRUT SOCIAL (comme la CNPS salariale), PAS le total des
    // gains : la prime de fonction non imposable doit rester hors de cette base, alors que
    // l'indemnité de responsabilité non taxable doit y être incluse (cf. computeSocialDeductions).
    brutCumule += r.social.brutSocial;
    // Le plafond CNPS s'applique MOIS PAR MOIS (règle légale), d'où le calcul mois par mois puis la somme
    const c = computeEmployerSocialCharges(r.social.brutSocial, atRate);
    charges.baseRetraite += c.baseRetraite;
    charges.baseFamAT += c.baseFamAT;
    charges.retraitePatronale += c.retraitePatronale;
    charges.prestationsFamiliales += c.prestationsFamiliales;
    charges.accidentsTravail += c.accidentsTravail;
    charges.totalCnps += c.totalCnps;
    charges.taxeApprentissage += c.taxeApprentissage;
    charges.taxeFormationContinue += c.taxeFormationContinue;
    charges.totalFdfp += c.totalFdfp;
    charges.totalMensuel += c.totalMensuel;
    detail.push({ label: m.label, brut: r.social.brutSocial, totalMensuel: c.totalMensuel, hasData: r.hasData });
  });

  return { brutCumule, moisAvecDonnees, totalMois: months.length, charges, detail };
}

const MOIS_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

// Page réutilisée pour les 3 sous-menus (mensuelle / semestrielle / annuelle).
// Les montants proviennent TOUJOURS de la paie réelle calculée mois par mois (mêmes présences
// que dans le menu "Paie") — jamais d'une simple multiplication du salaire actuel.
function SocialChargesPage({ filtered, mode, periodLabel }: { filtered: Employee[]; mode: ChargesPeriodMode; periodLabel: string }) {
  const { version, bump } = useContext(DataVersionContext);
  const now = new Date();
  // Ancré sur le mois/année courants par défaut, pour rester cohérent avec le menu "Paie".
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [semester, setSemester] = useState<1 | 2>(now.getMonth() + 1 <= 6 ? 1 : 2);
  // Taux Accidents du Travail : réglage GLOBAL persisté (parametres/general), partagé avec le
  // bulletin de paie et le Livre de paie en fin d'année — le modifier ici le modifie partout.
  const atRatePct = parametresGeneraux.accidentTravailTauxPct;
  const atRate = atRatePct / 100;

  // Détermine la liste des mois calendaires réellement agrégés selon le mode choisi
  const months = useMemo(() => {
    if (mode === 'month') return [monthRange(year, month)];
    if (mode === 'semester') {
      const startM = semester === 1 ? 1 : 7;
      return Array.from({ length: 6 }, (_, i) => monthRange(year, startM + i));
    }
    return Array.from({ length: 12 }, (_, i) => monthRange(year, i + 1)); // année complète
  }, [mode, year, month, semester]);

  const rows = useMemo(
    () => filtered.map(emp => ({ emp, ...cumulateEmployerCharges(emp, months, atRate) })),
    [filtered, months, atRate, version]
  );

  const totalCnps = rows.reduce((a, r) => a + r.charges.totalCnps, 0);
  const totalFdfp = rows.reduce((a, r) => a + r.charges.totalFdfp, 0);
  const totalGlobal = rows.reduce((a, r) => a + r.charges.totalMensuel, 0);
  const avgGlobal = rows.length ? totalGlobal / rows.length : 0;

  const yearOptions = [2024, 2025, 2026, 2027];

  const buildRows = useCallback((): ExportRow[] => rows.map(({ emp, brutCumule, moisAvecDonnees, totalMois, charges }) => ({
    nom: `${emp.firstName} ${emp.lastName}`, poste: emp.position, moisAvecDonnees: `${moisAvecDonnees}/${totalMois}`,
    brutCumule, retraitePatronale: charges.retraitePatronale, prestationsFamiliales: charges.prestationsFamiliales,
    accidentsTravail: charges.accidentsTravail, totalFdfp: charges.totalFdfp, total: charges.totalMensuel,
  })), [rows]);
  useEffect(() => {
    const key = CHARGES_SOCIALES_PAGE_KEY[mode];
    exportRegistry[key] = { title: `Charges sociales — ${periodLabel}`, tableClass: 'charges-sociales-table', columns: CHARGES_SOCIALES_EXPORT_COLUMNS, buildRows };
  }, [mode, periodLabel, buildRows]);

  return (
    <div className="space-y-6">
      {/* Cartes statistiques */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
          <div className="flex items-start justify-between mb-2"><div className="h-9 w-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-sm"><Ico name="briefcase" size={18} className="text-white" /></div></div>
          <p className="text-xl font-bold text-slate-800">{filtered.length}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Total employés</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
          <div className="flex items-start justify-between mb-2"><div className="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white shadow-sm"><Ico name="shield" size={18} className="text-white" /></div></div>
          <p className="text-lg font-bold text-slate-800">{formatFCFA(totalCnps)}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Cotisations CNPS ({periodLabel.toLowerCase()})</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
          <div className="flex items-start justify-between mb-2"><div className="h-9 w-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center text-white shadow-sm"><Ico name="books" size={18} className="text-white" /></div></div>
          <p className="text-lg font-bold text-slate-800">{formatFCFA(totalFdfp)}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Contribution FDFP ({periodLabel.toLowerCase()})</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
          <div className="flex items-start justify-between mb-2"><div className="h-9 w-9 rounded-xl bg-gradient-to-br from-sky-500 to-cyan-500 flex items-center justify-center text-white shadow-sm"><Ico name="trendUp" size={18} className="text-white" /></div></div>
          <p className="text-lg font-bold text-slate-800">{formatFCFA(totalGlobal)}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Total charges patronales ({periodLabel.toLowerCase()})</p>
        </div>
      </div>

      {/* Sélecteurs de période + taux AT */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <Ico name="calendar" size={18} className="text-orange-500" />
        {mode === 'month' && (
          <>
            <span className="text-xs font-bold text-slate-700">Mois :</span>
            <select value={month} onChange={e => setMonth(Number(e.target.value))}
              className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-300">
              {MOIS_FR.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </>
        )}
        {mode === 'semester' && (
          <>
            <span className="text-xs font-bold text-slate-700">Semestre :</span>
            <div className="flex rounded-xl overflow-hidden border border-slate-200">
              <button onClick={() => setSemester(1)} className={cn('px-3 py-2 text-xs font-semibold', semester === 1 ? 'bg-orange-500 text-white' : 'bg-slate-50 text-slate-600')}>S1 (Jan-Juin)</button>
              <button onClick={() => setSemester(2)} className={cn('px-3 py-2 text-xs font-semibold', semester === 2 ? 'bg-orange-500 text-white' : 'bg-slate-50 text-slate-600')}>S2 (Juil-Déc)</button>
            </div>
          </>
        )}
        {mode !== 'month' && <span className="text-xs font-bold text-slate-700 ml-1">Année :</span>}
        {mode === 'month' && <span className="text-xs font-bold text-slate-700">Année :</span>}
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-300">
          {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </select>

        <span className="w-px h-6 bg-slate-200 mx-1" />
        <span className="text-[10px] text-slate-400 uppercase">Période du</span>
        <span className="text-xs font-semibold text-slate-700">{formatDateFR(months[0]?.start)}</span>
        <span className="text-[10px] text-slate-400 uppercase">au</span>
        <span className="text-xs font-semibold text-slate-700">{formatDateFR(months[months.length - 1]?.end)}</span>

        <span className="w-px h-6 bg-slate-200 mx-1" />

        <Ico name="shield" size={18} className="text-orange-500" />
        <span className="text-xs font-bold text-slate-700">Taux Accidents du travail :</span>
        <input type="number" min={0} max={100} step={0.5} value={atRatePct}
          onChange={e => { setAccidentTravailTauxPct(Number(e.target.value) || 0); bump(); }}
          className="w-20 px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-300" />
        <span className="text-xs text-slate-500">%</span>
        <span className="text-[10px] text-slate-400">(réglage commun à toute l'application — bulletin, Livre de paie fin d'année inclus)</span>
      </div>

      {/* Tableau détaillé par employé */}
      <div className="bg-white rounded-2xl border border-orange-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 bg-orange-50 border-b border-orange-100">
          <h3 className="text-sm font-bold text-orange-800">
            Charges sociales patronales {periodLabel} — par employé · {months[0]?.label}{months.length > 1 ? ` → ${months[months.length - 1].label}` : ''}
          </h3>
          <p className="text-[11px] text-orange-600 mt-0.5">
            Montants réels cumulés mois par mois (jours payés, heures sup. saisis manuellement) · CNPS Retraite 7,7% (plaf. {formatFCFA(CNPS_PLAFOND_RETRAITE)}/mois) · Prestations familiales 5% & Accidents du travail {(atRate * 100).toFixed(0)}% (plaf. {formatFCFA(CNPS_PLAFOND_PF_AT)}/mois) · FDFP 1,6%
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left charges-sociales-table">
            <thead><tr className="border-b border-slate-100 bg-slate-50/50">
              <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase">Employé</th>
              <th className="px-3 py-3 text-[10px] font-bold text-slate-400 uppercase text-right">Mois avec données</th>
              <th className="px-3 py-3 text-[10px] font-bold text-slate-400 uppercase text-right">Brut réel cumulé</th>
              <th className="px-3 py-3 text-[10px] font-bold text-slate-400 uppercase text-right">CNPS Retraite (7,7%)</th>
              <th className="px-3 py-3 text-[10px] font-bold text-slate-400 uppercase text-right">Prest. familiales (5%)</th>
              <th className="px-3 py-3 text-[10px] font-bold text-slate-400 uppercase text-right">Accidents travail</th>
              <th className="px-3 py-3 text-[10px] font-bold text-slate-400 uppercase text-right">FDFP (1,6%)</th>
              <th className="px-3 py-3 text-[10px] font-bold text-orange-600 uppercase text-right">Total {periodLabel.toLowerCase()}</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(({ emp, brutCumule, moisAvecDonnees, totalMois, charges }) => (
                <tr key={emp.id} className="hover:bg-orange-50/60">
                  <td className="px-4 py-3"><div className="flex items-center gap-3"><Avatar emp={emp} /><div><p className="text-xs font-semibold text-slate-700">{emp.firstName} {emp.lastName}</p><p className="text-[10px] text-slate-400">{emp.position} · {emp.professionalStatus}</p></div></div></td>
                  <td className="px-3 py-3 text-right">
                    <span className={cn('inline-block px-2 py-0.5 rounded-full text-[10px] font-bold',
                      moisAvecDonnees === totalMois ? 'bg-emerald-100 text-emerald-700' : moisAvecDonnees === 0 ? 'bg-slate-100 text-slate-400' : 'bg-amber-100 text-amber-700')}>
                      {moisAvecDonnees}/{totalMois} mois
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-600 text-right">{formatFCFA(brutCumule)}</td>
                  <td className="px-3 py-3 text-xs text-slate-600 text-right">{formatFCFA(charges.retraitePatronale)}</td>
                  <td className="px-3 py-3 text-xs text-slate-600 text-right">{formatFCFA(charges.prestationsFamiliales)}</td>
                  <td className="px-3 py-3 text-xs text-slate-600 text-right">{formatFCFA(charges.accidentsTravail)}</td>
                  <td className="px-3 py-3 text-xs text-slate-600 text-right">{formatFCFA(charges.totalFdfp)}</td>
                  <td className="px-3 py-3 text-xs font-extrabold text-right text-orange-700">{formatFCFA(charges.totalMensuel)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                <td className="px-4 py-3 text-xs text-slate-700">TOTAL</td>
                <td className="px-3 py-3"></td>
                <td className="px-3 py-3"></td>
                <td className="px-3 py-3 text-xs text-slate-700 text-right">{formatFCFA(rows.reduce((a, r) => a + r.charges.retraitePatronale, 0))}</td>
                <td className="px-3 py-3 text-xs text-slate-700 text-right">{formatFCFA(rows.reduce((a, r) => a + r.charges.prestationsFamiliales, 0))}</td>
                <td className="px-3 py-3 text-xs text-slate-700 text-right">{formatFCFA(rows.reduce((a, r) => a + r.charges.accidentsTravail, 0))}</td>
                <td className="px-3 py-3 text-xs text-slate-700 text-right">{formatFCFA(totalFdfp)}</td>
                <td className="px-3 py-3 text-sm text-orange-700 text-right">{formatFCFA(totalGlobal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="px-5 py-3 border-t border-orange-100 flex items-center justify-between bg-orange-50/40">
          <span className="text-[11px] text-slate-500">{filtered.length} employé(s) · Moyenne par employé : {formatFCFA(avgGlobal)}</span>
        </div>
      </div>

      {/* Note légale / avertissement */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-[11px] text-amber-800 leading-relaxed">
        ⚠ Ces montants sont calculés à partir de la <b>saisie manuelle</b> de chaque mois (jours payés, heures sup.) dans le menu "Paie" — puis additionnés mois par mois pour les vues semestrielle et annuelle. Le badge « X/Y mois » indique combien de mois de la période disposent d'une saisie ; pour un mois sans aucune saisie, le calcul retombe par défaut sur le salaire de base (comme si l'employé avait été présent tout le mois). Taux CNPS/FDFP indicatifs (retraite 7,7% part patronale, prestations familiales 5%, accidents du travail 2 à 5% selon secteur, FDFP 1,6%) — le plafond CNPS est appliqué mois par mois, conformément à la réglementation. Ces montants correspondent au <b>coût employeur</b>, distinct des retenues salariales déjà affichées sur le bulletin de paie. Faites valider ces montants par un expert-comptable ou directement auprès de la CNPS / du FDFP avant tout versement.
      </div>
    </div>
  );
}



/* ══════════════════════════════════════════════════════ */
/* PAGE : LIVRE DE PAIE — FIN D'ANNÉE                      */
/* Reproduit l'onglet "LIVRE DE PAIE DECEMBRE 2025" : le    */
/* même registre que "Paie", cumulé sur les 12 mois de      */
/* l'année, complété par les charges patronales (colonnes   */
/* ISP, FDFP, PF, accident du travail, retraite patronale)  */
/* pour obtenir le "TOTAL GÉNÉRAL" (coût employeur annuel). */
/* ══════════════════════════════════════════════════════ */

// Cumule, pour un employé, la paie réelle (salariale) ET les charges patronales
// sur les 12 mois de l'année — chaque mois est calculé séparément à partir des
// présences réellement saisies (mêmes fonctions que "Paie"), puis additionné.
function cumulateAnnualPayroll(emp: Employee, months: { start: string; end: string; label: string }[]) {
  const c = getComponents(emp);
  const acc = {
    baseSalary: 0, sursalaire: 0, overtimePay: 0, ancienneteAmount: 0, primeFonction: 0,
    totalBrut: 0, brutImposable: 0, brutSocial: 0,
    impotsBrut: 0, ricf: 0, its: 0, cnps: 0, cnam: 0, pret: 0, acompte: 0, assurance: 0, transport: 0, netToPay: 0,
    isp: 0, fdfpTA: 0, fdfpTCF: 0, totalImpotPatronal: 0,
    prestationFamiliale: 0, accidentTravail: 0, cnpsPatronal: 0, totalCnpsPatronal: 0,
    totalGeneral: 0,
  };
  let moisAvecDonnees = 0;
  const primeFonctionMensuelle = c.representation + c.responsibility + c.housing + c.performance + c.boisson + c.other;

  months.forEach(m => {
    const r = computeEmployeePayrollForPeriod(emp, m.start, m.end);
    if (r.hasData) moisAvecDonnees++;
    // Un mois SANS saisie manuelle dans "Paie" ne doit RIEN ajouter au cumul annuel — sinon
    // ce registre inclurait un mois complet fictif (30 j par défaut) pour chaque mois non
    // encore traité, au lieu de refléter uniquement les mois réellement enregistrés.
    if (!r.hasData) return;
    const s = r.social;

    acc.baseSalary += r.baseSalaryProrated;
    acc.sursalaire += r.sursalaireProrated;
    acc.overtimePay += r.overtimePay;
    acc.ancienneteAmount += r.ancienneteAmount;
    acc.primeFonction += primeFonctionMensuelle;
    acc.totalBrut += s.totalBrut;
    acc.brutImposable += s.brutImposable;
    acc.brutSocial += s.brutSocial;
    acc.impotsBrut += s.impotsBrut;
    acc.ricf += s.ricf;
    acc.its += s.its;
    acc.cnps += s.cnps;
    acc.cnam += s.cnam;
    acc.pret += s.pret;
    acc.acompte += s.acompte;
    acc.assurance += s.assurance;
    acc.transport += s.transportNonImposable;
    acc.netToPay += r.netToPay;

    // Charges patronales du mois (source : onglet "LIVRE DE PAIE DECEMBRE 2025", colonnes AA à AJ)
    const isp = Math.round(s.totalBrut * 0.012);           // ISP — Impôt sur salaires (part patronale)
    const fdfpTA = Math.round(s.totalBrut * 0.004);          // FDFP — Taxe d'apprentissage
    const fdfpTCF = Math.round(s.totalBrut * 0.012);         // FDFP — Taxe FPC
    const totalImpotPatronal = isp + fdfpTA + fdfpTCF + s.its;
    const pfBase = Math.min(s.brutSocial, CHARGES_PATRONALES.prestationFamilialeBase);
    const prestationFamiliale = Math.round(pfBase * CHARGES_PATRONALES.prestationFamilialeTaux);
    const atBase = Math.min(s.brutSocial, CHARGES_PATRONALES.accidentTravailBase);
    const accidentTravail = Math.round(atBase * (parametresGeneraux.accidentTravailTauxPct / 100));
    const cnpsPatronal = computeCNPSPatronal(s.brutSocial);
    const totalCnpsPatronal = prestationFamiliale + accidentTravail + cnpsPatronal;
    const totalGeneral = totalImpotPatronal + totalCnpsPatronal;

    acc.isp += isp; acc.fdfpTA += fdfpTA; acc.fdfpTCF += fdfpTCF; acc.totalImpotPatronal += totalImpotPatronal;
    acc.prestationFamiliale += prestationFamiliale; acc.accidentTravail += accidentTravail;
    acc.cnpsPatronal += cnpsPatronal; acc.totalCnpsPatronal += totalCnpsPatronal;
    acc.totalGeneral += totalGeneral;
  });

  return { ...acc, moisAvecDonnees, totalMois: months.length };
}

const LIVRE_FIN_ANNEE_EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'n', label: 'N°' }, { key: 'nom', label: 'Nom' }, { key: 'prenoms', label: 'Prénoms' },
  { key: 'salaireBase', label: 'Salaire base (cumul)' }, { key: 'sursalaire', label: 'Sursalaire (cumul)' },
  { key: 'heureSuppl', label: 'Heure suppl. (cumul)' }, { key: 'primeAnciennete', label: 'Prime ancienneté (cumul)' },
  { key: 'primeFonction', label: 'Prime fonction (cumul)' }, { key: 'totalBrut', label: 'Total brut annuel' },
  { key: 'brutImposable', label: 'Brut imposable' }, { key: 'brutSocial', label: 'Brut social' },
  { key: 'impotsBrut', label: 'Impôts brut' }, { key: 'ricf', label: 'RICF' }, { key: 'its', label: 'ITS salariés' },
  { key: 'cnps', label: 'CNPS salariés' }, { key: 'cnam', label: 'CNAM' }, { key: 'pret', label: 'Prêts' },
  { key: 'transport', label: 'Indem. transport' }, { key: 'salaireNet', label: 'Salaire net annuel' },
  { key: 'isp', label: 'ISP (1,2%)' }, { key: 'fdfpTA', label: 'FDFP TA (0,4%)' }, { key: 'fdfpTCF', label: 'FDFP TCF (1,2%)' },
  { key: 'totalImpot', label: 'Total impôt' }, { key: 'prestationFamiliale', label: 'Prest. familiales' },
  { key: 'accidentTravail', label: 'Accident travail' }, { key: 'retraitePatronale', label: 'Retraite patronale' },
  { key: 'totalCnpsPatronal', label: 'Total CNPS patronal' }, { key: 'totalGeneral', label: 'TOTAL GÉNÉRAL' },
];

function buildLivreFinAnneeExportRows(rows: { emp: Employee; baseSalary: number; sursalaire: number; overtimePay: number; ancienneteAmount: number; primeFonction: number; totalBrut: number; brutImposable: number; brutSocial: number; impotsBrut: number; ricf: number; its: number; cnps: number; cnam: number; pret: number; transport: number; netToPay: number; isp: number; fdfpTA: number; fdfpTCF: number; totalImpotPatronal: number; prestationFamiliale: number; accidentTravail: number; cnpsPatronal: number; totalCnpsPatronal: number; totalGeneral: number }[]): ExportRow[] {
  return rows.map((r, i) => ({
    n: i + 1, nom: r.emp.lastName, prenoms: r.emp.firstName, salaireBase: r.baseSalary, sursalaire: r.sursalaire,
    heureSuppl: r.overtimePay, primeAnciennete: r.ancienneteAmount, primeFonction: r.primeFonction, totalBrut: r.totalBrut,
    brutImposable: r.brutImposable, brutSocial: r.brutSocial, impotsBrut: r.impotsBrut, ricf: r.ricf, its: r.its,
    cnps: r.cnps, cnam: r.cnam, pret: r.pret, transport: r.transport, salaireNet: r.netToPay, isp: r.isp,
    fdfpTA: r.fdfpTA, fdfpTCF: r.fdfpTCF, totalImpot: r.totalImpotPatronal, prestationFamiliale: r.prestationFamiliale,
    accidentTravail: r.accidentTravail, retraitePatronale: r.cnpsPatronal, totalCnpsPatronal: r.totalCnpsPatronal, totalGeneral: r.totalGeneral,
  }));
}

function LivreFinAnneePage({ filtered }: { filtered: Employee[] }) {
  const { version } = useContext(DataVersionContext);
  const [year, setYear] = useState(new Date().getFullYear());
  const [payslip, setPayslip] = useState<PayrollRow | null>(null);
  const yearOptions = [2024, 2025, 2026, 2027, 2028];

  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => monthRange(year, i + 1)), [year]);
  const decEnd = months[11].end;

  const rows = useMemo(
    () => filtered.map(emp => ({ emp, ...cumulateAnnualPayroll(emp, months) })),
    [filtered, months, version]
  );

  const sum = (fn: (r: typeof rows[number]) => number) => rows.reduce((a, r) => a + fn(r), 0);
  const T = {
    base: sum(r => r.baseSalary), sursalaire: sum(r => r.sursalaire), overtimePay: sum(r => r.overtimePay),
    anciennete: sum(r => r.ancienneteAmount), primeFonction: sum(r => r.primeFonction),
    totalBrut: sum(r => r.totalBrut), brutImposable: sum(r => r.brutImposable), brutSocial: sum(r => r.brutSocial),
    impotsBrut: sum(r => r.impotsBrut), ricf: sum(r => r.ricf), its: sum(r => r.its), cnps: sum(r => r.cnps),
    cnam: sum(r => r.cnam), pret: sum(r => r.pret), transport: sum(r => r.transport), netToPay: sum(r => r.netToPay),
    isp: sum(r => r.isp), fdfpTA: sum(r => r.fdfpTA), fdfpTCF: sum(r => r.fdfpTCF), totalImpotPatronal: sum(r => r.totalImpotPatronal),
    prestationFamiliale: sum(r => r.prestationFamiliale), accidentTravail: sum(r => r.accidentTravail),
    cnpsPatronal: sum(r => r.cnpsPatronal), totalCnpsPatronal: sum(r => r.totalCnpsPatronal), totalGeneral: sum(r => r.totalGeneral),
  };
  const coutTotalEmployeur = T.netToPay + T.its + T.cnps + T.cnam + T.totalGeneral; // net + retenues salariales reversées + charges patronales

  const buildRows = useCallback(() => buildLivreFinAnneeExportRows(rows), [rows]);
  useEffect(() => {
    exportRegistry['livre-fin-annee'] = { title: "Livre de paie - Fin d'année", tableClass: 'livre-fin-annee-table', columns: LIVRE_FIN_ANNEE_EXPORT_COLUMNS, buildRows };
  }, [buildRows]);

  return (
    <div className="space-y-6">
      {/* Sélecteur d'année */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <Ico name="receipt" size={18} className="text-orange-500" />
        <span className="text-xs font-bold text-slate-700">Exercice :</span>
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-300">
          {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <span className="w-px h-6 bg-slate-200 mx-1" />
        <span className="text-[10px] text-slate-400 uppercase">Période du</span>
        <span className="text-xs font-semibold text-slate-700">{formatDateFR(months[0].start)}</span>
        <span className="text-[10px] text-slate-400 uppercase">au</span>
        <span className="text-xs font-semibold text-slate-700">{formatDateFR(decEnd)}</span>
        <span className="text-[10px] text-slate-400 ml-2">cliquez sur une ligne pour voir le bulletin de décembre</span>
      </div>

      {/* Cartes statistiques globales */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
          <div className="flex items-start justify-between mb-2"><div className="h-9 w-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-sm"><Ico name="briefcase" size={18} className="text-white" /></div></div>
          <p className="text-xl font-bold text-slate-800">{filtered.length}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Employés permanents</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
          <div className="flex items-start justify-between mb-2"><div className="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white shadow-sm"><Ico name="paye" size={18} className="text-white" /></div></div>
          <p className="text-lg font-bold text-slate-800">{formatFCFA(T.totalBrut)}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Masse salariale brute {year}</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
          <div className="flex items-start justify-between mb-2"><div className="h-9 w-9 rounded-xl bg-gradient-to-br from-red-500 to-rose-500 flex items-center justify-center text-white shadow-sm"><Ico name="shield" size={18} className="text-white" /></div></div>
          <p className="text-lg font-bold text-slate-800">{formatFCFA(T.totalGeneral)}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Charges patronales {year} (Total général)</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
          <div className="flex items-start justify-between mb-2"><div className="h-9 w-9 rounded-xl bg-gradient-to-br from-sky-500 to-cyan-500 flex items-center justify-center text-white shadow-sm"><Ico name="calendar" size={18} className="text-white" /></div></div>
          <p className="text-lg font-bold text-slate-800">{formatFCFA(coutTotalEmployeur)}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Coût total employeur {year}</p>
        </div>
      </div>

      {/* ════ LIVRE DE PAIE FIN D'ANNÉE — permanents, colonnes salariales + patronales ════ */}
      <div className="bg-white rounded-2xl border border-orange-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 bg-orange-50 border-b border-orange-100">
          <h3 className="text-sm font-bold text-orange-800">Livre de paie en fin d'année — Permanents — Cumul {year}</h3>
          <p className="text-[11px] text-orange-600 mt-0.5">
            Reprend le "Livre de paie" mois par mois (Janvier → Décembre) et y ajoute les charges patronales : ISP 1,2% · FDFP (Taxe d'apprentissage 0,4% + Taxe FPC 1,2%) · Prestations familiales 5,75% &amp; accident du travail {parametresGeneraux.accidentTravailTauxPct}% (plaf. {formatFCFA(CHARGES_PATRONALES.prestationFamilialeBase)}, réglable dans "Charges sociales") · Caisse de retraite patronale 7,7% (plaf. {formatFCFA(CNPS_PLAFOND)})
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left livre-fin-annee-table">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70">
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase whitespace-nowrap">N°</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase whitespace-nowrap">Nom</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase whitespace-nowrap">Prénoms</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase text-right whitespace-nowrap">Salaire base (cumul)</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase text-right whitespace-nowrap">Sursalaire (cumul)</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase text-right whitespace-nowrap">Heure suppl. (cumul)</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase text-right whitespace-nowrap">Prime ancienneté (cumul)</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase text-right whitespace-nowrap">Prime fonction (cumul)</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-emerald-600 uppercase text-right whitespace-nowrap">Total brut annuel</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase text-right whitespace-nowrap">Brut imposable</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase text-right whitespace-nowrap">Brut social</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-red-500 uppercase text-right whitespace-nowrap">Impôts brut</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-red-500 uppercase text-right whitespace-nowrap">RICF</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-red-500 uppercase text-right whitespace-nowrap">ITS salariés</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-red-500 uppercase text-right whitespace-nowrap">CNPS salariés</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-red-500 uppercase text-right whitespace-nowrap">CNAM</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-red-500 uppercase text-right whitespace-nowrap">Prêts</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-slate-400 uppercase text-right whitespace-nowrap">Indem. transport</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-emerald-700 uppercase text-right whitespace-nowrap">Salaire net annuel</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-indigo-600 uppercase text-right whitespace-nowrap">ISP (1,2%)</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-indigo-600 uppercase text-right whitespace-nowrap">FDFP TA (0,4%)</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-indigo-600 uppercase text-right whitespace-nowrap">FDFP TCF (1,2%)</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-indigo-700 uppercase text-right whitespace-nowrap">Total impôt</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-purple-600 uppercase text-right whitespace-nowrap">Prest. familiales</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-purple-600 uppercase text-right whitespace-nowrap">Accident travail</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-purple-600 uppercase text-right whitespace-nowrap">Retraite patronale</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-purple-700 uppercase text-right whitespace-nowrap">Total CNPS patronal</th>
                <th className="px-2.5 py-2 text-[9px] font-bold text-orange-700 uppercase text-right whitespace-nowrap">TOTAL GÉNÉRAL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => {
                const { emp } = r;
                return (
                  <tr key={emp.id} className="hover:bg-orange-50/60 cursor-pointer"
                    onClick={() => setPayslip({ ...computeEmployeePayrollForPeriod(emp, months[11].start, decEnd), emp } as PayrollRow)}
                    title="Cliquez pour voir le bulletin de paie de décembre">
                    <td className="px-2.5 py-2 text-[11px] text-slate-500">{i + 1}</td>
                    <td className="px-2.5 py-2 text-[11px] font-semibold text-slate-700 whitespace-nowrap">{emp.lastName}</td>
                    <td className="px-2.5 py-2 text-[11px] text-slate-700 whitespace-nowrap">{emp.firstName}</td>
                    <LP_Td value={r.baseSalary} />
                    <LP_Td value={r.sursalaire} />
                    <LP_Td value={r.overtimePay} />
                    <LP_Td value={r.ancienneteAmount} />
                    <LP_Td value={r.primeFonction} />
                    <LP_Td value={r.totalBrut} bold colorClass="text-emerald-700" />
                    <LP_Td value={r.brutImposable} />
                    <LP_Td value={r.brutSocial} />
                    <LP_Td value={r.impotsBrut} colorClass="text-red-500" />
                    <LP_Td value={r.ricf} colorClass="text-red-500" />
                    <LP_Td value={r.its} colorClass="text-red-600" />
                    <LP_Td value={r.cnps} colorClass="text-red-500" />
                    <LP_Td value={r.cnam} colorClass="text-red-500" />
                    <LP_Td value={r.pret} colorClass="text-red-500" />
                    <LP_Td value={r.transport} />
                    <LP_Td value={r.netToPay} bold colorClass="text-emerald-700" />
                    <LP_Td value={r.isp} colorClass="text-indigo-600" />
                    <LP_Td value={r.fdfpTA} colorClass="text-indigo-600" />
                    <LP_Td value={r.fdfpTCF} colorClass="text-indigo-600" />
                    <LP_Td value={r.totalImpotPatronal} bold colorClass="text-indigo-700" />
                    <LP_Td value={r.prestationFamiliale} colorClass="text-purple-600" />
                    <LP_Td value={r.accidentTravail} colorClass="text-purple-600" />
                    <LP_Td value={r.cnpsPatronal} colorClass="text-purple-600" />
                    <LP_Td value={r.totalCnpsPatronal} bold colorClass="text-purple-700" />
                    <LP_Td value={r.totalGeneral} bold colorClass="text-orange-700" />
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={27} className="px-4 py-8 text-center text-xs text-slate-400">Aucun employé</td></tr>}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                <td colSpan={3} className="px-2.5 py-2.5 text-[11px] text-slate-700">TOTAUX</td>
                <LP_Td value={T.base} />
                <LP_Td value={T.sursalaire} />
                <LP_Td value={T.overtimePay} />
                <LP_Td value={T.anciennete} />
                <LP_Td value={T.primeFonction} />
                <LP_Td value={T.totalBrut} colorClass="text-emerald-700" />
                <LP_Td value={T.brutImposable} />
                <LP_Td value={T.brutSocial} />
                <LP_Td value={T.impotsBrut} colorClass="text-red-600" />
                <LP_Td value={T.ricf} colorClass="text-red-600" />
                <LP_Td value={T.its} colorClass="text-red-600" />
                <LP_Td value={T.cnps} colorClass="text-red-600" />
                <LP_Td value={T.cnam} colorClass="text-red-600" />
                <LP_Td value={T.pret} colorClass="text-red-600" />
                <LP_Td value={T.transport} />
                <LP_Td value={T.netToPay} colorClass="text-emerald-700" />
                <LP_Td value={T.isp} colorClass="text-indigo-600" />
                <LP_Td value={T.fdfpTA} colorClass="text-indigo-600" />
                <LP_Td value={T.fdfpTCF} colorClass="text-indigo-600" />
                <LP_Td value={T.totalImpotPatronal} colorClass="text-indigo-700" />
                <LP_Td value={T.prestationFamiliale} colorClass="text-purple-600" />
                <LP_Td value={T.accidentTravail} colorClass="text-purple-600" />
                <LP_Td value={T.cnpsPatronal} colorClass="text-purple-600" />
                <LP_Td value={T.totalCnpsPatronal} colorClass="text-purple-700" />
                <LP_Td value={T.totalGeneral} colorClass="text-orange-700" />
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="px-5 py-3 border-t border-orange-100 flex items-center justify-between bg-orange-50/40">
          <span className="text-[11px] text-slate-500">{filtered.length} employé(s) · Exercice {year}</span>
          <span className="text-xs font-bold text-slate-700">Coût total employeur {year} : {formatFCFA(coutTotalEmployeur)}</span>
        </div>
      </div>

      {/* Salariés non permanents (vacataires) — section de l'onglet Excel non reprise ici */}
      <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-[11px] text-slate-600 leading-relaxed">
        ℹ️ L'onglet Excel "LIVRE DE PAIE DÉCEMBRE 2025" comporte aussi un second tableau <b>"Salariés non permanents"</b> (vacataires payés à la tâche, imposés forfaitairement à 7,5% — NCC, Nom, Activité, Référence, Montant, Retenue). L'application ne gère aujourd'hui que les employés permanents du module "Employés" : dites-moi si vous voulez que j'ajoute une gestion dédiée aux vacataires pour compléter ce module.
      </div>

      {/* Note légale / avertissement */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-[11px] text-amber-800 leading-relaxed">
        ⚠ Montants cumulés mois par mois à partir de la <b>saisie manuelle</b> (comme dans "Paie") ; pour un mois sans aucune saisie, le calcul retombe par défaut sur le salaire de base. Le plafond CNPS ({formatFCFA(CNPS_PLAFOND)}) est appliqué mois par mois, conformément à la réglementation. Faites valider ces montants par un expert-comptable ou directement auprès de la DGI / CNPS / FDFP avant toute déclaration de fin d'année.
      </div>

      {/* Fiche de paie (bulletin de décembre) */}
      {payslip && <PaySlipModal row={payslip} periodStart={months[11].start} periodEnd={decEnd} onClose={() => setPayslip(null)} />}
    </div>
  );
}



/* ══════════════════════════════════════════════════════ */
/* MAIN APP                                               */
/* ══════════════════════════════════════════════════════ */


// ── Persistance Firestore ──
// Chaque type de donnée (employés, présences, congés, sites, comptes) est stocké
// dans SA PROPRE collection Firestore, avec UN DOCUMENT PAR ENREGISTREMENT (id du
// document = id de l'employé/présence/congé/site, ou nom d'utilisateur pour les
// comptes). Cela évite qu'une sauvegarde écrase par erreur les changements d'un
// autre appareil/utilisateur — contrairement à un unique "gros document" partagé.
//
// "page" et "currentUser" (session en cours) restent en localStorage : ce sont des
// informations propres à CET appareil/navigateur, pas des données à synchroniser.

function sanitizeForFirestore<T>(obj: T): T {
  // Firestore refuse les valeurs "undefined" — on les retire proprement avant écriture
  return JSON.parse(JSON.stringify(obj));
}

function persistDoc(collectionName: string, id: string, data: unknown) {
  setDoc(doc(db, collectionName, id), sanitizeForFirestore(data))
    .catch(err => console.error(`Erreur de sauvegarde Firestore (${collectionName}/${id}) :`, err));
}

function removeDoc(collectionName: string, id: string) {
  deleteDoc(doc(db, collectionName, id))
    .catch(err => console.error(`Erreur de suppression Firestore (${collectionName}/${id}) :`, err));
}

// Charge une collection dans le tableau module correspondant. Si la collection est
// vide ET qu'on lui fournit des données de démonstration, on l'amorce UNE SEULE FOIS
// (suivi via un document "_meta/<collection>") — pour ne jamais réinjecter les
// données de démo si un client a volontairement tout supprimé plus tard.
async function loadCollectionInto<T extends { id: string }>(collectionName: string, target: T[], seed: T[]) {
  const colRef = collection(db, collectionName);
  if (seed.length) {
    const metaRef = doc(db, '_meta', collectionName);
    const metaSnap = await getDoc(metaRef);
    if (!metaSnap.exists()) {
      const batch = writeBatch(db);
      seed.forEach(item => batch.set(doc(db, collectionName, item.id), sanitizeForFirestore(item)));
      batch.set(metaRef, { seeded: true });
      await batch.commit();
    }
  }
  const snap = await getDocs(colRef);
  target.length = 0;
  snap.docs.forEach(d => target.push(d.data() as T));
}

// Cas particulier "users" : la clé du document Firestore est le username (pas de champ "id")
async function loadUsersCollection(target: AuthUser[]) {
  const snap = await getDocs(collection(db, 'users'));
  target.length = 0;
  snap.docs.forEach(d => target.push(d.data() as AuthUser));
}

async function loadAllFromFirestore() {
  await ensureAnonymousAuth();
  await Promise.all([
    loadCollectionInto('employees', employees, employees.slice()),
    loadCollectionInto('payrollOverrides', payrollOverrides, payrollOverrides.slice()),
    loadCollectionInto('sites', sites, sites.slice()),
    loadUsersCollection(registeredUsers),
    loadParametresGeneraux(),
  ]);
}

// ── État d'interface local (session courante) : localStorage, propre à l'appareil ──
const UI_STORAGE_KEY = 'garagerh_ui_v1';

function loadUiState(): { page: string; currentUser: AuthUser | null } | null {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveUiState(state: { page: string; currentUser: AuthUser | null }) {
  try { localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

// Écran affiché pendant la connexion initiale à Firebase / le chargement des données
function LoadingScreen({ error }: { error?: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="text-center">
        <div className="h-16 w-28 rounded-2xl bg-white flex items-center justify-center shadow-lg mx-auto mb-5 overflow-hidden p-2">
          <img src={logo} alt="I.P & D Sarl" className="h-full w-full object-contain" />
        </div>
        {!error ? (
          <>
            <div className="h-8 w-8 border-3 border-orange-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-sm text-slate-300">Connexion à Gestion RH-Paie…</p>
          </>
        ) : (
          <div className="max-w-sm px-6">
            <p className="text-sm text-red-400 font-semibold mb-1">Connexion impossible</p>
            <p className="text-xs text-slate-400">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Composant racine : initialise Firebase (auth anonyme) puis charge les données
// avant d'afficher l'application (le chargement Firestore est asynchrone,
// contrairement à l'ancien localStorage qui était instantané).
export default function App() {
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    loadAllFromFirestore()
      .then(() => { if (!cancelled) setReady(true); })
      .catch(err => {
        console.error('Erreur d\'initialisation Firebase :', err);
        if (!cancelled) setInitError("Impossible de se connecter au serveur. Vérifiez votre connexion internet et réessayez.");
      });
    return () => { cancelled = true; };
  }, []);

  if (initError) return <LoadingScreen error={initError} />;
  if (!ready) return <LoadingScreen />;
  return <AppShell />;
}

// Filet de sécurité : si UNE page plante (ex. donnée incomplète non prévue), elle seule
// affiche un message d'erreur — le reste de l'application (menu, autres pages déjà ouvertes)
// continue de fonctionner normalement, au lieu d'un écran blanc général.
class PageErrorBoundary extends Component<
  { pageName: string; children: any }, { error: Error | null }
> {
  constructor(props: { pageName: string; children: any }) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: any) { console.error(`Erreur dans la page "${this.props.pageName}" :`, error, info); }
  render() {
    if (this.state.error) {
      return (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
          <p className="text-sm font-bold text-red-700 mb-1">Cette page a rencontré un problème et n'a pas pu s'afficher.</p>
          <p className="text-xs text-red-600 mb-3">{this.state.error.message}</p>
          <button onClick={() => this.setState({ error: null })}
            className="px-4 py-2 text-xs font-semibold bg-red-600 text-white rounded-xl hover:bg-red-700">
            Réessayer
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppShell() {
  const savedUi = loadUiState();
  const [page, setPage] = useState(savedUi?.page || 'dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(savedUi?.currentUser || null);

  // Version globale des données : incrémentée à chaque ajout/modification/suppression
  // n'importe où dans l'application (employé, site, saisie de paie...), pour que toutes les
  // pages déjà ouvertes se recalculent et se mettent à jour immédiatement, sans avoir à
  // rafraîchir le navigateur.
  const [dataVersion, setDataVersion] = useState(0);
  const bump = () => setDataVersion(v => v + 1);

  // Sauvegarde locale (cet appareil) à chaque changement de page / utilisateur
  useEffect(() => {
    saveUiState({ page, currentUser });
  }, [page, currentUser]);

  // Si la page est rechargée alors que l'utilisateur était déjà connecté
  // (session restaurée depuis le stockage local), on ouvre une nouvelle
  // session RISE Presence pour refléter cette reprise de connexion.
  useEffect(() => {
    if (currentUser) void startRiseSession({ username: currentUser.username, role: currentUser.role });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = (user: AuthUser) => {
    setCurrentUser(user);
    void startRiseSession({ username: user.username, role: user.role });
  };

  const handleLogout = () => {
    void endRiseSession();
    setCurrentUser(null);
    setSearch('');
    setPage('dashboard');
    setMobileOpen(false);
  };

  const titles: Record<string, string> = {
    dashboard: 'Tableau de bord',
    sites: 'Gestion des sites',
    employees: 'Gestion des employés',
    paye: 'Paie & Salaires',
    reconstitution: 'Reconstitution du salaire de base',
    'livre-fin-annee': "Livre de paie — Fin d'année",
    'cs-mensuelles': 'Charges sociales mensuelles',
    'cs-semestrielles': 'Charges sociales semestrielles',
    'cs-annuelles': 'Charges sociales annuelles',
  };

  const filtered = useMemo(() => {
    // .slice() : renvoie toujours une NOUVELLE référence de tableau, même quand la recherche
    // est vide, afin que les pages qui dépendent de "filtered" (via useMemo) détectent bien
    // le changement à chaque bump() — sans ça, certaines pages ne se rafraîchissaient pas.
    if (!search) return employees.slice();
    const q = search.toLowerCase();
    return employees.filter(e => `${e.firstName} ${e.lastName} ${e.position} ${e.department} ${e.email}`.toLowerCase().includes(q));
  }, [search, dataVersion]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [exportModalPage, setExportModalPage] = useState<string | null>(null);

  const onAction = (action: string) => {
    switch (action) {
      case 'save': alert('Toutes les données sont déjà enregistrées automatiquement et en temps réel sur le serveur — aucune action manuelle nécessaire.'); break;
      case 'print':
        if (exportRegistry[page]) { setExportModalPage(page); break; }
        window.print();
        break;
      case 'import':
        if (page !== 'employees') { alert('L\'import concerne la liste des employés — rendez-vous sur le menu "Employés".'); break; }
        fileInputRef.current?.click();
        break;
      case 'export':
        if (!exportRegistry[page]) { alert('L\'export n\'est pas encore disponible sur cette page.'); break; }
        setExportModalPage(page);
        break;
    }
  };

  async function handleImportFile(file: File) {
    setImportBusy(true);
    try {
      const { created, updated, errors } = await importEmployeesCSV(file);
      bump();
      let msg = `Import terminé : ${created} employé(s) créé(s), ${updated} mis à jour.`;
      if (errors.length) msg += `\n\n${errors.length} ligne(s) ignorée(s) :\n` + errors.slice(0, 10).join('\n');
      alert(msg);
    } catch (err) {
      alert('Erreur lors de l\'import : ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setImportBusy(false);
    }
  }

  /* ── Page de connexion ── */
  if (!currentUser) {
    return <LoginPage onLogin={handleLogin} />;
  }

  /* ── App principale ── */
  return (
    <DataVersionContext.Provider value={{ version: dataVersion, bump }}>
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar
        page={page}
        setPage={setPage}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
        currentUser={currentUser}
        onLogout={handleLogout}
      />
      <main className="flex-1 lg:ml-60 min-h-screen">
        <input ref={fileInputRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }}
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) void handleImportFile(file);
            e.target.value = ''; // permet de réimporter le même fichier plus tard si besoin
          }} />
        {importBusy && (
          <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center">
            <div className="bg-white rounded-2xl px-6 py-4 shadow-xl text-sm font-semibold text-slate-700">Import en cours…</div>
          </div>
        )}
        {exportModalPage && exportRegistry[exportModalPage] && (
          <ExportModal
            title={exportRegistry[exportModalPage].title}
            columns={exportRegistry[exportModalPage].columns}
            buildRows={exportRegistry[exportModalPage].buildRows}
            onClose={() => setExportModalPage(null)}
            onPrint={(hidden) => applyPrintColumnFilter(exportRegistry[exportModalPage!].tableClass, exportRegistry[exportModalPage!].columns.map(c => c.key), hidden)}
          />
        )}
        <TopBar
          title={titles[page]}
          setMobileOpen={setMobileOpen}
          search={search}
          setSearch={setSearch}
          onAction={onAction}
        />
        {/*
          Chaque page reste montée en permanence (juste masquée en CSS via display:none quand
          elle n'est pas active) au lieu d'être détruite/recréée à chaque changement de menu.
          Sans cela, les filtres, la période sélectionnée, la recherche ou le bulletin ouvert
          dans une page étaient perdus dès qu'on la quittait puis y revenait.
        */}
        <div className="p-4 lg:p-6 max-w-[1400px] mx-auto">
          <div style={{ display: page === 'dashboard' ? 'block' : 'none' }}><PageErrorBoundary pageName="Tableau de bord"><DashboardPage filtered={filtered} /></PageErrorBoundary></div>
          <div style={{ display: page === 'sites' ? 'block' : 'none' }}><PageErrorBoundary pageName="Sites"><SitesPage search={search} /></PageErrorBoundary></div>
          <div style={{ display: page === 'employees' ? 'block' : 'none' }}><PageErrorBoundary pageName="Employés"><EmployeesPage filtered={filtered} /></PageErrorBoundary></div>
          <div style={{ display: page === 'paye' ? 'block' : 'none' }}><PageErrorBoundary pageName="Paie"><PayePage filtered={filtered} /></PageErrorBoundary></div>
          <div style={{ display: page === 'reconstitution' ? 'block' : 'none' }}><PageErrorBoundary pageName="Reconstitution"><ReconstitutionPage filtered={filtered} /></PageErrorBoundary></div>
          <div style={{ display: page === 'livre-fin-annee' ? 'block' : 'none' }}><PageErrorBoundary pageName="Livre de paie — Fin d'année"><LivreFinAnneePage filtered={filtered} /></PageErrorBoundary></div>
          <div style={{ display: page === 'cs-mensuelles' ? 'block' : 'none' }}><PageErrorBoundary pageName="Charges sociales mensuelles"><SocialChargesPage filtered={filtered} mode="month" periodLabel="Mensuelles" /></PageErrorBoundary></div>
          <div style={{ display: page === 'cs-semestrielles' ? 'block' : 'none' }}><PageErrorBoundary pageName="Charges sociales semestrielles"><SocialChargesPage filtered={filtered} mode="semester" periodLabel="Semestrielles" /></PageErrorBoundary></div>
          <div style={{ display: page === 'cs-annuelles' ? 'block' : 'none' }}><PageErrorBoundary pageName="Charges sociales annuelles"><SocialChargesPage filtered={filtered} mode="year" periodLabel="Annuelles" /></PageErrorBoundary></div>
        </div>
      </main>
    </div>
    </DataVersionContext.Provider>
  );
}
