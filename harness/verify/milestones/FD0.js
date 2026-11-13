// FD0 free drive in the real city (P1-024): the game boots into the streamed pilot centre with the player in an auto at
// the auto stand on Janpath, south of Connaught Place. The script drives about 320 m north along Janpath (a CP radial)
// into the inner circle, rounds a quarter of it clockwise to its west side and stops. Real inputs only (steer and
// throttle once a frame, window.__sim.drive), waits in sim time. Route: harness/data/fixtures/city_routes.json fd0
// (tools/fixtures/gen_city_routes.mjs), the milestone's `data`.
const S = window.__sim;
const D = S.D;
const data = window.__scriptData;
if (!data || !data.routes || !data.routes.fd0) return S.failed('no route data (milestones.json FD0 data: harness/data/fixtures/city_routes.json)');
const route = data.routes.fd0.points;
await S.until(() => D.state().world && D.state().world.ready, { sim: 10, label: 'the city ring is attached' });
const st0 = D.state();
S.log('start', { scene: st0.scene, spawn: st0.world.spawn, player: st0.player });
if (st0.scene !== 'city') return S.failed(`the game did not boot into the city scene (scene ${st0.scene})`);
if (st0.world.spawn.pin !== 'cp_auto_stand') return S.failed(`the start is not the default pin (spawn ${JSON.stringify(st0.world.spawn)})`);
if (st0.player.mode !== 'vehicle') return S.failed(`the player does not start in the auto (mode ${st0.player.mode})`);
const start = st0.player.pos;
if (Math.hypot(start[0] - route[0][0], start[2] - route[0][2]) > 2) return S.failed(`the auto starts ${Math.hypot(start[0] - route[0][0], start[2] - route[0][2]).toFixed(1)} m from the route start`);
await S.shot('FD0_ready');
// The inner circle's centre (the Connaught Place central park, places.json): the circle beat is judged against it.
const centre = [-331.4, -1739];
let radialShot = false;
let circleShot = false;
let onCircle = 0;
let grounded = 0;
let frames = 0;
const res = await S.drive(route, {
  kmh: 32,
  label: 'FD0',
  onFrame: async (f) => {
    frames += 1;
    if (D.state().player.grounded) grounded += 1;
    const r = Math.hypot(f.pos[0] - centre[0], f.pos[2] - centre[1]);
    if (r < 140) onCircle += 1;
    if (!radialShot && f.s > 300) {
      radialShot = true;
      S.log('beat 1: 300 m along Janpath', f);
      await S.shot('FD0_radial');
    }
    if (!circleShot && r < 140 && f.pos[0] < centre[0] - 60) {
      circleShot = true;
      S.log('beat 2: on the inner circle', { ...f, r });
      await S.shot('FD0_circle');
    }
  },
});
const end = res.end;
S.log('beat 3: stopped', { res: { s: res.s, length: res.length, maxOffM: res.maxOffM, simS: res.simS }, end });
await S.shot('FD0_stopped');
const problems = [];
const along = Math.hypot(end.pos[0] - start[0], end.pos[2] - start[2]);
if (!radialShot) problems.push('never reached 300 m along Janpath');
if (!circleShot) problems.push('never rounded the inner circle to its west side');
if (!(res.s > res.length - 3)) problems.push(`stopped ${(res.length - res.s).toFixed(1)} m short of the end`);
if (!(Math.abs(end.speed) < 0.3)) problems.push(`not stopped: ${end.speed.toFixed(2)} m/s`);
if (!(end.pos[0] < centre[0] - 100)) problems.push(`the stop is not on the west side of the circle (x ${end.pos[0].toFixed(1)})`);
if (grounded < frames * 0.98) problems.push(`grounded in only ${grounded} of ${frames} frames`);
if (res.maxOffM > 4) problems.push(`left the route by ${res.maxOffM.toFixed(1)} m`);
if (problems.length) return S.failed(problems.join('; '), { res, end });
return S.ok({ simSeconds: res.simS, routeM: res.length, crowM: along, maxOffM: res.maxOffM, circleFrames: onCircle, end: end.pos });
