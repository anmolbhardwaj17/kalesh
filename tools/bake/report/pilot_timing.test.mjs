// Bake speed on the pilot centre (P1-038). The step time limits used to be wall clock assertions inside the pilot tests
// (rules under 3 s, lane model under 30 s, ...), which failed whenever another job used the machine. The tests now check
// correctness only; the limits live in harness/verify/perf_budgets.json ("bake": pilotStepMs, pilotFullMin) and are
// checked here, on the timing of the shared test bake (tools/testkit/sharedbake.mjs). When the machine was busy while
// that bake ran (load over half the cores), a time over its limit is printed and does not fail: it says nothing about
// the code. A bake kept in the cache from an idle run is judged as that run measured it.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { busy, pilotMissing, ROOT, sharedBake } from '../../testkit/sharedbake.mjs';

const { missing, reason } = pilotMissing();
const budgets = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness/verify/perf_budgets.json'), 'utf8')).bake;

describe.skipIf(missing.length > 0)(`pilot centre bake speed${reason ? ` (skipped: ${reason})` : ''}`, () => {
  it('every bake step is within its limit in perf_budgets.json (printed always; asserted when the machine was idle), the whole bake within pilotFullMin', async () => {
    const { health, timing, measured } = await sharedBake();
    const idle = !busy(measured);
    const steps = {
      graph: health.graph.buildMs,
      rules: health.repair.rulesTotalMs,
      lanes: health.lanes.buildMs,
      elevation: health.elevation.solveMs,
      mesh: health.mesh.buildMs,
      terrain: health.terrain.buildMs,
      areas: health.areas.ms.parcels + health.areas.ms.city,
    };
    const limits = budgets.pilotStepMs;
    console.log(`[bake speed] whole bake ${(timing.totalMs / 1000).toFixed(1)} s (load ${measured.loadStart} to ${measured.loadEnd} on ${measured.cpus} cores, ${idle ? 'idle' : 'busy: step limits are not asserted'}); steps ${JSON.stringify(timing.steps)}`);
    console.log(`[bake speed] ${Object.entries(steps).map(([k, v]) => `${k} ${v} ms of ${limits[k]}`).join(', ')}`);
    expect(Object.keys(steps).sort()).toEqual(Object.keys(limits).filter((k) => k !== '_doc').sort());
    for (const v of Object.values(steps)) expect(Number.isFinite(v) && v > 0).toBe(true);
    // a whole bake that takes this long is broken whatever else ran
    expect(timing.totalMs).toBeLessThan(budgets.pilotFullMin * 60000);
    if (idle) for (const [k, v] of Object.entries(steps)) expect(v, `${k} step`).toBeLessThan(limits[k]);
  }, 1800000);
});
