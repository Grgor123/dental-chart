// The appointment's "Pridem / Ne pridem" token (migration 052), shared by the
// reminder email and the SMS reminder: whichever goes out first creates it,
// the other reuses it, so both links lead to the same answer.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { publicPageUrl } from './publicPages.ts';

// 10 characters, like the original SMS tokens — keeps the SMS in one segment.
function randomToken(length = 10): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/** The appointment's token, created if it has none yet; null if it can't be stored. */
export async function ensureConfirmToken(supabase: SupabaseClient, appointmentId: string): Promise<string | null> {
  const { data } = await supabase.from('appointments').select('confirm_token').eq('id', appointmentId).maybeSingle();
  if (data?.confirm_token) return data.confirm_token as string;
  // `is null`: two senders at once can't overwrite each other's token.
  await supabase.from('appointments').update({ confirm_token: randomToken() }).eq('id', appointmentId).is('confirm_token', null);
  const { data: again } = await supabase.from('appointments').select('confirm_token').eq('id', appointmentId).maybeSingle();
  return (again?.confirm_token as string | null) ?? null;
}

export function confirmPageUrl(token: string): string {
  return publicPageUrl('appointment-confirm.html', token);
}
