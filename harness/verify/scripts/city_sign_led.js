// P2-048 fix round 3: a short frame sequence of lit sign boards at night (signs_led_seq_0..2.png, about 0.2 s of sim
// apart), so the verifier can see the running borders of the lit vertical boards move and a loose tube flicker
// (surface_b.gdshaderinc, the lit vertical group). Same view rule as city_kit_shots.js: a facade bay the bake placed,
// the camera `out` metres out from the wall and `back` metres along it at eye height.
const S = window.__sim;
const D = S.D;
const P = window.__scriptParams || {};
// [name, origin x, y, z, wall normal x, z, out, back, look, eye height]
const V = P.view || ['signs_led_seq', -726.0, 225.1, -2704.8, 0.98, -0.18, 4.5, 7, 3];
await S.until(() => D.state().world && D.state().world.ready, { sim: 30, label: 'the city ring is attached' });
const [name, x, y, z, nx, nz, o, back, look, h = 1.7] = V;
const tx = nz;
const tz = -nx;
await D.teleport([x + nx * Math.min(o, 3) - tx * (back + 8), y, z + nz * Math.min(o, 3) - tz * (back + 8)]);
await S.until(() => D.state().world.ready && D.state().world.queue.attach === 0 && D.state().world.queue.reading === 0, { sim: 20, label: `${name}: tiles attached` });
await D.setCamera({ pos: [x + nx * o - tx * back, y + h, z + nz * o - tz * back], target: [x + tx * look, y + (P.lookUp ?? 2.4) + (h - 1.7) * 0.5, z + tz * look] });
await S.waitSim(1.5);
const b = D.state().world.buildings;
for (let i = 0; i < (P.frames || 3); i++) {
  await S.shot(`${name}_${i}`);
  // (sim time and drawn frames both: on a loaded machine a short sim wait can pass with no new frame drawn)
  await S.waitSim(P.gap || 0.2);
  await D.frames(3);
}
await D.setCamera(null);
if (!b || !(b.instances > 0)) return S.failed(`${name}: no kit module drawn`, b);
return S.ok({ buildings: b, night: D.state().time });
