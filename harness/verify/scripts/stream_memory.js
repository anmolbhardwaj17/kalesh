// P1-019: memory while streaming. Five minutes of sim round the closed lap India Gate, Connaught Place and back (8.1 km,
// harness/data/fixtures/stream_routes.json) at 200 km/h on the full baked tiles: two laps. Time runs 4 times faster, so the
// streamer loads and unloads 4 times as fast as in play. Checks:
//   the tiles held never pass the cap; process memory at the end of lap 2 is under 50 MB above the end of lap 1;
//   back at the start with the same ring loaded (after an unload of everything else), the engine object count is within
//   2 percent of the first time there, with the same tiles, collider chunks and lane pieces.
const S = window.__sim;
const D = S.D;
const R = window.__scriptData;
const SPEED = 200;
const SECONDS = 300;
await S.frames(3);
const w0 = D.state().world;
if (!w0) return S.failed('no streamed city: this scenario needs the full pilot tiles (--tiles=full; bake them with `npm run bake -- pilot`)');
const problems = [];
const route = R.routes.loop;
const settle = async (label) => {
  await S.until(() => { const w = D.state().world; return w.ready && w.queue.attach === 0 && w.queue.dispose === 0 && w.queue.reading === 0 && w.queue.waiting === 0; }, { sim: 20, label });
  await S.frames(5);
};
// The same state both times: come to the start from far away (Chandni Chowk, 5 km north), so only the start's own ring
// is loaded and no tile of a hysteresis band is left from where the player was before.
const toStart = async (label) => {
  await D.teleport(R.places.chandni_chowk.at);
  await settle(`${label}: the far ring settles`);
  await D.teleport(route.points[0]);
  await settle(`${label}: the ring at the start settles`);
};
await toStart('before the laps');
const m0 = await D.stream('mem');
S.log('start', m0);
await D.stream('record', { on: true, skipS: 0 });
await D.stream('path', { points: route.points, speedKmh: SPEED, loop: true });
D.timeScale(4);
const t0 = S.clock().t;
const laps = [];
let heldWorst = 0;
while (S.clock().t - t0 < SECONDS) {
  await S.waitSim(2);
  const info = await D.stream('info');
  heldWorst = Math.max(heldWorst, info.held);
  if (info.path.laps > laps.length) {
    const m = await D.stream('mem');
    laps.push({ t: Math.round((S.clock().t - t0) * 10) / 10, ...m });
    S.log(`lap ${laps.length}`, laps[laps.length - 1]);
    S.progress(`lap ${laps.length}`);
  }
}
D.timeScale(1);
await D.stream('path', { stop: true });
const r = await D.stream('record', { on: false });
const end = await D.stream('info');
S.log('record', { heldMax: r.heldMax, capTiles: r.capTiles, tilesRead: r.tilesRead, tilesGone: r.tilesGone, frames: r.frames, attachMs: r.attachMs });
if (laps.length < 2) problems.push(`only ${laps.length} lap(s) in ${SECONDS} s`);
if (Math.max(r.heldMax, heldWorst) > r.capTiles || end.held > r.capTiles) problems.push(`${Math.max(r.heldMax, heldWorst, end.held)} tiles held, over the cap ${r.capTiles}`);
if (!(r.tilesRead > 100 && r.tilesGone > 100)) problems.push(`the loop streamed too little: ${r.tilesRead} read, ${r.tilesGone} unloaded`);
let growth = null;
if (laps.length >= 2) {
  const key = laps[0].rssMB !== undefined ? 'rssMB' : 'staticMB';
  growth = { key, mb: Math.round((laps[laps.length - 1][key] - laps[0][key]) * 10) / 10, staticMb: Math.round((laps[laps.length - 1].staticMB - laps[0].staticMB) * 10) / 10 };
  if (!(growth.mb < 50)) problems.push(`process memory (${key}) grew ${growth.mb} MB after the first lap (limit 50 MB)`);
  if (!(growth.staticMb < 50)) problems.push(`engine memory grew ${growth.staticMb} MB after the first lap (limit 50 MB)`);
}
if (end.errors.length) problems.push(`tile errors: ${end.errors.join('; ')}`);
// back where it started: the same ring, the same engine objects
await toStart('after the laps');
const m1 = await D.stream('mem');
S.log('back at the start', m1);
const objects = Math.abs(m1.objects - m0.objects) / m0.objects;
if (m1.held !== m0.held) problems.push(`${m1.held} tiles held back at the start, ${m0.held} the first time`);
if (!(objects <= 0.02)) problems.push(`the engine object count is ${m1.objects}, ${(objects * 100).toFixed(1)} percent off the first ${m0.objects} (limit 2 percent)`);
if (m1.colliderChunks !== m0.colliderChunks || m1.lanePieces !== m0.lanePieces) problems.push(`collider chunks ${m0.colliderChunks} then ${m1.colliderChunks}, lane pieces ${m0.lanePieces} then ${m1.lanePieces}`);
const summary = { laps, growth, heldMax: Math.max(r.heldMax, heldWorst), capTiles: r.capTiles, tilesRead: r.tilesRead, tilesGone: r.tilesGone, start: m0, back: m1, objectsOffPct: Math.round(objects * 10000) / 100 };
return problems.length ? S.failed(problems.join('; '), summary) : S.ok(summary);
