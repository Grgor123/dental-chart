// Deno Edge Function — outbound webhooks (migration 037, Nastavitve →
// Integracije).
//
// Two callers:
// - Service role ({ processQueue: true }) — the consent trigger / backfill via
//   pg_net, and the 5-minute cron job: posts every due row of
//   webhook_deliveries, with retries on failure.
// - A signed-in owner ({ action: 'test', webhookId }) — "Pošlji testni dogodek":
//   posts a sample payload right away and answers with the receiver's reply.
//   The webhook is read through the caller's own RLS (owners only), so a staff
//   member or another practice gets "not found".
//
// What is sent — never anything clinical:
// - consent_granted: only if the patient has marketing consent AT THE MOMENT OF
//   SENDING (re-checked on every attempt); name, email, phone.
// - consent_withdrawn (038): only if the consent is still withdrawn; email and
//   phone only, so the receiving tool can find the contact and stop marketing.
// The body is the standard flat JSON or the webhook's own template, plus the
// webhook's own headers (038) — built by _shared/webhookBody.ts.
//
// Signature: X-Webhook-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of
// "<t>.<raw body>" with the webhook's secret>.
//
// Deploy: supabase functions deploy deliver-webhooks
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { buildWebhookBody, headerError, sampleWebhookValues, type WebhookValues } from '../_shared/webhookBody.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const BATCH_SIZE = 50;
const TIMEOUT_MS = 10_000;
// Minutes to wait after attempt 1, 2, … — then give up ('failed').
const BACKOFF_MINUTES = [1, 5, 15, 60, 180, 360, 720, 1440];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

interface Webhook {
  id: string;
  practice_id: string;
  url: string;
  secret: string;
  enabled: boolean;
  events: string[];
  body_template: string | null;
  headers: Record<string, string> | null;
}

const WEBHOOK_COLUMNS = 'id, practice_id, url, secret, enabled, events, body_template, headers';

interface Delivery {
  id: string;
  practice_id: string;
  webhook_id: string;
  event: string;
  origin: string;
  patient_id: string | null;
  attempts: number;
}

// ---- SSRF guard: public https hosts only ------------------------------------------

function isPrivateIp(ip: string): boolean {
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (v6.includes(':')) {
    if (v6 === '::' || v6 === '::1') return true;
    if (v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80')) return true;
    const mapped = v6.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
  }
  return false;
}

async function checkTarget(rawUrl: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'Neveljaven URL.';
  }
  if (url.protocol !== 'https:') return 'URL mora začeti s https://.';
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return 'Notranji naslovi niso dovoljeni.';
  }
  if (isPrivateIp(host)) return 'Notranji naslovi niso dovoljeni.';
  if (!/^[\d.]+$/.test(host) && !host.includes(':')) {
    const addresses: string[] = [];
    for (const type of ['A', 'AAAA'] as const) {
      try {
        addresses.push(...(await Deno.resolveDns(host, type)));
      } catch {
        // no record of this type (or DNS unavailable) — fetch decides
      }
    }
    if (addresses.some(isPrivateIp)) return 'Naslov kaže na notranje omrežje.';
  }
  return null;
}

// ---- Signing and posting ------------------------------------------------------------

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

interface PostResult {
  ok: boolean;
  status: number | null;
  error: string | null;
}

async function post(webhook: Webhook, deliveryId: string, event: string, payload: unknown): Promise<PostResult> {
  const targetError = await checkTarget(webhook.url);
  if (targetError) return { ok: false, status: null, error: targetError };
  const custom: Record<string, string> = {};
  for (const [name, value] of Object.entries(webhook.headers ?? {})) {
    const problem = headerError(name, String(value));
    if (problem) return { ok: false, status: null, error: problem };
    custom[name] = String(value);
  }
  const body = JSON.stringify(payload);
  const t = Math.floor(Date.now() / 1000);
  const signature = await hmacHex(webhook.secret, `${t}.${body}`);
  try {
    const res = await fetch(webhook.url, {
      method: 'POST',
      redirect: 'manual', // a redirect could point inside the network
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        ...custom,
        'Content-Type': 'application/json',
        'User-Agent': 'DentalChart-Webhooks/1',
        'X-Webhook-Event': event,
        'X-Webhook-Id': deliveryId,
        'X-Webhook-Signature': `t=${t},v1=${signature}`,
      },
      body,
    });
    const text = (await res.text().catch(() => '')).slice(0, 300);
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, error: null };
    return { ok: false, status: res.status, error: text || res.statusText || `HTTP ${res.status}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: null, error: e instanceof DOMException && e.name === 'TimeoutError' ? 'Prejemnik ni odgovoril v 10 s.' : msg };
  }
}

// ---- Payloads ---------------------------------------------------------------------

async function practiceName(service: SupabaseClient, practiceId: string): Promise<string> {
  const { data } = await service.from('practices').select('name').eq('id', practiceId).maybeSingle();
  return (data?.name as string | undefined) ?? '';
}


// ---- Queue processing ---------------------------------------------------------------

async function processQueue(service: SupabaseClient): Promise<{ processed: number }> {
  const { data: claimed, error } = await service.rpc('claim_webhook_deliveries', { p_limit: BATCH_SIZE });
  if (error) throw new Error(error.message);
  const deliveries = (claimed ?? []) as Delivery[];
  const webhooks = new Map<string, Webhook | null>();
  const practices = new Map<string, string>();

  for (const d of deliveries) {
    async function finish(fields: Record<string, unknown>) {
      await service.from('webhook_deliveries').update({ locked_at: null, ...fields }).eq('id', d.id);
    }

    if (!webhooks.has(d.webhook_id)) {
      const { data } = await service.from('webhooks').select(WEBHOOK_COLUMNS).eq('id', d.webhook_id).maybeSingle();
      webhooks.set(d.webhook_id, (data as Webhook | null) ?? null);
    }
    const webhook = webhooks.get(d.webhook_id);
    if (!webhook || !webhook.enabled) {
      await finish({ status: 'skipped', last_error: 'Integracija je izklopljena.' });
      continue;
    }
    const granted = d.event === 'consent_granted';
    if ((!granted && d.event !== 'consent_withdrawn') || !d.patient_id) {
      await finish({ status: 'skipped', last_error: 'Neznan dogodek.' });
      continue;
    }

    const { data: patient } = await service
      .from('patients')
      .select('first_name, last_name, email, phone, marketing_consent, marketing_consent_at, practice_id')
      .eq('id', d.patient_id)
      .maybeSingle();
    if (!patient || patient.practice_id !== d.practice_id) {
      await finish({ status: 'skipped', last_error: 'Pacient ne obstaja več.' });
      continue;
    }
    if (patient.marketing_consent !== granted) {
      await finish({
        status: 'skipped',
        last_error: granted ? 'Pacient nima (več) soglasja za obveščanje.' : 'Pacient je medtem znova dal soglasje.',
      });
      continue;
    }

    if (!practices.has(d.practice_id)) practices.set(d.practice_id, await practiceName(service, d.practice_id));
    const values: WebhookValues = {
      event: d.event,
      event_id: d.id,
      occurred_at: new Date().toISOString(),
      practice: practices.get(d.practice_id)!,
      source: d.origin, // 'trigger' | 'backfill'
      email: patient.email ?? null,
      phone: patient.phone ?? null,
      // A withdrawal identifies the contact only — no names.
      first_name: granted ? patient.first_name : null,
      last_name: granted ? patient.last_name : null,
      full_name: granted ? `${patient.first_name} ${patient.last_name}` : null,
      tags: [],
      marketing_consent: granted,
      marketing_consent_at: patient.marketing_consent_at,
    };
    let payload: unknown;
    try {
      payload = buildWebhookBody(webhook.body_template, values);
    } catch {
      await finish({ status: 'failed', attempts: d.attempts + 1, last_error: 'Telo po meri ni veljaven JSON.' });
      continue;
    }

    const result = await post(webhook, d.id, d.event, payload);
    const attempts = d.attempts + 1;
    if (result.ok) {
      await finish({ status: 'delivered', attempts, payload, response_status: result.status, last_error: null, delivered_at: new Date().toISOString() });
    } else if (attempts >= BACKOFF_MINUTES.length) {
      await finish({ status: 'failed', attempts, payload, response_status: result.status, last_error: result.error });
    } else {
      const next = new Date(Date.now() + BACKOFF_MINUTES[attempts - 1] * 60_000).toISOString();
      await finish({ status: 'pending', attempts, payload, response_status: result.status, last_error: result.error, next_attempt_at: next });
    }
  }
  return { processed: deliveries.length };
}

// ---- Handler --------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);
  const body = await req.json().catch(() => null);
  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  if (authHeader === `Bearer ${SERVICE_ROLE_KEY}` && body?.processQueue) {
    try {
      return json(await processQueue(service));
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  }

  if (body?.action === 'test' && typeof body.webhookId === 'string') {
    // Through the caller's RLS: only an owner of the webhook's practice sees it.
    const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: visible } = await asUser.from('webhooks').select('id').eq('id', body.webhookId).maybeSingle();
    if (!visible) return json({ error: 'Integracija ne obstaja ali je ne smete urejati.' }, 404);
    const { data: webhook } = await service.from('webhooks').select(WEBHOOK_COLUMNS).eq('id', body.webhookId).single();
    const w = webhook as Webhook;

    const { data: row, error: insertError } = await service
      .from('webhook_deliveries')
      .insert({ practice_id: w.practice_id, webhook_id: w.id, event: 'test', origin: 'test', status: 'sending', attempts: 0 })
      .select('id')
      .single();
    if (insertError) return json({ error: insertError.message }, 500);

    let payload: unknown;
    try {
      payload = buildWebhookBody(w.body_template, sampleWebhookValues(row.id as string, await practiceName(service, w.practice_id)));
    } catch {
      payload = null;
    }
    const result: PostResult = payload === null
      ? { ok: false, status: null, error: 'Telo po meri ni veljaven JSON.' }
      : await post(w, row.id as string, 'test', payload);
    await service
      .from('webhook_deliveries')
      .update({
        status: result.ok ? 'delivered' : 'failed',
        attempts: 1,
        payload,
        response_status: result.status,
        last_error: result.error,
        delivered_at: result.ok ? new Date().toISOString() : null,
      })
      .eq('id', row.id);
    return json(result);
  }

  return json({ error: 'Unknown request' }, 400);
});
