// Underground structures (P1-041, decisions.md "Underground structures are their own class (Anmol)"): metro halls,
// underground markets and car parks. A footprint is underground when its source tags say so (OSM: location
// underground, a negative layer or level, no floors above ground with floors below, a tunnel, a subway station
// building; Overture: is_underground, a negative level, no floors above with floors below) or when the list in
// harness/data/underground.json names it. The list also names footprints whose tags look underground but are not
// (a covered arcade on layer -1). An Overture copy of an OSM way follows that way's class, so a copy can never bring
// a metro hall back as a building. Underground footprints never reach the graph's footprints, so no rule, shell or
// ground cut sees them; they ride along as named features for the metro work and the minimap. Pure.
import { boxOf, openRing, pointInRing, ringArea, ringCentroid } from '../geom.ts';
import type { P2 } from '../geom.ts';
import type { Footprint, MapNode, OsmElement, Tags } from '../osm.ts';
import type { StationFeature } from './features.ts';

/** One entry of harness/data/underground.json: a source id ("way/<id>", "relation/<id>", "overture/<id>") and why. */
export interface UndergroundListEntry {
  id: string;
  name?: string;
  kind?: string;
  why: string;
}

export interface UndergroundList {
  /** Below ground whatever the tags say (also ways that are not buildings, such as a market mapped as land use). */
  underground: UndergroundListEntry[];
  /** On the ground whatever the tags say. */
  surface: UndergroundListEntry[];
}

export const EMPTY_UNDERGROUND_LIST: UndergroundList = { underground: [], surface: [] };

export interface UndergroundFeature {
  id: string;
  name: string;
  /** metro_station, market, car_park or structure. */
  kind: string;
  /** Why it is underground: the tag or the list line. */
  reason: string;
  /** "tag" or "list". */
  by: 'tag' | 'list';
  source: string;
  ring: P2[];
  area: number;
  /** Other source footprints of the same structure (Overture copies of the OSM way): left out with it. */
  copies: string[];
  /** True when the source drew it as a building (OSM building or an Overture row): without the class it would be a footprint. */
  footprint: boolean;
}

const num = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)/.exec(v);
  return m ? Number(m[1]) : null;
};

/** The levels a level tag names ("-2", "0;-1", "-2--1"), as numbers. */
function levelsOf(v: string | undefined): number[] {
  if (v === undefined) return [];
  const out: number[] = [];
  for (const part of v.split(';')) {
    const m = /^\s*(-?\d+(?:\.\d+)?)(?:\s*-\s*(-?\d+(?:\.\d+)?))?\s*$/.exec(part);
    if (!m) return [];
    out.push(Number(m[1]));
    if (m[2] !== undefined) out.push(Number(m[2]));
  }
  return out;
}

const ABOVE = new Set(['surface', 'overground', 'roof', 'rooftop', 'overhead', 'outdoor']);

/** Why the tags of an OSM footprint put it below ground, or null when they do not. */
export function osmBelowGround(tags: Tags): string | null {
  const loc = tags['location'];
  if (loc === 'underground') return 'location=underground';
  if (loc !== undefined && ABOVE.has(loc)) return null;
  const layer = num(tags['layer']);
  if (layer !== null && layer < 0) return `layer ${layer}`;
  if (layer !== null && layer > 0) return null;
  const lv = levelsOf(tags['level']);
  if (lv.length && Math.max(...lv) < 0) return `level ${tags['level']}`;
  const above = num(tags['building:levels']);
  const below = num(tags['building:levels:underground']);
  if (above === 0 && below !== null && below > 0) return `no floors above ground, ${below} below`;
  const tunnel = tags['tunnel'];
  if (tunnel !== undefined && tunnel !== 'no' && tunnel !== 'building_passage') return `tunnel=${tunnel}`;
  if (tags['station'] === 'subway') return 'a subway station building';
  return null;
}

/** The Overture fields the class reads, kept in a footprint's tags under "overture:" keys. */
export interface OvertureFields {
  record: string | null;
  level: number | null;
  isUnderground: boolean;
  floors: number | null;
  floorsUnderground: number | null;
  name: string | null;
  cls: string | null;
}

/** Why Overture's own fields put a footprint below ground, or null. */
export function overtureBelowGround(f: Omit<OvertureFields, 'record' | 'name' | 'cls'>): string | null {
  if (f.isUnderground) return 'is_underground (Overture)';
  if (f.level !== null && f.level < 0) return `level ${f.level} (Overture)`;
  if (f.floors === 0 && f.floorsUnderground !== null && f.floorsUnderground > 0) return `no floors above ground, ${f.floorsUnderground} below (Overture)`;
  return null;
}

/** The OSM id an Overture record id names ("w1158884368@4" is "way/1158884368"), or null for other sources. */
export function osmIdOfRecord(record: string | null | undefined): string | null {
  const m = /^([wr])(\d+)(?:@\d+)?$/.exec(record ?? '');
  if (!m) return null;
  return `${m[1] === 'w' ? 'way' : 'relation'}/${m[2]}`;
}

/** Overture fields as tags (strings), so they ride on a Footprint through the merge. */
export function overtureTags(f: OvertureFields): Record<string, string> {
  const t: Record<string, string> = {};
  if (f.record) t['overture:record'] = f.record;
  if (f.level !== null) t['overture:level'] = String(f.level);
  if (f.isUnderground) t['overture:is_underground'] = 'yes';
  if (f.floors !== null) t['overture:floors'] = String(f.floors);
  if (f.floorsUnderground !== null) t['overture:floors_underground'] = String(f.floorsUnderground);
  if (f.name) t['overture:name'] = f.name;
  if (f.cls) t['overture:class'] = f.cls;
  return t;
}

const fieldsOf = (t: Tags): Omit<OvertureFields, 'record' | 'name' | 'cls'> => ({
  level: num(t['overture:level']), isUnderground: t['overture:is_underground'] === 'yes', floors: num(t['overture:floors']), floorsUnderground: num(t['overture:floors_underground']),
});

/** The footprint id without the part suffix ("overture/<id>#1" is "overture/<id>"). */
const baseId = (id: string): string => id.replace(/#\d+$/, '');

export interface UndergroundInput {
  /** OSM footprints on the ground by their tags (osm.ts buildings). */
  osm: readonly Footprint[];
  /** OSM footprints below ground by their tags (osm.ts belowGround). */
  osmBelow: readonly Footprint[];
  /** Overture footprints, every row (their fields in "overture:" tags). */
  overture: readonly Footprint[];
  list: UndergroundList;
  /** For list entries that are not buildings: the OSM elements and the projected nodes. */
  elements: readonly OsmElement[];
  node: (id: number) => MapNode | undefined;
  /** The stage outline (block metres): a feature belongs to the stage when its middle is inside. */
  ring: readonly P2[];
  /** Stations of the graph's features, to name a metro hall after the station inside it. */
  stations: readonly StationFeature[];
}

export interface UndergroundSplit {
  osm: Footprint[];
  overture: Footprint[];
  features: UndergroundFeature[];
  /** List entries the extract does not have (a way renamed or outside the data). */
  missing: string[];
}

/** Names of features the data does not name. */
const KIND_WORDS: Record<string, string> = { metro_station: 'unnamed station', market: 'unnamed market', car_park: 'unnamed car park', structure: 'unnamed structure' };

function kindOf(tags: Tags, stationInside: boolean): string {
  if (stationInside || tags['station'] === 'subway' || tags['subway'] === 'yes' || tags['building'] === 'train_station' || tags['overture:class'] === 'train_station') return 'metro_station';
  if (tags['amenity'] === 'parking' || tags['parking'] !== undefined) return 'car_park';
  if (tags['shop'] !== undefined || tags['landuse'] === 'retail' || tags['building'] === 'retail') return 'market';
  return 'structure';
}

/** Splits the footprints of a stage into the ground ones (for the merge) and the underground features. */
export function splitUnderground(input: UndergroundInput): UndergroundSplit {
  const listed = new Map(input.list.underground.map((e) => [e.id, e]));
  const surface = new Set(input.list.surface.map((e) => e.id));
  const seen = new Set<string>();
  const under = new Map<string, { f: Footprint; reason: string; by: 'tag' | 'list'; entry?: UndergroundListEntry; copies: string[] }>();
  const osm: Footprint[] = [];
  /** OSM id to its class: true below ground, false on the ground. */
  const osmClass = new Map<string, boolean>();
  for (const f of input.osm) {
    const e = listed.get(f.id);
    if (e) {
      seen.add(f.id);
      under.set(f.id, { f, reason: `list: ${e.why}`, by: 'list', entry: e, copies: [] });
      osmClass.set(f.id, true);
    } else {
      osm.push(f);
      osmClass.set(f.id, false);
    }
  }
  for (const f of input.osmBelow) {
    if (surface.has(f.id)) {
      seen.add(f.id);
      osm.push(f);
      osmClass.set(f.id, false);
      continue;
    }
    const e = listed.get(f.id);
    if (e) seen.add(f.id);
    under.set(f.id, { f, reason: e ? `list: ${e.why}` : `tag: ${osmBelowGround(f.tags) ?? 'below ground'}`, by: e ? 'list' : 'tag', ...(e ? { entry: e } : {}), copies: [] });
    osmClass.set(f.id, true);
  }
  // list entries that are not footprints (a market mapped as land use): their ways as features
  for (const e of input.list.underground) {
    if (seen.has(e.id) || under.has(e.id) || !e.id.startsWith('way/')) continue;
    const id = Number(e.id.slice(4));
    const w = input.elements.find((x) => x.type === 'way' && x.id === id);
    const pts = (w?.nodes ?? []).map((n) => input.node(n)).filter((n): n is MapNode => n !== undefined).map((n) => ({ x: n.x, z: n.z }));
    const ring = openRing(pts);
    if (!w || ring.length < 3) continue;
    seen.add(e.id);
    under.set(e.id, { f: { id: e.id, source: 'osm', ring, area: Math.abs(ringArea(ring)), centre: ringCentroid(ring), box: boxOf(ring), tags: w.tags ?? {}, height: null, levels: null }, reason: `list: ${e.why}`, by: 'list', entry: e, copies: [] });
  }
  // underground car parks mapped as parking areas (not buildings): features by their tags
  for (const w of input.elements) {
    const t = w.tags;
    if (w.type !== 'way' || !t || t['building'] !== undefined || t['parking'] !== 'underground' || under.has(`way/${w.id}`)) continue;
    const ids = w.nodes ?? [];
    if (ids.length < 4 || ids[0] !== ids[ids.length - 1]) continue;
    const ring = openRing(ids.map((n) => input.node(n)).filter((n): n is MapNode => n !== undefined).map((n) => ({ x: n.x, z: n.z })));
    if (ring.length < 3) continue;
    under.set(`way/${w.id}`, { f: { id: `way/${w.id}`, source: 'osm', ring, area: Math.abs(ringArea(ring)), centre: ringCentroid(ring), box: boxOf(ring), tags: t, height: null, levels: null }, reason: 'tag: parking=underground', by: 'tag', copies: [] });
  }
  const overture: Footprint[] = [];
  for (const f of input.overture) {
    const base = baseId(f.id);
    const e = listed.get(base);
    const ref = osmIdOfRecord(f.tags['overture:record']);
    const refClass = ref !== null ? osmClass.get(ref) : undefined;
    if (surface.has(base) || refClass === false) {
      if (surface.has(base)) seen.add(base);
      overture.push(f);
      continue;
    }
    let reason: string | null = null;
    let by: 'tag' | 'list' = 'tag';
    if (e) {
      seen.add(base);
      reason = `list: ${e.why}`;
      by = 'list';
    } else if (refClass === true) reason = `copy of ${ref}`;
    else {
      const own = overtureBelowGround(fieldsOf(f.tags));
      reason = own ? `tag: ${own}` : null;
    }
    if (reason === null) {
      overture.push(f);
      continue;
    }
    const owner = ref !== null && refClass === true ? under.get(ref) : undefined;
    if (owner) owner.copies.push(f.id);
    else under.set(f.id, { f, reason, by, ...(e ? { entry: e } : {}), copies: [] });
  }
  const features: UndergroundFeature[] = [];
  for (const [id, u] of under) {
    if (!pointInRing(u.f.centre, input.ring)) continue;
    const inside = input.stations.filter((s) => s.kind === 'metro' && s.name && pointInRing(s, u.f.ring));
    const kind = u.entry?.kind ?? kindOf(u.f.tags, inside.length > 0);
    const own = u.f.tags['name'] ?? u.f.tags['overture:name'];
    const station = inside[0]?.name;
    const name = u.entry?.name ?? own ?? (station ? `${station} metro station` : KIND_WORDS[kind] ?? 'unnamed structure');
    features.push({
      id, name, kind, reason: u.reason, by: u.by, source: u.f.source,
      ring: u.f.ring.map((p) => ({ x: Math.round(p.x * 100) / 100 + 0, z: Math.round(p.z * 100) / 100 + 0 })),
      area: Math.round(u.f.area * 10) / 10, copies: u.copies.slice().sort(), footprint: u.f.source !== 'osm' || (u.f.tags['building'] !== undefined && u.f.tags['building'] !== 'no'),
    });
  }
  features.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const missing = [...input.list.underground, ...input.list.surface].map((e) => e.id).filter((id) => !seen.has(id) && !under.has(id));
  return { osm, overture, features, missing };
}

/** Every id an underground feature stands for (its own and its copies'), to the feature. */
export function undergroundIds(features: readonly UndergroundFeature[]): Map<string, UndergroundFeature> {
  const out = new Map<string, UndergroundFeature>();
  for (const f of features) for (const id of [f.id, ...f.copies]) out.set(id, f);
  return out;
}

/** The label the inspector and the minimap show: "Underground: Rajiv Chowk metro station". */
export const undergroundLabel = (f: Pick<UndergroundFeature, 'name'>): string => `Underground: ${f.name}`;
