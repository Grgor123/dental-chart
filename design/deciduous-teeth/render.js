// Tiny SVG-path rasterizer (M/L/C/Z, absolute — what potrace writes), even-odd
// fill, to look at traced teeth as images. node render.js out.png fdi[:src] ...
//   src = perm (tracedTeeth.json) or milk (tracedDeciduousTeeth.json)
const Jimp = require('./node_modules/jimp');
const fs = require('fs');
const perm = JSON.parse(fs.readFileSync('C:/Users/Uporabnik/Documents/Dental charting/src/data/tracedTeeth.json', 'utf8'));
const milk = JSON.parse(fs.readFileSync('tracedDeciduousTeeth.json', 'utf8'));

function polys(d) {
  const tok = d.match(/[MLCZmlcz]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  const out = [];
  let cur = null, x = 0, y = 0, i = 0, cmd = '';
  const num = () => parseFloat(tok[i++]);
  while (i < tok.length) {
    if (/[MLCZmlcz]/.test(tok[i])) cmd = tok[i++];
    if (cmd === 'M' || cmd === 'm') { x = num(); y = num(); cur = [[x, y]]; out.push(cur); cmd = cmd === 'M' ? 'L' : 'l'; }
    else if (cmd === 'L') { x = num(); y = num(); cur.push([x, y]); }
    else if (cmd === 'C') {
      const [x1, y1, x2, y2, x3, y3] = [num(), num(), num(), num(), num(), num()];
      for (let t = 1; t <= 12; t++) {
        const s = t / 12, a = (1 - s) ** 3, b = 3 * (1 - s) ** 2 * s, c = 3 * (1 - s) * s * s, e = s ** 3;
        cur.push([a * x + b * x1 + c * x2 + e * x3, a * y + b * y1 + c * y2 + e * y3]);
      }
      x = x3; y = y3;
    } else if (cmd === 'Z' || cmd === 'z') { cmd = ''; }
    else i++;
  }
  return out;
}

function fill(img, d, scale, ox, color) {
  const ps = polys(d).map((p) => p.map(([x, y]) => [x * scale + ox, y * scale]));
  const H = img.bitmap.height, W = img.bitmap.width;
  for (let py = 0; py < H; py++) {
    const yc = py + 0.5, xs = [];
    for (const p of ps) for (let k = 0; k < p.length; k++) {
      const [x1, y1] = p[k], [x2, y2] = p[(k + 1) % p.length];
      if ((y1 <= yc && y2 > yc) || (y2 <= yc && y1 > yc)) xs.push(x1 + ((yc - y1) / (y2 - y1)) * (x2 - x1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let px = Math.max(0, Math.ceil(xs[k] - 0.5)); px < Math.min(W, xs[k + 1] - 0.5); px++) img.bitmap.data.writeUInt32BE(color, (py * W + px) * 4);
    }
  }
}

(async () => {
  const [out, ...specs] = process.argv.slice(2);
  const HEIGHT = 420;
  const teeth = specs.map((s) => { const [f, src] = s.split(':'); return (src === 'perm' ? perm : milk)[f]; });
  const widths = teeth.map((t) => (t.width / t.height) * HEIGHT);
  const img = new Jimp(Math.ceil(widths.reduce((a, b) => a + b + 30, 30)), HEIGHT, 0xffffffff);
  let ox = 30;
  teeth.forEach((t, n) => {
    const scale = HEIGHT / t.height;
    fill(img, t.d, scale, ox, 0xd8d5ccff);
    fill(img, t.detailD, scale, ox, 0x1f1e20ff);
    ox += widths[n] + 30;
  });
  await img.writeAsync(out);
})();
