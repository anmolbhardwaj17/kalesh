#!/usr/bin/env node
// Test builds of the game (P1-027, TECH.md "Verify harness and shipping", EM1 and EW1): the Mac app and the Windows export.
//
//   node harness/bin/export.mjs mac        ad hoc signed universal app in Kalesh-mac.zip, tiles pack inside the app
//   node harness/bin/export.mjs windows    Kalesh.exe, Kalesh.pck and the stage pack, unsigned, in Kalesh-windows.zip
//   node harness/bin/export.mjs all        both, then adds the Windows test notice on the dashboard (once)
//   node harness/bin/export.mjs smoke      unzips Kalesh-mac.zip to a clean folder and runs boot_title, hooks_no_debug and FD0
//                                          against that exported app through the driver (HARNESS_EXPORTED_APP)
//   node harness/bin/export.mjs list       the files of the last builds with their sizes (builds.json)
// Options: --tiles <dir> (the tile folder to pack; default game/world/tiles, the full set the bake wrote; its bake hash
// must be the one game/world/tiles.hash names).
// Output (gitignored, harness/reports/builds/): mac/Kalesh.app, Kalesh-mac.zip, windows/, Kalesh-windows.zip, packs/stage_<stage>.pck,
// logs/*.log (the engine's export output), builds.json (every file and its size). The export presets are game/export_presets.cfg.
// The data pack is made by tools/export/pack_stage.gd (Godot's PCKPacker): the tiles are NOT in the main pack (preset exclude
// filter world/tiles/*), the game mounts every stage_<name>.pck next to the executable (game/core/data_packs.gd). A new map
// stage is one more pack. A build without --debug has no debug server (the game never loads it).
// An export fails on any ERROR line of the engine's output. Developer ID signing and notarisation wait for the owner.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT } from './lib.mjs';
import { resolveGodot, errorLines, stripAnsi } from './godot.mjs';
import { checkSet, expectedTiles, TILES_DIR } from './tileset.mjs';

export const OUT = path.join(ROOT, 'harness', 'reports', 'builds');
const APP_NAME = 'Kalesh';
const MAC_PRESET = 'macOS';
const WIN_PRESET = 'Windows';

/** Human size, for the listing. */
export function sizeText(bytes) {
  if (bytes >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(2)} GB`;
  if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(1)} MB`;
  if (bytes >= 1 << 10) return `${(bytes / (1 << 10)).toFixed(1)} KB`;
  return `${bytes} B`;
}

/** The pack file name of a map stage: stage_<name>.pck (game/core/data_packs.gd mounts files with this name). */
export function packName(stage) {
  const clean = String(stage || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (!clean) throw new Error('the tile index has no stage name');
  return `stage_${clean}.pck`;
}

/** Files under dir (recursive), as [{file (relative), bytes}], sorted. Symlinks are not followed. */
export function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push({ file: path.relative(dir, p), bytes: fs.statSync(p).size });
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 << 20, ...opts });
  return { status: r.status, out: stripAnsi(`${r.stdout || ''}${r.stderr || ''}`) };
}

function readArgs(argv) {
  const opt = (k) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
  return { cmd: argv.find((a) => !a.startsWith('--')) || '', tiles: opt('--tiles') };
}

async function engine() {
  const g = await resolveGodot({ allowDownload: false });
  return g.path;
}

/** The headless import (fills game/.godot so the export sees every resource). Fails on an ERROR line. */
function importProject(bin) {
  const r = run(bin, ['--headless', '--path', path.join(ROOT, 'game'), '--import']);
  const errs = errorLines(r.out);
  if (r.status !== 0 || errs.length) throw new Error(`the project import failed:\n${errs.slice(0, 5).join('\n') || r.out.slice(-600)}`);
}

/** Makes (or reuses) the stage pack of a tile folder; returns {file, stage, bakeHash, bytes, files}. */
function buildPack(bin, tilesDir) {
  const idx = JSON.parse(fs.readFileSync(path.join(tilesDir, 'index.json'), 'utf8'));
  const want = expectedTiles(ROOT);
  if (want && path.resolve(tilesDir) === path.resolve(ROOT, TILES_DIR)) {
    const chk = checkSet(ROOT, want);
    if (!chk.ok) throw new Error(chk.reason);
  }
  const file = path.join(OUT, 'packs', packName(idx.stage));
  const mark = `${file}.hash`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!(fs.existsSync(file) && fs.existsSync(mark) && fs.readFileSync(mark, 'utf8').trim() === String(idx.bakeHash))) {
    fs.rmSync(file, { force: true });
    const r = run(bin, ['--headless', '--path', path.join(ROOT, 'game'), '--script', path.join(ROOT, 'tools', 'export', 'pack_stage.gd'), '--', path.resolve(tilesDir), file]);
    fs.mkdirSync(path.join(OUT, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(OUT, 'logs', 'pack.log'), r.out);
    const errs = errorLines(r.out);
    if (r.status !== 0 || errs.length || !fs.existsSync(file)) throw new Error(`the data pack failed: ${errs.slice(0, 3).join(' | ') || r.out.slice(-400)}`);
    fs.writeFileSync(mark, String(idx.bakeHash));
  }
  return { file, stage: idx.stage, bakeHash: idx.bakeHash, bytes: fs.statSync(file).size, files: idx.tiles.length };
}

/** Runs one Godot export of a preset; the log is kept and any ERROR line fails the export. */
function exportPreset(bin, preset, target, logName) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const r = run(bin, ['--headless', '--path', path.join(ROOT, 'game'), '--export-release', preset, target]);
  fs.mkdirSync(path.join(OUT, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'logs', `${logName}.log`), r.out);
  const errs = errorLines(r.out);
  if (r.status !== 0 || errs.length) throw new Error(`the ${preset} export failed (log harness/reports/builds/logs/${logName}.log):\n${errs.slice(0, 5).join('\n') || r.out.slice(-600)}`);
  return r.out;
}

function record(key, value) {
  const f = path.join(OUT, 'builds.json');
  let j = {};
  try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* new */ }
  j[key] = value;
  fs.writeFileSync(f, JSON.stringify(j, null, 1) + '\n');
}

function filesEntry(dir, builtAt = new Date().toISOString()) {
  const files = listFiles(dir);
  return { dir: path.relative(ROOT, dir), builtAt, bytes: files.reduce((n, f) => n + f.bytes, 0), files };
}

export async function buildMac(tilesDir) {
  const bin = await engine();
  importProject(bin);
  const pack = buildPack(bin, tilesDir);
  const dir = path.join(OUT, 'mac');
  fs.rmSync(dir, { recursive: true, force: true });
  const app = path.join(dir, `${APP_NAME}.app`);
  exportPreset(bin, MAC_PRESET, app, 'mac');
  // The stage pack goes into the bundle's Resources (the game looks there, data_packs.gd); that breaks the export's ad hoc
  // signature, so the bundle is signed again (ad hoc: no Apple account needed for a test build) and checked.
  fs.copyFileSync(pack.file, path.join(app, 'Contents', 'Resources', path.basename(pack.file)));
  const sign = run('codesign', ['--force', '--deep', '--sign', '-', app]);
  if (sign.status !== 0) throw new Error(`ad hoc signing failed: ${sign.out.slice(0, 400)}`);
  const verify = run('codesign', ['--verify', '--deep', '--strict', app]);
  if (verify.status !== 0) throw new Error(`the signed app does not verify: ${verify.out.slice(0, 400)}`);
  const archs = run('lipo', ['-archs', path.join(app, 'Contents', 'MacOS', APP_NAME)]).out.trim();
  const zip = path.join(OUT, `${APP_NAME}-mac.zip`);
  fs.rmSync(zip, { force: true });
  const z = run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);
  if (z.status !== 0 || !fs.existsSync(zip)) throw new Error(`zip failed: ${z.out.slice(0, 300)}`);
  const entry = { ...filesEntry(dir), archs, signature: 'ad hoc', zip: { file: path.relative(ROOT, zip), bytes: fs.statSync(zip).size }, pack: { file: path.basename(pack.file), stage: pack.stage, bakeHash: pack.bakeHash, bytes: pack.bytes } };
  record('mac', entry);
  return entry;
}

export async function buildWindows(tilesDir) {
  const bin = await engine();
  importProject(bin);
  const pack = buildPack(bin, tilesDir);
  const dir = path.join(OUT, 'windows');
  fs.rmSync(dir, { recursive: true, force: true });
  exportPreset(bin, WIN_PRESET, path.join(dir, `${APP_NAME}.exe`), 'windows');
  fs.copyFileSync(pack.file, path.join(dir, path.basename(pack.file)));
  const zip = path.join(OUT, `${APP_NAME}-windows.zip`);
  fs.rmSync(zip, { force: true });
  const z = run('zip', ['-r', '-q', zip, path.basename(dir)], { cwd: OUT });
  // zip the folder under its own name: unzipping gives windows/Kalesh.exe next to its packs
  if (z.status !== 0 || !fs.existsSync(zip)) throw new Error(`zip failed: ${z.out.slice(0, 300)}`);
  const entry = { ...filesEntry(dir), signature: 'unsigned', zip: { file: path.relative(ROOT, zip), bytes: fs.statSync(zip).size }, pack: { file: path.basename(pack.file), stage: pack.stage, bakeHash: pack.bakeHash, bytes: pack.bytes } };
  const have = new Set(entry.files.map((f) => f.file));
  for (const need of [`${APP_NAME}.exe`, `${APP_NAME}.pck`, path.basename(pack.file)]) {
    if (!have.has(need)) throw new Error(`the Windows export has no ${need}`);
  }
  record('windows', entry);
  return entry;
}

const WINDOWS_NOTICE = 'Test build for Windows: harness/reports/builds/Kalesh-windows.zip (exe plus the map pack, unsigned). It cannot be run on this Mac. Please try it on your PC and on your friend\'s: unzip, double click Kalesh.exe, and tell me whether it starts, shows the city and drives (Windows may warn that the app is unsigned: More info, Run anyway).';

function addWindowsNotice() {
  const list = run('node', [path.join(ROOT, 'harness', 'bin', 'notice.mjs'), 'list']).out;
  if (list.includes('Test build for Windows')) return 'already on the dashboard';
  return run('node', [path.join(ROOT, 'harness', 'bin', 'notice.mjs'), 'add', WINDOWS_NOTICE]).out.trim();
}

/** Unzips the Mac zip into a clean folder and runs the three smoke checks on that exported app. */
export function smokeMac() {
  const zip = path.join(OUT, `${APP_NAME}-mac.zip`);
  if (!fs.existsSync(zip)) throw new Error('no Kalesh-mac.zip: run `node harness/bin/export.mjs mac` first');
  const dir = path.join(OUT, 'smoke');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const u = run('ditto', ['-x', '-k', zip, dir]);
  const exe = path.join(dir, `${APP_NAME}.app`, 'Contents', 'MacOS', APP_NAME);
  if (u.status !== 0 || !fs.existsSync(exe)) throw new Error(`could not unzip the app: ${u.out.slice(0, 300)}`);
  // The first launch of a freshly unzipped app is slow (macOS checks the new binary and reads the whole pack): one
  // throwaway headless start first, so the boot time the scenarios judge is the app's, not the system's.
  const warm = run(exe, ['--headless', '--quit-after', '30', '--', '--verify']);
  console.log(`smoke: warm-up start of the unzipped app ${warm.status === 0 ? 'ok' : `exited ${warm.status}`}`);
  const env = { ...process.env, HARNESS_EXPORTED_APP: exe };
  const verify = path.join(ROOT, 'harness', 'bin', 'verify.mjs');
  const base = ['--no-checks', '--no-build'];
  const steps = [
    ['scenarios boot_title and hooks_no_debug', ['--only', 'boot_title,hooks_no_debug', ...base, '--report', path.join(OUT, 'smoke_scenarios.json'), '--shots', path.join(OUT, 'smoke_shots')]],
    ['milestone FD0', ['--milestone', 'FD0', '--no-build', '--report', path.join(OUT, 'smoke_fd0.json'), '--shots', path.join(OUT, 'smoke_shots')]],
  ];
  const results = [];
  for (const [label, a] of steps) {
    console.log(`smoke: ${label} on ${path.relative(ROOT, exe)}`);
    const r = spawnSync('node', [verify, ...a], { cwd: ROOT, env, stdio: 'inherit' });
    results.push({ label, ok: r.status === 0 });
  }
  record('macSmoke', { at: new Date().toISOString(), exe: path.relative(ROOT, exe), results });
  return results;
}

function printEntry(name, e) {
  console.log(`\n${name}: ${e.dir}  (${sizeText(e.bytes)})${e.archs ? `  archs ${e.archs}` : ''}  ${e.signature}`);
  for (const f of e.files.filter((x) => x.bytes >= 1 << 20 || !x.file.includes('/'))) console.log(`  ${f.file.padEnd(52)} ${sizeText(f.bytes)}`);
  console.log(`  zip: ${e.zip.file}  ${sizeText(e.zip.bytes)}`);
}

async function main() {
  const a = readArgs(process.argv.slice(2));
  const tilesDir = path.resolve(a.tiles || path.join(ROOT, TILES_DIR));
  if (a.cmd === 'mac') printEntry('mac', await buildMac(tilesDir));
  else if (a.cmd === 'windows') printEntry('windows', await buildWindows(tilesDir));
  else if (a.cmd === 'all') {
    printEntry('mac', await buildMac(tilesDir));
    printEntry('windows', await buildWindows(tilesDir));
    console.log(`\nnotice: ${addWindowsNotice()}`);
  } else if (a.cmd === 'smoke') {
    const res = smokeMac();
    if (res.some((r) => !r.ok)) { console.error(`SMOKE FAIL: ${res.filter((r) => !r.ok).map((r) => r.label).join(', ')}`); process.exit(1); }
    console.log('SMOKE OK: boot_title, hooks_no_debug and FD0 pass on the exported Mac app');
  } else if (a.cmd === 'list') {
    let j = {};
    try { j = JSON.parse(fs.readFileSync(path.join(OUT, 'builds.json'), 'utf8')); } catch { /* none */ }
    for (const k of ['mac', 'windows']) if (j[k]) printEntry(k, j[k]);
    if (j.macSmoke) console.log(`\nmac smoke ${j.macSmoke.at}: ${j.macSmoke.results.map((r) => `${r.label} ${r.ok ? 'ok' : 'FAIL'}`).join('; ')}`);
  } else {
    console.error('usage: node harness/bin/export.mjs mac | windows | all | smoke | list   [--tiles <dir>]');
    process.exit(2);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`export failed: ${e.message}`); process.exit(1); });
}
