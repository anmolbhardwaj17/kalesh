// P1-024 base test (2d): Chandni Chowk on wheels and on foot. Start: spawn pin chandni_chowk_east (--spawn), in the auto
// on the main road. The auto drives the main road westbound (route chandni_main, about 190 m) past the mouth of a gali
// and stops; F gets the player out (PlayerMode); the player walks round the back of the auto into the gali and through
// it (walk chandni_gali, a 3 m lane between building shells, about 140 m), real inputs only. city('watch') compares every wheel contact on the drive and the feet on every
// grounded tick in the gali with the drawn surface. Pass: nothing over 0.05 m off, nothing on an undrawn spot, never
// under the surface, never stuck; the streaming focus follows the player on foot (the ring stays round the walker).
// Shot city_chandni_gali_foot in the gali at the on-foot camera.
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
const res = await S.drive(r.points, { kmh: 25, label: 'Chandni Chowk main road' });
const wd = await D.city('watch', { on: false });
S.log('drive', { s: res.s, length: res.length, maxOffM: res.maxOffM, simS: res.simS });
S.log('drive watch', wd);
judge('the main road drive', wd);
// out of the auto: F, held until the player stands
D.input('enter_exit', 1);
await S.until(() => D.state().player.mode === 'foot', { sim: 6, label: 'out of the auto' });
D.input('enter_exit', 0);
await S.waitSim(0.6);
const out = D.state().player;
S.log('on foot', out);
// round the back of the parked auto (5 m behind it, on the side the player got out), to the gali's first point, then
// through it; the feet are watched from the gali's start on
const h = res.end.heading;
const fwd = [Math.sin(h), -Math.cos(h)];
const right = [Math.cos(h), Math.sin(h)];
const car = res.end.pos;
const side = Math.sign((out.pos[0] - car[0]) * right[0] + (out.pos[2] - car[2]) * right[1]) || 1;
const rear = [car[0] - fwd[0] * 5 + right[0] * side * 1.2, car[1], car[2] - fwd[1] * 5 + right[1] * side * 1.2];
const pts = [out.pos, rear, ...g.points];
const approach = Math.hypot(rear[0] - out.pos[0], rear[2] - out.pos[2]) + Math.hypot(g.points[0][0] - rear[0], g.points[0][2] - rear[2]);
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
