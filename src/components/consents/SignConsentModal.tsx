import { useEffect, useState } from 'react';
import type { PatientConsent } from '../../hooks/useConsents';
import { linkQrSvg } from '../../lib/upnQr';
import { publicPageUrl } from '../../lib/publicPages';

// "Podpiši" on a consent (migrations 058, 060): the dentist confirms they
// explained the procedure, then either
//   * a QR code — the patient scans it with their phone (or the practice
//     tablet scans it) and signs there; the window checks every 3 seconds, or
//   * an email — the patient reads it in peace at home and signs (or calls
//     with questions first).
// Both open docs/patient-consent.html. The explanation always comes first, in
// the practice (Gregor).

interface SignConsentModalProps {
  consent: PatientConsent;
  onConfirmExplained: () => Promise<{ error?: string }>;
  onPrepareLink: () => Promise<{ token?: string; error?: string }>;
  patientEmail: string | null;
  onSendEmail: () => Promise<{ sentTo?: string; error?: string }>;
  /** Re-reads the consent (polled while waiting for the signature). */
  onRefresh: () => void;
  onClose: () => void;
}

export function SignConsentModal({ consent, onConfirmExplained, onPrepareLink, patientEmail, onSendEmail, onRefresh, onClose }: SignConsentModalProps) {
  const [explained, setExplained] = useState(!!consent.explainedAt);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const signed = !!consent.signedAt;

  useEffect(() => {
    if (!qrUrl || signed) return;
    const timer = setInterval(onRefresh, 3000);
    return () => clearInterval(timer);
  }, [qrUrl, signed, onRefresh]);

  async function ensureExplained(): Promise<boolean> {
    if (consent.explainedAt) return true;
    const confirmed = await onConfirmExplained();
    if (confirmed.error) setError(confirmed.error);
    return !confirmed.error;
  }

  async function sendEmail() {
    setBusy(true);
    setError(null);
    if (!(await ensureExplained())) {
      setBusy(false);
      return;
    }
    const result = await onSendEmail();
    setBusy(false);
    if (result.error) setError(result.error);
    else setSentTo(result.sentTo ?? patientEmail);
  }

  async function showQr() {
    setBusy(true);
    setError(null);
    if (!(await ensureExplained())) {
      setBusy(false);
      return;
    }
    const result = await onPrepareLink();
    setBusy(false);
    if (result.error || !result.token) {
      setError(result.error ?? 'Povezave ni bilo mogoče pripraviti.');
      return;
    }
    setQrUrl(publicPageUrl('patient-consent.html', { token: result.token }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={busy ? undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-md bg-[var(--surface,#fff)] p-5 shadow-xl"
      >
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink,#1c2624)]">Podpis soglasja</h2>
          <p className="text-sm text-[var(--ink-soft,#45524f)]">
            {consent.title}
            {consent.details ? ` — ${consent.details}` : ''}
          </p>
        </div>

        {signed ? (
          <div className="rounded-md bg-[#e9f4f1] p-4 text-sm text-[var(--accent,#2e6e62)]">✓ Pacient je soglasje podpisal.</div>
        ) : sentTo ? (
          <div className="rounded-md bg-[#e9f4f1] p-4 text-sm text-[var(--accent,#2e6e62)]">
            ✓ Soglasje poslano na {sentTo}. Pacient ga lahko prebere in podpiše doma (povezava velja 30 dni) — podpis se prikaže v
            kartoteki.
          </div>
        ) : qrUrl ? (
          <div className="flex flex-col items-center gap-3 text-center">
            <div
              className="w-64 max-w-full"
              // Our own QR SVG (lib/upnQr.ts), no user content.
              dangerouslySetInnerHTML={{ __html: linkQrSvg(qrUrl) }}
            />
            <p className="text-sm text-[var(--ink,#1c2624)]">
              Pacient naj kodo skenira s kamero telefona (ali tablice ordinacije), prebere soglasje in ga podpiše.
            </p>
            <p className="text-xs text-[var(--muted,#6f7c79)]">Čakam na podpis … (osveži se samodejno)</p>
            <a href={qrUrl} target="_blank" rel="noreferrer" className="text-xs text-[var(--accent,#2e6e62)] hover:underline">
              Odpri povezavo na tem računalniku ↗
            </a>
          </div>
        ) : (
          <>
            {!consent.explainedAt && (
              <label className="flex items-start gap-2 text-sm text-[var(--ink,#1c2624)]">
                <input type="checkbox" checked={explained} onChange={(e) => setExplained(e.target.checked)} className="mt-0.5 h-4 w-4 flex-none" />
                <span>Pacientu sem pojasnil(a) potek posega, koristi, tveganja in druge možnosti ter odgovoril(a) na vprašanja.</span>
              </label>
            )}
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={showQr}
                disabled={busy || !explained}
                className="rounded bg-[var(--accent,#2e6e62)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                Podpis zdaj — prikaži kodo QR
              </button>
              <button
                type="button"
                onClick={sendEmail}
                disabled={busy || !explained || !patientEmail}
                className="rounded border border-[var(--accent,#2e6e62)] px-4 py-2 text-sm font-semibold text-[var(--accent,#2e6e62)] disabled:opacity-50"
              >
                Pošlji po e-pošti — pacient podpiše doma
              </button>
              {!patientEmail && <span className="text-xs text-[var(--muted,#6f7c79)]">Pacient nima e-poštnega naslova.</span>}
            </div>
          </>
        )}

        {error && <p className="text-sm text-[var(--danger,#b3261e)]">{error}</p>}

        <div className="flex justify-end">
          <button type="button" onClick={onClose} disabled={busy} className="rounded border border-[var(--line,#ccd6d4)] px-4 py-2 text-sm">
            Zapri
          </button>
        </div>
      </div>
    </div>
  );
}
