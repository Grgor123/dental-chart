// Calendar colours from a therapist's colour (Gregor, 2026-11-10): dark
// colours (e.g. the default dark green) made appointment chips hard to read,
// so chips and the therapist panel use a light shade of the colour, and the
// full colour only as a stripe. Pure.

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Relative luminance, 0 (black) … 1 (white). */
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** A colour dot as the calendar shows the colour: the light shade, ringed
 *  by the full colour (Ekipa, working-hours dialog). */
export function swatchStyle(hex: string): { backgroundColor: string; border: string } {
  return { backgroundColor: lightShade(hex), border: `2px solid ${hex}` };
}

/** A light shade of the colour that dark text reads well on: dark colours
 *  are mixed further towards white than light ones. */
export function lightShade(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const lum = luminance(rgb);
  const white = lum > 0.5 ? 0.3 : lum > 0.25 ? 0.5 : 0.68;
  return toHex(rgb.map((v) => v + (255 - v) * white) as [number, number, number]);
}
