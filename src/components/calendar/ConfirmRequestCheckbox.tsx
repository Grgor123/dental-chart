// "Pošlji e-pošto in SMS za potrditev termina" (Gregor, 2026-11-11) — for
// phone bookings and rebooked patients whose appointment is too close for the
// regular reminders (email 2 days before at 09:00, SMS at 14:00). Ticked, the
// save sets appointments.confirm_requested_at (migration 055): the reminder
// email with the "Pridem / Ne pridem" link goes out at once, the SMS 2 hours
// later if still unanswered. Shared by Koledar's and the patient record's
// booking windows.

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()}. ${d.getMonth() + 1}. ob ${d.toLocaleTimeString('sl-SI', { hour: '2-digit', minute: '2-digit' })}`;
}

export function ConfirmRequestCheckbox({
  checked,
  onChange,
  lastRequestedAt,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** When it was last asked for this appointment, if ever. */
  lastRequestedAt?: string | null;
}) {
  return (
    <label className="flex items-start gap-2 text-sm text-[var(--ink,#1c2624)]">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        Pošlji e-pošto in SMS za potrditev termina
        <span className="block text-xs text-[var(--muted,#6f7c79)]">
          E-pošta s povezavo »Pridem / Ne pridem« gre takoj ob shranjevanju, SMS čez 2 uri, če pacient ne odgovori (SMS le med 8. in 20. uro
          in s soglasjem za SMS).
          {lastRequestedAt && ` Zadnjič poslano ${formatWhen(lastRequestedAt)}.`}
        </span>
      </span>
    </label>
  );
}
