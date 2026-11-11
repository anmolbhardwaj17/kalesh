// Files of the elevation step (P1-013): the heights of the stage (a build product under the stage's data folder).
// The solve itself is pure (tools/bake/elevation/).
import fs from 'node:fs';
import path from 'node:path';
import type { ElevationFile } from '../elevation/elevout.ts';
import type { StagePlan } from '../layout/stages.ts';

/** Writes elevation.json and returns its repo-relative (or absolute, outside root) path. */
export function writeElevation(root: string, plan: StagePlan, file: ElevationFile): string {
  const dir = path.join(root, plan.def.dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'elevation.json');
  fs.writeFileSync(out, JSON.stringify(file));
  return out.startsWith(root) ? path.relative(root, out) : out;
}
