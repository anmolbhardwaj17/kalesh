// Elevation solver (ARCH_OPTIONS EL1, MAP_REPAIR.md "Elevation solver"): one height per knot of the site graph,
// solved together, so two roads can never disagree where they meet. A knot is a station every 12 m or so along
// a strip; strip ends that meet share one knot, a junction has one knot for its centre.
//
// It is a least squares problem with limits. The cost keeps ground roads near the ground model, keeps every
// profile smooth (bending) and keeps the two carriageways of a street level with each other. The limits are the
// grade per class and the clearance where one road passes over another or over a junction. A bridge tag only
// frees a stretch from the ground; layer only says which road is above; neither sets a height. The limits are
// enforced by an active set: a limit that is broken is added as a stiff spring at its bound and dropped again
// when the spring starts to pull the wrong way. Abutments are then simply where a profile leaves the ground.
import type { P2 } from '../geom.ts';
import { segCross } from './curve.ts';
import { DECK_DEPTH, HEADROOM, maxGrade } from './model.ts';
import type { Joint, Strip, StripEnd } from './model.ts';

export interface SolveJunction {
  centre: P2;
  /** Reach of the junction surface from its centre (metres). */
  radius: number;
  arms: { strip: number; end: StripEnd }[];
  layer: number;
}

export interface SolveInput {
  strips: Strip[];
  joints: Joint[];
  junctions: SolveJunction[];
  /** Pairs of strip numbers that are the two carriageways of one street. */
  pairs: [number, number][];
  ground: (x: number, z: number) => number;
  knotSpacing?: number;
}

export interface SolveReport {
  knots: number;
  iterations: number;
  crossings: number;
  sameLayerCrossings: number;
  junctionCrossings: number;
  activeClearance: number;
  activeGrade: number;
  ms: number;
}

export interface SolveResult {
  junctionHeights: number[];
  report: SolveReport;
}

const W_GROUND = 1;
const W_BEND = 4e5;
const W_SLOPE = 5;
const W_PAIR = 2;
const W_JUNCTION = 50;
const MU = 1e5;
/** What a deck must be above the road under it: headroom, the deck itself and a margin for the deck's width. */
export const CLEARANCE = HEADROOM + DECK_DEPTH + 0.3;

/** Solves A x = b for a symmetric positive definite A (dense Cholesky). A is overwritten. */
export function solveSPD(a: Float64Array, b: Float64Array, n: number): Float64Array {
  for (let j = 0; j < n; j++) {
    let d = a[j * n + j] as number;
    for (let k = 0; k < j; k++) d -= (a[j * n + k] as number) * (a[j * n + k] as number);
    if (d <= 1e-12) d = 1e-12;
    const l = Math.sqrt(d);
    a[j * n + j] = l;
    for (let i = j + 1; i < n; i++) {
      let s = a[i * n + j] as number;
      const ri = i * n;
      const rj = j * n;
      for (let k = 0; k < j; k++) s -= (a[ri + k] as number) * (a[rj + k] as number);
      a[ri + j] = s / l;
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i] as number;
    for (let k = 0; k < i; k++) s -= (a[i * n + k] as number) * (y[k] as number);
    y[i] = s / (a[i * n + i] as number);
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i] as number;
    for (let k = i + 1; k < n; k++) s -= (a[k * n + i] as number) * (x[k] as number);
    x[i] = s / (a[i * n + i] as number);
  }
  return x;
}

interface Term {
  idx: number[];
  c: number[];
  target: number;
  w: number;
}

interface Limit {
  kind: 'clearance' | 'grade';
  idx: number[];
  c: number[];
  /** The limit is c . h >= bound. */
  bound: number;
  active: boolean;
}

/** Sets h and g on every station and returns the junction centre heights. */
export function solveElevation(input: SolveInput): SolveResult {
  const t0 = Date.now();
  const { strips, joints } = input;
  const spacing = input.knotSpacing ?? 12;
  for (const s of strips) for (const st of s.st) st.g = input.ground(st.x, st.z);

  // knots of every strip, as station indices
  const knotIdx: number[][] = strips.map((s) => {
    const n = s.st.length;
    const len = Math.abs((s.st[n - 1] as { s: number }).s - (s.st[0] as { s: number }).s);
    const k = Math.max(1, Math.round(spacing / Math.max(0.5, len / Math.max(1, n - 1))));
    const out: number[] = [];
    for (let i = 0; i < n - 1; i += k) out.push(i);
    if (out.length > 1 && n - 1 - (out[out.length - 1] as number) < k / 2) out.pop();
    out.push(n - 1);
    return out;
  });
  // strip ends that meet share one variable
  const parent: number[] = [];
  const endId = (strip: number, end: StripEnd): number => strip * 2 + (end === 'start' ? 0 : 1);
  for (let i = 0; i < strips.length * 2; i++) parent.push(i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i] as number] as number;
      i = parent[i] as number;
    }
    return i;
  };
  for (const j of joints) parent[find(endId(j.a.strip, j.a.end))] = find(endId(j.b.strip, j.b.end));
  let count = 0;
  const endVar = new Map<number, number>();
  const vars: number[][] = strips.map((_, si) => {
    const ks = knotIdx[si] as number[];
    return ks.map((_k, i) => {
      if (i === 0 || i === ks.length - 1) {
        const root = find(endId(si, i === 0 ? 'start' : 'end'));
        let v = endVar.get(root);
        if (v === undefined) {
          v = count++;
          endVar.set(root, v);
        }
        return v;
      }
      return count++;
    });
  });
  const junctionVar = input.junctions.map(() => count++);
  const n = count;

  const stationDist = (si: number, i: number, j: number): number => {
    const st = (strips[si] as Strip).st;
    let d = 0;
    for (let k = Math.min(i, j); k < Math.max(i, j); k++) d += Math.hypot((st[k + 1] as P2).x - (st[k] as P2).x, (st[k + 1] as P2).z - (st[k] as P2).z);
    return Math.max(0.05, d);
  };
  const terms: Term[] = [];
  const limits: Limit[] = [];
  const bend = (a: number, b: number, c: number, d1: number, d2: number): void => {
    if (a === b || b === c || a === c) return;
    const k = 2 / (d1 + d2);
    terms.push({ idx: [a, b, c], c: [k / d1, -k * (1 / d1 + 1 / d2), k / d2], target: 0, w: (W_BEND * (d1 + d2)) / 2 });
  };
  strips.forEach((s, si) => {
    const ks = knotIdx[si] as number[];
    const vs = vars[si] as number[];
    const g = maxGrade(s.cls, s.link);
    for (let i = 0; i < ks.length; i++) {
      const st = s.st[ks[i] as number] as Strip['st'][number];
      const trib = (i > 0 ? stationDist(si, ks[i - 1] as number, ks[i] as number) : 0) / 2 + (i + 1 < ks.length ? stationDist(si, ks[i] as number, ks[i + 1] as number) : 0) / 2;
      terms.push({ idx: [vs[i] as number], c: [1], target: st.g, w: (st.bridge ? 0 : W_GROUND) * trib + 1e-4 });
      if (i + 1 < ks.length && vs[i] !== vs[i + 1]) {
        const d = stationDist(si, ks[i] as number, ks[i + 1] as number);
        terms.push({ idx: [vs[i] as number, vs[i + 1] as number], c: [-1 / d, 1 / d], target: 0, w: W_SLOPE * d });
        limits.push({ kind: 'grade', idx: [vs[i] as number, vs[i + 1] as number], c: [-1, 1], bound: -g * d, active: false });
        limits.push({ kind: 'grade', idx: [vs[i] as number, vs[i + 1] as number], c: [1, -1], bound: -g * d, active: false });
      }
      if (i > 0 && i + 1 < ks.length) bend(vs[i - 1] as number, vs[i] as number, vs[i + 1] as number, stationDist(si, ks[i - 1] as number, ks[i] as number), stationDist(si, ks[i] as number, ks[i + 1] as number));
    }
  });
  // bending across joints: the knot next to each end, through the shared knot
  const neighbour = (strip: number, end: StripEnd): { v: number; d: number } | null => {
    const ks = knotIdx[strip] as number[];
    const vs = vars[strip] as number[];
    if (ks.length < 2) return null;
    return end === 'start' ? { v: vs[1] as number, d: stationDist(strip, ks[0] as number, ks[1] as number) } : { v: vs[vs.length - 2] as number, d: stationDist(strip, ks[ks.length - 2] as number, ks[ks.length - 1] as number) };
  };
  const endKnot = (strip: number, end: StripEnd): number => (end === 'start' ? ((vars[strip] as number[])[0] as number) : ((vars[strip] as number[])[(vars[strip] as number[]).length - 1] as number));
  for (const j of joints) {
    const a = neighbour(j.a.strip, j.a.end);
    const b = neighbour(j.b.strip, j.b.end);
    if (a && b) bend(a.v, endKnot(j.a.strip, j.a.end), b.v, a.d, b.d);
  }
  // junctions: every arm's cut and the centre lie on one gentle surface
  input.junctions.forEach((jn, ji) => {
    const cv = junctionVar[ji] as number;
    for (const arm of jn.arms) {
      const s = strips[arm.strip] as Strip;
      const st = (arm.end === 'start' ? s.st[0] : s.st[s.st.length - 1]) as Strip['st'][number];
      const d = Math.max(2, Math.hypot(st.x - jn.centre.x, st.z - jn.centre.z));
      const v = endKnot(arm.strip, arm.end);
      terms.push({ idx: [v, cv], c: [-1 / d, 1 / d], target: 0, w: W_JUNCTION * d });
      limits.push({ kind: 'grade', idx: [v, cv], c: [-1, 1], bound: -0.05 * d, active: false });
      limits.push({ kind: 'grade', idx: [v, cv], c: [1, -1], bound: -0.05 * d, active: false });
      const nb = neighbour(arm.strip, arm.end);
      if (nb) bend(nb.v, v, cv, nb.d, d);
    }
    terms.push({ idx: [cv], c: [1], target: input.ground(jn.centre.x, jn.centre.z), w: W_GROUND * 4 });
  });
  // the two carriageways of one street stay level with each other
  for (const [pa, pb] of input.pairs) {
    const sa = strips[pa] as Strip;
    const sb = strips[pb] as Strip;
    (knotIdx[pa] as number[]).forEach((k, i) => {
      const p = sa.st[k] as Strip['st'][number];
      let best = -1;
      let bestD = 30;
      (knotIdx[pb] as number[]).forEach((k2, i2) => {
        const q = sb.st[k2] as Strip['st'][number];
        const d = Math.hypot(p.x - q.x, p.z - q.z);
        if (d < bestD && q.bridge === p.bridge) {
          bestD = d;
          best = i2;
        }
      });
      if (best >= 0) terms.push({ idx: [(vars[pa] as number[])[i] as number, (vars[pb] as number[])[best] as number], c: [1, -1], target: 0, w: W_PAIR });
    });
  }

  // a height along a strip as weights on its two nearest knots
  const expr = (si: number, station: number, frac: number): { idx: number[]; c: number[] } => {
    const ks = knotIdx[si] as number[];
    const vs = vars[si] as number[];
    const pos = station + frac;
    let i = 0;
    while (i + 2 < ks.length && (ks[i + 1] as number) <= pos) i++;
    if (ks.length === 1) return { idx: [vs[0] as number], c: [1] };
    const t = Math.max(0, Math.min(1, (pos - (ks[i] as number)) / Math.max(1e-9, (ks[i + 1] as number) - (ks[i] as number))));
    return { idx: [vs[i] as number, vs[i + 1] as number], c: [1 - t, t] };
  };
  // clearance where one strip passes over another
  const joined = new Set<string>();
  for (const j of joints) joined.add(`${Math.min(j.a.strip, j.b.strip)},${Math.max(j.a.strip, j.b.strip)}`);
  for (const jn of input.junctions) for (const a of jn.arms) for (const b of jn.arms) if (a.strip < b.strip) joined.add(`${a.strip},${b.strip}`);
  let crossings = 0;
  let sameLayer = 0;
  const boxes = strips.map((s) => {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const p of s.st) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    return { minX, minZ, maxX, maxZ };
  });
  for (let a = 0; a < strips.length; a++) {
    for (let b = a + 1; b < strips.length; b++) {
      if (joined.has(`${a},${b}`)) continue;
      const ba = boxes[a] as { minX: number; minZ: number; maxX: number; maxZ: number };
      const bb = boxes[b] as { minX: number; minZ: number; maxX: number; maxZ: number };
      if (ba.minX > bb.maxX || bb.minX > ba.maxX || ba.minZ > bb.maxZ || bb.minZ > ba.maxZ) continue;
      const sa = (strips[a] as Strip).st;
      const sb = (strips[b] as Strip).st;
      for (let i = 0; i + 1 < sa.length; i++) {
        for (let j = 0; j + 1 < sb.length; j++) {
          const x = segCross(sa[i] as P2, sa[i + 1] as P2, sb[j] as P2, sb[j + 1] as P2);
          // a crossing exactly on a station belongs to the segment that starts there
          if (!x || x.t >= 1 - 1e-9 || x.u >= 1 - 1e-9) continue;
          const la = (sa[i] as Strip['st'][number]).layer;
          const lb = (sb[j] as Strip['st'][number]).layer;
          if (la === lb) {
            sameLayer++;
            continue;
          }
          crossings++;
          const up = la > lb ? expr(a, i, x.t) : expr(b, j, x.u);
          const low = la > lb ? expr(b, j, x.u) : expr(a, i, x.t);
          limits.push({ kind: 'clearance', idx: [...up.idx, ...low.idx], c: [...up.c, ...low.c.map((v) => -v)], bound: CLEARANCE, active: false });
        }
      }
    }
  }
  // clearance where a strip passes over a junction
  let junctionCrossings = 0;
  input.junctions.forEach((jn, ji) => {
    const mine = new Set(jn.arms.map((a) => a.strip));
    strips.forEach((s, si) => {
      if (mine.has(si)) return;
      let hit = false;
      s.st.forEach((st, i) => {
        if (st.layer <= jn.layer || Math.hypot(st.x - jn.centre.x, st.z - jn.centre.z) > jn.radius) return;
        const e = expr(si, i, 0);
        limits.push({ kind: 'clearance', idx: [...e.idx, junctionVar[ji] as number], c: [...e.c, -1], bound: CLEARANCE, active: false });
        hit = true;
      });
      if (hit) junctionCrossings++;
    });
  });

  // active set loop
  let h: Float64Array = new Float64Array(n);
  let iterations = 0;
  const value = (l: Limit, x: Float64Array): number => l.idx.reduce((s, v, k) => s + (l.c[k] as number) * (x[v] as number), 0);
  for (; iterations < 40; iterations++) {
    const a = new Float64Array(n * n);
    const b = new Float64Array(n);
    const add = (idx: number[], c: number[], target: number, w: number): void => {
      for (let p = 0; p < idx.length; p++) {
        const ip = idx[p] as number;
        b[ip] = (b[ip] as number) + w * (c[p] as number) * target;
        for (let q = 0; q < idx.length; q++) {
          const at = ip * n + (idx[q] as number);
          a[at] = (a[at] as number) + w * (c[p] as number) * (c[q] as number);
        }
      }
    };
    for (const t of terms) add(t.idx, t.c, t.target, t.w);
    for (const l of limits) if (l.active) add(l.idx, l.c, l.bound + (l.kind === 'clearance' ? 0.02 : 0), l.kind === 'clearance' ? MU : MU / 10);
    h = solveSPD(a, b, n);
    let changed = 0;
    for (const l of limits) {
      const v = value(l, h);
      const target = l.bound + (l.kind === 'clearance' ? 0.02 : 0);
      if (!l.active && v < l.bound - 1e-4) {
        l.active = true;
        changed++;
      } else if (l.active && v > target + 1e-3) {
        // the spring pulls down: the limit is not needed any more
        l.active = false;
        changed++;
      }
    }
    if (changed === 0) break;
  }

  // station heights: a cubic through the knots of each strip
  strips.forEach((s, si) => {
    const ks = knotIdx[si] as number[];
    const hs = (vars[si] as number[]).map((v) => h[v] as number);
    const pos: number[] = [0];
    for (let i = 1; i < s.st.length; i++) pos.push((pos[i - 1] as number) + Math.hypot((s.st[i] as P2).x - (s.st[i - 1] as P2).x, (s.st[i] as P2).z - (s.st[i - 1] as P2).z));
    const kp = ks.map((k) => pos[k] as number);
    const slope = (i: number): number => {
      if (ks.length === 1) return 0;
      if (i === 0) return ((hs[1] as number) - (hs[0] as number)) / Math.max(1e-6, (kp[1] as number) - (kp[0] as number));
      if (i === ks.length - 1) return ((hs[i] as number) - (hs[i - 1] as number)) / Math.max(1e-6, (kp[i] as number) - (kp[i - 1] as number));
      return ((hs[i + 1] as number) - (hs[i - 1] as number)) / Math.max(1e-6, (kp[i + 1] as number) - (kp[i - 1] as number));
    };
    let seg = 0;
    s.st.forEach((st, i) => {
      if (ks.length === 1) {
        st.h = hs[0] as number;
        return;
      }
      while (seg + 2 < ks.length && (ks[seg + 1] as number) <= i) seg++;
      const x0 = kp[seg] as number;
      const x1 = kp[seg + 1] as number;
      const d = Math.max(1e-6, x1 - x0);
      const t = Math.max(0, Math.min(1, ((pos[i] as number) - x0) / d));
      const t2 = t * t;
      const t3 = t2 * t;
      st.h = (2 * t3 - 3 * t2 + 1) * (hs[seg] as number) + (t3 - 2 * t2 + t) * d * slope(seg) + (-2 * t3 + 3 * t2) * (hs[seg + 1] as number) + (t3 - t2) * d * slope(seg + 1);
    });
  });
  return {
    junctionHeights: junctionVar.map((v) => h[v] as number),
    report: {
      knots: n, iterations: iterations + 1, crossings, sameLayerCrossings: sameLayer, junctionCrossings,
      activeClearance: limits.filter((l) => l.active && l.kind === 'clearance').length, activeGrade: limits.filter((l) => l.active && l.kind === 'grade').length, ms: Date.now() - t0,
    },
  };
}

/**
 * Marks structures after the solve: a station more than 2 m above the ground is on a structure, and the structure
 * runs on along the road, both ways, until the road is back within 0.6 m of the ground: those ends are the
 * abutments. Above 3 m the structure is a deck on piers, below it a walled ramp. Returns the abutments.
 */
export function markStructures(strips: Strip[], joints: Joint[]): { strip: number; station: number; x: number; z: number; hag: number }[] {
  const on = strips.map((s) => s.st.map((st) => st.h - st.g > 2));
  const touch = (s: Strip, i: number): boolean => (s.st[i] as Strip['st'][number]).h - (s.st[i] as Strip['st'][number]).g > 0.6;
  for (let pass = 0; pass < 50; pass++) {
    let changed = false;
    strips.forEach((s, si) => {
      const o = on[si] as boolean[];
      for (let i = 1; i < o.length; i++) if (o[i - 1] && !o[i] && touch(s, i)) o[i] = changed = true;
      for (let i = o.length - 2; i >= 0; i--) if (o[i + 1] && !o[i] && touch(s, i)) o[i] = changed = true;
    });
    for (const j of joints) {
      const ia = j.a.end === 'start' ? 0 : (on[j.a.strip] as boolean[]).length - 1;
      const ib = j.b.end === 'start' ? 0 : (on[j.b.strip] as boolean[]).length - 1;
      const a = (on[j.a.strip] as boolean[])[ia] as boolean;
      const b = (on[j.b.strip] as boolean[])[ib] as boolean;
      if (a !== b) {
        (on[j.a.strip] as boolean[])[ia] = (on[j.b.strip] as boolean[])[ib] = true;
        changed = true;
      }
    }
    if (!changed) break;
  }
  const abutments: { strip: number; station: number; x: number; z: number; hag: number }[] = [];
  strips.forEach((s, si) => {
    const o = on[si] as boolean[];
    s.st.forEach((st, i) => {
      const hag = st.h - st.g;
      st.structure = o[i] ? (hag > 3 ? 2 : 1) : 0;
      st.edgeRaise = 0;
      if (o[i] && ((i > 0 && !o[i - 1]) || (i + 1 < o.length && !o[i + 1]))) abutments.push({ strip: si, station: i, x: st.x, z: st.z, hag });
    });
  });
  return abutments;
}
