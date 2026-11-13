// Area profiles (P2-004, DELHI_WORLD.md 2, ARCH_OPTIONS PS1): loader, schema and evidence check, archetype merge and
// the lookup from a world point to its area or rule archetype. Pure: it takes the file texts keyed by repo path (the
// tests read them with vite; the bake driver will read them from disk) and a lon/lat to metres function.
//
// Files (harness/data/areas/): areas.geojson (drawn polygons), rules.json + rule_cells.json (archetype by rule for the
// ground in no polygon), archetypes/_base.json (neutral defaults, no claims) and archetypes/<name>.json (only what
// differs from the base), profiles/<area_id>.json (only what differs from the archetype), overrides.json (inspector
// edits, laid over the profile), palette.json (colour words to swatches).
import { cellKey, cellOf, ruleArchetypes } from './rules.ts';
import type { RuleTable } from './rules.ts';
import { EVIDENCE_SOURCE, allText, checkValues, deepMerge, evidenceFor, getPath, isMeta, isObj, leaves, setPath, STEREOTYPE_WORDS } from './schema.ts';
import type { Json, JsonObject } from './schema.ts';

export interface RuleCells {
  cell_m: number;
  archetypes: string[];
  summary: Record<string, Record<string, number | null>>;
  rows: [number, number, number][];
}

interface GeoFeature {
  type: 'Feature';
  properties: { id: string; name: string; archetype: string; blend_m: number; sheet?: string; focus?: string; drawn_from?: string };
  geometry: { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] };
}
export interface AreaFC {
  type: 'FeatureCollection';
  features: GeoFeature[];
}

export interface AreaData {
  base: JsonObject;
  archetypes: Record<string, JsonObject>;
  profiles: Record<string, JsonObject>;
  overrides: JsonObject;
  areas: AreaFC;
  rules: RuleTable;
  cells: RuleCells;
  palette: Record<string, string>;
}

const DIR = 'harness/data/areas/';
const parse = (text: string | undefined, what: string): JsonObject => {
  if (text === undefined) throw new Error(`area data: ${what} is missing`);
  return JSON.parse(text) as JsonObject;
};

/** Build the data from file texts keyed by repo path ("harness/data/areas/profiles/ito.json"). */
export function parseAreaFiles(files: Record<string, string>): AreaData {
  const norm: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) norm[k.replace(/^\//, '')] = v;
  const archetypes: Record<string, JsonObject> = {};
  const profiles: Record<string, JsonObject> = {};
  for (const [k, v] of Object.entries(norm)) {
    let m = /^harness\/data\/areas\/archetypes\/([a-z0-9_]+)\.json$/.exec(k);
    if (m && m[1] !== '_base') archetypes[m[1] as string] = parse(v, k);
    m = /^harness\/data\/areas\/profiles\/([a-z0-9_]+)\.json$/.exec(k);
    if (m) profiles[m[1] as string] = parse(v, k);
  }
  return {
    base: parse(norm[`${DIR}archetypes/_base.json`], 'archetypes/_base.json'),
    archetypes,
    profiles,
    overrides: parse(norm[`${DIR}overrides.json`], 'overrides.json'),
    areas: parse(norm[`${DIR}areas.geojson`], 'areas.geojson') as unknown as AreaFC,
    rules: parse(norm[`${DIR}rules.json`], 'rules.json') as unknown as RuleTable,
    cells: parse(norm[`${DIR}rule_cells.json`], 'rule_cells.json') as unknown as RuleCells,
    palette: parse(norm[`${DIR}palette.json`], 'palette.json') as unknown as Record<string, string>,
  };
}

/** What a profile or archetype is made of, laid out: values without meta keys, the evidence map and the meta keys. */
export interface Merged {
  id: string;
  archetype: string;
  values: JsonObject;
  evidence: JsonObject;
  meta: JsonObject;
}

const split = (obj: JsonObject): { values: JsonObject; evidence: JsonObject; meta: JsonObject } => {
  const values: JsonObject = {};
  const meta: JsonObject = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'evidence') continue;
    if (isMeta(k)) meta[k] = v;
    else values[k] = v;
  }
  return { values, evidence: isObj(obj.evidence) ? obj.evidence : {}, meta };
};

/** Overrides for an area: dotted path to value, with its own evidence lines. */
const overridesOf = (data: AreaData, id: string): { set: JsonObject; evidence: JsonObject } => {
  const areas = data.overrides.areas;
  const o = isObj(areas) ? areas[id] : undefined;
  if (!isObj(o)) return { set: {}, evidence: {} };
  return { set: isObj(o.set) ? o.set : {}, evidence: isObj(o.evidence) ? o.evidence : {} };
};

/** The archetype with the neutral base laid under it. */
export function mergeArchetype(data: AreaData, name: string): Merged {
  const a = data.archetypes[name];
  if (!a) throw new Error(`area data: no archetype "${name}"`);
  const b = split(data.base);
  const x = split(a);
  return { id: name, archetype: name, values: deepMerge(b.values, x.values), evidence: deepMerge(b.evidence, x.evidence), meta: x.meta };
}

/** One area: base, then its archetype, then its profile file, then the inspector overrides. */
export function mergeProfile(data: AreaData, id: string): Merged {
  const p = data.profiles[id];
  if (!p) throw new Error(`area data: no profile "${id}"`);
  const archetype = typeof p.archetype === 'string' ? p.archetype : '';
  const parent = mergeArchetype(data, archetype);
  const x = split(p);
  const o = overridesOf(data, id);
  const values = deepMerge(parent.values, x.values);
  for (const [path, v] of Object.entries(o.set)) setPath(values, path, v);
  return { id, archetype, values, evidence: deepMerge(deepMerge(parent.evidence, x.evidence), o.evidence), meta: x.meta };
}

// ------------------------------------------------------------------ lookup

type Ring = { x: number; z: number }[];
interface IndexedArea {
  id: string;
  archetype: string;
  blend_m: number;
  rings: Ring[]; // first ring of each polygon is the outer ring, the rest are holes: [outer, ...holes] per polygon
  polys: Ring[][];
  box: [number, number, number, number];
}
export interface AreaIndex {
  areas: IndexedArea[];
  cellM: number;
  cells: Map<string, string>;
  fallback: string;
}
export type Project = (lon: number, lat: number) => { x: number; z: number };

const inRing = (x: number, z: number, ring: Ring): boolean => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as { x: number; z: number };
    const b = ring[j] as { x: number; z: number };
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
};

export function buildIndex(data: AreaData, project: Project): AreaIndex {
  const areas: IndexedArea[] = data.areas.features.map((f) => {
    const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).map((poly) => poly.map((r) => r.map(([lon, lat]) => project(lon as number, lat as number))));
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const poly of polys) for (const p of poly[0] as Ring) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    return { id: f.properties.id, archetype: f.properties.archetype, blend_m: f.properties.blend_m, rings: polys.flat(), polys, box: [x0, x1, z0, z1] };
  });
  const cells = new Map<string, string>();
  for (const [ix, iz, ai] of data.cells.rows) cells.set(cellKey(ix, iz), data.cells.archetypes[ai] as string);
  return { areas, cellM: data.cells.cell_m, cells, fallback: data.rules.fallback };
}

/** Every drawn area holding the point (a valid map has at most one). */
export function areasAt(index: AreaIndex, x: number, z: number): IndexedArea[] {
  return index.areas.filter((a) => x >= a.box[0] && x <= a.box[1] && z >= a.box[2] && z <= a.box[3] && a.polys.some((poly) => inRing(x, z, poly[0] as Ring) && !poly.slice(1).some((h) => inRing(x, z, h))));
}

export interface Resolved {
  kind: 'area' | 'rule' | 'none';
  /** The area id, or for a rule cell the archetype name. */
  id: string;
  archetype: string;
}

/** The area, or the rule archetype of the 100 m cell, holding a world point (bake frame metres). */
export function resolveAt(index: AreaIndex, x: number, z: number): Resolved {
  const hit = areasAt(index, x, z);
  if (hit[0]) return { kind: 'area', id: hit[0].id, archetype: hit[0].archetype };
  const [ix, iz] = cellOf(x, z, index.cellM);
  const a = index.cells.get(cellKey(ix, iz));
  return a ? { kind: 'rule', id: a, archetype: a } : { kind: 'none', id: '', archetype: '' };
}

// ------------------------------------------------------------------ checks

/** Evidence problems of one layer: every leaf that differs from what it inherits needs a sourced evidence line. */
function evidenceProblems(label: string, own: JsonObject, inherited: JsonObject, evidence: JsonObject): string[] {
  const out: string[] = [];
  for (const { path, value } of leaves(own)) {
    const got = getPath(inherited, path);
    if (got !== undefined && JSON.stringify(got) === JSON.stringify(value)) continue; // a default
    const line = evidenceFor(evidence, path);
    if (!line) out.push(`${label}: ${path} is not a default and has no evidence line`);
    else if (line.length < 25 || !EVIDENCE_SOURCE.test(line)) out.push(`${label}: evidence for ${path} must name its source (sheet, OSM statistic, registry or photo set): "${line}"`);
  }
  for (const k of Object.keys(evidence)) if (k !== '*' && !leaves(own).some((l) => l.path === k || l.path.startsWith(`${k}.`)) && getPath(own, k) === undefined) out.push(`${label}: evidence key ${k} matches no value`);
  return out;
}

const tooLong = (s: string): boolean => s.length > 600;

/** Every problem with the data files themselves (schema, evidence, references). Empty when all is well. */
export function checkData(data: AreaData): string[] {
  const out: string[] = [];
  const base = split(data.base);
  out.push(...checkValues(base.values, 'archetypes/_base'));
  for (const [name, a] of Object.entries(data.archetypes)) {
    const x = split(a);
    out.push(...checkValues(x.values, `archetype ${name}`));
    out.push(...evidenceProblems(`archetype ${name}`, x.values, base.values, x.evidence));
    if (typeof a.sheet !== 'string' && typeof a.confidence !== 'string') out.push(`archetype ${name}: needs a confidence word`);
  }
  for (const [id, p] of Object.entries(data.profiles)) {
    if (p.id !== id) out.push(`profile ${id}: id "${String(p.id)}" does not match the file name`);
    const arch = typeof p.archetype === 'string' ? p.archetype : '';
    if (!data.archetypes[arch]) {
      out.push(`profile ${id}: unknown archetype "${arch}"`);
      continue;
    }
    const x = split(p);
    out.push(...checkValues(x.values, `profile ${id}`));
    const parent = mergeArchetype(data, arch);
    out.push(...evidenceProblems(`profile ${id}`, x.values, parent.values, x.evidence));
    if (typeof p.sheet !== 'string') out.push(`profile ${id}: needs a sheet line`);
    if (typeof p.confidence !== 'string') out.push(`profile ${id}: needs a confidence word`);
    if (!('blueprint' in p)) out.push(`profile ${id}: needs a blueprint slot (null until an authored blueprint exists)`);
    const merged = mergeProfile(data, id);
    out.push(...checkValues(merged.values, `merged ${id}`));
    const ov = overridesOf(data, id);
    out.push(...evidenceProblems(`override ${id}`, ov.set, parent.values, ov.evidence));
  }
  for (const f of data.areas.features) {
    const { id, archetype } = f.properties;
    if (!data.profiles[id]) out.push(`areas.geojson: polygon ${id} has no profile file`);
    else if (data.profiles[id]?.archetype !== archetype) out.push(`areas.geojson: polygon ${id} says archetype ${archetype}, the profile says ${String(data.profiles[id]?.archetype)}`);
  }
  for (const id of Object.keys(data.profiles)) if (!data.areas.features.some((f) => f.properties.id === id)) out.push(`profile ${id}: no polygon in areas.geojson`);
  for (const a of ruleArchetypes(data.rules)) if (!data.archetypes[a]) out.push(`rules.json: archetype ${a} has no archetype file`);
  for (const a of data.cells.archetypes) if (!ruleArchetypes(data.rules).includes(a)) out.push(`rule_cells.json: archetype ${a} is not in rules.json`);
  // the palette must hold every colour word used
  for (const name of [...Object.keys(data.archetypes), ...Object.keys(data.profiles)]) {
    const merged = name in data.profiles ? mergeProfile(data, name) : mergeArchetype(data, name);
    const colours = getPath(merged.values, 'buildings.colours');
    if (Array.isArray(colours)) for (const c of colours) if (typeof c === 'string' && !(c in data.palette)) out.push(`${name}: colour "${c}" is not in palette.json`);
  }
  for (const [file, obj] of [...Object.entries(data.profiles), ...Object.entries(data.archetypes)] as [string, JsonObject][]) {
    for (const t of allText(obj)) {
      if (tooLong(t)) out.push(`${file}: a text is over 600 characters`);
      const low = t.toLowerCase();
      for (const w of STEREOTYPE_WORDS) if (low.includes(w)) out.push(`${file}: "${w}" is a stereotype word`);
    }
  }
  return out;
}

/** The share of the biggest building type of an area (0 when nothing is generated). */
export function topBuildingShare(merged: Merged): { type: string; share: number } {
  const mix = getPath(merged.values, 'buildings.mix');
  if (!isObj(mix)) return { type: '', share: 0 };
  let best = { type: '', share: 0 };
  for (const [k, v] of Object.entries(mix)) if (typeof v === 'number' && v > best.share) best = { type: k, share: v };
  return best;
}

export type { Json, JsonObject };
