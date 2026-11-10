// Stable GPU cost (P2B-102), the number perf gates and the P2B budgets compare.
//
// Why: at 60 fps the M2 Pro lowers its GPU clock on light frames, so the raw GPU timer p95 of one build swings about 12 to
// 20 ms from run to run (P2B-003), and a 15 percent cut cannot be shown. The GPU timer query is also not a cost on Apple
// GPUs: passes overlap, so under a stress load (each frame drawn n times) timer / n read 21 ms a frame in the den on High
// while the same GPU drew 12 frames in 83 ms.
//
// The measure: `debug.gpuBench({n, reps})` (docs/GAME_HOOKS.md, optional) draws the current frame n times
// back to back between two 1 pixel reads, each of which waits for the GPU, and returns the wall ms. The GPU is saturated
// for the whole run, so it is at full clock, and the time is throughput. After a warm up, `reps` pairs of runs at a low and a
// high n are taken interleaved, and the cost is the slope between the median times:
//
//   gpuCost.ms = (median(t at hi) - median(t at lo)) / (hi - lo)
//
// The slope drops the fixed part of a run (the two syncs, pipeline fill: 2 to 9 ms), so a cut in the scene shows in full.
// Per pair slopes give `spread` (a self check of one measurement). On a scene that is cheap on the GPU the bench is bound
// by the browser's command submission instead (den on Low reads the same at half resolution): that is still the frame's
// cost to draw, and `gpuBound` (the High/Medium views) is not checked here. The raw timer p95 (`perf.gpuMs.p95`) stays in
// every report next to it. Pure maths here (gpucost.test.mjs); `measureGpuCost` drives a page through `call(name, args)`
// (debugCall in browser.mjs).

export const GPU_COST_DEFAULTS = Object.freeze({ lo: 8, hi: 40, reps: 7, warmReps: 3 });

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

/** Median of finite numbers (mean of the two middle ones for an even count), or null for none. */
export function median(values) {
  const s = (values || []).filter(num).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** (max - min) / median of finite numbers: 0.1 is a 10 percent spread. Null for fewer than 2 values or a zero median. */
export function spread(values) {
  const s = (values || []).filter(num);
  if (s.length < 2) return null;
  const m = median(s);
  if (!m) return null;
  return (Math.max(...s) - Math.min(...s)) / m;
}

/**
 * The cost per frame from bench runs: `lo` and `hi` are arrays of wall ms for runs of `nLo` and `nHi` frames (the same
 * index is one interleaved pair). Returns {ms, perFrameHi, fixedMs, spread, pairs} or null when there is no usable pair or
 * the slope is not positive.
 */
export function benchCost(lo, hi, nLo, nHi) {
  if (!(nHi > nLo) || !Array.isArray(lo) || !Array.isArray(hi)) return null;
  const mLo = median(lo);
  const mHi = median(hi);
  if (mLo == null || mHi == null) return null;
  const ms = (mHi - mLo) / (nHi - nLo);
  if (!(ms > 0)) return null;
  const pairs = [];
  for (let i = 0; i < Math.min(lo.length, hi.length); i++) if (num(lo[i]) && num(hi[i])) pairs.push((hi[i] - lo[i]) / (nHi - nLo));
  const sp = spread(pairs);
  return { ms: r3(ms), perFrameHi: r3(mHi / nHi), fixedMs: r2(mLo - ms * nLo), spread: sp == null ? null : r3(sp), pairs: pairs.map(r3) };
}

/**
 * Summary of repeated measurements of the same build (the acceptance check: 5 runs, spread under 10 percent). `values` are
 * gpuCost.ms numbers. Returns {n, median, min, max, spread} or null.
 */
export function runSpread(values) {
  const s = (values || []).filter(num);
  if (!s.length) return null;
  return { n: s.length, median: r2(median(s)), min: r2(Math.min(...s)), max: r2(Math.max(...s)), spread: s.length > 1 ? r3(spread(s)) : null };
}

/** Relative change of a cost against a baseline cost (-0.15 is a 15 percent cut), or null. */
export function costChange(ms, baseMs) {
  return num(ms) && num(baseMs) && baseMs > 0 ? r3((ms - baseMs) / baseMs) : null;
}

/**
 * Measure the stable GPU cost on a page that is already staged and settled. `call(name, args)` runs a debug API call and
 * resolves {ok, value|error} (browser.mjs debugCall bound to the page). Returns {ms, perFrameHi, fixedMs, spread, pairs,
 * lo, hi, reps} or {error}.
 */
export async function measureGpuCost(call, o = {}) {
  const { lo, hi, reps, warmReps } = { ...GPU_COST_DEFAULTS, ...o };
  const bench = async (n, r) => {
    const v = await call('gpuBench', [{ n, reps: r }]);
    if (!v.ok) throw new Error(v.error);
    if (!Array.isArray(v.value) || v.value.length !== r) throw new Error(`gpuBench returned ${JSON.stringify(v.value)} (a build without debug.gpuBench, or no scene)`);
    return v.value;
  };
  try {
    await bench(hi, warmReps);
    const tLo = [];
    const tHi = [];
    for (let i = 0; i < reps; i++) {
      tLo.push((await bench(lo, 1))[0]);
      tHi.push((await bench(hi, 1))[0]);
    }
    const c = benchCost(tLo, tHi, lo, hi);
    if (!c) return { error: `no positive slope (lo ${tLo.join(',')}; hi ${tHi.join(',')})` };
    return { ...c, lo, hi, reps };
  } catch (e) {
    return { error: `gpuBench: ${String(e && e.message ? e.message : e)}` };
  }
}

/** "gpu cost 7.42 ms" for messages, or "gpu cost n/a (why)". */
export function gpuCostText(perf) {
  const c = perf?.gpuCost;
  if (!c || !num(c.ms)) return `gpu cost n/a${c?.error ? ` (${c.error})` : ''}`;
  return `gpu cost ${c.ms.toFixed(2)} ms`;
}
