// The window shim for the Godot target (P0-026). Page-side verify scripts (harness/verify/scripts/*.js, milestone play
// scripts, the __sim lib) were written for a browser page with window.__game. Under Godot they run in a node vm whose
// global is this shim, so they run unchanged:
// - window.__game.ready comes from the newest snapshot (false before the first one), .version from the hello;
// - the synchronous hooks (state, clock, events, hold with no args) read the newest snapshot the game pushed after its
//   last frame (docs/GAME_HOOKS.md "Snapshot vs request"), with no round trip;
// - every other hook is a request to the server (frames, perf, load, input, teleport, setCamera, timeScale, hud, quality,
//   timeOfDay, hold with args). Hooks that are synchronous in the browser (input, hold, timeScale, hud, setCamera) send the request
//   and return at once; TCP keeps the order, so a following `await D.frames(1)` runs after them in the game. A request
//   nobody awaits that fails is recorded (onAsyncError) instead of being lost.
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

/** The hooks a script may call on window.__game.debug (GAME_HOOKS.md "Required" plus quality and timeOfDay). */
export const SHIM_HOOKS = ['state', 'clock', 'frames', 'input', 'perf', 'load', 'teleport', 'setCamera', 'timeScale', 'hold', 'events', 'hud', 'quality', 'timeOfDay', 'stream', 'vehicle', 'foot', 'city', 'traffic', 'gps', 'bench'];

/**
 * window.__game for a connected GodotDebugClient (or any object with hello, snapshot, events and call(method, ...args)).
 * onAsyncError(method, error) is told about a failed request the script did not await.
 */
export function makeGame(client, { onAsyncError = () => {} } = {}) {
  const snap = () => client.snapshot || null;
  const fire = (method, ...args) => {
    const p = client.call(method, ...args);
    p.catch((e) => onAsyncError(method, e));
    return p;
  };
  const debug = {
    state: () => snap()?.state ?? null,
    clock: () => snap()?.clock ?? { t: 0, scale: 1, paused: false },
    events: () => client.events.slice(),
    frames: (n = 1) => client.call('frames', n),
    perf: (ms = 1000) => client.call('perf', ms),
    load: (id, opts) => client.call('load', ...(opts === undefined ? [id] : [id, opts])),
    teleport: (where) => client.call('teleport', where),
    quality: (...a) => client.call('quality', ...a),
    /** Reads ({}) or sets the day clock: {hour, rate, pin, reload} (GAME_HOOKS.md "timeOfDay"). */
    timeOfDay: (opts) => client.call('timeOfDay', ...(opts === undefined ? [] : [opts])),
    /** The streamed city's probes (GAME_HOOKS.md "stream"): info, path, record, probe, mem. */
    stream: (cmd = 'info', opts) => client.call('stream', cmd, ...(opts === undefined ? [] : [opts])),
    /** The V2 vehicle's probes (GAME_HOOKS.md "vehicle"): info, run, cost, camrec. */
    vehicle: (cmd = 'info', opts) => client.call('vehicle', cmd, ...(opts === undefined ? [] : [opts])),
    /** The on-foot probes (GAME_HOOKS.md "foot"): info, stage, run, camrec, cost. */
    foot: (cmd = 'info', opts) => client.call('foot', cmd, ...(opts === undefined ? [] : [opts])),
    /** bench('ballast', {n}) and bench('blank', {on}) in any scene (GPU readings under the 120 fps cap, ballast.mjs). */
    bench: (cmd, opts) => client.call('bench', cmd, ...(opts === undefined ? [] : [opts])),
    /** The city checks (GAME_HOOKS.md "city"): pins, geo, screen, mirror, surface, watch. */
    city: (cmd = 'pins', opts) => client.call('city', cmd, ...(opts === undefined ? [] : [opts])),
    /** The traffic stand-in (GAME_HOOKS.md "traffic", P2-045): start, stop, info. */
    traffic: (cmd = 'info', opts) => client.call('traffic', cmd, ...(opts === undefined ? [] : [opts])),
    /** The route line (GAME_HOOKS.md "gps", P2-045): set, clear, info, plan. */
    gps: (cmd = 'info', opts) => client.call('gps', cmd, ...(opts === undefined ? [] : [opts])),
    input: (action, value = 1) => { fire('input', action, value); },
    setCamera: (pose) => { fire('setCamera', pose ?? null); },
    timeScale: (n) => { fire('timeScale', n); },
    hud: (on) => { fire('hud', !!on); },
    /** No args: the newest snapshot's hold. With args: sent to the game; answers what the game will report. */
    hold: (opts) => {
      const s = snap();
      const now = { paused: !!s?.hold?.paused, t: s?.clock?.t ?? 0, at: s?.hold?.at ?? null };
      if (!opts || typeof opts !== 'object' || !Object.keys(opts).length) return now;
      fire('hold', opts);
      const out = { ...now };
      if (opts.cancel) out.at = null;
      if (opts.release) out.paused = false;
      if (opts.at !== undefined && opts.at !== null) out.at = Number(opts.at);
      return out;
    },
  };
  return {
    // Ready only once a snapshot says so: before the first one the sync hooks have nothing to answer from.
    get ready() { return !!snap()?.ready; },
    get version() { return String(client.hello?.version ?? ''); },
    debug,
  };
}

/**
 * A vm context that looks like the page to a script: `window` is the global, with window.__game, performance,
 * timers and console. `extra` adds globals (window.__shot, __hostLoad, __probeNoDebug ...). Returns the context.
 */
export function makeWindow(game, { extra = {}, onConsoleError = () => {}, onConsole = () => {} } = {}) {
  const win = {
    __game: game,
    performance,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    console: {
      log: (...a) => onConsole('log', a), info: (...a) => onConsole('info', a), debug: (...a) => onConsole('debug', a),
      warn: (...a) => onConsole('warn', a), error: (...a) => onConsoleError(a.map(String).join(' ')),
    },
    ...extra,
  };
  vm.createContext(win);
  win.window = win;
  win.globalThis = win;
  return win;
}

/** Runs page-style code in the shim: a function (called with arg) or an expression string. Like page.evaluate. */
export function evaluateIn(win, fnOrSrc, arg) {
  if (typeof fnOrSrc === 'function') return vm.runInContext(`(${fnOrSrc.toString()})`, win)(arg);
  return vm.runInContext(String(fnOrSrc), win);
}
