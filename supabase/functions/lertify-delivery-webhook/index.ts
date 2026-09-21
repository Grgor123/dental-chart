// Deno Edge Function, PUBLIC (deploy with --no-verify-jwt — Lertify's own
// server calls this, it holds no Supabase session at all). Receives
// Lertify's async delivery-status callback and records it on the matching
// appointment_reminders row — same mechanic as the sibling "dental
// calendar" project's own "Lertify Delivery Report Webhook" n8n node.
//
// Deploy: supabase functions deploy lertify-delivery-webhook --no-verify-jwt
//
// NOTE: the sibling project describes the payload as {messageId, status}
// with status one of SENT/DELIVERED/FAILED/REJECTED/UNKNOWN/CANCELLED —
// not a verified API reference, so double-check the real payload shape
// once a live delivery report actually arrives (Deno's console.error
// below logs anything that doesn't match, to make that easy to spot).
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const body = await req.json().catch(() => null);
  const messageId = body?.messageId ?? body?.id;
  const status = body?.status;
  if (!messageId || !status) {
    console.error('Unrecognized Lertify delivery-report payload:', body);
    return new Response('Missing messageId/status', { status: 400 });
  }

  // Last write wins, no history kept — matching the sibling project's own
  // approach, since a delivery report can arrive more than once per
  // message (e.g. SENT, then later DELIVERED).
  const { error } = await supabase.from('appointment_reminders').update({ delivery_status: status }).eq('lertify_message_id', messageId);
  if (error) return new Response(`Update failed: ${error.message}`, { status: 500 });

  return new Response('OK', { status: 200 });
});
