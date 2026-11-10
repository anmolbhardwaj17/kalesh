import { describe, expect, it } from 'vitest';
import { GPU_COST_DEFAULTS, benchCost, costChange, gpuCostText, measureGpuCost, median, runSpread, spread } from './gpucost.mjs';

describe('median and spread', () => {
  it('median of odd and even counts, ignoring non numbers', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([5, null, NaN, 'x', 1, 3])).toBe(3);
    expect(median([])).toBeNull();
    expect(median(undefined)).toBeNull();
  });
  it('spread is (max - min) / median', () => {
    expect(spread([9, 10, 11])).toBeCloseTo(0.2, 10);
    expect(spread([10, 10, 10, 10])).toBe(0);
    expect(spread([10])).toBeNull();
    expect(spread([0, 0])).toBeNull();
  });
});

describe('benchCost', () => {
  // A run of n frames takes fixed + n * cost ms (the two syncs and pipeline fill are the fixed part).
  const run = (n, cost, fixed) => fixed + n * cost;
  it('is the slope between the median times, so the fixed part of a run drops out', () => {
    const lo = [run(8, 5, 8.6), run(8, 5, 8.6), run(8, 5, 8.6)];
    const hi = [run(40, 5, 8.6), run(40, 5, 8.6), run(40, 5, 8.6)];
    const c = benchCost(lo, hi, 8, 40);
    expect(c.ms).toBe(5);
    expect(c.fixedMs).toBe(8.6);
    expect(c.perFrameHi).toBe(5.215); // the naive time / n reads 4 percent high
    expect(c.spread).toBe(0);
    expect(c.pairs).toEqual([5, 5, 5]);
  });
  it('one slow run does not move the median, and the pair spread shows it', () => {
    const lo = [48.6, 48.4, 48.8, 48.6, 48.5];
    const hi = [208.6, 208.2, 300, 209, 208.7];
    const c = benchCost(lo, hi, 8, 40);
    expect(c.ms).toBe(5.003); // (208.7 - 48.6) / 32
    expect(c.spread).toBeGreaterThan(0.5);
  });
  it('a cut in the scene shows in full', () => {
    const before = benchCost([run(8, 8, 3)], [run(40, 8, 3)], 8, 40).ms;
    const after = benchCost([run(8, 6.8, 3)], [run(40, 6.8, 3)], 8, 40).ms;
    expect(costChange(after, before)).toBe(-0.15);
  });
  it('is null without usable runs or a positive slope', () => {
    expect(benchCost([], [], 8, 40)).toBeNull();
    expect(benchCost([50], [40], 8, 40)).toBeNull();
    expect(benchCost([50], [90], 40, 8)).toBeNull();
    expect(benchCost(null, [90], 8, 40)).toBeNull();
  });
});

describe('runSpread and costChange', () => {
  it('summarises repeated runs of one build', () => {
    expect(runSpread([10, 10.4, 9.8, 10.1, 10.2])).toEqual({ n: 5, median: 10.1, min: 9.8, max: 10.4, spread: 0.059 });
    expect(runSpread([7]).spread).toBeNull();
    expect(runSpread([])).toBeNull();
  });
  it('relative change against a baseline', () => {
    expect(costChange(8.5, 10)).toBe(-0.15);
    expect(costChange(11, 10)).toBe(0.1);
    expect(costChange(null, 10)).toBeNull();
    expect(costChange(5, 0)).toBeNull();
  });
});

describe('measureGpuCost', () => {
  // A fake page: a run of n draws takes fixed + n * cost ms; `slowRun` makes one high run 3 times slower.
  const fakePage = ({ cost = 7, fixed = 4, slowRun = -1, bench = true, fail = false } = {}) => {
    const calls = [];
    let runs = 0;
    const call = async (name, args) => {
      calls.push([name, JSON.parse(JSON.stringify(args))]);
      if (fail) return { ok: false, error: 'boom' };
      if (name !== 'gpuBench') return { ok: false, error: 'unknown' };
      if (!bench) return { ok: true, value: null };
      const { n, reps } = args[0];
      return { ok: true, value: Array.from({ length: reps }, () => (fixed + n * cost) * (runs++ === slowRun ? 3 : 1)) };
    };
    return { call, calls };
  };
  it('warms up, then measures interleaved low and high runs', async () => {
    const p = fakePage({ cost: 7, fixed: 4 });
    const c = await measureGpuCost(p.call);
    expect(c.ms).toBe(7);
    expect(c.fixedMs).toBe(4);
    expect(c.pairs).toHaveLength(GPU_COST_DEFAULTS.reps);
    const { lo, hi, reps, warmReps } = GPU_COST_DEFAULTS;
    expect(p.calls[0]).toEqual(['gpuBench', [{ n: hi, reps: warmReps }]]);
    expect(p.calls.slice(1, 3)).toEqual([['gpuBench', [{ n: lo, reps: 1 }]], ['gpuBench', [{ n: hi, reps: 1 }]]]);
    expect(p.calls).toHaveLength(1 + 2 * reps);
  });
  it('the warm up is not counted and one slow run does not move the result', async () => {
    expect((await measureGpuCost(fakePage({ slowRun: 0 }).call)).ms).toBe(7);
    expect((await measureGpuCost(fakePage({ slowRun: 3 + 4 }).call)).ms).toBe(7);
  });
  it('a build without the bench or a failing call is an error, not a number', async () => {
    expect((await measureGpuCost(fakePage({ bench: false }).call)).error).toMatch(/a build without debug.gpuBench/);
    expect((await measureGpuCost(fakePage({ fail: true }).call)).error).toBe('gpuBench: boom');
  });
});

describe('gpuCostText', () => {
  it('formats the cost or says why it is missing', () => {
    expect(gpuCostText({ gpuCost: { ms: 7.4 } })).toBe('gpu cost 7.40 ms');
    expect(gpuCostText({})).toBe('gpu cost n/a');
    expect(gpuCostText({ gpuCost: { error: 'gpuBench: boom' } })).toBe('gpu cost n/a (gpuBench: boom)');
  });
});
