// P1-020: the chase camera over a 20 s drive in the course scene. The car starts on the flyover lane facing north with a
// 3 m wall 12.6 m behind it, reverses into the wall and pushes against it, then drives north at full throttle up the 6 percent
// ramp and over its crest (the ramp top, where the car hops) onto the deck. The probe vehicle('camrec') checks every drawn frame: the camera stays 0.5 m or more
// above the vehicle, is not inside geometry and has no wall between it and the vehicle. Six named shots. Input only: the
// script steers like a driver keeping the lane (x 100); only the start is staged (teleport).
// P1-021: the step's data ({id}, harness/data/fixtures/vehicle_<id>.json) picks the vehicle (vehicle('use')); its shots
// are named <id>_cam_*. No data: the car.
const S = window.__sim;
const D = S.D;
const id = (window.__scriptData && window.__scriptData.id) || 'car';
const pre = id === 'car' ? '' : `${id}_`;
await D.load('course');
await S.frames(3);
if (id !== 'car') await D.vehicle('use', { id });
await D.teleport([100, 0, 130]);
await S.frames(3);
const st = () => D.state().player;
// keep the lane with a light hand: back to x 100 and heading 0
const keepLane = () => {
  const p = st();
  const s = Math.max(-1, Math.min(1, -0.12 * (p.pos[0] - 100) - 2.5 * p.heading));
  D.input('steer', p.speed < -0.5 ? -s : s);
};
const t0 = D.clock().t;
await D.vehicle('camrec', { on: true });
await S.waitSim(0.5);
await S.shot(`${pre}cam_start`);
D.input('throttle', -1);
await S.waitSim(1.2);
await S.shot(`${pre}cam_reverse`);
await S.until(() => { const p = st(); return p.pos[2] > 141.8 && Math.abs(p.speed) < 0.6; }, { sim: 6, label: 'reversed into the wall' });
await S.waitSim(0.6);
await S.shot(`${pre}cam_wall`);
const atWall = st();
D.input('throttle', 0);
D.input('steer', 0);
await S.waitSim(0.4);
D.input('throttle', 1);
const shots = [['cam_ramp', -80], ['cam_crest', -152], ['cam_deck', -185]];
for (const [name, z] of shots) {
  await S.until(() => { keepLane(); return st().pos[2] < z; }, { sim: 40, label: `reached z ${z}` });
  await S.shot(`${pre}${name}`);
}
const drive = st();
await S.until(() => { keepLane(); return D.clock().t - t0 >= 20; }, { sim: 20, label: 'the rest of 20 s' });
D.input('throttle', 0);
D.input('steer', 0);
const r = await D.vehicle('camrec', { on: false });
S.log('camera record', r);
S.log('at the wall', atWall, 'on the deck', drive);
const problems = [];
if (!(r.frames >= 1100)) problems.push(`only ${r.frames} frames recorded`);
if (!(r.minAboveM >= 0.5)) problems.push(`the camera came ${r.minAboveM.toFixed(3)} m above the vehicle (want 0.5 or more)`);
if (r.insideFrames) problems.push(`the camera was inside geometry on ${r.insideFrames} frames: ${JSON.stringify(r.worst.slice(0, 3))}`);
if (r.blockedFrames) problems.push(`a wall stood between the vehicle and the camera on ${r.blockedFrames} frames: ${JSON.stringify(r.worst.slice(0, 3))}`);
if (!(atWall.pos[2] > 141.8)) problems.push(`the car did not reach the wall (z ${atWall.pos[2].toFixed(2)})`);
if ((await D.vehicle('info')).tune.id !== id) problems.push(`the player vehicle is not the ${id}`);
if (!(drive.pos[1] > 3)) problems.push(`the car was not on the flyover deck at the last shot (y ${drive.pos[1].toFixed(2)})`);
return problems.length ? S.failed(problems.join('; '), r) : S.ok({ frames: r.frames, minAboveM: r.minAboveM, minDistM: r.minDistM, simS: D.clock().t - t0 });
