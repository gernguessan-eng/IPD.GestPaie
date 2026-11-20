/**
 * « Solde de tout compte » — calculs et export Excel, au modèle exact du fichier fourni
 * (feuille « Solde de tout compte » : allocation de congé, méthode des 5 derniers mois,
 * jours de congé acquis, indemnité de congé payé, gratification).
 *
 * Les formules reproduisent celles du classeur d'origine, cellule par cellule :
 *   C12 =C11 · C14 =(C13-C12)/30 · C15 =C14/12 · D24 =(D22-D20)/30 · C42 =SOMME(C29:C41)
 *   C44 =C42/5 · C45 =C44/30 · D49 =D24*2,2 · D50 =D49*1,25 · D52 =D50-D51
 *   D56 =C45*D52 · C61 =ENT(D22-D20) · B62 =salaire de base*0,75*C61/365
 */
import { zipStore, XLSX_MIME, type XImage } from './xlsx';
import { SOLDE_TEMPLATE_PARTS, SOLDE_CELL_STYLES } from './soldeTemplate';

export const MOIS_ROWS = 13; // lignes B29:C41 du tableau « Période / Salaire brut »

export interface SoldeMois { ym: string; brut: number }       // ym = 'YYYY-MM' ('' = ligne vide)
export interface SoldeForm {
  title: string;              // « M NOM PRÉNOMS » (ligne de titre)
  dateEmbauche: string;       // 'YYYY-MM-DD'
  dateRetourConge: string;    // '' = identique à la date d'embauche (C12 = C11)
  dateDepart: string;
  mois: SoldeMois[];          // toujours MOIS_ROWS lignes
  permission: number;         // permission à déduire du congé (D51)
  salaireBase: number;        // salaire de base retenu pour la gratification (B62)
  anneeGratif: string;        // '' = date de retour du dernier congé (B60)
  refConge: number;           // montant de comparaison (E56 = D56 − montant) — 0 = non affiché
  refGratif: number;          // montant de comparaison (C62 = B62 − montant) — 0 = non affiché
}

export const emptyMois = (): SoldeMois[] => Array.from({ length: MOIS_ROWS }, () => ({ ym: '', brut: 0 }));
export const emptyForm = (): SoldeForm => ({
  title: '', dateEmbauche: '', dateRetourConge: '', dateDepart: '', mois: emptyMois(),
  permission: 0, salaireBase: 0, anneeGratif: '', refConge: 0, refGratif: 0,
});

/** Enregistrement Firestore (collection « soldes », un document par employé). */
export interface SoldeRecord extends SoldeForm { id: string; employeeId: string; updatedAt: string }

/* ─── Dates ─────────────────────────────────────────────── */
const DAY = 86400000;
function dayNum(d: string): number {           // jours depuis 1970 (UTC), NaN si vide/invalide
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return NaN;
  const [y, m, j] = d.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, j) / DAY);
}
const toSerial = (d: string): number => dayNum(d) + 25569;   // numéro de série Excel (1900)
const ymToDate = (ym: string): string => (/^\d{4}-\d{2}$/.test(ym) ? `${ym}-01` : '');

/* ─── Calculs ───────────────────────────────────────────── */
export interface SoldeCalc {
  ok: boolean;                 // dates d'embauche et de départ renseignées
  dateRetour: string;          // date de retour du dernier congé effective (C12)
  ancMois: number; ancAn: number;
  periodeRef: number;          // D24
  nbMois: number; total: number; moyMensuel: number; moyJour: number;
  joursOuvrables: number; joursCalendaires: number; joursNets: number;
  congePaye: number; ecartConge: number | null;
  joursPresence: number; gratification: number; ecartGratif: number | null;
  anneeGratifDate: string;     // B60
  methodeLabel: string;        // A26
  gratifLabel: string;         // A59
}

export function computeSolde(f: SoldeForm): SoldeCalc {
  const dateRetour = f.dateRetourConge || f.dateEmbauche;
  const dep = dayNum(f.dateDepart), ret = dayNum(dateRetour);
  const ok = Number.isFinite(dayNum(f.dateEmbauche)) && Number.isFinite(dep) && Number.isFinite(ret);
  const diff = ok ? dep - ret : 0;
  const ancMois = diff / 30;                                  // C14
  const periodeRef = ancMois;                                 // D24 = (D22−D20)/30
  const rows = f.mois.filter(m => m.ym && m.brut > 0);
  const nbMois = rows.length;
  const total = f.mois.reduce((a, m) => a + (m.brut || 0), 0); // C42
  const moyMensuel = nbMois ? total / nbMois : 0;             // C44 (modèle : /5)
  const moyJour = moyMensuel / 30;                            // C45
  const joursOuvrables = periodeRef * 2.2;                    // D49
  const joursCalendaires = joursOuvrables * 1.25;             // D50
  const joursNets = joursCalendaires - (f.permission || 0);   // D52
  const congePaye = moyJour * joursNets;                      // D56
  const joursPresence = Math.trunc(diff);                     // C61
  const gratification = (f.salaireBase || 0) * 0.75 * joursPresence / 365; // B62
  const annee = dep && Number.isFinite(dep) ? new Date(dep * DAY).getUTCFullYear() : '';
  return {
    ok, dateRetour, ancMois, ancAn: ancMois / 12, periodeRef, nbMois, total, moyMensuel, moyJour,
    joursOuvrables, joursCalendaires, joursNets, congePaye,
    ecartConge: f.refConge > 0 ? congePaye - f.refConge : null,
    joursPresence, gratification,
    ecartGratif: f.refGratif > 0 ? gratification - f.refGratif : null,
    anneeGratifDate: f.anneeGratif || dateRetour,
    methodeLabel: `b) Détermination du salaire moyen journalier (Méthode des ${nbMois || 5} ${nbMois === 1 ? 'dernier mois' : 'derniers mois'})`,
    gratifLabel: `Gratification = Salaire de base x 75% x Nombre de jours de présence en ${annee}`,
  };
}

/* ─── Formats d'affichage (identiques à ceux du modèle) ─── */
const NBSP_RE = /[  ]/g;
export function fmtInt(n: number): string {                    // #,##0 (arrondi à l'affichage seulement)
  if (!Number.isFinite(n)) return '';
  return Math.round(n).toLocaleString('fr-FR').replace(NBSP_RE, ' ');
}
export function fmtDec1(n: number): string {                   // #,##0.0
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).replace(NBSP_RE, ' ');
}
export function fmtDate(d: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '';
}
const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export function fmtMonth(ym: string): string {                // mmmm-yy
  return /^\d{4}-\d{2}$/.test(ym) ? `${MOIS_FR[Number(ym.slice(5)) - 1]}-${ym.slice(2, 4)}` : '';
}

/* ─── Export Excel : le fichier modèle, rempli ──────────── */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n: number) => String(Number.isFinite(n) ? +n.toPrecision(15) : 0);

export function buildSoldeXlsx(f: SoldeForm, logo: XImage | null): Blob {
  const c = computeSolde(f);
  const S = SOLDE_CELL_STYLES;
  const blank = (ref: string) => `<c r="${ref}" s="${S[ref]}"/>`;
  const text = (ref: string, t: string) => `<c r="${ref}" s="${S[ref]}" t="inlineStr"><is><t xml:space="preserve">${esc(t)}</t></is></c>`;
  // Cellule numérique ; `formula` (sans « = ») est conservée pour que le classeur reste « vivant » dans Excel.
  const val = (ref: string, v: number, formula?: string) =>
    Number.isFinite(v) ? `<c r="${ref}" s="${S[ref]}">${formula ? `<f>${esc(formula)}</f>` : ''}<v>${num(v)}</v></c>` : blank(ref);

  const ret = c.ok;
  const cells: Record<string, string> = {
    A9: text('A9', `SOLDE DE TOUT COMPTE : ${f.title}`.trimEnd()),
    C11: val('C11', toSerial(f.dateEmbauche)),
    C12: f.dateRetourConge ? val('C12', toSerial(f.dateRetourConge)) : val('C12', toSerial(f.dateEmbauche), '+C11'),
    C13: val('C13', toSerial(f.dateDepart)),
    C14: ret ? val('C14', c.ancMois, '(C13-C12)/30') : blank('C14'),
    C15: ret ? val('C15', c.ancAn, '+C14/12') : blank('C15'),
    D20: ret ? val('D20', toSerial(c.dateRetour), '+C12') : blank('D20'),
    D22: ret ? val('D22', toSerial(f.dateDepart), '+C13') : blank('D22'),
    D24: ret ? val('D24', c.periodeRef, '(D22-D20)/30') : blank('D24'),
    A26: text('A26', c.methodeLabel),
    C42: val('C42', c.total, 'SUM(C29:C41)'),
    C44: c.nbMois ? val('C44', c.moyMensuel, `C42/${c.nbMois}`) : blank('C44'),
    C45: c.nbMois ? val('C45', c.moyJour, 'C44/30') : blank('C45'),
    D49: ret ? val('D49', c.joursOuvrables, '+D24*2.2') : blank('D49'),
    D50: ret ? val('D50', c.joursCalendaires, 'D49*1.25') : blank('D50'),
    D51: val('D51', f.permission || 0),
    D52: ret ? val('D52', c.joursNets, '+D50-D51') : blank('D52'),
    D56: ret && c.nbMois ? val('D56', c.congePaye, 'C45*D52') : blank('D56'),
    E56: c.ecartConge !== null && ret && c.nbMois ? val('E56', c.ecartConge, `+D56-${num(f.refConge)}`) : blank('E56'),
    A59: text('A59', c.gratifLabel),
    B60: val('B60', toSerial(c.anneeGratifDate)),
    C61: ret ? val('C61', c.joursPresence, 'TRUNC(D22-D20)') : blank('C61'),
    B62: ret && f.salaireBase > 0 ? val('B62', c.gratification, `${num(f.salaireBase)}*0.75*C61/365`) : blank('B62'),
    C62: c.ecartGratif !== null && ret && f.salaireBase > 0 ? val('C62', c.ecartGratif, `+B62-${num(f.refGratif)}`) : blank('C62'),
  };
  for (let i = 0; i < MOIS_ROWS; i++) {
    const m = f.mois[i] || { ym: '', brut: 0 };
    cells[`B${29 + i}`] = m.ym ? val(`B${29 + i}`, toSerial(ymToDate(m.ym))) : blank(`B${29 + i}`);
    cells[`C${29 + i}`] = m.ym || m.brut ? val(`C${29 + i}`, m.brut || 0) : blank(`C${29 + i}`);
  }

  const parts = { ...SOLDE_TEMPLATE_PARTS };
  parts['xl/worksheets/sheet1.xml'] = parts['xl/worksheets/sheet1.xml'].replace(/@@([A-Z]+\d+)@@/g, (_, ref) => cells[ref] ?? blank(ref));
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  parts['docProps/core.xml'] = parts['docProps/core.xml'].replace(/@@NOW@@/g, now);

  const files: { name: string; data: Uint8Array }[] = [];
  const enc = new TextEncoder();
  if (logo) {
    // Logo contenu dans l'emplacement du modèle (≈ 3 124 200 × 1 381 125 EMU), proportions conservées.
    const ratio = Math.min(3124200 / logo.width, 1381125 / logo.height);
    const cx = Math.round(logo.width * ratio), cy = Math.round(logo.height * ratio);
    const ext = logo.ext === 'png' ? 'png' : 'jpg';
    parts['xl/drawings/drawing1.xml'] = parts['xl/drawings/drawing1.xml'].replace(/@@CX@@/g, String(cx)).replace(/@@CY@@/g, String(cy));
    parts['xl/drawings/_rels/drawing1.xml.rels'] = parts['xl/drawings/_rels/drawing1.xml.rels'].replace('image1.jpg', `image1.${ext}`);
    files.push({ name: `xl/media/image1.${ext}`, data: logo.data });
  } else {
    delete parts['xl/drawings/drawing1.xml'];
    delete parts['xl/drawings/_rels/drawing1.xml.rels'];
    delete parts['xl/worksheets/_rels/sheet1.xml.rels'];
    parts['xl/worksheets/sheet1.xml'] = parts['xl/worksheets/sheet1.xml'].replace('<drawing r:id="rId2"/>', '');
    parts['[Content_Types].xml'] = parts['[Content_Types].xml'].replace('<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>', '');
  }
  // [Content_Types].xml doit rester en tête de l'archive
  const xmlFiles = Object.keys(parts).sort((x, y) => (x === '[Content_Types].xml' ? -1 : y === '[Content_Types].xml' ? 1 : 0))
    .map(name => ({ name, data: enc.encode(parts[name]) }));
  files.unshift(...xmlFiles);
  const zipped = zipStore(files);
  return new Blob([zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer], { type: XLSX_MIME });
}

/** Lignes « libellé ; valeur » du document, pour l'export CSV. */
export function soldeCsvLines(f: SoldeForm): string[][] {
  const c = computeSolde(f);
  const L: string[][] = [
    [`SOLDE DE TOUT COMPTE : ${f.title}`],
    [''],
    ["Date d'embauche", fmtDate(f.dateEmbauche)],
    ['Date de retour de dernier congé', fmtDate(c.dateRetour)],
    ['Date de départ', fmtDate(f.dateDepart)],
    ['Ancienneté (en mois)', c.ok ? fmtInt(c.ancMois) : ''],
    ['Ancienneté (en année)', c.ok ? fmtDec1(c.ancAn) : ''],
    [''],
    ["1-Détermination de l'allocation congé"],
    ['Période de référence (en mois)', c.ok ? fmtInt(c.periodeRef) : ''],
    [c.methodeLabel],
    ['Période', 'Salaire brut'],
    ...f.mois.filter(m => m.ym || m.brut).map(m => [fmtMonth(m.ym), String(m.brut || 0)]),
    ['TOTAL', String(c.total)],
    ['Salaire Moyen Mensuel', fmtInt(c.moyMensuel)],
    ['Salaire moyen journalier', fmtInt(c.moyJour)],
    ['Nombre de jours ouvrables', fmtInt(c.joursOuvrables)],
    ['Période calendaire (jours de congé acquis)', fmtInt(c.joursCalendaires)],
    ['Permission à déduire de congé', String(f.permission || 0)],
    ['Période calendaire (jours de congé net acquis)', fmtInt(c.joursNets)],
    ['Congé payé', fmtInt(c.congePaye)],
    [''],
    ['2-Détermination de la gratification'],
    [c.gratifLabel],
    ['Nombre de jours de présence de gratification', String(c.joursPresence)],
    ['Gratification', fmtInt(c.gratification)],
  ];
  return L;
}
