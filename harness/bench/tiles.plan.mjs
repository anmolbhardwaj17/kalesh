// Plan of the tile format bench (P0-018; harness/design/ARCH_OPTIONS.md rows T, TL, ST). Run by
// node harness/bench/arch.mjs tiles, which harness/bench/pilot_data/tiles.mjs starts after it has baked the tiles
// (game/bench/tiles/gen/, with a manifest.json that names the files of each case). The scene is game/bench/tiles/
// (--arch=tiles:<setup>). Every setup is a CPU bench (gpu: false) on Jolt: first the memory of several copies kept
// loaded in the fresh process, then the timed loads (load off the main thread, attach on it, frames while attaching).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runTest } from './physics.plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const GEN = path.join(ROOT, 'game', 'bench', 'tiles', 'gen');
const manifestFile = path.join(GEN, 'manifest.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { cases: {} };
const res = (file) => `res://bench/tiles/gen/${file}`;
const files = (id, ext) => (manifest.cases[id]?.files?.[ext] || []).map(res);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r = (v, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

const base = { gpu: false, driver: 'metal', paths: [], project: { physics: { '3d/physics_engine': 'Jolt Physics' } }, shot: 'overview' };
const setups = [
  { ...base, id: 't1_dense', option: 'T1', group: 'format', tokens: 't1+dense', format: 't1', tile: 'dense250', ext: 'ktl', note: 'our binary tile, read by GDScript on a WorkerThreadPool thread; the dense 250 m tile' },
  { ...base, id: 't2_dense', option: 'T2', group: 'format', tokens: 't2+dense', format: 't2', tile: 'dense250', ext: 'res', note: 'a Godot .res (PackedScene) from the headless pack step, ResourceLoader threaded load, instantiated on a worker thread' },
  { ...base, id: 't3_dense', option: 'T3', group: 'format', tokens: 't3+dense', format: 't3', tile: 'dense250', ext: 'glb', note: 'a .glb loaded with GLTFDocument on a worker thread, col_* meshes turned into trimesh shapes there' },
  { ...base, id: 't1_open', option: 'T1', group: 'format', tokens: 't1+open', format: 't1', tile: 'open250', ext: 'ktl', note: 'the open 250 m tile' },
  { ...base, id: 't2_open', option: 'T2', group: 'format', tokens: 't2+open', format: 't2', tile: 'open250', ext: 'res', note: 'the open 250 m tile' },
  { ...base, id: 't3_open', option: 'T3', group: 'format', tokens: 't3+open', format: 't3', tile: 'open250', ext: 'glb', note: 'the open 250 m tile' },
  { ...base, id: 't1_500', option: 'ST2', group: 'size', tokens: 't1+500', format: 't1', tile: 'dense500', ext: 'ktl', copies: 4, note: 'one 500 m T1 tile around the dense tile (64 collider chunks)' },
  { ...base, id: 't1_250x4', option: 'ST1', group: 'size', tokens: 't1+250x4', format: 't1', tile: 'dense250x4', ext: 'ktl', copies: 4, note: 'the same 500 m square as four 250 m T1 tiles, loaded one after another' },
  { ...base, id: 't1_dense_placements', option: 'T1 (AG1)', group: 'placements', must: false, tokens: 't1+placements', format: 't1', tile: 'dense250p', ext: 'ktl', note: 'the dense tile with facade module placements (one per 3 m of wall per floor) as a MultiMesh buffer' },
];

function rssMB(pid) {
  const out = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).stdout;
  const kb = Number(String(out || '').trim());
  return Number.isFinite(kb) && kb > 0 ? kb / 1024 : null;
}

const extra = {};
for (const s of setups) {
  extra[s.id] = async (ctx, game, row) => {
    const list = files(s.tile, s.ext);
    if (!list.length) throw new Error(`no baked files for ${s.tile}.${s.ext}: run node harness/bench/pilot_data/tiles.mjs (it bakes, then starts this bench)`);
    const copies = s.copies || 8;
    await sleep(600);
    const before = rssMB(game.proc.pid);
    const mem = await runTest(game, 'memory', { format: s.format, files: list, copies });
    if (mem.error) throw new Error(mem.error);
    await sleep(600);
    const after = rssMB(game.proc.pid);
    await runTest(game, 'free');
    const res = await runTest(game, 'load', { format: s.format, files: list, loads: s.loads || 20 });
    if (res.error) throw new Error(res.error);
    const engineErrors = game.log.filter((l) => /^(ERROR|SCRIPT ERROR|USER ERROR)/.test(l)).length;
    row.test = 'load';
    row.case = s.tile;
    row.results = {
      ...res,
      memory: { ...mem, processMBPerCopy: r((after - before) / copies, 2), note: 'processMBPerCopy is the growth of the game process (resident memory from ps) per copy kept loaded; staticMB and bufferMB are the engine\'s own counters (script and node memory, vertex and index buffers)' },
      offMainThread: { engineErrorLines: engineErrors, safe: engineErrors === 0 },
    };
    const p = res.perTile;
    row.line = `${s.format} ${s.tile}: thread ${p.threadMs.p50} ms, ready after ${p.requestToReadyMs.p50} ms, attach ${p.attachTotalMs.p50} ms (mesh step ${p.attachMeshStepMs.p50}, chunk p95 ${p.attachChunkStepMs.p95}), worst frame ${res.frames.whileAttaching.max} ms (idle ${res.frames.idle.p50}), ${row.results.memory.processMBPerCopy} MB`;
  };
}

export default {
  name: 'tiles',
  scene: 'game/bench/tiles/',
  defaults: { resolution: '1280x720', windowMs: 1000, warmMs: 500 },
  howMeasured: 'One game run per setup on Jolt Physics, Metal, CPU times only. Memory first: 8 copies of the tile (4 for the 500 m cases) are loaded and kept, and the growth of the process (ps) and of the engine counters is divided by the copies. Then 20 timed loads after one warm-up load: the load runs off the main thread (threadMs is the work on worker threads, requestToReadyMs the wall time until the nodes exist), the main thread attaches the meshes in one step and then one collider chunk per frame (attach step times are around the add_child calls), and frame times are recorded while loading and while attaching against idle frames. Read a worst frame against the idle frame of the same run (frames.idle): when the display caps the window at 120 fps an idle frame is 8.3 ms, when it does not it is under 1 ms. Files are in the OS file cache after the first load.',
  setups,
  extra,
  notMeasured: [
    { id: 'cold_disk', option: 'T1, T2, T3', reason: 'loads are measured with the files in the OS file cache; a cold read from disk was not measured (no way to drop the cache without sudo)', estimate: 'adds the read of the file: under 5 ms for these sizes on an SSD' },
    { id: 'tl3_loader_thread', option: 'TL3', reason: 'not a bench item (ARCH_OPTIONS.md lists no bench for it)', estimate: 'no gain over the thread pool' },
  ],
};
