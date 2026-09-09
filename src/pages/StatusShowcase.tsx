import { DentalChart } from '../components/chart/DentalChart';
import { StatusLegend } from '../components/ui/StatusLegend';
import type { SurfaceMap, PocketDepths, GumMargin, BleedingPoints, EndoStage } from '../types/dental';

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

// Dental post (zobni zatiček) demo — one per arch, so both line directions
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

// Endodontic treatment (kanal) — no longer a ToothStatus (see EndoStage in
// types/dental.ts), so it's threaded independently here too, the same way
// MOCK_POST is. Preserves the exact same demo pairings the old
// endo/endo_planned/endo_existing statuses used: 33/36 combine endo with
// per-surface caries overrides in MOCK_SURFACES below (proving the two now
// genuinely coexist, not just "surfaces.all didn't happen to conflict");
// 34/47 are isolated planned/done circles; 22 is the isolated existing
// (grey) state.
const MOCK_ENDO: Record<string, EndoStage> = {
  22: 'existing',
  33: 'planned',
  34: 'planned',
  36: 'done',
  47: 'done',
};

// Illustrative surface statuses for the full "Cela karta" demo — a light
// scattering across all four quadrants, not one-per-status (that's what the
// EXAMPLES list below is for). Includes both abrasion cases (24 posterior,
// 23 anterior) so the bowtie/hollow-box marks are visible in context;
// implant fixture rendering (21); a 45-44-43 bridge anchored on two natural
// crowns; and a 15-14-13 bridge anchored on crowns at both ends too — both
// demos deliberately use the SAME anchor type at both ends (crown+crown),
// per Monika's explicit clinical correction: a bridge with two anchors
// must match, crown+crown or implant+implant, never one of each ("fixing
// bridge on crown on one side and implant on the other is a professional
// mistake") — enforced by both handleCreateBridge (PatientChart.tsx, at
// creation time) and findBridgeGroups's own anchorTypesMatch check
// (BridgeRow.tsx, re-validated live). A bridge only needs ONE anchor to
// exist at all, though — a cantilever (one anchor, no anchor at the far
// end) is a real clinical case and has nothing to mismatch against, since
// the type-matching rule only applies once there are two anchors to
// compare; three adjacent prosthesis teeth (31, 32, 41) to
// check the tloris circle-swap both in isolation and side-by-side across
// the midline divider, plus 42 next to 41 as a prosthesis_crown — a
// natural crowned tooth anchoring the same prosthesis, connected by the
// identical line but rendered as a completely ordinary crown, not a
// circle+X; both endodontic states side by side — 47 done (blue circle,
// isolated) and 34 still needed/in progress (red circle, isolated) — so
// the two colors of the same endo-circle symbol are visible together; and
// two teeth combining an independent endo-circle (MOCK_ENDO, below — no
// longer a ToothStatus, see EndoStage) with per-surface caries dots on
// every surface, one of each endo state — 33 (root canal still needed,
// red circle) and 36 (root canal already done, blue circle) — per
// Monika's explicit request that a tooth needing a root canal can show
// that alongside its own caries. This now demonstrates real coexistence,
// not just non-conflicting slots: 33/36 have no `all` entry in
// MOCK_SURFACES at all anymore, just per-surface 'caries' overrides — the
// endo-circle comes entirely from MOCK_ENDO, independent of surfaces.
// Plus one fully caries-treated tooth (25, blue) with no endo involvement,
// alongside 16's single whole-tooth caries case, so the per-surface dot
// marker (not a flat fill) reads clearly in context for both states, on
// its own and combined with a whole-tooth symbol. 48 (a real third molar —
// the classic clinically-impacted tooth) is 'impacted', replacing what used
// to be a third implant example there — see its own dedicated comment at
// its entry below, and "Impacted tooth" in CLAUDE.md for the full
// PerioGraphRow submerge/clip behavior this exercises.
// 17/35/37 demo the three fissure-sealant states (sealant_existing/
// sealant_planned/sealant) — a real ToothStatus set now, not a separate
// independent field, per Monika's explicit clinical correction: sealant
// and a status like implant are not compliant services on the same tooth,
// so there was never a valid case for combining them (the earlier
// implant+sealant demo on 21/37 was actually clinically wrong). 37 was
// implant before this change; converting it to `sealant` (done) leaves
// only 21 demonstrating the implant fixture rendering — a real reduction
// in tooth-shape coverage for that feature, accepted since implant
// rendering is settled and unlikely to regress, unlike this new status set.
const MOCK_SURFACES: Record<string, SurfaceMap> = {
  // A bridge anchor is just a plain `crown` (there's no separate
  // `bridge_anchor` status anymore — see `isAnchorStatus()` in
  // BridgeRow.tsx), so 13/15/43/45 below are indistinguishable from any
  // other crowned tooth on their own. The bracket itself no longer comes
  // from these statuses alone, though — BridgeRow only draws it for teeth
  // explicitly grouped together via MOCK_BRIDGE_GROUPS below (mirroring
  // handleCreateBridge in PatientChart.tsx — see BridgeRow.tsx's own
  // history comment for why purely status-driven detection was dropped).
  13: { all: 'crown' },
  14: { all: 'bridge_pontic' },
  15: { all: 'crown' },
  16: { all: 'caries' },
  // Fissure sealant, existing (grey) — see the dedicated comment above
  // MOCK_SURFACES for the other two states (37, 35).
  17: { all: 'sealant_existing' },
  21: { all: 'implant' },
  23: { all: 'abrasion' },
  24: { all: 'abrasion' },
  25: { all: 'caries_treated' },
  26: { all: 'crown' },
  // 33 still needs a root canal (MOCK_ENDO[33] = 'planned' — red circle,
  // set independently below) and also has caries on every one of its own
  // surfaces (anterior tooth, so just b/l/m/d, no 'o') — no `all` entry
  // here at all anymore, just the per-surface overrides, since the
  // endo-circle no longer comes from surfaces.all.
  33: { b: 'caries', l: 'caries', m: 'caries', d: 'caries' },
  // 34's root canal (still needed — red circle) is entirely MOCK_ENDO[34],
  // so it has no SurfaceMap entry here at all.
  // Fissure sealant, planned (red) — see the dedicated comment above
  // MOCK_SURFACES for the other two states (17, 37).
  35: { all: 'sealant_planned' },
  // 36 already had a root canal (MOCK_ENDO[36] = 'done' — blue circle, set
  // independently below, same reasoning as 33 above) and also has caries
  // on every surface (posterior, so b/o/l/m/d all included).
  36: { b: 'caries', o: 'caries', l: 'caries', m: 'caries', d: 'caries' },
  // Fissure sealant, done state — see the dedicated comment above
  // MOCK_SURFACES for why this replaced an implant demo here.
  37: { all: 'sealant' },
  42: { all: 'prosthesis_crown' },
  43: { all: 'crown' },
  44: { all: 'bridge_pontic' },
  45: { all: 'crown' },
  // 47's root canal (done — blue circle) is entirely MOCK_ENDO[47], so it
  // has no SurfaceMap entry here at all.
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
  // sealant tilde) instead of red/blue. 22's root canal is entirely
  // MOCK_ENDO[22] now, so it has no SurfaceMap entry here at all.
  27: { all: 'overlay_existing' },
};

// Explicit fdi → bridge-group-id map — mirrors handleCreateBridge in
// PatientChart.tsx (select an existing anchor together with its pontics,
// then click "Člen mostu"): BridgeRow no longer draws a bracket from
// crown/implant/bridge_pontic statuses alone, so without an entry here
// 13/14/15 and 43/44/45 above would just show as an ordinary crown, a
// crossed-out pontic square, and another ordinary crown, with no bracket
// connecting them. Group ids only need to be distinct from one another;
// their value has no meaning beyond that.
const MOCK_BRIDGE_GROUPS: Record<string, string> = {
  13: 'demo-13-15',
  14: 'demo-13-15',
  15: 'demo-13-15',
  43: 'demo-43-45',
  44: 'demo-43-45',
  45: 'demo-43-45',
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
          endoByFdi={MOCK_ENDO}
          bridgeGroupByFdi={MOCK_BRIDGE_GROUPS}
        />
      </div>

      <div className="rounded-md border border-[var(--line,#ccd6d4)] bg-[var(--surface,#fff)] p-6">
        <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--muted,#6f7c79)]">Legenda</p>
        <StatusLegend />
      </div>
    </div>
  );
}
