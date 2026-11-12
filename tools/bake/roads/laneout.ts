// What the lane model hands on (P1-012): the model file for the mesh builder and the elevation solver (every strip
// with its stations, the joints, zones, junctions with their connecting lane paths, the explained ends), the lane
// graph for the tiles (one polyline per driving lane and per junction path, with what follows what, filed under the
// world tile of its middle), the lanes layer of the map inspector (world metres, compact) and the record for the
// health report. One implementation: the game only reads these. Our own JSON, modelled on OpenDRIVE. Pure.
import type { P2 } from '../geom.ts';
import { hashText } from '../graph/checks.ts';
import type { GraphEdge } from '../graph/build.ts';
import { tileId, tileOf } from '../layout/grid.ts';
import type { GEnd } from './graph.ts';
import type { LaneChecks } from './lanechecks.ts';
import type { Joint, LaneDef, Station, Strip, StripEnd } from './model.ts';
import type { ExplainedEnd, LaneBuild, LaneJunction } from './network.ts';

export const LANES_FORMAT = 'kalesh-lanes-1';
export const LANE_GRAPH_FORMAT = 'kalesh-lane-graph-1';

export interface LaneModelFile {
  format: string;
  _doc: string;
  block: string;
  stage: string;
  strips: {
    id: string; edge: string; kind: Strip['kind']; cls: string; link: boolean; name: string; hero: string | null; lanes: LaneDef[];
    /** Per station: x, z, nx, nz, s, layer, bridge (0 or 1), then every lane border left to right. */
    st: number[][];
    taper?: Strip['taper'];
  }[];
  joints: Joint[];
  zones: { strip: number; node: string; kind: 'diverge' | 'merge'; paintedNoseM: number; noseM: number; parent: [number, StripEnd] | null; left: [number, StripEnd] | null; right: [number, StripEnd] | null }[];
  junctions: LaneJunction[];
  ends: ExplainedEnd[];
  internal: LaneBuild['internal'];
  forks: LaneBuild['forks'];
  widenings: LaneBuild['widenings'];
  fitted: LaneBuild['fitted'];
  tightPaths: LaneBuild['tightPaths'];
}

/** The lane model as plain data. Strips keep their order: joints, zones and junctions name them by number. */
export function laneModelFile(b: LaneBuild, block: string, stage: string): LaneModelFile {
  const at = (e: GEnd): [number, StripEnd] | null => {
    const built = b.built.get(e.edge);
    return built ? (e.atStart ? [built.first, 'start'] : [built.last, 'end']) : null;
  };
  return {
    format: LANES_FORMAT,
    _doc: 'Lane model of one bake stage (tools/bake/roads/network.ts). Block metres: x east, z south (north is -Z). A strip is a run of stations along a reference line; a station is [x, z, nx, nz, s, layer, bridge, borders...]: the reference point, the unit vector to the left of the station order, metres along the source edge, the OSM layer, 1 on a bridge, then the lateral position of every lane border left to right (lanes + 1 numbers, falling). Lanes are listed left to right; dir 1 runs with the station order, -1 against it, 0 both ways or no traffic. Left-hand traffic. joints: two strip ends that meet, with lane pairs. zones: one strip from a split node to the nose with both branches side by side. junctions: arms (strip ends, the cut, the stop line, edges: the raised edge widths [left, right] looking away from the junction at the strip end, after edges gave way) and paths (from [strip, lane] to [strip, lane] with the turn, the radius and the points). ends: strip ends with nothing after them, each explained.',
    block, stage,
    strips: b.strips.map((s) => ({
      id: s.id, edge: s.edge, kind: s.kind, cls: s.cls, link: s.link, name: s.name, hero: s.hero, lanes: s.lanes,
      st: s.st.map((p) => [p.x, p.z, p.nx, p.nz, p.s, p.layer, p.bridge ? 1 : 0, ...p.b]),
      ...(s.taper ? { taper: s.taper } : {}),
    })),
    joints: b.joints,
    zones: b.zones.map((z, i) => ({ strip: b.zoneStrips[i] as number, node: b.road.nodeId[z.node] as string, kind: z.kind, paintedNoseM: z.dPainted, noseM: z.dNose, parent: at(z.parent), left: at(z.left), right: at(z.right) })),
    junctions: b.junctions, ends: b.ends, internal: b.internal, forks: b.forks, widenings: b.widenings, fitted: b.fitted, tightPaths: b.tightPaths,
  };
}

export const laneModelHash = (file: LaneModelFile): string => hashText(JSON.stringify(file));

export interface GraphLane {
  id: string;
  strip: number;
  lane: number;
  cls: string;
  /** Metres at the middle of the lane. */
  widthM: number;
  lengthM: number;
  layer: number;
  gali?: true;
  /** Both ways: the one lane of a narrow street. `next` then lists what follows at its far end, `back` at its near end. */
  bothWays?: true;
  /** Centre line in the direction of travel, block metres. */
  pts: [number, number][];
  next: string[];
  back?: string[];
  tile: string;
}

export interface GraphPath {
  id: string;
  junction: string;
  turn: string;
  radiusM: number | null;
  lengthM: number;
  from: string;
  to: string;
  /** True when the lane it leaves stops at a stop line before the junction. */
  stop: boolean;
  pts: [number, number][];
  tile: string;
}

export interface LaneGraphFile {
  format: string;
  _doc: string;
  block: string;
  /** World metres of the block's frame origin: world = block + offset. */
  offset: [number, number];
  lanes: GraphLane[];
  paths: GraphPath[];
  /** Lane and path numbers by world tile ("<tileX>_<tileZ>"). */
  tiles: Record<string, { lanes: number[]; paths: number[] }>;
}

const r2 = (v: number): number => Math.round(v * 100) / 100 + 0;
const laneName = (strip: number, lane: number): string => `s${strip}.${lane}`;

/** The lane graph traffic, pursuit and barricades follow: driving lanes and junction paths with their successors. */
export function laneGraph(b: LaneBuild, block: string, offset: P2): LaneGraphFile {
  const lanes: GraphLane[] = [];
  const index = new Map<string, number>();
  const tileAt = (p: readonly [number, number]): string => {
    const t = tileOf(p[0] + offset.x, p[1] + offset.z);
    return tileId(t.tx, t.tz);
  };
  b.strips.forEach((s, si) => {
    s.lanes.forEach((l, k) => {
      if (l.type !== 'drive') return;
      const pts: [number, number][] = [];
      let last: [number, number] | null = null;
      let length = 0;
      for (const st of s.st) {
        const lat = ((st.b[k] as number) + (st.b[k + 1] as number)) / 2;
        const p: [number, number] = [r2(st.x + st.nx * lat), r2(st.z + st.nz * lat)];
        if (last) length += Math.hypot(p[0] - last[0], p[1] - last[1]);
        last = p;
        pts.push(p);
      }
      if (l.dir === -1) pts.reverse();
      const mid = s.st[Math.floor(s.st.length / 2)] as Station;
      const lane: GraphLane = {
        id: laneName(si, k), strip: si, lane: k, cls: s.cls + (s.link ? '_link' : ''), widthM: r2((mid.b[k] as number) - (mid.b[k + 1] as number)), lengthM: r2(length), layer: mid.layer,
        ...(l.tag === 'gali' ? { gali: true as const } : {}), ...(l.dir === 0 ? { bothWays: true as const, back: [] } : {}),
        pts, next: [], tile: tileAt(pts[Math.floor(pts.length / 2)] as [number, number]),
      };
      index.set(lane.id, lanes.length);
      lanes.push(lane);
    });
  });
  // what follows a lane at one of its ends: only where traffic leaves the lane there
  const follow = (strip: number, lane: number, end: StripEnd, to: string): void => {
    const i = index.get(laneName(strip, lane));
    if (i === undefined) return;
    const l = lanes[i] as GraphLane;
    const dir = ((b.strips[strip] as Strip).lanes[lane] as LaneDef).dir;
    if (dir === 0) {
      const list = end === 'end' ? l.next : (l.back as string[]);
      if (!list.includes(to)) list.push(to);
    } else if ((dir === 1) === (end === 'end') && !l.next.includes(to)) l.next.push(to);
  };
  for (const j of b.joints) {
    for (const [la, lb] of j.lanes) {
      if (!index.has(laneName(j.a.strip, la)) || !index.has(laneName(j.b.strip, lb))) continue;
      follow(j.a.strip, la, j.a.end, laneName(j.b.strip, lb));
      follow(j.b.strip, lb, j.b.end, laneName(j.a.strip, la));
    }
  }
  const paths: GraphPath[] = [];
  b.junctions.forEach((j) => {
    j.paths.forEach((p, n) => {
      const id = `${j.id}.${n}`;
      const arm = j.arms[p.fromArm];
      const pts = p.pts.map((q) => [r2(q.x), r2(q.z)] as [number, number]);
      paths.push({
        id, junction: j.id, turn: p.turn, radiusM: p.radius, lengthM: p.length, from: laneName(p.from[0], p.from[1]), to: laneName(p.to[0], p.to[1]), stop: (arm?.stopBack ?? 0) > 0 || j.control === 'signals',
        pts, tile: tileAt(pts[Math.floor(pts.length / 2)] as [number, number]),
      });
      if (arm) follow(p.from[0], p.from[1], arm.end, id);
    });
  });
  const tiles: LaneGraphFile['tiles'] = {};
  const slot = (t: string): { lanes: number[]; paths: number[] } => (tiles[t] ??= { lanes: [], paths: [] });
  lanes.forEach((l, i) => slot(l.tile).lanes.push(i));
  paths.forEach((p, i) => slot(p.tile).paths.push(i));
  const sorted: LaneGraphFile['tiles'] = {};
  for (const k of Object.keys(tiles).sort()) sorted[k] = tiles[k] as { lanes: number[]; paths: number[] };
  return {
    format: LANE_GRAPH_FORMAT,
    _doc: 'Lane graph of one bake stage (tools/bake/roads/laneout.ts): every driving lane as a centre line in its direction of travel and every connecting lane path through a junction, block metres (x east, z south). next names what follows: lanes ("s<strip>.<lane>") and paths ("<junction>.<n>"); a path leads to one lane (to). tiles files both under the 250 m world tile of their middle point (world = block + offset).',
    block, offset: [offset.x, offset.z], lanes, paths, tiles: sorted,
  };
}

export interface LanesLayer {
  version: number;
  _doc: string;
  block: string;
  /** Block frame origin (latitude, longitude) and the block's world offset: world = block + offset. The inspector writes set_lanes patches with a latitude and longitude anchor. */
  origin?: { lat: number; lon: number };
  offset: [number, number];
  strips: {
    id: string; /** The graph edge the strip was cut from: the id a set_lanes patch names. */ edge: string; kind: string; cls: string; name: string; hero: string | null; bridge: boolean;
    /** Where the lane count of the edge came from (street.ts LanesFrom) and, for "repair", the id of the issue or override patch. */
    from?: string; by?: string; /** A taper: [length, shift, needed] in metres. */ taper?: [number, number, number];
    lanes: [string, number][]; ref: [number, number][]; n: [number, number][]; b: number[] | number[][];
  }[];
  zones: { id: string; kind: string; node: [number, number]; nose: [number, number]; noseM: number }[];
  junctions: { id: string; at: [number, number]; control: string; arms: number; paths: { turn: string; r: number | null; pts: [number, number][] }[] }[];
  ends: { at: [number, number]; kind: string }[];
}

/** The lanes layer the map inspector draws (step 2 of the inspector): world metres, borders once per strip where they do not change. */
export function lanesLayer(b: LaneBuild, block: string, offset: P2, origin?: { lat: number; lon: number }): LanesLayer {
  const w = (x: number, z: number): [number, number] => [r2(x + offset.x), r2(z + offset.z)];
  const endSt = (strip: number, end: StripEnd): Station => {
    const s = b.strips[strip] as Strip;
    return (end === 'start' ? s.st[0] : s.st[s.st.length - 1]) as Station;
  };
  return {
    version: 1,
    _doc: 'Lanes layer for the map inspector, written by the bake (tools/bake/roads/laneout.ts). World metres (x east, z south). origin and offset: the block frame (world = block + offset). strips: edge is the graph edge the strip was cut from, from where its lane count came from (spec, tag, repair, street, pair, class, fit, width, room), by the issue or override patch behind a repair, taper [length, shift, needed] in metres, ref is the reference line, n the unit vector to the left at each point, lanes [type, direction] left to right, b the lateral position of every lane border (one list when it is the same at every point, else one list per point). junction paths: turn, smallest radius (null: straight) and points.',
    block,
    ...(origin ? { origin: { lat: origin.lat, lon: origin.lon } } : {}),
    offset: [offset.x, offset.z],
    strips: b.strips.map((s) => {
      const first = (s.st[0] as Station).b;
      const constant = s.st.every((st) => st.b.every((v, k) => Math.abs(v - (first[k] as number)) < 0.002));
      const plan = b.streets.byEdge.get(s.edge);
      return {
        id: s.id, edge: s.edge, kind: s.kind, cls: s.cls + (s.link ? '_link' : ''), name: s.name, hero: s.hero, bridge: s.st.some((st) => st.bridge),
        ...(plan ? { from: plan.from, ...(plan.by ? { by: plan.by } : {}) } : {}),
        ...(s.taper ? { taper: [r2(s.taper.length), r2(s.taper.shift), r2(s.taper.needed)] as [number, number, number] } : {}),
        lanes: s.lanes.map((l) => [l.type, l.dir] as [string, number]),
        ref: s.st.map((st) => w(st.x, st.z)), n: s.st.map((st) => [Math.round(st.nx * 1000) / 1000 + 0, Math.round(st.nz * 1000) / 1000 + 0] as [number, number]),
        b: constant ? first.map(r2) : s.st.map((st) => st.b.map(r2)),
      };
    }),
    zones: b.zones.map((z, i) => {
      const s = b.strips[b.zoneStrips[i] as number] as Strip;
      const a = s.st[0] as Station;
      const e = s.st[s.st.length - 1] as Station;
      return { id: s.id, kind: z.kind, node: w(a.x, a.z), nose: w(e.x, e.z), noseM: r2(z.dNose) };
    }),
    junctions: b.junctions.map((j) => ({ id: j.id, at: w(j.centre.x, j.centre.z), control: j.control, arms: j.arms.length, paths: j.paths.map((p) => ({ turn: p.turn, r: p.radius, pts: p.pts.map((q) => w(q.x, q.z)) })) })),
    ends: b.ends.map((e) => {
      const st = endSt(e.strip, e.end);
      return { at: w(st.x, st.z), kind: e.kind };
    }),
  };
}

export interface LanesRecord {
  hash: string;
  buildMs: number;
  rounds: number;
  counts: {
    edges: number; strips: number; stations: number; taperStrips: number; zoneStrips: number; driveLanes: number; laneKm: number; galiLanes: number;
    joints: number; zones: number; diverges: number; merges: number; junctions: number; junctionPaths: number; junctionPairs: number; signals: number; stopLines: number; crossings: number;
    internalEdges: number; forks: number; widenings: number; fitted: number; streets: number;
  };
  /** Where the lane count of every edge came from, and how many differ from the graph's own count. */
  inference: { from: Record<string, number>; changed: number; widthKept: number };
  gates: { laneContinuityBreaks: number; tapersOutOfLimits: number; tapersUnexplained: number };
  continuity: { joints: number; splitJoints: number; lanePairs: number; breaks: number; maxOffsetM: number; list: { strip: string; lane: number; why: string }[] };
  explainedEnds: Record<string, number>;
  tapers: { tapers: number; violations: number; unexplained: number; byClass: Record<string, { tapers: number; violations: number; ratio: number }>; findings: { strip: string; cls: string; lengthM: number; shiftM: number; neededM: number; why: string }[] };
  zones: LaneChecks['zones'];
  forks: { total: number; byReason: Record<string, number> };
  trafficSide: { twoWayStrips: number; wrongSide: number };
  widths: LaneChecks['widths'];
  paths: LaneChecks['paths'] & { uTurnsLeftOut: number; restricted: number; droppedForRadius: number; tight: LaneBuild['tightPaths'] };
  hero: { spec: string; strips: number; stationsChecked: number; fieldsCompared: number; mismatches: number; list: string[] }[];
  /** Strips lying on each other in plan on one level, after the edges gave way (not a gate of this step). */
  overlap: LaneChecks['overlap'];
  /** Edge lanes narrowed beside another strip (roads/edges.ts). */
  edgeTrims: LaneBuild['edgeTrims'];
  junctionClusters: { most: number; over8Nodes: number };
  problems: string[];
  ms: Record<string, number>;
  files: Record<string, string | string[]>;
}

/** The lanes record of the health report. */
export function lanesRecord(b: LaneBuild, c: LaneChecks, hash: string, buildMs: number, files: LanesRecord['files']): LanesRecord {
  let stations = 0;
  let km = 0;
  for (const s of b.strips) {
    stations += s.st.length;
    const n = s.lanes.filter((l) => l.type === 'drive').length;
    for (let i = 1; i < s.st.length; i++) km += (n * Math.hypot((s.st[i] as Station).x - (s.st[i - 1] as Station).x, (s.st[i] as Station).z - (s.st[i - 1] as Station).z)) / 1000;
  }
  const byReason: Record<string, number> = {};
  for (const f of b.forks) {
    const k = f.why.replace(/^[\d.]+ m from the junction node \S+/, 'beside a junction node');
    byReason[k] = (byReason[k] ?? 0) + 1;
  }
  const why = new Map(c.tapers.explained.map((e) => [e.strip, e.why]));
  const edgeOf = new Map(b.strips.map((s) => [s.id, s.edge]));
  const lenOf = new Map(b.road.source.map((e: GraphEdge) => [e.id, e.len]));
  return {
    hash, buildMs, rounds: b.rounds,
    counts: {
      edges: b.road.source.length, strips: b.strips.length, stations, taperStrips: b.strips.filter((s) => s.kind === 'taper').length, zoneStrips: b.zones.length, driveLanes: c.widths.driveLanes, laneKm: Math.round(km * 10) / 10,
      galiLanes: c.widths.galiLanes, joints: b.joints.length, zones: b.zones.length, diverges: c.zones.diverges, merges: c.zones.merges, junctions: b.junctions.length, junctionPaths: c.paths.paths, junctionPairs: c.paths.pairs,
      signals: c.paths.signals, stopLines: c.paths.stopLines, crossings: c.paths.crossings, internalEdges: b.internal.length, forks: b.forks.length, widenings: b.widenings.length, fitted: b.fitted.length, streets: b.streets.report.streets,
    },
    inference: { from: b.streets.report.from, changed: b.streets.report.changed, widthKept: b.streets.report.widthKept },
    gates: { laneContinuityBreaks: c.continuity.breaks, tapersOutOfLimits: c.tapers.violations, tapersUnexplained: c.tapers.unexplained },
    continuity: { joints: c.continuity.joints, splitJoints: c.continuity.splitJoints, lanePairs: c.continuity.lanePairs, breaks: c.continuity.breaks, maxOffsetM: c.continuity.maxOffsetM, list: c.continuity.list },
    explainedEnds: c.explainedEnds,
    tapers: {
      tapers: c.tapers.tapers, violations: c.tapers.violations, unexplained: c.tapers.unexplained, byClass: c.tapers.byClass,
      findings: c.tapers.list.map((t) => ({ ...t, why: why.get(t.strip) ?? `finding: the road is ${Math.round((lenOf.get(edgeOf.get(t.strip) ?? '') ?? 0) * 10) / 10} m long between its two nodes, too short for the taper its class asks for; the lanes change over the length there is` })),
    },
    zones: c.zones, forks: { total: b.forks.length, byReason }, trafficSide: { twoWayStrips: c.trafficSide.twoWayStrips, wrongSide: c.trafficSide.wrongSide }, widths: c.widths,
    paths: { ...c.paths, uTurnsLeftOut: b.turns.uTurnsTooTight, restricted: b.turns.restricted, droppedForRadius: b.turns.droppedForRadius, tight: b.tightPaths },
    hero: c.hero.map((h) => ({ spec: h.spec, strips: h.strips, stationsChecked: h.stationsChecked, fieldsCompared: h.fieldsCompared, mismatches: h.mismatches, list: h.list })),
    overlap: c.overlap,
    edgeTrims: b.edgeTrims,
    junctionClusters: { most: b.junctions.reduce((m, j) => Math.max(m, j.nodes.length), 0), over8Nodes: b.junctions.filter((j) => j.nodes.length > 8).length },
    problems: b.problems, ms: b.ms, files,
  };
}
