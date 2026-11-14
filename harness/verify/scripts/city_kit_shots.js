// P2-010: one street shot per area kit at player height (kit_<archetype>.png), the grime pair kit_wear_bazaar and
// kit_wear_lutyens (the same framing distance on a bazaar wall and a Lutyens bungalow wall; both Lutyens views stand in a
// row of bungalows west of Connaught Place with their boundary walls and neighbours, not the lone bungalow by India Gate) and kit_railings_close (a
// residential block close up: balcony railings, window grilles, roof railings, an outside stair). Each view is a
// facade bay the bake placed (tile placements, world metres): the player is teleported to the street in front of it,
// the player stands on the street behind the camera, the debug camera stands `out` metres out from the wall and `back` metres along it at eye height and looks along the
// wall. The script checks the city is ready and the buildings system drew kit modules in view, and leaves the shots to
// the verifier's eye (VERIFY.md rubric; GAME.md and DELHI_WORLD.md section 3 respect rule).
const S = window.__sim;
const D = S.D;
const P = window.__scriptParams || {};
// [name, origin x, y, z, wall normal x, z, out, back, look]
const VIEWS = P.views || [
  ['kit_colonnade', -0.6, 217.1, -1630.4, -0.27, 0.96, 7, 12, 8],
  ['kit_bazaar', 979.5, 222.9, -4317.7, 0.11, -0.99, 7, 12, 8],
  ['kit_gali', 87.8, 225.9, -4276.4, 1.0, 0.08, 1.5, 3, 14],
  ['kit_hotel', -726.0, 225.1, -2704.8, 0.98, -0.18, 5, 10, 8],
  ['kit_office', 1694.4, 210.7, -1260.5, -1.0, 0.03, 12, 14, 10],
  ['kit_lutyens', -492.5, 219.2, -2312.8, -0.04, -1.0, 9, 9, 6],
  ['kit_market', -335.3, 215.1, -976.6, 1.0, -0.01, 6, 8, 6],
  ['kit_hardware', -26.5, 223.6, -3449.0, 0.1, -0.99, 6, 10, 8],
  ['kit_wear_bazaar', 979.5, 222.9, -4317.7, 0.11, -0.99, 5, 7, 1],
  ['kit_wear_lutyens', -492.5, 219.2, -2312.8, -0.04, -1.0, 5, 7, 1],
  ['kit_railings_close', 1174.0, 226.0, -3201.0, -0.54, 0.84, 7, 7, 2, 3.0],
];
await S.until(() => D.state().world && D.state().world.ready, { sim: 30, label: 'the city ring is attached' });
const problems = [];
const out = {};
for (const v of VIEWS) {
  const [name, x, y, z, nx, nz, o, back, look, h = 1.7] = v;
  const tx = nz;
  const tz = -nx;
  // the player waits on the street behind the camera, out of the frame
  await D.teleport([x + nx * Math.min(o, 3) - tx * (back + 8), y, z + nz * Math.min(o, 3) - tz * (back + 8)]);
  await S.until(() => D.state().world.ready && D.state().world.queue.attach === 0 && D.state().world.queue.reading === 0, { sim: 20, label: `${name}: tiles attached` });
  await D.setCamera({ pos: [x + nx * o - tx * back, y + h, z + nz * o - tz * back], target: [x + tx * look, y + 2.4 + (h - 1.7) * 0.5, z + tz * look] });
  await S.waitSim(1.5);
  const b = D.state().world.buildings;
  if (!b || !(b.instances > 0)) problems.push(`${name}: no kit module drawn`);
  out[name] = b;
  await S.shot(name);
}
await D.setCamera(null);
const info = await D.stream('info');
if (info.errors && info.errors.length) problems.push(`tile errors: ${info.errors.join('; ')}`);
return problems.length ? S.failed(problems.join('; '), out) : S.ok(out);
