import { useMemo, useState } from 'react';
import { AppNavShell } from '../components/ui/AppNavShell';
import { usePracticeContext } from '../contexts/PracticeContext';
import { usePatients } from '../hooks/usePatients';
import { INVOICE_STATE_META, invoiceState, useInvoiceList, type InvoiceState, type InvoiceSummary } from '../hooks/useInvoices';
import { PAYMENT_METHOD_LABELS, formatDate, formatDateTime, formatEur } from '../../supabase/functions/_shared/invoice/render';
import { useUnbilledWork } from '../hooks/useChartBilling';
import { chartLinkLabel } from '../lib/chartBilling';

// "Računi" — every invoice of the practice (supabase/migrations/
// 023_add_invoicing.sql): filter by date and state, search by patient or
// number, the sum of what's shown, and a click opens it in InvoiceEditor.
// "Nov račun" starts a draft here too: for a patient picked from the list, or
// for a payer who isn't a patient (typed in on the draft — migration 025).
// "Nepotrjeni pri FURS" lists cash/card invoices FURS hasn't confirmed yet
// (they also carry an amber/red pill — confirmed ones carry none, Gregor's
// choice). "Neobračunano" swaps the table for chart work from recent visits
// that isn't on any invoice yet (useUnbilledWork — the same detection as the
// invoice's "Dodaj iz karte").

interface InvoicesProps {
  onOpenInvoice: (invoiceId: string) => void;
  onBack: () => void;
  onSignOut: () => void;
  onNavigateCalendar: () => void;
  onNavigateEmail: () => void;
  onNavigateSettings: () => void;
  onNavigateInvoices: () => void;
}

type FilterKey = 'all' | InvoiceState | 'furs' | 'unbilled';

const STATE_FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'Vsi' },
  { key: 'unpaid', label: 'Neplačani' },
  { key: 'paid', label: 'Plačani' },
  { key: 'draft', label: 'Osnutki' },
  { key: 'cancelled', label: 'Stornirani' },
  { key: 'credit_note', label: 'Dobropisi' },
  { key: 'furs', label: 'Nepotrjeni pri FURS' },
  { key: 'unbilled', label: 'Neobračunano' },
];

function formatVisitDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${Number(d)}. ${Number(m)}. ${y}`;
}

/** The date an invoice "belongs to": issue date, or creation date for a draft (local YYYY-MM-DD). */
function invoiceDay(inv: InvoiceSummary): string {
  const d = new Date(inv.issuedAt ?? inv.createdAt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function Invoices({ onOpenInvoice, onBack, onSignOut, onNavigateCalendar, onNavigateEmail, onNavigateSettings, onNavigateInvoices }: InvoicesProps) {
  const { practiceName } = usePracticeContext();
  const { invoices, loading, error, createDraft } = useInvoiceList();
  const { patients } = usePatients();
  const [newOpen, setNewOpen] = useState(false);
  const [patientQuery, setPatientQuery] = useState('');
  const [newError, setNewError] = useState<string | null>(null);

  const patientMatches = useMemo(() => {
    const q = patientQuery.trim().toLowerCase();
    if (!q) return [];
    return patients
      .filter((p) => `${p.firstName} ${p.lastName}`.toLowerCase().includes(q) || `${p.lastName} ${p.firstName}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [patients, patientQuery]);

  // "Zaračunaj" in Neobračunano: the patient's open draft if there is one
  // (the work is usually meant for it), otherwise a new one.
  async function billPatient(patientId: string) {
    const draft = invoices.find((inv) => inv.patientId === patientId && inv.status === 'draft' && inv.kind === 'invoice');
    if (draft) {
      onOpenInvoice(draft.id);
      return;
    }
    await startInvoice(patientId);
  }

  async function startInvoice(patientId: string | null) {
    setNewError(null);
    const result = await createDraft(patientId, null);
    if (result.error || !result.id) {
      setNewError(result.error ?? 'Računa ni bilo mogoče ustvariti.');
      return;
    }
    onOpenInvoice(result.id);
  }
  const [stateFilter, setStateFilter] = useState<FilterKey>('all');
  const unbilled = useUnbilledWork(stateFilter === 'unbilled');
  const patientNameById = useMemo(() => new Map(patients.map((p) => [p.patientId, `${p.firstName} ${p.lastName}`])), [patients]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return invoices.filter((inv) => {
      if (stateFilter === 'furs') {
        if (inv.fursStatus !== 'pending' && inv.fursStatus !== 'failed') return false;
      } else if (stateFilter !== 'all' && stateFilter !== 'unbilled' && invoiceState(inv) !== stateFilter) return false;
      const day = invoiceDay(inv);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (q && !inv.patientName.toLowerCase().includes(q) && !(inv.number ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [invoices, stateFilter, from, to, query]);

  // Drafts aren't invoices yet, so they never count towards the sum; credit
  // notes are negative, so a cancelled invoice and its storno net to zero.
  const shownUnbilled = useMemo(() => {
    const q = query.trim().toLowerCase();
    return unbilled.visits.filter((v) => {
      if (from && v.visitDate < from) return false;
      if (to && v.visitDate > to) return false;
      if (q && !(patientNameById.get(v.patientId) ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [unbilled.visits, from, to, query, patientNameById]);

  const issuedSum = shown.filter((inv) => inv.status === 'issued').reduce((sum, inv) => sum + inv.totalEur, 0);

  return (
    <>
      <AppNavShell
        userLabel={practiceName ?? undefined}
        onSignOut={onSignOut}
        onNavigateHome={onBack}
        onNavigateStoritve={onBack}
        onNavigateCalendar={onNavigateCalendar}
        onNavigateEmail={onNavigateEmail}
        onNavigateSettings={onNavigateSettings}
        onNavigateInvoices={onNavigateInvoices}
        activeSubmenu="racuni"
      />
      <div className="mx-auto flex max-w-[1300px] flex-col gap-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold text-[var(--ink,#1c2624)]">Računi</h1>
          <div className="relative">
            <button
              type="button"
              onClick={() => setNewOpen((o) => !o)}
              className="rounded-full bg-[var(--accent,#2e6e62)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              + Nov račun
            </button>
            {newOpen && (
              <div className="absolute right-0 top-full z-20 mt-2 flex w-[340px] flex-col gap-2 rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-3 shadow-lg">
                <span className="text-xs font-semibold text-[var(--ink-soft,#45524f)]">Pacient</span>
                <input
                  autoFocus
                  value={patientQuery}
                  onChange={(e) => setPatientQuery(e.target.value)}
                  placeholder="Poišči pacienta po imenu …"
                  className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-sm"
                />
                {patientMatches.length > 0 && (
                  <ul className="flex max-h-64 flex-col overflow-y-auto">
                    {patientMatches.map((p) => (
                      <li key={p.patientId}>
                        <button
                          type="button"
                          onClick={() => startInvoice(p.patientId)}
                          className="flex w-full justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[#f7faf9]"
                        >
                          <span>
                            {p.firstName} {p.lastName}
                          </span>
                          <span className="text-xs text-[var(--muted,#6f7c79)]">{p.city ?? ''}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {patientQuery.trim() && patientMatches.length === 0 && (
                  <span className="px-1 text-xs italic text-[var(--muted,#6f7c79)]">Ni zadetkov.</span>
                )}
                <div className="border-t border-[var(--line,#ccd6d4)] pt-2">
                  <button
                    type="button"
                    onClick={() => startInvoice(null)}
                    className="text-sm font-medium text-[var(--accent,#2e6e62)] hover:underline"
                  >
                    Plačnik, ki ni pacient — vpišem ročno
                  </button>
                </div>
                {newError && <span className="text-xs text-[var(--danger,#b3261e)]">{newError}</span>}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-wrap gap-1.5">
            {STATE_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setStateFilter(f.key)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                  stateFilter === f.key
                    ? 'bg-[#C8D1D9] text-[var(--ink,#1c2624)]'
                    : 'text-[var(--ink-soft,#45524f)] hover:text-[var(--accent,#2e6e62)]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--ink-soft,#45524f)]">
            Od
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border border-[var(--line,#ccd6d4)] px-2 py-1.5 text-sm font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--ink-soft,#45524f)]">
            Do
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border border-[var(--line,#ccd6d4)] px-2 py-1.5 text-sm font-normal" />
          </label>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Išči po pacientu ali številki …"
            className="min-w-[240px] flex-1 rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-sm"
          />
        </div>

        {stateFilter === 'unbilled' ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-[var(--muted,#6f7c79)]">
              Storitve, ki so bile na zobni karti v zadnjih 60 dneh nedvomno opravljene in še niso na nobenem računu (tudi ne na osnutku).
              Postavke, ki so morda le vpis obstoječega stanja, tu niso naštete — preverite jih z »Dodaj iz karte« na računu.
            </p>
            <div className="overflow-x-auto rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--ink-soft,#45524f)]">
                    <th className="px-3 py-2 font-semibold">Pacient</th>
                    <th className="px-3 py-2 font-semibold">Obisk</th>
                    <th className="px-3 py-2 font-semibold">Opravljeno</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {unbilled.loading && (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-[var(--ink-soft,#45524f)]">Nalaganje…</td>
                    </tr>
                  )}
                  {unbilled.error && (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 text-[var(--danger,#b3261e)]">{unbilled.error}</td>
                    </tr>
                  )}
                  {!unbilled.loading && !unbilled.error && shownUnbilled.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-4 italic text-[var(--muted,#6f7c79)]">Vse opravljeno je zaračunano.</td>
                    </tr>
                  )}
                  {!unbilled.loading &&
                    shownUnbilled.map((v) => (
                      <tr key={v.visitId} className="border-t border-[var(--line,#ccd6d4)]">
                        <td className="px-3 py-2 font-medium">{patientNameById.get(v.patientId) ?? '—'}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          {formatVisitDate(v.visitDate)}
                          {!v.visitClosed && <span className="text-xs text-[var(--muted,#6f7c79)]"> (odprt)</span>}
                        </td>
                        <td className="px-3 py-2">
                          {v.items.map((item) => `${item.fdi ? `${item.fdi} ` : ''}${chartLinkLabel(item)}`).join(' · ')}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => billPatient(v.patientId)}
                            className="whitespace-nowrap rounded border border-[var(--accent,#2e6e62)] px-3 py-1 text-sm font-medium text-[var(--accent,#2e6e62)] hover:bg-[#eaf4f1]"
                          >
                            Zaračunaj
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {newError && <span className="text-xs text-[var(--danger,#b3261e)]">{newError}</span>}
          </div>
        ) : (
        <div className="overflow-x-auto rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--ink-soft,#45524f)]">
                <th className="px-3 py-2 font-semibold">Številka</th>
                <th className="px-3 py-2 font-semibold">Datum</th>
                <th className="px-3 py-2 font-semibold">Pacient</th>
                <th className="px-3 py-2 text-right font-semibold">Znesek</th>
                <th className="px-3 py-2 font-semibold">Način plačila</th>
                <th className="px-3 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-[var(--ink-soft,#45524f)]">Nalaganje…</td>
                </tr>
              )}
              {error && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-[var(--danger,#b3261e)]">{error}</td>
                </tr>
              )}
              {!loading && !error && shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 italic text-[var(--muted,#6f7c79)]">Ni računov.</td>
                </tr>
              )}
              {shown.map((inv) => {
                const state = invoiceState(inv);
                return (
                  <tr
                    key={inv.id}
                    onClick={() => onOpenInvoice(inv.id)}
                    className="cursor-pointer border-t border-[var(--line,#ccd6d4)] hover:bg-[#f7faf9]"
                  >
                    <td className="px-3 py-2 font-medium">{inv.number ?? '—'}</td>
                    <td className="px-3 py-2">{inv.issuedAt ? formatDateTime(inv.issuedAt) : formatDate(invoiceDay(inv))}</td>
                    <td className="px-3 py-2">{inv.patientName}</td>
                    <td className="px-3 py-2 text-right">{formatEur(inv.totalEur)}</td>
                    <td className="px-3 py-2">{PAYMENT_METHOD_LABELS[inv.paymentMethod]}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${INVOICE_STATE_META[state].className}`}>
                        {INVOICE_STATE_META[state].label}
                      </span>
                      {inv.fursStatus === 'pending' && (
                        <span className="ml-1.5 rounded-full bg-[#fff6e5] px-2 py-0.5 text-xs font-semibold text-[#6b4a00]" title="Čaka na potrditev FURS — pošlje se samodejno.">
                          FURS čaka
                        </span>
                      )}
                      {inv.fursStatus === 'failed' && (
                        <span className="ml-1.5 rounded-full bg-[#fdecea] px-2 py-0.5 text-xs font-semibold text-[#b3261e]" title="FURS je račun zavrnil — odprite ga za podrobnosti.">
                          FURS napaka
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {shown.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-[var(--ink,#1c2624)]">
                  <td colSpan={3} className="px-3 py-2 font-semibold">
                    Skupaj izdanih ({shown.filter((i) => i.status === 'issued').length})
                  </td>
                  <td className="px-3 py-2 text-right font-bold">{formatEur(issuedSum)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        )}
      </div>
    </>
  );
}
