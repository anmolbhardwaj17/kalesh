// P1-024 shot: India Gate from the road into its hexagon at the play camera. Start: spawn pin rajpath_india_gate
// (--spawn), in the auto on the road from the south-west into the hexagon, north-eastbound (P2-045: Kartavya Path is a
// promenade closed to cars, the pin left it). The auto drives the route rajpath (about 160 m, real inputs) and stops at
// the hexagon road; India Gate (its pin from the live tiles) must be in front of the play camera, in the middle half of
// the frame. Shot city_india_gate_hexagon.
const S = window.__sim;
const D = S.D;
const data = window.__scriptData || {};
const r = data.routes && data.routes.rajpath;
if (!r) return S.failed('needs city_routes.json');
await S.until(() => D.state().world && D.state().world.ready, { sim: 10, label: 'the city ring is attached' });
if (D.state().world.spawn.pin !== 'rajpath_india_gate') return S.failed(`started at ${D.state().world.spawn.pin}, not rajpath_india_gate`);
const res = await S.drive(r.points, { kmh: 30, label: 'the road into the hexagon' });
await S.waitSim(1.5);
const pins = await D.city('pins');
const ig = pins.find((p) => p.id === 'india_gate');
if (!ig) return S.failed(`no India Gate pin in the live tiles (${pins.map((p) => p.id).join(', ')})`);
const sc = await D.city('screen', { points: [[ig.x, ig.y + 20, ig.z]] });
const at = sc.points[0];
S.log('stopped', { s: res.s, pos: res.end.pos, india_gate: ig, screen: at, size: sc.size });
await S.shot('city_india_gate_hexagon');
if (!(at.front && at.x > sc.size[0] / 4 && at.x < (3 * sc.size[0]) / 4)) return S.failed(`India Gate is not in the middle half of the play camera (x ${at.x.toFixed(0)} of ${sc.size[0]}, front ${at.front})`);
return S.ok({ stop: res.end.pos, indiaGate: at });
