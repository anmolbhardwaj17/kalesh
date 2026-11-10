// GPU readings under the 120 fps cap (P0-016 found it, P0-039 moved the tools to it).
//
// Why: since 2026-11-11 a Godot window on this Mac runs at 120 fps at most even with vsync off (Vulkan and Metal). Under
// the cap the GPU clocks down to fill the 8.33 ms frame, so any scene cheaper than about 7 ms reads 6 to 7 ms of `gpuMs`
// whatever it costs (the look B stack over empty ground reads 6.6 ms and costs 3.6 ms). A plain reading is the idle frame.
//
// The method: keep the GPU busy with a ballast (game/debug/gpu_ballast.gd, debug hook bench('ballast', {n}): a constant
// shader load in an offscreen viewport, sized so a frame with no 3D takes 12 to 20 ms) and read the root viewport's GPU
// time with the ballast on: `gpuP95`, the scene's cost at full clock (Vulkan only). Cross-check from frame times, which
// also works on Metal (no GPU timer there): `frameCostP50` = a ballast frame with the scene minus the ballast alone
// (bench('blank', {on}) switches the root viewport's 3D off). The plain window stays in the numbers as `gpuMsCapped`.
//
// Used by harness/bench/arch.mjs (calibrate and blank), lookproof.mjs --perf and verify.mjs perf scenarios (ballastPerf,
// which puts the result in perf.gpuCost, the number perfgate.mjs judges). Pure maths in ballastCost (ballast.test.mjs).

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (v, d = 2) => (num(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

/** Frame p50 under which a ballast frame is not GPU bound, and over which it is wastefully long. */
export const BALLAST_FRAME_MS = { min: 12, max: 20, aim: 15 };

/**
 * The next ballast size from a frame p50 measured at size n with no 3D: null when it is in range, else the size to try.
 */
export function nextBallastSize(n, frameP50, { min, max, aim } = BALLAST_FRAME_MS) {
  if (!num(frameP50) || frameP50 <= 0) return Math.round(n * 1.5);
  if (frameP50 < min) return Math.round(n * Math.min(3, Math.max(1.5, aim / frameP50)));
  if (frameP50 > max) return Math.max(1, Math.round(n * (aim / frameP50)));
  return null;
}

/**
 * The cost of a scene from a window measured with the ballast on (`busy`, a debug.perf answer) and the ballast alone
 * (`blank`, a debug.perf answer with 3D off). Returns {ms, source, gpuP95, gpuP50, frameCostP50, frameCostP95, ...} where
 * `ms` is the GPU p95 with the ballast when the driver reports GPU time ('ballast-gpu'), else the frame cost p95
 * ('ballast-frame', Metal), or null when neither is there.
 */
export function ballastCost(busy, blank, n = null) {
  const gpuP95 = round(busy?.gpuMs?.p95);
  const gpuP50 = round(busy?.gpuMs?.p50);
  const frameP50 = round(busy?.frameMs?.p50);
  const frameP95 = round(busy?.frameMs?.p95);
  const blankP50 = round(blank?.frameMs?.p50);
  const blankP95 = round(blank?.frameMs?.p95);
  const costP50 = num(frameP50) && num(blankP50) ? round(frameP50 - blankP50) : null;
  const costP95 = num(frameP95) && num(blankP95) ? round(frameP95 - blankP95) : null;
  const fromGpu = num(gpuP95) && gpuP95 > 0;
  return {
    ms: fromGpu ? gpuP95 : costP95,
    source: fromGpu ? 'ballast-gpu' : num(costP95) ? 'ballast-frame' : null,
    gpuP95, gpuP50, frameCostP50: costP50, frameCostP95: costP95,
    ballastFrameP50: frameP50, ballastFrameP95: frameP95, blankFrameP50: blankP50, blankFrameP95: blankP95, n,
  };
}

/**
 * Finds a ballast size (shader iterations) that makes a frame with no 3D take 12 to 20 ms, so every measured frame is
 * GPU bound and longer than the display's refresh. `client.call(method, ...args)` is the debug client; `cache` is an
 * object that keeps sizes by `key` (driver and window size) so a run of views calibrates once.
 */
export async function calibrateBallast(client, cache = {}, key = 'default') {
  let n = cache[key] || 1200;
  await client.call('bench', 'blank', { on: true });
  try {
    for (let i = 0; i < 6; i++) {
      await client.call('bench', 'ballast', { n });
      await client.call('perf', 300);
      const f = (await client.call('perf', 700)).frameMs?.p50;
      const next = nextBallastSize(n, f);
      if (next == null) break;
      n = next;
    }
  } finally {
    await client.call('bench', 'ballast', { n: 0 });
    await client.call('bench', 'blank', { on: false });
  }
  cache[key] = n;
  return n;
}

/** The ballast alone: a window with the root viewport's 3D off. Returns the debug.perf answer. */
export async function measureBlank(client, n, { warmMs = 400, windowMs = 1200 } = {}) {
  await client.call('bench', 'blank', { on: true });
  try {
    await client.call('bench', 'ballast', { n });
    await client.call('perf', warmMs);
    return await client.call('perf', windowMs);
  } finally {
    await client.call('bench', 'ballast', { n: 0 });
    await client.call('bench', 'blank', { on: false });
  }
}

/**
 * Adds the ballast reading to a plain perf window of a staged, settled scene: calibrates (cached), measures a window with
 * the GPU kept busy and the ballast alone, then returns `{...plain, gpuCost, gpuMsCapped}`. `gpuCost` is
 * {ms, source, gpuP95, frameCostP50, ...} (ballastCost) and is what perfgate.mjs judges as the GPU number; `gpuMsCapped`
 * is the plain gpuMs, kept to show the trap. A failure keeps the plain window and sets gpuCost {error}. The ballast is
 * always switched off again.
 */
export async function ballastPerf(client, plain, { windowMs = 3000, cache = {}, key = 'default' } = {}) {
  try {
    const n = await calibrateBallast(client, cache, key);
    await client.call('bench', 'ballast', { n });
    await client.call('perf', 500);
    const busy = await client.call('perf', windowMs);
    await client.call('bench', 'ballast', { n: 0 });
    const blank = await measureBlank(client, n);
    const cost = ballastCost(busy, blank, n);
    return { ...plain, gpuMsCapped: plain.gpuMs ?? null, gpuCost: cost.ms != null ? cost : { error: 'no GPU time and no frame times from the ballast window' } };
  } catch (e) {
    try { await client.call('bench', 'ballast', { n: 0 }); await client.call('bench', 'blank', { on: false }); } catch { /* gone */ }
    return { ...plain, gpuCost: { error: `ballast: ${String(e && e.message ? e.message : e).split('\n')[0]}` } };
  }
}

/** "ballast gpu p95 7.4 ms, frame cost p50 7.1 ms" for reports, or the error. */
export function ballastText(c) {
  if (!c || c.ms == null) return `ballast n/a${c?.error ? ` (${c.error})` : ''}`;
  const g = num(c.gpuP95) ? `gpu p95 ${c.gpuP95.toFixed(1)} ms, ` : '';
  const f = num(c.frameCostP50) ? `frame cost p50 ${c.frameCostP50.toFixed(1)} ms` : 'no frame cost';
  return `ballast ${g}${f}`;
}
