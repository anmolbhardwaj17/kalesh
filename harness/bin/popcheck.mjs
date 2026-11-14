#!/usr/bin/env node
// Pop check of a landmark frame sequence (P2-007, harness/verify/scripts/landmark_pop_seq.js). Reads the frames the
// scenario returned in harness/reports/latest.json (its summary) (name, distance, level, the landmark's box on screen), crops that box
// (plus half its size round it) from each shot, and measures the mean luma change from one frame to the next inside it.
// The camera moves 5.83 m a frame, so the picture changes a little every frame; a level change that pops shows as a
// change well over the frames round it: over POP_RATIO times the median of its window and over POP_MIN_LEVELS levels,
// at the frame where the level changes or the next one. Spikes elsewhere are listed as `spikes` (not a level change).
// Writes harness/reports/shots/<prefix><window>_sheet.png (the crops in order, the level under each) and prints JSON.
// Usage: node harness/bin/popcheck.mjs [--scenario landmark_pop_seq] [--prefix pop_ig_]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { H, parseArgs } from './lib.mjs';

export const POP_RATIO = 3;
export const POP_MIN_LEVELS = 4;

/** Frame to frame changes of a series and the pops among them (pure; popcheck.test.mjs). */
export function findPops(diffs, ratio = POP_RATIO, minLevels = POP_MIN_LEVELS) {
  const s = diffs.filter((d) => Number.isFinite(d)).slice().sort((a, b) => a - b);
  const med = s.length ? s[Math.floor((s.length - 1) / 2)] : 0;
  const pops = [];
  diffs.forEach((d, i) => {
    if (Number.isFinite(d) && d > ratio * med && d > minLevels) pops.push({ at: i + 1, diff: d });
  });
  return { median: med, max: s.length ? s[s.length - 1] : 0, pops };
}

async function crop(file, box, size) {
  const [x0, y0, x1, y1] = box;
  const w = Math.max(24, x1 - x0);
  const h = Math.max(24, y1 - y0);
  const left = Math.max(0, Math.round(x0 - w * 0.5));
  const top = Math.max(0, Math.round(y0 - h * 0.5));
  const right = Math.min(size[0], Math.round(x1 + w * 0.5));
  const bottom = Math.min(size[1], Math.round(y1 + h * 0.5));
  const meta = await sharp(file).metadata();
  const sx = meta.width / size[0];
  const sy = meta.height / size[1];
  const region = { left: Math.round(left * sx), top: Math.round(top * sy), width: Math.max(8, Math.round((right - left) * sx)), height: Math.max(8, Math.round((bottom - top) * sy)) };
  const img = sharp(file).extract(region);
  const luma = await img.clone().resize(64, 64, { fit: 'fill' }).greyscale().raw().toBuffer();
  const thumb = await img.clone().resize(160, 160, { fit: 'contain', background: '#000' }).png().toBuffer();
  return { luma, thumb };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scen = typeof args.scenario === 'string' ? args.scenario : 'landmark_pop_seq';
  const prefix = typeof args.prefix === 'string' ? args.prefix : 'pop_ig_';
  const latest = JSON.parse(fs.readFileSync(H('reports', 'latest.json'), 'utf8'));
  const sc = Array.isArray(latest.scenarios) ? latest.scenarios.find((s) => s.name === scen) : latest.scenarios?.[scen];
  if (!sc) throw new Error(`no scenario ${scen} in harness/reports/latest.json`);
  const frames = sc.script?.summary?.frames || sc.summary?.frames || [];
  if (!frames.length) throw new Error(`scenario ${scen} has no frames in its summary`);
  const groups = new Map();
  for (const f of frames) {
    const b = f.name.slice(prefix.length).split('_')[0];
    if (!groups.has(b)) groups.set(b, []);
    groups.get(b).push(f);
  }
  const out = { scenario: scen, windows: {} };
  for (const [b, list] of groups) {
    const crops = [];
    for (const f of list) crops.push({ f, ...(await crop(H('reports', 'shots', `${f.name}.png`), f.box, f.size)) });
    const diffs = [];
    for (let i = 1; i < crops.length; i++) {
      const a = crops[i - 1].luma;
      const c = crops[i].luma;
      let sum = 0;
      for (let k = 0; k < a.length; k++) sum += Math.abs(a[k] - c[k]);
      diffs.push(Math.round((sum / a.length) * 100) / 100);
    }
    const res = findPops(diffs);
    const changes = [];
    for (let i = 1; i < list.length; i++) if (list[i].level !== list[i - 1].level) changes.push({ at: i, from: list[i - 1].level, to: list[i].level, d: list[i].d, diff: diffs[i - 1] });
    // a pop is a spike at a level change (the frame of the change or the one after); other spikes are the run's own
    // change (aliasing of thin bands a few pixels high, traffic crossing the crop) and are listed, not failed
    const near = (at) => changes.some((c) => Math.abs(c.at - at) <= 1);
    out.windows[b] = { frames: list.length, median: res.median, max: res.max, pops: res.pops.filter((p) => near(p.at)), spikes: res.pops.filter((p) => !near(p.at)), levelChanges: changes };
    const cols = 12;
    const rows = Math.ceil(crops.length / cols);
    const sheet = path.join(H('reports', 'shots'), `${prefix}${b}_sheet.png`);
    await sharp({ create: { width: cols * 160, height: rows * 160, channels: 3, background: '#000' } })
      .composite(crops.map((c, i) => ({ input: c.thumb, left: (i % cols) * 160, top: Math.floor(i / cols) * 160 })))
      .png()
      .toFile(sheet);
    out.windows[b].sheet = path.relative(process.cwd(), sheet);
  }
  out.ok = Object.values(out.windows).every((w) => w.pops.length === 0);
  console.log(JSON.stringify(out, null, 1));
  process.exitCode = out.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main().catch((e) => {
  console.error(e.message);
  process.exit(2);
});
