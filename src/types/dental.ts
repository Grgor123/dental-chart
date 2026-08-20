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
  | 'endo'           // endodontsko zdravljenje (kanal) — dokončano
  | 'endo_planned'   // endodontsko zdravljenje — potrebno / v teku
  | 'endo_existing'  // endodontsko zdravljenje — obstoječe (pred spremljanjem)
  | 'implant'
  | 'abrasion'       // abrazija
  | 'overlay_planned'  // predviden overlay
  | 'overlay'          // overlay — dokončan
  | 'overlay_existing'  // overlay — obstoječ (pred spremljanjem)
  | 'extraction_planned'  // predvidena ekstrakcija — zob še prisoten
  | 'extracted'      // ekstrahiran — zob odstranjen
  | 'missing'        // manjkajoč (ni bil prisoten)
  | 'impacted'        // impaktiran (neizrastel)
  | 'prosthesis'         // zob v protezi (odstranljiva proteza, ne naravni zob)
  | 'prosthesis_crown';  // naravni zob s krono, nosilec proteze (proteza na kroni)

// Surface-level status map
export type SurfaceMap = Partial<Record<Surface, ToothStatus>> & { all?: ToothStatus };

// Pocket depths: [mesial, mid, distal] in mm
export type PocketDepths = [number, number, number];

// Gingival margin position relative to CEJ: [mesial, mid, distal] in mm.
// 0 = at the CEJ. Negative = receded apical to CEJ (root exposed — the
// common case, and what "luščenje - glajenje" is tracked against).
// Positive = gum sits coronal to CEJ (covering some crown).
export type GumMargin = [number, number, number];

// Bleeding on probing (BOP): [mesial, mid, distal], one flag per probing
// point — same 3 points as PocketDepths, tracked per surface like pockets
// and gum margin, since BOP is clinically meaningful on both.
export type BleedingPoints = [boolean, boolean, boolean];

// Fissure-sealant lifecycle — same three-stage model as endo_existing/
// endo/endo_planned and overlay_existing/overlay/overlay_planned:
// 'existing' (grey) marks one already there before this practice started
// tracking it, 'planned' (red) one still to be placed, 'done' (blue) one
// just placed. Kept as its own field rather than folded into ToothStatus
// (see ToothData.sealant below) — a plain three-value type, not a new
// ToothStatus, for the same reason it was a boolean before: it needs to
// combine freely with whatever else is going on for that tooth.
export type SealantStage = 'planned' | 'done' | 'existing';

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
  canal?: boolean;
  post?: boolean;  // zobni kolček (zatič) — vstavljen v koreninski kanal
  sealant?: SealantStage;  // zalitje fisur — zaščitni premaz na okluzalni ploskvi
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
  sex: 'M' | 'F' | 'other';
  diagnoses: string[];
  visits: VisitRecord[];
}
