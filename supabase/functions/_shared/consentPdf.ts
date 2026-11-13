// The signed consent as an A4 PDF (Gregor, 2026-11-12) — the patient's copy:
// attached to the copy email and offered for download right after signing
// (patient-consent function). pdf-lib (pure JS, runs in Edge Functions) with
// DejaVu Sans for the Slovene letters (č, š, ž are missing from the PDF base
// fonts); the font files are fetched once per function instance and embedded
// as subsets. Same plain-text format as everywhere: blank line = paragraph,
// line break kept, **bold**.
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'npm:pdf-lib@1.17.1';
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1';

const FONT_URL = 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf';
const BOLD_URL = 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf';

let fontCache: Promise<[Uint8Array, Uint8Array]> | null = null;
/** DejaVu Sans regular + bold (also used by planPdf.ts). */
export function loadFonts(): Promise<[Uint8Array, Uint8Array]> {
  if (!fontCache) {
    fontCache = Promise.all(
      [FONT_URL, BOLD_URL].map(async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Font ${url}: ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
      })
    ) as Promise<[Uint8Array, Uint8Array]>;
    fontCache.catch(() => {
      fontCache = null;
    });
  }
  return fontCache;
}

export interface ConsentPdfInput {
  practiceName: string;
  practiceLines: string[];
  patientName: string;
  title: string;
  body: string;
  details: string | null;
  signerName: string;
  signedAt: string;
  signaturePng: string;
  explainedByName: string | null;
  explainedAt: string | null;
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;
const INK = rgb(0.11, 0.15, 0.14);
const SOFT = rgb(0.35, 0.4, 0.39);
const ACCENT = rgb(0.18, 0.43, 0.38);

function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('sl-SI', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Ljubljana' });
}

export interface Word {
  text: string;
  bold: boolean;
}

/** One paragraph → lines of words (bold runs from **…**, \n forces a break). */
export function layoutParagraph(text: string, regular: PDFFont, bold: PDFFont, size: number, width: number): Word[][] {
  const lines: Word[][] = [];
  for (const hardLine of text.split('\n')) {
    const words: Word[] = [];
    hardLine.split(/(\*\*.+?\*\*)/).forEach((part) => {
      const isBold = /^\*\*.+\*\*$/.test(part);
      const clean = isBold ? part.slice(2, -2) : part;
      for (const w of clean.split(/\s+/).filter(Boolean)) words.push({ text: w, bold: isBold });
    });
    let line: Word[] = [];
    let lineWidth = 0;
    for (const word of words) {
      const font = word.bold ? bold : regular;
      const w = font.widthOfTextAtSize(word.text, size);
      const space = line.length ? regular.widthOfTextAtSize(' ', size) : 0;
      if (line.length && lineWidth + space + w > width) {
        lines.push(line);
        line = [word];
        lineWidth = w;
      } else {
        line.push(word);
        lineWidth += space + w;
      }
    }
    lines.push(line);
  }
  return lines;
}

export async function renderConsentPdf(input: ConsentPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await loadFonts();
  const regular = await pdf.embedFont(regularBytes, { subset: true });
  const bold = await pdf.embedFont(boldBytes, { subset: true });
  pdf.setTitle(input.title);
  pdf.setAuthor(input.practiceName);

  const contentWidth = PAGE_W - 2 * MARGIN;
  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  function ensure(space: number) {
    if (y - space < MARGIN + 20) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
  }
  function text(value: string, opts: { size: number; font?: PDFFont; color?: ReturnType<typeof rgb>; x?: number }) {
    page.drawText(value, { x: opts.x ?? MARGIN, y, size: opts.size, font: opts.font ?? regular, color: opts.color ?? INK });
  }
  function paragraph(value: string, size: number, gapAfter: number) {
    const lineHeight = size * 1.45;
    for (const line of layoutParagraph(value, regular, bold, size, contentWidth)) {
      ensure(lineHeight);
      y -= lineHeight;
      let x = MARGIN;
      for (const word of line) {
        const font = word.bold ? bold : regular;
        page.drawText(word.text, { x, y, size, font, color: INK });
        x += font.widthOfTextAtSize(word.text, size) + regular.widthOfTextAtSize(' ', size);
      }
    }
    y -= gapAfter;
  }

  // Header: practice left, patient right, a line under.
  y -= 14;
  text(input.practiceName, { size: 13, font: bold });
  const patientWidth = regular.widthOfTextAtSize(input.patientName, 10);
  text(input.patientName, { size: 10, x: PAGE_W - MARGIN - patientWidth });
  for (const line of input.practiceLines.filter(Boolean)) {
    y -= 12;
    text(line, { size: 8.5, color: SOFT });
  }
  y -= 10;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1.5, color: ACCENT });
  y -= 14;

  paragraph(`**${input.title.replace(/\*/g, '')}**`, 15, 6);
  if (input.details) paragraph(`**Predvideni poseg:** ${input.details}`, 10.5, 8);
  for (const p of input.body.replace(/\r\n/g, '\n').split(/\n{2,}/).map((s) => s.trim()).filter(Boolean)) {
    paragraph(p, 10.5, 7);
  }

  // Signatures.
  ensure(130);
  y -= 16;
  const signature = await pdf.embedPng(input.signaturePng.replace(/^data:image\/png;base64,/, ''));
  const scale = Math.min(200 / signature.width, 70 / signature.height);
  page.drawImage(signature, { x: MARGIN, y: y - 70, width: signature.width * scale, height: signature.height * scale });
  y -= 76;
  const half = contentWidth / 2;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + half - 20, y }, thickness: 0.8, color: INK });
  page.drawLine({ start: { x: MARGIN + half, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.8, color: INK });
  y -= 13;
  text(`Pacient: ${input.signerName}`, { size: 9.5, font: bold });
  text(`Pojasnil: ${input.explainedByName ?? '—'}`, { size: 9.5, font: bold, x: MARGIN + half });
  y -= 12;
  text(`Podpisano ${dateTime(input.signedAt)}`, { size: 8.5, color: SOFT });
  if (input.explainedAt) text(`Potrjeno ${dateTime(input.explainedAt)}`, { size: 8.5, color: SOFT, x: MARGIN + half });

  // Page numbers.
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    if (pages.length > 1) {
      const label = `${i + 1}/${pages.length}`;
      p.drawText(label, { x: PAGE_W - MARGIN - regular.widthOfTextAtSize(label, 8), y: 30, size: 8, font: regular, color: SOFT });
    }
  });

  return await pdf.save();
}

/** For JSON responses and email attachments. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
