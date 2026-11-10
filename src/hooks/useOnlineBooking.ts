import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePracticeContext } from '../contexts/PracticeContext';

// Online booking settings and visit types (migration 050) — Nastavitve →
// Spletno naročanje. Everyone reads, owners write (RLS). The form itself is
// docs/online-booking.html + the public Edge Function `online-booking`.

export interface OnlineBookingSettings {
  enabled: boolean;
  publicKey: string | null; // null until the settings row exists
  bookingWindowDays: number;
  minNoticeHours: number;
  slotStepMinutes: number;
  consentText: string;
  privacyPolicyUrl: string;
  phone: string;
}

export interface OnlineVisitType {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  active: boolean;
  sortOrder: number;
  /** Who offers it; empty = every bookable team member. */
  therapistIds: string[];
}

export const DEFAULT_SETTINGS: OnlineBookingSettings = {
  enabled: false,
  publicKey: null,
  bookingWindowDays: 28,
  minNoticeHours: 24,
  slotStepMinutes: 15,
  consentText: '',
  privacyPolicyUrl: '',
  phone: '',
};

export const DEFAULT_CONSENT_TEXT =
  'Strinjam se, da {ordinacija} shrani moje podatke v skladu z izjavo o zasebnosti in jih uporablja za obveščanje o terminih in komunikacijo, povezano z obiskom.';

const SETTINGS_COLUMNS: Record<Exclude<keyof OnlineBookingSettings, 'publicKey'>, string> = {
  enabled: 'enabled',
  bookingWindowDays: 'booking_window_days',
  minNoticeHours: 'min_notice_hours',
  slotStepMinutes: 'slot_step_minutes',
  consentText: 'consent_text',
  privacyPolicyUrl: 'privacy_policy_url',
  phone: 'phone',
};

export function useOnlineBooking() {
  const { practiceId } = usePracticeContext();
  const [settings, setSettings] = useState<OnlineBookingSettings>(DEFAULT_SETTINGS);
  const [visitTypes, setVisitTypes] = useState<OnlineVisitType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [s, v, l] = await Promise.all([
      supabase.from('online_booking_settings').select('*').maybeSingle(),
      supabase.from('online_visit_types').select('id, name, description, duration_minutes, active, sort_order').order('sort_order').order('name'),
      supabase.from('online_visit_type_therapists').select('visit_type_id, therapist_id'),
    ]);
    setLoading(false);
    // Before migration 050 the tables don't exist.
    const failed = s.error ?? v.error ?? l.error;
    if (failed) {
      setError(failed.message);
      return;
    }
    setError(null);
    const row = s.data as Record<string, unknown> | null;
    setSettings(
      row
        ? {
            enabled: Boolean(row.enabled),
            publicKey: row.public_key as string,
            bookingWindowDays: row.booking_window_days as number,
            minNoticeHours: row.min_notice_hours as number,
            slotStepMinutes: row.slot_step_minutes as number,
            consentText: (row.consent_text as string | null) ?? '',
            privacyPolicyUrl: (row.privacy_policy_url as string | null) ?? '',
            phone: (row.phone as string | null) ?? '',
          }
        : DEFAULT_SETTINGS
    );
    const links = l.data ?? [];
    setVisitTypes(
      (v.data ?? []).map((r) => ({
        id: r.id as string,
        name: r.name as string,
        description: (r.description as string | null) ?? '',
        durationMinutes: r.duration_minutes as number,
        active: Boolean(r.active),
        sortOrder: r.sort_order as number,
        therapistIds: links.filter((x) => x.visit_type_id === r.id).map((x) => x.therapist_id as string),
      }))
    );
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  /** Saves some settings, creating the practice's row (and its embed key) on first save. */
  async function saveSettings(fields: Partial<Omit<OnlineBookingSettings, 'publicKey'>>): Promise<{ error?: string }> {
    if (!practiceId) return { error: 'Ordinacija ni bila najdena.' };
    const values: Record<string, unknown> = { practice_id: practiceId, updated_at: new Date().toISOString() };
    for (const [key, value] of Object.entries(fields) as [keyof typeof SETTINGS_COLUMNS, unknown][]) {
      values[SETTINGS_COLUMNS[key]] = typeof value === 'string' ? value.trim() || null : value;
    }
    const { error: saveError } = await supabase.from('online_booking_settings').upsert(values, { onConflict: 'practice_id' });
    await reload();
    return saveError ? { error: saveError.message } : {};
  }

  async function createVisitType(): Promise<{ error?: string }> {
    if (!practiceId) return { error: 'Ordinacija ni bila najdena.' };
    const sortOrder = Math.max(0, ...visitTypes.map((v) => v.sortOrder)) + 10;
    const { error: insertError } = await supabase
      .from('online_visit_types')
      .insert({ practice_id: practiceId, name: 'Nova vrsta obiska', duration_minutes: 30, sort_order: sortOrder });
    await reload();
    return insertError ? { error: insertError.message } : {};
  }

  async function updateVisitType(
    id: string,
    fields: Partial<Pick<OnlineVisitType, 'name' | 'description' | 'durationMinutes' | 'active' | 'sortOrder'>>
  ): Promise<{ error?: string }> {
    const values: Record<string, unknown> = {};
    if (fields.name !== undefined) values.name = fields.name.trim();
    if (fields.description !== undefined) values.description = fields.description.trim() || null;
    if (fields.durationMinutes !== undefined) values.duration_minutes = fields.durationMinutes;
    if (fields.active !== undefined) values.active = fields.active;
    if (fields.sortOrder !== undefined) values.sort_order = fields.sortOrder;
    const { error: updateError } = await supabase.from('online_visit_types').update(values).eq('id', id);
    await reload();
    return updateError ? { error: updateError.message } : {};
  }

  /** Swaps the order of two neighbouring visit types. */
  async function moveVisitType(id: string, direction: -1 | 1): Promise<{ error?: string }> {
    const index = visitTypes.findIndex((v) => v.id === id);
    const other = visitTypes[index + direction];
    if (index < 0 || !other) return {};
    const a = visitTypes[index];
    // Distinct numbers even if both had the same sort_order.
    const [first, second] = direction === -1 ? [a, other] : [other, a];
    const base = Math.min(a.sortOrder, other.sortOrder);
    const r1 = await supabase.from('online_visit_types').update({ sort_order: base }).eq('id', first.id);
    const r2 = await supabase.from('online_visit_types').update({ sort_order: base + 1 }).eq('id', second.id);
    await reload();
    return r1.error || r2.error ? { error: (r1.error ?? r2.error)!.message } : {};
  }

  async function deleteVisitType(id: string): Promise<{ error?: string }> {
    const { error: deleteError } = await supabase.from('online_visit_types').delete().eq('id', id);
    await reload();
    return deleteError ? { error: deleteError.message } : {};
  }

  /** Replaces who offers a visit type (empty = everyone). */
  async function setVisitTypeTherapists(id: string, therapistIds: string[]): Promise<{ error?: string }> {
    if (!practiceId) return { error: 'Ordinacija ni bila najdena.' };
    const current = visitTypes.find((v) => v.id === id)?.therapistIds ?? [];
    const toAdd = therapistIds.filter((t) => !current.includes(t));
    const toRemove = current.filter((t) => !therapistIds.includes(t));
    if (toAdd.length > 0) {
      const { error: insertError } = await supabase
        .from('online_visit_type_therapists')
        .insert(toAdd.map((therapistId) => ({ visit_type_id: id, therapist_id: therapistId, practice_id: practiceId })));
      if (insertError) {
        await reload();
        return { error: insertError.message };
      }
    }
    if (toRemove.length > 0) {
      const { error: deleteError } = await supabase
        .from('online_visit_type_therapists')
        .delete()
        .eq('visit_type_id', id)
        .in('therapist_id', toRemove);
      if (deleteError) {
        await reload();
        return { error: deleteError.message };
      }
    }
    await reload();
    return {};
  }

  return {
    settings,
    visitTypes,
    loading,
    error,
    saveSettings,
    createVisitType,
    updateVisitType,
    moveVisitType,
    deleteVisitType,
    setVisitTypeTherapists,
  };
}
