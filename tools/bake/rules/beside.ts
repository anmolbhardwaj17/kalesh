// Roads beside each other (P1-031): two carriageways on one level that run alongside closer than their lanes and
// kerbs are wide lie on each other in plan. The detect (rule R-LANE-05) and the shift its repair applies
// (repair/shift.ts) share this file. The shift moves each road half of what is missing, away from the other; unlike
// the pair shift of R-LANE-FIT-01 it does not fade at an end whose node it may move: such a node moves with the road
// and every other road at it follows over its own blend length, so a road drawn too close right up to a junction
// is moved there too. A node the two roads share (a split, a junction both enter) stays: near it the zone or the
// junction holds both, and R-LANE-04 handles branches that never open; two roads from one node that open and then
// come back closer are moved apart where they do. Pure.
import type { P2 } from '../geom.ts';
import type { GraphEdge } from '../graph/build.ts';
import { leftOf, projectOn, r3, sameLevel } from './context.ts';
import type { RuleContext } from './context.ts';

/** Two roads closer than their separation by more than this (m) are on each other. */
export const BESIDE_TOL_M = 0.25;
/** Only roads within this angle of each other run alongside (a crossing at an angle is a junction's). */
export const BESIDE_COS = Math.cos((30 * Math.PI) / 180);
/** How fast a shift may grow along a road: metres along per metre sideways. */
export const SHIFT_RAMP = 5;
const STEP_M = 4;

/** Distance two carriageways beside each other must keep: half of each width and two kerbs. */
export const besideSeparation = (a: GraphEdge, b: GraphEdge): number => Math.round((a.road.width / 2 + b.road.width / 2 + 0.6) * 100) / 100;

export interface Beside {
  a: GraphEdge;
  b: GraphEdge;
  minSep: number;
  /** Closest the two centre lines come where they run alongside, and where. */
  minD: number;
  at: P2;
}

/** The two carriageways of one street: rules R-LANE-FIT-01 and R-LANE-03 keep them apart away from their ends. */
const paired = (a: GraphEdge, b: GraphEdge): boolean => a.pairedWith.includes(b.id) || b.pairedWith.includes(a.id);
const sharedNode = (a: GraphEdge, b: GraphEdge): boolean => a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b;

/** Every pair of roads on one level whose carriageways lie on each other where they run alongside. */
export function besidePairs(ctx: RuleContext): Beside[] {
  const cached = ctx.cache.get('beside') as Beside[] | undefined;
  if (cached) return cached;
  const found = new Map<string, Beside>();
  const widest = Math.max(0, ...ctx.graph.edges.map((e) => e.road.width));
  const keep = (a: GraphEdge, b: GraphEdge, minSep: number, d: number, at: P2): void => {
    // marked by an earlier shift of this pair: the shift is done, what is left is the blend at a fixed end
    if (String(ctx.marks[a.id]?.['beside_with'] ?? '').split(',').includes(b.id)) return;
    const [x, y] = a.id < b.id ? [a, b] : [b, a];
    const key = `${x.id}|${y.id}`;
    const prev = found.get(key);
    if (!prev || d < prev.minD) found.set(key, { a: x, b: y, minSep, minD: r3(d), at: { x: at.x, z: at.z } });
  };
  const alongside = (p: { tx: number; tz: number }, s0: P2, s1: P2): boolean => {
    const l = Math.hypot(s1.x - s0.x, s1.z - s0.z) || 1;
    return Math.abs((p.tx * (s1.x - s0.x) + p.tz * (s1.z - s0.z)) / l) >= BESIDE_COS;
  };
  for (const a of ctx.graph.edges) {
    const samples = ctx.samples(a, STEP_M, 0);
    for (const p of samples) {
      const lv = ctx.levelAt(a, p.s);
      for (const n of ctx.near(p, a.road.width / 2 + widest / 2 + 0.6)) {
        const b = n.seg.edge;
        if (b === a || sharedNode(a, b) || !sameLevel(lv, n.seg.lv)) continue;
        // the two carriageways of one street away from their ends are R-LANE-FIT-01's (its shift fades at the ends)
        if (paired(a, b) && p.s >= blendLength(a) && p.s <= a.len - blendLength(a)) continue;
        // the nearest point is b's own end: b stops beside a (a side road), it does not run alongside
        if ((n.seg.i === 0 && n.t <= 0) || (n.seg.i === b.pts.length - 2 && n.t >= 1)) continue;
        const minSep = besideSeparation(a, b);
        if (n.d >= minSep - BESIDE_TOL_M || !alongside(p, n.seg.a, n.seg.b)) continue;
        keep(a, b, minSep, n.d, p);
      }
    }
    // two roads from one node (the branches of a split, two arms of a junction): near the node they meet by design,
    // the zone or the junction holds that. Once they have been a separation apart, coming back closer is an overlap
    for (const atStart of [true, false]) {
      const node = atStart ? a.a : a.b;
      if (a.a === a.b) continue;
      for (const end of ctx.ends.get(node) ?? []) {
        const b = end.edge;
        if (b === a || b.a === b.b || paired(a, b) || [a.a, a.b].every((x) => x === b.a || x === b.b)) continue;
        const minSep = besideSeparation(a, b);
        let opened = false;
        for (const p of atStart ? samples : samples.slice().reverse()) {
          const pr = projectOn(p, b.pts);
          if ((pr.i === 0 && pr.t <= 0) || (pr.i === b.pts.length - 2 && pr.t >= 1)) continue;
          if (pr.d >= minSep - BESIDE_TOL_M) {
            opened = true;
            continue;
          }
          if (!opened || !sameLevel(ctx.levelAt(a, p.s), ctx.levelAt(b, 0)) || !alongside(p, b.pts[pr.i] as P2, b.pts[pr.i + 1] as P2)) continue;
          keep(a, b, minSep, pr.d, p);
        }
      }
    }
  }
  const out = [...found.values()].sort((p, q) => (p.a.id < q.a.id ? -1 : p.a.id > q.a.id ? 1 : p.b.id < q.b.id ? -1 : p.b.id > q.b.id ? 1 : 0));
  ctx.cache.set('beside', out);
  return out;
}

/** The stretch at each end of an edge where a sideways shift fades to nothing (its nodes stay where they are). */
export const blendLength = (e: GraphEdge): number => Math.min(30, e.len / 3);

const smoothstep = (t: number): number => {
  const v = Math.max(0, Math.min(1, t));
  return v * v * (3 - 2 * v);
};

/** A polyline with extra points so no segment is longer than `step`. */
export function densify(pts: readonly P2[], step: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i] as P2;
    const b = pts[i + 1] as P2;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  if (pts.length) out.push({ ...(pts[pts.length - 1] as P2) });
  return out;
}

export interface ShiftField {
  /** The road's points, densified, and the move of each (a vector). */
  pts: P2[];
  move: P2[];
  maxShift: number;
}

/**
 * How road `a` moves away from road `b` so the two keep `minSep` (a takes `share` of what is missing, and 2 cm more).
 * The move grows at most 1 m per SHIFT_RAMP m along the road. At an end that stays (`fixed`) it fades to nothing over
 * the end's `blend` metres; at an end whose node may move it runs on to the node. `ramp` (metres along per metre
 * sideways, from the start of a) replaces the fade at the start: a branch that leaves a split node.
 */
export function shiftField(a: GraphEdge, b: readonly P2[], minSep: number, share: number, fixed: { start: boolean; end: boolean }, blend: number, ramp = 0): ShiftField {
  const pts = densify(a.pts, 4);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push((cum[i - 1] as number) + Math.hypot((pts[i] as P2).x - (pts[i - 1] as P2).x, (pts[i] as P2).z - (pts[i - 1] as P2).z));
  const len = cum[cum.length - 1] as number;
  const last = b.length - 2;
  const size = pts.map((p) => {
    const pr = projectOn(p, b);
    // beyond the end of b: nothing beside this point
    if ((pr.i === 0 && pr.t <= 0) || (pr.i === last && pr.t >= 1)) return 0;
    const need = minSep - pr.d;
    return need <= 0 ? 0 : need * share + 0.02;
  });
  // the move spreads along the road, growing 1 m per SHIFT_RAMP m
  for (let i = 1; i < size.length; i++) size[i] = Math.max(size[i] as number, (size[i - 1] as number) - ((cum[i] as number) - (cum[i - 1] as number)) / SHIFT_RAMP);
  for (let i = size.length - 2; i >= 0; i--) size[i] = Math.max(size[i] as number, (size[i + 1] as number) - ((cum[i + 1] as number) - (cum[i] as number)) / SHIFT_RAMP);
  let maxShift = 0;
  const move = pts.map((p, i) => {
    let m = size[i] as number;
    const s = cum[i] as number;
    if (ramp > 0) m = Math.min(m, s / ramp);
    else if (fixed.start) m *= smoothstep(s / blend);
    if (fixed.end) m *= smoothstep((len - s) / blend);
    if (m < 1e-4) return { x: 0, z: 0 };
    const pr = projectOn(p, b);
    let ux = p.x - pr.x;
    let uz = p.z - pr.z;
    const ul = Math.hypot(ux, uz);
    if (ul < 1e-6) {
      const q = (pts[i + 1] ?? pts[i - 1]) as P2;
      const sgn = pts[i + 1] ? 1 : -1;
      const l = Math.hypot(q.x - p.x, q.z - p.z) || 1;
      const n = leftOf((sgn * (q.x - p.x)) / l, (sgn * (q.z - p.z)) / l);
      ux = n.x;
      uz = n.z;
    } else {
      ux /= ul;
      uz /= ul;
    }
    maxShift = Math.max(maxShift, m);
    return { x: ux * m, z: uz * m };
  });
  return { pts, move, maxShift: r3(maxShift) };
}
