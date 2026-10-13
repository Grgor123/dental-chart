// Deno Edge Function — emails a patient the aftercare instructions
// ("Navodila po posegu", migration 034) ticked on an issued invoice: the
// practice's editable "aftercare" intro, then each topic as a section.
//
// Called from the browser with the signed-in user's own session (default JWT
// verification ON), right after "Izdaj račun" (`auto: true`) or by hand with
// "Pošlji znova". The invoice, its lines and the topics are read through a
// client carrying THAT user's JWT, so RLS decides whether this user may touch
// them at all. Only then does the service-role client read the patient's
// address/opt-out and the practice's sender settings, and write email_log.
//
// Which topics: the invoice's aftercare_topic_ids; null there means nothing
// was chosen by hand, so the topics linked to the categories of the
// invoice's services are used.
//
// It's a service message like the appointment emails: never sent to a patient
// who unsubscribed (they get a printout instead), and it carries the
// unsubscribe footer. An automatic send respects the template's on/off switch
// and goes out only once per invoice; a manual send always goes.
//
// Deploy: supabase functions deploy send-aftercare-email
import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolveSenderIdentity, sendEmail } from '../_shared/email/send.ts';
import { formatDate, renderTemplate } from '../_shared/email/templates.ts';
import { logEmail, resolveUnsubscribeToken } from '../_shared/email/log.ts';
import { UNSUBSCRIBE_PAGE_URL } from '../_shared/email/sendAppointmentEmail.ts';

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

type Skipped = 'no_topics' | 'no_patient' | 'no_email' | 'opted_out' | 'disabled' | 'already_sent';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => null);
  const invoiceId = typeof body?.invoiceId === 'string' ? body.invoiceId : null;
  const auto = body?.auto === true;
  if (!invoiceId) return json({ error: 'Missing invoiceId' }, 400);
  const skipped = (reason: Skipped) => json({ status: 'skipped', reason });

  // ---- Through the user's own RLS ------------------------------------------------
  const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: invoice } = await asUser
    .from('invoices')
    .select('id, practice_id, patient_id, status, kind, service_date, aftercare_topic_ids, invoice_lines(service_id)')
    .eq('id', invoiceId)
    .maybeSingle();
  if (!invoice) return json({ error: 'Račun ni bil najden.' }, 404);
  if (invoice.status !== 'issued' || invoice.kind !== 'invoice') return json({ error: 'Navodila je mogoče poslati le z izdanim računom.' }, 409);
  if (!invoice.patient_id) return skipped('no_patient');

  let topicIds: string[] = (invoice.aftercare_topic_ids as string[] | null) ?? [];
  if (invoice.aftercare_topic_ids === null) {
    // Nothing chosen by hand: the topics of the services' categories.
    const serviceIds = ((invoice.invoice_lines as { service_id: string | null }[] | null) ?? [])
      .map((l) => l.service_id)
      .filter((id): id is string => !!id);
    if (serviceIds.length > 0) {
      const { data: services } = await asUser.from('services').select('category_id').in('id', serviceIds);
      const categoryIds = [...new Set((services ?? []).map((s) => s.category_id as string | null).filter((id): id is string => !!id))];
      if (categoryIds.length > 0) {
        const { data: links } = await asUser.from('aftercare_topic_categories').select('topic_id').in('category_id', categoryIds);
        topicIds = [...new Set((links ?? []).map((l) => l.topic_id as string))];
      }
    }
  }
  if (topicIds.length === 0) return skipped('no_topics');
  const { data: topics } = await asUser
    .from('aftercare_topics')
    .select('title, body')
    .in('id', topicIds)
    .eq('is_active', true)
    .order('sort_order')
    .order('title');
  if (!topics || topics.length === 0) return skipped('no_topics');

  // ---- Service role: patient, practice, template, log ----------------------------
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: patient } = await service
    .from('patients')
    .select('id, first_name, last_name, email, email_opt_out')
    .eq('id', invoice.patient_id)
    .single();
  if (!patient) return skipped('no_patient');
  const to = (patient.email as string | null)?.trim();
  if (!to) return skipped('no_email');
  if (patient.email_opt_out) return skipped('opted_out');

  const { data: override } = await service
    .from('email_templates')
    .select('subject, heading, body, enabled')
    .eq('practice_id', invoice.practice_id)
    .eq('template_key', 'aftercare')
    .maybeSingle();
  if (auto) {
    if (override && override.enabled === false) return skipped('disabled');
    const { data: earlier } = await service
      .from('email_log')
      .select('id')
      .eq('invoice_id', invoice.id)
      .eq('email_type', 'aftercare')
      // 'delivered' once SES reports back — anything but a failure counts.
      .not('status', 'in', '(failed,bounced)')
      .limit(1);
    if (earlier && earlier.length > 0) return skipped('already_sent');
  }

  const { data: practice } = await service
    .from('practices')
    .select('name, contact_email, email_sending_mode, custom_domain, custom_domain_sender_local_part, custom_domain_verified')
    .eq('id', invoice.practice_id)
    .single();
  if (!practice) return json({ error: 'Ordinacija ni bila najdena.' }, 500);

  const sender = resolveSenderIdentity({
    name: practice.name,
    emailSendingMode: practice.email_sending_mode,
    customDomain: practice.custom_domain,
    customDomainSenderLocalPart: practice.custom_domain_sender_local_part,
    customDomainVerified: practice.custom_domain_verified,
  });
  const unsubscribeToken = await resolveUnsubscribeToken(service, patient.id as string);
  const content = renderTemplate(
    'aftercare',
    override ?? null,
    {
      ime: patient.first_name as string,
      priimek: patient.last_name as string,
      datum: formatDate(`${invoice.service_date}T12:00:00Z`),
      ordinacija: practice.name,
    },
    {
      practiceName: practice.name,
      unsubscribeUrl: `${UNSUBSCRIBE_PAGE_URL}?token=${unsubscribeToken}`,
      sections: topics.map((t) => ({ title: t.title as string, body: t.body as string })),
    }
  );

  const logBase = {
    patientId: patient.id as string,
    invoiceId: invoice.id as string,
    emailType: 'aftercare' as const,
    recipientEmail: to,
    subject: content.subject,
    bodyHtml: content.html,
    senderDomain: sender.fromDomain,
  };
  try {
    const { messageId } = await sendEmail({
      to,
      sender,
      replyTo: practice.contact_email,
      subject: content.subject,
      html: content.html,
    });
    await logEmail(service, { ...logBase, status: 'sent', providerMessageId: messageId });
    return json({ status: 'sent', to });
  } catch (sendError) {
    const errorMessage = sendError instanceof Error ? sendError.message : String(sendError);
    console.error('Aftercare email failed:', sendError);
    await logEmail(service, { ...logBase, status: 'failed', errorMessage });
    return json({ status: 'failed', to, error: errorMessage }, 502);
  }
});
