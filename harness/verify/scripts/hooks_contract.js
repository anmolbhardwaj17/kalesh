// Proves the game implements the hook contract (docs/GAME_HOOKS.md). Runs in the page as the body of an async function.
// Required hooks must exist and answer in the right shape; optional hooks are listed as present or missing.
const S = window.__sim;
const G = window.__game;
const D = G && G.debug;
const problems = [];
const need = (cond, what) => { if (!cond) problems.push(what); };
need(G && G.ready === true, 'window.__game.ready is true');
need(D, 'window.__game.debug exists (the page was opened with ?debug=1)');
if (!D) return S.failed(problems.join('; '));
const required = ['state', 'clock', 'frames', 'input', 'perf', 'load', 'teleport', 'setCamera', 'timeScale', 'hold', 'events', 'hud'];
const optional = ['shotProblems', 'gpuBench', 'quality', 'save'];
for (const k of required) need(typeof D[k] === 'function', `debug.${k} is a function`);
if (problems.length) return S.failed(`missing hooks: ${problems.join('; ')}`);
const st = D.state();
need(st && typeof st === 'object' && 'scene' in st, 'debug.state() returns an object with a scene');
const c0 = D.clock();
need(c0 && typeof c0.t === 'number' && typeof c0.scale === 'number' && typeof c0.paused === 'boolean', 'debug.clock() returns {t, scale, paused}');
// The sim ticks at a fixed 60 Hz while frames may draw faster (a 120 Hz display under Godot, P0-026), so a couple of
// frames can hold no tick at all: wait (a few frames, bounded) for the sim to move instead of counting frames.
await S.frames(3);
await S.until(() => D.clock().t > c0.t, { sim: 1, wallMs: 5000, label: 'sim time moves while frames run' }).catch(() => null);
need(D.clock().t > c0.t, 'sim time moves while frames run');
const h = D.hold({ at: D.clock().t + 0.2 });
await S.until(() => D.hold().paused, { sim: 2, label: 'sim hold pauses at its time' });
const held = D.clock().t;
await new Promise((r) => setTimeout(r, 150));
need(Math.abs(D.clock().t - held) < 1e-6, 'a held sim does not move');
D.hold({ release: true, cancel: true });
await S.frames(2);
await S.until(() => D.clock().t > held, { sim: 1, wallMs: 5000, label: 'a released sim moves again' }).catch(() => null);
need(D.clock().t > held, 'a released sim moves again');
const p = await D.perf(500);
need(p && p.cpuMs && typeof p.cpuMs.p95 === 'number', 'debug.perf(ms) returns cpuMs {p50, p95, max}');
need(p && typeof p.avgFps === 'number' && typeof p.drawCalls === 'number' && typeof p.triangles === 'number', 'debug.perf returns avgFps, drawCalls and triangles');
need(Array.isArray(D.events()), 'debug.events() returns an array');
S.log('optional hooks', optional.map((k) => `${k}:${typeof D[k] === 'function' ? 'yes' : 'no'}`).join(' '));
return problems.length ? S.failed(problems.join('; ')) : S.ok({ perf: { cpuP95: p.cpuMs.p95, fps: p.avgFps, drawCalls: p.drawCalls }, optional: optional.filter((k) => typeof D[k] === 'function') });
