import { describe, it, expect } from 'vitest';
import { normalize, judgeBudgets } from './perfbudget.mjs';

const perf = (p95, extra = {}) => ({ cpuMs: { p50: p95 * 0.8, p95, max: p95 * 1.2 }, p95FrameMs: p95, avgFps: 1000 / Math.max(p95, 16.7), drawCalls: 100, triangles: 100000, ...extra });

describe('perf budgets', () => {
  const b = normalize({ frameMs: { warn: 10, fail: 20 }, loadMs: { warn: 1000, fail: 3000 }, presets: { default: { drawCalls: { warn: 150, fail: 300 } } } });

  it('passes a page inside every budget', () => {
    const r = judgeBudgets({ perf: perf(8), loadMs: 500, budgets: b });
    expect(r.fails).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('fails a frame time over the fail budget and warns between warn and fail', () => {
    expect(judgeBudgets({ perf: perf(25), budgets: b }).fails.join()).toMatch(/frame time/);
    expect(judgeBudgets({ perf: perf(12), budgets: b }).warnings.join()).toMatch(/frame time/);
  });

  it('judges load time and draw calls', () => {
    expect(judgeBudgets({ loadMs: 4000, budgets: b }).fails.join()).toMatch(/load time/);
    expect(judgeBudgets({ perf: perf(8, { drawCalls: 200 }), budgets: b }).warnings.join()).toMatch(/draw calls/);
    expect(judgeBudgets({ perf: perf(8, { drawCalls: 400 }), budgets: b }).fails.join()).toMatch(/draw calls/);
  });

  it('never judges frame time on software GL', () => {
    expect(judgeBudgets({ perf: perf(80), budgets: b, software: true }).fails).toEqual([]);
  });

  it('lets a scenario override one budget', () => {
    const r = judgeBudgets({ perf: perf(8, { drawCalls: 400 }), budgets: b, scenario: { budget: { drawCalls: { warn: 500, fail: 900 } } } });
    expect(r.fails).toEqual([]);
  });

  it('falls back to defaults with no file', () => {
    const d = normalize(null);
    expect(d.frameMsFail).toBe(22);
    expect(judgeBudgets({ perf: perf(10), budgets: d }).fails).toEqual([]);
  });
});
