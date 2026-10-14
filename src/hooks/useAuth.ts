import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AUTH_LINK, supabase } from '../lib/supabase';

interface AuthState {
  session: Session | null;
  loading: boolean;
}

// Supabase's own English messages for the cases people actually hit.
function friendlySignInError(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'Napačen e-poštni naslov ali geslo.';
  if (/banned/i.test(message)) return 'Ta račun je onemogočen. Obrnite se na lastnika ordinacije.';
  if (/email not confirmed/i.test(message)) return 'Račun še ni aktiviran — uporabite povezavo iz vabila.';
  return message;
}

export function useAuth() {
  const [{ session, loading }, setState] = useState<AuthState>({ session: null, loading: true });
  const [signInError, setSignInError] = useState<string | null>(null);
  // Opened from an invitation / reset link (migration 036): the link signs the
  // person in, and they must choose a password before using the app.
  const [mustSetPassword, setMustSetPassword] = useState(AUTH_LINK.type !== null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setState({ session: data.session, loading: false });
      // A link that didn't sign anyone in (expired, used) — a normal login
      // afterwards mustn't be sent to "Nastavite geslo".
      if (!data.session) setMustSetPassword(false);
      // The client has read the link by now (getSession waits for that) —
      // its details shouldn't stay in the address bar.
      if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setMustSetPassword(true);
      setState({ session, loading: false });
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string) {
    setSignInError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setSignInError(friendlySignInError(error.message));
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  async function setPassword(password: string): Promise<{ error?: string }> {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      return { error: /should be different/i.test(error.message) ? 'Novo geslo mora biti drugačno od starega.' : error.message };
    }
    setMustSetPassword(false);
    return {};
  }

  /** "Pozabljeno geslo?" — always reports success (never reveals whether the
      address has an account); the function emails a link if it does. */
  async function requestPasswordReset(email: string): Promise<{ error?: string }> {
    const { error } = await supabase.functions.invoke('request-password-reset', {
      body: { email, redirectTo: window.location.origin },
    });
    return error ? { error: 'Zahteve ni bilo mogoče poslati. Poskusite znova.' } : {};
  }

  return {
    session,
    loading,
    signIn,
    signOut,
    signInError,
    mustSetPassword,
    setPassword,
    requestPasswordReset,
    /** The link the app opened from was expired or already used. */
    authLinkError: AUTH_LINK.error,
  };
}
