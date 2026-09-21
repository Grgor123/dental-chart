import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

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
}

export interface AppointmentWithPatient extends Appointment {
  patientFirstName: string;
  patientLastName: string;
}

const APPOINTMENT_COLUMNS = 'id, patient_id, starts_at, ends_at, status, service, notes, therapist_id';

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
// Loads one patient's soonest not-yet-happened, not-cancelled appointment.
// scheduleAppointment() both creates (no appointment yet) and reschedules
// (one already exists) — Frame 5's single "Naroči/Prestavi termin" button
// stays the same either way, just against real data now.
export function useNextAppointment(patientId: string) {
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from('appointments')
      .select(APPOINTMENT_COLUMNS)
      .eq('patient_id', patientId)
      .neq('status', 'cancelled')
      .gte('starts_at', new Date().toISOString())
      .order('starts_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }
    setAppointment(data ? rowToAppointment(data) : null);
    setError(null);
    setLoading(false);
  }, [patientId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const scheduleAppointment = useCallback(
    async (fields: AppointmentFields): Promise<{ appointment: Appointment } | { error: string }> => {
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
      const { data, error: saveError } = appointment
        ? await supabase.from('appointments').update(columns).eq('id', appointment.id).select(APPOINTMENT_COLUMNS).single()
        : await supabase
            .from('appointments')
            .insert({ patient_id: patientId, ...columns })
            .select(APPOINTMENT_COLUMNS)
            .single();
      if (saveError) return { error: saveError.message };
      const saved = rowToAppointment(data);
      setAppointment(saved);
      return { appointment: saved };
    },
    [appointment, patientId]
  );

  const cancelAppointment = useCallback(async (): Promise<{ error: string } | null> => {
    if (!appointment) return null;
    const { error: cancelError } = await supabase.from('appointments').update({ status: 'cancelled' }).eq('id', appointment.id);
    if (cancelError) return { error: cancelError.message };
    await reload();
    return null;
  }, [appointment, reload]);

  return { appointment, loading, error, reload, scheduleAppointment, cancelAppointment };
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
    setAppointments(
      (data ?? []).map((row) => {
        const patient = row.patients as unknown as { first_name: string; last_name: string } | null;
        return {
          ...rowToAppointment(row),
          patientFirstName: patient?.first_name ?? '',
          patientLastName: patient?.last_name ?? '',
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
