import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Dentition } from '../lib/dentition';

// One patient's dentition (migration 062): which positions show a milk tooth
// or a not-yet-erupted permanent one. Loaded on its own (not in the patient
// list query) so the rest of the app doesn't depend on the column.
export function usePatientDentition(patientId: string) {
  const [dentition, setDentitionState] = useState<Dentition>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('patients')
      .select('dentition')
      .eq('id', patientId)
      .maybeSingle()
      .then(({ data, error: fetchError }) => {
        if (cancelled) return;
        // Before migration 062 the column doesn't exist: treat as an adult.
        if (fetchError) setError(fetchError.message);
        else setDentitionState(((data?.dentition as Dentition | null) ?? {}) as Dentition);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  /** Saves the whole map (optimistic; reverts and reports on failure). */
  const saveDentition = useCallback(
    async (next: Dentition): Promise<{ error?: string }> => {
      const previous = dentition;
      setDentitionState(next);
      const { error: updateError } = await supabase.from('patients').update({ dentition: next }).eq('id', patientId);
      if (updateError) {
        setDentitionState(previous);
        return { error: updateError.message };
      }
      return {};
    },
    [dentition, patientId]
  );

  return { dentition, loaded, error, saveDentition };
}
