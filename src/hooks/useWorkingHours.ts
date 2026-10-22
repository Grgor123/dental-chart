import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  minToTime,
  timeToMin,
  type Absence,
  type AbsenceReason,
  type DayPeriod,
  type Period,
  type Schedule,
  type WeeklyPeriod,
  type WeekParity,
} from '../lib/workingHours';

// Working hours of the whole team (migration 047): weekly templates, one-day
// edits and absences. Read by everyone (calendar, free-slot search), written
// by owners in Nastavitve → Ekipa (RLS). A small practice has few rows, so
// everything is loaded at once.

interface Rows {
  weekly: (WeeklyPeriod & { therapistId: string })[];
  days: (DayPeriod & { therapistId: string })[];
  absences: (Absence & { therapistId: string })[];
  alternating: Record<string, boolean>;
}

const EMPTY: Rows = { weekly: [], days: [], absences: [], alternating: {} };

export function useWorkingHours() {
  const [rows, setRows] = useState<Rows>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [w, d, a, t] = await Promise.all([
      supabase.from('therapist_hours').select('id, therapist_id, week_parity, weekday, start_time, end_time'),
      supabase.from('therapist_day_hours').select('id, therapist_id, date, start_time, end_time, note').order('date'),
      supabase.from('therapist_absences').select('id, therapist_id, date_from, date_to, reason, note').order('date_from'),
      supabase.from('therapists').select('id, alternating_weeks'),
    ]);
    // Before migration 047 the tables don't exist — the calendar keeps the default hours.
    const failed = w.error ?? d.error ?? a.error ?? t.error;
    if (failed) {
      setError(failed.message);
      return;
    }
    setError(null);
    setRows({
      weekly: (w.data ?? []).map((r) => ({
        id: r.id as string,
        therapistId: r.therapist_id as string,
        weekParity: r.week_parity as WeekParity,
        weekday: r.weekday as number,
        startMin: timeToMin(r.start_time as string),
        endMin: timeToMin(r.end_time as string),
      })),
      days: (d.data ?? []).map((r) => ({
        id: r.id as string,
        therapistId: r.therapist_id as string,
        date: r.date as string,
        startMin: timeToMin(r.start_time as string),
        endMin: timeToMin(r.end_time as string),
        note: (r.note as string | null) ?? null,
      })),
      absences: (a.data ?? []).map((r) => ({
        id: r.id as string,
        therapistId: r.therapist_id as string,
        dateFrom: r.date_from as string,
        dateTo: r.date_to as string,
        reason: r.reason as AbsenceReason,
        note: (r.note as string | null) ?? null,
      })),
      alternating: Object.fromEntries((t.data ?? []).map((r) => [r.id as string, Boolean(r.alternating_weeks)])),
    });
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const schedules = useMemo(() => {
    const map = new Map<string, Schedule>();
    const get = (id: string) => {
      let s = map.get(id);
      if (!s) {
        s = { alternatingWeeks: rows.alternating[id] ?? false, weekly: [], days: [], absences: [] };
        map.set(id, s);
      }
      return s;
    };
    for (const id of Object.keys(rows.alternating)) get(id);
    rows.weekly.forEach((r) => get(r.therapistId).weekly.push(r));
    rows.days.forEach((r) => get(r.therapistId).days.push(r));
    rows.absences.forEach((r) => get(r.therapistId).absences.push(r));
    return map;
  }, [rows]);

  /** Replaces a therapist's weekly hours (new rows first, then the old ones
   *  go — a failed insert never leaves them with none). */
  async function saveWeekly(therapistId: string, alternatingWeeks: boolean, periods: WeeklyPeriod[]): Promise<{ error?: string }> {
    const oldIds = rows.weekly.filter((r) => r.therapistId === therapistId).map((r) => r.id!);
    const { error: flagError } = await supabase.from('therapists').update({ alternating_weeks: alternatingWeeks }).eq('id', therapistId);
    if (flagError) return { error: flagError.message };
    if (periods.length > 0) {
      const { error: insertError } = await supabase.from('therapist_hours').insert(
        periods.map((p) => ({
          therapist_id: therapistId,
          week_parity: alternatingWeeks ? p.weekParity : 'all',
          weekday: p.weekday,
          start_time: minToTime(p.startMin),
          end_time: minToTime(p.endMin),
        }))
      );
      if (insertError) {
        await reload();
        return { error: insertError.message };
      }
    }
    if (oldIds.length > 0) await supabase.from('therapist_hours').delete().in('id', oldIds);
    await reload();
    return {};
  }

  /** Sets one date's own hours (replacing that date's earlier edit); no
   *  periods removes the edit, so the weekly hours apply again. */
  async function saveDay(therapistId: string, date: string, periods: Period[], note: string | null): Promise<{ error?: string }> {
    const oldIds = rows.days.filter((r) => r.therapistId === therapistId && r.date === date).map((r) => r.id);
    if (periods.length > 0) {
      const { error: insertError } = await supabase.from('therapist_day_hours').insert(
        periods.map((p) => ({
          therapist_id: therapistId,
          date,
          start_time: minToTime(p.startMin),
          end_time: minToTime(p.endMin),
          note: note?.trim() || null,
        }))
      );
      if (insertError) return { error: insertError.message };
    }
    if (oldIds.length > 0) await supabase.from('therapist_day_hours').delete().in('id', oldIds);
    await reload();
    return {};
  }

  async function addAbsence(therapistId: string, a: Omit<Absence, 'id'>): Promise<{ error?: string }> {
    const { error: insertError } = await supabase.from('therapist_absences').insert({
      therapist_id: therapistId,
      date_from: a.dateFrom,
      date_to: a.dateTo,
      reason: a.reason,
      note: a.note?.trim() || null,
    });
    await reload();
    return insertError ? { error: insertError.message } : {};
  }

  async function removeAbsence(id: string): Promise<{ error?: string }> {
    const { error: deleteError } = await supabase.from('therapist_absences').delete().eq('id', id);
    await reload();
    return deleteError ? { error: deleteError.message } : {};
  }

  return { schedules, error, reload, saveWeekly, saveDay, addAbsence, removeAbsence };
}
