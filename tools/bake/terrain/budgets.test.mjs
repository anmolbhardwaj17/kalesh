// The limits the terrain step checks (tools/bake/terrain/terrainout.ts) are the ones of the budget file
// (harness/verify/perf_budgets.json, world.ground): one place says the number, the other must say the same.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUILD_LIMIT_MS, GAP_LIMIT_M, HOLE_LIMIT, NEEDLE_LIMIT, SEAM_LIMIT_M } from './terrainout.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('ground budgets', () => {
  it('the terrain step checks the limits of perf_budgets.json world.ground', () => {
    const g = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness/verify/perf_budgets.json'), 'utf8')).world.ground;
    expect(GAP_LIMIT_M).toBe(g.roadGapM);
    expect(NEEDLE_LIMIT).toBe(g.needleShare);
    expect(SEAM_LIMIT_M).toBe(g.seamM);
    expect(HOLE_LIMIT).toBe(g.holeShare);
    expect(BUILD_LIMIT_MS).toBe(g.buildS * 1000);
  });
});
