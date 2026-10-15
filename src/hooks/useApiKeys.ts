import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePracticeContext } from '../contexts/PracticeContext';

// Inbound API keys (migration 042, Nastavitve → Integracije, owners only). A
// key is generated here in the browser, shown once, and only its SHA-256 hash
// and a short prefix are stored — the public-api Edge Function hashes what it
// receives and compares.

export type ApiScope = 'unsubscribe';

export const API_SCOPES: { key: ApiScope; label: string }[] = [
  { key: 'unsubscribe', label: 'Odjava od marketinga (nastavi soglasje na »ne«)' },
];

export const PUBLIC_API_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/public-api`;

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
  createdAt: string;
  lastUsedAt: string | null;
  useCount: number;
  revokedAt: string | null;
}

function newKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(40));
  return `dc_${Array.from(bytes, (b) => chars[b % chars.length]).join('')}`;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function useApiKeys() {
  const { practiceId } = usePracticeContext();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('api_keys')
      .select('id, name, prefix, scopes, created_at, last_used_at, use_count, revoked_at')
      .order('created_at', { ascending: false });
    if (fetchError) {
      setError(fetchError.message);
      return;
    }
    setError(null);
    setKeys(
      (data ?? []).map((row) => ({
        id: row.id as string,
        name: row.name as string,
        prefix: row.prefix as string,
        scopes: row.scopes as ApiScope[],
        createdAt: row.created_at as string,
        lastUsedAt: (row.last_used_at as string | null) ?? null,
        useCount: row.use_count as number,
        revokedAt: (row.revoked_at as string | null) ?? null,
      }))
    );
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  /** Returns the full key — the only time it is ever visible. */
  async function createKey(name: string, scopes: ApiScope[]): Promise<{ key?: string; error?: string }> {
    if (!practiceId) return { error: 'Ordinacija ni naložena.' };
    const key = newKey();
    const { error: insertError } = await supabase.from('api_keys').insert({
      practice_id: practiceId,
      name: name.trim(),
      prefix: key.slice(0, 10),
      key_hash: await sha256Hex(key),
      scopes,
    });
    if (insertError) return { error: insertError.message };
    await reload();
    return { key };
  }

  async function revokeKey(id: string): Promise<{ error?: string }> {
    const { error: updateError } = await supabase.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', id);
    if (updateError) return { error: updateError.message };
    await reload();
    return {};
  }

  return { keys, error, reload, createKey, revokeKey };
}
