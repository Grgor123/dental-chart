// Clean feature lines in the style of the permanent teeth: from the thinned
// engraving lines (lines_thin.bin → re-thinned here), keep each long stroke's
// main path only (the longest route through its skeleton — no spurs or
// loops), drop short ones, and draw it as an even ~3 px line. → features.bin
const fs = require('fs');
const { w, h } = JSON.parse(fs.readFileSync('dims.json', 'utf8'));
const src = new Uint8Array(fs.readFileSync(process.env.SRC || 'lines.bin'));
const MIN_LEN = Number(process.argv[2] ?? 45); // px along the path
const RADIUS = Number(process.argv[3] ?? 1.6);

// Zhang–Suen thinning.
const m = src.slice();
const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : m[y * w + x]);
for (let changed = true; changed; ) {
  changed = false;
  for (const step of [0, 1]) {
    const del = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      const p = [at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1)];
      const b = p.reduce((s, v) => s + v, 0);
      if (b < 2 || b > 6) continue;
      let a = 0;
      for (let i = 0; i < 8; i++) if (!p[i] && p[(i + 1) % 8]) a++;
      if (a !== 1) continue;
      if (step === 0 && (p[0] * p[2] * p[4] || p[2] * p[4] * p[6])) continue;
      if (step === 1 && (p[0] * p[2] * p[6] || p[0] * p[4] * p[6])) continue;
      del.push(y * w + x);
    }
    for (const i of del) m[i] = 0;
    if (del.length) changed = true;
  }
}

const nbrs = (j) => {
  const x = j % w, y = (j / w) | 0, out = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < w && ny < h && m[ny * w + nx]) out.push(ny * w + nx);
  }
  return out;
};
function bfs(start, allowed) {
  const prev = new Map([[start, -1]]);
  const q = [start];
  let last = start;
  while (q.length) {
    const j = q.shift();
    last = j;
    for (const k of nbrs(j)) if (allowed.has(k) && !prev.has(k)) { prev.set(k, j); q.push(k); }
  }
  return { last, prev };
}

const seen = new Uint8Array(w * h);
const out = new Uint8Array(w * h);
let kept = 0;
for (let i = 0; i < w * h; i++) {
  if (!m[i] || seen[i]) continue;
  const comp = new Set([i]);
  const st = [i];
  seen[i] = 1;
  while (st.length) for (const k of nbrs(st.pop())) if (!seen[k]) { seen[k] = 1; comp.add(k); st.push(k); }
  if (comp.size < MIN_LEN) continue;
  // Longest path: farthest point from any point, then farthest from that.
  const a = bfs(i, comp).last;
  const { last: b, prev } = bfs(a, comp);
  const path = [];
  for (let j = b; j !== -1; j = prev.get(j)) path.push(j);
  if (path.length < MIN_LEN) continue;
  kept++;
  // Smooth the path a little (moving average) and draw it.
  const pts = path.map((j) => [j % w, (j / w) | 0]);
  const R = 3;
  for (let n = 0; n < pts.length; n++) {
    let sx = 0, sy = 0, c = 0;
    for (let k = Math.max(0, n - R); k <= Math.min(pts.length - 1, n + R); k++) { sx += pts[k][0]; sy += pts[k][1]; c++; }
    const cx = sx / c, cy = sy / c;
    const r = Math.ceil(RADIUS);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = Math.round(cx + dx), y = Math.round(cy + dy);
      if (x >= 0 && y >= 0 && x < w && y < h && (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS * RADIUS) out[y * w + x] = 1;
    }
  }
}
fs.writeFileSync('features.bin', Buffer.from(out));
console.log('kept strokes', kept);
