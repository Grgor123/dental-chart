// Surface keys
export type PostSurface = 'b' | 'o' | 'l' | 'm' | 'd';   // bukalna, okluzalna, lingvalna, mezialna, distalna
export type AntSurface  = 'b' | 'l' | 'm' | 'd';          // labialna, lingvalna, mezialna, distalna
export type Surface = PostSurface | AntSurface;

// Tooth type
export type ToothType = 'ant' | 'post';

// All possible statuses for a surface or whole tooth. No 'perio' entry —
// periodontal disease is represented directly by the pocket-depth/gum-
// margin numbers and gumline in the perio graph, not a flat status color;
// a color swatch would only ever be a coarser, redundant summary of data
// the graph already shows precisely.
export type ToothStatus =
  | 'healthy'
  | 'caries'          // karies / poka — še ni sanirano
  | 'caries_treated'  // plomba — pravkar sanirano
  | 'filling'        // plomba — obstoječa (pred spremljanjem)
  | 'crown'          // prevleka / krona — tudi sidro mostu ali proteze
  | 'bridge_pontic'  // člen mostu
  | 'implant'
  | 'abrasion'       // abrazija
  | 'overlay_planned'  // predviden overlay
  | 'overlay'          // overlay — dokončan
  | 'overlay_existing'  // overlay — obstoječ (pred spremljanjem)
  | 'sealant_planned'  // zalitje fisur — predvideno
  | 'sealant'          // zalitje fisur — opravljeno
  | 'sealant_existing'  // zalitje fisur — obstoječe (pred spremljanjem)
  | 'extraction_planned'  // predvidena ekstrakcija — zob še prisoten
  | 'extracted'      // ekstrahiran — zob odstranjen
  | 'missing'        // manjkajoč (ni bil prisoten)
  | 'impacted'        // impaktiran (neizrastel)
  | 'prosthesis'         // zob v protezi (odstranljiva proteza, ne naravni zob)
  | 'prosthesis_crown';  // naravni zob s krono, nosilec proteze (proteza na kroni)

// Surface-level status map
export type SurfaceMap = Partial<Record<Surface, ToothStatus>> & { all?: ToothStatus };

// Pocket depths: [mesial, mid, distal] in mm. Each point is individually
// `null` until entered — click-to-focus/type-a-number entry (PatientChart.tsx)
// fills one point at a time (mesial, then mid, then distal, auto-advancing),
// so a tooth mid-entry, or one only ever partly probed, genuinely has some
// points set and others not — a plain `number` per slot couldn't represent
// that. `null`, not `undefined`, specifically: the outer `Record<string, ...>`
// lookup already uses a missing key/`undefined` to mean "this tooth has no
// entry at all" (see PocketDepthRow's own `pockets?.[fdi]`), so `null` here
// unambiguously means "this tooth has *some* data, but not this point."
export type PocketDepths = [number | null, number | null, number | null];

// Gingival margin position relative to CEJ: [mesial, mid, distal] in mm.
// 0 = at the CEJ. Negative = receded apical to CEJ (root exposed — the
// common case, and what "luščenje - glajenje" is tracked against).
// Positive = gum sits coronal to CEJ (covering some crown). Same per-point
// `null`-until-entered shape as PocketDepths above, for the same reason.
export type GumMargin = [number | null, number | null, number | null];

// Bleeding on probing (BOP): [mesial, mid, distal], one flag per probing
// point — same 3 points as PocketDepths, tracked per surface like pockets
// and gum margin, since BOP is clinically meaningful on both.
export type BleedingPoints = [boolean, boolean, boolean];

// Endodontic treatment lifecycle — same three-stage model as
// overlay_planned/overlay/overlay_existing and the sealant statuses:
// 'planned' (red) still needs doing / in progress, 'done' (blue) just
// completed, 'existing' (grey) a root canal already done before this
// practice started tracking the tooth. Kept independent of ToothStatus
// (see ToothData.endo below) rather than folded into it — per Monika's
// explicit request that endodontic treatment combine freely with whatever
// else is going on for that tooth (a filling and a completed root canal on
// the same tooth at once, say), which the old endo/endo_planned/
// endo_existing statuses couldn't do since they competed with every other
// status for the single surfaces.all slot. Supersedes the older, unused
// `canal` boolean this field replaces.
export type EndoStage = 'planned' | 'done' | 'existing';

// Single tooth data
export interface ToothData {
  toothId: string;              // FDI number as string: '11', '36', etc.
  type: ToothType;
  surfaces: SurfaceMap;
  pockets: {
    buccal: PocketDepths;
    lingual: PocketDepths;
  };
  gumMargin?: {
    buccal: GumMargin;
    lingual: GumMargin;
  };
  bleeding?: {
    buccal: BleedingPoints;
    lingual: BleedingPoints;
  };
  furcation?: 0 | 1 | 2 | 3;
  mobility?: 0 | 1 | 2 | 3;
  endo?: EndoStage;  // endodontsko zdravljenje (kanal) — see EndoStage above
  post?: boolean;  // zobni zatiček — vstavljen v koreninski kanal
  notes?: string;
  rootCount: number;
}

// Visit record
export interface VisitRecord {
  visitId: string;
  patientId: string;
  date: string;                 // ISO date
  dentistId: string;
  teeth: ToothData[];
  notes?: string;
  treatmentPlanned?: TreatmentEntry[];
  treatmentCompleted?: TreatmentEntry[];
}

// Treatment entry
export interface TreatmentEntry {
  toothId: string;
  surface?: Surface[];
  procedure: string;
  priceEur?: number;
  status: 'planned' | 'completed';
  date?: string;
}

// Patient
export interface Patient {
  patientId: string;
  firstName: string;
  lastName: string;
  dob: string;                  // ISO date
  sex: 'M' | 'F';                // per Monika's explicit request, only these two are offered — no 'other' option
  phone?: string;
  email?: string;
  // Address split into three fields — street (+ house number), postal
  // code, city — rather than one free-text line, per Monika's explicit
  // request. (Checked the sibling "dental calendar" booking app first —
  // its own intake form doesn't collect a postal address at all, only
  // name/phone/email/reason, so there was no existing convention to
  // match; this three-way split is this app's own.)
  address?: string;      // street + house number, e.g. "Slovenska cesta 15"
  postalCode?: string;   // e.g. "1000"
  city?: string;         // e.g. "Ljubljana"
  // Št. zdravstvene kartice (ZZZS) — captured at patient creation for
  // future use only; nothing in the app reads or validates this yet (see
  // CLAUDE.md's "Out of Scope for Phase 1" — eZdravje/ZZZS integration is
  // a later phase). Kept as a plain free-text string rather than a
  // validated card-number format, since that format isn't needed for
  // anything yet either.
  healthCardNumber?: string;
  diagnoses: string[];
  visits: VisitRecord[];
}
