// Deno Edge Function — davčno potrjevanje (FURS fiscal verification) of an
// issued cash or card invoice / credit note. See CLAUDE.md "FURS".
//
// Two callers:
//   - the browser, right after "Izdaj račun" / "Storniraj" (signed-in user's
//     JWT, body {invoiceId}) — the invoice is read through that user's RLS
//     first, so an id from another practice simply isn't found;
//   - the cron job every 10 minutes (service-role bearer, {retryPending:true})
//     — re-sends invoices FURS hasn't confirmed yet (unreachable at issue
//     time), marked SubsequentSubmit as the rules require.
//
// Per invoice: the ZOI is computed once (deterministic from the issue data)
// and stored BEFORE sending, so the printout always has it; FURS's EOR is
// stored on success. A FURS refusal is 'failed' (needs a person); a network
// error stays 'pending' for the retry. Writes go through
// record_invoice_furs() (service role), the only way past the issued
// invoice's immutability.
//
// Deploy: supabase functions deploy fiscalize-invoice
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { FURS_ENV } from '../_shared/furs/client.ts';
import { computeZoi, fiscalizeInvoice, fursQrValue, type FursInvoiceInput, type FursVatRow } from '../_shared/furs/invoice.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

const INVOICE_COLUMNS =
  'id, practice_id, kind, status, payment_method, premise_code, device_code, sequence_number, issued_at, issued_by, total_eur, vat_breakdown, original_invoice_id, furs_status, furs_zoi, furs_operator_tax_number, furs_attempts';

type InvoiceRow = {
  id: string;
  practice_id: string;
  kind: 'invoice' | 'credit_note';
  status: string;
  payment_method: string;
  premise_code: string;
  device_code: string;
  sequence_number: number;
  issued_at: string;
  issued_by: string | null;
  total_eur: number;
  vat_breakdown: FursVatRow[];
  original_invoice_id: string | null;
  furs_status: string | null;
  furs_zoi: string | null;
  furs_operator_tax_number: string | null;
  furs_attempts: number;
};

export type FiscalizeOutcome =
  | { status: 'confirmed'; eor: string; zoi: string }
  | { status: 'pending' | 'failed'; zoi?: string; error: string }
  | { status: 'skipped'; reason: string };

async function record(service: SupabaseClient, id: string, values: { status: string; zoi?: string; eor?: string; qr?: string; operator?: string; error?: string | null }) {
  const { error } = await service.rpc('record_invoice_furs', {
    p_invoice_id: id,
    p_status: values.status,
    p_zoi: values.zoi ?? null,
    p_eor: values.eor ?? null,
    p_qr: values.qr ?? null,
    p_operator_tax_number: values.operator ?? null,
    p_error: values.error ?? null,
  });
  if (error) console.error(`record_invoice_furs failed for ${id}:`, error.message);
}

async function processInvoice(service: SupabaseClient, inv: InvoiceRow): Promise<FiscalizeOutcome> {
  if (inv.status !== 'issued') return { status: 'skipped', reason: 'not_issued' };
  if (inv.payment_method !== 'cash' && inv.payment_method !== 'card') return { status: 'skipped', reason: 'not_cash_or_card' };
  if (inv.furs_status === 'confirmed') return { status: 'skipped', reason: 'already_confirmed' };

  // FURS is on for a practice once its premise is registered in this environment.
  const { data: premise } = await service
    .from('furs_premises')
    .select('premise_code')
    .eq('practice_id', inv.practice_id)
    .eq('premise_code', inv.premise_code)
    .eq('environment', FURS_ENV)
    .maybeSingle();
  if (!premise) return { status: 'skipped', reason: 'premise_not_registered' };

  const taxNumber = Number(Deno.env.get('FURS_TAX_NUMBER'));
  let operator = inv.furs_operator_tax_number;
  if (!operator && inv.issued_by) {
    const { data: profile } = await service.from('user_profiles').select('tax_number').eq('user_id', inv.issued_by).maybeSingle();
    operator = (profile?.tax_number as string | null) ?? null;
  }
  if (!operator) {
    const error = 'Izdajatelj računa nima vpisane davčne številke (Nastavitve → Moj profil).';
    await record(service, inv.id, { status: 'failed', error });
    return { status: 'failed', error };
  }

  let reference: FursInvoiceInput['reference'];
  if (inv.kind === 'credit_note' && inv.original_invoice_id) {
    const { data: original } = await service
      .from('invoices')
      .select('premise_code, device_code, sequence_number, issued_at')
      .eq('id', inv.original_invoice_id)
      .single();
    if (original) {
      reference = {
        premiseId: original.premise_code as string,
        deviceId: original.device_code as string,
        sequenceNumber: original.sequence_number as number,
        issuedAt: new Date(original.issued_at as string),
      };
    }
  }

  const issuedAt = new Date(inv.issued_at);
  const input: FursInvoiceInput = {
    taxNumber,
    issuedAt,
    premiseId: inv.premise_code,
    deviceId: inv.device_code,
    sequenceNumber: inv.sequence_number,
    total: Number(inv.total_eur),
    vatRows: (inv.vat_breakdown ?? []).map((r) => ({ rate: Number(r.rate), net: Number(r.net), vat: Number(r.vat), gross: Number(r.gross) })),
    operatorTaxNumber: Number(operator),
    // Sent later than at issue time (an earlier attempt failed, or FURS was
    // never reached) — FURS requires the flag then.
    subsequentSubmit: inv.furs_attempts > 0 || Date.now() - issuedAt.getTime() > 2 * 60 * 1000,
    reference,
    zoi: inv.furs_zoi ?? undefined,
  };

  // The ZOI and QR value go onto the invoice before sending, so the printout
  // has them even if FURS doesn't answer.
  const zoi = input.zoi ?? (await computeZoi(input));
  input.zoi = zoi;
  const qr = fursQrValue(zoi, taxNumber, issuedAt);
  if (!inv.furs_zoi) await record(service, inv.id, { status: 'pending', zoi, qr, operator });

  try {
    const result = await fiscalizeInvoice(input);
    if (result.ok && result.eor) {
      await record(service, inv.id, { status: 'confirmed', eor: result.eor, error: null });
      return { status: 'confirmed', eor: result.eor, zoi };
    }
    const error = [result.errorCode, result.errorMessage].filter(Boolean).join(': ') || 'FURS ni potrdil računa.';
    // An HTTP-level failure (no JWS answer) is worth retrying; a FURS error code isn't.
    const status = result.errorCode ? 'failed' : 'pending';
    await record(service, inv.id, { status, error });
    return { status, zoi, error };
  } catch (sendError) {
    const error = `FURS ni dosegljiv: ${sendError instanceof Error ? sendError.message : String(sendError)}`;
    await record(service, inv.id, { status: 'pending', error });
    return { status: 'pending', zoi, error };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);
  const body = await req.json().catch(() => ({}));
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Cron: retry everything still waiting.
  if (authHeader === `Bearer ${SERVICE_ROLE_KEY}` && body?.retryPending) {
    const { data, error } = await service.from('invoices').select(INVOICE_COLUMNS).eq('furs_status', 'pending').limit(50);
    if (error) return json({ error: error.message }, 500);
    const results = [];
    for (const inv of (data ?? []) as InvoiceRow[]) results.push({ id: inv.id, ...(await processInvoice(service, inv)) });
    return json({ retried: results.length, results });
  }

  // Browser: one invoice, through the caller's RLS.
  const invoiceId = typeof body?.invoiceId === 'string' ? body.invoiceId : null;
  if (!invoiceId) return json({ error: 'Missing invoiceId' }, 400);
  const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: inv, error } = await asUser.from('invoices').select(INVOICE_COLUMNS).eq('id', invoiceId).maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!inv) return json({ error: 'Račun ni bil najden.' }, 404);
  try {
    return json(await processInvoice(service, inv as InvoiceRow));
  } catch (e) {
    return json({ status: 'pending', error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
