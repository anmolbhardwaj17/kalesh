import { describe, it, expect } from 'vitest';
import { perfMeta, checkPoses } from './lookproof.mjs';

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
