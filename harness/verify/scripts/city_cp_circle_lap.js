// P1-024 base test (2c): wheels stay on the drawn surface round a lap of the Connaught Place inner circle. Start: spawn
// pin cp_inner_circle (--spawn), on the circle's south side, clockwise. The auto drives the route cp_lap (city_routes.json,
// about 760 m, back to its own start) with real inputs, while city('watch') compares every wheel contact with the drawn
// surface. Pass: the lap closes (back within 3 m, a full clockwise turn of the heading), no contact over 0.05 m off the
// drawn surface or on nothing drawn, never under it, never stuck.
const S = window.__sim;
const D = S.D;
const data = window.__scriptData || {};
const r = data.routes && data.routes.cp_lap;
if (!r) return S.failed('needs city_routes.json');
await S.until(() => D.state().world && D.state().world.ready, { sim: 10, label: 'the city ring is attached' });
const st0 = D.state();
if (st0.world.spawn.pin !== 'cp_inner_circle') return S.failed(`started at ${st0.world.spawn.pin}, not cp_inner_circle (scenario query spawn=)`);
await D.city('watch', { on: true });
let turned = 0;
let lastH = st0.player.heading;
const res = await S.drive(r.points, {
  kmh: 30,
  label: 'CP inner circle',
  onFrame: async (f) => {
    let d = f.heading - lastH;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    turned += d;
    lastH = f.heading;
  },
});
const w = await D.city('watch', { on: false });
const end = res.end.pos;
const start = r.points[0];
const gap = Math.hypot(end[0] - start[0], end[2] - start[2]);
S.log('lap', { s: res.s, length: res.length, maxOffM: res.maxOffM, simS: res.simS, turnedDeg: (turned * 180) / Math.PI, gap });
S.log('watch', w);
const problems = [];
if (!(gap < 3)) problems.push(`the lap ends ${gap.toFixed(1)} m from its start`);
if (!(turned > 1.8 * Math.PI)) problems.push(`the heading turned ${((turned * 180) / Math.PI).toFixed(0)} degrees, not a clockwise lap`);
if (!(w.samples > 100)) problems.push(`only ${w.samples} wheel contacts watched`);
if (w.over > 0) problems.push(`${w.over} wheel contacts over 0.05 m off the drawn surface (worst ${w.maxGapM.toFixed(3)} m at ${JSON.stringify(w.worst)})`);
if (w.undrawn > 0) problems.push(`${w.undrawn} wheel contacts where nothing is drawn`);
if (w.fallTicks > 0) problems.push(`under the drawn surface for ${w.fallTicks} ticks (${JSON.stringify(w.fall)})`);
if (problems.length) return S.failed(problems.join('; '), { res, w });
return S.ok({ lengthM: res.length, simS: res.simS, turnedDeg: (turned * 180) / Math.PI, watch: w });
