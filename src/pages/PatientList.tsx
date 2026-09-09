import { useMemo, useState, type FormEvent } from 'react';
import PhoneInput from 'react-phone-number-input';
import 'react-phone-number-input/style.css';
import { usePatients } from '../hooks/usePatients';
import type { Patient } from '../types/dental';

interface PatientListProps {
  onSelectPatient: (patientId: string, label: string) => void;
  onSignOut: () => void;
}

// Formats a patient's own display label consistently everywhere it's
// needed (this list's rows, and PatientChart.tsx's header once a patient
// is selected) — "Priimek Ime" (surname first, the order Slovenian medical
// records conventionally sort/display by), matching this list's own
// last-name-first sort order from usePatients.ts.
function patientLabel(p: { firstName: string; lastName: string }): string {
  return `${p.lastName} ${p.firstName}`;
}

function formatDob(dob: string): string {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return dob;
  return d.toLocaleDateString('sl-SI');
}

function ageFromDob(dob: string): number | null {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const hasHadBirthdayThisYear = now.getMonth() > d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() >= d.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

// Only 'M'/'F' are offered — per Monika's explicit request, no 'other'
// option (see Patient['sex'] in types/dental.ts). A patient with no sex
// recorded yet (null — see PatientListItem in usePatients.ts) isn't in
// this map at all; that case is handled inline where it's rendered below.
const SEX_LABELS: Record<Patient['sex'], string> = { M: 'M', F: 'Ž' };

// Landing page after login: search/pick an existing patient, or add a new
// one — the app's actual entry point now that PatientChart.tsx no longer
// hardcodes one seeded test patient/visit (see CLAUDE.md's "Visit
// lifecycle" and "Current Status & Next Steps"). Selecting a patient hands
// their id up to App.tsx, which resolves/creates their open visit
// (useOpenVisit.ts) before mounting PatientChart.
export function PatientList({ onSelectPatient, onSignOut }: PatientListProps) {
  const { patients, loading, error, createPatient } = usePatients();
  const [query, setQuery] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter((p) => patientLabel(p).toLowerCase().includes(q));
  }, [patients, query]);

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-5 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--ink,#1c2624)]">Pacienti</h1>
          <p className="mt-1.5 text-sm text-[var(--ink-soft,#45524f)]">Izberite pacienta ali dodajte novega.</p>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          className="rounded border border-[var(--line,#ccd6d4)] px-3 py-1.5 text-sm text-[var(--ink-soft,#45524f)]"
        >
          Odjava
        </button>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Iskanje po imenu ali priimku …"
          className="flex-1 rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-sm text-[var(--ink,#1c2624)]"
        />
        <button
          type="button"
          onClick={() => setShowNewForm((v) => !v)}
          className="rounded bg-[var(--accent,#2e6e62)] px-3 py-2 text-sm font-medium text-white"
        >
          {showNewForm ? 'Prekliči' : '+ Nov pacient'}
        </button>
      </div>

      {showNewForm && (
        <NewPatientForm
          onCreated={(patientId, label) => {
            setShowNewForm(false);
            onSelectPatient(patientId, label);
          }}
          createPatient={createPatient}
        />
      )}

      {loading && <p className="text-sm text-[var(--ink-soft,#45524f)]">Nalaganje …</p>}
      {error && <p className="text-sm text-[var(--danger,#b3261e)]">Napaka pri nalaganju: {error}</p>}

      {!loading && !error && (
        <ul className="flex flex-col gap-1.5">
          {filtered.length === 0 && (
            <li className="rounded border border-dashed border-[var(--line,#ccd6d4)] p-4 text-center text-sm text-[var(--muted,#6f7c79)]">
              {patients.length === 0 ? 'Ni še nobenega pacienta.' : 'Ni zadetkov za to iskanje.'}
            </li>
          )}
          {filtered.map((p) => {
            const age = ageFromDob(p.dob);
            return (
              <li key={p.patientId}>
                <button
                  type="button"
                  onClick={() => onSelectPatient(p.patientId, patientLabel(p))}
                  className="flex w-full items-center justify-between gap-4 rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] px-4 py-3 text-left hover:border-[var(--accent,#2e6e62)]"
                >
                  <span className="flex flex-col">
                    <span className="font-medium text-[var(--ink,#1c2624)]">{patientLabel(p)}</span>
                    {p.phone && <span className="text-xs text-[var(--muted,#6f7c79)]">{p.phone}</span>}
                  </span>
                  <span className="flex items-center gap-3 text-xs text-[var(--muted,#6f7c79)]">
                    <span>
                      {formatDob(p.dob)}
                      {age != null && ` (${age} let)`}
                    </span>
                    <span>{p.sex ? SEX_LABELS[p.sex] : '—'}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface NewPatientFormProps {
  createPatient: (input: {
    firstName: string;
    lastName: string;
    dob: string;
    sex?: Patient['sex'];
    phone?: string;
    email?: string;
    address?: string;
    postalCode?: string;
    city?: string;
    healthCardNumber?: string;
  }) => Promise<{ patientId: string } | { error: string }>;
  onCreated: (patientId: string, label: string) => void;
}

// First/last name and date of birth are the only three the `patients`
// table actually requires not-null; sex, phone, email, address, and the
// ZZZS health-card number are all optional here — captured when known, but
// nothing blocks opening a chart without them. Diagnoses and everything
// else on the full `Patient` type are left for the chart itself / a future
// patient-detail view, not this quick-add form. There's no edit flow yet
// either — once a patient's created, these fields aren't shown again
// anywhere but the list row's own phone number (see PatientList above).
function NewPatientForm({ createPatient, onCreated }: NewPatientFormProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [sex, setSex] = useState<'' | Patient['sex']>('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [city, setCity] = useState('');
  const [healthCardNumber, setHealthCardNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    const result = await createPatient({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      dob,
      sex: sex || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      address: address.trim() || undefined,
      postalCode: postalCode.trim() || undefined,
      city: city.trim() || undefined,
      healthCardNumber: healthCardNumber.trim() || undefined,
    });
    setSubmitting(false);
    if ('error' in result) {
      setFormError(result.error);
      return;
    }
    onCreated(result.patientId, `${lastName.trim()} ${firstName.trim()}`);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-4"
    >
      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
          Ime
          <input
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
          Priimek
          <input
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]"
          />
        </label>
      </div>
      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
          Datum rojstva
          <input
            type="date"
            required
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
          Spol
          <select
            value={sex}
            onChange={(e) => setSex(e.target.value as '' | Patient['sex'])}
            className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]"
          >
            <option value="">Neznano</option>
            <option value="F">Ženski</option>
            <option value="M">Moški</option>
          </select>
        </label>
      </div>
      <div className="flex gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
          Telefon
          {/* Same component/config as the sibling "dental calendar" booking
              app's own intake form (see its CLAUDE.md's "Patient data on
              Calendar events") — country flag/dial-code dropdown, defaults
              to Slovenia, emits an E.164 string directly. Deliberately NOT
              `required` here, unlike that form: a phone number there gates
              an online booking submission, but here it's just one optional
              field on an otherwise-already-valid patient record. */}
          <PhoneInput defaultCountry="SI" value={phone} onChange={(value) => setPhone(value ?? '')} />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
          E-pošta
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]"
          />
        </label>
      </div>
      {/* Address split into three fields (street, postal code, city) rather
          than one free-text line — per Monika's explicit request. The
          sibling "dental calendar" booking app has no address field at all
          to match conventions against (see NewPatientFormProps' own
          comment), so this arrangement is this app's own. Naslov spans the
          full form width on its own row (a street address needs the room);
          the row below splits into the same left-half/right-half as every
          row above (Ime/Priimek, Datum rojstva/Spol, Telefon/E-pošta) — per
          Monika's explicit follow-up request that Št. zdravstvene kartice
          land in that same right-column position — with Poštna št./Kraj
          sharing the left half between them, since neither needs a full
          half-width field to itself. */}
      <label className="flex flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
        Naslov
        <input
          placeholder="Ulica in hišna številka"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]"
        />
      </label>
      <div className="flex gap-3">
        <div className="flex flex-1 gap-3">
          <label className="flex flex-1 flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
            Poštna št.
            <input
              inputMode="numeric"
              placeholder="1000"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
            Kraj
            <input
              placeholder="Ljubljana"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]"
            />
          </label>
        </div>
        <label className="flex flex-1 flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
          Št. zdravstvene kartice
          {/* A 9-digit number, per Monika's explicit spec — digits only
              (anything else typed/pasted is stripped, not just rejected on
              submit), capped at 9 characters, with `pattern` as a backstop
              so a partially-typed number (fewer than 9 digits) still blocks
              submission via the browser's own validation rather than
              saving a truncated value silently. */}
          <input
            inputMode="numeric"
            pattern="\d{9}"
            maxLength={9}
            placeholder="9-mestna številka"
            value={healthCardNumber}
            onChange={(e) => setHealthCardNumber(e.target.value.replace(/\D/g, '').slice(0, 9))}
            className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]"
          />
        </label>
      </div>
      {formError && <p className="text-sm text-[var(--danger,#b3261e)]">Napaka: {formError}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="self-start rounded bg-[var(--accent,#2e6e62)] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {submitting ? 'Dodajanje …' : 'Dodaj in odpri karto'}
      </button>
    </form>
  );
}
