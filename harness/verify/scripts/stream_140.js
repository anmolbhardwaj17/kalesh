// P1-019: frame time while the city streams. The same drive as stream_200 (India Gate to the Red Fort by ITO) at 140 km/h on
// the full baked tiles. The script starts the drive, checks 10 s of it for hitches and leaves it running: the scenario's
// perf window then measures the frame while tiles load and unload (scene kind city; the scenario's budget makes the signed
// warn line of 10 ms p95 the fail line, because the acceptance is "inside warn").
const S = window.__sim;
const D = S.D;
const R = window.__scriptData;
const SPEED = 140;
await S.frames(3);
const w0 = D.state().world;
if (!w0) return S.failed('no streamed city: this scenario needs the full pilot tiles (--tiles=full; bake them with `npm run bake -- pilot`)');
const problems = [];
if (w0.bakeHash !== R.bakeHash) problems.push(`the routes were made for bake ${R.bakeHash}, the tiles are ${w0.bakeHash}: run node tools/fixtures/gen_stream_routes.mjs`);
const route = R.routes.across;
await D.teleport(route.points[0]);
await D.stream('path', { points: route.points, speedKmh: SPEED });
await D.stream('record', { on: true, skipS: 2 });
await S.waitSim(10);
const r = await D.stream('record', { on: false });
S.log('record', r);
if (r.over33 > 0) problems.push(`${r.over33} frame(s) over 33 ms after the first 2 s: ${JSON.stringify(r.over33List.slice(0, 6))}`);
if (!(r.attachMs.p99 <= 1.0)) problems.push(`attach work p99 ${r.attachMs.p99.toFixed(2)} ms a frame, over 1 ms`);
if (r.chunksMax > 3 || r.mixedFrames > 0) problems.push(`${r.chunksMax} collider chunks in one frame, ${r.mixedFrames} frames with a mesh and a chunk`);
const info = await D.stream('info');
if (!info.path.running) problems.push('the drive stopped before the perf window');
if (info.errors.length) problems.push(`tile errors: ${info.errors.join('; ')}`);
const summary = { frames: r.frames, frameMs: r.frameMs, attachMs: r.attachMs, coreMs: r.coreMs, chunksMax: r.chunksMax, tilesRead: r.tilesRead, drawCalls: r.drawCalls, heldMax: r.heldMax };
return problems.length ? S.failed(problems.join('; '), summary) : S.ok(summary);
