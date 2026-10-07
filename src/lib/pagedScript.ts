// The Paged.js polyfill (npm "pagedjs"), as source text to inline into the
// A4 invoice document (supabase/functions/_shared/invoice/render.ts): it lays
// the invoice out as real A4 sheets — header and footer repeated on every
// page, "2/3" page numbers — identically in the on-screen preview and in
// print. ~500 KB, so it's loaded only when an invoice is opened. Imported by
// path: the package's "exports" field doesn't expose this file.
let cached: Promise<string> | null = null;

export function loadPagedScript(): Promise<string> {
  cached ??= import('../../node_modules/pagedjs/dist/paged.polyfill.min.js?raw').then((m) => m.default);
  return cached;
}
