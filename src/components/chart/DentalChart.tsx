import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { UPPER_LEFT, UPPER_RIGHT, LOWER_LEFT, LOWER_RIGHT } from '../../data/toothMeta';
import type { Surface, SurfaceMap, PocketDepths, GumMargin, BleedingPoints, EndoStage } from '../../types/dental';
import type { PerioPoint } from './perioStyle';
import { ArchRow } from './ArchRow';

interface DentalChartProps {
  /** Fires on every click inside a tooth's tloris square — see TlorisRow.tsx's own onSelect comment for why its value isn't threaded back down anywhere in this tree. */
  onSelect?: (fdi: string) => void;
  surfacesByFdi?: Record<string, SurfaceMap>;
  pocketsBuccal?: Record<string, PocketDepths>;
  pocketsLingual?: Record<string, PocketDepths>;
  /** Gum margin (buccal surface only, for now) — see PerioGraphRow. */
  gumMargin?: Record<string, GumMargin>;
  /** Bleeding on probing (BOP), one flag per mesial/mid/distal point. */
  bleedingBuccal?: Record<string, BleedingPoints>;
  bleedingLingual?: Record<string, BleedingPoints>;
  /** Which teeth show the dental-post line in the tloris view. */
  postByFdi?: Record<string, boolean>;
  /** Endodontic treatment (kanal) per tooth — independent of surfaces, see EndoStage. */
  endoByFdi?: Record<string, EndoStage>;
  /** Explicit fdi → bridge-group-id map — see BridgeRow.tsx's own prop comment and PatientChart.tsx's handleCreateBridge. Pure pass-through. */
  bridgeGroupByFdi?: Record<string, string>;
  /** Direct surface/whole-tooth click targeting — see ArchRow.tsx/TlorisRow.tsx/NumberRow.tsx. Pure pass-through. */
  onTargetClick?: (fdi: string, target: Surface | 'all', e: MouseEvent) => void;
  isTargetSelected?: (fdi: string, target: Surface | 'all') => boolean;
  /** Coarser than isTargetSelected: true if ANY target on this tooth is selected — drives the tloris square's outline and the FDI number's highlight together, so the two always agree. */
  isFdiSelected?: (fdi: string) => boolean;
  /** Pocket-depth/gum-margin click-to-focus entry — see PerioPoint (perioStyle.ts) and PatientChart.tsx. Pure pass-through. */
  onPerioPointClick?: (point: PerioPoint) => void;
  focusedPerioPoint?: PerioPoint | null;
  /**
   * Hides each arch's own "Zgornja čeljust — …"/"Spodnja čeljust — …" label
   * — per Gregor's explicit request on `PatientPageMockup.tsx` ("get rid of
   * text ... as this is obvious"), since which arch is which reads fine
   * from the tooth numbers alone once the page already knows it's showing
   * one patient's full chart. Defaults to false so PatientChart.tsx/
   * StatusShowcase.tsx keep the labels unchanged.
   */
  hideArchLabels?: boolean;
  /**
   * Tighter outer padding and inter-arch gap — per the same mockup request
   * to reclaim vertical/horizontal space so more of the surrounding page
   * fits without scrolling. Defaults to false (the original p-6/gap-8)
   * everywhere else.
   */
  compact?: boolean;
  /**
   * Instruction line rendered inside this card, above the arches — per
   * Gregor's explicit feedback on `PatientPageMockup.tsx` that the text
   * "belongs to the dental chart" and should sit inside its own bordered
   * frame rather than floating above it as a separate paragraph. Typed as
   * `ReactNode`, not `string` — the mockup's own usage needs a two-part
   * row (a dynamic "Kliknite na zob…"/"Izbran zob: …" message on the left,
   * a static perio-entry hint on the right, matching the SVG mockup's own
   * header row), not just plain text. Rendered outside the zoomed inner
   * wrapper below so it stays normal-sized regardless of `zoom: 1.3`.
   * Undefined (the default) renders nothing, so every other caller
   * (StatusShowcase.tsx, PatientChart.tsx) is unaffected.
   */
  instructionText?: ReactNode;
  /**
   * Scales the chart to exactly fill this card's own width, instead of the
   * fixed `zoom: 1.3` every other caller still uses — per Gregor's
   * explicit request to widen the chart to the full width of
   * `PatientPageMockup.tsx`'s own middle column (2fr of a 1:2:1 grid, so
   * its actual pixel width varies with viewport/monitor — a fixed zoom
   * can only ever coincidentally match one specific width). Measures the
   * card's own clientWidth and the chart's *unzoomed* natural width (by
   * dividing its current rendered width by whatever zoom is currently
   * applied — algebraically exact regardless of that zoom value, so this
   * converges in a single measurement, no guess-and-check) via
   * ResizeObserver, so it stays correctly filled across window resizes
   * too. Since `zoom` scales height right along with width, this is also
   * what makes the chart "a few px taller" than the old fixed-1.3 version
   * — a deliberate side effect, not a bug, per Gregor's own "keep the
   * proportions" request. Defaults to false so every other caller
   * (StatusShowcase.tsx, PatientChart.tsx) keeps the fixed 1.3 zoom
   * unchanged.
   */
  fitWidth?: boolean;
}

export function DentalChart({
  onSelect,
  surfacesByFdi,
  pocketsBuccal,
  pocketsLingual,
  gumMargin,
  bleedingBuccal,
  bleedingLingual,
  postByFdi,
  endoByFdi,
  bridgeGroupByFdi,
  onTargetClick,
  isTargetSelected,
  isFdiSelected,
  onPerioPointClick,
  focusedPerioPoint,
  hideArchLabels = false,
  compact = false,
  instructionText,
  fitWidth = false,
}: DentalChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Natural (unscaled) size of the content, read via offsetWidth/
  // offsetHeight — unlike getBoundingClientRect(), these are NOT affected
  // by a `transform`, so they always report the content's own true layout
  // size regardless of whatever scale is currently applied. That sidesteps
  // the whole class of bug the previous CSS-`zoom`-based version of this
  // had (Gregor could still see a real, unclosed gap after a hard reload —
  // `zoom` is non-standard and applies at the *layout* level, which turned
  // out not to be as reliably invertible in practice, likely interacting
  // with the browser's own display/DPI scaling, as dividing a
  // getBoundingClientRect() reading by the current zoom factor assumed on
  // paper). `transform: scale()` is the standard, well-supported technique
  // for this instead — it's purely a paint-time effect, which is exactly
  // why offsetWidth/offsetHeight can see straight through it.
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    if (!fitWidth || !contentRef.current) return;
    setNaturalSize({ width: contentRef.current.offsetWidth, height: contentRef.current.offsetHeight });
  }, [fitWidth, compact]);

  useLayoutEffect(() => {
    if (!fitWidth || !naturalSize || !containerRef.current) return;
    const container = containerRef.current;
    function recompute() {
      if (!naturalSize || naturalSize.width <= 0) return;
      // clientWidth includes the container's own left/right padding —
      // the chart's content sits *inside* that padding, so the padding
      // has to come back out, or the chart renders exactly one
      // padding's-worth too wide (the horizontal-scrollbar bug Gregor
      // just caught).
      const style = getComputedStyle(container);
      const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const availableWidth = container.clientWidth - paddingX;
      const nextScale = availableWidth / naturalSize.width;
      // Ignore sub-0.1%-ish changes — belt-and-suspenders against the
      // scrollbar-toggle feedback loop the scrollbar-gutter CSS above
      // fixes at the root; this just means a stray 1px measurement
      // wobble (from something other than the scrollbar) can't still
      // visibly re-trigger this indefinitely.
      setScale((prev) => (Math.abs(nextScale - prev) > 0.001 ? nextScale : prev));
    }
    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(container);
    return () => observer.disconnect();
  }, [fitWidth, naturalSize]);

  return (
    <div
      ref={containerRef}
      className={`overflow-x-auto rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] ${compact ? 'p-2' : 'p-6'}`}
    >
      {instructionText && (
        <div className="mb-2 text-xs text-[var(--muted,#6f7c79)]">{instructionText}</div>
      )}
      {/* The chart's native size (~700px wide) is tiny next to a real
          monitor. Every non-fitWidth caller still uses the original fixed
          `zoom: 1.3` (tuned for the ~1030px narrow-panel layout those
          pages use); fitWidth instead wraps the content in an explicitly
          *sized* outer box (naturalSize × scale — this is what makes the
          surrounding flex/grid layout actually reserve the right amount
          of space, since `transform` alone never changes layout size) and
          scales the content to fill it via `transform`, `transform-origin:
          top left`. */}
      <div
        style={
          fitWidth && naturalSize
            ? { width: naturalSize.width * scale, height: naturalSize.height * scale }
            : undefined
        }
      >
        <div
          ref={contentRef}
          className={`flex flex-col ${compact ? 'gap-3' : 'gap-8'}`}
          style={
            fitWidth
              ? ({ transform: `scale(${scale})`, transformOrigin: 'top left', width: 'max-content' } as CSSProperties)
              : ({ zoom: 1.3 } as CSSProperties)
          }
        >
        <ArchRow
          label={hideArchLabels ? undefined : 'Zgornja čeljust — 18→11 · 21→28'}
          arch="upper"
          leftQuadrant={UPPER_LEFT}
          rightQuadrant={UPPER_RIGHT}
          onSelect={onSelect}
          surfacesByFdi={surfacesByFdi}
          pocketsBuccal={pocketsBuccal}
          pocketsLingual={pocketsLingual}
          gumMargin={gumMargin}
          bleedingBuccal={bleedingBuccal}
          bleedingLingual={bleedingLingual}
          postByFdi={postByFdi}
          endoByFdi={endoByFdi}
          bridgeGroupByFdi={bridgeGroupByFdi}
          onTargetClick={onTargetClick}
          isTargetSelected={isTargetSelected}
          isFdiSelected={isFdiSelected}
          onPerioPointClick={onPerioPointClick}
          focusedPerioPoint={focusedPerioPoint}
        />
        <ArchRow
          label={hideArchLabels ? undefined : 'Spodnja čeljust — 48→41 · 31→38'}
          arch="lower"
          leftQuadrant={LOWER_LEFT}
          rightQuadrant={LOWER_RIGHT}
          onSelect={onSelect}
          surfacesByFdi={surfacesByFdi}
          pocketsBuccal={pocketsBuccal}
          pocketsLingual={pocketsLingual}
          gumMargin={gumMargin}
          bleedingBuccal={bleedingBuccal}
          bleedingLingual={bleedingLingual}
          postByFdi={postByFdi}
          endoByFdi={endoByFdi}
          bridgeGroupByFdi={bridgeGroupByFdi}
          onTargetClick={onTargetClick}
          isTargetSelected={isTargetSelected}
          isFdiSelected={isFdiSelected}
          onPerioPointClick={onPerioPointClick}
          focusedPerioPoint={focusedPerioPoint}
        />
        </div>
      </div>
    </div>
  );
}
