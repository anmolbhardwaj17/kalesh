// One bake of the pilot centre per test run, shared by every pilot test (P1-038).
//
// Before this, each tools/bake/**/pilot_*.test.mjs ran its own bake driver (sources to its own step): eight bakes side
// by side, 5 to 9 minutes of wall clock and wall clock assertions that failed under outside load. Now a test asks
// `sharedBake()` for the whole bake (`npm run bake -- pilot --offline` into a cache folder); the first test of any test
// file that asks builds it, the others wait for it (a lock folder), and a later run with the same inputs reads it back
// with no bake at all. `memo(name, extra, produce)` is the same for a test's own special bake (no overrides, a pick
// from the inspector) or a slow pure computation.
//
// The cache key is a hash of everything the bake reads: the bake code (tools/bake, tools/geo, this folder, test files
// left out so a test edit keeps the cache), harness/data (districts, overrides, hero roads, the gate list; the
// milestones file is not a bake input), the pins of the pilot source files, and the node version. Any change to one
// of them gives a new folder and the old folder is deleted. The cache lives in node_modules/.cache/kalesh-bake
// (gitignored; about 400 MB). To force a fresh bake: delete that folder.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../bake/cli.ts';
import { stagePlan } from '../bake/layout/stages.ts';
import { bake, offlineNet } from '../bake/main.ts';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CACHE = path.join(ROOT, 'node_modules', '.cache', 'kalesh-bake');
const TODAY = '2026-11-12';
const STALE_LOCK_MS = 30 * 60 * 1000;

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every file under `dir` (sorted, repo relative) that passes `keep`. */
function walk(dir, keep, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') walk(p, keep, out);
    } else if (keep(p)) out.push(p);
  }
  return out;
}

const isTest = (p) => /\.test\.(ts|mjs)$/.test(p);

/**
 * The hash of everything the bake reads under `root`: the bake code, the data folder and the pins of `sourceIds`
 * (test files, the milestones file and everything else are left out so editing them keeps the cache).
 */
export function hashInputs(root, sourceIds) {
  const files = [
    ...walk(path.join(root, 'tools', 'bake'), (p) => !isTest(p)),
    ...walk(path.join(root, 'tools', 'geo'), (p) => !isTest(p)),
    ...walk(path.join(root, 'tools', 'testkit'), (p) => !isTest(p)),
    ...walk(path.join(root, 'harness', 'data'), (p) => !p.endsWith(`${path.sep}milestones.json`)),
  ];
  const h = crypto.createHash('sha256');
  for (const f of files) h.update(path.relative(root, f)).update('\0').update(fs.readFileSync(f)).update('\0');
  const pins = JSON.parse(fs.readFileSync(path.join(root, 'data', 'SOURCES.json'), 'utf8')).files;
  for (const id of sourceIds) h.update(`${id}:${pins[id]?.sha256 ?? 'unpinned'}\0`);
  h.update(process.version);
  return h.digest('hex').slice(0, 16);
}

let keyed;
/** The cache key of this checkout's pilot bake: see the header. */
export function bakeKey() {
  return (keyed ??= hashInputs(ROOT, pilotPlan().sources.map((s) => s.id)));
}

let planned;
/** The pilot stage plan (the same one the tests read). */
export function pilotPlan() {
  if (!planned) {
    const districts = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness/data/districts.json'), 'utf8'));
    planned = stagePlan(districts, 'pilot', fs.readFileSync(path.join(ROOT, 'harness/data/districts/pilot_centre.geojson'), 'utf8'));
  }
  return planned;
}

/** The pilot source files the bake needs, and the reason to skip when one is missing ('' when all are there). */
export function pilotMissing() {
  const plan = pilotPlan();
  const missing = ['osm.json', 'overture_buildings.json', 'gedtm30_window.json'].filter((f) => !fs.existsSync(path.join(ROOT, plan.def.dataDir, f)));
  return { missing, reason: missing.length ? `pilot data missing (${missing.join(', ')} in ${plan.def.dataDir}): run npm run bake -- pilot --stage sources` : '' };
}

const inProcess = new Map();

/**
 * `produce(dir)` runs once per key and name, across every test file of a run and across runs: the result (JSON) is
 * saved beside whatever files `produce` wrote into `dir`. Returns `{ ...result, dir }`.
 */
export function memo(name, extra, produce) {
  const key = bakeKey();
  const id = `${key}/${name}/${extra}`;
  if (!inProcess.has(id)) inProcess.set(id, once(key, name, extra, produce));
  return inProcess.get(id);
}

async function once(key, name, extra, produce) {
  const base = path.join(CACHE, key);
  const slot = `${name}${extra ? `-${sha(extra).slice(0, 10)}` : ''}`;
  const dir = path.join(base, slot);
  const doneFile = path.join(dir, 'done.json');
  const lock = `${dir}.lock`;
  for (;;) {
    try {
      return { ...JSON.parse(fs.readFileSync(doneFile, 'utf8')), dir };
    } catch {
      // not built yet
    }
    fs.mkdirSync(base, { recursive: true });
    try {
      fs.mkdirSync(lock);
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let age = 0;
      try {
        age = Date.now() - fs.statSync(lock).mtimeMs;
      } catch {
        continue;
      }
      if (age > STALE_LOCK_MS) fs.rmSync(lock, { recursive: true, force: true });
      else await sleep(1000);
      continue;
    }
    const beat = setInterval(() => {
      try {
        fs.utimesSync(lock, new Date(), new Date());
      } catch {
        // the lock is gone: the run ends soon
      }
    }, 30000);
    try {
      // a new key: the folders of older keys go
      for (const old of fs.readdirSync(CACHE)) if (old !== key) fs.rmSync(path.join(CACHE, old), { recursive: true, force: true });
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const load0 = os.loadavg()[0];
      const t0 = Date.now();
      const value = await produce(dir);
      const measured = { wallMs: Date.now() - t0, loadStart: Math.round(load0 * 10) / 10, loadEnd: Math.round(os.loadavg()[0] * 10) / 10, cpus: os.cpus().length };
      fs.writeFileSync(`${doneFile}.tmp`, JSON.stringify({ ...value, measured }));
      fs.renameSync(`${doneFile}.tmp`, doneFile);
    } finally {
      clearInterval(beat);
      fs.rmSync(lock, { recursive: true, force: true });
    }
  }
}

/** Was the machine busy while this slot was built? Then wall clock limits only warn (a build is 2 to 3 times slower under load). */
export function busy(measured) {
  return Math.max(measured.loadStart, measured.loadEnd) > measured.cpus / 2;
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/**
 * The whole pilot bake (all nine steps, default overrides, tiles into the cache): { report, health, timing, lines,
 * dir, benchDir, tiles, file(rel), measured }. `file(rel)` is the cache copy of a stage file the bake wrote into
 * data/pilot_centre/ (a path as health.json names it, or a bare name): the tests read these, never the folder the
 * bake wrote, which another bake may be writing at this moment.
 */
export async function sharedBake() {
  const r = await memo('full', '', async (dir) => {
    const plan = pilotPlan();
    const healthFile = path.join(dir, 'health.json');
    const benchDir = path.join(dir, 'gen');
    const tiles = path.join(dir, 'tiles');
    const lines = [];
    await bake(parseArgs(['pilot', '--offline', '--out', tiles]), { root: ROOT, net: offlineNet, today: TODAY, log: (l) => lines.push(l), healthFile, benchDir });
    const health = readJson(healthFile);
    // the stage files the tests read, copied before another bake can write them again
    fs.mkdirSync(path.join(dir, 'stage'), { recursive: true });
    const names = new Set(['graph.json', 'graph_repaired.json', path.basename(health.lanes.files.model), path.basename(health.lanes.files.laneGraph), path.basename(health.elevation.files.heights)]);
    for (const n of names) fs.copyFileSync(path.join(ROOT, plan.def.dataDir, n), path.join(dir, 'stage', n));
    return { lines };
  });
  const health = readJson(path.join(r.dir, 'health.json'));
  return { ...r, report: health, health, benchDir: path.join(r.dir, 'gen'), tiles: path.join(r.dir, 'tiles'), timing: readJson(path.join(r.dir, 'timing.json')), file: (rel) => path.join(r.dir, 'stage', path.basename(rel)) };
}

const printed = new Set();
/** Print the bake's log lines that start with `prefix`, once per test file (every test asks for the bake again). */
export function logLines(lines, prefix) {
  if (printed.has(prefix)) return;
  printed.add(prefix);
  for (const l of lines.filter((x) => x.startsWith(prefix))) console.log(l);
}

/**
 * The bake through the repair step with no overrides (what the repair tests count and the inspector pick test starts
 * from), kept in the cache like the whole bake: { report, health, lines, dir, issues, repairs }.
 */
export async function repairBaseline() {
  const m = await memo('repair_none', '', async (dir) => {
    const lines = [];
    await bake(parseArgs(['pilot', '--stage', 'repair', '--offline']), { root: ROOT, net: offlineNet, today: '2026-11-11', log: (l) => lines.push(l), healthFile: path.join(dir, 'health.json'), overridesDir: path.join(dir, 'no_overrides') });
    return { lines };
  });
  const health = readJson(path.join(m.dir, 'health.json'));
  return {
    report: health, lines: m.lines, dir: m.dir, health,
    issues: readJson(path.join(m.dir, 'issues.json')),
    repairs: fs.readFileSync(path.join(m.dir, 'repairs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)),
  };
}
