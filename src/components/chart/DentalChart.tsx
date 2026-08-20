import type { CSSProperties } from 'react';
import { UPPER_LEFT, UPPER_RIGHT, LOWER_LEFT, LOWER_RIGHT } from '../../data/toothMeta';
import type { SurfaceMap, PocketDepths, GumMargin, BleedingPoints, SealantStage } from '../../types/dental';
import { ArchRow } from './ArchRow';

interface DentalChartProps {
  onSelect?: (fdi: string) => void;
  selectedFdi?: string;
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
  /** Which teeth show the fissure-sealant tilde in the bridge row. */
  sealantByFdi?: Record<string, SealantStage>;
}

export function DentalChart({
  onSelect,
  selectedFdi,
  surfacesByFdi,
  pocketsBuccal,
  pocketsLingual,
  gumMargin,
  bleedingBuccal,
  bleedingLingual,
  postByFdi,
  sealantByFdi,
}: DentalChartProps) {
  return (
    <div className="overflow-x-auto rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-6">
      {/* The chart's native size (~700px wide) is tiny next to a real
          monitor — zoom scales every fixed-pixel element uniformly (SVGs,
          the 26px tloris buttons, borders, text) so it actually fills the
          wider panel below instead of sitting small in a sea of padding.
          1.3, not higher, so one arch (~930px zoomed, ~1030px with panel
          padding) fits comfortably without horizontal scrolling on a 13"
          laptop screen (~1280px logical width at typical scaling). */}
      <div className="flex flex-col gap-8" style={{ zoom: 1.3 } as CSSProperties}>
        <ArchRow
          label="Zgornja čeljust — 18→11 · 21→28"
          arch="upper"
          leftQuadrant={UPPER_LEFT}
          rightQuadrant={UPPER_RIGHT}
          onSelect={onSelect}
          selectedFdi={selectedFdi}
          surfacesByFdi={surfacesByFdi}
          pocketsBuccal={pocketsBuccal}
          pocketsLingual={pocketsLingual}
          gumMargin={gumMargin}
          bleedingBuccal={bleedingBuccal}
          bleedingLingual={bleedingLingual}
          postByFdi={postByFdi}
          sealantByFdi={sealantByFdi}
        />
        <ArchRow
          label="Spodnja čeljust — 48→41 · 31→38"
          arch="lower"
          leftQuadrant={LOWER_LEFT}
          rightQuadrant={LOWER_RIGHT}
          onSelect={onSelect}
          selectedFdi={selectedFdi}
          surfacesByFdi={surfacesByFdi}
          pocketsBuccal={pocketsBuccal}
          pocketsLingual={pocketsLingual}
          gumMargin={gumMargin}
          bleedingBuccal={bleedingBuccal}
          bleedingLingual={bleedingLingual}
          postByFdi={postByFdi}
          sealantByFdi={sealantByFdi}
        />
      </div>
    </div>
  );
}
