// P2-032: a drive through every car tunnel and underpass of the pilot (tunnel_routes.json from
// tools/fixtures/gen_tunnel_routes.mjs: from 70 m before a mouth a lane enters, through the tunnel, 60 m past the last
// mouth). Each route is staged with teleport [x, y, z, heading] at its start (staging only: this is a scenario, not a
// milestone play script) and driven with real inputs (S.drive), while city('watch') compares every wheel contact with
// the drawn surface and tests the body box against the colliders (a wall or the ceiling, bodyTicks). Pass: every
// route finished, no wheel contact over 0.05 m off the drawn surface, none where nothing is drawn, never under it,
// never a body touch on a wall or a ceiling. Params: {kmh (50; 25 in a box under 6.6 m wide), vehicle ('car'),
// only: [route ids], shots: true}
// (shots: one eye shot inside the first Pragati Maidan route).
const S = window.__sim;
const D = S.D;
const data = window.__scriptData || {};
const params = window.__scriptParams || {};
const all = data.routes || {};
const ids = (params.only || Object.keys(all)).filter((id) => all[id]);
if (!ids.length) return S.failed('needs tunnel_routes.json with routes');
await S.until(() => D.state().world && D.state().world.ready, { sim: 10, label: 'the city ring is attached' });
// the car (the widest body of the player's vehicles), staged: the body box test is the strictest with it
await D.vehicle('use', { id: params.vehicle || 'car' });
const results = [];
const problems = [];
let shot = false;
for (const id of ids) {
  const r = all[id];
  const p0 = r.points[0];
  const p1 = r.points[1];
  const heading = Math.atan2(p1[0] - p0[0], -(p1[2] - p0[2]));
  if (!(await D.teleport([p0[0], p0[1] + 0.5, p0[2], heading]))) { problems.push(`${id}: the staging teleport failed`); continue; }
  await S.waitSim(1.0);
  await D.city('watch', { on: true });
  let res = null;
  let err = '';
  let lowY = Infinity;
  try {
    res = await S.drive(r.points, {
      // a narrow box (a service tunnel or a one lane link, under 6.6 m between its walls) is driven the way a driver
      // takes it: slower, so the pursuit line does not cut its bends into the wall
      kmh: params.kmh ?? (r.widthM < 6.6 ? 25 : 50),
      lookM: r.widthM < 4.5 ? 3 : r.widthM < 6.6 ? 4 : 6,
      label: id,
      onFrame: async (f) => {
        lowY = Math.min(lowY, f.pos[1]);
        if (params.shots !== false && !shot && r.variant === 'TUN-T1' && f.pos[1] < r.yRange[0] + 0.6 && f.speed > 5) {
          shot = true;
          await S.shot('tunnel_drive_inside_eye');
        }
      },
    });
  } catch (e) {
    err = String(e && e.message ? e.message : e);
  }
  const w = await D.city('watch', { on: false });
  const one = { id, variant: r.variant, lengthM: r.lengthM, mouths: r.mouths, lowY, finished: !err, err, samples: w.samples, over: w.over, maxGapM: w.maxGapM, undrawn: w.undrawn, fallTicks: w.fallTicks, bodyTicks: w.bodyTicks, body: w.body, groundTicks: w.groundTicks, worst: w.worst };
  results.push(one);
  S.log(id, one);
  if (err) problems.push(`${id}: ${err}`);
  if (!(w.samples > 50)) problems.push(`${id}: only ${w.samples} wheel contacts watched`);
  if (w.over > 0) problems.push(`${id}: ${w.over} wheel contacts over 0.05 m off the drawn surface (worst ${Number(w.maxGapM).toFixed(3)} m at ${JSON.stringify(w.worst)})`);
  if (w.undrawn > 0) problems.push(`${id}: ${w.undrawn} wheel contacts where nothing is drawn`);
  if (w.fallTicks > 0) problems.push(`${id}: under the drawn surface for ${w.fallTicks} ticks (${JSON.stringify(w.fall)})`);
  if (w.bodyTicks > 0) problems.push(`${id}: the body touched a wall or the ceiling on ${w.bodyTicks} ticks (first ${JSON.stringify(w.body)})`);
}
if (problems.length) return S.failed(problems.join('; '), { results });
return S.ok({ routes: results.length, results });
