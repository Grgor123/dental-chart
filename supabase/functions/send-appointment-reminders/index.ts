// Deno Edge Function — the SMS reminder, 2 days before each appointment,
// plus requested confirmations (see below). Invoked every 15 minutes by pg_cron (see
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
import { confirmPageUrl, ensureConfirmToken } from '../_shared/confirmToken.ts';
import { SMS_REMINDER_DAYS_BEFORE, SMS_REMINDER_HOUR } from '../_shared/email/templateDefs.ts';
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

const HOUR_MS = 3600000;
const DAY_MS = 86400000;
// "Pošlji e-pošto in SMS za potrditev termina" (migration 055): the SMS this
// long after the request if still unanswered, and only during these hours.
const REQUEST_SMS_DELAY_MS = 2 * HOUR_MS;
const SMS_FROM_HOUR = 8;
const SMS_UNTIL_HOUR = 20;

interface AppointmentJoin {
  id: string;
  starts_at: string;
  status: string;
  confirm_requested_at: string | null;
  patients: PatientJoin | null;
}

/** Has this appointment had an SMS since `sinceIso` (or ever, if null)? */
async function smsSentSince(appointmentId: string, sinceIso: string | null): Promise<boolean> {
  let query = supabase.from('appointment_reminders').select('id').eq('appointment_id', appointmentId);
  if (sinceIso) query = query.gte('sent_at', sinceIso);
  const { data } = await query.limit(1);
  return (data ?? []).length > 0;
}

async function sendSms(appt: AppointmentJoin): Promise<boolean> {
  const patient = appt.patients as PatientJoin;
  // The appointment's own token (migration 052) — the reminder email's
  // link is the same one, so either answer counts.
  const token = (await ensureConfirmToken(supabase, appt.id)) ?? randomToken();
  const time = new Date(appt.starts_at).toLocaleString('sl-SI', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Ljubljana' });
  // Points at the GitHub Pages page, not this Edge Function's own URL —
  // see appointment-confirm's own comment for why (Supabase won't serve
  // real HTML from *.supabase.co).
  const link = confirmPageUrl(token);
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
    return false;
  }

  const reminder = {
    appointment_id: appt.id,
    patient_phone: patient.phone,
    confirm_token: token,
    lertify_message_id: lertifyBody?.messages?.[0]?.messageId ?? null,
  };
  // message_text (migration 030) is the SMS as sent, shown in the
  // patient's Sporočila tab. If the column doesn't exist yet, the row —
  // which the confirm link needs — is still written, without it.
  let { error: insertError } = await supabase.from('appointment_reminders').insert({ ...reminder, message_text: message });
  if (insertError && (insertError.code === '42703' || insertError.code === 'PGRST204')) {
    ({ error: insertError } = await supabase.from('appointment_reminders').insert(reminder));
  }
  if (insertError) console.error(`Failed to record reminder for appointment ${appt.id}:`, insertError.message);
  return true;
}

function canText(appt: AppointmentJoin): boolean {
  return !!appt.patients?.phone && appt.patients.sms_consent_status === 'granted';
}

const SELECT = 'id, starts_at, status, confirm_requested_at, patients(phone, sms_consent_status)';

// Runs every 15 minutes (migration 055). Two sends:
//   1. the regular reminder at 14:00, SMS_REMINDER_DAYS_BEFORE days ahead,
//      unless already answered (e.g. "Pridem" in the 09:00 email) or already
//      sent — it runs four times in that hour, so the second check matters;
//   2. a requested confirmation ("Pošlji e-pošto in SMS za potrditev
//      termina"): 2 hours after the request, if still unanswered and no SMS
//      since the request, between 08:00 and 20:00.
Deno.serve(async (req) => {
  if (req.headers.get('Authorization') !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const hour = ljubljanaHour();
  const now = Date.now();
  let regular = 0;
  let requested = 0;

  // ---- 1. Regular reminder
  if (hour === SMS_REMINDER_HOUR) {
    const targetYmd = toLjubljanaYmd(new Date(now + SMS_REMINDER_DAYS_BEFORE * DAY_MS).toISOString());
    // Padded a full day either side of the target — the exact target day is
    // filtered in JS via toLjubljanaYmd (DST shifts the boundary).
    const { data, error } = await supabase
      .from('appointments')
      .select(SELECT)
      .gte('starts_at', new Date(now + (SMS_REMINDER_DAYS_BEFORE - 1) * DAY_MS).toISOString())
      .lt('starts_at', new Date(now + (SMS_REMINDER_DAYS_BEFORE + 1) * DAY_MS).toISOString())
      // Already answered → no SMS.
      .not('status', 'in', '(cancelled,completed,confirmed,no_show)');
    if (error) return new Response(`Query failed: ${error.message}`, { status: 500 });
    for (const appt of (data ?? []) as unknown as AppointmentJoin[]) {
      if (toLjubljanaYmd(appt.starts_at) !== targetYmd || !canText(appt)) continue;
      // A fresh request is handled by send 2, two hours after it.
      if (appt.confirm_requested_at && Date.parse(appt.confirm_requested_at) > now - REQUEST_SMS_DELAY_MS) continue;
      if (await smsSentSince(appt.id, appt.confirm_requested_at)) continue;
      if (await sendSms(appt)) regular++;
    }
  }

  // ---- 2. Requested confirmation, 2 hours later
  if (hour >= SMS_FROM_HOUR && hour < SMS_UNTIL_HOUR) {
    const { data, error } = await supabase
      .from('appointments')
      .select(SELECT)
      .not('confirm_requested_at', 'is', null)
      .lte('confirm_requested_at', new Date(now - REQUEST_SMS_DELAY_MS).toISOString())
      .gte('confirm_requested_at', new Date(now - 3 * DAY_MS).toISOString())
      .gt('starts_at', new Date(now).toISOString())
      .in('status', ['scheduled', 'sent']);
    if (error) return new Response(`Query failed: ${error.message}`, { status: 500 });
    for (const appt of (data ?? []) as unknown as AppointmentJoin[]) {
      if (!canText(appt)) continue;
      if (await smsSentSince(appt.id, appt.confirm_requested_at)) continue;
      if (await sendSms(appt)) requested++;
    }
  }

  return new Response(`Sent ${regular} regular and ${requested} requested reminder SMS.`, { status: 200 });
});
