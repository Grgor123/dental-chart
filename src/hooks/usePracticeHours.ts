import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePracticeContext } from '../contexts/PracticeContext';
import { minToTime, timeToMin, type ClosedDay, type PracticeSchedule } from '../lib/workingHours';

// The clinic's working hours, closed days and the "no booking outside working
// hours" switch (migration 048) — Nastavitve → Delovni čas. Everyone reads
// (calendar), owners write (RLS). The database also enforces the clinic
// window on appointments (trigger check_appointment_hours).

/** Offered until a clinic sets its own (migration 051). */
export const DEFAULT_APPOINTMENT_DURATIONS = [15, 30, 45, 60, 90, 120, 180];

/** The clinic's durations plus the one currently set (an existing
 *  appointment may have another length), sorted. */
export function durationOptions(durations: number[], current?: number): number[] {
  return [...new Set(current ? [...durations, current] : durations)].sort((a, b) => a - b);
}

export function usePracticeHours() {
  const { practiceId } = usePracticeContext();
  const [weekly, setWeekly] = useState<(PracticeSchedule['weekly'][number] & { id: string })[]>([]);
  const [closed, setClosed] = useState<ClosedDay[]>([]);
  const [blockOutsideHours, setBlock] = useState(false);
  const [durations, setDurationsState] = useState<number[]>(DEFAULT_APPOINTMENT_DURATIONS);
  // Daily confirmation report (migration 054): on/off, recipient, and the
  // practice's contact email it falls back to.
  const [report, setReport] = useState<{ enabled: boolean; email: string; fallbackEmail: string }>({
    enabled: true,
    email: '',
    fallbackEmail: '',
  });
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [h, c, s] = await Promise.all([
      supabase.from('practice_hours').select('id, weekday, start_time, end_time'),
      supabase.from('practice_closed_days').select('id, date_from, date_to, note, repeat_yearly').order('date_from'),
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
        repeatYearly: Boolean(r.repeat_yearly),
      }))
    );
    setBlock(Boolean(s.data?.block_outside_hours));
    // Separate query: before migration 051 the column doesn't exist, and the
    // rest of the hours must still load.
    const d = await supabase.from('practice_settings').select('appointment_durations').maybeSingle();
    const list = (d.data?.appointment_durations as number[] | null | undefined) ?? null;
    setDurationsState(!d.error && list && list.length > 0 ? [...list].sort((a, b) => a - b) : DEFAULT_APPOINTMENT_DURATIONS);
    const [r, p] = await Promise.all([
      supabase.from('practice_settings').select('reminder_report_enabled, reminder_report_email').maybeSingle(),
      supabase.from('practices').select('contact_email').maybeSingle(),
    ]);
    setReport({
      enabled: r.error ? true : ((r.data?.reminder_report_enabled as boolean | undefined) ?? true),
      email: r.error ? '' : ((r.data?.reminder_report_email as string | null | undefined) ?? ''),
      fallbackEmail: (p.data?.contact_email as string | null | undefined) ?? '',
    });
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
      repeat_yearly: day.repeatYearly,
    });
    await reload();
    return insertError ? { error: insertError.message } : {};
  }

  /** Adds several closed days at once ("Dodaj slovenske praznike"). */
  async function addClosedMany(days: Omit<ClosedDay, 'id'>[]): Promise<{ error?: string }> {
    if (!practiceId) return { error: 'Ordinacija ni bila najdena.' };
    if (days.length === 0) return {};
    const { error: insertError } = await supabase.from('practice_closed_days').insert(
      days.map((day) => ({
        practice_id: practiceId,
        date_from: day.dateFrom,
        date_to: day.dateTo,
        note: day.note?.trim() || null,
        repeat_yearly: day.repeatYearly,
      }))
    );
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

  /** Saves the clinic's appointment durations (null = back to the defaults). */
  async function setDurations(list: number[] | null): Promise<{ error?: string }> {
    if (!practiceId) return { error: 'Ordinacija ni bila najdena.' };
    const value = list ? [...new Set(list)].sort((a, b) => a - b) : null;
    const { error: upsertError } = await supabase
      .from('practice_settings')
      .upsert({ practice_id: practiceId, appointment_durations: value, updated_at: new Date().toISOString() });
    await reload();
    return upsertError ? { error: upsertError.message } : {};
  }

  /** Saves the daily confirmation report's on/off and recipient ('' = contact email). */
  async function saveReport(fields: { enabled?: boolean; email?: string }): Promise<{ error?: string }> {
    if (!practiceId) return { error: 'Ordinacija ni bila najdena.' };
    const values: Record<string, unknown> = { practice_id: practiceId, updated_at: new Date().toISOString() };
    if (fields.enabled !== undefined) values.reminder_report_enabled = fields.enabled;
    if (fields.email !== undefined) values.reminder_report_email = fields.email.trim() || null;
    const { error: upsertError } = await supabase.from('practice_settings').upsert(values);
    await reload();
    return upsertError ? { error: upsertError.message } : {};
  }

  /** Sends the report for the day after tomorrow right now (send-reminder-report). */
  async function sendReportNow(): Promise<{ sent?: boolean; message?: string; error?: string }> {
    const { data, error: invokeError } = await supabase.functions.invoke('send-reminder-report', { body: {} });
    if (invokeError) return { error: invokeError.message };
    const result = data as { sent?: boolean; message?: string; error?: string } | null;
    return result ?? { error: 'Ni odgovora.' };
  }

  return {
    practice,
    durations,
    report,
    error,
    saveWeekly,
    addClosed,
    addClosedMany,
    removeClosed,
    setBlockOutsideHours,
    setDurations,
    saveReport,
    sendReportNow,
  };
}
