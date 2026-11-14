// The stand-in massing of placed landmarks and the far silhouettes (P2-006): what fills the LOD slots until the
// parts kit (P2-007) and the hero models arrive. Good enough to judge position, scale and outline, no more:
// - a structure: its footprint (off the roads, on its pad) as a prism to the registry height; a broad one (a mosque
//   with its court) gets a lower body and a crown at its middle that reaches the height;
// - a site: the buildings inside it as prisms on the solved ground (its parts), and the wall line of a fort as a
//   wall with its two heights, open where a road passes;
// - a far silhouette (heroes, and the far landmarks of the backdrop): the same shapes from simpler rings, under the
//   triangle budget, around the landmark's own origin.
// Triangles are in block metres, three vertices each, wound Godot's way (clockwise seen from outside), no edge over
// 60 m so every triangle stays near the tile of its centre. Pure.
import type { P2 } from '../geom.ts';
import { pointInRing, ringArea, ringCentroid } from '../geom.ts';
import { triangulateRing } from '../mesh/solids.ts';
import type { SourceMesh } from '../tile/cutter.ts';
import { FLOOR_M, CLASS_HEIGHT_M, DEFAULT_HEIGHT_M } from '../tile/shells.ts';
import { bearingVector, mainAxis } from './orient.ts';
import { FORT_WALL_M } from './place.ts';
import type { FarPlacement, PlaceFootprint, Placement } from './place.ts';

export const LANDMARK_MATERIALS = ['landmark', 'landmark_red'] as const;
/** The massing starts this far under the lowest ground at its foot (m): no slope shows a gap under a wall. */
const SINK_M = 0.3;
const MAX_EDGE_M = 60;

type V3 = [number, number, number];

class Tris {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  count = 0;
  /** No edge longer than this (m): tile meshes keep near their tile; a far silhouette has no such need. */
  private readonly maxEdge: number;
  constructor(maxEdge: number = MAX_EDGE_M) {
    this.maxEdge = maxEdge;
  }

  /** One triangle with its outward normal; halved until no edge is over the limit. */
  add(a: V3, b: V3, c: V3, n: V3, limit = this.maxEdge): void {
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const bc = Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]);
    const ca = Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]);
    const longest = Math.max(ab, bc, ca);
    if (longest > limit) {
      const mid = (p: V3, q: V3): V3 => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
      if (longest === ab) {
        const m = mid(a, b);
        this.add(a, m, c, n, limit);
        this.add(m, b, c, n, limit);
      } else if (longest === bc) {
        const m = mid(b, c);
        this.add(a, b, m, n, limit);
        this.add(a, m, c, n, limit);
      } else {
        const m = mid(c, a);
        this.add(a, b, m, n, limit);
        this.add(m, b, c, n, limit);
      }
      return;
    }
    // Godot front faces: (b - a) x (c - a) points away from the side the normal shows
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const facing = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
    for (const p of facing > 0 ? [a, c, b] : [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(n[0], n[1], n[2]);
    }
    this.count++;
  }

  /** A prism over a ring from `base` to `top` (side walls and a flat roof). */
  prism(ring: readonly P2[], base: number, top: number): void {
    const r = ring.length > 1 && (ring[0] as P2).x === (ring[ring.length - 1] as P2).x && (ring[0] as P2).z === (ring[ring.length - 1] as P2).z ? ring.slice(0, -1) : ring.slice();
    if (r.length < 3 || Math.abs(ringArea(r)) < 1 || top - base < 0.2) return;
    const sign = ringArea(r) > 0 ? 1 : -1;
    for (let i = 0; i < r.length; i++) {
      const p = r[i] as P2;
      const q = r[(i + 1) % r.length] as P2;
      const len = Math.hypot(q.x - p.x, q.z - p.z);
      if (len < 1e-3) continue;
      const n: V3 = [(sign * (q.z - p.z)) / len, 0, (-sign * (q.x - p.x)) / len];
      this.add([p.x, base, p.z], [q.x, base, q.z], [q.x, top, q.z], n);
      this.add([p.x, base, p.z], [q.x, top, q.z], [p.x, top, p.z], n);
    }
    const idx = triangulateRing(r.map((p) => [p.x, p.z] as [number, number]));
    for (let k = 0; k + 2 < idx.length; k += 3) {
      const [a, b, c] = [r[idx[k] as number] as P2, r[idx[k + 1] as number] as P2, r[idx[k + 2] as number] as P2];
      this.add([a.x, top, a.z], [b.x, top, b.z], [c.x, top, c.z], [0, 1, 0]);
    }
  }

  /** A wall along a line from p to q: a box `thick` wide on the left... centred on the line, with a top from hp to hq. */
  wall(p: P2, q: P2, basep: number, baseq: number, hp: number, hq: number, thick: number): void {
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    if (len < 0.05) return;
    const tx = (q.x - p.x) / len;
    const tz = (q.z - p.z) / len;
    const nx = -tz;
    const nz = tx;
    const h = thick / 2;
    // the box reaches half its thickness past both ends, so two segments close their corner
    const a: P2 = { x: p.x - tx * h, z: p.z - tz * h };
    const b: P2 = { x: q.x + tx * h, z: q.z + tz * h };
    const c = (pt: P2, side: number, y: number): V3 => [pt.x + nx * h * side, y, pt.z + nz * h * side];
    for (const side of [1, -1]) {
      const n: V3 = [nx * side, 0, nz * side];
      this.add(c(a, side, basep), c(b, side, baseq), c(b, side, hq), n);
      this.add(c(a, side, basep), c(b, side, hq), c(a, side, hp), n);
    }
    this.add(c(a, 1, hp), c(b, 1, hq), c(b, -1, hq), [0, 1, 0]);
    this.add(c(a, 1, hp), c(b, -1, hq), c(a, -1, hp), [0, 1, 0]);
    this.add(c(a, 1, basep), c(a, -1, basep), c(a, -1, hp), [-tx, 0, -tz]);
    this.add(c(a, 1, basep), c(a, -1, hp), c(a, 1, hp), [-tx, 0, -tz]);
    this.add(c(b, 1, baseq), c(b, -1, baseq), c(b, -1, hq), [tx, 0, tz]);
    this.add(c(b, 1, baseq), c(b, -1, hq), c(b, 1, hq), [tx, 0, tz]);
  }
}

/** A structure broader than this many times its height gets a body and a crown, not one tall block. */
const BROAD = 1.6;

/** The two tiers of a structure's massing: the body height and, for a broad one, the crown ring at its middle. */
export function tiersOf(ring: readonly P2[], height: number): { bodyH: number; crown: P2[] | null } {
  const side = Math.sqrt(Math.abs(ringArea(ring as P2[])));
  if (side <= height * BROAD) return { bodyH: height, crown: null };
  const bodyH = Math.max(Math.min(height, 6), Math.round(height * 0.4 * 10) / 10);
  const ax = mainAxis(ring);
  if (!ax || bodyH >= height) return { bodyH, crown: null };
  // the crown: a rectangle along the main axis at the middle of the footprint, a third of its size
  const u = bearingVector(ax.axisDeg);
  const v = { x: -u.z, z: u.x };
  const c = ringCentroid(ring as P2[]);
  const centre = pointInRing(ax.centre, ring as P2[]) ? ax.centre : c;
  const hl = Math.max(3, ax.lengthM * 0.17);
  const hw = Math.max(3, ax.widthM * 0.17);
  const crown = [
    { x: centre.x + u.x * hl + v.x * hw, z: centre.z + u.z * hl + v.z * hw }, { x: centre.x - u.x * hl + v.x * hw, z: centre.z - u.z * hl + v.z * hw },
    { x: centre.x - u.x * hl - v.x * hw, z: centre.z - u.z * hl - v.z * hw }, { x: centre.x + u.x * hl - v.x * hw, z: centre.z + u.z * hl - v.z * hw },
  ];
  return { bodyH, crown };
}

/** A gate or an arch: the share of its long side that is the opening, and how high the opening reaches. */
const GATE_OPENING = 0.34;
const GATE_OPENING_H = 0.62;

/**
 * The stand-in shape of a structure on its ring: prisms as [ring, from, to] in metres above its foot. A gate or an
 * arch is two piers and a lintel over the passage through its short side; a broad structure a body with a crown;
 * anything else one block.
 */
export function structureShapes(ring: readonly P2[], height: number, shape: 'block' | 'gate'): { ring: P2[]; from: number; to: number }[] {
  const ax = shape === 'gate' ? mainAxis(ring) : null;
  if (ax && ax.fill > 0.8 && height > 4) {
    const u = bearingVector(ax.axisDeg);
    const v = { x: -u.z, z: u.x };
    const hl = ax.lengthM / 2;
    const hw = ax.widthM / 2;
    const rect = (a0: number, a1: number): P2[] => [
      { x: ax.centre.x + u.x * a0 + v.x * hw, z: ax.centre.z + u.z * a0 + v.z * hw }, { x: ax.centre.x + u.x * a1 + v.x * hw, z: ax.centre.z + u.z * a1 + v.z * hw },
      { x: ax.centre.x + u.x * a1 - v.x * hw, z: ax.centre.z + u.z * a1 - v.z * hw }, { x: ax.centre.x + u.x * a0 - v.x * hw, z: ax.centre.z + u.z * a0 - v.z * hw },
    ];
    const open = hl * GATE_OPENING;
    const top = Math.round(height * GATE_OPENING_H * 10) / 10;
    return [{ ring: rect(-hl, -open), from: 0, to: top }, { ring: rect(open, hl), from: 0, to: top }, { ring: rect(-hl, hl), from: top, to: height }];
  }
  const t = tiersOf(ring, height);
  const out = [{ ring: ring.slice(), from: 0, to: t.bodyH }];
  if (t.crown) out.push({ ring: t.crown, from: t.bodyH - 0.1, to: height });
  return out;
}

/** The height of a part of a site: its own data, else the class default of its building tag (as the plain shells). */
export function partHeight(f: PlaceFootprint): number {
  if (f.height !== null && f.height >= 2.2) return Math.min(200, f.height);
  if (f.levels !== null && f.levels >= 1) return Math.min(200, f.levels * FLOOR_M);
  const cls = f.tags['building'];
  return (cls !== undefined ? CLASS_HEIGHT_M[cls] : undefined) ?? DEFAULT_HEIGHT_M;
}

export interface MassingRecord {
  id: string;
  triangles: number;
  /** Lowest foot and highest top (m). */
  baseM: number;
  topM: number;
  /** Top above the pad or the ground at its position (m). */
  heightM: number;
  parts: number;
  wallM: number;
  /** Wall length left open where a road passes (m). */
  gateM: number;
}

/** What the parts kit builds instead (P2-007, kit.ts): the body and wall line of these landmarks, and these parts. */
export interface KitSkip {
  ids: ReadonlySet<string>;
  parts: ReadonlySet<string>;
}
const NO_KIT: KitSkip = { ids: new Set(), parts: new Set() };

export interface Massing {
  meshes: SourceMesh[];
  records: MassingRecord[];
  triangles: number;
}

/**
 * The massing of every placed landmark, in block metres. `ground` is the solved ground (NaN under a road),
 * `fallback` the ground model.
 */
export function buildMassing(placements: readonly Placement[], footprints: ReadonlyMap<string, PlaceFootprint>, ground: (x: number, z: number) => number, fallback: (x: number, z: number) => number, kit: KitSkip = NO_KIT): Massing {
  const sets: Record<string, Tris> = { landmark: new Tris(), landmark_red: new Tris() };
  const records: MassingRecord[] = [];
  const at = (x: number, z: number): number => {
    const y = ground(x, z);
    return Number.isFinite(y) ? y : fallback(x, z);
  };
  for (const p of placements) {
    const out = sets[p.material] as Tris;
    const before = out.count;
    let base = Infinity;
    let top = -Infinity;
    let parts = 0;
    let wallM = 0;
    let gateM = 0;
    const byKit = kit.ids.has(p.id);
    if (p.mode === 'structure' && p.pad && !byKit) {
      const lo = p.pad.level - SINK_M;
      for (const ring of p.body) {
        // the piers of a gate and the body of a block go down into the pad; what stands on them starts where they end
        for (const sh of structureShapes(ring, p.massingHeightM, p.shape)) out.prism(sh.ring, sh.from === 0 ? lo : p.pad.level + sh.from, p.pad.level + sh.to);
        base = Math.min(base, lo);
        top = Math.max(top, p.pad.level + p.massingHeightM);
        parts++;
      }
    }
    for (const id of p.partIds) {
      const f = footprints.get(id);
      if (!f || kit.parts.has(id)) continue;
      let lo = Infinity;
      let hi = -Infinity;
      for (const q of f.ring) {
        const y = at(q.x, q.z);
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
      const h = partHeight(f);
      out.prism(f.ring, lo - SINK_M, hi + h);
      base = Math.min(base, lo - SINK_M);
      top = Math.max(top, hi + h);
      parts++;
    }
    for (const w of byKit ? [] : p.walls) {
      const n = w.pts.length;
      for (let k = 0; k < (w.closed ? n : n - 1); k++) {
        const a = w.pts[k] as P2;
        const b = w.pts[(k + 1) % n] as P2;
        const ha = w.heights[k] as number;
        const hb = w.heights[(k + 1) % n] as number;
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const steps = Math.max(1, Math.ceil(len / 20));
        for (let i = 0; i < steps; i++) {
          const t0 = i / steps;
          const t1 = (i + 1) / steps;
          const s: P2 = { x: a.x + (b.x - a.x) * t0, z: a.z + (b.z - a.z) * t0 };
          const e: P2 = { x: a.x + (b.x - a.x) * t1, z: a.z + (b.z - a.z) * t1 };
          // a wall piece whose ends or middle lie on a road is a gate: left open
          const gs = ground(s.x, s.z);
          const ge = ground(e.x, e.z);
          const gm = ground((s.x + e.x) / 2, (s.z + e.z) / 2);
          if (!Number.isFinite(gs) || !Number.isFinite(ge) || !Number.isFinite(gm)) {
            gateM += len / steps;
            continue;
          }
          const h0 = ha + (hb - ha) * t0;
          const h1 = ha + (hb - ha) * t1;
          out.wall(s, e, gs - SINK_M, ge - SINK_M, gs + h0, ge + h1, FORT_WALL_M);
          base = Math.min(base, gs - SINK_M, ge - SINK_M);
          top = Math.max(top, gs + h0, ge + h1);
          wallM += len / steps;
        }
      }
    }
    if (out.count > before) records.push({ id: p.id, triangles: out.count - before, baseM: r2(base), topM: r2(top), heightM: r2(top - p.y), parts, wallM: Math.round(wallM), gateM: Math.round(gateM) });
  }
  const meshes: SourceMesh[] = LANDMARK_MATERIALS.filter((m) => (sets[m] as Tris).count > 0).map((m) => {
    const out = sets[m] as Tris;
    return { material: m, pos: out.pos, nrm: out.nrm, uv: [], uv2: [], idx: Array.from({ length: out.count * 3 }, (_, i) => i) };
  });
  return { meshes, records, triangles: LANDMARK_MATERIALS.reduce((n, m) => n + (sets[m] as Tris).count, 0) };
}

const r2 = (v: number): number => Math.round(v * 100) / 100;

// ------------------------------------------------------------------ far silhouettes

export interface Silhouette {
  id: string;
  /** World metres of its origin (the landmark's position, at its foot). */
  origin: [number, number, number];
  /** Metres from the origin, three numbers per vertex; three vertices per triangle (Godot winding). */
  pos: number[];
  triangles: number;
  heightM: number;
  from: 'massing' | 'type';
}

/** A ring with fewer points: every point nearer than `tol` to the line of its neighbours goes (Douglas-Peucker on a closed ring). */
export function simplifyRing(ring: readonly P2[], tol: number): P2[] {
  if (ring.length <= 4) return ring.slice();
  // split at the two points furthest apart, simplify both halves
  let ia = 0;
  let ib = 1;
  let far = -1;
  for (let i = 0; i < ring.length; i++) {
    for (let j = i + 1; j < ring.length; j++) {
      const d = Math.hypot((ring[i] as P2).x - (ring[j] as P2).x, (ring[i] as P2).z - (ring[j] as P2).z);
      if (d > far) {
        far = d;
        ia = i;
        ib = j;
      }
    }
  }
  const dp = (pts: P2[]): P2[] => {
    if (pts.length <= 2) return pts;
    const a = pts[0] as P2;
    const b = pts[pts.length - 1] as P2;
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    let worst = 0;
    let wi = -1;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i] as P2;
      const d = Math.abs((b.x - a.x) * (a.z - p.z) - (a.x - p.x) * (b.z - a.z)) / len;
      if (d > worst) {
        worst = d;
        wi = i;
      }
    }
    if (worst <= tol) return [a, b];
    return [...dp(pts.slice(0, wi + 1)).slice(0, -1), ...dp(pts.slice(wi))];
  };
  const first = dp(ring.slice(ia, ib + 1));
  const second = dp([...ring.slice(ib), ...ring.slice(0, ia + 1)]);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

/** A stand-in outline for a landmark that has no footprint here (a far landmark), from its type and height. */
function typeSilhouette(t: Tris, type: string, h: number): void {
  const kind = type.toLowerCase();
  const lathe = (profile: [number, number][], seg: number): void => {
    for (let k = 0; k + 1 < profile.length; k++) {
      const [r0, y0] = profile[k] as [number, number];
      const [r1, y1] = profile[k + 1] as [number, number];
      for (let s = 0; s < seg; s++) {
        const a0 = (2 * Math.PI * s) / seg;
        const a1 = (2 * Math.PI * (s + 1)) / seg;
        const am = (a0 + a1) / 2;
        const slope = Math.atan2(r0 - r1, y1 - y0);
        const n: V3 = [Math.cos(am) * Math.cos(slope), Math.sin(slope), Math.sin(am) * Math.cos(slope)];
        const p = (r: number, y: number, a: number): V3 => [r * Math.cos(a), y, r * Math.sin(a)];
        if (r0 > 1e-6) t.add(p(r0, y0, a0), p(r0, y0, a1), p(r1, y1, a1), n);
        if (r1 > 1e-6) t.add(p(r0, y0, a0), p(r1, y1, a1), p(r1, y1, a0), n);
      }
    }
  };
  const box = (w: number, d: number, y0: number, y1: number): void => t.prism([{ x: -w / 2, z: -d / 2 }, { x: w / 2, z: -d / 2 }, { x: w / 2, z: d / 2 }, { x: -w / 2, z: d / 2 }], y0, y1);
  if (/minaret|tower|minar/.test(kind)) {
    lathe([[h * 0.1, 0], [h * 0.07, h * 0.45], [h * 0.05, h * 0.75], [h * 0.035, h * 0.97], [0, h]], 16);
  } else if (/temple|tomb|mausoleum|mosque|masjid|palace|presidential|dome/.test(kind)) {
    box(h * 2.2, h * 1.6, 0, h * 0.45);
    lathe([[h * 0.42, h * 0.45], [h * 0.4, h * 0.62], [h * 0.3, h * 0.82], [h * 0.14, h * 0.95], [0, h]], 16);
  } else {
    box(h * 2, h * 1.4, 0, h * 0.7);
    box(h * 0.7, h * 0.5, h * 0.7, h);
  }
}

/**
 * The far silhouette of a placed hero: its massing from simpler shapes, around its own origin, under the budget.
 * A structure: its body rings simplified. A site: its wall line simplified and its largest parts as boxes.
 */
export function heroSilhouette(p: Placement, footprints: ReadonlyMap<string, PlaceFootprint>, y: number, budget: number): Silhouette {
  let tol = 0.5;
  for (let round = 0; round < 12; round++) {
    const t = new Tris(Infinity);
    const o = { x: p.x, z: p.z };
    const local = (ring: readonly P2[]): P2[] => ring.map((q) => ({ x: q.x - o.x, z: q.z - o.z }));
    if (p.mode === 'structure') {
      for (const ring of p.body) {
        const s = simplifyRing(ring, tol);
        for (const sh of structureShapes(s, p.massingHeightM, p.shape)) t.prism(local(sh.ring), sh.from, sh.to);
      }
    }
    for (const w of p.walls) {
      // the wall as a prism ring: outer face only matters from afar, so one thin prism per simplified segment
      const s = simplifyRing(w.pts, tol * 4);
      const hMax = Math.max(...w.heights);
      const hMin = Math.min(...w.heights);
      const c = ringCentroid(w.pts as P2[]);
      const front = p.yawDeg !== null && p.frontKnown ? bearingVector(p.yawDeg) : null;
      const hAt = (q: P2): number => {
        if (!front) return hMax;
        const len = Math.hypot(q.x - c.x, q.z - c.z) || 1;
        return hMin + (hMax - hMin) * Math.max(0, Math.min(1, (((q.x - c.x) * front.x + (q.z - c.z) * front.z) / len + 0.35) / 0.7));
      };
      for (let k = 0; k < s.length; k++) {
        const a = s[k] as P2;
        const b = s[(k + 1) % s.length] as P2;
        t.wall({ x: a.x - o.x, z: a.z - o.z }, { x: b.x - o.x, z: b.z - o.z }, 0, 0, hAt(a), hAt(b), FORT_WALL_M);
      }
    }
    // parts: the largest first, as the boxes of their main axis, while the budget lasts
    const parts = p.partIds.map((id) => footprints.get(id)).filter((f): f is PlaceFootprint => !!f).map((f) => ({ f, area: Math.abs(ringArea(f.ring as P2[])) })).sort((a, b) => b.area - a.area || (a.f.id < b.f.id ? -1 : 1));
    for (const { f } of parts) {
      if (t.count + 12 > budget) break;
      const ax = mainAxis(f.ring);
      if (!ax) continue;
      const u = bearingVector(ax.axisDeg);
      const v = { x: -u.z, z: u.x };
      const c = { x: ax.centre.x - o.x, z: ax.centre.z - o.z };
      const hl = ax.lengthM / 2;
      const hw = ax.widthM / 2;
      t.prism([{ x: c.x + u.x * hl + v.x * hw, z: c.z + u.z * hl + v.z * hw }, { x: c.x - u.x * hl + v.x * hw, z: c.z - u.z * hl + v.z * hw }, { x: c.x - u.x * hl - v.x * hw, z: c.z - u.z * hl - v.z * hw }, { x: c.x + u.x * hl - v.x * hw, z: c.z + u.z * hl - v.z * hw }], 0, partHeight(f));
    }
    if (t.count <= budget || round === 11) {
      let top = 0;
      for (let i = 1; i < t.pos.length; i += 3) top = Math.max(top, t.pos[i] as number);
      return { id: p.id, origin: [p.wx, r2(y), p.wz], pos: t.pos.map(r2), triangles: t.count, heightM: r2(top), from: 'massing' };
    }
    tol *= 2;
  }
  throw new Error('unreachable');
}

/** The silhouette of a far landmark of the backdrop, from its type and height. */
export function farSilhouette(f: FarPlacement, y: number): Silhouette {
  const t = new Tris(Infinity);
  const h = f.heightM ?? 30;
  typeSilhouette(t, f.type, h);
  return { id: f.id, origin: [f.wx, r2(y), f.wz], pos: t.pos.map(r2), triangles: t.count, heightM: h, from: 'type' };
}
