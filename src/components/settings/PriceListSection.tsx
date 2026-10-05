import { useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { usePriceList, type Service, type ServiceCategory, type ServiceFields } from '../../hooks/usePriceList';

// Nastavitve → Cenik — a single editable table, spreadsheet-style: every
// field is edited directly in its cell (no popup for adding or editing),
// per Gregor's explicit request. Editing a cell saves on blur/Enter; the
// last row is a permanent "+" row — fill in a name and price and it becomes
// a real service, and a fresh blank row appears below it. Services are
// archived, never deleted (invoices will reference them later).
//
// Categories (supabase/migrations/020_add_price_list.sql — every practice
// starts with a starter set) are managed in a slim strip above the table,
// not a filtering sidebar — there used to be one, removed per Gregor's
// explicit request ("why are these categories needed at the left side").

const VAT_PRESETS = [0, 5, 9.5, 22];

const INPUT_CLASS =
  'w-full min-w-0 rounded border border-transparent bg-transparent px-2 py-1.5 text-sm text-[var(--ink,#1c2624)] hover:border-[var(--line,#ccd6d4)] focus:border-[var(--accent,#2e6e62)] focus:bg-[var(--surface,#fff)] focus:outline-none';

function formatVat(rate: number): string {
  return rate === 0 ? 'oproščeno' : `${String(rate).replace('.', ',')} %`;
}

// Accepts "12,50", "12.5" or "1 200,00"; rounds to cents. Null = not a valid,
// non-negative price.
function parsePrice(text: string): number | null {
  const normalized = text.replace(/\s/g, '').replace(',', '.');
  if (normalized === '') return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100) / 100;
}

function priceText(value: number): string {
  return String(value).replace('.', ',');
}

export function PriceListSection() {
  const {
    categories,
    services,
    loading,
    error,
    createCategory,
    renameCategory,
    deleteCategory,
    createService,
    updateService,
    setServiceActive,
  } = usePriceList();
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [categoryMessage, setCategoryMessage] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return services.filter((s) => {
      if (!showArchived && !s.isActive) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q) || (s.code ?? '').toLowerCase().includes(q);
    });
  }, [services, query, showArchived]);

  if (loading) return <p className="text-sm text-[var(--ink-soft,#45524f)]">Nalaganje …</p>;
  if (error) return <p className="text-sm text-[var(--danger,#b3261e)]">Napaka pri nalaganju: {error}</p>;

  return (
    <div className="flex flex-col gap-4">
      <CategoryStrip
        categories={categories}
        message={categoryMessage}
        onCreate={createCategory}
        onRename={renameCategory}
        onDelete={async (id) => {
          const result = await deleteCategory(id);
          setCategoryMessage(result.error ?? null);
        }}
      />

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Iskanje po nazivu ali šifri …"
          className="min-w-[200px] flex-1 rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-sm text-[var(--ink,#1c2624)]"
        />
        <label className="flex items-center gap-2 text-sm text-[var(--ink,#1c2624)]">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Prikaži arhivirane
        </label>
      </div>

      <div className="overflow-x-auto rounded border border-[var(--line,#ccd6d4)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#f7faf9] text-xs uppercase text-[var(--ink-soft,#45524f)]">
            <tr>
              <th className="px-2 py-2 font-semibold">Šifra</th>
              <th className="px-2 py-2 font-semibold">Naziv</th>
              <th className="px-2 py-2 font-semibold">Kategorija</th>
              <th className="px-2 py-2 text-right font-semibold">Cena</th>
              <th className="px-2 py-2 font-semibold">DDV</th>
              <th className="px-2 py-2 font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => (
              <ServiceRow
                key={s.id}
                service={s}
                categories={categories}
                onSave={(fields) => updateService(s.id, fields)}
                onSetActive={(active) => setServiceActive(s.id, active)}
              />
            ))}
            {visible.length === 0 && services.length > 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-[var(--muted,#6f7c79)]">
                  Ni storitev za ta iskalni niz.
                </td>
              </tr>
            )}
            <NewServiceRow categories={categories} onCreate={createService} />
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface CategoryStripProps {
  categories: ServiceCategory[];
  message: string | null;
  onCreate: (name: string) => Promise<{ error?: string }>;
  onRename: (id: string, name: string) => Promise<{ error?: string }>;
  onDelete: (id: string) => void;
}

// A slim management strip, not a filter — chips here don't affect the table
// below at all, they only exist so a category can be renamed or removed.
function CategoryStrip({ categories, message, onCreate, onRename, onDelete }: CategoryStripProps) {
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  // The category awaiting a "really delete?" confirmation — the ✕ only opens
  // the dialog, nothing is deleted until "Da" is clicked.
  const [pendingDelete, setPendingDelete] = useState<ServiceCategory | null>(null);

  async function handleAdd() {
    if (!newName.trim()) return;
    const result = await onCreate(newName);
    setLocalError(result.error ?? null);
    if (!result.error) setNewName('');
  }

  async function handleRename(id: string) {
    const result = await onRename(id, renameValue);
    setLocalError(result.error ?? null);
    if (!result.error) setRenamingId(null);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-[var(--ink-soft,#45524f)]">Kategorije</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {categories.map((c) =>
          renamingId === c.id ? (
            <input
              key={c.id}
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => handleRename(c.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setRenamingId(null);
              }}
              className="rounded-full border border-[var(--accent,#2e6e62)] px-2.5 py-1 text-xs text-[var(--ink,#1c2624)] outline-none"
            />
          ) : (
            <span
              key={c.id}
              className="flex items-center gap-1 rounded-full border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] pl-2.5 pr-1.5 py-1 text-xs text-[var(--ink,#1c2624)]"
            >
              <button
                type="button"
                onClick={() => {
                  setRenamingId(c.id);
                  setRenameValue(c.name);
                  setLocalError(null);
                }}
                title="Preimenuj"
              >
                {c.name}
              </button>
              <button
                type="button"
                onClick={() => setPendingDelete(c)}
                title="Izbriši kategorijo"
                className="flex h-4 w-4 items-center justify-center rounded-full text-[var(--muted,#6f7c79)] hover:bg-[#fdecea] hover:text-[var(--danger,#b3261e)]"
              >
                ✕
              </button>
            </span>
          ),
        )}
        <span className="flex items-center gap-1">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={handleAdd}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            placeholder="+ Nova kategorija"
            className="w-32 rounded-full border border-dashed border-[var(--line,#ccd6d4)] px-2.5 py-1 text-xs text-[var(--ink,#1c2624)] outline-none focus:border-[var(--accent,#2e6e62)]"
          />
        </span>
      </div>
      {(message || localError) && <p className="text-xs text-[var(--danger,#b3261e)]">{message ?? localError}</p>}
      {pendingDelete && (
        <ConfirmDialog
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            onDelete(pendingDelete.id);
            setPendingDelete(null);
          }}
        >
          Ali res želite izbrisati kategorijo <strong>{pendingDelete.name}</strong>?
        </ConfirmDialog>
      )}
    </div>
  );
}

interface ConfirmDialogProps {
  children: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
}

// A "do you really want to …?" safety fuse with Prekliči / Da — clicking the
// backdrop counts as Prekliči. Cancel gets focus so a stray Enter is harmless.
function ConfirmDialog({ children, onCancel, onConfirm }: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-4 rounded-md bg-[var(--surface,#fff)] p-5 text-left shadow-xl"
      >
        <p className="whitespace-normal text-sm text-[var(--ink,#1c2624)]">{children}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-sm text-[var(--ink,#1c2624)] hover:bg-[#f7faf9]"
          >
            Prekliči
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded bg-[var(--danger,#b3261e)] px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Da
          </button>
        </div>
      </div>
    </div>
  );
}

interface ServiceRowProps {
  service: Service;
  categories: ServiceCategory[];
  onSave: (fields: ServiceFields) => Promise<{ error?: string }>;
  onSetActive: (active: boolean) => Promise<{ error?: string }>;
}

// Every field commits independently on blur (text) or immediately on change
// (selects), compared against the last-saved snapshot so an unchanged field
// tabbed past never fires a write. Local state is seeded once from the
// service and never re-synced from props — after a successful save the
// service prop settles back to exactly this state anyway, and re-syncing
// would fight whatever the person is mid-typing in another field.
function ServiceRow({ service, categories, onSave, onSetActive }: ServiceRowProps) {
  const [name, setName] = useState(service.name);
  const [code, setCode] = useState(service.code ?? '');
  const [categoryId, setCategoryId] = useState(service.categoryId ?? '');
  const [priceStr, setPriceStr] = useState(priceText(service.priceEur));
  const [vatRate, setVatRate] = useState(service.vatRate);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const saved = useRef<ServiceFields>({
    name: service.name,
    code: service.code ?? '',
    categoryId: service.categoryId,
    description: service.description ?? '',
    priceEur: service.priceEur,
    vatRate: service.vatRate,
  });

  const vatOptions = VAT_PRESETS.includes(vatRate) ? VAT_PRESETS : [...VAT_PRESETS, vatRate].sort((a, b) => a - b);

  async function commit(next: Partial<ServiceFields>) {
    const fields: ServiceFields = { ...saved.current, ...next };
    const unchanged =
      fields.name === saved.current.name &&
      fields.code === saved.current.code &&
      fields.categoryId === saved.current.categoryId &&
      fields.priceEur === saved.current.priceEur &&
      fields.vatRate === saved.current.vatRate;
    if (unchanged) return;
    setBusy(true);
    const result = await onSave(fields);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setError(null);
    saved.current = fields;
  }

  function handleNameBlur() {
    if (!name.trim()) {
      setName(saved.current.name); // never allow an empty name
      return;
    }
    commit({ name: name.trim() });
  }

  function handlePriceBlur() {
    const parsed = parsePrice(priceStr);
    if (parsed === null) {
      setError('Neveljavna cena.');
      setPriceStr(priceText(saved.current.priceEur));
      return;
    }
    setPriceStr(priceText(parsed));
    commit({ priceEur: parsed });
  }

  function blurOnEnter(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') e.currentTarget.blur();
  }

  return (
    <tr className={`border-t border-[var(--line,#ccd6d4)] ${service.isActive ? '' : 'opacity-60'}`}>
      <td className="p-0.5">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onBlur={() => commit({ code })}
          onKeyDown={blurOnEnter}
          className={INPUT_CLASS}
        />
      </td>
      <td className="p-0.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleNameBlur}
          onKeyDown={blurOnEnter}
          className={INPUT_CLASS}
        />
      </td>
      <td className="p-0.5">
        <select
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            commit({ categoryId: e.target.value || null });
          }}
          className={INPUT_CLASS}
        >
          <option value="">Brez kategorije</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </td>
      <td className="p-0.5">
        <input
          value={priceStr}
          onChange={(e) => setPriceStr(e.target.value)}
          onBlur={handlePriceBlur}
          onKeyDown={blurOnEnter}
          inputMode="decimal"
          className={INPUT_CLASS + ' text-right'}
        />
      </td>
      <td className="p-0.5">
        <select
          value={vatRate}
          onChange={(e) => {
            const next = Number(e.target.value);
            setVatRate(next);
            commit({ vatRate: next });
          }}
          className={INPUT_CLASS}
        >
          {vatOptions.map((rate) => (
            <option key={rate} value={rate}>
              {formatVat(rate)}
            </option>
          ))}
        </select>
      </td>
      <td className="whitespace-nowrap p-0.5 pr-2 text-right">
        {error && <span className="mr-2 text-xs text-[var(--danger,#b3261e)]">{error}</span>}
        {busy && <span className="mr-2 text-xs text-[var(--muted,#6f7c79)]">…</span>}
        <button
          type="button"
          // Archiving asks first; restoring is harmless, so it stays one click.
          onClick={() => (service.isActive ? setConfirmingArchive(true) : onSetActive(true))}
          className="text-xs font-medium text-[var(--ink-soft,#45524f)] hover:text-[var(--accent,#2e6e62)]"
        >
          {service.isActive ? 'Arhiviraj' : 'Obnovi'}
        </button>
        {confirmingArchive && (
          <ConfirmDialog
            onCancel={() => setConfirmingArchive(false)}
            onConfirm={() => {
              onSetActive(false);
              setConfirmingArchive(false);
            }}
          >
            Ali res želite arhivirati storitev <strong>{service.name}</strong>?
          </ConfirmDialog>
        )}
      </td>
    </tr>
  );
}

interface NewServiceRowProps {
  categories: ServiceCategory[];
  onCreate: (fields: ServiceFields) => Promise<{ error?: string }>;
}

// The permanent last row — a "+" marker in the first cell, blank fields
// otherwise. Filling in a name and a valid price and leaving the row
// creates the service; the row then clears itself for the next one.
function NewServiceRow({ categories, onCreate }: NewServiceRowProps) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [priceStr, setPriceStr] = useState('');
  const [vatRate, setVatRate] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rowRef = useRef<HTMLTableRowElement>(null);

  function blurOnEnter(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') e.currentTarget.blur();
  }

  // Fires when focus leaves the whole row (not just one field) — so tabbing
  // from Šifra to Naziv doesn't trigger a premature, still-incomplete save.
  async function handleRowBlur(e: FocusEvent<HTMLTableRowElement>) {
    if (rowRef.current?.contains(e.relatedTarget as Node | null)) return;
    if (!name.trim() && !priceStr.trim() && !code.trim()) return; // nothing entered at all
    if (!name.trim()) {
      setError('Vnesite naziv, da dodate storitev.');
      return;
    }
    const price = parsePrice(priceStr);
    if (price === null) {
      setError('Vnesite veljavno ceno, da dodate storitev.');
      return;
    }
    setBusy(true);
    const result = await onCreate({ name, code, categoryId: categoryId || null, description: '', priceEur: price, vatRate });
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setError(null);
    setName('');
    setCode('');
    setCategoryId('');
    setPriceStr('');
    setVatRate(0);
  }

  return (
    <tr ref={rowRef} onBlur={handleRowBlur} className="border-t border-[var(--line,#ccd6d4)]">
      <td className="p-0.5">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={blurOnEnter}
          placeholder="+"
          className={
            INPUT_CLASS + ' text-center text-[var(--muted,#6f7c79)] placeholder:text-[var(--accent,#2e6e62)] placeholder:font-semibold'
          }
        />
      </td>
      <td className="p-0.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={blurOnEnter}
          placeholder="Nova storitev …"
          className={INPUT_CLASS + ' placeholder:text-[var(--muted,#6f7c79)]'}
        />
      </td>
      <td className="p-0.5">
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={INPUT_CLASS}>
          <option value="">Brez kategorije</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </td>
      <td className="p-0.5">
        <input
          value={priceStr}
          onChange={(e) => setPriceStr(e.target.value)}
          onKeyDown={blurOnEnter}
          inputMode="decimal"
          placeholder="0,00"
          className={INPUT_CLASS + ' text-right placeholder:text-[var(--muted,#6f7c79)]'}
        />
      </td>
      <td className="p-0.5">
        <select value={vatRate} onChange={(e) => setVatRate(Number(e.target.value))} className={INPUT_CLASS}>
          {VAT_PRESETS.map((rate) => (
            <option key={rate} value={rate}>
              {formatVat(rate)}
            </option>
          ))}
        </select>
      </td>
      <td className="whitespace-nowrap p-0.5 pr-2 text-right">
        {busy && <span className="text-xs text-[var(--muted,#6f7c79)]">Dodajam …</span>}
        {error && <span className="text-xs text-[var(--danger,#b3261e)]">{error}</span>}
      </td>
    </tr>
  );
}
