import { useState } from 'react';
import { useConsentTemplates, usePatientConsents, type PatientConsent } from '../../hooks/useConsents';
import { useInvoiceSettings } from '../../hooks/useInvoiceSettings';
import { logPatientAccess } from '../../hooks/useAuditLog';
import { consentTextHtml, renderConsentPrintHtml } from '../../lib/consentPrint';
import { printHtml } from '../../lib/printInvoice';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { SignConsentModal } from './SignConsentModal';

// The patient record's "Soglasja" tab (migrations 058, 060): new consent from
// the practice's library, "Podpiši" (the dentist confirms the explanation; the
// patient signs now via a QR code on their phone or the practice tablet, or
// at home from an emailed link), viewing and printing signed ones.

interface PatientConsentsPanelProps {
  patientId: string;
  patientName: string;
  patientDob: string | null;
  patientEmail: string | null;
  practiceName: string;
}

function dateTime(iso: string): string {
  return new Date(iso).toLocaleString('sl-SI', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Ljubljana' });
}

const LINK_BUTTON = 'text-xs font-semibold text-[var(--accent,#2e6e62)] hover:underline disabled:opacity-50';

export function PatientConsentsPanel({ patientId, patientName, patientDob, patientEmail, practiceName }: PatientConsentsPanelProps) {
  const { templates } = useConsentTemplates();
  const { consents, loading, error, reload, createConsent, confirmExplained, cancelConsent, prepareLink, sendByEmail } = usePatientConsents(patientId);
  const { settings } = useInvoiceSettings();
  const [creating, setCreating] = useState(false);
  const [templateId, setTemplateId] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  // The "Podpiši" window (QR code).
  const [signingFor, setSigningFor] = useState<string | null>(null);
  const [viewing, setViewing] = useState<PatientConsent | null>(null);
  const [cancelling, setCancelling] = useState<PatientConsent | null>(null);

  // Forms without text (an unfinished one in the library) aren't offered.
  const activeTemplates = templates.filter((t) => t.isActive && t.body.trim() !== '');
  const signingConsent = consents.find((c) => c.id === signingFor) ?? null;

  async function create() {
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;
    setBusy(true);
    setNotice(null);
    const result = await createConsent({ templateId: template.id, title: template.title, body: template.body, details });
    setBusy(false);
    if (result.error || !result.id) {
      setNotice({ kind: 'error', text: result.error ?? 'Soglasja ni bilo mogoče ustvariti.' });
      return;
    }
    setCreating(false);
    setTemplateId('');
    setDetails('');
    setSigningFor(result.id);
  }

  function print(c: PatientConsent) {
    void logPatientAccess(patientId, 'print', { document: 'soglasje' });
    printHtml(
      renderConsentPrintHtml({
        practiceName: settings.legalName || practiceName,
        practiceLines: [settings.address, [settings.postalCode, settings.city].filter(Boolean).join(' '), settings.phone, settings.email],
        patientName,
        patientDob,
        title: c.title,
        body: c.body,
        details: c.details,
        signerName: c.signerName,
        signedAt: c.signedAt,
        signedVia: c.signedVia,
        signaturePng: c.signaturePng,
        explainedByName: c.explainedByName,
        explainedAt: c.explainedAt,
      })
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      {!creating ? (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="self-start rounded-full border border-[var(--ink,#1c2624)] px-3 py-1 text-xs font-semibold text-[var(--ink,#1c2624)] hover:border-[var(--accent,#2e6e62)] hover:text-[var(--accent,#2e6e62)]"
        >
          + Novo soglasje
        </button>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-[var(--line,#ccd6d4)] p-3">
          {activeTemplates.length === 0 ? (
            <p className="text-sm text-[var(--ink-soft,#45524f)]">V Nastavitve → Soglasja še ni nobenega soglasja.</p>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-xs text-[var(--ink-soft,#45524f)]">
                Soglasje
                <select
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  className="rounded border border-[var(--line,#ccd6d4)] px-2 py-1.5 text-sm text-[var(--ink,#1c2624)]"
                >
                  <option value="">Izberite …</option>
                  {activeTemplates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                      {t.needsReview ? ' (osnutek)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              {templates.find((t) => t.id === templateId)?.needsReview && (
                <p className="text-xs text-[#8a5a00]">To besedilo je osnutek, ki ga zobozdravnik še ni pregledal (Nastavitve → Soglasja).</p>
              )}
              <label className="flex flex-col gap-1 text-xs text-[var(--ink-soft,#45524f)]">
                Predvideni poseg (neobvezno)
                <input
                  type="text"
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  maxLength={2000}
                  placeholder="npr. zob 36, implantat"
                  className="rounded border border-[var(--line,#ccd6d4)] px-2 py-1.5 text-sm text-[var(--ink,#1c2624)]"
                />
              </label>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={create}
              disabled={!templateId || busy}
              className="rounded bg-[var(--accent,#2e6e62)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              Naprej na podpis
            </button>
            <button type="button" onClick={() => setCreating(false)} disabled={busy} className="px-2 text-xs text-[var(--ink-soft,#45524f)]">
              Prekliči
            </button>
          </div>
        </div>
      )}

      {notice && (
        <p className={`text-xs ${notice.kind === 'error' ? 'text-[var(--danger,#b3261e)]' : 'text-[var(--accent,#2e6e62)]'}`}>{notice.text}</p>
      )}
      {error && <p className="text-xs text-[var(--danger,#b3261e)]">Napaka pri nalaganju: {error}</p>}
      {!loading && consents.length === 0 && <p className="text-sm italic text-[var(--muted,#6f7c79)]">Pacient še nima soglasij.</p>}

      <ul className="flex flex-col gap-2">
        {consents.map((c) => {
          const expired = !c.signedAt && new Date(c.expiresAt).getTime() < Date.now();
          return (
            <li key={c.id} className={`rounded-md bg-[#e7e7e7] p-3 text-sm ${c.cancelledAt ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-[var(--ink,#1c2624)]">{c.title}</span>
                {c.signedAt ? (
                  <span className="text-xs text-[var(--accent,#2e6e62)]">
                    ✓ Podpisano {dateTime(c.signedAt)}
                  </span>
                ) : c.cancelledAt ? (
                  <span className="text-xs text-[var(--muted,#6f7c79)]">Preklicano</span>
                ) : (
                  <span className="rounded-full bg-[#fff1cc] px-2 py-0.5 text-[11px] font-semibold text-[#8a5a00]">
                    {expired ? 'Povezava potekla' : c.sentAt ? `Poslano po e-pošti ${dateTime(c.sentAt)}` : 'Čaka na podpis'}
                  </span>
                )}
              </div>
              {c.details && <div className="text-xs text-[var(--ink-soft,#45524f)]">Poseg: {c.details}</div>}
              <div className="mt-1 text-xs text-[var(--ink-soft,#45524f)]">
                {c.explainedAt && <>Pojasnil: {c.explainedByName ?? '—'}</>}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-3">
                <button type="button" onClick={() => setViewing(c)} className={LINK_BUTTON}>
                  Odpri
                </button>
                {c.signedAt && (
                  <button type="button" onClick={() => print(c)} className={LINK_BUTTON}>
                    Natisni
                  </button>
                )}
                {!c.signedAt && !c.cancelledAt && (
                  <>
                    <button type="button" onClick={() => setSigningFor(c.id)} disabled={busy} className={LINK_BUTTON}>
                      Podpiši
                    </button>
                    <button type="button" onClick={() => setCancelling(c)} disabled={busy} className="text-xs text-[var(--danger,#b3261e)] hover:underline">
                      Prekliči
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {signingConsent && (
        <SignConsentModal
          consent={signingConsent}
          onConfirmExplained={() => confirmExplained(signingConsent.id)}
          onPrepareLink={() => prepareLink(signingConsent.id)}
          patientEmail={patientEmail}
          onSendEmail={() => sendByEmail(signingConsent.id)}
          onRefresh={reload}
          onClose={() => setSigningFor(null)}
        />
      )}

      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={() => setViewing(null)}>
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-3 overflow-y-auto rounded-md bg-[var(--surface,#fff)] p-5 shadow-xl"
          >
            <h2 className="text-lg font-semibold text-[var(--ink,#1c2624)]">{viewing.title}</h2>
            {viewing.details && <p className="text-sm">Predvideni poseg: {viewing.details}</p>}
            <div
              className="text-sm leading-relaxed text-[var(--ink,#1c2624)] [&_p]:mb-2"
              // Escaped by consentTextHtml (only <p>, <br>, <strong> are produced).
              dangerouslySetInnerHTML={{ __html: consentTextHtml(viewing.body) }}
            />
            {viewing.signaturePng && (
              <div className="border-t border-[var(--line,#ccd6d4)] pt-3 text-sm">
                <img src={viewing.signaturePng} alt="Podpis pacienta" className="h-20 max-w-full object-contain" />
                {viewing.signerName} · {viewing.signedAt && dateTime(viewing.signedAt)}
              </div>
            )}
            <p className="text-xs text-[var(--muted,#6f7c79)]">
              Ustvaril/a {viewing.createdByName ?? '—'}, {dateTime(viewing.createdAt)}
              {viewing.explainedAt && ` · Pojasnil ${viewing.explainedByName ?? '—'}, ${dateTime(viewing.explainedAt)}`}
            </p>
            <div className="flex justify-end gap-2">
              {viewing.signedAt && (
                <button type="button" onClick={() => print(viewing)} className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-sm">
                  Natisni
                </button>
              )}
              <button type="button" onClick={() => setViewing(null)} className="rounded bg-[var(--accent,#2e6e62)] px-3 py-2 text-sm font-semibold text-white">
                Zapri
              </button>
            </div>
          </div>
        </div>
      )}

      {cancelling && (
        <ConfirmDialog
          onCancel={() => setCancelling(null)}
          onConfirm={async () => {
            const target = cancelling;
            setCancelling(null);
            const result = await cancelConsent(target.id);
            if (result.error) setNotice({ kind: 'error', text: result.error });
          }}
          confirmLabel="Prekliči soglasje"
        >
          Preklicati soglasje »{cancelling.title}«? Povezava, poslana pacientu, ne bo več delovala.
        </ConfirmDialog>
      )}
    </div>
  );
}
