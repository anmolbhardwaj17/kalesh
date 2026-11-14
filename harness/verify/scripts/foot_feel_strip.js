// P2-041: frame strips of the on-foot body for the verifier's eyes: a walk, a jog, a sprint, a start from standing, a
// stop from a jog and a plant-and-turn back, each as FRAMES frames a few ticks apart, taken twice at every held tick:
// from the play camera (the on-foot camera, as the player sees it) and from a side camera level with the hips (the
// stride, the lean and the feet on the ground read best there). Input only: the keys go through the InputMap, the
// sim is held for each frame so both views show the same pose. `node harness/bin/footstrip.mjs` runs this scenario
// and lays the shots out as strips under harness/reports/foot/. Lockstep, windowed, course scene, default look.
const S = window.__sim;
const D = S.D;
const P = window.__scriptParams || {};
const FRAMES = P.frames || 12;
await D.load('course');
await S.frames(3);
await S.waitSim(0.4);
const out = {};
const info = async () => await D.foot('info');
async function strip(name, everyTicks, before) {
  await D.foot('stage', { x: -290, z: 40, h: 0 });
  await S.waitSim(0.5);
  await before();
  const rows = [];
  const t0 = D.clock().t;
  for (let k = 0; k < FRAMES; k++) {
    await D.hold({ at: t0 + (k * everyTicks) / 60 + 1e-4 });
    await S.until(() => D.hold().paused, { sim: 2, label: `hold ${name} ${k}` });
    const i = await info();
    rows.push({ t: +(D.clock().t - t0).toFixed(3), speed: +i.speed.toFixed(2), state: i.anim.state, rate: i.anim.rate, phase: i.anim.phase, lean: i.anim.lean });
    const kk = String(k).padStart(2, '0');
    await S.shot(`strip_${name}_${kk}_play`);
    const p = i.pos;
    const h = i.heading;
    // 3.4 m to the body's right, level with the hips
    const rx = Math.cos(h);
    const rz = Math.sin(h);
    D.setCamera({ pos: [p[0] + rx * 3.4, p[1] + 0.95, p[2] + rz * 3.4], target: [p[0], p[1] + 0.9, p[2]] });
    await S.frames(2);
    await S.shot(`strip_${name}_${kk}_side`);
    D.setCamera(null);
    await S.frames(1);
    await D.hold({ release: true });
    await S.until(() => !D.hold().paused, { sim: 2, label: `release ${name} ${k}` });
  }
  D.input('move_y', 0);
  D.input('walk', false);
  D.input('sprint', false);
  out[name] = rows;
  await S.waitSim(0.6);
}
// steady gaits: 1.2 s to get going, then the frames
await strip('walk', 5, async () => { D.input('walk', true); D.input('move_y', 1); await S.waitSim(1.2); });
await strip('jog', 3, async () => { D.input('move_y', 1); await S.waitSim(1.2); });
await strip('sprint', 2, async () => { D.input('sprint', true); D.input('move_y', 1); await S.waitSim(1.4); });
// a start from standing: the frames begin with the key
await strip('start', 3, async () => { D.input('move_y', 1); });
// a stop from a jog: the frames begin when the key is let go
await strip('stop', 3, async () => { D.input('move_y', 1); await S.waitSim(1.2); D.input('move_y', 0); });
// plant and turn back: jog north, then S (toward the camera)
await strip('turn', 3, async () => { D.input('move_y', 1); await S.waitSim(1.2); D.input('move_y', -1); });
S.log('strips', out);
const problems = [];
const states = (n) => out[n].map((r) => r.state);
if (!states('walk').every((s) => s === 'walk')) problems.push(`walk strip states ${states('walk')}`);
if (!states('jog').every((s) => s === 'jog')) problems.push(`jog strip states ${states('jog')}`);
if (!states('sprint').every((s) => s === 'sprint')) problems.push(`sprint strip states ${states('sprint')}`);
if (!states('start').includes('start')) problems.push(`the start strip never plays the start (${states('start')})`);
if (!states('stop').includes('stop')) problems.push(`the stop strip never plays the stop (${states('stop')})`);
if (!states('turn').includes('turn')) problems.push(`the turn strip never plays the turn (${states('turn')})`);
return problems.length ? S.failed(problems.join('; '), out) : S.ok(out);
