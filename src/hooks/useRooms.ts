import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePracticeContext } from '../contexts/PracticeContext';

// Ordinacije — rooms/chairs inside one clinic (migration 046), managed in
// Nastavitve → Ekipa (owners only, enforced by RLS). Archived, never deleted.
export interface Room {
  id: string;
  name: string;
  sortOrder: number;
  archived: boolean;
}

export function useRooms() {
  const { practiceId } = usePracticeContext();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from('rooms')
      .select('id, name, sort_order, archived_at')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (error) {
      setError(error.message);
      return;
    }
    setError(null);
    setRooms(
      (data ?? []).map((r) => ({
        id: r.id as string,
        name: r.name as string,
        sortOrder: (r.sort_order as number | null) ?? 0,
        archived: r.archived_at != null,
      }))
    );
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function createRoom(name: string): Promise<{ error?: string }> {
    if (!practiceId) return { error: 'Ordinacija ni bila najdena.' };
    const nextOrder = rooms.reduce((max, r) => Math.max(max, r.sortOrder), 0) + 1;
    const { error } = await supabase.from('rooms').insert({ practice_id: practiceId, name: name.trim(), sort_order: nextOrder });
    await reload();
    return error ? { error: error.message } : {};
  }

  async function renameRoom(id: string, name: string): Promise<{ error?: string }> {
    const { error } = await supabase.from('rooms').update({ name: name.trim() }).eq('id', id);
    await reload();
    return error ? { error: error.message } : {};
  }

  async function setRoomArchived(id: string, archived: boolean): Promise<{ error?: string }> {
    const { error } = await supabase
      .from('rooms')
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq('id', id);
    await reload();
    return error ? { error: error.message } : {};
  }

  return { rooms, error, createRoom, renameRoom, setRoomArchived };
}
