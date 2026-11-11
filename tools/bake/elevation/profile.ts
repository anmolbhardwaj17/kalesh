// Height profiles of the elevation solver (P1-013). Strips that run on into each other are one chain, and a chain
// has one profile: knots at even spacing along it (about 12 m), with the height between them a quadratic B-spline
// of the knot heights. Three things follow from that shape, exactly and at every point, not only at the knots:
//   the grade lies between the grades of the two knot intervals around it, so a limit on every interval holds everywhere;
//   the vertical curvature is the second difference of three knots over the spacing squared, constant between knot
//   midpoints, so a limit on every knot holds everywhere;
//   two strips that meet at a joint read the same chain at the same place: no step, and no kink either.
// A chain end at a junction or a dead end runs straight through its last knot. Where a road splits, the chain goes
// on into one branch; the other branch starts on the chain's own height and tangent there (its first two knots are
// not unknowns, they follow the chain), so it leaves the main line without a step or a kink. Every height is
// therefore a weighted sum of free unknowns plus a constant (an Expr). Pure.
import type { Joint, Strip, StripEnd } from '../roads/model.ts';
import { maxGrade, minCurveRadius } from './limits.ts';

/** sum of c[i] * x[idx[i]] plus k, over the free unknowns of the system. */
export interface Expr {
  idx: number[];
  c: number[];
  k: number;
}

export interface ChainPart {
  strip: number;
  /** The chain runs against the strip's station order. */
  reversed: boolean;
  /** Chain metres where the part begins. */
  x0: number;
  len: number;
}

export interface Chain {
  parts: ChainPart[];
  length: number;
  /** Knot intervals and their length. */
  m: number;
  d: number;
  /** Number of the first knot among all knots; a chain has m + 1 knots, a closed one m. */
  knot0: number;
  loop: boolean;
  /** Largest grade of every knot interval, and largest curvature (1 / radius) at every knot. */
  grade: Float64Array;
  curve: Float64Array;
}

export const endId = (strip: number, end: StripEnd): number => strip * 2 + (end === 'start' ? 0 : 1);

/** Adds parts[i].s times parts[i].e, merging unknowns named more than once. */
export function combine(parts: readonly { e: Expr; s: number }[]): Expr {
  const idx: number[] = [];
  const c: number[] = [];
  let k = 0;
  for (const { e, s } of parts) {
    k += e.k * s;
    for (let i = 0; i < e.idx.length; i++) {
      const v = e.idx[i] as number;
      const at = idx.indexOf(v);
      if (at >= 0) c[at] = (c[at] as number) + (e.c[i] as number) * s;
      else {
        idx.push(v);
        c.push((e.c[i] as number) * s);
      }
    }
  }
  return { idx, c, k };
}

export const evalExpr = (e: Expr, x: Float64Array): number => {
  let v = e.k;
  for (let i = 0; i < e.idx.length; i++) v += (e.c[i] as number) * (x[e.idx[i] as number] as number);
  return v;
};

interface Raw {
  ids: number[];
  w: number[];
  k: number;
}

export interface ProfileOptions {
  /** Aim for this many metres between knots. */
  spacing: number;
}

export class Profiles {
  readonly chains: Chain[] = [];
  /** Per strip: its chain and its part there. */
  readonly where: { chain: number; part: number }[] = [];
  /** Per strip: metres from station 0 to every station. */
  readonly pos: Float64Array[];
  /** Free unknowns (knots that do not follow another chain). */
  free = 0;
  readonly counts = { knots: 0, following: 0, loops: 0, cycles: 0, branches: 0 };
  private readonly defs: (Raw | null)[] = [];
  private readonly varOf: number[] = [];
  private readonly expanded: (Expr | null)[] = [];

  constructor(strips: readonly Strip[], joints: readonly Joint[], opts: ProfileOptions) {
    this.pos = strips.map((s) => {
      const p = new Float64Array(s.st.length);
      for (let i = 1; i < s.st.length; i++) p[i] = (p[i - 1] as number) + Math.hypot((s.st[i] as { x: number }).x - (s.st[i - 1] as { x: number }).x, (s.st[i] as { z: number }).z - (s.st[i - 1] as { z: number }).z);
      return p;
    });
    const lenOf = (si: number): number => Math.max(0.05, (this.pos[si] as Float64Array)[(this.pos[si] as Float64Array).length - 1] as number);
    // strip ends that meet
    const parent: number[] = [];
    for (let i = 0; i < strips.length * 2; i++) parent.push(i);
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i] as number] as number;
        i = parent[i] as number;
      }
      return i;
    };
    const jointsAt = new Map<number, number>();
    for (const j of joints) {
      const a = endId(j.a.strip, j.a.end);
      const b = endId(j.b.strip, j.b.end);
      parent[find(a)] = find(b);
      jointsAt.set(a, (jointsAt.get(a) ?? 0) + 1);
      jointsAt.set(b, (jointsAt.get(b) ?? 0) + 1);
    }
    const groups = new Map<number, number[]>();
    for (const e of [...jointsAt.keys()].sort((a, b) => a - b)) {
      const r = find(e);
      const g = groups.get(r);
      if (g) g.push(e);
      else groups.set(r, [e]);
    }
    // which two ends of a group the chain runs through; the rest are branches that follow it
    const link = new Map<number, number>();
    const branchOf = new Map<number, number>();
    const heading = (e: number, into: boolean): { x: number; z: number } => {
      const s = strips[e >> 1] as Strip;
      const st = ((e & 1) === 0 ? s.st[0] : s.st[s.st.length - 1]) as { nx: number; nz: number };
      // the tangent along the station order is (-nz, nx); into the joint from an end, out of it from a start
      const sign = ((e & 1) === 1) === into ? 1 : -1;
      return { x: -st.nz * sign, z: st.nx * sign };
    };
    for (const g of groups.values()) {
      if (g.length === 2) {
        link.set(g[0] as number, g[1] as number);
        link.set(g[1] as number, g[0] as number);
        continue;
      }
      let trunk = g[0] as number;
      for (const e of g) if ((jointsAt.get(e) ?? 0) > (jointsAt.get(trunk) ?? 0)) trunk = e;
      const ts = strips[trunk >> 1] as Strip;
      const th = heading(trunk, true);
      const score = (e: number): number => {
        const s = strips[e >> 1] as Strip;
        const h = heading(e, false);
        const turn = Math.acos(Math.max(-1, Math.min(1, th.x * h.x + th.z * h.z)));
        return (s.link !== ts.link ? 100 : 0) + (s.cls !== ts.cls ? 10 : 0) + turn;
      };
      let main = -1;
      for (const e of g) if (e !== trunk && (main < 0 || score(e) < score(main) - 1e-9)) main = e;
      link.set(trunk, main);
      link.set(main, trunk);
      for (const e of g) if (e !== trunk && e !== main) branchOf.set(e, trunk);
    }
    // chains
    const visited = new Uint8Array(strips.length);
    for (let s = 0; s < strips.length; s++) this.where.push({ chain: -1, part: -1 });
    for (let s = 0; s < strips.length; s++) {
      if (visited[s]) continue;
      let head = { strip: s, reversed: false };
      let loop = false;
      const seen = new Set([s]);
      for (;;) {
        const o = link.get(endId(head.strip, head.reversed ? 'end' : 'start'));
        if (o === undefined) break;
        if (seen.has(o >> 1)) {
          loop = true;
          head = { strip: s, reversed: false };
          break;
        }
        head = { strip: o >> 1, reversed: (o & 1) === 0 };
        seen.add(o >> 1);
      }
      const parts: ChainPart[] = [];
      let x = 0;
      let cur = head;
      for (;;) {
        visited[cur.strip] = 1;
        this.where[cur.strip] = { chain: this.chains.length, part: parts.length };
        const len = lenOf(cur.strip);
        parts.push({ strip: cur.strip, reversed: cur.reversed, x0: x, len });
        x += len;
        const o = link.get(endId(cur.strip, cur.reversed ? 'start' : 'end'));
        if (o === undefined || visited[o >> 1]) break;
        cur = { strip: o >> 1, reversed: (o & 1) === 1 };
      }
      this.chains.push({ parts, length: x, m: 1, d: x, knot0: 0, loop, grade: new Float64Array(0), curve: new Float64Array(0) });
      if (loop) this.counts.loops++;
    }
    // knots
    const headEnd = (c: Chain): number => endId((c.parts[0] as ChainPart).strip, (c.parts[0] as ChainPart).reversed ? 'end' : 'start');
    const tailEnd = (c: Chain): number => {
      const p = c.parts[c.parts.length - 1] as ChainPart;
      return endId(p.strip, p.reversed ? 'start' : 'end');
    };
    const needAt = (e: number): number => (branchOf.has(e) ? 2 : 0);
    let raw = 0;
    for (const c of this.chains) {
      const need = c.loop ? 0 : needAt(headEnd(c)) + needAt(tailEnd(c));
      c.m = Math.max(c.loop ? 3 : 1, Math.round(c.length / opts.spacing), need - 1);
      c.d = c.length / c.m;
      c.knot0 = raw;
      raw += c.loop ? c.m : c.m + 1;
      c.grade = new Float64Array(c.m).fill(Infinity);
      c.curve = new Float64Array(c.m + 1).fill(Infinity);
      for (const p of c.parts) {
        const s = strips[p.strip] as Strip;
        const g = maxGrade(s.cls, s.link);
        const k = 1 / minCurveRadius(s.cls, s.link);
        const eps = 1e-9 * c.d;
        // the grade at a point blends the two knot intervals around its nearest knot: both take the part's limit
        const lo = c.loop ? 0 : Math.max(0, Math.round((p.x0 + eps) / c.d) - 1);
        const hi = c.loop ? c.m - 1 : Math.min(c.m - 1, Math.round((p.x0 + p.len - eps) / c.d));
        for (let j = lo; j <= hi; j++) c.grade[j] = Math.min(c.grade[j] as number, g);
        // the curve around knot i spans half an interval each way
        for (let i = c.loop ? 0 : Math.max(0, Math.floor((p.x0 + eps) / c.d + 0.5)); i <= c.m && (c.loop || (i - 0.5) * c.d < p.x0 + p.len - eps); i++) c.curve[i] = Math.min(c.curve[i] as number, k);
      }
    }
    this.counts.knots = raw;
    for (let i = 0; i < raw; i++) {
      this.defs.push(null);
      this.varOf.push(-1);
      this.expanded.push(null);
    }
    // branches: the first two knots follow the chain they leave
    const endX = (e: number): number => {
      const w = this.where[e >> 1] as { chain: number; part: number };
      const p = (this.chains[w.chain] as Chain).parts[w.part] as ChainPart;
      const at = (e & 1) === 0 ? 0 : p.len;
      return p.reversed ? p.x0 + p.len - at : p.x0 + at;
    };
    for (const c of this.chains) {
      if (c.loop) continue;
      for (const [e, first, second] of [[headEnd(c), c.knot0, c.knot0 + 1], [tailEnd(c), c.knot0 + c.m, c.knot0 + c.m - 1]] as const) {
        const trunk = branchOf.get(e);
        if (trunk !== undefined) {
          const tc = (this.where[trunk >> 1] as { chain: number }).chain;
          const xj = endX(trunk);
          const away = xj > endX(trunk ^ 1) ? 1 : -1;
          const h = this.rawAt(tc, xj);
          const g = this.rawSlopeAt(tc, xj);
          this.defs[first] = h;
          const ids = h.ids.slice();
          const w = h.w.slice();
          g.ids.forEach((id, i) => {
            const at = ids.indexOf(id);
            const v = (g.w[i] as number) * away * c.d;
            if (at >= 0) w[at] = (w[at] as number) + v;
            else {
              ids.push(id);
              w.push(v);
            }
          });
          this.defs[second] = { ids, w, k: 0 };
          this.counts.following += 2;
          this.counts.branches++;
        }
      }
    }
    for (let i = 0; i < raw; i++) if (!this.defs[i]) this.varOf[i] = this.free++;
    const state = new Uint8Array(raw);
    const expand = (i: number): Expr => {
      const done = this.expanded[i];
      if (done) return done;
      const def = this.defs[i];
      if (!def || state[i] === 1) {
        // a knot that would follow itself through other chains (two tiny roads that branch off each other) is left free
        if (def) {
          this.defs[i] = null;
          this.varOf[i] = this.free++;
          this.counts.cycles++;
        }
        const e = { idx: [this.varOf[i] as number], c: [1], k: 0 };
        this.expanded[i] = e;
        return e;
      }
      state[i] = 1;
      const e = combine(def.ids.map((id, n) => ({ e: expand(id), s: def.w[n] as number })));
      e.k += def.k;
      state[i] = 2;
      this.expanded[i] = this.expanded[i] ?? e;
      return this.expanded[i] as Expr;
    };
    for (let i = 0; i < raw; i++) expand(i);
  }

  private knotId(c: Chain, i: number): number {
    return c.knot0 + (c.loop ? ((i % c.m) + c.m) % c.m : i);
  }

  /** The height at chain metres x as weights on at most three knots. */
  private rawAt(ci: number, x: number): Raw {
    const c = this.chains[ci] as Chain;
    const t = x / c.d;
    const i = c.loop ? Math.round(t) : Math.max(0, Math.min(c.m, Math.round(t)));
    if (!c.loop && (i === 0 || c.m === 1)) return { ids: [c.knot0, c.knot0 + 1], w: [1 - t, t], k: 0 };
    if (!c.loop && i === c.m) return { ids: [c.knot0 + c.m - 1, c.knot0 + c.m], w: [c.m - t, t - (c.m - 1)], k: 0 };
    const u = t - i;
    return { ids: [this.knotId(c, i - 1), this.knotId(c, i), this.knotId(c, i + 1)], w: [((0.5 - u) * (0.5 - u)) / 2, 0.75 - u * u, ((0.5 + u) * (0.5 + u)) / 2], k: 0 };
  }

  /** The grade at chain metres x (rise per metre towards larger x) as weights on knots. */
  private rawSlopeAt(ci: number, x: number): Raw {
    const c = this.chains[ci] as Chain;
    const t = x / c.d;
    const i = c.loop ? Math.round(t) : Math.max(0, Math.min(c.m, Math.round(t)));
    if (!c.loop && (i === 0 || c.m === 1)) return { ids: [c.knot0, c.knot0 + 1], w: [-1 / c.d, 1 / c.d], k: 0 };
    if (!c.loop && i === c.m) return { ids: [c.knot0 + c.m - 1, c.knot0 + c.m], w: [-1 / c.d, 1 / c.d], k: 0 };
    const u = t - i;
    return { ids: [this.knotId(c, i - 1), this.knotId(c, i), this.knotId(c, i + 1)], w: [-(0.5 - u) / c.d, (-2 * u) / c.d, (0.5 + u) / c.d], k: 0 };
  }

  /** Knot i of a chain over the free unknowns. */
  knot(ci: number, i: number): Expr {
    return this.expanded[this.knotId(this.chains[ci] as Chain, i)] as Expr;
  }

  /** The height at chain metres x over the free unknowns. */
  at(ci: number, x: number): Expr {
    const r = this.rawAt(ci, x);
    return combine(r.ids.map((id, n) => ({ e: this.expanded[id] as Expr, s: r.w[n] as number })));
  }

  /** Chain metres of a station. */
  xOf(strip: number, station: number): { chain: number; x: number } {
    const w = this.where[strip] as { chain: number; part: number };
    const p = (this.chains[w.chain] as Chain).parts[w.part] as ChainPart;
    const at = (this.pos[strip] as Float64Array)[station] as number;
    return { chain: w.chain, x: p.reversed ? p.x0 + p.len - at : p.x0 + at };
  }

  /** The height at a place between station i and i + 1 of a strip (t from 0 to 1) over the free unknowns. */
  station(strip: number, station: number, t = 0): Expr {
    const a = this.xOf(strip, station);
    if (t === 0) return this.at(a.chain, a.x);
    const b = this.xOf(strip, station + 1);
    return this.at(a.chain, a.x + (b.x - a.x) * t);
  }

  /** The height of every knot for a solution of the free unknowns. */
  knotValues(x: Float64Array): Float64Array {
    const out = new Float64Array(this.expanded.length);
    for (let i = 0; i < out.length; i++) out[i] = evalExpr(this.expanded[i] as Expr, x);
    return out;
  }

  /** The height at a station from the knot heights. */
  heightAt(knots: Float64Array, strip: number, station: number): number {
    const a = this.xOf(strip, station);
    const r = this.rawAt(a.chain, a.x);
    let v = 0;
    for (let n = 0; n < r.ids.length; n++) v += (r.w[n] as number) * (knots[r.ids[n] as number] as number);
    return v;
  }
}
