// The shell of one generated building (P2-009): walls from under the lowest ground at the footprint to the plan's
// height over the highest ground, and a roof by kind: flat (the walls stand a parapet's height over the slab line, so
// the street sees a parapet), `setback` (the top floor stands back on a terrace), `mumty` (a stair head on the roof),
// `crown` (a service core on a slab or tower), `gable` (a pitched roof on a four-cornered shed). One shell is one
// collider (tile/colliders.ts keeps a building in one chunk). Every wall carries a facade UV: u counts bays along
// the wall, v floors up from the ground line, so a shader can draw windows on walls that carry no modules; UV2 holds
// the wall colour (0xRRGGBB as a whole number) and the wear. Pure.
import earcut from 'earcut';
import { EndType, JoinType, areaD, inflatePathsD } from 'clipper2-ts';
import type { P2 } from '../geom.ts';
import { pointInRing, ringArea, ringCentroid } from '../geom.ts';
import { triangulateRing } from '../mesh/solids.ts';
import type { Shell } from '../tile/shells.ts';
import { SHELL_SINK_M } from '../tile/shells.ts';
import type { BuildingPlan } from './plan.ts';
import { orientedBox } from './space.ts';

/** A wall of a shell, for the facade modules. */
export interface Wall {
  /** Ends in block metres, in the order that puts the outside on the left of a to b seen from above... see nx, nz. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Unit outward normal. */
  nx: number;
  nz: number;
  len: number;
  /** Bays along it (0: too short for one). */
  bays: number;
  /** Floors it rises through, from which floor (a setback wall starts at the top floor). */
  floor0: number;
  floors: number;
}

export interface GenShell extends Shell {
  /** Two numbers per vertex (three vertices per triangle): bays along, floors up. */
  uv: number[];
  /** 0xRRGGBB and wear 0 to 1. */
  tint: number;
  wear: number;
  walls: Wall[];
  /** The ground line the floors are counted from (the highest ground at the footprint). */
  groundY: number;
  roofY: number;
}

export const SETBACK_M = 1.8;
/** A stair head and a service core stand this far over the wall top (m). */
export const MUMTY_M = 1.8;
export const CROWN_M = 2.8;
/** A wall shorter than this carries no bay. */
export const MIN_BAY_M = 1.6;

const openRing = (ring: readonly P2[]): P2[] => (ring.length > 1 && ring[0]!.x === ring[ring.length - 1]!.x && ring[0]!.z === ring[ring.length - 1]!.z ? ring.slice(0, -1) : ring.slice());

/** How many bays a wall of a length takes at a bay width. */
export function baysOf(len: number, bayM: number): number {
  if (len < MIN_BAY_M) return 0;
  return Math.max(1, Math.round(len / bayM));
}

/** The ring moved in by `d` (one ring only, else null). */
export function inset(ring: readonly P2[], d: number): P2[] | null {
  const path = ring.map((p) => ({ x: p.x, y: p.z }));
  const pos = areaD(path) < 0 ? path.slice().reverse() : path;
  const out = inflatePathsD([pos], -d, JoinType.Miter, EndType.Polygon, 2, 3);
  if (out.length !== 1) return null;
  const r = (out[0] as { x: number; y: number }[]).map((q) => ({ x: Math.round(q.x * 100) / 100, z: Math.round(q.y * 100) / 100 }));
  return r.length >= 3 ? r : null;
}

/**
 * The shell of a parcel. `ground` gives the solved surface (NaN under a road), `fallback` the ground model. Null for a
 * ring that is not a shape.
 */
export function buildShell(id: string, ringIn: readonly P2[], plan: BuildingPlan, bayM: number, ground: (x: number, z: number) => number, fallback: (x: number, z: number) => number): GenShell | null {
  const ring = openRing(ringIn);
  if (ring.length < 3 || Math.abs(ringArea(ring)) < 1) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of ring) {
    let y = ground(p.x, p.z);
    if (!Number.isFinite(y)) y = fallback(p.x, p.z);
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  const base = lo - SHELL_SINK_M;
  const tris: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const walls: Wall[] = [];
  // floors up at a height: the ground floor is floor 0 to 1, each upper floor one more
  const vAt = (y: number): number => {
    const h = y - hi;
    if (h <= plan.groundM) return h / plan.groundM;
    return 1 + (h - plan.groundM) / plan.floorM;
  };
  const tri = (a: [number, number, number], b: [number, number, number], c: [number, number, number], n: [number, number, number], ua: [number, number], ub: [number, number], uc: [number, number]): void => {
    tris.push(...a, ...b, ...c);
    nrm.push(...n);
    uv.push(...ua, ...ub, ...uc);
  };
  /** Walls of a ring from y0 to y1; returns nothing, pushes the wall list when `list` is set. */
  const wallsOf = (r: readonly P2[], y0: number, y1: number, floor0: number, floors: number, list: boolean): void => {
    const sign = ringArea(r) > 0 ? 1 : -1;
    for (let i = 0; i < r.length; i++) {
      const p = r[i] as P2;
      const q = r[(i + 1) % r.length] as P2;
      const len = Math.hypot(q.x - p.x, q.z - p.z);
      if (len < 1e-4) continue;
      const nx = (sign * (q.z - p.z)) / len;
      const nz = (-sign * (q.x - p.x)) / len;
      const bays = baysOf(len, bayM);
      const u1 = Math.max(1, bays);
      const v0 = vAt(y0);
      const v1 = vAt(y1);
      tri([p.x, y0, p.z], [q.x, y0, q.z], [q.x, y1, q.z], [nx, 0, nz], [0, v0], [u1, v0], [u1, v1]);
      tri([p.x, y0, p.z], [q.x, y1, q.z], [p.x, y1, p.z], [nx, 0, nz], [0, v0], [u1, v1], [0, v1]);
      if (list) walls.push({ ax: p.x, az: p.z, bx: q.x, bz: q.z, nx, nz, len, bays, floor0, floors });
    }
  };
  const flatRoof = (r: readonly P2[], y: number): void => {
    const idx = triangulateRing(r.map((p) => [p.x, p.z] as [number, number]));
    for (let k = 0; k + 2 < idx.length; k += 3) {
      const [a, b, c] = [r[idx[k] as number] as P2, r[idx[k + 1] as number] as P2, r[idx[k + 2] as number] as P2];
      tri([a.x, y, a.z], [b.x, y, b.z], [c.x, y, c.z], [0, 1, 0], [0, 0], [0, 0], [0, 0]);
    }
  };
  /** A box on the roof: centre, unit axis, half sizes, from y0 to y1. */
  const box = (cx: number, cz: number, ux: number, uz: number, a: number, b: number, y0: number, y1: number): void => {
    const vx = -uz;
    const vz = ux;
    const r = [
      { x: cx - ux * a - vx * b, z: cz - uz * a - vz * b }, { x: cx + ux * a - vx * b, z: cz + uz * a - vz * b },
      { x: cx + ux * a + vx * b, z: cz + uz * a + vz * b }, { x: cx - ux * a + vx * b, z: cz - uz * a + vz * b },
    ];
    const sign = ringArea(r) > 0 ? 1 : -1;
    for (let i = 0; i < 4; i++) {
      const p = r[i] as P2;
      const q = r[(i + 1) % 4] as P2;
      const len = Math.hypot(q.x - p.x, q.z - p.z);
      const nx = (sign * (q.z - p.z)) / len;
      const nz = (-sign * (q.x - p.x)) / len;
      tri([p.x, y0, p.z], [q.x, y0, q.z], [q.x, y1, q.z], [nx, 0, nz], [0, 0], [0, 0], [0, 0]);
      tri([p.x, y0, p.z], [q.x, y1, q.z], [p.x, y1, p.z], [nx, 0, nz], [0, 0], [0, 0], [0, 0]);
    }
    tri([r[0]!.x, y1, r[0]!.z], [r[1]!.x, y1, r[1]!.z], [r[2]!.x, y1, r[2]!.z], [0, 1, 0], [0, 0], [0, 0], [0, 0]);
    tri([r[0]!.x, y1, r[0]!.z], [r[2]!.x, y1, r[2]!.z], [r[3]!.x, y1, r[3]!.z], [0, 1, 0], [0, 0], [0, 0], [0, 0]);
  };
  const inside = (x: number, z: number): boolean => pointInRing({ x, z }, ring);
  const boxFits = (cx: number, cz: number, ux: number, uz: number, a: number, b: number): boolean => {
    const vx = -uz;
    const vz = ux;
    for (const [s, t] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]] as const) if (!inside(cx + ux * a * s * 1.15 + vx * b * t * 1.15, cz + uz * a * s * 1.15 + vz * b * t * 1.15)) return false;
    return true;
  };
  const top = hi + plan.height;
  let roof = plan.roof;
  const ob = orientedBox(ring);
  const centre = ringCentroid(ring);

  // a pitched roof on a four-cornered shed: eaves at the wall top, the ridge along the long side
  if (roof === 'gable') {
    const ok = ring.length === 4 && ob.b >= 1.5 && Math.abs(ringArea(ring)) >= 0.85 * 4 * ob.a * ob.b;
    if (!ok) roof = 'flat';
    else {
      wallsOf(ring, base, top, 0, plan.floors, true);
      const rise = Math.min(2.4, ob.b * 0.55);
      // the two ends of the ridge: the middles of the short sides
      const sideLen = (i: number): number => Math.hypot((ring[(i + 1) % 4] as P2).x - (ring[i] as P2).x, (ring[(i + 1) % 4] as P2).z - (ring[i] as P2).z);
      const s = sideLen(0) < sideLen(1) ? 0 : 1; // sides s and s + 2 are the short ones
      const mid = (i: number): P2 => ({ x: ((ring[i] as P2).x + (ring[(i + 1) % 4] as P2).x) / 2, z: ((ring[i] as P2).z + (ring[(i + 1) % 4] as P2).z) / 2 });
      const r0 = mid(s);
      const r1 = mid(s + 2);
      const sign = ringArea(ring) > 0 ? 1 : -1;
      for (const k of [s, s + 2]) {
        // gable end: a triangle over the short wall
        const p = ring[k % 4] as P2;
        const q = ring[(k + 1) % 4] as P2;
        const m = k === s ? r0 : r1;
        const len = Math.hypot(q.x - p.x, q.z - p.z);
        tri([p.x, top, p.z], [q.x, top, q.z], [m.x, top + rise, m.z], [(sign * (q.z - p.z)) / len, 0, (-sign * (q.x - p.x)) / len], [0, 0], [0, 0], [0, 0]);
      }
      for (const k of [s + 1, s + 3]) {
        // a roof slope over a long wall, from its eave up to the ridge
        const p = ring[k % 4] as P2;
        const q = ring[(k + 1) % 4] as P2;
        const [ra, rb] = k === s + 1 ? [r0, r1] : [r1, r0];
        const len = Math.hypot(q.x - p.x, q.z - p.z);
        const ox = (sign * (q.z - p.z)) / len;
        const oz = (-sign * (q.x - p.x)) / len;
        const half = ob.b;
        const nl = Math.hypot(rise, half);
        const n: [number, number, number] = [(ox * rise) / nl, half / nl, (oz * rise) / nl];
        tri([p.x, top, p.z], [q.x, top, q.z], [rb.x, top + rise, rb.z], n, [0, 0], [0, 0], [0, 0]);
        tri([p.x, top, p.z], [rb.x, top + rise, rb.z], [ra.x, top + rise, ra.z], n, [0, 0], [0, 0], [0, 0]);
      }
      return { id, anchor: centre, tris, nrm, uv, base, top: top + rise, from: fromOf(plan), tint: plan.tint, wear: plan.wear, walls, groundY: hi, roofY: top };
    }
  }

  // the top floor stands back on a terrace
  if (roof === 'setback') {
    const upper = inset(ring, SETBACK_M);
    const y1 = top - plan.floorM;
    if (!upper || Math.abs(ringArea(upper)) < Math.max(12, 0.35 * Math.abs(ringArea(ring))) || plan.floors < 3) roof = 'flat';
    else {
      wallsOf(ring, base, y1, 0, plan.floors - 1, true);
      // the terrace: the ring with the upper ring as its hole
      const flat: number[] = [];
      const outer = ringArea(ring) > 0 ? ring : ring.slice().reverse();
      const hole = ringArea(upper) > 0 ? upper.slice().reverse() : upper;
      for (const p of outer) flat.push(p.x, p.z);
      for (const p of hole) flat.push(p.x, p.z);
      const all = [...outer, ...hole];
      const idx = earcut(flat, [outer.length]);
      for (let k = 0; k + 2 < idx.length; k += 3) {
        const [a, b, c] = [all[idx[k] as number] as P2, all[idx[k + 1] as number] as P2, all[idx[k + 2] as number] as P2];
        tri([a.x, y1, a.z], [b.x, y1, b.z], [c.x, y1, c.z], [0, 1, 0], [0, 0], [0, 0], [0, 0]);
      }
      wallsOf(upper, y1, top, plan.floors - 1, 1, true);
      flatRoof(upper, top);
      return { id, anchor: centre, tris, nrm, uv, base, top, from: fromOf(plan), tint: plan.tint, wear: plan.wear, walls, groundY: hi, roofY: top };
    }
  }

  wallsOf(ring, base, top, 0, plan.floors, true);
  flatRoof(ring, top);
  let peak = top;
  if (roof === 'mumty') {
    // a stair head: 3.2 by 2.6 m, toward one corner of the box
    const a = 1.6;
    const b = 1.3;
    for (const [s, t] of [[0.55, 0.5], [-0.55, 0.5], [0.55, -0.5], [-0.55, -0.5], [0, 0]] as const) {
      const cx = ob.cx + ob.ux * (ob.a - a) * s - ob.uz * (ob.b - b) * t;
      const cz = ob.cz + ob.uz * (ob.a - a) * s + ob.ux * (ob.b - b) * t;
      if (ob.a > a * 1.3 && ob.b > b * 1.3 && boxFits(cx, cz, ob.ux, ob.uz, a, b)) {
        box(cx, cz, ob.ux, ob.uz, a, b, top, top + MUMTY_M);
        peak = top + MUMTY_M;
        break;
      }
    }
  } else if (roof === 'crown') {
    // a service core: about a third of the box
    const a = Math.max(1.5, Math.min(7, ob.a * 0.36));
    const b = Math.max(1.5, Math.min(5, ob.b * 0.4));
    for (const [cx, cz] of [[centre.x, centre.z], [ob.cx, ob.cz]] as const) {
      if (boxFits(cx, cz, ob.ux, ob.uz, a, b)) {
        box(cx, cz, ob.ux, ob.uz, a, b, top, top + CROWN_M);
        peak = top + CROWN_M;
        break;
      }
    }
  }
  return { id, anchor: centre, tris, nrm, uv, base, top: peak, from: fromOf(plan), tint: plan.tint, wear: plan.wear, walls, groundY: hi, roofY: top };
}

const fromOf = (p: BuildingPlan): Shell['from'] => (p.from === 'height' ? 'height' : p.from === 'levels' ? 'levels' : p.from === 'class' ? 'class' : 'default');
