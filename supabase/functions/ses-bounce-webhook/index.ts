// Deno Edge Function, PUBLIC (deploy with --no-verify-jwt — AWS SNS calls
// this, it holds no Supabase session at all). Receives SES's Bounce/
// Complaint/Delivery events via an SNS topic subscription and:
//   - updates the matching email_log row's status
//   - on a PERMANENT bounce or ANY complaint, opts the patient out of
//     future email (email_opt_out = true) — see CLAUDE.md's "Email
//     notifications" section for why this is load-bearing, not optional:
//     AWS enforces bounce-rate/complaint-rate thresholds and will throttle
//     or suspend a sending account that exceeds them.
//
// Deploy: supabase functions deploy ses-bounce-webhook --no-verify-jwt
//
// NOT verified: SNS message-signature verification (SigningCertURL /
// Signature) to confirm a POST really came from AWS — flagged as real
// hardening worth doing before scaling much further, low severity to skip
// for now (a spoofed request could only wrongly opt someone out of email,
// not expose data). See CLAUDE.md.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

interface SesMailEvent {
  eventType?: string; // 'Bounce' | 'Complaint' | 'Delivery' | ...
  mail?: { messageId?: string; commonHeaders?: { to?: string[] } };
  bounce?: { bounceType?: string };
  complaint?: { complaintFeedbackType?: string };
}

async function optOutByRecipients(emails: string[]): Promise<void> {
  if (emails.length === 0) return;
  await supabase
    .from('patients')
    .update({ email_opt_out: true, email_opt_out_at: new Date().toISOString() })
    .in('email', emails)
    .eq('email_opt_out', false);
}

async function updateLogByMessageId(messageId: string | undefined, status: 'bounced' | 'complained' | 'delivered'): Promise<void> {
  if (!messageId) return;
  await supabase
    .from('email_log')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('provider_message_id', messageId);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const body = await req.json().catch(() => null);
  if (!body) return new Response('Invalid JSON', { status: 400 });

  const messageType = req.headers.get('x-amz-sns-message-type') ?? body.Type;

  // SNS subscription-confirmation handshake — handled on every request
  // defensively (not just "the first ever"), since SNS can re-send this if
  // a topic is recreated. Without fetching SubscribeURL, the topic never
  // actually delivers real notifications afterward.
  if (messageType === 'SubscriptionConfirmation') {
    if (body.SubscribeURL) {
      try {
        await fetch(body.SubscribeURL);
      } catch (confirmError) {
        console.error('Failed to confirm SNS subscription:', confirmError);
        return new Response('Failed to confirm subscription', { status: 500 });
      }
    }
    return new Response('Subscription confirmed', { status: 200 });
  }

  if (messageType !== 'Notification') {
    console.error('Unrecognized SNS message type:', messageType, body);
    return new Response('Ignored', { status: 200 });
  }

  // The SNS envelope's own Message field is itself a JSON string containing
  // the real SES event — parsed twice.
  const sesEvent: SesMailEvent = JSON.parse(body.Message ?? '{}');
  const recipients = sesEvent.mail?.commonHeaders?.to ?? [];
  const messageId = sesEvent.mail?.messageId;

  if (sesEvent.eventType === 'Bounce') {
    await updateLogByMessageId(messageId, 'bounced');
    // Only a PERMANENT bounce is a real signal the address doesn't work —
    // a Transient bounce (full mailbox, temporary failure) isn't.
    if (sesEvent.bounce?.bounceType === 'Permanent') {
      await optOutByRecipients(recipients);
    }
  } else if (sesEvent.eventType === 'Complaint') {
    await updateLogByMessageId(messageId, 'complained');
    await optOutByRecipients(recipients);
  } else if (sesEvent.eventType === 'Delivery') {
    await updateLogByMessageId(messageId, 'delivered');
  } else {
    console.error('Unrecognized SES event type:', sesEvent.eventType, sesEvent);
  }

  return new Response('OK', { status: 200 });
});
