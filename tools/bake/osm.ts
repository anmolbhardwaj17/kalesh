// OSM elements (the JSON of an Overpass query) to the bake's map model in district metres: road ways with their
// class, layer and width, building footprints, open ground. Pure: the caller reads the file and passes a projection.
import { boxOf, openRing, polylineLength, ringArea, ringCentroid } from './geom.ts';
import type { Box2, P2 } from './geom.ts';
import { osmBelowGround } from './graph/underground.ts';

export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  members?: { type: string; ref: number; role: string }[];
  tags?: Record<string, string>;
}

export type Tags = Readonly<Record<string, string>>;

export interface MapNode extends P2 {
  id: number;
  lat: number;
  lon: number;
  tags?: Tags;
}

export interface Road {
  /** "way/<osm id>" */
  id: string;
  nodes: number[];
  pts: P2[];
  tags: Tags;
  cls: string;
  link: boolean;
  layer: number;
  bridge: boolean;
  tunnel: boolean;
  oneway: boolean;
  name: string;
  /** Carriageway width in metres: the width tag, else lanes, else the class default. */
  width: number;
  widthFrom: 'width' | 'lanes' | 'class';
  length: number;
  box: Box2;
}

export interface Footprint {
  /** "way/<id>" or "relation/<id>" for OSM; other sources use their own prefix. */
  id: string;
  source: string;
  ring: P2[];
  area: number;
  centre: P2;
  box: Box2;
  tags: Tags;
  height: number | null;
  levels: number | null;
}

export interface OpenGround {
  id: string;
  kind: string;
  ring: P2[];
  area: number;
  centre: P2;
  box: Box2;
}

export interface MapData {
  nodes: Map<number, MapNode>;
  roads: Road[];
  /** Ways with a highway tag that are not carriageways (footways, steps, paths, cycleways). */
  footways: number;
  buildings: Footprint[];
  /** Footprints left out because their tags put them below ground (graph/underground.ts osmBelowGround): metro halls, subways. */
  underground: number;
  /** Those footprints, for the underground class of the block graph (graph/underground.ts). */
  belowGround: Footprint[];
  open: OpenGround[];
  /** Road ways per node id: the degree of a node in the road graph. */
  roadsAtNode: Map<number, Road[]>;
}

/** Carriageway classes, most important first. Everything else with a highway tag is a footway or not built. */
export const ROAD_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'pedestrian', 'road'] as const;

/** Default carriageway width in metres per class: [one-way, two-way]. A first guess, replaced by the lane model. */
const CLASS_WIDTH: Readonly<Record<string, readonly [number, number]>> = {
  motorway: [10.5, 14], trunk: [10.5, 14], primary: [7, 12], secondary: [6.5, 10], tertiary: [6, 8],
  unclassified: [4, 5.5], residential: [4, 5.5], living_street: [3, 3.5], service: [3, 3.5], pedestrian: [3, 4], road: [4, 5.5],
};
/** Ramps and slip roads: [one-way, two-way]. */
const LINK_WIDTH: readonly [number, number] = [5, 7];
const LANE_WIDTH = 3.2;

/** 0 to 1: how much an issue on a road of this class matters (motorway 1, service 0.2). */
export function classImpact(cls: string): number {
  const i = (ROAD_CLASSES as readonly string[]).indexOf(cls);
  if (i < 0) return 0.1;
  return [1, 0.95, 0.85, 0.7, 0.55, 0.35, 0.3, 0.2, 0.2, 0.3, 0.3][i] ?? 0.2;
}

const num = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)/.exec(v);
  return m ? Number(m[1]) : null;
};

export function roadWidth(tags: Tags, cls: string, oneway: boolean, link = false): { width: number; from: Road['widthFrom'] } {
  const w = num(tags['width']);
  if (w !== null && w > 1 && w < 60) return { width: w, from: 'width' };
  const lanes = num(tags['lanes']);
  if (lanes !== null && lanes >= 1 && lanes <= 12) return { width: Math.round(lanes * LANE_WIDTH * 10) / 10, from: 'lanes' };
  const d = link ? LINK_WIDTH : CLASS_WIDTH[cls] ?? [4, 5.5];
  return { width: oneway ? d[0] : d[1], from: 'class' };
}

const OPEN_KEYS: readonly [string, readonly string[]][] = [
  ['leisure', ['park', 'garden', 'pitch', 'playground', 'golf_course', 'stadium', 'recreation_ground']],
  ['landuse', ['grass', 'recreation_ground', 'meadow', 'forest', 'village_green', 'greenfield']],
  ['natural', ['grassland', 'wood', 'scrub']],
];

export function openKind(tags: Tags): string | null {
  for (const [key, values] of OPEN_KEYS) {
    const v = tags[key];
    if (v !== undefined && values.includes(v)) return `${key}=${v}`;
  }
  return null;
}

/** Builds the map model. `project` turns WGS84 degrees into district metres (tools/geo/projection.ts). */
export function buildMap(elements: readonly OsmElement[], project: (lat: number, lon: number) => P2): MapData {
  const nodes = new Map<number, MapNode>();
  const ways = new Map<number, OsmElement>();
  for (const e of elements) {
    if (e.type === 'node' && e.lat !== undefined && e.lon !== undefined) {
      const p = project(e.lat, e.lon);
      const prev = nodes.get(e.id);
      // a node may come twice (once with tags, once as a way's member): keep the tags
      nodes.set(e.id, { id: e.id, lat: e.lat, lon: e.lon, x: p.x, z: p.z, tags: e.tags ?? prev?.tags });
    } else if (e.type === 'way') {
      const prev = ways.get(e.id);
      if (!prev || (e.tags && !prev.tags)) ways.set(e.id, e);
    }
  }
  const ptsOf = (ids: readonly number[]): P2[] => {
    const out: P2[] = [];
    for (const id of ids) {
      const n = nodes.get(id);
      if (n) out.push({ x: n.x, z: n.z });
    }
    return out;
  };
  const map: MapData = { nodes, roads: [], footways: 0, buildings: [], underground: 0, belowGround: [], open: [], roadsAtNode: new Map() };
  const footprint = (id: string, ringIds: readonly number[], tags: Tags): void => {
    const ring = openRing(ptsOf(ringIds));
    if (ring.length < 3) return;
    const levels = num(tags['building:levels']);
    const below = osmBelowGround(tags) !== null;
    if (below) map.underground++;
    (below ? map.belowGround : map.buildings).push({ id, source: 'osm', ring, area: Math.abs(ringArea(ring)), centre: ringCentroid(ring), box: boxOf(ring), tags, height: num(tags['height']), levels });
  };
  for (const w of ways.values()) {
    const tags = w.tags ?? {};
    const ids = w.nodes ?? [];
    const hw = tags['highway'];
    if (hw !== undefined) {
      const link = hw.endsWith('_link');
      const cls = link ? hw.slice(0, -5) : hw;
      if (!(ROAD_CLASSES as readonly string[]).includes(cls) || tags['area'] === 'yes') {
        map.footways++;
      } else {
        const known = ids.filter((id) => nodes.has(id));
        const pts = ptsOf(known);
        if (pts.length >= 2) {
          const oneway = tags['oneway'] === 'yes' || tags['oneway'] === '-1' || tags['junction'] === 'roundabout' || cls === 'motorway';
          const bridge = tags['bridge'] !== undefined && tags['bridge'] !== 'no';
          const tunnel = tags['tunnel'] !== undefined && tags['tunnel'] !== 'no';
          const { width, from } = roadWidth(tags, cls, oneway, link);
          const road: Road = {
            id: `way/${w.id}`, nodes: known, pts, tags, cls, link, layer: num(tags['layer']) ?? 0, bridge, tunnel, oneway,
            name: tags['name'] ?? tags['ref'] ?? '', width, widthFrom: from, length: polylineLength(pts), box: boxOf(pts),
          };
          map.roads.push(road);
          for (const id of new Set(known)) {
            const list = map.roadsAtNode.get(id);
            if (list) list.push(road);
            else map.roadsAtNode.set(id, [road]);
          }
        }
      }
      continue;
    }
    const closed = ids.length >= 4 && ids[0] === ids[ids.length - 1];
    if (!closed) continue;
    if (tags['building'] !== undefined && tags['building'] !== 'no') {
      footprint(`way/${w.id}`, ids, tags);
      continue;
    }
    const kind = openKind(tags);
    if (kind) {
      const ring = openRing(ptsOf(ids));
      if (ring.length >= 3) map.open.push({ id: `way/${w.id}`, kind, ring, area: Math.abs(ringArea(ring)), centre: ringCentroid(ring), box: boxOf(ring) });
    }
  }
  // multipolygon buildings: the outer ways (a first pass keeps each closed outer way as one footprint)
  for (const e of elements) {
    if (e.type !== 'relation' || !e.tags || e.tags['building'] === undefined || e.tags['building'] === 'no') continue;
    let part = 0;
    for (const m of e.members ?? []) {
      if (m.type !== 'way' || m.role !== 'outer') continue;
      const w = ways.get(m.ref);
      const ids = w?.nodes ?? [];
      if (ids.length >= 4 && ids[0] === ids[ids.length - 1] && !(w?.tags && w.tags['building'] !== undefined)) {
        footprint(part === 0 ? `relation/${e.id}` : `relation/${e.id}#${part}`, ids, e.tags);
        part++;
      }
    }
  }
  map.roads.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  map.buildings.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  map.belowGround.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return map;
}

export interface TagCoverage {
  roads: number;
  roadKm: number;
  /** Share of road ways (0 to 1) that carry the tag. */
  lanes: number;
  width: number;
  layer: number;
  oneway: number;
  name: number;
  bridges: number;
  tunnels: number;
  buildings: number;
  /** Share of buildings with a height tag, with building:levels, and with either. */
  height: number;
  levels: number;
  heightOrLevels: number;
  byClass: Record<string, { ways: number; km: number; lanes: number; width: number }>;
}

/** Tag coverage of the roads and buildings: what the lane model and the massing can read and what they must infer. */
export function tagCoverage(map: MapData): TagCoverage {
  const share = (n: number, of: number) => (of === 0 ? 0 : Math.round((n / of) * 10000) / 10000);
  const r = map.roads;
  const b = map.buildings;
  const byClass: TagCoverage['byClass'] = {};
  for (const road of r) {
    const c = (byClass[road.cls] ??= { ways: 0, km: 0, lanes: 0, width: 0 });
    c.ways++;
    c.km += road.length / 1000;
    if (road.tags['lanes'] !== undefined) c.lanes++;
    if (road.tags['width'] !== undefined) c.width++;
  }
  for (const c of Object.values(byClass)) {
    c.lanes = share(c.lanes, c.ways);
    c.width = share(c.width, c.ways);
    c.km = Math.round(c.km * 100) / 100;
  }
  const has = (key: string) => r.filter((x) => x.tags[key] !== undefined).length;
  return {
    roads: r.length, roadKm: Math.round(r.reduce((s, x) => s + x.length, 0) / 10) / 100,
    lanes: share(has('lanes'), r.length), width: share(has('width'), r.length), layer: share(has('layer'), r.length),
    oneway: share(has('oneway'), r.length), name: share(has('name'), r.length),
    bridges: r.filter((x) => x.bridge).length, tunnels: r.filter((x) => x.tunnel).length,
    buildings: b.length, height: share(b.filter((x) => x.height !== null).length, b.length), levels: share(b.filter((x) => x.levels !== null).length, b.length),
    heightOrLevels: share(b.filter((x) => x.height !== null || x.levels !== null).length, b.length), byClass,
  };
}
