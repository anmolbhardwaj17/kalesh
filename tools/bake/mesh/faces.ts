// The top surface of the road mesh as plan faces (P1-014): every lane quad of every strip, every junction surface
// and raised corner band is one polygon over shared vertices. Vertices are welded in plan (the lane model is rounded
// to the millimetre), so two faces that meet share their edge's two vertex numbers: the watertight check, the T joint
// repair (conform.ts) and the ground cut (P1-015) read edges, not coordinates. Corners carry the top height and the lane
// UV. Pure.

export const LANE_KINDS = ['drive', 'parking', 'gore', 'kerb', 'footpath', 'planter', 'median', 'junction', 'band'] as const;
export type FaceKind = (typeof LANE_KINDS)[number];
/** How the ground meets a face: 0 at its edge at the edge's own height, 1 at the foot (or top) of a wall, 2 not at all (a deck, a tunnel). */
export const CUT_EDGE = 0;
export const CUT_WALL = 1;
export const CUT_NONE = 2;

/** Vertices closer than this in plan are one vertex (m): the lane model's rounding. */
export const WELD_M = 0.001;

export interface Corner {
  x: number;
  z: number;
  /** Top height. */
  y: number;
  u?: number;
  v?: number;
}

export class FaceSet {
  readonly vx: number[] = [];
  readonly vz: number[] = [];
  private readonly cells = new Map<number, number>();

  // faces: where their corners start in the pools, how many, and what they are
  readonly start: number[] = [];
  readonly len: number[] = [];
  /** Strip number, or strips.length + junction number. */
  readonly piece: number[] = [];
  readonly kind: number[] = [];
  readonly cut: number[] = [];
  /** Carriageway height under the face (without the raise), averaged over its corners. */
  readonly hb: number[] = [];
  readonly raise: number[] = [];
  /** A strip face: its first station and its lane; -1 for junction faces. */
  readonly station: number[] = [];
  readonly lane: number[] = [];
  /** Level key for the overlap proof: faces on different sheets may lie over each other. */
  readonly sheet: number[] = [];

  // corner pools
  readonly ids: number[] = [];
  readonly ys: number[] = [];
  readonly us: number[] = [];
  readonly vs: number[] = [];

  get faces(): number {
    return this.start.length;
  }

  private key(ix: number, iz: number): number {
    return (ix + 16777216) * 33554432 + (iz + 16777216);
  }

  /** The vertex at a plan point: an existing one within the weld distance, or a new one. */
  vertex(x: number, z: number): number {
    const fx = x / WELD_M;
    const fz = z / WELD_M;
    const ix = Math.round(fx);
    const iz = Math.round(fz);
    let id = this.cells.get(this.key(ix, iz));
    if (id !== undefined) return id;
    // two copies of one vertex can round to neighbouring millimetres: look there before making a new one
    const nx = Math.abs(fx - ix) > 0.3 ? ix + Math.sign(fx - ix) : ix;
    const nz = Math.abs(fz - iz) > 0.3 ? iz + Math.sign(fz - iz) : iz;
    if (nx !== ix || nz !== iz) {
      for (const k of [this.key(nx, iz), this.key(ix, nz), this.key(nx, nz)]) {
        id = this.cells.get(k);
        if (id !== undefined) return id;
      }
    }
    id = this.vx.length;
    this.cells.set(this.key(ix, iz), id);
    this.vx.push(x);
    this.vz.push(z);
    return id;
  }

  /** The vertex at a plan point, or -1 when none is there. */
  find(x: number, z: number): number {
    const fx = x / WELD_M;
    const fz = z / WELD_M;
    const ix = Math.round(fx);
    const iz = Math.round(fz);
    const nx = Math.abs(fx - ix) > 0.3 ? ix + Math.sign(fx - ix) : ix;
    const nz = Math.abs(fz - iz) > 0.3 ? iz + Math.sign(fz - iz) : iz;
    for (const k of [this.key(ix, iz), this.key(nx, iz), this.key(ix, nz), this.key(nx, nz)]) {
      const id = this.cells.get(k);
      if (id !== undefined) return id;
    }
    return -1;
  }

  /** The nearest vertex within `r` metres of a plan point (a few millimetres at most), or -1. */
  nearest(x: number, z: number, r: number): number {
    const cx = Math.round(x / WELD_M);
    const cz = Math.round(z / WELD_M);
    const n = Math.ceil(r / WELD_M);
    let best = -1;
    let bd = r;
    for (let i = cx - n; i <= cx + n; i++) {
      for (let j = cz - n; j <= cz + n; j++) {
        const id = this.cells.get(this.key(i, j));
        if (id === undefined) continue;
        const d = Math.hypot((this.vx[id] as number) - x, (this.vz[id] as number) - z);
        if (d <= bd) {
          bd = d;
          best = id;
        }
      }
    }
    return best;
  }

  /**
   * Adds a face; corners in either turning sense (stored with positive shoelace area in x, z), or with `asGiven`
   * only in the stored sense (-2 when it turns the other way). Corners that weld to the one before are dropped.
   * Returns the face number, or -1 when fewer than three corners are left.
   */
  add(corners: readonly Corner[], meta: { piece: number; kind: FaceKind; cut: number; raise: number; sheet: number; station?: number; lane?: number }, asGiven = false): number {
    const ids: number[] = [];
    const keep: number[] = [];
    for (let k = 0; k < corners.length; k++) {
      const c = corners[k] as Corner;
      const id = this.vertex(c.x, c.z);
      if (ids.length && ids[ids.length - 1] === id) continue;
      ids.push(id);
      keep.push(k);
    }
    while (ids.length > 1 && ids[0] === ids[ids.length - 1]) {
      ids.pop();
      keep.pop();
    }
    if (ids.length < 3) return -1;
    let area = 0;
    for (let k = 0; k < ids.length; k++) {
      const a = ids[k] as number;
      const b = ids[(k + 1) % ids.length] as number;
      area += (this.vx[a] as number) * (this.vz[b] as number) - (this.vx[b] as number) * (this.vz[a] as number);
    }
    if (Math.abs(area) < 1e-9) return -1;
    // a face that must already turn the stored way and does not is inside out: a fold
    if (asGiven && area < 0) return -2;
    const n = ids.length;
    const flip = area < 0;
    const f = this.start.length;
    this.start.push(this.ids.length);
    this.len.push(n);
    this.piece.push(meta.piece);
    this.kind.push(LANE_KINDS.indexOf(meta.kind));
    this.cut.push(meta.cut);
    this.raise.push(meta.raise);
    this.station.push(meta.station ?? -1);
    this.lane.push(meta.lane ?? -1);
    this.sheet.push(meta.sheet);
    let hb = 0;
    for (let j = 0; j < n; j++) {
      const k = flip ? n - 1 - j : j;
      const c = corners[keep[k] as number] as Corner;
      this.ids.push(ids[k] as number);
      this.ys.push(c.y);
      this.us.push(c.u ?? 0);
      this.vs.push(c.v ?? 0);
      hb += c.y;
    }
    this.hb.push(hb / n - meta.raise);
    return f;
  }

  /** Puts new corners into the edge that starts at corner `at` of a face (vertex ids with their position along the edge, 0 to 1). */
  insert(face: number, at: number, extra: readonly { id: number; t: number }[]): void {
    const s = this.start[face] as number;
    const n = this.len[face] as number;
    const a = s + at;
    const b = s + ((at + 1) % n);
    const sorted = extra.slice().sort((p, q) => p.t - q.t);
    const base = this.ids.length;
    for (let k = 0; k < n; k++) {
      this.push(this.ids[s + k] as number, this.ys[s + k] as number, this.us[s + k] as number, this.vs[s + k] as number);
      if (k !== at) continue;
      for (const e of sorted) {
        const mix = (list: readonly number[]): number => (list[a] as number) + ((list[b] as number) - (list[a] as number)) * e.t;
        this.push(e.id, mix(this.ys), mix(this.us), mix(this.vs));
      }
    }
    this.start[face] = base;
    this.len[face] = n + sorted.length;
  }

  private push(id: number, y: number, u: number, v: number): void {
    this.ids.push(id);
    this.ys.push(y);
    this.us.push(u);
    this.vs.push(v);
  }

  /** Twice the signed area of a face in plan (positive for every stored face). */
  area(face: number): number {
    const s = this.start[face] as number;
    const n = this.len[face] as number;
    let a = 0;
    for (let k = 0; k < n; k++) {
      const p = this.ids[s + k] as number;
      const q = this.ids[s + ((k + 1) % n)] as number;
      a += (this.vx[p] as number) * (this.vz[q] as number) - (this.vx[q] as number) * (this.vz[p] as number);
    }
    return a / 2;
  }

  /** The plan ring of a face as [x, z] pairs. */
  ring(face: number): [number, number][] {
    const s = this.start[face] as number;
    const n = this.len[face] as number;
    const out: [number, number][] = [];
    for (let k = 0; k < n; k++) {
      const id = this.ids[s + k] as number;
      out.push([this.vx[id] as number, this.vz[id] as number]);
    }
    return out;
  }
}
