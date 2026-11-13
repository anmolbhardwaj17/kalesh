// P1-024 base test (3): north is up on the map and -Z in the world, in the real city. From the default start (the auto
// stand on Janpath) the auto drives 230 m north up Janpath with real inputs and stops: shot city_cp_radial_eye at the
// play camera. Then:
//  - the port of coords_north_marker: a camera over the stop, 3 m up, looking along -Z, must see the Connaught Place
//    park centre (due north) in the centre third of the frame, the New Delhi station (north-north-east) right of it and
//    Karol Bagh (west-north-west) in the left half (city('screen') of the places the game's projection puts there);
//  - a debug top view straight down on Connaught Place has north up: the station is above the park centre, Jantar
//    Mantar (south-south-west) below and left, Agrasen ki Baoli (south-east) below and right. Shots city_north_marker
//    and city_north_up.
// Data: harness/data/fixtures/city_routes.json (fd0) and harness/data/districts/places.json.
const S = window.__sim;
const D = S.D;
const data = window.__scriptData || {};
const route = data.routes && data.routes.routes && data.routes.routes.fd0 && data.routes.routes.fd0.points;
const places = (data.places && data.places.places) || [];
if (!route || !places.length) return S.failed('needs data {routes: city_routes.json, places: places.json}');
await S.until(() => D.state().world && D.state().world.ready, { sim: 10, label: 'the city ring is attached' });
// the first 230 m of the FD0 route: Janpath, still south of the inner circle
const path = S.pathOf(route);
const part = [route[0]];
for (let i = 1; i < route.length && path.cum[i] < 230; i++) part.push(route[i]);
const res = await S.drive(part, { kmh: 30, label: 'Janpath' });
await S.waitSim(1);
await S.shot('city_cp_radial_eye');
const p = D.state().player;
S.log('stopped on Janpath', { s: res.s, pos: p.pos, heading: p.heading });
const ids = ['connaught_place', 'ndls_ajmeri_gate', 'karol_bagh_metro', 'jantar_mantar', 'agrasen_ki_baoli'];
const geo = await D.city('geo', { places: ids.map((id) => places.find((q) => q.id === id)).map((q) => ({ id: q.id, lat: q.lat, lon: q.lon })) });
const at = Object.fromEntries(geo.map((g) => [g.id, g]));
const gy = p.pos[1];
const problems = [];
// the port of coords_north_marker: look north (-Z) from 3 m over the stop
D.setCamera({ pos: [p.pos[0], gy + 3, p.pos[2]], target: [p.pos[0], gy + 3, p.pos[2] - 100] });
await S.frames(3);
const look = D.state().camera;
if (!(look.override && look.dir[2] < -0.99)) problems.push(`the marker camera does not look along -Z (dir ${JSON.stringify(look.dir)})`);
const m = await D.city('screen', { points: ['connaught_place', 'ndls_ajmeri_gate', 'karol_bagh_metro'].map((id) => [at[id].x, gy, at[id].z]) });
const [w] = m.size;
const [cp, nd, kb] = m.points;
S.log('marker view', { size: m.size, cp, nd, kb });
if (!(cp.front && cp.x > w / 3 && cp.x < (2 * w) / 3)) problems.push(`looking north, the Connaught Place centre is not in the centre third (x ${cp.x.toFixed(0)} of ${w}, front ${cp.front})`);
if (!(nd.front && nd.x > cp.x)) problems.push(`looking north, the station (north-north-east) is not right of Connaught Place (${nd.x.toFixed(0)} against ${cp.x.toFixed(0)})`);
if (!(kb.front && kb.x < w / 2)) problems.push(`looking north, Karol Bagh (west-north-west) is not in the left half (x ${kb.x.toFixed(0)})`);
await S.shot('city_north_marker');
// the top view: straight down on the park centre (the debug camera's up is -Z when it looks straight down)
const c = at.connaught_place;
D.setCamera({ pos: [c.x, gy + 700, c.z], target: [c.x, gy, c.z] });
await S.frames(3);
const top = D.state().camera;
if (!(top.override && top.dir[1] < -0.999)) problems.push(`the top view does not look straight down (dir ${JSON.stringify(top.dir)})`);
const t = await D.city('screen', { points: ['connaught_place', 'ndls_ajmeri_gate', 'jantar_mantar', 'agrasen_ki_baoli'].map((id) => [at[id].x, gy, at[id].z]) });
const [tc, tn, tj, ta] = t.points;
S.log('top view', { size: t.size, tc, tn, tj, ta });
if (!(Math.abs(tc.x - t.size[0] / 2) < 2 && Math.abs(tc.y - t.size[1] / 2) < 2)) problems.push(`the park centre is not at the middle of the top view (${tc.x.toFixed(0)}, ${tc.y.toFixed(0)})`);
if (!(tn.y < tc.y)) problems.push(`top view: the station (north) is not above the park (y ${tn.y.toFixed(0)} against ${tc.y.toFixed(0)})`);
if (!(tj.y > tc.y && tj.x < tc.x)) problems.push(`top view: Jantar Mantar (south-south-west) is not below and left of the park (${tj.x.toFixed(0)}, ${tj.y.toFixed(0)})`);
if (!(ta.y > tc.y && ta.x > tc.x)) problems.push(`top view: Agrasen ki Baoli (south-east) is not below and right of the park (${ta.x.toFixed(0)}, ${ta.y.toFixed(0)})`);
await S.shot('city_north_up');
D.setCamera(null);
await S.frames(2);
if (problems.length) return S.failed(problems.join('; '), { at });
return S.ok({ stop: p.pos, marker: { cp, nd, kb }, top: { tc, tn, tj, ta } });
