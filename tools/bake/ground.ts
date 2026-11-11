// Ground height sources: reading a height grid, the ground filter of option GS2 (keep only open cells of a surface
// model and fit a smooth surface through them), and the profile measures the terrain bench compares sources with.
import type { P2 } from './geom.ts';

/** A north-up height grid in WGS84 degrees: row 0 is the north row, values in metres, NaN for no data. */
export interface HeightGrid {
  west: number;
  north: number;
  /** Cell size in degrees: dLon positive, dLat negative (rows run south). */
  dLon: number;
  dLat: number;
  width: number;
  height: number;
  data: Float32Array | Float64Array | number[];
  /** True when a value belongs to the cell centre (GeoTIFF "area"), false when to the cell corner ("point"). */
  cellCentre: boolean;
}

/** Height at a point by bilinear interpolation between the four nearest cell values; null outside or at no data. */
export function sampleGrid(g: HeightGrid, lat: number, lon: number): number | null {
  const half = g.cellCentre ? 0.5 : 0;
  const fx = (lon - g.west) / g.dLon - half;
  const fy = (lat - g.north) / g.dLat - half;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= g.width || y0 + 1 >= g.height) return null;
  const tx = fx - x0;
  const ty = fy - y0;
  const v00 = g.data[y0 * g.width + x0] as number;
  const v10 = g.data[y0 * g.width + x0 + 1] as number;
  const v01 = g.data[(y0 + 1) * g.width + x0] as number;
  const v11 = g.data[(y0 + 1) * g.width + x0 + 1] as number;
  const v = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
  return Number.isFinite(v) ? v : null;
}

export interface GroundSample extends P2 {
  h: number;
}

export interface GroundSurface {
  /** Height of the fitted surface at a point (metres), null when no sample is near. */
  at(x: number, z: number): number | null;
  kept: number;
  dropped: number;
}

export interface FilterOptions {
  /** Radius (m) of the Gaussian that smooths the kept samples. */
  sigma: number;
  /** A sample this far above the fitted surface is a roof or a tree left in: dropped, then the fit is repeated. */
  dropAbove: number;
  passes: number;
}

export const FILTER_DEFAULTS: FilterOptions = { sigma: 60, dropAbove: 1.5, passes: 3 };

/**
 * GS2 ground filter: a smooth surface through samples of a surface model that were taken on open ground only
 * (the caller keeps roads, parks and open ground and leaves out cells under buildings). Samples that stand above
 * the fit are dropped and the fit repeated, because a 30 m cell beside a building still holds part of its roof.
 */
export function fitGround(samples: readonly GroundSample[], opts: FilterOptions = FILTER_DEFAULTS): GroundSurface {
  let live = samples.slice();
  const cell = opts.sigma;
  let buckets = new Map<string, GroundSample[]>();
  const index = () => {
    buckets = new Map();
    for (const s of live) {
      const key = `${Math.floor(s.x / cell)},${Math.floor(s.z / cell)}`;
      const list = buckets.get(key);
      if (list) list.push(s);
      else buckets.set(key, [s]);
    }
  };
  const at = (x: number, z: number): number | null => {
    const ci = Math.floor(x / cell);
    const cj = Math.floor(z / cell);
    let sum = 0;
    let weight = 0;
    for (let i = ci - 3; i <= ci + 3; i++) {
      for (let j = cj - 3; j <= cj + 3; j++) {
        const list = buckets.get(`${i},${j}`);
        if (!list) continue;
        for (const s of list) {
          const d2 = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
          const w = Math.exp(-d2 / (2 * opts.sigma * opts.sigma));
          sum += s.h * w;
          weight += w;
        }
      }
    }
    return weight > 1e-6 ? sum / weight : null;
  };
  index();
  for (let pass = 1; pass < opts.passes; pass++) {
    const next = live.filter((s) => {
      const fit = at(s.x, s.z);
      return fit === null || s.h - fit <= opts.dropAbove;
    });
    if (next.length === live.length) break;
    live = next;
    index();
  }
  return { at, kept: live.length, dropped: samples.length - live.length };
}

export interface ProfileStats {
  samples: number;
  /** Root mean square of the second difference (m): how bumpy the profile is at the sample spacing. */
  roughness: number;
  /** Largest height change between two neighbouring samples (m). */
  maxStep: number;
  maxGradePct: number;
  min: number;
  max: number;
}

/** Roughness, largest step and steepest grade of a height profile sampled every `step` metres. */
export function profileStats(h: readonly number[], step: number): ProfileStats {
  let sq = 0;
  let n = 0;
  let maxStep = 0;
  for (let i = 1; i < h.length; i++) {
    const d = Math.abs((h[i] as number) - (h[i - 1] as number));
    if (d > maxStep) maxStep = d;
    if (i + 1 < h.length) {
      const second = (h[i + 1] as number) - 2 * (h[i] as number) + (h[i - 1] as number);
      sq += second * second;
      n++;
    }
  }
  const r = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
  return { samples: h.length, roughness: r(n ? Math.sqrt(sq / n) : 0), maxStep: r(maxStep), maxGradePct: r((maxStep / step) * 100, 1), min: r(Math.min(...h), 2), max: r(Math.max(...h), 2) };
}

/** Mean, root mean square and largest absolute value of a list of differences. */
export function diffStats(d: readonly number[]): { n: number; mean: number; rms: number; maxAbs: number } {
  const n = d.length;
  if (n === 0) return { n: 0, mean: 0, rms: 0, maxAbs: 0 };
  const r = (v: number) => Math.round(v * 100) / 100;
  return { n, mean: r(d.reduce((s, v) => s + v, 0) / n), rms: r(Math.sqrt(d.reduce((s, v) => s + v * v, 0) / n)), maxAbs: r(Math.max(...d.map((v) => Math.abs(v)))) };
}
