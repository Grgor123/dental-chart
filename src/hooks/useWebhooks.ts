import { useCallback, useEffect, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { usePracticeContext } from '../contexts/PracticeContext';
import type { WebhookEventKey } from '../../supabase/functions/_shared/webhookBody';

// Nastavitve → Integracije (migration 037): outbound webhooks. Owners only —
// RLS hides both tables from staff. Delivery itself happens in the
// deliver-webhooks Edge Function; this hook manages the webhooks, shows the
// delivery log and triggers a test / "Pošlji obstoječe". Migration 038 added
// events per webhook, a custom JSON body and custom headers.

export type WebhookEvent = WebhookEventKey;

export interface Webhook {
  id: string;
  name: string;
  url: string;
  events: WebhookEvent[];
  secret: string;
  enabled: boolean;
  /** null = the standard body. */
  bodyTemplate: string | null;
  headers: Record<string, string>;
  /** Email types that fire email_sent (migration 043). */
  emailTypes: string[];
  createdAt: string;
}

export type WebhookFields = Partial<Pick<Webhook, 'name' | 'url' | 'enabled' | 'events' | 'bodyTemplate' | 'headers' | 'emailTypes'>>;

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: string;
  origin: 'trigger' | 'backfill' | 'test';
  patientName: string | null;
  status: 'pending' | 'sending' | 'delivered' | 'failed' | 'skipped';
  attempts: number;
  nextAttemptAt: string;
  responseStatus: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface TestResult {
  ok: boolean;
  status: number | null;
  error: string | null;
}

export function isValidWebhookUrl(url: string): boolean {
  return /^https:\/\/[^\s/]+\.[^\s]+$/.test(url.trim());
}

function mapWebhook(row: Record<string, unknown>): Webhook {
  return {
    id: row.id as string,
    name: row.name as string,
    url: row.url as string,
    events: (row.events as WebhookEvent[]) ?? [],
    secret: row.secret as string,
    enabled: row.enabled as boolean,
    bodyTemplate: (row.body_template as string | null) ?? null,
    headers: (row.headers as Record<string, string> | null) ?? {},
    emailTypes: (row.email_types as string[] | null) ?? [],
    createdAt: row.created_at as string,
  };
}

function mapDelivery(row: Record<string, unknown>): WebhookDelivery {
  const p = row.patients as { first_name: string; last_name: string } | null;
  return {
    id: row.id as string,
    webhookId: row.webhook_id as string,
    event: row.event as string,
    origin: row.origin as WebhookDelivery['origin'],
    patientName: p ? `${p.first_name} ${p.last_name}` : null,
    status: row.status as WebhookDelivery['status'],
    attempts: row.attempts as number,
    nextAttemptAt: row.next_attempt_at as string,
    responseStatus: (row.response_status as number | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    createdAt: row.created_at as string,
    deliveredAt: (row.delivered_at as string | null) ?? null,
  };
}

export function useWebhooks() {
  const { practiceId } = usePracticeContext();
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [consentedCount, setConsentedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [hooks, log, consented] = await Promise.all([
      supabase.from('webhooks').select('*').order('created_at'),
      supabase
        .from('webhook_deliveries')
        .select('id, webhook_id, event, origin, status, attempts, next_attempt_at, response_status, last_error, created_at, delivered_at, patients(first_name, last_name)')
        .order('created_at', { ascending: false })
        .limit(50),
      supabase.from('patients').select('id', { count: 'exact', head: true }).eq('marketing_consent', true),
    ]);
    const firstError = hooks.error ?? log.error ?? consented.error;
    if (firstError) {
      setError(firstError.message);
    } else {
      setError(null);
      setWebhooks((hooks.data ?? []).map(mapWebhook));
      setDeliveries((log.data ?? []).map((r) => mapDelivery(r as Record<string, unknown>)));
      setConsentedCount(consented.count ?? 0);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function createWebhook(name: string, url: string, events: WebhookEvent[]): Promise<{ error?: string }> {
    if (!practiceId) return { error: 'Ordinacija ni naložena.' };
    const { error: insertError } = await supabase
      .from('webhooks')
      .insert({ practice_id: practiceId, name: name.trim(), url: url.trim(), events });
    if (insertError) return { error: insertError.message };
    await reload();
    return {};
  }

  async function updateWebhook(id: string, fields: WebhookFields): Promise<{ error?: string }> {
    const { bodyTemplate, emailTypes, ...rest } = fields;
    const row: Record<string, unknown> = { ...rest };
    if (bodyTemplate !== undefined) row.body_template = bodyTemplate;
    if (emailTypes !== undefined) row.email_types = emailTypes;
    const { error: updateError } = await supabase.from('webhooks').update(row).eq('id', id);
    if (updateError) return { error: updateError.message };
    await reload();
    return {};
  }

  async function deleteWebhook(id: string): Promise<{ error?: string }> {
    const { error: deleteError } = await supabase.from('webhooks').delete().eq('id', id);
    if (deleteError) return { error: deleteError.message };
    await reload();
    return {};
  }

  async function sendTest(id: string): Promise<TestResult> {
    const { data, error: fnError } = await supabase.functions.invoke('deliver-webhooks', { body: { action: 'test', webhookId: id } });
    await reload();
    if (fnError) {
      let message = fnError.message;
      if (fnError instanceof FunctionsHttpError) {
        const payload = await fnError.context.json().catch(() => null);
        if (payload?.error) message = payload.error as string;
      }
      return { ok: false, status: null, error: message };
    }
    return data as TestResult;
  }

  async function sendExisting(id: string): Promise<{ count?: number; error?: string }> {
    const { data, error: rpcError } = await supabase.rpc('queue_webhook_backfill', { p_webhook_id: id });
    if (rpcError) return { error: rpcError.message };
    // Give the function a moment to post the first batch before refreshing.
    window.setTimeout(reload, 3000);
    return { count: data as number };
  }

  return { webhooks, deliveries, consentedCount, loading, error, reload, createWebhook, updateWebhook, deleteWebhook, sendTest, sendExisting };
}
