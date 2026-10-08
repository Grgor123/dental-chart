import { useEffect, useRef, useState } from 'react';

// The live A4 preview in the invoice editor, double-buffered.
//
// Every update is a whole new document (the invoice + the Paged.js layout
// library) that empties itself while it lays out its pages, so swapping it
// straight into the one visible frame showed a blank sheet during every
// re-layout — and a blank sheet for good if that layout never finished.
// Instead each update renders into a second frame UNDERNEATH the visible one
// and is only brought to the front once it reports "ready" (render.ts,
// previewId). If it doesn't within WATCHDOG_MS it is retried once, and then
// shown without page layout (one flowing page) with a note — never a blank
// box. The frame underneath stays "visible" to the browser (covered, not
// hidden), so its layout isn't throttled.

const DEBOUNCE_MS = 400;
/** Typing never postpones the preview by more than this. */
const MAX_WAIT_MS = 1500;
const WATCHDOG_MS = 6000;

export type RenderPreview = (options: { previewId: string; paged: boolean }) => string;

interface Pending {
  id: string;
  slot: 0 | 1;
  attempt: number;
  render: RenderPreview;
  lastError: string;
}

let previewCounter = 0;

export function InvoicePreview({ render, className }: { render: RenderPreview; className?: string }) {
  const [slots, setSlots] = useState<[string, string]>(['', '']);
  const [shown, setShown] = useState<0 | 1 | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const frames = [useRef<HTMLIFrameElement>(null), useRef<HTMLIFrameElement>(null)];
  const shownRef = useRef<0 | 1 | null>(null);
  const pending = useRef<Pending | null>(null);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstChangeAt = useRef<number | null>(null);

  function start(renderFn: RenderPreview, attempt: number) {
    if (watchdog.current) clearTimeout(watchdog.current);
    previewCounter += 1;
    const id = `p${previewCounter}`;
    const slot: 0 | 1 = shownRef.current === 0 ? 1 : 0;
    const lastError = attempt > 0 && pending.current ? pending.current.lastError : '';
    pending.current = { id, slot, attempt, render: renderFn, lastError };
    const html = renderFn({ previewId: id, paged: attempt < 2 });
    setSlots((prev) => (slot === 0 ? [html, prev[1]] : [prev[0], html]));
    watchdog.current = setTimeout(() => {
      const p = pending.current;
      if (!p || p.id !== id) return;
      if (p.attempt < 2) {
        start(p.render, p.attempt + 1);
      } else {
        pending.current = null;
        setProblem(`Predogleda ni bilo mogoče pripraviti${p.lastError ? ` (${p.lastError})` : ''}.`);
      }
    }, WATCHDOG_MS);
  }

  // Follow changes with a short debounce, but never wait longer than
  // MAX_WAIT_MS while edits keep coming; the very first one renders at once.
  useEffect(() => {
    const now = Date.now();
    const first = shownRef.current === null && !pending.current;
    firstChangeAt.current ??= now;
    const wait = first ? 0 : Math.max(0, Math.min(DEBOUNCE_MS, firstChangeAt.current + MAX_WAIT_MS - now));
    const timer = setTimeout(() => {
      firstChangeAt.current = null;
      start(render, 0);
    }, wait);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [render]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const data = e.data as { invoicePreview?: unknown; status?: unknown; message?: unknown } | null;
      const p = pending.current;
      if (!data || !p || data.invoicePreview !== p.id) return;
      if (e.source !== frames[p.slot].current?.contentWindow) return;
      if (data.status === 'error') {
        // Not fatal by itself (e.g. a harmless ResizeObserver notice) — kept
        // for the message if the watchdog gives up.
        p.lastError = String(data.message ?? '');
        return;
      }
      if (data.status !== 'ready') return;
      if (watchdog.current) clearTimeout(watchdog.current);
      pending.current = null;
      shownRef.current = p.slot;
      setShown(p.slot);
      setProblem(p.attempt >= 2 ? 'Predogled je prikazan brez razdelitve na strani (natisnjen račun bo razdeljen pravilno).' : null);
    }
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      if (watchdog.current) clearTimeout(watchdog.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-1">
      <div className={`relative overflow-hidden rounded-md border border-[var(--line,#ccd6d4)] bg-[#e9eeed] ${className ?? ''}`}>
        {([0, 1] as const).map((slot) => (
          <iframe
            key={slot}
            ref={frames[slot]}
            title={slot === shown ? 'Predogled računa' : 'Priprava predogleda'}
            aria-hidden={slot !== shown}
            srcDoc={slots[slot]}
            // No sandbox on purpose: a sandboxed (cross-origin) frame runs in its
            // own process, and Chrome then sometimes doesn't repaint it after a tab
            // switch — the preview stayed grey until something forced a redraw. The
            // document is our own render.ts output with every value escaped.
            className="absolute inset-0 h-full w-full border-0"
            style={{ zIndex: slot === shown ? 2 : 1, pointerEvents: slot === shown ? 'auto' : 'none' }}
          />
        ))}
        {shown === null && (
          <div className="absolute inset-0 z-[3] flex items-center justify-center bg-[#e9eeed] text-sm text-[var(--ink-soft,#45524f)]">
            {problem ?? 'Pripravljam predogled …'}
          </div>
        )}
      </div>
      {problem && shown !== null && <p className="text-xs text-[var(--danger,#b3261e)]">{problem}</p>}
    </div>
  );
}
