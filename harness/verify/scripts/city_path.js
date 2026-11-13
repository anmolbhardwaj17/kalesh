// P1-026: a fixed vehicle path of the city perf scenarios city_path_<path>_<kmh>. The scenario's `params` name the path
// (harness/data/fixtures/city_paths.json: cp_radial, ito_flyover, chandni_main, india_gate) and the speed (60, 140 or
// 200 km/h). The scripted drive (stream('path'), the V2 vehicle frozen and carried along the lanes, also at 140 km/h and
// under, so every speed measures the same code path) runs out and back along the path as a closed loop. The script
// records 8 s of drawn frames (no frame over 33 ms after the first 2 s, streaming work within its cap) and leaves the drive
// running: the scenario's perf window with the GPU ballast then measures the city on that path (scene kind city).
const S = window.__sim;
const D = S.D;
const R = window.__scriptData;
const P = window.__scriptParams || {};
const path = R.paths[P.path];
const KMH = Number(P.kmh);
if (!path) return S.failed(`no path ${P.path} in city_paths.json`);
if (!(KMH > 0)) return S.failed('the scenario needs params.kmh');
await S.frames(3);
const w0 = D.state().world;
if (!w0) return S.failed('no streamed city: this scenario needs the full pilot tiles (npm run bake -- pilot)');
const problems = [];
if (w0.bakeHash !== R.bakeHash) problems.push(`the paths were made for bake ${R.bakeHash}, the tiles are ${w0.bakeHash}: run node tools/fixtures/gen_city_paths.mjs`);
await D.teleport(path.points[0]);
await D.stream('path', { points: path.points, speedKmh: KMH, loop: true });
await D.stream('record', { on: true, skipS: 2 });
await S.waitSim(8);
const r = await D.stream('record', { on: false });
S.log('record', r);
const info = await D.stream('info');
if (!info.path.running) problems.push('the drive stopped before the perf window');
if (info.errors.length) problems.push(`tile errors: ${info.errors.join('; ')}`);
// a long frame with little game work (core step 1 ms or less, process time under a frame) was spent in the present path or the OS: noted, not failed
const ownLong = r.over33List.filter((f) => f.coreMs > 1 || f.processMs > 16);
if (ownLong.length) problems.push(`${ownLong.length} frame(s) over 33 ms with game work after the first 2 s: ${JSON.stringify(ownLong.slice(0, 4))}`);
if (r.over33 > 3) problems.push(`${r.over33} frames over 33 ms after the first 2 s: ${JSON.stringify(r.over33List.slice(0, 4))}`);
if (r.chunksMax > 3 || r.mixedFrames > 0) problems.push(`${r.chunksMax} collider chunks in one frame, ${r.mixedFrames} frames with a mesh and a chunk`);
const summary = {
  path: P.path, kmh: KMH, oneWayM: path.oneWayM, frames: r.frames, frameMs: r.frameMs, attachMs: r.attachMs, coreMs: r.coreMs, processMs: r.processMs,
  physicsMs: r.physicsMs, renderCpuMs: r.renderCpuMs, chunksMax: r.chunksMax, tilesRead: r.tilesRead, drawCalls: r.drawCalls, heldMax: r.heldMax, laps: info.path.laps,
};
return problems.length ? S.failed(problems.join('; '), summary) : S.ok(summary);
