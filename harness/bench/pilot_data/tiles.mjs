#!/usr/bin/env node
// Tile format bench driver (P0-018, ARCH_OPTIONS.md rows T, TL, ST). Bakes stand-in tiles from the real pilot data
// with the typed bake code (tools/bake/tile/standin.ts, codec.ts, glb.ts), packs the T2 resources with a headless Godot step, runs the Godot
// bench (node harness/bench/arch.mjs tiles, scene game/bench/tiles/) and writes harness/reports/arch/tile_format.json.
//
//   node harness/bench/pilot_data/tiles.mjs            bake, pack, run the Godot bench, write the report
//   node harness/bench/pilot_data/tiles.mjs --no-run   bake and pack only, then write the report from the last Godot run
//   node harness/bench/pilot_data/tiles.mjs --only t1_dense,t2_dense   passes --only to the Godot bench
//
// Tiles: one dense 250 m tile (the Chandni Chowk tile with the most buildings) and one open 250 m tile (the India
// Gate tile with the fewest buildings that still has roads); the 500 m tile around the dense one and its four 250 m
// tiles for the tile size comparison. Geometry is a stand-in from real data: a ground grid with real heights, one
// ribbon per road segment, one extruded prism per Overture footprint, 16 collider chunks per 250 m tile.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildTile, tileOf, tileStats } from '../../../tools/bake/tile/standin.ts';
import { decodeT1, encodeT1 } from '../../../tools/bake/tile/codec.ts';
import { encodeGlb } from '../../../tools/bake/tile/glb.ts';
import { fitGround } from '../../../tools/bake/ground.ts';
import { resolveGodot } from '../../bin/godot.mjs';
import { REPORTS, ROOT, pilotAreas, readJson, rel, round, unionBox, writeJson } from './lib.mjs';
import { loadArea, loadHeights, overtureFootprints, sampler } from './load.mjs';

const args = process.argv.slice(2);
const noRun = args.includes('--no-run');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const GEN = path.join(ROOT, 'game', 'bench', 'tiles', 'gen');
fs.mkdirSync(GEN, { recursive: true });
fs.writeFileSync(path.join(GEN, '.gdignore'), '');

const areas = pilotAreas();
const heights = await loadHeights(unionBox(areas));
function prepare(id) {
  const ctx = loadArea(areas.find((a) => a.id === id));
  ctx.buildings = overtureFootprints(ctx) || ctx.map.buildings;
  ctx.buildingsFrom = ctx.buildings === ctx.map.buildings ? 'OSM footprints (Overture was not downloaded)' : 'Overture footprints (BS1)';
  // ground: GEDTM30 smoothed over 60 m (the reading of terrain_sources.json), plain 215 m when no height file is there
  if (heights.gedtm) {
    const g = heights.gedtm;
    const samples = [];
    for (let j = 0; j < g.height; j++) {
      for (let i = 0; i < g.width; i++) {
        const p = ctx.proj.toWorld(g.north + (j + 0.5) * g.dLat, g.west + (i + 0.5) * g.dLon);
        if (p.x < ctx.box.minX - 300 || p.x > ctx.box.maxX + 300 || p.z < ctx.box.minZ - 300 || p.z > ctx.box.maxZ + 300) continue;
        if (Number.isFinite(g.data[j * g.width + i])) samples.push({ x: p.x, z: p.z, h: g.data[j * g.width + i] });
      }
    }
    const fit = fitGround(samples, { sigma: 60, dropAbove: Infinity, passes: 1 });
    const plain = sampler(g, ctx.proj);
    ctx.ground = (x, z) => fit.at(x, z) ?? plain(x, z) ?? 215;
    ctx.groundFrom = 'GEDTM30 smoothed over 60 m';
  } else {
    ctx.ground = () => 215;
    ctx.groundFrom = 'flat (no height file)';
  }
  return ctx;
}
const dense = prepare('chandni_chowk');
const open = prepare('india_gate');

/** Buildings and road metres per 250 m tile that lies fully inside the download box. */
function tileCounts(ctx, size = 250) {
  const cells = new Map();
  const get = (t) => {
    const key = `${t.tx},${t.tz}`;
    if (!cells.has(key)) cells.set(key, { ...t, buildings: 0, roadM: 0 });
    return cells.get(key);
  };
  for (const b of ctx.buildings) get(tileOf(b.centre.x, b.centre.z, size)).buildings++;
  for (const r of ctx.map.roads) {
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const a = r.pts[i];
      const b = r.pts[i + 1];
      get(tileOf((a.x + b.x) / 2, (a.z + b.z) / 2, size)).roadM += Math.hypot(b.x - a.x, b.z - a.z);
    }
  }
  return [...cells.values()].filter((c) => c.tx * size >= ctx.box.minX && (c.tx + 1) * size <= ctx.box.maxX && c.tz * size >= ctx.box.minZ && (c.tz + 1) * size <= ctx.box.maxZ);
}
const denseTile = tileCounts(dense).sort((a, b) => b.buildings - a.buildings)[0];
const openTile = tileCounts(open).filter((c) => c.roadM >= 300).sort((a, b) => a.buildings - b.buildings || b.roadM - a.roadM)[0];
const big = { tx: Math.floor(denseTile.tx / 2), tz: Math.floor(denseTile.tz / 2) };

const median = (v) => v.slice().sort((a, b) => a - b)[Math.floor(v.length / 2)];
function timed(fn, runs = 5) {
  const ms = [];
  let out;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    out = fn();
    ms.push(performance.now() - t0);
  }
  return { out, ms: round(median(ms), 2) };
}

const cases = {};
function bake(id, ctx, specs, formats, note) {
  const c = { note, district: ctx.area.id, tiles: [], files: {}, bytes: {}, bakeMs: { content: 0, t1: 0, glb: 0 }, stats: { vertices: 0, triangles: 0, colliderTriangles: 0, colliderChunks: 0, placements: 0 } };
  for (const [n, spec] of specs.entries()) {
    const input = { district: ctx.area.id, tx: spec.tx, tz: spec.tz, size: spec.size, roads: ctx.map.roads, buildings: ctx.buildings, ground: ctx.ground, chunks: spec.size / 62.5, placements: !!spec.placements };
    const content = timed(() => buildTile(input));
    c.bakeMs.content = round(c.bakeMs.content + content.ms, 2);
    const st = tileStats(content.out);
    for (const k of Object.keys(c.stats)) c.stats[k] += st[k];
    c.tiles.push({ tx: spec.tx, tz: spec.tz, size: spec.size, origin: content.out.origin, ...st });
    const name = specs.length > 1 ? `${id}_${n}` : id;
    const put = (ext, bytes) => {
      fs.writeFileSync(path.join(GEN, `${name}.${ext}`), bytes);
      (c.files[ext] ??= []).push(`${name}.${ext}`);
      c.bytes[ext] = (c.bytes[ext] || 0) + bytes.length;
    };
    if (formats.includes('ktl')) {
      const t1 = timed(() => encodeT1(content.out));
      c.bakeMs.t1 = round(c.bakeMs.t1 + t1.ms, 2);
      put('ktl', t1.out);
      // the bake's own check: the file reads back
      const back = decodeT1(t1.out);
      if (back.header.meshes.reduce((s, m) => s + m.indices / 3, 0) !== st.triangles) throw new Error(`${name}.ktl does not read back`);
    }
    if (formats.includes('glb')) {
      const glb = timed(() => encodeGlb(content.out));
      c.bakeMs.glb = round(c.bakeMs.glb + glb.ms, 2);
      put('glb', glb.out);
    }
  }
  cases[id] = c;
  return c;
}
bake('dense250', dense, [{ ...denseTile, size: 250 }], ['ktl', 'glb'], `the 250 m tile of Chandni Chowk with the most buildings (${denseTile.buildings})`);
bake('open250', open, [{ ...openTile, size: 250 }], ['ktl', 'glb'], `the India Gate 250 m tile with the fewest buildings that has roads (${openTile.buildings} buildings, ${Math.round(openTile.roadM)} m of road)`);
bake('dense500', dense, [{ ...big, size: 500 }], ['ktl'], 'the 500 m tile around the dense tile');
bake('dense250x4', dense, [0, 1, 2, 3].map((k) => ({ tx: big.tx * 2 + (k % 2), tz: big.tz * 2 + Math.floor(k / 2), size: 250 })), ['ktl'], 'the same 500 m square as four 250 m tiles');
bake('dense250p', dense, [{ ...denseTile, size: 250, placements: true }], ['ktl'], 'the dense tile with facade module placements');

// T2: the headless Godot pack step (one process for both tiles)
const godot = await resolveGodot({ allowDownload: true });
const pack = { process: null, tiles: {} };
{
  const pairs = [];
  for (const id of ['dense250', 'open250']) pairs.push(`res://bench/tiles/gen/${id}.ktl`, `res://bench/tiles/gen/${id}.res`);
  const t0 = Date.now();
  const run = spawnSync(godot.path, ['--headless', '--path', path.join(ROOT, 'game'), '-s', 'res://bench/tiles/pack_t2.gd', '--quit-after', '600', '--', ...pairs], { encoding: 'utf8', timeout: 180000 });
  pack.process = { wallMs: Date.now() - t0, exit: run.status };
  const outText = `${run.stdout || ''}\n${run.stderr || ''}`.replace(/\x1b\[[0-9;]*m/g, '');
  for (const m of outText.matchAll(/pack: res:\/\/bench\/tiles\/gen\/(\w+)\.res ([\d.]+) ms (\d+) bytes/g)) pack.tiles[m[1]] = { ms: Number(m[2]), bytes: Number(m[3]) };
  for (const id of ['dense250', 'open250']) {
    if (!pack.tiles[id]) {
      console.log(`T2 pack of ${id} FAILED:\n${outText.split('\n').filter((l) => /pack:|ERROR/.test(l)).slice(0, 8).join('\n')}`);
      continue;
    }
    cases[id].files.res = [`${id}.res`];
    cases[id].bytes.res = pack.tiles[id].bytes;
    cases[id].bakeMs.res = pack.tiles[id].ms;
  }
  console.log(`packed T2: ${Object.entries(pack.tiles).map(([k, v]) => `${k} ${v.ms} ms ${v.bytes} bytes`).join(', ')} (process ${pack.process.wallMs} ms)`);
}
writeJson(path.join(GEN, 'manifest.json'), { at: new Date().toISOString(), cases });
for (const [id, c] of Object.entries(cases)) console.log(`${id}: ${c.stats.triangles} triangles, ${c.stats.colliderChunks} chunks, ${c.stats.placements} placements, ${Object.entries(c.bytes).map(([k, v]) => `${k} ${v}`).join(', ')}, bake ${JSON.stringify(c.bakeMs)}`);

if (!noRun) {
  const run = spawnSync('node', [path.join(ROOT, 'harness', 'bench', 'arch.mjs'), 'tiles', ...(only ? ['--only', only] : [])], { stdio: 'inherit', timeout: 1500000 });
  if (run.status !== 0) console.log(`the Godot bench ended with exit code ${run.status}`);
}

// ------------------------------------------------------------------ the report

const godotReport = readJson(path.join(REPORTS, 'tiles.json'));
const rowOf = (id) => {
  const s = godotReport?.setups?.[id];
  if (!s || s.failed || !s.results) return s?.failed ? { failed: s.failed } : null;
  const res = s.results;
  const c = cases[s.case];
  const ext = { t1: 'ktl', t2: 'res', t3: 'glb' }[res.format];
  return {
    option: s.option, case: s.case, format: res.format, tiles: res.perSet.tiles, fileBytes: c.bytes[ext], fileMB: round(c.bytes[ext] / 2 ** 20, 3),
    bakeMs: ext === 'ktl' ? round(c.bakeMs.content + c.bakeMs.t1, 2) : ext === 'glb' ? round(c.bakeMs.content + c.bakeMs.glb, 2) : round(c.bakeMs.content + c.bakeMs.t1 + c.bakeMs.res, 2),
    bakeParts: ext === 'ktl' ? { contentMs: c.bakeMs.content, encodeMs: c.bakeMs.t1 } : ext === 'glb' ? { contentMs: c.bakeMs.content, encodeMs: c.bakeMs.glb } : { contentMs: c.bakeMs.content, encodeT1Ms: c.bakeMs.t1, godotPackMs: c.bakeMs.res, note: 'the pack reads the T1 tile in a headless Godot process, which also takes about a second to start (pack.process.wallMs)' },
    loadOffMainThreadMs: res.perSet.threadMs, requestToReadyMs: res.perTile.requestToReadyMs, instantiateMs: res.perTile.instantiateMs || null,
    attachMs: res.perSet.attachMs, attachMeshStepMs: res.perTile.attachMeshStepMs, attachChunkStepMs: res.perTile.attachChunkStepMs,
    worstFrameWhileAttachingMs: res.frames.whileAttaching.max, frameP95WhileAttachingMs: res.frames.whileAttaching.p95, frameP50WhileAttachingMs: res.frames.whileAttaching.p50, worstFrameWhileLoadingMs: res.frames.whileLoading.max, frameP95WhileLoadingMs: res.frames.whileLoading.p95,
    idleFrameMs: { p50: res.frames.idle.p50, p95: res.frames.idle.p95, max: res.frames.idle.max }, worstMainThreadStepMs: round(Math.max(res.perTile.attachMeshStepMs.max, res.perTile.attachChunkStepMs.max), 3),
    worstFrameReading: res.frames.whileAttaching.max <= Math.max(res.frames.idle.max, 8.4) * 1.25 ? 'no hitch: the worst frame while attaching is no longer than the worst idle frame of the same run' : `the worst frame while attaching (${res.frames.whileAttaching.max} ms) is longer than the worst idle frame (${res.frames.idle.max} ms), while the longest attach step on the main thread is ${round(Math.max(res.perTile.attachMeshStepMs.max, res.perTile.attachChunkStepMs.max), 2)} ms: the rest is frame jitter of the window, not attach work`,
    memoryMBPerTileSet: { process: res.memory.processMBPerCopy, engineStatic: res.memory.staticMBPerCopy, renderBuffers: res.memory.bufferMBPerCopy, copies: res.memory.copies },
    counts: res.counts, engineErrorLines: res.offMainThread.engineErrorLines, shot: s.shot, hostLoad: s.hostLoad,
  };
};
const ids = ['t1_dense', 't2_dense', 't3_dense', 't1_open', 't2_open', 't3_open', 't1_500', 't1_250x4', 't1_dense_placements'];
const rows = Object.fromEntries(ids.map((id) => [id, rowOf(id)]));
const cpus = os.cpus();
const report = {
  bench: 'tile_format', writtenBy: 'node harness/bench/pilot_data/tiles.mjs (bake and pack), which runs node harness/bench/arch.mjs tiles (scene game/bench/tiles/, --arch=tiles)',
  at: new Date().toISOString(), machine: godotReport?.machine || `${os.hostname().replace(/\.local$/, '')}, ${os.platform()} ${os.arch()}, ${cpus[0]?.model}, ${cpus.length} cores, ${Math.round(os.totalmem() / 2 ** 30)} GB`,
  godotVersion: godotReport?.godotVersion || null, renderer: godotReport?.renderer || null, gpuAdapter: godotReport?.gpuAdapter || null, hostLoad: godotReport?.hostLoad || null, node: process.version,
  how: {
    content: `Stand-in geometry from the real pilot data in the district frame: a 12.5 m ground grid with heights from ${dense.groundFrom}, one ribbon per road segment at its class or tagged width, one extruded prism per building (${dense.buildingsFrom}; height from the tag, else levels times 3.2 m, else 9 m), and 16 collider chunks per 250 m tile (62.5 m cells) holding every surface and shell triangle. Vertices are relative to the tile origin. The final tiles (lane model, area generator, modules) will be heavier; the format comparison holds because every format carries the same arrays.`,
    formats: 'T1: our binary tile (a JSON header plus float32 and uint32 arrays), read by GDScript on a WorkerThreadPool thread with one packed-array call per array. T2: the same nodes saved as a Godot .res (a PackedScene) by a headless Godot pack script, loaded with ResourceLoader.load_threaded_request and instantiated on a worker thread. T3: a .glb (one mesh node per material, collider chunks as col_* mesh nodes) loaded with GLTFDocument on a worker thread, the col_* meshes turned into trimesh shapes there.',
    godot: godotReport?.howMeasured || null,
    worstFrame: 'The window was not capped by the display in these runs: an idle frame is 0.5 to 1.7 ms at the median, and single idle frames reach 4 to 22 ms with nothing loading (idleFrameMs.max). So a worst frame is read against the idle frames of the same run, and the firm number for hitches is worstMainThreadStepMs: the longest single attach step on the main thread.',
    bake: 'bakeMs is the median of 5 runs in Node 22 on this machine: the shared content build plus the encode of that format (for T2 plus the Godot pack of the tile).',
  },
  tiles: {
    dense: { district: 'chandni_chowk', ...denseTile, roadM: Math.round(denseTile.roadM), ...cases.dense250.stats, origin: cases.dense250.tiles[0].origin },
    open: { district: 'india_gate', ...openTile, roadM: Math.round(openTile.roadM), ...cases.open250.stats, origin: cases.open250.tiles[0].origin },
    square500: { district: 'chandni_chowk', ...big, size: 500, ...cases.dense500.stats, the250mTiles: cases.dense250x4.tiles.map((t) => ({ tx: t.tx, tz: t.tz, triangles: t.triangles, colliderChunks: t.colliderChunks })) },
  },
  formats: { dense: { T1: rows.t1_dense, T2: rows.t2_dense, T3: rows.t3_dense }, open: { T1: rows.t1_open, T2: rows.t2_open, T3: rows.t3_open } },
  tileSize: { how: 'The same 500 m square of Chandni Chowk as one 500 m T1 tile (ST2) and as four 250 m T1 tiles loaded one after another (ST1). Numbers are per set: the whole square.', t1_500: rows.t1_500, t1_250x4: rows.t1_250x4 },
  placements: { how: 'The dense tile again with facade module placements written into the tile (AG1): one transform per 3 m of wall per floor, read straight into a MultiMesh buffer.', t1_dense_placements: rows.t1_dense_placements, bytesPerPlacement: 48 },
  t2Pack: pack,
  bakeFiles: Object.fromEntries(Object.entries(cases).map(([id, c]) => [id, { note: c.note, bytes: c.bytes, bakeMs: c.bakeMs, stats: c.stats }])),
  notMeasured: [...(godotReport?.notMeasured || []), ...ids.filter((id) => !rows[id]).map((id) => ({ id, reason: 'no result from the Godot bench for this setup' })), ...ids.filter((id) => rows[id]?.failed).map((id) => ({ id, reason: `the run failed: ${rows[id].failed}` }))],
};
writeJson(path.join(REPORTS, 'tile_format.json'), report);
console.log(`wrote ${rel(path.join(REPORTS, 'tile_format.json'))}`);
for (const id of ids) {
  const x = rows[id];
  if (x && !x.failed) console.log(`${id.padEnd(20)} ${String(x.fileBytes).padStart(9)} B  bake ${String(x.bakeMs).padStart(7)} ms  thread ${String(x.loadOffMainThreadMs.p50).padStart(7)} ms  attach ${String(x.attachMs.p50).padStart(6)} ms (chunk p95 ${x.attachChunkStepMs.p95})  worst frame ${x.worstFrameWhileAttachingMs} ms  ${x.memoryMBPerTileSet.process} MB`);
  else console.log(`${id.padEnd(20)} ${x?.failed ? `FAILED ${x.failed}` : 'no result'}`);
}
