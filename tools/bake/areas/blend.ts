// Edge blending of the area profiles (P2-009, DELHI_WORLD.md 10 EB1): the weight of every profile at a point.
//
// - Inside a drawn area, away from its edge, the area's profile has weight 1. In the ground the rules cover, the
//   weight is shared by the archetypes of the 100 m rule cells around the point (a tent of 200 m, so the rule map has
//   no step at a cell line).
// - Across the edge of a drawn area the weight of its profile falls in a straight line from 1 (one band depth inside)
//   through 0.5 (on the line) to 0 (one band depth outside); what it gives up goes to the profile on the other side.
//   So the mix changes in one direction across the band and never jumps at the line.
// - The band depth on each side is the area's `blend_m` times 1.5 on a plain edge and times 0.7 where the edge runs
//   along a road or a rail line (a seam), and never under 85 m: 170 m from one profile to the other keeps every step
//   between two samples 25 m apart under 20 percent (25 / 170 = 0.15, with room for the rule cells changing under
//   it and for a second edge near by, as in the ring of the Connaught Place outer circle). The seam share of an
//   edge is smoothed along it, so the depth does not jump where a road leaves the edge.
// A parcel picks one profile with these weights (plan.ts), so near an edge the buildings of two areas interleave.
// Pure.
import type { P2 } from '../geom.ts';
import { cellKey, cellOf } from './rules.ts';
import type { AreaIndex } from './profiles.ts';

export const BLEND = {
  /** Smallest band depth on each side of an edge (m). */
  sideMinM: 85,
  plainFactor: 1.5,
  seamFactor: 0.7,
  /** An edge point this near a road centre line or a rail line is on a seam (m). */
  seamNearM: 16,
  /** Spacing of the edge samples (m) and the half window the seam share is averaged over (m). */
  sampleM: 8,
  smoothM: 48,
  /** Half width of the tent the rule cells are mixed with (m). */
  ruleTentM: 200,
} as const;

export interface Weight {
  key: string;
  w: number;
}

interface Edge {
  /** Sample points along a ring (closed: the last joins the first) and the seam share at each. */
  pts: P2[];
  seam: Float64Array;
}

interface BandArea {
  id: string;
  key: string;
  blend: number;
  box: [number, number, number, number];
  polys: P2[][][];
  edges: Edge[];
}

const inRing = (x: number, z: number, ring: readonly P2[]): boolean => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as P2;
    const b = ring[j] as P2;
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
};

const inPolys = (x: number, z: number, polys: readonly P2[][][]): boolean => polys.some((poly) => inRing(x, z, poly[0] as P2[]) && !poly.slice(1).some((h) => inRing(x, z, h)));

/** A closed ring as sample points at most `step` apart (the corners stay). */
function sampleRing(ring: readonly P2[], step: number): P2[] {
  const pts = ring.length > 1 && (ring[0] as P2).x === (ring[ring.length - 1] as P2).x && (ring[0] as P2).z === (ring[ring.length - 1] as P2).z ? ring.slice(0, -1) : ring.slice();
  const out: P2[] = [];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k] as P2;
    const b = pts[(k + 1) % pts.length] as P2;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let s = 0; s < n; s++) out.push({ x: a.x + ((b.x - a.x) * s) / n, z: a.z + ((b.z - a.z) * s) / n });
  }
  return out;
}

export class AreaSampler {
  private readonly areas: BandArea[];
  private readonly cells: Map<string, string>;
  private readonly cellM: number;
  private readonly fallback: string;
  private readonly reach: number;

  /** `seams`: the centre lines of the roads and the rail lines that count as seams (block metres). */
  constructor(index: AreaIndex, seams: readonly (readonly P2[])[]) {
    // seam points by 16 m cell
    const grid = new Map<number, number[]>();
    const gk = (i: number, j: number): number => (i + 32768) * 65536 + (j + 32768);
    for (const line of seams) {
      for (let k = 0; k + 1 < line.length; k++) {
        const a = line[k] as P2;
        const b = line[k + 1] as P2;
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 5));
        for (let s = 0; s <= n; s++) {
          const x = a.x + ((b.x - a.x) * s) / n;
          const z = a.z + ((b.z - a.z) * s) / n;
          const key = gk(Math.floor(x / 16), Math.floor(z / 16));
          const list = grid.get(key);
          if (list) list.push(x, z);
          else grid.set(key, [x, z]);
        }
      }
    }
    const nearSeam = (p: P2): boolean => {
      const r = BLEND.seamNearM;
      for (let i = Math.floor((p.x - r) / 16); i <= Math.floor((p.x + r) / 16); i++) {
        for (let j = Math.floor((p.z - r) / 16); j <= Math.floor((p.z + r) / 16); j++) {
          const list = grid.get(gk(i, j));
          if (!list) continue;
          for (let k = 0; k < list.length; k += 2) if (Math.hypot((list[k] as number) - p.x, (list[k + 1] as number) - p.z) <= r) return true;
        }
      }
      return false;
    };
    const half = Math.round(BLEND.smoothM / BLEND.sampleM);
    this.areas = index.areas.map((a) => {
      const edges: Edge[] = a.rings.map((ring) => {
        const pts = sampleRing(ring, BLEND.sampleM);
        const raw = pts.map((p) => (nearSeam(p) ? 1 : 0));
        const seam = new Float64Array(pts.length);
        for (let k = 0; k < pts.length; k++) {
          let sum = 0;
          for (let d = -half; d <= half; d++) sum += raw[(((k + d) % pts.length) + pts.length) % pts.length] as number;
          seam[k] = sum / (2 * half + 1);
        }
        return { pts, seam };
      });
      return { id: a.id, key: `area:${a.id}`, blend: a.blend_m, box: a.box, polys: a.polys, edges };
    });
    this.cells = index.cells;
    this.cellM = index.cellM;
    this.fallback = index.fallback;
    this.reach = Math.max(BLEND.sideMinM, ...this.areas.map((a) => a.blend * BLEND.plainFactor)) + 1;
  }

  /** The drawn area holding a point (the first in file order), or null. */
  areaAt(x: number, z: number): string | null {
    for (const a of this.areas) if (x >= a.box[0] && x <= a.box[1] && z >= a.box[2] && z <= a.box[3] && inPolys(x, z, a.polys)) return a.id;
    return null;
  }

  /** The nearest point of an area's edge: distance, the point and the band depth there. */
  private edgeOf(a: BandArea, x: number, z: number, edges: readonly Edge[] = a.edges): { d: number; qx: number; qz: number; nx: number; nz: number; depth: number } {
    let best = Infinity;
    let qx = x;
    let qz = z;
    let nx = 0;
    let nz = 0;
    let seam = 0;
    for (const e of edges) {
      const n = e.pts.length;
      for (let k = 0; k < n; k++) {
        const p = e.pts[k] as P2;
        const q = e.pts[(k + 1) % n] as P2;
        const dx = q.x - p.x;
        const dz = q.z - p.z;
        const l2 = dx * dx + dz * dz;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - p.x) * dx + (z - p.z) * dz) / l2)) : 0;
        const cx = p.x + dx * t;
        const cz = p.z + dz * t;
        const d = Math.hypot(x - cx, z - cz);
        if (d < best) {
          best = d;
          qx = cx;
          qz = cz;
          const l = Math.sqrt(l2) || 1;
          nx = dz / l;
          nz = -dx / l;
          seam = (e.seam[k] as number) * (1 - t) + (e.seam[(k + 1) % n] as number) * t;
        }
      }
    }
    const plain = Math.max(BLEND.sideMinM, a.blend * BLEND.plainFactor);
    const onSeam = Math.max(BLEND.sideMinM, a.blend * BLEND.seamFactor);
    return { d: best, qx, qz, nx, nz, depth: plain + (onSeam - plain) * seam };
  }

  /** The archetypes of the rule cells round a point with their tent weights (sum 1), or empty where no cell is. */
  ruleMix(x: number, z: number): Map<string, number> {
    const h = BLEND.ruleTentM;
    const c = this.cellM;
    const out = new Map<string, number>();
    let total = 0;
    const [i0, j0] = cellOf(x - h, z - h, c);
    const [i1, j1] = cellOf(x + h, z + h, c);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const a = this.cells.get(cellKey(i, j));
        if (!a) continue;
        const w = Math.max(0, 1 - Math.abs(x - (i + 0.5) * c) / h) * Math.max(0, 1 - Math.abs(z - (j + 0.5) * c) / h);
        if (w <= 0) continue;
        out.set(`rule:${a}`, (out.get(`rule:${a}`) ?? 0) + w);
        total += w;
      }
    }
    if (total > 0) for (const [k, w] of out) out.set(k, w / total);
    return out;
  }

  /** The weight of every profile at a point: sorted by key, summing to 1. */
  weightsAt(x: number, z: number): Weight[] {
    const home = this.areaAt(x, z);
    const out = new Map<string, number>();
    let others = 0;
    let toRule = 0;
    for (const a of this.areas) {
      const r = this.reach;
      if (x < a.box[0] - r || x > a.box[1] + r || z < a.box[2] - r || z > a.box[3] + r) continue;
      if (a.id === home) {
        // each ring of its own edge (the outline, a hole) on its own. What lies across the nearest point: another
        // drawn area takes its share by its own band (below); rule ground takes it here
        for (const ring of a.edges) {
          const e = this.edgeOf(a, x, z, [ring]);
          if (e.d >= e.depth) continue;
          // the far side of the edge: 3 m off the nearest point, on the side that is not this area
          const s1 = this.areaAt(e.qx + e.nx * 3, e.qz + e.nz * 3);
          const s2 = this.areaAt(e.qx - e.nx * 3, e.qz - e.nz * 3);
          const across = s1 !== home ? s1 : s2;
          if (across === null) toRule = Math.max(toRule, 0.5 * (1 - e.d / e.depth));
        }
      } else {
        const e = this.edgeOf(a, x, z);
        if (e.d >= e.depth) continue;
        const share = 0.5 * (1 - e.d / e.depth);
        out.set(a.key, share);
        others += share;
      }
    }
    const rule = this.ruleMix(x, z);
    if (home !== null) {
      if (!rule.size) toRule = 0;
      const sum = others + toRule;
      const scale = sum > 0.66 ? 0.66 / sum : 1;
      for (const [k, w] of out) out.set(k, w * scale);
      out.set(`area:${home}`, 1 - sum * scale);
      for (const [k, w] of rule) out.set(k, (out.get(k) ?? 0) + w * toRule * scale);
    } else {
      const scale = others > 1 ? 1 / others : 1;
      for (const [k, w] of out) out.set(k, w * scale);
      const rest = 1 - others * scale;
      if (rule.size) for (const [k, w] of rule) out.set(k, (out.get(k) ?? 0) + w * rest);
      else if (out.size) for (const [k, w] of out) out.set(k, w / (others * scale));
      else out.set(`rule:${this.fallback}`, 1);
    }
    return [...out.entries()].filter(([, w]) => w > 1e-9).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([key, w]) => ({ key, w }));
  }
}

/** Half the sum of the absolute weight differences of two mixes (0 the same, 1 nothing shared). */
export function mixStep(a: readonly Weight[], b: readonly Weight[]): number {
  const m = new Map<string, number>();
  for (const w of a) m.set(w.key, w.w);
  for (const w of b) m.set(w.key, (m.get(w.key) ?? 0) - w.w);
  let s = 0;
  for (const v of m.values()) s += Math.abs(v);
  return s / 2;
}

export interface TransectSample {
  /** Metres along the transect. */
  at: number;
  x: number;
  z: number;
  weights: Weight[];
  /** The change from the sample before (0 to 1). */
  step: number;
}

export interface Transect {
  id: string;
  name: string;
  /** The drawn area whose edge it crosses: its profile's weight must only fall along the transect. */
  area: string;
  samples: TransectSample[];
  maxStep: number;
  /** The largest rise of the area's own weight between two samples (0 when it only falls). */
  maxRise: number;
  /** The area's weight at the first and the last sample. */
  from: number;
  to: number;
}

/** Samples the profile mix every `stepM` along a line from a to b. */
export function transect(sampler: AreaSampler, id: string, name: string, area: string, a: P2, b: P2, stepM = 25): Transect {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.floor(len / stepM);
  const samples: TransectSample[] = [];
  let maxStep = 0;
  let maxRise = 0;
  const own = (w: readonly Weight[]): number => w.find((v) => v.key === `area:${area}`)?.w ?? 0;
  for (let k = 0; k <= n; k++) {
    const x = a.x + ((b.x - a.x) * k * stepM) / len;
    const z = a.z + ((b.z - a.z) * k * stepM) / len;
    const weights = sampler.weightsAt(x, z);
    const prev = samples[samples.length - 1];
    const step = prev ? mixStep(prev.weights, weights) : 0;
    if (prev) maxRise = Math.max(maxRise, own(weights) - own(prev.weights));
    maxStep = Math.max(maxStep, step);
    samples.push({ at: k * stepM, x, z, weights, step });
  }
  return { id, name, area, samples, maxStep, maxRise, from: own(samples[0]?.weights ?? []), to: own(samples[samples.length - 1]?.weights ?? []) };
}
