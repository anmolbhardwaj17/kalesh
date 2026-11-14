// The odd-footprint check (P2-009, DELHI_WORLD.md "OSM is reference, not the final word"): footprints that would look
// wrong in the game are flagged, and the ones that are plainly not a real building shape are regularised.
//   sliver        thinner than a room (mean width under 1.5 m, or a box under 1.8 m wide): dropped, it is a wall
//                 or a scrap, never a building
//   spike         a corner sharper than 15 degrees: the spike is cut off
//   self_overlap  the outline crosses itself: the outer shape is kept
//   zigzag        a machine-made outline (Microsoft, Google, Esri) that wobbles round a plain rectangle: squared to
//                 the rectangle of the same area along its own long wall; one that wobbles round another shape has
//                 its wobble taken out. A new outline is taken only when it stays off the roads and off the
//                 neighbours; else the old one stays and the line says `flagged`
//   size, height  far outside what the area has (over 20,000 m2, or a tagged height over three times the area's
//                 tall floor count): flagged and kept, the data says so until a photo says otherwise
// A footprint named in the keep list (harness/data/areas/footprint_keep.json: checked against photos or satellite,
// the real building is like that) is never changed. Every line goes to the report the map inspector reads. Pure.
import { FillRule, areaD, intersectD, unionD } from 'clipper2-ts';
import type { PathD } from 'clipper2-ts';
import type { P2 } from '../geom.ts';
import { orientedBox, ringBox } from './space.ts';
import type { RingIndex } from './space.ts';

export type OddKind = 'sliver' | 'spike' | 'self_overlap' | 'zigzag' | 'size' | 'height';
export type OddAction = 'dropped' | 'regularised' | 'flagged' | 'kept';

export interface OddLine {
  id: string;
  source: string;
  kind: OddKind;
  action: OddAction;
  detail: string;
  areaBefore: number;
  areaAfter: number;
  /** Block metres of its centre. */
  x: number;
  z: number;
}

export interface OddFootprint {
  id: string;
  source: string;
  ring: P2[];
  area: number;
  height: number | null;
  levels: number | null;
  tags: Readonly<Record<string, string>>;
}

export const ODD = {
  sliverMeanM: 1.5,
  sliverBoxM: 1.8,
  spikeDeg: 15,
  /** A machine-made outline is squared when the rectangle of its area shares this much with it (intersection over union). */
  rectIou: 0.82,
  /** The wobble: points nearer than this to the line between their neighbours are noise (m). */
  wobbleM: 0.6,
  /** A new outline may lie on the neighbours by this much more than the old one (m2). */
  neighbourTolM2: 0.5,
  roadTolM2: 0.01,
  hugeM2: 20000,
  minAreaM2: 6,
} as const;

const PRECISION = 3;
const r2 = (v: number): number => Math.round(v * 100) / 100 + 0;
const toPath = (ring: readonly P2[]): PathD => ring.map((p) => ({ x: p.x, y: p.z }));
const positive = (p: PathD): PathD => (areaD(p) < 0 ? p.slice().reverse() : p);
const areaOf = (ring: readonly P2[]): number => {
  let a = 0;
  for (let i = 0; i < ring.length; i++) a += (ring[i] as P2).x * (ring[(i + 1) % ring.length] as P2).z - (ring[(i + 1) % ring.length] as P2).x * (ring[i] as P2).z;
  return Math.abs(a) / 2;
};
const perimeter = (ring: readonly P2[]): number => {
  let s = 0;
  for (let i = 0; i < ring.length; i++) s += Math.hypot((ring[(i + 1) % ring.length] as P2).x - (ring[i] as P2).x, (ring[(i + 1) % ring.length] as P2).z - (ring[i] as P2).z);
  return s;
};
const centre = (ring: readonly P2[]): P2 => {
  let x = 0;
  let z = 0;
  for (const p of ring) {
    x += p.x;
    z += p.z;
  }
  return { x: x / ring.length, z: z / ring.length };
};

/** An open ring without repeated points. */
export function cleanRing(ring: readonly P2[]): P2[] {
  const out: P2[] = [];
  for (const p of ring) if (!out.length || Math.hypot(p.x - (out[out.length - 1] as P2).x, p.z - (out[out.length - 1] as P2).z) > 0.01) out.push({ x: p.x, z: p.z });
  if (out.length > 1 && Math.hypot((out[0] as P2).x - (out[out.length - 1] as P2).x, (out[0] as P2).z - (out[out.length - 1] as P2).z) <= 0.01) out.pop();
  return out;
}

/** Does the outline cross itself (two edges that are not neighbours meet). */
export function selfCrosses(ring: readonly P2[]): boolean {
  const n = ring.length;
  const cross = (a: P2, b: P2, c: P2): number => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  for (let i = 0; i < n; i++) {
    const a = ring[i] as P2;
    const b = ring[(i + 1) % n] as P2;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = ring[j] as P2;
      const d = ring[(j + 1) % n] as P2;
      const d1 = cross(a, b, c);
      const d2 = cross(a, b, d);
      const d3 = cross(c, d, a);
      const d4 = cross(c, d, b);
      if (d1 * d2 < -1e-9 && d3 * d4 < -1e-9) return true;
    }
  }
  return false;
}

/** The ring without its spikes (corners sharper than `deg`); null when nothing is left. */
export function cutSpikes(ring: readonly P2[], deg: number): { ring: P2[]; cut: number } | null {
  const pts = ring.slice();
  let cut = 0;
  const limit = Math.cos((deg * Math.PI) / 180);
  for (let guard = 0; guard < 64; guard++) {
    let at = -1;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[(i + pts.length - 1) % pts.length] as P2;
      const q = pts[i] as P2;
      const r = pts[(i + 1) % pts.length] as P2;
      const ax = p.x - q.x;
      const az = p.z - q.z;
      const bx = r.x - q.x;
      const bz = r.z - q.z;
      const la = Math.hypot(ax, az);
      const lb = Math.hypot(bx, bz);
      if (la < 1e-6 || lb < 1e-6 || (ax * bx + az * bz) / (la * lb) > limit) {
        at = i;
        break;
      }
    }
    if (at < 0) break;
    pts.splice(at, 1);
    cut++;
    if (pts.length < 3) return null;
  }
  return { ring: pts, cut };
}

/** The ring without the points that lie within `tol` of the line between the points kept on both sides. */
export function dewobble(ring: readonly P2[], tol: number): P2[] {
  const n = ring.length;
  if (n <= 4) return ring.slice();
  // start at the two points farthest apart, then keep what stands out (Douglas and Peucker on both halves)
  let i0 = 0;
  let i1 = 0;
  let far = -1;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const d = Math.hypot((ring[i] as P2).x - (ring[j] as P2).x, (ring[i] as P2).z - (ring[j] as P2).z);
    if (d > far) {
      far = d;
      i0 = i;
      i1 = j;
    }
  }
  const keep = new Uint8Array(n);
  keep[i0] = keep[i1] = 1;
  const walk = (from: number, to: number): void => {
    // indices from..to going forward round the ring
    const len = (to - from + n) % n;
    if (len < 2) return;
    const a = ring[from] as P2;
    const b = ring[to] as P2;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    let worst = -1;
    let wi = -1;
    for (let s = 1; s < len; s++) {
      const p = ring[(from + s) % n] as P2;
      const d = Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) / l;
      if (d > worst) {
        worst = d;
        wi = (from + s) % n;
      }
    }
    if (worst > tol) {
      keep[wi] = 1;
      walk(from, wi);
      walk(wi, to);
    }
  };
  walk(i0, i1);
  walk(i1, i0);
  return ring.filter((_, i) => keep[i]);
}

/** The rectangle of the ring's area along its own longest wall. */
export function squared(ring: readonly P2[]): P2[] {
  const b = orientedBox(ring);
  const k = Math.sqrt(areaOf(ring) / Math.max(1e-9, 4 * b.a * b.b));
  const a = b.a * k;
  const c = b.b * k;
  const vx = -b.uz;
  const vz = b.ux;
  return [
    { x: r2(b.cx - b.ux * a - vx * c), z: r2(b.cz - b.uz * a - vz * c) },
    { x: r2(b.cx + b.ux * a - vx * c), z: r2(b.cz + b.uz * a - vz * c) },
    { x: r2(b.cx + b.ux * a + vx * c), z: r2(b.cz + b.uz * a + vz * c) },
    { x: r2(b.cx - b.ux * a + vx * c), z: r2(b.cz - b.uz * a + vz * c) },
  ];
}

/** Intersection over union of two rings. */
export function iou(a: readonly P2[], b: readonly P2[]): number {
  const pa = positive(toPath(a));
  const pb = positive(toPath(b));
  const inter = intersectD([pa], [pb], FillRule.NonZero, PRECISION).reduce((s, p) => s + Math.abs(areaD(p)), 0);
  const u = Math.abs(areaD(pa)) + Math.abs(areaD(pb)) - inter;
  return u > 0 ? inter / u : 0;
}

const machineMade = (source: string): boolean => source.startsWith('overture:') && source !== 'overture:osm';

export interface OddInput<F extends OddFootprint> {
  footprints: readonly F[];
  /** Ids checked against photos: never changed. */
  keep: ReadonlySet<string>;
  /** Area of a ring on the road faces (m2). */
  onRoad: (ring: readonly P2[]) => number;
  /** The tall floor count (p90) of the area at a point. */
  tallFloors: (x: number, z: number) => number;
  index: RingIndex<{ id: string; ring: readonly P2[]; box: ReturnType<typeof ringBox> }>;
}

export interface OddResult<F extends OddFootprint> {
  footprints: F[];
  lines: OddLine[];
  counts: Record<OddKind, number> & { checked: number; dropped: number; regularised: number; flagged: number; kept: number };
}

/** Every footprint through the check, in id order. The index holds the outlines as they were (neighbours are read from it). */
export function checkFootprints<F extends OddFootprint>(input: OddInput<F>): OddResult<F> {
  const lines: OddLine[] = [];
  const out: F[] = [];
  const counts: OddResult<F>['counts'] = { sliver: 0, spike: 0, self_overlap: 0, zigzag: 0, size: 0, height: 0, checked: 0, dropped: 0, regularised: 0, flagged: 0, kept: 0 };
  const list = input.footprints.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const onNeighbours = (id: string, ring: readonly P2[]): number => {
    const box = ringBox(ring);
    const near = input.index.near(box).filter((n) => n.id !== id);
    if (!near.length) return 0;
    return intersectD([positive(toPath(ring))], near.map((n) => positive(toPath(n.ring))), FillRule.NonZero, PRECISION).reduce((s, p) => s + Math.abs(areaD(p)), 0);
  };
  for (const f of list) {
    counts.checked++;
    const c = centre(f.ring);
    const line = (kind: OddKind, action: OddAction, detail: string, after: number): void => {
      lines.push({ id: f.id, source: f.source, kind, action, detail, areaBefore: r2(f.area), areaAfter: r2(after), x: r2(c.x), z: r2(c.z) });
      counts[kind]++;
      counts[action]++;
    };
    if (f.source === 'blueprint') {
      out.push(f);
      continue;
    }
    let ring = cleanRing(f.ring);
    const kept = input.keep.has(f.id);
    let changed = false;
    const accept = (next: P2[], oldOverlap: number): boolean => {
      if (next.length < 3 || areaOf(next) < ODD.minAreaM2) return false;
      if (input.onRoad(next) > ODD.roadTolM2) return false;
      return onNeighbours(f.id, next) <= oldOverlap + ODD.neighbourTolM2;
    };
    // the outline crosses itself: the outer shape
    if (ring.length >= 4 && selfCrosses(ring)) {
      if (kept) line('self_overlap', 'kept', 'the outline crosses itself; on the keep list', f.area);
      else {
        const parts = unionD([positive(toPath(ring))], [], FillRule.NonZero, PRECISION).filter((p) => areaD(p) > 0).sort((a, b) => areaD(b) - areaD(a));
        const best = parts[0];
        if (best && areaD(best) >= ODD.minAreaM2) {
          ring = cleanRing(best.map((q) => ({ x: r2(q.x), z: r2(q.y) })));
          changed = true;
          line('self_overlap', 'regularised', `the outline crossed itself: the outer shape of ${parts.length} is kept`, areaOf(ring));
        } else {
          line('self_overlap', 'dropped', 'the outline crossed itself and no shape of 6 m2 is left', 0);
          continue;
        }
      }
    }
    // spikes
    const sp = cutSpikes(ring, ODD.spikeDeg);
    if (!sp) {
      if (kept) {
        line('spike', 'kept', 'only spikes; on the keep list', f.area);
        out.push(f);
      } else line('spike', 'dropped', 'nothing but a spike', 0);
      continue;
    }
    if (sp.cut > 0) {
      if (kept) line('spike', 'kept', `${sp.cut} corners sharper than ${ODD.spikeDeg} degrees; on the keep list`, f.area);
      else if (areaOf(sp.ring) >= ODD.minAreaM2) {
        ring = sp.ring;
        changed = true;
        line('spike', 'regularised', `${sp.cut} corners sharper than ${ODD.spikeDeg} degrees cut off`, areaOf(ring));
      }
    }
    // slivers
    const area = areaOf(ring);
    const mean = (2 * area) / Math.max(1e-9, perimeter(ring));
    const box = orientedBox(ring);
    if (mean < ODD.sliverMeanM || box.b * 2 < ODD.sliverBoxM || area < ODD.minAreaM2) {
      if (kept) {
        line('sliver', 'kept', `mean width ${r2(mean)} m; on the keep list`, f.area);
        out.push(f);
      } else line('sliver', 'dropped', `mean width ${r2(mean)} m, box ${r2(box.a * 2)} by ${r2(box.b * 2)} m: a wall or a scrap, not a building`, 0);
      continue;
    }
    // machine-made wobble
    if (!kept && machineMade(f.source) && ring.length > 4) {
      const rect = squared(ring);
      const share = iou(ring, rect);
      const before = onNeighbours(f.id, ring);
      if (share >= ODD.rectIou) {
        if (accept(rect, before)) {
          ring = rect;
          changed = true;
          line('zigzag', 'regularised', `machine-made outline of ${f.ring.length} points round a rectangle (shares ${Math.round(share * 100)} percent with it): squared`, areaOf(rect));
        } else line('zigzag', 'flagged', `machine-made outline round a rectangle, but the rectangle would stand on a road or a neighbour: left as it is`, area);
      } else {
        const smooth = dewobble(ring, ODD.wobbleM);
        if (smooth.length >= 3 && smooth.length <= ring.length * 0.7 && ring.length >= 8) {
          const a2 = areaOf(smooth);
          if (Math.abs(a2 - area) <= area * 0.1 && accept(smooth, before)) {
            ring = smooth;
            changed = true;
            line('zigzag', 'regularised', `machine-made outline: ${f.ring.length - smooth.length} wobble points of ${f.ring.length} taken out`, a2);
          } else line('zigzag', 'flagged', `machine-made outline with ${f.ring.length - smooth.length} wobble points of ${f.ring.length}: the smooth outline would change it too much or stand on a road or a neighbour`, area);
        }
      }
    }
    // outliers: flagged, kept
    const finalArea = areaOf(ring);
    if (finalArea > ODD.hugeM2) line('size', kept ? 'kept' : 'flagged', `${Math.round(finalArea)} m2: far larger than a building of this area; check it against the satellite view`, finalArea);
    if (f.height !== null) {
      const tall = input.tallFloors(c.x, c.z);
      if (f.height > Math.max(30, tall * 3.2 * 3)) line('height', kept ? 'kept' : 'flagged', `tagged ${r2(f.height)} m where the area's tall buildings have ${tall} floors; check it against photos`, finalArea);
    }
    out.push(changed ? { ...f, ring, area: r2(finalArea) } : f);
  }
  return { footprints: out, lines, counts };
}
