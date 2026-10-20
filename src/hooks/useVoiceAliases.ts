import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePracticeContext } from '../contexts/PracticeContext';
import { aliasKey } from '../lib/voice/parseVoiceCommand';

// The practice's taught voice words (migration 045): a misheard word → what it
// means. Shared by everyone in the practice; read once per chart page.

export interface VoiceAlias {
  id: string;
  heard: string;
  meaning: string;
}

export function useVoiceAliases() {
  const { practiceId } = usePracticeContext();
  const [aliases, setAliases] = useState<VoiceAlias[]>([]);

  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('voice_aliases').select('id, heard, meaning').order('heard');
    // Before migration 045 the table doesn't exist — voice entry works without it.
    if (!error) setAliases((data ?? []) as VoiceAlias[]);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const map = useMemo(() => Object.fromEntries(aliases.map((a) => [a.heard, a.meaning])), [aliases]);

  /** Saves (or replaces) a taught word; returns the updated map for immediate use. */
  async function teach(heard: string, meaning: string): Promise<{ map?: Record<string, string>; error?: string }> {
    if (!practiceId) return { error: 'Ordinacija ni naložena.' };
    const key = aliasKey(heard);
    if (!key) return { error: 'Prazna beseda.' };
    const { error } = await supabase
      .from('voice_aliases')
      .upsert({ practice_id: practiceId, heard: key, meaning }, { onConflict: 'practice_id,heard' });
    if (error) return { error: error.message };
    await reload();
    return { map: { ...map, [key]: meaning } };
  }

  async function forget(id: string): Promise<void> {
    await supabase.from('voice_aliases').delete().eq('id', id);
    await reload();
  }

  return { aliases, map, teach, forget };
}
