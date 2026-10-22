import { useState, type FormEvent } from 'react';
import type { Therapist } from '../../hooks/useTherapists';
import type { useWorkingHours } from '../../hooks/useWorkingHours';
import { PeriodsEditor, periodsError } from './PeriodsEditor';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import {
  ABSENCE_LABELS,
  describeConflict,
  describePeriods,
  overlapPeriods,
  scheduleConflicts,
  hoursForDate,
  isoWeek,
  toDateIso,
  weekParity,
  WEEKDAY_LABELS,
  type AbsenceReason,
  type Period,
  type Schedule,
  type WeeklyPeriod,
  type WeekParity,
} from '../../lib/workingHours';

// Nastavitve → Ekipa → "Delovni čas" (migration 047, Gregor 2026-10-22): one
// team member's weekly hours (several periods a day = split shift; optional
// odd/even weeks), one-day edits ("Posebni dnevi") and absences. Owners edit,
// everyone else reads. The calendar uses all of it — see lib/workingHours.ts.

type WorkingHoursApi = ReturnType<typeof useWorkingHours>;

const INPUT_CLASS = 'rounded border border-[var(--line,#ccd6d4)] px-2 py-1.5 text-sm text-[var(--ink,#1c2624)]';
const LINK_CLASS = 'text-xs font-medium text-[var(--accent,#2e6e62)] hover:underline disabled:opacity-50';
const DANGER_LINK_CLASS = 'text-xs font-medium text-[var(--danger,#b3261e)] hover:underline';
const REASONS: AbsenceReason[] = ['dopust', 'bolniska', 'izobrazevanje', 'drugo'];

function formatDate(dateIso: string): string {
  const [y, m, d] = dateIso.split('-');
  return `${Number(d)}. ${Number(m)}. ${y}`;
}

function ConflictBox({ lines, roomName, onForce, onCancel }: { lines: string[]; roomName: string | null; onForce: () => void; onCancel: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded bg-[#fff6e5] px-3 py-2 text-sm text-[#6b4a00]">
      <span className="font-semibold">⚠ Prekrivanje v ordinaciji{roomName ? ` ${roomName}` : ''}:</span>
      <ul className="list-disc pl-5">
        {lines.slice(0, 6).map((l) => (
          <li key={l}>{l}</li>
        ))}
        {lines.length > 6 && <li>… in še {lines.length - 6}×</li>}
      </ul>
      <div className="flex gap-3">
        <button type="button" onClick={onCancel} className="rounded border border-[#e0c48a] bg-white px-3 py-1 text-sm">
          Popravim
        </button>
        <button type="button" onClick={onForce} className="rounded bg-[#6b4a00] px-3 py-1 text-sm font-medium text-white">
          Vseeno shrani
        </button>
      </div>
    </div>
  );
}

export function WorkingHoursDialog({
  therapist,
  schedule,
  api,
  isOwner,
  roommates,
  roomName,
  onClose,
}: {
  therapist: Therapist;
  schedule: Schedule | undefined;
  api: WorkingHoursApi;
  isOwner: boolean;
  /** Others assigned the same room — their hours must not overlap. */
  roommates: { therapist: Therapist; schedule: Schedule | undefined }[];
  roomName: string | null;
  onClose: () => void;
}) {
  const readOnly = !isOwner;
  const today = toDateIso(new Date());
  const thisWeekParity = weekParity(today);
  // Overlaps with roommates found on save — shown with "Vseeno shrani".
  const [conflicts, setConflicts] = useState<{ kind: 'weekly' | 'day'; lines: string[] } | null>(null);

  /** Overlap lines for a draft of this therapist's schedule (max 6). */
  function roomOverlaps(draft: Schedule): string[] {
    return roommates.flatMap(({ therapist: other, schedule: otherSchedule }) =>
      scheduleConflicts(draft, otherSchedule, today).map((c) => `${other.name} — ${describeConflict(c)}`)
    );
  }

  // ---- Weekly template (draft until "Shrani tedenski urnik")
  const [alternating, setAlternating] = useState(schedule?.alternatingWeeks ?? false);
  const [weekly, setWeekly] = useState<WeeklyPeriod[]>(() =>
    (schedule?.weekly ?? []).map((w) => ({ weekParity: w.weekParity, weekday: w.weekday, startMin: w.startMin, endMin: w.endMin }))
  );
  const [parityTab, setParityTab] = useState<'odd' | 'even'>(thisWeekParity);
  const [weeklyDirty, setWeeklyDirty] = useState(false);
  const [weeklyMessage, setWeeklyMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [savingWeekly, setSavingWeekly] = useState(false);
  const editedParity: WeekParity = alternating ? parityTab : 'all';

  function dayPeriods(weekday: number): Period[] {
    return weekly
      .filter((w) => w.weekday === weekday && w.weekParity === editedParity)
      .sort((a, b) => a.startMin - b.startMin);
  }
  function setDayPeriods(weekday: number, periods: Period[]) {
    setWeekly((prev) => [
      ...prev.filter((w) => !(w.weekday === weekday && w.weekParity === editedParity)),
      ...periods.map((p) => ({ ...p, weekday, weekParity: editedParity })),
    ]);
    setWeeklyDirty(true);
    setWeeklyMessage(null);
  }
  function toggleAlternating(on: boolean) {
    // Switching on copies the one week into both; switching off keeps the odd week.
    setWeekly((prev) =>
      on
        ? prev.filter((w) => w.weekParity === 'all').flatMap((w) => [{ ...w, weekParity: 'odd' as const }, { ...w, weekParity: 'even' as const }])
        : prev.filter((w) => w.weekParity === 'odd').map((w) => ({ ...w, weekParity: 'all' as const }))
    );
    setAlternating(on);
    setWeeklyDirty(true);
  }
  function copyMondayToWeekdays() {
    const monday = dayPeriods(1);
    setWeekly((prev) => [
      ...prev.filter((w) => !(w.weekParity === editedParity && w.weekday >= 2 && w.weekday <= 5)),
      ...[2, 3, 4, 5].flatMap((weekday) => monday.map((p) => ({ startMin: p.startMin, endMin: p.endMin, weekday, weekParity: editedParity }))),
    ]);
    setWeeklyDirty(true);
  }
  async function handleSaveWeekly(force = false) {
    for (let wd = 1; wd <= 7; wd++) {
      for (const parity of alternating ? (['odd', 'even'] as const) : (['all'] as const)) {
        const err = periodsError(weekly.filter((w) => w.weekday === wd && w.weekParity === parity));
        if (err) {
          setWeeklyMessage({ kind: 'error', text: `${WEEKDAY_LABELS[wd - 1]}${alternating ? ` (${parity === 'odd' ? 'lihi' : 'sodi'} teden)` : ''}: ${err}` });
          return;
        }
      }
    }
    if (!force) {
      const lines = roomOverlaps({ alternatingWeeks: alternating, weekly, days: schedule?.days ?? [], absences: schedule?.absences ?? [] });
      if (lines.length > 0) {
        setConflicts({ kind: 'weekly', lines });
        return;
      }
    }
    setConflicts(null);
    setSavingWeekly(true);
    const result = await api.saveWeekly(therapist.id, alternating, weekly);
    setSavingWeekly(false);
    if (result.error) {
      setWeeklyMessage({ kind: 'error', text: result.error });
      return;
    }
    setWeeklyDirty(false);
    setWeeklyMessage({ kind: 'ok', text: 'Tedenski urnik je shranjen.' });
  }

  // ---- One-day edits
  const [dayDate, setDayDate] = useState('');
  const [dayDraft, setDayDraft] = useState<Period[]>([]);
  const [dayNote, setDayNote] = useState('');
  const [dayMessage, setDayMessage] = useState<string | null>(null);
  const dayEdits = Object.entries(
    (schedule?.days ?? []).reduce<Record<string, Period[]>>((acc, d) => {
      (acc[d.date] ??= []).push(d);
      return acc;
    }, {})
  )
    .filter(([date]) => date >= today)
    .sort(([a], [b]) => a.localeCompare(b));

  function pickDayDate(date: string) {
    setDayDate(date);
    setDayMessage(null);
    // Start from what applies that day now (its edit, or the weekly hours).
    setDayDraft(date ? hoursForDate(schedule, date).periods : []);
    setDayNote(schedule?.days.find((d) => d.date === date)?.note ?? '');
  }
  async function handleSaveDay(e: FormEvent | null, force = false) {
    e?.preventDefault();
    if (!dayDate) return;
    if (dayDraft.length === 0) {
      setDayMessage('Dodajte vsaj eno obdobje — za prost dan vnesite odsotnost spodaj.');
      return;
    }
    const err = periodsError(dayDraft);
    if (err) {
      setDayMessage(err);
      return;
    }
    if (!force) {
      const lines = roommates.flatMap(({ therapist: other, schedule: otherSchedule }) => {
        // A roommate without weekly hours is only on the assumed default — not a clash.
        const theirs = hoursForDate(otherSchedule, dayDate);
        if (theirs.source === 'default') return [];
        const both = overlapPeriods(dayDraft, theirs.periods);
        return both.length > 0 ? [`${other.name} — ${describeConflict({ date: dayDate, periods: both })}`] : [];
      });
      if (lines.length > 0) {
        setConflicts({ kind: 'day', lines });
        return;
      }
    }
    setConflicts(null);
    const result = await api.saveDay(therapist.id, dayDate, dayDraft, dayNote);
    if (result.error) {
      setDayMessage(result.error);
      return;
    }
    setDayDate('');
    setDayDraft([]);
    setDayNote('');
    setDayMessage(null);
  }

  // ---- Absences
  const [absFrom, setAbsFrom] = useState('');
  const [absTo, setAbsTo] = useState('');
  const [absReason, setAbsReason] = useState<AbsenceReason>('dopust');
  const [absNote, setAbsNote] = useState('');
  const [absMessage, setAbsMessage] = useState<string | null>(null);
  const [confirmRemoveAbsence, setConfirmRemoveAbsence] = useState<string | null>(null);
  const absences = (schedule?.absences ?? []).filter((a) => a.dateTo >= today);

  async function handleAddAbsence(e: FormEvent) {
    e.preventDefault();
    const to = absTo || absFrom;
    if (!absFrom || to < absFrom) {
      setAbsMessage('Vnesite datum od (in do, če traja več dni).');
      return;
    }
    const result = await api.addAbsence(therapist.id, { dateFrom: absFrom, dateTo: to, reason: absReason, note: absNote });
    if (result.error) {
      setAbsMessage(result.error);
      return;
    }
    setAbsFrom('');
    setAbsTo('');
    setAbsReason('dopust');
    setAbsNote('');
    setAbsMessage(null);
  }

  function handleClose() {
    if (weeklyDirty && !window.confirm('Tedenski urnik ni shranjen. Zapustim brez shranjevanja?')) return;
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6" onClick={handleClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex w-full max-w-3xl flex-col gap-6 rounded-md bg-[var(--surface,#fff)] p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--ink,#1c2624)]">
            Delovni čas — {therapist.name}
            <span className="ml-2 inline-block h-3 w-3 rounded-full align-middle" style={{ backgroundColor: therapist.color }} />
          </h2>
          <button type="button" onClick={handleClose} className="text-[var(--ink-soft,#45524f)] hover:text-[var(--accent,#2e6e62)]">
            ✕
          </button>
        </div>

        {/* ---- Weekly template */}
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-[var(--ink,#1c2624)]">Tedenski urnik</h3>
            <label className="flex items-center gap-2 text-sm text-[var(--ink-soft,#45524f)]">
              <input type="checkbox" checked={alternating} disabled={readOnly} onChange={(e) => toggleAlternating(e.target.checked)} />
              Izmenični tedni (lihi / sodi)
            </label>
          </div>
          {(schedule?.weekly.length ?? 0) === 0 && !weeklyDirty && (
            <p className="text-xs text-[var(--muted,#6f7c79)]">Še ni nastavljen — koledar do takrat predvideva pon–pet 8–19 h.</p>
          )}
          {alternating && (
            <div className="flex items-center gap-2">
              {(['odd', 'even'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setParityTab(p)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    parityTab === p
                      ? 'border-[var(--accent,#2e6e62)] bg-[var(--accent,#2e6e62)] text-white'
                      : 'border-[var(--line,#ccd6d4)] text-[var(--ink,#1c2624)]'
                  }`}
                >
                  {p === 'odd' ? 'Lihi teden' : 'Sodi teden'}
                </button>
              ))}
              <span className="text-xs text-[var(--muted,#6f7c79)]">
                Ta teden ({isoWeek(today)}.) je {thisWeekParity === 'odd' ? 'lih' : 'sod'}.
              </span>
            </div>
          )}
          <div className="divide-y divide-[var(--line,#ccd6d4)] rounded border border-[var(--line,#ccd6d4)]">
            {WEEKDAY_LABELS.map((label, i) => (
              <div key={label} className="flex items-start gap-4 px-3 py-2">
                <span className="w-24 flex-none pt-1.5 text-sm font-semibold text-[var(--ink,#1c2624)]">{label}</span>
                <PeriodsEditor periods={dayPeriods(i + 1)} onChange={(next) => setDayPeriods(i + 1, next)} readOnly={readOnly} />
              </div>
            ))}
          </div>
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => handleSaveWeekly()}
                disabled={savingWeekly || !weeklyDirty}
                className="rounded bg-[var(--accent,#2e6e62)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {savingWeekly ? 'Shranjujem …' : 'Shrani tedenski urnik'}
              </button>
              <button type="button" onClick={copyMondayToWeekdays} className={LINK_CLASS}>
                Kopiraj ponedeljek na torek–petek
              </button>
              {weeklyMessage && (
                <span className={`text-sm ${weeklyMessage.kind === 'error' ? 'text-[var(--danger,#b3261e)]' : 'text-[var(--accent,#2e6e62)]'}`}>
                  {weeklyMessage.text}
                </span>
              )}
            </div>
          )}
          {conflicts?.kind === 'weekly' && (
            <ConflictBox lines={conflicts.lines} roomName={roomName} onCancel={() => setConflicts(null)} onForce={() => handleSaveWeekly(true)} />
          )}
        </section>

        {/* ---- One-day edits */}
        <section className="flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-bold text-[var(--ink,#1c2624)]">Posebni dnevi</h3>
            <p className="mt-1 text-xs text-[var(--muted,#6f7c79)]">Drugačen delovni čas za določen dan — velja namesto tedenskega urnika.</p>
          </div>
          {dayEdits.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm">
              {dayEdits.map(([date, periods]) => (
                <li key={date} className="flex items-center gap-3">
                  <span className="w-28">{formatDate(date)}</span>
                  <span>{describePeriods(periods)}</span>
                  {schedule?.days.find((d) => d.date === date)?.note && (
                    <span className="text-xs text-[var(--muted,#6f7c79)]">· {schedule?.days.find((d) => d.date === date)?.note}</span>
                  )}
                  {!readOnly && (
                    <>
                      <button type="button" onClick={() => pickDayDate(date)} className={LINK_CLASS}>
                        Uredi
                      </button>
                      <button type="button" onClick={() => api.saveDay(therapist.id, date, [], null)} className={DANGER_LINK_CLASS}>
                        Odstrani
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--muted,#6f7c79)]">Ni posebnih dni.</p>
          )}
          {!readOnly && (
            <form onSubmit={handleSaveDay} className="flex flex-col gap-3 rounded border border-[var(--line,#ccd6d4)] p-3">
              <div className="flex flex-wrap items-start gap-4">
                <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--ink-soft,#45524f)]">
                  Datum
                  <input type="date" min={today} value={dayDate} onChange={(e) => pickDayDate(e.target.value)} className={INPUT_CLASS} />
                </label>
                {dayDate && (
                  <div className="flex flex-col gap-1 text-xs font-semibold text-[var(--ink-soft,#45524f)]">
                    Delovni čas
                    <PeriodsEditor periods={dayDraft} onChange={setDayDraft} readOnly={false} />
                  </div>
                )}
                {dayDate && (
                  <label className="flex flex-1 flex-col gap-1 text-xs font-semibold text-[var(--ink-soft,#45524f)]">
                    Opomba
                    <input value={dayNote} onChange={(e) => setDayNote(e.target.value)} maxLength={200} className={INPUT_CLASS} />
                  </label>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={!dayDate}
                  className="rounded border border-[var(--line,#ccd6d4)] px-3 py-1.5 text-sm font-medium text-[var(--ink,#1c2624)] hover:border-[var(--accent,#2e6e62)] disabled:opacity-50"
                >
                  Shrani dan
                </button>
                {dayMessage && <span className="text-sm text-[var(--danger,#b3261e)]">{dayMessage}</span>}
              </div>
              {conflicts?.kind === 'day' && (
                <ConflictBox lines={conflicts.lines} roomName={roomName} onCancel={() => setConflicts(null)} onForce={() => handleSaveDay(null, true)} />
              )}
            </form>
          )}
        </section>

        {/* ---- Absences */}
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-bold text-[var(--ink,#1c2624)]">Odsotnosti</h3>
          {absences.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm">
              {absences.map((a) => (
                <li key={a.id} className="flex items-center gap-3">
                  <span className="w-52">
                    {formatDate(a.dateFrom)}
                    {a.dateTo !== a.dateFrom && ` – ${formatDate(a.dateTo)}`}
                  </span>
                  <span className="font-semibold">{ABSENCE_LABELS[a.reason]}</span>
                  {a.note && <span className="text-xs text-[var(--muted,#6f7c79)]">· {a.note}</span>}
                  {!readOnly && (
                    <button type="button" onClick={() => setConfirmRemoveAbsence(a.id)} className={DANGER_LINK_CLASS}>
                      Odstrani
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--muted,#6f7c79)]">Ni vnesenih odsotnosti.</p>
          )}
          {!readOnly && (
            <form onSubmit={handleAddAbsence} className="flex flex-col gap-2 rounded border border-[var(--line,#ccd6d4)] p-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--ink-soft,#45524f)]">
                  Od
                  <input type="date" value={absFrom} onChange={(e) => setAbsFrom(e.target.value)} className={INPUT_CLASS} />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--ink-soft,#45524f)]">
                  Do
                  <input type="date" min={absFrom || undefined} value={absTo} onChange={(e) => setAbsTo(e.target.value)} className={INPUT_CLASS} />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--ink-soft,#45524f)]">
                  Razlog
                  <select value={absReason} onChange={(e) => setAbsReason(e.target.value as AbsenceReason)} className={INPUT_CLASS}>
                    {REASONS.map((r) => (
                      <option key={r} value={r}>
                        {ABSENCE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-1 flex-col gap-1 text-xs font-semibold text-[var(--ink-soft,#45524f)]">
                  Opomba
                  <input value={absNote} onChange={(e) => setAbsNote(e.target.value)} maxLength={200} className={INPUT_CLASS} />
                </label>
                <button
                  type="submit"
                  className="rounded border border-[var(--line,#ccd6d4)] px-3 py-1.5 text-sm font-medium text-[var(--ink,#1c2624)] hover:border-[var(--accent,#2e6e62)]"
                >
                  Dodaj odsotnost
                </button>
              </div>
              <span className="text-xs text-[var(--muted,#6f7c79)]">Za en dan pustite »Do« prazno.</span>
              {absMessage && <span className="text-sm text-[var(--danger,#b3261e)]">{absMessage}</span>}
            </form>
          )}
        </section>

        {confirmRemoveAbsence && (
          <ConfirmDialog
            confirmLabel="Odstrani"
            onCancel={() => setConfirmRemoveAbsence(null)}
            onConfirm={async () => {
              const id = confirmRemoveAbsence;
              setConfirmRemoveAbsence(null);
              const r = await api.removeAbsence(id);
              if (r.error) setAbsMessage(r.error);
            }}
          >
            Ali res želite odstraniti to odsotnost?
          </ConfirmDialog>
        )}
      </div>
    </div>
  );
}
