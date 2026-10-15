// Outbound webhook bodies (migrations 037–038) — pure TS, no Deno APIs, so the
// deliver-webhooks Edge Function AND the Integracije editor (preview,
// validation) build bodies with the same code, like templateDefs.ts.
//
// A webhook either sends the standard body (body_template null) or the
// practice's own JSON with {placeholders}:
//   - a string that is exactly one placeholder ("{tags}", "{marketing_consent}")
//     becomes the raw value — an array, a boolean, null …;
//   - inside a longer string a placeholder is replaced by its text
//     ("Pacient {full_name}"); an unknown {name} is left as typed.
// Keys and fixed values are the practice's own, so any receiving app's format
// can be matched.

export type WebhookEventKey = 'consent_granted' | 'consent_withdrawn';

export const WEBHOOK_EVENTS: { key: WebhookEventKey; label: string }[] = [
  { key: 'consent_granted', label: 'Soglasje za obveščanje dano' },
  { key: 'consent_withdrawn', label: 'Soglasje za obveščanje preklicano' },
];

export interface WebhookValues {
  event: string;
  event_id: string;
  occurred_at: string;
  practice: string;
  source: string;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  tags: string[];
  marketing_consent: boolean;
  marketing_consent_at: string | null;
}

export const WEBHOOK_PLACEHOLDERS: { key: keyof WebhookValues; label: string }[] = [
  { key: 'event', label: 'dogodek (consent_granted / consent_withdrawn / test)' },
  { key: 'email', label: 'e-pošta' },
  { key: 'first_name', label: 'ime (prazno pri preklicu)' },
  { key: 'last_name', label: 'priimek (prazno pri preklicu)' },
  { key: 'full_name', label: 'ime in priimek (prazno pri preklicu)' },
  { key: 'phone', label: 'telefon (E.164)' },
  { key: 'marketing_consent', label: 'soglasje (true / false)' },
  { key: 'marketing_consent_at', label: 'čas soglasja ali preklica' },
  { key: 'tags', label: 'oznake (seznam, zaenkrat prazen)' },
  { key: 'practice', label: 'ime ordinacije' },
  { key: 'occurred_at', label: 'čas pošiljanja' },
  { key: 'event_id', label: 'ID dogodka (enak pri ponovnih poskusih)' },
  { key: 'source', label: 'vir (trigger / backfill / test)' },
];

/** Example values — the editor's preview and the "Pošlji testni dogodek" body. */
export function sampleWebhookValues(eventId: string, practice: string): WebhookValues {
  const now = new Date().toISOString();
  return {
    event: 'test',
    event_id: eventId,
    occurred_at: now,
    practice,
    source: 'test',
    email: 'test@example.com',
    phone: '+38640000000',
    first_name: 'Testni',
    last_name: 'Pacient',
    full_name: 'Testni Pacient',
    tags: [],
    marketing_consent: true,
    marketing_consent_at: now,
  };
}

export function standardWebhookBody(v: WebhookValues): Record<string, unknown> {
  return {
    event: v.event,
    event_id: v.event_id,
    occurred_at: v.occurred_at,
    practice: v.practice,
    source: v.source,
    email: v.email,
    first_name: v.first_name,
    last_name: v.last_name,
    phone: v.phone,
    tags: v.tags,
    tag: null,
    marketing_consent: v.marketing_consent,
    marketing_consent_at: v.marketing_consent_at,
  };
}

const ONLY_PLACEHOLDER = /^\{([a-z_]+)\}$/;
const ANY_PLACEHOLDER = /\{([a-z_]+)\}/g;

function fill(node: unknown, v: WebhookValues): unknown {
  if (typeof node === 'string') {
    const only = node.match(ONLY_PLACEHOLDER);
    if (only && only[1] in v) return v[only[1] as keyof WebhookValues];
    return node.replace(ANY_PLACEHOLDER, (whole, key: string) => {
      if (!(key in v)) return whole;
      const value = v[key as keyof WebhookValues];
      if (value === null) return '';
      return Array.isArray(value) ? value.join(', ') : String(value);
    });
  }
  if (Array.isArray(node)) return node.map((item) => fill(item, v));
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([k, item]) => [k, fill(item, v)]));
  }
  return node;
}

/** null when the template is fine, otherwise a Slovene error for the editor. */
export function templateError(template: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(template);
  } catch (e) {
    return `Ni veljaven JSON: ${e instanceof Error ? e.message : e}`;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'Telo mora biti JSON objekt: { … }.';
  return null;
}

export function buildWebhookBody(template: string | null, v: WebhookValues): unknown {
  if (!template) return standardWebhookBody(v);
  return fill(JSON.parse(template), v);
}

// ---- Custom headers -----------------------------------------------------------------

const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
const RESERVED_HEADERS = new Set(['host', 'content-length', 'content-type', 'connection', 'transfer-encoding', 'user-agent']);
export const MAX_WEBHOOK_HEADERS = 10;

/** null when a header pair is allowed, otherwise the reason. */
export function headerError(name: string, value: string): string | null {
  if (!HEADER_NAME.test(name)) return `Neveljavno ime glave »${name}«.`;
  const lower = name.toLowerCase();
  if (RESERVED_HEADERS.has(lower) || lower.startsWith('x-webhook-')) return `Glave »${name}« ni mogoče nastaviti.`;
  if (/[\r\n]/.test(value) || value.length > 2000) return `Neveljavna vrednost glave »${name}«.`;
  return null;
}
