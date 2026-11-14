import { describe, expect, it } from 'vitest';
import type { P2 } from '../geom.ts';
import { angleIn, compassOf, cpSectors, kitRecipe, outsideWall, wallRuns } from './kit.ts';
import { buildMassing } from './massing.ts';
import type { PlaceFootprint, Placement } from './place.ts';

const arcRing = (r0: number, r1: number, a0: number, a1: number): P2[] => {
  const out: P2[] = [];
  const pt = (r: number, a: number): P2 => ({ x: r * Math.sin((a * Math.PI) / 180), z: -r * Math.cos((a * Math.PI) / 180) });
  for (let a = a0; a <= a1; a += 2) out.push(pt(r0, a));
  for (let a = a1; a >= a0; a -= 2) out.push(pt(r1, a));
  return out;
};
const fp = (id: string, ring: P2[]): PlaceFootprint => ({ id, ring, height: null, levels: null, tags: { building: 'yes' } });

describe('landmark parts kit inputs (P2-007)', () => {
  it('knows the pilot recipes by registry id', () => {
    expect(kitRecipe('india_gate')).toBe('india_gate');
    expect(kitRecipe('red_fort')).toBe('red_fort');
    expect(kitRecipe('cp_circle')).toBe('cp_circle');
    expect(kitRecipe('jama_masjid')).toBe('jama_masjid');
    expect(kitRecipe('jama_masjid_q19580828')).toBeNull();
  });

  it('compass bearings: 0 north (-z), 90 east; angleIn wraps past 360', () => {
    expect(compassOf(0, -1)).toBeCloseTo(0);
    expect(compassOf(1, 0)).toBeCloseTo(90);
    expect(compassOf(0, 1)).toBeCloseTo(180);
    expect(angleIn(5, 350, 370)).toBe(true);
    expect(angleIn(345, 350, 370)).toBe(false);
  });

  it('a wall line becomes runs on the ground, open where a road passes', () => {
    const p = { x: 100, z: 50, walls: [{ pts: [{ x: 0, z: 0 }, { x: 200, z: 0 }], heights: [33, 33], closed: false, source: 'test' }] };
    // a road between x = 90 and x = 110 (NaN ground), elsewhere ground at 2 m
    const ground = (x: number): number => (x > 90 && x < 110 ? NaN : 2);
    const runs = wallRuns(p, ground, 1);
    expect(runs.length).toBe(2);
    for (const r of runs) {
      expect(r.pts.length).toBe(r.h.length);
      for (const q of r.pts) expect(q[1]).toBe(1);
    }
    // in metres from the landmark: the first run starts at x = -100
    expect(runs[0]!.pts[0]![0]).toBe(-100);
    expect(Math.max(...runs[0]!.pts.map((q) => q[0]))).toBeLessThanOrEqual(-10);
    expect(Math.min(...runs[1]!.pts.map((q) => q[0]))).toBeGreaterThanOrEqual(10);
  });

  it('Connaught Place: parts in two bands become ring sectors split at the radial roads and kept off the circles', () => {
    // inner blocks between 140 and 215 m, outer blocks between 250 and 300 m; radial roads every 60 degrees (8 degrees wide)
    const parts: PlaceFootprint[] = [];
    for (let k = 0; k < 6; k++) {
      const a0 = k * 60 + 5;
      parts.push(fp(`in${k}a`, arcRing(140, 215, a0, a0 + 24)));
      parts.push(fp(`in${k}b`, arcRing(140, 215, a0 + 25, a0 + 50)));
      parts.push(fp(`out${k}`, arcRing(250, 300, a0, a0 + 50)));
    }
    const isRoad = (x: number, z: number): boolean => {
      const r = Math.hypot(x, z);
      const a = compassOf(x, z);
      if (r < 132 || (r > 222 && r < 243) || r > 307) return true;
      return a % 60 < 4 || a % 60 > 56;
    };
    const ground = (x: number, z: number): number => (isRoad(x, z) ? NaN : 3);
    const p = { x: 0, z: 0, zone: { ring: arcRing(0, 330, 0, 360), clearM: 0, areaM2: 0, from: 'site' as const } };
    const { sectors, used } = cpSectors(p, parts, ground, () => 3, 2);
    expect(sectors.filter((s) => s.band === 'inner').length).toBe(6);
    expect(sectors.filter((s) => s.band === 'outer').length).toBe(6);
    expect(used.length).toBe(18);
    for (const s of sectors) {
      expect(s.base).toBe(1);
      expect(s.a1 - s.a0).toBeGreaterThan(40);
      expect(s.a1 - s.a0).toBeLessThan(52);
      // no corner on a road
      for (const r of [s.r0, s.r1]) {
        for (const a of [s.a0, s.a1]) expect(isRoad(r * Math.sin((a * Math.PI) / 180), -r * Math.cos((a * Math.PI) / 180))).toBe(false);
      }
    }
  });

  it('a fort building just outside its wall line is an outwork; one inside or far out is not', () => {
    const p = { x: 0, z: 0, walls: [{ pts: [{ x: -100, z: -100 }, { x: 100, z: -100 }, { x: 100, z: 100 }, { x: -100, z: 100 }], heights: [30, 30, 30, 30], closed: true, source: 'test' }] };
    expect(outsideWall({ x: 0, z: -140 }, p)).toBe(true);
    expect(outsideWall({ x: 0, z: -60 }, p)).toBe(false);
    expect(outsideWall({ x: 0, z: -200 }, p)).toBe(false);
  });

  it('the tile massing leaves out what the kit builds', () => {
    const ring: P2[] = [{ x: 0, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 10 }, { x: 0, z: 10 }];
    const base = { id: 'india_gate', mode: 'structure', pad: { ring, level: 5, marginM: 4, areaM2: 200, cutFillM: 0, clipped: false, from: 'footprint' }, body: [ring], massingHeightM: 42, shape: 'gate', material: 'landmark', partIds: ['b1'], walls: [], y: 5 } as unknown as Placement;
    const fps = new Map([['b1', fp('b1', [{ x: 30, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 10 }, { x: 30, z: 10 }])]]);
    const g = (): number => 5;
    expect(buildMassing([base], fps, g, g).triangles).toBeGreaterThan(0);
    expect(buildMassing([base], fps, g, g, { ids: new Set(['india_gate']), parts: new Set(['b1']) }).triangles).toBe(0);
    expect(buildMassing([base], fps, g, g, { ids: new Set(['india_gate']), parts: new Set() }).records[0]!.parts).toBe(1);
  });
});
