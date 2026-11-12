#!/usr/bin/env node
// Screenshots of the map inspector at Connaught Place and ITO, at 1280 and 1920 px wide (P1-039).
//   node tools/inspector/shots.mjs [--prefix after] [--out harness/reports/inspector]
// Uses the production report (harness/reports/map/) and a temp overrides folder and inbox, so nothing real is written.
// Each place: the high impact issue nearest to it is selected (the map flies there), then the view zooms out a little
// with the mouse wheel so the streets around it show. Prints the files it wrote and any console errors.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch } from '../../harness/bin/browser.mjs';
import { buildNameIndex, describeIssue } from './describe.ts';
import { startInspector } from './serve.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const prefix = arg('--prefix', 'after');
const out = path.resolve(ROOT, arg('--out', 'harness/reports/inspector'));
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'inspector-shots-'));
const server = await startInspector({ overridesDir: path.join(tmp, 'overrides'), inboxFile: path.join(tmp, 'inbox.jsonl'), gamePort: 1, date: '2026-11-12' });
const { browser } = await launch();
const errors = [];
const PLACES = [['cp', 'connaught_place'], ['ito', 'ito_crossing']];
const MAPDIR = path.join(ROOT, 'harness', 'reports', 'map');
const index = JSON.parse(fs.readFileSync(path.join(MAPDIR, 'tiles', 'index.json'), 'utf8'));
// the unnamed shot (Anmol 2026-11-12): the high impact issue on an unnamed road nearest Connaught Place
const names = buildNameIndex(JSON.parse(fs.readFileSync(path.join(MAPDIR, 'context.json'), 'utf8')), index.places);
const issuesFile = JSON.parse(fs.readFileSync(path.join(MAPDIR, 'issues.json'), 'utf8'));
const cp = index.places.find((q) => q.id === 'connaught_place');
const unnamed = issuesFile.issues
  .filter((i) => i.status === 'open' && i.impact >= 0.7 && describeIssue(i, names).what.startsWith('Unnamed'))
  .sort((a, b) => Math.hypot(a.x - cp.x, a.z - cp.z) - Math.hypot(b.x - cp.x, b.z - cp.z))[0];
try {
  for (const [w, h] of [[1280, 800], [1920, 1080]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await page.goto(server.url);
    await page.waitForFunction(() => window.__inspector?.state().ready, null, { timeout: 60000 });
    await page.waitForFunction(() => !window.__inspector.state().flying);
    await page.waitForFunction(() => { const s = window.__inspector.state(); return s.lanesReady === undefined || s.lanesReady; }, null, { timeout: 60000 });
    for (const [tag, place] of PLACES) {
      // the place positions in world metres come from the tiles index the page also reads
      const p = index.places.find((q) => q.id === place);
      const pickId = await page.evaluate(([px, pz]) => {
        let best = null; let bd = Infinity;
        for (const i of window.__inspector.highIds()) { const r = window.__inspector.issue(i); const d = Math.hypot(r.x - px, r.z - pz); if (d < bd) { bd = d; best = i; } }
        return best;
      }, [p.x, p.z]);
      await page.evaluate((x) => window.__inspector.select(x), pickId);
      await page.waitForFunction(() => !window.__inspector.state().flying);
      const box = await page.locator('#map canvas').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let k = 0; k < 3; k++) { await page.mouse.wheel(0, 800); await page.waitForTimeout(60); }
      await page.mouse.move(box.x + 4, box.y + box.height - 4);
      await page.waitForTimeout(500);
      const file = path.join(out, `${prefix}_${tag}_${w}.png`);
      await page.screenshot({ path: file });
      console.log(file);
    }
    if (unnamed) {
      // a click on its card, as Anmol does it, and no zoom: the frame the page picks
      await page.evaluate(() => { document.querySelector('#search') && (document.querySelector('#search').value = ''); });
      await page.locator(`.row[data-id="${unnamed.id}"]`).click();
      await page.waitForFunction(() => !window.__inspector.state().flying);
      await page.waitForTimeout(600);
      const file = path.join(out, `${prefix}_unnamed_${w}.png`);
      await page.screenshot({ path: file });
      console.log(file);
    }
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`unnamed issue: ${unnamed?.id} (${unnamed ? describeIssue(unnamed, names).title : 'none'})`);
console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'console errors: none');
