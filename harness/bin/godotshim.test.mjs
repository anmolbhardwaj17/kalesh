// P0-026: the window shim the Godot driver runs page-side scripts in (godotshim.mjs) and the driver's pure helpers.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeGame, makeWindow, evaluateIn, SHIM_HOOKS } from './godotshim.mjs';
import { classifyLine, queryArgs, specArgs } from './godotdriver.mjs';
import { targetName } from './driver.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TICK = 1 / 60;

/** A fake GodotDebugClient: records calls; `frames` advances the sim and pushes a new snapshot (as the game does). */
function fakeClient({ failOn = [] } = {}) {
  const c = {
    hello: { type: 'hello', version: '0.0.1', ready: false },
    snapshot: null, events: [], calls: [], pressed: {},
    push(t, extra = {}) {
      const prev = this.snapshot;
      const speed = (this.pressed.throttle || 0) * 10;
      const z = (prev?.state.player.pos[2] ?? 0) - speed * (t - (prev?.clock.t ?? 0));
      this.snapshot = { type: 'snapshot', ready: true, frame: (prev?.frame ?? 0) + 1, state: { scene: 'scaffold', player: { pos: [0, 0, z], heading: 0, speed } },
        clock: { t, scale: 1, paused: false }, hold: { paused: false, t, at: null }, ...extra };
    },
    async call(method, ...args) {
      this.calls.push([method, ...args]);
      if (failOn.includes(method)) throw new Error(`${method}: unknown action '${args[0]}'`);
      if (method === 'input') { this.pressed[args[0]] = args[1]; return true; }
      if (method === 'frames') { for (let i = 0; i < (args[0] || 1); i++) this.push((this.snapshot?.clock.t ?? 0) + TICK); return { frame: this.snapshot.frame }; }
      if (method === 'perf') return { cpuMs: { p50: 1, p95: 2, max: 3 }, avgFps: 60, drawCalls: 5, triangles: 10, p95FrameMs: 16 };
      if (method === 'load') { this.push(this.snapshot?.clock.t ?? 0); return { scene: args[0] }; }
      return true;
    },
  };
  return c;
}

describe('godot window shim', () => {
  it('has every hook of the contract', () => {
    const g = makeGame(fakeClient());
    for (const k of SHIM_HOOKS) expect(typeof g.debug[k], k).toBe('function');
  });

  it('answers the sync hooks from the newest snapshot, with no request', () => {
    const c = fakeClient();
    c.push(1.5);
    c.events.push({ type: 'scene:load', t: 0, w: 1 });
    const D = makeGame(c).debug;
    expect(D.state().scene).toBe('scaffold');
    expect(D.clock()).toEqual({ t: 1.5, scale: 1, paused: false });
    expect(D.hold()).toEqual({ paused: false, t: 1.5, at: null });
    expect(D.events().map((e) => e.type)).toEqual(['scene:load']);
    expect(c.calls).toEqual([]);
    c.push(2);
    expect(D.clock().t).toBe(2);
  });

  it('sends the async hooks to the server and resolves with its answer', async () => {
    const c = fakeClient();
    const D = makeGame(c).debug;
    expect(await D.load('scaffold')).toEqual({ scene: 'scaffold' });
    expect((await D.frames(3)).frame).toBe(4);
    expect((await D.perf(500)).avgFps).toBe(60);
    expect(await D.teleport([1, 0, 2])).toBe(true);
    expect(c.calls.map((x) => x[0])).toEqual(['load', 'frames', 'perf', 'teleport']);
    expect(c.calls[1]).toEqual(['frames', 3]);
  });

  it('sends the browser-sync hooks at once and returns without waiting', () => {
    const c = fakeClient();
    c.push(1);
    const D = makeGame(c).debug;
    expect(D.input('throttle', 1)).toBeUndefined();
    D.setCamera({ pos: [0, 3, 0], target: [0, 3, -100] });
    D.timeScale(2);
    D.hud(false);
    const h = D.hold({ at: 1.25 });
    expect(h).toEqual({ paused: false, t: 1, at: 1.25 });
    expect(D.hold({ release: true, cancel: true })).toEqual({ paused: false, t: 1, at: null });
    expect(c.calls).toEqual([['input', 'throttle', 1], ['setCamera', { pos: [0, 3, 0], target: [0, 3, -100] }], ['timeScale', 2], ['hud', false], ['hold', { at: 1.25 }], ['hold', { release: true, cancel: true }]]);
  });

  it('reports a failed request nobody awaited', async () => {
    const errors = [];
    const D = makeGame(fakeClient({ failOn: ['input'] }), { onAsyncError: (m, e) => errors.push(`${m}: ${e.message}`) }).debug;
    D.input('fly', 1);
    await new Promise((r) => setTimeout(r, 0));
    expect(errors).toEqual(["input: input: unknown action 'fly'"]);
  });

  it('is ready only once a snapshot says so, and reads version from the hello', () => {
    const c = fakeClient();
    c.hello.ready = true;
    const g = makeGame(c);
    expect(g.ready).toBe(false);
    expect(g.version).toBe('0.0.1');
    c.push(0);
    expect(g.ready).toBe(true);
  });

  it('evaluates page code with window as the global', () => {
    const c = fakeClient();
    c.push(3);
    const win = makeWindow(makeGame(c), { extra: { __mark: { n: 2 } } });
    expect(evaluateIn(win, 'window.__game.debug.clock().t + 1')).toBe(4);
    expect(evaluateIn(win, (n) => window[n] || null, '__mark')).toEqual({ n: 2 });
    expect(evaluateIn(win, (n) => window[n] || null, '__none')).toBe(null);
    expect(evaluateIn(win, 'typeof performance.now() === "number" && typeof setTimeout')).toBe('function');
  });

  it('runs the real sim lib and an unchanged drive script against the shim', async () => {
    const c = fakeClient();
    c.push(0);
    const errors = [];
    const win = makeWindow(makeGame(c), { onConsoleError: (t) => errors.push(t) });
    const lib = fs.readFileSync(path.join(ROOT, 'harness', 'verify', 'scripts', 'lib', 'sim.js'), 'utf8');
    evaluateIn(win, `window.__sim = ${lib.replace(/^(\/\/.*\n)+/, '')};`);
    const src = fs.readFileSync(path.join(ROOT, 'harness', 'verify', 'scripts', 'drive_north.js'), 'utf8');
    const r = JSON.parse(JSON.stringify(await evaluateIn(win, `(async () => {\n${src}\n})()`)));
    expect(r.ok, r.reason).toBe(true);
    expect(r.summary.z).toBeLessThan(-10);
    // press() released the throttle after 3 s of sim, through input requests in order.
    const inputs = c.calls.filter((x) => x[0] === 'input');
    expect(inputs).toEqual([['input', 'throttle', 1], ['input', 'throttle', 0]]);
    expect(c.snapshot.clock.t).toBeGreaterThanOrEqual(3);
    expect(errors).toEqual([]);
  });
});

describe('godot driver helpers', () => {
  it('counts ERROR and SCRIPT ERROR lines as errors, WARNING lines as warnings', () => {
    expect(classifyLine('ERROR: Condition "x" is true.')).toBe('error');
    expect(classifyLine('SCRIPT ERROR: Parse Error: oops')).toBe('error');
    expect(classifyLine('USER ERROR: boom')).toBe('error');
    expect(classifyLine('WARNING: ObjectDB instances leaked at exit')).toBe('warning');
    expect(classifyLine('game: boot debug=true')).toBe(null);
    expect(classifyLine('   at: load (gdscript.cpp:46)')).toBe(null);
  });

  it('turns page params into game args', () => {
    expect(queryArgs('style=toon&lockstep=1&mute&scene=a%20b')).toEqual(['--style=toon', '--lockstep', '--mute', '--scene=a b']);
    expect(queryArgs('')).toEqual([]);
    expect(specArgs({ quality: 'low', lockstep: true, query: 'style=toon' }, {})).toEqual(['--quality=low', '--lockstep', '--style=toon']);
    expect(specArgs({ lockstep: true }, { HARNESS_QUERY: 'lockstep=1&arch=b' })).toEqual(['--lockstep', '--arch=b']);
  });

  it('picks the target from kit.config.json, HARNESS_TARGET overriding', () => {
    expect(targetName({ target: 'godot' }, {})).toBe('godot');
    expect(targetName({}, {})).toBe('web');
    expect(targetName({ target: 'godot' }, { HARNESS_TARGET: 'web' })).toBe('web');
    expect(() => targetName({ target: 'unity' }, {})).toThrow(/unknown target/);
  });
});
