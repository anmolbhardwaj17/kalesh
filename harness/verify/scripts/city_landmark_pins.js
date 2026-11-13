// P1-024 base test (1): a known landmark lands at its projected position and on the right side of the map, in the real
// streamed city. For each pin (India Gate, the Connaught Place central park, the Red Fort, Jama Masjid, the ITO crossing,
// the New Delhi station forecourt) the game projects the place's latitude and longitude (city('geo'): the world frame of
// the tile index plus game/geo/projection.gd), the player is staged there (teleport), and the pin read from the live
// tiles (city('pins')) must lie within 5 m of that point. Then the sides: the Red Fort is north-east of India Gate and
// Connaught Place north-west (east +X, north -Z). Data: harness/data/districts/places.json.
const S = window.__sim;
const D = S.D;
const WANT = ['india_gate', 'connaught_place', 'red_fort', 'jama_masjid', 'ito_crossing', 'ndls_ajmeri_gate'];
const places = (window.__scriptData && window.__scriptData.places) || [];
const want = WANT.map((id) => places.find((p) => p.id === id)).filter(Boolean);
if (want.length !== WANT.length) return S.failed(`places.json lacks some of ${WANT.join(', ')}`);
await S.until(() => D.state().world && D.state().world.ready, { sim: 10, label: 'the city ring is attached' });
const projected = await D.city('geo', { places: want.map((p) => ({ id: p.id, lat: p.lat, lon: p.lon })) });
const problems = [];
const found = {};
for (const pr of projected) {
  const ok = await D.teleport([pr.x, 0, pr.z]);
  await S.frames(2);
  if (ok !== true) { problems.push(`teleport to ${pr.id} answered ${ok}`); continue; }
  const pins = await D.city('pins');
  const pin = pins.find((p) => p.id === pr.id);
  if (!pin) { problems.push(`no pin ${pr.id} in the live tiles (${pins.map((p) => p.id).join(', ') || 'none'})`); continue; }
  const d = Math.hypot(pin.x - pr.x, pin.z - pr.z);
  found[pr.id] = { x: pin.x, y: pin.y, z: pin.z, tile: pin.tile, projected: [pr.x, pr.z], offM: d };
  S.log(pr.id, found[pr.id]);
  if (!(d <= 5)) problems.push(`${pr.id}: the pin is ${d.toFixed(2)} m from its projected position`);
}
const ig = found.india_gate;
const rf = found.red_fort;
const cp = found.connaught_place;
if (ig && rf && !(rf.x > ig.x && rf.z < ig.z)) problems.push(`the Red Fort (${rf.x.toFixed(0)}, ${rf.z.toFixed(0)}) is not north-east of India Gate (${ig.x.toFixed(0)}, ${ig.z.toFixed(0)})`);
if (ig && cp && !(cp.x < ig.x && cp.z < ig.z)) problems.push(`Connaught Place (${cp.x.toFixed(0)}, ${cp.z.toFixed(0)}) is not north-west of India Gate`);
// the other pins: Jama Masjid lies north of India Gate and east of Connaught Place; the station north of Connaught Place
const jm = found.jama_masjid;
const nd = found.ndls_ajmeri_gate;
if (jm && ig && cp && !(jm.z < ig.z && jm.x > cp.x)) problems.push('Jama Masjid is not north of India Gate and east of Connaught Place');
if (nd && cp && !(nd.z < cp.z)) problems.push('the New Delhi station forecourt is not north of Connaught Place');
if (problems.length) return S.failed(problems.join('; '), found);
return S.ok(found);
