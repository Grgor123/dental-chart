import { useState, type KeyboardEvent } from 'react';
import type { SendInvoiceEmailInput, SendInvoiceEmailResult } from '../../hooks/useInvoices';

// "Pošlji po e-pošti" — a popup like the print preview: the email on the
// left (recipients, subject, message), the attached invoice on the right.
// The patient's address is prefilled; more can be added (Enter, comma or
// leaving the field). The PDF is made only when "Pošlji" is pressed.
//
// The subject and message start from the practice's template (E-pošta →
// "Račun" / "Dobropis") and can be changed here for THIS email only. The
// default wording is edited only on the E-pošta page, where the placeholders
// are visible — saving from here (with values already filled in) made it too
// easy to lose a placeholder unnoticed (Gregor's explicit decision).

const MAX_RECIPIENTS = 5;
const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

interface InvoiceEmailDialogProps {
  initialRecipients: string[];
  initialSubject: string;
  initialMessage: string;
  /** Heading inside the email, from the template (edited on the E-pošta page). */
  heading: string;
  /** "Račun" or "Dobropis" — the E-pošta tab where the default text is edited. */
  templateLabel: string;
  filename: string;
  /** A4 preview of the attached invoice. */
  previewHtml: string;
  /** Builds the PDF (base64) from the invoice's pages. */
  makePdf: () => Promise<string>;
  onSend: (input: SendInvoiceEmailInput) => Promise<SendInvoiceEmailResult>;
  onClose: () => void;
}

const INPUT = 'w-full rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-sm focus:border-[var(--accent,#2e6e62)] focus:outline-none';

export function InvoiceEmailDialog(props: InvoiceEmailDialogProps) {
  const [recipients, setRecipients] = useState<string[]>(props.initialRecipients);
  const [draftRecipient, setDraftRecipient] = useState('');
  const [subject, setSubject] = useState(props.initialSubject);
  const [message, setMessage] = useState(props.initialMessage);
  const [phase, setPhase] = useState<'edit' | 'pdf' | 'sending' | 'done'>('edit');
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<NonNullable<SendInvoiceEmailResult['results']>>([]);
  /** Adds whatever is typed (may hold several addresses); false if invalid. */
  function commitDraft(): boolean {
    const parts = draftRecipient
      .split(/[\s,;]+/)
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    if (parts.length === 0) return true;
    const invalid = parts.filter((p) => !EMAIL_RE.test(p));
    if (invalid.length > 0) {
      setError(`Neveljaven e-poštni naslov: ${invalid.join(', ')}`);
      return false;
    }
    const next = [...new Set([...recipients, ...parts])];
    if (next.length > MAX_RECIPIENTS) {
      setError(`Največ ${MAX_RECIPIENTS} prejemnikov naenkrat.`);
      return false;
    }
    setRecipients(next);
    setDraftRecipient('');
    setError(null);
    return true;
  }

  function handleRecipientKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      e.preventDefault();
      commitDraft();
    } else if (e.key === 'Backspace' && draftRecipient === '' && recipients.length > 0) {
      setRecipients(recipients.slice(0, -1));
    }
  }

  async function handleSend() {
    if (!commitDraft()) return;
    // commitDraft's state update isn't visible yet in this call — recompute.
    const typed = draftRecipient
      .split(/[\s,;]+/)
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    const to = [...new Set([...recipients, ...typed])];
    if (to.length === 0) {
      setError('Vpišite vsaj enega prejemnika.');
      return;
    }
    if (!subject.trim()) {
      setError('Vpišite zadevo.');
      return;
    }
    setError(null);
    try {
      setPhase('pdf');
      const pdfBase64 = await props.makePdf();
      setPhase('sending');
      const result = await props.onSend({ to, subject: subject.trim(), heading: props.heading, message, pdfBase64, filename: props.filename });
      if (result.error) {
        setError(result.error);
        setPhase('edit');
        return;
      }
      setResults(result.results ?? []);
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('edit');
    }
  }

  const busy = phase === 'pdf' || phase === 'sending';
  const failed = results.filter((r) => r.status === 'failed');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={busy ? undefined : props.onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pošlji račun po e-pošti"
        onClick={(e) => e.stopPropagation()}
        className="grid max-h-[94vh] w-full max-w-[1200px] grid-cols-1 gap-5 overflow-y-auto rounded-md bg-[var(--surface,#fff)] p-5 shadow-xl min-[1000px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      >
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-[var(--ink,#1c2624)]">Pošlji račun po e-pošti</h2>
            <button
              type="button"
              onClick={props.onClose}
              disabled={busy}
              aria-label="Zapri"
              className="text-[var(--ink-soft,#45524f)] hover:text-[var(--accent,#2e6e62)] disabled:opacity-40"
            >
              ✕
            </button>
          </div>

          {phase === 'done' ? (
            <div className="flex flex-col gap-3 text-sm text-[var(--ink,#1c2624)]">
              {results
                .filter((r) => r.status === 'sent')
                .map((r) => (
                  <p key={r.to} className="rounded bg-[#e8f5e9] px-3 py-2 text-[#1b5e20]">
                    Poslano: {r.to}
                  </p>
                ))}
              {failed.map((r) => (
                <p key={r.to} className="rounded bg-[#fdecea] px-3 py-2 text-[#8a1c14]">
                  Ni poslano: {r.to} — {r.error}
                </p>
              ))}
              <button
                type="button"
                onClick={props.onClose}
                className="w-fit rounded bg-[var(--accent,#2e6e62)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                Zapri
              </button>
            </div>
          ) : (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-[var(--ink-soft,#45524f)]">Za</span>
                <div className="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded border border-[var(--line,#ccd6d4)] px-2 py-1.5 focus-within:border-[var(--accent,#2e6e62)]">
                  {recipients.map((r) => (
                    <span key={r} className="flex items-center gap-1 rounded-full bg-[#eef6f4] px-2.5 py-0.5 text-sm text-[var(--ink,#1c2624)]">
                      {r}
                      <button
                        type="button"
                        aria-label={`Odstrani ${r}`}
                        onClick={() => setRecipients(recipients.filter((x) => x !== r))}
                        className="text-[var(--muted,#6f7c79)] hover:text-[var(--danger,#b3261e)]"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                  <input
                    value={draftRecipient}
                    onChange={(e) => setDraftRecipient(e.target.value)}
                    onKeyDown={handleRecipientKey}
                    onBlur={() => commitDraft()}
                    placeholder={recipients.length === 0 ? 'ime@primer.si' : 'Dodaj prejemnika …'}
                    className="min-w-[160px] flex-1 border-0 px-1 py-0.5 text-sm focus:outline-none"
                  />
                </div>
                <span className="text-xs text-[var(--muted,#6f7c79)]">
                  {props.initialRecipients.length === 0
                    ? 'Plačnik nima e-poštnega naslova v sistemu — vpišite prejemnika. '
                    : ''}
                  Več naslovov ločite z vejico ali Enter (največ {MAX_RECIPIENTS}); vsak prejme svoje sporočilo.
                </span>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-[var(--ink-soft,#45524f)]">Zadeva</span>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} className={INPUT} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-[var(--ink-soft,#45524f)]">Sporočilo</span>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={10} className={INPUT} />
              </label>
              <p className="-mt-1 text-xs text-[var(--muted,#6f7c79)]">
                Spremembe veljajo samo za to sporočilo. Privzeto besedilo urejate v E-pošta → {props.templateLabel}.
              </p>
              <div className="flex items-center gap-2 text-sm text-[var(--ink,#1c2624)]">
                <span className="text-xs font-semibold text-[var(--ink-soft,#45524f)]">Priponka:</span>
                <span className="rounded border border-[var(--line,#ccd6d4)] px-2 py-0.5">📎 {props.filename}</span>
              </div>
              {error && <p className="text-sm text-[var(--danger,#b3261e)]">{error}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSend}
                  className="rounded bg-[var(--accent,#2e6e62)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {phase === 'pdf' ? 'Pripravljam PDF …' : phase === 'sending' ? 'Pošiljam …' : 'Pošlji'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={props.onClose}
                  className="rounded border border-[var(--line,#ccd6d4)] px-4 py-2 text-sm text-[var(--ink,#1c2624)] hover:bg-[#f7faf9] disabled:opacity-40"
                >
                  Prekliči
                </button>
              </div>
            </>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <span className="text-xs font-semibold text-[var(--ink-soft,#45524f)]">Priponka — {props.filename}</span>
          <iframe
            title="Predogled priponke"
            srcDoc={props.previewHtml}
            sandbox="allow-scripts"
            className="h-[70vh] w-full rounded-md border border-[var(--line,#ccd6d4)] bg-[#e9eeed]"
          />
        </div>
      </div>
    </div>
  );
}
