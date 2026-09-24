import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import { usePatients, type PatientListItem } from '../hooks/usePatients';
import { usePracticeContext } from '../contexts/PracticeContext';
import { AppNavShell } from '../components/ui/AppNavShell';
import {
  useAppointmentsForDay,
  useAppointmentsForWeek,
  useAppointmentsForRange,
  type Appointment,
  type AppointmentFields,
  type AppointmentStatus,
  type AppointmentWithPatient,
} from '../hooks/useAppointments';
import { useTherapists, type Therapist } from '../hooks/useTherapists';
import { APPOINTMENT_STATUS_META, APPOINTMENT_STATUS_ORDER } from '../lib/appointmentStatus';
import { TimeGrid, type TimeGridColumn } from '../components/calendar/TimeGrid';
import { TherapistPanel } from '../components/calendar/TherapistPanel';
import { CalendarSearch } from '../components/calendar/CalendarSearch';
import { MonthOverview } from '../components/calendar/MonthOverview';
import { MiniCalendar } from '../components/calendar/MiniCalendar';

interface CalendarProps {
  onBack: () => void;
  /** Same signature PatientList.tsx already passes up to App.tsx — jumping
      from an appointment straight into that patient's chart. The full
      PatientListItem comes from this page's own usePatients() list (already
      loaded for the "+ Nov termin" patient picker below), not from the
      appointment row itself, which only carries first/last name. */
  onSelectPatient: (patient: PatientListItem, label: string) => void;
  onSignOut: () => void;
  onNavigateEmail: () => void;
}

type CalendarView = 'day' | 'week' | 'month';

// Remembers the last view/weekend-visibility the user picked (per Gregor's
// explicit request) so reopening the calendar later starts where they left
// off, rather than always defaulting back to Day. Per-browser only
// (localStorage, not a Supabase column) — a UI display preference, not
// practice data. Wrapped in try/catch since localStorage can throw (private
// browsing, disabled storage) — falling back to the plain defaults is fine
// either way, this is a convenience, not a correctness requirement.
const VIEW_STORAGE_KEY = 'dentalChart.calendarView';
const SHOW_WEEKENDS_STORAGE_KEY = 'dentalChart.calendarShowWeekends';

function loadStoredView(): CalendarView {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === 'day' || stored === 'week' || stored === 'month') return stored;
  } catch {
    // ignore — fall through to the default
  }
  return 'day';
}

function loadStoredShowWeekends(): boolean {
  try {
    const stored = localStorage.getItem(SHOW_WEEKENDS_STORAGE_KEY);
    if (stored !== null) return stored === 'true';
  } catch {
    // ignore — fall through to the default
  }
  return true;
}

function patientLabel(p: { firstName: string; lastName: string }): string {
  return `${p.lastName} ${p.firstName}`;
}

// Local-getter formatting, not `.toISOString().slice(0, 10)` — the latter
// round-trips a local-midnight Date through UTC, which rolls back a full
// calendar day for any timezone ahead of UTC (Slovenia's CET/CEST always
// is). That bug compounded across every addDays() call built on top of it
// (each re-parses the already-shifted string as a fresh local midnight,
// then shifts it again), landing Week view's whole column range and its
// underlying appointment-range query 1-2 days early. MiniCalendar.tsx and
// MonthOverview.tsx already used this same safe pattern; Calendar.tsx's
// own date helpers just hadn't been aligned with it.
function toDateIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayIso(): string {
  return toDateIso(new Date());
}

function addDays(dateIso: string, delta: number): string {
  const d = new Date(`${dateIso}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return toDateIso(d);
}

function addMonths(dateIso: string, delta: number): string {
  const d = new Date(`${dateIso}T00:00:00`);
  d.setMonth(d.getMonth() + delta);
  return toDateIso(d);
}

function startOfWeekIso(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00`);
  const weekday = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - weekday);
  return toDateIso(d);
}

function formatDayHeading(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00`);
  return d.toLocaleDateString('sl-SI', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatShortDate(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00`);
  return d.toLocaleDateString('sl-SI', { day: 'numeric', month: 'short' });
}

function weekdayAbbr(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00`);
  return d.toLocaleDateString('sl-SI', { weekday: 'short' }).toUpperCase().replace(/\.$/, '');
}

function formatMonthHeading(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00`);
  return d.toLocaleDateString('sl-SI', { month: 'long', year: 'numeric' });
}

type ModalState =
  | { mode: 'create'; prefillDateIso: string; prefillTime?: string; prefillTherapistId?: string | null }
  | { mode: 'edit'; appointment: AppointmentWithPatient };

const VIEW_LABELS: Record<CalendarView, string> = { day: 'Dan', week: 'Teden', month: 'Mesec' };

// Week view's own column header — weekday abbreviation + date number,
// with today's date circled in accent color, matching the mockup exactly.
function WeekColumnHeader({ dateIso, isToday }: { dateIso: string; isToday: boolean }) {
  const day = new Date(`${dateIso}T00:00:00`).getDate();
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`text-[10px] font-semibold ${isToday ? 'text-[var(--accent,#2e6e62)]' : 'text-[var(--muted,#6f7c79)]'}`}>
        {weekdayAbbr(dateIso)}
      </span>
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-full text-sm ${
          isToday ? 'bg-[var(--accent,#2e6e62)] font-semibold text-white' : 'text-[var(--ink,#1c2624)]'
        }`}
      >
        {day}
      </span>
    </div>
  );
}

// Google-Calendar-style scheduling UI: therapist resource columns (Day
// view), a Day/Week/Month grid, status badges (red tick/cross, blur,
// dashed border), cross-date search, and click-to-create straight from an
// empty grid slot. Built on top of the same appointments table/RLS pattern
// as the original day-agenda slice (supabase/migrations/013_add_appointments.sql,
// 014_add_therapists.sql).
export function Calendar({ onBack, onSelectPatient, onSignOut, onNavigateEmail }: CalendarProps) {
  const [view, setView] = useState<CalendarView>(loadStoredView);
  const [showWeekends, setShowWeekends] = useState(loadStoredShowWeekends);
  const [dateIso, setDateIso] = useState(todayIso());
  const [hiddenTherapistIds, setHiddenTherapistIds] = useState<Set<string>>(new Set());
  const [modalState, setModalState] = useState<ModalState | null>(null);
  const [pastSlotNotice, setPastSlotNotice] = useState(false);
  const pastSlotNoticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pastSlotNoticeTimeoutRef.current) clearTimeout(pastSlotNoticeTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      // ignore — see loadStoredView's own comment
    }
  }, [view]);
  useEffect(() => {
    try {
      localStorage.setItem(SHOW_WEEKENDS_STORAGE_KEY, String(showWeekends));
    } catch {
      // ignore — see loadStoredView's own comment
    }
  }, [showWeekends]);

  const { patients, createPatient } = usePatients();
  const { therapists, createTherapist } = useTherapists();
  const { practiceName } = usePracticeContext();

  const weekStartIso = startOfWeekIso(dateIso);
  const monthRangeStart = `${dateIso.slice(0, 7)}-01`;
  const monthRangeEndExclusive = useMemo(() => addMonths(monthRangeStart, 1), [monthRangeStart]);

  const dayData = useAppointmentsForDay(dateIso);
  const weekData = useAppointmentsForWeek(weekStartIso);
  const monthData = useAppointmentsForRange(
    new Date(`${monthRangeStart}T00:00:00`).toISOString(),
    new Date(`${monthRangeEndExclusive}T00:00:00`).toISOString()
  );

  // Writes always go through dayData's own create/update (identical insert
  // regardless of which range hook triggered it); the other two ranges are
  // then explicitly refreshed so switching views never shows stale data.
  async function createAppointmentEverywhere(
    input: AppointmentFields & { patientId: string }
  ): Promise<{ appointment: Appointment } | { error: string }> {
    const result = await dayData.createAppointment(input);
    weekData.reload();
    monthData.reload();
    return result;
  }
  async function updateAppointmentEverywhere(
    id: string,
    fields: Partial<AppointmentFields>
  ): Promise<{ appointment: Appointment } | { error: string }> {
    const result = await dayData.updateAppointment(id, fields);
    weekData.reload();
    monthData.reload();
    return result;
  }

  function toggleTherapistVisibility(id: string) {
    setHiddenTherapistIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openPatientChart(patientId: string) {
    const patient = patients.find((p) => p.patientId === patientId);
    if (patient) onSelectPatient(patient, patientLabel(patient));
  }

  function handlePrev() {
    if (view === 'day') setDateIso((d) => addDays(d, -1));
    else if (view === 'week') setDateIso((d) => addDays(d, -7));
    else setDateIso((d) => addMonths(d, -1));
  }
  function handleNext() {
    if (view === 'day') setDateIso((d) => addDays(d, 1));
    else if (view === 'week') setDateIso((d) => addDays(d, 7));
    else setDateIso((d) => addMonths(d, 1));
  }

  function heading(): string {
    if (view === 'day') return formatDayHeading(dateIso);
    if (view === 'week') return `${formatShortDate(weekStartIso)} – ${formatShortDate(addDays(weekStartIso, 6))}`;
    return formatMonthHeading(dateIso);
  }

  function handleSlotClick(columnKey: string, slotDateIso: string, time: string) {
    const prefillTherapistId = view === 'day' && columnKey !== 'unassigned' ? columnKey : null;
    setModalState({ mode: 'create', prefillDateIso: slotDateIso, prefillTime: time, prefillTherapistId });
  }
  // TimeGrid calls this instead of handleSlotClick for a slot that's
  // already in the past — no modal ever opens for it (it could never be
  // saved anyway, per AppointmentModal's own past-time guard), just a
  // brief top-of-calendar notice. Re-triggering resets the same timeout
  // rather than letting an earlier one cut a fresh click's notice short.
  function handlePastSlotClick() {
    setPastSlotNotice(true);
    if (pastSlotNoticeTimeoutRef.current) clearTimeout(pastSlotNoticeTimeoutRef.current);
    pastSlotNoticeTimeoutRef.current = setTimeout(() => setPastSlotNotice(false), 4000);
  }
  function handleEventClick(appt: AppointmentWithPatient) {
    setModalState({ mode: 'edit', appointment: appt });
  }
  function handleMonthDayClick(clickedDateIso: string) {
    setDateIso(clickedDateIso);
    setView('day');
  }
  function handleSearchSelect(appt: AppointmentWithPatient) {
    setDateIso(appt.startsAt.slice(0, 10));
    setView('day');
    setModalState({ mode: 'edit', appointment: appt });
  }

  const visibleTherapists = therapists.filter((t) => !hiddenTherapistIds.has(t.id));
  const therapistColorById = new Map(therapists.map((t) => [t.id, t.color] as const));
  // Now that TherapistPanel's visibility toggle shows on every view (not
  // just Day, whose per-therapist columns already implied it), Week/Month
  // need to honor it too — an unassigned appointment (no therapistId, or
  // one pointing at a deleted therapist) always stays visible.
  function isTherapistVisible(therapistId: string | null): boolean {
    return !therapistId || !hiddenTherapistIds.has(therapistId);
  }

  const dayColumns: TimeGridColumn[] =
    therapists.length === 0
      ? [{ key: 'unassigned', label: 'Ves urnik', dateIso, events: dayData.appointments }]
      : [
          ...visibleTherapists.map((t) => ({
            key: t.id,
            label: t.name,
            accentColor: t.color,
            dateIso,
            events: dayData.appointments.filter((a) => a.therapistId === t.id),
          })),
          {
            key: 'unassigned',
            label: 'Neuvrščeno',
            dateIso,
            events: dayData.appointments.filter((a) => !a.therapistId || !therapists.some((t) => t.id === a.therapistId)),
          },
        ];

  const weekDayIsos = (() => {
    const days: string[] = [];
    for (let i = 0; i < 7; i++) days.push(addDays(weekStartIso, i));
    return showWeekends ? days : days.slice(0, 5);
  })();
  const today = todayIso();
  const weekColumns: TimeGridColumn[] = weekDayIsos.map((d) => ({
    key: d,
    label: <WeekColumnHeader dateIso={d} isToday={d === today} />,
    dateIso: d,
    events: weekData.appointments.filter((a) => a.startsAt.slice(0, 10) === d && isTherapistVisible(a.therapistId)),
  }));

  const loadError = dayData.error || weekData.error || monthData.error;

  return (
    // Fixed-viewport frame: the page itself never scrolls (h-screen +
    // overflow-hidden) — only the calendar's own hour body does, via
    // TimeGrid's internal `overflow-auto`. This is what keeps the
    // calendar's own footprint identical across Day/Week/Month (each just
    // fills whatever's left below the header/toolbar) and lands its
    // bottom edge exactly `pb-3` (12px) above the viewport bottom, per
    // Gregor's explicit request — matched to the dental-chart page's own
    // convention wasn't possible (no such 100vh/12px pattern actually
    // exists there — see the pixel values it uses instead, all fixed
    // per-card heights), so this is a new, self-contained convention.
    <div className="flex h-screen flex-col overflow-hidden">
      <AppNavShell
        userLabel={practiceName ?? undefined}
        onSignOut={onSignOut}
        onNavigateHome={onBack}
        onNavigateStoritve={onBack}
        onNavigateEmail={onNavigateEmail}
        activeSubmenu="koledar"
      />
      <div className="mx-auto flex min-h-0 w-full max-w-[1800px] flex-1 flex-col gap-4 overflow-hidden p-6 pb-3">
        <div className="flex flex-none flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDateIso(todayIso())}
              className="rounded-full border border-[var(--line,#ccd6d4)] px-4 py-1.5 text-sm text-[var(--ink-soft,#45524f)]"
            >
              Danes
            </button>
            <button
              type="button"
              onClick={handlePrev}
              aria-label="Nazaj"
              className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--ink-soft,#45524f)] hover:bg-[var(--bg,#eef2f1)]"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={handleNext}
              aria-label="Naprej"
              className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--ink-soft,#45524f)] hover:bg-[var(--bg,#eef2f1)]"
            >
              ›
            </button>
            <span className="ml-1 text-lg font-medium capitalize text-[var(--ink,#1c2624)]">{heading()}</span>
          </div>
          {/* Sits in the same toolbar row as the date heading/search box —
              not a row of its own below the toolbar — so it appearing/
              disappearing never pushes the calendar frame down. Renders
              nothing (not even an empty node) when there's no notice, so
              justify-between still lands the two side groups at the row's
              edges exactly as before. */}
          {pastSlotNotice && (
            <p className="flex-none whitespace-nowrap rounded-md bg-[#fdecea] px-3 py-2 text-sm text-[var(--danger,#b3261e)]">
              Za preteklost ni možno ustvariti termina.
            </p>
          )}
          <div className="flex items-center gap-2">
            <CalendarSearch patients={patients} onSelectResult={handleSearchSelect} />
            <ViewSwitcher view={view} onSetView={setView} showWeekends={showWeekends} onSetShowWeekends={setShowWeekends} />
            <button
              type="button"
              onClick={() => setModalState({ mode: 'create', prefillDateIso: dateIso })}
              className="rounded bg-[var(--accent,#2e6e62)] px-3 py-2 text-sm font-medium text-white"
            >
              + Nov termin
            </button>
          </div>
        </div>

        {loadError && (
          <p className="flex-none text-sm text-[var(--danger,#b3261e)]">Napaka pri nalaganju: {loadError}</p>
        )}

        <div className="flex min-h-0 flex-1 items-stretch gap-4">
          <div className="flex w-64 flex-none flex-col">
            {/* Shown on every view now (Day/Week/Month alike), not just
                Day — the therapist color legend/visibility toggle is
                useful regardless of whether the grid itself has
                per-therapist columns (see the hidden-therapist filtering
                applied to week/monthData below). flex-1 stretches its own
                frame down to sit exactly 12px (mt-3) above MiniCalendar,
                which — via items-stretch on the row above — lands level
                with the calendar frame's own bottom edge too. */}
            <div className="flex min-h-0 flex-1 flex-col">
              <TherapistPanel
                therapists={therapists}
                hiddenIds={hiddenTherapistIds}
                onToggleVisibility={toggleTherapistVisibility}
                onCreateTherapist={createTherapist}
              />
            </div>
            <div className="mt-3">
              <MiniCalendar selectedDateIso={dateIso} onSelectDate={setDateIso} />
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {view === 'day' && (
              <TimeGrid
                columns={dayColumns}
                onSlotClick={handleSlotClick}
                onEventClick={handleEventClick}
                onPastSlotClick={handlePastSlotClick}
              />
            )}
            {view === 'week' && (
              <TimeGrid
                columns={weekColumns}
                resolveEventColor={(a) => (a.therapistId ? therapistColorById.get(a.therapistId) : undefined)}
                onSlotClick={handleSlotClick}
                onEventClick={handleEventClick}
                onPastSlotClick={handlePastSlotClick}
              />
            )}
            {view === 'month' && (
              <MonthOverview
                monthDateIso={dateIso}
                appointments={monthData.appointments.filter((a) => isTherapistVisible(a.therapistId))}
                onDayClick={handleMonthDayClick}
                resolveEventColor={(a) => (a.therapistId ? therapistColorById.get(a.therapistId) : undefined)}
              />
            )}
          </div>
        </div>

        {modalState && (
          <AppointmentModal
            mode={modalState.mode}
            appointment={modalState.mode === 'edit' ? modalState.appointment : null}
            defaultDateIso={modalState.mode === 'create' ? modalState.prefillDateIso : dateIso}
            defaultTime={modalState.mode === 'create' ? modalState.prefillTime : undefined}
            defaultTherapistId={modalState.mode === 'create' ? (modalState.prefillTherapistId ?? null) : null}
            patients={patients}
            therapists={therapists}
            onCreate={createAppointmentEverywhere}
            onUpdate={updateAppointmentEverywhere}
            onCreatePatient={createPatient}
            onOpenPatientChart={openPatientChart}
            onClose={() => setModalState(null)}
          />
        )}
      </div>
    </div>
  );
}

interface ViewSwitcherProps {
  view: CalendarView;
  onSetView: (v: CalendarView) => void;
  showWeekends: boolean;
  onSetShowWeekends: (v: boolean) => void;
}

function ViewSwitcher({ view, onSetView, showWeekends, onSetShowWeekends }: ViewSwitcherProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="rounded-full border border-[var(--line,#ccd6d4)] px-4 py-1.5 text-sm text-[var(--ink,#1c2624)]"
      >
        {VIEW_LABELS[view]} ▾
      </button>
      {open && (
        // z-30, not z-20: TimeGrid's own sticky day/hour header uses z-20
        // for its own (unrelated) purpose, and — being later in the DOM
        // than this toolbar — would otherwise win the tie and paint over
        // this dropdown instead of under it.
        <div
          className="absolute right-0 top-full z-30 mt-1 flex w-48 flex-col gap-0.5 rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-2 shadow-lg"
          onMouseLeave={() => setOpen(false)}
        >
          {(['day', 'week', 'month'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                onSetView(v);
                setOpen(false);
              }}
              className={`rounded px-2 py-1.5 text-left text-sm ${
                view === v ? 'bg-[var(--bg,#eef2f1)] font-semibold text-[var(--ink,#1c2624)]' : 'text-[var(--ink-soft,#45524f)]'
              }`}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
          <label className="mt-1 flex items-center gap-2 border-t border-[var(--line,#ccd6d4)] pt-2 text-sm text-[var(--ink-soft,#45524f)]">
            <input type="checkbox" checked={showWeekends} onChange={(e) => onSetShowWeekends(e.target.checked)} />
            Prikaži konce tedna
          </label>
        </div>
      )}
    </div>
  );
}

const DURATION_OPTIONS = [15, 30, 45, 60, 90];

function toDateInputValue(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toTimeInputValue(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function durationMinutes(startsAt: string, endsAt: string): number {
  return Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60000);
}

interface NewPatientInput {
  firstName: string;
  lastName: string;
  dob: string;
  phone?: string;
  email?: string;
}

interface AppointmentModalProps {
  mode: 'create' | 'edit';
  appointment: AppointmentWithPatient | null;
  defaultDateIso: string;
  defaultTime?: string;
  defaultTherapistId: string | null;
  patients: PatientListItem[];
  therapists: Therapist[];
  onCreate: (input: AppointmentFields & { patientId: string }) => Promise<{ appointment: Appointment } | { error: string }>;
  onUpdate: (id: string, fields: Partial<AppointmentFields>) => Promise<{ appointment: Appointment } | { error: string }>;
  onCreatePatient: (input: NewPatientInput) => Promise<{ patientId: string } | { error: string }>;
  onOpenPatientChart: (patientId: string) => void;
  onClose: () => void;
}

// Same modal for creating and editing — only the patient field differs
// (a search-and-pick control, plus an inline "+ Dodaj novega pacienta"
// mini-form, on create; a fixed link to the patient's chart on edit, since
// an appointment's patient isn't meant to change after the fact — cancel
// and create a new one instead).
function AppointmentModal({
  mode,
  appointment,
  defaultDateIso,
  defaultTime,
  defaultTherapistId,
  patients,
  therapists,
  onCreate,
  onUpdate,
  onCreatePatient,
  onOpenPatientChart,
  onClose,
}: AppointmentModalProps) {
  const [patientId, setPatientId] = useState(appointment?.patientId ?? '');
  const [patientQuery, setPatientQuery] = useState('');
  const [showNewPatientForm, setShowNewPatientForm] = useState(false);
  const [newFirstName, setNewFirstName] = useState('');
  const [newLastName, setNewLastName] = useState('');
  const [newDob, setNewDob] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPatientSaving, setNewPatientSaving] = useState(false);
  const [newPatientError, setNewPatientError] = useState<string | null>(null);

  const [date, setDate] = useState(appointment ? toDateInputValue(appointment.startsAt) : defaultDateIso);
  const [time, setTime] = useState(appointment ? toTimeInputValue(appointment.startsAt) : (defaultTime ?? '09:00'));
  const [duration, setDuration] = useState(appointment ? durationMinutes(appointment.startsAt, appointment.endsAt) : 30);
  const [service, setService] = useState(appointment?.service ?? '');
  const [status, setStatus] = useState<AppointmentStatus>(appointment?.status ?? 'scheduled');
  const [therapistId, setTherapistId] = useState(appointment?.therapistId ?? defaultTherapistId ?? '');
  const [notes, setNotes] = useState(appointment?.notes ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const selectedPatient = patients.find((p) => p.patientId === patientId) ?? null;
  const todayDateValue = toDateInputValue(new Date().toISOString());

  const filteredPatients = useMemo(() => {
    const q = patientQuery.trim().toLowerCase();
    if (!q) return [];
    return patients.filter((p) => patientLabel(p).toLowerCase().includes(q)).slice(0, 8);
  }, [patients, patientQuery]);

  async function handleCreatePatientInline(e: FormEvent) {
    e.preventDefault();
    if (!newFirstName.trim() || !newLastName.trim() || !newDob) {
      setNewPatientError('Izpolnite ime, priimek in datum rojstva.');
      return;
    }
    setNewPatientSaving(true);
    setNewPatientError(null);
    const result = await onCreatePatient({
      firstName: newFirstName.trim(),
      lastName: newLastName.trim(),
      dob: newDob,
      phone: newPhone || undefined,
      email: newEmail.trim() || undefined,
    });
    setNewPatientSaving(false);
    if ('error' in result) {
      setNewPatientError(result.error);
      return;
    }
    setPatientId(result.patientId);
    setShowNewPatientForm(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!patientId) {
      setFormError('Izberite pacienta.');
      return;
    }
    // Create-only: an edit can legitimately keep (or land back on) a past
    // date/time — that's how a past visit gets marked "Opravljen"/"Ni se
    // zglasil/-a" after the fact — so this only blocks scheduling a brand
    // new appointment in the past, not editing an existing one. Compares
    // the full timestamp, not just the date, so a past *time* on today's
    // date is caught too (the date picker's own `min` above only stops a
    // past day outright).
    if (mode === 'create' && new Date(`${date}T${time}`).getTime() < Date.now()) {
      setFormError('Ni mogoče ustvariti termina v preteklosti.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    const startsAt = new Date(`${date}T${time}`).toISOString();
    const endsAt = new Date(new Date(`${date}T${time}`).getTime() + duration * 60000).toISOString();
    const fields: AppointmentFields = {
      startsAt,
      endsAt,
      service: service.trim() || undefined,
      status,
      notes: notes.trim() || undefined,
      therapistId: therapistId || null,
    };
    const result = mode === 'create' ? await onCreate({ ...fields, patientId }) : await onUpdate(appointment!.id, fields);
    setSubmitting(false);
    if ('error' in result) {
      setFormError(result.error);
      return;
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col gap-3 rounded-md bg-[var(--surface,#fff)] p-6 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--ink,#1c2624)]">{mode === 'create' ? 'Nov termin' : 'Uredi termin'}</h2>
          <button type="button" onClick={onClose} className="text-[var(--ink-soft,#45524f)] hover:text-[var(--accent,#2e6e62)]">
            ✕
          </button>
        </div>

        {mode === 'create' ? (
          <div className="flex flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
            Pacient
            {selectedPatient ? (
              <div className="flex items-center justify-between rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]">
                <span>{patientLabel(selectedPatient)}</span>
                <button type="button" onClick={() => setPatientId('')} className="text-xs text-[var(--accent,#2e6e62)]">
                  Spremeni
                </button>
              </div>
            ) : showNewPatientForm ? (
              <div className="flex flex-col gap-2 rounded border border-[var(--line,#ccd6d4)] p-3">
                <div className="flex gap-2">
                  <input
                    value={newFirstName}
                    onChange={(e) => setNewFirstName(e.target.value)}
                    placeholder="Ime"
                    className="w-1/2 rounded border border-[var(--line,#ccd6d4)] px-2 py-1.5 text-sm text-[var(--ink,#1c2624)]"
                  />
                  <input
                    value={newLastName}
                    onChange={(e) => setNewLastName(e.target.value)}
                    placeholder="Priimek"
                    className="w-1/2 rounded border border-[var(--line,#ccd6d4)] px-2 py-1.5 text-sm text-[var(--ink,#1c2624)]"
                  />
                </div>
                <input
                  type="date"
                  value={newDob}
                  onChange={(e) => setNewDob(e.target.value)}
                  className="rounded border border-[var(--line,#ccd6d4)] px-2 py-1.5 text-sm text-[var(--ink,#1c2624)]"
                />
                {/* Same component/format as Storitve's own "+ Nov pacient"
                    form (PatientList.tsx) — country flag/dial-code
                    dropdown, defaults to Slovenia, emits E.164 directly.
                    Optional here too, matching that form: staff booking a
                    quick appointment shouldn't be blocked from creating the
                    patient if a phone/email isn't at hand yet, but having
                    them lets staff actually reach the patient about the
                    appointment. */}
                <PhoneInput
                  defaultCountry="SI"
                  value={newPhone}
                  onChange={(value) => setNewPhone(value ?? '')}
                  placeholder="Telefon"
                />
                {/* No className above — the plain `.PhoneInput` global CSS
                    rule (index.css) already gives it the same
                    border/padding/rounded look as every other input here
                    and on Storitve's own form; adding Tailwind classes on
                    top would double up the border/padding instead of
                    matching it. */}
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="E-pošta"
                  className="rounded border border-[var(--line,#ccd6d4)] px-2 py-1.5 text-sm text-[var(--ink,#1c2624)]"
                />
                {newPatientError && <p className="text-xs text-[var(--danger,#b3261e)]">{newPatientError}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={newPatientSaving}
                    onClick={handleCreatePatientInline}
                    className="rounded bg-[var(--accent,#2e6e62)] px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                  >
                    {newPatientSaving ? 'Shranjujem …' : 'Dodaj pacienta'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowNewPatientForm(false)}
                    className="rounded border border-[var(--line,#ccd6d4)] px-2.5 py-1.5 text-xs text-[var(--ink-soft,#45524f)]"
                  >
                    Prekliči
                  </button>
                </div>
              </div>
            ) : (
              <>
                <input
                  value={patientQuery}
                  onChange={(e) => setPatientQuery(e.target.value)}
                  placeholder="Iskanje po imenu ali priimku …"
                  className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]"
                />
                {filteredPatients.length > 0 && (
                  <ul className="flex flex-col gap-1 rounded border border-[var(--line,#ccd6d4)] p-1">
                    {filteredPatients.map((p) => (
                      <li key={p.patientId}>
                        <button
                          type="button"
                          onClick={() => {
                            setPatientId(p.patientId);
                            setPatientQuery('');
                          }}
                          className="w-full rounded px-2 py-1 text-left text-sm text-[var(--ink,#1c2624)] hover:bg-[var(--bg,#eef2f1)]"
                        >
                          {patientLabel(p)}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={() => setShowNewPatientForm(true)}
                  className="self-start text-xs text-[var(--accent,#2e6e62)] hover:underline"
                >
                  + Dodaj novega pacienta
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
            Pacient
            <button
              type="button"
              onClick={() => onOpenPatientChart(appointment!.patientId)}
              className="w-fit text-left text-sm font-medium text-[var(--accent,#2e6e62)] hover:underline"
            >
              {appointment!.patientLastName} {appointment!.patientFirstName}
            </button>
          </div>
        )}

        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
            Datum
            <input
              type="date"
              required
              value={date}
              // Only on create — an existing (edit-mode) appointment can
              // genuinely be in the past already (e.g. marking a past
              // visit "Opravljen"/"Ni se zglasil/-a"), and that date needs
              // to stay pickable/visible as-is rather than being blocked
              // by the browser's own date-picker min. This is a UX nicety
              // for the common case (picking a past day outright) —
              // handleSubmit's own check below is what actually enforces
              // this for every case, including a past time on today's date.
              min={mode === 'create' ? todayDateValue : undefined}
              onChange={(e) => setDate(e.target.value)}
              className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
            Ura
            <input
              type="time"
              required
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
            Trajanje
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]"
            >
              {DURATION_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
            Predvidena storitev
            <input
              value={service}
              onChange={(e) => setService(e.target.value)}
              placeholder="npr. Pregled + čiščenje"
              className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
            Terapevt
            <select
              value={therapistId}
              onChange={(e) => setTherapistId(e.target.value)}
              className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]"
            >
              <option value="">Neuvrščeno</option>
              {therapists.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
          Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as AppointmentStatus)}
            className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]"
          >
            {APPOINTMENT_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {APPOINTMENT_STATUS_META[s].label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
          Opombe
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]"
          />
        </label>

        {formError && <p className="text-sm text-[var(--danger,#b3261e)]">Napaka: {formError}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="self-start rounded bg-[var(--accent,#2e6e62)] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {submitting ? 'Shranjujem …' : mode === 'create' ? 'Ustvari termin' : 'Shrani spremembe'}
        </button>
      </form>
    </div>
  );
}
