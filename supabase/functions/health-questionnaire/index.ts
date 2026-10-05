// Deno Edge Function, PUBLIC (deploy with --no-verify-jwt) — JSON API behind
// the patient-facing health questionnaire page. Same reason as
// sms-consent-confirm for why this only serves JSON: Supabase rewrites
// text/html to text/plain on the shared *.supabase.co domain
// (https://github.com/supabase/supabase/issues/50214), so the page itself is
// docs/health-questionnaire.html on GitHub Pages and calls this via fetch().
//
//   GET  ?token=…  -> the form definition + the patient's prefilled contact
//                     details, or just a status if submitted/expired
//   POST ?token=…  -> saves the answers (once)
//
// The token is the only credential, so the link stops returning ANY personal
// data once the questionnaire is submitted or its 30-day validity runs out.
//
// Deploy: supabase functions deploy health-questionnaire --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  CONDITIONS,
  CONTACT_FIELDS,
  FORM_TEXT,
  FORM_VERSION,
  MEDICATION_FREQUENCIES,
  validateAnswers,
  visibleQuestions,
  type ContactData,
} from '../_shared/questionnaire.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Wide open — the endpoint is already gated by an unguessable token (same
// reasoning as sms-consent-confirm).
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}

interface QuestionnaireRow {
  id: string;
  patient_id: string;
  expires_at: string;
  submitted_at: string | null;
  patients: {
    first_name: string;
    last_name: string;
    dob: string;
    sex: 'M' | 'F' | null;
    address: string | null;
    postal_code: string | null;
    city: string | null;
    phone: string | null;
    email: string | null;
    marketing_consent: boolean;
  } | null;
  practices: { name: string } | null;
}

function contactFromPatient(p: NonNullable<QuestionnaireRow['patients']>): ContactData {
  return {
    firstName: p.first_name ?? '',
    lastName: p.last_name ?? '',
    dob: p.dob ?? '',
    address: p.address ?? '',
    postalCode: p.postal_code ?? '',
    city: p.city ?? '',
    phone: p.phone ?? '',
    email: p.email ?? '',
  };
}

// Patients type phones however they like ("041 123 456"); the app stores
// E.164 ("+38641123456", react-phone-number-input with SI default), so
// normalize the same way before staff compare/apply it.
function normalizePhone(raw: string): string {
  const compact = raw.replace(/[\s\-/().]/g, '');
  if (!compact) return '';
  if (compact.startsWith('+')) return compact;
  if (compact.startsWith('00')) return `+${compact.slice(2)}`;
  if (compact.startsWith('0')) return `+386${compact.slice(1)}`;
  return compact;
}

function cleanContact(raw: unknown): ContactData | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;
  const contact = {} as ContactData;
  for (const field of CONTACT_FIELDS) {
    const value = input[field.key];
    contact[field.key] = typeof value === 'string' ? value.trim().slice(0, 200) : '';
  }
  if (!contact.firstName || !contact.lastName) return null;
  if (contact.dob && !/^\d{4}-\d{2}-\d{2}$/.test(contact.dob)) return null;
  contact.phone = normalizePhone(contact.phone);
  contact.email = contact.email.toLowerCase();
  return contact;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  const token = new URL(req.url).searchParams.get('token');
  if (!token) return json({ error: 'missing_token' }, 400);

  const { data } = await supabase
    .from('health_questionnaires')
    .select('id, patient_id, expires_at, submitted_at, patients(first_name, last_name, dob, sex, address, postal_code, city, phone, email, marketing_consent), practices(name)')
    .eq('token', token)
    .maybeSingle();
  const row = data as unknown as QuestionnaireRow | null;
  if (!row || !row.patients) return json({ error: 'invalid_token' }, 404);

  const practiceName = row.practices?.name ?? '';
  if (row.submitted_at) return json({ status: 'submitted', practiceName });
  if (new Date(row.expires_at) < new Date()) return json({ status: 'expired', practiceName });

  const sex = row.patients.sex;

  if (req.method === 'POST') {
    const body = await req.json().catch(() => null);
    if (!body) return json({ error: 'invalid_body' }, 400);

    const validated = validateAnswers(body.answers, sex);
    if ('error' in validated) return json({ error: validated.error }, 400);
    const contact = cleanContact(body.contact);
    if (!contact) return json({ error: 'invalid_contact' }, 400);
    const signatureName = typeof body.signatureName === 'string' ? body.signatureName.trim().slice(0, 200) : '';
    if (!signatureName || body.confirmed !== true) return json({ error: 'missing_signature' }, 400);
    const language = body.language === 'en' ? 'en' : 'sl';
    // A patient who already consented never sees the box (see GET below), so
    // their consent is kept as-is — submitting can only ever GRANT it.
    // Withdrawal happens via the unsubscribe link or staff, not here.
    const alreadyConsented = row.patients.marketing_consent;
    const marketingConsent = alreadyConsented || body.marketingConsent === true;
    const marketingText = FORM_TEXT.marketingText[language];

    // `.is('submitted_at', null)` makes a double submit (two tabs, a
    // double-click) a no-op instead of overwriting the first answers.
    const { error } = await supabase
      .from('health_questionnaires')
      .update({
        submitted_at: new Date().toISOString(),
        language,
        form_version: FORM_VERSION,
        answers: validated.answers,
        signature_name: signatureName,
        submitted_contact: contact,
        // null = the box wasn't shown (already consented earlier).
        marketing_consent: alreadyConsented ? null : marketingConsent,
        marketing_consent_text: alreadyConsented ? null : marketingText,
      })
      .eq('id', row.id)
      .is('submitted_at', null);
    if (error) return json({ error: 'save_failed' }, 500);

    // A new consent goes straight onto the patient (unlike contact
    // corrections, there's nothing for staff to check — it's the patient's
    // own choice).
    if (marketingConsent && !alreadyConsented) {
      await supabase
        .from('patients')
        .update({
          marketing_consent: true,
          marketing_consent_at: new Date().toISOString(),
          marketing_consent_source: 'questionnaire',
          marketing_consent_text: marketingText,
        })
        .eq('id', row.patient_id);
    }
    return json({ status: 'submitted', practiceName });
  }

  return json({
    status: 'open',
    practiceName,
    contact: contactFromPatient(row.patients),
    // The page hides the marketing section entirely when this is true.
    alreadyConsented: row.patients.marketing_consent,
    form: {
      questions: visibleQuestions(sex),
      conditions: CONDITIONS,
      frequencies: MEDICATION_FREQUENCIES,
      text: FORM_TEXT,
      contactFields: CONTACT_FIELDS,
    },
  });
});
