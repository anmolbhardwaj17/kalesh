// P1-028: the look follows the day clock live inside a loaded scene. The scene (params.scene, default `street`, the
// stand-in arterial with sodium lamps, shops, traffic and lit windows; `city` for the streamed city) is loaded at 17:00
// with the clock pinned, then the clock runs 17:00 to 20:00 at a fast rate (0.1 game hours per sim second, 30 s of
// sim). Checks, from state().time.live (style_runner.gd live_state): the style is never built again (builds the same),
// it relights many times, the light goes from golden (night 0, few windows) to night (night over 0.9, half the windows,
// the street's night lights on), and the main-thread work of one relight stays small. The GPU cost while the light
// changes is measured with the ballast method (harness/bin/ballast.mjs, the same calibration and cost maths, done here
// so the window falls inside the change): p95 at most 12 ms (perf_budgets.json look scenes, fail). Two held shots for
// the verifier and the progress album: relight_<scene>_golden (17:45) and relight_<scene>_night (20:00).
const S = window.__sim;
const D = S.D;
const P = window.__scriptParams || {};
const SCENE = P.scene || 'street';
const RATE = 0.1;
const FAIL_MS = 12;
const problems = [];
const out = { scene: SCENE };
const live = () => (D.state().time || {}).live || {};
const hourNow = () => (D.state().time || {}).hour;

await D.timeOfDay({ hour: 17, pin: true });
await D.load(SCENE);
await S.until(() => D.state().scene === SCENE, { sim: 20, label: `scene ${SCENE}` });
await S.frames(5);
await S.waitSim(0.5);
if (SCENE === 'city') await S.until(() => D.state().world && D.state().world.ready, { sim: 30, label: 'city ring ready' });
const l0 = live();
out.start = { hour: hourNow(), lookHour: D.state().time.lookHour, ...l0 };
if (!l0.live) problems.push(`the look does not relight live: ${JSON.stringify(l0)}`);

// ballast size (ballast.mjs calibrateBallast and nextBallastSize: a frame with no 3D takes 12 to 20 ms)
const next = (n, f) => {
  if (!(f > 0)) return Math.round(n * 1.5);
  if (f < 12) return Math.round(n * Math.min(3, Math.max(1.5, 15 / f)));
  if (f > 20) return Math.max(1, Math.round(n * (15 / f)));
  return null;
};
let n = 1200;
await D.bench('blank', { on: true });
try {
  for (let i = 0; i < 6; i++) {
    await D.bench('ballast', { n });
    await D.perf(300);
    const nn = next(n, (await D.perf(700)).frameMs?.p50);
    if (nn == null) break;
    n = nn;
  }
} finally {
  await D.bench('ballast', { n: 0 });
  await D.bench('blank', { on: false });
}

async function held(name) {
  await D.hold({ at: D.clock().t });
  await S.until(() => D.hold().paused, { sim: 1, label: `hold for ${name}` });
  await S.frames(3);
  const t = D.state().time;
  await S.shot(name);
  await D.hold({ release: true });
  return { hour: t.hour, lookHour: t.lookHour, ...t.live };
}

// the clock runs: 17:00 to 20:00 in 30 s of sim
await D.timeOfDay({ rate: RATE, pin: false });
await S.until(() => hourNow() >= 17.75, { sim: 12, label: 'golden hour 17:45' });
out.golden = await held(`relight_${SCENE}_golden`);
if (out.golden.night >= 0.2) problems.push(`17:45 is already night (${out.golden.night})`);
if (out.golden.nightLightsOn > 0) problems.push(`${out.golden.nightLightsOn} night lights on at 17:45`);

// the GPU cost during the change, ballast on (17:50 to about 18:55: the street lights and shop lights come on, the sky
// goes to dusk)
await D.bench('ballast', { n });
let busy;
try {
  await D.perf(300);
  busy = await D.perf(10000);
} finally {
  await D.bench('ballast', { n: 0 });
}
out.windowEndHour = hourNow();

await S.until(() => hourNow() >= 20.0, { sim: 25, label: 'night 20:00' });
out.night = await held(`relight_${SCENE}_night`);
await D.timeOfDay({ rate: 0, pin: true });

// the ballast alone (3D off) for the frame cost on drivers with no GPU timer
let blank;
await D.bench('blank', { on: true });
try {
  await D.bench('ballast', { n });
  await D.perf(400);
  blank = await D.perf(1200);
} finally {
  await D.bench('ballast', { n: 0 });
  await D.bench('blank', { on: false });
}
const gpuP95 = busy?.gpuMs?.p95;
const costP95 = busy?.frameMs?.p95 != null && blank?.frameMs?.p95 != null ? busy.frameMs.p95 - blank.frameMs.p95 : null;
const ms = gpuP95 > 0 ? gpuP95 : costP95;
out.perf = {
  n, source: gpuP95 > 0 ? 'ballast-gpu' : 'ballast-frame', p95: ms != null ? Math.round(ms * 100) / 100 : null,
  gpuP50: busy?.gpuMs?.p50 ?? null, ballastFrameP95: busy?.frameMs?.p95 ?? null, ballastFrameMax: busy?.frameMs?.max ?? null,
  blankFrameP95: blank?.frameMs?.p95 ?? null, drawCalls: busy?.drawCalls ?? null,
};
if (ms == null) problems.push('no GPU time and no frame times from the ballast window');
else if (ms > FAIL_MS) problems.push(`GPU p95 ${ms.toFixed(2)} ms during the change (fail over ${FAIL_MS} ms)`);

const g = out.golden;
const nt = out.night;
if (nt.builds !== l0.builds) problems.push(`the style was built again during the change (${l0.builds} to ${nt.builds})`);
if (!(nt.relights - l0.relights >= 20)) problems.push(`only ${nt.relights - l0.relights} live relights from 17:00 to 20:00`);
if (!(nt.night >= 0.9)) problems.push(`20:00 is not night: night ${nt.night}`);
if (!(Math.abs(nt.lookHour - nt.hour) < 0.05)) problems.push(`the look (${nt.lookHour}) is behind the clock (${nt.hour})`);
if (!(nt.windowShare >= 0.5 && g.windowShare < 0.1)) problems.push(`window share ${g.windowShare} at 17:45 and ${nt.windowShare} at 20:00`);
if (SCENE !== 'city' && !(nt.nightLightsOn >= 10)) problems.push(`only ${nt.nightLightsOn} of ${nt.nightLights} night lights on at 20:00`);
if (!(nt.tickMsMaxRunning <= 4)) problems.push(`one frame of live relight work took ${nt.tickMsMaxRunning} ms on the main thread (over 4 ms)`);
return problems.length ? S.failed(problems.join('; '), out) : S.ok(out);
