import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { describeToothRecord, type ToothRecordFields } from '../lib/describeToothRecord';

// One visit's worth of activity, across every tooth touched during it —
// the cross-tooth counterpart to useToothHistory.ts's per-tooth version.
// Backs PatientChart.tsx's Frame 8 ("Pretekli termini in storitve").
export interface PatientHistoryEntry {
  visitId: string;
  date: string;
  closedAt: string | null;
  /** One line per touched tooth's own finding, already prefixed with which tooth it's about (e.g. "Zob 21: Cel zob: Abrazija") — flattened rather than grouped-by-tooth, matching PatientPageMockup.tsx's own MOCK_VISIT_HISTORY shape this replaces. */
  items: string[];
}

// Same join pattern as useToothHistory.ts, minus the .eq('tooth_id', …)
// filter — every tooth_records row for this patient, across every visit,
// grouped client-side by visit_id instead of by tooth. Reuses
// describeToothRecord() (src/lib/) so a tooth's own summary line can never
// disagree between this rollup and ToothDetailPanel.tsx's per-tooth
// "Zgodovina" tab — both read the exact same formatting logic.
export function usePatientHistory(patientId: string) {
  const [entries, setEntries] = useState<PatientHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      const { data, error: fetchError } = await supabase
        .from('tooth_records')
        .select('tooth_id, surfaces, post, endo, notes, visits!inner(id, date, closed_at, patient_id)')
        .eq('visits.patient_id', patientId)
        .order('date', { foreignTable: 'visits', ascending: false });
      if (cancelled) return;
      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }
      // One entry per distinct visit, in the same newest-first order the
      // query already returned rows in — a plain Map preserves first-seen
      // insertion order, so no separate sort step is needed.
      const byVisit = new Map<string, PatientHistoryEntry>();
      for (const row of data ?? []) {
        const visit = row.visits as unknown as { id: string; date: string; closed_at: string | null };
        const fdi = row.tooth_id as string;
        const fields: ToothRecordFields = {
          surfaces: row.surfaces && Object.keys(row.surfaces).length > 0 ? row.surfaces : null,
          post: !!row.post,
          endo: row.endo ?? null,
          notes: row.notes ?? null,
        };
        const lines = describeToothRecord(fields, fdi);
        if (lines.length === 0) continue;
        let entry = byVisit.get(visit.id);
        if (!entry) {
          entry = { visitId: visit.id, date: visit.date, closedAt: visit.closed_at, items: [] };
          byVisit.set(visit.id, entry);
        }
        for (const line of lines) entry.items.push(`Zob ${fdi}: ${line}`);
      }
      setEntries([...byVisit.values()]);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  return { entries, loading, error };
}
