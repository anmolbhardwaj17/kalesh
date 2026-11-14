// P1-024 base test (2d): Chandni Chowk on wheels and on foot. Start: spawn pin chandni_chowk_east (--spawn), in the auto
// on Netaji Subhash Marg south of the Red Fort end (P2-045: the main road is car-free in the day, so the auto keeps off
// it). The auto drives north and west along the lane south of Chandni Chowk (route chandni_main, about 190 m) and stops
// 12 m short of a two-wheeler gali's mouth; F gets the player out (PlayerMode); the player walks past the auto's side,
// up the gali (3 m, between building shells) onto Chandni Chowk main road and along it (walk chandni_gali, about 190 m,
// never through a line of bollards), real inputs only. city('watch') compares every wheel contact on the drive and the
// feet on every grounded tick of the walk with the drawn surface. Pass: nothing over 0.05 m off, nothing on an undrawn
// spot, never under the surface, never stuck; the streaming focus follows the player on foot (the ring stays round the
// walker). Shot city_chandni_gali_foot in the gali at the on-foot camera.
const S = window.__sim;
const D = S.D;
const data = window.__scriptData || {};
const r = data.routes && data.routes.chandni_main;
const g = data.walks && data.walks.chandni_gali;
if (!r || !g) return S.failed('needs city_routes.json');
await S.until(() => D.state().world && D.state().world.ready, { sim: 10, label: 'the city ring is attached' });
if (D.state().world.spawn.pin !== 'chandni_chowk_east') return S.failed(`started at ${D.state().world.spawn.pin}, not chandni_chowk_east`);
const problems = [];
const judge = (what, w) => {
  if (!(w.samples > 50)) problems.push(`${what}: only ${w.samples} contacts watched`);
  if (w.over > 0) problems.push(`${what}: ${w.over} contacts over 0.05 m off the drawn surface (worst ${w.maxGapM.toFixed(3)} m at ${JSON.stringify(w.worst)})`);
  if (w.undrawn > 0) problems.push(`${what}: ${w.undrawn} contacts where nothing is drawn`);
  if (w.fallTicks > 0) problems.push(`${what}: under the drawn surface for ${w.fallTicks} ticks (${JSON.stringify(w.fall)})`);
};
await D.city('watch', { on: true });
const res = await S.drive(r.points, { kmh: 25, label: 'Netaji Subhash Marg and the lane south of Chandni Chowk' });
const wd = await D.city('watch', { on: false });
S.log('drive', { s: res.s, length: res.length, maxOffM: res.maxOffM, simS: res.simS });
S.log('drive watch', wd);
judge('the drive', wd);
// out of the auto: F, held until the player stands
D.input('enter_exit', 1);
await S.until(() => D.state().player.mode === 'foot', { sim: 6, label: 'out of the auto' });
D.input('enter_exit', 0);
await S.waitSim(0.6);
const out = D.state().player;
S.log('on foot', out);
// past the side of the parked auto the player got out on (3.5 m ahead of its centre), to the walk's first point 12 m
// ahead of it, then up the gali; the feet are watched from the walk's start on
const h = res.end.heading;
const fwd = [Math.sin(h), -Math.cos(h)];
const right = [Math.cos(h), Math.sin(h)];
const car = res.end.pos;
const side = Math.sign((out.pos[0] - car[0]) * right[0] + (out.pos[2] - car[2]) * right[1]) || 1;
const pass = [car[0] + fwd[0] * 3.5 + right[0] * side * 1.1, car[1], car[2] + fwd[1] * 3.5 + right[1] * side * 1.1];
const pts = [out.pos, pass, ...g.points];
const approach = Math.hypot(pass[0] - out.pos[0], pass[2] - out.pos[2]) + Math.hypot(g.points[0][0] - pass[0], g.points[0][2] - pass[2]);
let watching = false;
let shot = false;
let maxRingM = 0;
const walked = await S.walk(pts, {
  gait: 'jog',
  label: 'gali walk',
  onFrame: async (f) => {
    if (!watching && f.s >= approach) { watching = true; await D.city('watch', { on: true }); }
    if (!shot && f.s >= approach + 60) { shot = true; S.log('in the gali', f); await S.shot('city_chandni_gali_foot'); }
    const fc = (await D.stream('info')).focus;
    maxRingM = Math.max(maxRingM, Math.hypot(fc[0] - f.pos[0], fc[2] - f.pos[2]));
  },
});
const wf = await D.city('watch', { on: false });
S.log('walk', { s: walked.s, length: walked.length, maxOffM: walked.maxOffM, simS: walked.simS, maxRingM });
S.log('walk watch', wf);
judge('the gali walk', wf);
if (!shot) problems.push('never reached the middle of the gali');
if (maxRingM > 5) problems.push(`the streaming focus was ${maxRingM.toFixed(1)} m from the walker (it should follow the player on foot)`);
if (D.state().player.mode !== 'foot') problems.push(`the player is not on foot at the end (${D.state().player.mode})`);
if (problems.length) return S.failed(problems.join('; '), { wd, wf });
return S.ok({ driveM: res.length, walkM: walked.length, drive: wd, walk: wf, maxRingM });
