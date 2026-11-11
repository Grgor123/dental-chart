// Deno Edge Function — the daily confirmation report (Gregor, 2026-11-11;
// the old booking widget's 17:00 n8n report, on this app's data). At 17:00
// Europe/Ljubljana — after the 09:00 reminder email and the 14:00 SMS — each
// practice gets one email about the appointments SMS_REMINDER_DAYS_BEFORE days
// ahead: not answered (with how the email and SMS reminders fared, and the
// phone number, so staff can call), declined, confirmed. Plus tomorrow's
// appointments that got a confirmation request by hand ("Pošlji e-pošto in
// SMS za potrditev termina", migration 055 — phone bookings, rebooked
// patients), with their answer. Names, times and phones only — no clinical
// data. Not sent when there's nothing to list.
//
// Two callers:
//   - pg_cron, hourly, with the service-role key (migration 054) — sends at
//     17:00 to every practice that has it on, once a day;
//   - the "Pošlji poročilo zdaj" button (Nastavitve → Delovni čas), with the
//     signed-in user's own JWT — sends the report of the user's own practice
//     now (RLS picks the practice), to its configured recipient only.
//
// Deploy: supabase functions deploy send-reminder-report
// (default JWT verification ON.)
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { resolveSenderIdentity, sendEmail } from '../_shared/email/send.ts';
import { escapeHtml, wrapEmailLayout } from '../_shared/email/templates.ts';
import { SMS_REMINDER_DAYS_BEFORE } from '../_shared/email/templateDefs.ts';
import { ljubljanaHour, toLjubljanaYmd } from '../_shared/email/time.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const REPORT_HOUR = 17;
const DAY_MS = 86400000;
const TIME_ZONE = 'Europe/Ljubljana';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

interface PracticeRow {
  id: string;
  name: string;
  contact_email: string | null;
  email_sending_mode: 'platform_default' | 'custom_domain';
  custom_domain: string | null;
  custom_domain_sender_local_part: string;
  custom_domain_verified: boolean;
}

interface SettingsRow {
  reminder_report_enabled: boolean;
  reminder_report_email: string | null;
  reminder_report_last_sent: string | null;
}

interface AppointmentRow {
  id: string;
  starts_at: string;
  status: string;
  confirm_requested_at: string | null;
  patients: { first_name: string; last_name: string; phone: string | null; email: string | null; email_opt_out: boolean; sms_consent_status: string } | null;
  therapists: { name: string } | null;
}

const SMS_LABELS: Record<string, string> = {
  SENT: 'poslan',
  DELIVERED: 'dostavljen',
  FAILED: 'ni uspel',
  REJECTED: 'zavrnjen',
  UNKNOWN: 'neznano',
  CANCELLED: 'preklican',
};
const EMAIL_LABELS: Record<string, string> = {
  sent: 'poslana',
  delivered: 'dostavljena',
  bounced: 'vrnjena (napačen naslov)',
  complained: 'označena kot nezaželena',
  failed: 'ni uspela',
};
const PROBLEM = new Set(['FAILED', 'REJECTED', 'CANCELLED', 'bounced', 'failed', 'complained']);

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE });
}

function longDate(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('sl-SI', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TIME_ZONE });
}

const CELL = 'padding:6px 8px;border-bottom:1px solid #eeeeee;font-size:13px;vertical-align:top;';
const HEAD = 'padding:6px 8px;border-bottom:2px solid #dddddd;font-size:12px;text-align:left;color:#666666;';

function section(title: string, color: string, rows: string[], headers: string[]): string {
  if (rows.length === 0) return '';
  return `<h2 style="margin:20px 0 6px;font-size:15px;color:${color};">${escapeHtml(title)} (${rows.length})</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
<tr>${headers.map((h) => `<th style="${HEAD}">${escapeHtml(h)}</th>`).join('')}</tr>
${rows.join('\n')}
</table>`;
}

/** Builds and sends one practice's report. Returns why it didn't send, or null. */
async function sendReport(practice: PracticeRow, settings: SettingsRow | null): Promise<string | null> {
  const recipient = settings?.reminder_report_email || practice.contact_email;
  if (!recipient) return 'no recipient (set one in Nastavitve → Delovni čas)';

  const targetYmd = toLjubljanaYmd(new Date(Date.now() + SMS_REMINDER_DAYS_BEFORE * DAY_MS).toISOString());
  const tomorrowYmd = toLjubljanaYmd(new Date(Date.now() + DAY_MS).toISOString());
  const { data, error } = await admin
    .from('appointments')
    .select(
      'id, starts_at, status, confirm_requested_at, patients(first_name, last_name, phone, email, email_opt_out, sms_consent_status), therapists(name)'
    )
    .eq('practice_id', practice.id)
    .gte('starts_at', new Date(Date.now()).toISOString())
    .lt('starts_at', new Date(Date.now() + (SMS_REMINDER_DAYS_BEFORE + 1) * DAY_MS).toISOString())
    .order('starts_at');
  if (error) return `query failed: ${error.message}`;
  const open = ((data ?? []) as unknown as AppointmentRow[]).filter((a) => a.status !== 'completed' && a.status !== 'no_show');
  const appointments = open.filter((a) => toLjubljanaYmd(a.starts_at) === targetYmd);
  const requestedTomorrow = open.filter((a) => toLjubljanaYmd(a.starts_at) === tomorrowYmd && a.confirm_requested_at);
  if (appointments.length === 0 && requestedTomorrow.length === 0) return 'no appointments that day';

  // Ascending by time, so the map keeps each appointment's latest message.
  const ids = [...appointments, ...requestedTomorrow].map((a) => a.id);
  const [{ data: sms }, { data: mail }] = await Promise.all([
    admin.from('appointment_reminders').select('appointment_id, delivery_status').in('appointment_id', ids).order('sent_at'),
    admin
      .from('email_log')
      .select('appointment_id, status')
      .eq('email_type', 'appointment_reminder')
      .in('appointment_id', ids)
      .order('sent_at'),
  ]);
  const smsBy = new Map((sms ?? []).map((r) => [r.appointment_id as string, (r.delivery_status as string | null) ?? 'SENT']));
  const mailBy = new Map((mail ?? []).map((r) => [r.appointment_id as string, r.status as string]));

  function smsText(a: AppointmentRow): string {
    const s = smsBy.get(a.id);
    if (s) return SMS_LABELS[s] ?? s;
    if (!a.patients?.phone) return 'ni telefona';
    if (a.patients.sms_consent_status !== 'granted') return 'ni soglasja za SMS';
    return 'ni poslan';
  }
  function mailText(a: AppointmentRow): string {
    const m = mailBy.get(a.id);
    if (m) return EMAIL_LABELS[m] ?? m;
    if (!a.patients?.email) return 'ni e-pošte';
    if (a.patients.email_opt_out) return 'odjavljen';
    return 'ni poslana';
  }
  function cellFor(text: string, raw: string | undefined): string {
    const bad = raw ? PROBLEM.has(raw) : false;
    return `<td style="${CELL}${bad ? 'color:#b3261e;font-weight:600;' : ''}">${escapeHtml(text)}</td>`;
  }
  const name = (a: AppointmentRow) => escapeHtml(`${a.patients?.last_name ?? ''} ${a.patients?.first_name ?? ''}`.trim());
  const therapist = (a: AppointmentRow) => escapeHtml(a.therapists?.name ?? 'Nedodeljen');

  const unanswered = appointments.filter((a) => a.status !== 'confirmed' && a.status !== 'cancelled');
  const declined = appointments.filter((a) => a.status === 'cancelled');
  const confirmed = appointments.filter((a) => a.status === 'confirmed');

  const unansweredRows = unanswered.map(
    (a) =>
      `<tr><td style="${CELL}">${timeOf(a.starts_at)}</td><td style="${CELL}"><strong>${name(a)}</strong><br><span style="color:#666666;">${therapist(a)}</span></td><td style="${CELL}">${escapeHtml(a.patients?.phone ?? '—')}</td>${cellFor(mailText(a), mailBy.get(a.id))}${cellFor(smsText(a), smsBy.get(a.id))}</tr>`
  );
  const simpleRows = (list: AppointmentRow[]) =>
    list.map(
      (a) =>
        `<tr><td style="${CELL}">${timeOf(a.starts_at)}</td><td style="${CELL}"><strong>${name(a)}</strong><br><span style="color:#666666;">${therapist(a)}</span></td><td style="${CELL}">${escapeHtml(a.patients?.phone ?? '—')}</td></tr>`
    );

  const ANSWER: Record<string, [string, string]> = {
    confirmed: ['potrdil', '#1e8e3e'],
    cancelled: ['odpovedal', '#b3261e'],
  };
  const requestedRows = requestedTomorrow.map((a) => {
    const [label, color] = ANSWER[a.status] ?? ['še ni odgovoril', '#b26a00'];
    return `<tr><td style="${CELL}">${timeOf(a.starts_at)}</td><td style="${CELL}"><strong>${name(a)}</strong><br><span style="color:#666666;">${therapist(a)}</span></td><td style="${CELL}">${escapeHtml(a.patients?.phone ?? '—')}</td><td style="${CELL}color:${color};font-weight:600;">${label}</td>${cellFor(mailText(a), mailBy.get(a.id))}${cellFor(smsText(a), smsBy.get(a.id))}</tr>`;
  });

  const summary =
    appointments.length > 0
      ? `Termini ${escapeHtml(longDate(targetYmd))}: ${appointments.length} — nepotrjenih ${unanswered.length}, odpovedanih ${declined.length}, potrjenih ${confirmed.length}.`
      : `Za ${escapeHtml(longDate(targetYmd))} ni terminov.`;
  const bodyHtml = [
    `<p style="margin:0 0 8px;line-height:1.5;">${summary}</p>`,
    unanswered.length > 0
      ? '<p style="margin:0 0 8px;line-height:1.5;color:#666666;font-size:13px;">Nepotrjeni pacienti niso odgovorili ne na e-pošto ne na SMS — morda jih je vredno poklicati. Rdeče: sporočilo ni prišlo do pacienta.</p>'
      : '',
    section('Nepotrjeni', '#b26a00', unansweredRows, ['Ura', 'Pacient', 'Telefon', 'E-pošta', 'SMS']),
    section('Odpovedani', '#b3261e', simpleRows(declined), ['Ura', 'Pacient', 'Telefon']),
    section('Potrjeni', '#1e8e3e', simpleRows(confirmed), ['Ura', 'Pacient', 'Telefon']),
    section(`Jutri (${longDate(tomorrowYmd)}) — naknadno poslane potrditve`, '#2e6e62', requestedRows, [
      'Ura',
      'Pacient',
      'Telefon',
      'Odgovor',
      'E-pošta',
      'SMS',
    ]),
  ].join('\n');

  const html = wrapEmailLayout({
    practiceName: practice.name,
    heading: `Potrditve terminov — ${longDate(targetYmd)}`,
    bodyHtml,
    unsubscribeUrl: null,
  });
  const sender = resolveSenderIdentity({
    name: practice.name,
    emailSendingMode: practice.email_sending_mode,
    customDomain: practice.custom_domain,
    customDomainSenderLocalPart: practice.custom_domain_sender_local_part,
    customDomainVerified: practice.custom_domain_verified,
  });
  await sendEmail({
    to: recipient,
    sender,
    // The sending address has no mailbox — a reply goes to the practice.
    replyTo: practice.contact_email,
    subject: `Potrditve terminov ${longDate(targetYmd)}: ${unanswered.length} nepotrjenih, ${declined.length} odpovedanih`,
    html,
  });
  return null;
}

const PRACTICE_COLUMNS = 'id, name, contact_email, email_sending_mode, custom_domain, custom_domain_sender_local_part, custom_domain_verified';
const SETTINGS_COLUMNS = 'reminder_report_enabled, reminder_report_email, reminder_report_last_sent';

async function loadSettings(client: SupabaseClient, practiceId: string): Promise<SettingsRow | null> {
  const { data } = await client.from('practice_settings').select(SETTINGS_COLUMNS).eq('practice_id', practiceId).maybeSingle();
  return (data as SettingsRow | null) ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  const auth = req.headers.get('Authorization') ?? '';
  const todayYmd = toLjubljanaYmd(new Date().toISOString());

  // ---- cron: every practice, at 17:00, once a day
  if (auth === `Bearer ${SERVICE_ROLE_KEY}`) {
    if (ljubljanaHour() !== REPORT_HOUR) return new Response('Not the scheduled hour, skipping.', { status: 200 });
    const { data: practices, error } = await admin.from('practices').select(PRACTICE_COLUMNS);
    if (error) return new Response(`Query failed: ${error.message}`, { status: 500 });
    let sent = 0;
    for (const practice of (practices ?? []) as PracticeRow[]) {
      const settings = await loadSettings(admin, practice.id);
      if (settings && !settings.reminder_report_enabled) continue;
      if (settings?.reminder_report_last_sent === todayYmd) continue;
      try {
        const skipped = await sendReport(practice, settings);
        if (skipped) {
          console.log(`Report for practice ${practice.id} not sent: ${skipped}`);
          continue;
        }
        await admin
          .from('practice_settings')
          .upsert({ practice_id: practice.id, reminder_report_last_sent: todayYmd }, { onConflict: 'practice_id' });
        sent++;
      } catch (e) {
        console.error(`Report for practice ${practice.id} failed:`, e);
      }
    }
    return new Response(`Sent ${sent} report(s).`, { status: 200 });
  }

  // ---- "Pošlji poročilo zdaj": the signed-in user's own practice, now
  if (!auth.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data: own } = await userClient.from('practices').select(PRACTICE_COLUMNS).limit(1).maybeSingle();
  if (!own) return json({ error: 'Ordinacija ni bila najdena.' }, 403);
  const practice = own as PracticeRow;
  try {
    const skipped = await sendReport(practice, await loadSettings(userClient, practice.id));
    if (skipped === 'no appointments that day') {
      return json({ sent: false, message: `Za ${longDate(toLjubljanaYmd(new Date(Date.now() + SMS_REMINDER_DAYS_BEFORE * DAY_MS).toISOString()))} ni terminov — poročilo ni bilo poslano.` });
    }
    if (skipped) return json({ sent: false, message: 'Ni naslova za poročilo — vpišite ga.' });
    return json({ sent: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
