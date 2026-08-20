import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthState {
  session: Session | null;
  loading: boolean;
}

export function useAuth() {
  const [{ session, loading }, setState] = useState<AuthState>({ session: null, loading: true });
  const [signInError, setSignInError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setState({ session: data.session, loading: false });
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ session, loading: false });
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  async function signIn(email: string, password: string) {
    setSignInError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setSignInError(error.message);
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return { session, loading, signIn, signOut, signInError };
}
