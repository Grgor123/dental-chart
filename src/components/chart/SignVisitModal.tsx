import { useState } from 'react';

interface SignVisitModalProps {
  /** e.g. "12. 11. 2026" */
  dateLabel: string;
  /** What the chart recorded in this visit ("Zob 36: …"). */
  items: string[];
  itemsLoading: boolean;
  initialNote: string;
  onSign: (note: string) => Promise<{ error?: string }>;
  onClose: () => void;
}

// "Podpiši obisk" (migration 056): the visit record text plus what the chart
// recorded, signed by the logged-in user. After signing, nothing of the visit
// can change — corrections are added as an addendum (Frame 8).
export function SignVisitModal({ dateLabel, items, itemsLoading, initialNote, onSign, onClose }: SignVisitModalProps) {
  const [note, setNote] = useState(initialNote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const empty = items.length === 0 && !note.trim();

  async function handleSign() {
    setBusy(true);
    setError(null);
    const result = await onSign(note);
    setBusy(false);
    if (result.error) setError(result.error);
    else onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={busy ? undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Podpiši obisk"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-xl flex-col gap-4 overflow-y-auto rounded-md bg-[var(--surface,#fff)] p-5 shadow-xl"
      >
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink,#1c2624)]">Podpiši obisk — {dateLabel}</h2>
          <p className="mt-1 text-xs text-[var(--muted,#6f7c79)]">
            Po podpisu obiska ni več mogoče spreminjati — popravke dodate kot dopolnilo, ki ostane vidno.
          </p>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-[var(--ink,#1c2624)]">Vpisano v karto</h3>
          {itemsLoading ? (
            <p className="mt-1 text-sm text-[var(--ink-soft,#45524f)]">Nalaganje …</p>
          ) : items.length === 0 ? (
            <p className="mt-1 text-sm italic text-[var(--muted,#6f7c79)]">V tem obisku v karto ni bilo vpisano nič.</p>
          ) : (
            <ul className="mt-1 flex max-h-48 flex-col gap-0.5 overflow-y-auto text-sm text-[var(--ink,#1c2624)]">
              {items.map((item, i) => (
                <li key={i}>• {item}</li>
              ))}
            </ul>
          )}
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-[var(--ink,#1c2624)]">Zapis obiska</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={6}
            autoFocus
            placeholder="Anamneza, izvid, opravljeno, anestezija, material, navodila …"
            className="w-full rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-sm text-[var(--ink,#1c2624)]"
          />
        </label>

        {error && <p className="text-sm text-[var(--danger,#b3261e)]">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-sm text-[var(--ink,#1c2624)] hover:bg-[#f7faf9]"
          >
            Prekliči
          </button>
          <button
            type="button"
            onClick={handleSign}
            disabled={busy || empty || itemsLoading}
            title={empty ? 'Obisk nima vpisov — dodajte zapis obiska.' : undefined}
            className="rounded bg-[var(--accent,#2e6e62)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Podpisujem …' : 'Podpiši'}
          </button>
        </div>
      </div>
    </div>
  );
}
