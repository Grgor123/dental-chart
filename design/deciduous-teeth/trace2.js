// Step 2: each of the 10 silhouettes (labels from trace.js) → potrace paths.
// d = filled silhouette; detailD = a thin outline band (the line art — the
// engraving's hatching is deliberately left out). Figure = left side, so the
// upper row is 61–65 and the lower row 71–75 (incisor → second molar, left to
// right); the right side (51–55, 81–85) is the mirror image.
const potrace = require('./node_modules/potrace');
const Jimp = require('./node_modules/jimp');
const fs = require('fs');
const furcationCurve = require('./furcation');

const { w, h } = JSON.parse(fs.readFileSync('dims.json', 'utf8'));
const label = new Int32Array(fs.readFileSync('labels.bin').buffer.slice(0));
const comps = JSON.parse(fs.readFileSync('components.json', 'utf8')).slice(0, 10);
const lines = new Uint8Array(fs.readFileSync(process.env.LINES || 'lines.bin'));
const PAD = 4;
// Outline like the permanent teeth: a firm line set slightly inside the grey
// silhouette edge.
const INSET = 3;
const THICK = Number(process.env.THICK || 6);

function trace(mask, mw, mh) {
  return new Promise((resolve, reject) => {
    const img = new Jimp(mw, mh, 0xffffffff);
    for (let i = 0; i < mw * mh; i++) if (mask[i]) img.bitmap.data.writeUInt32BE(0x000000ff, i * 4);
    img.getBuffer(Jimp.MIME_PNG, (err, buf) => {
      if (err) return reject(err);
      potrace.trace(buf, { threshold: 128, turdSize: 8, optTolerance: 0.4, alphaMax: 1.1 }, (e, svg) => {
        if (e) return reject(e);
        const ds = [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
        resolve(ds.join(' '));
      });
    });
  });
}

function erode(mask, mw, mh, r) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    let keep = 1;
    for (let dy = -r; dy <= r && keep; dy++) for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= mw || ny >= mh || !mask[ny * mw + nx]) { keep = 0; break; }
    }
    out[y * mw + x] = keep;
  }
  return out;
}

(async () => {
  const upper = comps.filter((c) => c.minY < 300).sort((a, b) => a.minX - b.minX);
  const lower = comps.filter((c) => c.minY >= 300).sort((a, b) => a.minX - b.minX);
  if (upper.length !== 5 || lower.length !== 5) throw new Error(`rows: ${upper.length} / ${lower.length}`);
  const assign = [...upper.map((c, i) => [`6${i + 1}`, `5${i + 1}`, c]), ...lower.map((c, i) => [`7${i + 1}`, `8${i + 1}`, c])];
  const out = {};
  for (const [left, right, c] of assign) {
    const mw = c.maxX - c.minX + 1 + PAD * 2;
    const mh = c.maxY - c.minY + 1 + PAD * 2;
    const mask = new Uint8Array(mw * mh);
    for (let y = c.minY; y <= c.maxY; y++) for (let x = c.minX; x <= c.maxX; x++) {
      if (label[y * w + x] === c.id) mask[(y - c.minY + PAD) * mw + (x - c.minX + PAD)] = 1;
    }
    // Inner line art (thinned engraving contours) for this tooth.
    const inner = new Uint8Array(mw * mh);
    for (let y = c.minY; y <= c.maxY; y++) for (let x = c.minX; x <= c.maxX; x++) {
      if (label[y * w + x] === c.id && lines[y * w + x]) inner[(y - c.minY + PAD) * mw + (x - c.minX + PAD)] = 1;
    }
    // Three-rooted upper molars (64, 65): the front roots' contour across the
    // fork, so the middle root lies behind them; the engraving's strokes in
    // that area are cleared first.
    const arc = new Uint8Array(mw * mh);
    if (left === '64' || left === '65') {
      const f = furcationCurve(mask, mw, mh);
      if (f) {
        const curveY = (x) => {
          let best = null;
          for (const [px, py] of f.pts) if (best === null || Math.abs(px - x) < Math.abs(best[0] - x)) best = [px, py];
          return best[1];
        };
        for (let y = 0; y < mh; y++) for (let x = Math.floor(f.a.x) - 6; x <= Math.ceil(f.b.x) + 6; x++) {
          if (x >= 0 && x < mw && y < curveY(Math.min(Math.max(x, f.a.x), f.b.x)) + 55) inner[y * mw + x] = 0;
        }
        const r = THICK / 2 + 0.5;
        // Sharp gaps (Gregor): each gap between a front root and the middle
        // root ends in a V — two straight edges meeting in a point on the
        // front root's contour, instead of the smoothed round end.
        const filled = (x, y) => x >= 0 && y >= 0 && x < mw && y < mh && mask[y * mw + x];
        const stroke = (x0, y0, x1, y1) => {
          const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
          for (let k = 0; k <= n; k++) {
            const px = x0 + ((x1 - x0) * k) / n, py = y0 + ((y1 - y0) * k) / n;
            for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
              const x = Math.round(px + dx), y = Math.round(py + dy);
              if (x >= 0 && y >= 0 && x < mw && y < mh && (x - px) ** 2 + (y - py) ** 2 <= r * r) arc[y * mw + x] = 1;
            }
          }
        };
        const inTriangle = (x, y, A, B, C) => {
          const d = (P, Q, R) => (P[0] - R[0]) * (Q[1] - R[1]) - (Q[0] - R[0]) * (P[1] - R[1]);
          const d1 = d([x, y], A, B), d2 = d([x, y], B, C), d3 = d([x, y], C, A);
          return !(((d1 < 0) || (d2 < 0) || (d3 < 0)) && ((d1 > 0) || (d2 > 0) || (d3 > 0)));
        };
        for (const [N, front] of [[f.L, -1], [f.R, +1]]) {
          const y0 = Math.round(N.y) - 22;
          let fx = Math.round(N.x), mx = Math.round(N.x);
          while (fx > 0 && fx < mw - 1 && !filled(fx, y0)) fx += front; // front root's edge
          while (mx > 0 && mx < mw - 1 && !filled(mx, y0)) mx -= front; // middle root's edge
          // Apex: on the front roots' contour, a little below the notch.
          const seq = front < 0 ? f.pts : f.pts.slice().reverse();
          const apex = seq.find(([, py]) => py >= N.y + 9) ?? seq[Math.floor(seq.length / 2)];
          const A = [fx, y0], B = [mx, y0], C = apex;
          for (let y = y0; y <= Math.ceil(apex[1]); y++) for (let x = Math.min(fx, mx, apex[0]) - 1; x <= Math.max(fx, mx, apex[0]) + 1; x++) {
            if (x >= 0 && y >= 0 && x < mw && y < mh && inTriangle(x + 0.5, y + 0.5, A, B, C)) { mask[y * mw + x] = 0; inner[y * mw + x] = 0; }
          }
          // Start each edge in the middle of the outline band (which sits
          // INSET px inside the silhouette), so the two line up.
          const shift = INSET + THICK / 2;
          stroke(fx + front * shift, y0, apex[0], apex[1]);
          stroke(mx - front * shift, y0, apex[0], apex[1]);
        }
        for (const [px, py] of f.pts) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
          const x = Math.round(px + dx), y = Math.round(py + dy);
          if (x >= 0 && y >= 0 && x < mw && y < mh && (x - px) ** 2 + (y - py) ** 2 <= r * r && mask[y * mw + x]) arc[y * mw + x] = 1;
        }
      }
    }
    const arcMirror = new Uint8Array(mw * mh);
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) arcMirror[y * mw + (mw - 1 - x)] = arc[y * mw + x];
    const innerMirror = new Uint8Array(mw * mh);
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) innerMirror[y * mw + (mw - 1 - x)] = inner[y * mw + x];
    const mirror = new Uint8Array(mw * mh);
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) mirror[y * mw + (mw - 1 - x)] = mask[y * mw + x];
    for (const [fdi, m, lineArt, arcArt] of [[left, mask, inner, arc], [right, mirror, innerMirror, arcMirror]]) {
      const outer = erode(m, mw, mh, INSET);
      const core = erode(m, mw, mh, INSET + THICK);
      // Feature lines only well inside the tooth: the engraving's shadow line
      // running just inside the edge would read as a double outline.
      const deep = erode(m, mw, mh, INSET + THICK + 7);
      const band = m.map((v, i) => ((outer[i] && !core[i]) || (lineArt[i] && deep[i]) || (arcArt[i] && v) ? 1 : 0));
      out[fdi] = { d: await trace(m, mw, mh), detailD: await trace(band, mw, mh), width: mw, height: mh };
    }
    console.log(left, right, mw, 'x', mh);
  }
  fs.writeFileSync('tracedDeciduousTeeth.json', JSON.stringify(out));
  console.log('saved', Object.keys(out).sort().join(','));
})();
