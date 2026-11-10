// Shared browser plumbing for verify.mjs and shoot.mjs: build, static server, Chromium with the best WebGL available.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { ROOT, R, config } from './lib.mjs';
import { startRecording } from './screencast.mjs';
import { drawAll } from './seqsheet.mjs';
import { LOAD_PER_CORE_MAX } from './perfgate.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.ktx2': 'image/ktx2', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json',
};

export function pkgScripts() {
  try { return JSON.parse(fs.readFileSync(R('package.json'), 'utf8')).scripts || {}; } catch { return {}; }
}

// Run an npm script if it exists. Returns {ran, ok, ms, tail}.
export function npmRun(script, { timeoutMs = 600000 } = {}) {
  if (!pkgScripts()[script]) return { ran: false, ok: true, ms: 0, tail: `no "${script}" script` };
  const t0 = Date.now();
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', '-s', script], { cwd: ROOT, encoding: 'utf8', timeout: timeoutMs, env: { ...process.env, CI: '1', FORCE_COLOR: '0' } });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim().split('\n');
  // P6-056: a run stopped at its limit never prints its failure reasons: say so, it is not a failing test.
  if (r.error?.code === 'ETIMEDOUT') out.push(`npm run ${script} was stopped at its ${Math.round(timeoutMs / 1000)} s limit (a stalled machine or a hang).`);
  return { ran: true, ok: r.status === 0, ms: Date.now() - t0, tail: out.slice(-40).join('\n') };
}

// Serve public/ first, then dist/. public/ only holds art, audio and manifest.json (stable paths), so a freshly ingested
// asset shows without a rebuild; dist/ still supplies index.html and Vite's hashed JS/CSS, which never exist in public/.
// Everything is sent no-store so neither the manifest nor an image can be stale.
// An overlay directory (P2-042 tests): files in <overlay>/assets/ are served before public/, and its assets/manifest.json is
// MERGED into the real manifest, so a scratch ingested rigged model shows in the game without ever being in public/assets.
let overlayDir = null;
export function setOverlay(dir) { overlayDir = dir ? path.resolve(dir) : null; }

function mergedManifest(overlayDir) {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
  const base = read(R('public', 'assets', 'manifest.json'));
  if (!overlayDir) return base;
  const over = read(path.join(overlayDir, 'assets', 'manifest.json'));
  const out = { ...base };
  for (const k of ['images', 'audio', 'models']) out[k] = { ...(base[k] || {}), ...(over[k] || {}) };
  return out;
}

// startServer({overlay}) gives THAT server its own overlay (verify runs a scenario with an overlay on a server of its own,
// so scenarios with and without one can run side by side); without it the server follows setOverlay().
export function startServer({ port = 0, overlay = null } = {}) {
  const own = overlay ? path.resolve(overlay) : null;
  const roots = [R(config().publicDir), R(config().buildDir)];
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (p.endsWith('/')) p += 'index.html';
    const ov = own || overlayDir;
    if (ov && p === '/assets/manifest.json') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(mergedManifest(ov))); return;
    }
    for (const root of ov ? [ov, ...roots] : roots) {
      const f = path.join(root, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
      if ((f === root || f.startsWith(root + path.sep)) && fs.existsSync(f) && fs.statSync(f).isFile()) {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        fs.createReadStream(f).pipe(res); return;
      }
    }
    res.writeHead(404); res.end('not found');
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise((r) => server.close(r)) })));
}

/** P5-113: script steps with a budget of this many ms or more get automatic progress marks (harness/verify/scripts/lib/sim.js autoMark). */
export const AUTO_PROGRESS_MIN_MS = 150000;
const NOISE = [/GL Driver Message/i, /Automatic fallback to software WebGL/i, /GPU stall due to ReadPixels/i, /favicon\.ico/i];

async function probeGL(browser) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      if (!gl) return null;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR) };
    });
  } finally { await page.close(); }
}

// Launch Chromium trying hardware GL first, then SwiftShader. Returns {browser, gl}.
export async function launch({ headed = false } = {}) {
  let pw;
  try { pw = await import('playwright'); }
  catch { throw new Error('playwright is not installed. Run: npm install && npx playwright install chromium'); }
  // P2B-011: the AudioContext may run without a gesture in the harness (verify, shoot), so the audio probe's meter is real.
  // A test-harness launch option only: the game still makes no context before a user gesture (audioBus.ts warmOnGesture).
  const audio = ['--autoplay-policy=no-user-gesture-required'];
  const gpu = [...audio, ...(process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist', '--enable-gpu'])];
  const soft = [...audio, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const attempts = [
    { channel: 'chromium', args: gpu }, { args: gpu },
    { channel: 'chromium', args: soft }, { args: soft },
  ];
  let lastErr;
  for (const a of attempts) {
    let browser;
    try {
      browser = await pw.chromium.launch({ headless: !headed, ...a });
      const gl = await probeGL(browser);
      if (gl) return { browser, gl: { ...gl, software: /swiftshader|llvmpipe|software|basic render/i.test(`${gl.renderer} ${gl.vendor}`), launch: a } };
      await browser.close();
    } catch (e) { lastErr = e; try { await browser?.close(); } catch { /* ignore */ } }
  }
  throw new Error(`Could not start Chromium with WebGL2. ${lastErr ? lastErr.message.split('\n')[0] : ''} Try: npx playwright install chromium`);
}

// Open a page and collect console errors / warnings / failed requests.
export async function openPage(browser, url, { width = 1280, height = 720, dpr = 1 } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
  const log = { errors: [], warnings: [], failedRequests: [] };
  page.on('console', (msg) => {
    const text = msg.text();
    const loc = msg.location();
    if (NOISE.some((r) => r.test(text) || r.test(loc?.url || ''))) return;
    if (msg.type() === 'error') log.errors.push({ text, url: loc?.url, line: loc?.lineNumber });
    else if (msg.type() === 'warning' && log.warnings.length < 50) log.warnings.push(text);
  });
  // P6-070: a renderer crash is named in the log (a step that was waiting reads "Target crashed" on its own).
  page.on('crash', () => log.errors.push({ text: 'page crashed (renderer process gone, often memory pressure)' }));
  page.on('pageerror', (err) => log.errors.push({ text: `pageerror: ${err.message}`, stack: (err.stack || '').split('\n').slice(0, 4).join(' | ') }));
  page.on('requestfailed', (req) => { if (!NOISE.some((r) => r.test(req.url()))) log.failedRequests.push(`${req.failure()?.errorText || 'failed'} ${req.url()}`); });
  page.on('response', (res) => { if (res.status() >= 400 && !NOISE.some((r) => r.test(res.url()))) log.failedRequests.push(`${res.status()} ${res.url()}`); });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  return { page, log };
}

export async function waitReady(page, timeoutMs = 45000) {
  try {
    await page.waitForFunction(() => window.__game && window.__game.ready === true, null, { timeout: timeoutMs, polling: 250 });
    return { ok: true };
  } catch {
    const hasApi = await page.evaluate(() => !!window.__game).catch(() => false);
    return { ok: false, reason: hasApi ? '__game exists but ready never became true' : 'window.__game never appeared (is ?debug=1 handled? see docs/GAME_HOOKS.md)' };
  }
}

// Run a debug API call by name with args; resolves to {ok, value|error}.
export async function debugCall(page, name, args = [], timeoutMs = 60000) {
  const call = page.evaluate(async ({ name, args }) => {
    const d = window.__game && window.__game.debug;
    if (!d || typeof d[name] !== 'function') return { ok: false, error: `__game.debug.${name} is not a function` };
    try { const v = await d[name](...args); return { ok: true, value: v === undefined ? null : JSON.parse(JSON.stringify(v)) }; }
    catch (e) { return { ok: false, error: String(e && e.message ? e.message : e) }; }
  }, { name, args });
  let handle;
  const timer = new Promise((r) => { handle = setTimeout(() => r({ ok: false, error: `${name} timed out after ${timeoutMs} ms` }), timeoutMs); });
  try { return await Promise.race([call.catch((e) => ({ ok: false, error: String(e.message || e).split('\n')[0] })), timer]); }
  finally { clearTimeout(handle); }
}

// P5-044 attempt 2: the progress probe and the budget wait live in budgetwait.mjs, shared by the script step and budgetedCall.
import { waitWithBudget } from './budgetwait.mjs';
import { waitForPredicate, waitForError } from './waitpredicate.mjs';
import { screenshotWithRetry } from './shotretry.mjs';
export { UNKNOWN, readMark, waitWithBudget } from './budgetwait.mjs';

/**
 * P5-044: a debug call (the autopilot) under a load safe wall clock guard, the same rule as a script budget (P5-042) and the
 * autopilot's own (`src/debug/autopilot/budget.ts`): `budgetMs` whatever happens; past it, on while the page's progress mark
 * (`window[markName]`) is fresh within `stallMs`, up to `slowCap` x the budget. `graceMs` is added to each limit, so the page's
 * own budget (which says where the bot was) normally ends the run first; this guard catches a page that stopped answering.
 * The wait is `waitWithBudget` (budgetwait.mjs): an unanswered probe is unknown, as in a script step.
 */
export async function budgetedCall(page, name, args, { budgetMs, stallMs = 150000, slowCap = 3, graceMs = 15000, markName = '__pilotProgress', probeMs, retryProbeMs, pollMs }) {
  const call = Promise.resolve().then(() => page.evaluate(async ({ name, args }) => {
    const d = window.__game && window.__game.debug;
    if (!d || typeof d[name] !== 'function') return { ok: false, error: `__game.debug.${name} is not a function` };
    try { const v = await d[name](...args); return { ok: true, value: v === undefined ? null : JSON.parse(JSON.stringify(v)) }; }
    catch (e) { return { ok: false, error: String(e && e.message ? e.message : e) }; }
  }, { name, args })).catch((e) => ({ ok: false, error: String(e.message || e).split('\n')[0] }));
  const w = await waitWithBudget(page, call, { budgetMs, stallMs, slowCap, graceMs, markName, probeMs, retryProbeMs, pollMs });
  if (!w.done) return { ok: false, error: `${name} timed out after ${w.ms} ms (budget ${budgetMs} ms; ${w.why})`, wallMs: w.ms };
  return { ...w.value, wallMs: w.ms, lastMark: w.lastMark };
}

// Execute one scenario/shoot step. ctx = {page, shotsDir, shots[], perf}
// `wait` is a pause on its own ({wait: 900}) or, next to an action ({viewport: [w, h], wait: 900}, {emulate, wait}), the settle
// time AFTER that action. The action always runs first (P2-085: a wait handled first returned before the viewport branch, so
// the title_keyart shots were never resized).
export async function runStep(ctx, step) {
  const { page } = ctx;
  const { wait, ...action } = step;
  if (!Object.keys(action).some((k) => ACTION_KEYS.has(k))) {
    if (wait) { await page.waitForTimeout(wait); return { ok: true }; }
    return { ok: false, error: `unknown step ${JSON.stringify(step)}` };
  }
  const r = await runAction(ctx, step);
  if (wait && r && r.ok) await page.waitForTimeout(wait);
  return r;
}

// Every key that makes a step an action; anything else (timeout, args, ms, value, data, ...) is a modifier of one.
const ACTION_KEYS = new Set(['call', 'eval', 'waitFor', 'settle', 'key', 'hold', 'input', 'script', 'viewport', 'reload', 'emulate', 'click', 'perf', 'shot', 'sheets', 'cpuThrottle']);

// One action of a step (no wait handling here: runStep waits after it). Actions that need a settle of their own (viewport,
// emulate) only take their default one when the step gives no explicit wait.
async function runAction(ctx, step) {
  const { page } = ctx;
  if (step.call) return debugCall(page, step.call, step.args || [], step.timeout || 60000);
  if (step.eval) {
    try { const v = await page.evaluate(`(async () => (${step.eval}))()`); return { ok: true, value: v }; }
    catch (e) { return { ok: false, error: e.message.split('\n')[0] }; }
  }
  if (step.waitFor) {
    // P6-070: answered time only (a page too busy to answer is not "false"), and a crash or a throwing predicate is named.
    const w = await waitForPredicate(page, step.waitFor, { timeoutMs: step.timeout || 20000 });
    if (w.ok) return { ok: true };
    const seen = w.kind === 'crashed' ? null : await Promise.race([new Promise((r) => setTimeout(() => r('no answer in 3 s'), 3000)), page.evaluate(() => {
      try {
        const s = window.__game && window.__game.debug && window.__game.debug.state();
        return s ? { scene: s.scene ?? null, level: s.level ?? s.milestone ?? null } : null;
      } catch (err) { return { stateError: String(err) }; }
    }).catch(() => 'no answer')]);
    return { ok: false, error: waitForError(step.waitFor, w, seen) };
  }
  if (step.settle !== undefined) {
    // `{settle: s}` (P2-122): lets s seconds of SIM pass, polled once per render frame (debug.frames), instead of a wall
    // clock `{wait: ms}`: a loaded page runs less game in the same ms. The wall cap only catches a sim that stopped.
    const sec = Number(step.settle);
    try {
      const why = await page.evaluate(async (sec) => {
        const D = window.__game && window.__game.debug;
        if (!D || typeof D.clock !== 'function') return 'no debug clock';
        const c0 = D.clock();
        const t = c0.t + sec - 1e-9;
        const cap = 15000 + (sec / Math.max(0.25, c0.scale)) * 8000;
        const w0 = performance.now();
        while (D.clock().t < t) {
          if (performance.now() - w0 > cap) return `settle ${sec} s of sim: the sim moved ${(D.clock().t - c0.t).toFixed(2)} s in ${Math.round(cap / 1000)} s of wall time (paused ${D.clock().paused})`;
          await D.frames(1);
        }
        return null;
      }, sec);
      return why ? { ok: false, error: why } : { ok: true };
    } catch (e) { return { ok: false, error: String(e.message || e).split('\n')[0] }; }
  }
  if (step.key) { await page.keyboard.press(step.key); return { ok: true }; }
  if (step.hold) { await page.keyboard.down(step.hold); await page.waitForTimeout(step.ms || 500); await page.keyboard.up(step.hold); return { ok: true }; }
  if (step.input) {
    const r = await debugCall(page, 'input', [step.input, step.value ?? 1]);
    if (step.ms) { await page.waitForTimeout(step.ms); await debugCall(page, 'input', [step.input, 0]); }
    return r;
  }
  if (step.script) {
    // Page-side script (harness/verify/scripts/*.js): the body of an async function that uses window.__game only and
    // returns {ok, reason?, log?}. It may call `await window.__shot(name)` to take a screenshot mid-run.
    try {
      if (!ctx.shotExposed) {
        await page.exposeFunction('__shot', async (name) => { await runStep(ctx, { shot: String(name) }); return true; });
        // Screen recording (P2-112, screencast.mjs): what the page really shows, for black gap checks and frame sequences.
        await page.exposeFunction('__recStart', async () => { ctx.rec = await startRecording(page); return true; });
        await page.exposeFunction('__recStop', async (name, opts) => {
          if (!ctx.rec) return null;
          const r = await ctx.rec.stop(String(name || 'rec'), ctx.shotsDir, opts && typeof opts === 'object' ? opts : {});
          ctx.rec = null;
          if (r.sheet) ctx.shots.push(r.sheet);
          // P4-071: a frame sequence's sheets are shots of the run too (the verifier reads them).
          if (r.sequence) for (const f of r.sequence.sheets) ctx.shots.push(f);
          return r;
        });
        // P4-052: the machine load for wall clock checks that a busy machine stretches (S.controlBack): the perf gate's rule.
        await page.exposeFunction('__hostLoad', () => {
          const avg1 = os.loadavg()[0];
          const cores = os.cpus().length;
          return { avg1: Math.round(avg1 * 100) / 100, cores, perCore: Math.round((avg1 / cores) * 100) / 100, loaded: avg1 / cores > LOAD_PER_CORE_MAX };
        });
        // P5-040: the page's main thread CPU time in ms (CDP Performance metrics, ThreadTime): work the page did, which
        // other pages on the machine do not stretch the way they stretch wall time (the caught flow's reload, RetryFlow.cpu).
        let cdp = null;
        await page.exposeFunction('__pageCpu', async () => {
          try {
            if (!cdp) {
              cdp = await page.context().newCDPSession(page);
              await cdp.send('Performance.enable');
            }
            const m = await cdp.send('Performance.getMetrics');
            const v = m.metrics.find((x) => x.name === 'ThreadTime')?.value;
            return typeof v === 'number' ? Math.round(v * 1e4) / 10 : null;
          } catch {
            return null;
          }
        });
        ctx.shotExposed = true;
      }
      // P5-036: real (trusted) mouse and keyboard input for page-side scripts, through Playwright's page.mouse and
      // page.keyboard: `await window.__realInput('click', x, y)`, `('move', x, y, steps)`, `('down' | 'up', button)`,
      // `('key', code)`, `('keyDown' | 'keyUp', code)`. Pointer lock and fullscreen only follow trusted input, so a check of
      // mouse look must use this, never debug.input or synthetic DOM events.
      if (!ctx.realExposed) {
        await page.exposeFunction('__realInput', async (op, a, b, c) => {
          if (op === 'click') await page.mouse.click(Number(a), Number(b));
          else if (op === 'move') await page.mouse.move(Number(a), Number(b), { steps: Math.max(1, Number(c) || 1) });
          else if (op === 'down') await page.mouse.down({ button: a || 'left' });
          else if (op === 'up') await page.mouse.up({ button: a || 'left' });
          else if (op === 'key') await page.keyboard.press(String(a));
          else if (op === 'keyDown') await page.keyboard.down(String(a));
          else if (op === 'keyUp') await page.keyboard.up(String(a));
          else throw new Error(`__realInput: unknown op ${op}`);
          return true;
        });
        ctx.realExposed = true;
      }
      // `data`: a JSON file the script reads as window.__scriptData (so a changed target needs no rebuild). An object of files ({poses: 'a.json', grades: 'b.json'}, P2B-034) gives
      // the script an object with each file parsed under its key.
      if (step.data) {
        const readData = (f) => JSON.parse(fs.readFileSync(path.resolve(ROOT, f), 'utf8'));
        const data = typeof step.data === 'string' ? readData(step.data) : Object.fromEntries(Object.entries(step.data).map(([k, f]) => [k, readData(f)]));
        await page.evaluate((d) => { window.__scriptData = d; }, data);
      }
      // The sim timed helpers (harness/verify/scripts/lib/sim.js, P2-093) as window.__sim, fresh for every script step.
      const lib = fs.readFileSync(path.join(ROOT, 'harness', 'verify', 'scripts', 'lib', 'sim.js'), 'utf8');
      // P5-113: a step with a budget of AUTO_PROGRESS_MIN_MS or more gets the sim helpers' automatic progress marks.
      const autoProgress = (step.timeout || 180000) >= AUTO_PROGRESS_MIN_MS;
      await page.evaluate(`window.__sim = ${lib.replace(/^(\/\/.*\n)+/, '')}; window.__scriptProgress = null; window.__scriptLog = null; window.__scriptAutoProgress = ${autoProgress};`);
      const src = fs.readFileSync(path.resolve(ROOT, step.script), 'utf8');
      // P5-042: `timeout` is the script's budget. A script that marks its progress (`S.progress(label)`, window.__scriptProgress)
      // and is still making it when the budget runs out (a mark within `stallMs`, default 90 s) runs on, up to `slowCap` times
      // the budget (default 3): a fixed number of region loads takes as long as the GPU the machine's other pages share lets
      // it (region_leak 30 s alone, 185 s in a loaded quick run), while a script that stops making progress fails at once.
      const limit = step.timeout || 180000;
      const stallMs = step.stallMs || 90000;
      const run = page.evaluate(`(async () => {\n${src}\n})()`).catch((e) => ({ ok: false, reason: String(e.message || e).split('\n')[0] }));
      // P5-042 attempt 2 and P5-044 attempt 2: a probe the busy page does not answer in time is unknown, not "no marks"
      // (budgetwait.mjs, shared with the autopilot guard).
      const w = await waitWithBudget(page, run, { budgetMs: limit, stallMs, slowCap: step.slowCap || 3, markName: '__scriptProgress' });
      const lastMark = w.lastMark;
      let v = w.done ? w.value : { ok: false, reason: `script timed out after ${w.ms} ms (budget ${limit} ms; ${w.why})` };
      const ran = w.ms;
      if (v && v.ok === true && ran > limit && Array.isArray(v.log)) v.log.push(`[harness] ran ${ran} ms, past its ${limit} ms budget while making progress (last mark ${lastMark ? `${lastMark.n} ${lastMark.label}` : 'none'}): a loaded machine`);
      // P5-042: a timed out script says where it was: the last lines of its log, if it published it as window.__scriptLog.
      if (v && v.ok === false && /^script timed out/.test(String(v.reason))) {
        const trail = await Promise.race([
          page.evaluate(() => (Array.isArray(window.__scriptLog) ? window.__scriptLog.slice(-6).map((x) => String(x).slice(0, 400)) : null)).catch(() => null),
          new Promise((r) => setTimeout(() => r(null), 5000)),
        ]);
        if (trail && trail.length) v = { ...v, reason: `${v.reason}; last log: ${trail.join(' || ')}`, log: trail };
      }
      ctx.scriptResult = v;
      if (!v || v.ok !== true) return { ok: false, error: `script ${step.script}: ${(v && v.reason) || 'returned no ok'}`, value: v };
      return { ok: true, value: v };
    } catch (e) { return { ok: false, error: e.message.split('\n')[0] }; }
  }
  // `{sheets: true}` (P2-107, seqsheet.mjs): draws the contact sheets (and writes the text files) the last script step
  // returned in `summary.sheets` / `summary.files` into the shots folder.
  if (step.sheets) {
    const sum = ctx.scriptResult && ctx.scriptResult.summary;
    if (!sum || !Array.isArray(sum.sheets)) return { ok: false, error: 'sheets: the last script returned no summary.sheets' };
    try {
      for (const f of await drawAll(sum, ctx.shotsDir)) if (f.endsWith('.png')) ctx.shots.push(path.relative(ROOT, f));
      return { ok: true };
    } catch (e) { return { ok: false, error: `sheets: ${String(e.message || e).split('\n')[0]}` }; }
  }
  if (step.viewport) { await page.setViewportSize({ width: step.viewport[0], height: step.viewport[1] }); if (!step.wait) await page.waitForTimeout(400); return { ok: true }; }
  if (step.reload) {
    // Reloads the page (localStorage survives) and waits for the game to be ready again. Page-side state is lost.
    try {
      await page.reload({ waitUntil: 'load', timeout: 60000 });
      const r = await waitReady(page);
      if (!r.ok) return { ok: false, error: `reload: ${r.reason}` };
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e.message || e).split('\n')[0] }; }
  }
  // `{cpuThrottle: 4}` (P4-070): Chrome's CPU throttling (DevTools "4x slowdown") for the rest of the page's life, reloads
  // included; `{cpuThrottle: 1}` turns it off. The scenario's script reads it back as window.__cpuThrottle.
  if (step.cpuThrottle !== undefined) {
    try {
      ctx.cdp ??= await page.context().newCDPSession(page);
      const rate = Math.max(1, Number(step.cpuThrottle) || 1);
      await ctx.cdp.send('Emulation.setCPUThrottlingRate', { rate });
      await page.addInitScript((r) => { window.__cpuThrottle = r; }, rate);
      await page.evaluate((r) => { window.__cpuThrottle = r; }, rate);
      return { ok: true };
    } catch (e) { return { ok: false, error: `cpuThrottle: ${String(e.message || e).split('\n')[0]}` }; }
  }
  // `{emulate: {reducedMotion: 'reduce'}}`: page.emulateMedia (reduced motion, color scheme) for accessibility checks.
  if (step.emulate) { await page.emulateMedia(step.emulate); if (!step.wait) await page.waitForTimeout(200); return { ok: true }; }
  if (step.click) { await page.mouse.click(step.click[0], step.click[1]); return { ok: true }; }
  if (step.perf) { const r = await debugCall(page, 'perf', [step.perf], step.perf + 30000); if (r.ok) ctx.perf = r.value; return r; }
  if (step.shot) {
    const name = String(step.shot).replace(/[^a-zA-Z0-9_.-]/g, '_');
    const file = path.join(ctx.shotsDir, `${name}.png`);
    fs.mkdirSync(ctx.shotsDir, { recursive: true });
    // P3-049: a milestone run waits for the loading screen and fades to clear first (verify.mjs settleFade), so the checks below
    // and the shot see the playable frame.
    if (ctx.settleShot) await ctx.settleShot(name);
    // Generic shot rules (docs/GAME_HOOKS.md): when the game exposes debug.shotProblems(name), every shot asks it what is
    // wrong on screen right now (the player hidden under the HUD, a subtitle over the player, a debug overlay left on) and
    // each answer becomes a problem of the step. A fresh problem gets two short retries (a fade that just started).
    const shotRule = () => page.evaluate((n) => {
      const d = window.__game && window.__game.debug;
      if (!d || typeof d.shotProblems !== 'function') return null;
      const r = d.shotProblems(n);
      return Array.isArray(r) && r.length ? r.map(String) : null;
    }, name);
    try {
      let bad = await shotRule();
      for (let i = 0; bad && i < 2; i++) { await page.waitForTimeout(200); bad = await shotRule(); }
      if (bad) (ctx.problems ||= []).push(...bad.map((b) => `${name}: ${b}`));
    } catch { /* no game page */ }
    // P3-049: settle again right before the shot (the checks above take up to 2 s, a region switch may start meanwhile), and
    // retake it (twice at most) when a cover came up while it was taken.
    if (ctx.settleShot) await ctx.settleShot(name);
    // P6-072: a screenshot timeout under a heavy load is retried while the page answers (shotretry.mjs).
    const retry = { onRetry: (line) => { (ctx.shotRetries ||= []).push(`${name}: ${line}`); console.log(`    ${name}: ${line}`); } };
    await screenshotWithRetry(page, { path: file }, retry);
    for (let i = 0; ctx.shotCovered && i < 2 && (await ctx.shotCovered(name)); i++) {
      await ctx.settleShot?.(name);
      await screenshotWithRetry(page, { path: file }, retry);
    }
    ctx.shots.push(path.relative(ROOT, file));
    // A shot named for its size (`..._1024x768`, `..._2560x1440_dpr2`) must really be that size (P2-085: a viewport step that
    // never ran left four "sized" title shots at 1280x720).
    const sized = shotSizeProblem(name, file);
    if (sized) return { ok: false, error: sized, file };
    return { ok: true, file };
  }
  return { ok: false, error: `unknown step ${JSON.stringify(step)}` };
}

/** For a shot named `<...>_<w>x<h>` or `<...>_<w>x<h>_dpr<n>`: an error if the PNG is not w*n by h*n pixels, else null. */
export function shotSizeProblem(name, file) {
  const m = /_(\d{3,5})x(\d{3,5})(?:_dpr(\d+(?:\.\d+)?))?$/.exec(name);
  if (!m) return null;
  const dpr = m[3] ? Number(m[3]) : 1;
  const want = [Math.round(Number(m[1]) * dpr), Math.round(Number(m[2]) * dpr)];
  const head = Buffer.alloc(24);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, head, 0, 24, 0); } finally { fs.closeSync(fd); }
  const got = [head.readUInt32BE(16), head.readUInt32BE(20)];
  return got[0] === want[0] && got[1] === want[1] ? null : `${name}.png is ${got.join('x')} px, its name asks for ${want.join('x')}`;
}
