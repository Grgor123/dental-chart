import { useMemo, useRef, useState } from 'react';
import type { Service } from '../../hooks/usePriceList';
import { formatEur } from '../../../supabase/functions/_shared/invoice/render';

// Shared by the invoice draft and the predračun editor.
const CELL_INPUT =
  'w-full min-w-0 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm text-[var(--ink,#1c2624)] hover:border-[var(--line,#ccd6d4)] focus:border-[var(--accent,#2e6e62)] focus:bg-[var(--surface,#fff)] focus:outline-none';

// The permanent last row: type a name or code, pick a price-list service
// (click, or arrows + Enter) and it becomes a line; the box clears for the next.
export function ServicePicker({ services, onPick }: { services: Service[]; onPick: (service: Service) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const active = services.filter((s) => s.isActive);
    const found = q ? active.filter((s) => s.name.toLowerCase().includes(q) || (s.code ?? '').toLowerCase().includes(q)) : active;
    return found.slice(0, 8);
  }, [services, query]);

  function pick(service: Service) {
    onPick(service);
    setQuery('');
    setHighlight(0);
    inputRef.current?.focus();
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, matches.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter' && matches[highlight]) {
            e.preventDefault();
            pick(matches[highlight]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder="+ Dodaj storitev iz cenika (ime ali šifra) …"
        className={CELL_INPUT + ' placeholder:font-semibold placeholder:text-[var(--accent,#2e6e62)]'}
      />
      {open && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] shadow-lg">
          {matches.length === 0 && (
            <li className="px-3 py-2 text-sm italic text-[var(--muted,#6f7c79)]">
              {services.length === 0 ? 'Cenik je prazen — storitve dodajte v Nastavitve → Cenik.' : 'Ni zadetkov.'}
            </li>
          )}
          {matches.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm ${
                  i === highlight ? 'bg-[#eef6f4]' : 'hover:bg-[#f7faf9]'
                }`}
              >
                <span>
                  {s.code && <span className="mr-2 text-[var(--muted,#6f7c79)]">{s.code}</span>}
                  {s.name}
                </span>
                <span className="whitespace-nowrap text-[var(--ink-soft,#45524f)]">{formatEur(s.priceEur)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
