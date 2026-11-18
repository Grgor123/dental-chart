# Deciduous (milk) teeth — side-view drawings

Source: **Gray's Anatomy, 20th edition (1918), Fig. 1004 "Deciduous teeth. Left side."** —
public domain (published before 1931; see
https://commons.wikimedia.org/wiki/File:Gray1004.png). Traced from the archive.org scan of
page 1118 (https://archive.org/details/anatomyofhumanbo1918gray), not from any other image.

Output: `src/data/tracedDeciduousTeeth.json` — `{ "<fdi>": { d, detailD, width, height } }`,
same shape as `tracedTeeth.json`. The figure shows the left side, so the upper row is 61–65 and
the lower 71–75; 51–55 and 81–85 are mirror images.

Pipeline (Node, `npm i jimp@0.22.12 potrace@2.1.8`; the page image as `dl/p1118.jpg`):

1. `node trace.js` — silhouettes: background flood fill after closing outline gaps, the 10
   largest components → `labels.bin`, `components.json`.
2. `node lines.js 155 40` — the engraving's long ink strokes inside each tooth (hatching dropped).
3. `SRC=lines.bin node clean.js 45 1.6` — each stroke reduced to one smooth, even line
   (`features.bin`).
4. `LINES=features.bin node trace2.js` — potrace: `d` = silhouette; `detailD` = outline set inside
   the edge (THICK 6) + feature lines away from the edge + for the three-rooted upper molars
   (64/65) the front roots' contour over the middle root and sharp V gaps (`furcation.js`).
5. `node preview.js` / `node render.js out.png 64:milk 16:perm …` — previews.

Style choices (Gregor, 2026-11-13): thick outline like the permanent teeth, no shading, inner
lines only where the engraving has them, middle root of upper molars drawn behind the front two.
