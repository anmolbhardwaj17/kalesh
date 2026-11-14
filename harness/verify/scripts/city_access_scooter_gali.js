// P2-042: a scooter rides from a lane open to cars into a gali that only two-wheelers, cycles and walkers may use (no
// barrier: a car there is a violation, not a wall). Start: spawn pin gali_scooter_entry (--spawn), on the scooter. The
// scooter drives the route gali_scooter (real inputs, a 90 degree turn into the 3 m gali) to the gali's far end. Pass:
// the drive ends (never stuck, never over 3 m off the route) and the scooter stands in the gali, at rest, upright.
// Shot city_access_scooter_gali at the chase camera.
const S = window.__sim;
const D = S.D;
const data = window.__scriptData || {};
const r = data.routes && data.routes.gali_scooter;
if (!r) return S.failed('needs city_routes.json with routes.gali_scooter (node tools/fixtures/gen_city_routes.mjs)');
await S.until(() => D.state().world && D.state().world.ready, { sim: 10, label: 'the city ring is attached' });
if (D.state().world.spawn.pin !== 'gali_scooter_entry') return S.failed(`started at ${D.state().world.spawn.pin}, not gali_scooter_entry`);
let shot = false;
const res = await S.drive(r.points, {
  kmh: 15, minKmh: 7, lookM: 4, maxOffM: 3, label: 'into the gali',
  onFrame: async (f) => { if (!shot && f.left < 40) { shot = true; await S.shot('city_access_scooter_gali'); } },
});
await S.waitSim(1);
const p = D.state().player;
const info = await D.vehicle('info');
const end = r.points[r.points.length - 1];
const left = Math.hypot(end[0] - p.pos[0], end[2] - p.pos[2]);
S.log('end', { res: { s: res.s, length: res.length, maxOffM: res.maxOffM, simS: res.simS }, pos: p.pos, info: { tune: info.tune && info.tune.id, kmh: info.kmh, contacts: info.contacts } });
const problems = [];
if (left > 4) problems.push(`the scooter stopped ${left.toFixed(1)} m from the gali's end`);
if (Math.abs(p.speed) > 0.3) problems.push(`the scooter still moves (${p.speed.toFixed(2)} m/s)`);
const tuneId = info.tune && typeof info.tune === 'object' ? info.tune.id : info.tune;
if (tuneId !== 'scooter') problems.push(`the player rides ${tuneId}, not the scooter`);
if (!p.grounded) problems.push('the scooter is not on its wheels at the end');
if (problems.length) return S.failed(problems.join('; '));
return S.ok({ rodeM: Math.round(res.length), maxOffM: res.maxOffM, simS: res.simS });
