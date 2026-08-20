import { COLUMN_WIDTH, COLUMN_GAP } from '../../data/toothProfiles';

interface NumberRowProps {
  fdis: readonly string[];
}

// FDI tooth-number labels for one quadrant, split out from the tloris
// squares so a PocketDepthRow can sit between the two.
export function NumberRow({ fdis }: NumberRowProps) {
  return (
    <div className="flex items-start" style={{ gap: `${COLUMN_GAP}px` }}>
      {fdis.map((fdi) => (
        <div
          key={fdi}
          className="flex flex-none justify-center font-mono text-[11px] tabular-nums text-[var(--ink-soft,#45524f)]"
          style={{ width: `${COLUMN_WIDTH}px` }}
        >
          {fdi}
        </div>
      ))}
    </div>
  );
}
