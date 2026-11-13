// P1-018, streamed since P1-019: the game starts on the committed test block (--tiles=test: 9 baked tiles of the ITO flyover
// and Connaught Place). The streamer loads the ring round the start (the ITO tiles, the ones nearest to India Gate), the
// game says ready only once that ring is attached with its colliders, the car stands on a lane of it with a collider
// under it, and a throttle drive moves it along its heading and leaves it on the road (input only). Then staging teleports in a row and a scene reload
// with tiles attached (a crash check).
const S = window.__sim;
const D = S.D;
await S.frames(3);
const st = D.state();
const w = st.world;
const problems = [];
if (!w) return S.failed(`state().world is empty: the tiles did not load (args ${JSON.stringify(st.args || null)})`);
S.log('world', w);
if (!w.booted || !w.ready) problems.push(`the game said ready before the ring was attached (booted ${w.booted}, ready ${w.ready})`);
if (w.indexTiles !== 9) problems.push(`the index has ${w.indexTiles} tiles, the test block has 9`);
if (w.tiles !== 4 || ['8_-5', '8_-6', '9_-5', '9_-6'].some((id) => !w.loaded.includes(id))) problems.push(`loaded tiles ${JSON.stringify(w.loaded)}, expected the four ITO tiles`);
if (w.errors.length) problems.push(`tile errors: ${w.errors.join('; ')}`);
if (w.queue.attach !== 0 || w.queue.reading !== 0 || w.queue.waiting !== 0) problems.push(`the queues are not empty at ready: ${JSON.stringify(w.queue)}`);
if (!(w.colliderTriangles > 20000)) problems.push(`only ${w.colliderTriangles} collider triangles`);
if (!(w.lanes > 300)) problems.push(`only ${w.lanes} lane pieces`);
const p0 = st.player;
if (!(p0.pos[1] > 150 && p0.pos[1] < 300)) problems.push(`the car stands at y ${p0.pos[1]}, not on the Delhi ground (about 206 m)`);
if (!(Math.abs(p0.pos[0]) > 100 || Math.abs(p0.pos[2]) > 100)) problems.push(`the car is still near the origin: ${JSON.stringify(p0.pos)}`);
// a collider under the car, at the height the road is drawn at
const probe = await D.stream('probe', { x: p0.pos[0], z: p0.pos[2] });
S.log('probe', probe);
if (!probe.hit) problems.push('no collider under the car');
else if (!probe.drawn || !(probe.gapM <= 0.05)) problems.push(`the collider is ${probe.gapM} m from the drawn surface (${probe.material})`);
else if (Math.abs(probe.colliderY - p0.pos[1]) > 0.05) problems.push(`the car stands ${(p0.pos[1] - probe.colliderY).toFixed(3)} m off the collider`);
await S.press('throttle', 1, 3);
await S.shot('drive_test_block');
const p1 = D.state().player;
const d = Math.hypot(p1.pos[0] - p0.pos[0], p1.pos[2] - p0.pos[2]);
S.log('drove', { from: p0.pos, to: p1.pos, d, heading: p1.heading, speed: p1.speed });
if (!(d > 10)) problems.push(`the car moved only ${d.toFixed(2)} m in 3 s of throttle`);
const along = (p1.pos[0] - p0.pos[0]) * Math.sin(p0.heading) - (p1.pos[2] - p0.pos[2]) * Math.cos(p0.heading);
if (!(along > 0.95 * d)) problems.push(`the car left its heading: ${along.toFixed(2)} m along of ${d.toFixed(2)} m`);
// the V2 car (P1-020) follows the road's grade: after the drive it still stands on the collider under it
const probe1 = await D.stream('probe', { x: p1.pos[0], z: p1.pos[2] });
if (!probe1.hit || Math.abs(probe1.colliderY - p1.pos[1]) > 0.1) problems.push(`after the drive the car stands ${probe1.hit ? (p1.pos[1] - probe1.colliderY).toFixed(3) : '?'} m off the collider`);
// Teleports in a row between the two ends of the block (ITO and Connaught Place, 3 km apart: every one unloads a ring and
// loads another), then three fired at once, then the scene is loaded again with tiles attached. None may raise an engine
// error, and the game must quit cleanly after (the driver fails a run that dies while quitting). Regression for the abort
// at quit of P1-019.
const ITO = [p0.pos[0], p0.pos[1], p0.pos[2]];
const CP = [-750, 0, -1750];
for (let i = 0; i < 6; i++) {
  const to = i % 2 === 0 ? CP : ITO;
  const ok = await D.teleport(to);
  await S.frames(1);
  const s = D.state();
  if (ok !== true || !s.world.ready || Math.hypot(s.player.pos[0] - to[0], s.player.pos[2] - to[2]) > 0.01) problems.push(`teleport ${i + 1} to ${to[0]}, ${to[2]}: answered ${ok}, ready ${s.world.ready}, player at ${s.player.pos[0].toFixed(1)}, ${s.player.pos[2].toFixed(1)}`);
}
const fired = [D.teleport(CP), D.teleport(ITO), D.teleport(CP)];
const answers = await Promise.all(fired);
await S.frames(2);
const after = D.state();
S.log('teleports at once', { answers, tiles: after.world.loaded, pos: after.player.pos });
if (answers[2] !== true) problems.push(`the last of three teleports fired at once answered ${answers[2]}`);
if (Math.hypot(after.player.pos[0] - CP[0], after.player.pos[2] - CP[2]) > 0.01 || after.world.tiles !== 5 || !after.world.ready) problems.push(`after three teleports at once the player is at ${after.player.pos[0].toFixed(1)}, ${after.player.pos[2].toFixed(1)} with tiles ${JSON.stringify(after.world.loaded)}`);
await D.load('scaffold');
await S.frames(2);
const again = D.state().world;
if (!again || !again.booted || !again.ready || again.tiles !== 4) problems.push(`after loading the scene again the city is ${JSON.stringify(again && { booted: again.booted, ready: again.ready, loaded: again.loaded })}`);
if (again && again.errors.length) problems.push(`tile errors after the reload: ${again.errors.join('; ')}`);
return problems.length ? S.failed(problems.join('; ')) : S.ok({ tiles: w.tiles, loadMs: w.loadMs, moved: d, gapM: probe.gapM, teleports: 9 });
