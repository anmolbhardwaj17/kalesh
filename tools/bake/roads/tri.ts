// Triangulation of a polygon with holes by ear clipping (holes are first joined to the outer ring by bridges).
// Every input vertex stays a triangle corner, also a vertex in the middle of a straight edge: the ground must
// meet every road edge vertex, or a crack opens where the road's height is not a straight line.
// Our own code: the dependency for a library triangulator was not available in this run (see decisions.md).
import type { P2 } from '../geom.ts';
import { area2 } from './curve.ts';

const cross = (a: P2, b: P2, c: P2): number => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
const same = (a: P2, b: P2): boolean => a.x === b.x && a.z === b.z;

function inTriangle(p: P2, a: P2, b: P2, c: P2): boolean {
  return cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
}

export interface Triangulation {
  /** The outer ring's points followed by every hole's points. */
  pts: P2[];
  /** Three indices into pts per triangle. */
  idx: number[];
  /** Ears that had to be cut without passing the test (a ring that touches itself). 0 for a clean polygon. */
  forced: number;
}

/**
 * Triangles of `outer` minus `holes`. Rings are open (no repeated closing point), in any turning sense; they
 * must not cross each other.
 */
export function triangulatePolygon(outer: readonly P2[], holes: readonly (readonly P2[])[] = []): Triangulation {
  const pts: P2[] = [];
  const ringIdx = (ring: readonly P2[], positive: boolean): number[] => {
    const base = pts.length;
    for (const p of ring) pts.push({ x: p.x, z: p.z });
    const idx = ring.map((_, i) => base + i);
    if (area2(ring) > 0 !== positive) idx.reverse();
    return idx;
  };
  let poly = ringIdx(outer, true);
  const holeIdx = holes.filter((h) => h.length >= 3).map((h) => ringIdx(h, false));
  const P = (i: number): P2 => pts[i] as P2;
  // holes from the one that reaches furthest east: each is joined to the ring by a bridge from its eastmost point
  const maxX = (ring: number[]): number => Math.max(...ring.map((i) => P(i).x));
  holeIdx.sort((a, b) => maxX(b) - maxX(a));
  for (const hole of holeIdx) {
    let mi = 0;
    for (let i = 1; i < hole.length; i++) if (P(hole[i] as number).x > P(hole[mi] as number).x) mi = i;
    const m = P(hole[mi] as number);
    // the nearest edge of the ring hit by a ray east from m
    let bestX = Infinity;
    let bestK = -1;
    for (let k = 0; k < poly.length; k++) {
      const a = P(poly[k] as number);
      const b = P(poly[(k + 1) % poly.length] as number);
      if (a.z > m.z === b.z > m.z) continue;
      const x = a.x + ((m.z - a.z) / (b.z - a.z)) * (b.x - a.x);
      if (x >= m.x - 1e-12 && x < bestX) {
        bestX = x;
        bestK = k;
      }
    }
    if (bestK < 0) {
      // a ray along an edge or a hole outside the ring: fall back to the nearest ring vertex to the east
      let d = Infinity;
      for (let k = 0; k < poly.length; k++) {
        const q = P(poly[k] as number);
        const dd = Math.hypot(q.x - m.x, q.z - m.z);
        if (dd < d) {
          d = dd;
          bestK = k;
        }
      }
    } else {
      const a = P(poly[bestK] as number);
      const b = P(poly[(bestK + 1) % poly.length] as number);
      let k = a.x > b.x ? bestK : (bestK + 1) % poly.length;
      const hit = { x: bestX, z: m.z };
      const p = P(poly[k] as number);
      // a ring vertex inside the triangle m, hit, p hides p: take the one closest to the ray
      let bestTan = Infinity;
      for (let q = 0; q < poly.length; q++) {
        const v = P(poly[q] as number);
        if (same(v, p) || v.x < m.x) continue;
        const inside = hit.z < p.z ? inTriangle(v, m, hit, p) || inTriangle(v, m, p, hit) : inTriangle(v, m, p, hit) || inTriangle(v, m, hit, p);
        if (!inside) continue;
        const tan = Math.abs(v.z - m.z) / Math.max(1e-12, v.x - m.x);
        if (tan < bestTan) {
          bestTan = tan;
          k = q;
        }
      }
      bestK = k;
    }
    const rotated = [...hole.slice(mi), ...hole.slice(0, mi)];
    poly = [...poly.slice(0, bestK + 1), ...rotated, rotated[0] as number, poly[bestK] as number, ...poly.slice(bestK + 1)];
  }

  // ear clipping on a linked ring
  const n = poly.length;
  const next: number[] = [];
  const prev: number[] = [];
  for (let i = 0; i < n; i++) {
    next.push((i + 1) % n);
    prev.push((i + n - 1) % n);
  }
  const at = (i: number): P2 => P(poly[i] as number);
  const idx: number[] = [];
  let left = n;
  let cur = 0;
  let stall = 0;
  let forced = 0;
  const isEar = (i: number): boolean => {
    const a = at(prev[i] as number);
    const b = at(i);
    const c = at(next[i] as number);
    if (cross(a, b, c) <= 1e-12) return false;
    for (let q = next[next[i] as number] as number; q !== prev[i]; q = next[q] as number) {
      const v = at(q);
      if (same(v, a) || same(v, b) || same(v, c)) continue;
      if (cross(at(prev[q] as number), v, at(next[q] as number)) > 1e-12) continue; // only a reflex vertex can be inside
      if (inTriangle(v, a, b, c)) return false;
    }
    return true;
  };
  const clip = (i: number): void => {
    idx.push(poly[prev[i] as number] as number, poly[i] as number, poly[next[i] as number] as number);
    next[prev[i] as number] = next[i] as number;
    prev[next[i] as number] = prev[i] as number;
    left--;
  };
  while (left > 3) {
    if (isEar(cur)) {
      const p = prev[cur] as number;
      clip(cur);
      cur = p;
      stall = 0;
      continue;
    }
    cur = next[cur] as number;
    stall++;
    if (stall > left) {
      // no ear passes: cut the most convex corner so the loop ends (counted, so a caller can tell)
      let best = cur;
      let bestC = -Infinity;
      let q = cur;
      for (let k = 0; k < left; k++) {
        const c = cross(at(prev[q] as number), at(q), at(next[q] as number));
        if (c > bestC) {
          bestC = c;
          best = q;
        }
        q = next[q] as number;
      }
      const p = prev[best] as number;
      clip(best);
      forced++;
      cur = p;
      stall = 0;
    }
  }
  if (left === 3) idx.push(poly[prev[cur] as number] as number, poly[cur] as number, poly[next[cur] as number] as number);
  // drop triangles without area (a bridge walked both ways leaves some)
  const clean: number[] = [];
  for (let k = 0; k + 2 < idx.length; k += 3) {
    if (Math.abs(cross(P(idx[k] as number), P(idx[k + 1] as number), P(idx[k + 2] as number))) > 1e-10) clean.push(idx[k] as number, idx[k + 1] as number, idx[k + 2] as number);
  }
  return { pts, idx: clean, forced };
}
