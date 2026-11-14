// P2-010 perf: the GPU cost of the generated buildings (shells plus the area kit modules; budget perf_budgets.json
// world.gpuMs.generatedBuildings, 2.0 ms) and the frame's draw calls (2,500 at most, scenes.city warn) in the busiest
// pilot views: the Chandni Chowk 40 m view of the city perf base (look view city_busiest_40m) and a street-eye view along
// Chandni Chowk. The GPU is kept busy with the ballast (harness/bin/ballast.mjs method: under the 120 fps cap a light
// frame reads no cost); the cost is the frame with the buildings shown minus the frame with them hidden (stream
// layers: the shells and every module MultiMesh), the median of 4 alternating pairs. Fails over either line.
const S = window.__sim;
const D = S.D;
const params = window.__scriptParams || {};
const BUDGET = params.budgetMs ?? 2.0;
const CALLS = params.drawCalls ?? 2500;
// the stream layers the A/B hides (P2-048: ['buildings_*_p*'] measures the small pieces alone, the sign boards among them)
const LAYERS = params.layers || ['buildings'];
// or an A/B of one shader parameter on those layers' materials instead of hiding them (P2-048 round 3: {name, on, off}:
// `shell_signs` 1 against 0 is the cost of the signs the kit shader draws on shell walls, at the densest setting)
const PARAM = params.param || null;
const poses = params.poses || [
  { id: 'busiest_40m', tp: [1093.5, 222.1, -4316.2], pos: [1120, 262, -4280], target: [1090, 222, -4320] },
  { id: 'chandni_street', tp: [982.0, 222.9, -4321.0], pos: [992.2, 224.6, -4323.3], target: [939.9, 226.0, -4322.1] },
];
await S.until(() => D.state().world && D.state().world.ready, { sim: 30, label: 'the city ring is attached' });
const next = (n, f) => {
  if (!(f > 0)) return Math.round(n * 1.5);
  if (f < 12) return Math.round(n * Math.min(3, Math.max(1.5, 15 / f)));
  if (f > 20) return Math.max(1, Math.round(n * (15 / f)));
  return null;
};
let n = 1200;
await D.bench('blank', { on: true });
try {
  for (let i = 0; i < 6; i++) {
    await D.bench('ballast', { n });
    await D.perf(300);
    const nn = next(n, (await D.perf(700)).frameMs?.p50);
    if (nn == null) break;
    n = nn;
  }
} finally {
  await D.bench('ballast', { n: 0 });
  await D.bench('blank', { on: false });
}
const median = (a) => {
  const s = a.slice().sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const out = { ballastN: n, poses: {} };
const problems = [];
for (const p of poses) {
  await D.teleport(p.tp);
  await S.until(() => D.state().world.ready && D.state().world.queue.attach === 0 && D.state().world.queue.reading === 0, { sim: 20, label: `${p.id}: tiles attached` });
  await D.setCamera({ pos: p.pos, target: p.target });
  await S.waitSim(2);
  const plain = await D.perf(1000);
  const b = D.state().world.buildings;
  const on = [];
  const off = [];
  const gpuOn = [];
  const gpuOff = [];
  await D.bench('ballast', { n });
  try {
    for (let r = 0; r < 4; r++) {
      for (const shown of r % 2 ? [false, true] : [true, false]) {
        if (PARAM) await D.stream('layers', { param: { [PARAM.name]: shown ? PARAM.on : PARAM.off }, of: LAYERS });
        else await D.stream('layers', shown ? { show: LAYERS } : { hide: LAYERS });
        await D.perf(300);
        const w = await D.perf(1500);
        (shown ? on : off).push(w.frameMs?.p50);
        if (w.gpuMs && w.gpuMs.p50 > 0) (shown ? gpuOn : gpuOff).push(w.gpuMs.p50);
      }
    }
  } finally {
    await D.bench('ballast', { n: 0 });
    if (!PARAM) await D.stream('layers', { show: LAYERS });
  }
  const pairs = on.map((v, i) => v - off[i]);
  const cost = median(pairs);
  const gpuCost = gpuOn.length === on.length ? median(gpuOn.map((v, i) => v - gpuOff[i])) : null;
  const ms = gpuCost ?? cost;
  const calls = plain.drawCalls ?? plain.draws ?? null;
  out.poses[p.id] = { layers: LAYERS, costMs: Math.round(cost * 1000) / 1000, gpuCostMs: gpuCost === null ? null : Math.round(gpuCost * 1000) / 1000, pairs: pairs.map((v) => Math.round(v * 1000) / 1000), drawCalls: calls, triangles: plain.triangles ?? null, frameOnP50: median(on), frameOffP50: median(off), buildings: b };
  S.log(p.id, out.poses[p.id]);
  await S.shot(`city_buildings_busiest_${p.id}`);
  if (!(ms <= BUDGET)) problems.push(`${p.id}: buildings GPU cost ${ms.toFixed(3)} ms, budget ${BUDGET} ms`);
  if (calls != null && calls > CALLS) problems.push(`${p.id}: ${calls} draw calls, budget ${CALLS}`);
}
await D.setCamera(null);
if (problems.length) return S.failed(problems.join('; '), out);
return S.ok(out);
