// The numerical loop of the elevation solver (P1-013): least squares with limits, by the method of multipliers.
// The cost is a sum of w (c . x - target)^2 terms; a limit is c . x >= bound. A broken limit becomes a stiff
// spring (weight mu) whose target moves by the multiplier until the limit holds to TOL; a multiplier that reaches
// its cap stops there, so limits without a cap (grades, curves) come before limits with one (clearances).
//
// For fixed multipliers the cost with its stretched springs is convex and piecewise quadratic. One Newton step
// solves it for the springs stretched now (one sparse factor, sparse.ts); the step is halved until the cost does
// not rise, so the set of springs cannot cycle, and when the set is the same before and after a step that step is
// the exact answer. Then the multipliers move and the next round begins. The matrix pattern holds every term and
// every limit from the start, so only values change. No random step: the same input gives the same bits. Pure.
import { SparseSpd } from './sparse.ts';

export interface Term {
  idx: number[];
  c: number[];
  target: number;
  w: number;
}

export interface Limit<K extends string = string> {
  kind: K;
  idx: number[];
  c: number[];
  /** c . x >= bound */
  bound: number;
  mu: number;
  /** The multiplier stops here (Infinity: the limit is held whatever it takes). */
  cap: number;
  lam: number;
  /** Not in force yet (limits of the second phase). */
  enabled: boolean;
}

export interface LoopOptions {
  /** Largest multiplier step, in the limit's own measure, at which the loop stops. */
  tol: number;
  maxRounds: number;
  innerRounds: number;
}

export interface LoopResult {
  x: Float64Array;
  rounds: number;
  factorisations: number;
  converged: boolean;
  matrix: number;
  factor: number;
  /** Milliseconds to order the unknowns and build the matrix. */
  orderMs: number;
}

export const dot = (l: { idx: number[]; c: number[] }, v: Float64Array): number => {
  let sum = 0;
  for (let p = 0; p < l.idx.length; p++) sum += (l.c[p] as number) * (v[l.idx[p] as number] as number);
  return sum;
};

/**
 * Minimises the terms under the limits. `secondPhase` is called once, when the first phase has converged: it may
 * enable limits (and set their bounds) from the answer so far and returns how many it enabled.
 */
export function solveWithLimits<K extends string>(n: number, terms: readonly Term[], limits: Limit<K>[], secondPhase: (x: Float64Array) => number, opts: LoopOptions): LoopResult {
  const clock = (globalThis as unknown as { performance: { now(): number } }).performance;
  const t0 = clock.now();
  const A = new SparseSpd(n, (function* () {
    for (const t of terms) yield t.idx;
    for (const l of limits) yield l.idx;
  })());
  const rhs0 = new Float64Array(n);
  for (const t of terms) {
    A.addTerm(t.idx, t.c, t.w);
    for (let p = 0; p < t.idx.length; p++) rhs0[t.idx[p] as number] = (rhs0[t.idx[p] as number] as number) + t.w * (t.c[p] as number) * t.target;
  }
  const base = A.snapshot();
  const orderMs = Math.round(clock.now() - t0);
  /** How far a limit's spring is stretched at v: positive when the limit (with its multiplier) is broken there. */
  const stretch = (l: Limit<K>, v: Float64Array): number => l.bound + l.lam / l.mu - dot(l, v);
  /** The cost with every stretched spring: what one step makes smaller. */
  const merit = (v: Float64Array): number => {
    let sum = 0;
    for (const t of terms) {
      const r = dot(t, v) - t.target;
      sum += t.w * r * r;
    }
    for (const l of limits) {
      if (!l.enabled) continue;
      const r = stretch(l, v);
      if (r > 0) sum += l.mu * r * r;
    }
    return sum;
  };
  let factorisations = 0;
  /** The least cost for the springs in `on` (pulled both ways). */
  const solveFor = (on: readonly Limit<K>[]): Float64Array => {
    A.restore(base);
    const rhs = rhs0.slice();
    for (const l of on) {
      A.addTerm(l.idx, l.c, l.mu);
      const pull = l.mu * l.bound + l.lam;
      for (let p = 0; p < l.idx.length; p++) rhs[l.idx[p] as number] = (rhs[l.idx[p] as number] as number) + (l.c[p] as number) * pull;
    }
    A.factor();
    factorisations++;
    return A.solve(rhs);
  };
  const stretched = (v: Float64Array): Limit<K>[] => limits.filter((l) => l.enabled && stretch(l, v) > 0);
  const same = (p: readonly Limit<K>[], q: readonly Limit<K>[]): boolean => p.length === q.length && p.every((l, i) => l === q[i]);
  /** The least cost for the multipliers as they stand. */
  const settle = (from: Float64Array): Float64Array => {
    let v = from;
    for (let step = 0; step < opts.innerRounds; step++) {
      const on = stretched(v);
      const next = solveFor(on);
      if (same(stretched(next), on)) return next;
      const before = merit(v);
      let alpha = 1;
      let trial = next;
      while (alpha > 1e-3 && merit(trial) > before * (1 + 1e-12)) {
        alpha /= 2;
        trial = new Float64Array(n);
        for (let i = 0; i < n; i++) trial[i] = (v[i] as number) + alpha * ((next[i] as number) - (v[i] as number));
      }
      v = trial;
    }
    return v;
  };
  let x = settle(solveFor([]));
  let rounds = 0;
  let converged = false;
  let phase = 0;
  for (; rounds < opts.maxRounds; rounds++) {
    // the multipliers move by what is still broken; a capped one stops at its cap
    let moved = 0;
    for (const l of limits) {
      if (!l.enabled) continue;
      const lam = Math.min(l.cap, Math.max(0, l.lam + l.mu * (l.bound - dot(l, x))));
      moved = Math.max(moved, Math.abs(lam - l.lam) / l.mu);
      l.lam = lam;
    }
    if (moved < opts.tol) {
      if (phase === 1 || secondPhase(x) === 0) {
        converged = true;
        break;
      }
      phase = 1;
    }
    x = settle(x);
  }
  return { x, rounds, factorisations, converged, matrix: A.stats.matrix, factor: A.stats.factor, orderMs };
}
