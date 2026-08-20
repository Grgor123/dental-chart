import type { ToothStatus } from '../types/dental';

export interface StatusStyle {
  /** Slovene label shown in the legend and detail panel */
  label: string;
  /** Fill color, or 'none' for an unfilled/outline-only status */
  fill: string;
  /** Border color override; defaults to the standard outline color when unset */
  border?: string;
  /** Dashed border, used for absent/planned-away teeth */
  borderDash?: boolean;
  /** Extra glyph drawn on top of the fill — see StatusSymbol components */
  symbol?: 'x-cross' | 'endo-circle';
  /**
   * Color for the `symbol` glyph, when it needs to differ from `border`
   * (the square/circle outline color) or from the per-file fallback used
   * when neither is set. `bridge_pontic` is the only status that sets
   * this today — its own `border` is unset (so its square outline falls
   * through to the default dark tooth-outline color already), and
   * `symbolColor` pins the cross to that same color explicitly, so it
   * doesn't depend on each file's own fallback color.
   */
  symbolColor?: string;
}

// Unified "still needs doing" / "already done" red and blue, shared by
// every two-state status pair on the chart: caries/caries_treated,
// endo/endo_planned, and extraction_planned/extracted. Each pair used to
// carry its own slightly different dedicated hex (the reasoning at the
// time being "a distinct clinical marker, not the same one repainted") —
// reverted per Monika's explicit request: red always means "to be done,"
// blue always means "done," the same two colors everywhere on the chart,
// so the dentist reads urgency/completion at a glance without having to
// remember which shade belongs to which feature. Exported so every file
// that draws a todo/done marker (ToothTopView.tsx, ToothSideView.tsx,
// StatusLegend.tsx) shares one source rather than duplicating literals.
export const TODO_COLOR = '#E94949';
export const DONE_COLOR = '#1412A9';

// Third leg of the same pattern: a "pre-existing / historical" marker —
// something already true about the tooth before this practice started
// tracking it (a crown or root canal done elsewhere years ago, say),
// distinct from something newly planned (red) or newly completed here
// (blue). Reuses the same grey `BridgeRow.tsx` already uses for the
// bridge bracket and fissure-sealant tilde (`BRACKET_COLOR` there is this
// same value) — per Monika's explicit request, rather than a fresh color,
// since that grey already reads as "neutral/status" on this chart.
// Exported for the same reason as TODO_COLOR/DONE_COLOR: every file that
// draws an existing/planned/done marker shares one source.
export const STATUS_COLOR = '#8a8f94';

// One deliberate deviation from the shared TODO_COLOR above: endo_planned's
// own circle (a thin 3px stroke, not a solid filled dot like caries') reads
// visibly lighter/more washed-out on screen than the same literal hex does
// on a filled shape, likely anti-aliasing/blending with the background at
// that stroke width — Monika flagged the on-screen color as "#E35656," a
// perceptibly pinker/lighter red than TODO_COLOR's own `#E94949`, once she
// checked it live. Rather than adjust TODO_COLOR itself (which would also
// shift caries' dot, extraction's X, overlay's cap, and sealant's tilde —
// all of which she confirmed read correctly as-is), this constant only
// overrides endo_planned's own symbolColor, compensating for that one
// symbol's own rendering context.
export const ENDO_PLANNED_COLOR = '#e24e4e';

// Shared by 'missing' and 'extracted' — both render as a flat, uniformly
// light-colored tooth outline in the side view (no crown/root color split,
// no ink line detail — see ToothSideView.tsx's isAbsentSilhouette) and as a
// borderless light square in the tloris view (ToothTopView.tsx), instead of
// a normal present tooth's appearance. Exported (rather than a literal in
// each StatusStyle.fill entry) so both view files and StatusLegend.tsx read
// the exact same value.
export const ABSENT_SILHOUETTE_COLOR = '#EBE9E3';

// Colors/borders below come directly from CLAUDE.md's "Status color palette"
// table. Two statuses exist in the ToothStatus type but weren't in that
// table (abrasion, impacted) — the values here are a first proposal for
// Monika to react to, not a finalized spec.
export const STATUS_STYLES: Record<ToothStatus, StatusStyle> = {
  healthy: { label: 'Zdrav', fill: 'none' },
  // Same three-state todo/done/existing pattern as endo/overlay below, all
  // rendered as a per-surface dot (drawn in ToothTopView.tsx, colored via
  // cariesDotColor() there — not through this style object, since
  // StatusStyle's `symbol` field is a whole-tooth concept and doesn't fit a
  // per-surface marker), per Monika's explicit request. `caries` is the
  // "still needs treatment" state (red dot, label extended to "Karies /
  // poka" — a fracture/crack is marked exactly the same way, see the
  // `fracture` removal note under "Status color palette" in CLAUDE.md);
  // `caries_treated` is the "just filled" state (blue dot, relabeled
  // "Plomba" — once treated, that surface simply *is* a filling now);
  // `filling` is the third leg — an existing restoration already there
  // before this practice started tracking the tooth (grey dot,
  // STATUS_COLOR), the same "pre-existing" role STATUS_COLOR plays for
  // endo_existing/overlay_existing below. `filling` used to be its own
  // flat white per-surface fill instead of a dot — changed to match the
  // other two once Monika pointed out a patient can come in with several
  // existing amalgam fillings that all need marking the same dot-driven
  // way caries/caries_treated already are, not a different mechanism.
  caries: { label: 'Karies / poka', fill: 'none' },
  caries_treated: { label: 'Plomba', fill: 'none' },
  filling: { label: 'Plomba (obstoječa)', fill: 'none' },
  crown: { label: 'Prevleka / krona', fill: '#9FE1CB' },
  // Endodontic treatment is now marked with a symbol — a plain circle
  // drawn inside the tooth's own tloris square (`endo-circle`, sized in
  // ToothTopView.tsx to match the same central ~16×16 area other special
  // symbols use), not a flat whole-tooth fill (was green, #C0DD97) —
  // per the doctor's revised spec, replacing the flat-fill approach the
  // same way extracted/missing/prosthesis already forgo a fill in favor
  // of a symbol. Blue circle = treatment done. Square outline itself
  // stays the default dark (`border` unset), same as an ordinary tooth —
  // only the circle carries the status color.
  endo: { label: 'Endodontsko zdravljenje (dokončano)', fill: 'none', symbol: 'endo-circle', symbolColor: DONE_COLOR },
  // The "not yet done / in progress" counterpart to `endo` above — same
  // circle-in-square symbol, red instead of blue. Two separate status
  // values (rather than one `endo` status plus a boolean flag, the
  // approach the earlier — since-removed — root-canal-line feature used)
  // because that's the same pattern already established for other
  // two-state pairs in this file (extracted/missing).
  endo_planned: { label: 'Endodontsko zdravljenje (potrebno / v teku)', fill: 'none', symbol: 'endo-circle', symbolColor: ENDO_PLANNED_COLOR },
  // Third state of the same pair: a root canal done before this practice
  // started tracking the tooth — grey instead of red/blue, per Monika's
  // explicit request to extend the missing/extraction "status vs.
  // to-be-done vs. done" pattern to the other treatment pairs on the chart.
  endo_existing: { label: 'Endodontsko zdravljenje (obstoječe)', fill: 'none', symbol: 'endo-circle', symbolColor: STATUS_COLOR },
  // Border unified to the same dark #1f1e20 every ordinary tooth's own
  // outline uses (was a saturated purple, #534AB7, paired with the fill)
  // — per Monika's explicit request extending the same square-outline
  // unification already done for extracted/missing/bridge_pontic/
  // prosthesis to implant too. Fill stays its own purple (#CECBF6,
  // untouched) — only the outline changed.
  implant: { label: 'Implantat', fill: '#CECBF6', border: '#1f1e20' },
  // Unfilled, solid (not dashed) square with a plain x-cross — and no
  // crown or root drawn at all in the side view (see ToothSideView.tsx's
  // hidesRoot/isPontic checks) — matching Monika's reference chart: a
  // pontic has no natural tooth structure at all ("brez korenine"). Went
  // through several looks against Monika's feedback each time: a dense
  // diagonal cross-hatch fill, then a dashed square with a red-by-default
  // cross (the fallback color every other x-cross status overrides but
  // this one didn't set), then grey — all reverted in favor of the same
  // dark color every ordinary tooth's own outline uses. `symbolColor` is
  // set explicitly here (rather than left to fall through to `border`,
  // which is itself unset) so the cross reliably matches that color in
  // both `ToothTopView.tsx` and `StatusLegend.tsx`, rather than depending
  // on each file's own (inconsistent) fallback-when-nothing-set color.
  bridge_pontic: { label: 'Člen mostu', fill: 'none', symbol: 'x-cross', symbolColor: '#1f1e20' },
  // Overlay — a partial-crown restoration covering the cusps. No fill or
  // symbol of its own in either the tloris or side view (the tooth's own
  // per-surface findings stay visible, unaffected — same reasoning as
  // extraction_planned below); it's marked entirely by a "[" -shaped cap
  // clipped onto the tooth in BridgeRow's own row (see "Bridge display"
  // in CLAUDE.md), the same shared gap the bridge bracket and sealant
  // tilde already use. `symbolColor` is set here even though nothing in
  // this file's own generic symbol rendering reads it (STATUS_STYLES.
  // overlay*.symbol is unset) — it's BridgeRow.tsx's own source of truth
  // for the cap's color, kept alongside every other status's color field
  // rather than duplicated as a literal there. Same red-todo/blue-done
  // pattern and the same two shared colors as caries/caries_treated,
  // endo/endo_planned, and extraction_planned/extracted.
  overlay_planned: { label: 'Overlay (predviden)', fill: 'none', symbolColor: TODO_COLOR },
  overlay: { label: 'Overlay', fill: 'none', symbolColor: DONE_COLOR },
  // Third state of the same pair — an overlay already present before this
  // practice started tracking the tooth, same reasoning as endo_existing
  // above.
  overlay_existing: { label: 'Overlay (obstoječ)', fill: 'none', symbolColor: STATUS_COLOR },
  // Still physically present — a real tooth with its normal fill/border/
  // detail — flagged for removal with a red X on top. No fill override
  // (stays 'none' so per-surface findings underneath still show normally,
  // same as a present tooth would), no border override, no borderDash:
  // the tooth itself looks completely ordinary except for the cross. The
  // "not yet done" counterpart to `extracted` below — same red-todo/
  // blue-done pattern as caries/caries_treated and endo/endo_planned, and
  // (per Monika's explicit request) the exact same two colors, not just
  // the same pattern.
  extraction_planned: { label: 'Za ekstrakcijo', fill: 'none', symbol: 'x-cross', symbolColor: TODO_COLOR },
  // Physically gone: a flat, uniformly light silhouette (no crown/root
  // split, no ink detail — ABSENT_SILHOUETTE_COLOR, shared with `missing`
  // below) with a blue X on top marking that this position *used to* have
  // a tooth, unlike `missing` (never present, no symbol at all). No
  // border/borderDash — previously a dashed dark square + dark X (matching
  // `missing`'s old look), reverted per Monika's explicit request in favor
  // of this lighter, symbol-distinguished treatment for both views.
  extracted: { label: 'Ekstrahiran', fill: ABSENT_SILHOUETTE_COLOR, symbol: 'x-cross', symbolColor: DONE_COLOR },
  // Never present at all — the same flat light silhouette as `extracted`
  // (ABSENT_SILHOUETTE_COLOR), but with no symbol: nothing was ever there
  // to cross out. Previously a dashed dark square + dark X matching
  // `extracted`'s old look — reverted per Monika's explicit request; see
  // ToothTopView.tsx/ToothSideView.tsx for the shared isAbsentSilhouette
  // handling both statuses lean on.
  missing: { label: 'Manjkajoč', fill: ABSENT_SILHOUETTE_COLOR },
  // Proposed — not in CLAUDE.md's original color table. Abrasion doesn't
  // fill like the other statuses — ToothTopView renders it as a red mark on
  // just the incisal edge (anterior) or occlusal surface (posterior), the
  // traditional paper-chart convention for tooth wear, so this fill color
  // only shows up there (and in the flat legend swatch), never as a
  // whole-tooth tint.
  abrasion: { label: 'Abrazija', fill: '#9D1616' },
  impacted: { label: 'Impaktiran', fill: '#D8D5CC', borderDash: true },
  // Removable-denture tooth ("proteza") — not a natural tooth at all, so it
  // gets its own shape (a circle, not the usual square) in the tloris view
  // rather than a fill color; see ToothTopView.tsx's isProsthesis handling.
  // Border explicitly set to the same dark color every ordinary tooth's
  // outline/divider lines use (ToothTopView.tsx's BORDER constant) rather
  // than left to default — per Monika's feedback that the circle should
  // match a normal tooth's outline color, not stand out grey like
  // 'missing'. The X-cross glyph shares this same color (both read it off
  // wholeStyle.border), so it changes along with the circle.
  prosthesis: { label: 'Proteza', fill: 'none', symbol: 'x-cross', border: '#1f1e20' },
  // A natural tooth with its own crown that also anchors/participates in a
  // prosthesis — per Monika's explicit request, renders as a completely
  // ordinary `crown` tooth: same teal fill, no circle, no symbol, and (like
  // `crown` itself — see FLAT_INNER_STATUSES in ToothTopView.tsx) a flat
  // whole-square fill with no per-surface triangle subdivisions. The one
  // thing that *is* special-cased is that it's included in the same
  // connector-line grouping `prosthesis` teeth get (see
  // `isProsthesisLink()` in TlorisRow.tsx) — so a crowned tooth sitting
  // next to a removable-denture tooth still gets joined to it by the same
  // line, unlike a plain bridge-anchor `crown` (visually identical but
  // belongs to `BridgeRow`'s separate bracket-over-a-run mechanism
  // instead — see `isBridgeAnchorStatus()` there).
  prosthesis_crown: { label: 'Krona (nosilec proteze)', fill: '#9FE1CB' },
};
