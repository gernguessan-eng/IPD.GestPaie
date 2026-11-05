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
  /** Emplacement du logo sur cette feuille (l'image elle-même est fournie au classeur). */
  logo?: { col: number; row: number; widthPx: number; heightPx: number };
}

/** Image intégrée au classeur (partagée par toutes les feuilles qui y font référence). */
export interface XImage {
  data: Uint8Array;
  ext: 'jpeg' | 'png';
  width: number;   // dimensions d'origine en pixels
  height: number;
}

/** Dimensions d'affichage (px) du logo, proportions conservées, contenues dans maxW × maxH. */
export function fitLogo(img: XImage, maxW: number, maxH: number): { widthPx: number; heightPx: number } {
  const ratio = Math.min(maxW / img.width, maxH / img.height);
  return { widthPx: Math.round(img.width * ratio), heightPx: Math.round(img.height * ratio) };
}

/** Lit le format et les dimensions d'une image JPEG ou PNG (sans la décoder). */
export function readImageInfo(bytes: Uint8Array): XImage | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // PNG : signature 89 50 4E 47, dimensions dans le bloc IHDR
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { data: bytes, ext: 'png', width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  // JPEG : FF D8, puis parcours des segments jusqu'au marqueur « Start Of Frame »
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = dv.getUint16(i + 2);
      const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSOF) return { data: bytes, ext: 'jpeg', height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
      i += 2 + len;
    }
  }
  return null;
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

function buildSheetXml(opts: XlsxOptions, hasDrawing: boolean): string {
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
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
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
${hasDrawing ? '<drawing r:id="rId1"/>' : ''}
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

/** Construit un classeur .xlsx d'une seule feuille (Blob prêt à être téléchargé). */
export function buildXlsxBlob(opts: XlsxOptions, image?: XImage | null): Blob {
  return buildWorkbookBlob([opts], image);
}

// Noms de feuilles uniques (Excel ignore la casse) et limités à 31 caractères : en cas de
// doublon (deux employés homonymes), on ajoute " (2)", " (3)"… en gardant la longueur valide.
function uniqueSheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map(raw => {
    const base = safeSheetName(raw);
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) {
      const suffix = ` (${i})`;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

/** Construit un classeur .xlsx de plusieurs feuilles, dans l'ordre donné. */
export function buildWorkbookBlob(sheets: XlsxOptions[], image?: XImage | null): Blob {
  const names = uniqueSheetNames(sheets.map(s => s.sheetName));
  const enc = new TextEncoder();
  const xml = (s: string) => enc.encode(s);
  const n = sheets.length;
  // Une feuille n'affiche le logo que si l'image est fournie ET qu'elle le demande.
  const withLogo = sheets.map(sh => !!(image && sh.logo));

  const sheetOverrides = sheets
    .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join('\n');
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheetOverrides}
${image ? `<Default Extension="${image.ext}" ContentType="image/${image.ext}"/>` : ''}
${sheets.map((_, i) => withLogo[i] ? `<Override PartName="/xl/drawings/drawing${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` : '').join('\n')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const sheetTags = names.map((nm, i) => `<sheet name="${xmlEsc(nm)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView activeTab="0"/></bookViews>
<sheets>${sheetTags}</sheets>
</workbook>`;

  const sheetRels = sheets
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join('\n');
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheetRels}
<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const files: { name: string; data: Uint8Array }[] = [
    { name: '[Content_Types].xml', data: xml(contentTypes) },
    { name: '_rels/.rels', data: xml(rootRels) },
    { name: 'xl/workbook.xml', data: xml(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: xml(workbookRels) },
    ...sheets.map((sh, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: xml(buildSheetXml(sh, withLogo[i])) })),
    { name: 'xl/styles.xml', data: xml(STYLES_XML) },
  ];
  if (image) {
    files.push({ name: `xl/media/image1.${image.ext}`, data: image.data });
    sheets.forEach((sh, i) => {
      if (!withLogo[i] || !sh.logo) return;
      const { col, row, widthPx, heightPx } = sh.logo;
      const cx = Math.round(widthPx * 9525), cy = Math.round(heightPx * 9525);
      files.push({ name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, data: xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${i + 1}.xml"/>
</Relationships>`) });
      files.push({ name: `xl/drawings/_rels/drawing${i + 1}.xml.rels`, data: xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.${image.ext}"/>
</Relationships>`) });
      files.push({ name: `xl/drawings/drawing${i + 1}.xml`, data: xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<xdr:oneCellAnchor>
<xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>38100</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>28575</xdr:rowOff></xdr:from>
<xdr:ext cx="${cx}" cy="${cy}"/>
<xdr:pic>
<xdr:nvPicPr><xdr:cNvPr id="2" name="Logo"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>
<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>
<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>
</xdr:pic>
<xdr:clientData/>
</xdr:oneCellAnchor>
</xdr:wsDr>`) });
    });
  }
  const zip = zipStore(files);

  // `out` (dans zipStore) est un tampon neuf dont .buffer couvre exactement le fichier.
  return new Blob([zip.buffer as ArrayBuffer], { type: XLSX_MIME });
}
