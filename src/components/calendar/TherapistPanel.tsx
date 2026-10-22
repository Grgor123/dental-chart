import type { Therapist } from '../../hooks/useTherapists';

interface TherapistPanelProps {
  therapists: Therapist[];
  hiddenIds: Set<string>;
  /** Calendar.tsx's chip-click cycle — only used for the tooltips here. */
  filter: { kind: 'all' } | { kind: 'only'; id: string } | { kind: 'except'; id: string };
  onToggleVisibility: (id: string) => void;
  /** Owners only: opens Nastavitve → Ekipa, where the team is managed
   *  (migration 046 — the old "+" add-therapist modal lived here). */
  onEditTeam?: () => void;
}

// Mockup shows each therapist as a solid-colored name chip (not a
// checkbox+dot row) in a two-column wrap grid. Clicking a chip cycles the
// calendar's filter (Gregor, 2026-10-22): only this therapist (outlined) →
// everyone except them (dimmed) → everyone.
export function TherapistPanel({ therapists, hiddenIds, filter, onToggleVisibility, onEditTeam }: TherapistPanelProps) {
  // What the next click on this chip does (see Calendar.tsx's toggleTherapistVisibility).
  function nextAction(id: string): string {
    if (filter.kind === 'only' && filter.id === id) return 'Skrij tega terapevta';
    if (filter.kind === 'except' && filter.id === id) return 'Prikaži vse terapevte';
    return 'Prikaži samo tega terapevta';
  }
  return (
    <div className="flex h-full flex-col gap-3 rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-[var(--ink,#1c2624)]">Terapevti:</h2>
        {onEditTeam && (
          <button
            type="button"
            onClick={onEditTeam}
            className="text-xs font-medium text-[var(--accent,#2e6e62)] hover:underline"
          >
            Uredi ekipo →
          </button>
        )}
      </div>
      {/* min-h-0 lets this shrink below its content's natural height
          inside the panel's own fixed h-full frame — without it, a 13"
          screen with many therapists would grow the whole panel (and the
          fixed-height calendar frame it sits beside) instead of scrolling
          internally. content-start keeps wrapped rows anchored to the top
          rather than centering in the leftover vertical space. */}
      <div className="flex min-h-0 flex-1 flex-wrap content-start gap-2 overflow-y-auto">
        {therapists.map((t) => {
          const hidden = hiddenIds.has(t.id);
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onToggleVisibility(t.id)}
              title={nextAction(t.id)}
              className="flex-none rounded-md px-3 py-1.5 text-sm font-semibold text-[var(--ink,#1c2624)]"
              style={{
                backgroundColor: t.color,
                opacity: hidden ? 0.35 : 1,
                outline: filter.kind === 'only' && filter.id === t.id ? '2px solid var(--ink, #1c2624)' : 'none',
                outlineOffset: 2,
              }}
            >
              {t.name}
            </button>
          );
        })}
        {therapists.length === 0 && (
          <span className="text-xs text-[var(--muted,#6f7c79)]">
            Ni terapevtov. {onEditTeam ? 'Dodate jih v Nastavitve → Ekipa.' : 'Doda jih lastnik ordinacije v Nastavitve → Ekipa.'}
          </span>
        )}
      </div>
      {therapists.length > 1 && (
        <p className="flex-none text-[11px] leading-snug text-[var(--muted,#6f7c79)]">
          Klik na terapevta: samo on · še enkrat: skrij ga · še enkrat: vsi
        </p>
      )}
    </div>
  );
}
