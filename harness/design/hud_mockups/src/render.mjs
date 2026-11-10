// Renders the HUD mockup pages to PNG at 1920x1080 (and a 1600 px preview in the scratch folder if given).
// Usage: node harness/design/hud_mockups/src/render.mjs [name ...]
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '..');
const all = fs.readdirSync(here).filter(f => /^\d\d_.*\.html$/.test(f)).map(f => f.replace(/\.html$/, ''));
const names = process.argv.slice(2).length ? process.argv.slice(2) : all;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
for (const n of names) {
  await page.goto(pathToFileURL(path.join(here, `${n}.html`)).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  const file = path.join(outDir, `${n}.png`);
  await page.screenshot({ path: file });
  console.log('wrote', file);
}
await browser.close();
