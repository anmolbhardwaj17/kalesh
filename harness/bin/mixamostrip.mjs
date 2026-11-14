#!/usr/bin/env node
// Mixamo candidate strips (P2-072): renders candidate clips on a lead model and lays them out as one sheet per
// lead and role, so the picks per lead (harness/reports/leads/mixamo_picks.md) are made by eye.
//   node harness/bin/mixamostrip.mjs                  every role of CANDIDATES on all three leads
//   node harness/bin/mixamostrip.mjs --lead meera --role walk
//   node harness/bin/mixamostrip.mjs --draw           draw from the frames already rendered
//   node harness/bin/mixamostrip.mjs --set <name> --lead <id> <clip>...   any clips, sheet mixamo_<name>_<id>.png
//   node harness/bin/mixamostrip.mjs --layers [--draw]  scenario lead_layers (the layers in game: pistol and aim, phone,
//                                             texting, carrying, wave, flinch), harness/reports/leads/mixamo_layers.png
// Renders with game/characters/tools/mixamo_strips.gd (a window parked off screen at 30000,30000; it never shows).
// One row per clip: 4 frames from behind, then the same 4 frames from the lead's left side, on a ground plane.
// Writes harness/reports/leads/mixamo_<role>_<lead>.png (frames in harness/reports/leads/mxframes/).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'harness/reports/leads');
const FRAMES = path.join(OUT, 'mxframes');
const LEADS = ['bittu', 'meera', 'danny'];
// Candidate clips per role (names from game/data/mixamo_clips.json).
export const CANDIDATES = {
  idle: ['breathing_idle', 'idle', 'idle_1', 'idle_2', 'idle_4', 'neutral_idle', 'happy_idle', 'looking_around', 'bored', 'catwalk_idle'],
  walk: ['walking', 'walking_1', 'walking_2', 'walking_3', 'walking_4', 'strut_walking', 'female_walk', 'female_tough_walk', 'catwalk_walk_forward_01', 'catwalk_walk_forward_03'],
  jog: ['jogging', 'jogging_1', 'jogging_2', 'slow_run'],
  run: ['run_forward', 'unarmed_run_forward', 'fast_run', 'sprint'],
  startstop: ['start_walking', 'stop_walking', 'female_start_walking', 'female_stop_walking', 'run_to_stop', 'run_to_stop_1'],
  turn: ['left_turn', 'right_turn', 'walking_left_turn', 'running_turn_180', 'quick_180_turn'],
};
const N = 4;
const TILE = [120, 175];
const LABEL_W = 150;

const text = (w, h, s, size = 13) => Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="#16181c"/><text x="6" y="${Math.round(h * 0.55)}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" fill="#e8e4da">${s}</text></svg>`);

function render(lead, clips) {
  fs.mkdirSync(FRAMES, { recursive: true });
  const bin = spawnSync('node', ['harness/bin/godot.mjs', 'path'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const r = spawnSync(bin, ['--path', 'game', '--position', '30000,30000', '-s', 'res://characters/tools/mixamo_strips.gd', '--', FRAMES, lead, ...clips], { cwd: ROOT, encoding: 'utf8', timeout: 900000 });
  if (r.status !== 0) console.log(`mixamostrip: render ${lead} failed (exit ${r.status})\n${(r.stderr || '').split('\n').filter((l) => /ERROR|mixamo/.test(l)).join('\n')}`);
}

async function tile(file) {
  const m = await sharp(file).metadata();
  const box = { left: Math.round(m.width * 0.33), top: Math.round(m.height * 0.07), width: Math.round(m.width * 0.34), height: Math.round(m.height * 0.88) };
  return sharp(file).extract(box).resize(TILE[0], TILE[1], { fit: 'cover' }).png().toBuffer();
}

async function sheet(name, lead, clips) {
  const rows = clips.filter((c) => fs.existsSync(path.join(FRAMES, `mxs_${lead}_${c}_0_back.png`)));
  if (!rows.length) return null;
  const w = LABEL_W + 2 * N * TILE[0] + 8;
  const head = 26;
  const h = head + rows.length * TILE[1];
  const comp = [{ input: text(w, head, `${lead}: ${name} candidates. 4 frames from behind, then the same 4 from the left side`, 14), left: 0, top: 0 }];
  for (let r = 0; r < rows.length; r++) {
    const top = head + r * TILE[1];
    comp.push({ input: text(LABEL_W, TILE[1], rows[r]), left: 0, top });
    for (let i = 0; i < N; i++) {
      for (const [k, view] of [[0, 'back'], [1, 'side']]) {
        const f = path.join(FRAMES, `mxs_${lead}_${rows[r]}_${i}_${view}.png`);
        if (!fs.existsSync(f)) continue;
        comp.push({ input: await tile(f), left: LABEL_W + k * (N * TILE[0] + 8) + i * TILE[0], top });
      }
    }
  }
  const file = path.join(OUT, `mixamo_${name}_${lead}.png`);
  await sharp({ create: { width: w, height: h, channels: 3, background: '#16181c' } }).composite(comp).png().toFile(file);
  return file;
}

// --layers: one row per lead, one column per layer shot of scenario lead_layers
const LAYERS = ['pistol', 'phone', 'text', 'carry', 'wave', 'flinch'];
async function layers(draw) {
  if (!draw) {
    const r = spawnSync('node', ['harness/bin/verify.mjs', '--only', 'lead_layers', '--no-build', '--no-checks'], { cwd: ROOT, encoding: 'utf8', timeout: 1800000 });
    console.log((r.stdout || '').split('\n').filter((l) => /lead_layers|FAIL|ok/.test(l)).slice(-6).join('\n'));
  }
  const shots = path.join(ROOT, 'harness/reports/shots');
  const T = [260, 340];
  const head = 26;
  const comp = [{ input: text(LABEL_W + LAYERS.length * T[0], head, 'Layers in game: pistol aim with the chest aimed 30 deg left, phone and texting while walking, carrying, wave, head flinch', 14), left: 0, top: 0 }];
  LEADS.forEach((lead, r) => {
    comp.push({ input: text(LABEL_W, T[1], lead), left: 0, top: head + r * T[1] });
  });
  for (let r = 0; r < LEADS.length; r++) {
    for (let c = 0; c < LAYERS.length; c++) {
      const f = path.join(shots, `lead_${LEADS[r]}_layer_${LAYERS[c]}.png`);
      if (!fs.existsSync(f)) continue;
      const m = await sharp(f).metadata();
      const box = { left: Math.round(m.width * 0.3), top: Math.round(m.height * 0.05), width: Math.round(m.width * 0.4), height: Math.round(m.height * 0.92) };
      comp.push({ input: await sharp(f).extract(box).resize(T[0], T[1], { fit: 'cover' }).png().toBuffer(), left: LABEL_W + c * T[0], top: head + r * T[1] });
      comp.push({ input: text(90, 20, LAYERS[c], 12), left: LABEL_W + c * T[0], top: head + r * T[1] });
    }
  }
  const file = path.join(OUT, 'mixamo_layers.png');
  await sharp({ create: { width: LABEL_W + LAYERS.length * T[0], height: head + LEADS.length * T[1], channels: 3, background: '#16181c' } }).composite(comp).png().toFile(file);
  console.log(path.relative(ROOT, file));
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--layers')) return layers(argv.includes('--draw'));
  const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const draw = argv.includes('--draw');
  const leads = opt('--lead') ? [opt('--lead')] : LEADS;
  const set = opt('--set');
  if (set) {
    const clips = argv.filter((a, i) => !a.startsWith('--') && !['--set', '--lead'].includes(argv[i - 1]));
    for (const lead of leads) {
      if (!draw) render(lead, clips);
      const f = await sheet(set, lead, clips);
      if (f) console.log(path.relative(ROOT, f));
    }
    return;
  }
  const roles = opt('--role') ? [opt('--role')] : Object.keys(CANDIDATES);
  for (const lead of leads) {
    if (!draw) render(lead, [...new Set(roles.flatMap((r) => CANDIDATES[r]))]);
    for (const role of roles) {
      const f = await sheet(role, lead, CANDIDATES[role]);
      if (f) console.log(path.relative(ROOT, f));
    }
  }
}

main();
