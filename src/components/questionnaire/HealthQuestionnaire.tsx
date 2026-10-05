import { useState, type ReactNode } from 'react';
import type { PatientListItem } from '../../hooks/usePatients';
import type { HealthQuestionnaire } from '../../hooks/useHealthQuestionnaire';
import {
  CONDITIONS,
  CONTACT_FIELDS,
  frequencyLabel,
  QUESTIONS,
  summarizeAlerts,
  type ContactData,
  type ContactKey,
} from '../../../supabase/functions/_shared/questionnaire';

// Frame 1 of the Patient Record page: the health banner (what the doctor
// must see before treating — allergies, medications, every "yes" answer and
// ticked condition, from the latest submitted questionnaire) with the
// "Vprašalnik" (full answers) and "Pošlji vprašalnik" buttons, plus the full
// questionnaire view itself.

const RED = '#e0231c';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('sl-SI', { day: 'numeric', month: 'numeric', year: 'numeric' });
}

function isOlderThan12Months(iso: string): boolean {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 12);
  return new Date(iso) < cutoff;
}

function patientContact(patient: PatientListItem): ContactData {
  return {
    firstName: patient.firstName ?? '',
    lastName: patient.lastName ?? '',
    dob: patient.dob ?? '',
    address: patient.address ?? '',
    postalCode: patient.postalCode ?? '',
    city: patient.city ?? '',
    phone: patient.phone ?? '',
    email: patient.email ?? '',
  };
}

/** Contact fields the patient changed versus what's on record now. */
export function contactDifferences(
  questionnaire: HealthQuestionnaire | null,
  patient: PatientListItem
): { key: ContactKey; label: string; current: string; submitted: string }[] {
  if (!questionnaire?.submittedContact || questionnaire.contactAppliedAt) return [];
  const current = patientContact(patient);
  const submitted = questionnaire.submittedContact;
  return CONTACT_FIELDS.filter((f) => (submitted[f.key] ?? '').trim() !== (current[f.key] ?? '').trim()).map((f) => ({
    key: f.key,
    label: f.label.sl,
    current: current[f.key],
    submitted: submitted[f.key] ?? '',
  }));
}

interface BannerProps {
  questionnaire: HealthQuestionnaire | null;
  pending: HealthQuestionnaire | null;
  hasContactChanges: boolean;
  onOpen: () => void;
  onSend: () => Promise<{ error?: string }>;
}

export function HealthBanner({ questionnaire, pending, hasContactChanges, onOpen, onSend }: BannerProps) {
  const [sendState, setSendState] = useState<{ kind: 'idle' | 'sending' | 'sent' } | { kind: 'error'; message: string }>({
    kind: 'idle',
  });

  async function handleSend() {
    setSendState({ kind: 'sending' });
    const result = await onSend();
    setSendState(result.error ? { kind: 'error', message: result.error } : { kind: 'sent' });
  }

  const alerts = questionnaire?.answers ? summarizeAlerts(questionnaire.answers) : null;
  const hasAlerts = !!alerts && (!!alerts.allergies || !!alerts.medications || alerts.conditions.length > 0);
  // Red only when there's something to warn about — a red bar saying
  // "nothing on file" would cry wolf.
  const tone = hasAlerts
    ? { background: RED, color: '#fff', muted: 'rgba(255,255,255,0.8)', buttonText: RED }
    : { background: '#e7ecea', color: 'var(--ink, #1c2624)', muted: 'var(--muted, #6f7c79)', buttonText: 'var(--ink, #1c2624)' };

  let statusNote = '';
  if (questionnaire?.submittedAt) {
    statusNote = `izpolnjen ${formatDate(questionnaire.submittedAt)}`;
    if (isOlderThan12Months(questionnaire.submittedAt)) statusNote += ' — starejši od 12 mesecev';
  }
  if (pending) statusNote = `${statusNote ? `${statusNote} · ` : ''}poslan ${formatDate(pending.sentAt)}, čaka na odgovor`;
  if (sendState.kind === 'sending') statusNote = 'Pošiljam …';
  if (sendState.kind === 'sent') statusNote = 'Vprašalnik poslan.';
  if (sendState.kind === 'error') statusNote = sendState.message;

  const chip = (text: string) => (
    <span className="flex-none rounded-full bg-white px-2 py-0.5 text-[11px] font-bold" style={{ color: tone.buttonText }}>
      {text}
    </span>
  );

  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-4 rounded-md px-4 py-2 text-sm font-bold"
      style={{ background: tone.background, color: tone.color }}
    >
      {alerts ? (
        <div className="grid min-w-0 flex-1 grid-cols-3 items-center gap-4 text-left">
          <span className="truncate" title={alerts.allergies ?? undefined}>
            Alergije: {alerts.allergies ?? 'ni navedeno'}
          </span>
          <span className="truncate" title={alerts.conditions.join(', ') || undefined}>
            Stanja: {alerts.conditions.length > 0 ? alerts.conditions.join(', ') : 'brez'}
          </span>
          <span className="truncate" title={alerts.medications ?? undefined}>
            Zdravila: {alerts.medications ?? 'ni navedeno'}
          </span>
        </div>
      ) : (
        <span className="min-w-0 flex-1 truncate text-left">Vprašalnik o zdravju še ni izpolnjen</span>
      )}
      {questionnaire && !questionnaire.reviewedAt && chip('Ni pregledano')}
      {hasContactChanges && chip('Posodobljeni podatki')}
      {statusNote && (
        <span
          className="max-w-[260px] flex-none truncate text-xs font-normal italic"
          style={{ color: sendState.kind === 'error' && !hasAlerts ? 'var(--danger, #b3261e)' : tone.muted }}
          title={statusNote}
        >
          {statusNote}
        </span>
      )}
      <button
        type="button"
        onClick={onOpen}
        className="flex-none rounded-full bg-white px-4 py-1.5 text-xs font-bold hover:bg-white/90"
        style={{ color: tone.buttonText }}
      >
        Vprašalnik
      </button>
      <button
        type="button"
        onClick={handleSend}
        disabled={sendState.kind === 'sending'}
        className="flex-none rounded-full border border-white bg-transparent px-4 py-1.5 text-xs font-bold hover:bg-white/15 disabled:opacity-60"
        style={hasAlerts ? undefined : { borderColor: 'var(--ink-soft, #45524f)' }}
      >
        Pošlji vprašalnik
      </button>
    </div>
  );
}

interface ModalProps {
  questionnaire: HealthQuestionnaire | null;
  pending: HealthQuestionnaire | null;
  patient: PatientListItem;
  onClose: () => void;
  onMarkReviewed: (id: string) => Promise<{ error?: string }>;
  onApplyContact: (fields: Partial<ContactData>) => Promise<{ error?: string }>;
  onDismissContact: (id: string) => Promise<{ error?: string }>;
}

export function HealthQuestionnaireModal({
  questionnaire,
  pending,
  patient,
  onClose,
  onMarkReviewed,
  onApplyContact,
  onDismissContact,
}: ModalProps) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const differences = contactDifferences(questionnaire, patient);
  const answers = questionnaire?.answers ?? null;

  async function run(action: () => Promise<{ error?: string }>) {
    setBusy(true);
    const result = await action();
    setBusy(false);
    setActionError(result.error ?? null);
  }

  let number = 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-md bg-[var(--surface,#fff)] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-xl font-bold text-[var(--ink,#1c2624)]">Vprašalnik o zdravju</h2>
          <button type="button" onClick={onClose} className="text-[var(--ink-soft,#45524f)] hover:text-[var(--accent,#2e6e62)]">
            ✕
          </button>
        </div>

        {!questionnaire || !answers ? (
          <p className="mt-3 text-sm text-[var(--ink-soft,#45524f)]">
            Pacient še ni izpolnil vprašalnika.
            {pending && ` Vprašalnik je bil poslan ${formatDate(pending.sentAt)} in čaka na odgovor.`}
          </p>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--ink-soft,#45524f)]">
              <span>
                Izpolnjen: <strong>{formatDate(questionnaire.submittedAt!)}</strong>
                {isOlderThan12Months(questionnaire.submittedAt!) && (
                  <span className="text-[var(--danger,#b3261e)]"> (starejši od 12 mesecev)</span>
                )}
              </span>
              <span>Podpis pacienta: {questionnaire.signatureName}</span>
              {questionnaire.language === 'en' && <span>Izpolnjen v angleščini</span>}
              <span className="ml-auto">
                {questionnaire.reviewedAt ? (
                  <>
                    Pregledal(a): {questionnaire.reviewedBy ?? '—'}, {formatDate(questionnaire.reviewedAt)}
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => onMarkReviewed(questionnaire.id))}
                    className="rounded bg-[var(--accent,#2e6e62)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                  >
                    Pregledano
                  </button>
                )}
              </span>
            </div>

            {differences.length > 0 && (
              <div className="mb-4 rounded border border-[#f0c36d] bg-[#fff8e6] p-3 text-sm">
                <p className="mb-2 font-semibold text-[var(--ink,#1c2624)]">Pacient je posodobil podatke</p>
                <table className="mb-3 w-full text-left text-sm">
                  <thead className="text-xs text-[var(--ink-soft,#45524f)]">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Podatek</th>
                      <th className="py-1 pr-3 font-medium">V kartoteki</th>
                      <th className="py-1 font-medium">Vnesel pacient</th>
                    </tr>
                  </thead>
                  <tbody>
                    {differences.map((d) => (
                      <tr key={d.key} className="border-t border-[#f0e0b0]">
                        <td className="py-1 pr-3">{d.label}</td>
                        <td className="py-1 pr-3 text-[var(--muted,#6f7c79)]">{d.current || '—'}</td>
                        <td className="py-1 font-semibold">{d.submitted || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const fields: Partial<ContactData> = {};
                        for (const d of differences) fields[d.key] = d.submitted;
                        const applied = await onApplyContact(fields);
                        if (applied.error) return applied;
                        return onDismissContact(questionnaire.id);
                      })
                    }
                    className="rounded bg-[var(--accent,#2e6e62)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                  >
                    Prevzemi
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => onDismissContact(questionnaire.id))}
                    className="rounded border border-[var(--line,#ccd6d4)] px-3 py-1.5 text-xs text-[var(--ink,#1c2624)] disabled:opacity-60"
                  >
                    Zavrzi
                  </button>
                </div>
              </div>
            )}

            {actionError && <p className="mb-3 text-sm text-[var(--danger,#b3261e)]">Napaka: {actionError}</p>}

            <ol className="flex flex-col text-sm text-[var(--ink,#1c2624)]">
              {QUESTIONS.map((q) => {
                if (q.kind === 'yesno' && !(q.id in answers.yesNo)) return null; // not shown to this patient (women-only)
                number += 1;
                let answer: ReactNode;
                if (q.kind === 'yesno') {
                  const yes = answers.yesNo[q.id] === 'yes';
                  answer = (
                    <>
                      <span className={yes ? 'font-bold text-[var(--danger,#b3261e)]' : 'text-[var(--muted,#6f7c79)]'}>
                        {yes ? 'DA' : 'NE'}
                      </span>
                      {yes && answers.details[q.id] && <span className="ml-2">— {answers.details[q.id]}</span>}
                    </>
                  );
                } else if (q.kind === 'text') {
                  const text = answers.texts[q.id];
                  answer = text ? (
                    <span className="whitespace-pre-wrap font-semibold">{text}</span>
                  ) : (
                    <span className="text-[var(--muted,#6f7c79)]">—</span>
                  );
                } else if (q.kind === 'medications') {
                  const medications = answers.medications ?? [];
                  answer =
                    medications.length > 0 ? (
                      <span className="flex flex-col gap-0.5">
                        {medications.map((m, i) => (
                          <span key={i}>
                            <span className="font-semibold">{m.name}</span>
                            <span className="text-[var(--ink-soft,#45524f)]"> — {frequencyLabel(m.frequency)}</span>
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="text-[var(--muted,#6f7c79)]">Ne jemlje zdravil</span>
                    );
                } else {
                  const ticked = CONDITIONS.filter((c) => answers.conditions.includes(c.id));
                  answer =
                    ticked.length > 0 ? (
                      <span className="flex flex-wrap gap-1.5">
                        {ticked.map((c) => (
                          <span key={c.id} className="rounded-full bg-[#fdecea] px-2 py-0.5 font-semibold text-[var(--danger,#b3261e)]">
                            {c.label.sl}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="text-[var(--muted,#6f7c79)]">Nič označenega</span>
                    );
                }
                return (
                  <li key={q.id} className="flex gap-3 border-t border-[var(--line,#ccd6d4)] py-2 first:border-t-0">
                    <span className="w-5 flex-none text-[var(--muted,#6f7c79)]">{number}.</span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:gap-4">
                      <span className="sm:w-1/2 sm:flex-none">{q.text.sl}</span>
                      <span className="min-w-0">{answer}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
