// Every repair rule on the pilot centre graph, timed and run twice, and the whole repair with the lane model's feedback
// run on its own against the graph the bake driver wrote (P1-010 acceptance). The time limit of the rules is checked by
// pilot_timing.test.mjs (perf_budgets.json bake.pilotStepMs.rules), not here. Split from pilot_repair.test.mjs so it
// runs in its own worker beside the other bakes (P1-038).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { projector } from '../../geo/projection.ts';
import { buildBlockGraph } from '../graph/build.ts';
import { graphHash } from '../graph/checks.ts';
import { smoothedGround } from '../heights.ts';
import { outlineRing } from '../layout/outline.ts';
import { blockFrame } from '../layout/placement.ts';
import { stagePlan } from '../layout/stages.ts';
import { boxMetres } from '../main.ts';
import { laneInputs } from '../sites.ts';
import { CATALOGUE, timeRules } from '../rules/catalogue.ts';
import { RuleContext } from '../rules/context.ts';
import { readGraphInput } from '../sources/graphinput.ts';
import { readGedtmFile } from '../sources/ground.ts';
import { readRepairInput } from '../sources/repairio.ts';
import { memo, repairBaseline } from '../../testkit/sharedbake.mjs';
import { buildRuleEnv } from './env.ts';
import { repairWithLanes } from './feedback.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const districts = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness/data/districts.json'), 'utf8'));
const plan = stagePlan(districts, 'pilot', fs.readFileSync(path.join(ROOT, 'harness/data/districts/pilot_centre.geojson'), 'utf8'));
const missing = ['osm.json', 'overture_buildings.json', 'gedtm30_window.json'].filter((f) => !fs.existsSync(path.join(ROOT, plan.def.dataDir, f)));
const reason = missing.length ? `pilot data missing (${missing.join(', ')} in ${plan.def.dataDir}): run npm run bake -- pilot --stage sources` : '';

describe.skipIf(missing.length > 0)(`pilot centre repair rules${reason ? ` (skipped: ${reason})` : ''}`, () => {
  const T = 1800000;

  /** A slow pure computation (every rule timed twice, then the whole repair with the lane feedback on its own): kept in the test cache for this code and data. */
  let recomputing;
  const recomputed = () => (recomputing ??= memo('repair_recompute', '', async () => {
      const input = readGraphInput(ROOT, plan);
      const g = buildBlockGraph(input);
      const proj = projector(plan.origin);
      const grid = readGedtmFile(path.join(ROOT, plan.def.dataDir, 'gedtm30_window.json'));
      const ground = smoothedGround(grid, proj, boxMetres(plan));
      const extra = readRepairInput(ROOT);
      const focusIds = new Set(districts.districts.filter((d) => d.block === plan.def.block).map((d) => d.id));
      const focus = districts.districts.filter((d) => focusIds.has(d.id) && typeof d.outline === 'string').map((d) => ({ id: d.id, ring: outlineRing(JSON.parse(fs.readFileSync(path.join(ROOT, 'harness/data', d.outline), 'utf8')).features[0].geometry.coordinates[0], plan.origin) }));
      const env = buildRuleEnv({ proj, offset: blockFrame(districts, plan.def.block).offset, focus, ground: (x, z) => ground.at(x, z), heightSource: grid, heroSpecs: extra.heroSpecs, heroList: extra.heroList, places: extra.places.filter((p) => p.block === plan.def.block), elements: input.elements, graph: g, mapEdge: 'stage' });
      const a = timeRules(new RuleContext(g, env), () => performance.now());
      const b = timeRules(new RuleContext(g, env), () => performance.now());
      // the whole repair with the lane model's feedback (R-LANE-06), run here on its own
      const lin = laneInputs(input, plan, extra.heroSpecs);
      const { res } = repairWithLanes(g, env, {}, (rg) => ({ nodes: rg.nodes, edges: rg.edges, marks: rg.marks, ...lin }));
      return { rules: Object.keys(a.ms), ms: a.ms, totalA: a.totalMs, totalB: b.totalMs, same: JSON.stringify(b.issues) === JSON.stringify(a.issues), hash: graphHash(res.graph), total: res.summary.total, repairs: res.repairs.length };
  }));
  const baked = () => repairBaseline();

  it('all rules give the same output twice and the whole repair with the lane feedback, run on its own, gives the graph the driver wrote (time per rule printed; the limit is checked by pilot_timing.test.mjs)', async () => {
    const { health } = await baked();
    const r = await recomputed();
    console.log(`[pilot repair] all rules: ${r.totalA} ms and ${r.totalB} ms (driver: ${health.repair.rulesTotalMs} ms); per rule: ${Object.entries(r.ms).map(([id, ms]) => `${id} ${ms}`).join(', ')}`);
    expect(r.rules).toEqual(CATALOGUE.map((x) => x.id));
    expect(r.same).toBe(true);
    expect(r.hash).toBe(health.repair.hash);
    expect(r.total).toBe(health.repair.summary.total);
    expect(r.repairs).toBe(health.repair.summary.auto);
  }, T);
});
