import type { CSSProperties, MouseEvent } from 'react';
import type { AppointmentWithPatient } from '../../hooks/useAppointments';
import { appointmentBadge, appointmentChipStyle } from '../../lib/appointmentStatus';
import { DONE_COLOR } from '../../data/statusStyles';
import { lightShade } from '../../lib/therapistColors';

interface AppointmentChipProps {
  appointment: AppointmentWithPatient;
  /** Therapist color (or undefined for "Nedodeljen" — falls back to a
      neutral grey so an unassigned appointment still reads as a chip, not
      a blank box). */
  color?: string;
  style: CSSProperties;
  onClick: (e: MouseEvent) => void;
}

const NEUTRAL_COLOR = '#9CA3AF';
// Confirmed = green tick, declined = red cross (Gregor, 2026-11-10 — both
// used to be the same red, told apart only by shape). The red is the
// "Odpovedan" pill's red (appointmentStatus.ts).
const BADGE_COLORS = { tick: '#1e8e3e', cross: '#e0231c' } as const;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' });
}

// Light shade of the therapist's colour with the full colour as a left
// stripe (Gregor, 2026-11-10 — solid dark colours were hard to read). First
// line: ✓/✕ badge, name, SPLETNO tag; then time and service. An appointment
// of 15 minutes or less has everything on one line.
export function AppointmentChip({ appointment, color, style, onClick }: AppointmentChipProps) {
  const badge = appointmentBadge(appointment.status, appointment.reminder ?? null);
  const { dashed } = appointmentChipStyle(appointment.status);
  const accent = color || NEUTRAL_COLOR;
  const minutes = (new Date(appointment.endsAt).getTime() - new Date(appointment.startsAt).getTime()) / 60000;
  const oneLine = minutes <= 15;
  const timeRange = `${formatTime(appointment.startsAt)}–${formatTime(appointment.endsAt)}`;
  const name = `${appointment.patientLastName} ${appointment.patientFirstName}`;
  const title = `${timeRange} ${name}${appointment.service ? ` — ${appointment.service}` : ''}${
    appointment.source === 'online' ? ' (spletno naročilo)' : ''
  }`;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        ...style,
        backgroundColor: lightShade(accent),
        borderColor: accent,
        borderStyle: dashed ? 'dashed' : 'solid',
        borderLeft: `3px solid ${accent}`,
      }}
      className="absolute overflow-hidden rounded-md border px-1.5 py-[3px] text-left text-[11px] leading-[12px] text-[var(--ink,#1c2624)] shadow-sm"
    >
      <span className="flex items-center gap-1">
        {badge === 'pending' && (
          <span className="h-3 w-3 flex-none rounded-full bg-white" title="Opomnik po e-pošti poslan — čakamo na odgovor" />
        )}
        {/* No answer by 14:00, SMS sent too — blue centre, the chart's
            "Plomba" blue (Gregor, 2026-11-11). */}
        {badge === 'pending-sms' && (
          <span
            className="flex h-3 w-3 flex-none items-center justify-center rounded-full bg-white"
            title="SMS opomnik poslan — čakamo na odgovor"
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: DONE_COLOR }} />
          </span>
        )}
        {(badge === 'tick' || badge === 'cross') && (
          <span
            className="flex h-3 w-3 flex-none items-center justify-center rounded-full bg-white text-[8px] font-bold leading-none"
            style={{ color: BADGE_COLORS[badge] }}
          >
            {badge === 'tick' ? '✓' : '✕'}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold">{name}</span>
          {oneLine && <span> · {timeRange}</span>}
        </span>
        {appointment.source === 'online' && (
          <span className="flex-none rounded bg-white/85 px-1 text-[8px] font-semibold uppercase leading-[11px] tracking-wide">spletno</span>
        )}
      </span>
      {!oneLine && <span className="block truncate">{timeRange}</span>}
      {!oneLine && appointment.service && (
        <span className="block truncate text-[10px] text-[var(--ink-soft,#45524f)]">{appointment.service}</span>
      )}
    </button>
  );
}
