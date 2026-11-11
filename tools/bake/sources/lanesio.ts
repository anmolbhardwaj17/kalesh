// Files of the lanes step (P1-012): the lane model and the lane graph (build products under the stage's data folder)
// and the lanes layer of the map inspector beside the health report. The model itself is pure (tools/bake/roads/).
import fs from 'node:fs';
import path from 'node:path';
import type { StagePlan } from '../layout/stages.ts';
import type { LaneGraphFile, LaneModelFile, LanesLayer } from '../roads/laneout.ts';

/** Writes the three files and returns their repo-relative (or absolute, outside root) paths. */
export function writeLanes(root: string, plan: StagePlan, reportDir: string, model: LaneModelFile, graph: LaneGraphFile, layer: LanesLayer): { model: string; laneGraph: string; layer: string } {
  const dir = path.join(root, plan.def.dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const modelFile = path.join(dir, 'lanes.json');
  fs.writeFileSync(modelFile, JSON.stringify(model));
  const graphFile = path.join(dir, 'lane_graph.json');
  fs.writeFileSync(graphFile, JSON.stringify(graph));
  fs.mkdirSync(reportDir, { recursive: true });
  const layerFile = path.join(reportDir, 'lanes.json');
  fs.writeFileSync(layerFile, JSON.stringify(layer));
  const rel = (f: string): string => (f.startsWith(root) ? path.relative(root, f) : f);
  return { model: rel(modelFile), laneGraph: rel(graphFile), layer: rel(layerFile) };
}
