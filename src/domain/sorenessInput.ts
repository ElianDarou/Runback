/**
 * From speech to structure: spoken or typed soreness reports are mapped
 * deterministically through a fixed lexicon, never guessed.
 *
 * Purely deterministic: same input, same result. No network, no React, no
 * randomness. The lexicon is fixed and versioned — it is not reinvented on
 * every call.
 *
 * The core is ground rule 6: a language model may listen and propose fields,
 * but this file decides. A region that is not in the lexicon here is discarded
 * and not invented.
 */
import {
  REGIONS_VERSION,
  allRegionIds,
  regionBaseLabel,
  regionDefinition,
  regionId,
  regionLabel,
  type RegionBase,
  type RegionId,
  type Side,
} from './regions';
import { quote, tr } from './i18n';

export const SORENESS_LEXICON_VERSION = 'soreness-lexicon-v1';

/** A proposed entry. Value 0–10, as the user reported it. */
export interface SorenessProposal {
  regionId: RegionId;
  value: number;
}

/**
 * Something that was not clear. Asked, not guessed.
 */
export interface SorenessQuestion {
  kind: 'region' | 'side' | 'intensity' | 'unknown';
  /** The heard wording, so the follow-up question stays traceable. */
  fragment: string;
  /** Ready-made follow-up question in the active language. */
  question: string;
  /** Possible concrete regions. Empty if nothing could be matched. */
  candidates: RegionId[];
  /** Intensity already recognized, if only the region is open. */
  value?: number;
}

export interface SorenessParse {
  lexiconVersion: string;
  regionsVersion: string;
  transcript: string;
  /** “Nothing today” — a complete, meaningful answer, not an empty one. */
  nothingToday: boolean;
  proposals: SorenessProposal[];
  questions: SorenessQuestion[];
}

/** Structured fields from an optional language-model pass. */
export interface StructuredSorenessItem {
  region?: unknown;
  side?: unknown;
  value?: unknown;
}

// ---------------------------------------------------------------------------
// Lexikon
// ---------------------------------------------------------------------------

/**
 * Words mapped to base regions. Several regions mean ambiguous: the user is
 * asked. Keys are already normalized (lowercase, without umlauts). German
 * words come first; the English words below map to the same regions.
 */
const REGION_WORDS: Record<string, RegionBase[]> = {
  nacken: ['neck'],
  hals: ['neck'],
  genick: ['neck'],
  trapez: ['trap_upper'],
  trapezius: ['trap_upper'],
  kapuzenmuskel: ['trap_upper'],
  'trapez oben': ['trap_upper'],
  'oberer trapez': ['trap_upper'],
  'trapez mitte': ['trap_mid'],
  'mittlerer trapez': ['trap_mid'],
  rautenmuskel: ['rhomboid'],
  rhomboid: ['rhomboid'],
  rhomboiden: ['rhomboid'],
  latissimus: ['lat'],
  lat: ['lat'],
  lats: ['lat'],
  'breiter ruckenmuskel': ['lat'],
  'unterer rucken': ['lower_back'],
  'unteren rucken': ['lower_back'],
  kreuz: ['lower_back'],
  lende: ['lower_back'],
  lenden: ['lower_back'],
  ruckenstrecker: ['lower_back'],
  rucken: ['lat', 'lower_back', 'trap_mid', 'rhomboid'],
  schulter: ['shoulder_front', 'shoulder_side', 'shoulder_rear'],
  schultern: ['shoulder_front', 'shoulder_side', 'shoulder_rear'],
  'vordere schulter': ['shoulder_front'],
  'schulter vorne': ['shoulder_front'],
  frontdelta: ['shoulder_front'],
  'seitliche schulter': ['shoulder_side'],
  'mittlere schulter': ['shoulder_side'],
  seitdelta: ['shoulder_side'],
  'hintere schulter': ['shoulder_rear'],
  'schulter hinten': ['shoulder_rear'],
  'obere brust': ['chest_upper'],
  'brust oben': ['chest_upper'],
  brust: ['chest_mid'],
  brustmuskel: ['chest_mid'],
  'mittlere brust': ['chest_mid'],
  bizeps: ['biceps'],
  armbeuger: ['biceps'],
  'oberarm vorne': ['biceps'],
  trizeps: ['triceps'],
  armstrecker: ['triceps'],
  'oberarm hinten': ['triceps'],
  unterarm: ['forearm'],
  unterarme: ['forearm'],
  oberarm: ['biceps', 'triceps'],
  'oberer bauch': ['abs_upper'],
  'bauch oben': ['abs_upper'],
  'unterer bauch': ['abs_lower'],
  'bauch unten': ['abs_lower'],
  bauch: ['abs_upper', 'abs_lower'],
  bauchmuskeln: ['abs_upper', 'abs_lower'],
  'seitlicher bauch': ['oblique'],
  'schrage bauchmuskeln': ['oblique'],
  obliques: ['oblique'],
  flanke: ['oblique'],
  huftbeuger: ['hip_flexor'],
  hufte: ['hip_flexor'],
  gesass: ['glute'],
  po: ['glute'],
  hintern: ['glute'],
  gluteus: ['glute'],
  quadrizeps: ['quad'],
  quads: ['quad'],
  'oberschenkel vorne': ['quad'],
  'vorderer oberschenkel': ['quad'],
  ischiocrurale: ['hamstring'],
  beinbeuger: ['hamstring'],
  hamstrings: ['hamstring'],
  'oberschenkel hinten': ['hamstring'],
  'hinterer oberschenkel': ['hamstring'],
  oberschenkel: ['quad', 'hamstring', 'adductor'],
  schenkel: ['quad', 'hamstring', 'adductor'],
  adduktoren: ['adductor'],
  adduktor: ['adductor'],
  innenschenkel: ['adductor'],
  wade: ['calf_gastroc'],
  waden: ['calf_gastroc'],
  zwilling: ['calf_gastroc'],
  zwillingsmuskel: ['calf_gastroc'],
  gastrocnemius: ['calf_gastroc'],
  schollenmuskel: ['calf_soleus'],
  soleus: ['calf_soleus'],
  'tiefe wade': ['calf_soleus'],
  schienbein: ['tibialis'],
  schienbeinmuskel: ['tibialis'],
  tibialis: ['tibialis'],
  bein: ['quad', 'hamstring', 'calf_gastroc', 'glute'],
  beine: ['quad', 'hamstring', 'calf_gastroc', 'glute'],
  arm: ['biceps', 'triceps', 'forearm'],
  arme: ['biceps', 'triceps', 'forearm'],
  // English
  neck: ['neck'],
  shoulder: ['shoulder_front', 'shoulder_side', 'shoulder_rear'],
  shoulders: ['shoulder_front', 'shoulder_side', 'shoulder_rear'],
  'front shoulder': ['shoulder_front'],
  'side shoulder': ['shoulder_side'],
  'rear shoulder': ['shoulder_rear'],
  'back shoulder': ['shoulder_rear'],
  'upper trapezius': ['trap_upper'],
  traps: ['trap_upper'],
  'upper traps': ['trap_upper'],
  'middle trapezius': ['trap_mid'],
  'middle traps': ['trap_mid'],
  rhomboids: ['rhomboid'],
  back: ['lat', 'lower_back', 'trap_mid', 'rhomboid'],
  'lower back': ['lower_back'],
  lumbar: ['lower_back'],
  chest: ['chest_mid'],
  pec: ['chest_mid'],
  pecs: ['chest_mid'],
  pectorals: ['chest_mid'],
  'middle chest': ['chest_mid'],
  'upper chest': ['chest_upper'],
  biceps: ['biceps'],
  triceps: ['triceps'],
  'upper arm': ['biceps', 'triceps'],
  forearm: ['forearm'],
  forearms: ['forearm'],
  arms: ['biceps', 'triceps', 'forearm'],
  abs: ['abs_upper', 'abs_lower'],
  abdominals: ['abs_upper', 'abs_lower'],
  stomach: ['abs_upper', 'abs_lower'],
  belly: ['abs_upper', 'abs_lower'],
  'upper abs': ['abs_upper'],
  'lower abs': ['abs_lower'],
  'side abs': ['oblique'],
  'hip flexor': ['hip_flexor'],
  'hip flexors': ['hip_flexor'],
  hip: ['hip_flexor'],
  glute: ['glute'],
  glutes: ['glute'],
  buttocks: ['glute'],
  butt: ['glute'],
  quad: ['quad'],
  quadriceps: ['quad'],
  'front thigh': ['quad'],
  'front of thigh': ['quad'],
  thigh: ['quad', 'hamstring', 'adductor'],
  thighs: ['quad', 'hamstring', 'adductor'],
  hamstring: ['hamstring'],
  'back thigh': ['hamstring'],
  'back of thigh': ['hamstring'],
  'inner thigh': ['adductor'],
  'inner thighs': ['adductor'],
  adductor: ['adductor'],
  adductors: ['adductor'],
  calf: ['calf_gastroc'],
  calves: ['calf_gastroc'],
  'deep calf': ['calf_soleus'],
  shin: ['tibialis'],
  shins: ['tibialis'],
  leg: ['quad', 'hamstring', 'calf_gastroc', 'glute'],
  legs: ['quad', 'hamstring', 'calf_gastroc', 'glute'],
};

/** Side words. `both` produces two entries, not one. */
const SIDE_WORDS: Record<string, Side | 'both'> = {
  links: 'l',
  linke: 'l',
  linker: 'l',
  linkes: 'l',
  linken: 'l',
  rechts: 'r',
  rechte: 'r',
  rechter: 'r',
  rechtes: 'r',
  rechten: 'r',
  beide: 'both',
  beiden: 'both',
  beidseitig: 'both',
  beidseits: 'both',
  bds: 'both',
  // English
  left: 'l',
  right: 'r',
  both: 'both',
  bilateral: 'both',
};

/** Intensity words. Fixed, part of the lexicon version. */
const INTENSITY_WORDS: Record<string, number> = {
  leicht: 3,
  mittel: 5,
  ordentlich: 6,
  stark: 8,
  extrem: 9,
  // English
  mild: 3,
  light: 3,
  moderate: 5,
  medium: 5,
  decent: 6,
  strong: 8,
  severe: 8,
  extreme: 9,
};

const NUMBER_WORDS: Record<string, number> = {
  null: 0,
  eins: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  funf: 5,
  fuenf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  // English
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/** “Nothing today” is an answer, not a missing value. */
const NOTHING_PHRASES = [
  'heute nichts',
  'nichts heute',
  'nichts',
  'nix',
  'kein muskelkater',
  'keinen muskelkater',
  'keine beschwerden',
  'alles gut',
  'alles frei',
  'nichts zu melden',
  // English
  'nothing today',
  'nothing to report',
  'no soreness',
  'no pain',
  'no complaints',
  'all good',
  'all fine',
];

/** Filler words. They raise no question. */
const FILLER = new Set([
  'ich',
  'habe',
  'hab',
  'hatte',
  'bin',
  'ist',
  'sind',
  'war',
  'der',
  'die',
  'das',
  'den',
  'dem',
  'ein',
  'eine',
  'einen',
  'meine',
  'mein',
  'meinem',
  'meiner',
  'meinen',
  'am',
  'an',
  'im',
  'in',
  'und',
  'sowie',
  'auch',
  'noch',
  'etwas',
  'bisschen',
  'ganz',
  'sehr',
  'heute',
  'gestern',
  'muskelkater',
  'kater',
  'tut',
  'tun',
  'weh',
  'schmerzt',
  'schmerzen',
  'zieht',
  'von',
  'bis',
  'so',
  'ja',
  'ok',
  'okay',
  'aber',
  'nur',
  // English
  'i',
  'a',
  'the',
  'my',
  'am',
  'are',
  'was',
  'were',
  'have',
  'has',
  'had',
  'it',
  'its',
  'on',
  'at',
  'of',
  'to',
  'some',
  'just',
  'yesterday',
  'little',
  'bit',
  'very',
  'really',
  'quite',
  'still',
  'also',
  'pain',
  'sore',
  'soreness',
  'hurts',
  'hurt',
  'aching',
  'feel',
  'feels',
]);

// ---------------------------------------------------------------------------
// Normalization and fuzziness
// ---------------------------------------------------------------------------

/** Lowercase, without umlauts or punctuation. Umlauts fall back to their base vowel. */
export function normalizeText(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[äàáâ]/g, 'a')
    .replace(/[öòóô]/g, 'o')
    .replace(/[üùúû]/g, 'u')
    .replace(/[éèêë]/g, 'e')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein distance, iterative with one row of memory. */
export function levenshtein(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (!a.length) {
    return b.length;
  }
  if (!b.length) {
    return a.length;
  }
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/** 1 for equal strings, 0 for entirely different ones. */
export function normalizedLevenshtein(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  return longest ? 1 - levenshtein(a, b) / longest : 1;
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value} `;
  const found = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) {
    found.add(padded.slice(i, i + 3));
  }
  return found;
}

/**
 * Dice coefficient over trigrams. Catches reorderings that Levenshtein
 * scores harshly.
 */
export function trigramSimilarity(a: string, b: string): number {
  if (a === b) {
    return 1;
  }
  const left = trigrams(a);
  const right = trigrams(b);
  if (!left.size || !right.size) {
    return 0;
  }
  let shared = 0;
  left.forEach(gram => {
    if (right.has(gram)) {
      shared++;
    }
  });
  return (2 * shared) / (left.size + right.size);
}

const LEVENSHTEIN_THRESHOLD = 0.8;
const TRIGRAM_THRESHOLD = 0.7;

/**
 * Catches recognition errors: normalized Levenshtein similarity ≥ 0.8, or high
 * trigram similarity at a still plausible distance.
 */
export function fuzzyMatch(token: string, keys: string[]): string | null {
  if (token.length < 4) {
    return null;
  }
  let best: string | null = null;
  let bestScore = 0;
  for (const key of keys) {
    if (Math.abs(key.length - token.length) > 4) {
      continue;
    }
    const lev = normalizedLevenshtein(token, key);
    const tri = trigramSimilarity(token, key);
    const accepted =
      lev >= LEVENSHTEIN_THRESHOLD || (tri >= TRIGRAM_THRESHOLD && lev >= 0.6);
    if (!accepted) {
      continue;
    }
    const score = Math.max(lev, tri);
    if (score > bestScore) {
      bestScore = score;
      best = key;
    }
  }
  return best;
}

/** Strips German adjective and plural endings when nothing else matches. */
function stems(token: string): string[] {
  const found = [token];
  for (const suffix of ['en', 'em', 'er', 'es', 'e', 'n']) {
    if (token.length - suffix.length >= 4 && token.endsWith(suffix)) {
      found.push(token.slice(0, -suffix.length));
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Tokenizing
// ---------------------------------------------------------------------------

type Token =
  | { type: 'region'; text: string; bases: RegionBase[] }
  | { type: 'side'; text: string; side: Side | 'both' }
  | { type: 'intensity'; text: string; value: number }
  | { type: 'filler'; text: string }
  | { type: 'unknown'; text: string };

const REGION_KEYS = Object.keys(REGION_WORDS);
const SIDE_KEYS = Object.keys(SIDE_WORDS);
const INTENSITY_KEYS = Object.keys(INTENSITY_WORDS);
const MAX_PHRASE_WORDS = 3;

function lookup(phrase: string, words: number): Token | null {
  const region = REGION_WORDS[phrase];
  if (region) {
    return { type: 'region', text: phrase, bases: region };
  }
  const side = SIDE_WORDS[phrase];
  if (side) {
    return { type: 'side', text: phrase, side };
  }
  const intensity = INTENSITY_WORDS[phrase];
  if (intensity !== undefined) {
    return { type: 'intensity', text: phrase, value: intensity };
  }
  if (words === 1) {
    const number = NUMBER_WORDS[phrase];
    if (number !== undefined) {
      return { type: 'intensity', text: phrase, value: number };
    }
    if (/^(?:[0-9]|10)$/.test(phrase)) {
      return { type: 'intensity', text: phrase, value: Number(phrase) };
    }
    if (FILLER.has(phrase)) {
      return { type: 'filler', text: phrase };
    }
  }
  return null;
}

const sameWordCount = (keys: string[], words: number) =>
  keys.filter(key => key.split(' ').length === words);

function classify(phrase: string, words: number): Token | null {
  const direct = lookup(phrase, words);
  if (direct) {
    return direct;
  }
  if (words === 1) {
    for (const stem of stems(phrase).slice(1)) {
      const viaStem = lookup(stem, 1);
      if (viaStem && viaStem.type !== 'filler') {
        return { ...viaStem, text: phrase };
      }
    }
  }
  // Fuzzy matching last, so an exact match is never overridden.
  const candidates = [
    ...sameWordCount(REGION_KEYS, words),
    ...(words === 1 ? SIDE_KEYS : []),
    ...(words === 1 ? INTENSITY_KEYS : []),
  ];
  const match = fuzzyMatch(phrase, candidates);
  if (match) {
    const resolved = lookup(match, words);
    return resolved ? { ...resolved, text: phrase } : null;
  }
  return null;
}

/** Words between an intensity and its scale: “von” or “out of”. Returns how many. */
const scaleConnectorLength = (words: string[], at: number): number => {
  if (words[at] === 'von') {
    return 1;
  }
  if (words[at] === 'out' && words[at + 1] === 'of') {
    return 2;
  }
  return 0;
};

function tokenize(normalized: string): Token[] {
  const words = normalized ? normalized.split(' ') : [];
  const tokens: Token[] = [];
  let index = 0;
  while (index < words.length) {
    let matched: Token | null = null;
    let length = 1;
    for (
      let n = Math.min(MAX_PHRASE_WORDS, words.length - index);
      n >= 1;
      n--
    ) {
      const phrase = words.slice(index, index + n).join(' ');
      const token = classify(phrase, n);
      if (token) {
        matched = token;
        length = n;
        break;
      }
    }
    // “acht von zehn” and “eight out of ten” name one intensity, not two.
    if (matched && matched.type === 'intensity') {
      const connector = scaleConnectorLength(words, index + length);
      if (
        connector &&
        lookup(words[index + length + connector] || '', 1)?.type === 'intensity'
      ) {
        length += connector + 1;
      }
    }
    tokens.push(matched || { type: 'unknown', text: words[index] });
    index += length;
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

interface Entry {
  text: string;
  bases: RegionBase[];
  side?: Side | 'both';
  value?: number;
}

function group(tokens: Token[]): { entries: Entry[]; unknown: string[] } {
  const entries: Entry[] = [];
  const unknown: string[] = [];
  let pendingSide: Side | 'both' | undefined;
  let pendingValue: number | undefined;
  for (const token of tokens) {
    if (token.type === 'region') {
      entries.push({
        text: token.text,
        bases: token.bases,
        side: pendingSide,
        value: pendingValue,
      });
      pendingSide = undefined;
      pendingValue = undefined;
      continue;
    }
    const last = entries[entries.length - 1];
    if (token.type === 'side') {
      if (last && last.side === undefined) {
        last.side = token.side;
      } else if (
        last &&
        last.value === undefined &&
        last.side !== undefined &&
        last.side !== 'both' &&
        token.side !== 'both' &&
        last.side !== token.side
      ) {
        // Speech recognition often repeats both sides as “links und rechts” (“left and right”).
        // Preserve that explicit information instead of leaving the second
        // side pending and silently applying the next intensity to one side.
        last.side = 'both';
      } else {
        if (
          pendingSide !== undefined &&
          pendingSide !== 'both' &&
          token.side !== 'both' &&
          pendingSide !== token.side
        ) {
          pendingSide = 'both';
        } else {
          pendingSide = token.side;
        }
      }
    } else if (token.type === 'intensity') {
      if (last && last.value === undefined) {
        last.value = token.value;
      } else {
        pendingValue = token.value;
      }
    } else if (token.type === 'unknown' && token.text.length >= 4) {
      unknown.push(token.text);
    }
  }
  return { entries, unknown };
}

const sidesOf = (side: Side | 'both' | undefined): Side[] =>
  side === 'both' ? ['l', 'r'] : side ? [side] : [];

function questionForEntry(entry: Entry): SorenessQuestion | null {
  const base = entry.bases[0];
  if (entry.bases.length > 1) {
    const candidates = entry.bases.flatMap(candidate => {
      const definition = regionDefinition(candidate);
      if (!definition.sided) {
        return [regionId(candidate)];
      }
      const sides = sidesOf(entry.side).length
        ? sidesOf(entry.side)
        : (['l', 'r'] as Side[]);
      return sides.map(side => regionId(candidate, side));
    });
    return {
      kind: 'region',
      fragment: entry.text,
      question: `${quote(entry.text)} ${tr(
        'ist nicht eindeutig. Welche Region meinst du?',
        'is ambiguous. Which region do you mean?',
      )}`,
      candidates,
      value: entry.value,
    };
  }
  const definition = regionDefinition(base);
  if (definition.sided && !entry.side) {
    return {
      kind: 'side',
      fragment: entry.text,
      question: tr(
        `${regionBaseLabel(base)}: links, rechts oder beide?`,
        `${regionBaseLabel(base)}: left, right, or both?`,
      ),
      candidates: [regionId(base, 'l'), regionId(base, 'r')],
      value: entry.value,
    };
  }
  if (entry.value === undefined) {
    const ids = definition.sided
      ? sidesOf(entry.side).map(side => regionId(base, side))
      : [regionId(base)];
    const names = ids.map(regionLabel).join(tr(' und ', ' and '));
    return {
      kind: 'intensity',
      fragment: entry.text,
      question: tr(
        `Wie stark ist es an ${names}? 0 bis 10.`,
        `How sore is it at ${names}? 0 to 10.`,
      ),
      candidates: ids,
    };
  }
  return null;
}

const clamp = (value: number) => Math.min(10, Math.max(0, Math.round(value)));

/** Later entry wins: “calf three, no, calf six” ends at 6. */
function dedupe(proposals: SorenessProposal[]): SorenessProposal[] {
  const byId = new Map<RegionId, number>();
  proposals.forEach(entry => byId.set(entry.regionId, entry.value));
  return Array.from(byId, ([id, value]) => ({ regionId: id, value }));
}

/**
 * The only path from spoken language to regions. Returns suggestions and open
 * questions — never a guessed match.
 */
export function parseSoreness(transcript: string): SorenessParse {
  const normalized = normalizeText(transcript);
  const tokens = tokenize(normalized);
  const grouped = group(tokens);
  const proposals: SorenessProposal[] = [];
  const questions: SorenessQuestion[] = [];

  const nothingToday =
    !grouped.entries.length &&
    NOTHING_PHRASES.some(
      phrase => normalized === phrase || normalized.includes(phrase),
    );

  for (const entry of grouped.entries) {
    const question = questionForEntry(entry);
    if (question) {
      questions.push(question);
      continue;
    }
    const base = entry.bases[0];
    const definition = regionDefinition(base);
    const ids = definition.sided
      ? sidesOf(entry.side).map(side => regionId(base, side))
      : [regionId(base)];
    for (const id of ids) {
      proposals.push({ regionId: id, value: clamp(entry.value as number) });
    }
  }

  if (grouped.unknown.length && !nothingToday) {
    const fragment = grouped.unknown.join(' ');
    questions.push({
      kind: 'unknown',
      fragment,
      question: `${quote(fragment)} ${tr(
        'konnte ich keiner Region zuordnen. Tippe sie auf der Figur an.',
        'I could not match it to a region. Tap it on the figure.',
      )}`,
      candidates: [],
    });
  }

  return {
    lexiconVersion: SORENESS_LEXICON_VERSION,
    regionsVersion: REGIONS_VERSION,
    transcript,
    nothingToday,
    proposals: dedupe(proposals),
    questions,
  };
}

// ---------------------------------------------------------------------------
// Checking foreign fields (ground rule 6)
// ---------------------------------------------------------------------------

const VALID_IDS = new Set(allRegionIds());
const REGION_ORDER = new Map(allRegionIds().map((id, index) => [id, index]));

/** Returns the ID if it really exists in `regions-v1`. */
export function validRegionId(value: unknown): RegionId | null {
  return typeof value === 'string' && VALID_IDS.has(value) ? value : null;
}

/**
 * Passes structured fields from a language model through the same lexicon.
 * What does not get through is discarded and asked about — never invented.
 */
export function fromStructured(
  items: StructuredSorenessItem[],
  transcript = '',
): SorenessParse {
  const proposals: SorenessProposal[] = [];
  const questions: SorenessQuestion[] = [];
  for (const item of items || []) {
    const raw = typeof item?.region === 'string' ? item.region : '';
    const sideRaw =
      typeof item?.side === 'string' ? normalizeText(item.side) : '';
    const side =
      sideRaw === 'l' || sideRaw === 'r'
        ? (sideRaw as Side)
        : SIDE_WORDS[sideRaw];
    const rawValue = item?.value;
    const numeric =
      typeof rawValue === 'string' && rawValue.trim() === ''
        ? Number.NaN
        : Number(rawValue);
    const value =
      rawValue !== undefined &&
      rawValue !== null &&
      Number.isFinite(numeric)
        ? clamp(numeric)
        : undefined;

    const direct = validRegionId(raw);
    if (direct) {
      if (value === undefined) {
        questions.push({
          kind: 'intensity',
          fragment: raw,
          question: tr(
            `Wie stark ist es an ${regionLabel(direct)}? 0 bis 10.`,
            `How sore is it at ${regionLabel(direct)}? 0 to 10.`,
          ),
          candidates: [direct],
        });
      } else {
        proposals.push({ regionId: direct, value });
      }
      continue;
    }

    const token = raw ? classify(normalizeText(raw), 1) : null;
    if (!token || token.type !== 'region') {
      questions.push({
        kind: 'unknown',
        fragment: raw,
        question: raw
          ? `${quote(raw)} ${tr(
              'gehört nicht zur Regionenliste und wurde verworfen. Tippe die Region auf der Figur an.',
              'is not in the region list and was discarded. Tap the region on the figure.',
            )}`
          : tr(
              'Eine Angabe ohne Region wurde verworfen. Tippe die Region auf der Figur an.',
              'An entry without a region was discarded. Tap the region on the figure.',
            ),
        candidates: [],
      });
      continue;
    }
    const entry: Entry = { text: raw, bases: token.bases, side, value };
    const question = questionForEntry(entry);
    if (question) {
      questions.push(question);
      continue;
    }
    const base = entry.bases[0];
    const definition = regionDefinition(base);
    const ids = definition.sided
      ? sidesOf(entry.side).map(s => regionId(base, s))
      : [regionId(base)];
    ids.forEach(id => proposals.push({ regionId: id, value: value as number }));
  }
  return {
    lexiconVersion: SORENESS_LEXICON_VERSION,
    regionsVersion: REGIONS_VERSION,
    transcript,
    nothingToday: false,
    proposals: dedupe(proposals),
    questions,
  };
}

/** A saved report. Stored on the device and included in backups. */
export interface SorenessReport {
  at: number;
  lexiconVersion: string;
  regionsVersion: string;
  nothingToday: boolean;
  entries: SorenessProposal[];
  source: 'voice' | 'tap' | 'mixed';
  transcript?: string;
}

/** Builds the report from the confirmed state of the figure. */
export function buildReport(
  values: Record<RegionId, number | null>,
  at: number,
  source: SorenessReport['source'],
  transcript?: string,
): SorenessReport {
  const entries = Object.keys(values)
    .filter(
      id =>
        validRegionId(id) &&
        typeof values[id] === 'number' &&
        Number.isFinite(values[id]),
    )
    .map(id => ({ regionId: id, value: clamp(values[id] as number) }));
  entries.sort(
    (left, right) =>
      (REGION_ORDER.get(left.regionId) ?? Number.MAX_SAFE_INTEGER) -
      (REGION_ORDER.get(right.regionId) ?? Number.MAX_SAFE_INTEGER),
  );
  return {
    at,
    lexiconVersion: SORENESS_LEXICON_VERSION,
    regionsVersion: REGIONS_VERSION,
    nothingToday: entries.length === 0,
    entries,
    source,
    ...(transcript ? { transcript } : {}),
  };
}
