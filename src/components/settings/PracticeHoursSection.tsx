import { useEffect, useState, type FormEvent } from 'react';
import { usePracticeContext } from '../../contexts/PracticeContext';
import { usePracticeHours } from '../../hooks/usePracticeHours';
import { toDateIso, WEEKDAY_LABELS, type Period } from '../../lib/workingHours';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { PeriodsEditor, periodsError } from './PeriodsEditor';

// Nastavitve → Delovni čas (migration 048, Gregor 2026-10-22): the clinic's
// weekly hours, days it's closed, and "Naročanje izven delovnega časa ni
// mogoče". Clinic hours are the fallback for team members without their own,
// and bound what can be booked. Online bookings by patients are always
// refused outside them (database trigger). Owners edit, others read.

type DayPeriods = { weekday: number; startMin: number; endMin: number };

const INPUT_CLASS = 'rounded border border-[var(--line,#ccd6d4)] px-2 py-1.5 text-sm text-[var(--ink,#1c2624)]';

function formatDate(dateIso: string): string {
  const [y, m, d] = dateIso.split('-');
  return `${Number(d)}. ${Number(m)}. ${y}`;
}

export function PracticeHoursSection() {
  const { role } = usePracticeContext();
  const readOnly = role !== 'owner';
  const { practice, error, saveWeekly, addClosed, removeClosed, setBlockOutsideHours } = usePracticeHours();
  const today = toDateIso(new Date());

  // ---- Weekly hours (draft until saved)
  const [draft, setDraft] = useState<DayPeriods[]>([]);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!dirty) setDraft(practice.weekly.map(({ weekday, startMin, endMin }) => ({ weekday, startMin, endMin })));
  }, [practice.weekly, dirty]);

  function dayPeriods(weekday: number): Period[] {
    return draft.filter((p) => p.weekday === weekday).sort((a, b) => a.startMin - b.startMin);
  }
  function setDay(weekday: number, periods: Period[]) {
    setDraft((prev) => [...prev.filter((p) => p.weekday !== weekday), ...periods.map((p) => ({ ...p, weekday }))]);
    setDirty(true);
    setMessage(null);
  }
  function copyMonday() {
    const monday = dayPeriods(1);
    setDraft((prev) => [
      ...prev.filter((p) => p.weekday < 2 || p.weekday > 5),
      ...[2, 3, 4, 5].flatMap((weekday) => monday.map((p) => ({ startMin: p.startMin, endMin: p.endMin, weekday }))),
    ]);
    setDirty(true);
  }
  async function handleSave() {
    for (let wd = 1; wd <= 7; wd++) {
      const err = periodsError(dayPeriods(wd));
      if (err) {
        setMessage({ kind: 'error', text: `${WEEKDAY_LABELS[wd - 1]}: ${err}` });
        return;
      }
    }
    setSaving(true);
    const result = await saveWeekly(draft);
    setSaving(false);
    if (result.error) {
      setMessage({ kind: 'error', text: result.error });
      return;
    }
    setDirty(false);
    setMessage({ kind: 'ok', text: 'Delovni čas ambulante je shranjen.' });
  }

  // ---- Closed days
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [closedMessage, setClosedMessage] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const upcomingClosed = practice.closed.filter((c) => c.dateTo >= today);

  async function handleAddClosed(e: FormEvent) {
    e.preventDefault();
    const end = to || from;
    if (!from || end < from) {
      setClosedMessage('Vnesite datum od (in do, če traja več dni).');
      return;
    }
    const result = await addClosed({ dateFrom: from, dateTo: end, note });
    if (result.error) {
      setClosedMessage(result.error);
      return;
    }
    setFrom('');
    setTo('');
    setNote('');
    setClosedMessage(null);
  }

  if (error) return <p className="text-sm text-[var(--danger,#b3261e)]">Napaka pri nalaganju: {error}</p>;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-bold text-[var(--ink,#1c2624)]">Delovni čas ambulante</h3>
          <p className="mt-1 text-sm text-[var(--ink-soft,#45524f)]">
            Velja za vso ambulanto. Član ekipe brez lastnega delovnega časa dela v tem času; termini se ponujajo samo znotraj njega.
            {practice.weekly.length === 0 && ' Dokler ni nastavljen, koledar predvideva pon–pet 8–19 h.'}
          </p>
        </div>
        <div className="divide-y divide-[var(--line,#ccd6d4)] rounded border border-[var(--line,#ccd6d4)]">
          {WEEKDAY_LABELS.map((label, i) => (
            <div key={label} className="flex items-start gap-4 px-3 py-2">
              <span className="w-24 flex-none pt-1.5 text-sm font-semibold text-[var(--ink,#1c2624)]">{label}</span>
              <PeriodsEditor periods={dayPeriods(i + 1)} onChange={(next) => setDay(i + 1, next)} readOnly={readOnly} />
            </div>
          ))}
        </div>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty}
              className="rounded bg-[var(--accent,#2e6e62)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Shranjujem …' : 'Shrani delovni čas'}
            </button>
            <button type="button" onClick={copyMonday} className="text-xs font-medium text-[var(--accent,#2e6e62)] hover:underline">
              Kopiraj ponedeljek na torek–petek
            </button>
            {dirty && (
              <button
                type="button"
                onClick={() => {
                  setDirty(false);
                  setMessage(null);
                }}
                className="text-xs font-medium text-[var(--ink-soft,#45524f)] hover:underline"
              >
                Prekliči spremembe
              </button>
            )}
            {message && (
              <span className={`text-sm ${message.kind === 'error' ? 'text-[var(--danger,#b3261e)]' : 'text-[var(--accent,#2e6e62)]'}`}>
                {message.text}
              </span>
            )}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-bold text-[var(--ink,#1c2624)]">Naročanje izven delovnega časa</h3>
        <label className="flex items-start gap-2 text-sm text-[var(--ink,#1c2624)]">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={practice.blockOutsideHours}
            disabled={readOnly}
            onChange={async (e) => {
              const r = await setBlockOutsideHours(e.target.checked);
              if (r.error) setMessage({ kind: 'error', text: r.error });
            }}
          />
          <span>
            <strong>Naročanje izven delovnega časa ni mogoče</strong>
            <span className="block text-[var(--ink-soft,#45524f)]">
              Velja za termine, ki jih vnese osebje — izven delovnega časa ambulante ali terapevta termina ni mogoče shraniti.
              Izklopljeno: termin se shrani z opozorilom.
            </span>
          </span>
        </label>
        <p className="text-xs text-[var(--muted,#6f7c79)]">
          Spletna naročila pacientov izven delovnega časa ambulante so vedno zavrnjena.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-bold text-[var(--ink,#1c2624)]">Ambulanta zaprta</h3>
          <p className="mt-1 text-xs text-[var(--muted,#6f7c79)]">Prazniki, kolektivni dopust … — ti dnevi veljajo za vso ekipo.</p>
        </div>
        {upcomingClosed.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm">
            {upcomingClosed.map((c) => (
              <li key={c.id} className="flex items-center gap-3">
                <span className="w-52">
                  {formatDate(c.dateFrom)}
                  {c.dateTo !== c.dateFrom && ` – ${formatDate(c.dateTo)}`}
                </span>
                {c.note && <span className="text-[var(--ink-soft,#45524f)]">{c.note}</span>}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(c.id)}
                    className="text-xs font-medium text-[var(--danger,#b3261e)] hover:underline"
                  >
                    Odstrani
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--muted,#6f7c79)]">Ni vnesenih zaprtih dni.</p>
        )}
        {!readOnly && (
          <form onSubmit={handleAddClosed} className="flex flex-col gap-2 rounded border border-[var(--line,#ccd6d4)] p-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--ink-soft,#45524f)]">
                Od
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={INPUT_CLASS} />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--ink-soft,#45524f)]">
                Do
                <input type="date" min={from || undefined} value={to} onChange={(e) => setTo(e.target.value)} className={INPUT_CLASS} />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-xs font-semibold text-[var(--ink-soft,#45524f)]">
                Opomba
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="npr. Dan reformacije" className={INPUT_CLASS} />
              </label>
              <button
                type="submit"
                className="rounded border border-[var(--line,#ccd6d4)] px-3 py-1.5 text-sm font-medium text-[var(--ink,#1c2624)] hover:border-[var(--accent,#2e6e62)]"
              >
                Dodaj
              </button>
            </div>
            <span className="text-xs text-[var(--muted,#6f7c79)]">Za en dan pustite »Do« prazno.</span>
            {closedMessage && <span className="text-sm text-[var(--danger,#b3261e)]">{closedMessage}</span>}
          </form>
        )}
      </section>

      {confirmRemove && (
        <ConfirmDialog
          confirmLabel="Odstrani"
          onCancel={() => setConfirmRemove(null)}
          onConfirm={async () => {
            const id = confirmRemove;
            setConfirmRemove(null);
            const r = await removeClosed(id);
            if (r.error) setClosedMessage(r.error);
          }}
        >
          Ali res želite odstraniti ta zaprti dan?
        </ConfirmDialog>
      )}
    </div>
  );
}

