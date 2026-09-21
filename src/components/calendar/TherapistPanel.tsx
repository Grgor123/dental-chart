import { useState, type FormEvent } from 'react';
import type { Therapist } from '../../hooks/useTherapists';

// Fixed palette rather than a raw color picker — keeps therapist colors
// visually distinct from each other and from the app's own accent/status
// colors at a glance. The first four match the approved mockup exactly
// (green/turquoise/tan/orange), so a practice's first few therapists land
// on the same colors Gregor signed off on.
const COLOR_PALETTE = ['#57d974', '#5ce1e6', '#eece9a', '#ff914d', '#9C6ADE', '#4C7093', '#B3261E', '#607D8B'];

interface TherapistPanelProps {
  therapists: Therapist[];
  hiddenIds: Set<string>;
  onToggleVisibility: (id: string) => void;
  onCreateTherapist: (name: string, color: string) => Promise<{ id: string } | { error: string }>;
}

// Mockup shows each therapist as a solid-colored name chip (not a
// checkbox+dot row) in a two-column wrap grid — clicking a chip toggles
// its own visibility in Day view (dimmed when hidden), since there's no
// separate checkbox in the design.
export function TherapistPanel({ therapists, hiddenIds, onToggleVisibility, onCreateTherapist }: TherapistPanelProps) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="flex h-full flex-col gap-3 rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold text-[var(--ink,#1c2624)]">Terapevti:</h2>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          aria-label="Dodaj terapevta"
          className="flex h-7 w-7 flex-none items-center justify-center rounded-full border border-[var(--line,#ccd6d4)] text-[var(--ink,#1c2624)] hover:border-[var(--accent,#2e6e62)]"
        >
          {/* An SVG cross centers exactly regardless of font metrics — a
              text "+" glyph sits off-center inside a circle in most fonts
              (its own glyph box isn't vertically symmetric around the cap
              the way a drawn cross is). */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
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
              title={hidden ? 'Prikaži v koledarju' : 'Skrij iz koledarja'}
              className="flex-none rounded-md px-3 py-1.5 text-sm font-semibold text-[var(--ink,#1c2624)]"
              style={{ backgroundColor: t.color, opacity: hidden ? 0.35 : 1 }}
            >
              {t.name}
            </button>
          );
        })}
        {therapists.length === 0 && <span className="text-xs text-[var(--muted,#6f7c79)]">Ni dodanih terapevtov.</span>}
      </div>

      {addOpen && <AddTherapistModal onCreate={onCreateTherapist} onClose={() => setAddOpen(false)} />}
    </div>
  );
}

interface AddTherapistModalProps {
  onCreate: (name: string, color: string) => Promise<{ id: string } | { error: string }>;
  onClose: () => void;
}

function AddTherapistModal({ onCreate, onClose }: AddTherapistModalProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLOR_PALETTE[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Vnesite ime terapevta.');
      return;
    }
    setSaving(true);
    setError(null);
    const result = await onCreate(name.trim(), color);
    setSaving(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-3 rounded-md bg-[var(--surface,#fff)] p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-[var(--ink,#1c2624)]">Dodaj terapevta</h3>
          <button type="button" onClick={onClose} className="text-[var(--ink-soft,#45524f)] hover:text-[var(--accent,#2e6e62)]">
            ✕
          </button>
        </div>
        <label className="flex flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
          Ime
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-[var(--ink,#1c2624)]"
          />
        </label>
        <div className="flex flex-col gap-1 text-sm text-[var(--ink-soft,#45524f)]">
          Barva
          <div className="flex flex-wrap gap-2">
            {COLOR_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={c}
                className="h-6 w-6 rounded-full"
                style={{ backgroundColor: c, outline: color === c ? '2px solid var(--ink, #1c2624)' : 'none', outlineOffset: 2 }}
              />
            ))}
          </div>
        </div>
        {error && <p className="text-sm text-[var(--danger,#b3261e)]">Napaka: {error}</p>}
        <button
          type="submit"
          disabled={saving}
          className="self-start rounded bg-[var(--accent,#2e6e62)] px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {saving ? 'Shranjujem …' : 'Dodaj'}
        </button>
      </form>
    </div>
  );
}
