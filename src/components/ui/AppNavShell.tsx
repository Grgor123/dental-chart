// Nav shell: visual only, no real routing except the links that actually go
// somewhere (Domov, Koledar, Storitve, E-pošta — see below) — colors/positions
// pixel-matched off the original design mockup's own header bars (#5CE1E6
// turquoise, #C8D1D9 grey "active" pill, both sampled directly off the
// rendered mockup). Rendered at the very top of every signed-in page
// (PatientList.tsx, PatientChart.tsx, Calendar.tsx, EmailTemplates.tsx) — see
// CLAUDE.md's "App Shell — top navigation frame" section for the full rule.
// Sporočila/Nastavitve stay fully inert everywhere, since neither feature
// exists yet.
//
// Shared between PatientPageMockup.tsx (dev-only, no props passed — stays
// fully inert/cosmetic, same as before) and the three real pages (each
// passes a real onSignOut so the Odjava button here actually works,
// replacing any page-local sign-out button; a real userLabel — the
// signed-in user's own practice name via usePracticeContext(), now that
// more than one practice can exist — supabase/migrations/
// 011_add_multi_tenancy.sql; a real onNavigateCalendar, once the native
// scheduling calendar existed for "Koledar" to actually go somewhere —
// supabase/migrations/013_add_appointments.sql; and a real onNavigateHome
// for "Domov", added alongside this file's app-wide rollout). The generic
// userLabel default below is only ever seen on the dev-only mockup, which
// has no session/practice to read from.
const SUBMENU_ITEMS = [
  { key: 'koledar', label: 'Koledar' },
  { key: 'storitve', label: 'Storitve' },
  { key: 'sporocila', label: 'Sporočila' },
  { key: 'eposta', label: 'E-pošta' },
  { key: 'nastavitve', label: 'Nastavitve' },
] as const;

type SubmenuKey = (typeof SUBMENU_ITEMS)[number]['key'];

interface AppNavShellProps {
  userLabel?: string;
  onSignOut?: () => void;
  /** Which submenu pill reads as "active" (the grey pill) — one per real
      page: 'storitve' for PatientList/PatientChart (the patient-record
      path, per Gregor's explicit request — Storitve is the dental-chart
      section), 'koledar' for Calendar.tsx (its own section, not nested
      under Storitve). Defaults to 'storitve' so the dev-only mockup and
      any caller that doesn't pass this keep the original look. */
  activeSubmenu?: SubmenuKey;
  /** "Domov" — takes the signed-in user back to the patient list from
      wherever they are (PatientChart/Calendar's own onBack). Omitted on
      the dev-only mockup and on PatientList itself (already home). */
  onNavigateHome?: () => void;
  /** "Koledar" becomes clickable when this is passed — jumps to
      Calendar.tsx. Omitted on the dev-only mockup, and on Calendar.tsx
      itself (already there — see activeSubmenu). */
  onNavigateCalendar?: () => void;
  /** "Storitve" becomes clickable when this is passed — jumps back to the
      patient list (the dental-chart section's own home). Only
      Calendar.tsx passes this (its own onBack, which already goes to the
      patient list) — PatientList/PatientChart have Storitve as their
      *active* pill already, so clicking it there would just be a no-op
      reload of where the user already is, same reasoning
      onNavigateCalendar is omitted on Calendar.tsx itself. Sporočila/
      E-pošta/Nastavitve stay inert everywhere regardless, since none of
      those features exist yet. */
  onNavigateStoritve?: () => void;
  /** "E-pošta" becomes clickable when this is passed — jumps to the email
      template editor (EmailTemplates.tsx). Omitted on the dev-only mockup,
      and on EmailTemplates.tsx itself (already there). */
  onNavigateEmail?: () => void;
}

export function AppNavShell({
  userLabel = 'Uporabnik',
  onSignOut,
  activeSubmenu = 'storitve',
  onNavigateHome,
  onNavigateCalendar,
  onNavigateStoritve,
  onNavigateEmail,
}: AppNavShellProps) {
  return (
    <div className="flex w-full flex-col">
      <div className="flex items-center justify-between bg-[#5CE1E6] px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onNavigateHome}
            className="rounded-full px-3 py-1 text-sm font-medium text-white hover:bg-white/10"
          >
            Domov
          </button>
          <button type="button" className="rounded-full bg-[#C8D1D9] px-3 py-1 text-sm font-semibold text-[var(--ink,#1c2624)]">
            CRM
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-white">Uporabnik: {userLabel}</span>
          <button
            type="button"
            onClick={onSignOut}
            aria-label="Odjava"
            className="flex h-7 w-7 flex-none items-center justify-center rounded bg-white text-[var(--ink,#1c2624)] hover:opacity-80"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </div>
      <div className="flex items-center gap-1 border-b border-[var(--line,#ccd6d4)] bg-white px-4 py-2">
        {SUBMENU_ITEMS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={
              key === 'koledar' && activeSubmenu !== 'koledar'
                ? onNavigateCalendar
                : key === 'storitve' && activeSubmenu !== 'storitve'
                  ? onNavigateStoritve
                  : key === 'eposta' && activeSubmenu !== 'eposta'
                    ? onNavigateEmail
                    : undefined
            }
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              key === activeSubmenu
                ? 'bg-[#C8D1D9] text-[var(--ink,#1c2624)]'
                : 'text-[var(--ink-soft,#45524f)] hover:text-[var(--accent,#2e6e62)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
