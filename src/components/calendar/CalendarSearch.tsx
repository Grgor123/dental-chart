import { useState } from 'react';
import type { PatientListItem } from '../../hooks/usePatients';
import { useAppointmentSearch } from '../../hooks/useAppointmentSearch';
import type { AppointmentWithPatient } from '../../hooks/useAppointments';
import { APPOINTMENT_STATUS_META } from '../../lib/appointmentStatus';

interface CalendarSearchProps {
  patients: PatientListItem[];
  onSelectResult: (appointment: AppointmentWithPatient) => void;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('sl-SI', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

// Cross-date search by patient name — results list the same way Google
// Calendar's own search results do: date + time + title (here, patient +
// service) per row. The mockup shows a persistently visible search box
// (input + icon inline), not a click-to-expand icon, so this renders that
// way directly rather than toggling open/closed.
export function CalendarSearch({ patients, onSelectResult }: CalendarSearchProps) {
  const [query, setQuery] = useState('');
  const { results, loading } = useAppointmentSearch(query, patients);

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-full border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] px-3 py-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Iskanje po pacientu …"
          className="w-48 text-sm text-[var(--ink,#1c2624)] outline-none"
        />
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="flex-none text-[var(--ink-soft,#45524f)]">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      </div>

      {query.trim() && (
        // z-30, matching ViewSwitcher's own dropdown in Calendar.tsx — both
        // sit above TimeGrid's sticky header (z-20), which would otherwise
        // win ties by DOM order and paint over either dropdown.
        <ul className="absolute right-0 top-full z-30 mt-1 flex max-h-80 w-80 flex-col gap-0.5 overflow-y-auto rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-1.5 shadow-lg">
          {loading && <li className="p-2 text-sm text-[var(--ink-soft,#45524f)]">Iskanje …</li>}
          {!loading && results.length === 0 && <li className="p-2 text-sm text-[var(--muted,#6f7c79)]">Ni zadetkov.</li>}
          {results.map((appt) => (
            <li key={appt.id}>
              <button
                type="button"
                onClick={() => {
                  onSelectResult(appt);
                  setQuery('');
                }}
                className="flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left hover:bg-[var(--bg,#eef2f1)]"
              >
                <span className="text-xs text-[var(--muted,#6f7c79)]">{formatDateTime(appt.startsAt)}</span>
                <span className="text-sm font-medium text-[var(--ink,#1c2624)]">
                  {appt.patientLastName} {appt.patientFirstName}
                </span>
                <span className="flex items-center gap-2 text-xs text-[var(--ink-soft,#45524f)]">
                  {appt.service && <span className="truncate">{appt.service}</span>}
                  <span className={`flex-none rounded-full px-2 py-0.5 font-semibold ${APPOINTMENT_STATUS_META[appt.status].pillClass}`}>
                    {APPOINTMENT_STATUS_META[appt.status].label}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
