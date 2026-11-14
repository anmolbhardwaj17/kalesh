// A Delaunay triangulation that can be constrained (P1-015, MAP_REPAIR.md "Terrain that fits the roads": "a
// constrained Delaunay ground with points inside the blocks"). Our own: no package (decisions.md 2026-11-12).
// Points go in one at a time (walk to the triangle, split it, flip edges until every circle is empty); segments are
// forced in afterwards by cdtsegments.ts. Coordinates are whole units (predicates.ts), so every turn test is exact
// and the structure cannot tear. A triangle stores its three vertices (turning the positive way in x, z), the
// triangle across the edge opposite each vertex, and one bit per edge: constrained. A constrained edge carries a
// label (a packed number the caller reads back); when an edge is split both halves keep it. Pure.
import { incircle, orient } from './predicates.ts';

const KEY = 4194304;

export class Cdt {
  /** Vertex positions in whole units. The first four are the corners of the box around everything. */
  readonly x: number[] = [];
  readonly z: number[] = [];
  /** A triangle each vertex belongs to. */
  readonly vt: number[] = [];
  tv: Int32Array;
  tn: Int32Array;
  tc: Uint8Array;
  nt = 0;
  /** Labels of constrained edges, keyed by the lower then the higher vertex; the caller's packed number. */
  readonly labels = new Map<number, number>();
  /** Turns a label around (as seen from the other end of the edge). */
  flipLabel: (label: number) => number = (l) => l;
  /** Adds two labels on one edge. */
  joinLabels: (a: number, b: number) => number = (a, b) => a | b;
  /** Called when a constrained edge a to b gets the new vertex v on it. */
  onSplit: ((a: number, b: number, v: number) => void) | null = null;
  /** A crossing of two constrained edges that got no vertex: the segment s to e went through v instead of (px, pz). */
  onForced: ((px: number, pz: number, v: number, s: number, e: number) => void) | null = null;
  readonly stats = { flips: 0, edgeSplits: 0, walkSteps: 0 };
  private last = 0;
  private readonly stack: number[] = [];

  constructor(minX: number, minZ: number, maxX: number, maxZ: number, expect = 1024) {
    const cap = Math.max(16, expect * 2 + 16);
    this.tv = new Int32Array(cap * 3);
    this.tn = new Int32Array(cap * 3);
    this.tc = new Uint8Array(cap);
    for (const [px, pz] of [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]] as [number, number][]) {
      this.x.push(px);
      this.z.push(pz);
      this.vt.push(0);
    }
    const a = this.newTri(0, 1, 2);
    const b = this.newTri(0, 2, 3);
    this.tn.set([-1, b, -1], a * 3);
    this.tn.set([-1, -1, a], b * 3);
  }

  private newTri(a: number, b: number, c: number): number {
    if ((this.nt + 1) * 3 > this.tv.length) {
      const grow = <T extends Int32Array | Uint8Array>(old: T, n: number): T => {
        const next = (old instanceof Int32Array ? new Int32Array(n) : new Uint8Array(n)) as T;
        next.set(old);
        return next;
      };
      this.tv = grow(this.tv, this.tv.length * 2);
      this.tn = grow(this.tn, this.tn.length * 2);
      this.tc = grow(this.tc, this.tc.length * 2);
    }
    const t = this.nt++;
    this.setTri(t, 0, a, b, c);
    this.tc[t] = 0;
    return t;
  }

  /** Writes the vertices of t starting at slot `at` (a, then b, then c the positive way round). */
  private setTri(t: number, at: number, a: number, b: number, c: number): void {
    const o = t * 3;
    this.tv[o + at] = a;
    this.tv[o + ((at + 1) % 3)] = b;
    this.tv[o + ((at + 2) % 3)] = c;
    this.vt[a] = t;
    this.vt[b] = t;
    this.vt[c] = t;
  }

  /** The slot of triangle n that looks back at t. */
  slotOf(n: number, t: number): number {
    const o = n * 3;
    return this.tn[o] === t ? 0 : this.tn[o + 1] === t ? 1 : 2;
  }

  private relink(n: number, from: number, to: number): void {
    if (n >= 0) this.tn[n * 3 + this.slotOf(n, from)] = to;
  }

  private bit(t: number, slot: number): number {
    return ((this.tc[t] as number) >> slot) & 1;
  }

  private setBits(t: number, s0: number, b0: number, s1: number, b1: number, s2: number, b2: number): void {
    this.tc[t] = (b0 << s0) | (b1 << s1) | (b2 << s2);
  }

  /** The triangle that holds a point (on its edge counts). Points must lie inside the box. */
  locate(px: number, pz: number): number {
    let t = this.last;
    const { x, z, tv, tn } = this;
    for (let guard = 0; guard < 10000000; guard++) {
      const o = t * 3;
      let moved = false;
      // the edge to try first turns with the step count, so a walk through constrained (not Delaunay) triangles cannot circle
      for (let k = 0; k < 3; k++) {
        const s = (k + guard) % 3;
        const a = tv[o + ((s + 1) % 3)] as number;
        const b = tv[o + ((s + 2) % 3)] as number;
        if (orient(x[a] as number, z[a] as number, x[b] as number, z[b] as number, px, pz) < 0) {
          const n = tn[o + s] as number;
          if (n < 0) throw new Error(`point ${px}, ${pz} lies outside the triangulation box`);
          t = n;
          moved = true;
          break;
        }
      }
      if (!moved) {
        this.last = t;
        this.stats.walkSteps += guard;
        return t;
      }
    }
    throw new Error('point location did not end');
  }

  /** Adds a point and returns its vertex: the vertex already there, or a new one (a point on an edge splits it). */
  insert(px: number, pz: number): number {
    const t = this.locate(px, pz);
    const o = t * 3;
    const { x, z, tv } = this;
    const a = tv[o] as number;
    const b = tv[o + 1] as number;
    const c = tv[o + 2] as number;
    const oa = orient(x[b] as number, z[b] as number, x[c] as number, z[c] as number, px, pz);
    const ob = orient(x[c] as number, z[c] as number, x[a] as number, z[a] as number, px, pz);
    const oc = orient(x[a] as number, z[a] as number, x[b] as number, z[b] as number, px, pz);
    if (oa === 0 && ob === 0) return c;
    if (ob === 0 && oc === 0) return a;
    if (oc === 0 && oa === 0) return b;
    if (oa === 0 || ob === 0 || oc === 0) {
      const v = this.splitEdge(t, oa === 0 ? 0 : ob === 0 ? 1 : 2, px, pz);
      if (v < 0) throw new Error('a point on an edge could not split it');
      return v;
    }
    const v = this.x.length;
    this.x.push(px);
    this.z.push(pz);
    this.vt.push(t);
    const nbc = this.tn[o] as number;
    const nca = this.tn[o + 1] as number;
    const nab = this.tn[o + 2] as number;
    const cbc = this.bit(t, 0);
    const cca = this.bit(t, 1);
    const cab = this.bit(t, 2);
    const t1 = this.newTri(b, c, v);
    const t2 = this.newTri(c, a, v);
    this.setTri(t, 0, a, b, v);
    this.tn.set([t1, t2, nab], t * 3);
    this.tn.set([t2, t, nbc], t1 * 3);
    this.tn.set([t, t1, nca], t2 * 3);
    this.relink(nbc, t, t1);
    this.relink(nca, t, t2);
    this.setBits(t, 0, 0, 1, 0, 2, cab);
    this.setBits(t1, 0, 0, 1, 0, 2, cbc);
    this.setBits(t2, 0, 0, 1, 0, 2, cca);
    this.stack.push(t, 2, t1, 2, t2, 2);
    this.legalize();
    return v;
  }

  /**
   * Puts a new vertex on the edge opposite slot i of t (the point should lie on it, or within a unit of it) and
   * returns the vertex; -1 when the point would turn a triangle inside out, or the edge is on the box.
   */
  splitEdge(t: number, i: number, px: number, pz: number): number {
    const { x, z } = this;
    const o = t * 3;
    const i1 = (i + 1) % 3;
    const i2 = (i + 2) % 3;
    const c = this.tv[o + i] as number;
    const a = this.tv[o + i1] as number;
    const b = this.tv[o + i2] as number;
    const n = this.tn[o + i] as number;
    if (n < 0) return -1;
    const j = this.slotOf(n, t);
    const j1 = (j + 1) % 3;
    const j2 = (j + 2) % 3;
    const d = this.tv[n * 3 + j] as number;
    const ok = (p: number, q: number, rx: number, rz: number): boolean => orient(x[p] as number, z[p] as number, x[q] as number, z[q] as number, rx, rz) > 0;
    // c, a, v and c, v, b and d, b, v and d, v, a must all turn the positive way
    if (!ok(c, a, px, pz) || !ok(b, c, px, pz) || !ok(d, b, px, pz) || !ok(a, d, px, pz)) return -1;
    const v = x.length;
    x.push(px);
    z.push(pz);
    this.vt.push(t);
    const nbc = this.tn[o + i1] as number;
    const nca = this.tn[o + i2] as number;
    const nad = this.tn[n * 3 + j1] as number;
    const ndb = this.tn[n * 3 + j2] as number;
    const cab = this.bit(t, i);
    const cbc = this.bit(t, i1);
    const cca = this.bit(t, i2);
    const cad = this.bit(n, j1);
    const cdb = this.bit(n, j2);
    const t2 = this.newTri(c, v, b);
    const n2 = this.newTri(d, v, a);
    // t becomes c, a, v; n becomes d, b, v
    this.setTri(t, i, c, a, v);
    this.setTri(n, j, d, b, v);
    this.tn[o + i] = n2;
    this.tn[o + i1] = t2;
    this.tn[o + i2] = nca;
    this.tn.set([n, nbc, t], t2 * 3);
    this.tn[n * 3 + j] = t2;
    this.tn[n * 3 + j1] = n2;
    this.tn[n * 3 + j2] = ndb;
    this.tn.set([t, nad, n], n2 * 3);
    this.relink(nbc, t, t2);
    this.relink(nad, n, n2);
    this.setBits(t, i, cab, i1, 0, i2, cca);
    this.setBits(t2, 0, cab, 1, cbc, 2, 0);
    this.setBits(n, j, cab, j1, 0, j2, cdb);
    this.setBits(n2, 0, cab, 1, cad, 2, 0);
    if (cab) {
      const key = a < b ? a * KEY + b : b * KEY + a;
      const lab = this.labels.get(key);
      if (lab !== undefined) {
        this.labels.delete(key);
        const fwd = a < b ? lab : this.flipLabel(lab);
        this.addLabel(a, v, fwd);
        this.addLabel(v, b, fwd);
      }
      this.onSplit?.(a, b, v);
    }
    this.stats.edgeSplits++;
    this.stack.push(t, i2, t2, 1, n, j2, n2, 1);
    this.legalize();
    return v;
  }

  /** Adds a label to the edge a to b, as seen going from a to b. */
  addLabel(a: number, b: number, label: number): void {
    const key = a < b ? a * KEY + b : b * KEY + a;
    const own = a < b ? label : this.flipLabel(label);
    const old = this.labels.get(key);
    this.labels.set(key, old === undefined ? own : this.joinLabels(old, own));
  }

  /** The label of the edge a to b as seen going from a to b, or undefined. */
  labelOf(a: number, b: number): number | undefined {
    const lab = this.labels.get(a < b ? a * KEY + b : b * KEY + a);
    return lab === undefined || a < b ? lab : this.flipLabel(lab);
  }

  /** Flips edges (never a constrained one) until the triangles on the stack are Delaunay again. The stack holds triangle, slot pairs. */
  private legalize(): void {
    const { x, z, stack } = this;
    while (stack.length) {
      const i = stack.pop() as number;
      const t = stack.pop() as number;
      const o = t * 3;
      const n = this.tn[o + i] as number;
      if (n < 0 || this.bit(t, i)) continue;
      const p = this.tv[o + i] as number;
      const a = this.tv[o + ((i + 1) % 3)] as number;
      const b = this.tv[o + ((i + 2) % 3)] as number;
      const d = this.tv[n * 3 + this.slotOf(n, t)] as number;
      if (incircle(x[p] as number, z[p] as number, x[a] as number, z[a] as number, x[b] as number, z[b] as number, x[d] as number, z[d] as number) > 0) {
        this.flip(t, i);
        stack.push(t, i, n, 0);
      }
    }
  }

  /**
   * Flips the edge opposite slot i of t. With t = p, a, b and its neighbour holding d: afterwards t = p, a, d
   * (p still in slot i) and the neighbour = p, d, b (p in slot 0). The caller checks that the four corners are convex.
   */
  flip(t: number, i: number): void {
    const o = t * 3;
    const i1 = (i + 1) % 3;
    const i2 = (i + 2) % 3;
    const n = this.tn[o + i] as number;
    const m = n * 3;
    const j = this.slotOf(n, t);
    const j1 = (j + 1) % 3;
    const j2 = (j + 2) % 3;
    const p = this.tv[o + i] as number;
    const a = this.tv[o + i1] as number;
    const b = this.tv[o + i2] as number;
    const d = this.tv[m + j] as number;
    const nbp = this.tn[o + i1] as number;
    const npa = this.tn[o + i2] as number;
    const nad = this.tn[m + j1] as number;
    const ndb = this.tn[m + j2] as number;
    const cbp = this.bit(t, i1);
    const cpa = this.bit(t, i2);
    const cad = this.bit(n, j1);
    const cdb = this.bit(n, j2);
    this.setTri(t, i, p, a, d);
    this.tn[o + i] = nad;
    this.tn[o + i1] = n;
    this.tn[o + i2] = npa;
    this.setTri(n, 0, p, d, b);
    this.tn[m] = ndb;
    this.tn[m + 1] = nbp;
    this.tn[m + 2] = t;
    this.relink(nad, n, t);
    this.relink(nbp, t, n);
    this.setBits(t, i, cad, i1, 0, i2, cpa);
    this.setBits(n, 0, cdb, 1, cbp, 2, 0);
    this.stats.flips++;
  }

  /** The triangle and slot where the edge from p to q starts (slot of p, q follows it), or null when there is no such edge. */
  findEdge(p: number, q: number): { t: number; slot: number } | null {
    const start = this.vt[p] as number;
    let t = start;
    for (let guard = 0; guard < 100000; guard++) {
      const o = t * 3;
      const k = this.tv[o] === p ? 0 : this.tv[o + 1] === p ? 1 : 2;
      if (this.tv[o + ((k + 1) % 3)] === q) return { t, slot: k };
      // on round p, the positive way: across the edge that ends in p
      t = this.tn[o + ((k + 1) % 3)] as number;
      if (t < 0 || t === start) return null;
    }
    return null;
  }

  /** Marks the existing edge a to b as constrained with a label (as seen from a to b). False when the edge is not there. */
  constrain(a: number, b: number, label: number): boolean {
    const e = this.findEdge(a, b);
    if (!e) return false;
    const slot = (e.slot + 2) % 3;
    this.tc[e.t] = (this.tc[e.t] as number) | (1 << slot);
    const n = this.tn[e.t * 3 + slot] as number;
    if (n >= 0) this.tc[n] = (this.tc[n] as number) | (1 << this.slotOf(n, e.t));
    this.addLabel(a, b, label);
    return true;
  }

  /** True when the edge opposite `slot` of t is constrained. */
  constrained(t: number, slot: number): boolean {
    return this.bit(t, slot) === 1;
  }

  /** Runs the flip stack on given triangle, slot pairs (after a segment went in). */
  relax(pairs: readonly number[]): void {
    for (const v of pairs) this.stack.push(v);
    this.legalize();
  }
}
