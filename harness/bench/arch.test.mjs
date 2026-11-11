// Pure parts of the architecture bench runner (harness/bench/arch.mjs) and the shape of the render plan.
import { describe, it, expect } from 'vitest';
import { parseArgs, engineArgs, perfRow, hostLoad, overrideText } from './arch.mjs';
import plan from './render.plan.mjs';
import physics, { summarise, line } from './physics.plan.mjs';

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

describe('arch.mjs project settings per run', () => {
  it('writes an override.cfg with sections and quoted values', () => {
    const text = overrideText({ physics: { '3d/physics_engine': 'Jolt Physics', '3d/run_on_separate_thread': true } });
    expect(text.startsWith('; written by harness/bench/arch.mjs')).toBe(true);
    expect(text).toContain('[physics]');
    expect(text).toContain('3d/physics_engine="Jolt Physics"');
    expect(text).toContain('3d/run_on_separate_thread=true');
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

describe('physics plan', () => {
  const ids = physics.setups.map((s) => s.id);

  it('has unique CPU-only setups, each with a test', () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of physics.setups) {
      expect(s.gpu, s.id).toBe(false);
      expect(s.test, s.id).toBeTruthy();
      expect(s.tokens, s.id).toBeTruthy();
      expect(typeof physics.extra[s.id], s.id).toBe('function');
    }
  });

  it('covers every MUST item of P0-017', () => {
    for (const id of ['engine_default', 'engine_jolt', 'engine_godot', 'clock', 'vehicle_v1', 'vehicle_v2', 'vehicle_auto', 'colliders', 'onfoot', 'combat',
      'agents', 'traffic_v2', 'far_vehicle_v2', 'far_vehicle_v1', 'far_onfoot']) {
      expect(ids, id).toContain(id);
      expect(physics.setups.find((s) => s.id === id).must, id).not.toBe(false);
    }
  });

  it('sets the physics engine per run and leaves the default run alone', () => {
    const by = Object.fromEntries(physics.setups.map((s) => [s.id, s]));
    expect(by.engine_default.project).toBeUndefined();
    expect(by.engine_jolt.project.physics['3d/physics_engine']).toBe('Jolt Physics');
    expect(by.engine_godot.project.physics['3d/physics_engine']).toBe('GodotPhysics3D');
    expect(by.vehicle_v2.project.physics['3d/physics_engine']).toBe('Jolt Physics');
  });

  it('lists what it does not measure with a reason', () => {
    for (const n of physics.notMeasured) expect(n.reason, n.id).toBeTruthy();
    expect(physics.notMeasured.map((n) => n.option)).toEqual(expect.arrayContaining(['N1, N2', 'K2', 'LANG2']));
  });

  it('summarises into one section per MUST item, also from an empty report', () => {
    const s = summarise({ setups: {} });
    expect(Object.keys(s)).toEqual(['engines', 'clock', 'vehicles', 'colliders', 'onFoot', 'combat', 'scripting', 'floatPrecision']);
    expect(s.clock).toBe(null);
    expect(s.engines.defaultResolvesTo).toBe(null);
    expect(line('vehicle', {})).toBe('');
  });

  it('reads the engine names and the clock verdict out of the rows', () => {
    const step = { busy: { p50: 0.4, p95: 0.8 }, idle: { p50: 0.01, p95: 0.02 } };
    const rays = { msPer1000: { p50: 2 }, msPerFrameAt1000PerSecond: 0.03, hitShare: 0.9 };
    const s = summarise({ setups: {
      engine_default: { results: { engine: 'GodotPhysics3D', step, rays, bodies: {} }, scene: { engineSetting: 'DEFAULT' } },
      engine_jolt: { results: { engine: 'Jolt Physics', step, rays, bodies: {} } },
      engine_godot: { results: { engine: 'GodotPhysics3D', step: { busy: { p50: 0.3, p95: 0.4 }, idle: step.idle }, rays, bodies: {} } },
      clock: { results: { verdict: 'C1 holds', c1: { holds: true, hold: { ticksToStop: 1 }, scale: { maxSpreadMm: 0 } }, c2: {} } },
    } });
    expect(s.engines.defaultResolvesTo).toBe('GodotPhysics3D');
    expect(s.engines.projectSetting).toBe('DEFAULT');
    expect(s.engines.stepP95RatioGodotOverJolt).toBe(0.5);
    expect(s.clock.c1Holds).toBe(true);
  });
});
