// FURS request signing: every request body is {"token": "<JWS>"}, a compact
// JWS signed RS256 with the certificate's private key. FURS's own answer comes
// back the same way. Its header names the signing certificate:
//   { "alg": "RS256", "subject_name": ..., "issuer_name": ..., "serial": <decimal> }
// Secrets: FURS_KEY_PEM_B64 (see client.ts), FURS_CERT_SUBJECT /
// FURS_CERT_ISSUER (RFC 2253, `openssl x509 -noout -subject -issuer
// -nameopt RFC2253`) and FURS_CERT_SERIAL (the serial in decimal).

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing secret ${name}`);
  return value;
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlFromText(text: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(text));
}

function bytesFromBase64Url(value: string): Uint8Array {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

let signingKey: Promise<CryptoKey> | null = null;

function privateKey(): Promise<CryptoKey> {
  signingKey ??= (() => {
    const pem = atob(requireEnv('FURS_KEY_PEM_B64'));
    const match = pem.match(/-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/);
    if (!match) throw new Error('FURS_KEY_PEM_B64 is not a PKCS#8 private key');
    const der = Uint8Array.from(atob(match[1].replace(/\s+/g, '')), (c) => c.charCodeAt(0));
    return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  })();
  return signingKey;
}

/** RSA-SHA256 signature of arbitrary bytes with the FURS key (also used for the ZOI). */
export async function rsaSha256Sign(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await privateKey(), data));
}

/** Compact JWS of `payload`, signed with the FURS certificate's key. */
export async function signFursJws(payload: unknown): Promise<string> {
  // Written by hand: the serial is far beyond Number.MAX_SAFE_INTEGER, so it
  // can't go through JSON.stringify as a number without losing digits.
  const serial = requireEnv('FURS_CERT_SERIAL');
  if (!/^\d+$/.test(serial)) throw new Error('FURS_CERT_SERIAL must be the decimal serial');
  const header =
    `{"alg":"RS256","subject_name":${JSON.stringify(requireEnv('FURS_CERT_SUBJECT'))},` +
    `"issuer_name":${JSON.stringify(requireEnv('FURS_CERT_ISSUER'))},"serial":${serial}}`;
  const signingInput = `${base64UrlFromText(header)}.${base64UrlFromText(JSON.stringify(payload))}`;
  const signature = await rsaSha256Sign(new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64UrlFromBytes(signature)}`;
}

/** The payload of FURS's JWS answer. (Its signature isn't verified — the
    answer arrives over the mutually authenticated TLS connection.) */
export function decodeFursJws(token: string): unknown {
  const part = token.split('.')[1];
  if (!part) throw new Error('FURS answer is not a JWS');
  return JSON.parse(new TextDecoder().decode(bytesFromBase64Url(part)));
}

/** "2026-10-08T21:30:05" — local Ljubljana time, the format FURS expects. */
export function fursDateTime(date = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Ljubljana',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
