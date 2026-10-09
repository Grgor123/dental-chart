// Reads a price list a practice uploads in Nastavitve → Cenik → "Uvozi cenik":
// CSV (any of ; , or tab as separator, UTF-8 with or without BOM) or Excel
// .xlsx (first sheet). No library: an .xlsx is a ZIP of XML files, and the
// browser can inflate ZIP entries itself (DecompressionStream 'deflate-raw').
// Every cell comes back as a trimmed string.

export type Sheet = string[][];

export async function readSpreadsheet(file: File): Promise<Sheet> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) return readXlsx(new Uint8Array(await file.arrayBuffer()));
  if (name.endsWith('.xls')) throw new Error('Stari format .xls ni podprt — v Excelu shranite datoteko kot .xlsx ali .csv.');
  return parseCsv(await file.text());
}

// ---- CSV ----------------------------------------------------------------------
export function parseCsv(text: string): Sheet {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const delimiter = [';', '\t', ','].reduce((best, d) => (count(firstLine, d) > count(firstLine, best) ? d : best), ';');
  const rows: Sheet = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ''));
}

function count(text: string, ch: string): number {
  return text.split(ch).length - 1;
}

// ---- XLSX -----------------------------------------------------------------------
async function readXlsx(bytes: Uint8Array): Promise<Sheet> {
  const entries = zipEntries(bytes);
  const read = async (path: string): Promise<string | null> => {
    const entry = entries.get(path);
    return entry ? new TextDecoder().decode(await entry()) : null;
  };

  const sheetPath = await firstSheetPath(read);
  const sheetXml = await read(sheetPath);
  if (!sheetXml) throw new Error('V datoteki ni najti delovnega lista.');
  const sharedXml = await read('xl/sharedStrings.xml');
  const parser = new DOMParser();
  const shared = sharedXml
    ? Array.from(parser.parseFromString(sharedXml, 'application/xml').getElementsByTagName('si')).map((si) =>
        Array.from(si.getElementsByTagName('t'))
          .map((t) => t.textContent ?? '')
          .join('')
      )
    : [];

  const doc = parser.parseFromString(sheetXml, 'application/xml');
  const rows: Sheet = [];
  for (const rowEl of Array.from(doc.getElementsByTagName('row'))) {
    const row: string[] = [];
    let next = 0;
    for (const c of Array.from(rowEl.getElementsByTagName('c'))) {
      const ref = c.getAttribute('r');
      const col = ref ? columnIndex(ref) : next;
      next = col + 1;
      const type = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      let value: string;
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr')
        value = Array.from(c.getElementsByTagName('t'))
          .map((t) => t.textContent ?? '')
          .join('');
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if ((type === null || type === 'n') && v !== '' && Number.isFinite(Number(v)))
        // Excel stores 12.5 as e.g. 12.499999999999998 — round away float noise.
        value = String(Math.round(Number(v) * 1e6) / 1e6);
      else value = v;
      while (row.length < col) row.push('');
      row[col] = value.trim();
    }
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ''));
}

async function firstSheetPath(read: (p: string) => Promise<string | null>): Promise<string> {
  const workbook = await read('xl/workbook.xml');
  const rels = await read('xl/_rels/workbook.xml.rels');
  if (workbook && rels) {
    const parser = new DOMParser();
    const sheet = parser.parseFromString(workbook, 'application/xml').getElementsByTagName('sheet')[0];
    const rid = sheet?.getAttribute('r:id') ?? sheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    const rel = Array.from(parser.parseFromString(rels, 'application/xml').getElementsByTagName('Relationship')).find(
      (r) => r.getAttribute('Id') === rid
    );
    const target = rel?.getAttribute('Target');
    if (target) return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  }
  return 'xl/worksheets/sheet1.xml';
}

function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A';
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

/** ZIP central directory → lazy readers per entry name. */
function zipEntries(bytes: Uint8Array): Map<string, () => Promise<Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Datoteka ni veljavna datoteka .xlsx.');
  const total = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries = new Map<string, () => Promise<Uint8Array>>();
  for (let n = 0; n < total; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Datoteka .xlsx je poškodovana.');
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, async () => {
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.slice(start, start + size);
      if (method === 0) return data;
      if (method !== 8) throw new Error('Datoteka .xlsx uporablja nepodprto stiskanje.');
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// ---- Template ---------------------------------------------------------------------
export const PRICE_LIST_COLUMNS = ['sifra', 'naziv', 'cena', 'ddv', 'em', 'kategorija', 'zzzs_sifra'] as const;

/** Semicolon-separated, UTF-8 with BOM — opens correctly in a Slovenian Excel. */
export function priceListTemplateCsv(): string {
  return (
    '﻿' +
    [
      PRICE_LIST_COLUMNS.join(';'),
      'P001;Pregled in posvet;35,00;0;kos;Diagnostika in RTG;',
      '52321;Zalivka na 2 ploskvah;70,00;0;zob;Restavrativa;52321',
    ].join('\r\n') +
    '\r\n'
  );
}

export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
