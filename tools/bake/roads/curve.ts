// Curves of the road model: a polyline with arc length, smoothing of an OSM way into a reference line, and the
// small vector helpers. Plane coordinates: x east, z south; the left of a direction (dx, dz) is (dz, -dx).
import type { P2 } from '../geom.ts';

export interface Frame extends P2 {
  /** Unit tangent. */
  tx: number;
  tz: number;
}

export const leftOf = (tx: number, tz: number): { nx: number; nz: number } => ({ nx: tz, nz: -tx });
export const smoothstep = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function unit(x: number, z: number): { x: number; z: number } {
  const len = Math.hypot(x, z);
  return len < 1e-12 ? { x: 1, z: 0 } : { x: x / len, z: z / len };
}

/** A polyline with cumulative lengths: points and tangents by arc length. */
export class Curve {
  readonly pts: P2[];
  readonly cum: number[];
  readonly length: number;

  constructor(pts: readonly P2[]) {
    this.pts = [];
    for (const p of pts) {
      const last = this.pts[this.pts.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.z - last.z) > 1e-6) this.pts.push({ x: p.x, z: p.z });
    }
    if (this.pts.length === 1) this.pts.push({ x: (this.pts[0] as P2).x + 1e-3, z: (this.pts[0] as P2).z });
    this.cum = [0];
    for (let i = 1; i < this.pts.length; i++) {
      const a = this.pts[i - 1] as P2;
      const b = this.pts[i] as P2;
      this.cum.push((this.cum[i - 1] as number) + Math.hypot(b.x - a.x, b.z - a.z));
    }
    this.length = this.cum[this.cum.length - 1] as number;
  }

  private seg(s: number): number {
    let lo = 0;
    let hi = this.cum.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.cum[mid] as number) <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Point and tangent at arc length s. Outside 0..length the end segment is extended as a straight line. */
  at(s: number): Frame {
    const i = this.seg(Math.max(0, Math.min(this.length, s)));
    const a = this.pts[i] as P2;
    const b = this.pts[i + 1] as P2;
    const t = unit(b.x - a.x, b.z - a.z);
    const d = s - (this.cum[i] as number);
    return { x: a.x + t.x * d, z: a.z + t.z * d, tx: t.x, tz: t.z };
  }

  /** The tangent averaged over a window, so a frame does not jump at a vertex. */
  smoothAt(s: number, window = 3): Frame {
    const p = this.at(s);
    const a = this.at(Math.max(0, s - window));
    const b = this.at(Math.min(this.length, s + window));
    const t = unit(b.x - a.x, b.z - a.z);
    return Math.hypot(b.x - a.x, b.z - a.z) < 1e-6 ? p : { x: p.x, z: p.z, tx: t.x, tz: t.z };
  }

  reversed(): Curve {
    return new Curve(this.pts.slice().reverse());
  }

  /**
   * Arc length of the point of the curve closest to p, the distance and the segment. With `near` only the
   * segments within `window` of that segment are searched (for walking along a road that runs alongside).
   */
  project(p: P2, near = -1, window = 24): { s: number; d: number; seg: number } {
    let best = { s: 0, d: Infinity, seg: 0 };
    const from = near < 0 ? 0 : Math.max(0, near - window);
    const to = near < 0 ? this.pts.length - 1 : Math.min(this.pts.length - 1, near + window);
    for (let i = from; i < to; i++) {
      const a = this.pts[i] as P2;
      const b = this.pts[i + 1] as P2;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
      const d = Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
      if (d < best.d) best = { s: (this.cum[i] as number) + Math.sqrt(len2) * t, d, seg: i };
    }
    return best;
  }
}

/**
 * A reference line from an OSM way: a Catmull-Rom spline through its points, sampled every `step` metres, so the
 * tangent turns smoothly and a ribbon does not fold at a vertex. Ends keep their points exactly; an end direction
 * (a unit vector along the line) makes two edges that meet at a node leave it on one tangent.
 */
export function smoothLine(pts: readonly P2[], step = 1, startDir?: P2, endDir?: P2): Curve {
  const raw = new Curve(pts);
  const p = raw.pts;
  const out: P2[] = [];
  for (let i = 0; i + 1 < p.length; i++) {
    const p0 = p[Math.max(0, i - 1)] as P2;
    const p1 = p[i] as P2;
    const p2 = p[i + 1] as P2;
    const p3 = p[Math.min(p.length - 1, i + 2)] as P2;
    const len = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const n = Math.max(1, Math.ceil(len / step));
    // tangents limited to the segment length, so a long neighbour does not make a short segment overshoot
    const lim = (ax: number, az: number): P2 => {
      const l = Math.hypot(ax, az);
      return l > len && l > 0 ? { x: (ax / l) * len, z: (az / l) * len } : { x: ax, z: az };
    };
    // an end may be given a direction: the one it shares with the road it runs on into at its node
    const m1 = i === 0 && startDir ? { x: startDir.x * len, z: startDir.z * len } : lim((p2.x - p0.x) / 2, (p2.z - p0.z) / 2);
    const m2 = i + 2 === p.length && endDir ? { x: endDir.x * len, z: endDir.z * len } : lim((p3.x - p1.x) / 2, (p3.z - p1.z) / 2);
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      out.push({ x: h00 * p1.x + h10 * m1.x + h01 * p2.x + h11 * m2.x, z: h00 * p1.z + h10 * m1.z + h01 * p2.z + h11 * m2.z });
    }
  }
  out.push({ ...(p[p.length - 1] as P2) });
  return new Curve(out);
}

/** Where two segments cross (ends included): the positions along each, or null. */
export function segCross(a: P2, b: P2, c: P2, d: P2): { t: number; u: number; x: number; z: number } | null {
  const rx = b.x - a.x;
  const rz = b.z - a.z;
  const sx = d.x - c.x;
  const sz = d.z - c.z;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * sz - (c.z - a.z) * sx) / den;
  const u = ((c.x - a.x) * rz - (c.z - a.z) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, x: a.x + rx * t, z: a.z + rz * t };
}

/** Standard shoelace area in the (x, z) plane: positive for one turning sense, negative for the other. */
export function area2(ring: readonly P2[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i] as P2;
    const q = ring[(i + 1) % ring.length] as P2;
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

/** True when a closed ring crosses itself (edges that only share an end do not count). */
export function selfCrossing(ring: readonly P2[]): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i] as P2;
    const b = ring[(i + 1) % n] as P2;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = ring[j] as P2;
      const d = ring[(j + 1) % n] as P2;
      const x = segCross(a, b, c, d);
      if (x && x.t > 1e-6 && x.t < 1 - 1e-6 && x.u > 1e-6 && x.u < 1 - 1e-6) return true;
    }
  }
  return false;
}
