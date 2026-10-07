// Payment data for bank-transfer (TRR) invoices: IBAN formatting/validation,
// the SI00 payment reference (sklic) and the UPN QR payload. Pure TS — the
// QR image itself is drawn by the caller (src/lib/upnQr.ts in the app), so
// this module stays free of npm imports and works in Deno as-is.

// ---- IBAN ---------------------------------------------------------------------

function ibanChecksumOk(compact: string): boolean {
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  return remainder === 1;
}

/**
 * Normalizes whatever was typed into a compact IBAN ("SI56040000279667334").
 * Spaces and dashes are dropped; a bare 15-digit Slovenian account number
 * gets its "SI" + check digits computed. `valid` is the mod-97 check.
 */
export function normalizeIban(input: string): { compact: string; valid: boolean } {
  let compact = input.replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{15}$/.test(compact)) {
    const remainder = [...`${compact}SI00`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))].reduce(
      (r, d) => (r * 10 + Number(d)) % 97,
      0
    );
    compact = `SI${String(98 - remainder).padStart(2, '0')}${compact}`;
  }
  const valid = /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(compact) && ibanChecksumOk(compact);
  return { compact, valid };
}

/** "SI56 0400 0027 9667 334" — groups of four, always with the country code. */
export function formatIban(input: string): string {
  const { compact } = normalizeIban(input);
  return compact.replace(/(.{4})/g, '$1 ').trim();
}

// ---- Payment reference (sklic) ---------------------------------------------------

/**
 * SI00 reference for an issued invoice: premise digits - year - sequence,
 * e.g. "SI00 1-2026-14". Model 00 allows digits and at most two hyphens, so
 * the invoice number itself (which has letters, "P1-B1-14") can't be used
 * directly; this carries the same identity. Null for a draft.
 */
export function paymentReference(invoiceNumber: string | null, issuedAt: string | null): string | null {
  if (!invoiceNumber || !issuedAt) return null;
  const parts = invoiceNumber.split('-');
  const premise = parts[0].replace(/\D/g, '') || '0';
  const sequence = parts[parts.length - 1].replace(/\D/g, '');
  const year = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Ljubljana', year: 'numeric' }).format(new Date(issuedAt));
  return `SI00 ${premise}-${year}-${sequence}`;
}

// ---- UPN QR ----------------------------------------------------------------------

export interface UpnQrInput {
  payerName: string;
  payerAddress: string;
  payerCity: string;
  amountEur: number;
  /** Payment purpose, e.g. "Placilo racuna P1-B1-14". */
  purpose: string;
  /** YYYY-MM-DD */
  dueDate: string | null;
  recipientIban: string;
  /** "SI00 1-2026-14" (the space is removed in the payload). */
  reference: string;
  recipientName: string;
  recipientAddress: string;
  recipientCity: string;
}

// č→c etc. The UPN QR standard expects ISO-8859-2 bytes plus an ECI marker
// that common QR encoders don't write, and without it banking apps can
// misread č/š/ž. Plain ASCII scans the same everywhere, and the payment is
// routed by IBAN + reference anyway.
function ascii(value: string, max: number): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, (c) => (c === 'đ' ? 'd' : 'D'))
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
    .slice(0, max);
}

/**
 * The UPN QR text (Združenje bank Slovenije, "UPN QR" standard): 19 fields
 * each ending in LF, then a 3-digit checksum (the length of everything
 * before it) and a final LF. Encode it as a QR code, version 15, error
 * correction M.
 */
export function upnQrPayload(input: UpnQrInput): string {
  const amountCents = Math.round(input.amountEur * 100);
  const due = input.dueDate ? input.dueDate.split('-').reverse().join('.') : '';
  const fields = [
    'UPNQR',
    '', // payer IBAN
    '', // deposit
    '', // withdrawal
    '', // payer reference
    ascii(input.payerName, 33),
    ascii(input.payerAddress, 33),
    ascii(input.payerCity, 33),
    String(amountCents).padStart(11, '0'),
    '', // payment date
    '', // urgent
    'MDCS', // purpose code: medical services
    ascii(input.purpose, 42),
    due,
    normalizeIban(input.recipientIban).compact,
    input.reference.replace(/\s/g, ''),
    ascii(input.recipientName, 33),
    ascii(input.recipientAddress, 33),
    ascii(input.recipientCity, 33),
  ];
  const body = fields.map((f) => `${f}\n`).join('');
  return `${body}${String(body.length).padStart(3, '0')}\n`;
}
