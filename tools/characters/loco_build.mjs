#!/usr/bin/env node
// Locomotion clip build (P2-041): the game's walk, jog, sprint and crouch walk cycles with planted feet, and the start,
// stop and plant-and-turn clips, made from the Universal Animation Library clips already in game/characters/rig/.
//   node tools/characters/loco_build.mjs
// Runs game/characters/tools/build_locomotion.gd headless (it reads rig/ual_clips.res and rig/mannequin_m.scn and
// writes rig/loco_clips.res, the only output, committed) and prints one line per clip: speed, cadence, step, how much
// faster the cycle is than the library clip, foot slide. Needs no download: run tools/characters/ual_build.mjs first
// only when rig/ual_clips.res is missing.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bin = spawnSync('node', ['harness/bin/godot.mjs', 'path'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const r = spawnSync(bin, ['--headless', '--path', 'game', '-s', 'res://characters/tools/build_locomotion.gd', '--quit-after', '20000'],
  { cwd: ROOT, encoding: 'utf8', timeout: 600000 });
const text = `${r.stdout}\n${r.stderr}`;
const bad = r.status !== 0 || /SCRIPT ERROR|^ERROR: (?!.*(leaked|still in use|Pages in use))/m.test(text) || !/build_locomotion: ok/.test(text);
const lines = text.split('\n').filter((l) => /^(gait|move|ground|build_locomotion)/.test(l) || (bad && /ERROR|error|at:/.test(l)));
console.log(lines.join('\n'));
if (bad) { console.log(`loco_build: failed (exit ${r.status})`); process.exit(1); }
const out = path.join(ROOT, 'game/characters/rig/loco_clips.res');
console.log(`${path.relative(ROOT, out)} ${(fs.statSync(out).size / 1e6).toFixed(2)} MB`);
