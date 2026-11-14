// Drains in the ground (P1-037): water that runs (drains, ditches, streams, canals) gets a surface that follows the
// slope of its banks instead of one flat level, and drain lines with no water area of their own become a channel of
// their class width. Level pools (ponds, lakes, reservoirs, the ornamental canals tagged natural=water) and the river
// stay flat: the whole water network with flow direction, joins and culverts is P2-030. Pure.
import type { P2 } from '../geom.ts';
import { pointInRing } from '../geom.ts';

/** A water line of the map (OSM waterway): drawn as a channel when no water area covers it. */
export interface WaterLineInput {
  id: string;
  kind: string;
  pts: readonly P2[];
  /** A culvert under a road or a building: not drawn. */
  tunnel: boolean;
}

/** Water area kinds whose surface follows its banks (the graph's `kind`, features.ts waterKind). */
export const SLOPED_AREA_KINDS: ReadonlySet<string> = new Set(['water=drain', 'water=ditch', 'water=stream', 'water=canal', 'water=wastewater', 'waterway=canal', 'waterway=drain']);

/** Half the width of the channel a water line becomes (m); kinds not listed (the river) are not drawn from lines. */
export const LINE_HALF_WIDTH_M: Readonly<Record<string, number>> = { 'waterway=drain': 2.5, 'waterway=canal': 4, 'waterway=stream': 1.5, 'waterway=ditch': 1 };

/** The steepest water surface a fit may give (fall per metre): a drain follows its bed, it does not run down a wall. */
export const MAX_WATER_SLOPE = 0.02;

/**
 * The channel of a water line as rings that overlap: a box per segment and an octagon at every bend (the water
 * count of the ground is "not zero", so overlaps are water once). Each ring is oriented by the collector.
 */
export function lineRings(line: WaterLineInput): P2[][] {
  const w = LINE_HALF_WIDTH_M[line.kind];
  if (w === undefined || line.tunnel || line.pts.length < 2) return [];
  const out: P2[][] = [];
  for (let k = 0; k + 1 < line.pts.length; k++) {
    const a = line.pts[k] as P2;
    const b = line.pts[k + 1] as P2;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 0.05) continue;
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    const nx = -uz * w;
    const nz = ux * w;
    out.push([{ x: a.x + nx, z: a.z + nz }, { x: b.x + nx, z: b.z + nz }, { x: b.x - nx, z: b.z - nz }, { x: a.x - nx, z: a.z - nz }]);
  }
  // an octagon round each inner bend (its inner radius the half width) closes the wedge between two boxes
  const R = (w / Math.cos(Math.PI / 8)) * 1.01;
  for (let k = 1; k + 1 < line.pts.length; k++) {
    const p = line.pts[k] as P2;
    const a = line.pts[k - 1] as P2;
    const b = line.pts[k + 1] as P2;
    const t = Math.atan2(b.z - a.z, b.x - a.x);
    const ring: P2[] = [];
    for (let i = 0; i < 8; i++) ring.push({ x: p.x + Math.cos(t + (i * Math.PI) / 4) * R, z: p.z + Math.sin(t + (i * Math.PI) / 4) * R });
    out.push(ring);
  }
  return out;
}

/** Rings of every water that runs: the areas of a sloped kind and the channels of the lines. */
export function slopedRings(water: readonly { kind?: string; rings: readonly (readonly P2[])[] }[], lines: readonly WaterLineInput[]): P2[][] {
  const out: P2[][] = [];
  for (const w of water) if (w.kind && SLOPED_AREA_KINDS.has(w.kind)) for (const r of w.rings) out.push(r as P2[]);
  for (const l of lines) out.push(...lineRings(l));
  return out;
}

/** Rings with their boxes, for a point test. */
export class RingSet {
  private readonly rings: { ring: P2[]; x0: number; x1: number; z0: number; z1: number }[] = [];
  constructor(rings: readonly P2[][]) {
    for (const ring of rings) {
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (const p of ring) {
        x0 = Math.min(x0, p.x);
        x1 = Math.max(x1, p.x);
        z0 = Math.min(z0, p.z);
        z1 = Math.max(z1, p.z);
      }
      this.rings.push({ ring, x0, x1, z0, z1 });
    }
  }
  get size(): number {
    return this.rings.length;
  }
  has(x: number, z: number): boolean {
    for (const r of this.rings) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1 && pointInRing({ x, z }, r.ring)) return true;
    return false;
  }
}

/** A water surface: level at the centre and the fall per metre in x and z. */
export interface WaterPlane {
  cx: number;
  cz: number;
  level: number;
  gx: number;
  gz: number;
}

export const levelAt = (p: WaterPlane, x: number, z: number): number => p.level + p.gx * (x - p.cx) + p.gz * (z - p.cz);

/**
 * The slope of the ground along a water body: heights of its bank points fitted by a line along the body's long axis
 * (the main direction of the points), so a straight drain whose banks lie on one line still has a defined slope.
 * Returns the fall per metre in x and z (0, 0 for fewer than three points or a body as wide as it is long).
 */
export function bankSlope(pts: readonly { x: number; z: number; y: number }[]): { cx: number; cz: number; gx: number; gz: number } {
  const n = pts.length;
  let cx = 0;
  let cz = 0;
  for (const p of pts) {
    cx += p.x;
    cz += p.z;
  }
  cx /= Math.max(1, n);
  cz /= Math.max(1, n);
  if (n < 3) return { cx, cz, gx: 0, gz: 0 };
  let sxx = 0;
  let szz = 0;
  let sxz = 0;
  for (const p of pts) {
    sxx += (p.x - cx) ** 2;
    szz += (p.z - cz) ** 2;
    sxz += (p.x - cx) * (p.z - cz);
  }
  // the long axis: the larger eigenvector of the 2 x 2 spread
  const tr = sxx + szz;
  const det = sxx * szz - sxz * sxz;
  const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l2 = tr - l1;
  if (l1 <= 0 || l2 / l1 > 0.25) return { cx, cz, gx: 0, gz: 0 };
  let ax = Math.abs(sxz) > 1e-12 ? l1 - szz : 1;
  let az = Math.abs(sxz) > 1e-12 ? sxz : 0;
  if (Math.abs(sxz) <= 1e-12 && szz > sxx) {
    ax = 0;
    az = 1;
  }
  const al = Math.hypot(ax, az) || 1;
  ax /= al;
  az /= al;
  let st = 0;
  let stt = 0;
  let sy = 0;
  let sty = 0;
  for (const p of pts) {
    const t = (p.x - cx) * ax + (p.z - cz) * az;
    st += t;
    stt += t * t;
    sy += p.y;
    sty += t * p.y;
  }
  const den = n * stt - st * st;
  if (den <= 0) return { cx, cz, gx: 0, gz: 0 };
  const s = Math.max(-MAX_WATER_SLOPE, Math.min(MAX_WATER_SLOPE, (n * sty - st * sy) / den));
  return { cx, cz, gx: s * ax, gz: s * az };
}
