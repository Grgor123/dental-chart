// Deno Edge Function — sends the health questionnaire email. Two callers:
//
//   1. The send_questionnaire_on_confirmation trigger (migration 022), when an
//      appointment becomes 'confirmed' — body { appointmentId }, authorized
//      with the service-role key like every trigger-invoked function. This is
//      the automatic send, so the 12-month / open-link rules apply.
//   2. The "Pošlji vprašalnik" button on the Patient Record page — body
//      { patientId }, called with the signed-in user's own session (default
//      JWT verification ON), same shape as email-template-preview. Always
//      sends (staff asked for it).
//
// The patient is looked up through a client carrying THAT user's JWT first,
// so RLS decides whether this user may touch this patient at all — a patient
// id from another practice simply isn't found. Only then does the service-role
// client do the actual send (it needs to write health_questionnaires/email_log
// and read the practice's sender settings).
//
// Deploy: supabase functions deploy send-health-questionnaire
import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendQuestionnaireEmail } from '../_shared/email/sendQuestionnaireEmail.ts';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => null);

  // 1. Trigger call (automatic, on confirmation).
  if (authHeader === `Bearer ${SERVICE_ROLE_KEY}`) {
    const appointmentId = typeof body?.appointmentId === 'string' ? body.appointmentId : null;
    if (!appointmentId) return json({ error: 'Missing appointmentId' }, 400);
    const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: appointment } = await service.from('appointments').select('patient_id').eq('id', appointmentId).maybeSingle();
    if (!appointment?.patient_id) return json({ status: 'skipped', reason: 'appointment not found' });
    const outcome = await sendQuestionnaireEmail(service, {
      patientId: appointment.patient_id as string,
      appointmentId,
      force: false,
    });
    if (outcome.status === 'failed') return json({ error: outcome.error }, 502);
    return json(outcome);
  }

  // 2. Manual button.
  const patientId = typeof body?.patientId === 'string' ? body.patientId : null;
  if (!patientId) return json({ error: 'Missing patientId' }, 400);

  const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: visible } = await asUser.from('patients').select('id').eq('id', patientId).maybeSingle();
  if (!visible) return json({ error: 'Patient not found' }, 404);

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const outcome = await sendQuestionnaireEmail(service, { patientId, appointmentId: null, force: true });

  if (outcome.status === 'failed') return json({ error: outcome.error }, 502);
  if (outcome.status === 'skipped') return json({ error: outcome.reason }, 409);
  return json({ status: 'sent' });
});
