import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export interface Practice {
  practiceId: string;
  practiceName: string;
}

// Resolves the signed-in user's own practice — the multi-tenancy
// counterpart to useAuth.ts's session. Every table's RLS policy already
// scopes rows to `practice_id = current_practice_id()` (see
// supabase/migrations/011_add_multi_tenancy.sql), so this hook's own query
// needs no explicit filter of its own: RLS on `practice_members` already
// restricts it to `user_id = auth.uid()`. Consumed app-wide via
// PracticeContext.tsx rather than called directly in every component that
// needs `practiceId`.
export function usePractice(session: Session | null) {
  const [practice, setPractice] = useState<Practice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      setPractice(null);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      const { data, error: fetchError } = await supabase
        .from('practice_members')
        .select('practice_id, practices(name)')
        .eq('user_id', session!.user.id)
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }
      if (!data) {
        // Shouldn't happen — handle_new_user_practice() provisions a
        // practice atomically with every new auth.users row — but fail
        // with a clear message rather than silently rendering a broken
        // patient list if it ever does.
        setError('Ta uporabniški račun ni povezan z nobeno ordinacijo.');
        setLoading(false);
        return;
      }
      const practices = data.practices as unknown as { name: string } | { name: string }[] | null;
      const practiceName = Array.isArray(practices) ? practices[0]?.name : practices?.name;
      setPractice({ practiceId: data.practice_id as string, practiceName: practiceName ?? '' });
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [session]);

  return { practice, loading, error };
}
