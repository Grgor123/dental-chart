interface PostSwatchProps {
  /** On-screen size in px; the internal viewBox stays fixed at 22×22 regardless, same convention as StatusSwatch.tsx. */
  size?: number;
}

// Representative icon for the dental post (zobni zatiček) — not a
// ToothStatus, so it doesn't go through StatusSwatch, but per Monika's
// explicit request it must still render the same way every real status
// does wherever services are listed (StatusToolbar.tsx, StatusLegend.tsx):
// one small icon + one label, same size, same button/row shape. A
// simplified hollow triangle, echoing the real chart's own dental-post mark
// (ToothTopView.tsx — base on the tooth's own edge, tip pointing outward),
// same dark outline color (#1f1e20) and stroke-only (no fill) treatment.
export function PostSwatch({ size = 22 }: PostSwatchProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" className="shrink-0">
      <polygon points="8,17 14,17 11,5" fill="none" stroke="#1f1e20" strokeWidth={1.25} strokeLinejoin="round" />
    </svg>
  );
}
