import { describe, expect, it } from 'vitest';
import { frameTimeGate, gateLabel, machineLoad, perfSummary, perfTable, stableGpuMs } from './perfgate.mjs';

// A perf block as debug.perf returns it. rAF p95 16.7 ms and 60 fps (frames held) unless `extra` says otherwise.
const block = (cpuP95, gpuP95, extra = {}) => ({
  cpuMs: { p50: cpuP95 / 2, p95: cpuP95, max: cpuP95 * 1.5, n: 300 },
  gpuMs: gpuP95 == null ? null : { p50: gpuP95 / 2, p95: gpuP95, max: gpuP95 * 1.2, n: 290 },
  gpuNote: gpuP95 == null ? 'gpu timer unavailable: EXT_disjoint_timer_query_webgl2 is not exposed by this browser' : null,
  avgFps: 60, p95FrameMs: 16.7, drawCalls: 200, triangles: 500000, load: { avg1: 3, cores: 12 }, ...extra,
});
const idle = { avg1: 2.1, cores: 12 };
const busy = { avg1: 15.3, cores: 12 };

describe('frameTimeGate', () => {
  it('passes, and warns over 16.6 ms on the slower of CPU and GPU', () => {
    expect(frameTimeGate(block(6, 9)).level).toBe('ok');
    expect(frameTimeGate(block(6, 9)).bound).toBe('gpu');
    expect(frameTimeGate(block(17, 4)).level).toBe('warn');
    expect(frameTimeGate(block(17, 4)).reason).toBe('budget');
    expect(frameTimeGate(block(5, 20)).reason).toBe('budget');
  });
  it('CPU p95 over 22 ms is a hard fail even with frames held', () => {
    const g = frameTimeGate(block(23, 5));
    expect(g.level).toBe('fail');
    expect(g.reason).toBe('cpu');
    expect(g.message).toMatch(/cpu p95 23\.0 ms is over the 22 ms limit/);
  });
  it('GPU timer over 22 ms with 60 fps held only warns (GPU overlap or contention)', () => {
    // The den_high_dpr2 case from the first verifier run: gpu p95 40.2 ms, rAF p95 17.7 ms.
    const g = frameTimeGate(block(7, 40.2, { p95FrameMs: 17.7, avgFps: 59.8 }));
    expect(g.level).toBe('warn');
    expect(g.reason).toBe('gpu_overlap');
    expect(g.message).toMatch(/gpu timer over budget but 60 fps held \(GPU overlap or contention\)/);
    expect(gateLabel(block(7, 40.2))).toBe('warn (gpu overlap)');
  });
  it('GPU over 22 ms fails when frames really drop: rAF p95 over 22 ms or fps under 45', () => {
    const raf = frameTimeGate(block(7, 30, { p95FrameMs: 33.4, avgFps: 50 }));
    expect(raf.level).toBe('fail');
    expect(raf.reason).toBe('gpu');
    expect(raf.message).toMatch(/frames dropped/);
    const fps = frameTimeGate(block(7, 30, { p95FrameMs: 20, avgFps: 40 }));
    expect(fps.level).toBe('fail');
    expect(fps.reason).toBe('gpu');
  });
  it('a strict run (HARNESS_PERF_STRICT=1) fails the GPU limit alone', () => {
    expect(frameTimeGate(block(7, 30, { strict: true })).level).toBe('fail');
    expect(frameTimeGate(block(7, 30, { strict: true })).message).toMatch(/strict GPU limit/);
    expect(frameTimeGate(block(7, 30), { strict: true }).level).toBe('fail');
    expect(frameTimeGate(block(7, 30)).level).toBe('warn');
  });
  it('average fps under 45 fails on its own (the old floor)', () => {
    const g = frameTimeGate(block(6, 9, { avgFps: 38, p95FrameMs: 30 }));
    expect(g.level).toBe('fail');
    expect(g.reason).toBe('fps');
  });
  it('judges the CPU alone when the GPU timer is unavailable, and says so', () => {
    const g = frameTimeGate(block(12, null));
    expect(g.level).toBe('ok');
    expect(g.bound).toBe('cpu');
    expect(g.message).toMatch(/gpu p95 n\/a \(gpu timer unavailable/);
  });
  it('fails a block with no CPU samples, even on a loaded machine', () => {
    expect(frameTimeGate({ avgFps: 60 }).level).toBe('fail');
    expect(frameTimeGate(null).level).toBe('fail');
    expect(frameTimeGate({ avgFps: 60, load: busy }).reason).toBe('no_data');
  });
});

describe('load downgrade', () => {
  it('reads the load per core', () => {
    expect(machineLoad(block(5, 5, { load: busy })).loaded).toBe(true);
    expect(machineLoad(block(5, 5, { load: idle })).loaded).toBe(false);
    expect(machineLoad(block(5, 5, { load: { avg1: 12.5, cores: 12 } })).loaded).toBe(true);
    expect(machineLoad({})).toBe(null);
  });
  it('downgrades a CPU fail on a loaded machine to a not judged warning', () => {
    const g = frameTimeGate(block(25, 5, { load: busy }));
    expect(g.level).toBe('warn');
    expect(g.reason).toBe('loaded');
    expect(g.downgraded).toBe('cpu');
    expect(g.message).toMatch(/^not judged: machine loaded \(load 15\.3 on 12 cores/);
    expect(gateLabel(block(25, 5, { load: busy }))).toBe('not judged (loaded)');
  });
  it('downgrades a GPU fail with dropped frames on a loaded machine', () => {
    const g = frameTimeGate(block(7, 30, { p95FrameMs: 33, avgFps: 40, load: busy }));
    expect(g.level).toBe('warn');
    expect(g.downgraded).toBe('gpu');
  });
  it('downgrades a strict GPU fail and an fps floor fail on a loaded machine', () => {
    expect(frameTimeGate(block(7, 30, { strict: true, load: busy })).downgraded).toBe('gpu');
    expect(frameTimeGate(block(6, 9, { avgFps: 38, load: busy })).downgraded).toBe('fps');
  });
  it('keeps the fail on an idle machine and when no load was recorded', () => {
    expect(frameTimeGate(block(25, 5, { load: idle })).level).toBe('fail');
    expect(frameTimeGate(block(25, 5, { load: undefined })).level).toBe('fail');
  });
  it('never downgrades the slow frame control, so the control still fails under load', () => {
    const g = frameTimeGate(block(26.2, 7, { slowFrameMs: 25, load: busy }));
    expect(g.level).toBe('fail');
    expect(g.reason).toBe('cpu');
    expect(g.message).toMatch(/over the 22 ms limit \(45 fps\).*slow frame control on: 25 ms busy loop/);
  });
  it('leaves ok and warn verdicts alone on a loaded machine', () => {
    expect(frameTimeGate(block(6, 9, { load: busy })).level).toBe('ok');
    expect(frameTimeGate(block(7, 40, { load: busy })).reason).toBe('gpu_overlap');
  });
});

describe('perf summary and table', () => {
  it('keeps ms first, fps second, and stores load and the gate reason', () => {
    const s = perfSummary(block(8, 10, { load: busy }));
    expect(s.frameGate).toBe('ok');
    expect(s.frameP95).toBe(10);
    expect(s.fps).toBe(60);
    expect(s.rafP95).toBe(16.7);
    expect(s.load).toEqual({ avg1: 15.3, cores: 12, loaded: true });
    const d = perfSummary(block(25, 5, { load: busy }));
    expect(d.gateReason).toBe('loaded');
    expect(d.gateLabel).toBe('not judged (loaded)');
  });
  it('puts the gate right after the name and the load last', () => {
    const lines = perfTable([{ name: 'den_high_dpr2', perf: block(8, null, { load: busy }) }, { name: 'street_high_dpr2', perf: block(5, 30) }]);
    expect(lines[0]).toMatch(/scenario\s+gate\s+cpu ms p50\/p95\/max\s+gpu cost\s+raw gpu p50\/p95\/max\s+rAF p95\s+fps\s+calls\s+load/);
    expect(lines[1]).toMatch(/den_high_dpr2\s+ok\s+4\.0 \/ 8\.0 \/ 12\.0\s+-\s+unavailable\s+16\.7\s+60\.0\s+200\s+load 15\.3 \/ 12 cores/);
    expect(lines[2]).toMatch(/street_high_dpr2\s+warn \(gpu overlap\)/);
    expect(lines[3]).toMatch(/gpu: gpu timer unavailable/);
  });
});

describe('stable GPU cost in the gate (P2B-102)', () => {
  const cost = (ms) => ({ gpuCost: { ms, perFrameHi: ms * 1.04, fixedMs: 3, spread: 0.03, pairs: [] } });
  it('uses the stable cost instead of the raw p95 as the GPU number', () => {
    expect(stableGpuMs(block(5, 19, cost(9.2)))).toBe(9.2);
    expect(stableGpuMs(block(5, 19))).toBeNull();
    expect(stableGpuMs(block(5, 19, { gpuCost: { error: 'no GPU timer results under stress' } }))).toBeNull();
    // A raw p95 of 19 ms (a clocked down GPU) warned; the stable cost 9.2 ms is under budget.
    expect(frameTimeGate(block(5, 19)).reason).toBe('budget');
    const g = frameTimeGate(block(5, 19, cost(9.2)));
    expect(g.level).toBe('ok');
    expect(g.p95).toBe(9.2);
    expect(g.bound).toBe('gpu');
    expect(g.gpuSource).toBe('cost');
    expect(g.message).toMatch(/gpu cost 9\.20 ms \(stable\), gpu p95 19\.0 ms \(raw\)/);
    // CPU over the stable cost is CPU bound.
    expect(frameTimeGate(block(12, 19, cost(9.2))).bound).toBe('cpu');
  });
  it('warns over 16.6 ms and fails over 22 ms on its own, frames held or not', () => {
    expect(frameTimeGate(block(5, 30, cost(17.5))).reason).toBe('budget');
    expect(frameTimeGate(block(5, 30, cost(17.5))).message).toMatch(/stable gpu cost 17\.5 ms/);
    const f = frameTimeGate(block(5, 30, cost(23)));
    expect(f.level).toBe('fail');
    expect(f.reason).toBe('gpu');
    expect(f.message).toMatch(/stable gpu cost 23\.00 ms is over the 22 ms limit/);
    // A raw p95 over 22 ms with a stable cost under it is not GPU overlap any more: it is the clock.
    expect(frameTimeGate(block(5, 30, cost(12))).level).toBe('ok');
  });
  it('a fail is still not judged on a loaded machine', () => {
    const g = frameTimeGate(block(5, 30, { ...cost(23), load: busy }));
    expect(g.level).toBe('warn');
    expect(g.downgraded).toBe('gpu');
  });
  it('the summary and the table carry the cost', () => {
    expect(perfSummary(block(5, 19, cost(9.2))).gpuCost).toEqual({ ms: 9.2, spread: 0.03 });
    expect(perfSummary(block(5, 19, { gpuCost: { error: 'x' } })).gpuCost).toEqual({ error: 'x' });
    expect(perfSummary(block(5, 19)).gpuCost).toBeNull();
    expect(perfTable([{ name: 'den_high_dpr2', perf: block(5, 19, cost(9.2)) }])[1]).toMatch(/den_high_dpr2\s+ok\s+2\.5 \/ 5\.0 \/ 7\.5\s+9\.20\s+9\.5 \/ 19\.0/);
  });
});

describe('runOrder (P2-182)', () => {
  it('runs perf scenarios first and alone, the pool next and the art bench last', async () => {
    const { runOrder } = await import('./perfgate.mjs');
    const list = [{ name: 'a' }, { name: 'art_bench' }, { name: 'den_high_dpr2', perf: true }, { name: 'b' }, { name: 'test_scene', perf: true }];
    const o = runOrder(list, { measures: (s) => !!s.perf, solo: (s) => !!s.perf || s.name === 'art_bench' });
    expect(o.perf.map((s) => s.name)).toEqual(['den_high_dpr2', 'test_scene']);
    expect(o.pool.map((s) => s.name)).toEqual(['a', 'b']);
    expect(o.after.map((s) => s.name)).toEqual(['art_bench']);
    // --quick measures no perf: perf scenarios join the pool.
    const q = runOrder(list, { measures: () => false, solo: (s) => s.name === 'art_bench' });
    expect(q.perf).toEqual([]);
    expect(q.pool.map((s) => s.name)).toEqual(['a', 'den_high_dpr2', 'b', 'test_scene']);
  });
});

describe('repeatList (P1-040)', () => {
  it('repeats perf and solo scenarios too, and runOrder still runs those alone', async () => {
    const { repeatList, runOrder } = await import('./perfgate.mjs');
    const list = [{ name: 'a' }, { name: 'stream_200', perf: true, solo: true }];
    const r = repeatList(list, 3);
    expect(r.map((s) => s.name)).toEqual(['a#1', 'a#2', 'a#3', 'stream_200#1', 'stream_200#2', 'stream_200#3']);
    expect(r.every((s) => s.baseName === s.name.split('#')[0])).toBe(true);
    const o = runOrder(r, { measures: (s) => !!s.perf, solo: (s) => !!s.perf || !!s.solo });
    expect(o.perf.map((s) => s.name)).toEqual(['stream_200#1', 'stream_200#2', 'stream_200#3']);
    expect(o.pool.map((s) => s.name)).toEqual(['a#1', 'a#2', 'a#3']);
    expect(repeatList(list, 0)).toBe(list);
  });
});
