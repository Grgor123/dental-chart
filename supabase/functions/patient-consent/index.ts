// Deno Edge Function, PUBLIC (deploy with --no-verify-jwt) — JSON API behind
// the consent page the patient opens from the QR code shown in the practice
// or from the emailed link (docs/patient-consent.html on GitHub Pages;
// same reason as health-questionnaire for why this only serves JSON).
//
//   GET  ?token=…  -> the consent to read (practice, patient, title, text,
//                     details), or just a status once signed / cancelled /
//                     expired
//   POST ?token=…  -> { signature } — the drawn signature as a PNG
//                     data URL; signs once
//
// The token is the only credential, so the link stops returning the text and
// the patient's name once the consent is signed, cancelled or expired.
//
// Deploy: supabase functions deploy patient-consent --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendConsentCopy } from '../_shared/email/sendConsentCopy.ts';
import { bytesToBase64, renderConsentPdf } from '../_shared/consentPdf.ts';

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

interface ConsentRow {
  id: string;
  title: string;
  body: string;
  details: string | null;
  expires_at: string;
  signed_at: string | null;
  cancelled_at: string | null;
  explained_by_name: string | null;
  explained_at: string | null;
  practice_id: string;
  patients: { first_name: string; last_name: string } | null;
  practices: { name: string } | null;
}

const MAX_SIGNATURE_LENGTH = 400000;
const PNG_PREFIX = 'data:image/png;base64,';

/** A real PNG of plausible size (an empty canvas is a few hundred bytes). */
function validSignature(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith(PNG_PREFIX) || value.length > MAX_SIGNATURE_LENGTH) return false;
  try {
    const bytes = Uint8Array.from(atob(value.slice(PNG_PREFIX.length, PNG_PREFIX.length + 12)), (c) => c.charCodeAt(0));
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && value.length > 1500;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  const token = new URL(req.url).searchParams.get('token');
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return json({ error: 'invalid_token' }, 404);

  const { data } = await supabase
    .from('patient_consents')
    .select('id, practice_id, title, body, details, expires_at, signed_at, cancelled_at, explained_by_name, explained_at, patients(first_name, last_name), practices(name)')
    .eq('token', token)
    .maybeSingle();
  const consent = data as unknown as ConsentRow | null;
  if (!consent) return json({ error: 'invalid_token' }, 404);
  if (consent.signed_at) return json({ status: 'signed' });
  if (consent.cancelled_at) return json({ status: 'cancelled' });
  if (new Date(consent.expires_at).getTime() < Date.now()) return json({ status: 'expired' });

  if (req.method === 'POST') {
    const input = await req.json().catch(() => null);
    // The signer is the patient as recorded in the practice — never typed.
    const signerName = consent.patients ? `${consent.patients.first_name} ${consent.patients.last_name}`.trim().slice(0, 120) : '';
    if (signerName.length < 2) return json({ error: 'Soglasja ni bilo mogoče shraniti.' }, 500);
    if (!validSignature(input?.signature)) return json({ error: 'Podpis manjka ali ni veljaven.' }, 400);
    const signedAt = new Date().toISOString();
    const { data: updated, error } = await supabase
      .from('patient_consents')
      .update({
        signed_at: signedAt,
        signed_via: 'link',
        signer_name: signerName,
        signature_png: input.signature,
        signer_user_agent: (req.headers.get('user-agent') ?? '').slice(0, 400),
      })
      .eq('id', consent.id)
      .is('signed_at', null)
      .is('cancelled_at', null)
      .select('id');
    if (error) return json({ error: 'Soglasja ni bilo mogoče shraniti.' }, 500);
    if (!updated || updated.length === 0) return json({ status: 'signed' });
    // The patient's copy as a PDF: returned for the page's download button and
    // emailed (if the patient has an address and didn't unsubscribe). A
    // failure here never undoes the signature.
    let pdfBase64: string | null = null;
    let emailed = false;
    try {
      const { data: issuer } = await supabase
        .from('invoice_settings')
        .select('legal_name, address, postal_code, city, phone, email')
        .eq('practice_id', consent.practice_id)
        .maybeSingle();
      const pdf = await renderConsentPdf({
        practiceName: issuer?.legal_name || consent.practices?.name || '',
        practiceLines: issuer
          ? [issuer.address ?? '', [issuer.postal_code, issuer.city].filter(Boolean).join(' '), issuer.phone ?? '', issuer.email ?? '']
          : [],
        patientName: signerName,
        title: consent.title,
        body: consent.body,
        details: consent.details,
        signerName,
        signedAt,
        signaturePng: input.signature,
        explainedByName: consent.explained_by_name,
        explainedAt: consent.explained_at,
      });
      pdfBase64 = bytesToBase64(pdf);
      emailed = await sendConsentCopy(supabase, consent.id, { filename: 'soglasje.pdf', base64: pdfBase64 });
    } catch (copyError) {
      console.error(`Consent copy failed for ${consent.id}:`, copyError);
    }
    return json({ status: 'signed', signedAt, signerName, emailed, pdf: pdfBase64 });
  }

  return json({
    status: 'pending',
    practiceName: consent.practices?.name ?? '',
    patientName: consent.patients ? `${consent.patients.first_name} ${consent.patients.last_name}`.trim() : '',
    title: consent.title,
    body: consent.body,
    details: consent.details,
    explainedByName: consent.explained_by_name,
  });
});
