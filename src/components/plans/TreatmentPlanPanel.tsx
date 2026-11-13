import { useEffect, useMemo, useRef, useState } from 'react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ServicePicker } from '../invoices/ServicePicker';
import { usePracticeContext } from '../../contexts/PracticeContext';
import { usePriceList, type Service } from '../../hooks/usePriceList';
import { useInvoiceSettings } from '../../hooks/useInvoiceSettings';
import { useZzzsSetting } from '../../hooks/useZzzs';
import { logPatientAccess } from '../../hooks/useAuditLog';
import {
  PLAN_STATUS_LABELS,
  itemTotal,
  planStatus,
  useTreatmentPlan,
  variantTotal,
  type PlanDraft,
  type PlanItem,
  type PlanVariant,
} from '../../hooks/useTreatmentPlans';
import { plannedMarksFromChart, servicesForMark } from '../../lib/planSuggestions';
import { renderPlanPrintHtml } from '../../lib/planPrint';
import { printHtml } from '../../lib/printInvoice';
import type { EndoStage, SurfaceMap } from '../../types/dental';
import { formatEur } from '../../../supabase/functions/_shared/invoice/render';

// One predračun, edited in a panel on the patient record next to the live,
// editable chart (Gregor, 2026-11-13). A draft has one or more options
// ("Implantat" / "Most") with items picked from the price list. The doctor
// marks planned work on the chart as usual; each planned mark appears here as
// a suggestion with its linked Cenik service, added only with "Dodaj". Sending
// emails the predračun as a PDF with a button to confirm it; a phone yes is
// "Sprejet ustno". Confirmed = frozen; the items go on invoices with "Dodaj iz
// predračuna". Changes save by themselves.

interface TreatmentPlanPanelProps {
  planId: string;
  patientId: string;
  patientLabel: string;
  patientEmail: string | null;
  /** The live chart (PatientChart's state) — planned marks become suggestions. */
  surfacesByFdi: Record<string, SurfaceMap>;
  endoByFdi: Record<string, EndoStage>;
  onClose: () => void;
}

const CELL = 'w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-[var(--line,#ccd6d4)] focus:border-[var(--accent,#2e6e62)] focus:bg-white focus:outline-none';
const BUTTON = 'rounded border border-[var(--line,#ccd6d4)] px-3 py-1.5 text-sm text-[var(--ink,#1c2624)] hover:border-[var(--accent,#2e6e62)] disabled:opacity-50';
const PRIMARY = 'rounded bg-[var(--accent,#2e6e62)] px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50';
const AUTOSAVE_MS = 1200;

function parseNumber(value: string): number {
  const n = Number(value.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function shortDate(iso: string): string {
  return new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('sl-SI', { timeZone: 'Europe/Ljubljana' });
}

function itemFromService(service: Service, variantId: string, tooth: string | null): PlanItem {
  return {
    id: crypto.randomUUID(),
    variantId,
    serviceId: service.id,
    code: service.code,
    name: service.name,
    unit: service.unit,
    vatRate: service.vatRate,
    toothFdi: tooth,
    quantity: 1,
    unitPriceEur: service.priceEur,
    discountPercent: 0,
  };
}

export function TreatmentPlanPanel({ planId, patientId, patientLabel, patientEmail, surfacesByFdi, endoByFdi, onClose }: TreatmentPlanPanelProps) {
  const { practiceName } = usePracticeContext();
  const { plan, loading, error, reload, saveDraft, acceptVerbally, cancelPlan, sendByEmail, deletePlan } = useTreatmentPlan(planId);
  const { services, links } = usePriceList();
  const zzzs = useZzzsSetting();
  const { settings } = useInvoiceSettings();

  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [nextTooth, setNextTooth] = useState<string | null>(null);
  const [targetVariantId, setTargetVariantId] = useState<string | null>(null);
  const [pickFor, setPickFor] = useState<Record<string, string>>({});
  const [verbalOpen, setVerbalOpen] = useState(false);
  const [verbalVariant, setVerbalVariant] = useState('');
  const [confirm, setConfirm] = useState<'send' | 'cancel' | 'delete' | null>(null);

  const editable = !!plan && !plan.acceptedAt && !plan.cancelledAt;
  const status = plan ? planStatus(plan) : 'draft';

  // The editable copy follows the stored plan whenever nothing is being edited.
  const [loadedFor, setLoadedFor] = useState<unknown>(null);
  if (plan && plan !== loadedFor && !dirty && !saving) {
    setLoadedFor(plan);
    setDraft({ title: plan.title, note: plan.note ?? '', validUntil: plan.validUntil, variants: plan.variants });
  }

  // A confirmation made from the email link shows on returning to the window.
  useEffect(() => {
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [reload]);

  // Autosave shortly after the last change.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // Closing the panel some other way ("Nazaj na kartoteko") still saves what
  // the autosave hasn't yet.
  const pendingRef = useRef({ dirty, saveDraft });
  pendingRef.current = { dirty, saveDraft };
  useEffect(
    () => () => {
      const { dirty: unsaved, saveDraft: saveNow } = pendingRef.current;
      if (unsaved && draftRef.current) void saveNow(draftRef.current);
    },
    []
  );
  useEffect(() => {
    if (!dirty || !draft) return;
    const timer = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // save reads the latest draft through draftRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, dirty]);

  async function save(): Promise<boolean> {
    const current = draftRef.current;
    if (!current || !dirty) return true;
    setSaving(true);
    const result = await saveDraft(current);
    setSaving(false);
    if (result.error) {
      setNotice({ kind: 'error', text: `Shranjevanje ni uspelo: ${result.error}` });
      return false;
    }
    // Edits made while saving stay dirty and save next round.
    if (draftRef.current === current) setDirty(false);
    return true;
  }

  function change(next: PlanDraft) {
    setDraft(next);
    setDirty(true);
    setNotice(null);
  }
  function changeVariant(id: string, fn: (v: PlanVariant) => PlanVariant) {
    if (!draft) return;
    change({ ...draft, variants: draft.variants.map((v) => (v.id === id ? fn(v) : v)) });
  }
  function changeItem(variantId: string, itemId: string, fields: Partial<PlanItem>) {
    changeVariant(variantId, (v) => ({ ...v, items: v.items.map((i) => (i.id === itemId ? { ...i, ...fields } : i)) }));
  }
  function addService(variantId: string, service: Service, tooth: string | null) {
    changeVariant(variantId, (v) => ({ ...v, items: [...v.items, itemFromService(service, variantId, tooth)] }));
  }

  const target = draft?.variants.find((v) => v.id === targetVariantId) ?? draft?.variants[0] ?? null;
  const marks = useMemo(() => plannedMarksFromChart(surfacesByFdi, endoByFdi), [surfacesByFdi, endoByFdi]);

  async function print() {
    if (!(await save()) || !plan || !draft) return;
    void logPatientAccess(patientId, 'print', { document: 'predracun', number: plan.number });
    printHtml(
      renderPlanPrintHtml({
        practiceName: settings.legalName || practiceName || '',
        practiceLines: [settings.address, [settings.postalCode, settings.city].filter(Boolean).join(' '), settings.phone, settings.email],
        patientName: patientLabel,
        plan: editable ? { ...plan, ...draft, note: draft.note || null } : plan,
      })
    );
  }

  function emptyVariant(): string | null {
    return draft?.variants.find((v) => v.items.length === 0)?.name ?? null;
  }

  if (loading || !draft) {
    return <p className="text-sm text-[var(--ink-soft,#45524f)]">{error ? `Napaka: ${error}` : 'Nalaganje …'}</p>;
  }
  if (!plan) return <p className="text-sm text-[var(--danger,#b3261e)]">Predračuna ni mogoče najti.</p>;
  const variants = editable ? draft.variants : plan.variants;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-[var(--ink,#1c2624)]">
            Predračun {plan.number}{' '}
            <span
              className={`ml-1 rounded-full px-2 py-0.5 align-middle text-xs font-semibold ${
                status === 'accepted'
                  ? 'bg-[#e9f4f1] text-[var(--accent,#2e6e62)]'
                  : status === 'cancelled' || status === 'expired'
                    ? 'bg-[#eee] text-[var(--muted,#6f7c79)]'
                    : 'bg-[#fff1cc] text-[#8a5a00]'
              }`}
            >
              {PLAN_STATUS_LABELS[status]}
            </span>
          </h2>
          <p className="text-xs text-[var(--ink-soft,#45524f)]">
            {plan.createdByName ?? '—'}, {shortDate(plan.createdAt)}
            {plan.sentAt && ` · poslano ${shortDate(plan.sentAt)}`}
            {editable && ` · ${saving ? 'Shranjujem …' : dirty ? 'Neshranjeno' : 'Shranjeno'}`}
          </p>
        </div>
        <button
          type="button"
          onClick={async () => {
            if (await save()) onClose();
          }}
          className="rounded-full border border-[var(--ink,#1c2624)] px-3 py-1 text-xs font-semibold hover:border-[var(--accent,#2e6e62)] hover:text-[var(--accent,#2e6e62)]"
        >
          Zapri predračun
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={print} disabled={busy} className={BUTTON}>
          Natisni
        </button>
        {editable && (
          <>
            <button type="button" onClick={() => setVerbalOpen(true)} disabled={busy} className={BUTTON}>
              Sprejet ustno
            </button>
            <button
              type="button"
              disabled={busy || !patientEmail}
              title={!patientEmail ? 'Pacient nima e-poštnega naslova.' : undefined}
              onClick={() => {
                const empty = emptyVariant();
                if (empty) setNotice({ kind: 'error', text: `Možnost »${empty}« nima postavk — dodajte storitve ali jo odstranite.` });
                else setConfirm('send');
              }}
              className={PRIMARY}
            >
              {plan.sentAt ? 'Pošlji znova po e-pošti' : 'Pošlji pacientu po e-pošti'}
            </button>
          </>
        )}
        {/* Large screen only, on the buttons' line: the patient's details are
            hidden there while the predračun is open (a narrow screen still
            shows them). */}
        <span className="ml-auto hidden self-center text-lg font-bold text-[var(--ink,#1c2624)] min-[1400px]:flex">{patientLabel}</span>
      </div>

      {notice && <p className={`text-sm ${notice.kind === 'error' ? 'text-[var(--danger,#b3261e)]' : 'text-[var(--accent,#2e6e62)]'}`}>{notice.text}</p>}

      {plan.acceptedAt && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--accent,#2e6e62)] bg-[#f4f9f8] p-3 text-sm">
          {plan.signaturePng && <img src={plan.signaturePng} alt="Podpis pacienta" className="h-12 rounded bg-white" />}
          <div>
            <div className="font-semibold text-[var(--accent,#2e6e62)]">
              ✓ Potrjen{' '}
              {plan.acceptedVia === 'link' ? `po e-pošti — ${plan.signerName ?? patientLabel}` : `ustno — zabeležil/a ${plan.acceptedByName ?? '—'}`},{' '}
              {new Date(plan.acceptedAt).toLocaleString('sl-SI', { dateStyle: 'medium', timeStyle: 'short' })}
            </div>
            <div className="text-xs text-[var(--ink-soft,#45524f)]">Storitve dodate na račun z gumbom »Dodaj iz predračuna« na osnutku računa.</div>
          </div>
        </div>
      )}

      {editable && (
        <div className="flex flex-col gap-1.5 rounded-md border border-[var(--line,#ccd6d4)] bg-[#f8faf9] p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-bold text-[var(--ink,#1c2624)]">Predlogi s karte</h3>
            {draft.variants.length > 1 && target && <span className="text-xs text-[var(--muted,#6f7c79)]">Dodaja se v: {target.name}</span>}
          </div>
          {marks.length === 0 ? (
            <p className="text-xs text-[var(--muted,#6f7c79)]">Na karti označite, kaj je treba narediti (rdeče) — predlogi se prikažejo tukaj.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {marks.map((mark) => {
                const options = servicesForMark(mark, services, links, zzzs.enabled);
                const onPlan = !!target?.items.some((i) => i.toothFdi === mark.fdi && options.some((o) => o.id === i.serviceId));
                const chosen = options.find((o) => o.id === pickFor[mark.key]) ?? options[0];
                return (
                  <li key={mark.key} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="min-w-[150px]">
                      <span className="font-semibold">Zob {mark.fdi}</span> — {mark.label}
                    </span>
                    {onPlan ? (
                      <span className="text-xs text-[var(--accent,#2e6e62)]">✓ na predračunu</span>
                    ) : options.length === 0 ? (
                      <button type="button" onClick={() => setNextTooth(mark.fdi)} className="text-xs font-semibold text-[var(--accent,#2e6e62)] hover:underline">
                        Ni povezane storitve — izberi iz cenika
                      </button>
                    ) : (
                      <>
                        <span className="text-[var(--ink-soft,#45524f)]">→</span>
                        {options.length === 1 ? (
                          <span>
                            {chosen!.name} · {formatEur(chosen!.priceEur)}
                          </span>
                        ) : (
                          <select
                            value={chosen!.id}
                            onChange={(e) => setPickFor((prev) => ({ ...prev, [mark.key]: e.target.value }))}
                            className="max-w-[220px] rounded border border-[var(--line,#ccd6d4)] px-1.5 py-0.5 text-sm"
                          >
                            {options.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name} · {formatEur(o.priceEur)}
                              </option>
                            ))}
                          </select>
                        )}
                        <button
                          type="button"
                          disabled={!target}
                          onClick={() => target && addService(target.id, chosen!, mark.fdi)}
                          className="rounded bg-[var(--accent,#2e6e62)] px-2 py-0.5 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          Dodaj
                        </button>
                        <button type="button" onClick={() => setNextTooth(mark.fdi)} className="text-xs text-[var(--accent,#2e6e62)] hover:underline">
                          Druga storitev
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
        <label className="flex flex-col gap-1 text-xs text-[var(--ink-soft,#45524f)]">
          Naslov
          <input value={draft.title} disabled={!editable} onChange={(e) => change({ ...draft, title: e.target.value })} className="rounded border border-[var(--line,#ccd6d4)] px-2 py-1.5 text-sm text-[var(--ink,#1c2624)] disabled:bg-[#f4f6f5]" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--ink-soft,#45524f)]">
          Velja do
          <input type="date" value={draft.validUntil} disabled={!editable} onChange={(e) => change({ ...draft, validUntil: e.target.value })} className="rounded border border-[var(--line,#ccd6d4)] px-2 py-1.5 text-sm text-[var(--ink,#1c2624)] disabled:bg-[#f4f6f5]" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--ink-soft,#45524f)] sm:col-span-2">
          Opomba za pacienta (neobvezno)
          <textarea value={draft.note} disabled={!editable} onChange={(e) => change({ ...draft, note: e.target.value })} rows={2} className="rounded border border-[var(--line,#ccd6d4)] px-2 py-1.5 text-sm text-[var(--ink,#1c2624)] disabled:bg-[#f4f6f5]" />
        </label>
      </div>

      {variants.map((variant) => {
        const notChosen = !!plan.acceptedAt && variant.id !== plan.acceptedVariantId;
        const isAccepted = !!plan.acceptedAt && variant.id === plan.acceptedVariantId;
        const isTarget = editable && draft.variants.length > 1 && target?.id === variant.id;
        return (
          <div
            key={variant.id}
            onClick={() => editable && setTargetVariantId(variant.id)}
            className={`flex flex-col gap-2 rounded-md border bg-white p-3 ${
              isAccepted || isTarget ? 'border-[var(--accent,#2e6e62)]' : 'border-[var(--line,#ccd6d4)]'
            } ${notChosen ? 'opacity-50' : ''}`}
          >
            <div className="flex items-center gap-2">
              {editable ? (
                <input
                  value={variant.name}
                  onChange={(e) => changeVariant(variant.id, (v) => ({ ...v, name: e.target.value }))}
                  className="flex-1 rounded border border-transparent px-1.5 py-1 text-base font-semibold hover:border-[var(--line,#ccd6d4)] focus:border-[var(--accent,#2e6e62)] focus:outline-none"
                />
              ) : (
                <span className="flex-1 text-base font-semibold">
                  {variant.name}
                  {isAccepted && <span className="ml-2 text-xs text-[var(--accent,#2e6e62)]">✓ izbrano</span>}
                  {notChosen && <span className="ml-2 text-xs text-[var(--muted,#6f7c79)]">ni izbrano</span>}
                </span>
              )}
              {editable && draft.variants.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    change({ ...draft, variants: draft.variants.filter((v) => v.id !== variant.id) });
                  }}
                  className="text-xs text-[var(--danger,#b3261e)] hover:underline"
                >
                  Odstrani možnost
                </button>
              )}
            </div>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--line,#ccd6d4)] text-xs text-[var(--muted,#6f7c79)]">
                  <th className="py-1 pr-1 font-semibold">Storitev</th>
                  <th className="w-16 py-1 pr-1 font-semibold">Zob</th>
                  <th className="w-12 py-1 pr-1 text-right font-semibold">Kol.</th>
                  <th className="w-20 py-1 pr-1 text-right font-semibold">Cena</th>
                  <th className="w-14 py-1 pr-1 text-right font-semibold">Pop. %</th>
                  <th className="w-20 py-1 text-right font-semibold">Znesek</th>
                  {editable && <th className="w-5" />}
                </tr>
              </thead>
              <tbody>
                {variant.items.map((item) => (
                  <tr key={item.id} className="border-b border-[#eef2f1] align-top">
                    <td className="py-1 pr-1">
                      {item.name}
                      {isAccepted && (
                        <div className="text-[11px] text-[var(--muted,#6f7c79)]">
                          {plan.invoiced[item.id] ? `zaračunano (${plan.invoiced[item.id]})` : 'še ni zaračunano'}
                        </div>
                      )}
                    </td>
                    <td className="py-1 pr-1">
                      {editable ? <input value={item.toothFdi ?? ''} onChange={(e) => changeItem(variant.id, item.id, { toothFdi: e.target.value || null })} className={CELL} /> : item.toothFdi}
                    </td>
                    <td className="py-1 pr-1 text-right">
                      {editable ? (
                        <input
                          value={String(item.quantity).replace('.', ',')}
                          onChange={(e) => changeItem(variant.id, item.id, { quantity: Math.max(parseNumber(e.target.value), 0) })}
                          className={CELL + ' text-right'}
                        />
                      ) : (
                        item.quantity
                      )}
                    </td>
                    <td className="py-1 pr-1 text-right">
                      {editable ? (
                        <input
                          defaultValue={item.unitPriceEur.toFixed(2).replace('.', ',')}
                          onBlur={(e) => changeItem(variant.id, item.id, { unitPriceEur: Math.max(parseNumber(e.target.value), 0) })}
                          className={CELL + ' text-right'}
                        />
                      ) : (
                        formatEur(item.unitPriceEur)
                      )}
                    </td>
                    <td className="py-1 pr-1 text-right">
                      {editable ? (
                        <input
                          value={item.discountPercent ? String(item.discountPercent).replace('.', ',') : ''}
                          onChange={(e) => changeItem(variant.id, item.id, { discountPercent: Math.min(Math.max(parseNumber(e.target.value), 0), 100) })}
                          className={CELL + ' text-right'}
                        />
                      ) : item.discountPercent ? (
                        `${item.discountPercent} %`
                      ) : (
                        ''
                      )}
                    </td>
                    <td className="py-1 text-right font-medium">{formatEur(itemTotal(item))}</td>
                    {editable && (
                      <td className="py-1 text-right">
                        <button
                          type="button"
                          onClick={() => changeVariant(variant.id, (v) => ({ ...v, items: v.items.filter((i) => i.id !== item.id) }))}
                          title="Odstrani postavko"
                          className="text-[var(--muted,#6f7c79)] hover:text-[var(--danger,#b3261e)]"
                        >
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {editable && (
                  <tr>
                    <td colSpan={7} className="pt-1">
                      <ServicePicker
                        services={services}
                        onPick={(s) => {
                          addService(variant.id, s, nextTooth);
                          setNextTooth(null);
                        }}
                      />
                      {nextTooth && <div className="mt-1 text-xs text-[var(--accent,#2e6e62)]">Naslednja dodana storitev bo za zob {nextTooth}.</div>}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="text-right text-base font-semibold">Skupaj: {formatEur(variantTotal(variant))}</div>
          </div>
        );
      })}

      {editable && (
        <button
          type="button"
          onClick={() => {
            const id = crypto.randomUUID();
            change({
              ...draft,
              variants: [
                ...draft.variants.map((v, i) => (draft.variants.length === 1 && i === 0 && v.name === 'Predlagano zdravljenje' ? { ...v, name: 'Možnost 1' } : v)),
                { id, name: `Možnost ${draft.variants.length + 1}`, items: [] },
              ],
            });
            setTargetVariantId(id);
          }}
          className="self-start rounded border border-dashed border-[var(--accent,#2e6e62)] px-3 py-1.5 text-sm font-semibold text-[var(--accent,#2e6e62)] hover:bg-[#f4f9f8]"
        >
          + Dodaj možnost (alternativo)
        </button>
      )}

      {(editable || plan.acceptedAt) && (
        <div className="flex gap-3 border-t border-[var(--line,#ccd6d4)] pt-2 text-sm">
          {editable && !plan.sentAt ? (
            <button type="button" onClick={() => setConfirm('delete')} className="text-[var(--danger,#b3261e)] hover:underline">
              Izbriši osnutek
            </button>
          ) : (
            <button type="button" onClick={() => setConfirm('cancel')} className="text-[var(--danger,#b3261e)] hover:underline">
              Prekliči predračun
            </button>
          )}
        </div>
      )}

      {verbalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={() => setVerbalOpen(false)}>
          <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} className="flex w-full max-w-sm flex-col gap-3 rounded-md bg-white p-5 shadow-xl">
            <h2 className="text-lg font-semibold">Pacient je predračun sprejel ustno</h2>
            {draft.variants.length > 1 && (
              <label className="flex flex-col gap-1 text-xs text-[var(--ink-soft,#45524f)]">
                Izbrana možnost
                <select value={verbalVariant} onChange={(e) => setVerbalVariant(e.target.value)} className="rounded border border-[var(--line,#ccd6d4)] px-2 py-1.5 text-sm">
                  <option value="">Izberite …</option>
                  {draft.variants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} — {formatEur(variantTotal(v))}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="text-xs text-[var(--muted,#6f7c79)]">Npr. po telefonu. Zabeleženo bo z vašim imenom; po sprejemu predračuna ni več mogoče spreminjati.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setVerbalOpen(false)} className={BUTTON}>
                Prekliči
              </button>
              <button
                type="button"
                disabled={busy || (draft.variants.length > 1 && !verbalVariant)}
                onClick={async () => {
                  const variantId = draft.variants.length > 1 ? verbalVariant : draft.variants[0]?.id;
                  if (!variantId || draft.variants.find((v) => v.id === variantId)?.items.length === 0) {
                    setNotice({ kind: 'error', text: 'Izbrana možnost nima postavk.' });
                    setVerbalOpen(false);
                    return;
                  }
                  if (!(await save())) return;
                  setBusy(true);
                  const result = await acceptVerbally(variantId);
                  setBusy(false);
                  setVerbalOpen(false);
                  setNotice(result.error ? { kind: 'error', text: result.error } : { kind: 'ok', text: 'Predračun je sprejet.' });
                }}
                className={PRIMARY}
              >
                Zabeleži sprejem
              </button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          onCancel={() => setConfirm(null)}
          confirmLabel={confirm === 'send' ? 'Pošlji' : confirm === 'delete' ? 'Izbriši' : 'Prekliči predračun'}
          onConfirm={async () => {
            const which = confirm;
            setConfirm(null);
            if (!(await save())) return;
            setBusy(true);
            if (which === 'send') {
              const result = await sendByEmail();
              setBusy(false);
              setNotice(
                result.error
                  ? { kind: 'error', text: result.error }
                  : { kind: 'ok', text: `Predračun poslan na ${result.sentTo ?? patientEmail}. Pacient ga potrdi z gumbom v e-pošti.` }
              );
              return;
            }
            const result = which === 'delete' ? await deletePlan() : await cancelPlan();
            setBusy(false);
            if (result.error) setNotice({ kind: 'error', text: result.error });
            else if (which === 'delete') onClose();
          }}
        >
          {confirm === 'send'
            ? `Poslati predračun ${plan.number} na ${patientEmail}? Predračun bo priložen kot PDF; pacient ga potrdi z gumbom v e-pošti.`
            : confirm === 'delete'
              ? `Izbrisati osnutek predračuna ${plan.number}?`
              : `Preklicati predračun ${plan.number}? Povezava, poslana pacientu, ne bo več delovala.`}
        </ConfirmDialog>
      )}
    </div>
  );
}
