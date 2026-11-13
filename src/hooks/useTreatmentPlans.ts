import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePracticeContext } from '../contexts/PracticeContext';

// Treatment plans / predračun (migration 061): a patient's plans (the record's
// "Predračuni" tab), one plan's editing and actions (TreatmentPlanPanel on the
// patient record) and the accepted items still to invoice ("Dodaj iz
// predračuna"). The chart's planned marks as suggestions: lib/planSuggestions.ts.

export interface PlanItem {
  id: string;
  variantId: string;
  serviceId: string | null;
  code: string | null;
  name: string;
  unit: string;
  vatRate: number;
  toothFdi: string | null;
  quantity: number;
  unitPriceEur: number;
  discountPercent: number;
}

export interface PlanVariant {
  id: string;
  name: string;
  items: PlanItem[];
}

export interface TreatmentPlan {
  id: string;
  patientId: string;
  number: string;
  title: string;
  note: string | null;
  validUntil: string;
  createdAt: string;
  createdByName: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  acceptedVariantId: string | null;
  acceptedVia: 'link' | 'verbal' | null;
  acceptedByName: string | null;
  signerName: string | null;
  signaturePng: string | null;
  cancelledAt: string | null;
  variants: PlanVariant[];
  /** Item id → number of the (non-cancelled) invoice it's on. */
  invoiced: Record<string, string>;
}

export type PlanStatus = 'draft' | 'sent' | 'accepted' | 'cancelled' | 'expired';

export function todayIso(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Ljubljana' });
}

export function planStatus(plan: Pick<TreatmentPlan, 'acceptedAt' | 'cancelledAt' | 'validUntil' | 'sentAt'>): PlanStatus {
  if (plan.cancelledAt) return 'cancelled';
  if (plan.acceptedAt) return 'accepted';
  if (plan.validUntil < todayIso()) return 'expired';
  return plan.sentAt ? 'sent' : 'draft';
}

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  draft: 'Osnutek',
  sent: 'Poslano pacientu',
  accepted: 'Sprejet',
  cancelled: 'Preklican',
  expired: 'Potekel',
};

export function itemTotal(item: Pick<PlanItem, 'quantity' | 'unitPriceEur' | 'discountPercent'>): number {
  return Math.round(item.quantity * item.unitPriceEur * (1 - item.discountPercent / 100) * 100) / 100;
}

export function variantTotal(variant: PlanVariant): number {
  return Math.round(variant.items.reduce((sum, i) => sum + itemTotal(i), 0) * 100) / 100;
}

type Row = Record<string, unknown>;

const PLAN_SELECT =
  'id, patient_id, number, title, note, valid_until, created_at, created_by_name, sent_at, accepted_at, accepted_variant_id, accepted_via, accepted_by_name, signer_name, signature_png, cancelled_at, ' +
  'treatment_plan_variants!treatment_plan_variants_plan_id_fkey(id, name, sort_order), ' +
  'treatment_plan_items(id, variant_id, service_id, code, name, unit, vat_rate, tooth_fdi, quantity, unit_price_eur, discount_percent, sort_order)';

function rowToPlan(row: Row, invoiced: Record<string, string>): TreatmentPlan {
  const items = ((row.treatment_plan_items as Row[] | null) ?? [])
    .slice()
    .sort((a, b) => (a.sort_order as number) - (b.sort_order as number))
    .map((i) => ({
      id: i.id as string,
      variantId: i.variant_id as string,
      serviceId: (i.service_id as string | null) ?? null,
      code: (i.code as string | null) ?? null,
      name: i.name as string,
      unit: i.unit as string,
      vatRate: Number(i.vat_rate),
      toothFdi: (i.tooth_fdi as string | null) ?? null,
      quantity: Number(i.quantity),
      unitPriceEur: Number(i.unit_price_eur),
      discountPercent: Number(i.discount_percent),
    }));
  const variants = ((row.treatment_plan_variants as Row[] | null) ?? [])
    .slice()
    .sort((a, b) => (a.sort_order as number) - (b.sort_order as number))
    .map((v) => ({ id: v.id as string, name: v.name as string, items: items.filter((i) => i.variantId === v.id) }));
  return {
    id: row.id as string,
    patientId: row.patient_id as string,
    number: row.number as string,
    title: row.title as string,
    note: (row.note as string | null) ?? null,
    validUntil: row.valid_until as string,
    createdAt: row.created_at as string,
    createdByName: (row.created_by_name as string | null) ?? null,
    sentAt: (row.sent_at as string | null) ?? null,
    acceptedAt: (row.accepted_at as string | null) ?? null,
    acceptedVariantId: (row.accepted_variant_id as string | null) ?? null,
    acceptedVia: (row.accepted_via as 'link' | 'verbal' | null) ?? null,
    acceptedByName: (row.accepted_by_name as string | null) ?? null,
    signerName: (row.signer_name as string | null) ?? null,
    signaturePng: (row.signature_png as string | null) ?? null,
    cancelledAt: (row.cancelled_at as string | null) ?? null,
    variants,
    invoiced,
  };
}

/** Item id → invoice number, for items on a non-cancelled invoice (credit notes don't count). */
async function loadInvoiced(itemIds: string[]): Promise<Record<string, string>> {
  if (itemIds.length === 0) return {};
  const { data } = await supabase
    .from('invoice_lines')
    .select('treatment_plan_item_id, invoices!inner(number, kind, cancelled_at)')
    .in('treatment_plan_item_id', itemIds)
    .eq('invoices.kind', 'invoice')
    .is('invoices.cancelled_at', null);
  const map: Record<string, string> = {};
  for (const l of (data ?? []) as Row[]) {
    const inv = l.invoices as { number: string | null };
    map[l.treatment_plan_item_id as string] = inv.number ?? 'osnutek';
  }
  return map;
}

async function loadPlans(filter: { patientId?: string; planId?: string }): Promise<{ plans?: TreatmentPlan[]; error?: string }> {
  let query = supabase.from('treatment_plans').select(PLAN_SELECT).order('created_at', { ascending: false });
  if (filter.patientId) query = query.eq('patient_id', filter.patientId);
  if (filter.planId) query = query.eq('id', filter.planId);
  const { data, error } = await query;
  if (error) return { error: error.message };
  const rows = (data ?? []) as unknown as Row[];
  const itemIds = rows.flatMap((r) => ((r.treatment_plan_items as Row[] | null) ?? []).map((i) => i.id as string));
  const invoiced = await loadInvoiced(itemIds);
  return { plans: rows.map((r) => rowToPlan(r, invoiced)) };
}

/** A patient's plans, newest first. */
export function usePatientPlans(patientId: string) {
  const { practiceId } = usePracticeContext();
  const [plans, setPlans] = useState<TreatmentPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadPlans({ patientId }).then((result) => {
      if (cancelled) return;
      setError(result.error ?? null);
      if (result.plans) setPlans(result.plans);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [patientId, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [reload]);

  /** A new plan with one empty variant; returns its id. */
  const createPlan = useCallback(async (): Promise<{ id?: string; error?: string }> => {
    const { data, error: insertError } = await supabase
      .from('treatment_plans')
      .insert({ patient_id: patientId, practice_id: practiceId })
      .select('id')
      .single();
    if (insertError) return { error: insertError.message };
    const { error: variantError } = await supabase
      .from('treatment_plan_variants')
      .insert({ plan_id: data.id, practice_id: practiceId, name: 'Predlagano zdravljenje', sort_order: 0 });
    if (variantError) return { error: variantError.message };
    reload();
    return { id: data.id as string };
  }, [patientId, practiceId, reload]);

  return { plans, loading, error, reload, createPlan };
}

export interface PlanDraft {
  title: string;
  note: string;
  validUntil: string;
  variants: PlanVariant[];
}

/** One plan: load, save the draft, accept, cancel, link, email, delete. */
export function useTreatmentPlan(planId: string) {
  const { practiceId } = usePracticeContext();
  const [plan, setPlan] = useState<TreatmentPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadPlans({ planId }).then((result) => {
      if (cancelled) return;
      setError(result.error ?? null);
      setPlan(result.plans?.[0] ?? null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [planId, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  /** Saves a draft: plan fields, then variants and items (upserted by id),
   *  then removes what's no longer there — new rows first, so a failed save
   *  never empties the plan. */
  const saveDraft = useCallback(
    async (draft: PlanDraft): Promise<{ error?: string }> => {
      if (!plan) return { error: 'Predračun ni naložen.' };
      const { error: planError } = await supabase
        .from('treatment_plans')
        .update({ title: draft.title.trim() || 'Predračun', note: draft.note.trim() || null, valid_until: draft.validUntil })
        .eq('id', planId);
      if (planError) return { error: planError.message };
      if (draft.variants.length > 0) {
        const { error: variantError } = await supabase.from('treatment_plan_variants').upsert(
          draft.variants.map((v, i) => ({ id: v.id, plan_id: planId, practice_id: practiceId, name: v.name.trim() || `Možnost ${i + 1}`, sort_order: i }))
        );
        if (variantError) return { error: variantError.message };
      }
      const items = draft.variants.flatMap((v) =>
        v.items.map((it, i) => ({
          id: it.id,
          plan_id: planId,
          variant_id: v.id,
          practice_id: practiceId,
          service_id: it.serviceId,
          code: it.code,
          name: it.name,
          unit: it.unit,
          vat_rate: it.vatRate,
          tooth_fdi: it.toothFdi?.trim() || null,
          quantity: it.quantity,
          unit_price_eur: it.unitPriceEur,
          discount_percent: it.discountPercent,
          sort_order: i,
        }))
      );
      if (items.length > 0) {
        const { error: itemError } = await supabase.from('treatment_plan_items').upsert(items);
        if (itemError) return { error: itemError.message };
      }
      const keepItems = new Set(items.map((i) => i.id));
      const goneItems = plan.variants.flatMap((v) => v.items.map((i) => i.id)).filter((id) => !keepItems.has(id));
      if (goneItems.length > 0) {
        const { error: deleteError } = await supabase.from('treatment_plan_items').delete().in('id', goneItems);
        if (deleteError) return { error: deleteError.message };
      }
      const keepVariants = new Set(draft.variants.map((v) => v.id));
      const goneVariants = plan.variants.map((v) => v.id).filter((id) => !keepVariants.has(id));
      if (goneVariants.length > 0) {
        const { error: deleteError } = await supabase.from('treatment_plan_variants').delete().in('id', goneVariants);
        if (deleteError) return { error: deleteError.message };
      }
      reload();
      return {};
    },
    [plan, planId, practiceId, reload]
  );

  const rpc = useCallback(
    async (name: string, args: Record<string, unknown>): Promise<{ error?: string }> => {
      const { error: rpcError } = await supabase.rpc(name, args);
      if (rpcError) return { error: rpcError.message };
      reload();
      return {};
    },
    [reload]
  );

  const acceptVerbally = useCallback((variantId: string) => rpc('accept_treatment_plan_verbally', { p_plan_id: planId, p_variant_id: variantId }), [rpc, planId]);
  const cancelPlan = useCallback(() => rpc('cancel_treatment_plan', { p_plan_id: planId }), [rpc, planId]);

  const sendByEmail = useCallback(async (): Promise<{ sentTo?: string; error?: string }> => {
    const { data, error: fnError } = await supabase.functions.invoke('send-treatment-plan', { body: { planId } });
    if (fnError) {
      let message = fnError.message;
      const context = (fnError as { context?: Response }).context;
      if (context && typeof context.json === 'function') {
        const payload = await context.json().catch(() => null);
        if (payload?.error) message = payload.error;
      }
      return { error: message };
    }
    reload();
    return { sentTo: (data as { sentTo?: string }).sentTo };
  }, [planId, reload]);

  const deletePlan = useCallback(async (): Promise<{ error?: string }> => {
    const { error: deleteError } = await supabase.from('treatment_plans').delete().eq('id', planId);
    if (deleteError) return { error: deleteError.message };
    return {};
  }, [planId]);

  return { plan, loading, error, reload, saveDraft, acceptVerbally, cancelPlan, sendByEmail, deletePlan };
}

export interface AcceptedPlanItem extends PlanItem {
  planId: string;
  planNumber: string;
  variantName: string;
  /** Invoice number if already on a non-cancelled invoice. */
  invoicedOn: string | null;
}

/** "Dodaj iz predračuna": every item of the patient's accepted plans (the
 *  chosen variant only), with whether it's invoiced already. */
export async function loadAcceptedPlanItems(patientId: string): Promise<{ items?: AcceptedPlanItem[]; error?: string }> {
  const result = await loadPlans({ patientId });
  if (result.error) return { error: result.error };
  const items: AcceptedPlanItem[] = [];
  for (const plan of result.plans ?? []) {
    if (!plan.acceptedAt || plan.cancelledAt) continue;
    const variant = plan.variants.find((v) => v.id === plan.acceptedVariantId);
    if (!variant) continue;
    for (const item of variant.items) {
      items.push({ ...item, planId: plan.id, planNumber: plan.number, variantName: variant.name, invoicedOn: plan.invoiced[item.id] ?? null });
    }
  }
  return { items };
}
