#!/usr/bin/env node
// On-foot frame strips (P2-041): lays the shots of scenario foot_feel_strip out as contact sheets a person can judge.
//   node harness/bin/footstrip.mjs            run the scenario (windowed, lockstep), then draw the sheets
//   node harness/bin/footstrip.mjs --draw     draw from the shots already in harness/reports/shots/
// Writes harness/reports/foot/strip_<move>.png (two rows: the play camera, then the side camera; one column per
// frame, the frame's time under it) for walk, jog, sprint, start, stop and turn, and strips.png with all of them.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHOTS = path.join(ROOT, 'harness/reports/shots');
const OUT = path.join(ROOT, 'harness/reports/foot');
const MOVES = { walk: 5, jog: 3, sprint: 2, start: 3, stop: 3, turn: 3 };
// crops as fractions of the frame [x, y, w, h]: the play camera has the body left of the middle (shoulder offset)
const CROP = { play: [0.3, 0.2, 0.34, 0.78], side: [0.33, 0.12, 0.34, 0.78] };
const TILE = [190, 245];
const LABEL = 22;

async function tile(file, crop) {
  const img = sharp(file);
  const m = await img.metadata();
  const box = { left: Math.round(crop[0] * m.width), top: Math.round(crop[1] * m.height), width: Math.round(crop[2] * m.width), height: Math.round(crop[3] * m.height) };
  return img.extract(box).resize(TILE[0], TILE[1], { fit: 'cover' }).png().toBuffer();
}

const text = (w, h, s, size = 14) => Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="#16181c"/><text x="6" y="${Math.round(h * 0.72)}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" fill="#e8e4da">${s}</text></svg>`);

async function sheet(move, every) {
  const frames = fs.readdirSync(SHOTS).filter((f) => f.startsWith(`strip_${move}_`) && f.endsWith('_play.png')).sort();
  if (!frames.length) return null;
  const w = frames.length * TILE[0];
  const h = LABEL + 2 * (TILE[1] + LABEL);
  const parts = [{ input: text(w, LABEL, `${move}: play camera (top), side camera (bottom), one frame every ${every} ticks (${Math.round((every * 1000) / 60)} ms)`), left: 0, top: 0 }];
  for (let i = 0; i < frames.length; i++) {
    for (const [row, view] of [[0, 'play'], [1, 'side']]) {
      const f = path.join(SHOTS, frames[i].replace('_play.png', `_${view}.png`));
      if (!fs.existsSync(f)) continue;
      const top = LABEL + row * (TILE[1] + LABEL);
      parts.push({ input: await tile(f, CROP[view]), left: i * TILE[0], top });
      parts.push({ input: text(TILE[0], LABEL, `${view} ${((i * every) / 60).toFixed(2)} s`, 12), left: i * TILE[0], top: top + TILE[1] });
    }
  }
  const file = path.join(OUT, `strip_${move}.png`);
  await sharp({ create: { width: w, height: h, channels: 3, background: '#16181c' } }).composite(parts).png().toFile(file);
  return { file, w, h };
}

async function main() {
  if (!process.argv.includes('--draw')) {
    const r = spawnSync('node', ['harness/bin/verify.mjs', '--only', 'foot_feel_strip', '--no-build', '--no-checks'], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) console.log('footstrip: the scenario did not pass; drawing what there is');
  }
  fs.mkdirSync(OUT, { recursive: true });
  const done = [];
  for (const [move, every] of Object.entries(MOVES)) {
    const s = await sheet(move, every);
    if (s) done.push(s);
  }
  if (!done.length) { console.log('footstrip: no strip_* shots in harness/reports/shots (run without --draw)'); process.exit(1); }
  const w = Math.max(...done.map((d) => d.w));
  let top = 0;
  const parts = [];
  for (const d of done) { parts.push({ input: d.file, left: 0, top }); top += d.h; }
  const all = path.join(OUT, 'strips.png');
  await sharp({ create: { width: w, height: top, channels: 3, background: '#16181c' } }).composite(parts).png().toFile(all);
  for (const d of done) console.log(path.relative(ROOT, d.file));
  console.log(path.relative(ROOT, all));
}

main().catch((e) => { console.log(`footstrip: ${e.message}`); process.exit(1); });
