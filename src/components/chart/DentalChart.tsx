import type { CSSProperties, MouseEvent, ReactNode } from 'react';
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
}: DentalChartProps) {
  return (
    <div
      className={`overflow-x-auto rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] ${compact ? 'p-2' : 'p-6'}`}
    >
      {instructionText && (
        <div className="mb-2 text-xs text-[var(--muted,#6f7c79)]">{instructionText}</div>
      )}
      {/* The chart's native size (~700px wide) is tiny next to a real
          monitor — zoom scales every fixed-pixel element uniformly (SVGs,
          the 26px tloris buttons, borders, text) so it actually fills the
          wider panel below instead of sitting small in a sea of padding.
          1.3, not higher, so one arch (~930px zoomed, ~1030px with panel
          padding) fits comfortably without horizontal scrolling on a 13"
          laptop screen (~1280px logical width at typical scaling). */}
      <div className={`flex flex-col ${compact ? 'gap-3' : 'gap-8'}`} style={{ zoom: 1.3 } as CSSProperties}>
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
  );
}
