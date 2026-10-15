import { useState, type FormEvent } from 'react';
import { API_SCOPES, PUBLIC_API_URL, useApiKeys, type ApiKey, type ApiScope } from '../../hooks/useApiKeys';
import { ConfirmDialog } from '../ui/ConfirmDialog';

// Integracije → "API ključi" (migration 042, owners only): keys an external tool
// uses to call the app — for now only to report an unsubscribe. The full key
// is shown once, right after it's created.

const INPUT_CLASS =
  'rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-sm text-[var(--ink,#1c2624)] outline-none focus:border-[var(--accent,#2e6e62)]';
const LINK_BUTTON = 'text-xs font-medium text-[var(--accent,#2e6e62)] hover:underline disabled:opacity-50';

function formatDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('sl-SI', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

const CURL_EXAMPLE = (key: string) => `curl -X POST ${PUBLIC_API_URL}/unsubscribe \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"email": "ana.novak@example.com"}'`;

export function ApiKeysSection() {
  const { keys, error, createKey, revokeKey } = useApiKeys();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiScope[]>(['unsubscribe']);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copyNote, setCopyNote] = useState<string | null>(null);

  async function copyKey(key: string) {
    try {
      await navigator.clipboard.writeText(key);
      setCopyNote('Kopirano ✓');
    } catch {
      setCopyNote('Kopiranje ni uspelo — kliknite ključ (označi se v celoti) in pritisnite Ctrl+C.');
    }
  }
  const [confirmRevoke, setConfirmRevoke] = useState<ApiKey | null>(null);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || scopes.length === 0) {
      setFormError('Vpišite ime in izberite vsaj eno dovoljenje.');
      return;
    }
    setBusy(true);
    const result = await createKey(name, scopes);
    setBusy(false);
    setFormError(result.error ?? null);
    if (result.key) {
      setNewKey(result.key);
      setCopyNote(null);
      setName('');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-bold text-[var(--ink,#1c2624)]">API ključi (dohodne zahteve)</h3>
      <p className="max-w-[900px] text-sm text-[var(--ink-soft,#45524f)]">
        S ključem lahko zunanje orodje sporoči programu, da se je nekdo odjavil od obveščanja (npr. FluentCRM ob odjavi pošlje spletni
        klic). Takrat se pacientu s tem e-poštnim naslovom soglasje za marketing nastavi na »ne«. Soglasja prek API-ja ni mogoče dati.
      </p>
      {error && <p className="text-sm text-[var(--danger,#b3261e)]">{error}</p>}

      {newKey && (
        <div className="flex flex-col gap-2 rounded border border-[#e6c34a] bg-[#fff8e1] p-3 text-sm">
          <strong>Ključ je ustvarjen — kopirajte ga zdaj, pozneje ga ne bo več mogoče videti.</strong>
          <div className="flex flex-wrap items-center gap-2">
            {/* select-all: one click selects the whole key for Ctrl+C. */}
            <code className="select-all break-all rounded bg-white px-2 py-1 text-xs">{newKey}</code>
            <button type="button" className={LINK_BUTTON} onClick={() => copyKey(newKey)}>
              Kopiraj
            </button>
            {copyNote && <span className="text-xs">{copyNote}</span>}
            <button
              type="button"
              className={LINK_BUTTON}
              onClick={() => {
                setNewKey(null);
                setCopyNote(null);
              }}
            >
              Zapri
            </button>
          </div>
        </div>
      )}

      {keys.length > 0 && (
        <div className="overflow-x-auto rounded border border-[var(--line,#ccd6d4)]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#f7faf9] text-xs uppercase text-[var(--ink-soft,#45524f)]">
              <tr>
                <th className="px-3 py-2 font-semibold">Ime</th>
                <th className="px-3 py-2 font-semibold">Ključ</th>
                <th className="px-3 py-2 font-semibold">Dovoljenja</th>
                <th className="px-3 py-2 font-semibold">Ustvarjen</th>
                <th className="px-3 py-2 font-semibold">Zadnja uporaba</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className={`border-t border-[var(--line,#ccd6d4)] ${k.revokedAt ? 'text-[var(--muted,#6f7c79)]' : ''}`}>
                  <td className="px-3 py-2">{k.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{k.prefix}…</td>
                  <td className="px-3 py-2 text-xs">{k.scopes.map((s) => API_SCOPES.find((x) => x.key === s)?.label ?? s).join(', ')}</td>
                  <td className="whitespace-nowrap px-3 py-2">{formatDateTime(k.createdAt)}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {formatDateTime(k.lastUsedAt)}
                    {k.useCount > 0 && <span className="text-xs text-[var(--muted,#6f7c79)]"> ({k.useCount}×)</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {k.revokedAt ? (
                      <span className="text-xs">Preklican {formatDateTime(k.revokedAt)}</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRevoke(k)}
                        className="text-xs font-medium text-[var(--danger,#b3261e)] hover:underline"
                      >
                        Prekliči
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded border border-dashed border-[var(--line,#ccd6d4)] p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-[var(--ink-soft,#45524f)]">Ime ključa</span>
            <input value={name} maxLength={80} placeholder="npr. FluentCRM" onChange={(e) => setName(e.target.value)} className={INPUT_CLASS} />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-[var(--ink-soft,#45524f)]">Dovoljenja</span>
            {API_SCOPES.map((s) => (
              <label key={s.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={scopes.includes(s.key)}
                  onChange={(e) => setScopes(e.target.checked ? [...scopes, s.key] : scopes.filter((x) => x !== s.key))}
                />
                {s.label}
              </label>
            ))}
          </div>
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-[var(--accent,#2e6e62)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            {busy ? 'Ustvarjam …' : 'Ustvari ključ'}
          </button>
        </div>
        {formError && <p className="text-sm text-[var(--danger,#b3261e)]">{formError}</p>}
      </form>

      <details className="rounded border border-[var(--line,#ccd6d4)] p-4 text-sm text-[var(--ink,#1c2624)]">
        <summary className="cursor-pointer font-semibold">Kako poklicati API</summary>
        <div className="mt-3 flex flex-col gap-2 text-[var(--ink-soft,#45524f)]">
          <p>
            <code>POST {PUBLIC_API_URL}/unsubscribe</code> s telesom <code>{'{"email": "…"}'}</code> (JSON ali obrazec) in glavo{' '}
            <code>Authorization: Bearer &lt;ključ&gt;</code> (ali <code>X-Api-Key</code>). Odgovor: <code>{'{"ok": true, "updated": 1}'}</code>{' '}
            — <code>updated</code> je število pacientov, ki jim je bilo soglasje preklicano. Za preizkus ključa: <code>POST …/ping</code>.
          </p>
          <pre className="overflow-x-auto rounded bg-[#f1f4f3] p-3 text-xs text-[var(--ink,#1c2624)]">{CURL_EXAMPLE('dc_…')}</pre>
          <p>
            FluentCRM: avtomatizacija s sprožilcem »Contact unsubscribed« (ali sprememba statusa) in dejanjem »Outgoing Webhook« — URL zgoraj,
            metoda POST, glava <code>Authorization</code>, polje <code>email</code> = e-pošta kontakta.
          </p>
        </div>
      </details>

      {confirmRevoke && (
        <ConfirmDialog
          confirmLabel="Prekliči ključ"
          onCancel={() => setConfirmRevoke(null)}
          onConfirm={() => {
            const k = confirmRevoke;
            setConfirmRevoke(null);
            revokeKey(k.id);
          }}
        >
          Ali res želite preklicati ključ <strong>{confirmRevoke.name}</strong>? Orodja, ki ga uporabljajo, ne bodo več mogla pošiljati
          zahtev.
        </ConfirmDialog>
      )}
    </div>
  );
}
