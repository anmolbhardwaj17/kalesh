// End to end in a temp folder (P1-010, P1-017): a pick written by the inspector server is read by the next bake and
// shows as fixed by override in health.json. Split from pilot_repair.test.mjs so it runs in its own worker (P1-038).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../cli.ts';
import { stagePlan } from '../layout/stages.ts';
import { bake, offlineNet } from '../main.ts';
import { startInspector } from '../../inspector/serve.mjs';
import { memo, repairBaseline } from '../../testkit/sharedbake.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const districts = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness/data/districts.json'), 'utf8'));
const plan = stagePlan(districts, 'pilot', fs.readFileSync(path.join(ROOT, 'harness/data/districts/pilot_centre.geojson'), 'utf8'));
const missing = ['osm.json', 'overture_buildings.json', 'gedtm30_window.json'].filter((f) => !fs.existsSync(path.join(ROOT, plan.def.dataDir, f)));
const reason = missing.length ? `pilot data missing (${missing.join(', ')} in ${plan.def.dataDir}): run npm run bake -- pilot --stage sources` : '';

describe.skipIf(missing.length > 0)(`pilot centre repair, an owner pick${reason ? ` (skipped: ${reason})` : ''}`, () => {
  const baked = () => repairBaseline();
  const T = 1800000;

  it('end to end in a temp folder: a pick written by the inspector server is read by the next bake and shows as fixed by override in health.json', async () => {
    const first = await baked();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bake-repair-pick-'));
    const overrides = path.join(tmp, 'picked_overrides');
    // the inspector reads the issues.json of the first bake and writes the owner's pick into the override folder
    const server = await startInspector({ dataDir: first.dir, overridesDir: overrides, inboxFile: path.join(tmp, 'inbox.jsonl'), gamePort: 1, date: '2026-11-12' });
    let issue;
    try {
      issue = first.issues.issues.find((i) => i.rule === 'R-ROAD-01' && i.status === 'open' && i.proposals.length >= 2);
      expect(issue, 'the pilot has an open R-ROAD-01 issue with two proposals').toBeTruthy();
      const res = await fetch(`${server.url.replace('/inspector/', '')}/api/inspector/pick`, { method: 'POST', body: JSON.stringify({ issue: issue.id, proposal: 1, note: 'a real dead end' }) });
      expect(res.status).toBe(200);
    } finally {
      await server.close();
    }
    const picked = fs.readdirSync(overrides);
    expect(picked).toEqual([`${issue.tile[0]}_${issue.tile[1]}.json`]);
    // the next bake reads the pick (kept in the test cache for this pick file: the same pick on the same code gives the same bake)
    const m = await memo('repair_picked', fs.readFileSync(path.join(overrides, picked[0]), 'utf8'), async (dir) => {
      await bake(parseArgs(['pilot', '--stage', 'repair', '--offline']), { root: ROOT, net: offlineNet, today: '2026-11-12', log: () => {}, healthFile: path.join(dir, 'health.json'), overridesDir: overrides });
      return {};
    });
    const health = JSON.parse(fs.readFileSync(path.join(m.dir, 'health.json'), 'utf8'));
    expect(health.stoppedBeforeTiles).toBe(false);
    expect(health.overrides).toMatchObject({ patches: 1, byId: 1, byAnchor: 0, stale: 0, applied: 1 });
    expect(health.overrides.records[0]).toMatchObject({ issue: issue.id, resolution: 'by_id', outcome: 'fixed', action: issue.proposals[1].action });
    expect(health.counts.fixedByOverrides).toBe(1);
    expect(health.counts.staleOverrides).toBe(0);
    expect(health.counts.leftOpen).toBeLessThan(first.health.counts.leftOpen + 1);
    const again = JSON.parse(fs.readFileSync(path.join(m.dir, 'issues.json'), 'utf8'));
    expect(again.issues.find((i) => i.id === issue.id).status).toBe('overridden');
    expect(health.invariants.filter((x) => x.id.startsWith('REPAIR-')).every((x) => x.ok)).toBe(true);
    // x and z of the issues are world metres: the tile of the record is the tile of its position
    for (const i of again.issues.slice(0, 200)) expect([Math.floor(i.x / 250), Math.floor(i.z / 250)]).toEqual(i.tile);
  }, T);
});
