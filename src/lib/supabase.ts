import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase config: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env (see .env.example).',
  );
}

/** Read BEFORE the client is created (it consumes the URL fragment): did the
 *  app open from an invitation / password-reset link (migration 036), or
 *  from one that failed (expired, already used)? */
function readAuthLink(): { type: 'invite' | 'recovery' | null; error: string | null } {
  if (typeof window === 'undefined') return { type: null, error: null };
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const type = params.get('type');
  const error = params.get('error_code') ?? params.get('error');
  return { type: type === 'invite' || type === 'recovery' ? type : null, error };
}
export const AUTH_LINK = readAuthLink();

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
