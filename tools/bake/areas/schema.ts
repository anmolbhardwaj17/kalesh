// Area profile schema (P2-004, DELHI_WORLD.md 2 "Profile schema"). Pure: types, the closed word lists, per-field
// checks and the evidence rule. A profile file holds only what differs from its archetype (which holds only what differs
// from archetypes/_base.json); `mergeProfile` in profiles.ts lays them over each other.
//
// Evidence rule: every leaf value in an archetype or profile file that is not the same as what it inherits needs an
// evidence line, kept in the file's `evidence` map under the leaf's dotted path or any parent path ("buildings.floors",
// or "life" for every life value). An evidence line names its source: an area sheet section, an OSM or footprint
// statistic (rule_cells.json summary), a registry entry or a photo set. No value comes from a cliche.

/** The closed list of words for densities and frequencies, with a scale for the generator (tunable, not area data). */
export const LEVELS = ['none', 'rare', 'low', 'medium', 'high', 'very_high'] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_DENSITY: Record<Level, number> = { none: 0, rare: 0.1, low: 0.25, medium: 0.5, high: 0.75, very_high: 0.95 };
export const levelDensity = (l: Level): number => LEVEL_DENSITY[l];

export const UPKEEP = ['kept', 'clean', 'mixed', 'worn', 'patched', 'neglected'] as const;
export const SCRIPTS = ['latn', 'deva', 'arab'] as const;
export const LAMP_COLOURS = ['warm_white', 'sodium', 'mixed', 'none'] as const;

/**
 * Generated building types (kit modules). There is no worship type on purpose: places of worship come from OSM or the
 * landmark registry, never from an area profile (DELHI_WORLD.md 3, respect rule).
 */
export const BUILDING_TYPES = [
  'colonnade_block', 'arcade_row', 'shop_house', 'haveli', 'hotel_stack', 'trade_row', 'bazaar_block', 'commercial_block', 'office_slab',
  'office_tower', 'govt_slab', 'low_row_market', 'bungalow', 'flats_block', 'civic_hall', 'admin_block', 'station_building', 'shed', 'house', 'other',
] as const;

/** Top-level keys that are not claims (no evidence line needed). */
export const META_KEYS = ['_doc', 'id', 'name', 'archetype', 'sheet', 'confidence', 'kind', 'blueprint', 'names_file', 'infrastructure', 'evidence', 'notes'] as const;

/** Words that label a group of people or a place by a stereotype. A profile text containing one fails (respect rule). */
export const STEREOTYPE_WORDS = [
  'slum', 'ghetto', 'dirty people', 'poor people', 'beggar', 'filthy', 'chaotic', 'chaos', 'seedy', 'sleazy', 'red-light', 'red light', 'brothel', 'prostitut',
  'criminal', 'gangster', 'thug', 'backward', 'primitive', 'exotic', 'mystical', 'teeming', 'squalor', 'squalid', 'hellhole', 'third world', 'third-world',
  'terrorist', 'extremist', 'sex work', 'trafficking', 'fundamentalist',
] as const;

/** Evidence lines must name a source of one of these kinds. */
export const EVIDENCE_SOURCE = /(sheet|OSM|rule_cells|footprint|Overture|photo set|registry|census|owner|inspector|archetype|infrastructure variant|hero road)/i;

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

export const isObj = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Paths whose value is a whole distribution: a profile replaces it, it is never merged key by key. */
export const WHOLE_PATHS: readonly string[] = ['buildings.mix'];

/** Deep merge: objects merge key by key, arrays, primitives and the WHOLE_PATHS replace. */
export function deepMerge(base: JsonObject, over: JsonObject, prefix = ''): JsonObject {
  const out: JsonObject = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const path = prefix ? `${prefix}.${k}` : k;
    const b = out[k];
    out[k] = isObj(v) && isObj(b) && !WHOLE_PATHS.includes(path) ? deepMerge(b, v, path) : v;
  }
  return out;
}

/** Leaf paths of a value: objects are walked, arrays, primitives and the WHOLE_PATHS are leaves. */
export function leaves(v: Json, prefix = ''): { path: string; value: Json }[] {
  if (!isObj(v) || WHOLE_PATHS.includes(prefix)) return prefix ? [{ path: prefix, value: v }] : [];
  const out: { path: string; value: Json }[] = [];
  for (const [k, c] of Object.entries(v)) out.push(...leaves(c, prefix ? `${prefix}.${k}` : k));
  return out;
}

export function getPath(v: JsonObject, path: string): Json | undefined {
  let cur: Json | undefined = v;
  for (const k of path.split('.')) {
    if (!isObj(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

export function setPath(v: JsonObject, path: string, value: Json): void {
  const keys = path.split('.');
  let cur = v;
  for (const k of keys.slice(0, -1)) {
    const next = cur[k];
    if (isObj(next)) cur = next;
    else {
      const made: JsonObject = {};
      cur[k] = made;
      cur = made;
    }
  }
  cur[keys[keys.length - 1] as string] = value;
}

/** The evidence line covering a leaf path: the path itself or the nearest parent. */
export function evidenceFor(evidence: JsonObject, path: string): string | null {
  const keys = path.split('.');
  for (let n = keys.length; n >= 1; n--) {
    const e = evidence[keys.slice(0, n).join('.')];
    if (typeof e === 'string' && e.length > 0) return e;
  }
  return null;
}

type Check = (v: Json) => string | null;
const str: Check = (v) => (typeof v === 'string' && v.length > 0 ? null : 'must be a non-empty string');
const unit: Check = (v) => (typeof v === 'number' && v >= 0 && v <= 1 ? null : 'must be a number from 0 to 1');
const level: Check = (v) => (typeof v === 'string' && (LEVELS as readonly string[]).includes(v) ? null : `must be one of ${LEVELS.join(', ')}`);
const oneOf = (list: readonly string[]): Check => (v) => (typeof v === 'string' && list.includes(v) ? null : `must be one of ${list.join(', ')}`);
const range: Check = (v) => (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' && v[0] >= 0 && v[0] <= v[1] ? null : 'must be [min, max] with 0 <= min <= max');
const rangeOrNull: Check = (v) => (v === null ? null : range(v));
const strings: Check = (v) => (Array.isArray(v) && v.every((s) => typeof s === 'string' && s.length > 0) ? null : 'must be a list of non-empty strings');
const scripts: Check = (v) => (Array.isArray(v) && v.length > 0 && v.every((s) => (SCRIPTS as readonly string[]).includes(s as string)) ? null : `must be a list of ${SCRIPTS.join(', ')}`);
const mix: Check = (v) => {
  if (!isObj(v)) return 'must be an object of type: share';
  const entries = Object.entries(v);
  if (entries.length === 0) return null; // nothing generated (lawns, monuments from the registry only)
  for (const [k, s] of entries) {
    if (!(BUILDING_TYPES as readonly string[]).includes(k)) return `unknown building type "${k}"`;
    if (typeof s !== 'number' || s < 0 || s > 1) return `share of ${k} must be 0 to 1`;
  }
  const total = entries.reduce((a, [, s]) => a + (s as number), 0);
  return Math.abs(total - 1) <= 0.011 ? null : `shares sum to ${total.toFixed(3)}, must be 1`;
};
const floors: Check = (v) => {
  if (!isObj(v)) return 'must be {p10, p50, p90}';
  const { p10, p50, p90 } = v;
  if (![p10, p50, p90].every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 60)) return 'p10, p50, p90 must be whole numbers from 1 to 60';
  return (p10 as number) <= (p50 as number) && (p50 as number) <= (p90 as number) ? null : 'p10 <= p50 <= p90';
};
const kindFreq: Check = (v) => {
  if (!isObj(v) || typeof v.kind !== 'string' || v.kind.length === 0) return 'must be {kind, frequency}';
  return level(v.frequency ?? null);
};

/** Check for every known leaf path (or object path for composite values). Unknown paths fail. */
export const FIELD_CHECKS: Record<string, Check> = {
  'buildings.mix': mix,
  'buildings.generated': str,
  'buildings.floors': floors,
  'buildings.setback_m': range,
  'buildings.frontage_m': range,
  'buildings.ground_floor': str,
  'buildings.colours': strings,
  'buildings.materials': strings,
  'buildings.balconies': str,
  'buildings.roof.water_tanks': unit,
  'buildings.roof.dish': unit,
  'buildings.roof.solar': unit,
  'buildings.roofline': str,
  'buildings.wires': level,
  'buildings.upkeep': oneOf(UPKEEP),
  'house_railings.balcony_grilles': kindFreq,
  'house_railings.roof_parapets': kindFreq,
  'house_railings.gate_and_window_grilles': kindFreq,
  'house_railings.outside_stairs': kindFreq,
  'footpath.width_m': rangeOrNull,
  'footpath.surface': str,
  'footpath.kerb': str,
  'footpath.notes': str,
  'lamps.kind': str,
  'lamps.height_m': rangeOrNull,
  'lamps.spacing_m': rangeOrNull,
  'lamps.colour': oneOf(LAMP_COLOURS),
  'lamps.notes': str,
  'boundaries.kinds': strings,
  'boundaries.height_m': rangeOrNull,
  'greenery.street_trees': level,
  'greenery.species': strings,
  'greenery.lawns': level,
  'greenery.planters': level,
  'props.bins': level,
  'props.benches': level,
  'props.bus_shelters': level,
  'props.hoardings': level,
  'props.barricades': level,
  'props.poles_and_wires': level,
  'props.parking_bays': level,
  'props.notes': str,
  'signs.density': level,
  'signs.scripts': scripts,
  'signs.boards': str,
  'life.vendors': level,
  'life.pedestrians': level,
  'life.people': str,
  'life.cycle_rickshaws': level,
  'life.e_rickshaws': level,
  'life.autos': level,
  'life.buses': level,
  'life.parked_cars': level,
  'life.parked_two_wheelers': level,
  'life.animals.dogs': level,
  'life.animals.cats': level,
  'life.animals.cows': level,
  'life.animals.pigeons': level,
  'sound.bed': str,
  'sound.horn_rate': level,
  'sound.calls': str,
  'wear': unit,
  'wear_notes': str,
  'road.condition': str,
  'road.cleanliness': level,
};

/** Top-level claim keys that are not meta. */
export const isMeta = (key: string): boolean => (META_KEYS as readonly string[]).includes(key);

/** Problems with the values of one profile or archetype object (not the evidence). Empty when valid. */
export function checkValues(obj: JsonObject, label: string): string[] {
  const out: string[] = [];
  const texts: string[] = [];
  const walk = (v: Json, path: string): void => {
    const direct = FIELD_CHECKS[path];
    if (direct) {
      const bad = direct(v);
      if (bad) out.push(`${label}: ${path} ${bad}`);
      collectText(v, texts);
      return;
    }
    if (isObj(v)) {
      for (const [k, c] of Object.entries(v)) walk(c, path ? `${path}.${k}` : k);
      return;
    }
    out.push(`${label}: unknown field ${path}`);
  };
  for (const [k, v] of Object.entries(obj)) if (!isMeta(k)) walk(v, k);
  for (const t of texts) {
    const low = t.toLowerCase();
    for (const w of STEREOTYPE_WORDS) if (low.includes(w)) out.push(`${label}: text "${t.slice(0, 60)}" uses the stereotype word "${w}"`);
  }
  return out;
}

function collectText(v: Json, into: string[]): void {
  if (typeof v === 'string') into.push(v);
  else if (Array.isArray(v)) for (const c of v) collectText(c, into);
  else if (isObj(v)) for (const c of Object.values(v)) collectText(c, into);
}

/** Text of the whole file that people read (values and evidence lines), for the respect word check. */
export function allText(obj: JsonObject): string[] {
  const t: string[] = [];
  collectText(obj as Json, t);
  return t;
}
