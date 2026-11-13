// A predračun as an A4 PDF (migration 061). Two uses:
//   * attached to the email that sends the predračun (send-treatment-plan) —
//     every option with its items and total, not yet confirmed;
//   * the patient's copy after confirming (treatment-plan function) — the
//     chosen option and how it was confirmed (button in the email link, or
//     verbally by phone, recorded by staff; an older signed one shows the
//     drawn signature).
// Fonts and paragraph layout from consentPdf.
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'npm:pdf-lib@1.17.1';
import fontkit from 'npm:@pdf-lib/fontkit@1.1.1';
import { layoutParagraph, loadFonts } from './consentPdf.ts';

export interface PlanPdfItem {
  name: string;
  code: string | null;
  toothFdi: string | null;
  quantity: number;
  unit: string;
  unitPriceEur: number;
  discountPercent: number;
  vatRate: number;
}

export interface PlanPdfVariant {
  name: string;
  items: PlanPdfItem[];
}

export interface PlanPdfAcceptance {
  at: string;
  via: 'link' | 'verbal';
  signerName: string | null;
  signaturePng: string | null;
  acceptedByName: string | null;
}

export interface PlanPdfInput {
  practiceName: string;
  practiceLines: string[];
  patientName: string;
  number: string;
  title: string;
  createdAt: string;
  validUntil: string;
  note: string | null;
  /** All options (unconfirmed), or just the chosen one (confirmed). */
  variants: PlanPdfVariant[];
  /** How many options the plan had — option names are shown when > 1. */
  variantCount: number;
  acceptance: PlanPdfAcceptance | null;
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 50;
const INK = rgb(0.11, 0.15, 0.14);
const SOFT = rgb(0.35, 0.4, 0.39);
const ACCENT = rgb(0.18, 0.43, 0.38);
const LINE = rgb(0.8, 0.84, 0.83);

function eur(value: number): string {
  return new Intl.NumberFormat('sl-SI', { style: 'currency', currency: 'EUR' }).format(value);
}
function date(iso: string): string {
  return new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('sl-SI', { dateStyle: 'long', timeZone: 'Europe/Ljubljana' });
}
function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('sl-SI', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Ljubljana' });
}
export function planLineTotal(item: Pick<PlanPdfItem, 'quantity' | 'unitPriceEur' | 'discountPercent'>): number {
  return Math.round(item.quantity * item.unitPriceEur * (1 - item.discountPercent / 100) * 100) / 100;
}

/** Wraps text to lines that fit `width` (plain, no bold). */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && font.widthOfTextAtSize(next, size) > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

export async function renderPlanPdf(input: PlanPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [regularBytes, boldBytes] = await loadFonts();
  const regular = await pdf.embedFont(regularBytes, { subset: true });
  const bold = await pdf.embedFont(boldBytes, { subset: true });
  pdf.setTitle(`Predračun ${input.number}`);
  pdf.setAuthor(input.practiceName);

  const contentWidth = PAGE_W - 2 * MARGIN;
  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;
  function ensure(space: number): boolean {
    if (y - space < MARGIN + 20) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
      return true;
    }
    return false;
  }
  function text(value: string, x: number, size: number, font: PDFFont = regular, color = INK) {
    page.drawText(value, { x, y, size, font, color });
  }
  function rightText(value: string, right: number, size: number, font: PDFFont = regular, color = INK) {
    text(value, right - font.widthOfTextAtSize(value, size), size, font, color);
  }

  // Header.
  y -= 14;
  text(input.practiceName, MARGIN, 13, bold);
  rightText(input.patientName, PAGE_W - MARGIN, 10);
  for (const line of input.practiceLines.filter(Boolean)) {
    y -= 12;
    text(line, MARGIN, 8.5, regular, SOFT);
  }
  y -= 10;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1.5, color: ACCENT });
  y -= 26;
  text(`${input.title} ${input.number}`, MARGIN, 16, bold);
  y -= 16;
  text(`Izdano ${date(input.createdAt)} · velja do ${date(input.validUntil)}`, MARGIN, 9.5, regular, SOFT);
  if (input.note) {
    y -= 6;
    for (const line of layoutParagraph(input.note, regular, bold, 9.5, contentWidth)) {
      ensure(14);
      y -= 13.5;
      text(line.map((w) => w.text).join(' '), MARGIN, 9.5);
    }
  }
  if (!input.acceptance && input.variantCount > 1) {
    y -= 18;
    text('Predlagamo več možnosti zdravljenja — izberete eno.', MARGIN, 9.5, regular, SOFT);
  }

  // One table per option.
  const cols = { no: MARGIN, name: MARGIN + 22, tooth: MARGIN + 270, qty: MARGIN + 330, price: MARGIN + 390, disc: MARGIN + 435, total: PAGE_W - MARGIN };
  const nameWidth = cols.tooth - cols.name - 8;
  function header() {
    y -= 20;
    const size = 8.5;
    text('Zap.', cols.no, size, bold, SOFT);
    text('Storitev', cols.name, size, bold, SOFT);
    text('Zob', cols.tooth, size, bold, SOFT);
    rightText('Količina', cols.qty + 40, size, bold, SOFT);
    rightText('Cena', cols.price + 40, size, bold, SOFT);
    rightText('Popust', cols.disc + 38, size, bold, SOFT);
    rightText('Znesek', cols.total, size, bold, SOFT);
    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.8, color: LINE });
  }
  for (const variant of input.variants) {
    ensure(70);
    if (input.variantCount > 1) {
      y -= 24;
      text(input.acceptance ? `Izbrana možnost: ${variant.name}` : variant.name, MARGIN, 11.5, bold, ACCENT);
    }
    header();
    let total = 0;
    variant.items.forEach((item, i) => {
      const size = 9.5;
      const nameLines = wrap(item.code ? `${item.name} (${item.code})` : item.name, regular, size, nameWidth);
      const toothLines = wrap(item.toothFdi ?? '', regular, size, cols.qty - cols.tooth - 10);
      const rowHeight = Math.max(nameLines.length, toothLines.length) * 12.5 + 6;
      if (ensure(rowHeight + 4)) header();
      y -= 14;
      const lineTotal = planLineTotal(item);
      total += lineTotal;
      text(String(i + 1), cols.no, size);
      nameLines.forEach((l, j) => page.drawText(l, { x: cols.name, y: y - j * 12.5, size, font: regular, color: INK }));
      toothLines.forEach((l, j) => page.drawText(l, { x: cols.tooth, y: y - j * 12.5, size, font: regular, color: INK }));
      rightText(`${item.quantity} ${item.unit}`, cols.qty + 40, size);
      rightText(eur(item.unitPriceEur), cols.price + 40, size);
      rightText(item.discountPercent ? `${item.discountPercent} %` : '', cols.disc + 38, size);
      rightText(eur(lineTotal), cols.total, size);
      y -= rowHeight - 14;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: LINE });
    });
    ensure(24);
    y -= 18;
    rightText(`Skupaj: ${eur(Math.round(total * 100) / 100)}`, PAGE_W - MARGIN, 12, bold);
  }
  ensure(40);
  y -= 18;
  rightText('Zneski vključujejo DDV, kjer se obračuna.', PAGE_W - MARGIN, 8.5, regular, SOFT);
  y -= 13;
  rightText('Predračun ni račun. Končni znesek je odvisen od dejansko opravljenih storitev.', PAGE_W - MARGIN, 8.5, regular, SOFT);

  // Confirmation.
  const a = input.acceptance;
  if (a) {
    ensure(110);
    y -= 30;
    if (a.via === 'link' && a.signaturePng) {
      const signature = await pdf.embedPng(a.signaturePng.replace(/^data:image\/png;base64,/, ''));
      const scale = Math.min(200 / signature.width, 70 / signature.height);
      page.drawImage(signature, { x: MARGIN, y: y - 70, width: signature.width * scale, height: signature.height * scale });
      y -= 76;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + 230, y }, thickness: 0.8, color: INK });
      y -= 13;
      text(`Predračun sprejel/a: ${a.signerName ?? input.patientName}`, MARGIN, 9.5, bold);
      y -= 12;
      text(`Podpisano ${dateTime(a.at)}`, MARGIN, 8.5, regular, SOFT);
    } else if (a.via === 'link') {
      text(`Predračun potrdil/a ${a.signerName ?? input.patientName} prek povezave v e-pošti`, MARGIN, 9.5, bold);
      y -= 12;
      text(dateTime(a.at), MARGIN, 8.5, regular, SOFT);
    } else {
      text(`Predračun sprejet ustno ${dateTime(a.at)}`, MARGIN, 9.5, bold);
      y -= 12;
      text(`Zabeležil/a: ${a.acceptedByName ?? '—'}`, MARGIN, 8.5, regular, SOFT);
    }
  }

  const pages = pdf.getPages();
  if (pages.length > 1) {
    pages.forEach((p, i) => {
      const label = `${i + 1}/${pages.length}`;
      p.drawText(label, { x: PAGE_W - MARGIN - regular.widthOfTextAtSize(label, 8), y: 30, size: 8, font: regular, color: SOFT });
    });
  }
  return await pdf.save();
}
