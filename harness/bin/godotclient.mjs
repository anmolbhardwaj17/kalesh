// Client for the Godot debug server (game/debug/debug_server.gd, docs/GAME_HOOKS.md "Godot transport").
// TCP on 127.0.0.1, newline-delimited JSON. Requests carry an id; responses answer it. After every drawn frame the
// game pushes a snapshot (state, clock, hold, new events), so the synchronous hooks (state, clock, hold, events) can
// be answered from the latest snapshot without a round trip.
//
//   import { launchGame, GodotDebugClient } from './godotclient.mjs';
//   const game = await launchGame({ debug: true, verify: true });   // spawns the pinned Godot, connects
//   await game.client.call('frames', 3);
//   game.client.snapshot.state.player.pos
//   await game.client.call('quit'); await game.exited;
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveGodot, godotConfig, stripAnsi, startFocusGuard, windowArgs, windowEnv, startWindowHider } from './godot.mjs';

const ROOT = process.env.HARNESS_ROOT
  ? path.resolve(process.env.HARNESS_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Splits a byte stream into lines. Returns push(chunk) that calls onLine(text) for each complete line. */
export function lineSplitter(onLine) {
  let buf = '';
  return (chunk) => {
    buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let i = buf.indexOf('\n');
    while (i >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (line.trim()) onLine(line);
      i = buf.indexOf('\n');
    }
  };
}

/** A free TCP port on 127.0.0.1 (the OS picks one). */
export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** True when something accepts a TCP connection on 127.0.0.1:port within timeoutMs. */
export function portOpen(port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

export class GodotDebugClient {
  constructor() {
    this.nextId = 1;
    this.pending = new Map();
    this.hello = null;
    this.snapshot = null;
    this.snapshots = 0;
    this.events = [];          // every event seen in snapshots (the harness-side ring)
    this.listeners = new Set(); // called with each snapshot
    this.closed = false;
  }

  /** Connects, retrying until the game listens or timeoutMs passes; resolves with the hello message. */
  async connect(port, { timeoutMs = 30000 } = {}) {
    const until = Date.now() + timeoutMs;
    let lastErr = null;
    while (Date.now() < until) {
      try {
        await this.#open(port);
        const hello = await this.#waitHello(Math.max(1000, until - Date.now()));
        return hello;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    throw new Error(`could not connect to the Godot debug server on 127.0.0.1:${port} (${lastErr?.message || 'timeout'})`);
  }

  #open(port) {
    return new Promise((resolve, reject) => {
      const sock = net.connect({ host: '127.0.0.1', port });
      sock.setNoDelay(true);
      sock.once('connect', () => { this.sock = sock; this.closed = false; resolve(); });
      sock.once('error', reject);
      sock.on('error', () => {}); // after connect, a reset shows up as 'close' (pending calls reject there)
      sock.on('data', lineSplitter((line) => this.#onLine(line)));
      sock.on('close', () => {
        if (sock !== this.sock) return;
        this.closed = true;
        for (const p of this.pending.values()) p.reject(new Error(`connection closed before ${p.method} answered`));
        this.pending.clear();
      });
    });
  }

  #waitHello(ms) {
    if (this.hello) return Promise.resolve(this.hello);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no hello from the game')), ms);
      this.onHello = (h) => { clearTimeout(t); resolve(h); };
    });
  }

  #onLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.type === 'hello') { this.hello = msg; this.onHello?.(msg); return; }
    if (msg.type === 'snapshot') {
      this.snapshot = msg;
      this.snapshots += 1;
      for (const e of msg.events || []) this.events.push(e);
      if (this.events.length > 1000) this.events.splice(0, this.events.length - 1000);
      for (const f of this.listeners) f(msg);
      return;
    }
    if (msg.type === 'response') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(Object.assign(new Error(`${p.method}: ${msg.error}`), { hookError: msg.error }));
    }
  }

  /** Calls a hook; resolves with its result or rejects with the game's error text. */
  call(method, ...args) {
    if (!this.sock || this.closed) return Promise.reject(new Error('not connected'));
    const id = this.nextId++;
    const timeoutMs = method === 'perf' ? Number(args[0] || 1000) + 30000 : 60000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, method, timer });
      this.sock.write(JSON.stringify({ id, method, args }) + '\n');
    });
  }

  /** Resolves with the first snapshot (from now on) for which pred(snapshot) is true. */
  waitSnapshot(pred, { timeoutMs = 10000 } = {}) {
    return new Promise((resolve, reject) => {
      const f = (s) => { if (pred(s)) { cleanup(); resolve(s); } };
      const t = setTimeout(() => { cleanup(); reject(new Error(`no matching snapshot in ${timeoutMs} ms`)); }, timeoutMs);
      const cleanup = () => { clearTimeout(t); this.listeners.delete(f); };
      this.listeners.add(f);
    });
  }

  close() { this.sock?.destroy(); }
}

/** The engine and user args for a game run. Engine args go before `--`, game args after it. */
export function gameArgs({ project, exported = false, debug = true, verify = true, port, quitAfter = 7200, resolution = '1280x720',
  headless = false, extra = [], engineExtra = [], env = process.env } = {}) {
  // An exported app (HARNESS_EXPORTED_APP) carries its own project: no --path.
  const engine = [...(exported ? [] : ['--path', project]), '--quit-after', String(quitAfter), ...engineExtra];
  if (headless) engine.unshift('--headless');
  else {
    if (resolution) engine.push('--resolution', resolution);
    engine.push(...windowArgs(env, engineExtra));
  }
  const user = [];
  if (debug) user.push('--debug');
  if (port) user.push(`--debug-port=${port}`);
  if (verify) user.push('--verify');
  user.push(...extra);
  return [...engine, '--', ...user];
}

/**
 * Launches the pinned Godot on game/ and, with debug, connects the client.
 * Returns { proc, port, client, log, exited } (exited resolves with the exit code; log holds the engine output lines).
 * quitAfter (frames) is a safety net so a stuck run always ends.
 */
export async function launchGame(opts = {}) {
  // opts.binary (a path from an earlier resolveGodot) skips the lookup: resolveGodot runs `godot --version` with
  // spawnSync, which blocks this process while other runs it drives are talking to their games.
  // HARNESS_EXPORTED_APP=<executable inside the exported app or exe> runs every harness game launch on that build
  // (harness/bin/export.mjs smoke): the build's own project instead of `--path game`.
  const exportedBin = process.env.HARNESS_EXPORTED_APP || '';
  const g = exportedBin ? { path: exportedBin, cfg: godotConfig() }
    : opts.binary ? { path: opts.binary, cfg: godotConfig() } : await resolveGodot({ allowDownload: true });
  const project = path.join(ROOT, g.cfg.project);
  const port = opts.port || await freePort();
  const args = gameArgs({ ...opts, project, port, exported: !!exportedBin });
  const windowed = !opts.headless;
  const proc = spawn(g.path, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: windowed ? windowEnv() : process.env });
  // A windowed run stays off the owner's screen (godot.mjs "Windowed runs stay off the owner's screen").
  if (windowed) startWindowHider(proc);
  // A windowed run must not take keyboard focus from the terminal (macOS): see startFocusGuard in godot.mjs.
  if (!opts.headless && !opts.keepFocus) startFocusGuard(proc);
  const log = [];
  const onOut = lineSplitter((l) => { log.push(stripAnsi(l)); opts.onLog?.(stripAnsi(l)); });
  proc.stdout.on('data', onOut);
  proc.stderr.on('data', onOut);
  const run = { proc, port, args, log, exited: null, exitSignal: null, client: null, binary: g.path };
  // exitSignal names the signal of a run that was killed or crashed (SIGABRT, SIGSEGV), so a crash is told from a quit.
  const exited = new Promise((resolve) => proc.on('exit', (code, signal) => { run.exitSignal = signal || null; resolve(code ?? (signal ? 1 : 0)); }));
  run.exited = exited;
  if (opts.debug === false) return run;
  const client = new GodotDebugClient();
  try {
    await Promise.race([
      client.connect(port, { timeoutMs: opts.connectTimeoutMs || 60000 }),
      exited.then((code) => { throw new Error(`the game exited (code ${code}) before the debug server answered`); }),
    ]);
  } catch (e) {
    proc.kill();
    throw new Error(`${e.message}\n${log.slice(-20).join('\n')}`);
  }
  run.client = client;
  return run;
}
