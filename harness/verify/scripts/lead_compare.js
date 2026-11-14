// P2-063: side by sides of the painted stand-in mannequin and each lead's own model in the same pose, input only,
// course scene. For each lead, first as the stand-in (foot('dress', {standin: true})), then on its model: idle after
// 1 s, a walk after 1.6 s and a jog after 1.3 s from the same staging, each from behind (2.6 m, chest height) and from
// the side (3 m), sim held. The same staging and timing give the same frame of each clip, so the two bodies can be
// compared joint by joint (shoulders, clavicles, arm hang and swing, head size). `node harness/bin/leadsheet.mjs
// --compare` lays them out under harness/reports/leads/compare_<id>.png.
const S = window.__sim;
const D = S.D;
await D.load('course');
await S.frames(3);
await S.waitSim(0.4);
const out = {};
async function hold() {
  await D.hold({ at: D.clock().t + 1e-4 });
  await S.until(() => D.hold().paused, { sim: 2, label: 'hold' });
}
async function release() {
  D.setCamera(null);
  await S.frames(1);
  await D.hold({ release: true });
  await S.until(() => !D.hold().paused, { sim: 2, label: 'release' });
}
async function views(name) {
  const i = await D.foot('info');
  const p = i.pos;
  const h = i.heading;
  const f = [Math.sin(h), -Math.cos(h)];
  const r = [Math.cos(h), Math.sin(h)];
  D.setCamera({ pos: [p[0] - f[0] * 2.6, p[1] + 1.35, p[2] - f[1] * 2.6], target: [p[0], p[1] + 1.0, p[2]] });
  await S.frames(3);
  await S.shot(`${name}_back`);
  D.setCamera({ pos: [p[0] + r[0] * 3.0, p[1] + 1.0, p[2] + r[1] * 3.0], target: [p[0], p[1] + 0.9, p[2]] });
  await S.frames(3);
  await S.shot(`${name}_side`);
  return i.anim;
}
for (const look of ['bittu', 'meera', 'danny']) {
  for (const standin of [true, false]) {
    const tag = `cmp_${look}_${standin ? 'standin' : 'model'}`;
    await D.foot('dress', { look, standin });
    out[tag] = {};
    for (const [move, keys, wait] of [['idle', null, 1.0], ['walk', { walk: true }, 1.6], ['jog', {}, 1.3]]) {
      await D.foot('stage', { x: -290, z: 40, h: 0 });
      await S.waitSim(0.5);
      if (keys) {
        if (keys.walk) D.input('walk', true);
        D.input('move_y', 1);
      }
      await S.waitSim(wait);
      await hold();
      const a = await views(`${tag}_${move}`);
      out[tag][move] = { state: a.state, model: a.model, phase: a.phase };
      await release();
      D.input('move_y', 0);
      D.input('walk', false);
      await S.waitSim(0.8);
    }
  }
}
await D.foot('dress', { look: 'bittu' });
S.log('compare', out);
return S.ok(out);
