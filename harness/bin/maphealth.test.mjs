// The map health panel of the dashboard (P1-011): the summary reads the same numbers as health.json, and the real
// dashboard shows them on its Map health tab with a link to the inspector. The page part needs Chromium and skips with
// a reason when it is missing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launch } from './browser.mjs';
import { freePort } from './godotclient.mjs';
import { GATE_NAMES, mapHealth } from './maphealth.mjs';

const health = {
  version: 5, stage: 'pilot', block: 'centre',
  counts: { found: 6319, byRule: { 'R-BLDG-01': 4916, 'R-ROAD-01': 127, 'R-LANE-FIT-01': 72 }, repairedAuto: 3374, fixedByOverrides: 2, repairsSwitchedOff: 1, staleOverrides: 1, leftOpen: 2841, highImpactOpen: 240, explained: 100 },
  repairs: { auto: 3374, byRule: { 'R-BLDG-01': 2495, 'R-ROAD-01': 7 } },
  overrides: { patches: 4, files: 3, byId: 2, byAnchor: 1, stale: 1, outsideStage: 2, records: [{ id: 'ov_x', file: '1_2.json', outcome: 'stale', note: 'way/9 is not in this extract' }, { id: 'ov_y', file: '1_2.json', outcome: 'fixed', note: '' }] },
  gates: { openPorts: null, floatingEnds: 3, unjoinedEnds: null, overlappingRoadFaces: null, laneContinuityBreaks: null, tapersOutOfLimits: null, widthSteps: 0, groundGapMaxM: 0.0014, needleShare: 0.025 },
  pairs: [{ ok: true }, { ok: true }, { ok: false }],
  layout: { worstPairBearingDeg: 0.023, worstPairDistancePct: 0.00002 },
  invariants: [{ id: 'A', ok: true, detail: '' }, { id: 'TERR-01.gap', ok: true, detail: 'largest gap 0.0014 m' }, { id: 'TERR-03.needles', ok: false, detail: '2.5 percent' }],
};

let tmp = '';
let file = '';
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maphealth-'));
  file = path.join(tmp, 'health.json');
  fs.writeFileSync(file, JSON.stringify(health));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('map health summary', () => {
  it('carries the counts of health.json as they are', () => {
    const m = mapHealth(file);
    expect(m).toMatchObject({ stage: 'pilot', found: 6319, repairedAuto: 3374, fixedByOverrides: 2, repairsSwitchedOff: 1, staleOverrides: 1, leftOpen: 2841, highImpactOpen: 240, explained: 100 });
    expect(m.byRule[0]).toEqual({ rule: 'R-BLDG-01', found: 4916, auto: 2495 });
    expect(m.overrides.stale).toEqual([{ id: 'ov_x', file: '1_2.json', note: 'way/9 is not in this extract' }]);
    expect(m.gates).toHaveLength(Object.keys(GATE_NAMES).length);
    expect(m.gates.find((g) => g.key === 'floatingEnds').count).toBe(3);
    expect(m.gates.find((g) => g.key === 'openPorts').count).toBeNull();
    expect(m.pairs).toMatchObject({ count: 3, failed: 1 });
    expect(m.gates.find((g) => g.key === 'widthSteps').count).toBe(0);
  });
  it('carries the ground checks TERR-01 to 07 with their numbers (P1-037)', () => {
    const m = mapHealth(file);
    expect(m.ground.map((g) => g.id)).toEqual(['TERR-01', 'TERR-02', 'TERR-03', 'TERR-04', 'TERR-05', 'TERR-06', 'TERR-07']);
    expect(m.ground[0]).toMatchObject({ value: 0.0014, unit: 'm', ok: true });
    expect(m.ground[2]).toMatchObject({ value: 2.5, unit: '%', ok: false });
    expect(m.ground[3]).toMatchObject({ value: null, ok: null });
  });
  it('carries the explained gate items, the findings, the bake time and the report link (P1-017)', () => {
    const f = path.join(tmp, 'health_gates.json');
    const g = (items) => ({ count: items.length, explained: items.filter((i) => i.explainedBy).length, unexplained: items.filter((i) => !i.explainedBy).length, items });
    fs.writeFileSync(f, JSON.stringify({
      ...health,
      gates: { ...health.gates, floatingEnds: 2, unjoinedEnds: 1 },
      gateReport: { ok: false, gates: { floatingEnds: g([{ id: 'a', explainedBy: 'P1-036: why' }, { id: 'b', explainedBy: 'P1-035 (d): why' }]), unjoinedEnds: g([{ id: 'c', explainedBy: null }]) }, idle: [], findings: [{ what: 'drains', measured: 'flat', owner: 'P1-037' }] },
    }));
    fs.writeFileSync(path.join(tmp, 'timing.json'), JSON.stringify({ stage: 'pilot', partial: false, totalMs: 160000, steps: {} }));
    fs.writeFileSync(path.join(tmp, 'repair_pilot_kashmere_gate.png'), '');
    const m = mapHealth(f);
    expect(m.gates.find((x) => x.key === 'floatingEnds')).toMatchObject({ count: 2, explained: 2, owners: ['P1-036', 'P1-035 (d)'] });
    expect(m.gates.find((x) => x.key === 'unjoinedEnds')).toMatchObject({ count: 1, explained: 0 });
    expect(m.gates.find((x) => x.key === 'openPorts').explained).toBeNull();
    expect(m.findings).toHaveLength(1);
    expect(m.timing.totalMs).toBe(160000);
    expect(m.report).toBe('health_gates.json');
    expect(m.pictures).toEqual(['repair_pilot_kashmere_gate.png']);
  });
  it('says so when there is no report, an unreadable one, or one from before the counts', () => {
    expect(mapHealth(path.join(tmp, 'none.json'))).toBeNull();
    const bad = path.join(tmp, 'bad.json');
    fs.writeFileSync(bad, '{');
    expect(mapHealth(bad).error).toMatch(/not valid JSON/);
    const old = path.join(tmp, 'old.json');
    fs.writeFileSync(old, JSON.stringify({ version: 4, stage: 'pilot' }));
    expect(mapHealth(old).error).toMatch(/Run "npm run bake/);
  });
});

describe('dashboard Map health tab', () => {
  let proc = null;
  let browser = null;
  let url = '';
  let skip = '';
  beforeAll(async () => {
    try {
      ({ browser } = await launch());
    } catch (e) {
      skip = `no Chromium (${String(e.message).split('\n')[0]})`;
      return;
    }
    const port = await freePort();
    url = `http://localhost:${port}`;
    proc = spawn(process.execPath, [path.resolve(import.meta.dirname, 'dashboard.mjs')], { env: { ...process.env, HARNESS_DASHBOARD_PORT: String(port), HARNESS_MAP_HEALTH: file }, stdio: 'ignore' });
    for (let n = 0; n < 50; n++) {
      try { if ((await fetch(`${url}/api/ping`)).ok) return; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    skip = 'the dashboard did not start';
  }, 30000);
  afterAll(async () => {
    await browser?.close();
    proc?.kill();
  });

  it('shows the same counts as health.json and links to the inspector', async (ctx) => {
    if (skip) return ctx.skip(skip);
    const state = await (await fetch(`${url}/api/state`)).json();
    expect(state.mapHealth).toMatchObject({ found: 6319, repairedAuto: 3374, fixedByOverrides: 2, staleOverrides: 1, leftOpen: 2841 });
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url);
    await page.click('[data-tab="map"]');
    await page.waitForSelector('#mapTiles [data-health="found"]');
    const num = async (id) => Number((await page.locator(`#mapTiles [data-health="${id}"] div`).nth(1).textContent()).replace(/,/g, ''));
    expect(await num('found')).toBe(health.counts.found);
    expect(await num('auto')).toBe(health.counts.repairedAuto);
    expect(await num('overrides')).toBe(health.counts.fixedByOverrides);
    expect(await num('stale')).toBe(health.counts.staleOverrides);
    expect(await num('open')).toBe(health.counts.leftOpen);
    const text = await page.locator('#p-map').innerText();
    expect(text).toContain('way/9 is not in this extract');
    expect(text).toContain('not measured yet');
    expect(text).not.toContain('—');
    expect(text).toContain('Roads that change width with a jump');
    expect(await page.locator('#mapGround [data-ground]').count()).toBe(7);
    expect(await page.locator('#mapGround [data-ground="TERR-03"]').innerText()).toContain('fails');
    const link = page.locator('#p-map a[href="/inspector/"]');
    expect(await link.count()).toBe(1);
    expect((await fetch(`${url}/inspector/`)).status).toBe(200);
    expect(errors).toEqual([]);
    const shots = path.resolve(import.meta.dirname, '..', 'reports', 'map');
    fs.mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: path.join(shots, 'dashboard_map_health.png') });
    await page.close();
  }, 30000);
});
