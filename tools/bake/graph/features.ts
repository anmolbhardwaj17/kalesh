// Everything of the block graph that is not a road (MAP_REPAIR.md "Pipeline" step 1): rail and metro lines, foot
// over bridges, water (areas and lines) and open ground, from the OSM elements, cut at the stage outline. Areas come
// from closed ways and from multipolygon relations (member ways joined into rings); a relation member that the box
// extract does not hold leaves its ring open, which is counted, never guessed. Pure.
import { FillRule, intersectD } from 'clipper2-ts';
import type { PathD, PathsD } from 'clipper2-ts';
import { boxOf, boxesMeet, pointInRing, polylineLength, ringArea } from '../geom.ts';
import type { P2 } from '../geom.ts';
import { openKind } from '../osm.ts';
import type { OsmElement, Tags } from '../osm.ts';

export type LineKind = 'rail' | 'metro';

export interface LineFeature {
  /** "way/<id>" plus "#<part>" when the outline cuts it into more than one piece. */
  id: string;
  kind: string;
  name: string;
  pts: P2[];
  len: number;
  layer: number;
  bridge: boolean;
  tunnel: boolean;
}

export interface AreaFeature {
  id: string;
  kind: string;
  name: string;
  /** Outer rings and holes as clipped by the outline (holes wind against the outer rings). */
  rings: P2[][];
  area: number;
}

export interface FootBridge {
  /** The lowest way id of the bridge ("way/<id>"); a bridge is the foot ways with a bridge tag joined at shared nodes. */
  id: string;
  ways: string[];
  pts: P2[][];
  len: number;
}

export interface StationFeature {
  /** "node/<id>" or "way/<id>" */
  id: string;
  kind: LineKind;
  name: string;
  x: number;
  z: number;
}

export interface Features {
  rail: LineFeature[];
  /** Railway and metro stations inside the outline (a node, or the middle of a station way). */
  stations: StationFeature[];
  water: AreaFeature[];
  waterLines: LineFeature[];
  open: AreaFeature[];
  footBridges: FootBridge[];
  /** Multipolygon rings left open because a member way is outside the extract. */
  openRings: number;
}

const RAIL = new Set(['rail', 'subway', 'light_rail', 'monorail', 'narrow_gauge', 'tram']);
const METRO = new Set(['subway', 'light_rail', 'monorail']);
const WATER_LINES = new Set(['river', 'stream', 'canal', 'drain', 'ditch']);
const FOOT = new Set(['footway', 'steps', 'pedestrian', 'path']);

const num = (v: string | undefined): number => {
  const m = v === undefined ? null : /^\s*(-?\d+)/.exec(v);
  return m ? Number(m[1]) : 0;
};
const yes = (v: string | undefined): boolean => v !== undefined && v !== 'no';

export function railKind(tags: Tags): LineKind | null {
  const r = tags['railway'];
  if (r === undefined || !RAIL.has(r)) return null;
  if (METRO.has(r) || /metro/i.test(tags['operator'] ?? '')) return 'metro';
  return 'rail';
}

export function waterKind(tags: Tags): string | null {
  if (tags['natural'] === 'water') return tags['water'] ? `water=${tags['water']}` : 'natural=water';
  if (tags['waterway'] === 'riverbank') return 'waterway=riverbank';
  if (tags['landuse'] === 'reservoir' || tags['landuse'] === 'basin') return `landuse=${tags['landuse']}`;
  return null;
}

/** Joins open ways (node id lists) end to end into closed rings; returns the rings and how many stayed open. */
export function assembleRings(ways: readonly (readonly number[])[]): { rings: number[][]; open: number } {
  const rings: number[][] = [];
  const pool = ways.filter((w) => w.length >= 2).map((w) => w.slice());
  let open = 0;
  while (pool.length) {
    let ring = pool.shift() as number[];
    let grew = true;
    while (ring[0] !== ring[ring.length - 1] && grew) {
      grew = false;
      const end = ring[ring.length - 1] as number;
      for (let i = 0; i < pool.length; i++) {
        const w = pool[i] as number[];
        if (w[0] === end) ring = ring.concat(w.slice(1));
        else if (w[w.length - 1] === end) ring = ring.concat(w.slice().reverse().slice(1));
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4 && ring[0] === ring[ring.length - 1]) rings.push(ring);
    else open++;
  }
  return { rings, open };
}

/** Cuts a line at the ring and keeps the pieces inside (a piece is inside when its middle is). */
export function clipLine(pts: readonly P2[], ring: readonly P2[]): P2[][] {
  const cutPts: P2[] = [];
  const out: P2[][] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i] as P2;
    const b = pts[i + 1] as P2;
    cutPts.push(a);
    const hits: { t: number; p: P2 }[] = [];
    for (let k = 0; k < ring.length; k++) {
      const c = ring[k] as P2;
      const d = ring[(k + 1) % ring.length] as P2;
      const rx = b.x - a.x;
      const rz = b.z - a.z;
      const sx = d.x - c.x;
      const sz = d.z - c.z;
      const den = rx * sz - rz * sx;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((c.x - a.x) * sz - (c.z - a.z) * sx) / den;
      const u = ((c.x - a.x) * rz - (c.z - a.z) * rx) / den;
      if (t <= 0 || t >= 1 || u < 0 || u >= 1) continue;
      hits.push({ t, p: { x: a.x + rx * t, z: a.z + rz * t } });
    }
    hits.sort((p, q) => p.t - q.t);
    for (const h of hits) {
      cutPts.push(h.p);
      flush(cutPts, ring, out);
      cutPts.length = 0;
      cutPts.push(h.p);
    }
  }
  if (pts.length) cutPts.push(pts[pts.length - 1] as P2);
  flush(cutPts, ring, out);
  return out;
}

function flush(line: readonly P2[], ring: readonly P2[], out: P2[][]): void {
  if (line.length < 2) return;
  const a = line[0] as P2;
  const b = line[1] as P2;
  if (pointInRing({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, ring) && polylineLength(line) > 0.01) out.push(line.map((p) => ({ x: p.x, z: p.z })));
}

/** Area rings cut to the outline (EvenOdd: a hole stays a hole). Empty when the area lies outside. */
export function clipArea(rings: readonly (readonly P2[])[], ring: readonly P2[]): P2[][] {
  const subject: PathsD = rings.map((r) => r.map((p) => ({ x: p.x, y: p.z })) as PathD);
  const clip: PathsD = [ring.map((p) => ({ x: p.x, y: p.z })) as PathD];
  return intersectD(subject, clip, FillRule.EvenOdd, 3).map((path) => path.map((p) => ({ x: p.x, z: p.y })));
}

const areaOf = (rings: readonly P2[][]): number => Math.abs(rings.reduce((s, r) => s + ringArea(r), 0));

/** Features of the OSM elements inside the outline `ring` (block metres). `pos` gives a node's position. */
export function readFeatures(elements: readonly OsmElement[], pos: (id: number) => P2 | undefined, ring: readonly P2[]): Features {
  const out: Features = { rail: [], stations: [], water: [], waterLines: [], open: [], footBridges: [], openRings: 0 };
  const outlineBox = boxOf(ring);
  const ptsOf = (ids: readonly number[]): P2[] => ids.map(pos).filter((p): p is P2 => p !== undefined);
  const ways = new Map<number, OsmElement>();
  for (const e of elements) if (e.type === 'way' && (!ways.has(e.id) || (e.tags && !ways.get(e.id)?.tags))) ways.set(e.id, e);
  const lines = (w: OsmElement, kind: string, list: LineFeature[]): void => {
    const t = w.tags ?? {};
    const pts = ptsOf(w.nodes ?? []);
    if (pts.length < 2 || !boxesMeet(boxOf(pts), outlineBox)) return;
    const pieces = clipLine(pts, ring);
    pieces.forEach((p, i) => list.push({ id: pieces.length > 1 ? `way/${w.id}#${i}` : `way/${w.id}`, kind, name: t['name'] ?? '', pts: p, len: polylineLength(p), layer: num(t['layer']), bridge: yes(t['bridge']), tunnel: yes(t['tunnel']) }));
  };
  const area = (id: string, kind: string, name: string, rings: P2[][], list: AreaFeature[]): void => {
    if (!rings.length || !boxesMeet(boxOf(rings.flat()), outlineBox)) return;
    const cut = clipArea(rings, ring);
    if (cut.length) list.push({ id, kind, name, rings: cut, area: areaOf(cut) });
  };
  const station = (id: string, t: Tags, p: P2 | undefined): void => {
    if (!p || (t['railway'] !== 'station' && t['railway'] !== 'halt') || !pointInRing(p, ring)) return;
    const metro = t['station'] === 'subway' || t['station'] === 'light_rail' || t['subway'] === 'yes' || /metro/i.test(`${t['operator'] ?? ''} ${t['network'] ?? ''}`);
    out.stations.push({ id, kind: metro ? 'metro' : 'rail', name: t['name'] ?? '', x: p.x, z: p.z });
  };
  for (const e of elements) if (e.type === 'node' && e.tags) station(`node/${e.id}`, e.tags, pos(e.id));
  const foot: OsmElement[] = [];
  for (const w of [...ways.values()].sort((a, b) => a.id - b.id)) {
    if (w.tags && (w.tags['railway'] === 'station' || w.tags['railway'] === 'halt')) {
      const sp = ptsOf(w.nodes ?? []);
      if (sp.length) station(`way/${w.id}`, w.tags, { x: sp.reduce((s, q) => s + q.x, 0) / sp.length, z: sp.reduce((s, q) => s + q.z, 0) / sp.length });
    }
    const t = w.tags ?? {};
    const ids = w.nodes ?? [];
    const rk = railKind(t);
    if (rk) {
      lines(w, rk, out.rail);
      continue;
    }
    if (t['highway'] !== undefined && FOOT.has(t['highway']) && yes(t['bridge'])) {
      foot.push(w);
      continue;
    }
    if (t['waterway'] !== undefined && WATER_LINES.has(t['waterway'])) {
      lines(w, `waterway=${t['waterway']}`, out.waterLines);
      continue;
    }
    const closed = ids.length >= 4 && ids[0] === ids[ids.length - 1];
    if (!closed || t['building'] !== undefined || t['highway'] !== undefined) continue;
    const wk = waterKind(t);
    if (wk) area(`way/${w.id}`, wk, t['name'] ?? '', [ptsOf(ids)], out.water);
    else {
      const ok = openKind(t);
      if (ok) area(`way/${w.id}`, ok, t['name'] ?? '', [ptsOf(ids)], out.open);
    }
  }
  for (const r of elements) {
    if (r.type !== 'relation' || !r.tags || r.tags['type'] !== 'multipolygon' || r.tags['building'] !== undefined) continue;
    const wk = waterKind(r.tags);
    const ok = wk ? null : openKind(r.tags);
    if (!wk && !ok) continue;
    const members = (r.members ?? []).filter((m) => m.type === 'way' && (m.role === 'outer' || m.role === 'inner' || m.role === ''));
    const asm = assembleRings(members.map((m) => ways.get(m.ref)?.nodes ?? []).filter((n) => n.length >= 2));
    out.openRings += asm.open;
    const rings = asm.rings.map(ptsOf).filter((p) => p.length >= 4);
    area(`relation/${r.id}`, (wk ?? ok) as string, r.tags['name'] ?? '', rings, wk ? out.water : out.open);
  }
  out.footBridges = footBridges(foot, ptsOf, ring);
  const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  out.water.sort(byId);
  out.open.sort(byId);
  out.stations.sort(byId);
  out.stations = out.stations.filter((st, i) => i === 0 || st.id !== (out.stations[i - 1] as StationFeature).id);
  return out;
}

/** Foot ways with a bridge tag, joined where they share a node (a bridge deck and its stairs are one bridge). */
function footBridges(ways: readonly OsmElement[], ptsOf: (ids: readonly number[]) => P2[], ring: readonly P2[]): FootBridge[] {
  const parent = ways.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i] as number] as number;
    return i;
  };
  const byNode = new Map<number, number>();
  ways.forEach((w, i) => {
    for (const n of w.nodes ?? []) {
      const j = byNode.get(n);
      if (j === undefined) byNode.set(n, i);
      else parent[find(i)] = find(j);
    }
  });
  const groups = new Map<number, number[]>();
  ways.forEach((_, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  });
  const out: FootBridge[] = [];
  for (const g of groups.values()) {
    const lines = g.map((i) => ptsOf((ways[i] as OsmElement).nodes ?? [])).filter((p) => p.length >= 2);
    const inside = lines.flatMap((l) => clipLine(l, ring));
    if (!inside.length) continue;
    const ids = g.map((i) => (ways[i] as OsmElement).id).sort((a, b) => a - b);
    out.push({ id: `way/${ids[0]}`, ways: ids.map((i) => `way/${i}`), pts: inside, len: inside.reduce((s, l) => s + polylineLength(l), 0) });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
