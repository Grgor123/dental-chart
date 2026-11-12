import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { describeToothRecord, type ToothRecordFields } from '../lib/describeToothRecord';

// One visit's worth of activity, across every tooth touched during it —
// the cross-tooth counterpart to useToothHistory.ts's per-tooth version.
// Backs PatientChart.tsx's Frame 8 ("Pretekli termini in storitve"), and,
// since migration 056, the visit's own record ("Zapis obiska"), its signature
// and any addenda added after signing.
export interface VisitAddendum {
  id: string;
  body: string;
  createdAt: string;
  createdByName: string | null;
}

export interface PatientHistoryEntry {
  visitId: string;
  date: string;
  closedAt: string | null;
  /** The visit record text (visits.notes). */
  note: string | null;
  signedAt: string | null;
  signedByName: string | null;
  addenda: VisitAddendum[];
  /** One line per touched tooth's own finding, already prefixed with which tooth it's about (e.g. "Zob 21: Cel zob: Abrazija"). */
  items: string[];
}

interface VisitRow {
  id: string;
  date: string;
  closed_at: string | null;
  notes: string | null;
  signed_at: string | null;
  signed_by_name: string | null;
}

// Every visit of the patient plus every tooth_records row and addendum,
// merged per visit. Reuses describeToothRecord() (src/lib/) so a tooth's own
// summary line can never disagree between this rollup and
// ToothDetailPanel.tsx's per-tooth "Zgodovina" tab.
export function usePatientHistory(patientId: string) {
  const [entries, setEntries] = useState<PatientHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    async function load() {
      const [visitsResult, recordsResult] = await Promise.all([
        supabase
          .from('visits')
          .select('id, date, closed_at, notes, signed_at, signed_by_name')
          .eq('patient_id', patientId)
          .order('date', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase
          .from('tooth_records')
          .select('visit_id, tooth_id, surfaces, post, endo, notes, visits!inner(patient_id)')
          .eq('visits.patient_id', patientId),
      ]);
      if (cancelled) return;
      const fetchError = visitsResult.error ?? recordsResult.error;
      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }
      const visits = (visitsResult.data ?? []) as VisitRow[];
      const { data: addendaRows, error: addendaError } = visits.length
        ? await supabase
            .from('visit_addenda')
            .select('id, visit_id, body, created_at, created_by_name')
            .in('visit_id', visits.map((v) => v.id))
            .order('created_at', { ascending: true })
        : { data: [], error: null };
      if (cancelled) return;
      if (addendaError) {
        setError(addendaError.message);
        setLoading(false);
        return;
      }

      const itemsByVisit = new Map<string, string[]>();
      for (const row of recordsResult.data ?? []) {
        const fdi = row.tooth_id as string;
        const fields: ToothRecordFields = {
          surfaces: row.surfaces && Object.keys(row.surfaces).length > 0 ? row.surfaces : null,
          post: !!row.post,
          endo: row.endo ?? null,
          notes: row.notes ?? null,
        };
        const lines = describeToothRecord(fields, fdi);
        if (lines.length === 0) continue;
        const list = itemsByVisit.get(row.visit_id as string) ?? [];
        for (const line of lines) list.push(`Zob ${fdi}: ${line}`);
        itemsByVisit.set(row.visit_id as string, list);
      }
      const addendaByVisit = new Map<string, VisitAddendum[]>();
      for (const a of addendaRows ?? []) {
        const list = addendaByVisit.get(a.visit_id as string) ?? [];
        list.push({ id: a.id, body: a.body, createdAt: a.created_at, createdByName: a.created_by_name });
        addendaByVisit.set(a.visit_id as string, list);
      }

      setEntries(
        visits
          .map((v) => ({
            visitId: v.id,
            date: v.date,
            closedAt: v.closed_at,
            note: v.notes,
            signedAt: v.signed_at,
            signedByName: v.signed_by_name,
            addenda: addendaByVisit.get(v.id) ?? [],
            items: (itemsByVisit.get(v.id) ?? []).sort(),
          }))
          // A visit opened and left without any entry isn't history.
          .filter((e) => e.items.length > 0 || e.note || e.signedAt)
      );
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [patientId, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  /** Signs a visit (and closes it if still open) — sign_visit(), migration 056. */
  const signVisit = useCallback(
    async (visitId: string, note: string): Promise<{ error?: string }> => {
      const { error: rpcError } = await supabase.rpc('sign_visit', { p_visit_id: visitId, p_note: note });
      if (rpcError) return { error: rpcError.message };
      reload();
      return {};
    },
    [reload]
  );

  /** Adds an addendum to a signed visit — add_visit_addendum(), migration 056. */
  const addAddendum = useCallback(
    async (visitId: string, body: string): Promise<{ error?: string }> => {
      const { error: rpcError } = await supabase.rpc('add_visit_addendum', { p_visit_id: visitId, p_body: body });
      if (rpcError) return { error: rpcError.message };
      reload();
      return {};
    },
    [reload]
  );

  return { entries, loading, error, reload, signVisit, addAddendum };
}
