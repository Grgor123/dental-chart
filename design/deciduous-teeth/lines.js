// Inner line art for the milk teeth: the engraving's long, continuous ink
// strokes inside each tooth (crown/root boundary, cusp and fissure contours,
// root separations), without the short hatching strokes. Writes a debug image
// lines.png and lines.bin (mask in the crop's coordinates).
const Jimp = require('./node_modules/jimp');
const fs = require('fs');

const CROP = { x: 205, y: 2045, w: 830, h: 705 };
const INK = Number(process.argv[2] ?? 120); // darker than this = ink
const MIN_EXTENT = Number(process.argv[3] ?? 28); // px: shorter strokes = hatching
const EDGE = 4; // ignore ink this close to the silhouette edge (that's the outline)

(async () => {
  const { w, h } = JSON.parse(fs.readFileSync('dims.json', 'utf8'));
  const label = new Int32Array(fs.readFileSync('labels.bin').buffer.slice(0));
  const comps = JSON.parse(fs.readFileSync('components.json', 'utf8')).slice(0, 10);
  const ids = new Set(comps.map((c) => c.id));
  const page = await Jimp.read('dl/p1118.jpg');
  const im = page.clone().crop(CROP.x, CROP.y, CROP.w, CROP.h).greyscale();
  const d = im.bitmap.data;

  // Inside = inside a tooth and at least EDGE px from its edge.
  const inside = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const id = label[y * w + x];
    if (!ids.has(id)) continue;
    let ok = 1;
    for (let dy = -EDGE; dy <= EDGE && ok; dy++) for (let dx = -EDGE; dx <= EDGE; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || label[ny * w + nx] !== id) { ok = 0; break; }
    }
    inside[y * w + x] = ok;
  }
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ink[i] = inside[i] && d[i * 4] < INK ? 1 : 0;

  // Keep ink components whose bounding box is long enough (8-connected).
  const seen = new Uint8Array(w * h);
  const keep = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!ink[i] || seen[i]) continue;
    const pix = [];
    const st = [i];
    seen[i] = 1;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    while (st.length) {
      const j = st.pop();
      pix.push(j);
      const x = j % w, y = (j / w) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (ink[k] && !seen[k]) { seen[k] = 1; st.push(k); }
      }
    }
    const extent = Math.hypot(maxX - minX, maxY - minY);
    // Long and thin = a contour line; short = hatching; big blobs (dense
    // shading) are dropped too.
    const fill = pix.length / ((maxX - minX + 1) * (maxY - minY + 1));
    if (extent >= MIN_EXTENT && fill < 0.35) for (const j of pix) keep[j] = 1;
  }

  const dbg = new Jimp(w, h, 0xffffffff);
  for (let i = 0; i < w * h; i++) {
    if (keep[i]) dbg.bitmap.data.writeUInt32BE(0x1f1e20ff, i * 4);
    else if (ids.has(label[i])) dbg.bitmap.data.writeUInt32BE(0xe6e4dcff, i * 4);
  }
  await dbg.writeAsync('lines.png');
  fs.writeFileSync('lines.bin', Buffer.from(keep));
  console.log('ink', INK, 'min extent', MIN_EXTENT);
})();
