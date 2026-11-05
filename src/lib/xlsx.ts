/**
 * Générateur minimal de classeur Excel « .xlsx » (Office Open XML), sans dépendance externe.
 *
 * Pourquoi un vrai .xlsx plutôt qu'un tableau HTML renommé en .xls ?
 *  - Excel traite un « HTML déguisé en .xls » comme une page web : la boîte « Enregistrer sous »
 *    propose alors « Page Web » au lieu du format Excel, et la mise en page à l'impression
 *    (nombre de pages, orientation, mise à l'échelle) n'est pas maîtrisable.
 *  - Un vrai .xlsx est reconnu comme classeur Excel, et on y déclare « Ajuster à 1 page en
 *    largeur et 1 page en hauteur » : le bulletin tient toujours sur UNE seule page.
 *
 * Le fichier produit contient : une feuille, des styles (gras, bordures, fonds, formats de
 * nombres), des cellules fusionnées, des largeurs de colonnes, et la configuration d'impression.
 * Les nombres sont de vrais nombres (calculables), pas du texte.
 */

export type XStyle =
  | 'default' | 'title' | 'bold' | 'header' | 'text' | 'textC'
  | 'num' | 'totLabel' | 'totNum' | 'net' | 'label';

export interface XCell {
  /** Texte ou nombre ; vide/null/undefined = cellule vide (mais stylée). */
  v?: string | number | null;
  s?: XStyle;
  /** Nombre de colonnes occupées (fusion horizontale). */
  span?: number;
}

export interface XlsxOptions {
  sheetName: string;
  colWidths: number[];
  rows: XCell[][];
  orientation?: 'portrait' | 'landscape';
  /** Nombre de pages en hauteur (1 = tout sur une page ; 0 = automatique, tableaux longs). */
  fitToHeight?: number;
}

// Index de style (cellXfs) — doit rester synchronisé avec STYLES_XML ci-dessous.
const STYLE_INDEX: Record<XStyle, number> = {
  default: 0, title: 1, bold: 2, header: 3, text: 4, textC: 5,
  num: 6, totLabel: 7, totNum: 8, net: 9, label: 10,
};

const BORDER = '<border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border>';

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0&quot; FCFA&quot;"/></numFmts>
<fonts count="3">
<font><sz val="10"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="10"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
${BORDER}
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="11">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="3" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="164" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/* ─── Utilitaires XML ─────────────────────────────────────── */

// Retire les caractères de contrôle interdits en XML 1.0, puis échappe les caractères spéciaux.
function xmlEsc(v: string): string {
  return v
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 0 → A, 25 → Z, 26 → AA …
function colName(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// Le nom d'une feuille : 31 caractères max, sans  : \ / ? * [ ]
function safeSheetName(name: string): string {
  const n = name.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31);
  return n || 'Feuille1';
}

/* ─── Feuille de calcul ───────────────────────────────────── */

function buildSheetXml(opts: XlsxOptions): string {
  const { colWidths, rows, orientation = 'portrait', fitToHeight = 1 } = opts;
  const merges: string[] = [];

  const sheetRows = rows.map((cells, rIdx) => {
    const r = rIdx + 1;
    let col = 0;
    let xml = '';
    for (const cell of cells) {
      const style = STYLE_INDEX[cell.s ?? 'default'];
      const span = Math.max(1, cell.span ?? 1);
      const ref = `${colName(col)}${r}`;
      const v = cell.v;
      if (typeof v === 'number' && Number.isFinite(v)) {
        xml += `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
      } else if (typeof v === 'string' && v !== '') {
        xml += `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
      } else {
        xml += `<c r="${ref}" s="${style}"/>`;
      }
      if (span > 1) {
        // Les autres cellules de la zone fusionnée portent le même style (bordures/fond cohérents).
        for (let k = 1; k < span; k++) xml += `<c r="${colName(col + k)}${r}" s="${style}"/>`;
        merges.push(`${ref}:${colName(col + span - 1)}${r}`);
      }
      col += span;
    }
    return `<row r="${r}">${xml}</row>`;
  });

  const cols = colWidths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('');
  const lastCol = colName(Math.max(colWidths.length, 1) - 1);
  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${lastCol}${Math.max(rows.length, 1)}"/>
<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${sheetRows.join('')}</sheetData>
${mergeXml}
<printOptions horizontalCentered="1"/>
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="${orientation}" fitToWidth="1" fitToHeight="${fitToHeight}"/>
</worksheet>`;
}

/* ─── Archive ZIP (méthode « stockée », sans compression) ─── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = (Math.max(now.getFullYear() - 1980, 0) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const enc = new TextEncoder();

  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const u16 = (v: DataView, o: number, n: number) => v.setUint16(o, n, true);
  const u32 = (v: DataView, o: number, n: number) => v.setUint32(o, n, true);

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50);
    u16(lv, 4, 20);        // version nécessaire
    u16(lv, 6, 0x0800);    // bit 11 : noms en UTF-8
    u16(lv, 8, 0);         // méthode 0 = stockée
    u16(lv, 10, dosTime);
    u16(lv, 12, dosDate);
    u32(lv, 14, crc);
    u32(lv, 18, size);
    u32(lv, 22, size);
    u16(lv, 26, nameBytes.length);
    u16(lv, 28, 0);
    local.set(nameBytes, 30);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    u32(cv, 0, 0x02014b50);
    u16(cv, 4, 20);        // version créatrice
    u16(cv, 6, 20);        // version nécessaire
    u16(cv, 8, 0x0800);
    u16(cv, 10, 0);
    u16(cv, 12, dosTime);
    u16(cv, 14, dosDate);
    u32(cv, 16, crc);
    u32(cv, 20, size);
    u32(cv, 24, size);
    u16(cv, 28, nameBytes.length);
    u16(cv, 30, 0);
    u16(cv, 32, 0);
    u16(cv, 34, 0);
    u16(cv, 36, 0);
    u32(cv, 38, 0);
    u32(cv, 42, offset);   // position de l'en-tête local
    cd.set(nameBytes, 46);

    chunks.push(local, f.data);
    central.push(cd);
    offset += local.length + size;
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50);
  u16(ev, 4, 0);
  u16(ev, 6, 0);
  u16(ev, 8, files.length);
  u16(ev, 10, files.length);
  u32(ev, 12, cdSize);
  u32(ev, 16, offset);
  u16(ev, 20, 0);

  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

/* ─── API publique ────────────────────────────────────────── */

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Construit le fichier .xlsx et le renvoie sous forme de Blob prêt à être téléchargé. */
export function buildXlsxBlob(opts: XlsxOptions): Blob {
  const sheetName = safeSheetName(opts.sheetName);
  const enc = new TextEncoder();
  const xml = (s: string) => enc.encode(s);

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView/></bookViews>
<sheets><sheet name="${xmlEsc(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const zip = zipStore([
    { name: '[Content_Types].xml', data: xml(contentTypes) },
    { name: '_rels/.rels', data: xml(rootRels) },
    { name: 'xl/workbook.xml', data: xml(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: xml(workbookRels) },
    { name: 'xl/worksheets/sheet1.xml', data: xml(buildSheetXml(opts)) },
    { name: 'xl/styles.xml', data: xml(STYLES_XML) },
  ]);

  // `out` (dans zipStore) est un tampon neuf dont .buffer couvre exactement le fichier.
  return new Blob([zip.buffer as ArrayBuffer], { type: XLSX_MIME });
}
