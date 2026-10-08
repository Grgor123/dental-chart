import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePracticeContext } from '../contexts/PracticeContext';
import { rowToInvoiceSettings, type InvoiceSettings } from './useInvoiceSettings';
import { DEFAULT_UNIT, type InvoiceBuyer, type PaymentMethod } from '../../supabase/functions/_shared/invoice/render';

// Invoices — supabase/migrations/023_add_invoicing.sql. Drafts are edited
// freely through RLS; issuing and storno go through the issue_invoice() /
// cancel_invoice() functions, which assign the gapless number and freeze the
// invoice. practice_id is auto-stamped by triggers on both tables.

export type InvoiceKind = 'invoice' | 'credit_note';

/** One display state per invoice, used for the list's status chip. */
export type InvoiceState = 'draft' | 'unpaid' | 'paid' | 'cancelled' | 'credit_note';

export const INVOICE_STATE_META: Record<InvoiceState, { label: string; className: string }> = {
  draft: { label: 'Osnutek', className: 'border border-[#9CA3AF] bg-white text-[var(--ink,#1c2624)]' },
  unpaid: { label: 'Neplačan', className: 'bg-[#e0231c] text-white' },
  paid: { label: 'Plačan', className: 'bg-[#4CAF50] text-white' },
  cancelled: { label: 'Storniran', className: 'bg-[#6f7c79] text-white' },
  credit_note: { label: 'Dobropis', className: 'bg-[#45524f] text-white' },
};

export interface InvoiceSummary {
  id: string;
  /** Null for an invoice to someone who isn't a patient (migration 025). */
  patientId: string | null;
  /** The payer's name — the one on the invoice, falling back to the patient. */
  patientName: string;
  kind: InvoiceKind;
  status: 'draft' | 'issued';
  number: string | null;
  issuedAt: string | null;
  createdAt: string;
  serviceDate: string;
  dueDate: string | null;
  paymentMethod: PaymentMethod;
  paidAt: string | null;
  cancelledAt: string | null;
  /** Stored total once issued; the sum of the lines while a draft. */
  totalEur: number;
}

export function invoiceState(inv: Pick<InvoiceSummary, 'status' | 'kind' | 'paidAt' | 'cancelledAt'>): InvoiceState {
  if (inv.status === 'draft') return 'draft';
  if (inv.kind === 'credit_note') return 'credit_note';
  if (inv.cancelledAt) return 'cancelled';
  return inv.paidAt ? 'paid' : 'unpaid';
}

export interface InvoiceLineDraft {
  /** Local key for React lists — not stored. */
  key: string;
  serviceId: string | null;
  code: string | null;
  name: string;
  /** Enota mere, copied from the price list (migration 029). */
  unit: string;
  vatRate: number;
  toothFdi: string | null;
  quantity: number;
  unitPriceEur: number;
  discountPercent: number;
}

export interface InvoiceDetail extends InvoiceSummary {
  appointmentId: string | null;
  issuedByEmail: string | null;
  note: string;
  lines: InvoiceLineDraft[];
  /** The payer: issue-time snapshot, the payer saved on the draft, or —
      for a fresh draft — the patient's current details. */
  buyer: InvoiceBuyer;
  /** The linked patient's current details ("reset payer to the patient"),
      null when the invoice has no patient. */
  patientBuyer: InvoiceBuyer | null;
  /** Issue-time snapshot of the issuer; null while a draft (use live settings). */
  issuerSnapshot: InvoiceSettings | null;
  originalInvoiceId: string | null;
  originalNumber: string | null;
  /** The credit note that cancelled this invoice, if any. */
  creditNote: { id: string; number: string | null } | null;
  /** The linked patient's email (prefilled as the recipient), if any. */
  patientEmail: string | null;
  /** Every time this invoice was emailed (migration 026), newest first. */
  emailLog: InvoiceEmailLogEntry[];
}

export interface InvoiceEmailLogEntry {
  to: string;
  sentAt: string;
  status: string;
}

export interface SendInvoiceEmailInput {
  to: string[];
  subject: string;
  /** Heading inside the email (from the template). */
  heading: string;
  message: string;
  pdfBase64: string;
  filename: string;
}

export interface SendInvoiceEmailResult {
  results?: { to: string; status: 'sent' | 'failed'; error?: string }[];
  error?: string;
}

export interface DraftFields {
  serviceDate: string;
  paymentMethod: PaymentMethod;
  note: string;
  /** Who pays — editable on the draft (e.g. a company paying for a patient). */
  payer: InvoiceBuyer;
}

const ERROR_MESSAGES: Record<string, string> = {
  invoice_settings_incomplete:
    'Pred izdajo računa izpolnite podatke izdajatelja (Nastavitve → Podatki za račune) — vsaj naziv in davčno številko.',
  invoice_no_lines: 'Račun nima nobene postavke.',
  invoice_not_draft: 'Račun je že izdan.',
  invoice_issued_immutable: 'Izdanega računa ni mogoče spreminjati.',
  invoice_already_cancelled: 'Račun je že storniran.',
  invoice_not_cancellable: 'Tega računa ni mogoče stornirati.',
  invoice_not_found: 'Račun ni bil najden.',
  invoice_no_buyer: 'Vpišite plačnika (vsaj ime oz. naziv).',
};

function friendlyError(message: string): string {
  const key = Object.keys(ERROR_MESSAGES).find((k) => message.includes(k));
  return key ? ERROR_MESSAGES[key] : message;
}

let keyCounter = 0;
export function newLineKey(): string {
  keyCounter += 1;
  return `line-${Date.now()}-${keyCounter}`;
}

type Row = Record<string, unknown>;

function patientName(row: Row): string {
  const buyerName = (row.buyer as { name?: string } | null)?.name?.trim();
  if (buyerName) return buyerName;
  const p = row.patients as { first_name: string; last_name: string } | null;
  return p ? `${p.first_name} ${p.last_name}` : '';
}

function rowToSummary(row: Row): InvoiceSummary {
  const lines = (row.invoice_lines as { line_total_eur: number | string }[] | null) ?? [];
  const linesSum = Math.round(lines.reduce((s, l) => s + Number(l.line_total_eur) * 100, 0)) / 100;
  return {
    id: row.id as string,
    patientId: (row.patient_id as string | null) ?? null,
    patientName: patientName(row),
    kind: row.kind as InvoiceKind,
    status: row.status as 'draft' | 'issued',
    number: (row.number as string | null) ?? null,
    issuedAt: (row.issued_at as string | null) ?? null,
    createdAt: row.created_at as string,
    serviceDate: row.service_date as string,
    dueDate: (row.due_date as string | null) ?? null,
    paymentMethod: row.payment_method as PaymentMethod,
    paidAt: (row.paid_at as string | null) ?? null,
    cancelledAt: (row.cancelled_at as string | null) ?? null,
    totalEur: row.total_eur != null ? Number(row.total_eur) : linesSum,
  };
}

const SUMMARY_COLUMNS =
  'id, patient_id, kind, status, number, issued_at, created_at, service_date, due_date, payment_method, paid_at, cancelled_at, total_eur, buyer, patients(first_name, last_name), invoice_lines(line_total_eur)';

/** Invoices for one patient (Frame 5) or for the whole practice (Računi). */
export function useInvoiceList(patientId?: string) {
  const { practiceId } = usePracticeContext();
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    let query = supabase.from('invoices').select(SUMMARY_COLUMNS).order('created_at', { ascending: false });
    if (patientId) query = query.eq('patient_id', patientId);
    const { data, error: fetchError } = await query;
    if (fetchError) {
      setError(fetchError.message);
    } else {
      setInvoices((data ?? []).map((r) => rowToSummary(r as Row)));
      setError(null);
    }
    setLoading(false);
  }, [patientId]);

  useEffect(() => {
    reload();
  }, [reload]);

  /** New empty draft — for a patient, or (patient null) for a payer typed in
      by hand; returns its id. */
  const createDraft = useCallback(
    async (forPatientId: string | null, appointmentId: string | null): Promise<{ id?: string; error?: string }> => {
      if (!forPatientId && !practiceId) return { error: 'Ordinacija ni bila najdena — poskusite znova po ponovni prijavi.' };
      const { data, error: insertError } = await supabase
        .from('invoices')
        // With a patient the trigger derives practice_id; without one it's ours.
        .insert(forPatientId ? { patient_id: forPatientId, appointment_id: appointmentId } : { practice_id: practiceId })
        .select('id')
        .single();
      if (insertError) return { error: friendlyError(insertError.message) };
      return { id: data.id as string };
    },
    [practiceId]
  );

  return { invoices, loading, error, reload, createDraft };
}

/** One invoice with its lines, plus every action on it. */
export function useInvoice(invoiceId: string) {
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [main, creditNotes, emails] = await Promise.all([
      supabase
        .from('invoices')
        .select('*, patients(first_name, last_name, address, postal_code, city, email), invoice_lines(*)')
        .eq('id', invoiceId)
        .single(),
      supabase.from('invoices').select('id, number').eq('original_invoice_id', invoiceId).limit(1),
      // Fails harmlessly (empty history) until migration 026 adds invoice_id.
      supabase
        .from('email_log')
        .select('recipient_email, sent_at, status')
        .eq('invoice_id', invoiceId)
        .order('sent_at', { ascending: false }),
    ]);
    if (main.error) {
      setError(main.error.message);
      setLoading(false);
      return;
    }
    const row = main.data as Row;
    // The original's number (on a credit note) is a separate lookup: a
    // self-referencing embed isn't resolved by the API's schema cache.
    let originalNumber: string | null = null;
    if (row.original_invoice_id) {
      const { data: original } = await supabase.from('invoices').select('number').eq('id', row.original_invoice_id as string).maybeSingle();
      originalNumber = (original?.number as string | null) ?? null;
    }
    const patient = row.patients as {
      first_name: string;
      last_name: string;
      address: string | null;
      postal_code: string | null;
      city: string | null;
      email: string | null;
    } | null;
    const buyerSnapshot = row.buyer as {
      name?: string;
      address?: string | null;
      postal_code?: string | null;
      city?: string | null;
      tax_number?: string | null;
    } | null;
    const patientBuyer: InvoiceBuyer | null = patient
      ? {
          name: `${patient.first_name} ${patient.last_name}`,
          address: patient.address ?? '',
          postalCode: patient.postal_code ?? '',
          city: patient.city ?? '',
          taxNumber: '',
        }
      : null;
    const buyer: InvoiceBuyer = buyerSnapshot
      ? {
          name: buyerSnapshot.name ?? '',
          address: buyerSnapshot.address ?? '',
          postalCode: buyerSnapshot.postal_code ?? '',
          city: buyerSnapshot.city ?? '',
          taxNumber: buyerSnapshot.tax_number ?? '',
        }
      : { ...(patientBuyer ?? { name: '', address: '', postalCode: '', city: '', taxNumber: '' }), taxNumber: (row.buyer_tax_number as string | null) ?? '' };
    const lines = ((row.invoice_lines as Row[] | null) ?? [])
      .slice()
      .sort((a, b) => (a.position as number) - (b.position as number))
      .map((l) => ({
        key: l.id as string,
        serviceId: (l.service_id as string | null) ?? null,
        code: (l.code as string | null) ?? null,
        name: l.name as string,
        unit: (l.unit as string | null) ?? DEFAULT_UNIT,
        vatRate: Number(l.vat_rate),
        toothFdi: (l.tooth_fdi as string | null) ?? null,
        quantity: Number(l.quantity),
        unitPriceEur: Number(l.unit_price_eur),
        discountPercent: Number(l.discount_percent),
      }));
    const credit = (creditNotes.data ?? [])[0] as { id: string; number: string | null } | undefined;
    setInvoice({
      ...rowToSummary(row),
      appointmentId: (row.appointment_id as string | null) ?? null,
      issuedByEmail: (row.issued_by_email as string | null) ?? null,
      note: (row.note as string | null) ?? '',
      lines,
      buyer,
      patientBuyer,
      issuerSnapshot: row.issuer ? rowToInvoiceSettings(row.issuer as Row) : null,
      originalInvoiceId: (row.original_invoice_id as string | null) ?? null,
      originalNumber,
      creditNote: credit ? { id: credit.id, number: credit.number } : null,
      patientEmail: patient?.email ?? null,
      emailLog: (emails.data ?? []).map((e) => ({
        to: e.recipient_email as string,
        sentAt: e.sent_at as string,
        status: e.status as string,
      })),
    });
    setError(null);
    setLoading(false);
  }, [invoiceId]);

  useEffect(() => {
    setLoading(true);
    reload();
  }, [reload]);

  /** Saves the draft's header fields and replaces its lines. */
  const saveDraft = useCallback(
    async (fields: DraftFields, lines: InvoiceLineDraft[]): Promise<{ error?: string }> => {
      const { error: updateError } = await supabase
        .from('invoices')
        .update({
          service_date: fields.serviceDate,
          payment_method: fields.paymentMethod,
          note: fields.note.trim() || null,
          // The payer as entered; issue_invoice() snapshots it as-is.
          buyer: {
            name: fields.payer.name.trim(),
            address: fields.payer.address.trim() || null,
            postal_code: fields.payer.postalCode.trim() || null,
            city: fields.payer.city.trim() || null,
            tax_number: fields.payer.taxNumber.trim() || null,
          },
          buyer_tax_number: fields.payer.taxNumber.trim() || null,
        })
        .eq('id', invoiceId);
      if (updateError) return { error: friendlyError(updateError.message) };
      // New lines are written BEFORE the old ones are removed, so a failed
      // write leaves the previously saved lines in place instead of an empty
      // draft (the old delete-then-insert order lost every line when the
      // insert failed).
      const { data: oldLines, error: oldLinesError } = await supabase
        .from('invoice_lines')
        .select('id')
        .eq('invoice_id', invoiceId);
      if (oldLinesError) return { error: friendlyError(oldLinesError.message) };
      if (lines.length > 0) {
        const { error: insertError } = await supabase.from('invoice_lines').insert(
          lines.map((l, i) => ({
            invoice_id: invoiceId,
            position: i,
            service_id: l.serviceId,
            code: l.code,
            name: l.name,
            unit: l.unit,
            vat_rate: l.vatRate,
            tooth_fdi: l.toothFdi?.trim() || null,
            quantity: l.quantity,
            unit_price_eur: l.unitPriceEur,
            discount_percent: l.discountPercent,
          }))
        );
        if (insertError) return { error: friendlyError(insertError.message) };
      }
      const oldIds = (oldLines ?? []).map((l) => l.id as string);
      if (oldIds.length > 0) {
        const { error: deleteError } = await supabase.from('invoice_lines').delete().in('id', oldIds);
        if (deleteError) {
          await reload();
          return { error: friendlyError(deleteError.message) };
        }
      }
      await reload();
      return {};
    },
    [invoiceId, reload]
  );

  const deleteDraft = useCallback(async (): Promise<{ error?: string }> => {
    const { error: deleteError } = await supabase.from('invoices').delete().eq('id', invoiceId);
    if (deleteError) return { error: friendlyError(deleteError.message) };
    return {};
  }, [invoiceId]);

  const issue = useCallback(async (): Promise<{ error?: string }> => {
    const { error: rpcError } = await supabase.rpc('issue_invoice', { p_invoice_id: invoiceId });
    if (rpcError) return { error: friendlyError(rpcError.message) };
    await reload();
    return {};
  }, [invoiceId, reload]);

  const setPaid = useCallback(
    async (paid: boolean): Promise<{ error?: string }> => {
      const { error: updateError } = await supabase
        .from('invoices')
        .update({ paid_at: paid ? new Date().toISOString() : null })
        .eq('id', invoiceId);
      if (updateError) return { error: friendlyError(updateError.message) };
      await reload();
      return {};
    },
    [invoiceId, reload]
  );

  /** Storno — returns the new credit note's id. */
  const cancel = useCallback(async (): Promise<{ creditNoteId?: string; error?: string }> => {
    const { data, error: rpcError } = await supabase.rpc('cancel_invoice', { p_invoice_id: invoiceId });
    if (rpcError) return { error: friendlyError(rpcError.message) };
    await reload();
    return { creditNoteId: data as string };
  }, [invoiceId, reload]);

  /** Emails the issued invoice (PDF attached) — supabase/functions/send-invoice-email. */
  const sendByEmail = useCallback(
    async (input: SendInvoiceEmailInput): Promise<SendInvoiceEmailResult> => {
      const { data, error: fnError } = await supabase.functions.invoke('send-invoice-email', {
        body: { invoiceId, ...input },
      });
      // A 4xx/5xx carries its own JSON message in the response body.
      if (fnError) {
        let message = fnError.message;
        const context = (fnError as { context?: Response }).context;
        if (context && typeof context.json === 'function') {
          const payload = await context.json().catch(() => null);
          if (payload?.error) message = payload.error;
          else if (payload?.results) {
            await reload();
            return { results: payload.results };
          }
        }
        return { error: message };
      }
      await reload();
      return { results: (data as SendInvoiceEmailResult).results ?? [] };
    },
    [invoiceId, reload]
  );

  return { invoice, loading, error, reload, saveDraft, deleteDraft, issue, setPaid, cancel, sendByEmail };
}
