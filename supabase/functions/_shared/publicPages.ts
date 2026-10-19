// Links to the patient-facing pages on GitHub Pages (docs/*.html — SMS and
// appointment confirm, questionnaire, unsubscribe, marketing consent).
//
// Every link carries this project's ref (?p=…), so the same static pages serve
// development and production: docs/backend.js turns it into the right
// *.supabase.co function URL, but only for projects on its allow-list.
// PUBLIC_PAGES_URL (secret, optional) points at another host for the pages,
// e.g. a practice's own domain later.
const PAGES_BASE = (Deno.env.get('PUBLIC_PAGES_URL') ?? 'https://grgor123.github.io/dental-chart').replace(/\/+$/, '');
const PROJECT_REF = new URL(Deno.env.get('SUPABASE_URL')!).hostname.split('.')[0];

/** e.g. publicPageUrl('sms-consent.html', token) */
export function publicPageUrl(page: string, token: string): string {
  return `${PAGES_BASE}/${page}?token=${encodeURIComponent(token)}&p=${PROJECT_REF}`;
}
