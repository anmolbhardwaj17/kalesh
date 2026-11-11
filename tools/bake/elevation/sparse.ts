// Sparse solver for the elevation system (P1-013): A x = b with A symmetric positive definite and mostly empty
// (a knot only meets its neighbours along the road, the knots across a joint and the knots of a road it crosses).
// The prototype's dense Cholesky is cubic in the knot count; this one orders the unknowns by minimum degree (the
// knot with the fewest neighbours left goes first, so the factor stays sparse) and factors column by column along
// the elimination tree (the up-looking Cholesky of Davis, "Direct Methods for Sparse Linear Systems", ch. 4).
//
// The pattern is fixed when the matrix is made: every pair of unknowns that can ever meet in a term or a limit.
// Values are then set and factored as often as the active limits change; one factor serves any number of right
// hand sides. No random step anywhere: the same input gives the same bits. Pure.

/** A min-heap of (degree, node) packed in one number; stale entries are skipped by the caller. */
class Heap {
  private readonly a: number[] = [];
  get size(): number {
    return this.a.length;
  }
  push(v: number): void {
    const a = this.a;
    let i = a.length;
    a.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((a[p] as number) <= v) break;
      a[i] = a[p] as number;
      i = p;
    }
    a[i] = v;
  }
  pop(): number {
    const a = this.a;
    const top = a[0] as number;
    const v = a.pop() as number;
    const n = a.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && (a[c + 1] as number) < (a[c] as number)) c++;
        if ((a[c] as number) >= v) break;
        a[i] = a[c] as number;
        i = c;
      }
      a[i] = v;
    }
    return top;
  }
}

const PACK = 4194304; // 2^22 nodes at most

/**
 * Minimum degree order on the graph of the pattern: returns the nodes in elimination order. `adj` is used up
 * (eliminating a node joins its neighbours to each other, as the factor will). Ties go to the lower node number.
 */
export function minDegreeOrder(adj: Set<number>[]): Int32Array {
  const n = adj.length;
  if (n >= PACK) throw new Error(`sparse: ${n} unknowns is more than the order can pack`);
  const order = new Int32Array(n);
  const done = new Uint8Array(n);
  const heap = new Heap();
  for (let i = 0; i < n; i++) heap.push((adj[i] as Set<number>).size * PACK + i);
  let k = 0;
  while (k < n) {
    const top = heap.pop();
    const v = top % PACK;
    const deg = (top - v) / PACK;
    const nb = adj[v] as Set<number>;
    if (done[v] || nb.size !== deg) continue;
    if (deg >= n - k - 1 && deg > 64) {
      // what is left is one clique: any order gives the same fill
      for (let i = 0; i < n; i++) if (!done[i]) order[k++] = i;
      break;
    }
    order[k++] = v;
    done[v] = 1;
    const list = [...nb];
    for (const a of list) (adj[a] as Set<number>).delete(v);
    for (let i = 0; i < list.length; i++) {
      const sa = adj[list[i] as number] as Set<number>;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j] as number;
        if (!sa.has(b)) {
          sa.add(b);
          (adj[b] as Set<number>).add(list[i] as number);
        }
      }
    }
    for (const a of list) heap.push((adj[a] as Set<number>).size * PACK + a);
    nb.clear();
  }
  return order;
}

export class SparseSpd {
  readonly n: number;
  /** Position of every unknown in the elimination order. */
  private readonly inv: Int32Array;
  private readonly order: Int32Array;
  // the upper triangle of the ordered matrix by columns (row <= column), rows sorted
  private readonly cp: Int32Array;
  private readonly ci: Int32Array;
  private readonly cx: Float64Array;
  // the factor L by columns, the diagonal first in each
  private readonly parent: Int32Array;
  private readonly lp: Int32Array;
  private readonly li: Int32Array;
  private readonly lx: Float64Array;
  /** Pivots that had to be lifted to stay positive in the last factor (0 for a sound system). */
  lifted = 0;

  /** `cliques`: every group of unknowns that meet in one term or limit (all pairs inside a group are in the pattern). */
  constructor(n: number, cliques: Iterable<readonly number[]>) {
    this.n = n;
    const adj: Set<number>[] = [];
    for (let i = 0; i < n; i++) adj.push(new Set());
    for (const q of cliques) {
      for (let i = 0; i < q.length; i++) {
        for (let j = i + 1; j < q.length; j++) {
          const a = q[i] as number;
          const b = q[j] as number;
          if (a === b) continue;
          (adj[a] as Set<number>).add(b);
          (adj[b] as Set<number>).add(a);
        }
      }
    }
    // the pattern in the new order, before the order uses the sets up
    const pairs: number[][] = adj.map((s) => [...s]);
    this.order = minDegreeOrder(adj);
    const inv = new Int32Array(n);
    for (let k = 0; k < n; k++) inv[this.order[k] as number] = k;
    this.inv = inv;
    const cols: number[][] = [];
    for (let k = 0; k < n; k++) cols.push([k]);
    for (let i = 0; i < n; i++) {
      const pi = inv[i] as number;
      for (const j of pairs[i] as number[]) {
        const pj = inv[j] as number;
        if (pi < pj) (cols[pj] as number[]).push(pi);
      }
    }
    const cp = new Int32Array(n + 1);
    for (let k = 0; k < n; k++) cp[k + 1] = (cp[k] as number) + (cols[k] as number[]).length;
    const ci = new Int32Array(cp[n] as number);
    for (let k = 0; k < n; k++) {
      const c = (cols[k] as number[]).sort((a, b) => a - b);
      ci.set(c, cp[k] as number);
    }
    this.cp = cp;
    this.ci = ci;
    this.cx = new Float64Array(ci.length);
    // elimination tree
    const parent = new Int32Array(n).fill(-1);
    const ancestor = new Int32Array(n).fill(-1);
    for (let k = 0; k < n; k++) {
      for (let p = cp[k] as number; p < (cp[k + 1] as number); p++) {
        let i = ci[p] as number;
        while (i !== -1 && i < k) {
          const next = ancestor[i] as number;
          ancestor[i] = k;
          if (next === -1) parent[i] = k;
          i = next;
        }
      }
    }
    this.parent = parent;
    // column counts of L: one pass over the row patterns
    const count = new Int32Array(n).fill(1);
    const flag = new Int32Array(n).fill(-1);
    for (let k = 0; k < n; k++) {
      flag[k] = k;
      for (let p = cp[k] as number; p < (cp[k + 1] as number); p++) {
        for (let i = ci[p] as number; flag[i] !== k; i = parent[i] as number) {
          count[i] = (count[i] as number) + 1;
          flag[i] = k;
        }
      }
    }
    const lp = new Int32Array(n + 1);
    for (let k = 0; k < n; k++) lp[k + 1] = (lp[k] as number) + (count[k] as number);
    this.lp = lp;
    this.li = new Int32Array(lp[n] as number);
    this.lx = new Float64Array(lp[n] as number);
  }

  /** Stored values of the upper triangle and of the factor. */
  get stats(): { n: number; matrix: number; factor: number } {
    return { n: this.n, matrix: this.ci.length, factor: this.li.length };
  }

  /** A copy of the matrix values (to put back with `restore` before the next set of limits is added). */
  snapshot(): Float64Array {
    return this.cx.slice();
  }

  restore(values: Float64Array): void {
    this.cx.set(values);
  }

  clear(): void {
    this.cx.fill(0);
  }

  private slot(i: number, j: number): number {
    let a = this.inv[i] as number;
    let b = this.inv[j] as number;
    if (a > b) {
      const t = a;
      a = b;
      b = t;
    }
    let lo = this.cp[b] as number;
    let hi = (this.cp[b + 1] as number) - 1;
    const ci = this.ci;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = ci[mid] as number;
      if (r === a) return mid;
      if (r < a) lo = mid + 1;
      else hi = mid - 1;
    }
    throw new Error(`sparse: (${i}, ${j}) is not in the pattern`);
  }

  /** Adds w (c . x)^2 to the quadratic form: w c[p] c[q] on every pair of the term's unknowns. */
  addTerm(idx: readonly number[], c: readonly number[], w: number): void {
    const cx = this.cx;
    for (let p = 0; p < idx.length; p++) {
      const wp = w * (c[p] as number);
      for (let q = p; q < idx.length; q++) {
        const s = this.slot(idx[p] as number, idx[q] as number);
        // an unknown named twice in one term meets itself off the diagonal loop: both orders land in one slot
        cx[s] = (cx[s] as number) + (idx[p] === idx[q] && p !== q ? 2 : 1) * wp * (c[q] as number);
      }
    }
  }

  /** Factors the current values (A = L L'). */
  factor(): void {
    const { n, cp, ci, cx, parent, lp, li, lx } = this;
    const next = new Int32Array(n);
    const x = new Float64Array(n);
    const stack = new Int32Array(n);
    const flag = new Int32Array(n).fill(-1);
    this.lifted = 0;
    for (let k = 0; k < n; k++) next[k] = lp[k] as number;
    for (let k = 0; k < n; k++) {
      // the pattern of row k of L, in an order that suits the tree
      let top = n;
      flag[k] = k;
      for (let p = cp[k] as number; p < (cp[k + 1] as number); p++) {
        let i = ci[p] as number;
        x[i] = cx[p] as number;
        let len = 0;
        for (; flag[i] !== k; i = parent[i] as number) {
          stack[len++] = i;
          flag[i] = k;
        }
        while (len > 0) stack[--top] = stack[--len] as number;
      }
      let d = x[k] as number;
      x[k] = 0;
      for (; top < n; top++) {
        const i = stack[top] as number;
        const lki = (x[i] as number) / (lx[lp[i] as number] as number);
        x[i] = 0;
        const end = next[i] as number;
        for (let p = (lp[i] as number) + 1; p < end; p++) {
          const r = li[p] as number;
          x[r] = (x[r] as number) - (lx[p] as number) * lki;
        }
        d -= lki * lki;
        li[end] = k;
        lx[end] = lki;
        next[i] = end + 1;
      }
      if (!(d > 1e-12)) {
        d = 1e-12;
        this.lifted++;
      }
      const at = next[k] as number;
      li[at] = k;
      lx[at] = Math.sqrt(d);
      next[k] = at + 1;
    }
  }

  /** Solves A x = b with the last factor. */
  solve(b: Float64Array): Float64Array {
    const { n, order, lp, li, lx } = this;
    const y = new Float64Array(n);
    for (let k = 0; k < n; k++) y[k] = b[order[k] as number] as number;
    for (let j = 0; j < n; j++) {
      const v = (y[j] as number) / (lx[lp[j] as number] as number);
      y[j] = v;
      for (let p = (lp[j] as number) + 1; p < (lp[j + 1] as number); p++) {
        const r = li[p] as number;
        y[r] = (y[r] as number) - (lx[p] as number) * v;
      }
    }
    for (let j = n - 1; j >= 0; j--) {
      let v = y[j] as number;
      for (let p = (lp[j] as number) + 1; p < (lp[j + 1] as number); p++) v -= (lx[p] as number) * (y[li[p] as number] as number);
      y[j] = v / (lx[lp[j] as number] as number);
    }
    const x = new Float64Array(n);
    for (let k = 0; k < n; k++) x[order[k] as number] = y[k] as number;
    return x;
  }
}
