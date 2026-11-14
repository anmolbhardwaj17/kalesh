// Railway track for the kits (P2-034, rail.md RAIL-BG): every railway line of the stage as a track at its height, the
// rail bridges at their deck level, the approaches on an embankment, level crossings flush with the road, and the
// overhead line masts where they stand clear of every other track and every road. Pure.
//   Heights: a line at grade lies on the final ground (ballast 0.3 m on it); a bridge line at the level the elevation
//   step gave it (the higher bank plus RAIL_EMBANKMENT_M); the at-grade lines joined to a bridge climb to it at 1.2
//   percent along the track (the embankment the Delhi rail bridges stand on), so no line steps up to its bridge.
//   Where the ground is a road (no ground triangle), the track is a level crossing: rails in the road surface.
import { Grid, pointSegment, polylineLength, resample } from '../geom.ts';
import type { P2 } from '../geom.ts';

/** Rail top over the sleeper base: the sleeper (0.17 m above the base) and the rail (0.16 m) (m). */
export const RAIL_OVER_SLEEPER_BASE_M = 0.33;
/** Ballast depth under the sleeper base (m). */
export const BALLAST_M = 0.3;
/** Grade of a rail embankment approach. */
export const RAIL_APPROACH_GRADE = 0.012;
export const RAIL_SAMPLE_M = 5;
/** Overhead line masts: spacing along a track, distance beside it, and the clearance to any other track centre. */
export const MAST_SPACING_M = 50;
export const MAST_OFFSET_M = 3.1;
export const MAST_CLEAR_M = 2.4;
/** Contact wire height above the rail (rail.md: nominal about 5.6 m). */
export const WIRE_M = 5.6;

export interface RailIn {
  id: string;
  name: string;
  /** rail or metro */
  kind: string;
  pts: P2[];
  bridge: boolean;
  tunnel: boolean;
  variant: string;
}

export const F_BALLAST = 0;
export const F_CROSSING = 1;
export const F_BRIDGE = 2;

export interface Track {
  id: string;
  variant: string;
  bridge: boolean;
  /** Every RAIL_SAMPLE_M: x, z, the sleeper base (ballast top, or deck top on a bridge), the ground under it, a flag. */
  pts: { x: number; z: number; y: number; g: number; f: number }[];
}

export interface Mast {
  x: number;
  z: number;
  /** Foot height (the ground or the bridge deck). */
  y: number;
  /** Direction of the track in plan (unit) and the lateral reach from the mast to the track centre (signed, + left). */
  dx: number;
  dz: number;
  reach: number;
  /** Contact wire level. */
  wire: number;
}

export interface RailInput {
  lines: readonly RailIn[];
  /** Final ground height, NaN where no ground triangle is (a road). */
  ground: (x: number, z: number) => number;
  /** The ground model (always a number). */
  groundModel: (x: number, z: number) => number;
  /** Height of the road under a point near a height, NaN when none. */
  roadAt: (x: number, z: number, near: number) => number;
  /** A support at (x, z) of radius r up to `below` would stand on a road. */
  blocked: (x: number, z: number, r: number, below: number) => boolean;
  railEmbankment: number;
}

const key = (p: P2): string => `${Math.round(p.x * 2)},${Math.round(p.z * 2)}`;

export function buildTracks(input: RailInput): { tracks: Track[]; masts: Mast[]; stats: { lines: number; km: number; crossings: number; embankmentM: number; bridges: number; masts: number } } {
  const lines = input.lines.filter((l) => !l.tunnel && l.pts.length >= 2);
  // bridge decks: the level of crossings.ts, the higher bank plus the embankment
  // (the sleeper base: the rail top of crossings.ts less the rail and sleeper, RAIL_OVER_SLEEPER_BASE_M)
  const deck = lines.map((l) => (l.bridge ? Math.max(input.groundModel((l.pts[0] as P2).x, (l.pts[0] as P2).z), input.groundModel((l.pts[l.pts.length - 1] as P2).x, (l.pts[l.pts.length - 1] as P2).z)) + input.railEmbankment - RAIL_OVER_SLEEPER_BASE_M : NaN));
  // the end nodes and the height each must reach: from every bridge end, along the at-grade lines, falling at the grade
  const nodeOf = new Map<string, number>();
  const node = (p: P2): number => {
    const k = key(p);
    let n = nodeOf.get(k);
    if (n === undefined) nodeOf.set(k, (n = nodeOf.size));
    return n;
  };
  const ends = lines.map((l) => [node(l.pts[0] as P2), node(l.pts[l.pts.length - 1] as P2)] as [number, number]);
  const lens = lines.map((l) => polylineLength(l.pts));
  const need = new Float64Array(nodeOf.size).fill(-Infinity);
  const adj: [number, number][][] = Array.from({ length: nodeOf.size }, () => []);
  lines.forEach((l, li) => {
    const [a, b] = ends[li] as [number, number];
    if (l.bridge) {
      need[a] = Math.max(need[a] as number, deck[li] as number);
      need[b] = Math.max(need[b] as number, deck[li] as number);
    } else {
      (adj[a] as [number, number][]).push([b, lens[li] as number]);
      (adj[b] as [number, number][]).push([a, lens[li] as number]);
    }
  });
  // a longest-height spread (Dijkstra on the height left): small graphs, a plain loop is enough
  const queue = [...need.keys()].filter((n) => Number.isFinite(need[n] as number));
  while (queue.length) {
    queue.sort((p, q) => (need[q] as number) - (need[p] as number));
    const n = queue.shift() as number;
    for (const [m, len] of adj[n] as [number, number][]) {
      const h = (need[n] as number) - len * RAIL_APPROACH_GRADE;
      if (h > (need[m] as number) + 1e-6) {
        need[m] = h;
        if (!queue.includes(m)) queue.push(m);
      }
    }
  }
  let crossings = 0;
  let embankmentM = 0;
  const tracks: Track[] = lines.map((l, li) => {
    const pts = resample(l.pts, RAIL_SAMPLE_M);
    const [a, b] = ends[li] as [number, number];
    const len = lens[li] as number;
    let s = 0;
    const out: Track['pts'] = [];
    for (let k = 0; k < pts.length; k++) {
      const p = pts[k] as P2;
      if (k > 0) s += Math.hypot(p.x - (pts[k - 1] as P2).x, p.z - (pts[k - 1] as P2).z);
      const gm = input.groundModel(p.x, p.z);
      if (l.bridge) {
        out.push({ x: p.x, z: p.z, y: deck[li] as number, g: Number.isFinite(input.ground(p.x, p.z)) ? input.ground(p.x, p.z) : gm, f: F_BRIDGE });
        continue;
      }
      const g = input.ground(p.x, p.z);
      const req = Math.max((need[a] as number) - s * RAIL_APPROACH_GRADE, (need[b] as number) - (len - s) * RAIL_APPROACH_GRADE);
      if (!Number.isFinite(g)) {
        // no ground triangle: a road (a level crossing), or the gap of a building or water
        const road = input.roadAt(p.x, p.z, gm);
        if (Number.isFinite(road) && !(req > road + 0.5)) {
          out.push({ x: p.x, z: p.z, y: road - 0.15, g: road, f: F_CROSSING });
          crossings++;
          continue;
        }
      }
      const base = Number.isFinite(g) ? g : gm;
      const y = Math.max(base + BALLAST_M, req);
      if (req > base + BALLAST_M + 0.05) embankmentM += RAIL_SAMPLE_M;
      out.push({ x: p.x, z: p.z, y, g: base, f: F_BALLAST });
    }
    return { id: l.id, variant: l.variant, bridge: l.bridge, pts: out };
  });
  // masts: every MAST_SPACING_M on the left of each track, where no other track, road or mast is
  const segs = new Grid<[P2, P2]>(40);
  for (const t of tracks) {
    for (let k = 0; k + 1 < t.pts.length; k++) {
      const p = t.pts[k] as P2;
      const q = t.pts[k + 1] as P2;
      segs.insert({ minX: Math.min(p.x, q.x), maxX: Math.max(p.x, q.x), minZ: Math.min(p.z, q.z), maxZ: Math.max(p.z, q.z) }, [p, q]);
    }
  }
  const placed = new Grid<P2>(20);
  const masts: Mast[] = [];
  tracks.forEach((t, ti) => {
    const line = lines[ti] as RailIn;
    if (line.kind !== 'rail' || line.variant === 'RAIL-DIS') return;
    let since = MAST_SPACING_M / 2;
    for (let k = 1; k < t.pts.length; k++) {
      const p = t.pts[k] as Track['pts'][number];
      const prev = t.pts[k - 1] as Track['pts'][number];
      since += Math.hypot(p.x - prev.x, p.z - prev.z);
      if (since < MAST_SPACING_M) continue;
      const dl = Math.hypot(p.x - prev.x, p.z - prev.z) || 1;
      const dx = (p.x - prev.x) / dl;
      const dz = (p.z - prev.z) / dl;
      // left of the direction of travel along the way (-z is north: left of +x is -z)
      for (const side of [1, -1]) {
        const mx = p.x + dz * MAST_OFFSET_M * side;
        const mz = p.z - dx * MAST_OFFSET_M * side;
        const m = { x: mx, z: mz };
        const box = { minX: mx - MAST_CLEAR_M, maxX: mx + MAST_CLEAR_M, minZ: mz - MAST_CLEAR_M, maxZ: mz + MAST_CLEAR_M };
        if (segs.query(box).some(([a, b]) => pointSegment(m, a, b).d < MAST_CLEAR_M)) continue;
        if (placed.query({ minX: mx - 6, maxX: mx + 6, minZ: mz - 6, maxZ: mz + 6 }).some((o) => Math.hypot(o.x - mx, o.z - mz) < 6)) continue;
        if (input.blocked(mx, mz, 0.4, p.y + WIRE_M)) continue;
        const foot = p.f === F_BRIDGE ? p.y : Number.isFinite(input.ground(mx, mz)) ? Math.min(input.ground(mx, mz), p.y) : p.g;
        masts.push({ x: mx, z: mz, y: foot, dx, dz, reach: MAST_OFFSET_M * side, wire: p.y + RAIL_OVER_SLEEPER_BASE_M + WIRE_M });
        placed.insert({ minX: mx, maxX: mx, minZ: mz, maxZ: mz }, m);
        since = 0;
        break;
      }
    }
  });
  const km = lens.reduce((s, l) => s + l, 0) / 1000;
  return { tracks, masts, stats: { lines: tracks.length, km: Math.round(km * 10) / 10, crossings, embankmentM, bridges: tracks.filter((t) => t.bridge).length, masts: masts.length } };
}
