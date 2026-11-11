import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { findNextFreeSlot, type BusyInterval } from '../lib/nextFreeSlot';
import type { PracticeSchedule, Schedule } from '../lib/workingHours';

// Native scheduling calendar — supabase/migrations/013_add_appointments.sql.
// practice_id is auto-stamped server-side by a trigger derived from
// patient_id (same convention as visits — see that migration's own
// comment), so nothing here ever sends practice_id on insert/update.
export type AppointmentStatus = 'scheduled' | 'sent' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';

export interface Appointment {
  id: string;
  patientId: string;
  startsAt: string; // ISO timestamp
  endsAt: string; // ISO timestamp
  status: AppointmentStatus;
  service: string | null;
  notes: string | null;
  therapistId: string | null;
  /** 'online' = booked by the patient on the website (migrations 048/050). */
  source?: 'staff' | 'online';
  /** Which reminder with the "Pridem / Ne pridem" link went out (Gregor,
   *  2026-11-11): 'email' (09:00) → empty circle, 'sms' (14:00, sent only if
   *  still unanswered) → circle with a blue centre. Undelivered ones don't
   *  count. Only loaded by useAppointmentsForRange. */
  reminder?: 'email' | 'sms' | null;
}

export interface AppointmentWithPatient extends Appointment {
  patientFirstName: string;
  patientLastName: string;
}

const APPOINTMENT_COLUMNS = 'id, patient_id, starts_at, ends_at, status, service, notes, therapist_id, source';

function rowToAppointment(row: Record<string, unknown>): Appointment {
  return {
    id: row.id as string,
    patientId: row.patient_id as string,
    startsAt: row.starts_at as string,
    endsAt: row.ends_at as string,
    status: row.status as AppointmentStatus,
    service: (row.service as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    therapistId: (row.therapist_id as string | null) ?? null,
    source: row.source === 'online' ? 'online' : 'staff',
  };
}

export interface AppointmentFields {
  startsAt: string;
  endsAt: string;
  service?: string | null;
  status?: AppointmentStatus;
  notes?: string | null;
  therapistId?: string | null;
}

// Frame 5 (Patient Record page, PatientChart.tsx) — "Podrobnosti termina."
// Every upcoming (not yet ended, not cancelled) appointment of one patient,
// soonest first (Gregor, 2026-11-09 — it used to be only the next one, which
// hid e.g. a second booking made online). scheduleAppointment() creates a new
// one, or reschedules/edits the one whose id is passed. Reloads when the
// window regains focus, so a booking made meanwhile (calendar, website) shows.
export function useUpcomingAppointments(patientId: string) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from('appointments')
      .select(APPOINTMENT_COLUMNS)
      .eq('patient_id', patientId)
      .neq('status', 'cancelled')
      .gte('ends_at', new Date().toISOString())
      .order('starts_at', { ascending: true })
      .limit(50);
    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }
    setAppointments((data ?? []).map(rowToAppointment));
    setError(null);
    setLoading(false);
  }, [patientId]);

  useEffect(() => {
    reload();
    const onFocus = () => reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  const scheduleAppointment = useCallback(
    async (fields: AppointmentFields, appointmentId: string | null): Promise<{ appointment: Appointment } | { error: string }> => {
      // therapist_id is deliberately sparse, not always-`?? null` like the
      // other fields: Frame 5 (Patient Record page) never sets fields.therapistId
      // at all, since it has no therapist picker of its own — if this
      // unconditionally wrote `null`, every reschedule from Frame 5 would
      // silently clear a therapist assigned via the calendar grid.
      const columns: Record<string, unknown> = {
        starts_at: fields.startsAt,
        ends_at: fields.endsAt,
        service: fields.service || null,
        status: fields.status ?? 'scheduled',
        notes: fields.notes || null,
      };
      if (fields.therapistId !== undefined) columns.therapist_id = fields.therapistId;
      const { data, error: saveError } = appointmentId
        ? await supabase.from('appointments').update(columns).eq('id', appointmentId).select(APPOINTMENT_COLUMNS).single()
        : await supabase
            .from('appointments')
            .insert({ patient_id: patientId, ...columns })
            .select(APPOINTMENT_COLUMNS)
            .single();
      if (saveError) return { error: saveError.message };
      await reload();
      return { appointment: rowToAppointment(data) };
    },
    [patientId, reload]
  );

  return { appointments, loading, error, reload, scheduleAppointment };
}

// "1982-03-12" -> the [start, end) UTC-ISO bounds of that calendar day in
// the browser's own local timezone — good enough for a single-country
// (Slovenia) app with no multi-timezone requirement, no library needed.
function dayRange(dateIso: string): { start: string; end: string } {
  const start = new Date(`${dateIso}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

// Shared by Day view (one day) and Week view (seven days) — every
// appointment (any patient, any status) starting in [startIso,
// endIsoExclusive), joined to the patient's name for display. Patients
// embeds as a single object, not an array, since appointments.patient_id
// -> patients is many-to-one (same convention noted for visits/
// tooth_records elsewhere in this codebase).
/** The first free slot for a new appointment (see lib/nextFreeSlot.ts):
 *  with a therapist, inside their working hours and around their booked
 *  appointments (cancelled and no-show ones don't block); without one, the
 *  next slot in the default hours.
 *  `enabled` false skips the lookup (e.g. once the time was picked by hand). */
export function useNextFreeSlot(
  therapistId: string | null,
  durationMinutes: number,
  fromIso: string,
  enabled: boolean,
  schedule?: Schedule,
  practice?: PracticeSchedule
) {
  const [slot, setSlot] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const from = new Date(Math.max(Date.now(), new Date(fromIso).getTime()));
    async function run() {
      setLoading(true);
      let busy: BusyInterval[] = [];
      if (therapistId) {
        const until = new Date(from.getTime() + 61 * 86400000).toISOString();
        const { data } = await supabase
          .from('appointments')
          .select('starts_at, ends_at')
          .eq('therapist_id', therapistId)
          .not('status', 'in', '(cancelled,no_show)')
          .gt('ends_at', from.toISOString())
          .lt('starts_at', until);
        busy = (data ?? []).map((r) => ({ start: new Date(r.starts_at as string).getTime(), end: new Date(r.ends_at as string).getTime() }));
      }
      if (cancelled) return;
      setSlot(findNextFreeSlot(from, durationMinutes, busy, schedule, practice, !!therapistId));
      setLoading(false);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [therapistId, durationMinutes, fromIso, enabled, schedule, practice]);

  return { slot, loading };
}

export function useAppointmentsForRange(startIso: string, endIsoExclusive: string) {
  const [appointments, setAppointments] = useState<AppointmentWithPatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from('appointments')
      .select(`${APPOINTMENT_COLUMNS}, patients(first_name, last_name)`)
      .gte('starts_at', startIso)
      .lt('starts_at', endIsoExclusive)
      .order('starts_at', { ascending: true });
    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }
    // Which still-open appointments already got a reminder with the confirm
    // link (Gregor, 2026-11-11). A failed lookup just means no circles.
    const openIds = (data ?? []).filter((row) => row.status === 'scheduled' || row.status === 'sent').map((row) => row.id as string);
    const reminded = new Map<string, 'email' | 'sms'>();
    if (openIds.length > 0) {
      const [mail, sms] = await Promise.all([
        supabase
          .from('email_log')
          .select('appointment_id')
          .eq('email_type', 'appointment_reminder')
          .in('status', ['sent', 'delivered'])
          .in('appointment_id', openIds),
        supabase.from('appointment_reminders').select('appointment_id, delivery_status').in('appointment_id', openIds),
      ]);
      for (const r of mail.data ?? []) reminded.set(r.appointment_id as string, 'email');
      for (const r of sms.data ?? []) {
        if (!['FAILED', 'REJECTED', 'CANCELLED'].includes((r.delivery_status as string | null) ?? '')) reminded.set(r.appointment_id as string, 'sms');
      }
    }
    setAppointments(
      (data ?? []).map((row) => {
        const patient = row.patients as unknown as { first_name: string; last_name: string } | null;
        return {
          ...rowToAppointment(row),
          patientFirstName: patient?.first_name ?? '',
          patientLastName: patient?.last_name ?? '',
          reminder: reminded.get(row.id as string) ?? null,
        };
      })
    );
    setError(null);
    setLoading(false);
  }, [startIso, endIsoExclusive]);

  useEffect(() => {
    reload();
  }, [reload]);

  const createAppointment = useCallback(
    async (input: AppointmentFields & { patientId: string }): Promise<{ appointment: Appointment } | { error: string }> => {
      const { data, error: createError } = await supabase
        .from('appointments')
        .insert({
          patient_id: input.patientId,
          starts_at: input.startsAt,
          ends_at: input.endsAt,
          service: input.service || null,
          status: input.status ?? 'scheduled',
          notes: input.notes || null,
          therapist_id: input.therapistId ?? null,
        })
        .select(APPOINTMENT_COLUMNS)
        .single();
      if (createError) return { error: createError.message };
      await reload();
      return { appointment: rowToAppointment(data) };
    },
    [reload]
  );

  const updateAppointment = useCallback(
    async (id: string, fields: Partial<AppointmentFields>): Promise<{ appointment: Appointment } | { error: string }> => {
      const columnUpdates: Record<string, unknown> = {};
      if (fields.startsAt !== undefined) columnUpdates.starts_at = fields.startsAt;
      if (fields.endsAt !== undefined) columnUpdates.ends_at = fields.endsAt;
      if (fields.service !== undefined) columnUpdates.service = fields.service || null;
      if (fields.status !== undefined) columnUpdates.status = fields.status;
      if (fields.notes !== undefined) columnUpdates.notes = fields.notes || null;
      if (fields.therapistId !== undefined) columnUpdates.therapist_id = fields.therapistId;

      const { data, error: updateError } = await supabase
        .from('appointments')
        .update(columnUpdates)
        .eq('id', id)
        .select(APPOINTMENT_COLUMNS)
        .single();
      if (updateError) return { error: updateError.message };
      await reload();
      return { appointment: rowToAppointment(data) };
    },
    [reload]
  );

  return { appointments, loading, error, reload, createAppointment, updateAppointment };
}

// Calendar.tsx's Day view.
export function useAppointmentsForDay(dateIso: string) {
  const { start, end } = dayRange(dateIso);
  return useAppointmentsForRange(start, end);
}

// Calendar.tsx's Week view — weekStartIso is the Monday (or whatever the
// caller decides the week starts on) of the visible week, "YYYY-MM-DD".
export function useAppointmentsForWeek(weekStartIso: string) {
  const start = new Date(`${weekStartIso}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return useAppointmentsForRange(start.toISOString(), end.toISOString());
}
