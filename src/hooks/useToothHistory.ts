import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { SurfaceMap, EndoStage } from '../types/dental';

// One tooth_records row for this tooth, from one of this patient's visits —
// "everything ever done to it, in order," per CLAUDE.md's "Visit lifecycle"
// section ("Zgodovina zdravljenja"). Deliberately a much thinner slice than
// useVisit.ts's own Snapshot: pocket-depth/gum-margin/BOP are left out of
// this first pass (they're already visible live on the chart for the
// CURRENT visit; a clean historical rendering of six numbers per past visit
// is a reasonable follow-up, not required for this to be useful today).
export interface ToothHistoryEntry {
  visitId: string;
  /** visits.date — when this visit was opened. Only as accurate as closing itself: a visit that stayed open across several real calendar days (the common case before closing was wired up) still shows its FIRST day here. */
  date: string;
  /** Whether this entry belongs to the patient's current, still-open visit — lets the UI say "today (v teku)" instead of implying it's finished history. */
  closedAt: string | null;
  surfaces: SurfaceMap | null;
  post: boolean;
  endo: EndoStage | null;
  notes: string | null;
}

// Loads every recorded finding for ONE tooth across ALL of a patient's
// visits — no new table, just the schema's own existing shape (one
// tooth_records row per tooth PER VISIT), joined to that visit's own date/
// closed_at and ordered newest-first, same convention
// PatientPageMockup.tsx's own "Pretekli termini" already uses. Re-fetches
// whenever `fdi` changes — ToothDetailPanel.tsx remounts fresh per tooth
// anyway (`key={fdi}`), so this hook doesn't need to worry about stale data
// from a previously-viewed tooth bleeding into the next one.
//
// Every Supabase call lives here, not in ToothDetailPanel.tsx directly, per
// CLAUDE.md's own "Coding Conventions" rule.
export function useToothHistory(patientId: string, fdi: string) {
  const [entries, setEntries] = useState<ToothHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function load() {
      // visits!inner(...) — an INNER join, not a plain embed — is what lets
      // .eq('visits.patient_id', ...) actually filter rows (a plain left
      // embed would filter the embedded visits object but still return
      // every tooth_records row regardless of whose patient it belongs to).
      const { data, error: fetchError } = await supabase
        .from('tooth_records')
        .select('surfaces, post, endo, notes, visits!inner(id, date, closed_at, patient_id)')
        .eq('tooth_id', fdi)
        .eq('visits.patient_id', patientId)
        .order('date', { foreignTable: 'visits', ascending: false });
      if (cancelled) return;
      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }
      const next: ToothHistoryEntry[] = (data ?? []).map((row) => {
        // supabase-js embeds a many-to-one relationship (many tooth_records
        // rows -> one visit) as a single object, not an array — `visits`
        // here is genuinely one visit, not a list.
        const visit = row.visits as unknown as { id: string; date: string; closed_at: string | null };
        return {
          visitId: visit.id,
          date: visit.date,
          closedAt: visit.closed_at,
          surfaces: row.surfaces && Object.keys(row.surfaces).length > 0 ? (row.surfaces as SurfaceMap) : null,
          post: !!row.post,
          endo: (row.endo as EndoStage | null) ?? null,
          notes: (row.notes as string | null) ?? null,
        };
      });
      setEntries(next);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [patientId, fdi]);

  return { entries, loading, error };
}
