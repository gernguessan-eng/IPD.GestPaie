// ─────────────────────────────────────────────────────────────────────────
// Export multi-format (CSV / Excel / PDF) + sélection de colonnes réutilisables
// ─────────────────────────────────────────────────────────────────────────
// Ce module est indépendant de toute page précise : on lui donne une liste de
// colonnes {key,label} et des lignes de données {[key]: valeur}, il s'occupe
// de générer le fichier. Utilisé par Employés, Paie, Livre de paie (fin
// d'année) et Charges sociales.
import { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export type ExportColumn = { key: string; label: string };
export type ExportRow = Record<string, string | number | null | undefined>;

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportCSV(filename: string, columns: ExportColumn[], rows: ExportRow[]) {
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [
    columns.map(c => esc(c.label)).join(';'),
    ...rows.map(r => columns.map(c => esc(r[c.key])).join(';')),
  ];
  const csv = '\uFEFF' + lines.join('\r\n'); // BOM pour un affichage correct des accents dans Excel
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), filename);
}

export function exportXLSX(filename: string, sheetName: string, columns: ExportColumn[], rows: ExportRow[]) {
  const data = [columns.map(c => c.label), ...rows.map(r => columns.map(c => r[c.key] ?? ''))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = columns.map(c => ({ wch: Math.max(10, c.label.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31)); // limite Excel : 31 caractères
  XLSX.writeFile(wb, filename);
}

export function exportPDF(filename: string, title: string, columns: ExportColumn[], rows: ExportRow[]) {
  const doc = new jsPDF({ orientation: columns.length > 8 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  doc.setFontSize(12);
  doc.text(title, 24, 24);
  autoTable(doc, {
    head: [columns.map(c => c.label)],
    body: rows.map(r => columns.map(c => String(r[c.key] ?? ''))),
    startY: 34,
    styles: { fontSize: 7, cellPadding: 3 },
    headStyles: { fillColor: [49, 147, 62] }, // vert de la marque
    margin: { left: 20, right: 20 },
  });
  doc.save(filename);
}

function DownloadIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>;
}
function PrintIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></svg>;
}

// Fenêtre modale partagée : choix des colonnes à inclure, puis choix du format
// (CSV / Excel / PDF / Impression). "onPrint" reçoit l'ensemble des clés de
// colonnes à MASQUER (celles décochées), pour être injecté dans une feuille de
// style d'impression ciblant les colonnes par position.
export function ExportModal({ title, columns, buildRows, onClose, onPrint }: {
  title: string;
  columns: ExportColumn[];
  buildRows: () => ExportRow[];
  onClose: () => void;
  onPrint?: (hiddenKeys: Set<string>) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(columns.map(c => c.key)));

  const toggle = (key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const allChecked = selected.size === columns.length;
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(columns.map(c => c.key)));

  const hiddenKeys = useMemo(() => new Set(columns.filter(c => !selected.has(c.key)).map(c => c.key)), [columns, selected]);
  const activeColumns = columns.filter(c => selected.has(c.key));

  const filenameBase = title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const dateSuffix = new Date().toISOString().slice(0, 10);

  const doExport = (fmt: 'csv' | 'xlsx' | 'pdf') => {
    if (!activeColumns.length) { alert('Sélectionnez au moins une colonne.'); return; }
    const rows = buildRows();
    if (fmt === 'csv') exportCSV(`${filenameBase}_${dateSuffix}.csv`, activeColumns, rows);
    if (fmt === 'xlsx') exportXLSX(`${filenameBase}_${dateSuffix}.xlsx`, title, activeColumns, rows);
    if (fmt === 'pdf') exportPDF(`${filenameBase}_${dateSuffix}.pdf`, title, activeColumns, rows);
    onClose();
  };

  const doPrint = () => {
    if (!activeColumns.length) { alert('Sélectionnez au moins une colonne.'); return; }
    onPrint?.(hiddenKeys);
    onClose();
    setTimeout(() => window.print(), 50);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800">Exporter / Imprimer — {title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-slate-600">Colonnes à inclure</p>
            <button onClick={toggleAll} className="text-[11px] font-semibold text-orange-600 hover:underline">
              {allChecked ? 'Tout décocher' : 'Tout cocher'}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {columns.map(c => (
              <label key={c.key} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input type="checkbox" checked={selected.has(c.key)} onChange={() => toggle(c.key)}
                  className="rounded border-slate-300 text-orange-600 focus:ring-orange-400" />
                {c.label}
              </label>
            ))}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-100 space-y-2">
          <p className="text-[11px] font-bold text-slate-500 uppercase">Format</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => doExport('csv')} className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold border border-slate-200 rounded-xl hover:bg-slate-50">
              <DownloadIcon /> CSV
            </button>
            <button onClick={() => doExport('xlsx')} className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold border border-slate-200 rounded-xl hover:bg-slate-50">
              <DownloadIcon /> Excel (.xlsx)
            </button>
            <button onClick={() => doExport('pdf')} className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold border border-slate-200 rounded-xl hover:bg-slate-50">
              <DownloadIcon /> PDF
            </button>
            <button onClick={doPrint} className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold bg-orange-500 hover:bg-orange-600 text-white rounded-xl">
              <PrintIcon /> Imprimer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Injecte une feuille de style d'impression qui masque, par POSITION (nth-child),
// les colonnes décochées d'un tableau identifié par sa classe CSS. Se retire
// automatiquement après l'impression (événement "afterprint").
export function applyPrintColumnFilter(tableClass: string, columnOrder: string[], hiddenKeys: Set<string>) {
  const styleEl = document.createElement('style');
  styleEl.id = 'print-column-filter';
  const rules = columnOrder
    .map((key, i) => (hiddenKeys.has(key) ? i + 1 : null))
    .filter((n): n is number => n !== null)
    .map(n => `.${tableClass} th:nth-child(${n}), .${tableClass} td:nth-child(${n}) { display: none !important; }`)
    .join('\n');
  styleEl.textContent = `@media print { ${rules} }`;
  document.head.appendChild(styleEl);
  const cleanup = () => { styleEl.remove(); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
}
