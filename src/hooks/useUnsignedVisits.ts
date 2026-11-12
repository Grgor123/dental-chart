import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// Closed visits from the last 30 days that have entries but no signature yet
// (migration 056) — the patient list's "Nepodpisani obiski" reminder. Older
// ones still show as "Nepodpisano" in each patient's Frame 8; the list keeps
// to recent work so the history from before signing existed doesn't flood it.
export interface UnsignedVisit {
  visitId: string;
  patientId: string;
  date: string;
}

const DAYS_BACK = 30;

export function useUnsignedVisits() {
  const [visits, setVisits] = useState<UnsignedVisit[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const since = new Date(Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('visits')
        .select('id, patient_id, date, notes, tooth_records(count)')
        .is('signed_at', null)
        .not('closed_at', 'is', null)
        .gte('closed_at', since)
        .order('date', { ascending: false });
      if (cancelled || error) return;
      setVisits(
        (data ?? [])
          .filter((v) => {
            const count = (v.tooth_records as unknown as { count: number }[] | null)?.[0]?.count ?? 0;
            return count > 0 || (v.notes ?? '').trim() !== '';
          })
          .map((v) => ({ visitId: v.id, patientId: v.patient_id, date: v.date }))
      );
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return visits;
}
