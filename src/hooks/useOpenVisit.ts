import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// Resolves which `visits.id` PatientChart.tsx should load/save against for
// a given patient — "resume the most recent still-open visit, or start a
// new one" — the logic CLAUDE.md's "Visit lifecycle" section describes.
// Previously PatientChart.tsx just hardcoded one seeded TEST_VISIT_ID; now
// that a real patient list exists (PatientList.tsx), there's a real
// patientId to resolve a real visit from.
//
// Resolution rule: an "open" visit is one with no `closed_at` at all — NOT
// scoped to today's date. An earlier version of this hook filtered on
// `.eq('date', today)` too, on the (wrong) assumption that "resume today's
// visit" meant "only ever reuse one dated today." Since closing a visit is
// still fully unimplemented (`closed_at` is never set by anything), that
// date filter meant a patient's chart silently started a brand new, EMPTY
// visit every time it was opened on a later calendar day than their last
// one — Gregor caught this directly: opening any patient showed a blank
// chart even after real data had been entered, because that data was sound
// in an older visit the date filter could no longer find. Dropping the
// date filter fixes this: as long as nothing has closed a patient's visit,
// there is only ever ONE open one for them, and every session — today,
// tomorrow, next week — keeps landing in that same visit until closing is
// actually built (see the "Not started" list in CLAUDE.md).
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
      const { data: existing, error: findError } = await supabase
        .from('visits')
        .select('id')
        .eq('patient_id', patientId)
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
      // `date` here is just descriptive (when this visit was first opened)
      // — it no longer plays any role in resolving which visit to reuse,
      // see this hook's own comment above.
      const today = new Date().toISOString().slice(0, 10);
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
