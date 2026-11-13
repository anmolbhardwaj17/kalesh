// OSM side of the landmark registry (P2-005, LM1): the objects that may be landmarks, with their footprint ring and
// centre, and the roads the tier score counts as "seen from". Overture drops the wikidata, historic, amenity and
// religion tags, so this reads the OSM elements directly. Pure.
import type { OsmElement } from '../osm.ts';
import type { OsmLandmark, SeenRoad } from './types.ts';

const EARTH = 6371008.8;

/** Great circle distance in metres between two WGS84 points. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The tags that make a named OSM object a landmark candidate (DELHI_WORLD.md 1 "Sources"). */
const LANDMARK_TAGS: readonly [string, readonly string[] | null][] = [
  ['historic', null], ['tourism', ['attraction', 'museum', 'viewpoint', 'gallery']], ['amenity', ['place_of_worship']],
  ['railway', ['station']], ['station', ['subway']], ['shop', ['mall']], ['leisure', ['stadium', 'park', 'garden']], ['barrier', ['city_wall']],
];

export function landmarkKind(tags: Readonly<Record<string, string>>): string | null {
  for (const [key, values] of LANDMARK_TAGS) {
    const v = tags[key];
    if (v !== undefined && v !== 'no' && (values === null || values.includes(v))) return `${key}=${v}`;
  }
  return null;
}

/** Why an OSM object with a wikidata tag or a landmark tag is still not a landmark candidate, or null. */
export function notALandmark(tags: Readonly<Record<string, string>>): string | null {
  if (tags['highway'] !== undefined) return 'a road (highway tag)';
  if (tags['route'] !== undefined) return 'a route';
  if (tags['boundary'] !== undefined && tags['historic'] === undefined) return 'a boundary';
  if (tags['place'] !== undefined) return `a place=${tags['place']} label: an area, not a structure (the area profiles cover it)`;
  if (tags['waterway'] !== undefined || tags['natural'] === 'water') return 'water';
  if (tags['railway'] === 'rail' || tags['railway'] === 'subway' || tags['railway'] === 'subway_entrance') return `railway=${tags['railway']}`;
  if (tags['public_transport'] === 'stop_position') return 'a stop position';
  return null;
}

interface RingGeo {
  lat: number;
  lon: number;
  area: number;
  closed: boolean;
  ring: [number, number][];
}

/**
 * OSM objects that may be landmarks: anything with a wikidata tag, and named objects with a landmark tag. `include`
 * names objects by id ("way/1") that are taken whatever their tags say (the owner list and the edits join by id).
 */
export function osmLandmarks(elements: readonly OsmElement[], include: ReadonlySet<string> = new Set()): { landmarks: OsmLandmark[]; skipped: { id: string; name: string; why: string }[] } {
  const nodes = new Map<number, { lat: number; lon: number }>();
  const ways = new Map<number, OsmElement>();
  for (const e of elements) {
    if (e.type === 'node' && e.lat !== undefined && e.lon !== undefined) nodes.set(e.id, { lat: e.lat, lon: e.lon });
    else if (e.type === 'way' && (!ways.has(e.id) || e.tags)) ways.set(e.id, e);
  }
  const ringOf = (ids: readonly number[]): RingGeo | null => {
    const pts = ids.map((id) => nodes.get(id)).filter((p): p is { lat: number; lon: number } => p !== undefined);
    if (pts.length === 0) return null;
    const lat0 = (pts[0] as { lat: number }).lat;
    const lon0 = (pts[0] as { lon: number }).lon;
    const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
    const kz = 110540;
    // metres around the first point: the shoelace sums lose nothing to the size of the raw degrees
    const loc = pts.map((p) => ({ x: (p.lon - lon0) * kx, z: (p.lat - lat0) * kz }));
    let a = 0;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < loc.length; i++) {
      const p = loc[i] as { x: number; z: number };
      const q = loc[(i + 1) % loc.length] as { x: number; z: number };
      const w = p.x * q.z - q.x * p.z;
      a += w;
      cx += (p.x + q.x) * w;
      cz += (p.z + q.z) * w;
    }
    const closed = ids.length >= 4 && ids[0] === ids[ids.length - 1] && pts.length === ids.length;
    if (!closed || Math.abs(a) < 1e-6) {
      return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length, area: 0, closed: false, ring: [] };
    }
    const ring = pts.slice(0, -1).map((p): [number, number] => [p.lat, p.lon]);
    return { lat: lat0 + cz / (3 * a) / kz, lon: lon0 + cx / (3 * a) / kx, area: Math.abs(a) / 2, closed: true, ring };
  };
  const out: OsmLandmark[] = [];
  const skipped: { id: string; name: string; why: string }[] = [];
  const seen = new Set<string>();
  for (const e of elements) {
    const tags = e.tags;
    if (!tags) continue;
    const wikidata = /^Q\d+$/.test(tags['wikidata'] ?? '') ? (tags['wikidata'] as string) : null;
    const kind = landmarkKind(tags);
    const name = tags['name:en'] ?? tags['name'] ?? '';
    const id = `${e.type}/${e.id}`;
    const forced = include.has(id);
    if (!forced && !wikidata && !(kind && name)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const no = forced ? null : notALandmark(tags);
    if (no) {
      if (wikidata) skipped.push({ id, name, why: no });
      continue;
    }
    let geo: RingGeo | null = null;
    let ringRef = id;
    if (e.type === 'node' && e.lat !== undefined && e.lon !== undefined) geo = { lat: e.lat, lon: e.lon, area: 0, closed: false, ring: [] };
    else if (e.type === 'way') geo = ringOf(e.nodes ?? []);
    else if (e.type === 'relation') {
      for (const m of e.members ?? []) {
        if (m.type !== 'way' || m.role === 'inner') continue;
        const g = ringOf(ways.get(m.ref)?.nodes ?? []);
        if (g && (!geo || g.area > geo.area)) {
          geo = g;
          ringRef = `way/${m.ref}`;
        }
      }
    }
    if (!geo) continue;
    out.push({
      id, name, nameHi: tags['name:hi'] ?? null, wikidata, lat: geo.lat, lon: geo.lon, hasFootprint: geo.closed, ringRef: geo.closed ? ringRef : id, ring: geo.ring,
      areaM2: Math.round(geo.area), kind: kind ?? (tags['building'] !== undefined ? `building=${tags['building']}` : 'other'), tags,
    });
  }
  return { landmarks: out, skipped };
}

const ARTERIAL = new Set(['motorway', 'trunk', 'primary', 'secondary']);

/**
 * The roads a landmark can be "seen from" for the tier score: arterials (motorway to secondary) and the hero roads
 * of harness/data/hero_list.json (by street name or way id). Read from the OSM ways, not from the block graph, so
 * the registry does not change when the road repair does.
 */
export function seenRoads(elements: readonly OsmElement[], project: (lat: number, lon: number) => { x: number; z: number }, hero: { names: readonly string[]; ways: readonly number[] }): SeenRoad[] {
  const nodes = new Map<number, { x: number; z: number }>();
  for (const e of elements) if (e.type === 'node' && e.lat !== undefined && e.lon !== undefined) nodes.set(e.id, project(e.lat, e.lon));
  const heroNames = new Set(hero.names);
  const heroWays = new Set(hero.ways);
  const out: SeenRoad[] = [];
  for (const e of elements) {
    if (e.type !== 'way' || !e.tags || !e.nodes) continue;
    const hw = e.tags['highway'];
    if (hw === undefined) continue;
    const isHero = heroWays.has(e.id) || heroNames.has(e.tags['name'] ?? '') || heroNames.has(e.tags['name:en'] ?? '');
    if (!isHero && !ARTERIAL.has(hw)) continue;
    const pts = e.nodes.map((n) => nodes.get(n)).filter((p): p is { x: number; z: number } => p !== undefined);
    if (pts.length >= 2) out.push({ id: `way/${e.id}`, hero: isHero, pts });
  }
  return out;
}
