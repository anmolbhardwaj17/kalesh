// P1-024 base test (2b): wheels stay on the drawn surface over the Ring Road flyover near ITO. The game starts at the
// spawn pin ito_flyover_south (--spawn) in the auto; it drives the route ito_flyover (city_routes.json: up the south
// ramp, over the deck about 7 m up, down the north ramp, 650 m) with real inputs, while city('watch') compares every wheel
// contact of every tick with the nearest drawn height there. Pass: no contact over 0.05 m off the drawn surface, no
// contact where nothing is drawn, never under the drawn surface (fell through), never stuck (S.drive). Shot
// city_ito_flyover_eye on the deck at the play camera.
const S = window.__sim;
const D = S.D;
const data = window.__scriptData || {};
const r = data.routes && data.routes.ito_flyover;
if (!r) return S.failed('needs city_routes.json');
await S.until(() => D.state().world && D.state().world.ready, { sim: 10, label: 'the city ring is attached' });
const sp = D.state().world.spawn;
if (sp.pin !== 'ito_flyover_south') return S.failed(`started at ${sp.pin}, not ito_flyover_south (scenario query spawn=)`);
const deckY = r.yRange[1];
await D.city('watch', { on: true });
let shot = false;
let topY = -Infinity;
const res = await S.drive(r.points, {
  kmh: 45,
  label: 'ITO flyover',
  onFrame: async (f) => {
    topY = Math.max(topY, f.pos[1]);
    if (!shot && f.pos[1] > deckY - 0.4 && f.speed > 5) { shot = true; S.log('on the deck', f); await S.shot('city_ito_flyover_eye'); }
  },
});
const w = await D.city('watch', { on: false });
S.log('drive', { s: res.s, length: res.length, maxOffM: res.maxOffM, simS: res.simS, topY });
S.log('watch', w);
const problems = [];
if (!shot) problems.push(`never on the deck (highest ${topY.toFixed(2)} m, deck ${deckY.toFixed(2)} m)`);
if (!(w.samples > 100)) problems.push(`only ${w.samples} wheel contacts watched`);
if (w.over > 0) problems.push(`${w.over} wheel contacts over 0.05 m off the drawn surface (worst ${w.maxGapM.toFixed(3)} m at ${JSON.stringify(w.worst)})`);
if (w.undrawn > 0) problems.push(`${w.undrawn} wheel contacts where nothing is drawn`);
if (w.fallTicks > 0) problems.push(`under the drawn surface for ${w.fallTicks} ticks (${JSON.stringify(w.fall)})`);
if (problems.length) return S.failed(problems.join('; '), { res, w });
return S.ok({ lengthM: res.length, simS: res.simS, topY, watch: w });
