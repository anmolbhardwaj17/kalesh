// Plain building shells (P1-016, ARCH_OPTIONS K3 "one simple shell per building"): one extruded prism per repaired
// footprint, standing on the solved ground, with a height from the data (the height tag, or the levels the repair
// turned into metres) or else a class default. They give the base world its walls and colliders until the area
// generator of P2 replaces them with real buildings. Pure.
import type { P2 } from '../geom.ts';
import { ringArea, ringCentroid } from '../geom.ts';
import { triangulateRing } from '../mesh/solids.ts';
import type { Ground } from '../terrain/build.ts';

/** Metres per floor (the same as the repair's levels rule). */
export const FLOOR_M = 3.2;
/** Walls start this far under the lowest ground at the footprint, so no slope shows a gap under a wall. */
export const SHELL_SINK_M = 0.3;

/** Class default heights (m) by the OSM building tag, for footprints with no height and no levels. */
export const CLASS_HEIGHT_M: Readonly<Record<string, number>> = {
  house: 9.6, detached: 9.6, semidetached_house: 9.6, terrace: 9.6, residential: 12.8, apartments: 16, dormitory: 12.8, hotel: 16,
  commercial: 12.8, retail: 9.6, office: 16, government: 12.8, public: 12.8, civic: 12.8, hospital: 16, school: 12.8, college: 12.8, university: 12.8,
  industrial: 9, warehouse: 9, train_station: 12, transportation: 9, parking: 9,
  temple: 12, mosque: 14, church: 14, gurudwara: 12, religious: 12, mausoleum: 14,
  garage: 3.5, garages: 3.5, shed: 3.5, roof: 4, hut: 3.5, kiosk: 3.2, toilets: 3.2, service: 4, construction: 6, ruins: 4,
};
/** Height of a footprint with no tag that names a class (building=yes): a three to four storey Delhi block. */
export const DEFAULT_HEIGHT_M = 11;

export interface ShellFootprint {
  id: string;
  ring: readonly P2[];
  height: number | null;
  levels: number | null;
  tags: Readonly<Record<string, string>>;
}

/** Height of a shell: the data's own, else the class default. */
export function shellHeight(f: ShellFootprint): { height: number; from: 'height' | 'levels' | 'class' | 'default' } {
  if (f.height !== null && f.height >= 2.2) return { height: Math.min(200, f.height), from: 'height' };
  if (f.levels !== null && f.levels >= 1) return { height: Math.min(200, f.levels * FLOOR_M), from: 'levels' };
  const cls = f.tags['building'];
  const h = cls !== undefined ? CLASS_HEIGHT_M[cls] : undefined;
  return h !== undefined ? { height: h, from: 'class' } : { height: DEFAULT_HEIGHT_M, from: 'default' };
}

/** One shell: triangles in block metres with flat normals, and the point whose tile it goes to (its centroid). */
export interface Shell {
  id: string;
  anchor: P2;
  /** Nine numbers per triangle (a, b, c in block metres). */
  tris: number[];
  /** Three numbers per triangle: its outward normal. */
  nrm: number[];
  base: number;
  top: number;
  from: 'height' | 'levels' | 'class' | 'default';
}

/** Heights of the solved ground surface at any point (block metres), from the terrain step's emitted triangles. */
export class GroundHeights {
  private readonly cell = 16;
  private readonly cells = new Map<number, number[]>();
  private readonly g: Pick<Ground, 'tg' | 'surface'>;
  constructor(g: Pick<Ground, 'tg' | 'surface'>) {
    this.g = g;
    const { vx, vz } = g.tg;
    const s = g.surface;
    for (let e = 0; e < s.cls.length; e++) {
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (let i = 0; i < 3; i++) {
        const v = s.tri[e * 3 + i] as number;
        x0 = Math.min(x0, vx[v] as number);
        x1 = Math.max(x1, vx[v] as number);
        z0 = Math.min(z0, vz[v] as number);
        z1 = Math.max(z1, vz[v] as number);
      }
      for (let i = Math.floor(x0 / this.cell); i <= Math.floor(x1 / this.cell); i++) {
        for (let j = Math.floor(z0 / this.cell); j <= Math.floor(z1 / this.cell); j++) {
          const key = this.key(i, j);
          let list = this.cells.get(key);
          if (!list) this.cells.set(key, (list = []));
          list.push(e);
        }
      }
    }
  }

  private key(i: number, j: number): number {
    return (i + 32768) * 65536 + (j + 32768);
  }

  /** The ground height at (x, z), or NaN where no ground triangle is (under a road). */
  at(x: number, z: number): number {
    const list = this.cells.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell)));
    if (!list) return NaN;
    const { vx, vz } = this.g.tg;
    const s = this.g.surface;
    for (const e of list) {
      const a = s.tri[e * 3] as number;
      const b = s.tri[e * 3 + 1] as number;
      const c = s.tri[e * 3 + 2] as number;
      const ax = vx[a] as number;
      const az = vz[a] as number;
      const d = ((vz[b] as number) - (vz[c] as number)) * (ax - (vx[c] as number)) + ((vx[c] as number) - (vx[b] as number)) * (az - (vz[c] as number));
      if (d === 0) continue;
      const l1 = (((vz[b] as number) - (vz[c] as number)) * (x - (vx[c] as number)) + ((vx[c] as number) - (vx[b] as number)) * (z - (vz[c] as number))) / d;
      const l2 = (((vz[c] as number) - az) * (x - (vx[c] as number)) + (ax - (vx[c] as number)) * (z - (vz[c] as number))) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      return l1 * (s.cy[e * 3] as number) + l2 * (s.cy[e * 3 + 1] as number) + l3 * (s.cy[e * 3 + 2] as number);
    }
    return NaN;
  }
}

/**
 * The shell of one footprint: walls from under the lowest ground at its corners to a flat roof at the highest corner
 * plus the height. `ground` gives the solved surface (NaN under a road), `fallback` the ground model. Null for a
 * ring that is not a shape.
 */
export function shellOf(f: ShellFootprint, ground: (x: number, z: number) => number, fallback: (x: number, z: number) => number): Shell | null {
  const ring = f.ring.length > 1 && f.ring[0]!.x === f.ring[f.ring.length - 1]!.x && f.ring[0]!.z === f.ring[f.ring.length - 1]!.z ? f.ring.slice(0, -1) : f.ring.slice();
  if (ring.length < 3 || Math.abs(ringArea(ring)) < 1) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of ring) {
    let y = ground(p.x, p.z);
    if (!Number.isFinite(y)) y = fallback(p.x, p.z);
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  const { height, from } = shellHeight(f);
  const base = lo - SHELL_SINK_M;
  const top = hi + height;
  const tris: number[] = [];
  const nrm: number[] = [];
  // with ringArea positive the outward normal of edge p to q is (dz, -dx); with it negative the other way
  const sign = ringArea(ring) > 0 ? 1 : -1;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i] as P2;
    const q = ring[(i + 1) % ring.length] as P2;
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    if (len < 1e-4) continue;
    const nx = (sign * (q.z - p.z)) / len;
    const nz = (-sign * (q.x - p.x)) / len;
    tris.push(p.x, base, p.z, q.x, base, q.z, q.x, top, q.z, p.x, base, p.z, q.x, top, q.z, p.x, top, p.z);
    nrm.push(nx, 0, nz, nx, 0, nz);
  }
  const idx = triangulateRing(ring.map((p) => [p.x, p.z] as [number, number]));
  for (let k = 0; k + 2 < idx.length; k += 3) {
    for (const v of [idx[k], idx[k + 1], idx[k + 2]] as number[]) tris.push((ring[v] as P2).x, top, (ring[v] as P2).z);
    nrm.push(0, 1, 0);
  }
  return { id: f.id, anchor: ringCentroid(ring), tris, nrm, base, top, from };
}
