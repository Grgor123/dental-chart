// Invoice → printable HTML, in two formats: an A4 sheet and a thermal-roll
// receipt (58 or 80 mm). Pure TS (no Deno or DOM APIs), so the React app
// prints it now and an Edge Function can reuse it later (emailing an invoice,
// the FURS phase). Returns a complete HTML document with its own inline CSS —
// src/lib/printInvoice.ts drops it into a hidden iframe, so the app's own
// styles never leak into the printout.
//
// A4 layout (Gregor's spec): logo top left, issuer details top right on the
// same line; payer under the logo, invoice data under the issuer; then the
// lines; then payment data (TRR only: IBAN, reference, UPN QR) on the left
// and the totals on the right.
//
// Phase 2 (FURS) adds ZOI, EOR and its own QR code where the `fiscal` block sits.
import { invoiceTotal, invoiceVat, lineNet, lineTotal, unitNet, vatBreakdown, type CalcLine } from './calc.ts';
import { formatIban, normalizeIban, paymentReference, type UpnQrInput } from './payment.ts';

export type PaymentMethod = 'cash' | 'card' | 'transfer';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Gotovina',
  card: 'Kartica',
  transfer: 'Nakazilo na TRR',
};

export interface InvoiceIssuer {
  legalName: string;
  address: string;
  postalCode: string;
  city: string;
  taxNumber: string;
  registrationNumber: string;
  vatPayer: boolean;
  iban: string;
  bankName: string;
  vatExemptNote: string;
  footerNote: string;
  /** Already filtered by the "show on invoice" ticks — empty = not printed. */
  phone: string;
  email: string;
  website: string;
  /** data: URL, or empty for no logo. */
  logoDataUrl: string;
}

export interface InvoiceBuyer {
  name: string;
  address: string;
  postalCode: string;
  city: string;
  taxNumber: string;
}

/** Enota mere — the price list has no unit yet, so every line is one piece. */
export const DEFAULT_UNIT = 'kos';

export interface InvoiceDocumentLine extends CalcLine {
  code: string | null;
  name: string;
  toothFdi: string | null;
}

export interface InvoiceDocument {
  status: 'draft' | 'issued';
  kind: 'invoice' | 'credit_note';
  number: string | null;
  /** The cancelled invoice's number, on a credit note. */
  originalNumber: string | null;
  issuedAt: string | null;
  /** YYYY-MM-DD */
  serviceDate: string;
  /** YYYY-MM-DD */
  dueDate: string | null;
  paymentMethod: PaymentMethod;
  paidAt: string | null;
  cancelled: boolean;
  issuer: InvoiceIssuer;
  buyer: InvoiceBuyer;
  lines: InvoiceDocumentLine[];
  note: string | null;
}

export type PrintFormat = { format: 'a4' } | { format: 'receipt'; widthMm: 58 | 80 };

export interface RenderExtras {
  /** Inline SVG of the UPN QR code (see upnQrInputFor). */
  upnQrSvg?: string | null;
  /** Source of the Paged.js polyfill (A4 only). When given, the A4 page is
      laid out as real sheets — repeated header/footer, page numbers — both in
      the on-screen preview and in print (src/lib/pagedScript.ts). */
  pagedScript?: string;
  /** Paged mode only: print as soon as the pages are laid out. */
  autoPrint?: boolean;
}

const NON_VAT_PAYER_NOTE = 'DDV ni obračunan na podlagi 1. odstavka 94. člena ZDDV-1.';

// ---- Formatting -------------------------------------------------------------

const EUR = new Intl.NumberFormat('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatEur(value: number): string {
  return `${EUR.format(value)} €`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : EUR.format(value);
}

/** YYYY-MM-DD → "5. 10. 2026" (no Date object, so no timezone shift). */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return `${d}. ${m}. ${y}`;
}

/** Timestamp → "5. 10. 2026 14:32", always in Ljubljana time. */
export function formatDateTime(iso: string): string {
  const parts = new Intl.DateTimeFormat('sl-SI', {
    timeZone: 'Europe/Ljubljana',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}. ${get('month')}. ${get('year')} ${get('hour')}:${get('minute')}`;
}

/** Service name with its price-list code after it: "Puljenje 123". */
function lineLabel(line: InvoiceDocumentLine): string {
  return line.code ? `${line.name} ${line.code}` : line.name;
}

/** Footer text: at most two lines, Enter = new line. */
function footerHtml(text: string): string {
  return text
    .split(/\r?\n/)
    .slice(0, 2)
    .map((line) => esc(line))
    .join('<br>');
}

function esc(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function kindLabel(doc: InvoiceDocument): string {
  return doc.kind === 'credit_note' ? 'Dobropis' : 'Račun';
}

function title(doc: InvoiceDocument): string {
  if (doc.status === 'draft') return `Osnutek — ${kindLabel(doc).toLowerCase()} še ni izdan`;
  return `${kindLabel(doc)} št. ${doc.number ?? ''}`;
}

function issuerTaxNumber(issuer: InvoiceIssuer): string {
  const bare = issuer.taxNumber.replace(/^SI/i, '');
  return issuer.vatPayer ? `SI${bare}` : bare;
}

/** "Davčna št.: SI12345678, matična št.: 1234567000" */
function issuerIdsLine(issuer: InvoiceIssuer): string {
  return [
    issuer.taxNumber ? `Davčna št.: ${issuerTaxNumber(issuer)}` : '',
    issuer.registrationNumber ? `matična št.: ${issuer.registrationNumber}` : '',
  ]
    .filter(Boolean)
    .join(', ');
}

function placeLine(postalCode: string, city: string): string {
  return [postalCode, city].filter(Boolean).join(' ');
}

function addressLine(address: string, postalCode: string, city: string): string {
  return [address, placeLine(postalCode, city)].filter(Boolean).join(', ');
}

/** Legal notes about VAT, shared by both formats. */
function taxNotes(doc: InvoiceDocument): string[] {
  if (!doc.issuer.vatPayer) return [NON_VAT_PAYER_NOTE];
  if (doc.lines.some((l) => l.vatRate === 0) && doc.issuer.vatExemptNote) return [doc.issuer.vatExemptNote];
  return [];
}

/** Totals block, shared by both formats: net, one DDV row per rate (0 % shown
    too), then the total. */
function totalRows(doc: InvoiceDocument): { label: string; value: string; grand?: boolean }[] {
  const total = invoiceTotal(doc.lines);
  const rows: { label: string; value: string; grand?: boolean }[] = [
    { label: 'Skupaj brez DDV', value: formatEur(Math.round((total - invoiceVat(doc.lines)) * 100) / 100) },
  ];
  for (const r of vatBreakdown(doc.lines)) {
    rows.push({ label: `DDV ${formatNumber(r.rate)} % (osnova ${formatEur(r.net)})`, value: formatEur(r.vat) });
  }
  rows.push({ label: 'Skupaj za plačilo', value: formatEur(total), grand: true });
  return rows;
}

/** Payment data is printed only for a bank-transfer invoice (not a credit note). */
function isTransferInvoice(doc: InvoiceDocument): boolean {
  return doc.kind === 'invoice' && doc.paymentMethod === 'transfer';
}

/** What the UPN QR code should carry, or null when there's nothing to pay by
    transfer yet (cash/card, credit note, draft without a number, no valid IBAN). */
export function upnQrInputFor(doc: InvoiceDocument): UpnQrInput | null {
  if (!isTransferInvoice(doc) || doc.cancelled || doc.paidAt) return null;
  const reference = paymentReference(doc.number, doc.issuedAt);
  const total = invoiceTotal(doc.lines);
  if (!reference || total <= 0 || !normalizeIban(doc.issuer.iban).valid) return null;
  return {
    payerName: doc.buyer.name,
    payerAddress: doc.buyer.address,
    payerCity: placeLine(doc.buyer.postalCode, doc.buyer.city),
    amountEur: total,
    purpose: `Placilo racuna ${doc.number}`,
    dueDate: doc.dueDate,
    recipientIban: doc.issuer.iban,
    reference,
    recipientName: doc.issuer.legalName,
    recipientAddress: doc.issuer.address,
    recipientCity: placeLine(doc.issuer.postalCode, doc.issuer.city),
  };
}

/** "Podatki za plačilo" rows (label, value). */
function paymentDataRows(doc: InvoiceDocument): [string, string][] {
  const rows: [string, string][] = [];
  if (doc.issuer.iban) rows.push(['IBAN', formatIban(doc.issuer.iban)]);
  if (doc.issuer.bankName) rows.push(['Banka', doc.issuer.bankName]);
  rows.push(['Sklicna št.', paymentReference(doc.number, doc.issuedAt) ?? 'dodeljena ob izdaji računa']);
  return rows;
}

// ---- Entry point --------------------------------------------------------------

export function renderInvoiceHtml(doc: InvoiceDocument, format: PrintFormat, extras: RenderExtras = {}): string {
  return format.format === 'a4' ? renderA4(doc, extras) : renderReceipt(doc, format.widthMm, extras);
}

// ---- A4 ---------------------------------------------------------------------------

function renderA4(doc: InvoiceDocument, extras: RenderExtras): string {
  const { issuer, buyer } = doc;
  const showTooth = doc.lines.some((l) => l.toothFdi);
  const notes = taxNotes(doc);

  // The lines are a grid of blocks, not a <table>: Paged.js splits blocks
  // cleanly across pages, while splitting a table dropped the row that fell
  // on the break. Fixed column widths keep every row aligned.
  const cols = showTooth
    ? '10mm minmax(0, 1fr) 9mm 14mm 8mm 20mm 13mm 11mm 21mm 20mm'
    : '10mm minmax(0, 1fr) 14mm 8mm 20mm 13mm 11mm 21mm 20mm';
  const cell = (cls: string, content: string) => `<div class="${cls}">${content}</div>`;

  const head = [
    cell('c', 'Zap. št.'),
    cell('l', 'Vrsta blaga/storitve'),
    showTooth ? cell('c', 'Zob') : '',
    cell('r', 'Količina'),
    cell('c', 'EM'),
    cell('r', 'Cena brez DDV'),
    cell('r', 'Popust %'),
    cell('r', 'DDV %'),
    cell('r', 'Vrednost brez DDV'),
    cell('r', 'Vrednost z DDV'),
  ].join('');

  const body = doc.lines
    .map(
      (l, i) => `<div class="lrow" style="grid-template-columns: ${cols}">${[
        cell('c', `${i + 1}.`),
        cell('l', esc(lineLabel(l))),
        showTooth ? cell('c', esc(l.toothFdi)) : '',
        cell('r', formatNumber(l.quantity)),
        cell('c', DEFAULT_UNIT),
        cell('r', formatEur(unitNet(l))),
        cell('r', formatNumber(l.discountPercent)),
        cell('r', formatNumber(l.vatRate)),
        cell('r', formatEur(lineNet(l))),
        cell('r', formatEur(lineTotal(l))),
      ].join('')}</div>`
    )
    .join('');

  // Issuer block, top right: name / address / tax ids / phone + email / web.
  const contactLine = [issuer.phone ? `Tel.: ${issuer.phone}` : '', issuer.email].filter(Boolean).join(' · ');
  const issuerRows = [
    `<strong class="company">${esc(issuer.legalName)}</strong>`,
    esc(addressLine(issuer.address, issuer.postalCode, issuer.city)),
    esc(issuerIdsLine(issuer)),
    esc(contactLine),
    esc(issuer.website),
  ].filter(Boolean);

  // Invoice data, under the issuer block.
  const meta: [string, string][] = [];
  if (doc.status === 'issued') {
    meta.push(['Kraj in datum izdaje', [issuer.city, doc.issuedAt ? formatDateTime(doc.issuedAt) : ''].filter(Boolean).join(', ')]);
  }
  meta.push(['Datum opravljene storitve', formatDate(doc.serviceDate)]);
  if (isTransferInvoice(doc) && doc.dueDate) meta.push(['Datum zapadlosti', formatDate(doc.dueDate)]);
  meta.push(['Način plačila', PAYMENT_METHOD_LABELS[doc.paymentMethod]]);
  if (doc.originalNumber) meta.push(['Dobropis k računu', doc.originalNumber]);

  const heading =
    doc.status === 'draft'
      ? `<div class="docno draft">${esc(title(doc))}</div>`
      : `<div class="docno">${kindLabel(doc)} št.: ${esc(doc.number)}</div>`;

  const paymentBlock = isTransferInvoice(doc)
    ? `<div class="payment">
        <div class="payment-text">
          <div class="label-strong">Podatki za plačilo:</div>
          <table class="kv">${paymentDataRows(doc)
            .map(([k, v]) => `<tr><td class="muted">${esc(k)}:</td><td class="nowrap">${esc(v)}</td></tr>`)
            .join('')}</table>
        </div>
      </div>`
    : '<div></div>';

  // Paged mode (Paged.js script supplied): real A4 pages — the header (logo +
  // issuer) and footer repeat on every page as running elements, and pages are
  // numbered "2/3" bottom right (hidden when there's just one page). Without
  // the script (e.g. a future server-side render) it falls back to one flowing
  // page with the footer pushed to the bottom.
  const paged = !!extras.pagedScript;
  const pagedConfig = `window.PagedConfig = {
    auto: true,
    after: function (flow) {
      window.__invoicePagesReady = true;
      var total = flow && flow.total ? flow.total : document.querySelectorAll('.pagedjs_page').length;
      if (total <= 1) {
        document.querySelectorAll('.pagedjs_margin-bottom-right').forEach(function (el) { el.style.visibility = 'hidden'; });
      }
      ${
        extras.autoPrint
          ? 'window.focus(); window.print();'
          : `var page = document.querySelector('.pagedjs_page');
      if (page) { document.body.style.zoom = String(Math.min(1, (window.innerWidth - 32) / page.getBoundingClientRect().width)); }`
      }
    }
  };`;

  return `<!doctype html>
<html lang="sl"><head><meta charset="utf-8"><title>${esc(title(doc))}</title>
<style>
  /* Top margin holds the repeated header (logo + issuer, ≤ 30 mm, starting
     15 mm from the paper edge); the bottom margin holds the footer, which
     ends 2 cm above the lower paper edge, and the page number. */
  @page {
    size: A4;
    margin: ${paged ? '52mm 15mm 34mm 15mm' : '15mm 15mm 20mm'};
    @top-center { content: element(pageHeader); vertical-align: top; text-align: left; padding-top: 15mm; }
    @bottom-left { content: element(pageFooter); vertical-align: bottom; text-align: left; padding-bottom: 20mm; }
    @bottom-right { content: counter(page) "/" counter(pages); vertical-align: bottom; padding-bottom: 20mm; font-family: Arial, Helvetica, sans-serif; font-size: 8pt; color: #45524f; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; color: #1c2624; background: #fff; }
  .page-header { width: 180mm; border-collapse: collapse; table-layout: fixed; }
  .page-header td { padding: 0; vertical-align: top; text-align: left; }
  .page-header td.logo { width: 84mm; padding-right: 8mm; }
  .page-footer { width: 150mm; padding-top: 3mm; border-top: 1px solid #ccd6d4; font-size: 8pt; line-height: 1.4; color: #45524f; }
  ${paged ? '.page-header { position: running(pageHeader); } .page-footer { position: running(pageFooter); }' : ''}
  /* Paged preview on screen: grey desk, white sheets. */
  @media screen {
    body.paged { background: #e9eeed; }
    body.paged .pagedjs_page { background: #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, .25); margin: 12px auto; }
    body.flow { padding: 15mm 15mm 20mm; }
  }
  /* Fallback: one flowing page, at least a sheet tall, footer at the bottom. */
  body.flow .page { max-width: 180mm; margin: 0 auto; min-height: 261mm; display: flex; flex-direction: column; }
  body.flow .page-header { width: auto; margin-bottom: 9mm; }
  body.flow .page-footer { order: 99; margin-top: auto; width: auto; }
  .logo { min-width: 0; }
  .logo img { display: block; max-width: 100%; max-height: 28mm; object-fit: contain; object-position: left top; }
  .issuer { line-height: 1.45; }
  .issuer .company { font-size: 12pt; }
  .head { display: grid; grid-template-columns: minmax(0, 1fr) 96mm; column-gap: 8mm; align-items: start; }
  .buyer { line-height: 1.45; }
  .buyer strong { font-size: 10.5pt; }
  .label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .05em; color: #6f7c79; margin-bottom: 1mm; }
  .label-strong { font-weight: bold; margin-bottom: 1.5mm; }
  .docno { font-size: 14pt; font-weight: bold; margin-bottom: 2mm; }
  .docno.draft { color: #b3261e; font-size: 12pt; }
  .stamp { display: inline-block; border: 2px solid #b3261e; color: #b3261e; padding: 0.5mm 2.5mm; font-weight: bold; font-size: 10pt; margin-bottom: 2mm; }
  table.kv td { padding: 0.4mm 4mm 0.4mm 0; vertical-align: top; white-space: nowrap; }
  .muted { color: #45524f; }
  .nowrap { white-space: nowrap; }
  .lines { margin-top: 9mm; font-size: 8.5pt; }
  .lrow { display: grid; align-items: start; border-bottom: 1px solid #ccd6d4; break-inside: avoid; }
  .lrow > div { padding: 1.5mm 1mm; min-width: 0; }
  .lrow.lhead { align-items: end; border-bottom: 1.5px solid #1c2624; font-size: 7.5pt; font-weight: bold; }
  .lrow.lhead > div { text-align: center; white-space: normal; }
  .l { text-align: left !important; } .r { text-align: right !important; white-space: nowrap; } .c { text-align: center; }
  .bottom { margin-top: 5mm; display: flex; justify-content: space-between; align-items: flex-start; gap: 5mm; break-inside: avoid; }
  .payment { display: flex; gap: 4mm; align-items: flex-start; min-width: 0; }
  .payment table.kv td { padding-right: 3mm; }
  .qr-row { display: flex; justify-content: flex-end; margin-top: 4mm; break-inside: avoid; }
  .qr { width: 32mm; flex: none; text-align: center; }
  .qr svg { display: block; width: 32mm; height: 32mm; }
  .totals { flex: none; }
  .qr-label { font-size: 7pt; color: #45524f; margin-top: 0.5mm; }
  .totals table { border-collapse: collapse; }
  .totals table td { padding: 0.8mm 0 0.8mm 5mm; text-align: right; white-space: nowrap; }
  .grand td { font-size: 12pt; font-weight: bold; border-top: 1.5px solid #1c2624; padding-top: 1.5mm !important; }
  .notes { margin-top: 8mm; font-size: 8.5pt; break-inside: avoid; }
  .notes p { margin: 1mm 0; }
  .fiscal { margin-top: 6mm; }
</style>
${paged ? `<script>${pagedConfig}</script><script>${extras.pagedScript!.replace(/<\/script/gi, '<\\/script')}</script>` : ''}
</head>
<body class="${paged ? 'paged' : 'flow'}"><div class="page">
  <table class="page-header"><tr>
    <td class="logo">${issuer.logoDataUrl ? `<img src="${esc(issuer.logoDataUrl)}" alt="">` : ''}</td>
    <td class="issuer">${issuerRows.join('<br>')}</td>
  </tr></table>
  ${issuer.footerNote.trim() ? `<div class="page-footer">${footerHtml(issuer.footerNote)}</div>` : ''}
  <div class="head">
    <div class="buyer">
      <div class="label">Plačnik</div>
      <strong>${esc(buyer.name)}</strong>
      ${buyer.address ? `<br>${esc(buyer.address)}` : ''}
      ${placeLine(buyer.postalCode, buyer.city) ? `<br>${esc(placeLine(buyer.postalCode, buyer.city))}` : ''}
      ${buyer.taxNumber ? `<br>Davčna št.: ${esc(buyer.taxNumber)}` : ''}
    </div>
    <div class="meta">
      ${heading}
      ${doc.cancelled ? '<div class="stamp">STORNIRANO</div>' : ''}
      <table class="kv">${meta.map(([k, v]) => `<tr><td class="muted">${esc(k)}:</td><td>${esc(v)}</td></tr>`).join('')}</table>
    </div>
  </div>
  <div class="lines"><div class="lrow lhead" style="grid-template-columns: ${cols}">${head}</div>${body}</div>
  <div class="bottom">
    ${paymentBlock}
    <div class="totals"><table>
      ${totalRows(doc)
        .map((r) => `<tr class="${r.grand ? 'grand' : ''}"><td>${esc(r.label)}</td><td>${r.value}</td></tr>`)
        .join('')}
    </table></div>
  </div>
  <div class="notes">
    ${notes.map((n) => `<p>${esc(n)}</p>`).join('')}
    ${doc.note ? `<p>${esc(doc.note)}</p>` : ''}
  </div>
  ${
    isTransferInvoice(doc) && extras.upnQrSvg
      ? `<div class="qr-row"><div class="qr">${extras.upnQrSvg}<div class="qr-label">UPN QR</div></div></div>`
      : ''
  }
  <div class="fiscal"></div>
</div></body></html>`;
}

// ---- Thermal roll ----------------------------------------------------------------

function renderReceipt(doc: InvoiceDocument, widthMm: 58 | 80, extras: RenderExtras): string {
  const { issuer, buyer } = doc;
  const notes = taxNotes(doc);
  // Printable area is a few mm narrower than the paper on most printers.
  const contentMm = widthMm === 80 ? 72 : 48;
  const fontPt = widthMm === 80 ? 9 : 7.5;
  const qrMm = widthMm === 80 ? 40 : 36;

  const lines = doc.lines
    .map((l) => {
      const detail = [
        `${formatNumber(l.quantity)} ${DEFAULT_UNIT} × ${formatEur(l.unitPriceEur)}`,
        l.discountPercent ? `−${formatNumber(l.discountPercent)} %` : '',
        `DDV ${formatNumber(l.vatRate)} %`,
        l.toothFdi ? `zob ${l.toothFdi}` : '',
      ]
        .filter(Boolean)
        .join('  ');
      return `<div class="item"><div>${esc(lineLabel(l))}</div><div class="row"><span class="muted">${esc(detail)}</span><span>${formatEur(lineTotal(l))}</span></div></div>`;
    })
    .join('');

  const contact = [issuer.phone ? `Tel.: ${issuer.phone}` : '', issuer.email, issuer.website].filter(Boolean);

  return `<!doctype html>
<html lang="sl"><head><meta charset="utf-8"><title>${esc(title(doc))}</title>
<style>
  @page { size: ${widthMm}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #fff; color: #000; font-family: Arial, Helvetica, sans-serif; font-size: ${fontPt}pt; line-height: 1.3; }
  .page { width: ${contentMm}mm; margin: 0 auto; padding: 3mm 0 6mm; }
  .center { text-align: center; }
  .muted { color: #222; }
  hr { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
  .row { display: flex; justify-content: space-between; gap: 2mm; }
  .row span:last-child { white-space: nowrap; }
  .item { margin-bottom: 1.2mm; }
  .total { font-size: ${fontPt + 3}pt; font-weight: bold; }
  h1 { font-size: ${fontPt + 2}pt; margin: 0 0 1mm; }
  p { margin: 0.6mm 0; }
  .logo img { max-width: ${contentMm}mm; max-height: 18mm; object-fit: contain; filter: grayscale(1); }
  .stamp { font-weight: bold; text-align: center; border: 1.5px solid #000; padding: 1mm; margin: 1mm 0; }
  .qr svg { display: block; width: ${qrMm}mm; height: ${qrMm}mm; margin: 1.5mm auto 0; }
</style></head>
<body><div class="page">
  <div class="center">
    ${issuer.logoDataUrl ? `<div class="logo"><img src="${esc(issuer.logoDataUrl)}" alt=""></div>` : ''}
    <strong>${esc(issuer.legalName)}</strong><br>
    ${esc(issuer.address)}<br>
    ${esc(placeLine(issuer.postalCode, issuer.city))}<br>
    ${esc(issuerIdsLine(issuer))}
    ${contact.map((c) => `<br>${esc(c)}`).join('')}
  </div>
  <hr>
  <h1>${esc(title(doc))}</h1>
  ${doc.cancelled ? '<div class="stamp">STORNIRANO</div>' : ''}
  ${doc.issuedAt ? `<p>Izdano: ${esc([issuer.city, formatDateTime(doc.issuedAt)].filter(Boolean).join(', '))}</p>` : ''}
  <p>Storitev opravljena: ${esc(formatDate(doc.serviceDate))}</p>
  ${isTransferInvoice(doc) && doc.dueDate ? `<p>Datum zapadlosti: ${esc(formatDate(doc.dueDate))}</p>` : ''}
  ${doc.originalNumber ? `<p>Dobropis k računu: ${esc(doc.originalNumber)}</p>` : ''}
  <p>Plačnik: ${esc(buyer.name)}${buyer.taxNumber ? `, davčna št. ${esc(buyer.taxNumber)}` : ''}</p>
  <hr>
  ${lines}
  <hr>
  ${totalRows(doc)
    .map((r) => `<div class="row${r.grand ? ' total' : ''}"><span>${esc(r.grand ? 'SKUPAJ' : r.label)}</span><span>${r.value}</span></div>`)
    .join('')}
  <hr>
  <p>Način plačila: ${esc(PAYMENT_METHOD_LABELS[doc.paymentMethod])}</p>
  ${
    isTransferInvoice(doc)
      ? `<p><strong>Podatki za plačilo:</strong></p>${paymentDataRows(doc)
          .map(([k, v]) => `<p>${esc(k)}: ${esc(v)}</p>`)
          .join('')}${extras.upnQrSvg ? `<div class="qr">${extras.upnQrSvg}</div>` : ''}`
      : ''
  }
  ${notes.map((n) => `<p>${esc(n)}</p>`).join('')}
  ${doc.note ? `<p>${esc(doc.note)}</p>` : ''}
  <div class="fiscal"></div>
  ${issuer.footerNote.trim() ? `<hr><p class="center">${footerHtml(issuer.footerNote)}</p>` : ''}
</div></body></html>`;
}
