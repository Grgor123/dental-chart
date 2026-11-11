import type { AppointmentStatus } from '../hooks/useAppointments';

// Shared between Calendar.tsx and PatientChart.tsx's Frame 5 so the same
// status can never render with two different labels/colors depending on
// which page you're looking at it from.
export const APPOINTMENT_STATUS_META: Record<AppointmentStatus, { label: string; pillClass: string }> = {
  scheduled: { label: 'Naročen', pillClass: 'bg-[#9CA3AF] text-white' },
  sent: { label: 'Poslano', pillClass: 'bg-[#F5A623] text-white' },
  confirmed: { label: 'Potrjen', pillClass: 'bg-[#4CAF50] text-white' },
  completed: { label: 'Opravljen', pillClass: 'bg-[#4C7093] text-white' },
  cancelled: { label: 'Odpovedan', pillClass: 'bg-[#e0231c] text-white' },
  no_show: { label: 'Ni se zglasil/-a', pillClass: 'bg-[#F5A623] text-white' },
};

export const APPOINTMENT_STATUS_ORDER: AppointmentStatus[] = ['scheduled', 'sent', 'confirmed', 'completed', 'no_show', 'cancelled'];

// Grid-chip-only badge treatment (Calendar.tsx's day/week grid) — Frame 5's
// plain status pill never shows these, only the label/color above. Green
// tick = confirmed, red cross = declined (Gregor, 2026-11-10 — both used to
// be red); an empty circle = the reminder email with the confirm link went
// out (or status "Poslano"); a blue centre = still no answer, so the 14:00
// SMS went out too — shows the SMS were sent. Colours in AppointmentChip.tsx.
export function appointmentBadge(
  status: AppointmentStatus,
  reminder: 'email' | 'sms' | null = null
): 'tick' | 'cross' | 'pending' | 'pending-sms' | null {
  if (status === 'confirmed') return 'tick';
  if (status === 'cancelled') return 'cross';
  if (status !== 'scheduled' && status !== 'sent') return null;
  if (reminder === 'sms') return 'pending-sms';
  if (reminder === 'email' || status === 'sent') return 'pending';
  return null;
}

// Grid-chip-only style treatment: a sent-but-not-yet-confirmed appointment
// gets a dashed chip border. A cancelled ("declined") appointment used to
// also render blurred/dimmed here — removed per Gregor's explicit
// request: it should look like any other chip, with the cross badge
// (appointmentBadge above) alone marking it declined.
export function appointmentChipStyle(status: AppointmentStatus): { dashed: boolean } {
  return { dashed: status === 'sent' };
}
