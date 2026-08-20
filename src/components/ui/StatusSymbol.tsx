interface StatusSymbolProps {
  symbol: 'x-cross' | 'endo-circle';
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  /**
   * Overrides the default stroke width (normally derived from the
   * bounding box itself — see below). Needed when a caller wants a
   * bounding box sized for *position* (e.g. reaching a square's own
   * corners) without the stroke scaling up along with it — the two are
   * unrelated once a symbol is meant to match another instance's weight
   * rather than its own box size.
   */
  strokeWidth?: number;
}

// First-pass glyphs for the statuses that need more than a fill color.
// Positioned via a bounding box so the same component works inside both the
// 28×28 top-view square and a side-view tooth's own (much larger, per-tooth)
// viewBox.
export function StatusSymbol({ symbol, x, y, width, height, color, strokeWidth: strokeWidthOverride }: StatusSymbolProps) {
  const strokeWidth = strokeWidthOverride ?? Math.max(width, height) * 0.07;

  if (symbol === 'x-cross') {
    return (
      <path
        d={`M${x},${y} L${x + width},${y + height} M${x + width},${y} L${x},${y + height}`}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        fill="none"
      />
    );
  }

  // endo-circle: a plain circle centered in the caller's bounding box
  // (normally the tloris square's own center), using the full passed-in
  // strokeWidth — meant to read at the same weight as every other line in
  // that view, not as fine annotation detail.
  const cx = x + width / 2;
  const cy = y + height / 2;
  return <circle cx={cx} cy={cy} r={Math.min(width, height) / 2} stroke={color} strokeWidth={strokeWidth} fill="none" />;
}
