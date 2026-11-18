// Preview: the traced milk teeth at real size (textbook averages) next to a
// few of Monika's permanent teeth at the same scale, coloured like the chart
// (white crown, grey root, dark line art).
const fs = require('fs');
const milk = JSON.parse(fs.readFileSync('tracedDeciduousTeeth.json', 'utf8'));
const perm = JSON.parse(fs.readFileSync('C:/Users/Uporabnik/Documents/Dental charting/src/data/tracedTeeth.json', 'utf8'));

const PX_PER_MM = 7;
// Deciduous crown / root length, mm (Wheeler's Dental Anatomy averages).
const MILK_MM = {
  upper: [[6.0, 10.0], [5.6, 11.4], [6.5, 13.5], [5.1, 10.0], [5.7, 11.7]],
  lower: [[5.0, 9.0], [5.2, 10.0], [6.0, 11.5], [6.0, 9.8], [5.5, 11.3]],
};
const PERM_MM = { '11': [10.5, 13.0], '13': [10.0, 17.0], '16': [7.5, 12.0], '41': [9.0, 12.5], '43': [11.0, 15.5], '46': [7.5, 14.0] };
const NAMES = ['sekalec 1', 'sekalec 2', 'podočnik', 'kočnik 1', 'kočnik 2'];

function tooth(t, crownMm, rootMm, upper, label) {
  const total = crownMm + rootMm;
  const hpx = total * PX_PER_MM;
  const wpx = (t.width / t.height) * hpx;
  const crownH = (crownMm / total) * t.height;
  const crownY = upper ? t.height - crownH : 0;
  const id = Math.random().toString(36).slice(2);
  return `<figure><svg width="${wpx.toFixed(1)}" height="${hpx.toFixed(1)}" viewBox="0 0 ${t.width} ${t.height}">
  <defs><clipPath id="s${id}"><path d="${t.d}"/></clipPath></defs>
  <g clip-path="url(#s${id})">
    <rect width="${t.width}" height="${t.height}" fill="#D8D5CC"/>
    <rect y="${crownY}" width="${t.width}" height="${crownH}" fill="#fff"/>
  </g>
  <path d="${t.detailD}" fill="#1f1e20" fill-rule="evenodd"/>
</svg><figcaption>${label}</figcaption></figure>`;
}

const row = (fdis, arch) =>
  fdis.map((f, i) => tooth(milk[f], ...MILK_MM[arch][Number(f[1]) - 1], arch === 'upper', `${f}<br><small>${NAMES[Number(f[1]) - 1]}</small>`)).join('');
const permRow = (fdis, upper) => fdis.map((f) => tooth(perm[f], ...PERM_MM[f], upper, `${f}<br><small>stalni</small>`)).join('');

const html = `<!doctype html><html lang="sl"><head><meta charset="utf-8"><title>Mlečni zobje — predogled</title>
<style>
body{font-family:system-ui,sans-serif;margin:24px;color:#1c2624;background:#f4f6f5}
h1{font-size:20px} h2{font-size:15px;margin:22px 0 8px}
.row{display:flex;align-items:flex-end;gap:14px;background:#fff;padding:16px;border-radius:8px;border:1px solid #ccd6d4;flex-wrap:wrap}
.row.lower{align-items:flex-start}
figure{margin:0;text-align:center;font-size:12px} figcaption{margin-top:4px} small{color:#6f7c79}
.sep{width:1px;align-self:stretch;background:#ccd6d4;margin:0 8px}
p{font-size:13px;color:#45524f;max-width:820px}
</style></head><body>
<h1>Mlečni zobje — predogled obrisov</h1>
<p>Vir: Gray's Anatomy, 20. izdaja (1918), slika 1004 »Deciduous teeth. Left side.« — javna domena. Obrisi so izrisani iz gravure (senčenje izpuščeno); velikosti po povprečnih dolžinah krone in korenine (Wheeler). Desno, v istem merilu, nekaj stalnih zob iz obstoječe karte za primerjavo.</p>
<h2>Zgornja čeljust — desna stran (55–51) · leva stran (61–65)</h2>
<div class="row">${row(['55', '54', '53', '52', '51'], 'upper')}<span class="sep"></span>${row(['61', '62', '63', '64', '65'], 'upper')}<span class="sep"></span>${permRow(['11', '13', '16'], true)}</div>
<h2>Spodnja čeljust — desna stran (85–81) · leva stran (71–75)</h2>
<div class="row lower">${row(['85', '84', '83', '82', '81'], 'lower')}<span class="sep"></span>${row(['71', '72', '73', '74', '75'], 'lower')}<span class="sep"></span>${permRow(['41', '43', '46'], false)}</div>
</body></html>`;
fs.writeFileSync('preview.html', html);
console.log('preview.html written');
