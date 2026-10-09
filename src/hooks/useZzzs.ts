import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePracticeContext } from '../contexts/PracticeContext';

// ZZZS šifrant (migration 033): the practice's "Uporabljaj šifrant ZZZS"
// switch and the shared, read-only catalogue of dental codes (loaded by
// scripts/sync-zzzs.mjs).

/** invoice_settings.use_zzzs_sifrant — off by default (no row = off). */
export function useZzzsSetting() {
  const { practiceId } = usePracticeContext();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('invoice_settings')
      .select('use_zzzs_sifrant')
      .maybeSingle()
      .then(({ data, error: fetchError }) => {
        if (cancelled) return;
        if (fetchError) setError(fetchError.message);
        else setEnabled(Boolean(data?.use_zzzs_sifrant));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Writes only this one column: on a first-ever insert the other settings
  // keep their column defaults, on update nothing else is touched.
  const setZzzsEnabled = useCallback(
    async (next: boolean): Promise<{ error?: string }> => {
      if (!practiceId) return { error: 'Ordinacija ni bila najdena — poskusite znova po ponovni prijavi.' };
      const { error: saveError } = await supabase
        .from('invoice_settings')
        .upsert({ practice_id: practiceId, use_zzzs_sifrant: next }, { onConflict: 'practice_id' });
      if (saveError) return { error: saveError.message };
      setEnabled(next);
      return {};
    },
    [practiceId]
  );

  return { enabled, loading, error, setZzzsEnabled };
}

export interface ZzzsList {
  code: string;
  name: string;
}

/** One ZZZS code (it can belong to several lists). */
export interface ZzzsEntry {
  code: string;
  shortName: string;
  lists: ZzzsList[];
}

/** Every currently valid dental code, by code. Loaded only when `enabled`. */
export function useZzzsCatalogue(enabled: boolean) {
  const [entries, setEntries] = useState<Map<string, ZzzsEntry>>(new Map());
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const rows: { list_code: string; list_name: string; code: string; short_name: string }[] = [];
      // ~1,400 rows; PostgREST returns at most 1,000 per request.
      for (let from = 0; ; from += 1000) {
        const { data, error: fetchError } = await supabase
          .from('zzzs_services')
          .select('list_code, list_name, code, short_name')
          .is('valid_to', null)
          .order('code')
          .range(from, from + 999);
        if (fetchError) {
          if (!cancelled) {
            setError(fetchError.message);
            setLoading(false);
          }
          return;
        }
        rows.push(...data);
        if (data.length < 1000) break;
      }
      const map = new Map<string, ZzzsEntry>();
      for (const r of rows) {
        const entry = map.get(r.code) ?? { code: r.code, shortName: r.short_name, lists: [] };
        entry.lists.push({ code: r.list_code, name: r.list_name });
        map.set(r.code, entry);
      }
      if (!cancelled) {
        setEntries(map);
        setError(null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { entries, loading, error };
}
