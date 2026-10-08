import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppNavShell } from '../components/ui/AppNavShell';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { usePracticeContext } from '../contexts/PracticeContext';
import { usePriceList, type Service } from '../hooks/usePriceList';
import { invoiceSettingsComplete, settingsToIssuer, useInvoiceSettings } from '../hooks/useInvoiceSettings';
import {
  INVOICE_STATE_META,
  invoiceState,
  newLineKey,
  useInvoice,
  type DraftFields,
  type InvoiceLineDraft,
} from '../hooks/useInvoices';
import { printHtml } from '../lib/printInvoice';
import { loadPagedScript } from '../lib/pagedScript';
import { InvoicePreview, type RenderPreview } from '../components/invoices/InvoicePreview';
import { upnQrSvg } from '../lib/upnQr';
import { formatIban, paymentReference, upnQrPayload } from '../../supabase/functions/_shared/invoice/payment';
import { InvoiceEmailDialog } from '../components/invoices/InvoiceEmailDialog';
import { useEmailTemplates } from '../hooks/useEmailTemplates';
import { fillTemplateText } from '../../supabase/functions/_shared/email/templates';
import { TEMPLATE_DEFS, type TemplateKey, type TemplateVars } from '../../supabase/functions/_shared/email/templateDefs';
import { invoiceHtmlToPdfBase64 } from '../lib/invoicePdf';
import type { InvoiceBuyer } from '../../supabase/functions/_shared/invoice/render';
import { invoiceTotal, invoiceVat, lineTotal, vatBreakdown } from '../../supabase/functions/_shared/invoice/calc';
import {
  PAYMENT_METHOD_LABELS,
  formatDate,
  formatDateTime,
  formatEur,
  renderInvoiceHtml,
  upnQrInputFor,
  type InvoiceDocument,
  type PaymentMethod,
} from '../../supabase/functions/_shared/invoice/render';

// One invoice — a draft is edited here (lines picked from the price list),
// then issued: issue_invoice() (supabase/migrations/023_add_invoicing.sql)
// gives it its gapless FURS-shaped number and freezes it. An issued invoice
// is read-only: print (A4 or thermal roll), mark a bank transfer paid, or
// cancel it with a credit note (storno). A full page rather than a modal — a
// multi-line invoice is too cramped in one.

interface InvoiceEditorProps {
  invoiceId: string;
  /** Where "back" goes — the patient record or the Računi list. */
  onBack: () => void;
  backLabel: string;
  /** Opened from a patient record: also offer the Računi list. */
  onBackToInvoices?: () => void;
  /** Opens another invoice (the credit note after a storno, or its original). */
  onOpenInvoice: (invoiceId: string) => void;
  onSignOut: () => void;
  onNavigateHome: () => void;
  onNavigateCalendar: () => void;
  onNavigateStoritve: () => void;
  onNavigateEmail: () => void;
  /** Opens Nastavitve on the "Podatki za račune" tab. */
  onNavigateInvoiceSettings: () => void;
  onNavigateSettings: () => void;
  onNavigateInvoices: () => void;
}

const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'card', 'transfer'];

const CELL_INPUT =
  'w-full min-w-0 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm text-[var(--ink,#1c2624)] hover:border-[var(--line,#ccd6d4)] focus:border-[var(--accent,#2e6e62)] focus:bg-[var(--surface,#fff)] focus:outline-none';

const EMPTY_PAYER: InvoiceBuyer = { name: '', address: '', postalCode: '', city: '', taxNumber: '' };

const PAYER_INPUT = 'rounded border border-[var(--line,#ccd6d4)] px-3 py-1.5 text-sm';

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function printFormatLabel(format: 'a4' | 'receipt'): string {
  return format === 'a4' ? 'A4' : 'na trak';
}

function vatLabel(rate: number): string {
  return rate === 0 ? 'oproščeno' : `${String(rate).replace('.', ',')} %`;
}

function sameDraft(a: { fields: DraftFields; lines: InvoiceLineDraft[] }, b: { fields: DraftFields; lines: InvoiceLineDraft[] }) {
  const strip = (lines: InvoiceLineDraft[]) => lines.map(({ key: _key, ...rest }) => rest);
  return JSON.stringify(a.fields) === JSON.stringify(b.fields) && JSON.stringify(strip(a.lines)) === JSON.stringify(strip(b.lines));
}

export function InvoiceEditor(props: InvoiceEditorProps) {
  const { invoiceId, onBack, backLabel, onOpenInvoice } = props;
  const { practiceName } = usePracticeContext();
  const { invoice, loading, error, saveDraft, deleteDraft, issue, setPaid, cancel, sendByEmail } = useInvoice(invoiceId);
  const [emailOpen, setEmailOpen] = useState(false);
  const { overrides: templateOverrides } = useEmailTemplates();
  const { settings, loading: settingsLoading, reload: reloadSettings } = useInvoiceSettings();
  const liveIssuer = useMemo(() => settingsToIssuer(settings), [settings]);

  // Settings may be changed in another browser tab (e.g. the roll width) —
  // pick them up when this one comes back into focus.
  useEffect(() => {
    const onFocus = () => reloadSettings();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reloadSettings]);
  const { services } = usePriceList();

  const [fields, setFields] = useState<DraftFields>({ serviceDate: todayIso(), paymentMethod: 'cash', note: '', payer: EMPTY_PAYER });
  const [lines, setLines] = useState<InvoiceLineDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'issue' | 'delete' | 'cancel' | null>(null);
  const [issueAndPrint, setIssueAndPrint] = useState(false);
  const [printWhenIssued, setPrintWhenIssued] = useState(false);

  // Reset the local draft to what's stored whenever the invoice (re)loads.
  useEffect(() => {
    if (!invoice) return;
    setFields({
      serviceDate: invoice.serviceDate,
      paymentMethod: invoice.paymentMethod,
      note: invoice.note,
      payer: invoice.buyer,
    });
    setLines(invoice.lines);
  }, [invoice]);

  const isDraft = invoice?.status === 'draft';
  const dirty =
    !!invoice &&
    isDraft &&
    !sameDraft(
      { fields, lines },
      {
        fields: {
          serviceDate: invoice.serviceDate,
          paymentMethod: invoice.paymentMethod,
          note: invoice.note,
          payer: invoice.buyer,
        },
        lines: invoice.lines,
      }
    );

  const doc: InvoiceDocument | null = useMemo(() => {
    if (!invoice) return null;
    return {
      status: invoice.status,
      kind: invoice.kind,
      number: invoice.number,
      originalNumber: invoice.originalNumber,
      issuedAt: invoice.issuedAt,
      serviceDate: isDraft ? fields.serviceDate : invoice.serviceDate,
      dueDate: invoice.dueDate,
      paymentMethod: isDraft ? fields.paymentMethod : invoice.paymentMethod,
      paidAt: invoice.paidAt,
      cancelled: !!invoice.cancelledAt,
      // The issue-time snapshot, but always the CURRENT logo (it isn't
      // snapshotted — see migration 024).
      // The issue-time snapshot for everything with legal weight (name, tax
      // numbers, IBAN …); logo, footer and contact lines are presentation and
      // always come from the current settings.
      issuer: {
        ...settingsToIssuer(invoice.issuerSnapshot ?? settings),
        logoDataUrl: liveIssuer.logoDataUrl,
        footerNote: liveIssuer.footerNote,
        phone: liveIssuer.phone,
        email: liveIssuer.email,
        website: liveIssuer.website,
      },
      buyer: isDraft ? fields.payer : invoice.buyer,
      lines: isDraft ? lines : invoice.lines,
      note: (isDraft ? fields.note : invoice.note) || null,
    };
  }, [invoice, isDraft, fields, lines, settings, liveIssuer]);

  // UPN QR for an unpaid bank-transfer invoice (null otherwise).
  const qrSvg = useMemo(() => {
    const input = doc ? upnQrInputFor(doc) : null;
    return input ? upnQrSvg(upnQrPayload(input)) : null;
  }, [doc]);

  // Paged.js (real A4 sheets, repeated header/footer, page numbers) — loaded
  // once per session; until it arrives the preview shows the plain layout.
  const [pagedScript, setPagedScript] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadPagedScript()
      .then((src) => {
        if (!cancelled) setPagedScript(src);
      })
      .catch(() => {
        // Plain single-flow layout stays as the fallback.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Without a preview id: the attachment preview in the email window.
  const liveHtml = useMemo(
    () => (doc ? renderInvoiceHtml(doc, { format: 'a4' }, { upnQrSvg: qrSvg, pagedScript: pagedScript ?? undefined }) : ''),
    [doc, qrSvg, pagedScript]
  );
  // The live preview (InvoicePreview: renders each update behind the visible
  // one and swaps it in once its pages are laid out).
  const renderPreview = useCallback<RenderPreview>(
    ({ previewId, paged }) =>
      doc
        ? renderInvoiceHtml(doc, { format: 'a4' }, { upnQrSvg: qrSvg, pagedScript: paged ? (pagedScript ?? undefined) : undefined, previewId })
        : '',
    [doc, qrSvg, pagedScript]
  );

  async function run(action: () => Promise<{ error?: string }>) {
    setBusy(true);
    setActionError(null);
    const result = await action();
    setBusy(false);
    if (result.error) setActionError(result.error);
    return !result.error;
  }

  async function handleSave() {
    await run(() => saveDraft(fields, lines));
  }

  /** Leaving the editor (back link, menu, sign-out) saves unsaved draft
      changes first; if saving fails, it stays here and shows the error. */
  function leave(go: () => void) {
    return async () => {
      if (dirty && !(await run(() => saveDraft(fields, lines)))) return;
      go();
    };
  }

  // Closing or reloading the tab can't wait for a save — the browser asks
  // for confirmation instead while the draft has unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  async function handleIssue() {
    setConfirming(null);
    const ok = await run(async () => {
      if (dirty) {
        const saved = await saveDraft(fields, lines);
        if (saved.error) return saved;
      }
      return issue();
    });
    if (ok && issueAndPrint) setPrintWhenIssued(true);
  }

  // "Izdaj in natisni": once the issued invoice has loaded (number, date …),
  // print it in the practice's default format (Nastavitve → Privzeto tiskanje).
  useEffect(() => {
    if (!printWhenIssued || invoice?.status !== 'issued') return;
    setPrintWhenIssued(false);
    printAs(settings.defaultPrintFormat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printWhenIssued, invoice]);

  /** Checks the draft, then asks for confirmation (issue, or issue + print). */
  function startIssue(andPrint: boolean) {
    // Never a silently disabled button — say what's missing.
    if (!fields.payer.name.trim()) {
      setActionError('Vpišite plačnika (vsaj ime oz. naziv).');
      return;
    }
    if (lines.length === 0) {
      setActionError('Dodajte vsaj eno storitev iz cenika (vrstica »+ Dodaj storitev« v tabeli).');
      return;
    }
    setActionError(null);
    setIssueAndPrint(andPrint);
    setConfirming('issue');
  }

  async function handleDelete() {
    setConfirming(null);
    if (await run(deleteDraft)) onBack();
  }

  async function handleCancel() {
    setConfirming(null);
    setBusy(true);
    setActionError(null);
    const result = await cancel();
    setBusy(false);
    if (result.error) setActionError(result.error);
    else if (result.creditNoteId) onOpenInvoice(result.creditNoteId);
  }

  function printAs(format: 'a4' | 'receipt') {
    if (!doc) return;
    if (format === 'a4') {
      // With Paged.js the document lays out its pages, then prints itself.
      printHtml(renderInvoiceHtml(doc, { format: 'a4' }, { upnQrSvg: qrSvg, pagedScript: pagedScript ?? undefined, autoPrint: true }), {
        selfPrinting: !!pagedScript,
      });
    } else {
      printHtml(renderInvoiceHtml(doc, { format: 'receipt', widthMm: settings.receiptWidthMm }, { upnQrSvg: qrSvg }));
    }
  }

  function updateLine(key: string, patch: Partial<InvoiceLineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function addService(service: Service) {
    setLines((prev) => [
      ...prev,
      {
        key: newLineKey(),
        serviceId: service.id,
        code: service.code,
        name: service.name,
        vatRate: service.vatRate,
        toothFdi: null,
        quantity: 1,
        unitPriceEur: service.priceEur,
        discountPercent: 0,
      },
    ]);
  }

  // The email's text comes from the practice's "Račun" / "Dobropis" template
  // (E-pošta page), filled in with this invoice's values. The payment values
  // are left empty unless it's an unpaid bank transfer, so the template's
  // payment paragraph drops out by itself otherwise.
  function emailTemplate() {
    if (!invoice || !doc) return null;
    const key: TemplateKey = invoice.kind === 'credit_note' ? 'credit_note' : 'invoice';
    const payByTransfer = invoice.kind === 'invoice' && invoice.paymentMethod === 'transfer' && !invoice.paidAt && !invoice.cancelledAt;
    const vars: TemplateVars = {
      placnik: invoice.buyer.name,
      stevilka: invoice.number ?? '',
      racun: invoice.originalNumber ?? '',
      znesek: formatEur(invoiceTotal(invoice.lines)),
      rok_placila: payByTransfer && invoice.dueDate ? formatDate(invoice.dueDate) : '',
      iban: payByTransfer && doc.issuer.iban ? formatIban(doc.issuer.iban) : '',
      sklic: payByTransfer ? (paymentReference(invoice.number, invoice.issuedAt) ?? '') : '',
      ordinacija: doc.issuer.legalName,
    };
    return { key, filled: fillTemplateText(key, templateOverrides[key] ?? null, vars) };
  }

  const nav = (
    <AppNavShell
      userLabel={practiceName ?? undefined}
      onSignOut={leave(props.onSignOut)}
      onNavigateHome={leave(props.onNavigateHome)}
      onNavigateCalendar={leave(props.onNavigateCalendar)}
      onNavigateStoritve={leave(props.onNavigateStoritve)}
      onNavigateEmail={leave(props.onNavigateEmail)}
      onNavigateSettings={leave(props.onNavigateSettings)}
      onNavigateInvoices={leave(props.onNavigateInvoices)}
      activeSubmenu="racuni"
    />
  );

  if (loading || settingsLoading) {
    return (
      <>
        {nav}
        <p className="p-6 text-sm text-[var(--ink-soft,#45524f)]">Nalaganje…</p>
      </>
    );
  }
  if (error || !invoice || !doc) {
    return (
      <>
        {nav}
        <p className="p-6 text-sm text-[var(--danger,#b3261e)]">Napaka pri nalaganju računa: {error ?? 'ni najden'}</p>
      </>
    );
  }

  const state = invoiceState(invoice);
  const shownLines = isDraft ? lines : invoice.lines;
  const breakdown = vatBreakdown(shownLines);
  const settingsOk = invoiceSettingsComplete(settings);
  const kindLabel = invoice.kind === 'credit_note' ? 'Dobropis' : 'Račun';
  const emailTpl = emailOpen ? emailTemplate() : null;

  return (
    <>
      {nav}
      <div className="mx-auto flex max-w-[1500px] flex-col gap-4 p-6">
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          {props.onBackToInvoices && (
            <button
              type="button"
              onClick={leave(props.onBackToInvoices)}
              className="w-fit text-sm text-[var(--accent,#2e6e62)] hover:underline"
            >
              ← Nazaj na seznam računov
            </button>
          )}
          <button
            type="button"
            onClick={leave(onBack)}
            className="w-fit text-sm text-[var(--accent,#2e6e62)] hover:underline"
          >
            ← {backLabel}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-[var(--ink,#1c2624)]">
            {isDraft ? `Nov ${kindLabel.toLowerCase()} (osnutek)` : `${kindLabel} ${invoice.number}`}
          </h1>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${INVOICE_STATE_META[state].className}`}>
            {INVOICE_STATE_META[state].label}
          </span>
          <span className="text-sm text-[var(--ink-soft,#45524f)]">{isDraft ? fields.payer.name : invoice.buyer.name}</span>
        </div>

        {isDraft && !settingsOk && (
          <div className="flex flex-wrap items-center gap-3 rounded border border-[#e0231c] bg-[#fdecea] px-3 py-2 text-sm text-[#8a1c14]">
            Pred izdajo računa izpolnite podatke izdajatelja (vsaj naziv in davčno številko).
            <button type="button" onClick={leave(props.onNavigateInvoiceSettings)} className="font-semibold underline">
              Odpri Nastavitve → Podatki za račune
            </button>
          </div>
        )}
        {isDraft && fields.paymentMethod !== 'transfer' && (
          <p className="rounded border border-[#EF9F27] bg-[#fff6e5] px-3 py-2 text-sm text-[#6b4a00]">
            Davčno potrjevanje (FURS) še ni vključeno. Računov, plačanih z gotovino ali kartico, zato še ne uporabljajte za
            resnična plačila.
          </p>
        )}

        <div className="grid gap-6 min-[1200px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* ---- Left: editor (draft) or details (issued) ---- */}
          <div className="flex flex-col gap-5 rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-5">
            {isDraft ? (
              <div className="flex flex-wrap gap-6">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-[var(--ink-soft,#45524f)]">Datum opravljene storitve</span>
                  <input
                    type="date"
                    value={fields.serviceDate}
                    onChange={(e) => e.target.value && setFields({ ...fields, serviceDate: e.target.value })}
                    className="rounded border border-[var(--line,#ccd6d4)] px-3 py-1.5 text-sm"
                  />
                </label>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-[var(--ink-soft,#45524f)]">Način plačila</span>
                  <div className="flex gap-1.5">
                    {PAYMENT_METHODS.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setFields({ ...fields, paymentMethod: m })}
                        className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                          fields.paymentMethod === m
                            ? 'bg-[var(--accent,#2e6e62)] text-white'
                            : 'border border-[var(--line,#ccd6d4)] text-[var(--ink,#1c2624)] hover:border-[var(--accent,#2e6e62)]'
                        }`}
                      >
                        {m === 'transfer' ? 'Nakazilo' : PAYMENT_METHOD_LABELS[m]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {isDraft ? (
              <fieldset className="flex flex-col gap-2 rounded border border-[var(--line,#ccd6d4)] p-3">
                <legend className="flex items-center gap-3 px-1 text-xs font-semibold text-[var(--ink-soft,#45524f)]">
                  Plačnik
                  {invoice.patientBuyer && JSON.stringify(fields.payer) !== JSON.stringify(invoice.patientBuyer) && (
                    <button
                      type="button"
                      onClick={() => setFields({ ...fields, payer: invoice.patientBuyer! })}
                      className="font-normal text-[var(--accent,#2e6e62)] hover:underline"
                    >
                      Ponastavi na podatke pacienta
                    </button>
                  )}
                </legend>
                <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-2">
                  <input
                    value={fields.payer.name}
                    onChange={(e) => setFields({ ...fields, payer: { ...fields.payer, name: e.target.value } })}
                    placeholder="Ime in priimek oz. naziv podjetja"
                    className={PAYER_INPUT}
                  />
                  <input
                    value={fields.payer.taxNumber}
                    onChange={(e) => setFields({ ...fields, payer: { ...fields.payer, taxNumber: e.target.value } })}
                    placeholder="Davčna št. (neobvezno)"
                    className={PAYER_INPUT}
                  />
                  <input
                    value={fields.payer.address}
                    onChange={(e) => setFields({ ...fields, payer: { ...fields.payer, address: e.target.value } })}
                    placeholder="Naslov"
                    className={PAYER_INPUT}
                  />
                  <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-2">
                    <input
                      value={fields.payer.postalCode}
                      onChange={(e) => setFields({ ...fields, payer: { ...fields.payer, postalCode: e.target.value } })}
                      placeholder="Pošta"
                      inputMode="numeric"
                      className={PAYER_INPUT + ' min-w-0'}
                    />
                    <input
                      value={fields.payer.city}
                      onChange={(e) => setFields({ ...fields, payer: { ...fields.payer, city: e.target.value } })}
                      placeholder="Kraj"
                      className={PAYER_INPUT + ' min-w-0'}
                    />
                  </div>
                </div>
              </fieldset>
            ) : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm text-[var(--ink,#1c2624)]">
                <dt className="text-[var(--ink-soft,#45524f)]">Izdano</dt>
                <dd>
                  {invoice.issuedAt ? formatDateTime(invoice.issuedAt) : ''}
                  {invoice.issuedByEmail ? ` · ${invoice.issuedByEmail}` : ''}
                </dd>
                <dt className="text-[var(--ink-soft,#45524f)]">Storitev opravljena</dt>
                <dd>{formatDate(invoice.serviceDate)}</dd>
                <dt className="text-[var(--ink-soft,#45524f)]">Način plačila</dt>
                <dd>{PAYMENT_METHOD_LABELS[invoice.paymentMethod]}</dd>
                {invoice.dueDate && invoice.kind === 'invoice' && (
                  <>
                    <dt className="text-[var(--ink-soft,#45524f)]">Rok plačila</dt>
                    <dd>{formatDate(invoice.dueDate)}</dd>
                  </>
                )}
                {invoice.kind === 'invoice' && !invoice.cancelledAt && (
                  <>
                    <dt className="text-[var(--ink-soft,#45524f)]">Plačano</dt>
                    <dd>{invoice.paidAt ? formatDateTime(invoice.paidAt) : 'ne'}</dd>
                  </>
                )}
                {invoice.originalInvoiceId && (
                  <>
                    <dt className="text-[var(--ink-soft,#45524f)]">Dobropis k računu</dt>
                    <dd>
                      <button type="button" onClick={() => onOpenInvoice(invoice.originalInvoiceId!)} className="text-[var(--accent,#2e6e62)] hover:underline">
                        {invoice.originalNumber}
                      </button>
                    </dd>
                  </>
                )}
                {invoice.creditNote && (
                  <>
                    <dt className="text-[var(--ink-soft,#45524f)]">Storniran z dobropisom</dt>
                    <dd>
                      <button type="button" onClick={() => onOpenInvoice(invoice.creditNote!.id)} className="text-[var(--accent,#2e6e62)] hover:underline">
                        {invoice.creditNote.number}
                      </button>
                    </dd>
                  </>
                )}
                {invoice.emailLog.length > 0 && (
                  <>
                    <dt className="text-[var(--ink-soft,#45524f)]">Poslano po e-pošti</dt>
                    <dd className="flex flex-col">
                      {invoice.emailLog.map((e) => (
                        <span key={`${e.to}-${e.sentAt}`} className={e.status === 'failed' || e.status === 'bounced' ? 'text-[var(--danger,#b3261e)]' : ''}>
                          {formatDateTime(e.sentAt)} → {e.to}
                          {e.status === 'failed' ? ' (ni uspelo)' : e.status === 'bounced' ? ' (zavrnjeno)' : ''}
                        </span>
                      ))}
                    </dd>
                  </>
                )}
              </dl>
            )}

            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--ink-soft,#45524f)]">
                  <th className="w-[70px] px-1.5 pb-1 font-semibold">Šifra</th>
                  <th className="px-1.5 pb-1 font-semibold">Storitev</th>
                  <th className="w-[52px] px-1.5 pb-1 font-semibold">Zob</th>
                  <th className="w-[62px] px-1.5 pb-1 text-right font-semibold">Kol.</th>
                  <th className="w-[86px] px-1.5 pb-1 text-right font-semibold">Cena €</th>
                  <th className="w-[66px] px-1.5 pb-1 text-right font-semibold">Popust %</th>
                  <th className="w-[76px] px-1.5 pb-1 font-semibold">DDV</th>
                  <th className="w-[86px] px-1.5 pb-1 text-right font-semibold">Znesek</th>
                  {isDraft && <th className="w-[28px]" />}
                </tr>
              </thead>
              <tbody>
                {shownLines.map((line) =>
                  isDraft ? (
                    <tr key={line.key} className="border-t border-[var(--line,#ccd6d4)]">
                      <td className="px-1.5 py-1 text-[var(--muted,#6f7c79)]">{line.code}</td>
                      <td className="px-1.5 py-1">{line.name}</td>
                      <td className="p-0.5">
                        <input
                          value={line.toothFdi ?? ''}
                          onChange={(e) => updateLine(line.key, { toothFdi: e.target.value.replace(/\D/g, '').slice(0, 2) || null })}
                          inputMode="numeric"
                          placeholder="—"
                          className={CELL_INPUT + ' text-center placeholder:text-[var(--muted,#6f7c79)]'}
                        />
                      </td>
                      <td className="p-0.5">
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={line.quantity}
                          onChange={(e) => updateLine(line.key, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                          className={CELL_INPUT + ' text-right'}
                        />
                      </td>
                      <td className="p-0.5">
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={line.unitPriceEur}
                          onChange={(e) => updateLine(line.key, { unitPriceEur: Math.max(0, Math.round((Number(e.target.value) || 0) * 100) / 100) })}
                          className={CELL_INPUT + ' text-right'}
                        />
                      </td>
                      <td className="p-0.5">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          value={line.discountPercent}
                          onChange={(e) => updateLine(line.key, { discountPercent: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
                          className={CELL_INPUT + ' text-right'}
                        />
                      </td>
                      <td className="px-1.5 py-1 text-[var(--ink-soft,#45524f)]">{vatLabel(line.vatRate)}</td>
                      <td className="px-1.5 py-1 text-right font-medium">{formatEur(lineTotal(line))}</td>
                      <td className="text-center">
                        <button
                          type="button"
                          aria-label="Odstrani postavko"
                          onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                          className="text-[var(--muted,#6f7c79)] hover:text-[var(--danger,#b3261e)]"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={line.key} className="border-t border-[var(--line,#ccd6d4)]">
                      <td className="px-1.5 py-1.5 text-[var(--muted,#6f7c79)]">{line.code}</td>
                      <td className="px-1.5 py-1.5">{line.name}</td>
                      <td className="px-1.5 py-1.5">{line.toothFdi}</td>
                      <td className="px-1.5 py-1.5 text-right">{line.quantity}</td>
                      <td className="px-1.5 py-1.5 text-right">{formatEur(line.unitPriceEur)}</td>
                      <td className="px-1.5 py-1.5 text-right">{line.discountPercent ? `${line.discountPercent} %` : ''}</td>
                      <td className="px-1.5 py-1.5 text-[var(--ink-soft,#45524f)]">{vatLabel(line.vatRate)}</td>
                      <td className="px-1.5 py-1.5 text-right font-medium">{formatEur(lineTotal(line))}</td>
                    </tr>
                  )
                )}
                {isDraft && (
                  <tr className="border-t border-[var(--line,#ccd6d4)]">
                    <td colSpan={9} className="p-0.5">
                      <ServicePicker services={services} onPick={addService} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="flex flex-col items-end gap-1 text-sm text-[var(--ink,#1c2624)]">
              <span className="text-[var(--ink-soft,#45524f)]">
                Skupaj brez DDV: {formatEur(Math.round((invoiceTotal(shownLines) - invoiceVat(shownLines)) * 100) / 100)}
              </span>
              {breakdown.map((r) => (
                <span key={r.rate} className="text-[var(--ink-soft,#45524f)]">
                  DDV {String(r.rate).replace('.', ',')} % (osnova {formatEur(r.net)}): {formatEur(r.vat)}
                </span>
              ))}
              <span className="text-lg font-bold">Skupaj za plačilo: {formatEur(invoiceTotal(shownLines))}</span>
            </div>

            {isDraft ? (
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-[var(--ink-soft,#45524f)]">Opomba na računu (neobvezno)</span>
                <textarea
                  value={fields.note}
                  onChange={(e) => setFields({ ...fields, note: e.target.value })}
                  rows={2}
                  className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-sm"
                />
              </label>
            ) : (
              invoice.note && <p className="text-sm text-[var(--ink-soft,#45524f)]">Opomba: {invoice.note}</p>
            )}

            {actionError && <p className="text-sm text-[var(--danger,#b3261e)]">{actionError}</p>}

            <div className="flex flex-wrap gap-2">
              {isDraft ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => startIssue(false)}
                    className="rounded bg-[var(--accent,#2e6e62)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
                  >
                    Izdaj račun
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => startIssue(true)}
                    className="rounded bg-[var(--accent,#2e6e62)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
                  >
                    Izdaj in natisni ({printFormatLabel(settings.defaultPrintFormat)})
                  </button>
                  <button
                    type="button"
                    disabled={busy || !dirty}
                    onClick={handleSave}
                    className="rounded border border-[var(--line,#ccd6d4)] px-4 py-2 text-sm text-[var(--ink,#1c2624)] hover:border-[var(--accent,#2e6e62)] disabled:opacity-40"
                  >
                    {dirty ? 'Shrani osnutek' : 'Osnutek shranjen'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirming('delete')}
                    className="ml-auto rounded px-3 py-2 text-sm text-[var(--danger,#b3261e)] hover:underline disabled:opacity-40"
                  >
                    Izbriši osnutek
                  </button>
                </>
              ) : (
                <>
                  {/* The practice's default printout first and filled; the other
                      outlined, so the wrong one isn't clicked by habit. */}
                  {([settings.defaultPrintFormat, settings.defaultPrintFormat === 'a4' ? 'receipt' : 'a4'] as const).map((format, i) => (
                    <button
                      key={format}
                      type="button"
                      onClick={() => printAs(format)}
                      className={
                        i === 0
                          ? 'rounded bg-[var(--accent,#2e6e62)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90'
                          : 'rounded border border-[var(--line,#ccd6d4)] px-4 py-2 text-sm text-[var(--ink,#1c2624)] hover:border-[var(--accent,#2e6e62)]'
                      }
                    >
                      Natisni {printFormatLabel(format)}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setEmailOpen(true)}
                    className="rounded bg-[var(--accent,#2e6e62)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
                  >
                    Pošlji po e-pošti
                  </button>
                  {invoice.kind === 'invoice' && !invoice.cancelledAt && invoice.paymentMethod === 'transfer' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => setPaid(!invoice.paidAt))}
                      className="rounded border border-[var(--line,#ccd6d4)] px-4 py-2 text-sm text-[var(--ink,#1c2624)] hover:border-[var(--accent,#2e6e62)] disabled:opacity-40"
                    >
                      {invoice.paidAt ? 'Označi kot neplačano' : 'Označi kot plačano'}
                    </button>
                  )}
                  {invoice.kind === 'invoice' && !invoice.cancelledAt && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirming('cancel')}
                      className="ml-auto rounded px-3 py-2 text-sm text-[var(--danger,#b3261e)] hover:underline disabled:opacity-40"
                    >
                      Storniraj
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ---- Right: live A4 preview — the same pages "Natisni A4" prints ---- */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-[var(--ink-soft,#45524f)]">Predogled (A4)</span>
            <InvoicePreview render={renderPreview} className="h-[900px]" />
          </div>
        </div>
      </div>

      {emailOpen && !isDraft && emailTpl && (
        <InvoiceEmailDialog
          initialRecipients={invoice.patientEmail ? [invoice.patientEmail.toLowerCase()] : []}
          initialSubject={emailTpl.filled.subject}
          initialMessage={emailTpl.filled.body}
          heading={emailTpl.filled.heading}
          templateLabel={TEMPLATE_DEFS[emailTpl.key].label}
          filename={`${invoice.kind === 'credit_note' ? 'Dobropis' : 'Racun'}-${invoice.number}.pdf`}
          previewHtml={liveHtml}
          makePdf={async () => {
            const script = pagedScript ?? (await loadPagedScript());
            return invoiceHtmlToPdfBase64(renderInvoiceHtml(doc, { format: 'a4' }, { upnQrSvg: qrSvg, pagedScript: script }));
          }}
          onSend={sendByEmail}
          onClose={() => setEmailOpen(false)}
        />
      )}
      {confirming === 'issue' && (
        <ConfirmDialog onCancel={() => setConfirming(null)} onConfirm={handleIssue} confirmLabel={issueAndPrint ? 'Izdaj in natisni' : 'Izdaj'}>
          Ali res želite izdati račun za <strong>{formatEur(invoiceTotal(lines))}</strong>
          {issueAndPrint ? ` in ga natisniti (${printFormatLabel(settings.defaultPrintFormat)})` : ''}? Po izdaji računa ni več
          mogoče spreminjati — popravek je mogoč le s stornom.
        </ConfirmDialog>
      )}
      {confirming === 'delete' && (
        <ConfirmDialog onCancel={() => setConfirming(null)} onConfirm={handleDelete}>
          Ali res želite izbrisati ta osnutek računa?
        </ConfirmDialog>
      )}
      {confirming === 'cancel' && (
        <ConfirmDialog onCancel={() => setConfirming(null)} onConfirm={handleCancel} confirmLabel="Storniraj">
          Ali res želite stornirati račun <strong>{invoice.number}</strong>? Izdan bo dobropis z negativnimi zneski.
        </ConfirmDialog>
      )}
    </>
  );
}

// The permanent last row: type a name or code, pick a price-list service
// (click, or arrows + Enter) and it becomes a line; the box clears for the next.
function ServicePicker({ services, onPick }: { services: Service[]; onPick: (service: Service) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const active = services.filter((s) => s.isActive);
    const found = q ? active.filter((s) => s.name.toLowerCase().includes(q) || (s.code ?? '').toLowerCase().includes(q)) : active;
    return found.slice(0, 8);
  }, [services, query]);

  function pick(service: Service) {
    onPick(service);
    setQuery('');
    setHighlight(0);
    inputRef.current?.focus();
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, matches.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter' && matches[highlight]) {
            e.preventDefault();
            pick(matches[highlight]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder="+ Dodaj storitev iz cenika (ime ali šifra) …"
        className={CELL_INPUT + ' placeholder:font-semibold placeholder:text-[var(--accent,#2e6e62)]'}
      />
      {open && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] shadow-lg">
          {matches.length === 0 && (
            <li className="px-3 py-2 text-sm italic text-[var(--muted,#6f7c79)]">
              {services.length === 0 ? 'Cenik je prazen — storitve dodajte v Nastavitve → Cenik.' : 'Ni zadetkov.'}
            </li>
          )}
          {matches.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm ${
                  i === highlight ? 'bg-[#eef6f4]' : 'hover:bg-[#f7faf9]'
                }`}
              >
                <span>
                  {s.code && <span className="mr-2 text-[var(--muted,#6f7c79)]">{s.code}</span>}
                  {s.name}
                </span>
                <span className="whitespace-nowrap text-[var(--ink-soft,#45524f)]">{formatEur(s.priceEur)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
