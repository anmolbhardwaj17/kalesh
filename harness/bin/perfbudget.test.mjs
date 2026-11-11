import { describe, it, expect } from 'vitest';
import { normalize, judgeBudgets, loadBudgets, sceneLimits } from './perfbudget.mjs';

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

  // The block game/debug/debug_server.gd perf(ms) answers on Godot: cpuMs and gpuMs stats, p95FrameMs a number, gpuMB video memory.
  const godotPerf = (over = {}) => ({
    windowMs: 3000, frames: 360, cpuMs: { p50: 0.2, p95: 0.3, max: 0.5 }, p95FrameMs: 8.4, avgFps: 120, drawCalls: 18, drawCallsAvg: 18,
    triangles: 116, trianglesAvg: 116, gpuMB: 90, textureMB: 20, bufferMB: 10, renderer: 'Apple M2 Pro (Apple8)', ...over,
  });

  it('reads a Godot perf block: cpuMs, p95FrameMs, drawCalls, triangles, gpuMB', () => {
    const budgets = normalize({ presets: { default: { gpuMB: { warn: 64, fail: 256 }, triangles: { warn: 100, fail: 1000 } } } });
    const ok = judgeBudgets({ perf: godotPerf(), budgets });
    expect(ok.frame.level).toBe('ok');
    expect(ok.fails).toEqual([]);
    expect(ok.warnings.join()).toMatch(/GPU memory 90 MB/);
    expect(ok.warnings.join()).toMatch(/triangles 116/);
    expect(judgeBudgets({ perf: godotPerf({ gpuMB: 300 }), budgets }).fails.join()).toMatch(/GPU memory/);
    expect(judgeBudgets({ perf: godotPerf({ cpuMs: { p50: 20, p95: 30, max: 40 } }), budgets }).fails.join()).toMatch(/frame time/);
  });

  it('judges Godot gpuMs when the Vulkan driver reports it, and works without it on Metal', () => {
    const slow = godotPerf({ gpuMs: { p50: 20, p95: 30, max: 40 }, p95FrameMs: 31, avgFps: 32 });
    expect(judgeBudgets({ perf: slow }).fails.join()).toMatch(/gpu p95/);
    expect(judgeBudgets({ perf: godotPerf({ gpuNote: 'the renderer reported no GPU time' }) }).frame.bound).toBe('cpu');
  });
});

describe('scene kind (look or city)', () => {
  // The signed numbers: look 600 / 1,000 draw calls, city 2,500 / 3,500.
  const kinds = normalize({
    presets: { default: { drawCalls: { warn: 600, fail: 1000 } } },
    scenes: { look: { drawCalls: { warn: 600, fail: 1000 } }, city: { drawCalls: { warn: 2500, fail: 3500 }, triangles: { warn: 6e6, fail: 9e6 } } },
  });
  const calls = (n, extra = {}) => judgeBudgets({ perf: perf(8, { drawCalls: n }), budgets: kinds, ...extra });

  it('judges a city scene with the city draw calls', () => {
    const warn = calls(2600, { sceneKind: 'city' });
    expect(warn.fails).toEqual([]);
    expect(warn.warnings.join()).toMatch(/draw calls 2600 is over the warn budget 2500/);
    expect(calls(3600, { sceneKind: 'city' }).fails.join()).toMatch(/draw calls 3600 is over the fail budget 3500/);
    expect(calls(2400, { sceneKind: 'city' })).toMatchObject({ fails: [], warnings: [], sceneKind: 'city' });
  });

  it('judges a look scene with the look draw calls', () => {
    expect(calls(700, { sceneKind: 'look' }).warnings.join()).toMatch(/draw calls 700 is over the warn budget 600/);
    expect(calls(1100, { sceneKind: 'look' }).fails.join()).toMatch(/draw calls 1100 is over the fail budget 1000/);
  });

  it('judges a scene with no kind as look', () => {
    expect(calls(700).warnings.join()).toMatch(/over the warn budget 600/);
    expect(calls(1100).fails.join()).toMatch(/over the fail budget 1000/);
    expect(calls(700).sceneKind).toBe('look');
    expect(calls(2600).fails.join()).toMatch(/draw calls 2600 is over the fail budget 1000/);
  });

  it('reads the kind from the scenario `scene`, and a scenario budget still overrides', () => {
    expect(calls(2600, { scenario: { scene: 'city' } }).warnings.join()).toMatch(/warn budget 2500/);
    expect(calls(3000, { scenario: { scene: 'city', budget: { drawCalls: { warn: 4000, fail: 5000 } } } })).toMatchObject({ fails: [], warnings: [] });
    expect(calls(2600, { sceneKind: 'look', scenario: { scene: 'city' } }).fails.join()).toMatch(/fail budget 1000/);
  });

  it('judges an unknown kind as look and says so', () => {
    const r = calls(700, { sceneKind: 'moon' });
    expect(r.sceneKind).toBe('look');
    expect(r.warnings.join()).toMatch(/scene kind "moon"/);
  });

  it('keeps frame time, fps floor and load the same for both kinds', () => {
    for (const sceneKind of ['look', 'city']) {
      expect(judgeBudgets({ perf: perf(25), budgets: kinds, sceneKind }).fails.join()).toMatch(/frame time/);
      expect(judgeBudgets({ loadMs: 99999, budgets: kinds, sceneKind }).fails.join()).toMatch(/load time/);
    }
  });

  it('falls back to the presets when the file has no scenes block, and the city triangles come from the block', () => {
    expect(sceneLimits(normalize(null), 'city').drawCalls).toEqual({ warn: 400, fail: 1000 });
    expect(sceneLimits(kinds, 'city').triangles.fail).toBe(9e6);
  });

  it('the signed perf_budgets.json has look 600 / 1,000 and city 2,500 / 3,500', () => {
    const b = loadBudgets();
    expect(b.scenes.look.drawCalls).toEqual({ warn: 600, fail: 1000 });
    expect(b.scenes.city.drawCalls).toEqual({ warn: 2500, fail: 3500 });
    expect(judgeBudgets({ perf: perf(8, { drawCalls: 2600 }), budgets: b, sceneKind: 'city' }).warnings.join()).toMatch(/draw calls/);
    expect(judgeBudgets({ perf: perf(8, { drawCalls: 3600 }), budgets: b, sceneKind: 'city' }).fails.join()).toMatch(/draw calls/);
    expect(judgeBudgets({ perf: perf(8, { drawCalls: 1100 }), budgets: b }).fails.join()).toMatch(/draw calls/);
  });
});
