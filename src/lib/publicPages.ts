// Links to the patient-facing pages on GitHub Pages (docs/*.html), the app's
// side of supabase/functions/_shared/publicPages.ts: every link carries this
// project's ref (?p=…) so docs/backend.js calls the right project.
export const PAGES_BASE = 'https://grgor123.github.io/dental-chart';
export const PROJECT_REF = new URL(import.meta.env.VITE_SUPABASE_URL as string).hostname.split('.')[0];

/** e.g. publicPageUrl('patient-consent.html', { token }) */
export function publicPageUrl(page: string, params: Record<string, string> = {}): string {
  const query = new URLSearchParams({ ...params, p: PROJECT_REF });
  return `${PAGES_BASE}/${page}?${query.toString()}`;
}
