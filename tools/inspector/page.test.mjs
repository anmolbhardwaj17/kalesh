// Map inspector page tests (P1-001, P1-011): Playwright drives the real page against the production report of the bake
// (harness/reports/map/issues.json, context.json). When that report is missing the test makes one with an offline
// bake into a temp folder; it needs the pilot downloads (data/pilot_centre) and the Chromium of Playwright, and
// without them the tests are skipped with a reason, never failed. The "Open in game" test also
// needs the pinned Godot (it starts the game headless with --debug).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launch } from '../../harness/bin/browser.mjs';
import { launchGame, freePort } from '../../harness/bin/godotclient.mjs';
import { parseArgs } from '../bake/cli.ts';
import { bake, offlineNet, ROOT } from '../bake/main.ts';
import { worldToGeo } from '../geo/projection.ts';
import { startInspector } from './serve.mjs';

const SHOTS = path.resolve(import.meta.dirname, '..', '..', 'harness', 'reports', 'inspector');
let skip = '';
const REPORT = path.join(ROOT, 'harness', 'reports', 'map');
let dataDir = REPORT;
let browser = null;
let issuesFile = null;
let server = null;
let tmp = '';
let overrides = '';
let inbox = '';
const consoleErrors = [];
const hosts = new Set();
let page = null;

/** The production report of the last bake, or a fresh offline bake of the pilot into a temp folder. */
async function ensureData() {
  const have = (d) => fs.existsSync(path.join(d, 'issues.json')) && fs.existsSync(path.join(d, 'context.json')) && fs.existsSync(path.join(d, 'tiles', 'index.json'));
  if (have(dataDir)) return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inspector-bake-'));
  await bake(parseArgs(['pilot', '--stage', 'repair', '--offline']), { root: ROOT, net: offlineNet, today: '2026-11-12', log: () => {}, healthFile: path.join(dir, 'health.json'), overridesDir: path.join(dir, 'no_overrides') });
  dataDir = dir;
}

beforeAll(async () => {
  try {
    await ensureData();
  } catch (e) {
    skip = `no bake report (harness/reports/map) and an offline pilot bake could not make one (${String(e.message).split('\n')[0]})`;
    return;
  }
  try {
    ({ browser } = await launch());
  } catch (e) {
    skip = `no Chromium with WebGL (${String(e.message).split('\n')[0]})`;
    return;
  }
  issuesFile = JSON.parse(fs.readFileSync(path.join(dataDir, 'issues.json'), 'utf8'));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inspector-test-'));
  overrides = path.join(tmp, 'overrides');
  inbox = path.join(tmp, 'inbox.jsonl');
  // gamePort: a port nothing listens on, so "Open in game" has no game to find
  const closedPort = await freePort();
  server = await startInspector({ dataDir, overridesDir: overrides, inboxFile: inbox, gamePort: closedPort, date: '2026-11-12' });
  page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('request', (r) => { const u = new URL(r.url()); if (!['data:', 'blob:', 'about:'].includes(u.protocol)) hosts.add(u.hostname); });
  await page.goto(server.url);
  await page.waitForFunction(() => window.__inspector?.state().ready, null, { timeout: 60000 });
  await page.waitForFunction(() => !window.__inspector.state().flying);
}, 120000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

const run = (name, fn, timeout) => it(name, async (ctx) => { if (skip) return ctx.skip(skip); await fn(); }, timeout);
const hook = (fn, arg) => page.evaluate(fn, arg);
const flown = () => page.waitForFunction(() => !window.__inspector.state().flying);

describe('map inspector page', () => {
  run('loads with no console errors and no request to any host but localhost', async () => {
    expect(consoleErrors).toEqual([]);
    expect([...hosts]).toEqual(['localhost']);
  });

  run('lists every issue and puts the high impact ones first', async () => {
    const st = await hook(() => window.__inspector.state());
    expect(st.issueCount).toBe(issuesFile.issues.length);
    expect(st.listCount).toBe(issuesFile.issues.length);
    expect(await page.locator('#list .row').count()).toBe(issuesFile.issues.length);
    const high = issuesFile.issues.filter((i) => i.status === 'open' && i.impact >= 0.7);
    expect(high.length).toBeGreaterThan(10);
    const ids = await hook(() => window.__inspector.listIds());
    const byId = new Map(issuesFile.issues.map((i) => [i.id, i]));
    for (const id of ids.slice(0, high.length)) { const i = byId.get(id); expect(i.status).toBe('open'); expect(i.impact).toBeGreaterThanOrEqual(0.7); }
    expect(new Set(ids.slice(0, high.length))).toEqual(new Set(high.map((i) => i.id)));
    const rest = ids.slice(high.length).map((id) => byId.get(id));
    expect(rest.every((i) => !(i.status === 'open' && i.impact >= 0.7))).toBe(true);
  });

  run('north is up: Red Fort is above and right of India Gate, Connaught Place above and left', async () => {
    await page.click('#fit');
    await flown();
    const p = await hook(() => window.__inspector.places());
    expect(p.red_fort.y).toBeLessThan(p.india_gate.y);
    expect(p.red_fort.x).toBeGreaterThan(p.india_gate.x);
    expect(p.connaught_place.y).toBeLessThan(p.india_gate.y);
    expect(p.connaught_place.x).toBeLessThan(p.india_gate.x);
    const box = async (id) => (await page.locator(`.place[data-place="${id}"]`).boundingBox());
    const [ig, rf, cp] = [await box('india_gate'), await box('red_fort'), await box('connaught_place')];
    expect(rf.y).toBeLessThan(ig.y);
    expect(rf.x).toBeGreaterThan(ig.x);
    expect(cp.y).toBeLessThan(ig.y);
    expect(cp.x).toBeLessThan(ig.x);
    const rotation = await page.locator('#compass span').evaluate((el) => el.style.transform);
    expect(rotation).toBe('rotate(0deg)');
  });

  run('clicking an issue flies the camera target to within 30 m of it', async () => {
    const ids = await hook(() => window.__inspector.listIds());
    for (const k of [0, 5, 40]) {
      await page.locator('#list .row').nth(k).click();
      await flown();
      const st = await hook(() => window.__inspector.state());
      const i = issuesFile.issues.find((q) => q.id === ids[k]);
      const d = Math.hypot(st.camera.target[0] - i.x, st.camera.target[2] - i.z);
      expect(d).toBeLessThan(30);
      expect(st.selected).toBe(ids[k]);
    }
  });

  run('a click on a dot on the map selects that issue', async () => {
    const id = (await hook(() => window.__inspector.listIds()))[3];
    await hook((x) => window.__inspector.select(x), id);
    await flown();
    await hook((x) => window.__inspector.select(x, { fly: false }), id);
    const s = await hook((x) => window.__inspector.issueScreen(x), id);
    const r = await page.locator('#map canvas').boundingBox();
    await page.mouse.click(s.x, s.y);
    const st = await hook(() => window.__inspector.state());
    expect(st.selected).toBeTruthy();
    const a = issuesFile.issues.find((q) => q.id === st.selected);
    const b = issuesFile.issues.find((q) => q.id === id);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(40);
    expect(r.width).toBeGreaterThan(400);
  });

  run('every card says what and where in words, what is wrong and the fix; a click labels it on the map (P1-039)', async () => {
    const cards = await page.locator('#list .row').evaluateAll((rows) => rows.slice(0, 400).map((r) => ({ t: r.querySelector('.t').textContent, s: r.querySelector('.s').textContent })));
    for (const c of cards) {
      expect(c.t.length).toBeGreaterThan(5);
      expect(c.t).not.toMatch(/\b(w\d+\.\d+|n\d{4,}|R-[A-Z]+-\d+)\b/);
      expect(c.s).not.toMatch(/\bR-[A-Z]+-\d+\b/);
    }
    const id = await hook(() => [...document.querySelectorAll('#list .row')].find((r) => /^Unnamed /.test(r.querySelector('.t').textContent))?.dataset.id);
    if (!id) return; // a report written before the names were in context.json
    await page.locator(`.row[data-id="${id}"]`).click();
    await flown();
    const d = await hook((x) => window.__inspector.describe(x), id);
    expect(d.title).toMatch(/^Unnamed .+ off .+, .*(of|at) /);
    expect(await page.locator('#selLabel').isVisible()).toBe(true);
    expect(await page.locator('#selLabel').textContent()).toContain(d.what);
    expect(await page.locator('#issue h2').textContent()).toBe(d.what);
    expect(await page.locator('#issue .block').first().textContent()).toContain(d.problem);
  });

  run('draws the lanes layer when the report has one', async () => {
    if (!fs.existsSync(path.join(dataDir, 'lanes.json'))) return;
    await page.waitForFunction(() => window.__inspector.state().lanesReady, null, { timeout: 60000 });
    const st = await hook(() => window.__inspector.state());
    expect(st.lanes.strips).toBeGreaterThan(1000);
    expect(st.lanes.centreLines + st.lanes.laneLines).toBeGreaterThan(1000);
    expect(consoleErrors).toEqual([]);
  });

  run('screenshots', async () => {
    fs.mkdirSync(SHOTS, { recursive: true });
    const first = (await hook(() => window.__inspector.highIds()))[0];
    await page.click('#fit');
    await flown();
    await hook((x) => window.__inspector.select(x, { fly: false }), first);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, 'issues.png') });
    await page.locator(`.row[data-id="${first}"]`).click();
    await flown();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, 'issue_zoom.png') });
    expect(consoleErrors).toEqual([]);
  });

  run('picking a fix writes the patch to the override file of its tile and one inbox line', async () => {
    const id = (await hook(() => window.__inspector.listIds())).find((x) => { const i = issuesFile.issues.find((q) => q.id === x); return i.proposals.length >= 2; });
    const issue = issuesFile.issues.find((q) => q.id === id);
    await page.locator(`.row[data-id="${id}"]`).click();
    await flown();
    await page.locator('.prop').nth(1).click();
    await page.fill('#note', 'Checked in a street photo');
    await page.click('#save');
    await page.waitForFunction(() => document.querySelector('#msg') && !document.querySelector('#msg').hidden && /Saved/.test(document.querySelector('#msg').textContent));
    const file = path.join(overrides, `${Math.floor(issue.x / 250)}_${Math.floor(issue.z / 250)}.json`);
    expect(fs.existsSync(file)).toBe(true);
    const patches = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ issue: id, action: issue.proposals[1].action, source: 'inspector', by: 'owner', why: 'Checked in a street photo', date: '2026-11-12' });
    expect(patches[0].target.anchor).toEqual({ lat: issue.lat, lon: issue.lon });
    const lines = fs.readFileSync(inbox, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0].source).toBe('inspector');
    expect(lines[0].text).toContain(id);
    // a second pick for the same issue replaces the patch, and the inbox gets a second line
    await page.locator('.prop').nth(0).click();
    await page.click('#save');
    await page.waitForFunction(() => /Saved/.test(document.querySelector('#msg')?.textContent ?? ''));
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))[0].action).toBe(issue.proposals[0].action);
    expect(await hook(() => window.__inspector.state().picks)).toContain(id);
    // "You picked" counts this pick and the issues an earlier bake settled with a patch (status overridden)
    const settled = new Set(issuesFile.issues.filter((i) => i.status === 'overridden').map((i) => i.id)).add(id);
    expect((await page.locator('.chips button', { hasText: 'You picked' }).textContent()).trim()).toBe(`You picked ${settled.size}`);
  });

  run('Open in game says so when no game is running and nothing fails', async () => {
    await page.click('#openGame');
    await page.waitForFunction(() => /No game is running/.test(document.querySelector('#msg')?.textContent ?? ''));
    expect(consoleErrors).toEqual([]);
  });

  run('the lanes layer toggles; the lanes tab lists the split zones and taper findings of health.json with the same counts', async () => {
    const lanesFile = path.join(dataDir, 'lanes.json');
    const healthFile = path.join(dataDir, 'health.json');
    if (!fs.existsSync(lanesFile) || !fs.existsSync(healthFile)) return;
    await page.waitForFunction(() => window.__inspector.state().lanesReady, null, { timeout: 60000 });
    if (!(await hook(() => window.__inspector.lanes.strips()[0]?.edge))) return; // a lanes layer written before P1-025 has no edge ids
    // the toggle
    expect((await hook(() => window.__inspector.state())).lanesVisible).toBe(true);
    await page.click('#layerRows [data-layer="lanes"]');
    expect((await hook(() => window.__inspector.state())).lanesVisible).toBe(false);
    await page.click('#layerRows [data-layer="lanes"]');
    expect((await hook(() => window.__inspector.state())).lanesVisible).toBe(true);
    // the list has the counts of the health report
    const health = JSON.parse(fs.readFileSync(healthFile, 'utf8')).lanes;
    await page.click('#lanesTab');
    const c = await hook(() => window.__inspector.lanes.counts());
    expect(c.zones).toBe(health.zones.zones);
    expect(c.tapers).toBe(health.tapers.findings.length);
    expect(c.health).toEqual({ zones: health.zones.zones, tapers: health.tapers.violations, findings: health.tapers.findings.length });
    expect(c.rows).toBe(health.zones.zones + health.tapers.findings.length);
    expect(c.summary).toContain(`${health.zones.zones} split zones (${health.zones.diverges} splits, ${health.zones.merges} merges)`);
    expect(c.summary).toContain(`${health.tapers.violations} taper findings`);
    // the first row is the one nearest the ITO crossing; a click flies to it and shows its card
    const items = await hook(() => window.__inspector.lanes.items());
    for (const it of [items[0], items.find((x) => x.kind === 'taper')]) {
      if (!it) continue;
      await page.locator(`#laneList .row[data-lane="${it.id}"]`).click();
      await flown();
      const st = await hook(() => window.__inspector.state());
      expect(Math.hypot(st.camera.target[0] - it.x, st.camera.target[2] - it.z)).toBeLessThan(5);
      expect((await hook(() => window.__inspector.lanes.selected())).item).toBe(it.id);
      expect(await page.locator('#lane h2').isVisible()).toBe(true);
      expect(await page.locator('#lane').textContent()).toMatch(/Where the lane count comes from/);
    }
    expect(consoleErrors).toEqual([]);
    // the picture of the layer at ITO (read by the verifier)
    fs.mkdirSync(SHOTS, { recursive: true });
    const ito = items[0];
    await page.locator(`#laneList .row[data-lane="${ito.id}"]`).click();
    await flown();
    await hook(([x, z]) => window.__inspector.view(x, z, 230), [ito.x, ito.z]);
    await flown();
    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, 'lanes_ito.png') });
  });

  run('clicking a road shows its lane section and where its count came from; saving writes a set_lanes patch and an inbox line', async () => {
    if (!fs.existsSync(path.join(dataDir, 'lanes.json')) || !fs.existsSync(path.join(dataDir, 'health.json'))) return;
    if (!(await hook(() => window.__inspector.lanes.strips()[0]?.edge))) return;
    const layer = JSON.parse(fs.readFileSync(path.join(dataDir, 'lanes.json'), 'utf8'));
    await page.click('#lanesTab');
    // a plain road section near the camera whose middle has no issue dot within 25 px, so the click lands on the road
    const t = (await hook(() => window.__inspector.state())).camera.target;
    const near = layer.strips.filter((s) => s.kind === 'road' && Math.hypot(s.ref[0][0] - t[0], s.ref[0][1] - t[2]) < 150 && s.lanes.filter((l) => l[0] === 'drive').length >= 2);
    await hook(([x, z]) => window.__inspector.view(x, z, 160), [t[0], t[2]]);
    await flown();
    const dots = await Promise.all(issuesFile.issues.filter((i) => Math.hypot(i.x - t[0], i.z - t[2]) < 250).map((i) => hook((id) => window.__inspector.issueScreen(id), i.id)));
    let strip = null; let px = null;
    for (const s of near) {
      const m = s.ref[Math.floor(s.ref.length / 2)];
      const p = await hook(([x, z]) => window.__inspector.lanes.screen(x, z), m);
      if (!p || p.x < 400 || p.x > 1100 || p.y < 100 || p.y > 800) continue;
      if (dots.some((d) => d && Math.hypot(d.x - p.x, d.y - p.y) < 25)) continue;
      strip = s; px = p; break;
    }
    expect(strip).not.toBeNull();
    await page.mouse.click(px.x, px.y);
    const sel = await hook(() => window.__inspector.lanes.selected());
    expect(sel).not.toBeNull();
    expect(await page.locator('#lane').textContent()).toMatch(/Where the lane count comes from/);
    const edgeStrips = layer.strips.filter((s) => s.edge === sel.edge);
    expect(edgeStrips.length).toBeGreaterThan(0);
    const before = sel.lanes;
    await page.click('#lanesUp');
    await page.fill('#laneNote', 'Counted on the street photo');
    await page.click('#laneSave');
    await page.waitForFunction(() => /Saved/.test(document.querySelector('#lmsg')?.textContent ?? ''));
    const point = await hook(() => { const s = document.querySelector('#lane .ids').textContent; return s; });
    const m = /x (-?\d+), z (-?\d+)/.exec(point);
    const tile = [Math.floor(Number(m[1]) / 250), Math.floor(Number(m[2]) / 250)];
    const file = path.join(overrides, `${tile[0]}_${tile[1]}.json`);
    expect(fs.existsSync(file)).toBe(true);
    const patch = JSON.parse(fs.readFileSync(file, 'utf8')).find((p) => p.issue === `lanes:${sel.edge}`);
    expect(patch).toMatchObject({ action: 'set_lanes', source: 'inspector', by: 'owner', why: 'Counted on the street photo', params: { on: sel.edge, lanes: before + 1 }, target: { ids: [sel.edge] } });
    // the anchor is the clicked spot as latitude and longitude of the block frame
    const back = worldToGeo(Number(m[1]) - layer.offset[0], Number(m[2]) - layer.offset[1], layer.origin);
    expect(Math.abs(patch.target.anchor.lat - back.lat)).toBeLessThan(0.0005);
    expect(Math.abs(patch.target.anchor.lon - back.lon)).toBeLessThan(0.0005);
    const lines = fs.readFileSync(inbox, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[lines.length - 1].text).toContain(`from ${before} to ${before + 1}`);
    expect(lines[lines.length - 1].source).toBe('inspector');
    expect(consoleErrors).toEqual([]);
  }, 60000);

});

describe('Open in game with a running game', () => {
  it('puts the player within 5 m of the issue', async (ctx) => {
    if (skip) return ctx.skip(skip);
    let game;
    try {
      game = await launchGame({ debug: true, verify: true, headless: true, quitAfter: 6000 });
    } catch (e) {
      return ctx.skip(`the game could not start (${String(e.message).split('\n')[0]})`);
    }
    const s = await startInspector({ dataDir, overridesDir: overrides, inboxFile: inbox, gamePort: game.port });
    try {
      const p2 = await browser.newPage({ viewport: { width: 1400, height: 800 } });
      await p2.goto(s.url);
      await p2.waitForFunction(() => window.__inspector?.state().ready, null, { timeout: 60000 });
      const id = (await p2.evaluate(() => window.__inspector.listIds()))[0];
      const issue = issuesFile.issues.find((q) => q.id === id);
      await p2.locator(`.row[data-id="${id}"]`).click();
      await p2.click('#openGame');
      await p2.waitForFunction(() => /The game is now/.test(document.querySelector('#msg')?.textContent ?? ''), null, { timeout: 20000 });
      await game.client.call('frames', 2);
      const pos = game.client.snapshot.state.player.pos;
      expect(Math.hypot(pos[0] - issue.x, pos[2] - issue.z)).toBeLessThan(5);
      await p2.close();
    } finally {
      await s.close();
      await game.client.call('quit').catch(() => {});
      game.proc.kill();
    }
  }, 120000);
});
