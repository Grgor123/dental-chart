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

export function useChartBilling(patientId: string | null, enabled: boolean) {
  const [visits, setVisits] = useState<ChartBillingVisit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    const [recordsResult, performedResult] = await Promise.all([
      supabase
        .from('tooth_records')
        .select('tooth_id, surfaces, endo, post, pockets_buccal, pockets_lingual, gum_margin_buccal, visit_id, visits!inner(patient_id, date, created_at, closed_at)')
        .eq('visits.patient_id', patientId),
      supabase.from('performed_services').select('id, visit_id, tooth_fdi, trigger_key, service_id').eq('patient_id', patientId),
    ]);
    const failure = recordsResult.error ?? performedResult.error;
    if (failure) {
      setError(failure.message);
      setLoading(false);
      return;
    }

    const rows: ChartRecordRow[] = (recordsResult.data ?? []).map((r: Row) => {
      const visit = r.visits as { date: string; created_at: string; closed_at: string | null };
      return {
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
    });

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
      if (linesError) {
        setError(linesError.message);
        setLoading(false);
        return;
      }
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

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);
    const cutoffIso = cutoff.toLocaleDateString('sv-SE');
    const result = detectChartWork(rows)
      .filter((v) => !v.visitClosed || v.visitDate >= cutoffIso)
      .map((v) => ({
        ...v,
        performed: new Map(
          v.items.flatMap((item) => {
            const ref = performedByKey.get(workItemKey(item));
            return ref ? [[workItemKey(item), ref] as const] : [];
          })
        ),
      }));
    setVisits(result);
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
