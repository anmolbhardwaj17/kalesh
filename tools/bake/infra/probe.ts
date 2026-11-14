// What lies at a point of the road mesh (P2-034): the faces a pier, a mast or a stair of the infrastructure kits may
// not stand in, and the height of the road a level crossing lies on. Read from the mesh step's faces. Pure.
import { CUT_NONE, LANE_KINDS } from '../mesh/faces.ts';
import type { FaceSet } from '../mesh/faces.ts';
import { inFace } from '../mesh/portal.ts';
import type { FaceGrid } from '../mesh/structures.ts';

/** Faces a support may not stand in: where vehicles drive or park, and junctions. Medians and footpaths are fine. */
const NO_SUPPORT = new Set(['drive', 'parking', 'gore', 'junction']);

export class RoadProbe {
  private readonly fs: FaceSet;
  private readonly grid: FaceGrid;
  constructor(fs: FaceSet, grid: FaceGrid) {
    this.fs = fs;
    this.grid = grid;
  }

  private lowest(f: number): number {
    const s = this.fs.start[f] as number;
    let y = Infinity;
    for (let k = 0; k < (this.fs.len[f] as number); k++) y = Math.min(y, this.fs.ys[s + k] as number);
    return y;
  }

  /**
   * True when a support of radius r standing at (x, z) up to height `below` would stand in a road face (any face of
   * a lane vehicles use, or a junction, whose surface lies under `below`; a roofed tunnel under the ground is no
   * obstacle).
   */
  blocked(x: number, z: number, r: number, below: number): boolean {
    const probes: [number, number][] = [[x, z], [x + r, z], [x - r, z], [x, z + r], [x, z - r], [x + r * 0.7, z + r * 0.7], [x - r * 0.7, z + r * 0.7], [x + r * 0.7, z - r * 0.7], [x - r * 0.7, z - r * 0.7]];
    for (const f of this.grid.near(x - r, z - r, x + r, z + r)) {
      const kind = LANE_KINDS[this.fs.kind[f] as number] ?? 'drive';
      if (!NO_SUPPORT.has(kind)) continue;
      if ((this.fs.sheet[f] as number) >= 2000 && this.fs.cut[f] === CUT_NONE) continue;
      if (this.lowest(f) > below) continue;
      if (probes.some(([px, pz]) => inFace(this.fs, f, px, pz))) return true;
    }
    return false;
  }

  /** Height of the highest road face at the point that lies within `reach` of `near` (a level crossing), or NaN. */
  roadAt(x: number, z: number, near: number, reach = 2.5): number {
    let best = NaN;
    for (const f of this.grid.near(x, z, x, z)) {
      if (!inFace(this.fs, f, x, z)) continue;
      const s = this.fs.start[f] as number;
      let y = 0;
      const n = this.fs.len[f] as number;
      for (let k = 0; k < n; k++) y += (this.fs.ys[s + k] as number) / n;
      if (Math.abs(y - near) <= reach && !(y <= best)) best = y;
    }
    return best;
  }
}
