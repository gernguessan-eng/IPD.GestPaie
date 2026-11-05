/**
 * Export générique « ce que je vois à l'écran » : lit les tableaux affichés par la page active
 * (ou des tableaux construits à partir des données) et les convertit en .xlsx ou .csv.
 * Utilisé par le bouton « Exporter » de la barre du haut.
 */
import { buildXlsxBlob, type XCell } from './xlsx';

export type ExportCell = string | number;
export interface ExportTable {
  /** Titre affiché au-dessus du tableau (ex. « Livre de paie — du … au … »). */
  title?: string;
  headers: string[];
  rows: ExportCell[][];
  /** Nombre de lignes finales (totaux) mises en évidence, en fin de `rows`. */
  footerCount?: number;
}

/* ─── Lecture d'un tableau HTML affiché à l'écran ─────────── */

// Texte d'une cellule : les retours à la ligne visuels (<br>, <p>) deviennent " · ",
// les champs de saisie sont remplacés par leur valeur, les éléments marqués
// data-export-skip (pastilles d'initiales, icônes…) sont ignorés.
function cellText(cell: HTMLElement): string | number {
  // Cellule de saisie (ex. « Jours payés ») : seule la valeur saisie compte, pas le « /30 » voisin.
  const input = cell.querySelector('input') as HTMLInputElement | null;
  if (input && input.type !== 'checkbox') return parseNumber((input.value || '').trim());
  const clone = cell.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[data-export-skip], svg, script, style').forEach(n => n.remove());
  clone.querySelectorAll('input, select, textarea').forEach(n => {
    const el = n as HTMLInputElement;
    n.replaceWith(document.createTextNode(el.value ?? ''));
  });
  clone.querySelectorAll('br').forEach(n => n.replaceWith(document.createTextNode(' · ')));
  const parts: string[] = [];
  clone.querySelectorAll('p').forEach(p => { const t = (p.textContent || '').replace(/\s+/g, ' ').trim(); if (t) parts.push(t); });
  const text = (parts.length ? parts.join(' · ') : (clone.textContent || '')).replace(/\s+/g, ' ').trim();
  return parseNumber(text);
}

// "3 039 000", "3 039 000 FCFA", "-1 200" → nombre. Les identifiants (matricule "003777",
// n° CNPS à 13 chiffres…) restent du texte pour ne pas perdre leurs zéros initiaux.
function parseNumber(text: string): string | number {
  const t = text.replace(/\s*FCFA$/i, '').trim();
  if (!/^-?\d[\d\s  ]*(,\d+)?$/.test(t)) return text;
  const digits = t.replace(/[\s  ]/g, '');
  const intPart = digits.replace(/^-/, '').split(',')[0];
  if (intPart.length > 1 && intPart.startsWith('0') && !digits.includes(',')) return text;
  if (intPart.length > 12) return text;
  const n = Number(digits.replace(',', '.'));
  return Number.isFinite(n) ? n : text;
}

/** Tableaux visibles d'un conteneur (en ignorant ceux d'une fenêtre modale ouverte). */
export function extractTables(root: HTMLElement): ExportTable[] {
  const result: ExportTable[] = [];
  root.querySelectorAll('table').forEach(table => {
    if (table.closest('.print-root')) return;
    const title = table.closest('.rounded-2xl')?.querySelector('h3')?.textContent?.replace(/\s+/g, ' ').trim() || undefined;

    const grid = (tr: Element): ExportCell[] => {
      const out: ExportCell[] = [];
      tr.querySelectorAll(':scope > th, :scope > td').forEach(c => {
        const span = Math.max(1, (c as HTMLTableCellElement).colSpan || 1);
        out.push(cellText(c as HTMLElement));
        for (let k = 1; k < span; k++) out.push('');
      });
      return out;
    };

    const headerRow = table.querySelector('thead tr');
    const headers = headerRow ? grid(headerRow).map(String) : [];
    const rows: ExportCell[][] = [];
    table.querySelectorAll('tbody tr').forEach(tr => rows.push(grid(tr)));
    // Ligne « Aucun résultat / Aucun employé » : pas de vraie donnée.
    if (rows.length === 1 && rows[0].filter(v => v !== '').length === 1 && /^aucun/i.test(String(rows[0][0]))) rows.length = 0;
    let footerCount = 0;
    table.querySelectorAll('tfoot tr').forEach(tr => { rows.push(grid(tr)); footerCount++; });

    // Colonnes à supprimer : « Actions » (boutons) et colonnes entièrement vides sans titre.
    const width = Math.max(headers.length, ...rows.map(r => r.length), 0);
    const keep: number[] = [];
    for (let c = 0; c < width; c++) {
      const h = (headers[c] || '').trim();
      const empty = rows.every(r => (r[c] ?? '') === '');
      if (/^actions?$/i.test(h)) continue;
      if (h === '' && empty) continue;
      keep.push(c);
    }
    result.push({
      title,
      headers: keep.map(c => headers[c] || ''),
      rows: rows.map(r => keep.map(c => r[c] ?? '')),
      footerCount,
    });
  });
  return result;
}

/* ─── Conversion en .xlsx ─────────────────────────────────── */

export function tablesToXlsxBlob(pageTitle: string, tables: ExportTable[]): Blob {
  const colCount = Math.max(1, ...tables.map(t => t.headers.length));
  const widths = new Array<number>(colCount).fill(8);
  const bump = (i: number, text: string, cap = 36) => {
    widths[i] = Math.max(widths[i], Math.min(cap, text.length + 3));
  };

  const rows: XCell[][] = [];
  rows.push([{ v: pageTitle, s: 'title', span: colCount }]);
  tables.forEach((t, ti) => {
    rows.push([{ span: colCount }]);
    if (t.title && t.title !== pageTitle) rows.push([{ v: t.title, s: 'bold', span: colCount }]);
    rows.push(t.headers.map(h => ({ v: h, s: 'header' as const })));
    t.headers.forEach((h, i) => bump(i, h.length > 14 ? h.slice(0, Math.ceil(h.length / 2)) : h, 22));
    const firstFooter = t.rows.length - (t.footerCount || 0);
    t.rows.forEach((r, ri) => {
      const foot = ri >= firstFooter;
      rows.push(r.map((v, i) => {
        if (typeof v === 'number') { bump(i, v.toLocaleString('fr-FR'), 20); return { v, s: foot ? 'totNum' as const : 'num' as const }; }
        bump(i, v);
        return { v, s: foot ? 'totLabel' as const : 'text' as const };
      }));
    });
    if (ti < tables.length - 1) rows.push([{ span: colCount }]);
  });

  return buildXlsxBlob({
    sheetName: pageTitle,
    colWidths: widths,
    rows,
    orientation: colCount > 6 ? 'landscape' : 'portrait',
    fitToHeight: 0, // largeur ajustée sur 1 page ; autant de pages que nécessaire en hauteur
  });
}

/* ─── Conversion en .csv ──────────────────────────────────── */

export function tablesToCsv(pageTitle: string, tables: ExportTable[]): string {
  const lines: string[] = [];
  const line = (cells: ExportCell[]) => lines.push(cells.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';'));
  line([pageTitle]);
  tables.forEach(t => {
    line(['']);
    if (t.title && t.title !== pageTitle) line([t.title]);
    line(t.headers);
    t.rows.forEach(r => line(r));
  });
  return lines.join('\r\n');
}
