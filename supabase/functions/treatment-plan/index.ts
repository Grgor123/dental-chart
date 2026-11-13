// Deno Edge Function, PUBLIC (deploy with --no-verify-jwt) — JSON API behind
// the patient's predračun page (docs/treatment-plan.html on GitHub Pages),
// opened from the button in the email that sent the predračun (migration 061).
//
//   GET  ?token=…  -> the predračun with its options, or just a status once
//                     confirmed / cancelled / expired
//   POST ?token=…  -> { variantId } — the patient picks one option and clicks
//                     "Potrjujem predračun" (no signature, Gregor); returns
//                     the PDF copy, also emailed to the patient
//
// The confirming name is always the patient's name from the record. The token
// is the only credential; after confirmation the link returns no data.
//
// Deploy: supabase functions deploy treatment-plan --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2';
import { bytesToBase64 } from '../_shared/consentPdf.ts';
import { renderPlanPdf } from '../_shared/planPdf.ts';
import { loadPlan, patientNameOf, planPdfInput, variantsOf } from '../_shared/planData.ts';
import { sendPdfCopy } from '../_shared/email/sendPdfCopy.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}

function todayLjubljana(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Ljubljana' });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  const token = new URL(req.url).searchParams.get('token');
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return json({ error: 'invalid_token' }, 404);

  const plan = await loadPlan(supabase, { token });
  if (!plan) return json({ error: 'invalid_token' }, 404);
  if (plan.accepted_at) return json({ status: 'accepted' });
  if (plan.cancelled_at) return json({ status: 'cancelled' });
  if (plan.valid_until < todayLjubljana()) return json({ status: 'expired' });

  const patientName = patientNameOf(plan);
  const variants = variantsOf(plan);

  if (req.method === 'POST') {
    const input = await req.json().catch(() => null);
    const variant = variants.find((v) => v.id === input?.variantId);
    if (!variant) return json({ error: 'Izberite možnost.' }, 400);
    const { error } = await supabase.rpc('sign_treatment_plan', {
      p_token: token,
      p_variant_id: variant.id,
      p_signer_name: patientName,
      p_signature_png: null,
      p_user_agent: (req.headers.get('user-agent') ?? '').slice(0, 400),
    });
    if (error) {
      if (/already_accepted/.test(error.message)) return json({ status: 'accepted' });
      return json({ error: 'Predračuna ni bilo mogoče potrditi.' }, 500);
    }

    // The patient's copy (PDF): returned for download and emailed. A failure
    // here never undoes the confirmation.
    let pdfBase64: string | null = null;
    let emailed = false;
    try {
      const pdf = await renderPlanPdf(
        await planPdfInput(
          supabase,
          plan,
          { at: new Date().toISOString(), via: 'link', signerName: patientName, signaturePng: null, acceptedByName: null },
          variant.id
        )
      );
      pdfBase64 = bytesToBase64(pdf);
      emailed = await sendPdfCopy(supabase, {
        patientId: plan.patient_id,
        emailType: 'treatment_plan',
        subject: `Potrjen predračun ${plan.number}`,
        heading: 'Potrjen predračun',
        paragraphs: [
          `Hvala za potrditev predračuna ${plan.number}${variants.length > 1 ? ` (izbrana možnost: ${variant.name})` : ''}. V priponki je kopija za vašo evidenco.`,
          'Za termin se dogovorimo po telefonu ali vas pokličemo. Če imate vprašanja, nam odgovorite na to sporočilo.',
        ],
        pdf: { filename: `predracun-${plan.number}.pdf`, base64: pdfBase64 },
      });
    } catch (copyError) {
      console.error(`Plan copy failed for ${plan.id}:`, copyError);
    }
    return json({ status: 'accepted', emailed, pdf: pdfBase64 });
  }

  return json({
    status: 'pending',
    practiceName: plan.practices?.name ?? '',
    patientName,
    number: plan.number,
    title: plan.title,
    note: plan.note,
    createdAt: plan.created_at,
    validUntil: plan.valid_until,
    variants,
  });
});
