// Deno Edge Function, PUBLIC (deploy with --no-verify-jwt) — JSON API
// behind the "Pridem / Ne pridem" page. Same reason as sms-consent-confirm
// for why this only serves JSON now: Supabase Edge Functions rewrite
// text/html to text/plain on the shared *.supabase.co domain (confirmed
// live — see that function's own comment for the source). The actual page
// lives on GitHub Pages (docs/appointment-confirm.html, published at
// https://grgor123.github.io/dental-chart/appointment-confirm.html) and
// calls this function via fetch(). Updates THIS app's own
// `appointments.status` directly — the calendar's own AppointmentChip
// already renders a tick for 'confirmed' and a cross for 'cancelled', so
// nothing on the frontend needs to change for the confirmation to show up
// on the appointment card.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token) return json({ error: 'missing_token' }, 400);

  const { data: reminder } = await supabase
    .from('appointment_reminders')
    .select('id, appointment_id, status')
    .eq('confirm_token', token)
    .maybeSingle();
  if (!reminder) return json({ error: 'invalid_token' }, 404);

  if (req.method === 'POST') {
    if (reminder.status !== 'pending') {
      return json({ status: reminder.status });
    }
    const { action } = await req.json().catch(() => ({}) as { action?: string });
    if (action !== 'confirm' && action !== 'decline') return json({ error: 'invalid_action' }, 400);

    // 'declined' here maps to this app's own 'cancelled' appointment
    // status — same status vocabulary Frame 5/the calendar already use.
    const status: 'confirmed' | 'declined' = action === 'confirm' ? 'confirmed' : 'declined';
    await supabase
      .from('appointment_reminders')
      .update({ status, replied_at: new Date().toISOString() })
      .eq('id', reminder.id);
    await supabase
      .from('appointments')
      .update({ status: status === 'confirmed' ? 'confirmed' : 'cancelled' })
      .eq('id', reminder.appointment_id);

    return json({ status });
  }

  if (reminder.status !== 'pending') {
    return json({ status: reminder.status });
  }

  const { data: appointment } = await supabase.from('appointments').select('starts_at').eq('id', reminder.appointment_id).single();
  return json({
    status: 'pending',
    appointmentTime: appointment
      ? new Date(appointment.starts_at).toLocaleString('sl-SI', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Ljubljana' })
      : null,
  });
});
