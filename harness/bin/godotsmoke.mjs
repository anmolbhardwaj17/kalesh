#!/usr/bin/env node
// Smoke test of the Godot debug server (docs/GAME_HOOKS.md "Godot transport").
//
//   node harness/bin/godotsmoke.mjs [--out <dir>] [--skip-nodebug] [--driver vulkan]
//   (--driver passes --rendering-driver to the engine; Metal, the macOS default, reports no GPU ms, Vulkan does)
//
// 1. Without --debug: launches the game headless with -- --debug-port=<free port> --verify and checks that nothing
//    listens on that port (nor on the default port) while the game runs.
// 2. With --debug --verify: launches the pinned Godot windowed, calls every required hook plus shot, quality, timeOfDay and quit,
//    prints each result, and checks each answers in the documented shape. Also checks the sim hold: hold({at}) pauses
//    within one physics tick of `at`, and a held sim does not move for 0.2 s of wall time while frames keep drawing.
//    And (P1-040) that a second client that connects and stops reading never stalls a frame: the game's snapshot
//    writes do not block (no frame over 50 ms in a 6 s perf window while that client's socket buffers are full).
// Writes <out>/smoke.json and <out>/smoke_shot.png (default out: harness/reports/godot). Exits 1 on any failure,
// including any ERROR line in the engine output.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchGame, freePort, portOpen } from './godotclient.mjs';
import { errorLines } from './godot.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const OUT = path.resolve(opt('--out', path.join(ROOT, 'harness', 'reports', 'godot')));
const TICK = 1 / 60;
const DRIVER = opt('--driver', '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
}
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(isNum);
const isStats = (s) => s && isNum(s.p50) && isNum(s.p95) && isNum(s.max);
const show = (label, v) => console.log(`  ${label} -> ${JSON.stringify(v).slice(0, 400)}`);
const defaultPort = () => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'harness', 'kit.config.json'), 'utf8')).godot.debugPort; } catch { return null; }
};

async function noDebugRun() {
  console.log('\n== without --debug ==');
  const port = await freePort();
  const run = await launchGame({ debug: false, headless: true, verify: true, port, quitAfter: 300, extra: [`--debug-port=${port}`] });
  // Wait until the game has booted (GameArgs prints its boot line), then probe for a while.
  const t0 = Date.now();
  while (!run.log.some((l) => l.startsWith('game: boot')) && Date.now() - t0 < 30000) await sleep(100);
  check('no-debug game booted', run.log.some((l) => l.startsWith('game: boot debug=false')), run.log.find((l) => l.startsWith('game: boot')) || 'no boot line');
  let open = false;
  for (let i = 0; i < 6 && run.proc.exitCode === null; i++) {
    if (await portOpen(port, 300)) open = true;
    const dp = defaultPort();
    if (dp && await portOpen(dp, 300)) open = true;
    await sleep(200);
  }
  check('no-debug: no port listening (asked port and default port)', !open, `port ${port}, default ${defaultPort()}`);
  check('no-debug: no debug server line in the log', !run.log.some((l) => l.startsWith('debug server:')));
  run.proc.kill();
  await run.exited;
  const errs = errorLines(run.log.join('\n'));
  check('no-debug: no ERROR lines', errs.length === 0, errs.slice(0, 3).join(' | '));
}

async function debugRun() {
  console.log('\n== with --debug --verify (windowed) ==');
  const run = await launchGame({ debug: true, verify: true, quitAfter: 12000, engineExtra: DRIVER ? ['--rendering-driver', DRIVER] : [] });
  const c = run.client;
  const results = {};
  const call = async (label, method, ...args) => {
    const r = await c.call(method, ...args);
    results[label] = r;
    show(label, r);
    return r;
  };
  check('hello received', c.hello && c.hello.protocol === 1 && Array.isArray(c.hello.methods), `port ${run.port}`);
  await c.waitSnapshot((s) => s.ready, { timeoutMs: 30000 });
  check('snapshots arrive after drawn frames', c.snapshots > 0, `${c.snapshots} so far`);

  const st = await call('state()', 'state');
  check('state shape', typeof st.scene === 'string' && st.scene === 'scaffold' && isVec3(st.player?.pos) && st.milestone === null, `scene ${st.scene}`);
  check('--verify hides the debug overlay', st.debugOverlay === false);

  const ck = await call('clock()', 'clock');
  check('clock shape', isNum(ck.t) && isNum(ck.scale) && typeof ck.paused === 'boolean');

  const f0 = c.snapshot.frame;
  const fr = await call('frames(5)', 'frames', 5);
  check('frames(5) waits 5 drawn frames', fr.frame - f0 >= 5, `frame ${f0} -> ${fr.frame}`);

  const ld = await call("load('scaffold')", 'load', 'scaffold');
  check('load resolves with the scene', ld.scene === 'scaffold');
  try { await c.call('load', 'nope'); check('load unknown id is an error response', false); } catch (e) { check('load unknown id is an error response', /unknown scene id/.test(e.message), e.message); }

  const z0 = (await c.call('state')).player.pos[2];
  await call("input('throttle', 1)", 'input', 'throttle', 1);
  await c.call('frames', 40);
  const z1 = (await c.call('state')).player.pos[2];
  check('input throttle drives the car north (-Z)', z1 < z0 - 0.2, `z ${z0.toFixed(2)} -> ${z1.toFixed(2)}`);
  await c.call('input', 'throttle', 0);
  try { await c.call('input', 'fly', 1); check('unknown action is an error response', false); } catch (e) { check('unknown action is an error response', /unknown action/.test(e.message)); }

  const tp = await call('teleport([5, 0, -20])', 'teleport', [5, 0, -20]);
  await c.call('frames', 2);
  const tpos = (await c.call('state')).player.pos;
  check('teleport puts the player there', tp === true && Math.abs(tpos[0] - 5) < 0.01 && Math.abs(tpos[2] + 20) < 0.01, JSON.stringify(tpos));
  check('teleport to an unknown anchor is false', (await c.call('teleport', 'nowhere')) === false);

  await call('setCamera(pose)', 'setCamera', { pos: [20, 8, 10], target: [5, 1, -20] });
  await c.call('frames', 2);
  const camSt = (await c.call('state')).camera;
  check('setCamera overrides the camera', camSt.override === true && Math.abs(camSt.pos[0] - 20) < 0.01, JSON.stringify(camSt.pos));
  await call('setCamera(null)', 'setCamera', null);
  await c.call('frames', 2);
  check('setCamera(null) hands back to the game camera', (await c.call('state')).camera.override === false);

  await call('timeScale(2)', 'timeScale', 2);
  check('timeScale sets clock.scale', (await c.call('clock')).scale === 2);
  await c.call('timeScale', 1);

  const hudOff = await call('hud(false)', 'hud', false);
  check('hud answers', hudOff.hud === false && isNum(hudOff.nodes));
  await c.call('hud', true);

  const q = await call('quality()', 'quality');
  check('quality reads the preset', typeof q.preset === 'string' && Array.isArray(q.presets));

  // Day clock (P1-002): state().time reads it, timeOfDay sets and pins it.
  const st0 = (await c.call('state')).time;
  check('state().time has the day clock', st0 && isNum(st0.hour) && isNum(st0.rate) && typeof st0.pinned === 'boolean', JSON.stringify(st0));
  const tod = await call('timeOfDay({hour: 18.5, pin: true})', 'timeOfDay', { hour: 18.5, pin: true });
  await c.call('frames', 5);
  const st1 = (await c.call('state')).time;
  check('timeOfDay sets and pins the hour', tod.hour === 18.5 && tod.pinned === true && st1.hour === 18.5, JSON.stringify(st1));
  try { await c.call('timeOfDay', { hour: 'noon' }); check('timeOfDay with a bad hour is an error response', false); } catch (e) { check('timeOfDay with a bad hour is an error response', /must be a number/.test(e.message)); }
  await c.call('timeOfDay', { hour: st0.hour, pin: st0.pinned });

  // Sim hold: drive, hold at t + 0.5 s, check it stops within one tick and stays still for 0.2 s of wall time.
  await c.call('load', 'scaffold');
  await c.call('input', 'throttle', 1);
  await c.call('frames', 10);
  const tNow = (await c.call('clock')).t;
  const at = Math.round((tNow + 0.5) * 1000) / 1000 + 0.004; // deliberately off a tick boundary
  const h = await call(`hold({at: ${at}})`, 'hold', { at });
  check('hold({at}) answers {paused, t, at}', h.paused === false && isNum(h.t) && h.at === at);
  const held = await c.waitSnapshot((s) => s.clock.paused, { timeoutMs: 10000 });
  const tHeld = held.clock.t;
  check('hold pauses within one physics tick of at', tHeld <= at + 1e-9 && at - tHeld < TICK + 1e-9, `at ${at}, paused at t ${tHeld.toFixed(5)} (tick ${TICK.toFixed(5)})`);
  const p1 = held.state.player.pos;
  const fA = held.frame;
  const w0 = Date.now();
  await sleep(200);
  const later = c.snapshot;
  check('held sim does not move for 0.2 s of wall time', Date.now() - w0 >= 190 && later.clock.t === tHeld && later.state.player.pos.every((v, i) => v === p1[i]),
    `t ${tHeld} -> ${later.clock.t}, pos ${JSON.stringify(p1)} -> ${JSON.stringify(later.state.player.pos)}`);
  check('frames keep drawing while held', later.frame - fA >= 3, `${later.frame - fA} frames in 0.2 s`);
  const holdEv = c.events.find((e) => e.type === 'sim:hold');
  check('hold emits a sim:hold event', !!holdEv, JSON.stringify(holdEv || null));
  const hr = await call('hold({release: true})', 'hold', { release: true });
  check('hold release resumes', hr.paused === false);
  await c.call('frames', 20);
  check('sim runs again after release', (await c.call('clock')).t > tHeld);
  await c.call('hold', { at: 9999 });
  const hc = await call('hold({cancel: true})', 'hold', { cancel: true });
  check('hold cancel clears a pending hold', hc.at === null && hc.paused === false);
  await c.call('input', 'throttle', 0);

  const ev = await call('events()', 'events');
  check('events shape', Array.isArray(ev) && ev.length > 0 && ev.every((e) => isNum(e.t) && isNum(e.w) && typeof e.type === 'string'), `${ev.length} events: ${[...new Set(ev.map((e) => e.type))].join(', ')}`);
  check('snapshot clock and hold present', c.snapshot && isNum(c.snapshot.clock.t) && 'at' in c.snapshot.hold);

  const pf = await call('perf(1000)', 'perf', 1000);
  if (DRIVER === 'vulkan') check('perf gpuMs present on Vulkan', isStats(pf.gpuMs) && pf.gpuMs.p50 > 0, JSON.stringify(pf.gpuMs || pf.gpuNote));
  check('perf shape', isStats(pf.cpuMs) && pf.cpuMs.p50 > 0 && pf.cpuMs.p50 < pf.p95FrameMs * 3 && isNum(pf.p95FrameMs) && isNum(pf.avgFps) && isNum(pf.drawCalls) && isNum(pf.triangles) && isNum(pf.gpuMB)
    && (isStats(pf.gpuMs) || typeof pf.gpuNote === 'string'), `cpu p95 ${pf.cpuMs?.p95?.toFixed(2)} ms, gpu p95 ${pf.gpuMs?.p95?.toFixed(2)} ms, ${pf.avgFps?.toFixed(1)} fps, ${pf.drawCalls} draws, ${pf.triangles} tris, ${pf.gpuMB?.toFixed(1)} MB`);

  // P1-040: a client that stops reading. A python3 client with a 2 KB receive buffer connects and never reads, so the
  // game's socket buffers for it fill within about two seconds of snapshots; a blocking write would then stall the
  // game until the client goes away. (Node cannot shrink a socket's receive buffer, and on loopback the default
  // buffers absorb several seconds of snapshots, so a paused node socket proves nothing.)
  const STALL_MS = 6000;
  const py = `import socket, sys, time
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 2048)
s.connect(("127.0.0.1", int(sys.argv[1])))
print("connected", flush=True)
time.sleep(float(sys.argv[2]))
s.close()`;
  const stall = spawn('python3', ['-c', py, String(run.port), String((STALL_MS + 1500) / 1000)], { stdio: ['ignore', 'pipe', 'pipe'] });
  const connected = await new Promise((resolve) => {
    stall.stdout.on('data', (d) => { if (String(d).includes('connected')) resolve(true); });
    stall.once('error', () => resolve(false));
    stall.once('exit', () => resolve(false));
  });
  if (!connected) check('stalled client check (needs python3)', false, 'python3 did not connect');
  else {
    await sleep(500);
    const sp = await c.call('perf', STALL_MS);
    await new Promise((resolve) => (stall.exitCode !== null ? resolve() : stall.once('exit', resolve)));
    check('a client that stops reading never stalls a frame (max frame under 50 ms)', sp.frameMs.max < 50,
      `max ${sp.frameMs.max.toFixed(1)} ms, p95 ${sp.frameMs.p95.toFixed(1)} ms over ${sp.frames} frames`);
    const f0 = c.snapshot.frame;
    await c.call('frames', 5);
    check('snapshots still arrive after the stalled client left', c.snapshot.frame >= f0 + 5, `frame ${f0} -> ${c.snapshot.frame}`);
  }

  // Shot from the chase camera behind the car at the start of the road.
  await c.call('load', 'scaffold');
  await c.call('frames', 5);
  fs.mkdirSync(OUT, { recursive: true });
  const shotPath = path.join(OUT, 'smoke_shot.png');
  fs.rmSync(shotPath, { force: true });
  const sh = await call('shot(path)', 'shot', shotPath);
  check('shot saves a PNG', fs.existsSync(shotPath) && fs.statSync(shotPath).size > 1000 && sh.width > 0 && sh.height > 0, `${sh.width}x${sh.height} ${shotPath}`);

  try { await c.call('nope'); check('unknown method is an error response', false); } catch (e) { check('unknown method is an error response', /unknown method/.test(e.message)); }

  await call('quit()', 'quit');
  const code = await Promise.race([run.exited, sleep(15000).then(() => 'timeout')]);
  check('quit ends the game with code 0', code === 0, `exit ${code}`);
  if (code === 'timeout') run.proc.kill();
  const errs = errorLines(run.log.join('\n'));
  check('no ERROR lines in the engine output', errs.length === 0, errs.slice(0, 3).join(' | '));
  const errEvents = c.events.filter((e) => e.type === 'error');
  check('no error events', errEvents.length === 0, JSON.stringify(errEvents.slice(0, 2)));
  return { results, port: run.port, args: run.args, log: run.log.slice(-40) };
}

async function main() {
  const report = { when: new Date().toISOString() };
  if (!argv.includes('--skip-nodebug')) await noDebugRun();
  report.debug = await debugRun();
  report.checks = checks;
  report.ok = checks.every((c) => c.ok);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'smoke.json'), JSON.stringify(report, null, 2));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\ngodot smoke: ${report.ok ? 'PASS' : 'FAIL'} (${checks.length - failed.length}/${checks.length} checks), report ${path.join(OUT, 'smoke.json')}`);
  return report.ok ? 0 : 1;
}

main().then((code) => process.exit(code), (e) => { console.log(`godot smoke: FAIL (${e.message})`); process.exit(1); });
