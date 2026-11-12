// P1-019: teleport in the streamed city (--tiles=full). For Connaught Place, the ITO crossing, Chandni Chowk and India Gate
// (lane points at grade from harness/data/fixtures/stream_routes.json): the teleport answers within 2 s of sim, and when it
// does the ring there is attached with its colliders, the player stands on the ground, and a ray down at the player and at
// four points 3 m around hits a collider within 0.05 m of the drawn surface. Then 12 teleports sent in a row (a crash check).
const S = window.__sim;
const D = S.D;
const R = window.__scriptData;
const PLACES = ['connaught_place', 'ito_crossing', 'chandni_chowk', 'india_gate'];
await S.frames(3);
if (!D.state().world) return S.failed('no streamed city: this scenario needs the full pilot tiles (--tiles=full; bake them with `npm run bake -- pilot`)');
const problems = [];
const out = {};
for (const id of PLACES) {
  const place = R.places[id];
  if (!place) { problems.push(`no place ${id} in the routes fixture`); continue; }
  const [x, y, z] = place.at;
  const t0 = S.clock().t;
  const wall0 = performance.now();
  const ok = await D.teleport([x, y, z]);
  const wallMs = Math.round(performance.now() - wall0);
  await S.frames(1);
  const simS = S.clock().t - t0;
  const st = D.state();
  const w = st.world;
  const p = st.player.pos;
  if (ok !== true) problems.push(`${id}: teleport answered ${ok}`);
  if (!(simS <= 2)) problems.push(`${id}: the teleport took ${simS.toFixed(2)} s of sim (limit 2 s)`);
  if (!w.ready || w.queue.attach !== 0 || w.queue.reading !== 0) problems.push(`${id}: the ring was not attached when the teleport answered (${JSON.stringify(w.queue)})`);
  if (Math.hypot(p[0] - x, p[2] - z) > 0.01) problems.push(`${id}: the player is at ${p[0].toFixed(1)}, ${p[2].toFixed(1)}, not at ${x}, ${z}`);
  let worst = 0;
  for (const [dx, dz] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]]) {
    const pr = await D.stream('probe', { x: x + dx, z: z + dz });
    if (!pr.hit) { problems.push(`${id}: no collider under ${x + dx}, ${z + dz}`); continue; }
    if (!pr.drawn) { problems.push(`${id}: nothing drawn under ${x + dx}, ${z + dz}`); continue; }
    worst = Math.max(worst, pr.gapM);
    if (!(pr.gapM <= 0.05)) problems.push(`${id}: the collider at ${x + dx}, ${z + dz} is ${pr.gapM.toFixed(3)} m from the drawn ${pr.material} (collider ${pr.colliderY.toFixed(3)}, drawn ${pr.drawnY.toFixed(3)})`);
    if (dx === 0 && dz === 0 && Math.abs(pr.colliderY - p[1]) > 0.05) problems.push(`${id}: the player stands ${(p[1] - pr.colliderY).toFixed(3)} m off the ground`);
  }
  out[id] = { simS: Math.round(simS * 100) / 100, wallMs, tiles: w.tiles, chunks: w.colliderChunks, worstGapM: Math.round(worst * 10000) / 10000, y: p[1] };
  S.log(id, out[id]);
  if (id === 'connaught_place') await S.shot('stream_teleport_cp');
}
// Teleports in a row, each one sent before the last one's ring is attached (reads cancelled, tiles disposed half attached):
// no engine error, the last one wins, and the game quits cleanly after (the driver fails a run that dies while quitting).
const order = [];
for (let i = 0; i < 12; i++) order.push(R.places[PLACES[i % PLACES.length]].at);
const answers = await Promise.all(order.map((at) => D.teleport(at)));
await S.frames(2);
const last = order[order.length - 1];
const end = D.state();
if (answers[answers.length - 1] !== true) problems.push(`the last of 12 teleports in a row answered ${answers[answers.length - 1]}`);
if (Math.hypot(end.player.pos[0] - last[0], end.player.pos[2] - last[2]) > 0.01 || !end.world.ready) problems.push(`after 12 teleports in a row the player is at ${end.player.pos[0].toFixed(1)}, ${end.player.pos[2].toFixed(1)}, ready ${end.world.ready}`);
if (end.world.errors.length) problems.push(`tile errors: ${end.world.errors.join('; ')}`);
if (end.world.held > end.world.cap.tiles) problems.push(`${end.world.held} tiles held after the teleports, over the cap ${end.world.cap.tiles}`);
out.inARow = { sent: order.length, done: answers.filter((a) => a === true).length, held: end.world.held, tiles: end.world.tiles };
S.log('in a row', out.inARow);
return problems.length ? S.failed(problems.join('; '), out) : S.ok(out);
