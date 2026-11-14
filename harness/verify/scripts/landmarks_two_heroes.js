// P2-007 perf: the GPU cost of the landmarks (budget perf_budgets.json world.gpuMs.landmarks, 0.5 ms) with two heroes
// in view. Poses (params.poses, world metres): India Gate at full detail with the Connaught Place circle behind it on the
// same line of sight, and the Red Fort's Lahori Gate with Jama Masjid. The GPU is kept busy with the ballast (the
// method of harness/bin/ballast.mjs: under the 120 fps cap a light frame reads no cost), and the cost is the frame time
// with every landmark shown minus the same frame with them hidden (city('kit', {visible})), the median of alternating
// pairs. Fails over the budget.
const S = window.__sim;
const D = S.D;
const params = window.__scriptParams || {};
const BUDGET = params.budgetMs ?? 0.5;
const poses = params.poses || [
  { id: 'india_gate_and_cp', pos: [725.5, 245.0, 692.4], target: [-330.4, 225.0, -1739.7], heroes: ['india_gate', 'cp_circle'] },
  { id: 'red_fort_and_jama_masjid', pos: [1600.0, 245.0, -3750.0], target: [1271.0, 225.0, -4010.0], heroes: ['red_fort', 'jama_masjid'], points: [[1528.7, 230.0, -4298.7], [1013.9, 240.0, -3721.0]] },
];
await S.until(() => D.state().world && D.state().world.ready, { sim: 30, label: 'the city ring is attached' });
let kit = await D.city('kit');
for (let i = 0; i < 120 && !kit.ready; i++) {
  await S.waitSim(0.5);
  kit = await D.city('kit');
}
if (!kit.ready) return S.failed(`kit landmarks still building: ${kit.building.join(', ')}`);
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
  await D.teleport([p.pos[0] - 20, 0, p.pos[2] - 20]);
  await D.setCamera({ pos: p.pos, target: p.target });
  await S.waitSim(2);
  const view = await D.city('kit');
  const levels = Object.fromEntries(view.landmarks.filter((l) => p.heroes.includes(l.id)).map((l) => [l.id, l.level]));
  // the point of each hero that must be on screen (its position, or a given point: the Red Fort's Lahori Gate)
  const sc = await D.city('screen', { points: p.points || p.heroes.map((id) => view.landmarks.find((l) => l.id === id).pos) });
  const inView = sc.points.map((q) => q.front && q.x >= 0 && q.x <= sc.size[0] && q.y >= 0 && q.y <= sc.size[1]);
  if (!inView.every(Boolean)) problems.push(`${p.id}: not every hero is in view (${JSON.stringify(inView)})`);
  const on = [];
  const off = [];
  const gpuOn = [];
  const gpuOff = [];
  await D.bench('ballast', { n });
  try {
    for (let r = 0; r < 4; r++) {
      for (const shown of r % 2 ? [false, true] : [true, false]) {
        await D.city('kit', { visible: shown });
        await D.perf(300);
        const w = await D.perf(1500);
        (shown ? on : off).push(w.frameMs?.p50);
        if (w.gpuMs && w.gpuMs.p50 > 0) (shown ? gpuOn : gpuOff).push(w.gpuMs.p50);
      }
    }
  } finally {
    await D.bench('ballast', { n: 0 });
    await D.city('kit', { visible: true });
  }
  const pairs = on.map((v, i) => v - off[i]);
  const cost = median(pairs);
  const gpuCost = gpuOn.length === on.length ? median(gpuOn.map((v, i) => v - gpuOff[i])) : null;
  const ms = gpuCost ?? cost;
  out.poses[p.id] = { levels, frameOnP50: median(on), frameOffP50: median(off), costMs: Math.round(cost * 1000) / 1000, gpuCostMs: gpuCost === null ? null : Math.round(gpuCost * 1000) / 1000, pairs: pairs.map((v) => Math.round(v * 1000) / 1000), triangles: view.landmarks.filter((l) => p.heroes.includes(l.id)).map((l) => ({ id: l.id, level: l.level, triangles: l.triangles })) };
  S.log(p.id, out.poses[p.id]);
  await S.shot(`landmarks_two_heroes_${p.id}`);
  if (!(ms <= BUDGET)) problems.push(`${p.id}: landmark GPU cost ${ms.toFixed(3)} ms, budget ${BUDGET} ms`);
}
await D.setCamera(null);
if (problems.length) return S.failed(problems.join('; '), out);
return S.ok(out);
