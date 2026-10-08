// Fiscal verification of one invoice (davčno potrjevanje računa):
// computes the ZOI, sends the signed InvoiceRequest and returns FURS's EOR.
// Endpoint: POST {base}/invoices, body {"token": <JWS>}.
import { crypto as stdCrypto } from 'jsr:@std/crypto@1';
import { fursPost } from './client.ts';
import { decodeFursJws, fursDateTime, rsaSha256Sign, signFursJws } from './jws.ts';
import type { FursResult } from './premise.ts';

export interface FursVatRow {
  /** Percent, e.g. 22 or 9.5; 0 = exempt (oproščeno). */
  rate: number;
  net: number;
  vat: number;
  gross: number;
}

export interface FursInvoiceInput {
  taxNumber: number;
  issuedAt: Date;
  premiseId: string;
  deviceId: string;
  /** The running number within premise + year (14 in P1-B1-14). */
  sequenceNumber: number;
  /** Total incl. VAT; negative on a credit note. */
  total: number;
  vatRows: FursVatRow[];
  /** Tax number of the person who issued the invoice. */
  operatorTaxNumber: number;
  /** True when the invoice was issued earlier and is only now sent (FURS was unreachable). */
  subsequentSubmit: boolean;
  /** On a credit note: the invoice it cancels. */
  reference?: { premiseId: string; deviceId: string; sequenceNumber: number; issuedAt: Date };
  /** ZOI computed at issue time — pass it on resends so it never changes. */
  zoi?: string;
}

export interface FursInvoiceResult extends FursResult {
  zoi: string;
  /** EOR (enkratna identifikacijska oznaka računa), when FURS confirmed it. */
  eor?: string;
}

const amount = (value: number) => Math.round(value * 100) / 100;

/** "08.10.2026 21:15:03" — the ZOI's date format. */
function zoiDateTime(date: Date): string {
  const [d, t] = fursDateTime(date).split('T');
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y} ${t}`;
}

/** ZOI (zaščitna oznaka izdajatelja računa): MD5 of the RSA-SHA256 signature
    of tax number + issue time + number + premise + device + total. */
export async function computeZoi(input: FursInvoiceInput): Promise<string> {
  const text =
    `${input.taxNumber}${zoiDateTime(input.issuedAt)}${input.sequenceNumber}` +
    `${input.premiseId}${input.deviceId}${amount(input.total).toFixed(2)}`;
  const signature = await rsaSha256Sign(new TextEncoder().encode(text));
  const md5 = new Uint8Array(await stdCrypto.subtle.digest('MD5', signature));
  return Array.from(md5, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The 60-digit value of the FURS QR code printed on the invoice: ZOI as a
    39-digit decimal + tax number + issue time (yyMMddHHmmss) + check digit. */
export function fursQrValue(zoi: string, taxNumber: number, issuedAt: Date): string {
  const zoiDecimal = BigInt(`0x${zoi}`).toString().padStart(39, '0');
  const [d, t] = fursDateTime(issuedAt).split('T');
  const stamp = d.slice(2).replace(/-/g, '') + t.replace(/:/g, '');
  const digits = `${zoiDecimal}${taxNumber}${stamp}`;
  const check = [...digits].reduce((sum, c) => sum + Number(c), 0) % 10;
  return `${digits}${check}`;
}

function taxes(vatRows: FursVatRow[]) {
  const vat = vatRows
    .filter((r) => r.rate > 0)
    .map((r) => ({ TaxRate: amount(r.rate), TaxableAmount: amount(r.net), TaxAmount: amount(r.vat) }));
  const exempt = amount(vatRows.filter((r) => r.rate === 0).reduce((sum, r) => sum + r.gross, 0));
  const seller: Record<string, unknown> = {};
  if (vat.length) seller.VAT = vat;
  if (exempt !== 0) seller.ExemptVATTaxableAmount = exempt;
  return [seller];
}

export async function fiscalizeInvoice(input: FursInvoiceInput): Promise<FursInvoiceResult> {
  const zoi = input.zoi ?? (await computeZoi(input));
  const invoice: Record<string, unknown> = {
    TaxNumber: input.taxNumber,
    IssueDateTime: fursDateTime(input.issuedAt),
    NumberingStructure: 'C', // numbered centrally per premise
    InvoiceIdentifier: {
      BusinessPremiseID: input.premiseId,
      ElectronicDeviceID: input.deviceId,
      InvoiceNumber: String(input.sequenceNumber),
    },
    InvoiceAmount: amount(input.total),
    PaymentAmount: amount(input.total),
    TaxesPerSeller: taxes(input.vatRows),
    OperatorTaxNumber: input.operatorTaxNumber,
    ProtectedID: zoi,
    SubsequentSubmit: input.subsequentSubmit,
  };
  if (input.reference) {
    invoice.ReferenceInvoice = [
      {
        ReferenceInvoiceIdentifier: {
          BusinessPremiseID: input.reference.premiseId,
          ElectronicDeviceID: input.reference.deviceId,
          InvoiceNumber: String(input.reference.sequenceNumber),
        },
        ReferenceInvoiceIssueDateTime: fursDateTime(input.reference.issuedAt),
      },
    ];
  }
  const payload = { InvoiceRequest: { Header: { MessageID: crypto.randomUUID(), DateTime: fursDateTime() }, Invoice: invoice } };

  const { status, json, text } = await fursPost('invoices', { token: await signFursJws(payload) });
  const token = (json as { token?: string } | null)?.token;
  if (!token) return { ok: false, zoi, errorMessage: `FURS HTTP ${status}: ${text.slice(0, 300)}`, response: json ?? text };
  const response = decodeFursJws(token) as {
    InvoiceResponse?: { UniqueInvoiceID?: string; Error?: { ErrorCode?: string; ErrorMessage?: string } };
  };
  const error = response.InvoiceResponse?.Error;
  if (error) return { ok: false, zoi, errorCode: error.ErrorCode, errorMessage: error.ErrorMessage, response };
  const eor = response.InvoiceResponse?.UniqueInvoiceID;
  return eor ? { ok: true, zoi, eor, response } : { ok: false, zoi, errorMessage: 'FURS answer had no EOR', response };
}
