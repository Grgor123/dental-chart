// Deno Edge Function — backs the El. pošta template editor
// (src/pages/EmailTemplates.tsx): renders a template with sample data for the
// live preview, and optionally sends that rendering as a test email.
//
// It runs the EXACT renderer real emails use (_shared/email/templates.ts), so
// what the practice sees in the preview can never drift from what patients
// receive, and no template logic is duplicated in the React app.
//
// Unlike the trigger/cron functions this is called from the browser with the
// signed-in user's own session, so it deploys with default JWT verification ON
// and reads the practice through a client carrying THAT user's JWT — RLS
// resolves which practice, nothing here trusts a practice id from the body.
// The test send goes ONLY to the signed-in user's own auth email, never an
// address supplied in the request, so this can't be used as an open relay.
//
// Deploy: supabase functions deploy email-template-preview
import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolveSenderIdentity, sendEmail } from '../_shared/email/send.ts';
import { renderTemplate } from '../_shared/email/templates.ts';
import { buildIcsEvent } from '../_shared/email/ics.ts';
import { SAMPLE_VARS, TEMPLATE_DEFS, TEMPLATE_KEYS, type TemplateKey } from '../_shared/email/templateDefs.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

function isTemplateKey(value: unknown): value is TemplateKey {
  return typeof value === 'string' && (TEMPLATE_KEYS as readonly string[]).includes(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const body = await req.json().catch(() => null);
  if (!body || !isTemplateKey(body.templateKey)) return json({ error: 'Missing or invalid templateKey' }, 400);
  const templateKey = body.templateKey;
  const def = TEMPLATE_DEFS[templateKey];

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });

  const { data: practice } = await supabase
    .from('practices')
    .select('id, name, contact_email, email_sending_mode, custom_domain, custom_domain_sender_local_part, custom_domain_verified')
    .limit(1)
    .maybeSingle();
  if (!practice) return json({ error: 'Practice not found for this user' }, 404);

  const override = {
    subject: stringOrNull(body.override?.subject),
    heading: stringOrNull(body.override?.heading),
    body: stringOrNull(body.override?.body),
  };
  const vars = { ...SAMPLE_VARS, ordinacija: practice.name };
  const content = renderTemplate(templateKey, override, vars, {
    practiceName: practice.name,
    unsubscribeUrl: '#',
  });

  if (!body.sendTest) return json({ subject: content.subject, html: content.html });

  const { data: userData } = await supabase.auth.getUser();
  const userEmail = userData.user?.email;
  if (!userEmail) return json({ error: 'No email address on your account to send the test to' }, 400);

  const sender = resolveSenderIdentity({
    name: practice.name,
    emailSendingMode: practice.email_sending_mode,
    customDomain: practice.custom_domain,
    customDomainSenderLocalPart: practice.custom_domain_sender_local_part,
    customDomainVerified: practice.custom_domain_verified,
  });

  // A sample calendar invite for the types that carry one, so the test shows
  // the attachment too. Never for a cancellation (a CANCEL for a made-up event
  // would be meaningless).
  const start = new Date(Date.now() + 7 * 86400000);
  const end = new Date(start.getTime() + 30 * 60000);
  const attachmentIcs =
    def.ics === 'request'
      ? {
          filename: 'termin.ics',
          method: 'REQUEST' as const,
          content: buildIcsEvent({
            appointmentId: crypto.randomUUID(),
            startsAt: start.toISOString(),
            endsAt: end.toISOString(),
            summary: 'Testni termin',
            organizerEmail: practice.contact_email || sender.fromAddress,
            organizerName: practice.name,
          }),
        }
      : null;

  try {
    await sendEmail({
      to: userEmail,
      sender,
      replyTo: practice.contact_email,
      subject: `[TEST] ${content.subject}`,
      html: content.html,
      attachmentIcs,
    });
  } catch (sendError) {
    console.error('Template test send failed:', sendError);
    return json({ error: sendError instanceof Error ? sendError.message : 'Send failed' }, 502);
  }

  return json({ subject: content.subject, html: content.html, sentTo: userEmail });
});
