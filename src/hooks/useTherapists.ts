import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePracticeContext } from '../contexts/PracticeContext';

// Terapevti (therapists) — supabase/migrations/014_add_therapists.sql.
// Like patients, a therapist has no parent row to derive practice_id from,
// so it's set explicitly on insert from usePracticeContext() rather than
// an auto-stamp trigger.
export interface Therapist {
  id: string;
  name: string;
  color: string;
}

const THERAPIST_COLUMNS = 'id, name, color';

function rowToTherapist(row: Record<string, unknown>): Therapist {
  return {
    id: row.id as string,
    name: row.name as string,
    color: row.color as string,
  };
}

// Loads every therapist belonging to the signed-in user's own practice —
// RLS already restricts reads/writes to rows whose practice_id matches
// current_practice_id(), so this hook's own select needs no explicit
// practice filter.
export function useTherapists() {
  const { practiceId } = usePracticeContext();
  const [therapists, setTherapists] = useState<Therapist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('therapists').select(THERAPIST_COLUMNS).order('name', { ascending: true });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setTherapists((data ?? []).map(rowToTherapist));
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const createTherapist = useCallback(
    async (name: string, color: string): Promise<{ id: string } | { error: string }> => {
      if (!practiceId) return { error: 'Ordinacija ni bila najdena — poskusite znova po ponovni prijavi.' };
      const { data, error } = await supabase
        .from('therapists')
        .insert({ practice_id: practiceId, name, color })
        .select('id')
        .single();
      if (error) return { error: error.message };
      await reload();
      return { id: data.id as string };
    },
    [reload, practiceId]
  );

  return { therapists, loading, error, createTherapist };
}
