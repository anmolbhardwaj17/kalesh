#!/usr/bin/env node
// Lead model shot sheets (P2-063): lays the shots of scenario lead_sheet out as one sheet per lead a person can judge.
//   node harness/bin/leadsheet.mjs            run the scenarios lead_sheet and lead_street (windowed, lockstep), then draw
//   node harness/bin/leadsheet.mjs --draw     draw from the shots already in harness/reports/shots/
//   node harness/bin/leadsheet.mjs --compare [--draw]   scenario lead_compare: stand-in and model side by side,
//                                             harness/reports/leads/compare_<id>.png
//   node harness/bin/leadsheet.mjs --rest [--draw]      the rest pose proof (game/characters/tools/lead_rest_shots.gd, a
//                                             window parked off screen): per lead the approved picture, the model as
//                                             delivered and the built model at rest, front and back,
//                                             harness/reports/leads/rest.png
// Writes harness/reports/leads/<id>.png (about 1600 px wide: the standing views, the close-ups, walk and jog from the
// play and the side camera, the seated pose) and, when they exist, the street shots lead_<id>_street*.png beside them.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHOTS = path.join(ROOT, 'harness/reports/shots');
const OUT = path.join(ROOT, 'harness/reports/leads');
const LEADS = ['bittu', 'meera', 'danny'];
// [shot suffix, label, crop [x, y, w, h] as fractions of the frame]
const FULL = [0.3, 0.0, 0.4, 1.0];
const ROWS = [
  [['front', 'front 3 m (play mesh)', FULL], ['side', 'side 3 m', FULL], ['back', 'back 3 m', FULL], ['three', 'three quarter 3 m', FULL]],
  [['close', 'close-up 0.95 m (full mesh)', [0.15, 0.0, 0.7, 1.0]], ['hands', 'hands 1.1 m', [0.1, 0.0, 0.8, 1.0]], ['drive_side', 'seated Driving pose', [0.2, 0.0, 0.6, 1.0]], ['drive_three', 'seated, three quarter', [0.2, 0.0, 0.6, 1.0]]],
  [['walk_play', 'walk, play camera', [0.25, 0.1, 0.5, 0.9]], ['walk_side', 'walk, side', FULL], ['jog_play', 'jog, play camera', [0.25, 0.1, 0.5, 0.9]], ['jog_side', 'jog, side', FULL]],
  [['street_play', 'street, player height', [0.0, 0.0, 1.0, 1.0]], ['street_close', 'street, close', [0.0, 0.0, 1.0, 1.0]]],
];
const TILE = [400, 400];
const LABEL = 24;

const text = (w, h, s, size = 15) => Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="#16181c"/><text x="8" y="${Math.round(h * 0.72)}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" fill="#e8e4da">${s}</text></svg>`);

async function tile(file, crop) {
  const img = sharp(file);
  const m = await img.metadata();
  const box = { left: Math.round(crop[0] * m.width), top: Math.round(crop[1] * m.height), width: Math.round(crop[2] * m.width), height: Math.round(crop[3] * m.height) };
  return img.extract(box).resize(TILE[0], TILE[1], { fit: 'contain', background: '#16181c' }).png().toBuffer();
}

async function sheet(id) {
  const rows = ROWS.map((r) => r.filter(([s]) => fs.existsSync(path.join(SHOTS, `lead_${id}_${s}.png`)))).filter((r) => r.length);
  if (!rows.length) return null;
  const w = 4 * TILE[0];
  const h = LABEL + rows.length * (TILE[1] + LABEL);
  const parts = [{ input: text(w, LABEL, `${id}: own model (rig/lead_${id}.scn), default look, sim held for every shot`, 16), left: 0, top: 0 }];
  rows.forEach((r, ri) => r.forEach(([s, label, crop], ci) => parts.push({ suffix: s, label, crop, left: ci * TILE[0], top: LABEL + ri * (TILE[1] + LABEL) })));
  const comp = [];
  for (const p of parts) {
    if (p.input) { comp.push(p); continue; }
    comp.push({ input: await tile(path.join(SHOTS, `lead_${id}_${p.suffix}.png`), p.crop), left: p.left, top: p.top });
    comp.push({ input: text(TILE[0], LABEL, p.label, 14), left: p.left, top: p.top + TILE[1] });
  }
  const file = path.join(OUT, `${id}.png`);
  await sharp({ create: { width: w, height: h, channels: 3, background: '#16181c' } }).composite(comp).png().toFile(file);
  return file;
}

// --compare: per lead, rows idle, walk, jog; columns stand-in back, model back, stand-in side, model side
async function compare(id) {
  const T = [400, 360];
  const cols = [['standin', 'back'], ['model', 'back'], ['standin', 'side'], ['model', 'side']];
  const moves = ['idle', 'walk', 'jog'];
  const w = 4 * T[0];
  const h = LABEL + moves.length * (T[1] + LABEL);
  const comp = [{ input: text(w, LABEL, `${id}: stand-in mannequin and own model, same frame of each clip, from behind and the side`, 16), left: 0, top: 0 }];
  for (let r = 0; r < moves.length; r++) {
    for (let c = 0; c < cols.length; c++) {
      const f = path.join(SHOTS, `cmp_${id}_${cols[c][0]}_${moves[r]}_${cols[c][1]}.png`);
      if (!fs.existsSync(f)) continue;
      const img = sharp(f);
      const m = await img.metadata();
      const box = { left: Math.round(0.28 * m.width), top: 0, width: Math.round(0.44 * m.width), height: m.height };
      const top = LABEL + r * (T[1] + LABEL);
      comp.push({ input: await img.extract(box).resize(T[0], T[1], { fit: 'contain', background: '#16181c' }).png().toBuffer(), left: c * T[0], top });
      comp.push({ input: text(T[0], LABEL, `${moves[r]}: ${cols[c][0] === 'standin' ? 'stand-in' : 'model'}, ${cols[c][1]}`, 14), left: c * T[0], top: top + T[1] });
    }
  }
  const file = path.join(OUT, `compare_${id}.png`);
  await sharp({ create: { width: w, height: h, channels: 3, background: '#16181c' } }).composite(comp).png().toFile(file);
  return file;
}

// --rest: rows bittu, meera, danny; columns approved picture, delivered front, built front, delivered back, built back
async function rest() {
  const T = [300, 420];
  const cols = [['pic', 'approved picture'], ['src_front', 'as delivered, front'], ['built_front', 'built, at rest, front'], ['src_back', 'as delivered, back'], ['built_back', 'built, at rest, back']];
  const w = cols.length * T[0];
  const h = LABEL + LEADS.length * (T[1] + LABEL);
  const comp = [{ input: text(w, LABEL, 'Rest pose: the model as delivered (its bind pose) and the built lead with its skeleton at rest must match', 16), left: 0, top: 0 }];
  for (let r = 0; r < LEADS.length; r++) {
    const id = LEADS[r];
    const top = LABEL + r * (T[1] + LABEL);
    for (let c = 0; c < cols.length; c++) {
      const f = cols[c][0] === 'pic' ? path.join(ROOT, `public/assets/portraits/portrait_lead_${id}.webp`) : path.join(OUT, `rest_${id}_${cols[c][0]}.png`);
      if (!fs.existsSync(f)) continue;
      let img = sharp(f);
      if (cols[c][0] !== 'pic') {
        const m = await img.metadata();
        img = sharp(await img.extract({ left: Math.round(m.width * 0.3), top: Math.round(m.height * 0.04), width: Math.round(m.width * 0.4), height: Math.round(m.height * 0.94) }).toBuffer());
      }
      comp.push({ input: await img.resize(T[0], T[1], { fit: 'contain', background: '#16181c' }).png().toBuffer(), left: c * T[0], top });
      comp.push({ input: text(T[0], LABEL, `${id}: ${cols[c][1]}`, 14), left: c * T[0], top: top + T[1] });
    }
  }
  const file = path.join(OUT, 'rest.png');
  await sharp({ create: { width: w, height: h, channels: 3, background: '#16181c' } }).composite(comp).png().toFile(file);
  return file;
}

async function main() {
  if (process.argv.includes('--rest')) {
    fs.mkdirSync(OUT, { recursive: true });
    if (!process.argv.includes('--draw')) {
      const bin = spawnSync('node', ['harness/bin/godot.mjs', 'path'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
      const r = spawnSync(bin, ['--path', 'game', '--position', '30000,30000', '-s', 'res://characters/tools/lead_rest_shots.gd', '--', OUT, ...LEADS], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
      if (r.status !== 0) console.log(`leadsheet: rest shots failed (exit ${r.status})\n${r.stderr}`);
    }
    console.log(path.relative(ROOT, await rest()));
    return;
  }
  if (process.argv.includes('--compare')) {
    if (!process.argv.includes('--draw')) {
      const r = spawnSync('node', ['harness/bin/verify.mjs', '--only', 'lead_compare', '--no-build', '--no-checks'], { cwd: ROOT, stdio: 'inherit' });
      if (r.status !== 0) console.log('leadsheet: the scenario did not pass; drawing what there is');
    }
    fs.mkdirSync(OUT, { recursive: true });
    for (const id of LEADS) console.log(path.relative(ROOT, await compare(id)));
    return;
  }
  if (!process.argv.includes('--draw')) {
    const r = spawnSync('node', ['harness/bin/verify.mjs', '--only', 'lead_sheet,lead_street', '--no-build', '--no-checks'], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) console.log('leadsheet: the scenario did not pass; drawing what there is');
  }
  fs.mkdirSync(OUT, { recursive: true });
  const done = [];
  for (const id of LEADS) {
    const f = await sheet(id);
    if (f) done.push(f);
  }
  if (!done.length) { console.log('leadsheet: no lead_* shots in harness/reports/shots (run without --draw)'); process.exit(1); }
  for (const f of done) console.log(path.relative(ROOT, f));
}

main().catch((e) => { console.log(`leadsheet: ${e.message}`); process.exit(1); });
