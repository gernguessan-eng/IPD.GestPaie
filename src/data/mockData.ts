export type Site = {
  id: string;
  name: string;
  address: string;
  city: string;
  phone: string;
  manager: string;
  capacity: number;
  cnpsEmployeur?: string;    // N° CNPS employeur — affiché sur le bulletin de paie des employés de ce site
  numeroContribuable?: string; // N° Contribuable (DGI) — affiché sur le bulletin de paie des employés de ce site
};

// ══════════════════════════════════════════════════════════════
// RUBRIQUES DE PAIE — basées sur le classeur Excel I.P & D
// (onglets "LIVRE DE PAIE", "ALI" et "LIVRE DE PAIE DECEMBRE 2025")
// ══════════════════════════════════════════════════════════════
export type SalaryComponents = {
  baseSalary: number;             // Salaire de base / échelon (E)
  sursalaire: number;             // Sursalaire (F)
  seniority: number;              // Prime d'ancienneté — conservé pour compat, RECALCULÉ automatiquement (voir computeAncienneteAmount)
  housing: number;                // Indemnité de logement (extension imposable)
  transport: number;              // Indemnité de transport — NON imposable, versée hors brut fiscal (AA / Y)
  representation: number;         // Indemnité de représentation — composante de la "Prime de fonction" imposable (J)
  responsibility: number;         // Prime de responsabilité — composante de la "Prime de fonction" imposable (J)
  performance: number;            // Prime de rendement / performance (extension imposable)
  boisson: number;                // Prime de boisson (extension imposable)
  other: number;                  // Autres primes (extension imposable)
  primeFonctionNonImposable: number; // Prime de fonction NON imposable (I) — issue de l'onglet "MODE D'EMPLOI" (AJ)
  indemniteResponsabiliteNonTaxable: number; // Indemnité de responsabilité NON taxable : exclue du salaire brut taxable
                                              // (IGR) ET des impôts sur salaires, MAIS incluse dans la base CNPS
                                              // (Cotisation Retraite) — rubrique distincte de "primeFonctionNonImposable"
                                              // qui, elle, est exclue à la fois de l'IGR et de la CNPS.
};

// Situation familiale — 5 valeurs canoniques utilisées par le barème fiscal
// (identiques aux valeurs R/P de "LIVRE DE PAIE" : MARIÉ / CELIBATAIRE / DIVORCE / VEUF / VEUVE)
export type FamilySituation = 'Célibataire' | 'Marié(e)' | 'Divorcé(e)' | 'Veuf' | 'Veuve';
export const FAMILY_SITUATIONS: FamilySituation[] = ['Célibataire', 'Marié(e)', 'Divorcé(e)', 'Veuf', 'Veuve'];

export type Employee = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  position: string;
  department: string;
  siteId: string;
  contractType: 'CDI' | 'CDD' | 'Stage' | 'Freelance';
  startDate: string;
  salary: number; // FCFA (total = somme des rubriques, y compris transport et prime non imposable)
  components: SalaryComponents; // détail des rubriques de paie
  status: 'Actif' | 'En congé' | 'Suspendu';
  // Statut professionnel & catégorie (Côte d'Ivoire)
  professionalStatus: 'Cadre' | 'Agent de maitrise' | 'Ouvrier';
  category: string;          // catégorie/échelon saisie manuellement (ex: "M1", "5e A")
  matricule?: string;        // matricule employé
  cnpsNumber?: string;       // numéro CNPS
  familySituation?: FamilySituation;  // situation familiale (utilisée pour le calcul des parts fiscales)
  logoUrl?: string;          // logo importé (data URL)
  avatarColor: string;

  // ── Champs issus de l'onglet "MODE D'EMPLOI" (fiche employé complète) ──
  birthDate?: string;          // Date de naissance
  nationality?: string;        // Nationalité
  gender?: 'Homme' | 'Femme';  // Homme ou Femme
  chefDeFamille?: boolean;     // Chef de famille (Oui/Non)
  numberOfChildren?: number;   // Nombre d'enfants — détermine le nombre de parts fiscales (voir computeFiscalParts)
  congesAnnuelsJours?: number; // Congés annuels (en jours)
  dateDepartConges?: string;   // Date de départ en congés
  cnamAmount?: number;         // Cotisation CNAM / CMU mensuelle (montant forfaitaire)
  pret?: number;                // Prêt — retenue mensuelle
  acompte?: number;             // Acompte sur salaire — retenue mensuelle
  assurance?: number;           // Assurance maladie — retenue mensuelle
};

// Helper pour calculer le salaire total à partir des rubriques
// (= "TOTAL SALAIRE BRUT" (K) de l'onglet LIVRE DE PAIE : inclut la prime non imposable et le transport)
export const computeSalary = (c: SalaryComponents): number =>
  c.baseSalary + c.sursalaire + c.seniority + c.housing + c.transport +
  c.representation + c.responsibility + c.performance + c.boisson + c.other + c.primeFonctionNonImposable +
  c.indemniteResponsabiliteNonTaxable;

// ══════════════════════════════════════════════════════════════
// MOTEUR FISCAL & SOCIAL — Côte d'Ivoire
// Reproduit fidèlement les formules des onglets "LIVRE DE PAIE",
// "LIVRE DE PAIE DECEMBRE 2025" et "ALI" du classeur Excel I.P & D.
// ══════════════════════════════════════════════════════════════

// ── Barème IGR (Impôt Général sur le Revenu) — tranches mensuelles progressives ──
// Formule source (LIVRE DE PAIE DECEMBRE!S9, ALI!O35) :
// IF(brut<=75000,0, IF(brut<=240000,(brut-75000)*16%, IF(brut<=800000,(brut-240000)*21%+26400,
//   IF(brut<=2400000,(brut-800000)*24%+144000, IF(brut<=8000000,(brut-2400000)*28%+528000,
//     (brut-8000000)*32%+2096000)))))
export function computeIGRBrut(brutImposable: number): number {
  const b = Math.max(0, brutImposable);
  if (b <= 75000) return 0;
  if (b <= 240000) return (b - 75000) * 0.16;
  if (b <= 800000) return (b - 240000) * 0.21 + 26400;
  if (b <= 2400000) return (b - 800000) * 0.24 + 144000;
  if (b <= 8000000) return (b - 2400000) * 0.28 + 528000;
  return (b - 8000000) * 0.32 + 2096000;
}

// ── RICF (Réduction d'Impôt pour Charges de Famille) — fonction du nombre de parts ──
// Formule source (LIVRE DE PAIE!V9, ALI!O36) :
// IF(parts<=1,0, IF(parts=1.5,5500, IF(parts=2,11000, ... IF(parts=5,44000))))
export function computeRICF(parts: number): number {
  if (parts <= 1) return 0;
  if (parts <= 1.5) return 5500;
  if (parts <= 2) return 11000;
  if (parts <= 2.5) return 16500;
  if (parts <= 3) return 22000;
  if (parts <= 3.5) return 27500;
  if (parts <= 4) return 33000;
  if (parts <= 4.5) return 38500;
  return 44000; // parts >= 5
}

// ── Nombre de parts fiscales (quotient familial) ──
// Reproduit la formule imbriquée LIVRE DE PAIE!T9, qui distingue 4 barèmes selon
// la situation familiale. Point notable conservé tel quel car présent dans le
// classeur d'origine : à 0 enfant, Veuf/Veuve = 1 part (comme Célibataire) mais
// dès 1 enfant, Veuf/Veuve suit la progression "Marié(e)" (parts plus élevées).
const PARTS_CELIBATAIRE_DIVORCE = [1, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5];  // index = nombre d'enfants (8+ plafonné)
const PARTS_MARIE = [2, 2.5, 3, 3.5, 4, 4.5, 5, 5, 5];
const PARTS_VEUF_VEUVE = [1, 2.5, 3, 3.5, 4, 4.5, 5, 5, 5];

export function computeFiscalParts(situation: FamilySituation | undefined, numberOfChildren: number | undefined): number {
  const n = Math.min(8, Math.max(0, Math.floor(numberOfChildren || 0)));
  switch (situation) {
    case 'Marié(e)': return PARTS_MARIE[n];
    case 'Veuf': return PARTS_VEUF_VEUVE[n];
    case 'Veuve': return PARTS_VEUF_VEUVE[n];
    case 'Divorcé(e)': return PARTS_CELIBATAIRE_DIVORCE[n];
    case 'Célibataire':
    default: return PARTS_CELIBATAIRE_DIVORCE[n];
  }
}

// ── Prime d'ancienneté — calculée automatiquement (jamais saisie manuellement) ──
// Formule source (LIVRE DE PAIE!O9:Q9) :
//   Durée (mois) = DATEDIF(dateEmbauche, finPériode, "M") + 1
//   Années = INT(Durée/12)
//   Taux% = Années si 2<=Années<=25 ; 25% si Années>25 (et Durée>1) ; sinon 0%
//   Prime = Salaire de base × Taux%
export function computeAncienneteRate(startDate: string | undefined, periodEnd: string): { months: number; ratePct: number } {
  if (!startDate) return { months: 0, ratePct: 0 };
  const start = new Date(startDate);
  const end = new Date(periodEnd);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return { months: 0, ratePct: 0 };
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  if (end.getDate() < start.getDate()) months -= 1;
  months += 1;
  if (months < 0) months = 0;
  const years = Math.floor(months / 12);
  let ratePct = 0;
  if (years >= 2 && years <= 25) ratePct = years;
  else if (years > 25 && months > 1) ratePct = 25;
  return { months, ratePct };
}

export function computeAncienneteAmount(baseSalary: number, startDate: string | undefined, periodEnd: string): number {
  const { ratePct } = computeAncienneteRate(startDate, periodEnd);
  return Math.floor(baseSalary * (ratePct / 100));
}

// ── CNPS — Caisse Nationale de Prévoyance Sociale ──
export const CNPS_PLAFOND = 3375000;         // Plafond mensuel du salaire brut social soumis à cotisation retraite
export const CNPS_TAUX_SALARIAL = 0.063;     // Part salariale : 6,3%
export const CNPS_TAUX_PATRONAL = 0.077;     // Part patronale : 7,7%

export function computeCNPSSalarial(brutSocial: number): number {
  return Math.round(Math.min(brutSocial, CNPS_PLAFOND) * CNPS_TAUX_SALARIAL);
}
export function computeCNPSPatronal(brutSocial: number): number {
  return Math.round(Math.min(brutSocial, CNPS_PLAFOND) * CNPS_TAUX_PATRONAL);
}

// ── Charges patronales complémentaires (source : onglet "ALI", section cotisations) ──
export const CHARGES_PATRONALES = {
  prestationFamilialeBase: 75000,
  prestationFamilialeTaux: 0.0575,   // 5,75%
  accidentTravailBase: 75000,
  accidentTravailTaux: 0.02,         // 2%
  isLocalTaux: 0.012,                // Part patronale Impôt sur Salaires (local) — 1,2%
  taxeApprentissageTaux: 0.004,      // FDFP — Taxe d'apprentissage — 0,4%
  taxeFPCTaux: 0.012,                // FDFP — Taxe FPC — 1,2%
  assuranceMaladiePatronaleTaux: 0,  // Part patronale assurance maladie (0 dans le classeur)
};

export type Contract = {
  id: string;
  employeeId: string;
  type: 'CDI' | 'CDD' | 'Stage' | 'Freelance';
  startDate: string;
  endDate: string | null;
  documentUrl: string;
  notes: string;
};

// Heures supplémentaires par taux de majoration (Côte d'Ivoire)
export type OvertimeHours = {
  h15: number;   // +15%
  h50: number;   // +50%
  h75: number;   // +75%
  h100: number;  // +100%
  h200: number;  // +200%
};

export const OVERTIME_RATES: { key: keyof OvertimeHours; label: string; rate: number }[] = [
  { key: 'h15', label: '15%', rate: 0.15 },
  { key: 'h50', label: '50%', rate: 0.50 },
  { key: 'h75', label: '75%', rate: 0.75 },
  { key: 'h100', label: '100%', rate: 1.00 },
  { key: 'h200', label: '200%', rate: 2.00 },
];

export const emptyOvertime = (): OvertimeHours => ({ h15: 0, h50: 0, h75: 0, h100: 0, h200: 0 });

// Saisie manuelle mensuelle de la paie variable par employé (remplace l'ancien calcul
// automatique basé sur les présences, module retiré). Une entrée par employé et par mois
// (clé "YYYY-MM"). En l'absence de saisie pour un mois donné, l'employé est considéré
// présent tout le mois (30 j) et sans heures supplémentaires.
export type PayrollOverride = {
  id: string;            // `${employeeId}::${yearMonth}`
  employeeId: string;
  yearMonth: string;     // 'YYYY-MM'
  joursPayes: number;    // jours réellement payés sur le mois (0 à 30), saisie manuelle
  overtime: OvertimeHours; // heures supplémentaires par taux, saisie manuelle
};

// ── SITES ───────────────────────────────────────────────────
export const sites: Site[] = [
  { id: 's1', name: 'Garage Central', address: '15 Rue de la République', city: 'Abidjan Plateau', phone: '+225 01 43 55 66 77', manager: 'Jean Dupont', capacity: 25 },
  { id: 's2', name: 'Garage Express Nord', address: '42 Avenue General de Gaulle', city: 'Yopougon', phone: '+225 01 42 34 56 78', manager: 'Sophie Martin', capacity: 20 },
  { id: 's3', name: 'Atelier Premium', address: '88 Boulevard de la Villette', city: 'Cocody', phone: '+225 01 40 36 47 58', manager: 'Karim Benali', capacity: 15 },
];

// Génère une répartition des rubriques de paie réaliste (Côte d'Ivoire)
function mkComponents(base: number, sursalaire: number, seniority: number, housing: number, transport: number, representation: number, resp: number, perf: number, boisson: number, other: number, primeFonctionNonImposable = 0, indemniteResponsabiliteNonTaxable = 0): SalaryComponents {
  return { baseSalary: base, sursalaire, seniority, housing, transport, representation, responsibility: resp, performance: perf, boisson, other, primeFonctionNonImposable, indemniteResponsabiliteNonTaxable };
}

// ── EMPLOYÉS ────────────────────────────────────────────────
type EmpExtra = {
  birthDate: string; nationality: string; gender: Employee['gender']; chefDeFamille: boolean;
  numberOfChildren: number; congesAnnuelsJours: number; dateDepartConges?: string;
  cnamAmount: number; pret?: number; acompte?: number; assurance?: number;
};

const _emp = (
  id: string, firstName: string, lastName: string, email: string, phone: string,
  position: string, department: string, siteId: string, contractType: Employee['contractType'],
  startDate: string, status: Employee['status'], avatarColor: string, components: SalaryComponents,
  professionalStatus: Employee['professionalStatus'], category: string, matricule: string, cnpsNumber: string,
  familySituation: FamilySituation, extra: EmpExtra
): Employee => ({
  id, firstName, lastName, email, phone, position, department, siteId, contractType, startDate, status, avatarColor,
  components, salary: computeSalary(components), professionalStatus, category, matricule, cnpsNumber, familySituation,
  birthDate: extra.birthDate, nationality: extra.nationality, gender: extra.gender, chefDeFamille: extra.chefDeFamille,
  numberOfChildren: extra.numberOfChildren, congesAnnuelsJours: extra.congesAnnuelsJours, dateDepartConges: extra.dateDepartConges,
  cnamAmount: extra.cnamAmount, pret: extra.pret || 0, acompte: extra.acompte || 0, assurance: extra.assurance || 0,
});

export const employees: Employee[] = [
  _emp('e1', 'Jean', 'Dupont', 'j.dupont@garage.ci', '+225 07 12 34 56 78', 'Manager de site', 'Direction', 's1', 'CDI',
    '2018-03-15', 'Actif', '#6366f1', mkComponents(1800000, 250000, 0, 400000, 75000, 150000, 200000, 45000, 0, 0, 50000),
    'Cadre', 'M1', '003777', '1800101712283', 'Marié(e)',
    { birthDate: '1988-05-12', nationality: 'Ivoirienne', gender: 'Homme', chefDeFamille: true, numberOfChildren: 2, congesAnnuelsJours: 27, cnamAmount: 2500 }),
  _emp('e2', 'Sophie', 'Martin', 's.martin@garage.ci', '+225 07 23 45 67 89', "Chef d'atelier", 'Mécanique', 's1', 'CDI',
    '2019-06-01', 'Actif', '#8b5cf6', mkComponents(1550000, 150000, 0, 300000, 75000, 0, 150000, 80000, 30000, 0),
    'Cadre', 'M2', '003778', '1900201712284', 'Marié(e)',
    { birthDate: '1990-02-20', nationality: 'Ivoirienne', gender: 'Femme', chefDeFamille: false, numberOfChildren: 1, congesAnnuelsJours: 27, cnamAmount: 2000 }),
  _emp('e3', 'Lucas', 'Bernard', 'l.bernard@garage.ci', '+225 07 34 56 78 90', 'Mécanicien', 'Mécanique', 's1', 'CDI',
    '2021-04-15', 'Actif', '#06b6d4', mkComponents(1250000, 80000, 0, 200000, 50000, 0, 0, 160000, 30000, 0),
    'Ouvrier', '5e A', '003779', '2100401712285', 'Célibataire',
    { birthDate: '1995-11-03', nationality: 'Ivoirienne', gender: 'Homme', chefDeFamille: false, numberOfChildren: 0, congesAnnuelsJours: 27, cnamAmount: 1000 }),
  _emp('e4', 'Claire', 'Petit', 'c.petit@garage.ci', '+225 07 45 67 89 01', 'Manager de site', 'Direction', 's2', 'CDI',
    '2020-09-01', 'Actif', '#f59e0b', mkComponents(1750000, 200000, 0, 380000, 75000, 150000, 200000, 50000, 0, 0, 50000),
    'Cadre', 'M1', '003780', '2000901712286', 'Marié(e)',
    { birthDate: '1985-07-18', nationality: 'Ivoirienne', gender: 'Femme', chefDeFamille: true, numberOfChildren: 3, congesAnnuelsJours: 27, cnamAmount: 3000 }),
  _emp('e5', 'Thomas', 'Moreau', 't.moreau@garage.ci', '+225 07 56 78 90 12', 'Mécanicien', 'Mécanique', 's2', 'CDI',
    '2020-11-01', 'Actif', '#10b981', mkComponents(1400000, 100000, 0, 250000, 50000, 0, 0, 150000, 30000, 0),
    'Ouvrier', '6e B', '003781', '2011101712287', 'Célibataire',
    { birthDate: '1992-09-25', nationality: 'Ivoirienne', gender: 'Homme', chefDeFamille: false, numberOfChildren: 1, congesAnnuelsJours: 27, cnamAmount: 1500, pret: 50000 }),
  _emp('e6', 'Emma', 'Laurent', 'e.laurent@garage.ci', '+225 07 67 89 01 23', 'Secrétaire', 'Administration', 's2', 'CDI',
    '2022-01-20', 'Actif', '#ec4899', mkComponents(950000, 60000, 0, 150000, 50000, 0, 0, 130000, 0, 0),
    'Agent de maitrise', '3e A', '003782', '2200101712288', 'Célibataire',
    { birthDate: '1997-04-14', nationality: 'Ivoirienne', gender: 'Femme', chefDeFamille: false, numberOfChildren: 0, congesAnnuelsJours: 27, cnamAmount: 1000 }),
  _emp('e7', 'Benoît', 'Leroy', 'b.leroy@garage.ci', '+225 07 78 90 12 34', 'Diagnosticien automobile', 'Mécanique', 's1', 'CDD',
    '2024-03-10', 'En congé', '#f97316', mkComponents(1450000, 90000, 0, 250000, 50000, 0, 100000, 70000, 0, 0),
    'Agent de maitrise', '4e B', '003783', '2400301712289', 'Divorcé(e)',
    { birthDate: '1993-01-30', nationality: 'Ivoirienne', gender: 'Homme', chefDeFamille: false, numberOfChildren: 1, congesAnnuelsJours: 27, dateDepartConges: '2025-07-14', cnamAmount: 2000 }),
  _emp('e8', 'Léa', 'Dubois', 'l.dubois@garage.ci', '+225 07 89 01 23 45', 'Apprentie mécanicienne', 'Mécanique', 's3', 'Stage',
    '2024-09-02', 'Actif', '#a855f7', mkComponents(600000, 0, 0, 100000, 50000, 0, 0, 0, 0, 0),
    'Ouvrier', '1e A', '003784', '2400901712290', 'Célibataire',
    { birthDate: '2002-06-10', nationality: 'Ivoirienne', gender: 'Femme', chefDeFamille: false, numberOfChildren: 0, congesAnnuelsJours: 27, cnamAmount: 500 }),
  _emp('e9', 'Antoine', 'Girard', 'a.girard@garage.ci', '+225 07 90 12 34 56', 'Vendeur pièces', 'Magasin', 's2', 'CDD',
    '2024-02-01', 'Actif', '#14b8a6', mkComponents(900000, 50000, 0, 150000, 50000, 0, 0, 130000, 0, 0),
    'Ouvrier', '4e A', '003785', '2400201712291', 'Célibataire',
    { birthDate: '1996-08-22', nationality: 'Ivoirienne', gender: 'Homme', chefDeFamille: false, numberOfChildren: 0, congesAnnuelsJours: 27, cnamAmount: 1000, acompte: 20000 }),
  _emp('e10', 'Julie', 'Fournier', 'j.fournier@garage.ci', '+225 07 01 23 45 67', 'Comptable', 'Finance', 's1', 'CDI',
    '2019-08-01', 'Actif', '#e11d48', mkComponents(1300000, 120000, 0, 250000, 50000, 0, 0, 75000, 0, 0),
    'Agent de maitrise', '5e A', '003786', '1900801712292', 'Veuve',
    { birthDate: '1989-12-05', nationality: 'Ivoirienne', gender: 'Femme', chefDeFamille: true, numberOfChildren: 1, congesAnnuelsJours: 27, cnamAmount: 2500 }),
  _emp('e11', 'Karim', 'Benali', 'k.benali@garage.ci', '+225 07 12 11 22 33', 'Responsable atelier premium', 'Mécanique', 's3', 'CDI',
    '2021-05-15', 'Actif', '#fbbf24', mkComponents(1600000, 180000, 0, 350000, 75000, 100000, 180000, 80000, 30000, 0, 40000),
    'Cadre', 'M2', '003787', '2100501712293', 'Marié(e)',
    { birthDate: '1984-03-09', nationality: 'Ivoirienne', gender: 'Homme', chefDeFamille: true, numberOfChildren: 2, congesAnnuelsJours: 27, cnamAmount: 3000 }),
  _emp('e12', 'Clara', 'Rousseau', 'c.rousseau@garage.ci', '+225 07 33 44 55 66', 'Carrossière', 'Carrosserie', 's3', 'CDI',
    '2022-09-01', 'Actif', '#22c55e', mkComponents(1150000, 80000, 0, 200000, 50000, 0, 0, 100000, 30000, 0),
    'Ouvrier', '6e A', '003788', '2200901712294', 'Marié(e)',
    { birthDate: '1994-10-17', nationality: 'Ivoirienne', gender: 'Femme', chefDeFamille: false, numberOfChildren: 1, congesAnnuelsJours: 27, cnamAmount: 1500 }),
];

// ── PAIE VARIABLE (saisie manuelle mensuelle) ─────────────────
// Vide par défaut : chaque mois non saisi retombe sur "30 jours payés, 0 heure sup".
export const payrollOverrides: PayrollOverride[] = [];

// ── CONTRATS (gardés en interne) ─────────────────────────────
