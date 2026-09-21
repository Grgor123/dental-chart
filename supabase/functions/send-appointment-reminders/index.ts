// Deno Edge Function — the daily reminder send, 2 days before each
// appointment. Invoked hourly by pg_cron (see
// supabase/migrations/015_add_sms_reminders.sql) rather than once at a
// fixed UTC time, and self-gates on the current Europe/Ljubljana
// wall-clock hour below — see that migration's own comment for why (14:00
// local is 12:00 or 13:00 UTC depending on daylight saving, and pg_cron
// has no timezone awareness).
//
// Deploy: supabase functions deploy send-appointment-reminders
// (keep default JWT verification ON — cron-invoked only, same reasoning
// as request-sms-consent's own Authorization check below.)
//
// Secrets needed (shared with request-sms-consent): LERTIFY_API_KEY,
// LERTIFY_SENDER
//
// LERTIFY REQUEST/RESPONSE SHAPE: verified against the sibling n8n
// workflow's own live "Send SMS via Lertify" and "Insert Reminder Row"
// nodes (read via the n8n API) — auth is a plain `apiKey` header, phone
// goes in a `destinations` array, `message` is a {content, isUnicode}
// object, and a successful response is `{ messages: [{ messageId }] }`.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LERTIFY_API_KEY = Deno.env.get('LERTIFY_API_KEY')!;
const LERTIFY_SENDER = Deno.env.get('LERTIFY_SENDER')!;
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function randomToken(length = 10): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function ljubljanaHour(): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Ljubljana', hour: 'numeric', hour12: false }).formatToParts(new Date());
  return Number(parts.find((p) => p.type === 'hour')?.value ?? -1);
}

function toLjubljanaYmd(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Ljubljana', year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(iso)
  );
}

interface PatientJoin {
  phone: string | null;
  sms_consent_status: string;
}

Deno.serve(async (req) => {
  if (req.headers.get('Authorization') !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (ljubljanaHour() !== 14) {
    return new Response('Not the scheduled hour, skipping.', { status: 200 });
  }

  const targetYmd = toLjubljanaYmd(new Date(Date.now() + 2 * 86400000).toISOString());
  // Padded a full day either side of the 2-day target — the exact target
  // day is filtered precisely in JS below via toLjubljanaYmd, so this only
  // needs to not miss anything near a UTC/local day boundary.
  const queryStart = new Date(Date.now() + 1 * 86400000).toISOString();
  const queryEnd = new Date(Date.now() + 3 * 86400000).toISOString();

  const { data: appointments, error } = await supabase
    .from('appointments')
    .select('id, starts_at, status, patients(phone, sms_consent_status)')
    .gte('starts_at', queryStart)
    .lt('starts_at', queryEnd)
    .not('status', 'in', '(cancelled,completed)');
  if (error) return new Response(`Query failed: ${error.message}`, { status: 500 });

  const targets = (appointments ?? []).filter((a) => {
    const patient = a.patients as unknown as PatientJoin | null;
    return toLjubljanaYmd(a.starts_at) === targetYmd && !!patient?.phone && patient.sms_consent_status === 'granted';
  });

  let sent = 0;
  for (const appt of targets) {
    // Dedup — the unique index on appointment_id would reject a second
    // insert anyway, but check first to avoid a wasted Lertify send.
    const { data: existing } = await supabase.from('appointment_reminders').select('id').eq('appointment_id', appt.id).maybeSingle();
    if (existing) continue;

    const patient = appt.patients as unknown as PatientJoin;
    const token = randomToken();
    const time = new Date(appt.starts_at).toLocaleString('sl-SI', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Ljubljana' });
    // Points at the GitHub Pages page, not this Edge Function's own URL —
    // see appointment-confirm's own comment for why (Supabase won't serve
    // real HTML from *.supabase.co).
    const link = `https://grgor123.github.io/dental-chart/appointment-confirm.html?token=${token}`;
    // Plain ASCII (no š/č/ž), matching the sibling n8n workflow's own
    // reminder text convention (isUnicode: false below) — GSM-7 keeps this
    // a single, cheaper SMS segment.
    const message = `Zobozdravstvo Goslar: opomnik na termin ${time}. Ali pridete? ${link}`;

    const lertifyRes = await fetch('https://api.lertify.app/v1/sms/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apiKey: LERTIFY_API_KEY },
      body: JSON.stringify({
        sender: LERTIFY_SENDER,
        destinations: [patient.phone],
        message: { content: message, isUnicode: false },
        deliveryReportUrl: `${SUPABASE_URL}/functions/v1/lertify-delivery-webhook`,
      }),
    });
    const lertifyBody: { messages?: { messageId?: string }[] } | null = await lertifyRes.json().catch(() => null);
    if (!lertifyRes.ok) {
      console.error(`Lertify send failed for appointment ${appt.id}:`, lertifyRes.status, lertifyBody);
      continue;
    }

    await supabase.from('appointment_reminders').insert({
      appointment_id: appt.id,
      patient_phone: patient.phone,
      confirm_token: token,
      lertify_message_id: lertifyBody?.messages?.[0]?.messageId ?? null,
    });
    sent++;
  }

  return new Response(`Sent ${sent} reminder(s) for ${targetYmd}.`, { status: 200 });
});
