import { describe, it, expect } from 'vitest';
import { perfMeta, checkPoses, sheetLabels, sheetCost } from './lookproof.mjs';

describe('lookproof perf.json header', () => {
  it('quotes the machine, Godot version, renderer, GPU adapter and load', () => {
    const m = perfMeta({
      kind: 'godot', browser: { version: '4.7.2.stable' }, gl: {},
      hello: { renderer: { method: 'forward_plus', driver: 'metal', adapter: 'Apple M2 Pro (Apple8)' } },
      load: { avg1: 3, cores: 12 },
    });
    expect(m.godotVersion).toBe('4.7.2.stable');
    expect(m.renderer).toBe('Forward+');
    expect(m.renderingDriver).toBe('metal');
    expect(m.gpuAdapter).toBe('Apple M2 Pro (Apple8)');
    expect(m.load).toEqual({ avg1: 3, cores: 12, perCore: 0.25 });
    expect(m.machine).toMatch(/cores/);
  });

  it('names Mobile for the mobile renderer', () => {
    expect(perfMeta({ kind: 'godot', hello: { renderer: { method: 'mobile' } } }).renderer).toBe('Mobile');
  });

  it('checks poses', () => {
    expect(checkPoses({ views: [{ name: 'a', steps: [] }] })).toEqual([]);
    expect(checkPoses({ views: [] })).toHaveLength(1);
  });
});

describe('lookproof sheet labels', () => {
  it('drops the prefix every set shares and keeps names short', () => {
    expect(sheetLabels(['style_stylised_b_dawn', 'style_stylised_b_night'])).toEqual(['dawn', 'night']);
    expect(sheetLabels(['baseline', 'style_stylised_grime_golden', 'style_stylised_b_dawn'])).toEqual(['baseline', 'grime golden', 'b dawn']);
    expect(sheetLabels(['baseline', 'other'])).toEqual(['baseline', 'other']);
    expect(sheetLabels(['style_a_x', 'style_b_x'])).toEqual(['a x', 'b x']);
    expect(sheetLabels(['a', 'b'], { a: 'Look A' })).toEqual(['Look A', 'b']);
  });

  it('quotes GPU p95 from Vulkan, never Metal CPU time as frame cost', () => {
    const metal = { rows: { v1: { cpuP95: 0.4, gpuP95: null, frameP95: 0.4 }, v2: { cpuP95: 0.9, gpuP95: null } } };
    const vk = { rows: { v1: { cpuP95: 0.5, gpuP95: 6.2 }, v2: { gpuP95: 7.9 } } };
    expect(sheetCost(vk, null)).toBe('GPU p95 7.9 ms');
    expect(sheetCost(metal, vk)).toBe('GPU p95 7.9 ms (Vulkan run)');
    expect(sheetCost(metal, null)).toBe('CPU p95 0.9 ms (no GPU timer)');
    expect(sheetCost(null, null)).toBe('no perf run');
  });
});

describe('perfRow', () => {
  const j = { fails: [], warnings: [], frame: { p95: 7.4 } };
  it('puts the ballast cost in the row and keeps the capped reading', async () => {
    const { perfRow } = await import('./lookproof.mjs');
    const perf = { cpuMs: { p95: 0.9 }, gpuMs: { p95: 6.6 }, gpuMsCapped: { p95: 6.6 }, avgFps: 119, drawCalls: 150, triangles: 1000,
      gpuCost: { ms: 7.4, source: 'ballast-gpu', gpuP95: 7.4, frameCostP50: 7.1, frameCostP95: 7.5, n: 900 } };
    expect(perfRow({ perf, j, loadMs: 1000, load: null })).toMatchObject({ gpuP95: 7.4, gpuP95Capped: 6.6, frameCostP50: 7.1, frameCostP95: 7.5, gpuCostMs: 7.4, ballastN: 900, frameP95: 7.4, verdict: 'ok' });
  });
  it('keeps the plain reading when no ballast ran', async () => {
    const { perfRow } = await import('./lookproof.mjs');
    expect(perfRow({ perf: { cpuMs: { p95: 0.9 }, gpuMs: { p95: 6.6 } }, j, loadMs: 1, load: null })).toMatchObject({ gpuP95: 6.6, gpuP95Capped: 6.6, gpuCostMs: null });
  });
});
