// The bake's ground model (P1-007, MAP_REPAIR.md "Sources", ARCH_OPTIONS GS1 and GS2): GEDTM30 smoothed over 60 m,
// with Copernicus GLO-30 through the ground filter as the fallback. FABDEM is never read. Pure: the driver reads the
// pinned files (tools/bake/sources/ground.ts) and passes the grids in. The result is a regular grid in block metres
// with bilinear lookups, the fast form later stages sample many times.
import type { Projector } from '../geo/projection.ts';
import type { Box2 } from './geom.ts';
import { fitGround } from './ground.ts';
import type { GroundSample, HeightGrid } from './ground.ts';

/** The saved GEDTM30 window (tools/bake/sources/readers.ts readGedtm). */
export interface GedtmWindow {
  west: number;
  north: number;
  dLon: number;
  dLat: number;
  width: number;
  height: number;
  scale: number;
  offset: number;
  noData: number | null;
  pixelIsPoint?: boolean;
  values: number[];
}

/** The window as a HeightGrid in metres (no data and the float fill value become NaN). */
export function gedtmGrid(w: GedtmWindow): HeightGrid {
  const data = Float32Array.from(w.values, (v) => (v === w.noData || !Number.isFinite(v) || Math.abs(v) > 1e30 ? NaN : v * w.scale + w.offset));
  return { west: w.west, north: w.north, dLon: w.dLon, dLat: w.dLat, width: w.width, height: w.height, data, cellCentre: !w.pixelIsPoint };
}

export type GroundSource = 'gedtm30' | 'glo30';

export interface GroundModel {
  source: GroundSource;
  /** How it was made, for the health report. */
  method: string;
  /** Grid in block metres: x0, z0 is the north-west corner, `cell` metres between values. */
  x0: number;
  z0: number;
  cell: number;
  cols: number;
  rows: number;
  h: Float32Array;
  /** Height at a point (bilinear), clamped to the grid edge. */
  at(x: number, z: number): number;
  stats: { samples: number; dropped: number; min: number; max: number; mean: number; holes: number };
}

export interface GroundOptions {
  /** Gaussian radius of the smoothing (m). */
  sigma: number;
  /** Spacing of the output grid (m). */
  cell: number;
  /** Source cells kept this far outside the box (m), so the edge of the grid is smoothed like its middle. */
  pad: number;
}

export const GROUND_DEFAULTS: GroundOptions = { sigma: 60, cell: 10, pad: 300 };

/** Every cell of a height grid near the box as a sample in block metres. `keep` drops cells (the GS2 open-ground test). */
export function gridSamples(g: HeightGrid, proj: Projector, box: Box2, pad: number, keep: (x: number, z: number) => boolean = () => true): GroundSample[] {
  const half = g.cellCentre ? 0.5 : 0;
  const out: GroundSample[] = [];
  for (let j = 0; j < g.height; j++) {
    for (let i = 0; i < g.width; i++) {
      const h = g.data[j * g.width + i] as number;
      if (!Number.isFinite(h)) continue;
      const p = proj.toWorld(g.north + (j + half) * g.dLat, g.west + (i + half) * g.dLon);
      if (p.x < box.minX - pad || p.x > box.maxX + pad || p.z < box.minZ - pad || p.z > box.maxZ + pad) continue;
      if (keep(p.x, p.z)) out.push({ x: p.x, z: p.z, h });
    }
  }
  return out;
}

/** A surface fitted through samples, put on a regular grid over the box. Throws when no sample is near the box. */
function gridModel(source: GroundSource, method: string, samples: readonly GroundSample[], box: Box2, opts: GroundOptions, dropAbove: number, passes: number): GroundModel {
  if (samples.length === 0) throw new Error(`${source}: no height sample near the box`);
  const fit = fitGround(samples, { sigma: opts.sigma, dropAbove, passes });
  const cols = Math.ceil((box.maxX - box.minX) / opts.cell) + 1;
  const rows = Math.ceil((box.maxZ - box.minZ) / opts.cell) + 1;
  const h = new Float32Array(cols * rows);
  let holes = 0;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v = fit.at(box.minX + i * opts.cell, box.minZ + j * opts.cell);
      if (v === null) holes++;
      h[j * cols + i] = v ?? NaN;
      if (v !== null) {
        min = Math.min(min, v);
        max = Math.max(max, v);
        sum += v;
      }
    }
  }
  if (holes) {
    // fill holes with the mean, so a lookup never returns NaN; the count goes to the health report
    const mean = sum / Math.max(1, cols * rows - holes);
    for (let k = 0; k < h.length; k++) if (!Number.isFinite(h[k] as number)) h[k] = mean;
  }
  const x0 = box.minX;
  const z0 = box.minZ;
  const at = (x: number, z: number): number => {
    const fx = Math.max(0, Math.min(cols - 1.000001, (x - x0) / opts.cell));
    const fz = Math.max(0, Math.min(rows - 1.000001, (z - z0) / opts.cell));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const k = j * cols + i;
    return ((h[k] as number) * (1 - u) + (h[k + 1] as number) * u) * (1 - v) + ((h[k + cols] as number) * (1 - u) + (h[k + cols + 1] as number) * u) * v;
  };
  const n = cols * rows - holes;
  return { source, method, x0, z0, cell: opts.cell, cols, rows, h, at, stats: { samples: fit.kept + fit.dropped, dropped: fit.dropped, min, max, mean: sum / Math.max(1, n), holes } };
}

/** GS1: GEDTM30 (a bare-earth model) smoothed over `sigma` metres; no sample is dropped. */
export function smoothedGround(g: HeightGrid, proj: Projector, box: Box2, opts: GroundOptions = GROUND_DEFAULTS): GroundModel {
  return gridModel('gedtm30', `GEDTM30 v1.2 smoothed over ${opts.sigma} m (Gaussian), on a ${opts.cell} m grid`, gridSamples(g, proj, box, opts.pad), box, opts, Infinity, 1);
}

/**
 * GS2: Copernicus GLO-30 (a surface model) through the ground filter: only cells on open ground (`open`, from roads,
 * parks and building footprints when the caller has them), then three passes that drop samples standing more than
 * 1.5 m above the fit (roofs and trees left in).
 */
export function filteredGround(g: HeightGrid, proj: Projector, box: Box2, open: (x: number, z: number) => boolean = () => true, opts: GroundOptions = GROUND_DEFAULTS): GroundModel {
  return gridModel('glo30', `Copernicus GLO-30 through the ground filter (open cells, drop 1.5 m above the fit, 3 passes, Gaussian ${opts.sigma} m), on a ${opts.cell} m grid`, gridSamples(g, proj, box, opts.pad, open), box, opts, 1.5, 3);
}

/** The ground of a stage: GEDTM30 when its window is there, else filtered GLO-30. Throws when neither is there. */
export function pickGround(grids: { gedtm30: HeightGrid | null; glo30: HeightGrid | null }, proj: Projector, box: Box2, open?: (x: number, z: number) => boolean): GroundModel {
  if (grids.gedtm30) return smoothedGround(grids.gedtm30, proj, box);
  if (grids.glo30) return filteredGround(grids.glo30, proj, box, open);
  throw new Error('no ground source: neither the GEDTM30 window nor the GLO-30 tile is there');
}
