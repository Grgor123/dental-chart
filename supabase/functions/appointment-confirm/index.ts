// Deno Edge Function, PUBLIC (deploy with --no-verify-jwt) — JSON API
// behind the "Pridem / Ne pridem" page. Same reason as sms-consent-confirm
// for why this only serves JSON now: Supabase Edge Functions rewrite
// text/html to text/plain on the shared *.supabase.co domain (confirmed
// live — see that function's own comment for the source). The actual page
// lives on GitHub Pages (docs/appointment-confirm.html, published at
// https://grgor123.github.io/dental-chart/appointment-confirm.html) and
// calls this function via fetch(). Updates THIS app's own
// `appointments.status` directly — the calendar's own AppointmentChip
// renders a tick for 'confirmed' and a cross for 'cancelled'.
//
// The link comes from the reminder email or the SMS reminder — both carry the
// appointment's own token (appointments.confirm_token, migration 052; Gregor,
// 2026-11-11). Older SMS links carry the token on appointment_reminders,
// still accepted. Whether it's answered is read from the appointment, so the
// second link of the two says "already answered".
//
// Deploy: supabase functions deploy appointment-confirm --no-verify-jwt
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

interface AppointmentRow {
  id: string;
  starts_at: string;
  status: string;
}

/** The appointment behind a token: its own token first, then an old SMS one. */
async function appointmentForToken(token: string): Promise<AppointmentRow | null> {
  const { data: own } = await supabase.from('appointments').select('id, starts_at, status').eq('confirm_token', token).maybeSingle();
  if (own) return own as AppointmentRow;
  const { data: reminders } = await supabase.from('appointment_reminders').select('appointment_id').eq('confirm_token', token).limit(1);
  const reminder = reminders?.[0];
  if (!reminder) return null;
  const { data } = await supabase.from('appointments').select('id, starts_at, status').eq('id', reminder.appointment_id).maybeSingle();
  return (data as AppointmentRow | null) ?? null;
}

/** 'confirmed' / 'declined' once answered, 'past' once the visit is over
 *  (completed / no-show), else 'pending'. */
function answerOf(status: string): 'confirmed' | 'declined' | 'past' | 'pending' {
  if (status === 'confirmed') return 'confirmed';
  if (status === 'cancelled') return 'declined';
  if (status === 'completed' || status === 'no_show') return 'past';
  return 'pending';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token) return json({ error: 'missing_token' }, 400);

  const appointment = await appointmentForToken(token);
  if (!appointment) return json({ error: 'invalid_token' }, 404);
  const current = answerOf(appointment.status);

  if (req.method === 'POST') {
    if (current !== 'pending') return json({ status: current });
    const { action } = await req.json().catch(() => ({}) as { action?: string });
    if (action !== 'confirm' && action !== 'decline') return json({ error: 'invalid_action' }, 400);

    // 'declined' maps to this app's own 'cancelled' appointment status.
    const status: 'confirmed' | 'declined' = action === 'confirm' ? 'confirmed' : 'declined';
    await supabase
      .from('appointments')
      .update({ status: status === 'confirmed' ? 'confirmed' : 'cancelled' })
      .eq('id', appointment.id);
    // The SMS reminder's own record (shown in the patient's Sporočila tab).
    await supabase
      .from('appointment_reminders')
      .update({ status, replied_at: new Date().toISOString() })
      .eq('appointment_id', appointment.id)
      .eq('status', 'pending');

    return json({ status });
  }

  if (current !== 'pending') return json({ status: current });
  return json({
    status: 'pending',
    appointmentTime: new Date(appointment.starts_at).toLocaleString('sl-SI', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Ljubljana' }),
  });
});
