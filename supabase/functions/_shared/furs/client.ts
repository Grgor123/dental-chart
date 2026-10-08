// FURS (davčno potrjevanje računov) connection — shared by every function
// that talks to FURS. FURS requires the practice's own certificate on the
// TLS connection itself (mutual TLS), so requests go through a Deno
// HttpClient carrying that certificate and key.
//
// Secrets (supabase secrets set, never in the repo):
//   FURS_CERT_PEM_B64 / FURS_KEY_PEM_B64  — the certificate and its private
//     key as PEM, base64-encoded to one line (converted from the .p12 FURS
//     issues: openssl pkcs12 -clcerts -nokeys / -nocerts -nodes)
//   FURS_TAX_NUMBER                      — the tax number the certificate
//     was issued for (FURS checks every request against it)
//   FURS_ENV                             — 'test' or 'production'

import { SI_TRUST_ROOT } from './caCerts.ts';

export const FURS_ENV = Deno.env.get('FURS_ENV') === 'production' ? 'production' : 'test';

export const FURS_BASE_URL =
  FURS_ENV === 'production'
    ? 'https://blagajne.fu.gov.si:9003/v1/cash_registers'
    : 'https://blagajne-test.fu.gov.si:9002/v1/cash_registers';

function secretPem(name: string): string {
  const b64 = Deno.env.get(name);
  if (!b64) throw new Error(`Missing secret ${name}`);
  return atob(b64);
}

let client: Deno.HttpClient | null = null;

export function fursHttpClient(): Deno.HttpClient {
  client ??= Deno.createHttpClient({
    cert: secretPem('FURS_CERT_PEM_B64'),
    key: secretPem('FURS_KEY_PEM_B64'),
    // FURS's server certificates come from the Slovenian state CA.
    caCerts: [SI_TRUST_ROOT],
  });
  return client;
}

/** POST a JSON body to a FURS endpoint (e.g. 'echo', 'invoices'). */
export async function fursPost(path: string, body: unknown): Promise<{ status: number; json: unknown; text: string }> {
  const res = await fetch(`${FURS_BASE_URL}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body),
    client: fursHttpClient(),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // FURS answered with something that isn't JSON — returned as text.
  }
  return { status: res.status, json, text };
}
