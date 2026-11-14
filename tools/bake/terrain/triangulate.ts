// The ground triangulation of a stage (P1-015): every collected point goes into one Delaunay triangulation, every
// segment is forced in, and then each triangle learns what it lies in by counting across the labelled edges from
// outside the stage inwards: a road (nothing is drawn: the road mesh is there), a building footprint, water, open
// land or plain ground. Because the tile lines are edges too, no triangle crosses a tile line. Hairline ground
// between two road pieces that nearly touch is dropped. Pure.
import { Cdt } from './cdt.ts';
import { insertSegment, newSegmentStats } from './cdtsegments.ts';
import type { SegmentStats } from './cdtsegments.ts';
import type { Collected, TerrainOptions } from './collect.ts';
import { CH_BUILDING, CH_OPEN, CH_OUTLINE, CH_ROAD, CH_WATER, CHANNELS, channelOf, flipLabel, joinLabels } from './labels.ts';
import { UNITS, incircleExactCalls } from './predicates.ts';

export const C_OUT = 0;
export const C_ROAD = 1;
export const C_PLOT = 2;
export const C_WATER = 3;
export const C_LAWN = 4;
export const C_GROUND = 5;
/** Ground under a centimetre wide between two road pieces: not drawn. */
export const C_DROPPED = 6;
export const CLASS_NAMES = ['outside', 'road', 'plot', 'water', 'lawn', 'ground', 'dropped'] as const;

const KEY = 4194304;

/** The road's free edge pieces after the triangulation cut them further: the road's top height at both ends of every piece. */
export class RoadEdges {
  readonly a: number[] = [];
  readonly b: number[] = [];
  readonly ya: number[] = [];
  readonly yb: number[] = [];
  readonly wall: number[] = [];
  readonly alive: number[] = [];
  private readonly at = new Map<number, number>();

  add(a: number, b: number, ya: number, yb: number, wall: number): void {
    if (a === b) return;
    const key = a * KEY + b;
    const old = this.at.get(key);
    // two faces of different levels with the same edge: the higher one is what the ground meets
    if (old !== undefined) {
      if (ya + yb > (this.ya[old] as number) + (this.yb[old] as number)) {
        this.ya[old] = ya;
        this.yb[old] = yb;
        this.wall[old] = wall;
      }
      return;
    }
    this.at.set(key, this.a.length);
    this.a.push(a);
    this.b.push(b);
    this.ya.push(ya);
    this.yb.push(yb);
    this.wall.push(wall);
    this.alive.push(1);
  }

  /** The piece from a to b (the road on its left), or -1. */
  find(a: number, b: number): number {
    return this.at.get(a * KEY + b) ?? -1;
  }

  /** Vertex v now lies on the piece from a to b, `t` of the way along. */
  split(a: number, b: number, v: number, t: number): void {
    const k = this.at.get(a * KEY + b);
    if (k === undefined) return;
    this.at.delete(a * KEY + b);
    this.alive[k] = 0;
    const ya = this.ya[k] as number;
    const yb = this.yb[k] as number;
    const yv = ya + (yb - ya) * Math.max(0, Math.min(1, t));
    this.add(a, v, ya, yv, this.wall[k] as number);
    this.add(v, b, yv, yb, this.wall[k] as number);
  }
}

export interface Triangulation {
  cdt: Cdt;
  /** Block metres of every vertex of the triangulation (a road vertex: the road mesh's own numbers). */
  vx: number[];
  vz: number[];
  road: RoadEdges;
  /** Per triangle: C_OUT to C_DROPPED. */
  cls: Uint8Array;
  stats: {
    points: number; vertices: number; triangles: number; segments: SegmentStats; flips: number; edgeSplits: number; walkSteps: number; exactCircleTests: number;
    /** Triangles reached with two different counts: 0 when every ring closes. */
    inconsistent: number;
    dropped: { components: number; triangles: number; areaM2: number };
    /** Points put inside a triangle that filled a corner between two road edges of different heights. */
    cornerPoints: number;
    /** Crossings that got no vertex (segments.forced): how far the segment bent through the nearer end (m), the worst first (block metres). */
    bent: { over1cm: number; maxM: number; list: { x: number; z: number; bendM: number }[] };
  };
  ms: Record<string, number>;
}

export function triangulate(col: Collected, opt: TerrainOptions): Triangulation {
  const ms: Record<string, number> = {};
  let clock = Date.now();
  const lap = (name: string): void => {
    const now = Date.now();
    ms[name] = now - clock;
    clock = now;
  };
  const n = col.ix.length;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, col.ix[i] as number);
    maxX = Math.max(maxX, col.ix[i] as number);
    minZ = Math.min(minZ, col.iz[i] as number);
    maxZ = Math.max(maxZ, col.iz[i] as number);
  }
  const PAD = 50 * UNITS;
  const cdt = new Cdt(minX - PAD, minZ - PAD, maxX + PAD, maxZ + PAD, n + (n >> 2));
  cdt.flipLabel = flipLabel;
  cdt.joinLabels = joinLabels;
  const exact0 = incircleExactCalls();

  // points in rows of cells, each row walked the other way: the walk to the next point stays short
  const CELL = 40 * UNITS;
  const cols = Math.ceil((maxX - minX) / CELL) + 1;
  const keys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(((col.ix[i] as number) - minX) / CELL);
    const cz = Math.floor(((col.iz[i] as number) - minZ) / CELL);
    keys[i] = cz * cols + (cz % 2 === 0 ? cx : cols - 1 - cx);
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((p, q) => (keys[p] as number) - (keys[q] as number) || p - q);
  const vid = new Int32Array(n);
  const vx: number[] = [0, 0, 0, 0];
  const vz: number[] = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    vx[k] = (cdt.x[k] as number) / UNITS;
    vz[k] = (cdt.z[k] as number) / UNITS;
  }
  for (const i of order) {
    const v = cdt.insert(col.ix[i] as number, col.iz[i] as number);
    vid[i] = v;
    vx[v] = col.ox[i] as number;
    vz[v] = col.oz[i] as number;
  }
  lap('points');

  const road = new RoadEdges();
  for (let k = 0; k < col.roadA.length; k++) road.add(vid[col.roadA[k] as number] as number, vid[col.roadB[k] as number] as number, col.roadYa[k] as number, col.roadYb[k] as number, col.roadWall[k] as number);
  cdt.onSplit = (a, b, v) => {
    if (vx[v] === undefined) {
      vx[v] = (cdt.x[v] as number) / UNITS;
      vz[v] = (cdt.z[v] as number) / UNITS;
    }
    const dx = (cdt.x[b] as number) - (cdt.x[a] as number);
    const dz = (cdt.z[b] as number) - (cdt.z[a] as number);
    const t = (((cdt.x[v] as number) - (cdt.x[a] as number)) * dx + ((cdt.z[v] as number) - (cdt.z[a] as number)) * dz) / (dx * dx + dz * dz || 1);
    road.split(a, b, v, t);
    road.split(b, a, v, 1 - t);
  };
  const bent: Triangulation['stats']['bent'] = { over1cm: 0, maxM: 0, list: [] };
  cdt.onForced = (px, pz, v) => {
    const d = Math.hypot(px - (cdt.x[v] as number), pz - (cdt.z[v] as number)) / UNITS;
    if (d > 0.01) bent.over1cm++;
    bent.maxM = Math.max(bent.maxM, d);
    bent.list.push({ x: px / UNITS, z: pz / UNITS, bendM: d });
  };
  const segStats = newSegmentStats();
  for (let k = 0; k < col.segA.length; k++) insertSegment(cdt, vid[col.segA[k] as number] as number, vid[col.segB[k] as number] as number, col.segLabel[k] as number, opt.eps, segStats);
  for (let v = vx.length; v < cdt.x.length; v++) {
    vx[v] = (cdt.x[v] as number) / UNITS;
    vz[v] = (cdt.z[v] as number) / UNITS;
  }
  lap('segments');

  // what every triangle lies in: counts carried from a corner of the box across the labelled edges
  const nt = cdt.nt;
  const w = new Int8Array(nt * CHANNELS);
  const seen = new Uint8Array(nt);
  const queue = new Int32Array(nt);
  let head = 0;
  let tail = 0;
  const first = cdt.vt[0] as number;
  seen[first] = 1;
  queue[tail++] = first;
  let inconsistent = 0;
  while (head < tail) {
    const t = queue[head++] as number;
    const o = t * 3;
    for (let i = 0; i < 3; i++) {
      const m = cdt.tn[o + i] as number;
      if (m < 0) continue;
      let lab: number | undefined;
      if (cdt.constrained(t, i)) lab = cdt.labelOf(cdt.tv[o + ((i + 1) % 3)] as number, cdt.tv[o + ((i + 2) % 3)] as number);
      if (seen[m]) {
        for (let c = 0; c < CHANNELS; c++) {
          if ((w[m * CHANNELS + c] as number) !== (w[t * CHANNELS + c] as number) - (lab === undefined ? 0 : channelOf(lab, c))) {
            inconsistent++;
            break;
          }
        }
        continue;
      }
      for (let c = 0; c < CHANNELS; c++) w[m * CHANNELS + c] = (w[t * CHANNELS + c] as number) - (lab === undefined ? 0 : channelOf(lab, c));
      seen[m] = 1;
      queue[tail++] = m;
    }
  }
  const cls = new Uint8Array(nt);
  for (let t = 0; t < nt; t++) {
    const o = t * CHANNELS;
    cls[t] = w[o + CH_OUTLINE] === 0 ? C_OUT : w[o + CH_ROAD] !== 0 ? C_ROAD : w[o + CH_BUILDING] !== 0 ? C_PLOT : w[o + CH_WATER] !== 0 ? C_WATER : w[o + CH_OPEN] !== 0 ? C_LAWN : C_GROUND;
  }
  lap('classes');

  // hairlines: ground that is under a centimetre wide on average, shut in between road pieces
  const dropped = { components: 0, triangles: 0, areaM2: 0 };
  const comp = new Int32Array(nt).fill(-1);
  const open = (t: number): boolean => cls[t] === C_GROUND || cls[t] === C_LAWN || cls[t] === C_WATER;
  const members: number[] = [];
  for (let t0 = 0; t0 < nt; t0++) {
    if (!open(t0) || comp[t0] !== -1) continue;
    members.length = 0;
    members.push(t0);
    comp[t0] = t0;
    let area = 0;
    let edge = 0;
    let roadOnly = true;
    for (let k = 0; k < members.length; k++) {
      const t = members[k] as number;
      const o = t * 3;
      const a = cdt.tv[o] as number;
      const b = cdt.tv[o + 1] as number;
      const c = cdt.tv[o + 2] as number;
      area += Math.abs(((vx[b] as number) - (vx[a] as number)) * ((vz[c] as number) - (vz[a] as number)) - ((vz[b] as number) - (vz[a] as number)) * ((vx[c] as number) - (vx[a] as number))) / 2;
      for (let i = 0; i < 3; i++) {
        const m = cdt.tn[o + i] as number;
        if (m >= 0 && open(m)) {
          if (comp[m] === -1) {
            comp[m] = t0;
            members.push(m);
          }
          continue;
        }
        const p = cdt.tv[o + ((i + 1) % 3)] as number;
        const q = cdt.tv[o + ((i + 2) % 3)] as number;
        edge += Math.hypot((vx[q] as number) - (vx[p] as number), (vz[q] as number) - (vz[p] as number));
        if (m < 0 || cls[m] !== C_ROAD) roadOnly = false;
      }
    }
    if (roadOnly && area < 0.005 * edge) {
      dropped.components++;
      dropped.triangles += members.length;
      dropped.areaM2 += area;
      for (const t of members) cls[t] = C_DROPPED;
    }
  }
  dropped.areaM2 = Math.round(dropped.areaM2 * 1000) / 1000;
  lap('hairlines');

  // a triangle that fills the corner between two road edges of different heights (a footpath end beside a
  // carriageway end) gets a point inside: then each edge has its own triangle and a small upright face closes the step
  let cornerPoints = 0;
  const grown: number[] = [];
  for (let t = 0; t < nt; t++) {
    const k = cls[t] as number;
    if (k !== C_GROUND && k !== C_LAWN && k !== C_PLOT && k !== C_WATER) continue;
    const o = t * 3;
    for (let i = 0; i < 3; i++) {
      const v = cdt.tv[o + i] as number;
      const out = road.find(cdt.tv[o + ((i + 1) % 3)] as number, v);
      const back = road.find(v, cdt.tv[o + ((i + 2) % 3)] as number);
      if (out < 0 || back < 0 || (road.wall[out] === 1 && road.wall[back] === 1) || Math.abs((road.yb[out] as number) - (road.ya[back] as number)) <= 0.002) continue;
      const a = cdt.tv[o] as number;
      const b = cdt.tv[o + 1] as number;
      const c = cdt.tv[o + 2] as number;
      const before = cdt.nt;
      const p = cdt.insert(Math.round(((cdt.x[a] as number) + (cdt.x[b] as number) + (cdt.x[c] as number)) / 3), Math.round(((cdt.z[a] as number) + (cdt.z[b] as number) + (cdt.z[c] as number)) / 3));
      if (vx[p] === undefined) {
        vx[p] = (cdt.x[p] as number) / UNITS;
        vz[p] = (cdt.z[p] as number) / UNITS;
        cornerPoints++;
      }
      // the new triangles lie in what the old one lay in: flips never cross a labelled edge
      for (let n2 = before; n2 < cdt.nt; n2++) grown.push(k);
      break;
    }
  }
  const all = new Uint8Array(cdt.nt);
  all.set(cls);
  all.set(grown, nt);
  lap('corners');
  return {
    cdt, vx, vz, road, cls: all, ms,
    stats: { points: n, vertices: cdt.x.length, triangles: cdt.nt, segments: segStats, flips: cdt.stats.flips, edgeSplits: cdt.stats.edgeSplits, walkSteps: cdt.stats.walkSteps, exactCircleTests: incircleExactCalls() - exact0, inconsistent, dropped, cornerPoints, bent: { over1cm: bent.over1cm, maxM: Math.round(bent.maxM * 10000) / 10000, list: bent.list.sort((p, q) => q.bendM - p.bendM || p.x - q.x || p.z - q.z).slice(0, 20).map((b) => ({ x: Math.round(b.x * 100) / 100, z: Math.round(b.z * 100) / 100, bendM: Math.round(b.bendM * 10000) / 10000 })) } },
  };
}
