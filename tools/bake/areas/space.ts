// Space helpers of the area generator (P2-009): a 1 m flag raster of the stage (roads, decks, water, open land,
// landmark zones, walkways) for the many point tests of the frontage scan and the wall exposure test, and an index of
// rings with numeric cell keys. The raster is a quick answer with up to a cell of error; anything that must be exact
// (a new ring against the road faces) is checked again with the clipper (repair/clear.ts onRoadM2). Pure.
import type { Box2, P2 } from '../geom.ts';
import { pointInRing } from '../geom.ts';

/** Raster flags. */
export const F_ROAD = 1; // a road face the ground meets
export const F_DECK = 2; // any road face (also the decks over the ground)
export const F_WATER = 4;
export const F_OPEN = 8; // parks, lawns, pitches and other open land of the map
export const F_ZONE = 16; // a landmark zone or pad
export const F_WALK = 32; // paved walking areas
export const F_OUT = 64; // outside the stage outline

export class FlagRaster {
  readonly x0: number;
  readonly z0: number;
  readonly w: number;
  readonly h: number;
  readonly cell: number;
  readonly data: Uint8Array;

  constructor(box: Box2, cell = 1) {
    this.cell = cell;
    this.x0 = Math.floor(box.minX);
    this.z0 = Math.floor(box.minZ);
    this.w = Math.ceil((box.maxX - this.x0) / cell) + 1;
    this.h = Math.ceil((box.maxZ - this.z0) / cell) + 1;
    this.data = new Uint8Array(this.w * this.h);
  }

  /** Flags of the cell holding a point (F_OUT outside the raster). */
  at(x: number, z: number): number {
    const i = Math.floor((x - this.x0) / this.cell);
    const j = Math.floor((z - this.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return F_OUT;
    return this.data[j * this.w + i] as number;
  }

  private set(i: number, j: number, flag: number): void {
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return;
    this.data[j * this.w + i]! |= flag;
  }

  /** Marks every cell whose centre is inside the ring, and (with `edges`) every cell an edge of the ring passes. */
  fill(ring: readonly P2[], flag: number, edges = true): void {
    const n = ring.length;
    if (n < 3) return;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of ring) {
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const c = this.cell;
    const j0 = Math.max(0, Math.floor((minZ - this.z0) / c));
    const j1 = Math.min(this.h - 1, Math.floor((maxZ - this.z0) / c));
    const xs: number[] = [];
    for (let j = j0; j <= j1; j++) {
      const z = this.z0 + (j + 0.5) * c;
      xs.length = 0;
      for (let k = 0; k < n; k++) {
        const a = ring[k] as P2;
        const b = ring[(k + 1) % n] as P2;
        if (a.z > z !== b.z > z) xs.push(a.x + ((z - a.z) * (b.x - a.x)) / (b.z - a.z));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil(((xs[k] as number) - this.x0) / c - 0.5));
        const i1 = Math.min(this.w - 1, Math.floor(((xs[k + 1] as number) - this.x0) / c - 0.5));
        for (let i = i0; i <= i1; i++) this.data[j * this.w + i]! |= flag;
      }
    }
    if (!edges) return;
    for (let k = 0; k < n; k++) {
      const a = ring[k] as P2;
      const b = ring[(k + 1) % n] as P2;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.ceil(len / (c * 0.5)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        this.set(Math.floor((a.x + (b.x - a.x) * t - this.x0) / c), Math.floor((a.z + (b.z - a.z) * t - this.z0) / c), flag);
      }
    }
  }

  /** Marks every cell whose centre is outside the ring. */
  outside(ring: readonly P2[], flag: number): void {
    const tmp = new FlagRaster({ minX: this.x0, minZ: this.z0, maxX: this.x0 + (this.w - 1) * this.cell, maxZ: this.z0 + (this.h - 1) * this.cell }, this.cell);
    tmp.fill(ring, 1, false);
    for (let k = 0; k < this.data.length; k++) if (!tmp.data[k]) this.data[k]! |= flag;
  }
}

export interface IndexedRing {
  id: string;
  ring: readonly P2[];
  box: Box2;
}

export function ringBox(ring: readonly P2[]): Box2 {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, minZ, maxX, maxZ };
}

/** Rings by 16 m cell, numeric keys. */
export class RingIndex<T extends IndexedRing = IndexedRing> {
  private readonly cells = new Map<number, T[]>();
  private readonly cell: number;
  constructor(cell = 16) {
    this.cell = cell;
  }

  private key(i: number, j: number): number {
    return (i + 32768) * 65536 + (j + 32768);
  }

  add(item: T): void {
    const c = this.cell;
    for (let i = Math.floor(item.box.minX / c); i <= Math.floor(item.box.maxX / c); i++) {
      for (let j = Math.floor(item.box.minZ / c); j <= Math.floor(item.box.maxZ / c); j++) {
        const k = this.key(i, j);
        const list = this.cells.get(k);
        if (list) list.push(item);
        else this.cells.set(k, [item]);
      }
    }
  }

  /** The ring holding a point (not `skip`), or null. */
  hit(x: number, z: number, skip?: T | null): T | null {
    const list = this.cells.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!list) return null;
    for (const r of list) {
      if (r === skip) continue;
      const b = r.box;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      if (pointInRing({ x, z }, r.ring)) return r;
    }
    return null;
  }

  /** Every ring whose box meets the box grown by pad, once each. */
  near(box: Box2, pad = 0): T[] {
    const c = this.cell;
    const seen = new Set<T>();
    for (let i = Math.floor((box.minX - pad) / c); i <= Math.floor((box.maxX + pad) / c); i++) {
      for (let j = Math.floor((box.minZ - pad) / c); j <= Math.floor((box.maxZ + pad) / c); j++) {
        const list = this.cells.get(this.key(i, j));
        if (!list) continue;
        for (const r of list) if (r.box.minX - pad <= box.maxX && r.box.maxX + pad >= box.minX && r.box.minZ - pad <= box.maxZ && r.box.maxZ + pad >= box.minZ) seen.add(r);
      }
    }
    return [...seen];
  }
}

/** The smallest distance between two rings' edges (0 when they cross or touch); stops early under `stop`. */
export function ringGap(a: readonly P2[], b: readonly P2[], stop = 0): number {
  let best = Infinity;
  const seg = (p: P2, a0: P2, a1: P2): number => {
    const dx = a1.x - a0.x;
    const dz = a1.z - a0.z;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a0.x) * dx + (p.z - a0.z) * dz) / l2)) : 0;
    return Math.hypot(p.x - (a0.x + dx * t), p.z - (a0.z + dz * t));
  };
  for (let i = 0; i < a.length; i++) {
    const p = a[i] as P2;
    for (let j = 0; j < b.length; j++) {
      const d = seg(p, b[j] as P2, b[(j + 1) % b.length] as P2);
      if (d < best) {
        best = d;
        if (best <= stop) return best;
      }
    }
  }
  for (let j = 0; j < b.length; j++) {
    const p = b[j] as P2;
    for (let i = 0; i < a.length; i++) {
      const d = seg(p, a[i] as P2, a[(i + 1) % a.length] as P2);
      if (d < best) {
        best = d;
        if (best <= stop) return best;
      }
    }
  }
  return best;
}

/** The oriented box of a ring along its longest edge: centre, unit long axis, half sizes (a >= b). */
export function orientedBox(ring: readonly P2[]): { cx: number; cz: number; ux: number; uz: number; a: number; b: number } {
  // the direction that gives the smallest box among the edge directions (the ring's own walls)
  let best = { cx: 0, cz: 0, ux: 1, uz: 0, a: 0, b: 0, area: Infinity };
  const n = ring.length;
  for (let k = 0; k < n; k++) {
    const p = ring[k] as P2;
    const q = ring[(k + 1) % n] as P2;
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    if (len < 0.5) continue;
    const ux = (q.x - p.x) / len;
    const uz = (q.z - p.z) / len;
    let s0 = Infinity;
    let s1 = -Infinity;
    let t0 = Infinity;
    let t1 = -Infinity;
    for (const r of ring) {
      const s = r.x * ux + r.z * uz;
      const t = -r.x * uz + r.z * ux;
      if (s < s0) s0 = s;
      if (s > s1) s1 = s;
      if (t < t0) t0 = t;
      if (t > t1) t1 = t;
    }
    const area = (s1 - s0) * (t1 - t0);
    if (area < best.area - 1e-9) {
      const sc = (s0 + s1) / 2;
      const tc = (t0 + t1) / 2;
      const long = s1 - s0 >= t1 - t0;
      best = { cx: sc * ux - tc * uz, cz: sc * uz + tc * ux, ux: long ? ux : -uz, uz: long ? uz : ux, a: Math.max(s1 - s0, t1 - t0) / 2, b: Math.min(s1 - s0, t1 - t0) / 2, area };
    }
  }
  return { cx: best.cx, cz: best.cz, ux: best.ux, uz: best.uz, a: best.a, b: best.b };
}
