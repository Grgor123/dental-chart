import { useEffect, useMemo, useState } from 'react';
import { loadAcceptedPlanItems, itemTotal, type AcceptedPlanItem } from '../../hooks/useTreatmentPlans';
import { formatEur } from '../../../supabase/functions/_shared/invoice/render';

// "Dodaj iz predračuna" on an invoice draft (migration 061): the items of the
// patient's accepted predračuni (the chosen variant only) that aren't invoiced
// yet, all ticked, at the agreed price. Items already on this draft or on
// another (non-cancelled) invoice are shown greyed out.

interface PlanItemsDialogProps {
  patientId: string;
  /** Plan item ids already on this draft. */
  onThisInvoice: Set<string>;
  onAdd: (items: AcceptedPlanItem[]) => void;
  onClose: () => void;
}

export function PlanItemsDialog({ patientId, onThisInvoice, onAdd, onClose }: PlanItemsDialogProps) {
  const [items, setItems] = useState<AcceptedPlanItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    loadAcceptedPlanItems(patientId).then((result) => {
      if (cancelled) return;
      if (result.error) setError(result.error);
      const list = result.items ?? [];
      setItems(list);
      setTicked(new Set(list.filter((i) => !i.invoicedOn && !onThisInvoice.has(i.id)).map((i) => i.id)));
    });
    return () => {
      cancelled = true;
    };
  }, [patientId, onThisInvoice]);

  const byPlan = useMemo(() => {
    const groups = new Map<string, AcceptedPlanItem[]>();
    for (const item of items ?? []) {
      const key = `${item.planNumber}${item.variantName ? ` — ${item.variantName}` : ''}`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.entries()];
  }, [items]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-md bg-white p-5 shadow-xl">
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink,#1c2624)]">Dodaj iz predračuna</h2>
          <p className="text-xs text-[var(--muted,#6f7c79)]">Storitve iz sprejetih predračunov po dogovorjeni ceni.</p>
        </div>
        {error && <p className="text-sm text-[var(--danger,#b3261e)]">{error}</p>}
        {items === null && <p className="text-sm text-[var(--ink-soft,#45524f)]">Nalaganje …</p>}
        {items && items.length === 0 && <p className="text-sm italic text-[var(--muted,#6f7c79)]">Pacient nima sprejetih predračunov.</p>}
        {byPlan.map(([title, group]) => (
          <div key={title} className="flex flex-col gap-1">
            <div className="text-sm font-semibold text-[var(--ink,#1c2624)]">Predračun {title}</div>
            {group.map((item) => {
              const blocked = !!item.invoicedOn || onThisInvoice.has(item.id);
              return (
                <label key={item.id} className={`flex items-start gap-2 rounded px-2 py-1 text-sm ${blocked ? 'opacity-50' : 'hover:bg-[#f4f6f5]'}`}>
                  <input
                    type="checkbox"
                    disabled={blocked}
                    checked={ticked.has(item.id)}
                    onChange={(e) =>
                      setTicked((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(item.id);
                        else next.delete(item.id);
                        return next;
                      })
                    }
                    className="mt-1"
                  />
                  <span className="flex-1">
                    {item.name}
                    {item.toothFdi && <span className="text-[var(--muted,#6f7c79)]"> · zob {item.toothFdi}</span>}
                    {item.quantity !== 1 && <span className="text-[var(--muted,#6f7c79)]"> · {item.quantity} {item.unit}</span>}
                    {item.invoicedOn && <span className="block text-xs text-[var(--muted,#6f7c79)]">že zaračunano ({item.invoicedOn})</span>}
                    {!item.invoicedOn && onThisInvoice.has(item.id) && <span className="block text-xs text-[var(--muted,#6f7c79)]">že na tem računu</span>}
                  </span>
                  <span className="whitespace-nowrap font-medium">{formatEur(itemTotal(item))}</span>
                </label>
              );
            })}
          </div>
        ))}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-sm">
            Prekliči
          </button>
          <button
            type="button"
            disabled={ticked.size === 0}
            onClick={() => {
              onAdd((items ?? []).filter((i) => ticked.has(i.id)));
              onClose();
            }}
            className="rounded bg-[var(--accent,#2e6e62)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Dodaj na račun ({ticked.size})
          </button>
        </div>
      </div>
    </div>
  );
}
