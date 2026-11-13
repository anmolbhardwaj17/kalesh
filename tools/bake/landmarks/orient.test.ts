// Orientation of a landmark from its footprint (P2-006).
import { describe, expect, it } from 'vitest';
import type { P2 } from '../geom';
import { axisGap, bearingDeg, bearingGap, bearingVector, mainAxis, orientationOf } from './orient';

/** A rectangle `len` long along a compass bearing and `wid` wide, around (cx, cz). */
const rect = (cx: number, cz: number, len: number, wid: number, bearing: number): P2[] => {
  const u = bearingVector(bearing);
  const v = { x: -u.z, z: u.x };
  return [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([a, b]) => ({ x: cx + (u.x * len * (a as number)) / 2 + (v.x * wid * (b as number)) / 2, z: cz + (u.z * len * (a as number)) / 2 + (v.z * wid * (b as number)) / 2 }));
};

describe('landmark orientation', () => {
  it('bearings: north is -Z, east is +X, clockwise', () => {
    expect(bearingDeg(0, -1)).toBeCloseTo(0);
    expect(bearingDeg(1, 0)).toBeCloseTo(90);
    expect(bearingDeg(0, 1)).toBeCloseTo(180);
    expect(bearingDeg(-1, 0)).toBeCloseTo(270);
    expect(bearingVector(90).x).toBeCloseTo(1);
    expect(bearingVector(0).z).toBeCloseTo(-1);
    expect(bearingGap(350, 10)).toBeCloseTo(20);
    expect(axisGap(179, 1)).toBeCloseTo(2);
  });

  it('the main axis is the long side of the smallest rectangle, whatever the ring is turned by', () => {
    for (const b of [0, 17, 45, 90, 133, 178]) {
      const ax = mainAxis(rect(120, -340, 60, 20, b));
      expect(ax).not.toBeNull();
      expect(axisGap(ax!.axisDeg, b)).toBeLessThan(0.01);
      expect(ax!.lengthM).toBeCloseTo(60, 6);
      expect(ax!.widthM).toBeCloseTo(20, 6);
      expect(ax!.elongation).toBeCloseTo(3, 6);
      expect(ax!.fill).toBeCloseTo(1, 6);
      expect(ax!.centre.x).toBeCloseTo(120, 6);
      expect(ax!.centre.z).toBeCloseTo(-340, 6);
    }
    // an L shape still reads along its long arm
    const l: P2[] = [{ x: 0, z: 0 }, { x: 80, z: 0 }, { x: 80, z: 10 }, { x: 10, z: 10 }, { x: 10, z: 30 }, { x: 0, z: 30 }];
    expect(axisGap(mainAxis(l)!.axisDeg, 90)).toBeLessThan(0.01);
    expect(mainAxis([{ x: 0, z: 0 }, { x: 1, z: 0 }])).toBeNull();
  });

  it('a front bearing from evidence picks the side of the rectangle; without one the axis alone is known', () => {
    // India Gate: long side north to south (turned 2 degrees), the front read as west
    const arch = mainAxis(rect(0, 0, 27, 18, 2.3));
    const o = orientationOf(arch, 270);
    expect(o.source).toBe('axis_and_front');
    expect(o.deg).toBeCloseTo(272.3, 1);
    expect(o.frontKnown).toBe(true);
    // the same footprint, front read as east
    expect(orientationOf(arch, 80).deg).toBeCloseTo(92.3, 1);
    // no front: square to the long side, the side in the southern half, and flagged as not known
    const n = orientationOf(arch, null);
    expect(n.source).toBe('principal_axis');
    expect(n.frontKnown).toBe(false);
    expect(n.deg).toBeCloseTo(92.3, 1);
    expect(orientationOf(mainAxis(rect(0, 0, 40, 10, 100)), null).deg).toBeCloseTo(190, 1);
  });

  it('a square keeps its sides, a circle has no axis, and no footprint gives the front bearing alone', () => {
    const sq = orientationOf(mainAxis(rect(0, 0, 30, 30, 12)), 95);
    expect(sq.source).toBe('axis_and_front');
    expect(sq.deg).toBeCloseTo(102, 1);
    const circle = Array.from({ length: 64 }, (_, k) => ({ x: 50 * Math.cos((2 * Math.PI * k) / 64), z: 50 * Math.sin((2 * Math.PI * k) / 64) }));
    const c = orientationOf(mainAxis(circle), null);
    expect(c).toMatchObject({ source: 'round', deg: 0, axisDeg: null, frontKnown: false });
    expect(orientationOf(mainAxis(circle), 200)).toMatchObject({ source: 'round', deg: 200, frontKnown: true });
    expect(orientationOf(null, null)).toMatchObject({ source: 'none', deg: null });
    expect(orientationOf(null, 45)).toMatchObject({ source: 'front_only', deg: 45, frontKnown: true });
  });
});
