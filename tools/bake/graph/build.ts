// The block graph (P1-009, docs/ARCHITECTURE.md `bake/graph/`, MAP_REPAIR.md "Pipeline" steps 1 and 2): one topology
// graph for a whole stage of a block, in block metres (east +X, north -Z). Road ways are normalised (nodes at one
// spot become one node, a way drawn twice is kept once), cut at the stage outline (a road that leaves the stage ends
// in a "map edge" node, kept for the later scale-up), cut at shared nodes, chains joined, one tangent through a node;
// the one-way carriageways of one street are paired; every road is classified with the Delhi defaults. Rail and metro,
// foot over bridges, water, open ground and the merged building footprints ride along. Ids are stable (source id plus
// part), so overrides survive a new extract. Pure: the driver reads the files (tools/bake/sources/graphinput.ts).
import { projector } from '../../geo/projection.ts';
import type { LatLon } from '../../geo/projection.ts';
import { boxOf, polylineLength } from '../geom.ts';
import type { P2 } from '../geom.ts';
import { buildMap } from '../osm.ts';
import type { OsmElement, Road, Tags } from '../osm.ts';
import { clipRoads } from '../layout/edge.ts';
import { classifyRoad } from './classify.ts';
import type { Carriageway, RoadClass } from './classify.ts';
import { readFeatures } from './features.ts';
import type { Features } from './features.ts';
import { mergeStageFootprints, overtureFootprints } from './footprints.ts';
import type { OvertureRow } from './footprints.ts';
import { PAIR_CLASSES, pairCarriageways } from './pairs.ts';
import type { PairEdge } from './pairs.ts';
import { cutAndJoin, draftPoints, throughHints } from './topology.ts';
import type { Draft, Run } from './topology.ts';

export const GRAPH_VERSION = 1;

export type NodeKind = 'junction' | 'joint' | 'end' | 'map_edge';

export interface GraphNode {
  /** "n<osm node id>", or "m<way id>.<k>" for the k-th place the stage outline cuts that way. */
  id: string;
  x: number;
  z: number;
  /** junction: three or more ends; joint: two ends that do not join (class or direction changes); end: a dead end; map_edge: the road goes on outside the stage. */
  kind: NodeKind;
  ends: number;
}

export interface EdgePiece {
  /** "way/<id>" */
  way: string;
  /** Metres along the edge. */
  s0: number;
  s1: number;
  layer: number;
  bridge: boolean;
  tunnel: boolean;
}

export interface GraphEdge {
  /** "w<way id>.<part>": the lowest way piece along it (part counts the pieces of that way after the cuts). */
  id: string;
  a: string;
  b: string;
  /** Centre line from a to b, millimetres. */
  pts: P2[];
  len: number;
  oneway: boolean;
  name: string;
  ref: string;
  roundabout: boolean;
  /** Unit direction of travel along the edge at a and at b (shared with the edge it runs on into there). */
  ta: P2;
  tb: P2;
  pieces: EdgePiece[];
  road: RoadClass;
  /** The edges of the other carriageway of the same street. */
  pairedWith: string[];
}

export interface GraphPair {
  /** "<edge a>|<edge b>", the two ids in order. */
  id: string;
  a: string;
  b: string;
  name: string;
  matchedA: number;
  matchedB: number;
  gap: number;
  /** The two halves carry different names (paired on geometry alone; the inspector shows these). */
  namesDiffer: boolean;
}

export interface GraphFootprint {
  id: string;
  source: string;
  ring: P2[];
  area: number;
  height: number | null;
  levels: number | null;
  tags: Tags;
}

export interface Normalised {
  /** Road nodes merged into another node at the same spot (under 2 cm apart). */
  snappedNodes: number;
  /** Ways that repeat another way node for node: kept once. */
  duplicateWays: string[];
  /** Ways left with fewer than two distinct nodes. */
  degenerateWays: number;
  /** Road pieces that started or ended on the outline and stayed out (clipRoads nicks), and excursions kept. */
  nicks: number;
  excursions: number;
  /** Footways and other highway ways that are not carriageways (counted, not in the graph). */
  footways: number;
}

export interface BlockGraph {
  version: number;
  block: string;
  stage: string;
  origin: LatLon;
  /** The stage outline in block metres (open ring). */
  outline: P2[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  pairs: GraphPair[];
  footprints: GraphFootprint[];
  footprintSources: ReturnType<typeof mergeStageFootprints>['bySource'];
  features: Features;
  normalised: Normalised;
  /** Clip crossings: every one must end in a map edge node. */
  crossings: P2[];
}

export interface GraphInput {
  block: string;
  stage: string;
  origin: LatLon;
  /** Stage outline as [lon, lat] pairs. */
  outline: readonly (readonly [number, number])[];
  elements: readonly OsmElement[];
  overture: readonly OvertureRow[];
  /** Tests only: a plain projection in place of the block projection around `origin`. */
  project?: (lat: number, lon: number) => P2;
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const rp = (p: P2): P2 => ({ x: r3(p.x), z: r3(p.z) });
const unit = (x: number, z: number): P2 => {
  const l = Math.hypot(x, z) || 1;
  return { x: Math.round((x / l) * 1e6) / 1e6 + 0, z: Math.round((z / l) * 1e6) / 1e6 + 0 };
};
const wayNum = (id: string): number => Number(id.replace(/^way\//, ''));

/** Snaps nodes closer than `tol` metres into the lowest id and drops ways drawn twice. Returns new Road objects. */
export function normaliseRoads(roads: readonly Road[], tol = 0.02): { roads: Road[]; snapped: number; duplicates: string[]; degenerate: number } {
  const cell = 0.05;
  const grid = new Map<string, { id: number; x: number; z: number }[]>();
  const rep = new Map<number, number>();
  const all = new Map<number, P2>();
  for (const r of roads) r.nodes.forEach((id, i) => all.set(id, r.pts[i] as P2));
  for (const id of [...all.keys()].sort((a, b) => a - b)) {
    const p = all.get(id) as P2;
    const ci = Math.floor(p.x / cell);
    const cj = Math.floor(p.z / cell);
    let hit: number | null = null;
    for (let i = ci - 1; i <= ci + 1 && hit === null; i++) {
      for (let j = cj - 1; j <= cj + 1 && hit === null; j++) {
        for (const q of grid.get(`${i},${j}`) ?? []) if (Math.hypot(q.x - p.x, q.z - p.z) < tol) hit = q.id;
      }
    }
    if (hit !== null) rep.set(id, hit);
    else {
      const key = `${ci},${cj}`;
      const list = grid.get(key);
      if (list) list.push({ id, x: p.x, z: p.z });
      else grid.set(key, [{ id, x: p.x, z: p.z }]);
    }
  }
  const out: Road[] = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];
  let degenerate = 0;
  for (const r of roads) {
    const nodes: number[] = [];
    const pts: P2[] = [];
    r.nodes.forEach((id0) => {
      const id = rep.get(id0) ?? id0;
      if (nodes[nodes.length - 1] === id) return;
      nodes.push(id);
      pts.push(all.get(id) as P2);
    });
    if (nodes.length < 2 || polylineLength(pts) < 0.01) {
      degenerate++;
      continue;
    }
    const fwd = nodes.join(',');
    const seq = r.oneway ? `${r.tags['oneway'] === '-1' ? '-' : '+'}${fwd}` : [fwd, nodes.slice().reverse().join(',')].sort()[0];
    const key = `${r.cls}|${r.link}|${r.layer}|${seq}`;
    if (seen.has(key)) {
      duplicates.push(r.id);
      continue;
    }
    seen.add(key);
    out.push({ ...r, nodes, pts, length: polylineLength(pts), box: boxOf(pts) });
  }
  return { roads: out, snapped: rep.size, duplicates, degenerate };
}

/** The longest way piece of a draft (its tags classify the edge). */
function longestPart(d: Draft): Draft['parts'][number] {
  let best = d.parts[0] as Draft['parts'][number];
  let bestLen = -1;
  for (const p of d.parts) {
    const l = polylineLength(p.pts);
    if (l > bestLen + 1e-9) {
      best = p;
      bestLen = l;
    }
  }
  return best;
}

/** Builds the block graph of one stage. */
export function buildBlockGraph(input: GraphInput): BlockGraph {
  const proj = projector(input.origin);
  const project = input.project ?? ((lat: number, lon: number): P2 => {
    const w = proj.toWorld(lat, lon);
    return { x: w.x, z: w.z };
  });
  const ring = input.outline.map(([lon, lat]) => project(lat, lon));
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && ring.length > 1 && Math.hypot(first.x - last.x, first.z - last.z) < 1e-6) ring.pop();

  const map = buildMap(input.elements, project);
  const norm = normaliseRoads(map.roads);
  const clip = clipRoads(norm.roads, ring);

  // runs in the direction of travel; clip ends get negative ids and a stable name
  const runs: Run[] = [];
  const keep = new Set<number>();
  const clipName = new Map<number, string>();
  const cutsOf = new Map<string, number>();
  let synthetic = -1;
  for (const piece of clip.inside) {
    const ids = piece.ids.map((id) => {
      if (id !== null) return id;
      const k = cutsOf.get(piece.road.id) ?? 0;
      cutsOf.set(piece.road.id, k + 1);
      const s = synthetic--;
      keep.add(s);
      clipName.set(s, `m${wayNum(piece.road.id)}.${k}`);
      return s;
    });
    const back = piece.road.tags['oneway'] === '-1';
    runs.push({ road: piece.road, nodes: back ? ids.reverse() : ids, pts: back ? piece.pts.slice().reverse() : piece.pts, reversed: back });
  }
  const { drafts, position } = cutAndJoin(runs, keep);
  const hints = throughHints(drafts, keep);
  const nodeName = (id: number): string => clipName.get(id) ?? `n${id}`;

  // edges, with ids from their lowest way piece
  interface Built { draft: Draft; edge: GraphEdge }
  const built: Built[] = [];
  for (const d of drafts) {
    const pts = draftPoints(d).map(rp);
    const len = polylineLength(pts);
    if (len < 0.01) continue;
    const low = d.parts.reduce((m, p) => {
      const w = wayNum(p.road.id);
      const mw = wayNum(m.road.id);
      return w < mw || (w === mw && p.part < m.part) ? p : m;
    });
    const pieces: EdgePiece[] = [];
    let s0 = 0;
    for (const part of d.parts) {
      const s1 = s0 + polylineLength(part.pts);
      pieces.push({ way: part.road.id, s0: r3(s0), s1: r3(s1), layer: part.road.layer, bridge: part.road.bridge, tunnel: part.road.tunnel });
      s0 = s1;
    }
    (pieces[pieces.length - 1] as EdgePiece).s1 = r3(len);
    const h = hints.get(d) ?? {};
    const p0 = pts[0] as P2;
    const p1 = pts[1] as P2;
    const q0 = pts[pts.length - 2] as P2;
    const q1 = pts[pts.length - 1] as P2;
    const main = longestPart(d);
    const tags = main.road.tags;
    built.push({
      draft: d,
      edge: {
        id: `w${wayNum(low.road.id)}.${low.part}`, a: nodeName(d.a), b: nodeName(d.b), pts, len: r3(len), oneway: d.oneway, name: d.name, ref: tags['ref'] ?? '',
        roundabout: d.parts.some((p) => p.road.tags['junction'] === 'roundabout' || p.road.tags['junction'] === 'circular'),
        ta: h.start ? unit(h.start.x, h.start.z) : unit(p1.x - p0.x, p1.z - p0.z), tb: h.end ? unit(h.end.x, h.end.z) : unit(q1.x - q0.x, q1.z - q0.z),
        pieces, road: classifyRoad(d.cls, d.link, d.oneway ? 'one_way' : 'two_way', tags, main.reversed), pairedWith: [],
      },
    });
  }
  built.sort((x, y) => (x.edge.id < y.edge.id ? -1 : x.edge.id > y.edge.id ? 1 : 0));
  const edges = built.map((b) => b.edge);

  // pairs of carriageways
  const pairInput: PairEdge[] = edges.map((e, index) => ({
    index, pts: e.pts, len: e.len, cls: e.road.cls, name: e.name, ref: e.ref, level: e.pieces.reduce((m, p) => (p.bridge || p.tunnel ? Math.max(m, Math.abs(p.layer) || 1) : m), 0),
    pairable: e.oneway && !e.road.link && !e.roundabout && e.a !== e.b && PAIR_CLASSES.has(e.road.cls),
  }));
  const pairs: GraphPair[] = pairCarriageways(pairInput).map((p) => {
    const a = edges[p.a] as GraphEdge;
    const b = edges[p.b] as GraphEdge;
    a.pairedWith.push(b.id);
    b.pairedWith.push(a.id);
    return { id: `${a.id}|${b.id}`, a: a.id, b: b.id, name: a.name || b.name, matchedA: p.matchedA, matchedB: p.matchedB, gap: p.gap, namesDiffer: p.namesDiffer };
  });
  built.forEach(({ draft, edge }) => {
    if (!edge.pairedWith.length) return;
    edge.pairedWith.sort();
    const main = longestPart(draft);
    edge.road = classifyRoad(draft.cls, draft.link, 'paired' as Carriageway, main.road.tags, main.reversed);
  });

  // nodes
  const count = new Map<string, number>();
  for (const e of edges) for (const id of [e.a, e.b]) count.set(id, (count.get(id) ?? 0) + 1);
  const nodes: GraphNode[] = [];
  for (const [num, p] of position) {
    const id = nodeName(num);
    const ends = count.get(id);
    if (!ends) continue;
    nodes.push({ id, x: r3(p.x), z: r3(p.z), kind: keep.has(num) ? 'map_edge' : ends >= 3 ? 'junction' : ends === 2 ? 'joint' : 'end', ends });
  }
  nodes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // footprints, features
  const ov = overtureFootprints(input.overture, project);
  const fp = mergeStageFootprints(map.buildings, ov.list, ring, map.underground, ov.underground);
  const KEEP_TAGS = ['building', 'name', 'wikidata', 'historic', 'amenity', 'height', 'building:levels'];
  const footprints: GraphFootprint[] = fp.footprints.map((f) => {
    const tags: Record<string, string> = {};
    for (const k of KEEP_TAGS) if (f.tags[k] !== undefined) tags[k] = f.tags[k] as string;
    return { id: f.id, source: f.source, ring: f.ring.map((p) => ({ x: Math.round(p.x * 100) / 100 + 0, z: Math.round(p.z * 100) / 100 + 0 })), area: Math.round(f.area * 10) / 10, height: f.height, levels: f.levels, tags };
  });
  const features = readFeatures(input.elements, (id) => map.nodes.get(id), ring);
  roundFeatures(features);

  return {
    version: GRAPH_VERSION, block: input.block, stage: input.stage, origin: { lat: input.origin.lat, lon: input.origin.lon }, outline: ring.map(rp),
    nodes, edges, pairs, footprints, footprintSources: fp.bySource, features,
    normalised: { snappedNodes: norm.snapped, duplicateWays: norm.duplicates, degenerateWays: norm.degenerate, nicks: clip.nicks, excursions: clip.excursions, footways: map.footways },
    crossings: clip.crossings.map((c) => rp(c)),
  };
}

function roundFeatures(f: Features): void {
  for (const l of [...f.rail, ...f.waterLines]) {
    l.pts = l.pts.map(rp);
    l.len = r3(l.len);
  }
  for (const a of [...f.water, ...f.open]) {
    a.rings = a.rings.map((r) => r.map(rp));
    a.area = Math.round(a.area * 10) / 10;
  }
  for (const b of f.footBridges) {
    b.pts = b.pts.map((l) => l.map(rp));
    b.len = r3(b.len);
  }
}
