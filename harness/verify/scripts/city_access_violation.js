// P2-045: a car driven into a gali closed to cars where no bollards stand (closed by width and context, P2-042) is a
// violation, not a wall: the game raises exactly one access_violation event (docs/GAME_HOOKS.md events, state().world
// .access), the hook of the later police and wanted level. Start: spawn pin gali_car_entry (--spawn), in the car on a
// lane open to cars. The car drives the route gali_car (real inputs, the turn into the gali the scooter test rides) about
// 25 m into the gali and stops there. Pass: one access_violation with the gali's piece, mode car, the position of the
// entry and no barrier near; none before the turn; state().world.access agrees; the car never stuck. Shot
// city_access_violation at the chase camera.
const S = window.__sim;
const D = S.D;
const data = window.__scriptData || {};
const r = data.routes && data.routes.gali_car;
if (!r) return S.failed('needs city_routes.json with routes.gali_car (node tools/fixtures/gen_city_routes.mjs)');
await S.until(() => D.state().world && D.state().world.ready, { sim: 10, label: 'the city ring is attached' });
if (D.state().world.spawn.pin !== 'gali_car_entry') return S.failed(`started at ${D.state().world.spawn.pin}, not gali_car_entry`);
const t0 = D.clock().t;
const seen = () => D.events().filter((e) => e.type === 'access_violation' && e.t >= t0);
let beforeTurn = -1;
let shot = false;
const res = await S.drive(r.points, {
  kmh: 12, minKmh: 6, lookM: 4, maxOffM: 3, label: 'into the gali',
  onFrame: async (f) => {
    if (beforeTurn < 0 && f.s >= r.entryM - 6) beforeTurn = seen().length;
    if (!shot && f.left < 8) { shot = true; await S.shot('city_access_violation'); }
  },
});
await S.waitSim(1.5);
const ev = seen();
const acc = D.state().world.access;
const p = D.state().player;
S.log('drive', { s: res.s, length: res.length, maxOffM: res.maxOffM, simS: res.simS, entryM: r.entryM });
S.log('events', ev.map((e) => ({ t: e.t, data: e.data })));
S.log('access', acc);
const problems = [];
if (beforeTurn !== 0) problems.push(`${beforeTurn} access_violation events before the car reached the gali`);
if (ev.length !== 1) problems.push(`${ev.length} access_violation events, not exactly one`);
const d = ev[0] && ev[0].data;
if (d) {
  if (d.mode !== 'car') problems.push(`the event's mode is ${d.mode}, not car`);
  if (!Array.isArray(d.modes) || d.modes.includes('car')) problems.push(`the event's piece ${d.piece} is open to cars (${d.modes})`);
  if (!Array.isArray(d.pos) || d.pos.length !== 3) problems.push('the event has no position');
  else {
    const off = Math.hypot(d.pos[0] - r.entry[0], d.pos[2] - r.entry[2]);
    if (off > 8) problems.push(`the event was raised ${off.toFixed(1)} m from the gali's entry`);
  }
  if (d.barrier) problems.push('the event says a barrier stands near (this gali has none)');
}
if (!acc || acc.violations !== 1 || !acc.inside) problems.push(`state().world.access says ${JSON.stringify(acc)}`);
if (res.s < res.length - 4) problems.push(`the car stopped ${(res.length - res.s).toFixed(1)} m short of the route's end`);
if (!p.grounded) problems.push('the car is not on its wheels at the end');
if (problems.length) return S.failed(problems.join('; '));
return S.ok({ event: d, droveM: Math.round(res.length), simS: res.simS });
