// The Godot driver (P0-026): the same interface verify.mjs and shoot.mjs use from browser.mjs, for the Godot game.
// kit.config.json "target": "godot" picks it (driver.mjs). A "page" is one run of the pinned Godot on game/:
//   launch()                       resolves the pinned engine; returns {browser, gl} (no browser: a handle for close())
//   startServer()                  nothing to serve; returns {url, close} so callers stay the same
//   openPage(browser, spec, size)  launches Godot windowed at size (or headless) with -- --debug --debug-port=N --verify
//                                  and the spec's game args, connects to the debug server; returns {page, log}
//   waitReady(page)                window.__game.ready (the newest snapshot says ready)
//   debugCall(page, name, args)    a hook through the window shim (godotshim.mjs)
//   runStep(ctx, step)             the scenario steps of browser.mjs runStep that make sense for Godot
// Page-side scripts run in a node vm whose global is the window shim (godotshim.mjs), so they run unchanged.
// A console error is any ERROR, SCRIPT ERROR, USER ERROR line in Godot's output, an `error` event from the game (its
// Logger, game/debug/debug_logger.gd) or a console.error in a script. Shots are the debug server's shot(path): the
// window's viewport as a PNG. Headless runs (scenario `headless: true`) have no shots and no perf.
// Env: HARNESS_GODOT_ARGS adds engine args (for example "--rendering-driver vulkan" for GPU times on macOS);
// HARNESS_QUERY adds game args the way it adds page params ("a=1&b" becomes "--a=1 --b").
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchGame, freePort, portOpen } from './godotclient.mjs';
import { resolveGodot, errorLines } from './godot.mjs';
import { makeGame, makeWindow, evaluateIn } from './godotshim.mjs';
import { waitWithBudget } from './budgetwait.mjs';
import { waitForPredicate, waitForError } from './waitpredicate.mjs';
import { LOAD_PER_CORE_MAX } from './perfgate.mjs';
import { ROOT, config } from './lib.mjs';

export const kind = 'godot';
export { npmRun } from './browser.mjs';

/** Script steps with a budget of this many ms or more get automatic progress marks (same rule as browser.mjs). */
export const AUTO_PROGRESS_MIN_MS = 150000;
const ERROR_LINE = /^\s*(ERROR|SCRIPT ERROR|USER ERROR|USER SCRIPT ERROR)\b/;
const WARNING_LINE = /^\s*(WARNING|USER WARNING|SCRIPT WARNING)\b/;
/** Frames before Godot quits on its own: a safety net only, close() ends every run. About an hour at 60 fps. */
const QUIT_AFTER = 216000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** What one line of engine output is: 'error', 'warning' or null. */
export function classifyLine(line) {
  if (ERROR_LINE.test(line)) return 'error';
  if (WARNING_LINE.test(line)) return 'warning';
  return null;
}

/** Page params as game args: "a=1&b&c=x y" becomes ["--a=1", "--b", "--c=x y"]; a value "1" or "true" is a flag. */
export function queryArgs(query) {
  const out = [];
  for (const part of String(query || '').replace(/^[?&]+/, '').split('&')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = decodeURIComponent(i < 0 ? part : part.slice(0, i)).replace(/^-+/, '');
    const v = i < 0 ? '' : decodeURIComponent(part.slice(i + 1));
    if (!k) continue;
    out.push(v === '' || v === '1' || v === 'true' ? `--${k}` : `--${k}=${v}`);
  }
  return out;
}

/** The game args (after `--`) for a scenario spec {quality, query, lockstep}, beside --debug, --debug-port and --verify. */
export function specArgs(spec = {}, env = process.env) {
  const a = [];
  if (spec.quality) a.push(`--quality=${spec.quality}`);
  if (spec.lockstep) a.push('--lockstep');
  a.push(...queryArgs(spec.query), ...queryArgs(env.HARNESS_QUERY));
  return [...new Set(a)];
}

export function engineArgs(env = process.env) {
  return String(env.HARNESS_GODOT_ARGS || '').split(/\s+/).filter(Boolean);
}

/** The engine; `gl` is filled from the first game's hello (adapter, driver). */
export async function launch() {
  const g = await resolveGodot({ allowDownload: true });
  const gl = { renderer: `Godot ${g.cfg.version}`, vendor: '', software: false, driver: 'godot', binary: g.path };
  return { browser: { kind, gl, binary: g.path, version: g.cfg.version, close: async () => undefined }, gl };
}

export async function startServer() {
  return { url: 'godot:', close: async () => undefined };
}

/**
 * One Godot run. spec: {quality, query, lockstep, headless, args: [extra game args]}; size: {width, height}.
 * Never throws: a run that could not start is a page whose waitReady says why.
 */
export async function openPage(browser, spec = {}, { width = 1280, height = 720 } = {}) {
  const log = { errors: [], warnings: [], failedRequests: [], lines: [], eventErrors: [] };
  const headless = !!spec.headless;
  const page = {
    kind, headless, size: [width, height], log, binary: browser?.binary, run: null, client: null, startError: null, closed: false,
    asyncErrors: [],
    evaluate: async (fnOrSrc, arg) => {
      if (page.closed || page.exited) throw new Error('the game has been closed (Godot exited)');
      return evaluateIn(page.win, fnOrSrc, arg);
    },
    waitForTimeout: (ms) => sleep(ms),
    close: () => closePage(page),
  };
  const onLog = (line) => {
    log.lines.push(line);
    if (log.lines.length > 400) log.lines.splice(0, log.lines.length - 400);
    const k = classifyLine(line);
    if (k === 'error') log.errors.push({ text: line.trim() });
    else if (k === 'warning' && log.warnings.length < 50) log.warnings.push(line.trim());
  };
  try {
    page.run = await launchGame({
      debug: true, verify: true, headless, resolution: `${width}x${height}`, quitAfter: QUIT_AFTER, binary: browser?.binary,
      extra: [...specArgs(spec), ...(spec.args || [])], engineExtra: engineArgs(), onLog,
    });
    page.client = page.run.client;
    page.run.exited.then((code) => { page.exited = true; page.exitCode = code; if (!page.closed) page.exitedEarly = code; });
    page.client.listeners.add((s) => {
      for (const e of s.events || []) if (e.type === 'error') log.eventErrors.push(e);
    });
    const r = page.client.hello?.renderer;
    if (r && browser?.gl && !headless) Object.assign(browser.gl, { renderer: `Godot ${browser.version} ${r.adapter || '?'} (${r.driver || '?'}, ${r.method || '?'})`, vendor: r.vendor || '' });
  } catch (e) {
    page.startError = String(e.message || e).split('\n')[0];
    log.errors.push({ text: `godot did not start: ${String(e.message || e).slice(0, 600)}` });
    page.exited = true;
  }
  const game = page.client
    ? makeGame(page.client, { onAsyncError: (m, e) => page.asyncErrors.push(`${m}: ${String(e.message || e)}`) })
    : { ready: false, version: '', debug: undefined };
  page.game = game;
  page.win = makeWindow(game, { onConsoleError: (text) => log.errors.push({ text: `console.error in a script: ${text}` }) });
  return { page, log };
}

/** Ends the run: quit() and wait, kill after 10 s. Error events that no ERROR line already reported count as errors. */
async function closePage(page) {
  if (page.closed) return;
  page.closed = true;
  const run = page.run;
  if (run && !page.exited) {
    try { await Promise.race([page.client.call('quit'), sleep(5000)]); } catch { /* already gone */ }
    const code = await Promise.race([run.exited, sleep(10000).then(() => 'timeout')]);
    if (code === 'timeout') { run.proc.kill('SIGKILL'); await run.exited; }
    // A game that dies while it quits (an abort or a segfault in its cleanup, P1-019: a node freed twice) is a crash.
    else if (code !== 0 || run.exitSignal) page.log.errors.push({ text: `godot crashed while quitting (exit code ${code}${run.exitSignal ? `, ${run.exitSignal}` : ''})` });
  }
  page.client?.close();
  const lines = page.log.errors.map((e) => e.text).join('\n');
  for (const e of page.log.eventErrors) {
    const msg = String(e.data?.message ?? e.message ?? JSON.stringify(e.data ?? e));
    if (!lines.includes(msg)) page.log.errors.push({ text: `error event: ${msg}${e.data?.file ? ` (${e.data.file}:${e.data.line})` : ''}` });
  }
  // A run that ended on its own (a crash) before close is an error too.
  if (page.exitedEarly !== undefined) page.log.errors.push({ text: `godot exited on its own (code ${page.exitedEarly}) before the run ended` });
}

export async function waitReady(page, timeoutMs = 45000) {
  if (page.startError) return { ok: false, reason: page.startError };
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (page.game.ready) return { ok: true };
    if (page.exited) return { ok: false, reason: `the game exited (code ${page.exitCode}) before it was ready` };
    await sleep(50);
  }
  return { ok: false, reason: 'the debug server connected but no snapshot said ready' };
}

/** Hooks a `call` step reads from the newest snapshot; every other one is a request whose answer (or error) it waits for. */
const SNAPSHOT_READS = new Set(['state', 'clock', 'events']);

/** A hook by name; resolves {ok, value|error} like browser.mjs debugCall. */
export async function debugCall(page, name, args = [], timeoutMs = 60000) {
  const d = page.game?.debug;
  if (!d || typeof d[name] !== 'function') return { ok: false, error: `__game.debug.${name} is not a function` };
  const read = SNAPSHOT_READS.has(name) || (name === 'hold' && (!args.length || args[0] == null));
  let handle;
  const timer = new Promise((r) => { handle = setTimeout(() => r({ ok: false, error: `${name} timed out after ${timeoutMs} ms` }), timeoutMs); });
  const call = Promise.resolve().then(() => (read ? d[name](...args) : page.client.call(name, ...args))).then(
    (v) => ({ ok: true, value: v === undefined ? null : JSON.parse(JSON.stringify(v)) }),
    (e) => ({ ok: false, error: String(e.message || e).split('\n')[0] }),
  );
  try { return await Promise.race([call, timer]); } finally { clearTimeout(handle); }
}

/** Launches the game WITHOUT --debug (headless) and probes its port and the default port (hooks_no_debug). */
export async function probeNoDebug({ bootMs = 30000, binary } = {}) {
  const port = await freePort();
  const run = await launchGame({ binary, debug: false, headless: true, verify: true, port, quitAfter: QUIT_AFTER, extra: [`--debug-port=${port}`] });
  const defaultPort = Number(config().godot?.debugPort) || null;
  try {
    const t0 = Date.now();
    while (!run.log.some((l) => l.startsWith('game: boot')) && Date.now() - t0 < bootMs && run.proc.exitCode === null) await sleep(100);
    const bootLine = run.log.find((l) => l.startsWith('game: boot')) || null;
    let open = false;
    let probes = 0;
    for (let i = 0; i < 6 && run.proc.exitCode === null; i++) {
      probes++;
      if (await portOpen(port, 300)) open = true;
      if (defaultPort && await portOpen(defaultPort, 300)) open = true;
      await sleep(200);
    }
    return { booted: !!bootLine, bootLine, open, probes, port, defaultPort, debugServerLine: run.log.some((l) => l.startsWith('debug server:')), errors: errorLines(run.log.join('\n')) };
  } finally {
    run.proc.kill();
    await run.exited;
  }
}

// Steps the Godot target cannot run: raw keys and mouse, browser-only emulation, reload, viewport changes mid-run.
const BROWSER_ONLY = { key: 'raw keys', hold: 'raw keys', click: 'mouse clicks', emulate: 'media emulation', cpuThrottle: 'CPU throttling', reload: 'reload', viewport: 'viewport changes (use the scenario `viewport` option)' };
const ACTION_KEYS = new Set(['call', 'eval', 'waitFor', 'settle', 'key', 'hold', 'input', 'script', 'viewport', 'reload', 'emulate', 'click', 'perf', 'shot', 'sheets', 'cpuThrottle']);

/** One scenario step (browser.mjs runStep for Godot). ctx = {page, shotsDir, shots[], perf}. */
export async function runStep(ctx, step) {
  const { wait, ...action } = step;
  if (!Object.keys(action).some((k) => ACTION_KEYS.has(k))) {
    if (wait) { await sleep(wait); return { ok: true }; }
    return { ok: false, error: `unknown step ${JSON.stringify(step)}` };
  }
  const r = await runAction(ctx, step);
  if (wait && r && r.ok) await sleep(wait);
  return r;
}

async function runAction(ctx, step) {
  const { page } = ctx;
  for (const k of Object.keys(BROWSER_ONLY)) if (step[k] !== undefined) return { ok: false, error: `${k} step: the godot target has no ${BROWSER_ONLY[k]} (drive the game with input steps)` };
  if (step.call) return debugCall(page, step.call, step.args || [], step.timeout || 60000);
  if (step.eval) {
    try { return { ok: true, value: await page.evaluate(`(async () => (${step.eval}))()`) }; }
    catch (e) { return { ok: false, error: String(e.message || e).split('\n')[0] }; }
  }
  if (step.waitFor) {
    const w = await waitForPredicate(page, step.waitFor, { timeoutMs: step.timeout || 20000 });
    if (w.ok) return { ok: true };
    const s = page.game.debug?.state();
    return { ok: false, error: waitForError(step.waitFor, w, s ? { scene: s.scene ?? null, level: s.level ?? null } : null) };
  }
  if (step.settle !== undefined) return settle(page, Number(step.settle));
  if (step.input) {
    const D = page.game.debug;
    D.input(step.input, step.value ?? 1);
    if (step.ms) { await sleep(step.ms); D.input(step.input, 0); }
    await D.frames(1);
    return page.asyncErrors.length ? { ok: false, error: page.asyncErrors.shift() } : { ok: true };
  }
  if (step.script) return runScript(ctx, step);
  if (step.sheets) {
    const sum = ctx.scriptResult && ctx.scriptResult.summary;
    if (!sum || !Array.isArray(sum.sheets)) return { ok: false, error: 'sheets: the last script returned no summary.sheets' };
    try {
      const { drawAll } = await import('./seqsheet.mjs');
      for (const f of await drawAll(sum, ctx.shotsDir)) if (f.endsWith('.png')) ctx.shots.push(path.relative(ROOT, f));
      return { ok: true };
    } catch (e) { return { ok: false, error: `sheets: ${String(e.message || e).split('\n')[0]}` }; }
  }
  if (step.perf) {
    if (page.headless) return { ok: false, error: 'perf: a headless run renders nothing (drop `headless` from the scenario)' };
    const r = await debugCall(page, 'perf', [step.perf], step.perf + 30000);
    if (r.ok) ctx.perf = r.value;
    return r;
  }
  if (step.shot) return shot(ctx, String(step.shot));
  return { ok: false, error: `unknown step ${JSON.stringify(step)}` };
}

/** `{settle: s}`: s seconds of SIM pass, polled once per frame; the wall cap only catches a sim that stopped. */
async function settle(page, sec) {
  const D = page.game.debug;
  try {
    const c0 = D.clock();
    const t = c0.t + sec - 1e-9;
    const cap = 15000 + (sec / Math.max(0.25, c0.scale)) * 8000;
    const w0 = Date.now();
    while (D.clock().t < t) {
      if (Date.now() - w0 > cap) return { ok: false, error: `settle ${sec} s of sim: the sim moved ${(D.clock().t - c0.t).toFixed(2)} s in ${Math.round(cap / 1000)} s of wall time (paused ${D.clock().paused})` };
      await D.frames(1);
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: `settle: ${String(e.message || e).split('\n')[0]}` }; }
}

/** A shot of the game window through the debug server. Names ending _<w>x<h> must have that size. */
async function shot(ctx, rawName) {
  const { page } = ctx;
  const name = rawName.replace(/[^a-zA-Z0-9_.-]/g, '_');
  if (page.headless) return { ok: false, error: `shot ${name}: a headless run renders nothing (drop \`headless\` from the scenario)` };
  const file = path.resolve(ctx.shotsDir, `${name}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    await page.client.call('shot', file);
  } catch (e) { return { ok: false, error: `shot ${name}: ${String(e.message || e).split('\n')[0]}` }; }
  ctx.shots.push(path.relative(ROOT, file));
  const { shotSizeProblem } = await import('./browser.mjs');
  const sized = shotSizeProblem(name, file);
  if (sized) return { ok: false, error: sized, file };
  return { ok: true, file };
}

/** The page-script globals the browser exposes (browser.mjs), for the shim. */
function scriptGlobals(ctx) {
  const { page } = ctx;
  return {
    __shot: async (name) => {
      if (page.headless) { (ctx.skippedShots ||= []).push(String(name)); return false; }
      const r = await shot(ctx, String(name));
      if (!r.ok) (ctx.problems ||= []).push(r.error);
      return r.ok;
    },
    __hostLoad: () => {
      const avg1 = os.loadavg()[0];
      const cores = os.cpus().length;
      return { avg1: Math.round(avg1 * 100) / 100, cores, perCore: Math.round((avg1 / cores) * 100) / 100, loaded: avg1 / cores > LOAD_PER_CORE_MAX };
    },
    __pageCpu: async () => null,
    __probeNoDebug: (opts) => probeNoDebug({ ...(opts || {}), binary: page.binary }),
    __recStart: async () => { throw new Error('screen recording needs the web target (screencast.mjs)'); },
    __recStop: async () => null,
    __realInput: async () => { throw new Error('__realInput needs the web target; drive the game with debug.input'); },
  };
}

async function runScript(ctx, step) {
  const { page } = ctx;
  if (!page.win || !page.game.debug) return { ok: false, error: `script ${step.script}: the game is not running` };
  try {
    Object.assign(page.win, scriptGlobals(ctx));
    if (step.data) {
      const readData = (f) => JSON.parse(fs.readFileSync(path.resolve(ROOT, f), 'utf8'));
      page.win.__scriptData = typeof step.data === 'string' ? readData(step.data) : Object.fromEntries(Object.entries(step.data).map(([k, f]) => [k, readData(f)]));
    }
    // `params`: a few plain values of the scenario for a script that several scenarios share (window.__scriptParams)
    page.win.__scriptParams = step.params ? JSON.parse(JSON.stringify(step.params)) : {};
    const lib = fs.readFileSync(path.join(ROOT, 'harness', 'verify', 'scripts', 'lib', 'sim.js'), 'utf8');
    const autoProgress = (step.timeout || 180000) >= AUTO_PROGRESS_MIN_MS;
    page.win.__scriptProgress = null;
    page.win.__scriptLog = null;
    page.win.__scriptAutoProgress = autoProgress;
    evaluateIn(page.win, `window.__sim = ${lib.replace(/^(\/\/.*\n)+/, '')};`);
    const src = fs.readFileSync(path.resolve(ROOT, step.script), 'utf8');
    const limit = step.timeout || 180000;
    const stallMs = step.stallMs || 90000;
    const run = Promise.resolve().then(() => evaluateIn(page.win, `(async () => {\n${src}\n})()`)).catch((e) => ({ ok: false, reason: String(e.message || e).split('\n')[0] }));
    const w = await waitWithBudget(page, run, { budgetMs: limit, stallMs, slowCap: step.slowCap || 3, markName: '__scriptProgress' });
    let v = w.done ? w.value : { ok: false, reason: `script timed out after ${w.ms} ms (budget ${limit} ms; ${w.why})` };
    if (v && v.ok === true && w.ms > limit && Array.isArray(v.log)) v.log.push(`[harness] ran ${w.ms} ms, past its ${limit} ms budget while making progress: a loaded machine`);
    if (v && v.ok === false && /^script timed out/.test(String(v.reason)) && Array.isArray(page.win.__scriptLog)) {
      const trail = page.win.__scriptLog.slice(-6).map((x) => String(x).slice(0, 400));
      if (trail.length) v = { ...v, reason: `${v.reason}; last log: ${trail.join(' || ')}`, log: trail };
    }
    // Results cross from the vm realm: copy them into plain node objects.
    v = v === undefined ? v : JSON.parse(JSON.stringify(v));
    if (page.asyncErrors.length && v && v.ok === true) v = { ...v, ok: false, reason: `a hook request failed: ${page.asyncErrors.join('; ')}` };
    if (ctx.skippedShots?.length && v && Array.isArray(v.log)) v.log.push(`[harness] headless run: ${ctx.skippedShots.length} script shot(s) skipped (${ctx.skippedShots.join(', ')})`);
    ctx.scriptResult = v;
    if (!v || v.ok !== true) return { ok: false, error: `script ${step.script}: ${(v && v.reason) || 'returned no ok'}`, value: v };
    return { ok: true, value: v };
  } catch (e) { return { ok: false, error: String(e.message || e).split('\n')[0] }; }
}
