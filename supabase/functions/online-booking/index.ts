// Deno Edge Function, PUBLIC (deploy with --no-verify-jwt) — JSON API behind
// the online booking form embedded on a practice's website
// (docs/online-booking.html on GitHub Pages; Supabase rewrites text/html on
// *.supabase.co, see sms-consent-confirm). Gregor, 2026-11-09.
//
//   GET  ?k=<embed key>            -> practice name, visit types, consent text,
//                                    Turnstile site key (or { enabled: false })
//   POST { action: 'slots', k, visitTypeId, firstName, lastName, phone, email,
//          consent, turnstileToken }
//        -> free start times + a signed `session` for the booking step
//   POST { action: 'book', k, session, start, note }
//        -> books it; 409 if the time was just taken
//
// The patient is never shown or asked for a therapist (Gregor): a known
// patient (same name + email or phone) with an "Izbran terapevt" who offers
// this visit type is booked with that therapist; everyone else with whoever
// is free — the earliest times come first, so the earliest free therapist.
// A new patient gets a record without a birth date (source 'online').
// Protection: Cloudflare Turnstile on the details step (when
// TURNSTILE_SECRET_KEY is set), a per-IP rate limit, and the database trigger
// check_appointment_hours that refuses online bookings outside clinic hours.
//
// Deploy: supabase functions deploy online-booking --no-verify-jwt
// Secrets (optional, both or neither): TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY
import { createClient } from 'npm:@supabase/supabase-js@2';
import { parsePhoneNumberFromString } from 'npm:libphonenumber-js@1.13.12/min';
import { timeToMin, type ClosedDay, type PracticeSchedule, type Schedule, type WeekParity, type AbsenceReason } from '../_shared/scheduling/workingHours.ts';
import { addDaysIso, onlineSlots, toLocal } from '../_shared/scheduling/onlineSlots.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TURNSTILE_SITE_KEY = Deno.env.get('TURNSTILE_SITE_KEY') ?? '';
const TURNSTILE_SECRET_KEY = Deno.env.get('TURNSTILE_SECRET_KEY') ?? '';
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const SESSION_MINUTES = 30;
const LIMITS = { slots: 30, book: 5 }; // per IP per hour
const DEFAULT_CONSENT =
  'Strinjam se, da {ordinacija} shrani moje podatke v skladu z izjavo o zasebnosti in jih uporablja za obveščanje o terminih in komunikacijo, povezano z obiskom.';

// Open: the form is embedded on practices' own websites; the embed key only
// selects the practice and every write is limited as above.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}

// ---- helpers ---------------------------------------------------------------

const encoder = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(text: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(`online-booking:${SERVICE_ROLE_KEY}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(text))));
}

async function sha256(text: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))));
}

function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
}

/** E.164 ("+38641362281") the way the app stores phones
 *  (react-phone-number-input, Slovenia by default): "041 362 281",
 *  "41362281" and "+386 41 362 281" all give the same number. Same library
 *  as the old booking widget. '' when it isn't a valid number. */
function normalizePhone(raw: string): string {
  const compact = raw.trim().replace(/^00/, '+');
  if (!compact) return '';
  const parsed = parsePhoneNumberFromString(compact, 'SI');
  return parsed && parsed.isValid() ? parsed.number : '';
}

function sameName(a: string | null, b: string): boolean {
  return (a ?? '').trim().toLocaleLowerCase('sl') === b.trim().toLocaleLowerCase('sl');
}

interface Contact {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
}

function cleanContact(input: Record<string, unknown>): Contact | string {
  const s = (key: string, max: number) => (typeof input[key] === 'string' ? (input[key] as string).trim().slice(0, max) : '');
  const contact = {
    firstName: s('firstName', 80),
    lastName: s('lastName', 80),
    phone: normalizePhone(s('phone', 40)),
    email: s('email', 200).toLowerCase(),
  };
  if (!contact.firstName || !contact.lastName) return 'Vpišite ime in priimek.';
  if (!contact.phone) return 'Telefonska številka ni pravilna.';
  // No quotes, commas or brackets: the address goes into a PostgREST or() filter.
  if (!/^[^\s@",()]+@[^\s@",()]+\.[^\s@",()]+$/.test(contact.email)) return 'E-poštni naslov ni pravilen.';
  return contact;
}

async function rateLimited(ipHash: string, kind: 'slots' | 'book'): Promise<boolean> {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await supabase
    .from('online_booking_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .eq('kind', kind)
    .gte('created_at', since);
  if ((count ?? 0) >= LIMITS[kind]) return true;
  await supabase.from('online_booking_attempts').insert({ ip_hash: ipHash, kind });
  // Keep the table small: nothing older than a day is needed.
  await supabase.from('online_booking_attempts').delete().lt('created_at', new Date(Date.now() - 86400_000).toISOString());
  return false;
}

async function turnstileOk(token: unknown, ip: string): Promise<boolean> {
  if (!TURNSTILE_SECRET_KEY) return true; // not configured (development)
  if (typeof token !== 'string' || !token) return false;
  const body = new FormData();
  body.append('secret', TURNSTILE_SECRET_KEY);
  body.append('response', token);
  if (ip !== 'unknown') body.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const out = (await res.json()) as { success?: boolean };
    return out.success === true;
  } catch {
    return false;
  }
}

// ---- practice data ---------------------------------------------------------

interface Settings {
  practice_id: string;
  enabled: boolean;
  booking_window_days: number;
  min_notice_hours: number;
  slot_step_minutes: number;
  consent_text: string | null;
  privacy_policy_url: string | null;
  phone: string | null;
}

async function loadSettings(k: unknown): Promise<Settings | null> {
  if (typeof k !== 'string' || !/^[a-f0-9]{32}$/.test(k)) return null;
  const { data } = await supabase
    .from('online_booking_settings')
    .select('practice_id, enabled, booking_window_days, min_notice_hours, slot_step_minutes, consent_text, privacy_policy_url, phone')
    .eq('public_key', k)
    .maybeSingle();
  return (data as Settings | null) ?? null;
}

async function practiceName(practiceId: string): Promise<string> {
  const { data } = await supabase.from('practices').select('name').eq('id', practiceId).maybeSingle();
  return (data?.name as string | undefined) ?? '';
}

interface VisitType {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
}

async function loadVisitTypes(practiceId: string): Promise<VisitType[]> {
  const { data } = await supabase
    .from('online_visit_types')
    .select('id, name, description, duration_minutes')
    .eq('practice_id', practiceId)
    .eq('active', true)
    .order('sort_order')
    .order('name');
  return (data as VisitType[] | null) ?? [];
}

interface TherapistRow {
  id: string;
  name: string;
  alternating_weeks: boolean;
}

/** Who may take this visit type, in the practice's own order. */
async function eligibleTherapists(practiceId: string, visitTypeId: string): Promise<TherapistRow[]> {
  const [{ data: all }, { data: links }] = await Promise.all([
    supabase
      .from('therapists')
      .select('id, name, alternating_weeks, kind')
      .eq('practice_id', practiceId)
      .is('archived_at', null)
      .neq('kind', 'assistant')
      .order('sort_order')
      .order('name'),
    supabase.from('online_visit_type_therapists').select('therapist_id').eq('visit_type_id', visitTypeId),
  ]);
  const listed = new Set((links ?? []).map((l) => l.therapist_id as string));
  return ((all ?? []) as TherapistRow[]).filter((t) => listed.size === 0 || listed.has(t.id));
}

async function loadPracticeSchedule(practiceId: string): Promise<PracticeSchedule> {
  const [{ data: hours }, { data: closed }] = await Promise.all([
    supabase.from('practice_hours').select('weekday, start_time, end_time').eq('practice_id', practiceId),
    supabase.from('practice_closed_days').select('id, date_from, date_to, note, repeat_yearly').eq('practice_id', practiceId),
  ]);
  return {
    weekly: (hours ?? []).map((h) => ({ weekday: h.weekday as number, startMin: timeToMin(h.start_time as string), endMin: timeToMin(h.end_time as string) })),
    closed: (closed ?? []).map(
      (c): ClosedDay => ({
        id: c.id as string,
        dateFrom: c.date_from as string,
        dateTo: c.date_to as string,
        note: (c.note as string | null) ?? null,
        repeatYearly: Boolean(c.repeat_yearly),
      })
    ),
    blockOutsideHours: true,
  };
}

async function loadSchedules(therapists: TherapistRow[]): Promise<Map<string, Schedule>> {
  const ids = therapists.map((t) => t.id);
  const map = new Map<string, Schedule>(
    therapists.map((t) => [t.id, { alternatingWeeks: Boolean(t.alternating_weeks), weekly: [], days: [], absences: [] }])
  );
  if (ids.length === 0) return map;
  const [{ data: weekly }, { data: days }, { data: absences }] = await Promise.all([
    supabase.from('therapist_hours').select('id, therapist_id, week_parity, weekday, start_time, end_time').in('therapist_id', ids),
    supabase.from('therapist_day_hours').select('id, therapist_id, date, start_time, end_time, note').in('therapist_id', ids),
    supabase.from('therapist_absences').select('id, therapist_id, date_from, date_to, reason, note').in('therapist_id', ids),
  ]);
  for (const r of weekly ?? []) {
    map.get(r.therapist_id as string)?.weekly.push({
      id: r.id as string,
      weekParity: r.week_parity as WeekParity,
      weekday: r.weekday as number,
      startMin: timeToMin(r.start_time as string),
      endMin: timeToMin(r.end_time as string),
    });
  }
  for (const r of days ?? []) {
    map.get(r.therapist_id as string)?.days.push({
      id: r.id as string,
      date: r.date as string,
      startMin: timeToMin(r.start_time as string),
      endMin: timeToMin(r.end_time as string),
      note: (r.note as string | null) ?? null,
    });
  }
  for (const r of absences ?? []) {
    map.get(r.therapist_id as string)?.absences.push({
      id: r.id as string,
      dateFrom: r.date_from as string,
      dateTo: r.date_to as string,
      reason: r.reason as AbsenceReason,
      note: (r.note as string | null) ?? null,
    });
  }
  return map;
}

async function loadBusy(therapistIds: string[], fromMs: number, toMs: number): Promise<Map<string, { start: number; end: number }[]>> {
  const map = new Map<string, { start: number; end: number }[]>(therapistIds.map((id) => [id, []]));
  if (therapistIds.length === 0) return map;
  const { data } = await supabase
    .from('appointments')
    .select('therapist_id, starts_at, ends_at')
    .in('therapist_id', therapistIds)
    .not('status', 'in', '(cancelled,no_show)')
    .lt('starts_at', new Date(toMs).toISOString())
    .gt('ends_at', new Date(fromMs).toISOString());
  for (const a of data ?? []) {
    map.get(a.therapist_id as string)?.push({ start: Date.parse(a.starts_at as string), end: Date.parse(a.ends_at as string) });
  }
  return map;
}

interface PatientMatch {
  id: string;
  assigned_therapist_id: string | null;
}

/** Same first + last name and the same email or phone. */
async function findPatient(practiceId: string, contact: Contact): Promise<PatientMatch | null> {
  const { data } = await supabase
    .from('patients')
    .select('id, first_name, last_name, email, phone, assigned_therapist_id, created_at')
    .eq('practice_id', practiceId)
    .or(`email.eq.${JSON.stringify(contact.email)},phone.eq.${JSON.stringify(contact.phone)}`)
    .order('created_at');
  const matches = (data ?? []).filter(
    (p) =>
      sameName(p.first_name as string, contact.firstName) &&
      sameName(p.last_name as string, contact.lastName) &&
      (((p.email as string | null) ?? '').toLowerCase() === contact.email || normalizePhone((p.phone as string | null) ?? '') === contact.phone)
  );
  const withTherapist = matches.find((p) => p.assigned_therapist_id);
  const best = withTherapist ?? matches[0];
  return best ? { id: best.id as string, assigned_therapist_id: (best.assigned_therapist_id as string | null) ?? null } : null;
}

interface Plan {
  visitType: VisitType;
  patient: PatientMatch | null;
  therapists: TherapistRow[];
}

/** The visit type, the matched patient and the therapists to offer: the
 *  patient's own when they take this visit type, otherwise every eligible one. */
async function plan(practiceId: string, visitTypeId: unknown, contact: Contact): Promise<Plan | string> {
  if (typeof visitTypeId !== 'string') return 'Izberite vrsto obiska.';
  const visitType = (await loadVisitTypes(practiceId)).find((v) => v.id === visitTypeId);
  if (!visitType) return 'Izberite vrsto obiska.';
  const eligible = await eligibleTherapists(practiceId, visitType.id);
  const patient = await findPatient(practiceId, contact);
  const own = patient?.assigned_therapist_id ? eligible.find((t) => t.id === patient.assigned_therapist_id) : undefined;
  return { visitType, patient, therapists: own ? [own] : eligible };
}

async function freeSlots(settings: Settings, p: Plan) {
  const earliestMs = Date.now() + settings.min_notice_hours * 3600_000;
  const lastDate = addDaysIso(toLocal(Date.now()).date, settings.booking_window_days);
  const [practice, schedules, busy] = await Promise.all([
    loadPracticeSchedule(settings.practice_id),
    loadSchedules(p.therapists),
    loadBusy(
      p.therapists.map((t) => t.id),
      earliestMs,
      Date.now() + (settings.booking_window_days + 2) * 86400_000
    ),
  ]);
  return onlineSlots({
    therapists: p.therapists.map((t) => ({ id: t.id, schedule: schedules.get(t.id), busy: busy.get(t.id) ?? [] })),
    practice,
    durationMin: p.visitType.duration_minutes,
    stepMin: settings.slot_step_minutes,
    earliestMs,
    lastDate,
  });
}

// ---- session (proves the details step passed Turnstile) ---------------------

interface Session {
  k: string;
  visitTypeId: string;
  contact: Contact;
  consentText: string;
  exp: number;
}

async function signSession(s: Session): Promise<string> {
  const body = b64url(encoder.encode(JSON.stringify(s)));
  return `${body}.${await hmac(body)}`;
}

async function readSession(token: unknown, k: string): Promise<Session | null> {
  if (typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig || (await hmac(body)) !== sig) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)))) as Session;
    return s.k === k && s.exp > Date.now() ? s : null;
  } catch {
    return null;
  }
}

// ---- handlers ----------------------------------------------------------------

async function handleConfig(k: string | null): Promise<Response> {
  const settings = await loadSettings(k);
  if (!settings || !settings.enabled) return json({ enabled: false });
  const [name, visitTypes, invoice] = await Promise.all([
    practiceName(settings.practice_id),
    loadVisitTypes(settings.practice_id),
    supabase.from('invoice_settings').select('phone').eq('practice_id', settings.practice_id).maybeSingle(),
  ]);
  return json({
    enabled: true,
    practiceName: name,
    phone: settings.phone || (invoice.data?.phone as string | null) || null,
    visitTypes: visitTypes.map((v) => ({ id: v.id, name: v.name, description: v.description, durationMinutes: v.duration_minutes })),
    consentText: (settings.consent_text || DEFAULT_CONSENT).replaceAll('{ordinacija}', name),
    privacyPolicyUrl: settings.privacy_policy_url,
    turnstileSiteKey: TURNSTILE_SECRET_KEY ? TURNSTILE_SITE_KEY || null : null,
  });
}

async function handleSlots(req: Request, input: Record<string, unknown>, settings: Settings, ipHash: string): Promise<Response> {
  if (await rateLimited(ipHash, 'slots')) return json({ error: 'Preveč poskusov. Poskusite znova čez eno uro.' }, 429);
  // A refresh (after "taken", or "Nazaj") reuses the session instead of a new captcha.
  const existing = input.session ? await readSession(input.session, input.k as string) : null;
  if (input.session && !existing) return json({ error: 'Seja je potekla. Začnite znova.', expired: true }, 400);
  let contact: Contact | string;
  if (existing) {
    contact = existing.contact;
  } else {
    contact = cleanContact(input);
    if (typeof contact === 'string') return json({ error: contact }, 400);
    if (input.consent !== true) return json({ error: 'Za naročilo potrebujemo vaše soglasje.' }, 400);
    if (!(await turnstileOk(input.turnstileToken, clientIp(req)))) return json({ error: 'Preverjanje, da niste robot, ni uspelo. Poskusite znova.' }, 400);
  }
  const p = await plan(settings.practice_id, existing?.visitTypeId ?? input.visitTypeId, contact);
  if (typeof p === 'string') return json({ error: p }, 400);
  const slots = await freeSlots(settings, p);
  const name = await practiceName(settings.practice_id);
  const session = existing
    ? (input.session as string)
    : await signSession({
        k: input.k as string,
        visitTypeId: p.visitType.id,
        contact,
        consentText: (settings.consent_text || DEFAULT_CONSENT).replaceAll('{ordinacija}', name),
        exp: Date.now() + SESSION_MINUTES * 60000,
      });
  return json({ session, slots: slots.map((s) => s.start.toISOString()) });
}

async function handleBook(input: Record<string, unknown>, settings: Settings, ipHash: string): Promise<Response> {
  if (await rateLimited(ipHash, 'book')) return json({ error: 'Preveč poskusov. Poskusite znova čez eno uro.' }, 429);
  const session = await readSession(input.session, input.k as string);
  if (!session) return json({ error: 'Seja je potekla. Začnite znova.', expired: true }, 400);
  const startMs = typeof input.start === 'string' ? Date.parse(input.start) : NaN;
  if (Number.isNaN(startMs)) return json({ error: 'Izberite termin.' }, 400);
  const note = typeof input.note === 'string' ? input.note.trim().slice(0, 500) : '';

  const p = await plan(settings.practice_id, session.visitTypeId, session.contact);
  if (typeof p === 'string') return json({ error: p }, 400);
  const slot = (await freeSlots(settings, p)).find((s) => s.start.getTime() === startMs);
  if (!slot) return json({ error: 'Ta termin je medtem že zaseden. Izberite drugega.', taken: true }, 409);
  const therapistId = slot.therapistIds[0];
  const therapist = p.therapists.find((t) => t.id === therapistId)!;
  const c = session.contact;

  // The patient: the matched one, or a new record without a birth date.
  let patientId = p.patient?.id ?? null;
  if (!patientId) {
    const { data, error } = await supabase
      .from('patients')
      .insert({
        practice_id: settings.practice_id,
        first_name: c.firstName,
        last_name: c.lastName,
        phone: c.phone,
        email: c.email,
        source: 'online',
        assigned_therapist_id: therapist.id,
        assigned_dentist: therapist.name,
      })
      .select('id')
      .single();
    if (error || !data) return json({ error: 'Naročila ni bilo mogoče shraniti. Pokličite ordinacijo.' }, 500);
    patientId = data.id as string;
  } else if (!p.patient?.assigned_therapist_id) {
    // Same as the calendar: a patient without a therapist gets this one.
    await supabase.from('patients').update({ assigned_therapist_id: therapist.id, assigned_dentist: therapist.name }).eq('id', patientId);
  }

  const notes = [`Spletno naročilo — telefon ${c.phone}, e-pošta ${c.email}.`, note ? `Opomba pacienta: ${note}` : ''].filter(Boolean).join('\n');
  const endMs = startMs + p.visitType.duration_minutes * 60000;
  const { data: appt, error: apptError } = await supabase
    .from('appointments')
    .insert({
      patient_id: patientId,
      therapist_id: therapist.id,
      starts_at: new Date(startMs).toISOString(),
      ends_at: new Date(endMs).toISOString(),
      status: 'scheduled',
      service: p.visitType.name,
      notes,
      source: 'online',
      online_visit_type_id: p.visitType.id,
    })
    .select('id, created_at')
    .single();
  if (apptError || !appt) {
    const outside = apptError?.code === 'P0001';
    return json({ error: outside ? 'Ta termin ni več na voljo. Izberite drugega.' : 'Naročila ni bilo mogoče shraniti. Pokličite ordinacijo.', taken: outside }, outside ? 409 : 500);
  }

  // Two patients booking the same time within the same second: the later
  // insert gives way.
  const { data: clash } = await supabase
    .from('appointments')
    .select('id, created_at')
    .eq('therapist_id', therapist.id)
    .neq('id', appt.id)
    .not('status', 'in', '(cancelled,no_show)')
    .lt('starts_at', new Date(endMs).toISOString())
    .gt('ends_at', new Date(startMs).toISOString());
  if ((clash ?? []).some((a) => (a.created_at as string) <= (appt.created_at as string))) {
    await supabase.from('appointments').delete().eq('id', appt.id);
    return json({ error: 'Ta termin je medtem že zaseden. Izberite drugega.', taken: true }, 409);
  }

  await supabase.from('online_booking_consents').insert({
    practice_id: settings.practice_id,
    patient_id: patientId,
    appointment_id: appt.id,
    consent_text: session.consentText,
    privacy_policy_url: settings.privacy_policy_url,
    ip_hash: ipHash,
  });

  return json({ ok: true, start: new Date(startMs).toISOString(), visitType: p.visitType.name, email: c.email });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  try {
    if (req.method === 'GET') return await handleConfig(new URL(req.url).searchParams.get('k'));
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    const input = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!input) return json({ error: 'Napačna zahteva.' }, 400);
    const settings = await loadSettings(input.k);
    if (!settings || !settings.enabled) return json({ error: 'Spletno naročanje trenutno ni na voljo.' }, 404);
    const ipHash = await sha256(`${clientIp(req)}:${SERVICE_ROLE_KEY.slice(-16)}`);

    if (input.action === 'slots') return await handleSlots(req, input, settings, ipHash);
    if (input.action === 'book') return await handleBook(input, settings, ipHash);
    return json({ error: 'Napačna zahteva.' }, 400);
  } catch {
    return json({ error: 'Prišlo je do napake. Poskusite znova ali pokličite ordinacijo.' }, 500);
  }
});
