import { useMemo, useState } from 'react';
import type { ServiceCategory, ZzzsServiceToAdd } from '../../hooks/usePriceList';
import type { ZzzsEntry } from '../../hooks/useZzzs';

// Nastavitve → Cenik → "+ Iz šifranta ZZZS": search the shared ZZZS dental
// catalogue, tick codes, add them as services in one go. The practice sets
// each price afterwards in the table (new rows are highlighted until then).

interface ZzzsPickerDialogProps {
  entries: Map<string, ZzzsEntry>;
  loading: boolean;
  error: string | null;
  /** ZZZS codes some service in the price list already carries. */
  usedCodes: Set<string>;
  categories: ServiceCategory[];
  onAdd: (items: ZzzsServiceToAdd[], categoryId: string | null) => Promise<{ error?: string }>;
  onClose: () => void;
}

// The adult lists cover most of a general practice's work, so they come first.
const PREFERRED_LISTS = ['15.119', '15.120'];
const MAX_SHOWN = 200;

export function ZzzsPickerDialog({ entries, loading, error, usedCodes, categories, onAdd, onClose }: ZzzsPickerDialogProps) {
  const [query, setQuery] = useState('');
  const [listFilter, setListFilter] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const lists = useMemo(() => {
    const byCode = new Map<string, string>();
    for (const e of entries.values()) for (const l of e.lists) byCode.set(l.code, l.name);
    const rank = (code: string) => (PREFERRED_LISTS.includes(code) ? PREFERRED_LISTS.indexOf(code) : 99);
    return [...byCode.entries()]
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => rank(a.code) - rank(b.code) || a.code.localeCompare(b.code, 'sl', { numeric: true }));
  }, [entries]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...entries.values()].filter((e) => {
      if (listFilter && !e.lists.some((l) => l.code === listFilter)) return false;
      if (!q) return true;
      return e.code.toLowerCase().includes(q) || e.shortName.toLowerCase().includes(q);
    });
  }, [entries, query, listFilter]);

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  async function handleAdd() {
    const items = [...selected].map((code) => ({ zzzsCode: code, name: entries.get(code)?.shortName ?? code }));
    setBusy(true);
    const result = await onAdd(items, categoryId || null);
    setBusy(false);
    if (result.error) {
      setSaveError(result.error);
      return;
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col gap-3 rounded-md bg-[var(--surface,#fff)] p-5 text-left shadow-xl"
      >
        <div>
          <h2 className="text-base font-bold text-[var(--ink,#1c2624)]">Dodaj storitve iz šifranta ZZZS</h2>
          <p className="text-xs text-[var(--muted,#6f7c79)]">
            Označite storitve in jih dodajte v cenik. Ceno vsake storitve nato vpišete v tabeli.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Iskanje po šifri ali nazivu …"
            className="min-w-[200px] flex-1 rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-sm text-[var(--ink,#1c2624)]"
          />
          <select
            value={listFilter}
            onChange={(e) => setListFilter(e.target.value)}
            className="max-w-[320px] rounded border border-[var(--line,#ccd6d4)] px-2 py-2 text-sm text-[var(--ink,#1c2624)]"
          >
            <option value="">Vsi seznami</option>
            {lists.map((l) => (
              <option key={l.code} value={l.code}>
                {l.code} — {l.name}
              </option>
            ))}
          </select>
        </div>

        <div className="min-h-[200px] flex-1 overflow-y-auto rounded border border-[var(--line,#ccd6d4)]">
          {loading && <p className="p-3 text-sm text-[var(--muted,#6f7c79)]">Nalaganje šifranta …</p>}
          {error && <p className="p-3 text-sm text-[var(--danger,#b3261e)]">Napaka pri nalaganju šifranta: {error}</p>}
          {!loading && !error && entries.size === 0 && (
            <p className="p-3 text-sm text-[var(--muted,#6f7c79)]">Šifrant ZZZS še ni naložen.</p>
          )}
          {!loading && !error && entries.size > 0 && results.length === 0 && (
            <p className="p-3 text-sm text-[var(--muted,#6f7c79)]">Ni zadetkov.</p>
          )}
          <ul>
            {results.slice(0, MAX_SHOWN).map((e) => {
              const used = usedCodes.has(e.code);
              return (
                <li key={e.code} className="border-b border-[var(--line,#ccd6d4)] last:border-b-0">
                  <label
                    className={`flex items-start gap-3 px-3 py-2 text-sm ${used ? 'opacity-50' : 'cursor-pointer hover:bg-[#f7faf9]'}`}
                    title={e.lists.map((l) => `${l.code} — ${l.name}`).join('\n')}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      disabled={used}
                      checked={selected.has(e.code)}
                      onChange={() => toggle(e.code)}
                    />
                    <span className="w-14 shrink-0 font-mono text-xs leading-5 text-[var(--ink-soft,#45524f)]">{e.code}</span>
                    <span className="flex-1 text-[var(--ink,#1c2624)]">{e.shortName}</span>
                    <span className="shrink-0 text-xs text-[var(--muted,#6f7c79)]">
                      {used ? 'že v ceniku' : e.lists.map((l) => l.code).join(', ')}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {results.length > MAX_SHOWN && (
            <p className="p-3 text-xs text-[var(--muted,#6f7c79)]">
              Prikazanih je prvih {MAX_SHOWN} od {results.length} zadetkov — zožite iskanje.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-[var(--ink,#1c2624)]">
            Kategorija:
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="rounded border border-[var(--line,#ccd6d4)] px-2 py-1.5 text-sm"
            >
              <option value="">Brez kategorije</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <span className="flex-1 text-xs text-[var(--danger,#b3261e)]">{saveError}</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-sm text-[var(--ink,#1c2624)] hover:bg-[#f7faf9]"
          >
            Prekliči
          </button>
          <button
            type="button"
            disabled={selected.size === 0 || busy}
            onClick={handleAdd}
            className="rounded bg-[var(--accent,#2e6e62)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Dodajam …' : `Dodaj izbrane (${selected.size})`}
          </button>
        </div>
      </div>
    </div>
  );
}
