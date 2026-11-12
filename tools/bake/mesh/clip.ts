// Polygon set operations for the road mesh (P1-014, ARCH_OPTIONS J3: the polygon union is the proof that no two road
// faces overlap, and the fallback for junctions the construction cannot solve). A thin layer over clipper2-ts: rings
// are [x, z] pairs in block metres; every call works in whole tenths of a millimetre around a local origin, so two
// rings that share a vertex share it exactly. Pure.
import { EndType, FillRule, JoinType, areaPaths, difference, inflatePaths, intersect, union } from 'clipper2-ts';
import type { Path64, Paths64 } from 'clipper2-ts';

export type Ring = readonly (readonly [number, number])[];

/** Clipper units per metre. */
export const CLIP_SCALE = 10000;

/** A part of a set result narrower than twice this is no face (m). */
export const NECK_M = 0.0015;

export interface Origin {
  x: number;
  z: number;
}

export const toPath = (ring: Ring, o: Origin): Path64 => ring.map(([x, z]) => ({ x: Math.round((x - o.x) * CLIP_SCALE), y: Math.round((z - o.z) * CLIP_SCALE) }));
export const toPaths = (rings: readonly Ring[], o: Origin): Paths64 => rings.map((r) => toPath(r, o));
const fromPath = (p: Path64, o: Origin): [number, number][] => p.map((q) => [q.x / CLIP_SCALE + o.x, q.y / CLIP_SCALE + o.z]);

/** Area of a set of result paths in m2 (holes count against their outer ring). */
export const pathsArea = (paths: Paths64): number => Math.abs(areaPaths(paths)) / (CLIP_SCALE * CLIP_SCALE);

/** Area of a ring in m2 (shoelace, unsigned). */
export function ringAreaM2(ring: Ring): number {
  let a = 0;
  for (let k = 0; k < ring.length; k++) {
    const p = ring[k] as readonly [number, number];
    const q = ring[(k + 1) % ring.length] as readonly [number, number];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

/** Area the two sets share (m2). Each set is taken as the union of its rings. */
export function sharedArea(a: readonly Ring[], b: readonly Ring[], o: Origin): number {
  if (!a.length || !b.length) return 0;
  return pathsArea(intersect(toPaths(a, o), toPaths(b, o), FillRule.NonZero));
}

/** Area of the union of the rings (m2). */
export function unionArea(rings: readonly Ring[], o: Origin): number {
  if (!rings.length) return 0;
  return pathsArea(union(toPaths(rings, o), FillRule.NonZero));
}

/**
 * `a` minus `b` as plain rings in block metres: every ring returned is a face without holes. Where the result has
 * holes (something of `b` wholly inside a piece), it is cut into slabs along lines that cross every hole: each hole
 * then lies open in the two slabs beside its line. Pieces under `minArea` m2 are dropped. `holes`
 * counts the holes found.
 */
export function minus(a: readonly Ring[], b: readonly Ring[], o: Origin, minArea = 0.005): { rings: [number, number][][]; holes: number } {
  let res = difference(toPaths(a, o), toPaths(b, o), FillRule.NonZero);
  // hairline necks (the gap between two neighbours that do not quite touch) are taken out: drawn in, then out again
  res = inflatePaths(inflatePaths(res, -NECK_M * CLIP_SCALE, JoinType.Miter, EndType.Polygon, 10), NECK_M * CLIP_SCALE, JoinType.Miter, EndType.Polygon, 10);
  let big = 0;
  for (const p of res) {
    const ar = areaPaths([p]);
    if (Math.abs(ar) > Math.abs(big)) big = ar;
  }
  // the largest path is an outer ring: a path that turns the other way is a hole
  const pos = Math.sign(big);
  const spans: [number, number][] = [];
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const p of res) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const q of p) {
      x0 = Math.min(x0, q.x);
      x1 = Math.max(x1, q.x);
      lo = Math.min(lo, q.y);
      hi = Math.max(hi, q.y);
    }
    if (Math.sign(areaPaths([p])) === -pos) spans.push([lo, hi]);
  }
  const holes = spans.length;
  if (holes) {
    // as few lines as will cross every hole: holes by their far side, a new line only for a hole no line crosses yet
    const lines: number[] = [];
    for (const [lo, hi] of spans.sort((p, q) => p[1] - q[1])) {
      const last = lines[lines.length - 1];
      if (last !== undefined && last > lo) continue;
      lines.push(hi - Math.max(1, Math.min(10, Math.floor((hi - lo) / 2))));
    }
    const far = 1e10;
    const slabs: Paths64 = [];
    for (let k = 0; k <= lines.length; k++) {
      const top = k === 0 ? -far : (lines[k - 1] as number);
      const bottom = k === lines.length ? far : (lines[k] as number);
      slabs.push(...intersect(res, [[{ x: x0 - 10, y: top }, { x: x1 + 10, y: top }, { x: x1 + 10, y: bottom }, { x: x0 - 10, y: bottom }]], FillRule.NonZero));
    }
    res = slabs;
  }
  const rings: [number, number][][] = [];
  for (const p of res) if (Math.abs(areaPaths([p])) / (CLIP_SCALE * CLIP_SCALE) >= minArea && (!holes || Math.sign(areaPaths([p])) === pos || pos === 0)) rings.push(fromPath(p, o));
  return { rings, holes };
}

/**
 * A ring without whiskers: a corner where the ring turns straight back on itself (the way out and the way back
 * within `tol` metres of each other) is taken out, again and again, until none is left. The polygon set leaves
 * such slivers where two edges nearly lie on each other; welded to the millimetre they would be an edge used twice.
 */
export function trimWhiskers(ring: readonly (readonly [number, number])[], tol = 0.003): [number, number][] {
  const pts = ring.map((p) => [p[0], p[1]] as [number, number]);
  const near = (p: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): boolean => {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len2 = dx * dx + dz * dz;
    const t = len2 > 1e-18 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2)) : 0;
    return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dz * t)) < tol;
  };
  for (let changed = true; changed && pts.length >= 3; ) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length >= 3; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length] as [number, number];
      const b = pts[i] as [number, number];
      const c = pts[(i + 1) % pts.length] as [number, number];
      const back = (a[0] - b[0]) * (c[0] - b[0]) + (a[1] - b[1]) * (c[1] - b[1]) > 0;
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < tol || (back && (near(c, a, b) || near(a, b, c)))) {
        pts.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  return pts;
}
