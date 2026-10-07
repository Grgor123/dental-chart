import type { ReactNode } from 'react';

interface ConfirmDialogProps {
  children: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  /** Defaults to "Da". */
  confirmLabel?: string;
}

// A "do you really want to …?" safety fuse with Prekliči / Da — clicking the
// backdrop counts as Prekliči. Cancel gets focus so a stray Enter is harmless.
// Used by the price list (delete category / archive service) and invoicing
// (issue / storno).
export function ConfirmDialog({ children, onCancel, onConfirm, confirmLabel = 'Da' }: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-4 rounded-md bg-[var(--surface,#fff)] p-5 text-left shadow-xl"
      >
        <div className="whitespace-normal text-sm text-[var(--ink,#1c2624)]">{children}</div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="rounded border border-[var(--line,#ccd6d4)] px-3 py-2 text-sm text-[var(--ink,#1c2624)] hover:bg-[#f7faf9]"
          >
            Prekliči
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded bg-[var(--danger,#b3261e)] px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
