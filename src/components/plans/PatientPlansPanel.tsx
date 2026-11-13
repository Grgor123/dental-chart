import { useState } from 'react';
import { PLAN_STATUS_LABELS, planStatus, usePatientPlans, variantTotal } from '../../hooks/useTreatmentPlans';
import { formatEur } from '../../../supabase/functions/_shared/invoice/render';

// The patient record's "Predračuni" tab (migration 061): the patient's
// predračuni with status and totals, and for accepted ones how many items are
// still to invoice. "+ Nov predračun" creates one and opens the editor.

interface PatientPlansPanelProps {
  patientId: string;
  onOpenPlan: (planId: string) => void;
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('sl-SI', { timeZone: 'Europe/Ljubljana' });
}

export function PatientPlansPanel({ patientId, onOpenPlan }: PatientPlansPanelProps) {
  const { plans, loading, error, createPlan } = usePatientPlans(patientId);
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setCreateError(null);
          const result = await createPlan();
          setBusy(false);
          if (result.id) onOpenPlan(result.id);
          else setCreateError(result.error ?? 'Predračuna ni bilo mogoče ustvariti.');
        }}
        className="self-start rounded-full border border-[var(--ink,#1c2624)] px-3 py-1 text-xs font-semibold text-[var(--ink,#1c2624)] hover:border-[var(--accent,#2e6e62)] hover:text-[var(--accent,#2e6e62)] disabled:opacity-50"
      >
        + Nov predračun
      </button>
      {createError && <p className="text-xs text-[var(--danger,#b3261e)]">{createError}</p>}
      {error && <p className="text-xs text-[var(--danger,#b3261e)]">Napaka pri nalaganju: {error}</p>}
      {!loading && plans.length === 0 && <p className="text-sm italic text-[var(--muted,#6f7c79)]">Pacient še nima predračunov.</p>}
      <ul className="flex flex-col gap-2">
        {plans.map((plan) => {
          const status = planStatus(plan);
          const accepted = plan.variants.find((v) => v.id === plan.acceptedVariantId);
          const open = accepted ? accepted.items.filter((i) => !plan.invoiced[i.id]).length : 0;
          return (
            <li key={plan.id}>
              <button
                type="button"
                onClick={() => onOpenPlan(plan.id)}
                className={`w-full rounded-md bg-[#e7e7e7] p-3 text-left text-sm hover:bg-[#dedede] ${status === 'cancelled' ? 'opacity-60' : ''}`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold text-[var(--ink,#1c2624)]">
                    {plan.number} · {plan.title}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      status === 'accepted'
                        ? 'bg-[#e9f4f1] text-[var(--accent,#2e6e62)]'
                        : status === 'cancelled' || status === 'expired'
                          ? 'bg-white text-[var(--muted,#6f7c79)]'
                          : 'bg-[#fff1cc] text-[#8a5a00]'
                    }`}
                  >
                    {PLAN_STATUS_LABELS[status]}
                  </span>
                </div>
                <div className="text-xs text-[var(--ink-soft,#45524f)]">
                  {shortDate(plan.createdAt)} ·{' '}
                  {accepted
                    ? `${plan.variants.length > 1 ? `${accepted.name}: ` : ''}${formatEur(variantTotal(accepted))}`
                    : plan.variants.map((v) => `${plan.variants.length > 1 ? `${v.name}: ` : ''}${formatEur(variantTotal(v))}`).join(' · ')}
                </div>
                {accepted && (
                  <div className={`text-xs ${open > 0 ? 'font-semibold text-[#8a5a00]' : 'text-[var(--muted,#6f7c79)]'}`}>
                    {open > 0 ? `Še ni zaračunano: ${open} od ${accepted.items.length} storitev` : 'Vse storitve so zaračunane'}
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
