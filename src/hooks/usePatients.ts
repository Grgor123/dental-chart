import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePracticeContext } from '../contexts/PracticeContext';
import type { Patient } from '../types/dental';

// Row shape this hook works with — a thin slice of the full `Patient` type
// (types/dental.ts): everything about a patient except `visits`/
// `diagnoses`, which belong to the chart/treatment side of the app, not a
// list/search screen. Field names already translated from the DB's
// snake_case columns to the app's own camelCase convention, same as
// useVisit.ts does for tooth_records. `sex` is nullable here even though
// `Patient['sex']` itself only allows 'M'/'F' (see types/dental.ts) — the
// DB column has no NOT NULL constraint, so a patient can genuinely have
// none recorded yet; that "not yet entered" case is `null`, not a third
// gender value. `phone`/`email`/`address`/`postalCode`/`city`/
// `healthCardNumber` are already optional on `Patient` itself, so `Pick`
// carries that through unchanged.
// `assignedDentist`/`internalRecordNumber` (migration
// 010_add_patient_care_fields.sql) aren't on `Patient` at all yet — added
// directly here rather than widening that type, since they're specific to
// the Patient Record page's own Frame 2, not part of the chart/treatment
// data model `Patient` otherwise describes. Neither is hardcoded (e.g.
// always "Monika Novak") per Gregor's explicit request — both are plain,
// editable text, same as every other patient field.
export type PatientListItem = Pick<
  Patient,
  | 'patientId'
  | 'firstName'
  | 'lastName'
  | 'dob'
  | 'phone'
  | 'email'
  | 'address'
  | 'postalCode'
  | 'city'
  | 'healthCardNumber'
> & {
  sex: Patient['sex'] | null;
  assignedDentist?: string;
  internalRecordNumber?: string;
  /** SMS reminder consent (migration 015_add_sms_reminders.sql) — a double
      opt-in: 'unknown' until a phone is ever set, 'pending' from the
      moment it is (the request_sms_consent_on_phone_change trigger sends
      the one-button opt-in SMS right then), 'granted' only once that link
      is actually clicked, 'declined' if staff manually turn it off (e.g.
      the patient asked by phone — Lertify's account can't receive inbound
      replies, so there's no other way for a patient to revoke it
      themselves besides the unsubscribe link in each reminder). Appointment
      reminders only ever send to 'granted'. */
  smsConsentStatus: 'unknown' | 'pending' | 'granted' | 'declined';
  /** Email notification opt-out (migration 016_add_email_notifications.sql)
      — a lighter-touch model than SMS's double opt-in: an email address on
      file is treated as implied consent for transactional appointment
      email, so this starts `false` (subscribed) the moment an email exists,
      with no separate request/grant step. Flips to `true` via the
      patient-facing unsubscribe link in any sent email, an automatic
      opt-out on a hard bounce/spam complaint (see
      supabase/functions/ses-bounce-webhook), or this hook's own
      setEmailOptOut manual staff override below. */
  emailOptOut: boolean;
};

const PATIENT_COLUMNS =
  'id, first_name, last_name, dob, sex, phone, email, address, postal_code, city, health_card_number, assigned_dentist, internal_record_number, sms_consent_status, email_opt_out';

function rowToPatientListItem(row: Record<string, unknown>): PatientListItem {
  return {
    patientId: row.id as string,
    firstName: row.first_name as string,
    lastName: row.last_name as string,
    dob: row.dob as string,
    sex: (row.sex as Patient['sex'] | null) ?? null,
    phone: (row.phone as string | null) ?? undefined,
    email: (row.email as string | null) ?? undefined,
    address: (row.address as string | null) ?? undefined,
    postalCode: (row.postal_code as string | null) ?? undefined,
    city: (row.city as string | null) ?? undefined,
    healthCardNumber: (row.health_card_number as string | null) ?? undefined,
    assignedDentist: (row.assigned_dentist as string | null) ?? undefined,
    internalRecordNumber: (row.internal_record_number as string | null) ?? undefined,
    smsConsentStatus: (row.sms_consent_status as PatientListItem['smsConsentStatus']) ?? 'unknown',
    emailOptOut: (row.email_opt_out as boolean | null) ?? false,
  };
}

// Loads every patient belonging to the signed-in user's own practice — RLS
// (supabase/migrations/011_add_multi_tenancy.sql/012_replace_rls_policies.sql)
// already restricts reads/writes to rows whose practice_id matches
// current_practice_id(), so this hook's own select needs no explicit
// practice filter. Search/filter is left to the caller (PatientList.tsx) to
// do client-side against this same in-memory list — one practice's patient
// list is small enough that a server-side search round trip would be
// solving a problem this app doesn't have yet.
//
// Every Supabase call lives here, not in PatientList.tsx/PatientChart.tsx
// directly, per CLAUDE.md's own "Coding Conventions" rule.
export function usePatients() {
  const { practiceId } = usePracticeContext();
  const [patients, setPatients] = useState<PatientListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('patients')
      .select(PATIENT_COLUMNS)
      .order('last_name', { ascending: true })
      .order('first_name', { ascending: true });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setPatients((data ?? []).map(rowToPatientListItem));
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Returns the new patient's id on success, or an error message on
  // failure — the caller (PatientList.tsx's "new patient" form) decides
  // what to do with either (navigate straight into the chart; show the
  // message inline).
  const createPatient = useCallback(
    async (input: {
      firstName: string;
      lastName: string;
      dob: string;
      sex?: Patient['sex'];
      phone?: string;
      email?: string;
      address?: string;
      postalCode?: string;
      city?: string;
      healthCardNumber?: string;
      assignedDentist?: string;
      internalRecordNumber?: string;
    }): Promise<{ patientId: string } | { error: string }> => {
      // Shouldn't happen — PracticeProvider (App.tsx) already blocks
      // rendering this far until a practice resolves — but fail with a
      // clear message rather than a raw NOT NULL violation from Postgres.
      if (!practiceId) return { error: 'Ordinacija ni bila najdena — poskusite znova po ponovni prijavi.' };
      const { data, error } = await supabase
        .from('patients')
        .insert({
          practice_id: practiceId,
          first_name: input.firstName,
          last_name: input.lastName,
          dob: input.dob,
          sex: input.sex ?? null,
          phone: input.phone || null,
          email: input.email || null,
          address: input.address || null,
          postal_code: input.postalCode || null,
          city: input.city || null,
          health_card_number: input.healthCardNumber || null,
          assigned_dentist: input.assignedDentist || null,
          internal_record_number: input.internalRecordNumber || null,
        })
        .select('id')
        .single();
      if (error) return { error: error.message };
      await reload();
      return { patientId: data.id as string };
    },
    [reload, practiceId]
  );

  // Frame 2 (Patient Record page, PatientChart.tsx) — "Uredi"/"Shrani" on
  // the patient info card. Same partial-update shape for every field:
  // caller passes only what changed. Returns the updated row (mapped back
  // through rowToPatientListItem) on success so the caller can refresh its
  // own local copy without a full reload() round trip, or an error message
  // on failure.
  const updatePatient = useCallback(
    async (
      patientId: string,
      fields: Partial<{
        firstName: string;
        lastName: string;
        dob: string;
        sex: Patient['sex'] | null;
        phone: string | null;
        email: string | null;
        address: string | null;
        postalCode: string | null;
        city: string | null;
        healthCardNumber: string | null;
        assignedDentist: string | null;
        internalRecordNumber: string | null;
      }>
    ): Promise<{ patient: PatientListItem } | { error: string }> => {
      const columnUpdates: Record<string, unknown> = {};
      if (fields.firstName !== undefined) columnUpdates.first_name = fields.firstName;
      if (fields.lastName !== undefined) columnUpdates.last_name = fields.lastName;
      if (fields.dob !== undefined) columnUpdates.dob = fields.dob;
      if (fields.sex !== undefined) columnUpdates.sex = fields.sex;
      if (fields.phone !== undefined) columnUpdates.phone = fields.phone || null;
      if (fields.email !== undefined) columnUpdates.email = fields.email || null;
      if (fields.address !== undefined) columnUpdates.address = fields.address || null;
      if (fields.postalCode !== undefined) columnUpdates.postal_code = fields.postalCode || null;
      if (fields.city !== undefined) columnUpdates.city = fields.city || null;
      if (fields.healthCardNumber !== undefined) columnUpdates.health_card_number = fields.healthCardNumber || null;
      if (fields.assignedDentist !== undefined) columnUpdates.assigned_dentist = fields.assignedDentist || null;
      if (fields.internalRecordNumber !== undefined)
        columnUpdates.internal_record_number = fields.internalRecordNumber || null;

      const { data, error } = await supabase
        .from('patients')
        .update(columnUpdates)
        .eq('id', patientId)
        .select(PATIENT_COLUMNS)
        .single();
      if (error) return { error: error.message };
      const patient = rowToPatientListItem(data);
      setPatients((prev) => prev.map((p) => (p.patientId === patientId ? patient : p)));
      return { patient };
    },
    []
  );

  // Manual staff override for SMS consent — kept as its own dedicated
  // action rather than a field on updatePatient's generic bag, since it's
  // a deliberate compliance decision (e.g. a patient asked by phone to
  // stop, or staff re-sending an opt-in request), not a routine text edit.
  // Setting 'declined' does NOT delete the patient_sms_consents audit
  // trail — that stays as the durable record of what was originally
  // requested/granted, this only flips the fast-lookup status that
  // send-appointment-reminders actually checks before sending.
  const setSmsConsentStatus = useCallback(
    async (
      patientId: string,
      status: PatientListItem['smsConsentStatus']
    ): Promise<{ patient: PatientListItem } | { error: string }> => {
      const { data, error } = await supabase
        .from('patients')
        .update({ sms_consent_status: status, sms_consent_responded_at: new Date().toISOString() })
        .eq('id', patientId)
        .select(PATIENT_COLUMNS)
        .single();
      if (error) return { error: error.message };
      const patient = rowToPatientListItem(data);
      setPatients((prev) => prev.map((p) => (p.patientId === patientId ? patient : p)));
      return { patient };
    },
    []
  );

  // Manual staff override for email opt-out — its own dedicated action for
  // the same reason setSmsConsentStatus above is: a deliberate compliance
  // decision, not a routine text edit. Unlike SMS's 4-state consent, this
  // is a plain boolean flip (opted out / not), so there's no equivalent of
  // 'pending'/'unknown' to preserve.
  const setEmailOptOut = useCallback(
    async (patientId: string, optOut: boolean): Promise<{ patient: PatientListItem } | { error: string }> => {
      const { data, error } = await supabase
        .from('patients')
        .update({ email_opt_out: optOut, email_opt_out_at: new Date().toISOString() })
        .eq('id', patientId)
        .select(PATIENT_COLUMNS)
        .single();
      if (error) return { error: error.message };
      const patient = rowToPatientListItem(data);
      setPatients((prev) => prev.map((p) => (p.patientId === patientId ? patient : p)));
      return { patient };
    },
    []
  );

  return { patients, loading, error, createPatient, updatePatient, setSmsConsentStatus, setEmailOptOut };
}
