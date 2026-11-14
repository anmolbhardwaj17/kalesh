// P2-063: shot sheets of the three lead models for the verifier's eyes, input only, in the course scene. For each lead
// (the player's body dressed as that lead, foot('dress')): standing front, side and back from 3 m (the play level of
// the mesh), a close-up of the head and chest from 0.9 m (the full mesh), a walk and a jog from the play camera and
// from a side camera level with the hips (feet and hands mid-stride), and for Bittu and Danny the seated driving pose
// (the library's Driving clip, the stand-in for the auto seat and the scooter ride). The sim is held for every shot.
// `node harness/bin/leadsheet.mjs` runs this scenario and lays the shots out under harness/reports/leads/.
const S = window.__sim;
const D = S.D;
const P = window.__scriptParams || {};
const LEADS = P.leads || ['bittu', 'meera', 'danny'];
await D.load('course');
await S.frames(3);
await S.waitSim(0.4);
const out = {};
const problems = [];
const info = async () => await D.foot('info');
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
// a camera `dist` m from the body along its forward (f), right (r) or back, at height `y`, looking at height `ty`
async function view(name, i, dir, dist, y, ty) {
  const p = i.pos;
  const h = i.heading;
  const f = [Math.sin(h), -Math.cos(h)];
  const r = [Math.cos(h), Math.sin(h)];
  const d = { front: f, back: [-f[0], -f[1]], side: r, three: [(f[0] + r[0]) * 0.7071, (f[1] + r[1]) * 0.7071] }[dir];
  D.setCamera({ pos: [p[0] + d[0] * dist, p[1] + y, p[2] + d[1] * dist], target: [p[0], p[1] + ty, p[2]] });
  await S.frames(3);
  await S.shot(name);
}
for (const id of LEADS) {
  const dressed = await D.foot('dress', { look: id });
  await D.foot('stage', { x: -290, z: 40, h: 0 });
  await S.waitSim(1.0);
  await hold();
  let i = await info();
  out[id] = { model: i.anim.model, scale: i.anim.scale, headY: i.headY, state: i.anim.state };
  if (i.anim.look !== id) problems.push(`${id}: the body is dressed as ${i.anim.look}`);
  if (i.anim.model !== 'lead') problems.push(`${id}: drawn on the ${i.anim.model}, not its own model`);
  await view(`lead_${id}_front`, i, 'front', 3.0, 1.0, 0.88);
  await view(`lead_${id}_side`, i, 'side', 3.0, 1.0, 0.88);
  await view(`lead_${id}_back`, i, 'back', 3.0, 1.0, 0.88);
  await view(`lead_${id}_three`, i, 'three', 3.0, 1.0, 0.88);
  await view(`lead_${id}_close`, i, 'front', 0.95, 1.5, 1.45);
  await view(`lead_${id}_hands`, i, 'three', 1.1, 1.0, 0.85);
  await release();
  // walk and jog, input only
  for (const [gait, keys, wait] of [['walk', { walk: true }, 1.6], ['jog', {}, 1.3]]) {
    await D.foot('stage', { x: -290, z: 40, h: 0 });
    await S.waitSim(0.5);
    if (keys.walk) D.input('walk', true);
    D.input('move_y', 1);
    await S.waitSim(wait);
    await hold();
    i = await info();
    out[id][gait] = { state: i.anim.state, rate: i.anim.rate, speed: +i.speed.toFixed(2) };
    if (i.anim.state !== gait) problems.push(`${id}: plays ${i.anim.state} at the ${gait}`);
    await S.shot(`lead_${id}_${gait}_play`);
    await view(`lead_${id}_${gait}_side`, i, 'side', 3.2, 0.95, 0.9);
    await release();
    D.input('move_y', 0);
    D.input('walk', false);
    await S.waitSim(0.8);
  }
  if (id === 'bittu' || id === 'danny') {
    await D.foot('stage', { x: -290, z: 40, h: 0 });
    await S.waitSim(0.5);
    await D.foot('dress', { look: id, pose: 'drive' });
    await S.waitSim(0.8);
    await hold();
    i = await info();
    out[id].drive = { state: i.anim.state, clip: i.anim.clip };
    if (i.anim.state !== 'drive') problems.push(`${id}: the drive pose plays ${i.anim.state}`);
    await view(`lead_${id}_drive_side`, i, 'side', 2.6, 0.9, 0.7);
    await view(`lead_${id}_drive_three`, i, 'three', 2.2, 1.2, 0.75);
    await release();
    await D.foot('dress', { look: id });
  }
  if (!dressed || dressed.look !== id) problems.push(`${id}: dress answered ${JSON.stringify(dressed)}`);
}
await D.foot('dress', { look: 'bittu' });
S.log('leads', out);
return problems.length ? S.failed(problems.join('; '), out) : S.ok(out);
