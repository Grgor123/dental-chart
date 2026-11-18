// Three-rooted upper molar (roots up): draw the two FRONT roots' inner edges
// continuing past the notches, over the middle root, down to where they meet
// in a U — as on the permanent molars (e.g. 16). The middle root's own outline
// then ends at those edges (a T-junction), which reads as "behind". The U is a
// quadratic curve whose ends follow each front root's measured edge direction,
// so the edges carry on smoothly (Gregor, 2026-11-13).
module.exports = function furcationCurve(mask, mw, mh) {
  const filled = (x, y) => x >= 0 && y >= 0 && x < mw && y < mh && mask[y * mw + x];
  // Top profile → notches (deepest gaps between the roots).
  const top = new Array(mw).fill(mh);
  for (let x = 0; x < mw; x++) for (let y = 0; y < mh; y++) if (mask[y * mw + x]) { top[x] = y; break; }
  const s = top.map((_, x) => {
    let sum = 0, n = 0;
    for (let k = x - 3; k <= x + 3; k++) if (k >= 0 && k < mw && top[k] < mh) { sum += top[k]; n++; }
    return n ? sum / n : mh;
  });
  const cands = [];
  for (let x = Math.round(mw * 0.12); x < Math.round(mw * 0.88); x++) {
    if (s[x] >= mh) continue;
    let isMax = true;
    for (let k = x - 6; k <= x + 6; k++) if (k !== x && k >= 0 && k < mw && s[k] > s[x]) { isMax = false; break; }
    if (isMax) cands.push({ x, y: s[x] });
  }
  cands.sort((a, b) => b.y - a.y);
  const first = cands[0];
  const second = cands.find((c) => Math.abs(c.x - first.x) > mw * 0.2);
  if (!first || !second) return null;
  const [L, R] = first.x < second.x ? [first, second] : [second, first];

  // Fit x = a*y + b to a front root's inner edge just above its notch:
  // from the notch, walk outward through the gap to the root's edge.
  function edge(notch, dir) {
    const ys = [], xs = [];
    for (let y = Math.round(notch.y) - 42; y <= Math.round(notch.y) - 6; y += 2) {
      let x = Math.round(notch.x);
      while (x > 0 && x < mw - 1 && !filled(x, y)) x += dir;
      if (filled(x, y) && Math.abs(x - notch.x) < mw * 0.35) { ys.push(y); xs.push(x); }
    }
    if (ys.length < 4) return null;
    const my = ys.reduce((p, v) => p + v, 0) / ys.length, mx = xs.reduce((p, v) => p + v, 0) / xs.length;
    let num = 0, den = 0;
    ys.forEach((y, i) => { num += (y - my) * (xs[i] - mx); den += (y - my) ** 2; });
    const a = den ? num / den : 0;
    return { a, b: mx - a * my };
  }
  const eL = edge(L, -1); // left front root: walk left
  const eR = edge(R, +1); // right front root: walk right
  // Start points: on each front root's edge line at the notch's height.
  const start = (e, n) => (e ? [e.a * n.y + e.b, n.y] : [n.x, n.y]);
  const p0 = start(eL, L), p2 = start(eR, R);
  const span = p2[0] - p0[0];
  const lowest = Math.max(p0[1], p2[1]);
  // Control point: where the two edge lines meet (they converge downward).
  let ctrl = null;
  if (eL && eR && eL.a !== eR.a) {
    const y = (eR.b - eL.b) / (eL.a - eR.a);
    if (y > lowest + span * 0.25) ctrl = [eL.a * y + eL.b, Math.min(y, lowest + span * 0.9)];
  }
  if (!ctrl) ctrl = [(p0[0] + p2[0]) / 2, lowest + span * 0.6];
  const pts = [];
  for (let t = 0; t <= 1.0001; t += 0.005) {
    const u = 1 - t;
    pts.push([u * u * p0[0] + 2 * u * t * ctrl[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * ctrl[1] + t * t * p2[1]]);
  }
  // Also extend each front edge a little ABOVE the notch (it continues the
  // root's own outline down to the curve without a gap).
  return { a: { x: Math.min(p0[0], L.x), y: L.y }, b: { x: Math.max(p2[0], R.x), y: R.y }, pts, L, R };
};
