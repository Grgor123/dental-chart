import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { AppointmentWithPatient } from './useAppointments';
import type { PatientListItem } from './usePatients';

const APPOINTMENT_COLUMNS = 'id, patient_id, starts_at, ends_at, status, service, notes, therapist_id';

// Calendar.tsx's search box — cross-date lookup by patient name. Filters
// the already-loaded `patients` list client-side (same pattern
// PatientList.tsx/Calendar.tsx already use for their own patient search —
// one practice's patient list is small enough that a server round trip
// isn't needed for this step), then queries appointments across ALL dates
// for those matching patients, newest-relevant-first.
export function useAppointmentSearch(query: string, patients: PatientListItem[]) {
  const [results, setResults] = useState<AppointmentWithPatient[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      return;
    }
    const needle = trimmed.toLowerCase();
    const matchingIds = patients
      .filter((p) => `${p.firstName} ${p.lastName}`.toLowerCase().includes(needle))
      .map((p) => p.patientId);
    if (matchingIds.length === 0) {
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    supabase
      .from('appointments')
      .select(`${APPOINTMENT_COLUMNS}, patients(first_name, last_name)`)
      .in('patient_id', matchingIds)
      .order('starts_at', { ascending: true })
      .limit(50)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setResults([]);
          setLoading(false);
          return;
        }
        setResults(
          (data ?? []).map((row) => {
            const patient = row.patients as unknown as { first_name: string; last_name: string } | null;
            return {
              id: row.id as string,
              patientId: row.patient_id as string,
              startsAt: row.starts_at as string,
              endsAt: row.ends_at as string,
              status: row.status as AppointmentWithPatient['status'],
              service: (row.service as string | null) ?? null,
              notes: (row.notes as string | null) ?? null,
              therapistId: (row.therapist_id as string | null) ?? null,
              patientFirstName: patient?.first_name ?? '',
              patientLastName: patient?.last_name ?? '',
            };
          })
        );
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [query, patients]);

  return { results, loading };
}
