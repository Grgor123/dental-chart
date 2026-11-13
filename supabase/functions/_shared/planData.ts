// A predračun with its options and items, plus the practice header — shared by
// send-treatment-plan (the email with the PDF attached) and treatment-plan
// (the patient's page and the copy after confirming). Migration 061.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { planLineTotal, type PlanPdfAcceptance, type PlanPdfInput, type PlanPdfItem } from './planPdf.ts';

export interface PlanItemRow {
  id: string;
  variant_id: string;
  code: string | null;
  name: string;
  unit: string;
  vat_rate: number;
  tooth_fdi: string | null;
  quantity: number;
  unit_price_eur: number;
  discount_percent: number;
  sort_order: number;
}

export interface PlanRow {
  id: string;
  practice_id: string;
  patient_id: string;
  number: string;
  title: string;
  note: string | null;
  valid_until: string;
  created_at: string;
  token: string;
  accepted_at: string | null;
  cancelled_at: string | null;
  patients: { first_name: string; last_name: string } | null;
  practices: { name: string } | null;
  treatment_plan_variants: { id: string; name: string; sort_order: number }[];
  treatment_plan_items: PlanItemRow[];
}

const SELECT =
  'id, practice_id, patient_id, number, title, note, valid_until, created_at, token, accepted_at, cancelled_at, patients(first_name, last_name), practices(name), ' +
  'treatment_plan_variants!treatment_plan_variants_plan_id_fkey(id, name, sort_order), ' +
  'treatment_plan_items(id, variant_id, code, name, unit, vat_rate, tooth_fdi, quantity, unit_price_eur, discount_percent, sort_order)';

export async function loadPlan(supabase: SupabaseClient, by: { token?: string; id?: string }): Promise<PlanRow | null> {
  let query = supabase.from('treatment_plans').select(SELECT);
  query = by.token ? query.eq('token', by.token) : query.eq('id', by.id ?? '');
  const { data } = await query.maybeSingle();
  return (data as unknown as PlanRow | null) ?? null;
}

export function patientNameOf(plan: PlanRow): string {
  return plan.patients ? `${plan.patients.first_name} ${plan.patients.last_name}`.trim() : '';
}

export function itemsOf(plan: PlanRow, variantId: string): PlanPdfItem[] {
  return plan.treatment_plan_items
    .filter((i) => i.variant_id === variantId)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((i) => ({
      name: i.name,
      code: i.code,
      toothFdi: i.tooth_fdi,
      quantity: Number(i.quantity),
      unit: i.unit,
      unitPriceEur: Number(i.unit_price_eur),
      discountPercent: Number(i.discount_percent),
      vatRate: Number(i.vat_rate),
    }));
}

/** Options that have items, in order, with totals. */
export function variantsOf(plan: PlanRow) {
  return plan.treatment_plan_variants
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((v) => {
      const items = itemsOf(plan, v.id);
      return {
        id: v.id,
        name: v.name,
        items: items.map((i) => ({ ...i, totalEur: planLineTotal(i) })),
        totalEur: Math.round(items.reduce((sum, i) => sum + planLineTotal(i), 0) * 100) / 100,
      };
    })
    .filter((v) => v.items.length > 0);
}

/** Everything the PDF needs; `onlyVariantId` = the confirmed option. */
export async function planPdfInput(
  supabase: SupabaseClient,
  plan: PlanRow,
  acceptance: PlanPdfAcceptance | null,
  onlyVariantId: string | null
): Promise<PlanPdfInput> {
  const { data: issuer } = await supabase
    .from('invoice_settings')
    .select('legal_name, address, postal_code, city, phone, email')
    .eq('practice_id', plan.practice_id)
    .maybeSingle();
  const all = variantsOf(plan);
  const shown = onlyVariantId ? all.filter((v) => v.id === onlyVariantId) : all;
  return {
    practiceName: issuer?.legal_name || plan.practices?.name || '',
    practiceLines: issuer
      ? [issuer.address ?? '', [issuer.postal_code, issuer.city].filter(Boolean).join(' '), issuer.phone ?? '', issuer.email ?? '']
      : [],
    patientName: patientNameOf(plan),
    number: plan.number,
    title: plan.title,
    createdAt: plan.created_at,
    validUntil: plan.valid_until,
    note: plan.note,
    variants: shown.map((v) => ({ name: v.name, items: itemsOf(plan, v.id) })),
    variantCount: all.length,
    acceptance,
  };
}
