import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
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
};

// Loads every patient (there's no per-practice multi-tenancy here — RLS
// already restricts this to the one authenticated dentist/account, see
// schema.sql's "auth_only" policies) and offers a way to add a new one.
// Search/filter is left to the caller (PatientList.tsx) to do client-side
// against this same in-memory list — a single-dentist practice's patient
// list is small enough that a server-side search round trip would be
// solving a problem this app doesn't have yet.
//
// Every Supabase call lives here, not in PatientList.tsx directly, per
// CLAUDE.md's own "Coding Conventions" rule.
export function usePatients() {
  const [patients, setPatients] = useState<PatientListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('patients')
      .select('id, first_name, last_name, dob, sex, phone, email, address, postal_code, city, health_card_number')
      .order('last_name', { ascending: true })
      .order('first_name', { ascending: true });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setPatients(
      (data ?? []).map((row) => ({
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
      }))
    );
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
    }): Promise<{ patientId: string } | { error: string }> => {
      const { data, error } = await supabase
        .from('patients')
        .insert({
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
        })
        .select('id')
        .single();
      if (error) return { error: error.message };
      await reload();
      return { patientId: data.id as string };
    },
    [reload]
  );

  return { patients, loading, error, createPatient };
}
