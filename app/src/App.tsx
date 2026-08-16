import { useState, useMemo, useEffect } from 'react';
import { collection, doc, getDoc, getDocs, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { db, ensureAnonymousAuth } from './lib/firebase';
import logo from './assets/logo.jpg';
import { sites, employees, leaves, presences, computeSalary, OVERTIME_RATES, emptyOvertime, type Employee, type Site, type Leave, type Presence, type SalaryComponents, type OvertimeHours } from './data/mockData';

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
            <h1 className="text-3xl font-black text-white leading-tight mb-3">GarageRH</h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              Accès sécurisé à l'application de gestion RH pour garage automobile.
              Connectez-vous ou créez votre compte lors de la première utilisation.
            </p>

            {/* Encadré info */}
            <div className="mt-8 rounded-xl border border-slate-600/50 bg-slate-700/30 p-4">
              <p className="text-xs text-slate-300 leading-relaxed">
                {forgotMode
                  ? <><span className="font-bold text-white">Mot de passe oublié :</span> répondez à votre question de sécurité pour définir un nouveau mot de passe.</>
                  : <><span className="font-bold text-white">Première utilisation :</span> créez votre compte avec un identifiant, un mot de passe et votre fonction. Aucun compte n'est pré-enregistré.</>}
              </p>
            </div>
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
const formatFCFA = (n: number) => n.toLocaleString('fr-FR') + ' FCFA';

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
    { key: 'presence', label: 'Présences', icon: 'presence' },
    { key: 'leave', label: 'Congés', icon: 'leave' },
    { key: 'paye', label: 'Paie', icon: 'paye' },
    {
      key: 'charges-sociales', label: 'Charges sociales', icon: 'shield', children: [
        { key: 'cs-mensuelles', label: 'C.S mensuelles' },
        { key: 'cs-semestrielles', label: 'C.S semestrielles' },
        { key: 'cs-annuelles', label: 'C.S annuelles' },
      ]
    },
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
            <h1 className="text-sm font-bold text-slate-800 leading-tight">GarageRH</h1>
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

function formatMoney(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + ' M FCFA';
  if (n >= 1000) return Math.round(n / 1000).toFixed(0) + ' K FCFA';
  return n.toLocaleString() + ' FCFA';
}

/* ══════════════════════════════════════════════════════ */
/* PRESENCE STATUS BADGE                                 */
/* ══════════════════════════════════════════════════════ */

const presenceStyles: Record<string, { bg: string; text: string; border: string; icon: string }> = {
  'Présent':   { bg: 'bg-green-50',     text: 'text-green-700', border: 'border-green-200',  icon: 'checkmark' },
  'Absent':    { bg: 'bg-red-50',       text: 'text-red-700',   border: 'border-red-200',    icon: 'cross' },
  'Congé':     { bg: 'bg-yellow-50',    text: 'text-yellow-700',border: 'border-yellow-200', icon: 'palm' },
  'Maladie':   { bg: 'bg-purple-50',    text: 'text-purple-700',border: 'border-purple-200', icon: 'smiley' },
  'Formation': { bg: 'bg-blue-50',      text: 'text-blue-700',  border: 'border-blue-200',  icon: 'books' },
  'Non saisi': { bg: 'bg-gray-50',      text: 'text-gray-600',  border: 'border-gray-200',  icon: 'question' },
};

function PresenceBadge({ status, onClick, selected, disabled }: { status: Presence['status']; onClick: () => void; selected?: boolean; disabled?: boolean }) {
  const s = presenceStyles[status] || presenceStyles['Non saisi'];
  return (
    <button onClick={onClick} disabled={disabled}
      className={cn('inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-semibold border transition-all',
        s.bg, s.text, s.border,
        disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer',
        selected ? 'shadow-md ring-2 ring-offset-1 ring-orange-300 scale-105' : (!disabled && 'hover:shadow-sm'))}>
      <Ico name={s.icon} size={13} />
      {status}
    </button>
  );
}

function PresenceStatusCard({ label, count, color, icon }: { label: string; count: number; color: string; icon: string }) {
  const bgMap: Record<string, { bg: string; border: string; text: string; iconBg: string }> = {
    green: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-800', iconBg: 'bg-green-100' },
    red:   { bg: 'bg-red-50',   border: 'border-red-200',   text: 'text-red-800',   iconBg: 'bg-red-100' },
    yellow:{ bg: 'bg-yellow-50', border: 'border-yellow-200',text: 'text-yellow-800', iconBg: 'bg-yellow-100' },
    purple:{ bg: 'bg-purple-50', border: 'border-purple-200',text: 'text-purple-800', iconBg: 'bg-purple-100' },
    blue:  { bg: 'bg-blue-50',  border: 'border-blue-200',  text: 'text-blue-800',  iconBg: 'bg-blue-100' },
    gray:  { bg: 'bg-gray-50',  border: 'border-gray-200',  text: 'text-gray-700',  iconBg: 'bg-gray-200' },
  };
  const c = bgMap[color] || bgMap.gray;

  return (
    <div className={cn('rounded-2xl border p-4 min-w-[120px]', c.bg, c.border)}>
      <div className={cn('h-10 w-10 rounded-xl flex items-center justify-center mb-2', c.iconBg)}>
        <Ico name={icon} size={22} className={c.text.replace('800','')} />
      </div>
      <p className={cn('text-lg font-extrabold', c.text)}>{count}</p>
      <p className={cn('text-[11px] font-medium', c.text, 'opacity-80')}>{label}</p>
    </div>
  );
}


/* ══════════════════════════════════════════════════════ */
/* PAGE: DASHBOARD                                        */
/* ══════════════════════════════════════════════════════ */

function DashboardPage({ filtered }: { filtered: Employee[] }) {
  const acts = filtered.filter((e) => e.status === 'Actif').length;
  const leaveCount = leaves.filter((l) => l.status === 'En attente').length;
  const inLeave = employees.filter((e) => e.status === 'En congé').length;
  const totalSalary = filtered.reduce((acc, e) => acc + e.salary, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Employés actifs" value={acts} sub={`${filtered.length} au total`} icon="employees" color="indigo" />
        <StatCard label="Sites actifs" value={sites.length} sub={`${sites.length} localisations`} icon="sites" color="violet" />
        <StatCard label="Demandes de congés" value={leaveCount} sub={`${inLeave} en congé`} icon="leave" color="amber" />
        <StatCard label="Masse salariale totale" value={formatMoney(totalSalary)} sub={`Mensuel`} icon="paye" color="emerald" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <h3 className="text-sm font-bold text-slate-800 mb-4">Employés par département</h3>
          <div className="space-y-3">
            {['Mécanique', 'Administration', 'Finance', 'Carrosserie', 'Magasin', 'Direction'].map((dept) => {
              const count = filtered.filter((e) => e.department === dept).length;
              const pct = filtered.length ? Math.round((count / filtered.length) * 100) : 0;
              const colors: Record<string, string> = { Mécanique: '#6366f1', Administration: '#f59e0b', Finance: '#10b981', Carrosserie: '#8b5cf6', Magasin: '#ec4899', Direction: '#e11d48' };
              return (<div key={dept}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-600">{dept}</span>
                  <span className="text-[11px] font-semibold text-slate-700">{count} <span className="text-slate-400">({pct}%)</span></span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: colors[dept] || '#94a3b8' }} />
                </div>
              </div>);
            })}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <h3 className="text-sm font-bold text-slate-800 mb-4">Derniers congés</h3>
          <div className="space-y-3">
            {leaves.slice(0, 4).map((l) => {
              const emp = employees.find((e) => e.id === l.employeeId);
              if (!emp) return null;
              return (
                <div key={l.id} className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <Avatar emp={emp} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-700 truncate">{emp.firstName} {emp.lastName}</p>
                    <p className="text-[10px] text-slate-400">{l.type}</p>
                  </div>
                  <StatusBadge status={l.status} />
                </div>
              );
            })}
          </div>
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

const emptyComponents = (): SalaryComponents => ({ baseSalary: 0, sursalaire: 0, seniority: 0, housing: 0, transport: 0, representation: 0, responsibility: 0, performance: 0, boisson: 0, other: 0 });

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

// Bloc complet des rubriques de paie (réutilisé add/edit)
function SalaryComponentsForm({ comp, onChange }: { comp: SalaryComponents; onChange: (c: SalaryComponents) => void }) {
  const total = computeSalary(comp);
  const set = (k: keyof SalaryComponents, v: number) => onChange({ ...comp, [k]: v });
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 space-y-2">
      <p className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
        <Ico name="paye" size={13} className="text-orange-500" /> Rubriques de paie
      </p>
      <div className="space-y-2 bg-white rounded-lg p-3 border border-slate-100">
        <SalaryLine label="Salaire de base / échelon" value={comp.baseSalary} onChange={(v) => set('baseSalary', v)} />
        <SalaryLine label="Sursalaire" value={comp.sursalaire} onChange={(v) => set('sursalaire', v)} />
        <SalaryLine label="Prime d'ancienneté" value={comp.seniority} onChange={(v) => set('seniority', v)} />
        <SalaryLine label="Indemnité de logement" value={comp.housing} onChange={(v) => set('housing', v)} />
        <SalaryLine label="Indemnité de transport" value={comp.transport} onChange={(v) => set('transport', v)} />
        <SalaryLine label="Indemnité de représentation" value={comp.representation} onChange={(v) => set('representation', v)} />
        <SalaryLine label="Prime de responsabilité" value={comp.responsibility} onChange={(v) => set('responsibility', v)} />
        <SalaryLine label="Prime de rendement" value={comp.performance} onChange={(v) => set('performance', v)} />
        <SalaryLine label="Prime de boisson" value={comp.boisson} onChange={(v) => set('boisson', v)} />
        <SalaryLine label="Autres primes" value={comp.other} onChange={(v) => set('other', v)} />
      </div>
      <div className="flex items-center justify-between px-1 pt-1">
        <span className="text-xs font-bold text-slate-700">SALAIRE BRUT TOTAL</span>
        <span className="text-sm font-extrabold text-orange-600">{formatFCFA(total)}</span>
      </div>
    </div>
  );
}

// Bloc commun : statut professionnel, catégorie, infos administratives & logo
function EmployeeExtraFields({ form, setForm, onLogo }: {
  form: Partial<Employee>; setForm: (f: Partial<Employee>) => void; onLogo: (file: File | undefined) => void;
}) {
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
      <div className="grid grid-cols-2 gap-3">
        <InputField label="Situation familiale" value={form.familySituation || ''} onChange={v => setForm({ ...form, familySituation: v })} placeholder="Marié(e)" />
        <InputField label="Nombre de parts" type="number" value={form.parts ?? 1} onChange={v => setForm({ ...form, parts: Number(v) })} />
      </div>
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

  function openAdd() {
    setForm({ firstName: '', lastName: '', email: '', phone: '', position: '', department: '', siteId: '', contractType: 'CDI', startDate: new Date().toISOString().split('T')[0], status: 'Actif', professionalStatus: 'Ouvrier', category: '', matricule: '', cnpsNumber: '', parts: 1, familySituation: 'Célibataire', logoUrl: '', avatarColor: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0') });
    setComp(emptyComponents());
    setModal(true);
  }

  function doAdd() {
    const newEmp: Employee = {
      id: `e${Date.now()}`, firstName: form.firstName!, lastName: form.lastName!, email: form.email!, phone: form.phone!,
      position: form.position!, department: form.department!, siteId: form.siteId!, contractType: form.contractType! as Employee['contractType'],
      startDate: form.startDate!, components: comp, salary: computeSalary(comp), status: form.status! as Employee['status'],
      professionalStatus: (form.professionalStatus as Employee['professionalStatus']) || 'Ouvrier', category: form.category || '',
      matricule: form.matricule, cnpsNumber: form.cnpsNumber, parts: form.parts, familySituation: form.familySituation, logoUrl: form.logoUrl,
      avatarColor: form.avatarColor!,
    };
    employees.push(newEmp);
    persistDoc('employees', newEmp.id, newEmp);
    setModal(false);
  }

  function openEdit(emp: Employee) {
    setForm({ ...emp });
    setComp({ ...emp.components });
    setEditModal(emp);
  }
  function doEdit() {
    if (!editModal) return;
    Object.assign(editModal, form, { components: comp, salary: computeSalary(comp) });
    persistDoc('employees', editModal.id, editModal);
    setEditModal(null);
  }

  // Import du logo (data URL)
  function handleLogoUpload(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm(f => ({ ...f, logoUrl: reader.result as string }));
    reader.readAsDataURL(file);
  }
  function handleDelete(id: string) { if (confirm('Supprimer cet employé ?')) { const i = employees.findIndex(e => e.id === id); if (i >= 0) employees.splice(i, 1); removeDoc('employees', id); } }

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
          <table className="w-full text-left">
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
          <SalaryComponentsForm comp={comp} onChange={setComp} />
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
          <SalaryComponentsForm comp={comp} onChange={setComp} />
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
  const [addModal, setAddModal] = useState(false);
  const [editModal, setEditModal] = useState<Site | null>(null);
  const [mForm, setMForm] = useState<Partial<Site>>({});

  function saveNew() {
    const ns: Site = { id:`s${Date.now()}`, name:mForm.name||'', address:mForm.address||'', city:mForm.city||'', phone:mForm.phone||'', manager:mForm.manager||'', capacity:Number(mForm.capacity)||10 };
    sites.push(ns); persistDoc('sites', ns.id, ns); setAddModal(false);
  }
  function saveEdit() {
    if(!editModal)return;Object.assign(editModal,mForm);persistDoc('sites', editModal.id, editModal);setEditModal(null);
  }

  const q = search.trim().toLowerCase();
  const sitesList = q ? sites.filter(s => `${s.name} ${s.address} ${s.city} ${s.manager} ${s.phone}`.toLowerCase().includes(q)) : sites;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{sitesList.length} site(s)</p>
        <button onClick={()=>{setMForm({capacity:10});setAddModal(true)}} className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white text-xs font-semibold rounded-xl shadow-sm shadow-orange-200">
          <Ico name="plus" size={15} /> Ajouter un site
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {sitesList.map(s=>{
          const cnt = employees.filter(e=>e.siteId===s.id).length;
          return <div key={s.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 hover:shadow-md transition-all group cursor-pointer" onClick={()=>{setMForm({...s});setEditModal(s);}}>
            <div className="flex items-start justify-between mb-3">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-orange-100 to-orange-200 flex items-center justify-center text-orange-600"><Ico name="sites" size={20}/></div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e=>e.stopPropagation()}>
                <button onClick={()=>{setMForm({...s});setEditModal(s)}} className="p-1.5 text-slate-400 hover:text-orange-600 rounded-lg hover:bg-orange-50"><Ico name="edit" size={13}/></button>
                <button onClick={()=>{if(confirm('Supprimer ce site ?')){const i=sites.findIndex(x=>x.id===s.id);if(i>=0)sites.splice(i,1);removeDoc('sites', s.id);}}} className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50"><Ico name="trash" size={13}/></button>
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
          <button onClick={saveNew} className="w-full py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 text-white text-xs font-bold rounded-xl">Enregistrer</button>
        </div>
      </Modal>

      <Modal open={!!editModal} onClose={()=>setEditModal(null)} title="Modifier le site">
        <div className="space-y-3">
          <InputField label="Nom du site" value={mForm.name||''} onChange={v=>setMForm({...mForm,name:v})}/>
          <div className="grid grid-cols-2 gap-3"><InputField label="Adresse" value={mForm.address||''} onChange={v=>setMForm({...mForm,address:v})}/><InputField label="Ville" value={mForm.city||''} onChange={v=>setMForm({...mForm,city:v})}/></div>
          <div className="grid grid-cols-2 gap-3"><InputField label="Téléphone" value={mForm.phone||''} onChange={v=>setMForm({...mForm,phone:v})}/><InputField label="Responsable" value={mForm.manager||''} onChange={v=>setMForm({...mForm,manager:v})}/></div>
          <InputField label="Capacité" type="number" value={mForm.capacity||10} onChange={v=>setMForm({...mForm,capacity:Number(v)})}/>
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
/* PAGE: PRÉSENCES                                         */
/* ══════════════════════════════════════════════════════ */

// Vérifie si un employé est en congé ACCEPTÉ à une date donnée
function isOnAcceptedLeave(employeeId: string, date: string): boolean {
  return leaves.some(l =>
    l.employeeId === employeeId &&
    l.status === 'Accepté' &&
    date >= l.startDate && date <= l.endDate
  );
}

function PresencePage({ search }: { search: string }) {
  const today = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedSite, setSelectedSite] = useState('all');
  const [selectedEmpId, setSelectedEmpId] = useState<string | null>(null);
  const [pForm, setPForm] = useState<{
    status: Presence['status'];
    justification: 'Justifié' | 'Non justifié';
    duree: number;
    overtime: OvertimeHours;
    notes: string;
  }>({ status: 'Non saisi', justification: 'Non justifié', duree: 1, overtime: emptyOvertime(), notes: '' });
  const [tick, setTick] = useState(0); // force re-render
  const refresh = () => setTick(t => t + 1);

  // Période récapitulatif
  const [periodStart, setPeriodStart] = useState('2025-06-02');
  const [periodEnd, setPeriodEnd] = useState('2025-06-04');
  const [showPeriod, setShowPeriod] = useState(false);

  // Synchronise automatiquement les congés acceptés vers les présences
  const syncLeavesToPresences = () => {
    leaves.filter(l => l.status === 'Accepté').forEach(l => applyAcceptedLeaveToPresences(l));
  };
  // Exécuter une fois au montage
  useMemo(() => { syncLeavesToPresences(); }, []);

  const q = search.trim().toLowerCase();
  let displayEmps = selectedSite === 'all' ? employees : employees.filter(e => e.siteId === selectedSite);
  if (q) {
    displayEmps = displayEmps.filter(e => {
      const site = sites.find(s => s.id === e.siteId);
      return `${e.firstName} ${e.lastName} ${e.position} ${e.department} ${e.email} ${site?.name || ''}`.toLowerCase().includes(q);
    });
  }

  const getPresence = (employeeId: string): Presence | null =>
    presences.find(p => p.employeeId === employeeId && p.date === selectedDate) || null;

  // Récupère les heures sup d'une présence (compat. ancien champ heuresSup => h15)
  const getOvertime = (p: Presence | null | undefined): OvertimeHours => {
    if (!p) return emptyOvertime();
    if (p.overtime) return p.overtime;
    return { ...emptyOvertime(), h15: p.heuresSup || 0 };
  };
  const sumOvertime = (o: OvertimeHours): number => o.h15 + o.h50 + o.h75 + o.h100 + o.h200;

  // Daily counts
  const counts: Record<string, number> = { 'Présent': 0, 'Absent': 0, 'Congé': 0, 'Maladie': 0, 'Formation': 0, 'Non saisi': 0 };
  displayEmps.forEach(emp => { const p = getPresence(emp.id); counts[p ? p.status : 'Non saisi']++; });

  const setStatus = (empId: string, status: Presence['status']) => {
    let p = getPresence(empId);
    if (p) { p.status = status; }
    else { p = { id: `pr${Date.now()}-${empId}`, employeeId: empId, date: selectedDate, status }; presences.push(p); }
    return p;
  };

  const openPresenceEdit = (empId: string, presetStatus?: Presence['status']) => {
    let p = getPresence(empId);
    if (presetStatus) p = setStatus(empId, presetStatus);
    if (!p) p = setStatus(empId, 'Non saisi');
    setPForm({
      status: p.status,
      justification: p.justification || 'Non justifié',
      duree: p.duree || 1,
      overtime: getOvertime(p),
      notes: p.notes || '',
    });
    setSelectedEmpId(empId);
    refresh();
  };

  const savePresence = () => {
    if (!selectedEmpId) return;
    let p = getPresence(selectedEmpId);
    if (!p) p = setStatus(selectedEmpId, pForm.status);
    p.status = pForm.status;
    p.overtime = { ...pForm.overtime };
    p.heuresSup = undefined;
    p.notes = pForm.notes;
    // Conditional fields
    if (pForm.status === 'Absent' || pForm.status === 'Maladie') { p.justification = pForm.justification; p.duree = undefined; }
    else if (pForm.status === 'Congé' || pForm.status === 'Formation') { p.duree = pForm.duree; p.justification = undefined; }
    else { p.justification = undefined; p.duree = undefined; }
    persistDoc('presences', p.id, p);
    setSelectedEmpId(null);
    refresh();
  };

  const allStatuses: Presence['status'][] = ['Présent', 'Absent', 'Congé', 'Maladie', 'Formation', 'Non saisi'];
  const needsJustification = pForm.status === 'Absent' || pForm.status === 'Maladie';
  const needsDuree = pForm.status === 'Congé' || pForm.status === 'Formation';

  // ── PÉRIODE : récapitulatif ──
  const datesInPeriod = useMemo(() => {
    const dates: string[] = [];
    const start = new Date(periodStart); const end = new Date(periodEnd);
    if (start > end) return dates;
    const d = new Date(start);
    while (d <= end) { dates.push(d.toISOString().split('T')[0]); d.setDate(d.getDate() + 1); }
    return dates;
  }, [periodStart, periodEnd, tick]);

  const periodSummary = useMemo(() => {
    return displayEmps.map(emp => {
      const rec = { 'Présent': 0, 'Absent': 0, 'Congé': 0, 'Maladie': 0, 'Formation': 0, 'Non saisi': 0, absNonJust: 0, absJust: 0, heuresSup: 0 };
      datesInPeriod.forEach(date => {
        const p = presences.find(pr => pr.employeeId === emp.id && pr.date === date);
        const st = p ? p.status : 'Non saisi';
        rec[st]++;
        if (p) {
          rec.heuresSup += sumOvertime(getOvertime(p));
          if (p.status === 'Absent') { if (p.justification === 'Non justifié') rec.absNonJust++; else rec.absJust++; }
        }
      });
      return { emp, ...rec };
    });
  }, [displayEmps, datesInPeriod, tick]);

  const selectedEmp = selectedEmpId ? employees.find(e => e.id === selectedEmpId) : null;

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-600">Date :</label>
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-300" />
        </div>
        <select value={selectedSite} onChange={(e) => setSelectedSite(e.target.value)}
          className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-300">
          <option value="all">Tous les sites</option>
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        {/* Période récap */}
        <div className="ml-auto flex flex-wrap items-center gap-2 border-l border-slate-200 pl-4">
          <span className="text-[11px] font-semibold text-slate-500 uppercase">Récapitulatif période :</span>
          <span className="text-[10px] text-slate-400">Du</span>
          <input type="date" value={periodStart} onChange={(e) => { setPeriodStart(e.target.value); setShowPeriod(true); }}
            className="px-2 py-1.5 text-[11px] border border-slate-200 rounded-lg bg-slate-50 focus:ring-2 focus:ring-orange-300" />
          <span className="text-[10px] text-slate-400">Au</span>
          <input type="date" value={periodEnd} onChange={(e) => { setPeriodEnd(e.target.value); setShowPeriod(true); }}
            className="px-2 py-1.5 text-[11px] border border-slate-200 rounded-lg bg-slate-50 focus:ring-2 focus:ring-orange-300" />
          <button onClick={() => setShowPeriod(!showPeriod)}
            className="px-3 py-1.5 text-[11px] font-semibold bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors">
            {showPeriod ? 'Masquer' : 'Afficher'}
          </button>
        </div>
      </div>

      {/* Status summary cards (jour) */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        <PresenceStatusCard label="Présent" count={counts['Présent']} color="green" icon="checkmark" />
        <PresenceStatusCard label="Absent" count={counts['Absent']} color="red" icon="cross" />
        <PresenceStatusCard label="Congé" count={counts['Congé']} color="yellow" icon="palm" />
        <PresenceStatusCard label="Maladie" count={counts['Maladie']} color="purple" icon="smiley" />
        <PresenceStatusCard label="Formation" count={counts['Formation']} color="blue" icon="books" />
        <PresenceStatusCard label="Non saisi" count={counts['Non saisi']} color="gray" icon="question" />
      </div>

      {/* TABLEAU RÉCAPITULATIF DE PÉRIODE */}
      {showPeriod && (
        <div className="bg-white rounded-2xl border border-orange-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3 bg-orange-50 border-b border-orange-100 flex items-center gap-2">
            <Ico name="calendar" size={16} className="text-orange-600" />
            <h3 className="text-sm font-bold text-orange-800">
              Récapitulatif des présences — du {fmt(periodStart)} au {fmt(periodEnd)} ({datesInPeriod.length} jour{datesInPeriod.length > 1 ? 's' : ''})
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead><tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="px-4 py-2.5 text-[10px] font-bold text-slate-400 uppercase">Employé</th>
                <th className="px-3 py-2.5 text-[10px] font-bold text-green-600 uppercase text-center">Présent</th>
                <th className="px-3 py-2.5 text-[10px] font-bold text-red-600 uppercase text-center">Abs. justifié</th>
                <th className="px-3 py-2.5 text-[10px] font-bold text-red-700 uppercase text-center">Abs. non just.</th>
                <th className="px-3 py-2.5 text-[10px] font-bold text-yellow-600 uppercase text-center">Congé</th>
                <th className="px-3 py-2.5 text-[10px] font-bold text-purple-600 uppercase text-center">Maladie</th>
                <th className="px-3 py-2.5 text-[10px] font-bold text-blue-600 uppercase text-center">Formation</th>
                <th className="px-3 py-2.5 text-[10px] font-bold text-indigo-600 uppercase text-center">H. Sup</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {periodSummary.map(r => (
                  <tr key={r.emp.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-2.5"><div className="flex items-center gap-2"><Avatar emp={r.emp} /><span className="text-xs font-semibold text-slate-700">{r.emp.firstName} {r.emp.lastName}</span></div></td>
                    <td className="px-3 py-2.5 text-center text-xs font-bold text-green-700">{r['Présent'] || '-'}</td>
                    <td className="px-3 py-2.5 text-center text-xs text-red-600">{r.absJust || '-'}</td>
                    <td className="px-3 py-2.5 text-center text-xs font-bold text-red-700">{r.absNonJust || '-'}</td>
                    <td className="px-3 py-2.5 text-center text-xs text-yellow-700">{r['Congé'] || '-'}</td>
                    <td className="px-3 py-2.5 text-center text-xs text-purple-700">{r['Maladie'] || '-'}</td>
                    <td className="px-3 py-2.5 text-center text-xs text-blue-700">{r['Formation'] || '-'}</td>
                    <td className="px-3 py-2.5 text-center text-xs font-bold text-indigo-700">{r.heuresSup ? `${r.heuresSup}h` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TABLEAU POINTAGE QUOTIDIEN */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-800">Pointage quotidien — {fmt(selectedDate)}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead><tr className="border-b border-slate-100 bg-slate-50/50">
              <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider w-[220px]">EMPLOYÉ</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">SITE</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">POINTAGE</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider w-[360px]">HEURES SUPP. (15% · 50% · 75% · 100% · 200%)</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {displayEmps.map(emp => {
                const lockedOnLeave = isOnAcceptedLeave(emp.id, selectedDate);
                // Si en congé accepté, on force le statut à 'Congé'
                let pres = getPresence(emp.id);
                if (lockedOnLeave && (!pres || pres.status !== 'Congé')) {
                  pres = setStatus(emp.id, 'Congé');
                }
                const site = sites.find(s => s.id === emp.siteId);
                const currentStatus = pres ? pres.status : 'Non saisi';
                return (
                  <tr key={emp.id} className={cn('hover:bg-slate-50/50', lockedOnLeave && 'bg-yellow-50/40')}>
                    <td className="px-4 py-3">
                      <div className={cn('flex items-center gap-3 rounded-lg p-1 -m-1', !lockedOnLeave && 'cursor-pointer hover:bg-orange-50')} onClick={() => !lockedOnLeave && openPresenceEdit(emp.id)}>
                        <Avatar emp={emp} />
                        <div>
                          <p className="text-xs font-bold text-slate-800">{emp.firstName} {emp.lastName}</p>
                          <p className="text-[10px] text-slate-400">{emp.position}</p>
                          {/* Tags justif/durée */}
                          {lockedOnLeave &&
                            <span className="inline-flex items-center gap-1 mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700">🔒 Congé validé</span>}
                          {!lockedOnLeave && pres && (pres.status === 'Absent' || pres.status === 'Maladie') && pres.justification &&
                            <span className={cn('inline-block mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded', pres.justification === 'Justifié' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')}>{pres.justification}</span>}
                          {!lockedOnLeave && pres && (pres.status === 'Congé' || pres.status === 'Formation') && pres.duree &&
                            <span className="inline-block mt-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{pres.duree} j</span>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{site?.name || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {allStatuses.map(st => (
                          <PresenceBadge key={st} status={st} selected={currentStatus === st}
                            disabled={lockedOnLeave && st !== 'Congé'}
                            onClick={() => {
                              if (lockedOnLeave) return; // verrouillé sur congé
                              if (st === 'Absent' || st === 'Maladie' || st === 'Congé' || st === 'Formation') {
                                openPresenceEdit(emp.id, st);
                              } else {
                                const p = setStatus(emp.id, st); persistDoc('presences', p.id, p); refresh();
                              }
                            }} />
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {OVERTIME_RATES.map(rate => {
                          const ot = getOvertime(pres);
                          return (
                            <div key={rate.key} className="flex flex-col items-center">
                              <span className="text-[8px] font-bold text-indigo-500 mb-0.5">{rate.label}</span>
                              <input type="number" min={0} step={0.5} value={ot[rate.key] || 0} disabled={lockedOnLeave}
                                onChange={(e) => {
                                  let p = getPresence(emp.id);
                                  if (!p) p = setStatus(emp.id, 'Non saisi');
                                  const cur = getOvertime(p);
                                  p.overtime = { ...cur, [rate.key]: Number(e.target.value) };
                                  p.heuresSup = undefined;
                                  persistDoc('presences', p.id, p);
                                  refresh();
                                }}
                                className={cn('w-12 px-1 py-1 text-[11px] text-center border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300', lockedOnLeave ? 'bg-slate-100 text-slate-400' : 'bg-slate-50')} />
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODALE D'ÉDITION */}
      <Modal open={!!selectedEmpId} onClose={() => setSelectedEmpId(null)}
        title={`Pointage — ${selectedEmp ? selectedEmp.firstName + ' ' + selectedEmp.lastName : ''}`}
        actions={
          <button onClick={savePresence} className="px-5 py-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-sm">
            <Ico name="save" size={14} /> Enregistrer
          </button>
        }>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-slate-500">Statut</label>
            <select value={pForm.status} onChange={(e) => setPForm({ ...pForm, status: e.target.value as Presence['status'] })}
              className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-300">
              {allStatuses.map(st => <option key={st} value={st}>{st}</option>)}
            </select>
          </div>

          {/* Justification (Absent / Maladie) */}
          {needsJustification && (
            <div className="space-y-1.5 p-3 rounded-xl bg-amber-50 border border-amber-200">
              <label className="text-[11px] font-bold text-amber-800">Cette absence est-elle justifiée ?</label>
              <div className="flex gap-2">
                {(['Justifié', 'Non justifié'] as const).map(j => (
                  <button key={j} onClick={() => setPForm({ ...pForm, justification: j })}
                    className={cn('flex-1 py-2 text-xs font-semibold rounded-lg border transition-all',
                      pForm.justification === j
                        ? (j === 'Justifié' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-red-500 text-white border-red-500')
                        : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50')}>
                    {j}
                  </button>
                ))}
              </div>
              {pForm.justification === 'Non justifié' && (
                <p className="text-[10px] text-red-600 mt-1">⚠ Une absence non justifiée entraîne une retenue sur salaire (voir menu Paie).</p>
              )}
            </div>
          )}

          {/* Durée (Congé / Formation) */}
          {needsDuree && (
            <div className="space-y-1.5 p-3 rounded-xl bg-sky-50 border border-sky-200">
              <label className="text-[11px] font-bold text-sky-800">Durée ({pForm.status.toLowerCase()})</label>
              <div className="flex items-center gap-2">
                <input type="number" min={1} value={pForm.duree} onChange={(e) => setPForm({ ...pForm, duree: Number(e.target.value) })}
                  className="w-24 px-3 py-2 text-xs border border-sky-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-300" />
                <span className="text-xs text-slate-600">jour(s)</span>
              </div>
            </div>
          )}

          {/* Heures supplémentaires par taux */}
          <div className="space-y-2 p-3 rounded-xl bg-indigo-50 border border-indigo-200">
            <label className="text-[11px] font-bold text-indigo-800">Heures supplémentaires (par taux de majoration)</label>
            <div className="grid grid-cols-5 gap-2">
              {OVERTIME_RATES.map(rate => (
                <div key={rate.key} className="flex flex-col items-center">
                  <span className="text-[10px] font-bold text-indigo-600 mb-1">{rate.label}</span>
                  <input type="number" min={0} step={0.5} value={pForm.overtime[rate.key]}
                    onChange={(e) => setPForm({ ...pForm, overtime: { ...pForm.overtime, [rate.key]: Number(e.target.value) } })}
                    className="w-full px-1.5 py-1.5 text-xs text-center border border-indigo-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                  <span className="text-[8px] text-slate-400 mt-0.5">h</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-indigo-600">Total : {pForm.overtime.h15 + pForm.overtime.h50 + pForm.overtime.h75 + pForm.overtime.h100 + pForm.overtime.h200} h supplémentaires</p>
          </div>

          <InputField label="Notes (optionnel)" value={pForm.notes} onChange={v => setPForm({ ...pForm, notes: v })} placeholder="Commentaire..." />
        </div>
      </Modal>
    </div>
  );
}


/* ══════════════════════════════════════════════════════ */
/* PAGE: CONGÉS                                            */
/* ══════════════════════════════════════════════════════ */

// Applique un congé accepté aux présences (verrouille la période sur 'Congé')
function applyAcceptedLeaveToPresences(l: Leave) {
  if (l.status !== 'Accepté') return;
  const d = new Date(l.startDate); const end = new Date(l.endDate);
  while (d <= end) {
    const ds = d.toISOString().split('T')[0];
    const existing = presences.find(p => p.employeeId === l.employeeId && p.date === ds);
    if (existing) { existing.status = 'Congé'; existing.duree = existing.duree || 1; persistDoc('presences', existing.id, existing); }
    else { const np: Presence = { id: `lv${l.id}-${ds}`, employeeId: l.employeeId, date: ds, status: 'Congé', duree: 1 }; presences.push(np); persistDoc('presences', np.id, np); }
    d.setDate(d.getDate() + 1);
  }
}
// Retire les présences générées par un congé (si statut ≠ accepté)
function removeLeavePresences(l: Leave) {
  const d = new Date(l.startDate); const end = new Date(l.endDate);
  while (d <= end) {
    const ds = d.toISOString().split('T')[0];
    const pid = `lv${l.id}-${ds}`;
    const idx = presences.findIndex(p => p.id === pid);
    if (idx >= 0) { presences.splice(idx, 1); removeDoc('presences', pid); }
    d.setDate(d.getDate() + 1);
  }
}

function LeavePage({ filtered }: { filtered: Employee[] }) {
  const [modal, setModal] = useState(false);
  const [editItem, setEditItem] = useState<Leave | null>(null);
  const [lForm, setLForm] = useState({ employeeId:'', type:'Congé annuel' as Leave['type'], startDate:'', endDate:'', reason:'', status:'En attente' as Leave['status'] });
  const [filterS, setFilterS] = useState('');
  const [tick, setTick] = useState(0);
  const refresh = () => setTick(t => t + 1);

  const sorted = [...leaves].sort((a,b)=>b.startDate.localeCompare(a.startDate));
  let display = sorted;
  if(filterS) display = display.filter(l=>l.status===filterS);

  // Change le statut d'un congé et synchronise les présences
  const changeStatus = (l: Leave, newStatus: Leave['status']) => {
    l.status = newStatus;
    persistDoc('leaves', l.id, l);
    if (newStatus === 'Accepté') applyAcceptedLeaveToPresences(l);
    else removeLeavePresences(l);
    refresh();
  };

  const create = ()=>{
    const newLeave: Leave = {id:`l${Date.now()}`, ...lForm};
    leaves.push(newLeave);
    persistDoc('leaves', newLeave.id, newLeave);
    if (newLeave.status === 'Accepté') applyAcceptedLeaveToPresences(newLeave);
    setModal(false); refresh();
  };

  const saveEdit =()=>{
    if(!editItem)return;
    Object.assign(editItem,lForm);
    persistDoc('leaves', editItem.id, editItem);
    if (editItem.status === 'Accepté') applyAcceptedLeaveToPresences(editItem);
    else removeLeavePresences(editItem);
    setEditItem(null); refresh();
  };

  void tick;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-2">
          {['Tous','En attente','Accepté','Refusé'].map(f=>{
            const v=f==='Tous'?'':f;
            return <button key={f} onClick={()=>setFilterS(v)}
              className={cn('px-3 py-1.5 text-[11px] font-medium rounded-lg transition-colors', filterS===v?'bg-orange-100 text-orange-700':'bg-slate-100 text-slate-500 hover:bg-slate-200')}>
              {f}{v===''?`(${leaves.length})`:`(${leaves.filter(l=>l.status===v).length})`}
            </button>;
          })}
        </div>
        <button onClick={()=>{setLForm({employeeId:'',type:'Congé annuel',startDate:'',endDate:'',reason:'',status:'En attente'});setModal(true)}}
          className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-orange-500 to-orange-600 text-white text-xs font-semibold rounded-xl shadow-sm">
          <Ico name="plus" size={15}/> Nouvelle demande
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead><tr className="border-b border-slate-100 bg-slate-50/50">
              <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase">Employé</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase">Type</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase">Dates</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase">Motif</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase">Statut</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {display.map(l=>{
                const emp=filtered.find(e=>e.id===l.employeeId); if(!emp)return null;
                const days=Math.ceil(((new Date(l.endDate).getTime() as number) - (new Date(l.startDate).getTime() as number))/86400000)+1;
                return <tr key={l.id} className="hover:bg-slate-50/80 cursor-pointer" onClick={()=>{setLForm({...l});setEditItem(l);}}>
                  <td className="px-4 py-3"><div className="flex items-center gap-2"><Avatar emp={emp}/><span className="text-xs font-semibold text-slate-700">{emp.firstName} {emp.lastName}</span></div></td>
                  <td className="px-4 py-3 text-xs text-slate-600">{l.type}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">{fmt(l.startDate)} → {fmt(l.endDate)}<br/><span className="text-[10px] text-slate-400">{days} jour(s)</span></td>
                  <td className="px-4 py-3 text-xs text-slate-500">{l.reason}</td>
                  <td className="px-4 py-3" onClick={e=>e.stopPropagation()}>
                    <div className="space-y-1 inline-block">
                      <select value={l.status} onChange={(e)=> changeStatus(l, e.target.value as Leave['status']) }
                        className="text-[10px] font-semibold px-2 py-1 rounded-lg border cursor-pointer focus:outline-none focus:ring-2 focus:ring-orange-300"
                        style={{
                          backgroundColor:l.status==='En attente'?'#fef3c7':l.status==='Accepté'?'#d1fae5':'#fee2e2',
                          color:l.status==='En attente'?'#b45309':l.status==='Accepté'?'#047857':'#dc2626'
                        }}>
                        <option value="En attente">En attente</option>
                        <option value="Accepté">Accepté</option>
                        <option value="Refusé">Refusé</option>
                      </select>
                      {l.status === 'Accepté' && <p className="text-[9px] text-emerald-600 mt-0.5">↳ Présences verrouillées</p>}
                    </div>
                  </td>
                  <td className="px-4 py-3" onClick={e=>e.stopPropagation()}>
                    <div className="flex gap-1">
                      <button onClick={()=>{setLForm({...l});setEditItem(l);}} className="p-1.5 text-slate-400 hover:text-orange-600 rounded-lg hover:bg-orange-50"><Ico name="edit" size={14}/></button>
                      <button onClick={()=>{if(confirm('Supprimer cette demande ?')){const i=leaves.findIndex(x=>x.id===l.id);if(i>=0)leaves.splice(i,1);removeDoc('leaves', l.id);}}} className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50"><Ico name="trash" size={14}/></button>
                    </div>
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add modal */}
      <Modal open={modal} onClose={()=>setModal(false)} title="Nouvelle demande de congé">
        <div className="space-y-3">
          <div className="space-y-1"><label className="text-[11px] text-slate-500">Employé</label><select value={lForm.employeeId} onChange={e=>setLForm({...lForm,employeeId:e.target.value})} className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50"><option>Sélectionner...</option>{filtered.map(e=><option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}</select></div>
          <div className="space-y-1"><label className="text-[11px] text-slate-500">Type</label><select value={lForm.type} onChange={e=>setLForm({...lForm,type:e.target.value as Leave['type']})} className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50"><option>Congé annuel</option><option>Congé maladie</option><option>Congé maternité</option><option>RTT</option><option>Congé sans solde</option></select></div>
          <div className="grid grid-cols-2 gap-3"><InputField label="Début" type="date" value={lForm.startDate} onChange={v=>setLForm({...lForm,startDate:v})}/><InputField label="Fin" type="date" value={lForm.endDate} onChange={v=>setLForm({...lForm,endDate:v})}/></div>
          <InputField label="Motif" value={lForm.reason} onChange={v=>setLForm({...lForm,reason:v})} placeholder="Raison du congé..."/>
          <div className="space-y-1"><label className="text-[11px] text-slate-500">Statut initial</label><select value={lForm.status} onChange={e=>setLForm({...lForm,status:e.target.value as Leave['status']})} className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50"><option>En attente</option><option>Accepté</option><option>Refusé</option></select></div>
          <button onClick={create} className="w-full py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5"><Ico name="save" size={14}/> Soumettre</button>
        </div>
      </Modal>

      {/* Edit modal */}
      <Modal open={!!editItem} onClose={()=>setEditItem(null)} title="Modifier la demande">
        <div className="space-y-3">
          <div className="space-y-1"><label className="text-[11px] text-slate-500">Employé</label><select value={lForm.employeeId} disabled className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50"><option>{employees.find(e=>e.id===lForm.employeeId)?.firstName+' '+employees.find(e=>e.id===lForm.employeeId)?.lastName}</option></select></div>
          <div className="space-y-1"><label className="text-[11px] text-slate-500">Type</label><select value={lForm.type} onChange={e=>setLForm({...lForm,type:e.target.value as Leave['type']})} className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50"><option>Congé annuel</option><option>Congé maladie</option><option>Congé maternité</option><option>RTT</option><option>Congé sans solde</option></select></div>
          <div className="grid grid-cols-2 gap-3"><InputField label="Début" type="date" value={lForm.startDate} onChange={v=>setLForm({...lForm,startDate:v})}/><InputField label="Fin" type="date" value={lForm.endDate} onChange={v=>setLForm({...lForm,endDate:v})}/></div>
          <InputField label="Motif" value={lForm.reason} onChange={v=>setLForm({...lForm,reason:v})}/>
          <div className="space-y-1"><label className="text-[11px] text-slate-500">Statut</label><select value={lForm.status} onChange={e=>setLForm({...lForm,status:e.target.value as Leave['status']})} className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-300"><option>En attente</option><option>Accepté</option><option>Refusé</option></select></div>
          <div className="flex gap-2 pt-2">
            <button onClick={saveEdit} className="flex-1 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5"><Ico name="save" size={14}/> Enregistrer</button>
            <button onClick={()=>setEditItem(null)} className="px-4 py-2.5 bg-slate-100 text-slate-600 text-xs font-bold rounded-xl hover:bg-slate-200">Annuler</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}


/* ══════════════════════════════════════════════════════ */
/* PAGE: PAIE                                              */
/* ══════════════════════════════════════════════════════ */

// Nombre moyen de jours ouvrés par mois (base légale de référence)
const JOURS_OUVRES_MOIS = 22;

// Retenues sociales & fiscales (taux CI simplifiés) — source unique de vérité
type SocialDeductions = {
  brut: number;        // salaire brut (base + heures sup - retenue absences)
  cnps: number;        // CNPS retraite 6.3%
  contribNat: number;  // Contribution nationale 1.2%
  its: number;         // ITS 1.5%
  igr: number;         // IGR 2.5%
  totalRetenues: number; // CNPS + CN + ITS + IGR + retenue absences
  netAPayer: number;   // brut total - total retenues
};

function computeSocialDeductions(salary: number, overtimePay: number, absenceDeduction: number): SocialDeductions {
  const brut = salary + overtimePay - absenceDeduction;
  const cnps = Math.round(brut * 0.063);
  const contribNat = Math.round(brut * 0.012);
  const its = Math.round(brut * 0.015);
  const igr = Math.round(brut * 0.025);
  const totalRetenues = cnps + contribNat + its + igr + absenceDeduction;
  const netAPayer = Math.round(salary + overtimePay - totalRetenues);
  return { brut, cnps, contribNat, its, igr, totalRetenues, netAPayer };
}

type PayrollRow = {
  emp: Employee; dailyRate: number; hourlyRate: number; absNonJust: number; absJust: number;
  heuresSup: number; ot: OvertimeHours; deduction: number; overtimePay: number; netToPay: number;
  social: SocialDeductions; hasData: boolean;
};

// Calcule la paie RÉELLE d'un employé sur une période donnée, à partir des présences
// effectivement saisies (absences, heures sup). Fonction unique utilisée à la fois par
// la page "Paie" et par "Charges sociales", pour garantir des montants identiques.
// hasData = true si au moins une présence a été saisie sur la période (sinon le calcul
// retombe par défaut sur le salaire de base, comme si l'employé avait été présent).
function computeEmployeePayrollForPeriod(emp: Employee, periodStart: string, periodEnd: string) {
  const dailyRate = emp.salary / JOURS_OUVRES_MOIS;

  const empPresences = presences.filter(p =>
    p.employeeId === emp.id && p.date >= periodStart && p.date <= periodEnd);

  const absNonJust = empPresences.filter(p => p.status === 'Absent' && p.justification === 'Non justifié').length;
  const absJust = empPresences.filter(p => p.status === 'Absent' && p.justification === 'Justifié').length;

  const ot: OvertimeHours = emptyOvertime();
  empPresences.forEach(p => {
    const o = p.overtime || { ...emptyOvertime(), h15: p.heuresSup || 0 };
    ot.h15 += o.h15; ot.h50 += o.h50; ot.h75 += o.h75; ot.h100 += o.h100; ot.h200 += o.h200;
  });
  const heuresSup = ot.h15 + ot.h50 + ot.h75 + ot.h100 + ot.h200;

  const deduction = Math.round(absNonJust * dailyRate);

  const hourlyRate = emp.salary / (JOURS_OUVRES_MOIS * 8);
  const overtimePay = Math.round(
    OVERTIME_RATES.reduce((acc, r) => acc + ot[r.key] * hourlyRate * (1 + r.rate), 0)
  );

  const social = computeSocialDeductions(emp.salary, overtimePay, deduction);
  const netToPay = social.netAPayer;

  return { dailyRate, hourlyRate, absNonJust, absJust, heuresSup, ot, deduction, overtimePay, netToPay, social, hasData: empPresences.length > 0 };
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

function PaySlipModal({ row, periodStart, periodEnd, onClose }: { row: PayrollRow; periodStart: string; periodEnd: string; onClose: () => void; }) {
  const { emp, ot, deduction, overtimePay, netToPay, hourlyRate, absNonJust, social } = row;
  const c = emp.components;
  const isCadre = emp.professionalStatus === 'Cadre';

  // Calculs sociaux : source unique (identiques au tableau récap)
  const { brut, cnps, contribNat, its, igr, totalRetenues, netAPayer } = social;
  const brutImposable = brut;

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
            {/* Bandeau entreprise + logo */}
            <div className={cn('flex items-start justify-between p-4 border-b-2', isCadre ? 'border-indigo-200 bg-indigo-50/50' : 'border-slate-200 bg-slate-50')}>
              <div className="flex items-start gap-3">
                {/* Emplacement logo */}
                <div className="h-14 w-14 rounded-lg border border-slate-300 bg-white flex items-center justify-center overflow-hidden shrink-0">
                  {emp.logoUrl
                    ? <img src={emp.logoUrl} alt="logo" className="h-full w-full object-contain" />
                    : <span className="text-[8px] text-slate-400 text-center px-1">LOGO</span>}
                </div>
                <div>
                  <p className="text-xs font-extrabold text-slate-800 uppercase leading-tight">Garage Automobile {site?.name || ''}</p>
                  <p className="text-[10px] text-slate-500">{site?.address}, {site?.city}</p>
                  <p className="text-[10px] text-slate-500">Tél : {site?.phone}</p>
                </div>
              </div>
              <div className={cn('text-center px-4 py-2 rounded-lg', isCadre ? 'bg-indigo-100' : 'bg-slate-200')}>
                <p className="text-[10px] font-bold text-slate-700 uppercase">Bulletin de paie</p>
                <p className="text-[10px] text-slate-600">Du {fmt(periodStart)}</p>
                <p className="text-[10px] text-slate-600">Au {fmt(periodEnd)}</p>
              </div>
            </div>

            {/* Infos salarié */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 p-4 border-b border-slate-200 text-[11px]">
              <div className="flex justify-between"><span className="text-slate-500">Matricule :</span><span className="font-semibold text-slate-700">{emp.matricule || '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">N° CNPS :</span><span className="font-semibold text-slate-700">{emp.cnpsNumber || '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Nom & Prénom :</span><span className="font-semibold text-slate-700">{emp.lastName} {emp.firstName}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Nombre de parts :</span><span className="font-semibold text-slate-700">{emp.parts ?? 1}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Fonction :</span><span className="font-semibold text-slate-700">{emp.position}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Situation familiale :</span><span className="font-semibold text-slate-700">{emp.familySituation || '—'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Date d'embauche :</span><span className="font-semibold text-slate-700">{fmt(emp.startDate)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Catégorie / Échelon :</span><span className="font-semibold text-slate-700">{emp.category || '—'}</span></div>
            </div>

            {/* Tableau gains / retenues */}
            <table className="w-full">
              <thead>
                <tr className={cn(isCadre ? 'bg-indigo-50' : 'bg-slate-100')}>
                  <th className="px-2 py-1.5 text-[9px] font-bold text-slate-500 uppercase text-left">Code</th>
                  <th className="px-2 py-1.5 text-[9px] font-bold text-slate-500 uppercase text-left">Libellé</th>
                  <th className="px-2 py-1.5 text-[9px] font-bold text-slate-500 uppercase text-right">Base</th>
                  <th className="px-2 py-1.5 text-[9px] font-bold text-slate-500 uppercase text-center">Taux/Nb</th>
                  <th className="px-2 py-1.5 text-[9px] font-bold text-emerald-600 uppercase text-right">Gains</th>
                  <th className="px-2 py-1.5 text-[9px] font-bold text-red-500 uppercase text-right">Retenue</th>
                </tr>
              </thead>
              <tbody>
                {/* Rubrique de base : pour Cadre on affiche "Salaire de base cadre" */}
                <PaySlipRow code="0001" label={isCadre ? 'SALAIRE DE BASE CADRE' : 'SALAIRE DE BASE/ÉCHELON'} base={c.baseSalary} gain={c.baseSalary} />
                {c.sursalaire > 0 && <PaySlipRow code="0128" label="SURSALAIRE MENSUEL" base={c.sursalaire} gain={c.sursalaire} />}
                {c.seniority > 0 && <PaySlipRow code="0222" label={isCadre ? 'ANCIENNETÉ MENSUELLE CADRE' : "ANCIENNETÉ MENSUELLE"} base={c.seniority} gain={c.seniority} />}
                {c.housing > 0 && <PaySlipRow code="1021" label="INDEMNITÉ DE LOGEMENT" base={c.housing} gain={c.housing} />}
                {c.transport > 0 && <PaySlipRow code="1710" label="INDEMNITÉ DE TRANSPORT" base={c.transport} gain={c.transport} />}
                {c.representation > 0 && <PaySlipRow code="1305" label="INDEMNITÉ DE REPRÉSENTATION" base={c.representation} gain={c.representation} />}
                {c.responsibility > 0 && <PaySlipRow code="1400" label="PRIME DE RESPONSABILITÉ" base={c.responsibility} gain={c.responsibility} />}
                {c.performance > 0 && <PaySlipRow code="1500" label="PRIME DE RENDEMENT" base={c.performance} gain={c.performance} />}
                {c.boisson > 0 && <PaySlipRow code="1600" label={isCadre ? 'PRIME DE BOISSON' : 'PRIME EXCEPTIONNELLE'} base={c.boisson} gain={c.boisson} />}
                {c.other > 0 && <PaySlipRow code="1900" label="AUTRES PRIMES" base={c.other} gain={c.other} />}

                {/* Heures supplémentaires par taux */}
                {OVERTIME_RATES.map(r => ot[r.key] > 0 && (
                  <PaySlipRow key={r.key} code={`9${r.label.replace('%','')}`} label={`HEURES SUP. +${r.label}`}
                    base={Math.round(hourlyRate)} taux={`${ot[r.key]} h`} gain={Math.round(ot[r.key] * hourlyRate * (1 + r.rate))} />
                ))}

                <tr className="bg-slate-50 font-bold border-y border-slate-200">
                  <td colSpan={4} className="px-2 py-1.5 text-[11px] text-slate-700">=== SALAIRE BRUT</td>
                  <td className="px-2 py-1.5 text-[11px] text-emerald-700 text-right">{(emp.salary + overtimePay).toLocaleString('fr-FR')}</td>
                  <td></td>
                </tr>

                {/* Absences non justifiées (retenue) */}
                {deduction > 0 && <PaySlipRow code="7100" label={`RETENUE ABSENCE(S) NON JUSTIFIÉE(S) (${absNonJust} j)`} taux={`${absNonJust} j`} retenue={deduction} />}

                {/* Retenues sociales & fiscales */}
                <PaySlipRow code="3000" label="CNPS RETRAITE" base={brut} taux="6,3%" retenue={cnps} />
                <PaySlipRow code="3012" label="CONTRIBUTION NATIONALE" base={brutImposable} taux="1,2%" retenue={contribNat} />
                <PaySlipRow code="3020" label="I.T.S" base={brutImposable} taux="1,5%" retenue={its} />
                <PaySlipRow code="3042" label="IGR" base={brutImposable} taux="2,5%" retenue={igr} />

                <tr className="bg-slate-50 font-bold border-y border-slate-200">
                  <td colSpan={4} className="px-2 py-1.5 text-[11px] text-slate-700">TOTAL DES RETENUES</td>
                  <td></td>
                  <td className="px-2 py-1.5 text-[11px] text-red-600 text-right">{totalRetenues.toLocaleString('fr-FR')}</td>
                </tr>
              </tbody>
            </table>

            {/* Net à payer */}
            <div className={cn('flex items-center justify-between p-4 border-t-2', isCadre ? 'border-indigo-300 bg-indigo-50' : 'border-slate-300 bg-slate-100')}>
              <div>
                <p className="text-[10px] text-slate-500 uppercase">Brut</p>
                <p className="text-xs font-bold text-slate-700">{(emp.salary + overtimePay).toLocaleString('fr-FR')} FCFA</p>
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
          </div>

          <p className="text-[9px] text-slate-400 text-center mt-3">
            Bulletin généré automatiquement — Modèle {isCadre ? 'CADRE' : 'NON-CADRE'} · Net à payer identique au tableau récapitulatif : {formatFCFA(netToPay)}
          </p>
        </div>
      </div>
    </div>
  );
}

function PayePage({ filtered }: { filtered: Employee[] }) {
  const totalMasse = filtered.reduce((acc, e) => acc + e.salary, 0);
  const avg = filtered.length ? totalMasse / filtered.length : 0;

  // Période de paie
  const [periodStart, setPeriodStart] = useState('2025-06-01');
  const [periodEnd, setPeriodEnd] = useState('2025-06-30');
  // Fiche de paie sélectionnée
  const [payslip, setPayslip] = useState<PayrollRow | null>(null);

  // Calcul de la paie sur la période sélectionnée
  const payroll = useMemo(() => {
    return filtered.map(emp => ({ emp, ...computeEmployeePayrollForPeriod(emp, periodStart, periodEnd) }));
  }, [filtered, periodStart, periodEnd]);

  const totalDeductions = payroll.reduce((a, p) => a + p.deduction, 0);
  const totalOvertimePay = payroll.reduce((a, p) => a + p.overtimePay, 0);
  const totalNet = payroll.reduce((a, p) => a + p.netToPay, 0);
  const totalAbsNonJust = payroll.reduce((a, p) => a + p.absNonJust, 0);

  return (
    <div className="space-y-6">
      {/* Cartes statistiques globales */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
          <div className="flex items-start justify-between mb-2"><div className="h-9 w-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-sm"><Ico name="briefcase" size={18} className="text-white" /></div></div>
          <p className="text-xl font-bold text-slate-800">{filtered.length}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Total employés</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
          <div className="flex items-start justify-between mb-2"><div className="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white shadow-sm"><Ico name="paye" size={18} className="text-white" /></div></div>
          <p className="text-lg font-bold text-slate-800">{formatFCFA(totalMasse)}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Masse salariale mensuelle</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
          <div className="flex items-start justify-between mb-2"><div className="h-9 w-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 flex items-center justify-center text-white shadow-sm"><Ico name="trendUp" size={18} className="text-white" /></div></div>
          <p className="text-lg font-bold text-slate-800">{formatFCFA(avg)}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Salaire moyen</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
          <div className="flex items-start justify-between mb-2"><div className="h-9 w-9 rounded-xl bg-gradient-to-br from-sky-500 to-cyan-500 flex items-center justify-center text-white shadow-sm"><Ico name="calendar" size={18} className="text-white" /></div></div>
          <p className="text-lg font-bold text-slate-800">{formatFCFA(totalMasse * 12)}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Masse salariale annuelle (est.)</p>
        </div>
      </div>

      {/* ════ SÉLECTEUR DE PÉRIODE (au-dessus de la nouvelle case) ════ */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <Ico name="calendar" size={18} className="text-orange-500" />
        <span className="text-xs font-bold text-slate-700">Période de paie :</span>
        <span className="text-[10px] text-slate-400 uppercase">Du</span>
        <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)}
          className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-300" />
        <span className="text-[10px] text-slate-400 uppercase">Au</span>
        <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)}
          className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-300" />
      </div>

      {/* ════ NOUVELLE CASE : PAIE SUR LA PÉRIODE SÉLECTIONNÉE ════ */}
      <div className="bg-white rounded-2xl border border-orange-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 bg-orange-50 border-b border-orange-100">
          <h3 className="text-sm font-bold text-orange-800">
            Paie de la période — du {fmt(periodStart)} au {fmt(periodEnd)}
          </h3>
          <p className="text-[11px] text-orange-600 mt-0.5">
            Déduction des absences non justifiées (règle légale : salaire mensuel ÷ {JOURS_OUVRES_MOIS} jours ouvrés) · Majoration heures sup. +15%
          </p>
        </div>

        {/* Mini-résumé de la période */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-slate-100">
          <div className="bg-white p-4"><p className="text-[10px] text-slate-400 uppercase font-medium">Masse brute</p><p className="text-sm font-bold text-slate-800 mt-1">{formatFCFA(totalMasse)}</p></div>
          <div className="bg-white p-4"><p className="text-[10px] text-red-400 uppercase font-medium">Retenues abs. non just.</p><p className="text-sm font-bold text-red-600 mt-1">– {formatFCFA(totalDeductions)}</p><p className="text-[10px] text-slate-400">{totalAbsNonJust} absence(s)</p></div>
          <div className="bg-white p-4"><p className="text-[10px] text-indigo-400 uppercase font-medium">Heures supp.</p><p className="text-sm font-bold text-indigo-600 mt-1">+ {formatFCFA(totalOvertimePay)}</p></div>
          <div className="bg-white p-4"><p className="text-[10px] text-emerald-500 uppercase font-medium">Net à payer</p><p className="text-base font-extrabold text-emerald-700 mt-1">{formatFCFA(totalNet)}</p></div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead><tr className="border-b border-slate-100 bg-slate-50/50">
              <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase">Employé</th>
              <th className="px-3 py-3 text-[10px] font-bold text-slate-400 uppercase text-right">Salaire base</th>
              <th className="px-3 py-3 text-[10px] font-bold text-slate-400 uppercase text-center">Abs. non just.</th>
              <th className="px-3 py-3 text-[10px] font-bold text-red-600 uppercase text-right">Retenue</th>
              <th className="px-3 py-3 text-[10px] font-bold text-indigo-600 uppercase text-center">H. sup</th>
              <th className="px-3 py-3 text-[10px] font-bold text-indigo-600 uppercase text-right">Majoration</th>
              <th className="px-3 py-3 text-[10px] font-bold text-emerald-600 uppercase text-right">Net à payer</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {payroll.map((row) => {
                const { emp, absNonJust, deduction, heuresSup, overtimePay, netToPay } = row;
                return (
                <tr key={emp.id} className="hover:bg-orange-50/60 cursor-pointer" onClick={() => setPayslip(row)} title="Cliquez pour voir la fiche de paie">
                  <td className="px-4 py-3"><div className="flex items-center gap-3"><Avatar emp={emp} /><div><p className="text-xs font-semibold text-slate-700">{emp.firstName} {emp.lastName}</p><p className="text-[10px] text-slate-400">{emp.position} · {emp.professionalStatus}</p></div></div></td>
                  <td className="px-3 py-3 text-xs text-slate-600 text-right">{formatFCFA(emp.salary)}</td>
                  <td className="px-3 py-3 text-center">{absNonJust > 0 ? <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">{absNonJust}</span> : <span className="text-[10px] text-slate-300">0</span>}</td>
                  <td className="px-3 py-3 text-xs font-semibold text-right text-red-600">{deduction > 0 ? '– ' + formatFCFA(deduction) : <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-3 text-center text-xs text-slate-600">{heuresSup > 0 ? `${heuresSup}h` : <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-3 text-xs font-semibold text-right text-indigo-600">{overtimePay > 0 ? '+ ' + formatFCFA(overtimePay) : <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-3 text-xs font-extrabold text-right text-emerald-700">{formatFCFA(netToPay)}</td>
                </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                <td className="px-4 py-3 text-xs text-slate-700">TOTAL</td>
                <td className="px-3 py-3 text-xs text-slate-700 text-right">{formatFCFA(totalMasse)}</td>
                <td className="px-3 py-3 text-center text-xs text-red-700">{totalAbsNonJust}</td>
                <td className="px-3 py-3 text-xs text-red-700 text-right">– {formatFCFA(totalDeductions)}</td>
                <td className="px-3 py-3"></td>
                <td className="px-3 py-3 text-xs text-indigo-700 text-right">+ {formatFCFA(totalOvertimePay)}</td>
                <td className="px-3 py-3 text-sm text-emerald-700 text-right">{formatFCFA(totalNet)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ════ CASE EXISTANTE : RÉSUMÉ DES SALAIRES ════ */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-800">Résumé des salaires</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead><tr className="border-b border-slate-100 bg-slate-50/50">
              <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase">Employé</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase">Poste</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase">Contrat</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase">Salaire mensuel (FCFA)</th>
              <th className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase">Salaire annuel (est.)</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {[...filtered].sort((a, b) => b.salary - a.salary).map(emp => {
                const site = sites.find(s => s.id === emp.siteId);
                return <tr key={emp.id} className="hover:bg-slate-50/80">
                  <td className="px-4 py-3"><div className="flex items-center gap-3"><Avatar emp={emp} /><div><p className="text-xs font-semibold text-slate-700">{emp.firstName} {emp.lastName}</p><p className="text-[10px] text-slate-400">{site?.name || ''}</p></div></div></td>
                  <td className="px-4 py-3 text-xs text-slate-600">{emp.position}</td>
                  <td className="px-4 py-3"><ContractBadge type={emp.contractType} /></td>
                  <td className="px-4 py-3 text-xs font-bold text-slate-700">{formatFCFA(emp.salary)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatFCFA(emp.salary * 12)}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between">
          <span className="text-[11px] text-slate-400">{filtered.length} employé(s)</span>
          <span className="text-xs font-bold text-slate-700">Total : {formatFCFA(totalMasse)}</span>
        </div>
      </div>

      {/* Fiche de paie (bulletin) */}
      {payslip && <PaySlipModal row={payslip} periodStart={periodStart} periodEnd={periodEnd} onClose={() => setPayslip(null)} />}
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

// Taux Accidents du Travail / Maladies Professionnelles — variable selon le secteur d'activité (2% à 5%)
const AT_RATE_OPTIONS: { value: number; label: string }[] = [
  { value: 0.02, label: '2% — Risque faible' },
  { value: 0.03, label: '3% — Risque modéré (atelier / garage)' },
  { value: 0.04, label: '4% — Risque élevé' },
  { value: 0.05, label: '5% — Risque maximal' },
];

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
    brutCumule += r.social.brut;
    // Le plafond CNPS s'applique MOIS PAR MOIS (règle légale), d'où le calcul mois par mois puis la somme
    const c = computeEmployerSocialCharges(r.social.brut, atRate);
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
    detail.push({ label: m.label, brut: r.social.brut, totalMensuel: c.totalMensuel, hasData: r.hasData });
  });

  return { brutCumule, moisAvecDonnees, totalMois: months.length, charges, detail };
}

const MOIS_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

// Page réutilisée pour les 3 sous-menus (mensuelle / semestrielle / annuelle).
// Les montants proviennent TOUJOURS de la paie réelle calculée mois par mois (mêmes présences
// que dans le menu "Paie") — jamais d'une simple multiplication du salaire actuel.
function SocialChargesPage({ filtered, mode, periodLabel }: { filtered: Employee[]; mode: ChargesPeriodMode; periodLabel: string }) {
  const [atRate, setAtRate] = useState(0.03);
  // Ancré sur juin 2025 par défaut, car c'est la période où des présences de démonstration existent déjà
  const [year, setYear] = useState(2025);
  const [month, setMonth] = useState(6);
  const [semester, setSemester] = useState<1 | 2>(1);

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
    [filtered, months, atRate]
  );

  const totalCnps = rows.reduce((a, r) => a + r.charges.totalCnps, 0);
  const totalFdfp = rows.reduce((a, r) => a + r.charges.totalFdfp, 0);
  const totalGlobal = rows.reduce((a, r) => a + r.charges.totalMensuel, 0);
  const avgGlobal = rows.length ? totalGlobal / rows.length : 0;

  const yearOptions = [2024, 2025, 2026, 2027];

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

        <Ico name="shield" size={18} className="text-orange-500" />
        <span className="text-xs font-bold text-slate-700">Taux Accidents du travail :</span>
        <select value={atRate} onChange={e => setAtRate(Number(e.target.value))}
          className="px-3 py-2 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-300">
          {AT_RATE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Tableau détaillé par employé */}
      <div className="bg-white rounded-2xl border border-orange-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 bg-orange-50 border-b border-orange-100">
          <h3 className="text-sm font-bold text-orange-800">
            Charges sociales patronales {periodLabel} — par employé · {months[0]?.label}{months.length > 1 ? ` → ${months[months.length - 1].label}` : ''}
          </h3>
          <p className="text-[11px] text-orange-600 mt-0.5">
            Montants réels cumulés mois par mois (présences, absences, heures sup.) · CNPS Retraite 7,7% (plaf. {formatFCFA(CNPS_PLAFOND_RETRAITE)}/mois) · Prestations familiales 5% & Accidents du travail {(atRate * 100).toFixed(0)}% (plaf. {formatFCFA(CNPS_PLAFOND_PF_AT)}/mois) · FDFP 1,6%
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
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
        ⚠ Ces montants sont calculés à partir des <b>présences réellement saisies</b> pour chaque mois (absences, heures sup.), exactement comme dans le menu "Paie" — puis additionnés mois par mois pour les vues semestrielle et annuelle. Le badge « X/Y mois » indique combien de mois de la période disposent de présences enregistrées ; pour un mois sans aucune saisie, le calcul retombe par défaut sur le salaire de base (comme si l'employé avait été présent tout le mois). Taux CNPS/FDFP indicatifs (retraite 7,7% part patronale, prestations familiales 5%, accidents du travail 2 à 5% selon secteur, FDFP 1,6%) — le plafond CNPS est appliqué mois par mois, conformément à la réglementation. Ces montants correspondent au <b>coût employeur</b>, distinct des retenues salariales déjà affichées sur le bulletin de paie. Faites valider ces montants par un expert-comptable ou directement auprès de la CNPS / du FDFP avant tout versement.
      </div>
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
    loadCollectionInto('leaves', leaves, leaves.slice()),
    loadCollectionInto('presences', presences, presences.slice()),
    loadCollectionInto('sites', sites, sites.slice()),
    loadUsersCollection(registeredUsers),
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
            <p className="text-sm text-slate-300">Connexion à GarageRH…</p>
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

function AppShell() {
  const savedUi = loadUiState();
  const [page, setPage] = useState(savedUi?.page || 'dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(savedUi?.currentUser || null);

  // Sauvegarde locale (cet appareil) à chaque changement de page / utilisateur
  useEffect(() => {
    saveUiState({ page, currentUser });
  }, [page, currentUser]);

  const handleLogin = (user: AuthUser) => {
    setCurrentUser(user);
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setSearch('');
    setPage('dashboard');
    setMobileOpen(false);
  };

  const titles: Record<string, string> = {
    dashboard: 'Tableau de bord',
    sites: 'Gestion des sites',
    employees: 'Gestion des employés',
    presence: 'Gestion des présences',
    leave: 'Gestion des congés',
    paye: 'Paie & Salaires',
    'cs-mensuelles': 'Charges sociales mensuelles',
    'cs-semestrielles': 'Charges sociales semestrielles',
    'cs-annuelles': 'Charges sociales annuelles',
  };

  const filtered = useMemo(() => {
    if (!search) return employees;
    const q = search.toLowerCase();
    return employees.filter(e => `${e.firstName} ${e.lastName} ${e.position} ${e.department} ${e.email}`.toLowerCase().includes(q));
  }, [search]);

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <DashboardPage filtered={filtered} />;
      case 'sites': return <SitesPage search={search} />;
      case 'employees': return <EmployeesPage filtered={filtered} />;
      case 'presence': return <PresencePage search={search} />;
      case 'leave': return <LeavePage filtered={filtered} />;
      case 'paye': return <PayePage filtered={filtered} />;
      case 'cs-mensuelles': return <SocialChargesPage filtered={filtered} mode="month" periodLabel="Mensuelles" />;
      case 'cs-semestrielles': return <SocialChargesPage filtered={filtered} mode="semester" periodLabel="Semestrielles" />;
      case 'cs-annuelles': return <SocialChargesPage filtered={filtered} mode="year" periodLabel="Annuelles" />;
      default: return <DashboardPage filtered={filtered} />;
    }
  };

  const onAction = (action: string) => {
    switch (action) {
      case 'save': alert('Toutes les données sont déjà enregistrées automatiquement et en temps réel sur le serveur — aucune action manuelle nécessaire.'); break;
      case 'print': window.print(); break;
      case 'import': alert('Fonctionnalité importer'); break;
      case 'export': alert('Export en cours...'); break;
    }
  };

  /* ── Page de connexion ── */
  if (!currentUser) {
    return <LoginPage onLogin={handleLogin} />;
  }

  /* ── App principale ── */
  return (
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
        <TopBar
          title={titles[page]}
          setMobileOpen={setMobileOpen}
          search={search}
          setSearch={setSearch}
          onAction={onAction}
        />
        <div className="p-4 lg:p-6 max-w-[1400px] mx-auto">{renderPage()}</div>
      </main>
    </div>
  );
}
