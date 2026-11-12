// P1-019: the streaming gate. A scripted drive across the pilot centre (India Gate to the Red Fort by ITO, on the lanes of
// harness/data/fixtures/stream_routes.json) at 200 km/h for 60 s of sim on the full baked tiles (--tiles=full). The game
// records every drawn frame (debug stream('record')):
//   no frame over 33 ms after the first 2 s; the streaming work of a frame at most 1 ms at p99; at most 3 collider chunks
//   attached in any frame and never with a mesh step; no burst while driving; the loaded tiles stay under the cap.
// The drive goes on after the script, so the scenario's perf window (scene kind city) measures the city while it streams.
const S = window.__sim;
const D = S.D;
const R = window.__scriptData;
const SPEED = 200;
const SECONDS = 60;
await S.frames(3);
const w0 = D.state().world;
if (!w0) return S.failed('no streamed city: this scenario needs the full pilot tiles (--tiles=full; bake them with `npm run bake -- pilot`)');
const problems = [];
if (w0.bakeHash !== R.bakeHash) problems.push(`the routes were made for bake ${R.bakeHash}, the tiles are ${w0.bakeHash}: run node tools/fixtures/gen_stream_routes.mjs`);
const route = R.routes.across;
if (route.lengthM < (SPEED / 3.6) * SECONDS + 200) return S.failed(`the route is ${route.lengthM} m, too short for ${SECONDS} s at ${SPEED} km/h`);
await D.teleport(route.points[0]);
const start = await D.stream('info');
S.log('start', { tiles: start.tiles, queue: start.queue, loadMs: start.loadMs });
await D.stream('path', { points: route.points, speedKmh: SPEED });
await D.stream('record', { on: true, skipS: 2 });
await S.waitSim(SECONDS);
const r = await D.stream('record', { on: false });
S.log('record', r);
await S.shot('stream_200');
const end = await D.stream('info');
const moved = r.path.s;
if (!(r.simS >= SECONDS - 0.5)) problems.push(`recorded only ${r.simS.toFixed(1)} s of sim`);
if (!(moved >= (SPEED / 3.6) * (SECONDS - 1))) problems.push(`the drive covered ${moved.toFixed(0)} m in ${SECONDS} s, not 200 km/h`);
if (r.over33 > 0) problems.push(`${r.over33} frame(s) over 33 ms after the first 2 s: ${JSON.stringify(r.over33List.slice(0, 6))}`);
if (!(r.attachMs.p99 <= 1.0)) problems.push(`attach work p99 ${r.attachMs.p99.toFixed(2)} ms a frame, over 1 ms`);
if (!(r.coreMs.p99 <= 1.0)) problems.push(`the whole streaming step p99 ${r.coreMs.p99.toFixed(2)} ms a frame, over 1 ms`);
if (r.chunksMax > 3) problems.push(`${r.chunksMax} collider chunks attached in one frame (cap 3)`);
if (r.mixedFrames > 0) problems.push(`${r.mixedFrames} frame(s) attached a mesh and a collider chunk`);
if (r.burstFrames > 0) problems.push(`${r.burstFrames} burst frame(s) while driving`);
if (!(r.tilesRead >= 20)) problems.push(`only ${r.tilesRead} tiles were read: the drive did not stream`);
if (!(r.chunkFrames > 100)) problems.push(`only ${r.chunkFrames} frames attached collider chunks`);
if (r.heldMax > r.capTiles) problems.push(`${r.heldMax} tiles held, over the cap ${r.capTiles}`);
if (end.errors.length) problems.push(`tile errors: ${end.errors.join('; ')}`);
const summary = {
  frames: r.frames, frameMs: r.frameMs, over33: r.over33, attachMs: r.attachMs, coreMs: r.coreMs, chunksMax: r.chunksMax, chunkFrames: r.chunkFrames,
  meshFrames: r.meshFrames, tilesRead: r.tilesRead, tilesGone: r.tilesGone, readMsMax: r.readMsMax, readMsAvg: r.readMsAvg, heldMax: r.heldMax,
  liveMax: r.liveMax, drawCalls: r.drawCalls, worstStepMs: r.worstStepMs, overBudget: r.overBudget, movedM: Math.round(moved),
};
return problems.length ? S.failed(problems.join('; '), summary) : S.ok(summary);
