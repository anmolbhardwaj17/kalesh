// Reads the pinned height files of a stage into HeightGrids (P1-007): the GEDTM30 window (JSON) and a window of the
// local GLO-30 tile (geotiff from the file). The smoothing and the filter are pure, in tools/bake/heights.ts.
import fs from 'node:fs';
import type { HeightGrid } from '../ground.ts';
import { gedtmGrid } from '../heights.ts';
import type { GedtmWindow } from '../heights.ts';
import type { GeoBox } from '../layout/outline.ts';
import { readWindow } from './net.ts';

export function readGedtmFile(file: string): HeightGrid | null {
  if (!fs.existsSync(file)) return null;
  return gedtmGrid(JSON.parse(fs.readFileSync(file, 'utf8')) as GedtmWindow);
}

export async function readGlo30File(file: string, box: GeoBox): Promise<HeightGrid | null> {
  if (!fs.existsSync(file)) return null;
  const geotiff = (await import('geotiff')) as unknown as {
    fromFile(p: string): Promise<{ getImage(): Promise<Parameters<typeof readWindow>[0]>; close?(): Promise<void> | void }>;
  };
  const tiff = await geotiff.fromFile(file);
  const w = await readWindow(await tiff.getImage(), box);
  await tiff.close?.();
  const data = Float32Array.from(w.values, (v) => (v === w.noData || !Number.isFinite(v) ? NaN : v * w.scale + w.offset));
  return { west: w.west, north: w.north, dLon: w.dLon, dLat: w.dLat, width: w.width, height: w.height, data, cellCentre: !w.pixelIsPoint };
}
