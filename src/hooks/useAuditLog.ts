import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// The audit log (migration 056): who created, changed or deleted patient data
// (written by database triggers) and who viewed, printed or emailed it
// (reported here by the app through log_patient_access()). Only owners can
// read it — Nastavitve → Revizijska sled.

export type AccessAction = 'view' | 'print' | 'email';

/** Records a view / printout / email of a patient's data. Never blocks the
 *  action itself: a failure is ignored (the database still records changes). */
export async function logPatientAccess(patientId: string, action: AccessAction, details?: Record<string, string>): Promise<void> {
  await supabase.rpc('log_patient_access', { p_patient_id: patientId, p_action: action, p_details: details ?? null });
}

export interface AuditEntry {
  id: number;
  occurredAt: string;
  actor: string;
  action: string;
  entity: string;
  recordId: string | null;
  patientId: string | null;
  details: { fields?: string[]; tooth?: string; document?: string; number?: string; [key: string]: unknown } | null;
}

export interface AuditFilters {
  patientId: string | null;
  action: string | null;
  /** yyyy-mm-dd, inclusive, Ljubljana days. */
  from: string | null;
  to: string | null;
}

const PAGE = 100;

export function useAuditLog(filters: AuditFilters) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const filterKey = JSON.stringify(filters);

  // A new filter starts from the first page.
  const [loadedKey, setLoadedKey] = useState(filterKey);
  if (loadedKey !== filterKey) {
    setLoadedKey(filterKey);
    setLimit(PAGE);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    async function load() {
      let query = supabase
        .from('audit_log')
        .select('id, occurred_at, actor, action, entity, record_id, patient_id, details')
        .order('occurred_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit + 1);
      if (filters.patientId) query = query.eq('patient_id', filters.patientId);
      // 'noview' (the default) hides views; 'all' shows everything.
      if (filters.action === 'noview') query = query.neq('action', 'view');
      else if (filters.action === 'change') query = query.in('action', ['insert', 'update', 'delete']);
      else if (filters.action && filters.action !== 'all') query = query.eq('action', filters.action);
      if (filters.from) query = query.gte('occurred_at', new Date(`${filters.from}T00:00:00`).toISOString());
      if (filters.to) {
        const end = new Date(`${filters.to}T00:00:00`);
        end.setDate(end.getDate() + 1);
        query = query.lt('occurred_at', end.toISOString());
      }
      const { data, error: fetchError } = await query;
      if (cancelled) return;
      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }
      const rows = data ?? [];
      setHasMore(rows.length > limit);
      setEntries(
        rows.slice(0, limit).map((r) => ({
          id: r.id,
          occurredAt: r.occurred_at,
          actor: r.actor,
          action: r.action,
          entity: r.entity,
          recordId: r.record_id,
          patientId: r.patient_id,
          details: r.details,
        }))
      );
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [filters.patientId, filters.action, filters.from, filters.to, limit]);

  const loadMore = useCallback(() => setLimit((l) => l + PAGE), []);

  return { entries, loading, error, hasMore, loadMore };
}
