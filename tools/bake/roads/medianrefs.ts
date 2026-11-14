// Reference medians (P1-032, harness/data/medians.json): the divider between the two carriageways of a divided street
// as a photo or a satellite reading gives it. The lane model fits the carriageways to it (dividers.ts, P1-034) and the
// mesh fills the median (mesh/medianfaces.ts). Block metres. Pure.
import type { Strip } from './model.ts';

export type MedianType = 'kerb' | 'planter' | 'barrier' | 'painted';

/** A reference median: the street names it covers (and an optional box in block metres), width and type, and where it was read. */
export interface MedianRef {
  names: readonly string[];
  box?: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Full width of the divider, kerb face to kerb face (m). */
  width: number;
  type: MedianType;
  source: 'photo' | 'satellite';
  ref: string;
}

/** The reference that covers a pair, or null. */
export function refFor(refs: readonly MedianRef[], a: Pick<Strip, 'name'>, bName: string, x: number, z: number): MedianRef | null {
  for (const r of refs) {
    if (!r.names.includes(a.name) && !r.names.includes(bName)) continue;
    if (r.box && (x < r.box.minX || x > r.box.maxX || z < r.box.minZ || z > r.box.maxZ)) continue;
    return r;
  }
  return null;
}
