import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// The practice's contact email (practices.contact_email) — the Reply-To of
// every automatic email, so patients' replies reach a real mailbox (the
// sending address obvestila@… has none). Set on the E-pošta page by owners
// through set_practice_contact_email() (migration 055; practices has no
// update policy). Also the daily report's default recipient.

export function usePracticeContactEmail() {
  const [email, setEmail] = useState('');
  // Suggested when empty: the email from Nastavitve → Podatki za račune.
  const [suggestion, setSuggestion] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const [p, i] = await Promise.all([
      supabase.from('practices').select('contact_email').maybeSingle(),
      supabase.from('invoice_settings').select('email').maybeSingle(),
    ]);
    setEmail((p.data?.contact_email as string | null | undefined) ?? '');
    setSuggestion((i.data?.email as string | null | undefined) ?? '');
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function save(next: string): Promise<{ error?: string }> {
    const { error } = await supabase.rpc('set_practice_contact_email', { p_email: next.trim() });
    await reload();
    return error ? { error: error.message } : {};
  }

  return { email, suggestion, loading, save };
}
