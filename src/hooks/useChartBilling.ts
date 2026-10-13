import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  detectChartWork,
  workItemKey,
  type ChartRecordRow,
  type ChartTrigger,
  type ChartVisitWork,
  type ChartWorkItem,
  type FillingVariant,
} from '../lib/chartBilling';

// "Dodaj iz karte" on an invoice (migration 033): what the chart says was done
// in the patient's recent visits, which of it already has a performed_services
// row, and which of those are already billed on another invoice.

/** Visits older than this aren't offered (unless still open). */
const LOOKBACK_DAYS = 60;

export interface PerformedServiceRef {
  id: string;
  serviceId: string | null;
  /** An invoice (not cancelled, not a credit note) already bills it. */
  billedOn: { invoiceId: string; number: string | null } | null;
}

export interface ChartBillingVisit extends ChartVisitWork {
  /** workItemKey(item) -> its performed_services row, if one exists. */
  performed: Map<string, PerformedServiceRef>;
}

export interface WorkToRecord {
  item: ChartWorkItem;
  serviceId: string;
  performedOn: string;
}

type Row = Record<string, unknown>;

/** Chart work of several patients (recent visits only — see LOOKBACK_DAYS),
 *  each item with its performed_services row and billed state. Shared by
 *  "Dodaj iz karte" (one patient) and the Računi page's "Neobračunano"
 *  overview (every patient with a recent visit), so the two can't disagree. */
export async function loadChartWork(patientIds: string[]): Promise<{ error?: string; byPatient?: Map<string, ChartBillingVisit[]> }> {
  const byPatient = new Map<string, ChartBillingVisit[]>();
  if (patientIds.length === 0) return { byPatient };
  const [recordsResult, performedResult] = await Promise.all([
    supabase
      .from('tooth_records')
      .select('tooth_id, surfaces, endo, post, pockets_buccal, pockets_lingual, gum_margin_buccal, visit_id, visits!inner(patient_id, date, created_at, closed_at)')
      .in('visits.patient_id', patientIds),
    supabase.from('performed_services').select('id, patient_id, visit_id, tooth_fdi, trigger_key, service_id').in('patient_id', patientIds),
  ]);
  const failure = recordsResult.error ?? performedResult.error;
  if (failure) return { error: failure.message };

  const rowsByPatient = new Map<string, ChartRecordRow[]>();
  for (const r of (recordsResult.data ?? []) as Row[]) {
    const visit = r.visits as { patient_id: string; date: string; created_at: string; closed_at: string | null };
    const row: ChartRecordRow = {
      visitId: r.visit_id as string,
      visitDate: visit.date,
      visitCreatedAt: visit.created_at,
      visitClosed: !!visit.closed_at,
      fdi: r.tooth_id as string,
      surfaces: (r.surfaces as ChartRecordRow['surfaces'] | null) ?? {},
      endo: (r.endo as ChartRecordRow['endo']) ?? null,
      post: !!r.post,
      pocketsBuccal: (r.pockets_buccal as (number | null)[] | null) ?? null,
      pocketsLingual: (r.pockets_lingual as (number | null)[] | null) ?? null,
      gumMargin: (r.gum_margin_buccal as (number | null)[] | null) ?? null,
    };
    rowsByPatient.set(visit.patient_id, [...(rowsByPatient.get(visit.patient_id) ?? []), row]);
  }

  const performed = (performedResult.data ?? []) as Row[];
  const ids = performed.map((p) => p.id as string);
  const billed = new Map<string, { invoiceId: string; number: string | null }>();
  if (ids.length > 0) {
    const { data: lines, error: linesError } = await supabase
      .from('invoice_lines')
      .select('performed_service_id, invoices!inner(id, number, kind, cancelled_at)')
      .in('performed_service_id', ids)
      .eq('invoices.kind', 'invoice')
      .is('invoices.cancelled_at', null);
    if (linesError) return { error: linesError.message };
    for (const l of (lines ?? []) as Row[]) {
      const inv = l.invoices as { id: string; number: string | null };
      billed.set(l.performed_service_id as string, { invoiceId: inv.id, number: inv.number });
    }
  }
  const performedByKey = new Map<string, PerformedServiceRef>(
    performed.map((p) => [
      workItemKey({ visitId: p.visit_id as string, fdi: (p.tooth_fdi as string | null) ?? null, trigger: p.trigger_key as ChartTrigger }),
      { id: p.id as string, serviceId: (p.service_id as string | null) ?? null, billedOn: billed.get(p.id as string) ?? null },
    ])
  );

  const cutoffIso = lookbackCutoffIso();
  for (const [patientId, rows] of rowsByPatient) {
    byPatient.set(
      patientId,
      detectChartWork(rows)
        .filter((v) => !v.visitClosed || v.visitDate >= cutoffIso)
        .map((v) => ({
          ...v,
          performed: new Map(
            v.items.flatMap((item) => {
              const ref = performedByKey.get(workItemKey(item));
              return ref ? [[workItemKey(item), ref] as const] : [];
            })
          ),
        }))
    );
  }
  return { byPatient };
}

/** First day (ISO) a closed visit may have to still be offered for billing. */
export function lookbackCutoffIso(): string {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);
  return cutoff.toLocaleDateString('sv-SE');
}

export function useChartBilling(patientId: string | null, enabled: boolean) {
  const [visits, setVisits] = useState<ChartBillingVisit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    const result = await loadChartWork([patientId]);
    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }
    setVisits(result.byPatient?.get(patientId) ?? []);
    setError(null);
    setLoading(false);
  }, [patientId]);

  useEffect(() => {
    if (enabled) reload();
  }, [enabled, reload]);

  /** Creates (or updates) the performed_services rows for the chosen items.
   *  Returns workItemKey -> performed service id. */
  const recordWork = useCallback(
    async (work: WorkToRecord[]): Promise<{ error?: string; ids?: Map<string, string> }> => {
      if (!patientId) return { error: 'Račun nima pacienta.' };
      const existing = new Map<string, PerformedServiceRef>();
      for (const v of visits) for (const [k, ref] of v.performed) existing.set(k, ref);
      const ids = new Map<string, string>();
      const toInsert: Row[] = [];
      for (const w of work) {
        const key = workItemKey(w.item);
        const ref = existing.get(key);
        if (ref) {
          ids.set(key, ref.id);
          if (ref.serviceId !== w.serviceId) {
            const { error: updateError } = await supabase
              .from('performed_services')
              .update({ service_id: w.serviceId, variant: w.item.variant })
              .eq('id', ref.id);
            if (updateError) return { error: updateError.message };
          }
        } else {
          toInsert.push({
            patient_id: patientId,
            visit_id: w.item.visitId,
            tooth_fdi: w.item.fdi,
            trigger_key: w.item.trigger,
            variant: w.item.variant as FillingVariant | null,
            service_id: w.serviceId,
            performed_on: w.performedOn,
          });
        }
      }
      if (toInsert.length > 0) {
        const { data, error: insertError } = await supabase.from('performed_services').insert(toInsert).select('id, visit_id, tooth_fdi, trigger_key');
        if (insertError) return { error: insertError.message };
        for (const p of (data ?? []) as Row[]) {
          ids.set(
            workItemKey({ visitId: p.visit_id as string, fdi: (p.tooth_fdi as string | null) ?? null, trigger: p.trigger_key as ChartTrigger }),
            p.id as string
          );
        }
      }
      return { ids };
    },
    [patientId, visits]
  );

  return { visits, loading, error, reload, recordWork };
}

export interface UnbilledVisit {
  patientId: string;
  visitId: string;
  visitDate: string;
  visitClosed: boolean;
  /** Clearly done (pre-ticked in "Dodaj iz karte") and not on any invoice. */
  items: ChartWorkItem[];
}

/** Računi → "Neobračunano": every patient's recent chart work that is clearly
 *  done and not on any invoice (draft or issued) yet, newest visit first. */
export function useUnbilledWork(enabled: boolean) {
  const [visits, setVisits] = useState<UnbilledVisit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    // Patients with a visit inside the look-back window, or one still open.
    const { data: recent, error: visitsError } = await supabase
      .from('visits')
      .select('patient_id')
      .or(`date.gte.${lookbackCutoffIso()},closed_at.is.null`);
    if (visitsError) {
      setError(visitsError.message);
      setLoading(false);
      return;
    }
    const patientIds = [...new Set((recent ?? []).map((v) => v.patient_id as string))];
    const result = await loadChartWork(patientIds);
    if (result.error || !result.byPatient) {
      setError(result.error ?? 'Nalaganje ni uspelo.');
      setLoading(false);
      return;
    }
    const list: UnbilledVisit[] = [];
    for (const [patientId, patientVisits] of result.byPatient) {
      for (const v of patientVisits) {
        const items = v.items.filter((item) => item.confident && !v.performed.get(workItemKey(item))?.billedOn);
        if (items.length > 0) list.push({ patientId, visitId: v.visitId, visitDate: v.visitDate, visitClosed: v.visitClosed, items });
      }
    }
    list.sort((a, b) => b.visitDate.localeCompare(a.visitDate));
    setVisits(list);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (enabled) reload();
  }, [enabled, reload]);

  return { visits, loading, error, reload };
}
