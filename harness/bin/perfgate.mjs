// Frame time gate and perf table (P2-118), shared by verify.mjs, sweep.mjs and the dashboard.
// The headline number is the p95 frame time in ms: the larger of the CPU p95 (work inside the frame) and the GPU p95
// (EXT_disjoint_timer_query_webgl2), since the CPU and the GPU work in parallel and the slower one sets the frame.
// TECH.md "Performance budgets": over 16.6 ms (60 fps) warns, over 22 ms (the 45 fps floor) fails, with these rules:
//  - CPU p95 over 22 ms is a hard FAIL (the slow frame control proves the gate catches it).
//  - GPU p95 over 22 ms FAILS only when frames really drop (rAF p95 over 22 ms or average fps under 45). Otherwise it only
//    warns: the ANGLE Metal timer measures GPU timeline time, which Apple tile overlap and other GPU users inflate while
//    60 fps holds. HARNESS_PERF_STRICT=1 (perf.strict) makes the GPU limit a hard fail again.
//  - Average fps under 45 FAILS on its own (the old fps floor), whatever the CPU and GPU timers say.
//  - On a loaded machine (1 minute load average over LOAD_PER_CORE_MAX per core, perf.load) every fail above becomes a
//    "not judged: machine loaded" warning, except when the slow frame control is on (a control must always fail).
//  - P2B-102: when the block has a stable GPU cost (`perf.gpuCost.ms`, harness/bin/gpucost.mjs: ms per frame drawn back to
//    back between GPU syncs, so at full clock), THAT is the GPU number of the gate instead of the raw timer p95, which swings
//    12 to 20 ms on one build as the GPU clocks down on light frames. A stable cost over 22 ms fails on its own (it is real
//    work at full clock, not overlap); the raw p95 stays in the message and the table.

export const FRAME_MS_WARN = 16.6;
export const FRAME_MS_FAIL = 22;
export const FPS_FLOOR = 45;
export const LOAD_PER_CORE_MAX = 1.0;

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const f1 = (v) => (num(v) ? v.toFixed(1) : '-');
const f2 = (v) => (num(v) ? v.toFixed(2) : '-');

/** The stable GPU cost in ms of a perf block (P2B-102, `perf.gpuCost.ms`), or null when it was not measured. */
export function stableGpuMs(perf) {
  const v = perf?.gpuCost?.ms;
  return num(v) && v > 0 ? v : null;
}

/** The machine load stored in a perf block ({avg1, cores}), or null. `loaded` is over LOAD_PER_CORE_MAX per core. */
export function machineLoad(perf, max = LOAD_PER_CORE_MAX) {
  const l = perf?.load;
  if (!l || !num(l.avg1) || !num(l.cores) || l.cores <= 0) return null;
  const perCore = l.avg1 / l.cores;
  return { avg1: l.avg1, cores: l.cores, perCore, loaded: perCore > max };
}

/** "load 9.4 / 12 cores" for messages and tables. */
export function loadText(perf) {
  const l = machineLoad(perf);
  return l ? `load ${l.avg1.toFixed(1)} / ${l.cores} cores` : 'load n/a';
}

/**
 * Judge one perf block. Returns {level: 'ok' | 'warn' | 'fail', reason, p95, bound: 'cpu' | 'gpu' | null, message}.
 * reason: ok, budget (over 16.6 ms), cpu (CPU over the limit), gpu (GPU over the limit and frames dropped, or strict),
 * gpu_overlap (GPU timer over the limit but frames held), fps (average under 45), loaded (a fail downgraded on a loaded
 * machine; `downgraded` holds the original reason), no_data. Options override the block's own `strict` and `load`.
 */
export function frameTimeGate(perf, { warnMs = FRAME_MS_WARN, failMs = FRAME_MS_FAIL, fpsFloor = FPS_FLOOR, strict, loadMax = LOAD_PER_CORE_MAX } = {}) {
  const cpu = perf?.cpuMs?.p95;
  const raw = perf?.gpuMs?.p95;
  if (!num(cpu)) return { level: 'fail', reason: 'no_data', p95: null, bound: null, message: 'no frame time measured (cpuMs missing: an old build or zero frames)' };
  const isStrict = strict ?? perf?.strict === true;
  // P2B-102: the stable cost replaces the raw timer p95 as the GPU number when it was measured.
  const stable = stableGpuMs(perf);
  const gpu = stable ?? raw;
  const gpuOk = num(gpu);
  const bound = gpuOk && gpu > cpu ? 'gpu' : 'cpu';
  const p95 = bound === 'gpu' ? gpu : cpu;
  const raf = perf?.p95FrameMs;
  const fps = perf?.avgFps;
  const fpsLow = num(fps) && fps < fpsFloor;
  const framesDropped = (num(raf) && raf > failMs) || fpsLow;
  const costText = stable != null ? `gpu cost ${f2(stable)} ms (stable), ` : '';
  const both = `cpu p95 ${f1(cpu)} ms, ${costText}gpu p95 ${num(raw) ? `${f1(raw)} ms` : `n/a (${perf?.gpuNote || 'gpu timer unavailable'})`}${stable != null ? ' (raw)' : ''}, rAF p95 ${f1(raf)} ms, ${f1(fps)} fps`;
  const slow = perf?.slowFrameMs ? `; slow frame control on: ${perf.slowFrameMs} ms busy loop per frame` : '';
  const out = (level, reason, message) => ({ level, reason, p95, bound, gpuSource: stable != null ? 'cost' : gpuOk ? 'raw' : null, message: `${message}: ${both}${slow}` });

  let res;
  if (cpu > failMs) res = out('fail', 'cpu', `cpu p95 ${f1(cpu)} ms is over the ${failMs} ms limit (45 fps)`);
  else if (stable != null && stable > failMs) res = out('fail', 'gpu', `stable gpu cost ${f2(stable)} ms is over the ${failMs} ms limit (45 fps) at full clock`);
  else if (stable == null && gpuOk && gpu > failMs && (framesDropped || isStrict)) {
    const why = isStrict && !framesDropped ? 'strict GPU limit (HARNESS_PERF_STRICT=1)' : 'frames dropped';
    res = out('fail', 'gpu', `gpu p95 ${f1(gpu)} ms is over the ${failMs} ms limit (45 fps), ${why}`);
  } else if (fpsLow) res = out('fail', 'fps', `average ${f1(fps)} fps is under the ${fpsFloor} fps floor`);
  else if (stable == null && gpuOk && gpu > failMs) res = out('warn', 'gpu_overlap', `gpu timer over budget but 60 fps held (GPU overlap or contention), gpu p95 ${f1(gpu)} ms`);
  else if (p95 > warnMs) res = out('warn', 'budget', `${bound === 'gpu' && stable != null ? 'stable gpu cost' : 'p95 frame time'} ${f1(p95)} ms (${bound} bound) is over the ${warnMs} ms budget (60 fps)`);
  else res = out('ok', 'ok', `${bound === 'gpu' && stable != null ? 'frame time (stable gpu cost)' : 'p95 frame time'} ${f1(p95)} ms (${bound} bound)`);

  const load = machineLoad(perf, loadMax);
  if (res.level === 'fail' && load?.loaded && !perf?.slowFrameMs) {
    return { ...res, level: 'warn', reason: 'loaded', downgraded: res.reason, message: `not judged: machine loaded (load ${load.avg1.toFixed(1)} on ${load.cores} cores, over ${loadMax} per core); would fail: ${res.message}` };
  }
  return res;
}

/** Short gate label for tables: ok, warn, FAIL, gpu overlap, not judged (loaded), not judged (software GL). */
export function gateLabel(perf, g = frameTimeGate(perf)) {
  if (perf?.judged === false) return 'not judged (software GL)';
  if (g.reason === 'loaded') return 'not judged (loaded)';
  if (g.reason === 'gpu_overlap') return 'warn (gpu overlap)';
  return g.level === 'fail' ? 'FAIL' : g.level;
}

/** "p50 / p95 / max" of a stats block, or the reason it is missing. */
export function msTriple(s, missing = 'n/a') {
  return s && typeof s.p95 === 'number' ? `${f1(s.p50)} / ${f1(s.p95)} / ${f1(s.max)}` : missing;
}

/** The compact per scenario perf summary stored in sweep reports and served to the dashboard. */
export function perfSummary(perf) {
  if (!perf) return null;
  const g = frameTimeGate(perf);
  const l = machineLoad(perf);
  return {
    cpuMs: perf.cpuMs || null,
    gpuMs: perf.gpuMs || null,
    gpuCost: perf.gpuCost ? (num(perf.gpuCost.ms) ? { ms: perf.gpuCost.ms, spread: perf.gpuCost.spread ?? null } : { error: perf.gpuCost.error || 'not measured' }) : null,
    gpuNote: perf.gpuNote || null,
    rafP95: num(perf.p95FrameMs) ? Math.round(perf.p95FrameMs * 10) / 10 : null,
    fps: typeof perf.avgFps === 'number' ? Math.round(perf.avgFps * 10) / 10 : null,
    drawCalls: perf.drawCalls ?? null,
    triangles: perf.triangles ?? null,
    gpuMB: perf.gpuMB ?? null,
    load: l ? { avg1: Math.round(l.avg1 * 100) / 100, cores: l.cores, loaded: l.loaded } : null,
    strict: perf.strict === true,
    frameGate: g.level,
    gateReason: g.reason,
    gateLabel: gateLabel(perf, g),
    frameP95: g.p95,
    bound: g.bound,
    judged: perf.judged !== false,
  };
}

/** Text table of perf rows ({name, perf}) for the verify and sweep console summaries. Gate comes right after the name. */
export function perfTable(rows) {
  // P2B-102: `gpu cost` is the stable GPU cost (ms per frame at full clock), the gate's GPU number.
  const head = `    ${'scenario'.padEnd(26)} ${'gate'.padEnd(20)} ${'cpu ms p50/p95/max'.padEnd(20)} ${'gpu cost'.padEnd(9)} ${'raw gpu p50/p95/max'.padEnd(20)} ${'rAF p95'.padStart(7)} ${'fps'.padStart(5)} ${'calls'.padStart(5)}  load`;
  const lines = rows.map(({ name, perf }) => {
    const gpu = msTriple(perf?.gpuMs, 'unavailable');
    const st = stableGpuMs(perf);
    const cost = st != null ? f2(st) : '-';
    return `    ${name.padEnd(26)} ${gateLabel(perf).padEnd(20)} ${msTriple(perf?.cpuMs).padEnd(20)} ${cost.padEnd(9)} ${gpu.padEnd(20)} ${f1(perf?.p95FrameMs).padStart(7)} ${f1(perf?.avgFps).padStart(5)} ${String(perf?.drawCalls ?? '-').padStart(5)}  ${loadText(perf)}`;
  });
  const notes = [...new Set(rows.map(({ perf }) => (perf && !perf.gpuMs && perf.gpuNote) || null).filter(Boolean))].map((n) => `    gpu: ${n}`);
  return [head, ...lines, ...notes];
}

/**
 * P2-182: the order verify runs its scenarios in. `perf` (scenarios that measure frame time and GPU memory) run FIRST, one
 * at a time, right after boot: an idle GPU that no other page has used yet. In GATE P2 run 2 they ran after the pool and
 * the 133 s art bench and three DPR 2 scenarios read 57 to 79 ms of GPU time that each read under 22 ms alone. `pool` runs
 * side by side after them, and `after` (long solo scenarios that measure nothing, the art bench) last. Same total time.
 * `measures(sc)` says whether a scenario measures perf in this mode, `solo(sc)` whether it must run alone anyway.
 */
export function runOrder(list, { measures, solo }) {
  return {
    perf: list.filter((s) => measures(s)),
    pool: list.filter((s) => !measures(s) && !solo(s)),
    after: list.filter((s) => !measures(s) && solo(s)),
  };
}

/**
 * P1-040: the scenario list of `verify --repeat N` (flakecheck.mjs). Every scenario becomes N copies named `<name>#<k>`
 * with `baseName`, perf and solo ones too (they used to run once whatever N said): runOrder still runs those copies
 * one at a time, perf first.
 */
export function repeatList(list, n) {
  if (!(n > 0)) return list;
  return list.flatMap((s) => Array.from({ length: n }, (_, k) => ({ ...s, name: `${s.name}#${k + 1}`, baseName: s.name })));
}
