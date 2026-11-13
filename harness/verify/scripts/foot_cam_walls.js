// P1-022: the on-foot camera over a 20 s route in the course scene's camera yard, played with the move keys and the look
// stick only (the start is staged). The route: jog into a lane 2 m wide between 3 m walls, turn the camera hard while
// running in it (the body slides along the wall), out into the walled court, along its north wall with the wall on the
// camera's shoulder side, then face away from the north west corner and back into it (S runs toward the camera, so the
// camera is pushed into the corner), turn the camera a full circle there, then crouch behind a 1.0 m wall with the
// camera looking over it (the wall fades). The probe foot('camrec') checks every
// drawn frame: the camera stays 0.6 m or more from the head, a 0.1 m sphere at the camera never touches geometry, the
// head stays in the frame, and the player is never hidden (some ray from the camera to the head, chest or hips is clear
// or passes only faded walls), and the low wall fades. Seven named shots. Lockstep: one tick per frame.
const S = window.__sim;
const D = S.D;
await D.load('course');
await S.frames(3);
await D.foot('stage', { x: -272, z: -194, h: 0 });
const st = () => D.state();
const pos = () => st().player.pos;
const camYaw = () => { const d = st().camera.dir; return Math.atan2(d[0], -d[2]); };
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// the look stick turns the camera toward a point; with W held the body runs where the camera looks
const aim = (x, z, gain = 2.5) => {
  const p = pos();
  const e = wrap(Math.atan2(x - p[0], -(z - p[2])) - camYaw());
  D.input('look_x', Math.max(-1, Math.min(1, e * gain)));
  return e;
};
const t0 = D.clock().t;
await D.foot('camrec', { on: true });
await S.waitSim(0.3);
await S.shot('foot_cam_open');
D.input('move_y', 1);
await S.until(() => { aim(-272, -209); return pos()[2] < -203; }, { sim: 6, label: 'into the 2 m lane' });
await S.shot('foot_cam_lane_in');
await S.until(() => { aim(-272, -209); return pos()[2] < -207; }, { sim: 4, label: 'mid lane' });
// a hard camera turn while running in the lane
D.input('look_x', 1);
await S.waitSim(0.45);
await S.shot('foot_cam_lane_turn');
await S.until(() => { aim(-272, -219); return pos()[2] < -217.5; }, { sim: 8, label: 'out of the lane' });
await S.until(() => { aim(-272, -230.9); return pos()[2] < -229.8; }, { sim: 6, label: 'to the north wall' });
await S.until(() => { aim(-280.5, -230.9); return pos()[0] < -276.5; }, { sim: 6, label: 'along the north wall' });
await S.shot('foot_cam_wall_side');
await S.until(() => { aim(-280.5, -230.9); return pos()[0] < -279.5; }, { sim: 4, label: 'near the corner' });
D.input('move_y', 0);
// face away from the corner (the camera looks south east), then run back toward the camera into the corner
await S.until(() => { const e = wrap(Math.PI * 0.75 - camYaw()); D.input('look_x', Math.max(-1, Math.min(1, e * 2.5))); return Math.abs(e) < 0.03; }, { sim: 4, label: 'camera faces south east' });
D.input('look_x', 0);
D.input('move_y', -1);
await S.waitSim(1.4);
await S.shot('foot_cam_corner_back');
const corner = pos();
await S.waitSim(0.5);
D.input('move_y', 0);
// a full circle of the camera in the corner
D.input('look_x', 1);
await S.waitSim(1.0);
await S.shot('foot_cam_corner_turn');
await S.waitSim(1.1);
D.input('look_x', 0);
// to the 1.0 m wall in the court, face north over it and crouch: the wall stands between the camera and the hips
D.input('move_y', 1);
await S.until(() => { aim(-266, -222.75); const p = pos(); return Math.hypot(p[0] + 266, p[2] + 222.75) < 0.35; }, { sim: 10, label: 'to the low wall' });
D.input('move_y', 0);
await S.until(() => { const e = wrap(0 - camYaw()); D.input('look_x', Math.max(-1, Math.min(1, e * 2.5))); return Math.abs(e) < 0.03; }, { sim: 4, label: 'camera faces north over the low wall' });
D.input('look_x', 0);
await S.press('crouch', 1, 0.1);
await S.waitSim(1.0);
await S.shot('foot_cam_low_wall');
const crouched = (await D.foot('info')).crouched;
await S.press('crouch', 1, 0.1);
await S.until(() => D.clock().t - t0 >= 20, { sim: 20, label: 'the rest of 20 s' });
const r = await D.foot('camrec', { on: false });
const info = await D.foot('info');
S.log('camera record', r);
S.log('corner', corner, 'end', info.pos, 'mode', st().player.mode);
const problems = [];
if (!(r.footFrames >= 1100)) problems.push(`only ${r.footFrames} on-foot frames recorded`);
if (!(r.minHeadM >= 0.6)) problems.push(`the camera came ${r.minHeadM.toFixed(3)} m from the head (want 0.6 or more)`);
if (r.insideFrames) problems.push(`the camera was inside geometry on ${r.insideFrames} frames: ${JSON.stringify(r.worst.slice(0, 3))}`);
if (r.hiddenFrames) problems.push(`the player was hidden on ${r.hiddenFrames} frames: ${JSON.stringify(r.worst.slice(0, 3))}`);
if (r.outOfFrame) problems.push(`the head left the frame on ${r.outOfFrame} frames: ${JSON.stringify(r.worst.slice(0, 3))}`);
if (!(Math.hypot(corner[0] + 282, corner[2] + 232) < 1.0)) problems.push(`the player did not back into the corner (at ${corner.map((v) => v.toFixed(2))})`);
if (st().player.mode !== 'foot') problems.push(`state().player.mode is ${st().player.mode}`);
if (!crouched) problems.push('the player did not crouch behind the low wall');
if (!(r.fadedFrames > 0)) problems.push('no wall faded on the whole route (the low wall stands between the camera and the hips)');
return problems.length ? S.failed(problems.join('; '), r) : S.ok({ footFrames: r.footFrames, minHeadM: r.minHeadM, liftedFrames: r.liftedFrames, maxLift: r.maxLift, fadedFrames: r.fadedFrames, simS: D.clock().t - t0 });
