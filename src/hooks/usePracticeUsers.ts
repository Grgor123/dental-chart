import { useCallback, useEffect, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

// Nastavitve → Uporabniki (migration 036): the practice's users, through the
// practice-users Edge Function — a user can't read other members' rows or
// emails directly (practice_members RLS shows only your own row). Owners can
// invite, re-send, change roles and remove; the function checks the role.

export type PracticeRole = 'owner' | 'staff';

export interface PracticeUser {
  userId: string;
  email: string;
  fullName: string | null;
  role: PracticeRole;
  joinedAt: string;
  lastSignInAt: string | null;
  /** Invited, hasn't set a password / signed in yet. */
  pending: boolean;
}

interface ListResponse {
  callerId: string;
  callerRole: PracticeRole;
  users: PracticeUser[];
}

async function messageOf(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    const payload = await error.context.json().catch(() => null);
    if (payload?.error) return payload.error as string;
  }
  return error instanceof Error ? error.message : 'Napaka pri povezavi.';
}

export function usePracticeUsers() {
  const [users, setUsers] = useState<PracticeUser[]>([]);
  const [callerId, setCallerId] = useState<string | null>(null);
  // From the server's answer, not the app's sign-in state — the same check the
  // function applies to every owner-only action.
  const [callerRole, setCallerRole] = useState<PracticeRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(async (body: Record<string, unknown>): Promise<{ error?: string }> => {
    const { data, error: fnError } = await supabase.functions.invoke('practice-users', {
      body: { ...body, redirectTo: window.location.origin },
    });
    if (fnError) return { error: await messageOf(fnError) };
    const list = data as ListResponse;
    setUsers(list.users);
    setCallerId(list.callerId);
    setCallerRole(list.callerRole);
    return {};
  }, []);

  useEffect(() => {
    call({ action: 'list' }).then((result) => {
      setError(result.error ?? null);
      setLoading(false);
    });
  }, [call]);

  return {
    users,
    callerId,
    callerRole,
    loading,
    error,
    invite: (email: string, fullName: string, role: PracticeRole) => call({ action: 'invite', email, fullName, role }),
    resend: (userId: string) => call({ action: 'resend', userId }),
    setRole: (userId: string, role: PracticeRole) => call({ action: 'set_role', userId, role }),
    remove: (userId: string) => call({ action: 'remove', userId }),
  };
}
