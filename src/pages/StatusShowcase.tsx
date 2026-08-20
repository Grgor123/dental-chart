import { DentalChart } from '../components/chart/DentalChart';
import { StatusLegend } from '../components/ui/StatusLegend';
import type { SurfaceMap, PocketDepths, GumMargin, BleedingPoints, SealantStage } from '../types/dental';

// No 'perio' status — periodontal disease is now shown directly by the
// pocket-depth/gum-margin numbers and gumline below, not a flat tooth
// color, per feedback that the two would be redundant.

// Illustrative probing-depth readings — not real patient data. Separate
// buccal (vestibular) and lingual/palatal (oral) sets, on purpose slightly
// different from each other per tooth, so it's obvious the two number rows
// really are two independent readings and not the same value duplicated.
// 48 has no entry — it's the impacted-tooth demo below (MOCK_SURFACES),
// unerupted and with nothing measurable to probe.
const MOCK_POCKETS_BUCCAL: Record<string, PocketDepths> = {
  11: [2, 2, 2], 12: [2, 3, 2], 13: [2, 2, 3], 14: [3, 2, 2], 15: [2, 2, 2], 16: [3, 4, 3], 17: [2, 3, 2], 18: [2, 2, 2],
  21: [2, 2, 3], 22: [2, 2, 2], 23: [3, 2, 2], 24: [2, 3, 2], 25: [2, 2, 2], 26: [3, 4, 3], 27: [2, 3, 5], 28: [2, 2, 2],
  31: [2, 2, 2], 32: [2, 2, 2], 33: [2, 2, 3], 34: [3, 2, 2], 35: [2, 2, 2], 36: [4, 3, 2], 37: [2, 2, 2], 38: [2, 2, 2],
  41: [2, 2, 2], 42: [2, 2, 2], 43: [3, 2, 2], 44: [2, 2, 3], 45: [2, 2, 2], 46: [3, 3, 4], 47: [2, 2, 2],
};

const MOCK_POCKETS_LINGUAL: Record<string, PocketDepths> = {
  11: [2, 2, 3], 12: [2, 2, 2], 13: [2, 3, 2], 14: [2, 2, 2], 15: [3, 2, 2], 16: [2, 3, 2], 17: [3, 2, 3], 18: [2, 2, 2],
  21: [2, 3, 2], 22: [2, 2, 2], 23: [2, 2, 2], 24: [3, 2, 2], 25: [2, 2, 3], 26: [2, 2, 4], 27: [2, 2, 2], 28: [2, 3, 2],
  31: [2, 2, 2], 32: [3, 2, 2], 33: [2, 2, 2], 34: [2, 2, 2], 35: [2, 3, 2], 36: [2, 4, 3], 37: [2, 2, 2], 38: [2, 2, 3],
  41: [2, 2, 2], 42: [2, 2, 2], 43: [2, 2, 2], 44: [3, 2, 2], 45: [2, 2, 2], 46: [2, 2, 3], 47: [2, 3, 2],
};

// Illustrative gum-margin readings (mm from CEJ; negative = recession) —
// again not real data. Mostly mild recession, plus one clearly pronounced
// example per arch (26, 36 — bumped to -4mm) so the recession case is
// unmistakable, not just a slight waver in the line.
// 48 has no entry either — see the pocket-depth maps' own note above; an
// impacted tooth has no gum margin to record, and PerioGraphRow forces a
// flat line there regardless (see its own "impacted" handling).
const MOCK_GUM_MARGIN: Record<string, GumMargin> = {
  11: [0, 0, 0], 12: [-1, 0, 0], 13: [-1, -1, 0], 14: [0, -1, 0], 15: [0, 0, -1], 16: [-2, -1, -2], 17: [-1, -1, 0], 18: [0, 0, -1],
  21: [-1, 0, -1], 22: [0, 0, 0], 23: [-1, -1, 0], 24: [0, -1, 0], 25: [0, 0, -1], 26: [-4, -3, -4], 27: [-1, -2, -1], 28: [0, 0, -1],
  31: [0, 0, 0], 32: [0, -1, 0], 33: [-1, 0, 0], 34: [0, 0, -1], 35: [0, 0, 0], 36: [-4, -4, -3], 37: [-1, -1, 0], 38: [0, 0, 0],
  41: [0, 0, 0], 42: [0, 0, 0], 43: [-1, 0, 0], 44: [0, -1, 0], 45: [0, 0, 0], 46: [-2, -2, -1], 47: [-1, -1, 0],
};

// Illustrative bleeding-on-probing (BOP) flags — a few points per arch,
// picked to line up with the higher pocket-depth readings above (bleeding
// correlates with deeper pockets clinically, so this reads as plausible
// rather than random).
const MOCK_BLEEDING_BUCCAL: Record<string, BleedingPoints> = {
  16: [false, true, true],
  36: [true, false, false],
};

const MOCK_BLEEDING_LINGUAL: Record<string, BleedingPoints> = {
  26: [false, false, true],
  46: [false, false, true],
};

// Dental post (zobni kolček) demo — one per arch, so both line directions
// (up on upper, down on lower) are visible. 26 (upper, crown) and 36
// (lower, already endo + caries) — a post commonly follows a root canal
// and supports a crown, so both are clinically plausible pairings, not
// arbitrary teeth. 13 (upper, crown — a bridge anchor, see MOCK_SURFACES)
// adds a post on a bridge anchor specifically — a post commonly supports
// a bridge abutment crown too — so the same quadrant has both a post AND
// a bridge bracket at once, exercising BridgeRow's `flip` (see
// ArchRow.tsx): without it, the post's own upward reach on the upper arch
// would collide with the bracket, since both used to sit on the tloris
// square's top edge.
const MOCK_POST: Record<string, boolean> = {
  13: true,
  26: true,
  36: true,
};

// Fissure sealant (zalitje fisur) demo. `sealant` used to be a plain
// boolean (always the grey "existing" look) before Monika's explicit
// request to extend the planned/done/existing pattern to it too, same as
// endo/overlay below. 17 (upper) and 35 (lower) keep their original
// 'existing' meaning, both otherwise unremarkable posterior teeth (no
// entry in MOCK_SURFACES, so plain `healthy`) — the most common
// real-world case, and still exercising both of BridgeRow's flip
// positions (above the tloris squares on the lower arch, below them on
// the upper). 21 and 37 (both `implant`, purple) add 'planned'/'done'
// sealant on top, to demonstrate the field's whole point: it combines
// freely with whatever else is going on for that tooth, rather than
// competing for the single surfaces.all slot.
const MOCK_SEALANT: Record<string, SealantStage> = {
  17: 'existing',
  35: 'existing',
  21: 'planned',
  37: 'done',
};

// Illustrative surface statuses for the full "Cela karta" demo — a light
// scattering across all four quadrants, not one-per-status (that's what the
// EXAMPLES list below is for). Includes both abrasion cases (24 posterior,
// 23 anterior) so the bowtie/hollow-box marks are visible in context; two
// implants (21, 37) so the fixture glyph's scaled and centered correctly
// across different tooth shapes; a 45-44-43 bridge anchored on two natural
// crowns; and a 15-14-13 bridge anchored on an implant (15) at one end and
// a natural crown (13) at the other, so
// BridgeRow's detection also covers implant-supported bridges, not just
// tooth-to-tooth ones; three adjacent prosthesis teeth (31, 32, 41) to
// check the tloris circle-swap both in isolation and side-by-side across
// the midline divider, plus 42 next to 41 as a prosthesis_crown — a
// natural crowned tooth anchoring the same prosthesis, connected by the
// identical line but rendered as a completely ordinary crown, not a
// circle+X; both endodontic states side by side — 47 done (blue circle,
// isolated) and 34 still needed/in progress (red circle, isolated) — so
// the two colors of the same endo-circle symbol are visible together; and
// two teeth combining a whole-tooth endo-circle with per-surface caries
// dots on every surface, one of each endo state — 33 (root canal still
// needed, red circle) and 36 (root canal already done, blue circle) — per
// Monika's explicit request that a tooth needing a root canal can show
// that alongside its own caries just like the done case already did.
// Works the same way for both: `surfaces.all` drives the whole-tooth
// symbol regardless of what any individual surface is overridden to, so
// every surface can be explicitly set to 'caries' without disturbing it.
// Plus one fully caries-treated tooth (25, blue) with no endo involvement,
// alongside 16's single whole-tooth caries case, so the per-surface dot
// marker (not a flat fill) reads clearly in context for both states, on
// its own and combined with a whole-tooth symbol. 48 (a real third molar —
// the classic clinically-impacted tooth) is 'impacted', replacing what used
// to be a third implant example there — see its own dedicated comment at
// its entry below, and "Impacted tooth" in CLAUDE.md for the full
// PerioGraphRow submerge/clip behavior this exercises.
const MOCK_SURFACES: Record<string, SurfaceMap> = {
  // A bridge anchor is just a plain `crown` (there's no separate
  // `bridge_anchor` status anymore — see `isBridgeAnchorStatus()` in
  // BridgeRow.tsx), so 13/43/45 below are indistinguishable from any other
  // crowned tooth on their own; the bracket appears automatically once
  // BridgeRow finds a valid crown/implant-pontic(s)-crown/implant run.
  13: { all: 'crown' },
  14: { all: 'bridge_pontic' },
  15: { all: 'implant' },
  16: { all: 'caries' },
  21: { all: 'implant' },
  23: { all: 'abrasion' },
  24: { all: 'abrasion' },
  25: { all: 'caries_treated' },
  26: { all: 'crown' },
  // 33 still needs a root canal (all: 'endo_planned' — red circle) and
  // also has caries on every one of its own surfaces (anterior tooth, so
  // just b/l/m/d, no 'o'), each explicitly overridden to 'caries' rather
  // than left to fall through to 'endo_planned' — the fallback rule
  // (statusFor) only reaches surfaces.all when a surface has no override
  // of its own.
  33: { all: 'endo_planned', b: 'caries', l: 'caries', m: 'caries', d: 'caries' },
  34: { all: 'endo_planned' },
  // 36 already had a root canal (all: 'endo' — keeps the blue circle,
  // same reasoning as 33 above) and also has caries on every surface
  // (posterior, so b/o/l/m/d all included).
  36: { all: 'endo', b: 'caries', o: 'caries', l: 'caries', m: 'caries', d: 'caries' },
  37: { all: 'implant' },
  42: { all: 'prosthesis_crown' },
  43: { all: 'crown' },
  44: { all: 'bridge_pontic' },
  45: { all: 'crown' },
  47: { all: 'endo' },
  31: { all: 'prosthesis' },
  32: { all: 'prosthesis' },
  41: { all: 'prosthesis' },
  46: { all: 'missing' },
  // Unerupted third molar — the real-world case 'impacted' models. No
  // pockets/gum-margin/bleeding entries exist for 48 in the mock maps
  // above; PerioGraphRow forces its gumline flat regardless, and there's
  // nothing to probe on a tooth that's never broken through the gum.
  48: { all: 'impacted' },
  // 18 is still fully present (normal white crown/grey root, full ink
  // detail) but flagged for removal — red X over an otherwise ordinary
  // tooth. 28 is already gone — flat light silhouette, blue X — so both
  // states of the extraction_planned/extracted pair are visible side by
  // side, same wing of the upper arch.
  18: { all: 'extraction_planned' },
  28: { all: 'extracted' },
  // 12 still needs its overlay (red cap, in BridgeRow's own row) and 11
  // already has one done (blue cap) — adjacent teeth, both states of the
  // pair visible side by side, same as the extraction_planned/extracted
  // pair above.
  12: { all: 'overlay_planned' },
  11: { all: 'overlay' },
  // 38 is on the lower arch (unlike 11/12), where BridgeRow paints
  // *before* TlorisRow in the DOM — the opposite paint order from the
  // upper arch — so this checks the overlay cap's wrap-onto-the-tooth
  // ends still show up correctly there too, not just where paint order
  // happens to favor them.
  38: { all: 'overlay' },
  // 22 and 27 demo the third ("existing") state Monika asked to add
  // alongside the planned/done pair, per service — a root canal or
  // overlay already present before this practice started tracking the
  // tooth, grey (STATUS_COLOR, the same grey as the bridge bracket and
  // sealant tilde) instead of red/blue.
  22: { all: 'endo_existing' },
  27: { all: 'overlay_existing' },
};

export function StatusShowcase() {
  return (
    <div className="mx-auto flex max-w-[1800px] flex-col gap-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--ink,#1c2624)]">Status barve in simboli — pregled</h1>
        <p className="mt-1.5 max-w-[65ch] text-sm text-[var(--ink-soft,#45524f)]">Začasna stran za pregled.</p>
      </div>

      <div className="rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-6">
        <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--muted,#6f7c79)]">
          Cela karta — sorazmerja iz anatomskih tabel + parodontalni graf, vse štiri kvadrante
        </p>
        <p className="mb-4 max-w-[70ch] text-xs leading-snug text-[var(--ink-soft,#45524f)]">
          Prikazani podatki so izmišljeni primeri, ne resnični. Globina žepka (PD) je zdaj prikazana z dveh strani
          zoba hkrati — ena vrsta številk nad ploščico tlorisa, ena pod njo (vestibularno/oralno, glede na čeljust)
          — obarvane rdeče ≥4mm, oranžno 3mm. Krvavitev ob sondiranju (BOP) obarva rob same točke rdeče in
          odebeljeno namesto tanke barve globine. Umik dlesni (REC, modro) ostaja ob stranskem pogledu, kjer se
          korenine končajo; polna oranžna črta v stranskem pogledu = dejanski rob dlesni glede na CEJ.
        </p>
        <DentalChart
          surfacesByFdi={MOCK_SURFACES}
          pocketsBuccal={MOCK_POCKETS_BUCCAL}
          pocketsLingual={MOCK_POCKETS_LINGUAL}
          gumMargin={MOCK_GUM_MARGIN}
          bleedingBuccal={MOCK_BLEEDING_BUCCAL}
          bleedingLingual={MOCK_BLEEDING_LINGUAL}
          postByFdi={MOCK_POST}
          sealantByFdi={MOCK_SEALANT}
        />
      </div>

      <div className="rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-6">
        <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--muted,#6f7c79)]">Legenda</p>
        <StatusLegend />
      </div>
    </div>
  );
}
