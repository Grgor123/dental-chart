// Staff accounts (migration 036): shared by practice-users (invitations,
// roles, removal) and request-password-reset. Login links are made with the
// Supabase admin API (generateLink) and emailed through our own SES sender —
// Supabase's built-in auth mailer is rate-limited to a few emails an hour and
// sends from a generic address.
import type { SupabaseClient, User } from 'npm:@supabase/supabase-js@2';
import { resolveSenderIdentity, sendEmail } from './email/send.ts';
import { renderActionEmail } from './email/templates.ts';

/** Where links land: the published app, or a local dev server. Anything else
 *  in a request is ignored (it must also be in Supabase Auth's Redirect URLs). */
const APP_URL = Deno.env.get('APP_URL') ?? 'https://dental-chart.pages.dev';
const ALLOWED_ORIGINS = [APP_URL.replace(/\/$/, ''), 'http://localhost:5181'];
// Cloudflare preview deployments (e.g. https://dev.dental-chart.pages.dev for
// the dev branch) — subdomains of the app's own host.
const APP_HOST = new URL(APP_URL).hostname.replace(/\./g, '\\.');
const PREVIEW_ORIGIN = new RegExp(`^https://[a-z0-9-]+\\.${APP_HOST}$`);

export function redirectTarget(requested: unknown): string {
  if (typeof requested === 'string') {
    const origin = requested.replace(/\/$/, '');
    if (ALLOWED_ORIGINS.includes(origin) || PREVIEW_ORIGIN.test(origin)) return `${origin}/`;
  }
  return `${ALLOWED_ORIGINS[0]}/`;
}

export const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

/** The auth user with this address, if any (a practice has few users). */
export async function findUserByEmail(service: SupabaseClient, email: string): Promise<User | null> {
  const wanted = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const hit = data.users.find((u) => (u.email ?? '').toLowerCase() === wanted);
    if (hit) return hit;
    if (data.users.length < 1000) return null;
  }
  return null;
}

export type AccountEmailKind = 'invite' | 'reset';

/** Emails a login link, from the practice's sender identity. */
export async function sendAccountEmail(
  service: SupabaseClient,
  practiceId: string,
  to: string,
  kind: AccountEmailKind,
  link: string,
  inviterName?: string | null
): Promise<void> {
  const { data: practice, error } = await service
    .from('practices')
    .select('name, contact_email, email_sending_mode, custom_domain, custom_domain_sender_local_part, custom_domain_verified')
    .eq('id', practiceId)
    .single();
  if (error || !practice) throw new Error('Ordinacija ni bila najdena.');
  const sender = resolveSenderIdentity({
    name: practice.name,
    emailSendingMode: practice.email_sending_mode,
    customDomain: practice.custom_domain,
    customDomainSenderLocalPart: practice.custom_domain_sender_local_part,
    customDomainVerified: practice.custom_domain_verified,
  });
  const content =
    kind === 'invite'
      ? renderActionEmail({
          practiceName: practice.name,
          heading: `Vabilo v ${practice.name}`,
          message: `Pozdravljeni,\n\n${inviterName ? `${inviterName} vas vabi` : 'Vabljeni ste'}, da se pridružite ordinaciji **${practice.name}** v programu za zobno kartoteko, naročanje in račune.\n\nKliknite spodnji gumb in si nastavite geslo. Nato se prijavljate s tem e-poštnim naslovom (${to}).`,
          action: { label: 'Nastavite geslo', url: link },
          footnote: 'Povezava velja 24 ur. Če vabila niste pričakovali, to sporočilo prezrite.',
        })
      : renderActionEmail({
          practiceName: practice.name,
          heading: 'Nastavitev novega gesla',
          message: `Pozdravljeni,\n\nprejeli smo zahtevo za novo geslo za vaš račun (${to}).\n\nKliknite spodnji gumb in si nastavite novo geslo.`,
          action: { label: 'Nastavite novo geslo', url: link },
          footnote: 'Povezava velja 24 ur. Če gesla niste želeli spremeniti, to sporočilo prezrite — vaše geslo ostane nespremenjeno.',
        });
  await sendEmail({
    to,
    sender,
    replyTo: practice.contact_email,
    subject: kind === 'invite' ? `Vabilo v ${practice.name}` : `Novo geslo — ${practice.name}`,
    html: content.html,
  });
}
