// Where the elevation solver must keep a clearance (P1-013): every place two road surfaces of different levels lie
// on each other in plan (a road that crosses under a deck, and a road that runs along under it), every junction a
// road of another level passes over or under, every railway line a road crosses, and every stretch of bridge that
// stands in water. Tags (layer, bridge, tunnel) only say which one is above; no height comes from them. The solver
// turns these into limits; the checks measure the same places again. Pure.
import { Grid, pointInRing } from '../geom.ts';
import type { Box2, P2 } from '../geom.ts';
import { segCross } from '../roads/curve.ts';
import type { Joint, Station, Strip, StripEnd } from '../roads/model.ts';

export interface ElevationJunction {
  centre: P2;
  /** Outline of the junction surface: the outer corners of every arm's cut, in order round the centre. */
  ring: P2[];
  arms: { strip: number; end: StripEnd }[];
}

/** The outline of a junction from the cut lines of its arms (two outer corners per arm, sorted round the centre). */
export function junctionRing(strips: readonly Strip[], centre: P2, arms: readonly { strip: number; end: StripEnd }[]): P2[] {
  const pts: P2[] = [];
  for (const a of arms) {
    const s = strips[a.strip] as Strip;
    const st = (a.end === 'start' ? s.st[0] : s.st[s.st.length - 1]) as Station;
    for (const b of [st.b[0] as number, st.b[st.b.length - 1] as number]) pts.push({ x: st.x + st.nx * b, z: st.z + st.nz * b });
  }
  return pts.sort((p, q) => Math.atan2(p.z - centre.z, p.x - centre.x) - Math.atan2(q.z - centre.z, q.x - centre.x));
}

export interface RailLine {
  id: string;
  name: string;
  pts: P2[];
  layer: number;
  bridge: boolean;
  tunnel: boolean;
}

export interface WaterArea {
  id: string;
  name: string;
  rings: P2[][];
}

/** 0: not a tunnel; 1: a tunnel under the ground; 2: a passage through a building, at grade. */
export type TunnelKind = 0 | 1 | 2;

/** One station of a road and the place on a road of another level that lies over or under it. */
export interface RoadOverlap {
  up: number;
  upStation: number;
  /** Between upStation and the next station (0 to 1). */
  upT: number;
  low: number;
  lowStation: number;
  lowT: number;
  x: number;
  z: number;
  /** The place where the two centre lines cross (the limit there carries the prototype's margin). */
  centre: boolean;
}

export interface JunctionCrossing {
  junction: number;
  strip: number;
  stations: number[];
  /** The strip passes over the junction (false: under it). */
  above: boolean;
}

export interface RailCrossing {
  strip: number;
  station: number;
  t: number;
  rail: number;
  /** Height of the rail at the crossing: the ground model, or the embankment a railway bridge stands on. */
  railH: number;
  roadAbove: boolean;
  x: number;
  z: number;
}

export interface WaterCrossing {
  strip: number;
  water: number;
  /** A run of bridge stations in the water. */
  first: number;
  last: number;
  /** Water level: the lowest ground model height under the run. */
  level: number;
}

export interface Crossings {
  roads: RoadOverlap[];
  /** Pairs of strips of different levels that lie on each other somewhere: the crossings of two levels. */
  roadPairs: number;
  junctions: JunctionCrossing[];
  rails: RailCrossing[];
  /** Road and rail at one level: a level crossing, no limit. */
  levelCrossings: number;
  water: WaterCrossing[];
}

export interface CrossingInput {
  strips: readonly Strip[];
  joints: readonly Joint[];
  junctions: readonly ElevationJunction[];
  tunnels?: readonly (ArrayLike<number> | undefined)[];
  rails?: readonly RailLine[];
  water?: readonly WaterArea[];
  ground: (x: number, z: number) => number;
  /** Height of a railway bridge above the ground model where it crosses a road. */
  railEmbankment: number;
}

/** Twice the layer, a step up on a bridge, a step down in a tunnel; a passage through a building counts as the ground. */
export const levelOf = (st: Station, tunnel: number): number => (tunnel === 2 ? 0 : st.layer * 2 + (st.bridge ? 1 : 0) - (tunnel === 1 ? 1 : 0));
/** Two surfaces lie on each other when a cross-section has this much of its width on the other road (or half the narrower road). */
const OVERLAP_MIN_M = 1.5;
const OVERLAP_STEP_M = 0.75;
/** A strip is only checked against itself this many stations away (a loop ramp over its own road). */
const SELF_GAP = 12;
const segBox = (a: P2, b: P2): Box2 => ({ minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) });

export function findCrossings(input: CrossingInput): Crossings {
  const { strips } = input;
  const tun = (si: number, i: number): number => input.tunnels?.[si]?.[i] ?? 0;
  const lvl = (si: number, i: number): number => levelOf((strips[si] as Strip).st[i] as Station, tun(si, i));
  // strips that meet at a joint or at one junction never cross each other
  const joined = new Set<number>();
  const pairKey = (a: number, b: number): number => Math.min(a, b) * strips.length + Math.max(a, b);
  for (const j of input.joints) joined.add(pairKey(j.a.strip, j.b.strip));
  for (const jn of input.junctions) for (const a of jn.arms) for (const b of jn.arms) if (a.strip < b.strip) joined.add(pairKey(a.strip, b.strip));

  // every piece of road surface between two stations, on a grid
  const grid = new Grid<number>(60);
  const segStrip: number[] = [];
  const segAt: number[] = [];
  const corner = (st: Station, k: number): P2 => ({ x: st.x + st.nx * (st.b[k] as number), z: st.z + st.nz * (st.b[k] as number) });
  const quadOf = (si: number, j: number): P2[] => {
    const p = (strips[si] as Strip).st[j] as Station;
    const q = (strips[si] as Strip).st[j + 1] as Station;
    return [corner(p, 0), corner(p, p.b.length - 1), corner(q, q.b.length - 1), corner(q, 0)];
  };
  strips.forEach((s, si) => {
    for (let i = 0; i + 1 < s.st.length; i++) {
      const quad = quadOf(si, i);
      const box = segBox(quad[0] as P2, quad[1] as P2);
      for (const p of quad) {
        box.minX = Math.min(box.minX, p.x);
        box.maxX = Math.max(box.maxX, p.x);
        box.minZ = Math.min(box.minZ, p.z);
        box.maxZ = Math.max(box.maxZ, p.z);
      }
      grid.insert(box, segStrip.length);
      segStrip.push(si);
      segAt.push(i);
    }
  });
  // a station whose cross-section lies on the surface of a road of another level, by at least a lane's worth
  const roads: RoadOverlap[] = [];
  const pairs = new Set<number>();
  strips.forEach((s, a) => {
    s.st.forEach((st, i) => {
      const la = lvl(a, i);
      if (la === 0) return;
      const left = corner(st, 0);
      const right = corner(st, st.b.length - 1);
      const width = Math.hypot(right.x - left.x, right.z - left.z);
      const n = Math.max(2, Math.ceil(width / OVERLAP_STEP_M));
      for (const r of grid.query(segBox(left, right)).sort((p, q) => p - q)) {
        const b = segStrip[r] as number;
        const j = segAt[r] as number;
        if ((a === b && Math.abs(i - j) <= SELF_GAP) || (a !== b && joined.has(pairKey(a, b)))) continue;
        const lb = lvl(b, j);
        if (la === lb) continue;
        const quad = quadOf(b, j);
        let inside = 0;
        for (let k = 0; k <= n; k++) if (pointInRing({ x: left.x + ((right.x - left.x) * k) / n, z: left.z + ((right.z - left.z) * k) / n }, quad)) inside++;
        const p = (strips[b] as Strip).st[j] as Station;
        const q = (strips[b] as Strip).st[j + 1] as Station;
        const other = Math.max(Math.abs((p.b[0] as number) - (p.b[p.b.length - 1] as number)), 0.1);
        if ((inside / (n + 1)) * width < Math.min(OVERLAP_MIN_M, 0.5 * Math.min(width, other))) continue;
        const dx = q.x - p.x;
        const dz = q.z - p.z;
        const t = Math.max(0, Math.min(1 - 1e-9, ((st.x - p.x) * dx + (st.z - p.z) * dz) / Math.max(1e-9, dx * dx + dz * dz)));
        roads.push(la > lb ? { up: a, upStation: i, upT: 0, low: b, lowStation: j, lowT: t, x: st.x, z: st.z, centre: false } : { up: b, upStation: j, upT: t, low: a, lowStation: i, lowT: 0, x: st.x, z: st.z, centre: false });
        pairs.add(pairKey(a, b));
      }
      // and where the centre line itself crosses the other road's centre line
      const nextSt = s.st[i + 1];
      if (!nextSt) return;
      for (const r of grid.query(segBox(st, nextSt)).sort((p, q) => p - q)) {
        const b = segStrip[r] as number;
        const j = segAt[r] as number;
        if ((a === b && Math.abs(i - j) <= SELF_GAP) || (a !== b && joined.has(pairKey(a, b)))) continue;
        const lb = lvl(b, j);
        if (la === lb || (lb !== 0 && (b < a || (b === a && j < i)))) continue;
        const x = segCross(st, nextSt, (strips[b] as Strip).st[j] as P2, (strips[b] as Strip).st[j + 1] as P2);
        // a crossing exactly on a station belongs to the segment that starts there
        if (!x || x.t >= 1 - 1e-9 || x.u >= 1 - 1e-9) continue;
        roads.push(la > lb ? { up: a, upStation: i, upT: x.t, low: b, lowStation: j, lowT: x.u, x: x.x, z: x.z, centre: true } : { up: b, upStation: j, upT: x.u, low: a, lowStation: i, lowT: x.t, x: x.x, z: x.z, centre: true });
        pairs.add(pairKey(a, b));
      }
    });
  });

  // a strip of another level over or under a junction: above every arm of it, or below every arm
  const junctions: JunctionCrossing[] = [];
  const stationGrid = new Grid<number>(60);
  const stStrip: number[] = [];
  const stAt: number[] = [];
  strips.forEach((s, si) => {
    s.st.forEach((st, i) => {
      stationGrid.insert({ minX: st.x, maxX: st.x, minZ: st.z, maxZ: st.z }, stStrip.length);
      stStrip.push(si);
      stAt.push(i);
    });
  });
  input.junctions.forEach((jn, ji) => {
    const mine = new Set(jn.arms.map((a) => a.strip));
    const armLevels = jn.arms.map((a) => lvl(a.strip, a.end === 'start' ? 0 : (strips[a.strip] as Strip).st.length - 1));
    if (jn.ring.length < 3 || !armLevels.length) return;
    const lo = Math.min(...armLevels);
    const hi = Math.max(...armLevels);
    const hit = new Map<number, { above: number[]; below: number[] }>();
    const box = jn.ring.reduce<Box2>((c, p) => ({ minX: Math.min(c.minX, p.x), maxX: Math.max(c.maxX, p.x), minZ: Math.min(c.minZ, p.z), maxZ: Math.max(c.maxZ, p.z) }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
    for (const q of stationGrid.query(box).sort((a, b) => a - b)) {
      const si = stStrip[q] as number;
      const i = stAt[q] as number;
      if (mine.has(si)) continue;
      const l = lvl(si, i);
      if (l >= lo && l <= hi) continue;
      const st = (strips[si] as Strip).st[i] as Station;
      if (!pointInRing(st, jn.ring)) continue;
      const h = hit.get(si) ?? { above: [], below: [] };
      (l > hi ? h.above : h.below).push(i);
      hit.set(si, h);
    }
    for (const [si, h] of [...hit].sort((a, b) => a[0] - b[0])) {
      if (h.above.length) junctions.push({ junction: ji, strip: si, stations: h.above, above: true });
      if (h.below.length) junctions.push({ junction: ji, strip: si, stations: h.below, above: false });
    }
  });

  // railway lines
  const rails: RailCrossing[] = [];
  let levelCrossings = 0;
  (input.rails ?? []).forEach((line, ri) => {
    if (line.tunnel || line.pts.length < 2) return;
    const rl = line.layer * 2 + (line.bridge ? 1 : 0);
    const first = line.pts[0] as P2;
    const last = line.pts[line.pts.length - 1] as P2;
    // a railway bridge spans from bank to bank: the higher of its two ends, on its embankment
    const bridgeH = Math.max(input.ground(first.x, first.z), input.ground(last.x, last.z)) + input.railEmbankment;
    for (let k = 0; k + 1 < line.pts.length; k++) {
      const p = line.pts[k] as P2;
      const q = line.pts[k + 1] as P2;
      for (const r of grid.query(segBox(p, q)).sort((a, b) => a - b)) {
        const si = segStrip[r] as number;
        const i = segAt[r] as number;
        const st = (strips[si] as Strip).st;
        const x = segCross(st[i] as P2, st[i + 1] as P2, p, q);
        if (!x || x.t >= 1 - 1e-9 || x.u >= 1 - 1e-9) continue;
        const l = lvl(si, i);
        if (l === rl) {
          levelCrossings++;
          continue;
        }
        rails.push({ strip: si, station: i, t: x.t, rail: ri, railH: line.bridge ? bridgeH : input.ground(x.x, x.z), roadAbove: l > rl, x: x.x, z: x.z });
      }
    }
  });

  // bridge stations that stand in water
  const water: WaterCrossing[] = [];
  const areas = (input.water ?? []).map((w) => ({ rings: w.rings, box: w.rings.reduce<Box2>((b, r) => r.reduce<Box2>((c, p) => ({ minX: Math.min(c.minX, p.x), maxX: Math.max(c.maxX, p.x), minZ: Math.min(c.minZ, p.z), maxZ: Math.max(c.maxZ, p.z) }), b), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }) }));
  const inWater = (w: (typeof areas)[number], p: P2): boolean => {
    if (p.x < w.box.minX || p.x > w.box.maxX || p.z < w.box.minZ || p.z > w.box.maxZ) return false;
    // holes wind against the outer rings: inside an odd number of rings is in the water
    let n = 0;
    for (const r of w.rings) if (pointInRing(p, r)) n++;
    return n % 2 === 1;
  };
  strips.forEach((s, si) => {
    if (!s.st.some((st) => st.bridge)) return;
    areas.forEach((w, wi) => {
      let start = -1;
      for (let i = 0; i <= s.st.length; i++) {
        const st = s.st[i];
        const wet = st !== undefined && st.bridge && inWater(w, st);
        if (wet && start < 0) start = i;
        if (!wet && start >= 0) {
          let level = Infinity;
          for (let k = start; k < i; k++) level = Math.min(level, input.ground((s.st[k] as Station).x, (s.st[k] as Station).z));
          water.push({ strip: si, water: wi, first: start, last: i - 1, level });
          start = -1;
        }
      }
    });
  });
  return { roads, roadPairs: pairs.size, junctions, rails, levelCrossings, water };
}
