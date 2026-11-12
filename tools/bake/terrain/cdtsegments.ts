// Forcing segments into the triangulation (P1-015): the road mesh's free edges, building walls, water and park
// edges, the stage outline and the 250 m tile lines all become edges of the ground. A segment walks from its start
// through the triangles it crosses. A vertex within `eps` of it becomes part of it (the segment bends by that
// much, so two edges that nearly lie on each other become one). Where it crosses an edge that is already
// constrained, a vertex is put on the crossing and both run through it. Edges that are not constrained are
// flipped out of the way. Pure.
import type { Cdt } from './cdt.ts';
import { incircle, orient } from './predicates.ts';

export interface SegmentStats {
  segments: number;
  /** Segments that were already an edge. */
  direct: number;
  /** Vertices a segment was bent through. */
  snapped: number;
  /** Crossings of two constrained edges that got a vertex. */
  crossings: number;
  /** Crossings where no vertex could be placed: the segment went through the nearer end of the crossed edge. */
  forced: number;
  flips: number;
  /** Segments given up (the flips did not end). 0 in a sound triangulation. */
  failed: number;
}

export const newSegmentStats = (): SegmentStats => ({ segments: 0, direct: 0, snapped: 0, crossings: 0, forced: 0, flips: 0, failed: 0 });

/** Forces the segment from vertex a to vertex b in, with a label as seen going from a to b. `eps` in units. */
export function insertSegment(cdt: Cdt, a: number, b: number, label: number, eps: number, stats: SegmentStats): void {
  stats.segments++;
  const todo: number[] = [b, a];
  for (let guard = 0; todo.length && guard < 100000; guard++) {
    const s = todo.pop() as number;
    const e = todo.pop() as number;
    if (s !== e) step(cdt, s, e, label, eps, stats, todo);
  }
}

/** One piece: either the edge s to e exists or is made, or the piece is cut at a vertex and the parts go back on the list (e first, then s). */
function step(cdt: Cdt, s: number, e: number, label: number, eps: number, stats: SegmentStats, todo: number[]): void {
  const { x, z } = cdt;
  const sx = x[s] as number;
  const sz = z[s] as number;
  const ex = x[e] as number;
  const ez = z[e] as number;
  const dx = ex - sx;
  const dz = ez - sz;
  const len2 = dx * dx + dz * dz;
  const side = (v: number): number => orient(sx, sz, ex, ez, x[v] as number, z[v] as number);
  /** Within eps of the segment and strictly between its ends. */
  const onSeg = (v: number, o: number): boolean => {
    if (v === s || v === e || o * o > eps * eps * len2) return false;
    const dot = ((x[v] as number) - sx) * dx + ((z[v] as number) - sz) * dz;
    return dot > 0 && dot < len2;
  };
  const via = (v: number): void => {
    stats.snapped++;
    cdt.onSplit?.(s, e, v);
    todo.push(e, v, v, s);
  };

  // the triangle at s that the segment leaves through
  const start = cdt.vt[s] as number;
  let t = start;
  let r = -1;
  let l = -1;
  for (let guard = 0; ; guard++) {
    const o = t * 3;
    const k = cdt.tv[o] === s ? 0 : cdt.tv[o + 1] === s ? 1 : 2;
    const u = cdt.tv[o + ((k + 1) % 3)] as number;
    const v = cdt.tv[o + ((k + 2) % 3)] as number;
    if (u === e) {
      cdt.constrain(s, e, label);
      stats.direct++;
      return;
    }
    const ou = side(u);
    const ov = side(v);
    if (onSeg(u, ou)) return via(u);
    if (ou < 0 && ov > 0) {
      if (onSeg(v, ov)) return via(v);
      r = u;
      l = v;
      break;
    }
    t = cdt.tn[o + ((k + 1) % 3)] as number;
    if (t < 0 || t === start || guard > 100000) {
      stats.failed++;
      return;
    }
  }

  // walk across: every crossed edge has r on the right of the segment and l on its left
  const crossed: number[] = [];
  let end = e;
  for (let guard = 0; guard < 1000000; guard++) {
    const o = t * 3;
    const slot = cdt.tv[o] !== r && cdt.tv[o] !== l ? 0 : cdt.tv[o + 1] !== r && cdt.tv[o + 1] !== l ? 1 : 2;
    if (cdt.constrained(t, slot)) {
      // two constrained edges cross: a vertex on the crossing, on the edge that is already there
      const rx = x[r] as number;
      const rz = z[r] as number;
      const lx = x[l] as number;
      const lz = z[l] as number;
      const os = orient(rx, rz, lx, lz, sx, sz);
      const oe = orient(rx, rz, lx, lz, ex, ez);
      const f = os / (os - oe);
      const px = Math.round(sx + dx * f);
      const pz = Math.round(sz + dz * f);
      const near = (v: number): boolean => Math.abs(px - (x[v] as number)) <= eps && Math.abs(pz - (z[v] as number)) <= eps;
      let v = near(r) ? r : near(l) ? l : -1;
      if (v < 0) {
        v = cdt.splitEdge(t, slot, px, pz);
        if (v >= 0) stats.crossings++;
        else {
          stats.forced++;
          v = Math.hypot(px - rx, pz - rz) <= Math.hypot(px - lx, pz - lz) ? r : l;
        }
      } else stats.snapped++;
      if (v === s || v === e) {
        stats.failed++;
        return;
      }
      cdt.onSplit?.(s, e, v);
      todo.push(e, v, v, s);
      return;
    }
    crossed.push(r, l);
    const n = cdt.tn[o + slot] as number;
    const w = cdt.tv[n * 3 + cdt.slotOf(n, t)] as number;
    if (w === e) break;
    const ow = side(w);
    if (onSeg(w, ow)) {
      end = w;
      stats.snapped++;
      break;
    }
    if (ow > 0) l = w;
    else r = w;
    t = n;
  }

  // take the crossed edges out by flipping; an edge whose four corners are not convex yet waits for its neighbours
  const fx = x[end] as number;
  const fz = z[end] as number;
  const fresh: number[] = [];
  let head = 0;
  const limit = crossed.length * crossed.length * 4 + 64;
  for (let guard = 0; head < crossed.length; guard++) {
    if (guard > limit) {
      stats.failed++;
      return;
    }
    const p = crossed[head++] as number;
    const q = crossed[head++] as number;
    const at = cdt.findEdge(p, q);
    if (!at) continue;
    const o = at.t * 3;
    const slot = (at.slot + 2) % 3;
    const c = cdt.tv[o + slot] as number;
    const n = cdt.tn[o + slot] as number;
    const d = cdt.tv[n * 3 + cdt.slotOf(n, at.t)] as number;
    const cx = x[c] as number;
    const cz = z[c] as number;
    const ddx = x[d] as number;
    const ddz = z[d] as number;
    if (orient(cx, cz, ddx, ddz, x[q] as number, z[q] as number) > 0 && orient(cx, cz, ddx, ddz, x[p] as number, z[p] as number) < 0) {
      cdt.flip(at.t, slot);
      stats.flips++;
      const oc = c === s || c === end ? 0 : orient(sx, sz, fx, fz, cx, cz);
      const od = d === s || d === end ? 0 : orient(sx, sz, fx, fz, ddx, ddz);
      if ((oc > 0 && od < 0) || (oc < 0 && od > 0)) crossed.push(c, d);
      else fresh.push(c, d);
    } else crossed.push(p, q);
  }
  if (!cdt.constrain(s, end, label)) {
    stats.failed++;
    return;
  }
  // the edges the flips made: back to Delaunay where the constraints allow
  for (let k = 0; k + 1 < fresh.length; k += 2) {
    const c = fresh[k] as number;
    const d = fresh[k + 1] as number;
    const at = cdt.findEdge(c, d);
    if (!at) continue;
    const slot = (at.slot + 2) % 3;
    if (cdt.constrained(at.t, slot)) continue;
    const o = at.t * 3;
    const p = cdt.tv[o + slot] as number;
    const n = cdt.tn[o + slot] as number;
    if (n < 0) continue;
    const q = cdt.tv[n * 3 + cdt.slotOf(n, at.t)] as number;
    if (incircle(x[p] as number, z[p] as number, x[c] as number, z[c] as number, x[d] as number, z[d] as number, x[q] as number, z[q] as number) > 0) cdt.relax([at.t, slot]);
  }
  if (end !== e) {
    cdt.onSplit?.(s, e, end);
    todo.push(e, end);
  }
}
