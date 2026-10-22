import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePracticeContext } from '../contexts/PracticeContext';

// Terapevti — the practice's team (migrations 014, 046), managed in
// Nastavitve → Ekipa (owners only, enforced by RLS). Like patients, a
// therapist has no parent row to derive practice_id from, so it's set
// explicitly on insert from usePracticeContext(). Archived, never deleted:
// appointments and patients keep pointing at former team members.
export type TherapistKind = 'dentist' | 'specialist' | 'hygienist' | 'assistant';

export const THERAPIST_KIND_LABELS: Record<TherapistKind, string> = {
  dentist: 'Zobozdravnik',
  specialist: 'Specialist',
  hygienist: 'Ustni higienik',
  assistant: 'Asistent / sestra',
};

// Fixed palette rather than a raw color picker — keeps therapist colors
// distinct from each other and from the app's own accent/status colors. The
// first four match the approved calendar mockup.
export const THERAPIST_COLORS = ['#57d974', '#5ce1e6', '#eece9a', '#ff914d', '#9C6ADE', '#4C7093', '#B3261E', '#607D8B'];

/** Kinds that get their own calendar column and can be booked. Assistants
 *  come into the calendar with room/assistant booking (roadmap item 5). */
export function isBookable(t: Therapist): boolean {
  return t.kind !== 'assistant';
}

export interface Therapist {
  id: string;
  name: string;
  color: string;
  title: string | null;
  kind: TherapistKind;
  userId: string | null;
  roomId: string | null;
  sortOrder: number;
  archived: boolean;
}

export type TherapistFields = Partial<Omit<Therapist, 'id' | 'archived'>>;

const THERAPIST_COLUMNS = 'id, name, color, title, kind, user_id, room_id, sort_order, archived_at';

function rowToTherapist(row: Record<string, unknown>): Therapist {
  return {
    id: row.id as string,
    name: row.name as string,
    color: row.color as string,
    title: (row.title as string | null) ?? null,
    kind: ((row.kind as TherapistKind | null) ?? 'dentist'),
    userId: (row.user_id as string | null) ?? null,
    roomId: (row.room_id as string | null) ?? null,
    sortOrder: (row.sort_order as number | null) ?? 0,
    archived: row.archived_at != null,
  };
}

function toColumns(fields: TherapistFields): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  if (fields.name !== undefined) columns.name = fields.name.trim();
  if (fields.color !== undefined) columns.color = fields.color;
  if (fields.title !== undefined) columns.title = fields.title?.trim() || null;
  if (fields.kind !== undefined) columns.kind = fields.kind;
  if (fields.userId !== undefined) columns.user_id = fields.userId;
  if (fields.roomId !== undefined) columns.room_id = fields.roomId;
  if (fields.sortOrder !== undefined) columns.sort_order = fields.sortOrder;
  return columns;
}

/** "dr. Ana Novak" — title + name, for lists and the patient record. */
export function therapistLabel(t: Pick<Therapist, 'name' | 'title'>): string {
  return t.title ? `${t.title} ${t.name}` : t.name;
}

// Loads every therapist of the signed-in user's practice, archived ones too
// (callers filter) — RLS restricts rows to current_practice_id().
export function useTherapists() {
  const { practiceId } = usePracticeContext();
  const [therapists, setTherapists] = useState<Therapist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from('therapists')
      .select(THERAPIST_COLUMNS)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setTherapists((data ?? []).map(rowToTherapist));
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const createTherapist = useCallback(
    async (fields: TherapistFields & { name: string }): Promise<{ id: string } | { error: string }> => {
      if (!practiceId) return { error: 'Ordinacija ni bila najdena — poskusite znova po ponovni prijavi.' };
      const { data, error } = await supabase
        .from('therapists')
        .insert({ practice_id: practiceId, ...toColumns(fields) })
        .select('id')
        .single();
      if (error) return { error: error.message };
      await reload();
      return { id: data.id as string };
    },
    [reload, practiceId]
  );

  const updateTherapist = useCallback(
    async (id: string, fields: TherapistFields): Promise<{ error?: string }> => {
      const { error } = await supabase.from('therapists').update(toColumns(fields)).eq('id', id);
      if (error) {
        await reload();
        return { error: error.message };
      }
      await reload();
      return {};
    },
    [reload]
  );

  const setArchived = useCallback(
    async (id: string, archived: boolean): Promise<{ error?: string }> => {
      const { error } = await supabase
        .from('therapists')
        .update({ archived_at: archived ? new Date().toISOString() : null })
        .eq('id', id);
      await reload();
      return error ? { error: error.message } : {};
    },
    [reload]
  );

  return { therapists, loading, error, createTherapist, updateTherapist, setArchived };
}
