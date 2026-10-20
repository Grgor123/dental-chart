import type { EndoStage, Surface, ToothStatus } from '../../types/dental';
import { ALL_FDI, LOWER_LEFT, LOWER_RIGHT, TOOTH_META, UPPER_LEFT, UPPER_RIGHT } from '../../data/toothMeta';

// Voice entry for the dental chart: one recognised phrase (Slovene, from the
// browser's speech recognition) → chart commands. Pure, no React — the chart
// page applies the commands through the same state as clicks and typing.
//
// Vocabulary (diacritics optional, numbers as digits or Slovene words):
//   36 karies mezialno okluzalno · 17 krona · 46 manjka · 24 endo opravljeno
//   25 zatiček · 16 bukalno 3 2 4 krvavitev · 16 lingvalno 2 2 3
//   3 2 4 (after a perio entry: the next tooth, same side) · naslednji
//   16 recesija 2 1 2 · 36 opomba občutljiv na mraz · razveljavi · konec
// Several teeth: "14 in 12 krona" (both), "36 karies 37 krona" (one each).
// Bridges: "most od 14 do 12", "14 in 12 povezana v mostiček".

export type PerioSide = 'buccal' | 'lingual';
type Triple<T> = [T, T, T];

export type VoiceCommand =
  /** amend: completes the previous phrase's finding ("23 plomba" … "mezialno"). */
  | { kind: 'status'; fdi: string; status: ToothStatus; surfaces: Surface[]; label: string; amend?: boolean }
  | { kind: 'endo'; fdi: string; stage: EndoStage; label: string }
  | { kind: 'post'; fdi: string; on: boolean; label: string }
  | { kind: 'pocket'; fdi: string; side: PerioSide; values: Triple<number | null>; bleeding: Triple<boolean> | null; label: string }
  | { kind: 'recession'; fdi: string; values: Triple<number | null>; label: string }
  | { kind: 'note'; fdi: string; text: string; label: string }
  | { kind: 'select'; fdi: string; label: string }
  /** The teeth named; the chart resolves anchors and pontics (bridgeRange). */
  | { kind: 'bridge'; fdis: string[]; label: string }
  | { kind: 'undo'; label: string }
  | { kind: 'stop'; label: string }
  /** Shown in the panel; changes nothing ("23 bukalno — povejte globine"). */
  | { kind: 'info'; label: string };

export interface VoiceContext {
  /** The tooth later commands without a number apply to. */
  currentFdi: string | null;
  /** The last perio entry — bare numbers continue with the next tooth. */
  /** pending: the side was named without numbers — the next three numbers go
   *  to this same tooth, not the next one. */
  lastPerio: { fdi: string; side: PerioSide; pending?: boolean } | null;
  /** The last filling/caries finding — a phrase with only surfaces completes it
   *  (the browser often splits "23 plomba … mezialno" at a short pause). The
   *  caller expires it after a few seconds. */
  lastFinding?: { fdis: string[]; status: ToothStatus } | null;
  /** "36 recesija" without numbers: the next numbers are its millimetres. */
  pendingRecession?: string | null;
}

export interface VoiceParseResult {
  commands: VoiceCommand[];
  /** Words that weren't understood (shown to the user). */
  unknown: string[];
  /** The single words among them, as heard — clickable to teach (voice_aliases). */
  unknownWords: string[];
  context: VoiceContext;
}

/** What a misheard word can be taught to mean (voice_aliases.meaning). */
export const ALIAS_MEANINGS: { group: string; words: string[] }[] = [
  { group: 'Izvid', words: ['karies', 'plomba', 'krona', 'implantat', 'manjka', 'ekstrakcija', 'ekstrahiran', 'abrazija', 'impaktiran', 'zdrav', 'proteza', 'overlay', 'zalitje', 'endo', 'zatiček', 'most'] },
  { group: 'Ploskev', words: ['mezialno', 'distalno', 'okluzalno', 'bukalno', 'lingvalno'] },
  { group: 'Stanje', words: ['predvideno', 'opravljeno', 'obstoječe'] },
  { group: 'Parodontologija', words: ['krvavitev', 'recesija', 'naslednji'] },
  { group: 'Ukaz', words: ['zob', 'opomba', 'razveljavi', 'konec'] },
  { group: 'Drugo', words: ['prezri'] },
];

/** The key a heard word is stored under (lower case, no č/š/ž). */
export function aliasKey(heard: string): string {
  return fold(heard.trim()).replace(/\s+/g, ' ');
}

// ---- Normalising and numbers ----------------------------------------------------------

function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/č/g, 'c')
    .replace(/š/g, 's')
    .replace(/ž/g, 'z')
    .replace(/ć/g, 'c')
    .replace(/đ/g, 'd');
}

const UNITS: Record<string, number> = {
  nic: 0, nula: 0, ena: 1, en: 1, eno: 1, dva: 2, dve: 2, tri: 3, stiri: 4, stir: 4, pet: 5, sest: 6, ses: 6, sedem: 7, osem: 8, devet: 9,
};
const UNIT_STEMS: Record<string, number> = { en: 1, ena: 1, dva: 2, tri: 3, stiri: 4, pet: 5, sest: 6, sedem: 7, osem: 8, devet: 9 };
const TEENS: Record<string, number> = {
  deset: 10, enajst: 11, dvanajst: 12, trinajst: 13, stirinajst: 14, petnajst: 15, sestnajst: 16, sedemnajst: 17, osemnajst: 18, devetnajst: 19,
};
const TENS: Record<string, number> = { dvajset: 20, trideset: 30, stirideset: 40 };

/** A single token as a number: "36", "3", "tri", "sestintrideset" … */
function wordNumber(token: string): number | null {
  if (/^\d{1,2}$/.test(token)) return Number(token);
  if (token in UNITS) return UNITS[token];
  if (token in TEENS) return TEENS[token];
  if (token in TENS) return TENS[token];
  const compound = token.match(/^([a-z]+?)in(dvajset|trideset|stirideset)$/);
  if (compound && compound[1] in UNIT_STEMS) return UNIT_STEMS[compound[1]] + TENS[compound[2]];
  return null;
}

const VALID_FDI = new Set(ALL_FDI);

interface Token {
  word: string;   // folded
  raw: string;    // as recognised (for notes)
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  // Commas, colons, full stops … become a separator token: they end a group of
  // teeth ("35 distalno krvavitev, 34 endo") — the cloud engine writes them.
  for (const raw of text.replace(/[,;:!?]/g, ' | ').split(/\s+/)) {
    if (raw === '|') {
      if (tokens.length && tokens[tokens.length - 1].word !== '|') tokens.push({ word: '|', raw: '' });
      continue;
    }
    const endsSentence = /[^\d]\.$|^\d+\.$/.test(raw) && !/^\d\.\d$/.test(raw);
    const cleaned = raw.replace(/\.$/, '');
    if (!cleaned) continue;
    if (endsSentence) {
      tokenizeWord(tokens, cleaned);
      tokens.push({ word: '|', raw: '' });
      continue;
    }
    tokenizeWord(tokens, cleaned);
  }
  return mergeKarJe(tokens);
}

function tokenizeWord(tokens: Token[], cleaned: string) {
  {
    // "1.4" (Chrome's way of writing "ena štiri") → 14
    const word = /^\d\.\d$/.test(cleaned) ? cleaned.replace('.', '') : fold(cleaned);
    // A number glued to a word ("6bukalno", "bukalno3") → two tokens.
    const glued = word.match(/^(\d+)([a-z]{3,})$/) ?? word.match(/^([a-z]{3,})(\d+)$/);
    if (glued) {
      tokens.push({ word: glued[1], raw: glued[1] }, { word: glued[2], raw: glued[2] });
      return;
    }
    // Teeth run together: "1716" / "17.16" → 17, 16 (each pair a real tooth).
    const run = word.replace('.', '');
    if (/^(\d{2}){2,4}$/.test(run) && run.match(/\d{2}/g)!.every((pair) => VALID_FDI.has(pair))) {
      for (const pair of run.match(/\d{2}/g)!) tokens.push({ word: pair, raw: pair });
      return;
    }
    // "3-6" / "3/6": two single digits forming a tooth → that tooth
    if (/^\d[-/]\d$/.test(word) && VALID_FDI.has(word.replace(/[-/]/, ''))) {
      tokens.push({ word: word.replace(/[-/]/, ''), raw: cleaned });
      return;
    }
    // "3-2-4" / "3/2/4" and "324" (digits run together) → separate numbers
    if (/^\d+([-/]\d+)+$/.test(word)) {
      for (const part of word.split(/[-/]/)) tokens.push({ word: part, raw: part });
    } else if (/^\d{3}$/.test(word)) {
      for (const ch of word) tokens.push({ word: ch, raw: ch });
    } else {
      tokens.push({ word, raw: cleaned });
    }
  }
}

function mergeKarJe(tokens: Token[]): Token[] {
  // "kar je" — Chrome's way of hearing "karies" → one word
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].word === 'kar' && /^(je|jes|ies)$/.test(tokens[i + 1].word)) {
      tokens.splice(i, 2, { word: 'karies', raw: `${tokens[i].raw} ${tokens[i + 1].raw}` });
    }
  }
  return tokens;
}

// ---- Vocabulary -------------------------------------------------------------------------

// Surfaces by how the word starts, not the exact word — Chrome writes
// "mezialno" as medialno, mesialno, miziano, medzianalno …, "okluzalno" as
// oklozalno (seen live, 2026-10-19).
function surfaceOf(w: string): Surface | null {
  if (w.length < 5) return null;
  if (/^(mez|mes|med|miz|mec|mas)/.test(w) && /(no|na|ni|en)$/.test(w)) return 'm';
  if (/^dis/.test(w)) return 'd';
  if (/^s?ok[lu]/.test(w)) return 'o';
  if (/^(buk|buc|bok|vest|ves|lab)/.test(w)) return 'b';
  if (/^(ling|lin|pal|oral)/.test(w)) return 'l';
  return null;
}
const PERIO_SIDE: Partial<Record<Surface, PerioSide>> = { b: 'buccal', l: 'lingual' };
/** Probing point for "krvavitev mezialno / sredina / distalno". */
function pointOf(w: string): 0 | 1 | 2 | null {
  if (/^sred/.test(w)) return 1;
  const s = surfaceOf(w);
  return s === 'm' ? 0 : s === 'd' ? 2 : null;
}
// Words that carry no meaning inside a finding ("36 karies tudi distalno").
const FILLER = new Set([
  'za', 'fisur', 'je', 'tudi', 'na', 'ter', 'pa', 'ploskev', 'ploskve', 'ploskvi', 'ob', 'se', 'so', 'sta', 'ki', 'pri', 'od',
  'meritev', 'zdravljenje', 'mikrofon', 'mikrofona', 'snemanje', 'poslusanje', 'zadnje', 'zadnji', 'zadnjo', 'dlesni', 'dlesen', 'stran', 'strani',
  'povezan', 'povezana', 'povezani', 'povezane', 'povezano', 'skupaj', 'med', 'sabo', 'seboj', 'ima', 'imata', 'imajo',
]);
// Words that join teeth into a list: "14 in 12", "od 14 do 12".
const JOINERS = new Set(['in', 'do', 'ter']);

const PLANNED = new Set(['predviden', 'predvideno', 'predvidena', 'potreben', 'potrebno', 'potrebna', 'planirano', 'planiran', 'teku']);
const EXISTING = new Set(['obstojec', 'obstojece', 'obstojeca', 'obstojeco', 'obstojeci', 'obstojecega', 'obstaja', 'obstoji', 'stara', 'star', 'staro']);
const DONE = new Set([
  'opravljeno', 'opravljen', 'opravljena', 'narejeno', 'koncano', 'dokoncano',
  'zdravljeno', 'zdravljen', 'zdravljena', 'pozdravljen', 'pozdravljeno', 'pozdravljena', 'saniran', 'sanirano',
]);

const BLEEDING = new Set(['krvavitev', 'krvavi', 'krvavenje', 'kri']);
const RECESSION = new Set(['recesija', 'recesije', 'umik', 'odmik']);
// "Globine žepkov: 14: 3 2 2, 15: 2 2 3" — tooth + three numbers = pocket depths.
const PERIO_WORDS = new Set(['globina', 'globine', 'globino', 'zep', 'zepi', 'zepov', 'zepek', 'zepki', 'zepkov', 'sondiranje']);
const NOTE = new Set(['opomba', 'zapis', 'beleska']);
const NEXT = new Set(['naslednji', 'naprej', 'preskoci']);
const UNDO = new Set(['razveljavi', 'nazaj']);
const STOP = new Set(['konec', 'ustavi', 'stop', 'izklopi', 'izkljuci', 'ugasni', 'koncaj', 'zakljuci']);
const ENDO = new Set(['endo', 'kanal', 'endodontsko', 'endodontija', 'koreninski']);
const POST = new Set(['zaticek', 'zaticka', 'zatick']);
const NEGATION = new Set(['brez', 'odstrani', 'ni']);
const TOOTH_WORD = new Set(['zob', 'zoba', 'zobu', 'zobom', 'zobje']);

const STATUS_LABEL: Record<ToothStatus, string> = {
  healthy: 'zdrav', caries: 'karies', caries_treated: 'plomba', filling: 'plomba (obstoječa)', crown: 'krona', bridge_pontic: 'člen mostu',
  implant: 'implantat', abrasion: 'abrazija', overlay_planned: 'overlay (predviden)', overlay: 'overlay', overlay_existing: 'overlay (obstoječ)',
  sealant_planned: 'zalitje fisur (predvideno)', sealant: 'zalitje fisur', sealant_existing: 'zalitje fisur (obstoječe)',
  extraction_planned: 'za ekstrakcijo', extracted: 'ekstrahiran', missing: 'manjka', impacted: 'impaktiran', prosthesis: 'proteza',
  prosthesis_crown: 'krona (nosilec proteze)',
};

/** Base status words; modifiers (predviden / obstoječ) adjust them. */
function baseStatus(word: string): 'caries' | 'filling' | 'crown' | 'implant' | 'missing' | 'extraction' | 'extracted' | 'abrasion' | 'impacted' | 'healthy' | 'prosthesis' | 'overlay' | 'sealant' | null {
  // Chrome writes karies as karje, karjes, karis … (seen live, 2026-10-20)
  if (['poka', 'razpoka'].includes(word) || /^kar(i|j)/.test(word)) return 'caries';
  if (['plomba', 'zalivka', 'sanirano', 'plombo'].includes(word)) return 'filling';
  if (['krona', 'prevleka', 'krono'].includes(word)) return 'crown';
  if (['implantat', 'implant'].includes(word)) return 'implant';
  if (['manjka', 'manjkajoc', 'manjkajoci', 'odsoten'].includes(word)) return 'missing';
  if (['ekstrakcija', 'ekstrakcijo', 'puljenje', 'izdrtje'].includes(word)) return 'extraction';
  if (['ekstrahiran', 'izpuljen', 'izdrt', 'odstranjen', 'puljen'].includes(word)) return 'extracted';
  if (['abrazija', 'obraba', 'obrabljen', 'obrabljena'].includes(word)) return 'abrasion';
  if (['impaktiran', 'retiniran'].includes(word)) return 'impacted';
  if (word === 'zdrav') return 'healthy';
  if (['proteza', 'protezo'].includes(word)) return 'prosthesis';
  if (word === 'overlay') return 'overlay';
  if (['zalitje', 'zalitev', 'pecatenje'].includes(word)) return 'sealant';
  return null;
}

function resolveStatus(base: NonNullable<ReturnType<typeof baseStatus>>, modifier: 'planned' | 'existing' | 'done' | null): ToothStatus {
  switch (base) {
    case 'filling':
      return modifier === 'existing' ? 'filling' : 'caries_treated';
    case 'extraction':
      return 'extraction_planned';
    case 'overlay':
      return modifier === 'planned' ? 'overlay_planned' : modifier === 'existing' ? 'overlay_existing' : 'overlay';
    case 'sealant':
      return modifier === 'planned' ? 'sealant_planned' : modifier === 'existing' ? 'sealant_existing' : 'sealant';
    default:
      return base;
  }
}

/** Words that start some other command (so they don't count as a misheard surface). */
function isKeyword(w: string): boolean {
  return (
    !!baseStatus(w) ||
    /^endo/.test(w) ||
    /don(t|j|c)sk/.test(w) ||
    [UNDO, STOP, ENDO, POST, NOTE, RECESSION, BLEEDING, NEXT, TOOTH_WORD, NEGATION, PLANNED, EXISTING, DONE, PERIO_WORDS].some((set) =>
      set.has(w)
    )
  );
}

// Statuses that mark single surfaces (dots); everything else is whole-tooth.
const PER_SURFACE: ToothStatus[] = ['caries', 'caries_treated', 'filling'];

// ---- Perio order --------------------------------------------------------------------------

const UPPER_ORDER = [...UPPER_LEFT, ...UPPER_RIGHT];
const LOWER_ORDER = [...LOWER_LEFT, ...LOWER_RIGHT];

/** The next tooth along the arch for perio, skipping teeth that can't be probed. */
export function nextPerioTooth(fdi: string, skip: (fdi: string) => boolean): string | null {
  const order = UPPER_ORDER.includes(fdi) ? UPPER_ORDER : LOWER_ORDER;
  for (let i = order.indexOf(fdi) + 1; i < order.length; i++) {
    if (!skip(order[i])) return order[i];
  }
  return null;
}

/** The teeth from the first to the last named one along the arch, or null when
 *  they aren't in the same jaw. "most od 14 do 12" → 14, 13, 12. */
export function bridgeRange(fdis: string[]): string[] | null {
  const order = UPPER_ORDER.includes(fdis[0]) ? UPPER_ORDER : LOWER_ORDER;
  if (!fdis.every((f) => order.includes(f))) return null;
  const idx = fdis.map((f) => order.indexOf(f));
  return order.slice(Math.min(...idx), Math.max(...idx) + 1);
}

function surfaceLetters(surfaces: Surface[]): string {
  return surfaces.map((s) => s.toUpperCase()).join(' ');
}

function formatTriple(values: Triple<number | null>): string {
  return values.map((v) => (v == null ? '–' : String(v))).join(' ');
}

// ---- Parser -----------------------------------------------------------------------------------

/**
 * @param skipPerio teeth the perio sequence passes over (missing, extracted …)
 */
/**
 * @param aliases the practice's taught words: heard (aliasKey) → meaning
 */
export function parseVoiceCommand(
  text: string,
  context: VoiceContext,
  skipPerio: (fdi: string) => boolean,
  aliases: Record<string, string> = {}
): VoiceParseResult {
  const tokens = toothFirst(mergeToothPairs(applyAliases(tokenize(text), aliases)));
  const numberAt = (i: number): number | null => (i < tokens.length ? wordNumber(tokens[i].word) : null);
  const commands: VoiceCommand[] = [];
  const unknown: string[] = [];
  const unknownWords: string[] = [];
  const miss = (raw: string) => {
    // Numbers can't be taught — only words.
    if (/\d/.test(raw)) return;
    if (!unknownWords.includes(raw)) unknownWords.push(raw);
  };
  // Every phrase must name its own tooth: if Chrome clipped the number, the
  // finding must not land on the previous tooth. Only the perio sequence
  // (bare numbers → next tooth) carries over between phrases.
  let ctx: VoiceContext = { ...context, currentFdi: null };
  // undefined = this phrase didn't touch it (noise keeps the previous one).
  let newFinding: { fdis: string[]; status: ToothStatus } | null | undefined;

  // "36 recesija" … "1 2 5": numbers right after the millimetres were asked for.
  if (context.pendingRecession) {
    const fdi = context.pendingRecession;
    ctx = { ...ctx, pendingRecession: null };
    const numbersOnly = tokens.every((t) => t.word === '|' || wordNumber(t.word) != null);
    const { values, next } = readValues(tokens[0]?.word === '|' ? 1 : 0);
    if (numbersOnly && values.length > 0 && next >= tokens.filter((t) => t.word !== '|').length) {
      const triple = toTriple(values);
      commands.push({ kind: 'recession', fdi, values: triple, label: `${fdi} recesija ${formatTriple(triple)}` });
      return { commands, unknown, unknownWords, context: ctx };
    }
  }

  // A phrase of surfaces only, right after a filling/caries: complete it.
  if (context.lastFinding && tokens.length > 0) {
    const named: Surface[] = [];
    let onlySurfaces = true;
    for (const t of tokens) {
      const s = surfaceOf(t.word);
      if (s) {
        if (!named.includes(s)) named.push(s);
      } else if (/\d/.test(t.word) || (!FILLER.has(t.word) && t.word.length > 2)) {
        // A number (a tooth, a depth) means a new entry, never a completion.
        onlySurfaces = false;
        break;
      }
    }
    if (onlySurfaces && named.length) {
      const { fdis, status } = context.lastFinding;
      for (const fdi of fdis) {
        const valid = named.filter((s) => TOOTH_META[fdi]?.surfaces.includes(s));
        if (valid.length === 0) {
          unknown.push(`ploskev ${surfaceLetters(named)} pri zobu ${fdi}`);
          continue;
        }
        commands.push({
          kind: 'status',
          fdi,
          status,
          surfaces: valid,
          amend: true,
          label: `${fdi} ${STATUS_LABEL[status]} ${surfaceLetters(valid)} (dopolnjeno)`,
        });
      }
      return { commands, unknown, unknownWords, context: ctx };
    }
  }


  // Up to three numbers from position i (perio values).
  function readValues(i: number): { values: number[]; next: number } {
    const values: number[] = [];
    while (values.length < 3 && i < tokens.length) {
      // "dva, dva, tri" — commas between the numbers don't end them
      if (values.length > 0 && tokens[i].word === '|' && numberAt(i + 1) != null) i++;
      const n = numberAt(i);
      if (n == null || n > 15) break;
      values.push(n);
      i++;
    }
    return { values, next: i };
  }

  function toTriple(values: number[]): Triple<number | null> {
    if (values.length === 1) return [null, values[0], null];
    return [values[0] ?? null, values[1] ?? null, values[2] ?? null];
  }

  // Bleeding after a pocket entry: "krvavitev" (all) or "krvavitev mezialno distalno".
  function readBleeding(i: number): { bleeding: Triple<boolean> | null; next: number } {
    if (tokens[i]?.word === '|' && BLEEDING.has(tokens[i + 1]?.word ?? '')) i++;
    if (i >= tokens.length || !BLEEDING.has(tokens[i].word)) return { bleeding: null, next: i };
    i++;
    const points: (0 | 1 | 2)[] = [];
    while (i < tokens.length && pointOf(tokens[i].word) != null) {
      points.push(pointOf(tokens[i].word) as 0 | 1 | 2);
      i++;
    }
    const bleeding: Triple<boolean> = points.length === 0 ? [true, true, true] : [points.includes(0), points.includes(1), points.includes(2)];
    return { bleeding, next: i };
  }

  function pushPocket(fdi: string, side: PerioSide, values: number[], bleeding: Triple<boolean> | null) {
    const triple = toTriple(values);
    commands.push({
      kind: 'pocket',
      fdi,
      side,
      values: triple,
      bleeding,
      label: `${fdi} ${side === 'buccal' ? 'bukalno' : 'lingvalno'} ${formatTriple(triple)}${bleeding ? ' · krvavitev' : ''}`,
    });
    ctx = { currentFdi: fdi, lastPerio: { fdi, side } };
  }

  // The teeth this part of the phrase is about: "14 in 12 krona" names two.
  // A tooth right after another (only "in"/"do"/filler between, no finding
  // yet) joins the list; after a finding the next tooth starts a new list.
  let teeth: string[] = [];
  let joinable = false;
  const allTeeth: string[] = [];
  let bridgeRequested = false;
  const noTooth: string[] = [];
  const badNumbers: string[] = [];
  // After "globine žepkov": "tooth + three numbers" are depths on this side.
  let perioSide: PerioSide | null = null;
  /** In perio mode, right after a tooth: its three depths (separators skipped). */
  function perioAfterTooth(fdi: string, k: number): number | null {
    if (!perioSide) return null;
    while (k < tokens.length && tokens[k].word === '|') k++;
    const { values, next } = readValues(k);
    if (values.length !== 3) return null;
    const { bleeding, next: afterBleeding } = readBleeding(next);
    pushPocket(fdi, perioSide, values, bleeding);
    findingDone();
    return afterBleeding;
  }

  function addTooth(fdi: string) {
    if (joinable && teeth.length) {
      if (!teeth.includes(fdi)) teeth.push(fdi);
    } else {
      teeth = [fdi];
    }
    joinable = true;
    if (!allTeeth.includes(fdi)) allTeeth.push(fdi);
    ctx = { ...ctx, currentFdi: fdi };
    commands.push({ kind: 'select', fdi, label: `zob ${fdi}` });
  }
  /** After a finding, a following tooth number starts a new list. */
  function findingDone() {
    joinable = false;
  }

  let i = 0;
  while (i < tokens.length) {
    const w = tokens[i].word;

    if (w === '|') {
      // A comma between two numbers keeps the list ("14, 15, 24: plomba");
      // anywhere else it ends the group of teeth.
      if (!(numberAt(i - 1) != null && numberAt(i + 1) != null)) joinable = false;
      i++;
      continue;
    }
    if (PERIO_WORDS.has(w)) {
      perioSide = perioSide ?? 'buccal';
      i++;
      continue;
    }
    if (perioSide && teeth.length === 0 && surfaceOf(w) && PERIO_SIDE[surfaceOf(w) as Surface]) {
      perioSide = PERIO_SIDE[surfaceOf(w) as Surface] as PerioSide;
      i++;
      continue;
    }
    if (UNDO.has(w)) {
      commands.push({ kind: 'undo', label: 'razveljavi' });
      i++;
      continue;
    }
    if (STOP.has(w)) {
      commands.push({ kind: 'stop', label: 'konec' });
      i++;
      continue;
    }
    if (TOOTH_WORD.has(w) || JOINERS.has(w)) {
      i++;
      continue;
    }
    if (/^most/.test(w)) {
      // "most(iček) od 14 do 12", "14 in 12 sta povezana v mostiček"
      bridgeRequested = true;
      i++;
      continue;
    }

    // A tooth number: "36", "šestintrideset", two single digits "ena šest",
    // or tens and units as two words "trideset šest".
    let n = numberAt(i);
    if (n != null) {
      const unit = numberAt(i + 1);
      if ((n === 20 || n === 30 || n === 40) && unit != null && unit >= 1 && unit <= 9 && !/^\d/.test(tokens[i + 1].word)) {
        n += unit;
        tokens.splice(i, 2, { word: String(n), raw: `${tokens[i].raw} ${tokens[i + 1].raw}` });
      }
      const asTooth = String(n);
      const n2 = numberAt(i + 1);
      const pair = n < 10 && n2 != null && n2 < 10 ? `${n}${n2}` : null;

      // Exactly three bare numbers right after a perio entry → the next tooth,
      // same side (two would be ambiguous with "ena šest" = tooth 16).
      if (ctx.lastPerio && !VALID_FDI.has(asTooth) && teeth.length === 0) {
        const { values, next } = readValues(i);
        if (values.length === 3) {
          const target = ctx.lastPerio.pending ? ctx.lastPerio.fdi : nextPerioTooth(ctx.lastPerio.fdi, skipPerio);
          if (!target) {
            unknown.push('ni naslednjega zoba');
            i = next;
            continue;
          }
          const { bleeding, next: afterBleeding } = readBleeding(next);
          pushPocket(target, ctx.lastPerio.side, values, bleeding);
          i = afterBleeding;
          continue;
        }
      }
      if (VALID_FDI.has(asTooth)) {
        addTooth(asTooth);
        i = perioAfterTooth(asTooth, i + 1) ?? i + 1;
        continue;
      }
      if (pair && VALID_FDI.has(pair)) {
        addTooth(pair);
        i = perioAfterTooth(pair, i + 2) ?? i + 2;
        continue;
      }
      // A number that isn't a tooth (Chrome lost a digit: "716" for "17 16"):
      // nothing from this phrase is applied — half a result is easy to miss.
      badNumbers.push(tokens[i].raw);
      i++;
      continue;
    }

    if (NEXT.has(w) && ctx.lastPerio) {
      const target = nextPerioTooth(ctx.lastPerio.fdi, skipPerio);
      if (target) {
        ctx = { currentFdi: target, lastPerio: { fdi: target, side: ctx.lastPerio.side } };
        commands.push({ kind: 'select', fdi: target, label: `naslednji: ${target}` });
      }
      i++;
      continue;
    }

    // "krvavitev [mezialno …]" on its own, right after a perio entry.
    if (teeth.length === 0 && BLEEDING.has(w) && ctx.lastPerio && !ctx.lastPerio.pending) {
      const { bleeding, next } = readBleeding(i);
      const { fdi, side } = ctx.lastPerio;
      commands.push({
        kind: 'pocket',
        fdi,
        side,
        values: [null, null, null],
        bleeding,
        label: `${fdi} ${side === 'buccal' ? 'bukalno' : 'lingvalno'} · krvavitev`,
      });
      i = next;
      continue;
    }

    if (NOTE.has(w)) {
      const rest = tokens.slice(i + 1);
      const text = rest
        .map((t) => t.raw)
        .filter(Boolean)
        .join(' ')
        .trim();
      const named = [...new Set(rest.map((t) => t.word).filter((x) => VALID_FDI.has(x)))];
      const targets = named.length ? named : teeth;
      if (!text) {
        unknown.push('opomba je prazna');
      } else if (targets.length === 0) {
        unknown.push(`opomba brez zoba: ${text}`);
      } else {
        for (const fdi of targets) commands.push({ kind: 'note', fdi, text, label: `${fdi} opomba: ${text}` });
      }
      ctx = { ...ctx, lastPerio: null };
      newFinding = null;
      break;
    }

    if (teeth.length === 0) {
      // Before any tooth number: fillers and short noise ("na", "ki", "c")
      // are skipped; anything else is reported — nothing is guessed.
      if (!FILLER.has(w) && w.length > 2) {
        noTooth.push(tokens[i].raw);
        if (!isKeyword(w) && !surfaceOf(w)) miss(tokens[i].raw);
      }
      i++;
      continue;
    }
    // Perio and recession go to one tooth — the last one named.
    const last = teeth[teeth.length - 1];

    if (RECESSION.has(w)) {
      let k = i + 1;
      while (k < tokens.length && (FILLER.has(tokens[k].word) || TOOTH_WORD.has(tokens[k].word) || tokens[k].word === '|')) k++;
      const { values, next } = readValues(k);
      if (values.length === 0) {
        commands.push({ kind: 'info', label: `${last} recesija — povejte milimetre` });
        ctx = { ...ctx, pendingRecession: last };
        i = k;
        continue;
      }
      const triple = toTriple(values);
      commands.push({ kind: 'recession', fdi: last, values: triple, label: `${last} recesija ${formatTriple(triple)}` });
      findingDone();
      i = next;
      continue;
    }

    // Bleeding at points: "35 distalno krvavitev" / "35 krvavitev distalno"
    // (buccal unless lingvalno is said).
    {
      let k = i;
      const points: (0 | 1 | 2)[] = [];
      let side: PerioSide = 'buccal';
      while (k < tokens.length && (surfaceOf(tokens[k].word) || /^sred/.test(tokens[k].word))) {
        const p = pointOf(tokens[k].word);
        if (p != null && !points.includes(p)) points.push(p);
        const sd = PERIO_SIDE[surfaceOf(tokens[k].word) as Surface];
        if (sd) side = sd;
        k++;
      }
      if (k < tokens.length && BLEEDING.has(tokens[k].word)) {
        const { bleeding, next } = readBleeding(k);
        // Points named before "krvavitev" plus any after it; none at all = the
        // whole side.
        const after = next > k + 1 && bleeding ? bleeding : ([false, false, false] as Triple<boolean>);
        const marks: Triple<boolean> =
          points.length === 0 && next === k + 1 ? [true, true, true] : [0, 1, 2].map((idx) => points.includes(idx as 0 | 1 | 2) || after[idx]) as Triple<boolean>;
        commands.push({
          kind: 'pocket',
          fdi: last,
          side,
          values: [null, null, null],
          bleeding: marks,
          label: `${last} krvavitev ${(['M', 'sredina', 'D'] as const).filter((_, idx) => marks[idx]).join(' ')}`.trim(),
        });
        ctx = { ...ctx, lastPerio: { fdi: last, side } };
        findingDone();
        i = next;
        continue;
      }
    }

    // Surface words: followed by numbers → perio for that side; otherwise they
    // collect surfaces for a status in the same phrase.
    const surfaceWord = surfaceOf(w);
    if (surfaceWord) {
      const side = PERIO_SIDE[surfaceWord];
      if (side) {
        const { values, next } = readValues(i + 1);
        if (values.length > 0) {
          const { bleeding, next: afterBleeding } = readBleeding(next);
          pushPocket(last, side, values, bleeding);
          findingDone();
          i = afterBleeding;
          continue;
        }
        // "23 bukalno" with no finding after it: the browser cut the depths
        // into the next phrase — wait for them there.
        const rest = tokens.slice(i + 1).map((t) => t.word);
        if (!rest.some((x) => baseStatus(x) || PLANNED.has(x) || EXISTING.has(x))) {
          ctx = { ...ctx, lastPerio: { fdi: last, side, pending: true } };
          commands.push({ kind: 'info', label: `${last} ${side === 'buccal' ? 'bukalno' : 'lingvalno'} — povejte globine` });
          findingDone();
          i++;
          continue;
        }
      }
      i = parseStatus(i, teeth);
      continue;
    }

    // Chrome splits "endodontsko" into "in do donjsko" — the tail is enough.
    if (ENDO.has(w) || /^endo/.test(w) || /don(t|j|c)sk/.test(w)) {
      let stage: EndoStage = 'done';
      let j = i + 1;
      while (j < tokens.length && ['kanal', 'zdravljenje', 'v', 'je', 'zob', 'koreninski'].includes(tokens[j].word)) j++;
      const mod = j < tokens.length ? tokens[j].word : '';
      if (PLANNED.has(mod)) stage = 'planned';
      else if (EXISTING.has(mod)) stage = 'existing';
      if (PLANNED.has(mod) || EXISTING.has(mod) || DONE.has(mod)) j++;
      const stageLabel = stage === 'planned' ? 'potrebno' : stage === 'existing' ? 'obstoječe' : 'opravljeno';
      for (const fdi of teeth) commands.push({ kind: 'endo', fdi, stage, label: `${fdi} endo ${stageLabel}` });
      ctx = { ...ctx, lastPerio: null };
      findingDone();
      i = j;
      continue;
    }

    if (POST.has(w) || (NEGATION.has(w) && i + 1 < tokens.length && POST.has(tokens[i + 1].word))) {
      const on = !NEGATION.has(w);
      for (const fdi of teeth) commands.push({ kind: 'post', fdi, on, label: `${fdi} ${on ? 'zatiček' : 'brez zatička'}` });
      ctx = { ...ctx, lastPerio: null };
      findingDone();
      i += on ? 1 : 2;
      continue;
    }

    if (baseStatus(w) || PLANNED.has(w) || EXISTING.has(w)) {
      i = parseStatus(i, teeth);
      continue;
    }
    if (FILLER.has(w) || w.length <= 2) {
      i++;
      continue;
    }

    unknown.push(tokens[i].raw);
    if (!isKeyword(w)) miss(tokens[i].raw);
    i++;
  }

  if (noTooth.length) unknown.push(`brez številke zoba: ${noTooth.join(' ')}`);
  if (bridgeRequested) {
    if (allTeeth.length >= 2) {
      commands.push({ kind: 'bridge', fdis: allTeeth, label: `most ${allTeeth.join(' – ')}` });
      ctx = { ...ctx, lastPerio: null };
    } else {
      unknown.push('most: povejte vsaj dva zoba (npr. »most od 14 do 12«)');
    }
  }

  // Status phrase starting at i for the named teeth: surfaces + base +
  // modifier in any order, until a word that belongs to something else.
  function parseStatus(start: number, forTeeth: string[]): number {
    const surfaces: Surface[] = [];
    let base: ReturnType<typeof baseStatus> = null;
    let modifier: 'planned' | 'existing' | 'done' | null = null;
    let j = start;
    while (j < tokens.length) {
      const w = tokens[j].word;
      const s = surfaceOf(w);
      if (s) {
        // A perio side followed by numbers ends the status phrase.
        if (PERIO_SIDE[s] && numberAt(j + 1) != null) break;
        if (!surfaces.includes(s)) surfaces.push(s);
      } else if (/^[mdobl]{1,4}$/.test(w) && new Set(w).size === w.length && (base || surfaces.length)) {
        // Surface letters inside a status phrase: "karies MO", "plomba MOD".
        for (const ch of w as Iterable<Surface>) if (!surfaces.includes(ch)) surfaces.push(ch);
      } else if (baseStatus(w) && !base) {
        base = baseStatus(w);
      } else if (PLANNED.has(w)) {
        modifier = 'planned';
      } else if (EXISTING.has(w)) {
        modifier = 'existing';
      } else if (DONE.has(w)) {
        modifier = 'done';
      } else if (FILLER.has(w) || (w.length <= 2 && numberAt(j) == null)) {
        // "za ekstrakcijo", "zalitje fisur", "tudi distalno", "karies z okluzalno"
      } else {
        break;
      }
      j++;
    }
    if (!base) {
      for (const t of tokens.slice(start, Math.max(j, start + 1))) {
        if (!surfaceOf(t.word) && !FILLER.has(t.word) && !isKeyword(t.word) && t.word.length > 2) miss(t.raw);
      }
      if (surfaces.length && forTeeth.length) {
        unknown.push(`${forTeeth.join(', ')} ${surfaceLetters(surfaces)} — ploskev brez izvida (npr. »${forTeeth[0]} karies mezialno«)`);
        return Math.max(j, start + 1);
      }
      unknown.push(
        tokens
          .slice(start, Math.max(j, start + 1))
          .map((t) => t.raw)
          .join(' ')
      );
      return Math.max(j, start + 1);
    }
    ctx = { ...ctx, lastPerio: null };
    findingDone();
    const status = resolveStatus(base, modifier);
    // A surface finding followed by a word that wasn't understood — most
    // likely a misheard surface: change nothing rather than mark the whole
    // tooth.
    if (
      PER_SURFACE.includes(status) &&
      surfaces.length === 0 &&
      j < tokens.length &&
      numberAt(j) == null &&
      !isKeyword(tokens[j].word) &&
      !/^most/.test(tokens[j].word) &&
      tokens[j].word.length > 2
    ) {
      unknown.push(`${forTeeth.join(', ')} ${STATUS_LABEL[status]} — ploskev ni razumljena: ${tokens[j].raw}`);
      miss(tokens[j].raw);
      return j + 1;
    }
    for (const fdi of forTeeth) {
      const meta = TOOTH_META[fdi];
      const valid = PER_SURFACE.includes(status) ? surfaces.filter((s) => meta?.surfaces.includes(s)) : [];
      // Surfaces were named but none exists on this tooth (an incisor has no
      // occlusal surface): change nothing rather than mark the whole tooth.
      if (PER_SURFACE.includes(status) && surfaces.length > 0 && valid.length === 0) {
        unknown.push(`ploskev ${surfaceLetters(surfaces)} pri zobu ${fdi}`);
        continue;
      }
      commands.push({
        kind: 'status',
        fdi,
        status,
        surfaces: valid,
        label: `${fdi} ${STATUS_LABEL[status]}${valid.length ? ` ${surfaceLetters(valid)}` : ''}`,
      });
    }
    newFinding = PER_SURFACE.includes(status) ? { fdis: [...forTeeth], status } : null;
    return j;
  }

  if (badNumbers.length) {
    const changes = commands.filter((c) => !['select', 'undo', 'stop', 'info'].includes(c.kind));
    if (changes.length) {
      for (const c of changes) commands.splice(commands.indexOf(c), 1);
      unknown.push(`številka zoba ni jasna (»${badNumbers.join(' ')}«) — nič ni vneseno, ponovite`);
      return { commands, unknown, unknownWords, context: { ...context, currentFdi: null } };
    }
    unknown.push(...badNumbers);
  }

  // Anything else that changed the chart ends the "complete the finding" window.
  if (newFinding === undefined && commands.some((c) => c.kind !== 'select' && c.kind !== 'info')) newFinding = null;
  if (newFinding !== undefined) ctx = { ...ctx, lastFinding: newFinding };
  return { commands, unknown, unknownWords, context: ctx };
}

/** Best guess for what a misheard word means (preselected in the teach form). */
export function guessAliasMeaning(heard: string): string | null {
  const word = aliasKey(heard).replace(/\s+/g, '');
  if (word.length < 2) return null;
  let best: string | null = null;
  let bestScore = Infinity;
  for (const meaning of ALIAS_MEANINGS.flatMap((g) => g.words)) {
    if (meaning === 'prezri') continue;
    const target = fold(meaning).slice(0, Math.max(word.length, 3));
    const score = levenshtein(word, target) / word.length;
    if (score < bestScore) {
      bestScore = score;
      best = meaning;
    }
  }
  return bestScore <= 0.5 ? best : null;
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

// Exactly two single digits in a row ("štir pet", "4 5") are one tooth number
// — three in a row are perio values and stay apart; commas separate.
function mergeToothPairs(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const a = wordNumber(tokens[i].word);
    const b = i + 1 < tokens.length ? wordNumber(tokens[i + 1].word) : null;
    const before = i > 0 ? wordNumber(tokens[i - 1].word) : null;
    const after = i + 2 < tokens.length ? wordNumber(tokens[i + 2].word) : null;
    if (a != null && b != null && a < 10 && b < 10 && before == null && after == null && VALID_FDI.has(`${a}${b}`)) {
      out.push({ word: `${a}${b}`, raw: `${tokens[i].raw} ${tokens[i + 1].raw}` });
      i++;
      continue;
    }
    out.push(tokens[i]);
  }
  return out;
}

// "Recesija dlesni na zobu 36": when the only tooth number comes after the
// finding, move it to the front ("36 recesija dlesni") — the grammar is
// tooth first.
function toothFirst(tokens: Token[]): Token[] {
  const toothAt = tokens.map((t, i) => (VALID_FDI.has(t.word) ? i : -1)).filter((i) => i >= 0);
  if (toothAt.length !== 1 || toothAt[0] === 0) return tokens;
  const before = tokens.slice(0, toothAt[0]);
  if (!before.some((t) => isKeyword(t.word) || surfaceOf(t.word))) return tokens;
  // Only when nothing before it is a number (that would be perio values).
  if (before.some((t) => /\d/.test(t.word))) return tokens;
  return [tokens[toothAt[0]], ...before, ...tokens.slice(toothAt[0] + 1)];
}

// Taught words first (two-word phrases before single words); "prezri" drops
// the word.
function applyAliases(tokens: Token[], aliases: Record<string, string>): Token[] {
  if (Object.keys(aliases).length === 0) return tokens;
  const out: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const pair = i + 1 < tokens.length ? `${tokens[i].word} ${tokens[i + 1].word}` : null;
    const meaning = pair && aliases[pair] ? aliases[pair] : aliases[tokens[i].word];
    if (!meaning) {
      out.push(tokens[i]);
      continue;
    }
    const raw = pair && aliases[pair] ? `${tokens[i].raw} ${tokens[i + 1].raw}` : tokens[i].raw;
    if (pair && aliases[pair]) i++;
    if (meaning === 'prezri') continue;
    for (const word of fold(meaning).split(/\s+/)) out.push({ word, raw });
  }
  return out;
}
