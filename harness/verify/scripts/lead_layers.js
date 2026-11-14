// P2-072: the layers over each lead's Mixamo locomotion, in shots for the eye, input only, course scene. Per lead (the
// player dressed as that lead, foot('dress')): standing with the pistol aim and the chest aimed 30 degrees left, walking
// while on the phone, walking while texting, standing carrying, a wave, a head flinch at its peak. foot('layer') drives
// the layers the way a weapon, phone or hit system will. Checks the asked action is the one playing. The sim is held
// for every shot. `node harness/bin/mixamostrip.mjs --layers --draw` lays them out (harness/reports/leads/mixamo_layers.png).
const S = window.__sim;
const D = S.D;
const P = window.__scriptParams || {};
const LEADS = P.leads || ['bittu', 'meera', 'danny'];
await D.load('course');
await S.frames(3);
await S.waitSim(0.4);
const out = {};
const problems = [];
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
async function view(name, i, dir, dist, y, ty) {
  const p = i.pos;
  const h = i.heading;
  const f = [Math.sin(h), -Math.cos(h)];
  const r = [Math.cos(h), Math.sin(h)];
  const d = { front: f, back: [-f[0], -f[1]], side: r, three: [(f[0] + r[0]) * 0.7071, (f[1] + r[1]) * 0.7071], back3: [(-f[0] + r[0]) * 0.7071, (-f[1] + r[1]) * 0.7071] }[dir];
  D.setCamera({ pos: [p[0] + d[0] * dist, p[1] + y, p[2] + d[1] * dist], target: [p[0], p[1] + ty, p[2]] });
  await S.frames(3);
  await S.shot(name);
}
// [name, layer opts, walk seconds (0 standing), wait, view, check]
const SHOTS = [
  ['pistol', { upper: 'pistol', aim: [30, 5] }, 0, 0.8, 'three', (a) => a.layers.upper === 'pistol' && a.layers.aim[0] > 0.4],
  ['phone', { upper: 'phone', aim: false }, 1.6, 0, 'side', (a) => a.layers.upper === 'phone' && a.state === 'walk'],
  ['text', { upper: 'text' }, 1.6, 0, 'three', (a) => a.layers.upper === 'text' && a.state === 'walk'],
  ['carry', { upper: 'carry' }, 0, 0.6, 'three', (a) => a.layers.upper === 'carry'],
  ['wave', { upper: 'wave' }, 0, 0.9, 'front', (a) => a.layers.upper === 'wave'],
  ['flinch', { upper: '', flinch: 'head' }, 0, 0.12, 'side', (a) => a.layers.flinchAmount > 0.3],
];
for (const id of LEADS) {
  out[id] = {};
  await D.foot('dress', { look: id });
  for (const [name, opts, walk, wait, dir, check] of SHOTS) {
    await D.foot('stage', { x: -290, z: 40, h: 0 });
    await S.waitSim(0.6);
    await D.foot('layer', opts);
    if (walk > 0) {
      D.input('walk', true);
      D.input('move_y', 1);
      await S.waitSim(walk);
    } else {
      await S.waitSim(wait);
    }
    await hold();
    const i = await D.foot('info');
    out[id][name] = { state: i.anim.state, layers: i.anim.layers };
    if (!check(i.anim)) problems.push(`${id} ${name}: ${JSON.stringify(i.anim.layers)} state ${i.anim.state}`);
    await view(`lead_${id}_layer_${name}`, i, dir, 2.6, 1.0, 0.95);
    await release();
    D.input('move_y', 0);
    D.input('walk', false);
  }
  await D.foot('layer', { upper: '', aim: false });
  await S.waitSim(0.5);
}
await D.foot('dress', { look: 'bittu' });
S.log('layers', out);
return problems.length ? S.failed(problems.join('; '), out) : S.ok(out);
