// Pure parts of the architecture bench runner (harness/bench/arch.mjs) and the shape of the render plan.
import { describe, it, expect } from 'vitest';
import { parseArgs, engineArgs, perfRow, hostLoad } from './arch.mjs';
import plan from './render.plan.mjs';

describe('arch.mjs args', () => {
  it('reads the bench name and the flags', () => {
    expect(parseArgs(['render'])).toMatchObject({ name: 'render', only: null, group: null, list: false, keep: false });
    expect(parseArgs(['render', '--only', 'a,b', '--window', '2500', '--keep'])).toMatchObject({ name: 'render', only: ['a', 'b'], windowMs: 2500, keep: true });
    expect(parseArgs(['--list', 'render', '--group', 'aa'])).toMatchObject({ name: 'render', list: true, group: ['aa'] });
  });

  it('runs on Vulkan with vsync off unless the setup names another driver', () => {
    expect(engineArgs({})).toEqual(['--rendering-driver', 'vulkan', '--disable-vsync']);
    expect(engineArgs({ driver: 'metal', engine: ['--rendering-method', 'mobile'] })).toEqual(['--rendering-driver', 'metal', '--disable-vsync', '--rendering-method', 'mobile']);
  });
});

describe('arch.mjs rows', () => {
  it('turns a debug.perf answer into the report row', () => {
    const row = perfRow({ frameMs: { p50: 8.333, p95: 9.127, max: 12 }, cpuMs: { p95: 1.234 }, gpuMs: { p50: 6.1, p95: 6.456 }, avgFps: 119.96,
      drawCalls: 1500, triangles: 1000000, drawCallsAvg: 1490.4, trianglesAvg: 990000.2, gpuMB: 300.71, textureMB: 216.5, bufferMB: 72.6, frames: 360 });
    expect(row).toMatchObject({ frameP50: 8.33, frameP95: 9.13, cpuP95: 1.23, gpuP95: 6.46, gpuP50: 6.1, fps: 120, drawCalls: 1500, primitives: 1000000, videoMB: 300.7, frames: 360 });
  });

  it('has no GPU time on a driver that reports none', () => {
    expect(perfRow({ frameMs: { p50: 8, p95: 9, max: 10 }, cpuMs: { p95: 1 } }).gpuP95).toBe(null);
  });

  it('reports the host load per core', () => {
    const l = hostLoad();
    expect(l.cores).toBeGreaterThan(0);
    expect(l.perCore).toBeCloseTo(l.avg1 / l.cores, 1);
  });
});

describe('render plan', () => {
  const ids = plan.setups.map((s) => s.id);

  it('has unique setup ids, each with tokens and at least one camera path', () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of plan.setups) {
      expect(s.tokens, s.id).toBeTruthy();
      expect(s.paths.length, s.id).toBeGreaterThan(0);
      expect(s.option, s.id).toBeTruthy();
    }
  });

  it('covers every MUST setup of P0-016', () => {
    for (const id of ['r1_base', 'i1', 'i2', 'i3', 'ld1_on', 'ld_off', 'oc_open_on', 'oc_open_off', 'oc_lane_on', 'oc_lane_off', 'l1', 'l2_sdfgi',
      'a1_taa_1080', 'a2_fsr2_1080', 'm_metalfx_1620', 'tx1_vram', 'tx3_lossless', 'an1', 'an2', 'kit_multimesh', 'kit_merged']) {
      expect(ids, id).toContain(id);
    }
  });

  it('lists what it does not measure with a reason', () => {
    for (const n of plan.notMeasured) expect(n.reason, n.id).toBeTruthy();
  });
});
