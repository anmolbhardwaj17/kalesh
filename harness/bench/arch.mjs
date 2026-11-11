#!/usr/bin/env node
// Architecture bench runner (harness/design/ARCH_OPTIONS.md "Bench tasks"). One runner for every Godot bench:
//
//   node harness/bench/arch.mjs <name>                 run every setup of harness/bench/<name>.plan.mjs
//   node harness/bench/arch.mjs <name> --only a,b      run only these setups (the others keep their rows in the report)
//   node harness/bench/arch.mjs <name> --group g1,g2   run only the setups of these groups
//   node harness/bench/arch.mjs <name> --list          print the setups and stop
//   options: --window <ms> (perf window per camera path, default from the plan), --keep (keep generated files)
//
// For each setup it starts one pinned Godot run (harness/bin/godotclient.mjs) with --debug and the game arg
// --arch=<name>:<setup tokens>, waits until the bench scene answers bench('info') with ready, then for each camera
// path of the setup: starts the path, warms up (shader pipelines compile on the first view), starts it again and
// reads debug.perf over the window, twice: once plain (frame times as a player sees them, CPU, draw calls, memory)
// and once with a GPU ballast (bench('ballast')) for the GPU time. The ballast matters: a window on this Mac is capped
// at 120 fps even with vsync off, and under the cap the GPU clocks down, so every light scene reads about 6.5 ms of
// GPU time. With the GPU kept busy gpuP95 is the scene's cost at full clock, and frameCostP50 (a ballast frame minus
// the ballast alone) is the same cost from frame times, which also works on Metal (no GPU timer there).
// It takes one shot per setup and writes harness/reports/arch/<name>.json with the machine, the Godot version, the
// renderer, the GPU adapter and the host load. Setups run one after another.
// GPU times need the Vulkan driver on macOS (the Metal driver reports none), so a setup's driver is "vulkan" unless
// the plan says "metal"; every run has vsync off. Before each run the host load per core must be under 1 (it waits
// up to a minute); a run that ended on a loaded machine is repeated once.
//
// A plan module (harness/bench/<name>.plan.mjs) default-exports:
//   { name, scene, defaults: { resolution, windowMs, warmMs }, setups: [ { id, option, group, tokens, paths, primary,
//     shot, driver, resolution, engine, note, must, gpu, project } ], notMeasured: [ { id, option, reason, estimate } ],
//     before(ctx), extra: { <setup id>: async (ctx, game, row) => {} }, after(ctx, report) }
// A setup with gpu: false is a CPU bench (physics, scripting): no camera paths, no perf windows and no ballast; its
// numbers come from the plan's extra(ctx, game, row), which talks to the bench scene (bench('run'), bench('poll')).
// A setup with project: { section: { key: value } } starts the game with those project settings: the runner writes
// game/override.cfg just before the launch and removes it as soon as the game answers (settings are read at start).
// That is how one bench runs on Jolt and on Godot Physics (physics/3d/physics_engine has no command line switch).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchGame } from '../bin/godotclient.mjs';
import { resolveGodot } from '../bin/godot.mjs';
import { calibrateBallast as calibrate, measureBlank } from '../bin/ballast.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RENDER_METHODS = { forward_plus: 'Forward+', mobile: 'Mobile', gl_compatibility: 'Compatibility' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

export function hostLoad() {
  const cores = os.cpus().length;
  const avg1 = os.loadavg()[0];
  return { avg1: round(avg1), cores, perCore: round(avg1 / Math.max(1, cores)) };
}

/** Parses the runner's own args: the bench name, then flags with or without a value. */
export function parseArgs(argv) {
  const out = { name: null, only: null, group: null, list: false, keep: false, windowMs: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') out.list = true;
    else if (a === '--keep') out.keep = true;
    else if (a === '--only') out.only = String(argv[++i] || '').split(',').filter(Boolean);
    else if (a === '--group') out.group = String(argv[++i] || '').split(',').filter(Boolean);
    else if (a === '--window') out.windowMs = Number(argv[++i]);
    else if (!a.startsWith('--') && !out.name) out.name = a;
  }
  return out;
}

/** The engine args of a setup: the rendering driver (GPU times need Vulkan on macOS), vsync off, plan extras. */
export function engineArgs(setup) {
  const driver = setup.driver || 'vulkan';
  return ['--rendering-driver', driver, '--disable-vsync', ...(setup.engine || [])];
}

/** The numbers of one perf window, in the shape every bench report uses. */
export function perfRow(p) {
  return {
    frameP50: round(p.frameMs?.p50), frameP95: round(p.frameMs?.p95 ?? p.p95FrameMs), frameMax: round(p.frameMs?.max),
    cpuP95: round(p.cpuMs?.p95), gpuP95: p.gpuMs ? round(p.gpuMs.p95) : null, gpuP50: p.gpuMs ? round(p.gpuMs.p50) : null,
    fps: round(p.avgFps, 1), drawCalls: p.drawCalls ?? null, primitives: p.triangles ?? null,
    drawCallsAvg: round(p.drawCallsAvg, 0), primitivesAvg: round(p.trianglesAvg, 0),
    videoMB: round(p.gpuMB, 1), textureMB: round(p.textureMB, 1), bufferMB: round(p.bufferMB, 1), frames: p.frames,
  };
}

/** The text of an override.cfg for { section: { key: value } }. */
export function overrideText(project) {
  const lines = ['; written by harness/bench/arch.mjs for one bench run, removed when the game has started'];
  for (const [section, keys] of Object.entries(project)) {
    lines.push('', `[${section}]`, '');
    for (const [k, v] of Object.entries(keys)) lines.push(`${k}=${JSON.stringify(v)}`);
  }
  return lines.join('\n') + '\n';
}

const OVERRIDE_FILE = path.join(ROOT, 'game', 'override.cfg');
const OVERRIDE_MARK = '; written by harness/bench/arch.mjs';

function writeOverride(project) {
  if (fs.existsSync(OVERRIDE_FILE) && !fs.readFileSync(OVERRIDE_FILE, 'utf8').startsWith(OVERRIDE_MARK)) {
    throw new Error('game/override.cfg exists and was not written by this runner: remove it first');
  }
  fs.writeFileSync(OVERRIDE_FILE, overrideText(project));
}

function removeOverride() {
  try {
    if (fs.existsSync(OVERRIDE_FILE) && fs.readFileSync(OVERRIDE_FILE, 'utf8').startsWith(OVERRIDE_MARK)) fs.unlinkSync(OVERRIDE_FILE);
  } catch { /* nothing to remove */ }
}

async function waitCalm(log) {
  let l = hostLoad();
  for (let i = 0; i < 6 && l.perCore >= 1; i++) {
    log(`  host load per core ${l.perCore}, waiting 10 s`);
    await sleep(10000);
    l = hostLoad();
  }
  return l;
}

async function waitReady(game, timeoutMs = 240000) {
  const until = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < until) {
    try {
      const info = await game.client.call('bench', 'info');
      if (info && info.ready) return info;
    } catch (e) {
      last = e;
      if (game.client.closed) break;
    }
    await sleep(100);
  }
  throw new Error(`the bench scene was not ready in ${timeoutMs} ms (${last?.message || 'no answer'})`);
}

/** The ballast size for this driver (harness/bin/ballast.mjs), calibrated once per run. */
async function calibrateBallast(ctx, game, driver) {
  ctx.ballast = ctx.ballast || {};
  return calibrate(game.client, ctx.ballast, driver);
}

async function runSetup(ctx, setup) {
  const { plan, binary, log } = ctx;
  const resolution = setup.resolution || plan.defaults.resolution;
  const windowMs = ctx.windowMs || setup.windowMs || plan.defaults.windowMs;
  const warmMs = plan.defaults.warmMs;
  const before = await waitCalm(log);
  const t0 = Date.now();
  if (setup.project) writeOverride(setup.project);
  let game;
  try {
    game = await launchGame({
      binary, resolution, quitAfter: setup.quitAfter || 400000, connectTimeoutMs: 120000,
      extra: [`--arch=${plan.name}:${setup.tokens}`, '--mute'], engineExtra: engineArgs(setup),
    });
  } finally {
    if (setup.project) removeOverride();
  }
  const row = {
    id: setup.id, option: setup.option, group: setup.group, tokens: setup.tokens, must: setup.must !== false,
    driver: setup.driver || 'vulkan', resolution, windowMs, note: setup.note || null, at: new Date().toISOString(),
  };
  if (setup.project) row.project = setup.project;
  try {
    const info = await waitReady(game);
    row.loadMs = Date.now() - t0;
    row.buildMs = info.buildMs ?? null;
    row.renderer = game.client.hello?.renderer || null;
    await game.client.call('frames', 20);
    if (setup.gpu === false) {
      // a CPU bench: the plan's extra does the measuring; then one shot of whatever the test left on screen
      row.cpuOnly = true;
      delete row.windowMs;
      if (plan.extra?.[setup.id]) await plan.extra[setup.id](ctx, game, row);
      if (setup.shot !== false) {
        const file = path.join(ctx.shotDir, `${setup.id}.png`);
        if (typeof setup.shot === 'string') await game.client.call('bench', 'pose', { name: setup.shot });
        await game.client.call('frames', 12);
        const s = await game.client.call('shot', file);
        row.shot = path.relative(ROOT, file);
        row.shotSize = `${s.width}x${s.height}`;
      }
      row.scene = await game.client.call('bench', 'info');
    } else {
      await measureRender(ctx, game, setup, row, windowMs, warmMs);
    }
  } finally {
    try { await game.client.call('quit'); } catch { /* already gone */ }
    const code = await Promise.race([game.exited, sleep(8000).then(() => 'timeout')]);
    if (code === 'timeout') game.proc.kill('SIGKILL');
  }
  return finishRow(game, row, before);
}

/** The render measurement of one setup: every camera path plain and with the ballast, the blank window, one shot. */
async function measureRender(ctx, game, setup, row, windowMs, warmMs) {
  const { plan } = ctx;
  row.paths = {};
  const n = await calibrateBallast(ctx, game, setup.driver || 'vulkan');
  for (const name of setup.paths) {
    // pass 1, as a player would see it: frame times (the display caps them), CPU, draw calls, memory
    await game.client.call('bench', 'path', { name, seconds: warmMs / 1000 + 0.5 });
    await game.client.call('perf', warmMs);
    await game.client.call('bench', 'path', { name, seconds: windowMs / 1000 + 1 });
    const plain = await game.client.call('perf', windowMs);
    // pass 2, with the GPU kept busy by the ballast: the root viewport's GPU time at full GPU clock
    await game.client.call('bench', 'ballast', { n });
    await game.client.call('bench', 'path', { name, seconds: windowMs / 1000 + 1.6 });
    await game.client.call('perf', 500);
    const busy = await game.client.call('perf', windowMs);
    await game.client.call('bench', 'ballast', { n: 0 });
    const r = perfRow(plain);
    r.gpuP95Capped = r.gpuP95;
    r.gpuP50Capped = r.gpuP50;
    r.gpuP95 = busy.gpuMs ? round(busy.gpuMs.p95) : null;
    r.gpuP50 = busy.gpuMs ? round(busy.gpuMs.p50) : null;
    r.ballastFrameP50 = round(busy.frameMs?.p50);
    r.ballastFrameP95 = round(busy.frameMs?.p95);
    row.paths[name] = r;
  }
  // the ballast alone (the root viewport draws no 3D): what to take off a ballast frame to get the scene's cost
  const blank = await measureBlank(game.client, n, { warmMs: 400, windowMs: 1200 });
  row.ballast = { n, blankFrameP50: round(blank.frameMs?.p50), blankFrameP95: round(blank.frameMs?.p95) };
  for (const r of Object.values(row.paths)) {
    r.frameCostP50 = round(r.ballastFrameP50 - row.ballast.blankFrameP50);
    r.frameCostP95 = round(r.ballastFrameP95 - row.ballast.blankFrameP95);
  }
  const primary = setup.primary || setup.paths[0];
  Object.assign(row, { primary }, row.paths[primary]);
  if (plan.extra?.[setup.id]) await plan.extra[setup.id](ctx, game, row);
  const shot = path.join(ctx.shotDir, `${setup.id}.png`);
  await game.client.call('bench', 'pose', { name: setup.shot || primary });
  await game.client.call('frames', 12);
  const s = await game.client.call('shot', shot);
  row.shot = path.relative(ROOT, shot);
  row.shotSize = `${s.width}x${s.height}`;
  row.scene = await game.client.call('bench', 'info');
}

/** Adds the engine's error and warning lines and the host load to a finished row. */
function finishRow(game, row, before) {
  const errors = game.log.filter((l) => /^(ERROR|SCRIPT ERROR|USER ERROR)/.test(l));
  if (errors.length) row.engineErrors = errors.slice(0, 6);
  const warnings = game.log.filter((l) => /^(WARNING|USER WARNING)/.test(l));
  if (warnings.length) row.engineWarnings = [...new Set(warnings)].slice(0, 6);
  row.hostLoad = { before, after: hostLoad() };
  return row;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.name) {
    console.log('usage: node harness/bench/arch.mjs <name> [--only a,b] [--group g] [--list] [--window ms] [--keep]');
    process.exit(2);
  }
  const planFile = path.join(ROOT, 'harness', 'bench', `${args.name}.plan.mjs`);
  if (!fs.existsSync(planFile)) {
    console.log(`no plan for bench '${args.name}' (${path.relative(ROOT, planFile)})`);
    process.exit(2);
  }
  const plan = (await import(pathToFileURL(planFile).href)).default;
  let setups = plan.setups;
  if (args.only) setups = setups.filter((s) => args.only.includes(s.id));
  if (args.group) setups = setups.filter((s) => args.group.includes(s.group));
  if (args.list) {
    for (const s of plan.setups) console.log(`${s.id.padEnd(22)} ${String(s.group).padEnd(10)} ${s.option.padEnd(8)} ${s.driver || 'vulkan'} ${s.tokens}  [${(s.paths || []).join(', ')}]`);
    return;
  }
  const outDir = path.join(ROOT, 'harness', 'reports', 'arch');
  const shotDir = path.join(outDir, plan.name);
  fs.mkdirSync(shotDir, { recursive: true });
  const outFile = path.join(outDir, `${plan.name}.json`);
  const g = await resolveGodot({ allowDownload: true });
  const version = String(spawnSync(g.path, ['--version'], { encoding: 'utf8' }).stdout || '').trim();
  const cpus = os.cpus();
  const log = (m) => console.log(m);
  const ctx = { plan, binary: g.path, root: ROOT, outDir, shotDir, log, windowMs: args.windowMs, keep: args.keep, selected: setups.map((s) => s.id), partial: !!(args.only || args.group) };
  let report = { bench: plan.name, setups: {} };
  if (ctx.partial && fs.existsSync(outFile)) {
    try { report = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch { /* start again */ }
  }
  report.bench = plan.name;
  report.scene = plan.scene;
  report.writtenBy = `node harness/bench/arch.mjs ${plan.name}`;
  report.at = new Date().toISOString();
  report.machine = `${os.hostname().replace(/\.local$/, '')}, ${os.platform()} ${os.arch()}, ${cpus[0]?.model || 'unknown cpu'}, ${cpus.length} cores, ${Math.round(os.totalmem() / 2 ** 30)} GB`;
  report.godotVersion = version;
  report.defaults = plan.defaults;
  report.howMeasured = plan.howMeasured || null;
  report.setups = report.setups || {};
  const save = () => fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n');
  if (plan.before) await plan.before(ctx, report);
  for (const setup of setups) {
    log(`[${plan.name}] ${setup.id} (${setup.tokens}, ${setup.driver || 'vulkan'})`);
    let row = null;
    try {
      row = await runSetup(ctx, setup);
      if (row.hostLoad.before.perCore >= 1 || row.hostLoad.after.perCore >= 1) {
        log('  the machine was loaded during this run: one rerun');
        const again = await runSetup(ctx, setup);
        again.rerunBecauseLoaded = true;
        row = again;
      }
    } catch (e) {
      row = { id: setup.id, option: setup.option, group: setup.group, tokens: setup.tokens, must: setup.must !== false, failed: String(e.message || e).split('\n').slice(0, 12).join(' | ') };
      log(`  FAILED: ${row.failed}`);
    }
    report.setups[setup.id] = row;
    if (!report.renderer && row.renderer) {
      report.renderer = RENDER_METHODS[row.renderer.method] || row.renderer.method;
      report.gpuAdapter = row.renderer.adapter;
    }
    report.hostLoad = hostLoad();
    if (!row.failed && row.cpuOnly) {
      log(`  load ${row.loadMs} ms  ${row.line || ''}  (load per core ${row.hostLoad.before.perCore} to ${row.hostLoad.after.perCore})`);
    } else if (!row.failed) {
      log(`  load ${row.loadMs} ms  frame p50 ${row.frameP50} p95 ${row.frameP95}  cost ${row.frameCostP50}  cpu p95 ${row.cpuP95}  gpu p95 ${row.gpuP95 ?? 'n/a'} (capped ${row.gpuP95Capped ?? 'n/a'})  draws ${row.drawCalls}  prims ${row.primitives}  video ${row.videoMB} MB  (load per core ${row.hostLoad.before.perCore} to ${row.hostLoad.after.perCore})`);
    }
    save();
  }
  report.notMeasured = [
    ...(plan.notMeasured || []),
    ...plan.setups.filter((s) => report.setups[s.id]?.failed).map((s) => ({ id: s.id, option: s.option, reason: `the run failed: ${report.setups[s.id].failed}`, estimate: s.estimate || null })),
    ...plan.setups.filter((s) => !report.setups[s.id]).map((s) => ({ id: s.id, option: s.option, reason: 'not run yet (partial run of the bench)', estimate: s.estimate || null })),
  ];
  if (plan.after) await plan.after(ctx, report);
  save();
  log(`wrote ${path.relative(ROOT, outFile)} (${Object.keys(report.setups).length} setups, ${report.notMeasured.length} not measured)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
}
