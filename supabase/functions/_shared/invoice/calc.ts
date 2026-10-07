// Invoice arithmetic — pure TS, no Deno or DOM APIs, shared by the React
// editor (live totals on a draft) and, later, Edge Functions. It mirrors the
// SQL in supabase/migrations/023_add_invoicing.sql exactly, so a draft's
// preview shows the same amounts the database stores when it's issued:
//
//   line total = round(quantity × unit price × (1 − discount / 100), 2)
//   per VAT rate: vat = round(gross × rate / (100 + rate), 2), net = gross − vat
//
// Prices are FINAL prices (VAT included), like the price list. Postgres rounds
// half away from zero, so roundCents() does too (Math.round alone would round
// −0.125 to −0.12 instead of −0.13 on a credit note).

export interface CalcLine {
  quantity: number;
  unitPriceEur: number;
  discountPercent: number;
  vatRate: number;
}

export interface VatRow {
  rate: number;
  gross: number;
  vat: number;
  net: number;
}

export function roundCents(value: number): number {
  const sign = value < 0 ? -1 : 1;
  // The tiny epsilon absorbs binary noise like 1.005 * 100 = 100.49999…
  return (sign * Math.round(Math.abs(value) * 100 + 1e-7)) / 100;
}

export function lineTotal(line: CalcLine): number {
  return roundCents(line.quantity * line.unitPriceEur * (1 - line.discountPercent / 100));
}

export function vatBreakdown(lines: CalcLine[]): VatRow[] {
  const grossByRate = new Map<number, number>();
  for (const line of lines) {
    grossByRate.set(line.vatRate, roundCents((grossByRate.get(line.vatRate) ?? 0) + lineTotal(line)));
  }
  return [...grossByRate.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rate, gross]) => {
      const vat = roundCents((gross * rate) / (100 + rate));
      return { rate, gross, vat, net: roundCents(gross - vat) };
    });
}

export function invoiceTotal(lines: CalcLine[]): number {
  return roundCents(lines.reduce((sum, line) => sum + lineTotal(line), 0));
}

// ---- Per-line VAT split (for the printed columns) ---------------------------
// The binding VAT amount is per rate (vatBreakdown, same as the SQL); these
// per-line figures are what the line columns show. Their sum can differ from
// the per-rate total by a cent at most, which is normal on invoices.

/** VAT contained in one line's final amount. */
export function lineVat(line: CalcLine): number {
  return roundCents((lineTotal(line) * line.vatRate) / (100 + line.vatRate));
}

/** One line's amount without VAT. */
export function lineNet(line: CalcLine): number {
  return roundCents(lineTotal(line) - lineVat(line));
}

/** Unit price without VAT (the price list holds final prices). */
export function unitNet(line: CalcLine): number {
  return roundCents(line.unitPriceEur / (1 + line.vatRate / 100));
}

/** Total VAT of the invoice — the sum over rates, as stored at issue. */
export function invoiceVat(lines: CalcLine[]): number {
  return roundCents(vatBreakdown(lines).reduce((sum, row) => sum + row.vat, 0));
}
