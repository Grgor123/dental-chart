import type { CSSProperties, MouseEvent } from 'react';
import type { AppointmentWithPatient } from '../../hooks/useAppointments';
import { appointmentBadge, appointmentChipStyle } from '../../lib/appointmentStatus';

interface AppointmentChipProps {
  appointment: AppointmentWithPatient;
  /** Therapist color (or undefined for "Neuvrščeno" — falls back to a
      neutral grey so an unassigned appointment still reads as a chip, not
      a blank box). */
  color?: string;
  style: CSSProperties;
  onClick: (e: MouseEvent) => void;
}

const NEUTRAL_COLOR = '#9CA3AF';
// Both the confirmed tick and the declined cross render in this same red,
// per Gregor's explicit instruction — shape (not color) is what tells the
// two apart on this chart. Reuses the exact red already used for the
// "Odpovedan" status pill (appointmentStatus.ts) so this reads as the same
// color language as the rest of the app, not a separate ad-hoc shade.
const BADGE_RED = '#e0231c';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' });
}

export function AppointmentChip({ appointment, color, style, onClick }: AppointmentChipProps) {
  const badge = appointmentBadge(appointment.status);
  const { dashed } = appointmentChipStyle(appointment.status);
  const accent = color || NEUTRAL_COLOR;
  const title = `${formatTime(appointment.startsAt)}–${formatTime(appointment.endsAt)} ${appointment.patientLastName} ${appointment.patientFirstName}${
    appointment.service ? ` — ${appointment.service}` : ''
  }`;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        ...style,
        backgroundColor: accent,
        borderColor: accent,
        borderStyle: dashed ? 'dashed' : 'solid',
      }}
      className="absolute overflow-hidden rounded-md border px-1.5 py-0.5 text-left text-[11px] leading-tight text-[var(--ink,#1c2624)] shadow-sm"
    >
      {badge && (
        <span
          className="absolute right-0.5 top-0.5 flex h-3.5 w-3.5 flex-none items-center justify-center rounded-full bg-white text-[9px] font-bold leading-none"
          style={{ color: BADGE_RED }}
        >
          {badge === 'tick' ? '✓' : '✕'}
        </span>
      )}
      <span className="block truncate pr-3.5 font-semibold">
        {appointment.patientLastName} {appointment.patientFirstName}
      </span>
      <span className="block truncate pr-3.5">
        {formatTime(appointment.startsAt)}–{formatTime(appointment.endsAt)}
      </span>
      {appointment.service && <span className="block truncate pr-3.5 text-[10px] text-[var(--ink-soft,#45524f)]">{appointment.service}</span>}
    </button>
  );
}
