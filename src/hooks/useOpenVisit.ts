import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// Resolves which `visits.id` PatientChart.tsx should load/save against for
// a given patient — the "resume today's open visit, or start a new one"
// logic CLAUDE.md's "Visit lifecycle" section describes and useVisit.ts's
// own comment used to flag as deliberately not built yet. Previously
// PatientChart.tsx just hardcoded one seeded TEST_VISIT_ID; now that a real
// patient list exists (PatientList.tsx), there's a real patientId to
// resolve a real visit from.
//
// Resolution rule: an "open" visit is one with today's date and no
// `closed_at` — if the patient already has one (e.g. re-opening the chart
// mid-appointment, or clicking back into the same patient later the same
// day), reuse it so today's edits keep landing in one row per tooth rather
// than fragmenting across several visits; otherwise create a fresh one
// dated today. Nothing here ever sets `closed_at` — that's the other half
// of the lifecycle (explicitly closing a visit once an appointment is
// truly done) and stays a future step, same as it was before this hook
// existed.
//
// Every Supabase call lives here, not in PatientChart.tsx directly, per
// CLAUDE.md's own "Coding Conventions" rule.
export function useOpenVisit(patientId: string) {
  const [visitId, setVisitId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setVisitId(null);
    setError(null);

    async function resolve() {
      const today = new Date().toISOString().slice(0, 10);
      const { data: existing, error: findError } = await supabase
        .from('visits')
        .select('id')
        .eq('patient_id', patientId)
        .eq('date', today)
        .is('closed_at', null)
        .order('created_at', { ascending: false })
        .limit(1);
      if (cancelled) return;
      if (findError) {
        setError(findError.message);
        setLoading(false);
        return;
      }
      if (existing && existing.length > 0) {
        setVisitId(existing[0].id as string);
        setLoading(false);
        return;
      }
      const { data: created, error: createError } = await supabase
        .from('visits')
        .insert({ patient_id: patientId, date: today })
        .select('id')
        .single();
      if (cancelled) return;
      if (createError) {
        setError(createError.message);
        setLoading(false);
        return;
      }
      setVisitId(created.id as string);
      setLoading(false);
    }

    resolve();
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  return { visitId, loading, error };
}
