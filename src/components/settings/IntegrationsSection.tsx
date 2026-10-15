import { useState, type FormEvent } from 'react';
import {
  isValidWebhookUrl,
  useWebhooks,
  type TestResult,
  type Webhook,
  type WebhookDelivery,
  type WebhookEvent,
  type WebhookFields,
} from '../../hooks/useWebhooks';
import {
  MAX_WEBHOOK_HEADERS,
  WEBHOOK_EVENTS,
  WEBHOOK_PLACEHOLDERS,
  buildWebhookBody,
  headerError,
  sampleWebhookValues,
  templateError,
} from '../../../supabase/functions/_shared/webhookBody';
import { usePracticeContext } from '../../contexts/PracticeContext';
import { ConfirmDialog } from '../ui/ConfirmDialog';

// Nastavitve → Integracije (migration 037, owners only): outbound webhooks that
// tell an external tool (FluentCRM, Make, Zapier, n8n, Brevo …) when a patient
// gives or withdraws marketing consent — in the standard body or the
// practice's own JSON, with its own headers (038). Only contact data is ever
// sent — see supabase/functions/deliver-webhooks.

const INPUT_CLASS =
  'w-full rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-sm text-[var(--ink,#1c2624)] outline-none focus:border-[var(--accent,#2e6e62)]';
const LINK_BUTTON = 'text-xs font-medium text-[var(--accent,#2e6e62)] hover:underline disabled:opacity-50';

const EXAMPLE_PAYLOAD = `{
  "event": "consent_granted",
  "event_id": "5b0c…",
  "occurred_at": "2026-10-14T09:12:00.000Z",
  "practice": "Monikina ordinacija",
  "source": "trigger",
  "email": "ana.novak@example.com",
  "first_name": "Ana",
  "last_name": "Novak",
  "phone": "+38641123456",
  "tags": [],
  "tag": null,
  "marketing_consent": true,
  "marketing_consent_at": "2026-10-14T09:11:58.000Z"
}`;

const STATUS_LABELS: Record<WebhookDelivery['status'], { text: string; className: string }> = {
  delivered: { text: 'Dostavljeno', className: 'bg-[#e6f4ef] text-[#1f6b4f]' },
  pending: { text: 'Čaka na ponovni poskus', className: 'bg-[#fff6e5] text-[#6b4a00]' },
  sending: { text: 'Pošiljanje …', className: 'bg-[#fff6e5] text-[#6b4a00]' },
  failed: { text: 'Ni uspelo', className: 'bg-[#fdecea] text-[#b3261e]' },
  skipped: { text: 'Preskočeno', className: 'bg-[#eef1f0] text-[#45524f]' },
};

const ORIGIN_LABELS: Record<WebhookDelivery['origin'], string> = {
  trigger: 'Dogodek',
  backfill: 'Obstoječe soglasje',
  test: 'Testni dogodek',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('sl-SI', { dateStyle: 'short', timeStyle: 'short' });
}

const DEFAULT_TEMPLATE = `{
  "email": "{email}",
  "first_name": "{first_name}",
  "last_name": "{last_name}",
  "phone": "{phone}",
  "subscribed": "{marketing_consent}",
  "event": "{event}"
}`;

type HeaderRow = { name: string; value: string };
type Note = { kind: 'ok' | 'error'; text: string } | null;

function headerRows(headers: Record<string, string>): HeaderRow[] {
  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

function NoteText({ note }: { note: Note }) {
  if (!note) return null;
  return <span className={`text-sm ${note.kind === 'error' ? 'text-[var(--danger,#b3261e)]' : 'text-[var(--accent,#2e6e62)]'}`}>{note.text}</span>;
}

const SAVE_BUTTON =
  'rounded bg-[var(--accent,#2e6e62)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50';

function WebhookCard({
  webhook,
  consentedCount,
  practiceName,
  onUpdate,
  onDelete,
  onTest,
  onSendExisting,
}: {
  webhook: Webhook;
  consentedCount: number;
  practiceName: string;
  onUpdate: (fields: WebhookFields) => Promise<{ error?: string }>;
  onDelete: () => void;
  onTest: () => Promise<TestResult>;
  onSendExisting: () => Promise<{ count?: number; error?: string }>;
}) {
  const [name, setName] = useState(webhook.name);
  const [url, setUrl] = useState(webhook.url);
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState<'test' | 'existing' | null>(null);
  const [message, setMessage] = useState<Note>(null);
  const [confirmExisting, setConfirmExisting] = useState(false);
  const [custom, setCustom] = useState(webhook.bodyTemplate !== null);
  const [template, setTemplate] = useState(webhook.bodyTemplate ?? DEFAULT_TEMPLATE);
  const [headers, setHeaders] = useState<HeaderRow[]>(headerRows(webhook.headers));
  const [bodyNote, setBodyNote] = useState<Note>(null);
  const [headersNote, setHeadersNote] = useState<Note>(null);

  const receivesGranted = webhook.events.includes('consent_granted');
  const problem = custom ? templateError(template) : null;
  const preview = problem
    ? null
    : JSON.stringify(buildWebhookBody(custom ? template : null, sampleWebhookValues('…', practiceName)), null, 2);
  const bodyDirty = (custom ? template : null) !== webhook.bodyTemplate;
  const headersDirty = JSON.stringify(headers.filter((h) => h.name.trim())) !== JSON.stringify(headerRows(webhook.headers));
  const headerCount = Object.keys(webhook.headers).length;

  async function commit(fields: WebhookFields) {
    if (fields.url !== undefined && !isValidWebhookUrl(fields.url)) {
      setMessage({ kind: 'error', text: 'URL mora začeti s https:// in vsebovati domeno.' });
      return;
    }
    if (fields.name !== undefined && !fields.name.trim()) return;
    const result = await onUpdate(fields);
    setMessage(result.error ? { kind: 'error', text: `Ni shranjeno: ${result.error}` } : { kind: 'ok', text: 'Shranjeno.' });
  }

  function toggleEvent(event: WebhookEvent, on: boolean) {
    const next = WEBHOOK_EVENTS.map((e) => e.key).filter((k) => (k === event ? on : webhook.events.includes(k)));
    if (next.length === 0) {
      setMessage({ kind: 'error', text: 'Izberite vsaj en dogodek.' });
      return;
    }
    commit({ events: next });
  }

  async function saveBody() {
    if (problem) return;
    const result = await onUpdate({ bodyTemplate: custom ? template : null });
    setBodyNote(result.error ? { kind: 'error', text: `Ni shranjeno: ${result.error}` } : { kind: 'ok', text: 'Telo je shranjeno.' });
  }

  async function saveHeaders() {
    const rows = headers.filter((h) => h.name.trim());
    if (rows.length > MAX_WEBHOOK_HEADERS) {
      setHeadersNote({ kind: 'error', text: `Največ ${MAX_WEBHOOK_HEADERS} glav.` });
      return;
    }
    const out: Record<string, string> = {};
    for (const h of rows) {
      const err = headerError(h.name.trim(), h.value);
      if (err) {
        setHeadersNote({ kind: 'error', text: err });
        return;
      }
      out[h.name.trim()] = h.value;
    }
    const result = await onUpdate({ headers: out });
    setHeadersNote(result.error ? { kind: 'error', text: `Ni shranjeno: ${result.error}` } : { kind: 'ok', text: 'Glave so shranjene.' });
  }

  async function handleTest() {
    setBusy('test');
    setMessage(null);
    const result = await onTest();
    setBusy(null);
    setMessage(
      result.ok
        ? { kind: 'ok', text: `Prejemnik je potrdil prejem (HTTP ${result.status}).` }
        : { kind: 'error', text: `Ni uspelo${result.status ? ` (HTTP ${result.status})` : ''}: ${result.error ?? 'neznana napaka'}` }
    );
  }

  async function handleExisting() {
    setConfirmExisting(false);
    setBusy('existing');
    setMessage(null);
    const result = await onSendExisting();
    setBusy(null);
    setMessage(
      result.error
        ? { kind: 'error', text: result.error }
        : { kind: 'ok', text: result.count ? `V pošiljanje je dodanih ${result.count} pacientov.` : 'Ni novih pacientov za pošiljanje.' }
    );
  }

  return (
    <div className={`flex flex-col gap-3 rounded border border-[var(--line,#ccd6d4)] p-4 ${webhook.enabled ? '' : 'bg-[#f7faf9]'}`}>
      <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-[var(--ink-soft,#45524f)]">Ime</span>
          <input
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() !== webhook.name && commit({ name: name.trim() })}
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-[var(--ink-soft,#45524f)]">URL prejemnika</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => url.trim() !== webhook.url && commit({ url: url.trim() })}
            className={INPUT_CLASS}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-[var(--ink,#1c2624)]">
        <label className="flex items-center gap-2 font-medium">
          <input type="checkbox" checked={webhook.enabled} onChange={(e) => commit({ enabled: e.target.checked })} />
          Vklopljeno
        </label>
        <span className="text-xs font-semibold text-[var(--ink-soft,#45524f)]">Dogodki:</span>
        {WEBHOOK_EVENTS.map((e) => (
          <label key={e.key} className="flex items-center gap-2">
            <input type="checkbox" checked={webhook.events.includes(e.key)} onChange={(ev) => toggleEvent(e.key, ev.target.checked)} />
            {e.label}
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs font-semibold text-[var(--ink-soft,#45524f)]">Skrivni ključ za podpis:</span>
        <code className="rounded bg-[#f1f4f3] px-2 py-0.5 text-xs">{showSecret ? webhook.secret : '•'.repeat(24)}</code>
        <button type="button" className={LINK_BUTTON} onClick={() => setShowSecret((s) => !s)}>
          {showSecret ? 'Skrij' : 'Pokaži'}
        </button>
        <button type="button" className={LINK_BUTTON} onClick={() => navigator.clipboard?.writeText(webhook.secret)}>
          Kopiraj
        </button>
      </div>

      <details className="rounded border border-[var(--line,#ccd6d4)] p-3">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--ink,#1c2624)]">
          Telo zahteve: {webhook.bodyTemplate === null ? 'standardna oblika' : 'po meri'}
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-wrap gap-5 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={!custom} onChange={() => setCustom(false)} />
              Standardna oblika
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={custom} onChange={() => setCustom(true)} />
              Po meri (lastni JSON)
            </label>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="flex flex-col gap-2">
              {custom ? (
                <>
                  <textarea
                    value={template}
                    onChange={(e) => setTemplate(e.target.value)}
                    rows={12}
                    spellCheck={false}
                    className={`${INPUT_CLASS} font-mono text-xs`}
                  />
                  <p className="text-xs text-[var(--muted,#6f7c79)]">
                    Poljubni ključi in stalne vrednosti. Vrednost, ki je samo ena oznaka (npr. <code>"{'{marketing_consent}'}"</code>), dobi
                    pravo vrsto (true/false, seznam); v daljšem besedilu se oznaka zamenja z besedilom. Klik na oznako jo kopira.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {WEBHOOK_PLACEHOLDERS.map((ph) => (
                      <button
                        key={ph.key}
                        type="button"
                        title={ph.label}
                        onClick={() => navigator.clipboard?.writeText(`{${ph.key}}`)}
                        className="rounded-full border border-[var(--line,#ccd6d4)] px-2 py-0.5 font-mono text-xs text-[var(--ink,#1c2624)] hover:bg-[#f1f4f3]"
                      >
                        {`{${ph.key}}`}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-[var(--ink-soft,#45524f)]">
                  Standardna oblika ustreza FluentCRM-u in večini orodij (Make, Zapier, n8n). Za drugačna imena polj ali dodatne
                  vrednosti izberite »Po meri«.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-[var(--ink-soft,#45524f)]">Predogled (testni pacient)</span>
              {problem ? (
                <p className="text-sm text-[var(--danger,#b3261e)]">{problem}</p>
              ) : (
                <pre className="overflow-x-auto rounded bg-[#f1f4f3] p-3 text-xs text-[var(--ink,#1c2624)]">{preview}</pre>
              )}
              <p className="text-xs text-[var(--muted,#6f7c79)]">
                Pri preklicu soglasja sta ime in priimek prazna (null), <code>marketing_consent</code> je false.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" disabled={!bodyDirty || !!problem} onClick={saveBody} className={SAVE_BUTTON}>
              Shrani telo
            </button>
            <NoteText note={bodyNote} />
          </div>
        </div>
      </details>

      <details className="rounded border border-[var(--line,#ccd6d4)] p-3">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--ink,#1c2624)]">
          Glave zahteve{headerCount ? ` (${headerCount})` : ''}
        </summary>
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-xs text-[var(--muted,#6f7c79)]">
            Npr. <code>Authorization</code> = <code>Bearer …</code> ali <code>api-key</code> = ključ, če ga prejemnik zahteva.
          </p>
          {headers.map((h, i) => (
            <div key={i} className="grid grid-cols-[200px_1fr_auto] items-center gap-2">
              <input
                value={h.name}
                placeholder="Ime glave"
                onChange={(e) => setHeaders(headers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                className={`${INPUT_CLASS} font-mono text-xs`}
              />
              <input
                value={h.value}
                placeholder="Vrednost"
                onChange={(e) => setHeaders(headers.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                className={`${INPUT_CLASS} font-mono text-xs`}
              />
              <button
                type="button"
                onClick={() => setHeaders(headers.filter((_, j) => j !== i))}
                className="text-xs font-medium text-[var(--danger,#b3261e)] hover:underline"
              >
                Odstrani
              </button>
            </div>
          ))}
          <div className="flex items-center gap-4">
            <button
              type="button"
              disabled={headers.length >= MAX_WEBHOOK_HEADERS}
              onClick={() => setHeaders([...headers, { name: '', value: '' }])}
              className={LINK_BUTTON}
            >
              + Dodaj glavo
            </button>
            <button type="button" disabled={!headersDirty} onClick={saveHeaders} className={SAVE_BUTTON}>
              Shrani glave
            </button>
            <NoteText note={headersNote} />
          </div>
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-4">
        <button type="button" disabled={busy !== null || !webhook.enabled} onClick={handleTest} className={LINK_BUTTON}>
          {busy === 'test' ? 'Pošiljam …' : 'Pošlji testni dogodek'}
        </button>
        {receivesGranted && (
          <button
            type="button"
            disabled={busy !== null || !webhook.enabled || consentedCount === 0}
            onClick={() => setConfirmExisting(true)}
            className={LINK_BUTTON}
          >
            {busy === 'existing' ? 'Dodajam …' : `Pošlji obstoječe (${consentedCount})`}
          </button>
        )}
        <button type="button" onClick={onDelete} className="text-xs font-medium text-[var(--danger,#b3261e)] hover:underline">
          Izbriši
        </button>
      </div>

      {message && (
        <p className={`text-sm ${message.kind === 'error' ? 'text-[var(--danger,#b3261e)]' : 'text-[var(--accent,#2e6e62)]'}`}>{message.text}</p>
      )}

      {confirmExisting && (
        <ConfirmDialog confirmLabel="Pošlji" onCancel={() => setConfirmExisting(false)} onConfirm={handleExisting}>
          Prejemniku <strong>{webhook.name}</strong> pošljemo kontaktne podatke vseh pacientov, ki so dali soglasje za obveščanje (
          {consentedCount}). Če jih prejemnik že ima, jih običajno le posodobi.
        </ConfirmDialog>
      )}
    </div>
  );
}

export function IntegrationsSection() {
  const { webhooks, deliveries, consentedCount, loading, error, reload, createWebhook, updateWebhook, deleteWebhook, sendTest, sendExisting } =
    useWebhooks();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Webhook | null>(null);
  const [newEvents, setNewEvents] = useState<WebhookEvent[]>(['consent_granted', 'consent_withdrawn']);
  const { practiceName } = usePracticeContext();

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!isValidWebhookUrl(url)) {
      setAddError('URL mora začeti s https:// in vsebovati domeno.');
      return;
    }
    setAdding(true);
    if (newEvents.length === 0) {
      setAddError('Izberite vsaj en dogodek.');
      return;
    }
    const result = await createWebhook(name || 'Integracija', url, newEvents);
    setAdding(false);
    setAddError(result.error ?? null);
    if (!result.error) {
      setName('');
      setUrl('');
    }
  }

  if (loading) return <p className="text-sm text-[var(--ink-soft,#45524f)]">Nalaganje …</p>;
  if (error) return <p className="text-sm text-[var(--danger,#b3261e)]">Napaka pri nalaganju: {error}</p>;

  const nameById = new Map(webhooks.map((w) => [w.id, w.name]));

  return (
    <div className="flex flex-col gap-5">
      <p className="max-w-[900px] text-sm text-[var(--ink-soft,#45524f)]">
        Spletni klici (webhooki) obvestijo zunanje orodje — npr. FluentCRM, Make, Zapier ali Brevo — ko pacient na vprašalniku o
        zdravju da soglasje za obveščanje, ali ko je soglasje preklicano. Pošljemo le kontaktne podatke (ob preklicu samo e-pošto in
        telefon), nikoli zdravstvenih podatkov. Prejemnik je lahko katerakoli aplikacija — obliko telesa in glave lahko prilagodite.
        Če prejemnik ni dosegljiv, poskušamo znova do 24 ur.
      </p>

      {webhooks.map((w) => (
        <WebhookCard
          key={w.id}
          webhook={w}
          consentedCount={consentedCount}
          practiceName={practiceName ?? ''}
          onUpdate={(fields) => updateWebhook(w.id, fields)}
          onDelete={() => setConfirmDelete(w)}
          onTest={() => sendTest(w.id)}
          onSendExisting={() => sendExisting(w.id)}
        />
      ))}

      <form onSubmit={handleAdd} className="flex flex-col gap-3 rounded border border-dashed border-[var(--line,#ccd6d4)] p-4">
        <h3 className="text-sm font-bold text-[var(--ink,#1c2624)]">Dodaj integracijo</h3>
        <div className="grid gap-3 sm:grid-cols-[220px_1fr_auto] sm:items-end">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-[var(--ink-soft,#45524f)]">Ime</span>
            <input value={name} maxLength={80} placeholder="npr. FluentCRM" onChange={(e) => setName(e.target.value)} className={INPUT_CLASS} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-[var(--ink-soft,#45524f)]">URL prejemnika</span>
            <input
              value={url}
              required
              placeholder="https://…"
              onChange={(e) => setUrl(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
          <button
            type="submit"
            disabled={adding}
            className="rounded bg-[var(--accent,#2e6e62)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {adding ? 'Dodajam …' : 'Dodaj'}
          </button>
        </div>
        <div className="flex flex-wrap gap-5 text-sm text-[var(--ink,#1c2624)]">
          {WEBHOOK_EVENTS.map((ev) => (
            <label key={ev.key} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={newEvents.includes(ev.key)}
                onChange={(e) =>
                  setNewEvents(WEBHOOK_EVENTS.map((x) => x.key).filter((k) => (k === ev.key ? e.target.checked : newEvents.includes(k))))
                }
              />
              {ev.label}
            </label>
          ))}
        </div>
        {addError && <p className="text-sm text-[var(--danger,#b3261e)]">{addError}</p>}
      </form>

      <details className="rounded border border-[var(--line,#ccd6d4)] p-4 text-sm text-[var(--ink,#1c2624)]">
        <summary className="cursor-pointer font-semibold">Kaj pošljemo (za nastavitev prejemnika)</summary>
        <div className="mt-3 flex flex-col gap-2 text-[var(--ink-soft,#45524f)]">
          <p>
            Zahteva <code>POST</code> z JSON telesom. V FluentCRM (Contacts → Incoming Webhooks) povežite polja <code>email</code>,{' '}
            <code>first_name</code>, <code>last_name</code> in <code>phone</code>.
          </p>
          <pre className="overflow-x-auto rounded bg-[#f1f4f3] p-3 text-xs text-[var(--ink,#1c2624)]">{EXAMPLE_PAYLOAD}</pre>
          <p>
            Glave: <code>X-Webhook-Event</code>, <code>X-Webhook-Id</code> (enak pri ponovnih poskusih) in{' '}
            <code>X-Webhook-Signature: t=&lt;čas&gt;,v1=&lt;podpis&gt;</code> — podpis je HMAC-SHA256 niza{' '}
            <code>&lt;čas&gt;.&lt;telo&gt;</code> s skrivnim ključem integracije. Preverjanje podpisa je neobvezno (FluentCRM ga ne
            preverja; URL sam vsebuje njegov ključ).
          </p>
        </div>
      </details>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-[var(--ink,#1c2624)]">Zadnja pošiljanja</h3>
          <button type="button" onClick={reload} className={LINK_BUTTON}>
            Osveži
          </button>
        </div>
        {deliveries.length === 0 ? (
          <p className="text-sm text-[var(--muted,#6f7c79)]">Še nič poslanega.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-[var(--line,#ccd6d4)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#f7faf9] text-xs uppercase text-[var(--ink-soft,#45524f)]">
                <tr>
                  <th className="px-3 py-2 font-semibold">Čas</th>
                  <th className="px-3 py-2 font-semibold">Integracija</th>
                  <th className="px-3 py-2 font-semibold">Dogodek</th>
                  <th className="px-3 py-2 font-semibold">Pacient</th>
                  <th className="px-3 py-2 font-semibold">Stanje</th>
                  <th className="px-3 py-2 font-semibold">Odgovor</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => {
                  const status = STATUS_LABELS[d.status];
                  return (
                    <tr key={d.id} className="border-t border-[var(--line,#ccd6d4)] align-top">
                      <td className="whitespace-nowrap px-3 py-2">{formatDateTime(d.createdAt)}</td>
                      <td className="px-3 py-2">{nameById.get(d.webhookId) ?? '—'}</td>
                      <td className="px-3 py-2">{ORIGIN_LABELS[d.origin]}</td>
                      <td className="px-3 py-2">{d.patientName ?? (d.origin === 'test' ? 'Testni Pacient' : '—')}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status.className}`}>{status.text}</span>
                        {d.status === 'pending' && d.attempts > 0 && (
                          <div className="mt-1 text-xs text-[var(--muted,#6f7c79)]">
                            poskus {d.attempts}, naslednji {formatDateTime(d.nextAttemptAt)}
                          </div>
                        )}
                      </td>
                      <td className="max-w-[320px] px-3 py-2 text-xs text-[var(--ink-soft,#45524f)]">
                        {d.responseStatus ? `HTTP ${d.responseStatus}` : ''}
                        {d.lastError ? `${d.responseStatus ? ' — ' : ''}${d.lastError}` : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          confirmLabel="Izbriši"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            const w = confirmDelete;
            setConfirmDelete(null);
            deleteWebhook(w.id);
          }}
        >
          Ali res želite izbrisati integracijo <strong>{confirmDelete.name}</strong>? Pošiljanje se takoj ustavi, izbriše se tudi njen
          dnevnik pošiljanj.
        </ConfirmDialog>
      )}
    </div>
  );
}
