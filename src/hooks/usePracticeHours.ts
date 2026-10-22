import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePracticeContext } from '../contexts/PracticeContext';
import { minToTime, timeToMin, type ClosedDay, type PracticeSchedule } from '../lib/workingHours';

// The clinic's working hours, closed days and the "no booking outside working
// hours" switch (migration 048) — Nastavitve → Delovni čas. Everyone reads
// (calendar), owners write (RLS). The database also enforces the clinic
// window on appointments (trigger check_appointment_hours).

export function usePracticeHours() {
  const { practiceId } = usePracticeContext();
  const [weekly, setWeekly] = useState<(PracticeSchedule['weekly'][number] & { id: string })[]>([]);
  const [closed, setClosed] = useState<ClosedDay[]>([]);
  const [blockOutsideHours, setBlock] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [h, c, s] = await Promise.all([
      supabase.from('practice_hours').select('id, weekday, start_time, end_time'),
      supabase.from('practice_closed_days').select('id, date_from, date_to, note').order('date_from'),
      supabase.from('practice_settings').select('block_outside_hours').maybeSingle(),
    ]);
    // Before migration 048 the tables don't exist — the calendar keeps its defaults.
    const failed = h.error ?? c.error ?? s.error;
    if (failed) {
      setError(failed.message);
      return;
    }
    setError(null);
    setWeekly(
      (h.data ?? []).map((r) => ({
        id: r.id as string,
        weekday: r.weekday as number,
        startMin: timeToMin(r.start_time as string),
        endMin: timeToMin(r.end_time as string),
      }))
    );
    setClosed(
      (c.data ?? []).map((r) => ({
        id: r.id as string,
        dateFrom: r.date_from as string,
        dateTo: r.date_to as string,
        note: (r.note as string | null) ?? null,
      }))
    );
    setBlock(Boolean(s.data?.block_outside_hours));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const practice: PracticeSchedule = useMemo(() => ({ weekly, closed, blockOutsideHours }), [weekly, closed, blockOutsideHours]);

  /** Replaces the weekly hours (new rows first, then the old ones go). */
  async function saveWeekly(periods: { weekday: number; startMin: number; endMin: number }[]): Promise<{ error?: string }> {
    if (!practiceId) return { error: 'Ordinacija ni bila najdena.' };
    const oldIds = weekly.map((w) => w.id);
    if (periods.length > 0) {
      const { error: insertError } = await supabase.from('practice_hours').insert(
        periods.map((p) => ({ practice_id: practiceId, weekday: p.weekday, start_time: minToTime(p.startMin), end_time: minToTime(p.endMin) }))
      );
      if (insertError) return { error: insertError.message };
    }
    if (oldIds.length > 0) await supabase.from('practice_hours').delete().in('id', oldIds);
    await reload();
    return {};
  }

  async function addClosed(day: Omit<ClosedDay, 'id'>): Promise<{ error?: string }> {
    if (!practiceId) return { error: 'Ordinacija ni bila najdena.' };
    const { error: insertError } = await supabase.from('practice_closed_days').insert({
      practice_id: practiceId,
      date_from: day.dateFrom,
      date_to: day.dateTo,
      note: day.note?.trim() || null,
    });
    await reload();
    return insertError ? { error: insertError.message } : {};
  }

  async function removeClosed(id: string): Promise<{ error?: string }> {
    const { error: deleteError } = await supabase.from('practice_closed_days').delete().eq('id', id);
    await reload();
    return deleteError ? { error: deleteError.message } : {};
  }

  async function setBlockOutsideHours(value: boolean): Promise<{ error?: string }> {
    if (!practiceId) return { error: 'Ordinacija ni bila najdena.' };
    const { error: upsertError } = await supabase
      .from('practice_settings')
      .upsert({ practice_id: practiceId, block_outside_hours: value, updated_at: new Date().toISOString() });
    await reload();
    return upsertError ? { error: upsertError.message } : {};
  }

  return { practice, error, saveWeekly, addClosed, removeClosed, setBlockOutsideHours };
}
