import { useMemo, useState } from 'react';
import type { Service } from '../../hooks/usePriceList';
import type { ChartBillingVisit } from '../../hooks/useChartBilling';
import {
  chartLinkLabel,
  effectiveChartLink,
  workItemKey,
  type ChartWorkItem,
  type ServiceChartLinkRow,
} from '../../lib/chartBilling';

// Invoice draft → "Dodaj iz karte": what the chart says was done in the
// patient's recent visits, one row per item, each resolved to a price-list
// service through the Cenik's "Iz karte" links. A filling resolves by itself
// (its surface count picks the service); anything with several linked
// services needs a pick — never a silent default. A mark with no linked
// service offers the whole price list, and the pick can be saved as the link
// ("Poveži v ceniku") so it resolves by itself next time. Items already
// billed on another invoice are shown but can't be added again.

export interface ChartBillingPick {
  item: ChartWorkItem;
  service: Service;
  performedOn: string;
  /** Save this service as the chart mark's link in the Cenik. */
  saveLink: boolean;
}

interface ItemChoice {
  checked: boolean;
  serviceId: string;
  saveLink: boolean;
}

interface ChartBillingDialogProps {
  invoiceId: string;
  visits: ChartBillingVisit[];
  loading: boolean;
  error: string | null;
  services: Service[];
  links: ServiceChartLinkRow[];
  zzzsOn: boolean;
  /** performed_service ids already on this draft's (unsaved) lines. */
  onThisInvoice: Set<string>;
  onAdd: (picks: ChartBillingPick[]) => Promise<{ error?: string }>;
  onClose: () => void;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${Number(d)}. ${Number(m)}. ${y}`;
}

function formatEur(value: number): string {
  return `${value.toFixed(2).replace('.', ',')} €`;
}

export function ChartBillingDialog(props: ChartBillingDialogProps) {
  const { invoiceId, visits, loading, error, services, links, zzzsOn, onThisInvoice, onAdd, onClose } = props;

  // Active services per chart link ("filling:2" / "extraction").
  const candidatesFor = useMemo(() => {
    const byLink = new Map<string, Service[]>();
    for (const s of services) {
      if (!s.isActive) continue;
      const link = effectiveChartLink(s.id, s.zzzsCode, links, zzzsOn);
      if (!link) continue;
      const key = link.trigger === 'filling' ? `filling:${link.variant}` : link.trigger;
      byLink.set(key, [...(byLink.get(key) ?? []), s]);
    }
    return (item: ChartWorkItem) => byLink.get(item.trigger === 'filling' ? `filling:${item.variant}` : item.trigger) ?? [];
  }, [services, links, zzzsOn]);

  const allActive = useMemo(
    () => services.filter((s) => s.isActive).sort((a, b) => a.name.localeCompare(b.name, 'sl')),
    [services]
  );

  // Why an item can't be added, if it can't.
  const blockedReason = (visit: ChartBillingVisit, item: ChartWorkItem): string | null => {
    const ref = visit.performed.get(workItemKey(item));
    if (ref && onThisInvoice.has(ref.id)) return 'že na tem računu';
    if (ref?.billedOn && ref.billedOn.invoiceId !== invoiceId) return `že zaračunano${ref.billedOn.number ? ` (${ref.billedOn.number})` : ''}`;
    return null;
  };

  const [choice, setChoice] = useState<Map<string, ItemChoice>>(() => {
    const initial = new Map<string, ItemChoice>();
    for (const v of visits) {
      for (const item of v.items) {
        const candidates = candidatesFor(item);
        const ref = v.performed.get(workItemKey(item));
        const serviceId = ref?.serviceId && candidates.some((c) => c.id === ref.serviceId) ? ref.serviceId : candidates.length === 1 ? candidates[0].id : '';
        initial.set(workItemKey(item), {
          checked: item.confident && candidates.length > 0 && blockedReason(v, item) === null,
          serviceId,
          saveLink: true,
        });
      }
    }
    return initial;
  });
  const [busy, setBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  function update(key: string, patch: Partial<ItemChoice>) {
    setChoice((prev) => {
      const next = new Map(prev);
      next.set(key, { ...(prev.get(key) ?? { checked: false, serviceId: '', saveLink: true }), ...patch });
      return next;
    });
  }

  const picked = visits.flatMap((v) => v.items.map((item) => ({ v, item, c: choice.get(workItemKey(item)) }))).filter((p) => p.c?.checked);
  const missingService = picked.some((p) => !p.c?.serviceId);

  async function handleAdd() {
    const picks: ChartBillingPick[] = picked.flatMap(({ v, item, c }) => {
      const service = services.find((s) => s.id === c?.serviceId);
      // Only a pick from the whole list (no linked service) can be saved as a link.
      const saveLink = !!c?.saveLink && candidatesFor(item).length === 0;
      return service ? [{ item, service, performedOn: v.visitDate, saveLink }] : [];
    });
    setBusy(true);
    const result = await onAdd(picks);
    setBusy(false);
    if (result.error) setAddError(result.error);
    else onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-4xl flex-col gap-3 rounded-md bg-[var(--surface,#fff)] p-5 text-left shadow-xl"
      >
        <div>
          <h2 className="text-base font-bold text-[var(--ink,#1c2624)]">Dodaj iz karte</h2>
          <p className="text-xs text-[var(--muted,#6f7c79)]">
            Kar je bilo na zobni karti opravljeno v zadnjih obiskih. Označene postavke se dodajo na račun s ceno iz cenika. Neoznačene
            so morda le vpis obstoječega stanja — preverite jih.
          </p>
        </div>

        <div className="min-h-[160px] flex-1 overflow-y-auto rounded border border-[var(--line,#ccd6d4)]">
          {loading && <p className="p-3 text-sm text-[var(--muted,#6f7c79)]">Nalaganje …</p>}
          {error && <p className="p-3 text-sm text-[var(--danger,#b3261e)]">Napaka: {error}</p>}
          {!loading && !error && visits.length === 0 && (
            <p className="p-3 text-sm text-[var(--muted,#6f7c79)]">Na zobni karti v zadnjih 60 dneh ni opravljenih storitev za zaračunanje.</p>
          )}
          {!loading &&
            visits.map((v) => (
              <div key={v.visitId}>
                <div className="sticky top-0 bg-[#f7faf9] px-3 py-1.5 text-xs font-semibold text-[var(--ink-soft,#45524f)]">
                  Obisk {formatDate(v.visitDate)}
                  {!v.visitClosed && ' (odprt)'}
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {v.items.map((item) => {
                      const key = workItemKey(item);
                      const c = choice.get(key) ?? { checked: false, serviceId: '', saveLink: true };
                      const linked = candidatesFor(item);
                      // No linked service: offer the whole price list.
                      const candidates = linked.length > 0 ? linked : allActive;
                      const blocked = blockedReason(v, item);
                      const service = services.find((s) => s.id === c.serviceId);
                      return (
                        <tr key={key} className={`border-t border-[var(--line,#ccd6d4)] ${blocked ? 'opacity-50' : ''}`}>
                          <td className="w-8 px-3 py-1.5">
                            <input
                              type="checkbox"
                              disabled={!!blocked}
                              checked={c.checked}
                              onChange={(e) => update(key, { checked: e.target.checked })}
                            />
                          </td>
                          <td className="w-12 px-1 py-1.5 font-medium">{item.fdi ?? '—'}</td>
                          <td className="px-1 py-1.5">
                            {chartLinkLabel(item)}
                            {item.teethMeasured ? (
                              <span className="text-[var(--muted,#6f7c79)]"> · izmerjenih zob: {item.teethMeasured}</span>
                            ) : null}
                            {!item.confident && !blocked && (
                              <span className="block text-xs text-[#6b4a00]">Morda le vpis obstoječega stanja — preverite.</span>
                            )}
                          </td>
                          <td className="w-[45%] px-1 py-1.5">
                            {blocked ? (
                              <span className="text-xs text-[var(--muted,#6f7c79)]">{blocked}</span>
                            ) : candidates.length === 0 ? (
                              <span className="text-xs text-[var(--muted,#6f7c79)]">Cenik je prazen — dodajte storitve v Nastavitve → Cenik.</span>
                            ) : (
                              <>
                              <select
                                value={c.serviceId}
                                onChange={(e) => update(key, { serviceId: e.target.value, checked: e.target.value !== '' || c.checked })}
                                className={`w-full rounded border px-2 py-1 text-sm ${
                                  c.checked && !c.serviceId ? 'border-[var(--danger,#b3261e)]' : 'border-[var(--line,#ccd6d4)]'
                                }`}
                              >
                                <option value="">{linked.length > 0 ? 'Izberite storitev …' : 'Ni povezane storitve — izberite iz cenika …'}</option>
                                {candidates.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.code ? `${s.code} · ` : ''}
                                    {s.name}
                                  </option>
                                ))}
                              </select>
                              {linked.length === 0 && c.serviceId && (
                                <label
                                  className="mt-1 flex items-center gap-1.5 text-xs text-[var(--ink-soft,#45524f)]"
                                  title="Ta storitev se bo pri tej oznaki na karti naslednjič ponudila sama (Nastavitve → Cenik, stolpec »Iz karte«)."
                                >
                                  <input type="checkbox" checked={c.saveLink} onChange={(e) => update(key, { saveLink: e.target.checked })} />
                                  Poveži v ceniku ({chartLinkLabel(item)})
                                </label>
                              )}
                              </>
                            )}
                          </td>
                          <td className="w-24 px-3 py-1.5 text-right text-[var(--ink-soft,#45524f)]">{service ? formatEur(service.priceEur) : ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="flex-1 text-xs text-[var(--danger,#b3261e)]">
            {addError ?? (missingService ? 'Pri označenih postavkah izberite storitev.' : '')}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-sm text-[var(--ink,#1c2624)] hover:bg-[#f7faf9]"
          >
            Prekliči
          </button>
          <button
            type="button"
            disabled={picked.length === 0 || missingService || busy}
            onClick={handleAdd}
            className="rounded bg-[var(--accent,#2e6e62)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Dodajam …' : `Dodaj na račun (${picked.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
