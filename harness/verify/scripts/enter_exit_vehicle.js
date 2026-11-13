// P1-022: getting out of the car and back in with F (the enter_exit action), in the course scene where the player starts
// in the car. Each switch takes under 2 s of sim, ends with the right camera (the on-foot camera on foot, the chase
// camera driving) and state().player.mode says which; after the exit the character stands clear of the car and the
// world (no overlap). A second round starts on foot 2 m from the car's door, so getting in includes the walk to it.
// Input only; only the second round's start is staged. Lockstep, windowed (four named shots).
const S = window.__sim;
const D = S.D;
await D.load('course');
await S.frames(3);
await S.waitSim(1.0);
const st = () => D.state().player;
const problems = [];
const out = {};
if (st().mode !== 'vehicle') problems.push(`the course starts with mode ${st().mode} (want vehicle)`);
const car0 = st().pos;
// out
let t = D.clock().t;
await S.press('enter_exit', 1, 0.1);
await S.until(() => st().mode === 'foot', { sim: 4, label: 'on foot after F' });
out.exitS = D.clock().t - t;
await S.waitSim(0.3);
let info = await D.foot('info');
out.exitInfo = { side: info.lastSwitch.side, s: info.lastSwitch.s, camera: info.camera.current, overlap: info.overlap, pos: info.pos };
await S.shot('exit_on_foot');
if (info.camera.current !== 'foot') problems.push(`after the exit the camera is ${info.camera.current} (want foot)`);
if (info.overlap) problems.push('the character overlaps the car or the world after the exit');
const gap = Math.hypot(info.pos[0] - car0[0], info.pos[2] - car0[2]);
if (!(gap > 1.0 && gap < 2.5)) problems.push(`the character stands ${gap.toFixed(2)} m from the car (want beside its door)`);
if (!(out.exitS < 2)) problems.push(`getting out took ${out.exitS.toFixed(2)} s (want under 2)`);
// back in
t = D.clock().t;
await S.press('enter_exit', 1, 0.1);
await S.until(() => st().mode === 'vehicle', { sim: 4, label: 'driving after F' });
out.enterS = D.clock().t - t;
await S.waitSim(0.3);
info = await D.foot('info');
out.enterInfo = { s: info.lastSwitch.s, camera: info.camera.current };
await S.shot('enter_driving');
if (info.camera.current !== 'chase') problems.push(`after getting in the camera is ${info.camera.current} (want chase)`);
if (!(out.enterS < 2)) problems.push(`getting in took ${out.enterS.toFixed(2)} s (want under 2)`);
// the car drives again
D.input('throttle', 1);
await S.waitSim(1.0);
D.input('throttle', 0);
const moved = st().pos;
if (!(car0[2] - moved[2] > 1)) problems.push(`the car did not drive after getting back in (z ${car0[2].toFixed(2)} to ${moved[2].toFixed(2)})`);
D.input('brake', 1);
await S.until(() => Math.abs(st().speed) < 0.3, { sim: 6, label: 'the car stops' });
D.input('brake', 0);
await S.waitSim(0.5);
// round two: out, then staged 2 m from the right door, walk to it and get in
await S.press('enter_exit', 1, 0.1);
await S.until(() => st().mode === 'foot', { sim: 4, label: 'on foot again' });
const p = D.state().player.pos;
await D.foot('stage', { x: p[0] + 2.0, z: p[2] + 0.5, h: -90 });
await S.waitSim(0.2);
await S.shot('walk_to_door');
t = D.clock().t;
await S.press('enter_exit', 1, 0.1);
await S.until(() => st().mode === 'vehicle', { sim: 4, label: 'in after the walk to the door' });
out.walkEnterS = D.clock().t - t;
info = await D.foot('info');
if (info.camera.current !== 'chase') problems.push(`after the walk in the camera is ${info.camera.current}`);
if (!(out.walkEnterS < 2)) problems.push(`walking 2 m to the door and getting in took ${out.walkEnterS.toFixed(2)} s (want under 2)`);
await S.waitSim(0.3);
await S.shot('walk_enter_driving');
S.log('enter and exit', out);
return problems.length ? S.failed(problems.join('; '), out) : S.ok({ exitS: out.exitS, enterS: out.enterS, walkEnterS: out.walkEnterS, side: out.exitInfo.side });
