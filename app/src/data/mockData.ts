export type Site = {
  id: string;
  name: string;
  address: string;
  city: string;
  phone: string;
  manager: string;
  capacity: number;
};

// Rubriques de paie d'un salarié en Côte d'Ivoire (basé sur bulletin de paie réel)
export type SalaryComponents = {
  baseSalary: number;       // Salaire de base / échelon
  sursalaire: number;       // Sursalaire
  seniority: number;        // Prime d'ancienneté
  housing: number;          // Indemnité de logement
  transport: number;        // Indemnité / Prime de transport
  representation: number;   // Indemnité de représentation
  responsibility: number;   // Prime de responsabilité / fonction
  performance: number;      // Prime de rendement / performance
  boisson: number;          // Prime de boisson
  other: number;            // Autres primes
};

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
  salary: number; // FCFA (total = somme des rubriques)
  components: SalaryComponents; // détail des rubriques de paie
  status: 'Actif' | 'En congé' | 'Suspendu';
  // Statut professionnel & catégorie (Côte d'Ivoire)
  professionalStatus: 'Cadre' | 'Agent de maitrise' | 'Ouvrier';
  category: string;          // catégorie/échelon saisie manuellement (ex: "M1", "5e A")
  matricule?: string;        // matricule employé
  cnpsNumber?: string;       // numéro CNPS
  familySituation?: string;  // situation familiale (parts)
  parts?: number;            // nombre de parts fiscales
  logoUrl?: string;          // logo importé (data URL)
  avatarColor: string;
};

// Helper pour calculer le salaire total à partir des rubriques
export const computeSalary = (c: SalaryComponents): number =>
  c.baseSalary + c.sursalaire + c.seniority + c.housing + c.transport +
  c.representation + c.responsibility + c.performance + c.boisson + c.other;

export type Leave = {
  id: string;
  employeeId: string;
  type: 'Congé annuel' | 'Congé maladie' | 'Congé maternité' | 'RTT' | 'Congé sans solde';
  startDate: string;
  endDate: string;
  status: 'En attente' | 'Accepté' | 'Refusé';
  reason: string;
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

export type Presence = {
  id: string;
  employeeId: string;
  date: string;
  status: 'Présent' | 'Absent' | 'Congé' | 'Maladie' | 'Formation' | 'Non saisi';
  // Pour 'Absent' et 'Maladie' : justification
  justification?: 'Justifié' | 'Non justifié';
  // Pour 'Congé' et 'Formation' : durée en jours
  duree?: number;
  // Heures supplémentaires saisies manuellement (legacy = 15%)
  heuresSup?: number;
  // Heures supplémentaires par taux
  overtime?: OvertimeHours;
  notes?: string;
};

// ── SITES ───────────────────────────────────────────────────
export const sites: Site[] = [
  { id: 's1', name: 'Garage Central', address: '15 Rue de la République', city: 'Abidjan Plateau', phone: '+225 01 43 55 66 77', manager: 'Jean Dupont', capacity: 25 },
  { id: 's2', name: 'Garage Express Nord', address: '42 Avenue General de Gaulle', city: 'Yopougon', phone: '+225 01 42 34 56 78', manager: 'Sophie Martin', capacity: 20 },
  { id: 's3', name: 'Atelier Premium', address: '88 Boulevard de la Villette', city: 'Cocody', phone: '+225 01 40 36 47 58', manager: 'Karim Benali', capacity: 15 },
];

// Génère une répartition des rubriques de paie réaliste (Côte d'Ivoire)
function mkComponents(base: number, sursalaire: number, seniority: number, housing: number, transport: number, representation: number, resp: number, perf: number, boisson: number, other: number): SalaryComponents {
  return { baseSalary: base, sursalaire, seniority, housing, transport, representation, responsibility: resp, performance: perf, boisson, other };
}

// ── EMPLOYÉS ────────────────────────────────────────────────
const _emp = (
  id: string, firstName: string, lastName: string, email: string, phone: string,
  position: string, department: string, siteId: string, contractType: Employee['contractType'],
  startDate: string, status: Employee['status'], avatarColor: string, components: SalaryComponents,
  professionalStatus: Employee['professionalStatus'], category: string, matricule: string, cnpsNumber: string, parts: number
): Employee => ({ id, firstName, lastName, email, phone, position, department, siteId, contractType, startDate, status, avatarColor, components, salary: computeSalary(components), professionalStatus, category, matricule, cnpsNumber, parts, familySituation: 'Marié(e)' });

export const employees: Employee[] = [
  //    id     prénom    nom         email                    tél                   poste                     dept            site  contrat date         statut    couleur     base     sursal  ancien  logem   transp  repr    resp    perf    boiss   autre    statutPro          catég    matric    cnps        parts
  _emp('e1', 'Jean', 'Dupont', 'j.dupont@garage.ci', '+225 07 12 34 56 78', 'Manager de site', 'Direction', 's1', 'CDI', '2018-03-15', 'Actif', '#6366f1', mkComponents(1800000, 250000, 280000, 400000, 75000, 150000, 200000, 45000, 0, 0), 'Cadre', 'M1', '003777', '1800101712283', 3),
  _emp('e2', 'Sophie', 'Martin', 's.martin@garage.ci', '+225 07 23 45 67 89', "Chef d'atelier", 'Mécanique', 's1', 'CDI', '2019-06-01', 'Actif', '#8b5cf6', mkComponents(1550000, 150000, 195000, 300000, 75000, 0, 150000, 80000, 30000, 0), 'Cadre', 'M2', '003778', '1900201712284', 2),
  _emp('e3', 'Lucas', 'Bernard', 'l.bernard@garage.ci', '+225 07 34 56 78 90', 'Mécanicien', 'Mécanique', 's1', 'CDI', '2021-04-15', 'Actif', '#06b6d4', mkComponents(1250000, 80000, 90000, 200000, 50000, 0, 0, 160000, 30000, 0), 'Ouvrier', '5e A', '003779', '2100401712285', 1),
  _emp('e4', 'Claire', 'Petit', 'c.petit@garage.ci', '+225 07 45 67 89 01', 'Manager de site', 'Direction', 's2', 'CDI', '2020-09-01', 'Actif', '#f59e0b', mkComponents(1750000, 200000, 245000, 380000, 75000, 150000, 200000, 50000, 0, 0), 'Cadre', 'M1', '003780', '2000901712286', 4),
  _emp('e5', 'Thomas', 'Moreau', 't.moreau@garage.ci', '+225 07 56 78 90 12', 'Mécanicien', 'Mécanique', 's2', 'CDI', '2020-11-01', 'Actif', '#10b981', mkComponents(1400000, 100000, 130000, 250000, 50000, 0, 0, 150000, 30000, 0), 'Ouvrier', '6e B', '003781', '2011101712287', 2),
  _emp('e6', 'Emma', 'Laurent', 'e.laurent@garage.ci', '+225 07 67 89 01 23', 'Secrétaire', 'Administration', 's2', 'CDI', '2022-01-20', 'Actif', '#ec4899', mkComponents(950000, 60000, 70000, 150000, 50000, 0, 0, 130000, 0, 0), 'Agent de maitrise', '3e A', '003782', '2200101712288', 1),
  _emp('e7', 'Benoît', 'Leroy', 'b.leroy@garage.ci', '+225 07 78 90 12 34', 'Diagnosticien automobile', 'Mécanique', 's1', 'CDD', '2024-03-10', 'En congé', '#f97316', mkComponents(1450000, 90000, 0, 250000, 50000, 0, 100000, 70000, 0, 0), 'Agent de maitrise', '4e B', '003783', '2400301712289', 2),
  _emp('e8', 'Léa', 'Dubois', 'l.dubois@garage.ci', '+225 07 89 01 23 45', 'Apprentie mécanicienne', 'Mécanique', 's3', 'Stage', '2024-09-02', 'Actif', '#a855f7', mkComponents(600000, 0, 0, 100000, 50000, 0, 0, 0, 0, 0), 'Ouvrier', '1e A', '003784', '2400901712290', 1),
  _emp('e9', 'Antoine', 'Girard', 'a.girard@garage.ci', '+225 07 90 12 34 56', 'Vendeur pièces', 'Magasin', 's2', 'CDD', '2024-02-01', 'Actif', '#14b8a6', mkComponents(900000, 50000, 0, 150000, 50000, 0, 0, 130000, 0, 0), 'Ouvrier', '4e A', '003785', '2400201712291', 1),
  _emp('e10', 'Julie', 'Fournier', 'j.fournier@garage.ci', '+225 07 01 23 45 67', 'Comptable', 'Finance', 's1', 'CDI', '2019-08-01', 'Actif', '#e11d48', mkComponents(1300000, 120000, 175000, 250000, 50000, 0, 0, 75000, 0, 0), 'Agent de maitrise', '5e A', '003786', '1900801712292', 2),
  _emp('e11', 'Karim', 'Benali', 'k.benali@garage.ci', '+225 07 12 11 22 33', 'Responsable atelier premium', 'Mécanique', 's3', 'CDI', '2021-05-15', 'Actif', '#fbbf24', mkComponents(1600000, 180000, 165000, 350000, 75000, 100000, 180000, 80000, 30000, 0), 'Cadre', 'M2', '003787', '2100501712293', 3),
  _emp('e12', 'Clara', 'Rousseau', 'c.rousseau@garage.ci', '+225 07 33 44 55 66', 'Carrossière', 'Carrosserie', 's3', 'CDI', '2022-09-01', 'Actif', '#22c55e', mkComponents(1150000, 80000, 90000, 200000, 50000, 0, 0, 100000, 30000, 0), 'Ouvrier', '6e A', '003788', '2200901712294', 2),
];

// ── CONGÉS ────────────────────────────────────────────────
export const leaves: Leave[] = [
  { id: 'l1', employeeId: 'e7', type: 'Congé annuel', startDate: '2025-07-14', endDate: '2025-07-28', status: 'Accepté', reason: 'Vacances d été' },
  { id: 'l2', employeeId: 'e2', type: 'Congé annuel', startDate: '2025-08-01', endDate: '2025-08-14', status: 'En attente', reason: 'Vacances été' },
  { id: 'l3', employeeId: 'e1', type: 'RTT', startDate: '2025-08-21', endDate: '2025-08-21', status: 'En attente', reason: 'Démarches administratives' },
  { id: 'l4', employeeId: 'e8', type: 'Congé annuel', startDate: '2025-08-17', endDate: '2025-08-29', status: 'Refusé', reason: 'Période chargée en atelier' },
  { id: 'l5', employeeId: 'e6', type: 'Congé maladie', startDate: '2025-06-10', endDate: '2025-06-18', status: 'Accepté', reason: 'Arrêt maladie' },
];

// ── CONTRATS (gardés en interne) ─────────────────────────────
export const contracts: Contract[] = [
  { id: 'c1', employeeId: 'e1', type: 'CDI', startDate: '2018-03-15', endDate: null, documentUrl: '/docs/cdi_dupont.pdf', notes: 'CDI depuis 2018' },
  { id: 'c2', employeeId: 'e2', type: 'CDI', startDate: '2019-06-01', endDate: null, documentUrl: '/docs/cdi_martin.pdf', notes: '' },
  { id: 'c3', employeeId: 'e8', type: 'Stage', startDate: '2024-09-02', endDate: '2025-08-29', documentUrl: '/docs/stage_dubois.pdf', notes: 'Apprentissage 1 an' },
  { id: 'c4', employeeId: 'e9', type: 'CDD', startDate: '2024-02-01', endDate: '2025-01-31', documentUrl: '/docs/cdd_girard.pdf', notes: 'CDD remplacement' },
  { id: 'c5', employeeId: 'e7', type: 'CDD', startDate: '2024-03-10', endDate: '2025-03-09', documentUrl: '/docs/cdd_leroy.pdf', notes: '' },
];

// ── PRÉSENCES ──────────────────────────────────────────────
export const presences: Presence[] = [
  // Jour exemple : 02/06/2025
  { id: 'p1', employeeId: 'e1', date: '2025-06-02', status: 'Présent', overtime: { h15: 2, h50: 0, h75: 0, h100: 0, h200: 0 } },
  { id: 'p2', employeeId: 'e2', date: '2025-06-02', status: 'Présent', overtime: { h15: 0, h50: 2, h75: 0, h100: 0, h200: 0 } },
  { id: 'p3', employeeId: 'e3', date: '2025-06-02', status: 'Présent', overtime: { h15: 1, h50: 0, h75: 1, h100: 0, h200: 0 } },
  { id: 'p4', employeeId: 'e4', date: '2025-06-02', status: 'Présent' },
  { id: 'p5', employeeId: 'e5', date: '2025-06-02', status: 'Absent', justification: 'Non justifié' },
  { id: 'p6', employeeId: 'e6', date: '2025-06-02', status: 'Présent' },
  { id: 'p7', employeeId: 'e7', date: '2025-06-02', status: 'Congé', duree: 5 },
  { id: 'p8', employeeId: 'e8', date: '2025-06-02', status: 'Présent' },
  { id: 'p9', employeeId: 'e9', date: '2025-06-02', status: 'Présent' },
  { id: 'p10', employeeId: 'e10', date: '2025-06-02', status: 'Présent' },
  { id: 'p11', employeeId: 'e11', date: '2025-06-02', status: 'Maladie', justification: 'Justifié' },
  { id: 'p12', employeeId: 'e12', date: '2025-06-02', status: 'Formation', duree: 3 },

  // Autre jour : 03/06/2025
  { id: 'p13', employeeId: 'e1', date: '2025-06-03', status: 'Présent' },
  { id: 'p14', employeeId: 'e2', date: '2025-06-03', status: 'Présent', heuresSup: 3 },
  { id: 'p15', employeeId: 'e3', date: '2025-06-03', status: 'Absent', justification: 'Justifié' },
  { id: 'p16', employeeId: 'e7', date: '2025-06-03', status: 'Congé', duree: 5 },
  { id: 'p17', employeeId: 'e11', date: '2025-06-03', status: 'Maladie', justification: 'Justifié' },
  { id: 'p18', employeeId: 'e12', date: '2025-06-03', status: 'Formation', duree: 3 },
  { id: 'p19', employeeId: 'e5', date: '2025-06-03', status: 'Absent', justification: 'Non justifié' },

  // Autre jour : 04/06/2025
  { id: 'p20', employeeId: 'e1', date: '2025-06-04', status: 'Présent' },
  { id: 'p21', employeeId: 'e5', date: '2025-06-04', status: 'Absent', justification: 'Non justifié' },
  { id: 'p22', employeeId: 'e6', date: '2025-06-04', status: 'Présent', heuresSup: 2 },
];
