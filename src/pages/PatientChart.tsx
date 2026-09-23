import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import { DentalChart } from '../components/chart/DentalChart';
import { hidesSurfaceDetail } from '../components/chart/ToothTopView';
import { samePerioPoint, type PerioPoint } from '../components/chart/perioStyle';
import { UPPER_LEFT, UPPER_RIGHT, LOWER_LEFT, LOWER_RIGHT } from '../data/toothMeta';
import { ToothDetailPanel } from '../components/ui/ToothDetailPanel';
import { StatusToolbar } from '../components/ui/StatusToolbar';
import { AppNavShell } from '../components/ui/AppNavShell';
import { usePracticeContext } from '../contexts/PracticeContext';
import { useOpenVisit } from '../hooks/useOpenVisit';
import { useVisit } from '../hooks/useVisit';
import { useToothHistory } from '../hooks/useToothHistory';
import { usePatientHistory } from '../hooks/usePatientHistory';
import { useNextAppointment, type AppointmentStatus } from '../hooks/useAppointments';
import { usePatients, type PatientListItem } from '../hooks/usePatients';
import { describeToothRecord } from '../lib/describeToothRecord';
import { APPOINTMENT_STATUS_META } from '../lib/appointmentStatus';
import type { Surface, ToothStatus, EndoStage, PocketDepths, GumMargin, BleedingPoints } from '../types/dental';

// Every quadrant's own FDI order, left-to-right as displayed — the same
// arrays DentalChart.tsx builds the whole chart from. Used only to walk
// "the next point" during perio entry (advancePerioPoint below); auto-
// advance never crosses a quadrant boundary (see its own comment).
const QUADRANTS: readonly (readonly string[])[] = [UPPER_LEFT, UPPER_RIGHT, LOWER_LEFT, LOWER_RIGHT];

// Each arch's two quadrants combined, left-to-right as displayed — used
// only by handleCreateBridge's own boundary check below. A bridge CAN span
// both quadrants of one arch (crossing the midline, e.g. 44 all the way to
// 31 — a real clinical case, per Monika's explicit correction of an
// earlier same-quadrant-only rule), but never crosses between the upper
// and lower arch, which isn't a bridge at all. Deliberately separate from
// QUADRANTS above, which stays per-quadrant for perio auto-advance — the
// two checks have different boundaries on purpose.
const ARCHES: readonly (readonly string[])[] = [
  [...UPPER_LEFT, ...UPPER_RIGHT],
  [...LOWER_LEFT, ...LOWER_RIGHT],
];

// Statuses whose own mark is drawn from `surfaces.all` directly, never
// resolved per individual surface — see redirectsSurfaceEditToWholeTooth's
// own comment (below, in the component) for the full reasoning. Module-level
// since the list itself never changes across renders.
const WHOLE_TOOTH_MARKER_STATUSES: ToothStatus[] = [
  'abrasion',
  'sealant_planned', 'sealant', 'sealant_existing',
  'overlay_planned', 'overlay', 'overlay_existing',
];

// ---------------------------------------------------------------------
// Frame 3 (Rentgeni/Fotografije/SMS/E-pošta) placeholder data — per
// Gregor's explicit choice, this stays exactly as fabricated as it was in
// PatientPageMockup.tsx (no imaging/messaging backend exists — CLAUDE.md's
// "Out of Scope for Phase 1"). Copied verbatim from that file rather than
// referencing it, since the mockup stays a separate, independent dev-only
// sandbox (same role StatusShowcase.tsx already plays) — not imported from
// here. Frame 5's own appointment status/date/time is real now (see
// useNextAppointment below) — only its unpaid-invoice panel
// (MOCK_INVOICES) is still fabricated, since invoicing is separate,
// out-of-scope work.
// ---------------------------------------------------------------------
// "Ni termina" has no equivalent in the real AppointmentStatus enum (see
// useAppointments.ts) — it means "no appointment row exists at all," not a
// status any row can hold. Kept as a small local addition to
// APPOINTMENT_STATUS_META's shape rather than widening that shared type
// with a value the database itself never stores.
const NI_TERMINA_META = { label: 'Ni termina', pillClass: 'border-2 border-[#9CA3AF] bg-white text-[var(--ink,#1c2624)]' };

const MOCK_INVOICES = [
  { id: 'R-2026-014', date: '14. 3. 2026', storitev: 'Pregled + čiščenje', amount: 45, paid: false },
  { id: 'R-2025-098', date: '2. 11. 2025', storitev: 'Zalitje fisur', amount: 30, paid: false },
  { id: 'R-2025-072', date: '5. 8. 2025', storitev: 'Plomba', amount: 60, paid: true },
];

const MOCK_RTG_GALLERY = [
  { date: '11. 10. 2026', opis: 'Panoramski posnetek (OPG)' },
  { date: '3. 1. 2023', opis: 'Lokalni posnetek — zgornji desni kvadrant' },
  { date: '22. 9. 2022', opis: 'Lokalni posnetek — implantat 21' },
];

const MOCK_PHOTOS = [
  { date: '11. 10. 2026', opis: 'Pred posegom — zgornji lok' },
  { date: '3. 1. 2023', opis: 'Most 13–15, po namestitvi' },
];

const MOCK_SMS = { date: '12. 10. 2026', text: 'Pozdravljeni, vaš termin je potrjen za 14. 3. 2026 ob 10:30. Lep pozdrav, Ordinacija Monika Goslar.' };

const MOCK_EMAILS = [
  { date: '12. 10. 2026', subject: 'Potrditev termina 14. 3. 2026', snippet: 'Pozdravljeni, obveščamo vas, da je vaš termin potrjen…' },
  { date: '2. 1. 2023', subject: 'Napotnica za rentgensko slikanje', snippet: 'V prilogi vam pošiljamo napotnico za OPG posnetek…' },
];

// "1982-03-12" -> "12.3.1982" — day.month.year, no leading zeros.
function formatSlovenianDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(d)}.${Number(m)}.${y}`;
}

const GENDER_LABELS: Record<string, string> = { M: 'Moški', F: 'Ženski', '': 'Neznano' };

// Frame 2 field styling — deliberately NOT boxed (a bordered/padded input
// is taller than a bare line of text), matching PatientPageMockup.tsx's
// own approach exactly: edit-mode fields get only an underline (a
// box-shadow, not a border, since a border adds to the element's own box
// height) at the same font-size/line-height as the view-mode text.
const FIELD_INPUT_CLASSES =
  'w-full appearance-none border-0 bg-transparent px-0 py-0 text-base leading-6 text-[var(--ink,#1c2624)] shadow-[0_1px_0_0_var(--line,#ccd6d4)] focus:shadow-[0_1px_0_0_var(--accent,#2e6e62)] focus:outline-none disabled:cursor-not-allowed disabled:text-[var(--muted,#6f7c79)]';
const VIEW_LABEL_CLASSES = 'text-sm text-[var(--muted,#7e7e7d)]';
const VIEW_VALUE_CLASSES = 'text-base text-[var(--ink,#1c2624)]';
const PHONE_COMPACT_CSS = `
  .ppm-phone-compact .PhoneInputInput { border: none; padding: 0; background: transparent; font-size: 1rem; line-height: 1.5rem; }
  .ppm-phone-compact .PhoneInputCountryIcon { height: 1.1rem; }
`;

// SMS reminder consent (migration 015_add_sms_reminders.sql) — see
// usePatients.ts's PatientListItem.smsConsentStatus comment for the full
// state machine.
const SMS_CONSENT_LABEL: Record<PatientListItem['smsConsentStatus'], string> = {
  unknown: 'Ni zahtevano',
  pending: 'Čaka na potrditev',
  granted: 'Potrjeno',
  declined: 'Zavrnjeno',
};
const SMS_CONSENT_BADGE_CLASSES: Record<PatientListItem['smsConsentStatus'], string> = {
  unknown: 'bg-[var(--bg,#eef2f1)] text-[var(--muted,#6f7c79)]',
  pending: 'bg-[#fff4e5] text-[#b26a00]',
  granted: 'bg-[#e8f5e9] text-[#2e7d32]',
  declined: 'bg-[#fdecea] text-[var(--danger,#b3261e)]',
};

interface PatientChartProps {
  /** Which patient this chart belongs to — from PatientList.tsx's own selection. */
  patientId: string;
  /** Display label for the header ("Priimek Ime") — computed once in PatientList.tsx, not re-fetched here. */
  patientLabel: string;
  /** The whole selected patient record — PatientList.tsx already has this in memory (usePatients()), so Frame 2 below can render real fields immediately with no extra fetch. */
  patient: PatientListItem;
  /** Back to the patient list — flushes any pending edits first, same as onSignOut below. */
  onBack: () => void;
  onSignOut: () => void;
  /** Wired to AppNavShell's "Koledar" button below. */
  onNavigateCalendar: () => void;
}

// One chart target — a specific surface, or the whole tooth ('all').
interface Target {
  fdi: string;
  surface: Surface | 'all';
}

function sameTarget(a: Target, b: Target): boolean {
  return a.fdi === b.fdi && a.surface === b.surface;
}

// The real Patient Record page — ports PatientPageMockup.tsx's full
// 8-frame layout onto this page's own real, Supabase-backed chart/
// toolbar/detail-panel logic (unchanged from before this port). Sections
// with no real backend yet (Frame 1's health banner, Frame 3's Rentgeni/
// Fotografije/SMS/E-pošta, Frame 5's Podrobnosti termina) stay exactly as
// fabricated placeholder content as they were in the mockup — building
// real appointments/imaging/messaging is out of scope (CLAUDE.md's own
// "Out of Scope for Phase 1"). Frame 2 (patient info) and Frame 8
// (Pretekli termini) are real now — see their own sections below.
//
// Two ways to set a status, both wired to the same underlying data so
// they can never disagree:
//  1. Click a tooth → detail panel opens below → click a surface chip or
//     "Cel zob" → inline picker → pick a status (ToothDetailPanel.tsx,
//     unchanged from before — kept for notes editing and as a guided
//     fallback, rendered separately below the frame grid, same as always).
//  2. Click surfaces/whole teeth directly on the chart (Ctrl/Cmd+click to
//     select several at once, Escape to clear), then pick a status in the
//     always-visible StatusToolbar (now embedded in Frame 7's "Legenda"
//     tab) to apply it to the whole selection at once.
// Loads and saves against ONE real Supabase visit, resolved fresh for
// `patientId` on every mount — see useOpenVisit.ts and useVisit.ts's own
// comments for exactly what each does.
export function PatientChart({ patientId, patientLabel, patient, onBack, onSignOut, onNavigateCalendar }: PatientChartProps) {
  const { visitId, loading: visitLoading, error: visitError } = useOpenVisit(patientId);
  const { updatePatient, setSmsConsentStatus, setEmailOptOut } = usePatients();
  const { practiceName } = usePracticeContext();
  const [selectedFdi, setSelectedFdi] = useState<string | undefined>();
  const {
    surfacesByFdi,
    setSurfacesByFdi,
    notesByFdi,
    setNotesByFdi,
    postByFdi,
    setPostByFdi,
    endoByFdi,
    setEndoByFdi,
    pocketsBuccalByFdi,
    setPocketsBuccalByFdi,
    pocketsLingualByFdi,
    setPocketsLingualByFdi,
    gumMarginByFdi,
    setGumMarginByFdi,
    bleedingBuccalByFdi,
    setBleedingBuccalByFdi,
    bleedingLingualByFdi,
    setBleedingLingualByFdi,
    bridgeGroupByFdi,
    setBridgeGroupByFdi,
    loading,
    loadError,
    saveStatus,
    flush,
    closeVisit,
  } = useVisit(patientId, visitId);

  // Which single probing point is currently focused for keyboard entry, if
  // any — see PerioPoint (perioStyle.ts). Mutually exclusive with `selection`
  // below (entering numbers and painting statuses are two separate modes;
  // starting one clears the other, see handlePerioPointClick/handleTargetClick).
  const [focusedPerioPoint, setFocusedPerioPoint] = useState<PerioPoint | null>(null);

  const [selection, setSelection] = useState<Target[]>([]);
  const [bridgeMessage, setBridgeMessage] = useState<string | null>(null);

  // Frame 7: "Legenda" (holding the clickable status toolbar) is the
  // first/default tab.
  const [activeTab, setActiveTab] = useState<'legenda' | 'storitve'>('legenda');

  // ---- Frame 2: patient info — REAL, per Gregor's explicit request
  // (including two fields with no prior column, added via migration
  // 010_add_patient_care_fields.sql: assignedDentist/internalRecordNumber
  // — neither hardcoded). Local editable copy seeded from the `patient`
  // prop, same edit/view toggle shape PatientPageMockup.tsx already
  // established; "Shrani" calls updatePatient() for real instead of just
  // flipping editMode off.
  const [editMode, setEditMode] = useState(false);
  const [patientDraft, setPatientDraft] = useState(patient);
  const [savingPatient, setSavingPatient] = useState(false);
  const [patientSaveError, setPatientSaveError] = useState<string | null>(null);
  function updatePatientDraft<K extends keyof PatientListItem>(key: K, value: PatientListItem[K]) {
    setPatientDraft((prev) => ({ ...prev, [key]: value }));
  }
  async function handleSavePatientInfo() {
    setSavingPatient(true);
    setPatientSaveError(null);
    const result = await updatePatient(patientId, {
      firstName: patientDraft.firstName,
      lastName: patientDraft.lastName,
      dob: patientDraft.dob,
      sex: patientDraft.sex,
      phone: patientDraft.phone ?? null,
      email: patientDraft.email ?? null,
      address: patientDraft.address ?? null,
      postalCode: patientDraft.postalCode ?? null,
      city: patientDraft.city ?? null,
      healthCardNumber: patientDraft.healthCardNumber ?? null,
      assignedDentist: patientDraft.assignedDentist ?? null,
      internalRecordNumber: patientDraft.internalRecordNumber ?? null,
    });
    setSavingPatient(false);
    if ('error' in result) {
      setPatientSaveError(result.error);
      return;
    }
    setPatientDraft(result.patient);
    setEditMode(false);
  }
  // Manual override for SMS reminder consent — a deliberate compliance
  // action (patient asked by phone to stop, or staff re-sending an opt-in
  // request), independent of the Uredi/Shrani edit toggle above; see
  // usePatients.ts's own setSmsConsentStatus() comment for why this isn't
  // just another updatePatient() field.
  const [smsConsentSaving, setSmsConsentSaving] = useState(false);
  async function handleSetSmsConsent(status: PatientListItem['smsConsentStatus']) {
    setSmsConsentSaving(true);
    const result = await setSmsConsentStatus(patientId, status);
    setSmsConsentSaving(false);
    if (!('error' in result)) {
      setPatientDraft(result.patient);
    }
  }
  // Manual override for email opt-out — same shape as the SMS override
  // above, but a plain boolean flip (migration 016_add_email_notifications.sql
  // uses opt-out, not SMS's 4-state opt-in) — see usePatients.ts's own
  // setEmailOptOut() comment.
  const [emailOptOutSaving, setEmailOptOutSaving] = useState(false);
  async function handleSetEmailOptOut(optOut: boolean) {
    setEmailOptOutSaving(true);
    const result = await setEmailOptOut(patientId, optOut);
    setEmailOptOutSaving(false);
    if (!('error' in result)) {
      setPatientDraft(result.patient);
    }
  }
  // Notes: its own submit flow, independent of the Edit toggle above —
  // still local-only (no patient-level notes-log table exists yet, same
  // gap the mockup's own version had — see the plan history for this
  // port). Starts empty every session; nothing here persists across a
  // reload, unlike every other field on this card.
  const [noteDraft, setNoteDraft] = useState('');
  const [noteLog, setNoteLog] = useState<{ date: string; text: string }[]>([]);
  function handleSubmitNote() {
    const text = noteDraft.trim();
    if (!text) return;
    setNoteLog((prev) => [{ date: new Date().toLocaleDateString('sl-SI'), text }, ...prev]);
    setNoteDraft('');
  }

  // ---- Frame 3 placeholder local state — copied verbatim from
  // PatientPageMockup.tsx, per Gregor's explicit choice to keep this
  // section fabricated (no real imaging/messaging backend). The
  // invoice panel below it is likewise still fabricated (invoicing is
  // separate, out-of-scope work) even though the rest of Frame 5 is real.
  const [questionnaireOpen, setQuestionnaireOpen] = useState(false);
  const [infoTab, setInfoTab] = useState<'rentgeni' | 'fotografije' | 'sms' | 'eposta'>('rentgeni');
  const [rtgGalleryOpen, setRtgGalleryOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<(typeof MOCK_INVOICES)[number] | null>(null);
  const unpaidInvoices = MOCK_INVOICES.filter((inv) => !inv.paid);
  const totalUnpaid = unpaidInvoices.reduce((sum, inv) => sum + inv.amount, 0);

  // ---- Frame 5: real appointment data (supabase/migrations/
  // 013_add_appointments.sql) — one modal handles both "Naroči naslednji
  // termin" (no appointment.appointment yet) and "Prestavi termin"
  // (rescheduling the existing one), since scheduleAppointment() already
  // does the right thing for either case.
  const { appointment: nextAppointment, scheduleAppointment } = useNextAppointment(patientId);
  const [appointmentModalOpen, setAppointmentModalOpen] = useState(false);
  const [appointmentModalError, setAppointmentModalError] = useState<string | null>(null);
  const [appointmentModalSaving, setAppointmentModalSaving] = useState(false);
  const [appointmentDate, setAppointmentDate] = useState('');
  const [appointmentTime, setAppointmentTime] = useState('09:00');
  const [appointmentDuration, setAppointmentDuration] = useState(30);
  const [appointmentService, setAppointmentService] = useState('');
  const [appointmentStatus, setAppointmentStatus] = useState<AppointmentStatus>('scheduled');

  function openAppointmentModal() {
    if (nextAppointment) {
      const starts = new Date(nextAppointment.startsAt);
      setAppointmentDate(
        `${starts.getFullYear()}-${String(starts.getMonth() + 1).padStart(2, '0')}-${String(starts.getDate()).padStart(2, '0')}`
      );
      setAppointmentTime(`${String(starts.getHours()).padStart(2, '0')}:${String(starts.getMinutes()).padStart(2, '0')}`);
      setAppointmentDuration(Math.round((new Date(nextAppointment.endsAt).getTime() - starts.getTime()) / 60000));
      setAppointmentService(nextAppointment.service ?? '');
      setAppointmentStatus(nextAppointment.status);
    } else {
      const today = new Date();
      setAppointmentDate(
        `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      );
      setAppointmentTime('09:00');
      setAppointmentDuration(30);
      setAppointmentService('');
      setAppointmentStatus('scheduled');
    }
    setAppointmentModalError(null);
    setAppointmentModalOpen(true);
  }

  async function handleSaveAppointment() {
    setAppointmentModalSaving(true);
    setAppointmentModalError(null);
    const startsAt = new Date(`${appointmentDate}T${appointmentTime}`).toISOString();
    const endsAt = new Date(new Date(`${appointmentDate}T${appointmentTime}`).getTime() + appointmentDuration * 60000).toISOString();
    const result = await scheduleAppointment({
      startsAt,
      endsAt,
      service: appointmentService.trim() || undefined,
      status: appointmentStatus,
    });
    setAppointmentModalSaving(false);
    if ('error' in result) {
      setAppointmentModalError(result.error);
      return;
    }
    setAppointmentModalOpen(false);
  }

  // ---- Frame 8: real cross-tooth visit rollup (usePatientHistory.ts) —
  // replaces PatientPageMockup.tsx's fabricated MOCK_VISIT_HISTORY.
  const { entries: patientHistoryEntries } = usePatientHistory(patientId);

  // Statuses that need to land on the whole tooth (`surfaces.all`) no
  // matter which individual surface was actually clicked to apply them —
  // see hidesSurfaceDetail()/WHOLE_TOOTH_MARKER_STATUSES.
  function redirectsSurfaceEditToWholeTooth(status: ToothStatus): boolean {
    return WHOLE_TOOTH_MARKER_STATUSES.includes(status) || hidesSurfaceDetail(status);
  }

  function handleSurfaceStatusChange(fdi: string, surface: Surface, status: ToothStatus) {
    if (redirectsSurfaceEditToWholeTooth(status)) {
      handleWholeToothStatusChange(fdi, status);
      return;
    }
    setSurfacesByFdi((prev) => ({ ...prev, [fdi]: { ...prev[fdi], [surface]: status } }));
  }

  function handleWholeToothStatusChange(fdi: string, status: ToothStatus) {
    setSurfacesByFdi((prev) => ({ ...prev, [fdi]: { all: status } }));
  }

  function applyStatusToTarget(target: Target, status: ToothStatus) {
    if (target.surface === 'all') handleWholeToothStatusChange(target.fdi, status);
    else handleSurfaceStatusChange(target.fdi, target.surface, status);
  }

  function isTargetSelected(fdi: string, surface: Surface | 'all'): boolean {
    return selection.some((t) => sameTarget(t, { fdi, surface }));
  }

  function isFdiSelected(fdi: string): boolean {
    return selection.some((t) => t.fdi === fdi);
  }

  function handleTargetClick(fdi: string, surface: Surface | 'all', e: MouseEvent) {
    const target: Target = { fdi, surface };
    const extend = e.ctrlKey || e.metaKey || e.shiftKey;
    setSelection((prev) => {
      const idx = prev.findIndex((t) => sameTarget(t, target));
      if (extend) {
        return idx >= 0 ? prev.filter((_, i) => i !== idx) : [...prev, target];
      }
      return [target];
    });
    setFocusedPerioPoint(null);
    setBridgeMessage(null);
  }

  function handleStatusClick(status: ToothStatus) {
    if (selection.length === 0) return;
    if (status === 'bridge_pontic') {
      handleCreateBridge();
      return;
    }
    selection.forEach((target) => applyStatusToTarget(target, status));
  }

  function handleCreateBridge() {
    const fdis = [...new Set(selection.map((t) => t.fdi))];
    if (fdis.length < 2) {
      setBridgeMessage(
        'Za most izberite vsaj dva zoba skupaj — pridržite Ctrl (ali Cmd na Macu) med klikom na drugi zob, da ostane izbran tudi prvi.'
      );
      return;
    }
    const arch = ARCHES.find((a) => fdis.every((fdi) => a.includes(fdi)));
    if (!arch) {
      setBridgeMessage('Izbrani zobje morajo biti v isti čeljusti (zgornji ali spodnji).');
      return;
    }
    const anchors = fdis.filter((fdi) => {
      const status = surfacesByFdi[fdi]?.all;
      return status === 'crown' || status === 'implant';
    });
    if (anchors.length === 0) {
      setBridgeMessage('Izbira mora vsebovati zob, ki že ima prevleko ali implantat — most se pripne nanj.');
      return;
    }
    const anchorTypes = new Set(anchors.map((fdi) => surfacesByFdi[fdi]?.all));
    if (anchorTypes.size > 1) {
      setBridgeMessage('Oba sidra mostu morata biti istega tipa — obe prevleki ali oba implantata, ne kombinacija.');
      return;
    }
    const pontics = fdis.filter((fdi) => !anchors.includes(fdi));
    if (pontics.length === 0) {
      setBridgeMessage('Poleg prevleke/implantata izberite še vsaj en zob, ki naj postane člen mostu.');
      return;
    }
    setBridgeMessage(null);
    setSurfacesByFdi((prev) => {
      const next = { ...prev };
      for (const fdi of pontics) next[fdi] = { all: 'bridge_pontic' };
      return next;
    });
    const groupId = `bridge-${fdis.slice().sort().join('_')}-${Date.now()}`;
    setBridgeGroupByFdi((prev) => {
      const next = { ...prev };
      for (const fdi of fdis) next[fdi] = groupId;
      return next;
    });
  }

  function handleClearSelection() {
    setSelection([]);
    setBridgeMessage(null);
  }

  function handleTogglePost() {
    const fdis = [...new Set(selection.map((t) => t.fdi))];
    if (fdis.length === 0) return;
    const allHavePost = fdis.every((fdi) => postByFdi[fdi]);
    setPostByFdi((prev) => {
      const next = { ...prev };
      for (const fdi of fdis) next[fdi] = !allHavePost;
      return next;
    });
  }

  function handleSetEndoStage(stage: EndoStage) {
    const fdis = [...new Set(selection.map((t) => t.fdi))];
    if (fdis.length === 0) return;
    const allHaveStage = fdis.every((fdi) => endoByFdi[fdi] === stage);
    setEndoByFdi((prev) => {
      const next = { ...prev };
      for (const fdi of fdis) {
        if (allHaveStage) delete next[fdi];
        else next[fdi] = stage;
      }
      return next;
    });
  }

  function quadrantOf(fdi: string): readonly string[] | undefined {
    return QUADRANTS.find((q) => q.includes(fdi));
  }

  function advancePerioPoint(point: PerioPoint): PerioPoint | null {
    if (point.index < 2) return { ...point, index: (point.index + 1) as 0 | 1 | 2 };
    const quadrant = quadrantOf(point.fdi);
    const nextFdi = quadrant?.[quadrant.indexOf(point.fdi) + 1];
    if (!nextFdi) return null;
    return point.kind === 'pocket' ? { kind: 'pocket', fdi: nextFdi, surface: point.surface, index: 0 } : { kind: 'gum', fdi: nextFdi, index: 0 };
  }

  const toggleBleeding = useCallback(
    (point: Extract<PerioPoint, { kind: 'pocket' }>) => {
      const setter = point.surface === 'buccal' ? setBleedingBuccalByFdi : setBleedingLingualByFdi;
      setter((prev) => {
        const cur = prev[point.fdi] ?? [false, false, false];
        const next = [...cur] as BleedingPoints;
        next[point.index] = !next[point.index];
        return { ...prev, [point.fdi]: next };
      });
    },
    [setBleedingBuccalByFdi, setBleedingLingualByFdi]
  );

  const toggleGumSign = useCallback(
    (point: Extract<PerioPoint, { kind: 'gum' }>) => {
      setGumMarginByFdi((prev) => {
        const cur = prev[point.fdi];
        if (cur == null || cur[point.index] == null) return prev;
        const next = [...cur] as GumMargin;
        next[point.index] = -(next[point.index] as number);
        return { ...prev, [point.fdi]: next };
      });
    },
    [setGumMarginByFdi]
  );

  function handlePerioPointClick(point: PerioPoint) {
    setSelection([]);
    if (samePerioPoint(focusedPerioPoint, point)) {
      if (point.kind === 'pocket') toggleBleeding(point);
      else toggleGumSign(point);
      return;
    }
    setFocusedPerioPoint(point);
  }

  const applyPerioDigit = useCallback(
    (point: PerioPoint, digit: number, shiftHeld: boolean) => {
      if (point.kind === 'pocket') {
        const setter = point.surface === 'buccal' ? setPocketsBuccalByFdi : setPocketsLingualByFdi;
        setter((prev) => {
          const cur = prev[point.fdi] ?? [null, null, null];
          const next = [...cur] as PocketDepths;
          next[point.index] = digit;
          return { ...prev, [point.fdi]: next };
        });
        if (shiftHeld) toggleBleeding(point);
      } else {
        setGumMarginByFdi((prev) => {
          const cur = prev[point.fdi] ?? [null, null, null];
          const priorValue = cur[point.index];
          const priorSign = priorValue != null && priorValue > 0 ? 1 : -1;
          const next = [...cur] as GumMargin;
          next[point.index] = priorSign * digit;
          return { ...prev, [point.fdi]: next };
        });
        if (shiftHeld) toggleGumSign(point);
      }
    },
    [setPocketsBuccalByFdi, setPocketsLingualByFdi, toggleBleeding, setGumMarginByFdi, toggleGumSign]
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      if (e.key === 'Escape') {
        setSelection([]);
        setFocusedPerioPoint(null);
        setBridgeMessage(null);
        return;
      }
      if (focusedPerioPoint && /^[0-9]$/.test(e.key)) {
        e.preventDefault();
        applyPerioDigit(focusedPerioPoint, Number(e.key), e.shiftKey);
        setFocusedPerioPoint(advancePerioPoint(focusedPerioPoint));
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedPerioPoint, applyPerioDigit]);

  useEffect(() => {
    const timer = setTimeout(() => {
      flush();
    }, 30000);
    return () => clearTimeout(timer);
  }, [
    surfacesByFdi,
    postByFdi,
    endoByFdi,
    pocketsBuccalByFdi,
    pocketsLingualByFdi,
    gumMarginByFdi,
    bleedingBuccalByFdi,
    bleedingLingualByFdi,
    notesByFdi,
    bridgeGroupByFdi,
    flush,
  ]);

  useEffect(() => {
    const timer = setTimeout(
      async () => {
        await flush();
        await closeVisit();
      },
      30 * 60 * 1000
    );
    return () => clearTimeout(timer);
  }, [
    surfacesByFdi,
    postByFdi,
    endoByFdi,
    pocketsBuccalByFdi,
    pocketsLingualByFdi,
    gumMarginByFdi,
    bleedingBuccalByFdi,
    bleedingLingualByFdi,
    notesByFdi,
    bridgeGroupByFdi,
    flush,
    closeVisit,
  ]);

  async function handleBackClick() {
    await flush();
    await closeVisit();
    onBack();
  }
  async function handleSignOutClick() {
    await flush();
    await closeVisit();
    onSignOut();
  }

  if (visitLoading || loading) {
    return <p className="p-6 text-sm text-[var(--ink-soft,#45524f)]">Nalaganje…</p>;
  }
  if (visitError) {
    return <p className="p-6 text-sm text-[var(--danger,#b3261e)]">Napaka pri odpiranju obiska: {visitError}</p>;
  }
  if (loadError) {
    return <p className="p-6 text-sm text-[var(--danger,#b3261e)]">Napaka pri nalaganju: {loadError}</p>;
  }

  // ---- Shared frame content, rendered at two different responsive
  // positions below 1400px vs. >=1400px — same sharing pattern
  // PatientPageMockup.tsx established (appointmentCardContent/
  // visitHistoryContent/rentgeniCardContent), so each frame's actual
  // markup exists once, not as two independently-maintained copies.
  const appointmentCardContent = (
    <>
      <h2 className="mb-3 text-lg font-bold text-[var(--ink,#1c2624)]">Podrobnosti termina</h2>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-1 flex-col items-start gap-2">
          <span
            className={`w-fit rounded-full px-4 py-1.5 text-sm font-semibold ${
              nextAppointment ? APPOINTMENT_STATUS_META[nextAppointment.status].pillClass : NI_TERMINA_META.pillClass
            }`}
          >
            {nextAppointment ? APPOINTMENT_STATUS_META[nextAppointment.status].label : NI_TERMINA_META.label}
          </span>
          <button
            type="button"
            onClick={openAppointmentModal}
            className="w-fit rounded-full bg-[var(--accent,#2e6e62)] px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90"
          >
            {nextAppointment ? 'Prestavi termin' : 'Naroči naslednji termin'}
          </button>
          {nextAppointment && (
            <div className="flex flex-col gap-1 text-sm text-[var(--ink,#1c2624)]">
              <span>Datum: {formatSlovenianDate(nextAppointment.startsAt.slice(0, 10))}</span>
              <span>Ura: {new Date(nextAppointment.startsAt).toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' })}</span>
              {nextAppointment.service && <span>Predvidena storitev: {nextAppointment.service}</span>}
            </div>
          )}
        </div>
        <div className="flex w-[150px] flex-none flex-col gap-1.5">
          {unpaidInvoices.length > 0 ? (
            <>
              <span className="w-fit rounded-full bg-[#e0231c] px-3 py-1 text-xs font-semibold text-white">
                Neplačani račun
              </span>
              <ul className="flex flex-col gap-1">
                {unpaidInvoices.map((inv) => (
                  <li key={inv.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedInvoice(inv)}
                      className="w-full rounded border border-[var(--line,#ccd6d4)] px-2 py-1 text-left text-xs text-[var(--ink,#1c2624)] hover:border-[var(--accent,#2e6e62)]"
                    >
                      <div className="font-medium">{inv.date}</div>
                      <div className="text-[var(--muted,#6f7c79)]">{inv.amount.toFixed(2)} €</div>
                    </button>
                  </li>
                ))}
              </ul>
              <span className="mt-1 text-xs font-semibold text-[var(--ink,#1c2624)]">
                Skupaj: {totalUnpaid.toFixed(2)} €
              </span>
            </>
          ) : (
            <span className="w-fit rounded-full bg-[#4CAF50] px-3 py-1 text-xs font-medium text-white">
              Računi plačani
            </span>
          )}
        </div>
      </div>
    </>
  );

  // Frame 8 — real cross-tooth rollup (usePatientHistory above).
  const visitHistoryContent = (
    <>
      <h2 className="mb-3 flex-none text-xl font-bold text-[var(--ink,#1c2624)]">Pretekli termini in storitve</h2>
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {patientHistoryEntries.length === 0 && (
          <li className="text-sm italic text-[var(--muted,#6f7c79)]">Za tega pacienta še ni zabeležene zgodovine.</li>
        )}
        {patientHistoryEntries.map((visit) => (
          <li key={visit.visitId} className="flex-none rounded-md bg-[#e7e7e7] p-3">
            <span className="font-mono text-xs text-[var(--muted,#6f7c79)]">{formatSlovenianDate(visit.date)}</span>
            <ul className="mt-1 flex flex-col gap-0.5 text-sm text-[var(--ink,#1c2624)]">
              {visit.items.map((item, j) => (
                <li key={j}>• {item}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </>
  );

  const rentgeniCardContent = (
    <>
      <div className="mb-3 flex flex-none items-center justify-between border-b border-[var(--line,#ccd6d4)]">
        <div className="flex gap-1">
          {(
            [
              ['rentgeni', 'Rentgeni'],
              ['fotografije', 'Fotografije'],
              ['sms', 'SMS'],
              ['eposta', 'E-pošta'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setInfoTab(key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
                infoTab === key
                  ? 'border-[var(--accent,#2e6e62)] text-[var(--accent,#2e6e62)]'
                  : 'border-transparent text-[var(--ink-soft,#45524f)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {infoTab === 'rentgeni' && (
          <button
            type="button"
            onClick={() => setRtgGalleryOpen(true)}
            className="mb-2 flex-none rounded-full border border-[var(--ink,#1c2624)] px-3 py-1 text-xs font-semibold text-[var(--ink,#1c2624)] hover:border-[var(--accent,#2e6e62)] hover:text-[var(--accent,#2e6e62)]"
          >
            RTG galerija
          </button>
        )}
      </div>

      {infoTab === 'rentgeni' && (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <p className="flex-none text-xs italic text-[var(--muted,#6f7c79)]">
            Mockup — slike bi se sem prenesle samodejno iz RTG aparata/studia. Prikazan je najnovejši posnetek.
          </p>
          <div className="flex w-full flex-1 items-center justify-center rounded-md bg-[#e7e7e7] text-sm text-[var(--muted,#6f7c79)]">
            {MOCK_RTG_GALLERY[0].opis} · {MOCK_RTG_GALLERY[0].date}
          </div>
        </div>
      )}
      {infoTab === 'fotografije' && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <p className="flex-none text-xs italic text-[var(--muted,#6f7c79)]">
            Mockup — klinične fotografije, ki jih zdravnik naloži med zdravljenjem.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {MOCK_PHOTOS.map((photo, i) => (
              <div key={i} className="flex flex-col gap-1">
                <div className="flex aspect-square w-full items-center justify-center rounded-md bg-[#e7e7e7] text-xs text-[var(--muted,#6f7c79)]">
                  {photo.opis}
                </div>
                <span className="text-xs text-[var(--muted,#6f7c79)]">{photo.date}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {infoTab === 'sms' && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <p className="flex-none text-xs italic text-[var(--muted,#6f7c79)]">Mockup — zadnje SMS sporočilo s pacientom.</p>
          <div className="rounded-md bg-[#e7e7e7] p-3 text-sm text-[var(--ink,#1c2624)]">
            <p>{MOCK_SMS.text}</p>
            <p className="mt-2 text-xs text-[var(--muted,#6f7c79)]">{MOCK_SMS.date}</p>
          </div>
        </div>
      )}
      {infoTab === 'eposta' && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <p className="flex-none text-xs italic text-[var(--muted,#6f7c79)]">Mockup — kronološka zgodovina e-pošte s pacientom.</p>
          <ul className="flex flex-col gap-2">
            {MOCK_EMAILS.map((email, i) => (
              <li key={i} className="rounded-md bg-[#e7e7e7] p-3 text-sm text-[var(--ink,#1c2624)]">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{email.subject}</span>
                  <span className="flex-none text-xs text-[var(--muted,#6f7c79)]">{email.date}</span>
                </div>
                <p className="mt-1 text-xs text-[var(--muted,#6f7c79)]">{email.snippet}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );

  return (
    <>
      <AppNavShell
        userLabel={practiceName ?? undefined}
        onSignOut={handleSignOutClick}
        onNavigateCalendar={onNavigateCalendar}
        onNavigateHome={handleBackClick}
        activeSubmenu="storitve"
      />
      <style>{PHONE_COMPACT_CSS}</style>
      <div className="flex w-full flex-col gap-1.5 pb-4 pt-1.5">
        {/* ---- Frame 1: health banner + Vprašalnik — placeholder, per
            Gregor's explicit choice (no real questionnaire/allergies data
            model exists). Back-link and autosave status are real
            (handleBackClick/saveStatus) — folded into this same row rather
            than a title strip of their own, so this page's total height
            matches the mockup's exactly (an earlier version added a
            separate title/autosave row above this one, which pushed every
            frame below it down ~50px versus the mockup at the same
            viewport — enough to tip a 17" screen into vertical scroll that
            the mockup never had; Gregor caught this by comparing the two
            side by side). */}
        <div className="flex items-center gap-4 px-4">
          <button
            type="button"
            onClick={handleBackClick}
            className="flex-none text-sm text-[var(--ink-soft,#45524f)] hover:text-[var(--accent,#2e6e62)]"
          >
            ← Nazaj na seznam pacientov
          </button>
          <span className="flex-none text-xs text-[var(--muted,#6f7c79)]">
            {saveStatus === 'saving' && 'Shranjujem …'}
            {saveStatus === 'saved' && 'Shranjeno'}
            {saveStatus === 'error' && <span className="text-[var(--danger,#b3261e)]">Napaka pri shranjevanju</span>}
          </span>
          <div className="flex flex-1 items-center gap-4 rounded-md bg-[#e0231c] px-4 py-2 text-sm font-bold text-white">
            <div className="grid flex-1 grid-cols-3 items-center gap-4 text-left">
              <span>Alergije: penicilin</span>
              <span>Akutna stanja: povišan krvni tlak</span>
              <span>Zdravila: Lisinopril 10mg</span>
            </div>
            <span className="flex-none text-xs font-normal italic text-white/80">(mockup — iz vprašalnika o zdravju)</span>
            <button
              type="button"
              onClick={() => setQuestionnaireOpen(true)}
              className="flex-none rounded-full bg-white px-4 py-1.5 text-xs font-bold text-[#e0231c] hover:bg-white/90"
            >
              Vprašalnik
            </button>
          </div>
        </div>

        {questionnaireOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={() => setQuestionnaireOpen(false)}>
            <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-md bg-[var(--surface,#fff)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-bold text-[var(--ink,#1c2624)]">Vprašalnik o zdravju</h2>
                <button type="button" onClick={() => setQuestionnaireOpen(false)} className="text-[var(--ink-soft,#45524f)] hover:text-[var(--accent,#2e6e62)]">
                  ✕
                </button>
              </div>
              <p className="mb-4 text-sm italic text-[var(--muted,#6f7c79)]">
                Mockup — tu bo prikazan celoten izpolnjen vprašalnik pacienta (odgovori o alergijah, kroničnih boleznih, zdravilih, preteklih operacijah ipd.).
              </p>
              <div className="flex flex-col gap-3 text-sm text-[var(--ink,#1c2624)]">
                <div><span className="font-semibold">Alergije: </span>penicilin</div>
                <div><span className="font-semibold">Kronične bolezni / akutna stanja: </span>povišan krvni tlak</div>
                <div><span className="font-semibold">Zdravila: </span>Lisinopril 10mg</div>
                <div><span className="font-semibold">Datum izpolnitve: </span>4. 1. 2023</div>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 items-start gap-3 px-3 sm:grid-cols-2 min-[1400px]:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
          {/* ---- Left column: Frame 2 (patient info, REAL) + Frame 8
              (Pretekli termini, REAL) ---- */}
          <div className="contents min-[1400px]:order-1 min-[1400px]:flex min-[1400px]:flex-col min-[1400px]:gap-3">
            <div className="order-0 flex flex-col gap-2 rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-4 sm:col-span-2 min-[1400px]:col-span-1 min-[1400px]:gap-4">
              <div className="flex items-start justify-between gap-3">
                <h1 className="text-3xl font-bold text-[var(--ink,#1c2624)]">{patientLabel}</h1>
                <button
                  type="button"
                  onClick={() => (editMode ? handleSavePatientInfo() : setEditMode(true))}
                  disabled={savingPatient}
                  className={
                    editMode
                      ? 'flex-none rounded-full bg-[var(--accent,#2e6e62)] px-5 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60'
                      : 'flex-none rounded-full border border-[var(--ink,#1c2624)] px-5 py-1.5 text-sm font-semibold text-[var(--ink,#1c2624)] hover:border-[var(--accent,#2e6e62)] hover:text-[var(--accent,#2e6e62)]'
                  }
                >
                  {savingPatient ? 'Shranjujem …' : editMode ? 'Shrani' : 'Uredi'}
                </button>
              </div>
              {patientSaveError && <p className="text-xs text-[var(--danger,#b3261e)]">Napaka pri shranjevanju: {patientSaveError}</p>}

              <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-4 min-[1400px]:grid-cols-2 min-[1400px]:gap-y-3">
                <div className="flex flex-col gap-1">
                  <span className={VIEW_LABEL_CLASSES}>Spol</span>
                  {editMode ? (
                    <select
                      value={patientDraft.sex ?? ''}
                      onChange={(e) => updatePatientDraft('sex', (e.target.value || null) as PatientListItem['sex'])}
                      className={FIELD_INPUT_CLASSES}
                    >
                      <option value="">Neznano</option>
                      <option value="F">Ženski</option>
                      <option value="M">Moški</option>
                    </select>
                  ) : (
                    <span className={VIEW_VALUE_CLASSES}>{GENDER_LABELS[patientDraft.sex ?? '']}</span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <span className={VIEW_LABEL_CLASSES}>Izbran terapevt</span>
                  {editMode ? (
                    <input
                      value={patientDraft.assignedDentist ?? ''}
                      onChange={(e) => updatePatientDraft('assignedDentist', e.target.value)}
                      className={FIELD_INPUT_CLASSES}
                    />
                  ) : (
                    <span className={VIEW_VALUE_CLASSES}>{patientDraft.assignedDentist || '—'}</span>
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  <span className={VIEW_LABEL_CLASSES}>Datum rojstva</span>
                  {editMode ? (
                    <input
                      value={patientDraft.dob}
                      onChange={(e) => updatePatientDraft('dob', e.target.value)}
                      placeholder="LLLL-MM-DD"
                      className={FIELD_INPUT_CLASSES}
                    />
                  ) : (
                    <span className={VIEW_VALUE_CLASSES}>{formatSlovenianDate(patientDraft.dob)}</span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <span className={VIEW_LABEL_CLASSES}>E-pošta</span>
                  {editMode ? (
                    <input
                      type="email"
                      value={patientDraft.email ?? ''}
                      onChange={(e) => updatePatientDraft('email', e.target.value)}
                      className={FIELD_INPUT_CLASSES}
                    />
                  ) : (
                    <span className={VIEW_VALUE_CLASSES}>{patientDraft.email || '—'}</span>
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  <span className={VIEW_LABEL_CLASSES}>Naslov</span>
                  {editMode ? (
                    <div className="flex flex-col">
                      <input
                        value={patientDraft.address ?? ''}
                        onChange={(e) => updatePatientDraft('address', e.target.value)}
                        className={FIELD_INPUT_CLASSES}
                      />
                      <div className="flex gap-1.5">
                        <input
                          value={patientDraft.postalCode ?? ''}
                          onChange={(e) => updatePatientDraft('postalCode', e.target.value)}
                          inputMode="numeric"
                          placeholder="Poštna št."
                          className={FIELD_INPUT_CLASSES + ' w-20'}
                        />
                        <input
                          value={patientDraft.city ?? ''}
                          onChange={(e) => updatePatientDraft('city', e.target.value)}
                          placeholder="Kraj"
                          className={FIELD_INPUT_CLASSES + ' flex-1'}
                        />
                      </div>
                    </div>
                  ) : (
                    <span className={VIEW_VALUE_CLASSES}>
                      {patientDraft.address || '—'}
                      <br />
                      {patientDraft.postalCode} {patientDraft.city}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <span className={VIEW_LABEL_CLASSES}>Telefonska številka</span>
                  {editMode ? (
                    <div className="ppm-phone-compact w-full shadow-[0_1px_0_0_var(--line,#ccd6d4)]">
                      <PhoneInput defaultCountry="SI" value={patientDraft.phone ?? ''} onChange={(v) => updatePatientDraft('phone', v ?? '')} />
                    </div>
                  ) : (
                    <span className={VIEW_VALUE_CLASSES}>{patientDraft.phone || '—'}</span>
                  )}
                </div>

                {/* SMS-consent indicator — only meaningful once a phone
                    exists, matching the trigger's own condition (no phone,
                    no consent flow at all). Always actionable regardless of
                    the Uredi/Shrani toggle above, since it's a status
                    action, not a draft text edit. */}
                {patientDraft.phone && (
                  <div className="flex flex-col gap-1">
                    <span className={VIEW_LABEL_CLASSES}>SMS opomniki</span>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${SMS_CONSENT_BADGE_CLASSES[patientDraft.smsConsentStatus]}`}
                      >
                        {SMS_CONSENT_LABEL[patientDraft.smsConsentStatus]}
                      </span>
                      {patientDraft.smsConsentStatus === 'granted' ? (
                        <button
                          type="button"
                          disabled={smsConsentSaving}
                          onClick={() => handleSetSmsConsent('declined')}
                          className="text-xs text-[var(--danger,#b3261e)] hover:underline disabled:opacity-60"
                        >
                          Prekliči soglasje
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={smsConsentSaving}
                          onClick={() => handleSetSmsConsent('granted')}
                          className="text-xs text-[var(--accent,#2e6e62)] hover:underline disabled:opacity-60"
                        >
                          Označi kot potrjeno
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Email opt-out indicator — only meaningful once an email
                    is on file, same reasoning as the SMS badge above.
                    Opt-out model, not SMS's opt-in: an email on file is
                    treated as implied consent, so this only needs 2 states
                    and 1 toggle, not SMS's 4. */}
                {patientDraft.email && (
                  <div className="flex flex-col gap-1">
                    <span className={VIEW_LABEL_CLASSES}>E-poštna obvestila</span>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          patientDraft.emailOptOut
                            ? 'bg-[#fdecea] text-[#b3261e]'
                            : 'bg-[#e8f5e9] text-[#2e7d32]'
                        }`}
                      >
                        {patientDraft.emailOptOut ? 'Odjavljen(a)' : 'Aktivno'}
                      </span>
                      {patientDraft.emailOptOut ? (
                        <button
                          type="button"
                          disabled={emailOptOutSaving}
                          onClick={() => handleSetEmailOptOut(false)}
                          className="text-xs text-[var(--accent,#2e6e62)] hover:underline disabled:opacity-60"
                        >
                          Ponovno omogoči
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={emailOptOutSaving}
                          onClick={() => handleSetEmailOptOut(true)}
                          className="text-xs text-[var(--danger,#b3261e)] hover:underline disabled:opacity-60"
                        >
                          Odjavi
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-1">
                  <span className={VIEW_LABEL_CLASSES}>Št. ZZZS</span>
                  {editMode ? (
                    <input
                      value={patientDraft.healthCardNumber ?? ''}
                      onChange={(e) => updatePatientDraft('healthCardNumber', e.target.value)}
                      inputMode="numeric"
                      className={FIELD_INPUT_CLASSES}
                    />
                  ) : (
                    <span className={VIEW_VALUE_CLASSES}>{patientDraft.healthCardNumber || '—'}</span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <span className={VIEW_LABEL_CLASSES}>Št. interne evidence</span>
                  {editMode ? (
                    <input
                      value={patientDraft.internalRecordNumber ?? ''}
                      onChange={(e) => updatePatientDraft('internalRecordNumber', e.target.value)}
                      className={FIELD_INPUT_CLASSES}
                    />
                  ) : (
                    <span className={VIEW_VALUE_CLASSES}>{patientDraft.internalRecordNumber || '—'}</span>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <span className={VIEW_LABEL_CLASSES}>Opombe</span>
                <div className="flex items-stretch gap-2 min-[1400px]:relative min-[1400px]:block">
                  <textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    placeholder="Dodaj opombo o pacientu…"
                    rows={4}
                    className="h-10 w-full resize-none rounded-xl border-none bg-[#d2d0ca] px-3 py-2 text-[var(--ink,#1c2624)] placeholder:text-[var(--ink,#1c2624)]/50 min-[1400px]:h-auto min-[1400px]:pb-12"
                  />
                  <button
                    type="button"
                    onClick={handleSubmitNote}
                    disabled={!noteDraft.trim()}
                    className="flex-none self-center rounded-full bg-[#1800ad] px-5 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 min-[1400px]:absolute min-[1400px]:bottom-3 min-[1400px]:right-3 min-[1400px]:self-auto"
                  >
                    Shrani
                  </button>
                </div>
                {noteLog.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1.5 border-t border-[var(--line,#ccd6d4)] pt-2">
                    {noteLog.map((entry, i) => (
                      <li key={i} className="flex gap-3 text-sm text-[var(--ink,#1c2624)]">
                        <span className="w-20 flex-none font-mono text-xs text-[var(--muted,#6f7c79)]">{entry.date}</span>
                        <span>{entry.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="hidden h-[271px] flex-col rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-4 min-[1400px]:flex">
              {visitHistoryContent}
            </div>
          </div>

          {/* ---- Middle column: chart + StatusToolbar + Legenda/Storitve po zobeh — REAL ---- */}
          <div className="order-1 flex flex-col gap-1.5 sm:col-span-2 sm:flex-row sm:items-start sm:gap-3 min-[1400px]:order-2 min-[1400px]:col-span-1 min-[1400px]:flex-col min-[1400px]:gap-1.5">
            <div className="flex flex-col gap-3 sm:flex-none min-[1400px]:contents">
              <div className="mx-auto w-full max-[1399px]:max-w-[990px] sm:mx-0 sm:flex-none">
                <DentalChart
                  instructionText={
                    <div className="flex items-center justify-between gap-3">
                      <span>{selectedFdi ? `Izbran zob: ${selectedFdi}` : 'Kliknite na zob za izbiro in urejanje statusa/storitev spodaj.'}</span>
                      <span>Za vnos globine žepka ali umika dlesni kliknite eno od točk ob zobeh.</span>
                    </div>
                  }
                  surfacesByFdi={surfacesByFdi}
                  pocketsBuccal={pocketsBuccalByFdi}
                  pocketsLingual={pocketsLingualByFdi}
                  gumMargin={gumMarginByFdi}
                  bleedingBuccal={bleedingBuccalByFdi}
                  bleedingLingual={bleedingLingualByFdi}
                  postByFdi={postByFdi}
                  endoByFdi={endoByFdi}
                  bridgeGroupByFdi={bridgeGroupByFdi}
                  onSelect={setSelectedFdi}
                  onTargetClick={handleTargetClick}
                  isTargetSelected={isTargetSelected}
                  isFdiSelected={isFdiSelected}
                  onPerioPointClick={handlePerioPointClick}
                  focusedPerioPoint={focusedPerioPoint}
                  hideArchLabels
                  compact
                  fitWidth
                />
              </div>

              <div className="hidden flex-col gap-3 sm:flex sm:flex-row sm:items-start sm:gap-3 min-[1400px]:hidden">
                <div className="flex flex-col gap-3 sm:min-w-0 sm:flex-1">
                  <div className="rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-4">{appointmentCardContent}</div>
                  <div className="flex h-[271px] flex-col rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-4">{visitHistoryContent}</div>
                </div>
                <div className="flex h-[589px] flex-col rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-4 sm:min-w-0 sm:flex-1">
                  {rentgeniCardContent}
                </div>
              </div>
            </div>

            <div className="flex flex-col rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-4 sm:min-w-0 sm:flex-1 min-[1400px]:flex-none min-[1400px]:w-full">
              <div className="mb-3 flex flex-none flex-col items-stretch gap-2 border-b border-[var(--line,#ccd6d4)] min-[1400px]:flex-row min-[1400px]:items-center min-[1400px]:justify-between min-[1400px]:gap-3">
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setActiveTab('legenda')}
                    className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
                      activeTab === 'legenda' ? 'border-[var(--accent,#2e6e62)] text-[var(--accent,#2e6e62)]' : 'border-transparent text-[var(--ink-soft,#45524f)]'
                    }`}
                  >
                    Legenda
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('storitve')}
                    className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
                      activeTab === 'storitve' ? 'border-[var(--accent,#2e6e62)] text-[var(--accent,#2e6e62)]' : 'border-transparent text-[var(--ink-soft,#45524f)]'
                    }`}
                  >
                    Storitve po zobeh
                  </button>
                </div>
                {activeTab === 'legenda' && (
                  <div className="mb-2 flex flex-wrap items-center gap-2 min-[1400px]:flex-none min-[1400px]:flex-nowrap">
                    {selection.length > 0 ? (
                      <>
                        <span className="text-xs text-[var(--ink,#1c2624)]">
                          <strong>{selection.length}</strong> {selection.length === 1 ? 'izbrana ploskev/zob' : 'izbranih'} — kliknite status za uporabo.
                        </span>
                        <button
                          type="button"
                          onClick={handleClearSelection}
                          className="flex-none rounded border border-[var(--line,#ccd6d4)] px-2 py-1 text-xs text-[var(--ink-soft,#45524f)]"
                        >
                          Prekliči izbiro (Esc)
                        </button>
                      </>
                    ) : (
                      <span className="text-right text-xs text-[var(--ink-soft,#45524f)]">
                        Kliknite ploskev ali cel zob na karti (Ctrl/Cmd za več), nato status spodaj za uporabo.
                      </span>
                    )}
                  </div>
                )}
              </div>

              {activeTab === 'legenda' && (
                <StatusToolbar
                  bare
                  hideHeader
                  className="w-full"
                  selectionCount={selection.length}
                  onStatusClick={handleStatusClick}
                  onClearSelection={handleClearSelection}
                  onTogglePost={handleTogglePost}
                  onSetEndoStage={handleSetEndoStage}
                  bridgeMessage={bridgeMessage}
                />
              )}

              {activeTab === 'storitve' && (
                <div className="max-h-[220px] overflow-y-auto">
                  {!selectedFdi ? (
                    <p className="text-sm italic text-[var(--muted,#6f7c79)]">Kliknite zob na karti zgoraj, da vidite kronološko zgodovino storitev.</p>
                  ) : (
                    <StoritvePoZobehTab patientId={patientId} fdi={selectedFdi} />
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ---- Right column: Frame 5 (appointment, placeholder) + Frame 3 (Rentgeni tabs, placeholder) ---- */}
          <div className="order-3 hidden flex-col gap-3 min-[1400px]:flex">
            <div className="rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-4">{appointmentCardContent}</div>
            <div className="flex h-[589px] flex-col rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-4">{rentgeniCardContent}</div>
          </div>
        </div>

        {selectedFdi && (
          <div className="px-3">
            <ToothDetailPanel
              key={selectedFdi}
              patientId={patientId}
              fdi={selectedFdi}
              surfaces={surfacesByFdi[selectedFdi]}
              notes={notesByFdi[selectedFdi]}
              onSurfaceStatusChange={(surface, status) => handleSurfaceStatusChange(selectedFdi, surface, status)}
              onWholeToothStatusChange={(status) => handleWholeToothStatusChange(selectedFdi, status)}
              onNotesChange={(text) => setNotesByFdi((prev) => ({ ...prev, [selectedFdi]: text }))}
            />
          </div>
        )}

        {rtgGalleryOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={() => setRtgGalleryOpen(false)}>
            <div className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-md bg-[var(--surface,#fff)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-bold text-[var(--ink,#1c2624)]">RTG galerija</h2>
                <button type="button" onClick={() => setRtgGalleryOpen(false)} className="text-[var(--ink-soft,#45524f)] hover:text-[var(--accent,#2e6e62)]">
                  ✕
                </button>
              </div>
              <p className="mb-4 text-sm italic text-[var(--muted,#6f7c79)]">Mockup — tu bo prikazana celotna RTG galerija pacienta.</p>
              <div className="grid grid-cols-2 gap-3">
                {MOCK_RTG_GALLERY.map((img, i) => (
                  <div key={i} className="flex flex-col gap-1">
                    <div className="flex aspect-[4/3] w-full items-center justify-center rounded-md bg-[#e7e7e7] text-xs text-[var(--muted,#6f7c79)]">{img.opis}</div>
                    <span className="text-xs text-[var(--muted,#6f7c79)]">{img.date}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {appointmentModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={() => setAppointmentModalOpen(false)}>
            <div className="w-full max-w-md rounded-md bg-[var(--surface,#fff)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-bold text-[var(--ink,#1c2624)]">{nextAppointment ? 'Prestavi termin' : 'Naroči naslednji termin'}</h2>
                <button type="button" onClick={() => setAppointmentModalOpen(false)} className="text-[var(--ink-soft,#45524f)] hover:text-[var(--accent,#2e6e62)]">
                  ✕
                </button>
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex gap-3">
                  <label className="flex flex-1 flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
                    Datum
                    <input
                      type="date"
                      value={appointmentDate}
                      onChange={(e) => setAppointmentDate(e.target.value)}
                      className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]"
                    />
                  </label>
                  <label className="flex flex-1 flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
                    Ura
                    <input
                      type="time"
                      value={appointmentTime}
                      onChange={(e) => setAppointmentTime(e.target.value)}
                      className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]"
                    />
                  </label>
                  <label className="flex flex-1 flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
                    Trajanje
                    <select
                      value={appointmentDuration}
                      onChange={(e) => setAppointmentDuration(Number(e.target.value))}
                      className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]"
                    >
                      {[15, 30, 45, 60, 90].map((m) => (
                        <option key={m} value={m}>
                          {m} min
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="flex flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
                  Predvidena storitev
                  <input
                    value={appointmentService}
                    onChange={(e) => setAppointmentService(e.target.value)}
                    placeholder="npr. Pregled + čiščenje"
                    className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]"
                  />
                </label>
                {nextAppointment && (
                  <label className="flex flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
                    Status
                    <select
                      value={appointmentStatus}
                      onChange={(e) => setAppointmentStatus(e.target.value as AppointmentStatus)}
                      className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]"
                    >
                      {(Object.keys(APPOINTMENT_STATUS_META) as AppointmentStatus[]).map((s) => (
                        <option key={s} value={s}>
                          {APPOINTMENT_STATUS_META[s].label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {appointmentModalError && <p className="text-sm text-[var(--danger,#b3261e)]">Napaka: {appointmentModalError}</p>}
                <button
                  type="button"
                  onClick={handleSaveAppointment}
                  disabled={appointmentModalSaving}
                  className="self-start rounded-full bg-[var(--accent,#2e6e62)] px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
                >
                  {appointmentModalSaving ? 'Shranjujem …' : nextAppointment ? 'Shrani spremembe' : 'Ustvari termin'}
                </button>
              </div>
            </div>
          </div>
        )}

        {selectedInvoice && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={() => setSelectedInvoice(null)}>
            <div className="w-full max-w-md rounded-md bg-[var(--surface,#fff)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-bold text-[var(--ink,#1c2624)]">Račun {selectedInvoice.id}</h2>
                <button type="button" onClick={() => setSelectedInvoice(null)} className="text-[var(--ink-soft,#45524f)] hover:text-[var(--accent,#2e6e62)]">
                  ✕
                </button>
              </div>
              <div className="flex flex-col gap-2 text-sm text-[var(--ink,#1c2624)]">
                <div><span className="font-semibold">Datum: </span>{selectedInvoice.date}</div>
                <div><span className="font-semibold">Storitev: </span>{selectedInvoice.storitev}</div>
                <div><span className="font-semibold">Znesek: </span>{selectedInvoice.amount.toFixed(2)} €</div>
                <div><span className="font-semibold">Status: </span>{selectedInvoice.paid ? 'Plačano' : 'Neplačano'}</div>
              </div>
              <p className="mt-4 text-xs italic text-[var(--muted,#6f7c79)]">Mockup — tu bo celoten podroben pregled računa.</p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// "Storitve po zobeh" tab (Frame 7) — a quick, read-only glance at one
// tooth's real chronological history, using the same useToothHistory.ts
// hook and describeToothRecord() formatting ToothDetailPanel.tsx's own
// "Zgodovina" tab uses, so the two can never disagree. Deliberately a
// separate component (not inlined in the parent's JSX) so the hook only
// ever runs while this tab is actually the one being looked at.
function StoritvePoZobehTab({ patientId, fdi }: { patientId: string; fdi: string }) {
  const { entries, loading, error } = useToothHistory(patientId, fdi);
  if (loading) return <p className="text-sm text-[var(--ink-soft,#45524f)]">Nalaganje …</p>;
  if (error) return <p className="text-sm text-[var(--danger,#b3261e)]">Napaka pri nalaganju: {error}</p>;

  const rows = entries.flatMap((entry) =>
    describeToothRecord(entry, fdi).map((line) => ({ date: entry.date, line }))
  );
  if (rows.length === 0) {
    return <p className="text-sm italic text-[var(--muted,#6f7c79)]">Ni zabeleženih storitev za ta zob.</p>;
  }
  return (
    <div>
      <h3 className="mb-2 font-semibold text-[var(--ink,#1c2624)]">Zob {fdi}</h3>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row, i) => (
          <li key={i} className="flex gap-3 text-sm text-[var(--ink,#1c2624)]">
            <span className="w-24 flex-none font-mono text-xs text-[var(--muted,#6f7c79)]">{formatSlovenianDate(row.date)}</span>
            <span>{row.line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
