// v8: fixes the "double stroke at gumline" problem by separating fill from
// line — root/crown are now unstroked fill shapes, and a single ink-detail
// path (traced from the original artwork's actual pen strokes, not the
// flood-filled silhouette) is drawn once on top, preserving internal detail
// lines (root division, fissures) that the silhouette alone smooths away.
// Also: smaller icons with real gaps so teeth don't touch.
const fs = require('fs');
const path = require('path');
const DIR = __dirname;

const traced = JSON.parse(fs.readFileSync(path.join(DIR, 'traced-teeth.json'), 'utf8'));

const TYPE_BY_POS = {
  1: 'incisor_central', 2: 'incisor_lateral', 3: 'canine',
  4: 'premolar1', 5: 'premolar2', 6: 'molar1', 7: 'molar2', 8: 'molar3',
};
const ARCH_BY_QUAD = { 1: 'upper', 2: 'upper', 3: 'lower', 4: 'lower' };

const CROWN_FRACTION = {
  incisor_central: 0.34, incisor_lateral: 0.36, canine: 0.24,
  premolar1: 0.36, premolar2: 0.36, molar1: 0.46, molar2: 0.46, molar3: 0.46,
};

const BORDER = '#1f1e20';
const bw = 10, bh = 8, bx = 14 - bw / 2, by = 14 - bh / 2;

function isAnterior(fdi) {
  const pos = fdi % 10;
  return pos >= 1 && pos <= 3;
}

// Each of the 32 photos was cropped independently, so raw pixel dimensions
// aren't comparable across quadrants. Drive sizing from HEIGHT: every tooth
// is scaled (uniformly, preserving its own true aspect ratio) so its
// rendered height exactly equals its position's reference height — taken
// from the upper arch. Width is whatever that same per-tooth scale factor
// produces from the tooth's own true width, so it isn't forced to match
// across quadrants (only height is, per feedback — "as tall as").
// Trying to match width AND height by fitting into one shared box (the
// previous approach) doesn't give an exact height match: `meet` still
// picks whichever dimension is tighter for that tooth's own aspect ratio,
// so a proportionally stubbier photo (like 48 vs 47) came out shorter even
// with an identical box.
const refH = {};
for (let p = 1; p <= 8; p++) {
  refH[p] = (traced[10 + p].height + traced[20 + p].height) / 2;
}

// Per feedback: 48/38 specifically (not 18/28) should match the 2nd-molar
// height reference rather than their own smaller 3rd-molar one.
const DISPLAY_OVERRIDE = { 48: 7, 38: 7 };

// 48/38's own photos are proportionally wider than 47/37's, so matching
// height alone (above) still leaves them the widest columns in the whole
// chart (54.7/52.1px vs. the next-largest at 46.5px) — that outsized pair
// forces every column to reserve extra horizontal room, reading as bigger
// gaps between all the teeth, not just around 48/38. Per feedback, shave a
// few px off just these two so the row's max column width comes back in
// line with the rest of the molars.
const EXTRA_SHRINK = { 48: 0.9, 38: 0.9 };

// One shared px-per-viewbox-unit scale, tuned so a typical incisor lands
// close to its previous on-screen size.
const SCALE = 30 / 43.5;

const profiles = {};
for (let q = 1; q <= 4; q++) {
  for (let p = 1; p <= 8; p++) {
    const fdi = q * 10 + p;
    const type = TYPE_BY_POS[p];
    const arch = ARCH_BY_QUAD[q];
    const t = traced[fdi];
    const H = t.height;
    const frac = CROWN_FRACTION[type];
    const gingivaY = arch === 'upper' ? Math.round(H * (1 - frac)) : Math.round(H * frac);
    const refPos = DISPLAY_OVERRIDE[fdi] ?? p;
    const heightMatchScale = refH[refPos] / t.height;
    const shrink = EXTRA_SHRINK[fdi] ?? 1;
    const displayH = refH[refPos] * SCALE * shrink;
    const displayW = t.width * heightMatchScale * SCALE * shrink;
    profiles[fdi] = { type, arch, silhouette: t.d, detail: t.detailD, H, displayW, displayH, W: t.width, gingivaY };
  }
}

function topViewSvg(fdi) {
  const anterior = isAnterior(fdi);
  if (anterior) {
    const midY = 14, lx = bx, rx = bx + bw;
    return `<svg viewBox="0 0 28 28" class="tooth" role="img" aria-label="Top view ${fdi}">
      <rect x="1" y="1" width="26" height="26" fill="none" stroke="${BORDER}" stroke-width="1"/>
      <path d="M1,1 L${lx},${midY} M27,1 L${rx},${midY} M27,27 L${rx},${midY} M1,27 L${lx},${midY} M${lx},${midY} L${rx},${midY}"
        stroke="${BORDER}" stroke-width="0.75" fill="none"/>
    </svg>`;
  }
  return `<svg viewBox="0 0 28 28" class="tooth" role="img" aria-label="Top view ${fdi}">
    <rect x="1" y="1" width="26" height="26" fill="none" stroke="${BORDER}" stroke-width="1"/>
    <path d="M1,1 L${bx},${by} M27,1 L${bx + bw},${by} M27,27 L${bx + bw},${by + bh} M1,27 L${bx},${by + bh}"
      stroke="${BORDER}" stroke-width="0.75" fill="none"/>
    <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="none" stroke="${BORDER}" stroke-width="0.75"/>
  </svg>`;
}

function sideViewSvg(fdi) {
  const p = profiles[fdi];
  const crownTop = p.arch === 'upper' ? p.gingivaY : 0;
  const crownH = p.arch === 'upper' ? (p.H - p.gingivaY) : p.gingivaY;
  const clipId = `sclip-${fdi}`;
  const silClipId = `silclip-${fdi}`;
  // Clip the whole tooth (including the detail line-art) to its own traced
  // silhouette, so stray marks picked up outside the tooth's own outline
  // (dust/artifacts in the source photo) never render.
  // Content must anchor to whichever edge touches the top-view square: the
  // bottom of the viewBox for upper teeth (crown-down), the top for lower
  // teeth (crown-up). This matters now that the box height is shared across
  // a tooth's 4 quadrant copies (previous turn's fix) rather than matched to
  // each photo's own true height — any slack space has to collapse toward
  // the gumline edge, not the root tip.
  const par = p.arch === 'upper' ? 'xMidYMax meet' : 'xMidYMin meet';
  return `<svg viewBox="0 0 ${p.W} ${p.H}" width="${p.displayW.toFixed(1)}" height="${p.displayH.toFixed(1)}" preserveAspectRatio="${par}" class="sideview" role="img" aria-label="Side view ${fdi}">
    <defs>
      <clipPath id="${clipId}"><rect x="-4" y="${crownTop}" width="${p.W + 8}" height="${crownH}"/></clipPath>
      <clipPath id="${silClipId}"><path d="${p.silhouette}"/></clipPath>
    </defs>
    <g clip-path="url(#${silClipId})">
      <path class="root-fill" d="${p.silhouette}"/>
      <path class="crown-fill" d="${p.silhouette}" clip-path="url(#${clipId})"/>
      <path class="detail" d="${p.detail}" fill-rule="evenodd"/>
    </g>
  </svg>`;
}

function column(fdi, colWidth) {
  const p = profiles[fdi];
  const svStyle = `align-items:${p.arch === 'upper' ? 'flex-end' : 'flex-start'};`;
  const sv = `<div class="sv" style="${svStyle}">${sideViewSvg(fdi)}</div>`;
  const tv = `<div class="tv">${topViewSvg(fdi)}</div>`;
  const num = `<div class="num">${fdi}</div>`;
  const stack = p.arch === 'upper' ? [sv, tv, num] : [num, tv, sv];
  return `<div class="col" style="width:${colWidth.toFixed(1)}px">${stack.join('')}</div>`;
}

// Each upper-arch column sits directly above the lower-arch column at the
// same left-to-right position (18 above 48, 17 above 47, ... 21 above 31,
// etc.) — but the two teeth in a pair rarely have the same displayW, so
// giving every column its own fit-content width (previous edit) breaks that
// alignment. Share one width per pair, sized to whichever tooth is wider,
// so the same x-slot in both rows lines up.
function archColumns(upperOrder, lowerOrder) {
  const widths = upperOrder.map((upperFdi, i) => {
    const lowerFdi = lowerOrder[i];
    return Math.max(profiles[upperFdi].displayW, profiles[lowerFdi].displayW);
  });
  const upper = upperOrder.map((fdi, i) => column(fdi, widths[i])).join('');
  const lower = lowerOrder.map((fdi, i) => column(fdi, widths[i])).join('');
  return { upper, lower };
}

const upperLeft = [18,17,16,15,14,13,12,11];
const upperRight = [21,22,23,24,25,26,27,28];
const lowerLeft = [48,47,46,45,44,43,42,41];
const lowerRight = [31,32,33,34,35,36,37,38];

const leftCols = archColumns(upperLeft, lowerLeft);
const rightCols = archColumns(upperRight, lowerRight);

const html = `<!doctype html>
<title>Dental chart — full column v9</title>
<style>
  :root {
    --bg: #eef2f1; --surface: #ffffff; --ink: #1c2624; --ink-soft: #45524f; --muted: #6f7c79;
    --line: #ccd6d4; --accent: #2e6e62; --crown-fill: none; --root-fill: none; --outline: #1f1e20; --divider: #8fb7c9;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #12181a; --surface: #1a2224; --ink: #e7edea; --ink-soft: #b7c4c0; --muted: #869390;
      --line: #2b3638; --accent: #7fc9b8; --outline: #d8d5cc; --divider: #3f6b7c;
    }
  }
  :root[data-theme="dark"] {
    --bg: #12181a; --surface: #1a2224; --ink: #e7edea; --ink-soft: #b7c4c0; --muted: #869390;
    --line: #2b3638; --accent: #7fc9b8; --outline: #d8d5cc; --divider: #3f6b7c;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif; padding: clamp(20px, 4vw, 48px); }
  .wrap { max-width: 1180px; margin: 0 auto; display: flex; flex-direction: column; gap: 22px; }
  .eyebrow { font-family: ui-monospace, "Cascadia Code", monospace; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
  h1 { font-family: ui-serif, "Iowan Old Style", Georgia, serif; font-size: clamp(22px, 3vw, 28px); font-weight: 600; margin: 4px 0 0; }
  .lede { color: var(--ink-soft); font-size: 14px; line-height: 1.55; max-width: 70ch; margin: 6px 0 0; }
  .chart-card { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: clamp(16px, 3vw, 28px); overflow-x: auto; }
  .arch-label { font-family: ui-monospace, monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin: 0 0 10px; }
  .arch-label:not(:first-child) { margin-top: 24px; }
  .arch-row { display: flex; align-items: flex-start; min-width: max-content; gap: 1px; }
  .quad-divider { width: 2px; align-self: stretch; background: var(--ink); margin: 0 6px; opacity: 0.6; }
  .col { display: flex; flex-direction: column; align-items: center; width: fit-content; flex: none; gap: 4px; }
  .sv { width: fit-content; height: 102px; display: flex; align-items: flex-end; justify-content: center; }
  .sv svg { display: block; max-width: 100%; }
  .tv { width: 26px; height: 26px; }
  .num { font-family: ui-monospace, monospace; font-variant-numeric: tabular-nums; font-size: 11px; color: var(--ink-soft); }
  path.root-fill { fill: var(--root-fill); stroke: none; }
  path.crown-fill { fill: var(--crown-fill); stroke: none; }
  path.detail { fill: var(--outline); stroke: none; }
</style>
<div class="wrap">
  <div>
    <div class="eyebrow">Dental chart · full column · v8</div>
    <h1>Solid line, real details, no overlap</h1>
    <p class="lede">Root/crown are now unstroked fill shapes (no more doubled stroke at the gumline). A single line-art path, traced from the actual ink strokes in your photos rather than the flattened silhouette, sits on top and preserves internal detail (root division, fissures). Icons are smaller with real gaps between columns.</p>
  </div>
  <div class="chart-card">
    <p class="arch-label">Upper arch — 18→11 · 21→28</p>
    <div class="arch-row">${leftCols.upper}<div class="quad-divider"></div>${rightCols.upper}</div>
    <p class="arch-label">Lower arch — 48→41 · 31→38</p>
    <div class="arch-row">${leftCols.lower}<div class="quad-divider"></div>${rightCols.lower}</div>
  </div>
</div>
`;

fs.writeFileSync(path.join(DIR, 'chart-preview.html'), html, 'utf8');
console.log('done');
