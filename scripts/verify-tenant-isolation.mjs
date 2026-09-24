// Throwaway verification script for the multi-tenancy migration
// (supabase/migrations/011_add_multi_tenancy.sql / 012_replace_rls_policies.sql)
// — NOT shipped as part of the app, not a permanent test suite. Confirms
// the actual security property that matters: a second practice's account
// can create its own data and genuinely cannot see (or write into) the
// first practice's patient records.
//
// Also exercises 013_add_appointments.sql and 014_add_therapists.sql's
// identical cross-account isolation, once those are run live too.
//
// Usage (run from the repo root, after running BOTH migrations live):
//   ACCOUNT1_EMAIL=... ACCOUNT1_PASSWORD=... \
//   ACCOUNT2_EMAIL=... ACCOUNT2_PASSWORD=... \
//   node scripts/verify-tenant-isolation.mjs
//
// ACCOUNT1 = an existing real account (e.g. goslar.monika@gmail.com) whose
// practice already has patients. ACCOUNT2 = a fresh throwaway account
// created via Supabase Dashboard -> Authentication -> Add user (this
// sidesteps the email-confirmation question entirely, and still exercises
// the same handle_new_user_practice() trigger that provisions a brand new
// practice for it).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const env = loadEnv(fileURLToPath(new URL('../.env', import.meta.url)));
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY;

const ACCOUNT1_EMAIL = process.env.ACCOUNT1_EMAIL;
const ACCOUNT1_PASSWORD = process.env.ACCOUNT1_PASSWORD;
const ACCOUNT2_EMAIL = process.env.ACCOUNT2_EMAIL;
const ACCOUNT2_PASSWORD = process.env.ACCOUNT2_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}
if (!ACCOUNT1_EMAIL || !ACCOUNT1_PASSWORD || !ACCOUNT2_EMAIL || !ACCOUNT2_PASSWORD) {
  console.error('Set ACCOUNT1_EMAIL/ACCOUNT1_PASSWORD/ACCOUNT2_EMAIL/ACCOUNT2_PASSWORD env vars first.');
  process.exit(1);
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}${detail ? `: ${detail}` : ''}`);
}

function freshClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

async function main() {
  // 1. Account 1 (existing practice) still sees its own patients.
  const client1 = freshClient();
  const { error: signIn1Error } = await client1.auth.signInWithPassword({
    email: ACCOUNT1_EMAIL,
    password: ACCOUNT1_PASSWORD,
  });
  if (signIn1Error) {
    check('sign in as account 1', false, signIn1Error.message);
    process.exit(1);
  }
  const { data: account1Patients, error: account1SelectError } = await client1.from('patients').select('id').limit(50);
  check(
    'account 1 sees its own existing patients (regression check)',
    !account1SelectError && (account1Patients?.length ?? 0) > 0,
    account1SelectError?.message ?? `${account1Patients?.length ?? 0} patients`
  );
  const foreignPatientId = account1Patients?.[0]?.id;

  // Account 1's own practice_id — needed below to test that account 2
  // can't spoof it onto a therapists row (therapists has no parent row to
  // auto-stamp practice_id from, same as patients, so it's the one place a
  // malicious/buggy client could try to attach a fabricated practice_id).
  const { data: account1Membership } = await client1.from('practice_members').select('practice_id').limit(1).maybeSingle();
  const account1PracticeId = account1Membership?.practice_id;

  // 2. Account 2 (fresh throwaway practice) sees NO patients at all.
  const client2 = freshClient();
  const { error: signIn2Error } = await client2.auth.signInWithPassword({
    email: ACCOUNT2_EMAIL,
    password: ACCOUNT2_PASSWORD,
  });
  if (signIn2Error) {
    check('sign in as account 2', false, signIn2Error.message);
    process.exit(1);
  }
  const { data: account2Patients, error: account2SelectError } = await client2.from('patients').select('id');
  check(
    'account 2 sees ZERO patients (fresh practice)',
    !account2SelectError && (account2Patients?.length ?? 0) === 0,
    account2SelectError?.message ?? `${account2Patients?.length ?? 0} patients`
  );

  // 3. Account 2 cannot fetch a specific patient id belonging to account 1.
  if (foreignPatientId) {
    const { data: foreignFetch, error: foreignFetchError } = await client2
      .from('patients')
      .select('id')
      .eq('id', foreignPatientId);
    check(
      "account 2 cannot fetch account 1's patient by id",
      !foreignFetchError && (foreignFetch?.length ?? 0) === 0,
      foreignFetchError?.message ?? `returned ${foreignFetch?.length ?? 0} rows`
    );

    // 4. Account 2 cannot insert a visit against account 1's patient.
    const { error: foreignVisitError } = await client2
      .from('visits')
      .insert({ patient_id: foreignPatientId, date: new Date().toISOString().slice(0, 10) });
    check(
      "account 2 cannot insert a visit against account 1's patient",
      !!foreignVisitError,
      foreignVisitError ? foreignVisitError.message : 'insert unexpectedly succeeded'
    );

    // 4b. Same check for appointments (013_add_appointments.sql) — the
    // trigger-derived practice_id + WITH CHECK should reject this exactly
    // like the visits check above.
    const nowIso = new Date().toISOString();
    const inOneHourIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { error: foreignAppointmentError } = await client2
      .from('appointments')
      .insert({ patient_id: foreignPatientId, starts_at: nowIso, ends_at: inOneHourIso });
    check(
      "account 2 cannot insert an appointment against account 1's patient",
      !!foreignAppointmentError,
      foreignAppointmentError ? foreignAppointmentError.message : 'insert unexpectedly succeeded'
    );
  } else {
    check("account 2 cannot fetch account 1's patient by id", false, 'skipped — account 1 had no patients to test against');
    check("account 2 cannot insert a visit against account 1's patient", false, 'skipped — account 1 had no patients to test against');
    check("account 2 cannot insert an appointment against account 1's patient", false, 'skipped — account 1 had no patients to test against');
  }

  // 4c. Account 2 cannot spoof account 1's practice_id onto a therapists
  // row (014_add_therapists.sql) — therapists is a root table like
  // patients, so the client sets practice_id explicitly rather than an
  // auto-stamp trigger deriving it; the insert WITH CHECK must still
  // reject a fabricated foreign practice_id.
  if (account1PracticeId) {
    const { error: foreignTherapistError } = await client2
      .from('therapists')
      .insert({ practice_id: account1PracticeId, name: 'Spoofed Therapist' });
    check(
      "account 2 cannot insert a therapist under account 1's practice_id",
      !!foreignTherapistError,
      foreignTherapistError ? foreignTherapistError.message : 'insert unexpectedly succeeded'
    );
  } else {
    check("account 2 cannot insert a therapist under account 1's practice_id", false, "skipped — couldn't resolve account 1's practice_id");
  }

  // 4d. Same spoof check for email_templates (019_add_email_templates.sql) —
  // another root table where the client sets practice_id explicitly. Run only
  // after 019 is live.
  if (account1PracticeId) {
    const { error: foreignTemplateError } = await client2
      .from('email_templates')
      .insert({ practice_id: account1PracticeId, template_key: 'recall', subject: 'Spoofed' });
    check(
      "account 2 cannot insert an email template under account 1's practice_id",
      !!foreignTemplateError,
      foreignTemplateError ? foreignTemplateError.message : 'insert unexpectedly succeeded'
    );
  } else {
    check("account 2 cannot insert an email template under account 1's practice_id", false, "skipped — couldn't resolve account 1's practice_id");
  }

  // 5. Account 2 can create its own patient, and account 1 still can't see it.
  // patients.practice_id has no auto-stamp trigger (it's the root table, no
  // parent row to derive it from) — the real app sets it explicitly via
  // usePracticeContext() (see usePatients.ts createPatient), so this test
  // must do the same lookup rather than omitting it.
  const { data: account2Membership, error: membershipError } = await client2
    .from('practice_members')
    .select('practice_id')
    .limit(1)
    .maybeSingle();
  check(
    'account 2 can resolve its own practice_id',
    !membershipError && !!account2Membership,
    membershipError?.message ?? (account2Membership ? account2Membership.practice_id : 'no practice_members row found')
  );

  const { data: newPatient, error: createError } = await client2
    .from('patients')
    .insert({
      practice_id: account2Membership?.practice_id,
      first_name: 'Verify',
      last_name: 'Tenant',
      dob: '2000-01-01',
      sex: 'F',
    })
    .select('id')
    .single();
  check('account 2 can create its own patient', !createError, createError?.message);

  if (newPatient) {
    const { data: account1SeesNew, error: account1SeesNewError } = await client1
      .from('patients')
      .select('id')
      .eq('id', newPatient.id);
    check(
      "account 1 cannot see account 2's new patient",
      !account1SeesNewError && (account1SeesNew?.length ?? 0) === 0,
      account1SeesNewError?.message ?? `returned ${account1SeesNew?.length ?? 0} rows`
    );

    // 6. Account 2 can create an appointment for its own patient (practice_id
    // auto-stamped by the trigger, no explicit value sent), and account 1
    // can't see it.
    const nowIso = new Date().toISOString();
    const inOneHourIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { data: newAppointment, error: appointmentCreateError } = await client2
      .from('appointments')
      .insert({ patient_id: newPatient.id, starts_at: nowIso, ends_at: inOneHourIso })
      .select('id')
      .single();
    check('account 2 can create an appointment for its own patient', !appointmentCreateError, appointmentCreateError?.message);

    if (newAppointment) {
      const { data: account1SeesAppointment, error: account1SeesAppointmentError } = await client1
        .from('appointments')
        .select('id')
        .eq('id', newAppointment.id);
      check(
        "account 1 cannot see account 2's appointment",
        !account1SeesAppointmentError && (account1SeesAppointment?.length ?? 0) === 0,
        account1SeesAppointmentError?.message ?? `returned ${account1SeesAppointment?.length ?? 0} rows`
      );
    }

    // 7. Account 2 can create its own therapist (practice_id set
    // explicitly from its own resolved membership, same as patients
    // above), and account 1 can't see it.
    const { data: newTherapist, error: therapistCreateError } = await client2
      .from('therapists')
      .insert({ practice_id: account2Membership?.practice_id, name: 'Verify Therapist' })
      .select('id')
      .single();
    check('account 2 can create its own therapist', !therapistCreateError, therapistCreateError?.message);

    if (newTherapist) {
      const { data: account1SeesTherapist, error: account1SeesTherapistError } = await client1
        .from('therapists')
        .select('id')
        .eq('id', newTherapist.id);
      check(
        "account 1 cannot see account 2's therapist",
        !account1SeesTherapistError && (account1SeesTherapist?.length ?? 0) === 0,
        account1SeesTherapistError?.message ?? `returned ${account1SeesTherapist?.length ?? 0} rows`
      );
    }
  }

  await client1.auth.signOut();
  await client2.auth.signOut();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Script error:', err);
  process.exit(1);
});
