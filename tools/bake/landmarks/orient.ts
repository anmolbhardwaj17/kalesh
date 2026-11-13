// Orientation of a landmark from its footprint (P2-006, DELHI_WORLD.md "Placement rules": "from the footprint's main
// axis and the entrance node or `front` field. Never guessed from a photo alone"). The main axis is the long side of
// the smallest rectangle around the ring; the front is the side of that rectangle nearest to a front bearing read
// from evidence (an edit). Without a front bearing the axis alone is known, and the entry says so. Bearings are
// compass degrees in the block frame: 0 north (-Z), 90 east (+X), clockwise. Pure.
import type { P2 } from '../geom.ts';

export interface Axis {
  /** Compass bearing of the long side, 0 to 180 (an axis has no direction). */
  axisDeg: number;
  lengthM: number;
  widthM: number;
  /** Length over width: 1 for a square or a circle. */
  elongation: number;
  /** The ring's area over the rectangle's: near 1 for a rectangle, 0.79 for a circle. */
  fill: number;
  /** The middle of the rectangle. */
  centre: P2;
}

/** A footprint this near to square has no long side; one that also fills its rectangle less than this is round: no axis at all. */
export const ROUND_ELONGATION = 1.1;
export const ROUND_FILL = 0.84;

export const bearingDeg = (dx: number, dz: number): number => ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
/** The unit vector of a compass bearing in block metres. */
export const bearingVector = (deg: number): P2 => ({ x: Math.sin((deg * Math.PI) / 180), z: -Math.cos((deg * Math.PI) / 180) });
/** The smallest angle between two bearings, 0 to 180. */
export const bearingGap = (a: number, b: number): number => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
/** The smallest angle between two axes (bearings taken modulo 180), 0 to 90. */
export const axisGap = (a: number, b: number): number => {
  const d = bearingGap(a, b);
  return d > 90 ? 180 - d : d;
};

function hull(points: readonly P2[]): P2[] {
  const pts = points.slice().sort((p, q) => p.x - q.x || p.z - q.z);
  if (pts.length < 3) return pts;
  const cross = (o: P2, a: P2, b: P2): number => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const lower: P2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2] as P2, lower[lower.length - 1] as P2, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: P2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i] as P2;
    while (upper.length >= 2 && cross(upper[upper.length - 2] as P2, upper[upper.length - 1] as P2, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** The main axis of a ring: the long side of the smallest rectangle around it. Null for a ring that is not a shape. */
export function mainAxis(ring: readonly P2[]): Axis | null {
  const h = hull(ring);
  if (h.length < 3) return null;
  let twice = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i] as P2;
    const q = ring[(i + 1) % ring.length] as P2;
    twice += p.x * q.z - q.x * p.z;
  }
  let best: Axis | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < h.length; i++) {
    const a = h[i] as P2;
    const b = h[(i + 1) % h.length] as P2;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-6) continue;
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const p of h) {
      const u = (p.x - a.x) * ux + (p.z - a.z) * uz;
      const v = -(p.x - a.x) * uz + (p.z - a.z) * ux;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const du = u1 - u0;
    const dv = v1 - v0;
    const area = du * dv;
    // the same area from two sides of a rectangle: the first one found stays (a stable answer)
    if (area >= bestArea - 1e-9) continue;
    bestArea = area;
    const long = du >= dv;
    const cu = (u0 + u1) / 2;
    const cv = (v0 + v1) / 2;
    best = {
      axisDeg: (long ? bearingDeg(ux, uz) : bearingDeg(-uz, ux)) % 180,
      lengthM: Math.max(du, dv),
      widthM: Math.min(du, dv),
      elongation: Math.min(du, dv) > 1e-9 ? Math.max(du, dv) / Math.min(du, dv) : Infinity,
      fill: area > 1e-9 ? Math.abs(twice) / 2 / area : 0,
      centre: { x: a.x + cu * ux - cv * uz, z: a.z + cu * uz + cv * ux },
    };
  }
  return best;
}

export type OrientationSource = 'axis_and_front' | 'principal_axis' | 'front_only' | 'round' | 'none';

export interface Orientation {
  /** The compass bearing the front faces; null when nothing says it. */
  deg: number | null;
  source: OrientationSource;
  axisDeg: number | null;
  elongation: number | null;
  /** True when a front bearing from evidence chose the side. */
  frontKnown: boolean;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * The bearing a landmark's front faces. With a front bearing from evidence: the side of the footprint's rectangle
 * nearest to it. Without one: square to the long side (a facade lies along the long side), the side that faces the
 * southern half, and `frontKnown` false (a square has four such sides: the same rule picks one). A round footprint
 * has no axis: the front bearing as given, else north.
 */
export function orientationOf(axis: Axis | null, front: number | null): Orientation {
  if (!axis) return { deg: front === null ? null : round1(((front % 360) + 360) % 360), source: front === null ? 'none' : 'front_only', axisDeg: null, elongation: null, frontKnown: front !== null };
  const elongation = Math.round(axis.elongation * 100) / 100;
  const axisDeg = round1(axis.axisDeg);
  if (axis.elongation < ROUND_ELONGATION && axis.fill < ROUND_FILL) return { deg: front === null ? 0 : round1(((front % 360) + 360) % 360), source: 'round', axisDeg: null, elongation, frontKnown: front !== null };
  if (front === null) {
    const a = (axis.axisDeg + 90) % 360;
    const b = (axis.axisDeg + 270) % 360;
    // the candidate in the southern half (90 to 270), so the same footprint always gives the same answer
    const deg = a >= 90 && a < 270 ? a : b;
    return { deg: round1(deg), source: 'principal_axis', axisDeg, elongation, frontKnown: false };
  }
  let best = axis.axisDeg;
  let gap = Infinity;
  for (const k of [0, 90, 180, 270]) {
    const c = (axis.axisDeg + k) % 360;
    const g = bearingGap(c, front);
    if (g < gap) {
      gap = g;
      best = c;
    }
  }
  return { deg: round1(best), source: 'axis_and_front', axisDeg, elongation, frontKnown: true };
}
