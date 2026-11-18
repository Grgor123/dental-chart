// Traces the 10 deciduous tooth shapes from Gray's Anatomy (1918), Fig. 1004
// (public domain) into silhouette SVG paths. Hatching is ignored: the
// silhouette comes from flood-filling the background (after closing small
// gaps in the engraved outline).
const Jimp = require('./node_modules/jimp');
const potrace = require('./node_modules/potrace');
const fs = require('fs');

const CROP = { x: 205, y: 2045, w: 830, h: 705 };
const DARK = 185; // grey level below = ink
const CLOSE = 6; // px dilation to close outline gaps

function idx(w, x, y) { return y * w + x; }

function dilate(mask, w, h, r) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[idx(w, x, y)]) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && dx * dx + dy * dy <= r * r) out[idx(w, nx, ny)] = 1;
    }
  }
  return out;
}
function erode(mask, w, h, r) {
  const inv = mask.map((v) => (v ? 0 : 1));
  const d = dilate(inv, w, h, r);
  return d.map((v) => (v ? 0 : 1));
}

(async () => {
  const page = await Jimp.read('dl/p1118.jpg');
  const im = page.clone().crop(CROP.x, CROP.y, CROP.w, CROP.h).greyscale();
  im.write('fig_wide.png');
  const { width: w, height: h, data } = im.bitmap;
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ink[i] = data[i * 4] < DARK ? 1 : 0;
  const walls = dilate(ink, w, h, CLOSE);

  // Background = reachable from the border through non-wall pixels.
  const bg = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) { stack.push([x, 0], [x, h - 1]); }
  for (let y = 0; y < h; y++) { stack.push([0, y], [w - 1, y]); }
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = idx(w, x, y);
    if (bg[i] || walls[i]) continue;
    bg[i] = 1;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  // Silhouette = not background, shrunk back by the closing radius.
  let sil = bg.map((v) => (v ? 0 : 1));
  sil = erode(sil, w, h, CLOSE);

  // Connected components.
  const label = new Int32Array(w * h);
  const comps = [];
  for (let i = 0; i < w * h; i++) {
    if (!sil[i] || label[i]) continue;
    const id = comps.length + 1;
    let minX = w, minY = h, maxX = 0, maxY = 0, area = 0;
    const st = [i];
    label[i] = id;
    while (st.length) {
      const j = st.pop();
      const x = j % w, y = (j / w) | 0;
      area++;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = idx(w, nx, ny);
        if (sil[k] && !label[k]) { label[k] = id; st.push(k); }
      }
    }
    comps.push({ id, area, minX, minY, maxX, maxY });
  }
  comps.sort((a, b) => b.area - a.area);
  console.log('largest components:', comps.slice(0, 14).map((c) => `${c.area}@${c.minX},${c.minY}-${c.maxX},${c.maxY}`).join(' | '));
  fs.writeFileSync('components.json', JSON.stringify(comps.slice(0, 14)));

  // Debug image of the silhouettes.
  const dbg = new Jimp(w, h, 0xffffffff);
  for (let i = 0; i < w * h; i++) if (sil[i]) dbg.bitmap.data.writeUInt32BE(label[i] % 2 ? 0x2e6e62ff : 0x9fe1cbff, i * 4);
  await dbg.writeAsync('silhouettes.png');
  fs.writeFileSync('labels.bin', Buffer.from(label.buffer));
  fs.writeFileSync('dims.json', JSON.stringify({ w, h }));
})();
