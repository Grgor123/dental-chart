// Deno Edge Function — emails a patient the link to review and accept a
// predračun (treatment_plans, migration 061). Called from the predračun page
// ("Pošlji po e-pošti") with the signed-in user's session (default JWT
// verification ON); body { planId }. The predračun is attached as a PDF; the
// email's button opens docs/treatment-plan.html, where the patient picks an
// option and clicks "Potrjujem predračun" (Gregor).
//
// The plan is looked up through a client carrying THAT user's JWT first, so
// RLS decides whether this user may touch it at all. Only then does the
// service-role client send (sender settings, email_log).
//
// Deploy: supabase functions deploy send-treatment-plan
import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendEmail, resolveSenderIdentity } from '../_shared/email/send.ts';
import { renderTemplate } from '../_shared/email/templates.ts';
import { logEmail, resolveUnsubscribeToken } from '../_shared/email/log.ts';
import { loadTemplateOverride, unsubscribeUrl } from '../_shared/email/sendAppointmentEmail.ts';
import { publicPageUrl } from '../_shared/publicPages.ts';
import { bytesToBase64 } from '../_shared/consentPdf.ts';
import { renderPlanPdf } from '../_shared/planPdf.ts';
import { loadPlan, planPdfInput, variantsOf } from '../_shared/planData.ts';

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

interface PatientRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  email_opt_out: boolean;
  practice_id: string;
  practices: {
    name: string;
    contact_email: string | null;
    email_sending_mode: 'platform_default' | 'custom_domain';
    custom_domain: string | null;
    custom_domain_sender_local_part: string;
    custom_domain_verified: boolean;
  } | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => null);
  const planId = typeof body?.planId === 'string' ? body.planId : null;
  if (!planId) return json({ error: 'Missing planId' }, 400);

  const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: plan } = await asUser
    .from('treatment_plans')
    .select('id, patient_id, token, accepted_at, cancelled_at, valid_until')
    .eq('id', planId)
    .maybeSingle();
  if (!plan) return json({ error: 'Predračuna ni mogoče najti.' }, 404);
  if (plan.accepted_at) return json({ error: 'Predračun je že sprejet.' }, 409);
  if (plan.cancelled_at) return json({ error: 'Predračun je preklican.' }, 409);
  if ((plan.valid_until as string) < new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Ljubljana' })) {
    return json({ error: 'Predračun je potekel — podaljšajte veljavnost.' }, 409);
  }

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data } = await service
    .from('patients')
    .select(
      'id, first_name, last_name, email, email_opt_out, practice_id, practices(name, contact_email, email_sending_mode, custom_domain, custom_domain_sender_local_part, custom_domain_verified)'
    )
    .eq('id', plan.patient_id)
    .single();
  const patient = data as unknown as PatientRow | null;
  const practice = patient?.practices;
  if (!patient || !practice) return json({ error: 'Pacienta ni mogoče najti.' }, 404);
  if (!patient.email) return json({ error: 'Pacient nima e-poštnega naslova.' }, 409);
  if (patient.email_opt_out) return json({ error: 'Pacient se je odjavil od e-pošte — uporabite kodo QR.' }, 409);

  // The predračun itself, every option, as a PDF attachment.
  const fullPlan = await loadPlan(service, { id: plan.id as string });
  if (!fullPlan || variantsOf(fullPlan).length === 0) return json({ error: 'Predračun nima postavk.' }, 409);
  let pdfBase64: string;
  try {
    pdfBase64 = bytesToBase64(await renderPlanPdf(await planPdfInput(service, fullPlan, null, null)));
  } catch (pdfError) {
    console.error(`Plan PDF failed for ${plan.id}:`, pdfError);
    return json({ error: 'PDF predračuna ni bilo mogoče pripraviti.' }, 500);
  }

  await service.from('treatment_plans').update({ sent_at: new Date().toISOString() }).eq('id', plan.id);

  const override = await loadTemplateOverride(service, patient.practice_id, 'treatment_plan');
  const sender = resolveSenderIdentity({
    name: practice.name,
    emailSendingMode: practice.email_sending_mode,
    customDomain: practice.custom_domain,
    customDomainSenderLocalPart: practice.custom_domain_sender_local_part,
    customDomainVerified: practice.custom_domain_verified,
  });
  const unsubscribeToken = await resolveUnsubscribeToken(service, patient.id);
  const content = renderTemplate(
    'treatment_plan',
    override,
    { ime: patient.first_name, priimek: patient.last_name, datum: '', ura: '', storitev: '', terapevt: '', ordinacija: practice.name },
    {
      practiceName: practice.name,
      unsubscribeUrl: unsubscribeUrl(unsubscribeToken),
      actionUrl: publicPageUrl('treatment-plan.html', plan.token as string),
    }
  );

  try {
    const { messageId } = await sendEmail({
      to: patient.email,
      sender,
      replyTo: practice.contact_email,
      subject: content.subject,
      html: content.html,
      attachmentIcs: null,
      attachments: [{ filename: `predracun-${fullPlan.number}.pdf`, contentType: 'application/pdf', base64: pdfBase64 }],
    });
    await logEmail(service, {
      patientId: patient.id,
      appointmentId: null,
      emailType: 'treatment_plan',
      recipientEmail: patient.email,
      subject: content.subject,
      bodyHtml: content.html,
      status: 'sent',
      providerMessageId: messageId,
      senderDomain: sender.fromDomain,
    });
    return json({ status: 'sent', sentTo: patient.email });
  } catch (sendError) {
    const message = sendError instanceof Error ? sendError.message : String(sendError);
    console.error(`SES plan send failed for patient ${patient.id}:`, sendError);
    await logEmail(service, {
      patientId: patient.id,
      appointmentId: null,
      emailType: 'treatment_plan',
      recipientEmail: patient.email,
      subject: content.subject,
      bodyHtml: content.html,
      status: 'failed',
      senderDomain: sender.fromDomain,
      errorMessage: message,
    });
    return json({ error: message }, 502);
  }
});
