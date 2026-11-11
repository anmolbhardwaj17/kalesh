// Plane geometry of the offline bake, in district metres (x east, z south: north is -Z, the game's one coordinate
// system). Pure functions and one spatial grid; no file or network access here.

export interface P2 {
  x: number;
  z: number;
}

export interface Box2 {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export const dist = (a: P2, b: P2): number => Math.hypot(a.x - b.x, a.z - b.z);

/** Closest point of segment ab to p: its distance and the position t (0 at a, 1 at b). */
export function pointSegment(p: P2, a: P2, b: P2): { d: number; t: number; x: number; z: number } {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
  const x = a.x + dx * t;
  const z = a.z + dz * t;
  return { d: Math.hypot(p.x - x, p.z - z), t, x, z };
}

/**
 * Crossing of segments ab and cd strictly inside both (ends that only touch do not count).
 * `margin` (0 to 0.5) is how far from each end, as a share of the segment, a crossing must be.
 */
export function segmentCrossing(a: P2, b: P2, c: P2, d: P2, margin = 1e-9): (P2 & { t: number; u: number }) | null {
  const rx = b.x - a.x;
  const rz = b.z - a.z;
  const sx = d.x - c.x;
  const sz = d.z - c.z;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c.x - a.x) * sz - (c.z - a.z) * sx) / den;
  const u = ((c.x - a.x) * rz - (c.z - a.z) * rx) / den;
  if (t <= margin || t >= 1 - margin || u <= margin || u >= 1 - margin) return null;
  return { x: a.x + rx * t, z: a.z + rz * t, t, u };
}

/** Smallest distance between segments ab and cd (0 when they cross). */
export function segmentSegment(a: P2, b: P2, c: P2, d: P2): number {
  if (segmentCrossing(a, b, c, d, -1e-9)) return 0;
  return Math.min(pointSegment(a, c, d).d, pointSegment(b, c, d).d, pointSegment(c, a, b).d, pointSegment(d, a, b).d);
}

export function polylineLength(pts: readonly P2[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1] as P2, pts[i] as P2);
  return len;
}

/** Points every `step` metres along a polyline, ends included. */
export function resample(pts: readonly P2[], step: number): P2[] {
  const out: P2[] = [];
  if (pts.length === 0) return out;
  out.push({ ...(pts[0] as P2) });
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as P2;
    const b = pts[i] as P2;
    const len = dist(a, b);
    let at = step - carry;
    while (at < len) {
      out.push({ x: a.x + ((b.x - a.x) * at) / len, z: a.z + ((b.z - a.z) * at) / len });
      at += step;
    }
    carry = len - (at - step);
  }
  const last = pts[pts.length - 1] as P2;
  if (dist(out[out.length - 1] as P2, last) > 1e-6) out.push({ ...last });
  return out;
}

/** Signed area of a ring (the closing point may be repeated or not). Positive when clockwise seen with north up. */
export function ringArea(ring: readonly P2[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i] as P2;
    const q = ring[(i + 1) % ring.length] as P2;
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

export function ringCentroid(ring: readonly P2[]): P2 {
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i] as P2;
    const q = ring[(i + 1) % ring.length] as P2;
    const w = p.x * q.z - q.x * p.z;
    a += w;
    cx += (p.x + q.x) * w;
    cz += (p.z + q.z) * w;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0;
    let sz = 0;
    for (const p of ring) {
      sx += p.x;
      sz += p.z;
    }
    return { x: sx / Math.max(1, ring.length), z: sz / Math.max(1, ring.length) };
  }
  return { x: cx / (3 * a), z: cz / (3 * a) };
}

export function pointInRing(p: P2, ring: readonly P2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as P2;
    const b = ring[j] as P2;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function boxOf(pts: readonly P2[]): Box2 {
  const b: Box2 = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const p of pts) {
    if (p.x < b.minX) b.minX = p.x;
    if (p.x > b.maxX) b.maxX = p.x;
    if (p.z < b.minZ) b.minZ = p.z;
    if (p.z > b.maxZ) b.maxZ = p.z;
  }
  return b;
}

export const boxesMeet = (a: Box2, b: Box2, pad = 0): boolean => a.minX - pad <= b.maxX && a.maxX + pad >= b.minX && a.minZ - pad <= b.maxZ && a.maxZ + pad >= b.minZ;
export const inBox = (b: Box2, p: P2, pad = 0): boolean => p.x >= b.minX - pad && p.x <= b.maxX + pad && p.z >= b.minZ - pad && p.z <= b.maxZ + pad;

/** Drops a repeated closing point, so a ring is stored open. */
export function openRing(ring: readonly P2[]): P2[] {
  const out = ring.slice();
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && first && last && first.x === last.x && first.z === last.z) out.pop();
  return out;
}

/** Smallest distance from a segment to a ring's edge, 0 when an end of the segment is inside the ring. */
export function segmentRing(a: P2, b: P2, ring: readonly P2[]): number {
  if (pointInRing(a, ring) || pointInRing(b, ring)) return 0;
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const d = segmentSegment(a, b, ring[i] as P2, ring[(i + 1) % ring.length] as P2);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Share of ring a's area that lies inside ring b, from an n by n grid of sample points over a's box.
 * An estimate (about 1 / n of the area), which is enough to tell a duplicate from a neighbour.
 */
export function overlapShare(a: readonly P2[], b: readonly P2[], n = 12): number {
  const box = boxOf(a);
  let inA = 0;
  let inBoth = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const p = { x: box.minX + ((i + 0.5) / n) * (box.maxX - box.minX), z: box.minZ + ((j + 0.5) / n) * (box.maxZ - box.minZ) };
      if (!pointInRing(p, a)) continue;
      inA++;
      if (pointInRing(p, b)) inBoth++;
    }
  }
  return inA === 0 ? 0 : inBoth / inA;
}

/** A uniform grid over the plane that answers "which items have a box near this box". */
export class Grid<T> {
  private readonly cells = new Map<string, T[]>();
  private readonly cell: number;
  constructor(cell = 50) {
    this.cell = cell;
  }

  insert(box: Box2, item: T): void {
    const c = this.cell;
    for (let i = Math.floor(box.minX / c); i <= Math.floor(box.maxX / c); i++) {
      for (let j = Math.floor(box.minZ / c); j <= Math.floor(box.maxZ / c); j++) {
        const key = `${i},${j}`;
        const list = this.cells.get(key);
        if (list) list.push(item);
        else this.cells.set(key, [item]);
      }
    }
  }

  /** Every item whose cells meet the box grown by pad. An item is returned once. */
  query(box: Box2, pad = 0): T[] {
    const c = this.cell;
    const seen = new Set<T>();
    for (let i = Math.floor((box.minX - pad) / c); i <= Math.floor((box.maxX + pad) / c); i++) {
      for (let j = Math.floor((box.minZ - pad) / c); j <= Math.floor((box.maxZ + pad) / c); j++) {
        const list = this.cells.get(`${i},${j}`);
        if (list) for (const item of list) seen.add(item);
      }
    }
    return [...seen];
  }
}

/** Triangles of a simple ring by ear clipping, as indices into the ring. Any winding. */
export function triangulate(ring: readonly P2[]): number[] {
  const n = ring.length;
  if (n < 3) return [];
  const idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(i);
  if (ringArea(ring) < 0) idx.reverse();
  const out: number[] = [];
  const cross = (a: P2, b: P2, c: P2) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  let guard = 0;
  while (idx.length > 3 && guard < 4 * n * n) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length] as number;
      const ib = idx[i] as number;
      const ic = idx[(i + 1) % idx.length] as number;
      const a = ring[ia] as P2;
      const b = ring[ib] as P2;
      const c = ring[ic] as P2;
      guard++;
      if (cross(a, b, c) <= 1e-12) continue; // reflex or flat corner
      let ear = true;
      for (const k of idx) {
        if (k === ia || k === ib || k === ic) continue;
        const p = ring[k] as P2;
        if (cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0) {
          ear = false;
          break;
        }
      }
      if (!ear) continue;
      out.push(ia, ib, ic);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // a bad ring (self-crossing): keep what was found, fan the rest
  }
  for (let i = 1; i + 1 < idx.length; i++) out.push(idx[0] as number, idx[i] as number, idx[i + 1] as number);
  return out;
}
