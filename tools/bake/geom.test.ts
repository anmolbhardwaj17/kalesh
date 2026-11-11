import { describe, expect, it } from 'vitest';
import { Grid, boxOf, overlapShare, pointInRing, pointSegment, resample, ringArea, ringCentroid, segmentCrossing, segmentRing, triangulate } from './geom';

const square = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }];

describe('bake geometry', () => {
  it('finds the closest point of a segment', () => {
    const c = pointSegment({ x: 5, z: 3 }, { x: 0, z: 0 }, { x: 10, z: 0 });
    expect(c.d).toBeCloseTo(3);
    expect(c.t).toBeCloseTo(0.5);
    expect(pointSegment({ x: -4, z: 3 }, { x: 0, z: 0 }, { x: 10, z: 0 }).d).toBeCloseTo(5);
  });
  it('crossings count only strictly inside both segments', () => {
    expect(segmentCrossing({ x: 0, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }, { x: 10, z: 0 })).toMatchObject({ x: 5, z: 5 });
    expect(segmentCrossing({ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 })).toBeNull();
    expect(segmentCrossing({ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 0, z: 1 }, { x: 10, z: 1 })).toBeNull();
  });
  it('ring area, centroid and point tests', () => {
    expect(Math.abs(ringArea(square))).toBeCloseTo(100);
    expect(ringCentroid(square)).toMatchObject({ x: 5, z: 5 });
    expect(pointInRing({ x: 5, z: 5 }, square)).toBe(true);
    expect(pointInRing({ x: 15, z: 5 }, square)).toBe(false);
    expect(segmentRing({ x: 12, z: -5 }, { x: 12, z: 15 }, square)).toBeCloseTo(2);
    expect(segmentRing({ x: 5, z: 5 }, { x: 20, z: 5 }, square)).toBe(0);
  });
  it('overlap share tells a duplicate from a neighbour', () => {
    const shifted = square.map((p) => ({ x: p.x + 5, z: p.z }));
    expect(overlapShare(square, square)).toBe(1);
    expect(overlapShare(square, shifted)).toBeCloseTo(0.5, 1);
    expect(overlapShare(square, square.map((p) => ({ x: p.x + 20, z: p.z })))).toBe(0);
  });
  it('triangulates a concave ring to its own area, either winding', () => {
    const l = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 4 }, { x: 4, z: 4 }, { x: 4, z: 10 }, { x: 0, z: 10 }];
    for (const ring of [l, l.slice().reverse()]) {
      const t = triangulate(ring);
      expect(t.length).toBe((ring.length - 2) * 3);
      let area = 0;
      for (let i = 0; i < t.length; i += 3) area += Math.abs(ringArea([ring[t[i]!]!, ring[t[i + 1]!]!, ring[t[i + 2]!]!]));
      expect(area).toBeCloseTo(Math.abs(ringArea(ring)));
    }
  });
  it('resamples a polyline at a fixed step with both ends', () => {
    const pts = resample([{ x: 0, z: 0 }, { x: 100, z: 0 }], 30);
    expect(pts.map((p) => p.x)).toEqual([0, 30, 60, 90, 100]);
  });
  it('the grid returns items near a box once', () => {
    const g = new Grid<string>(10);
    g.insert(boxOf([{ x: 0, z: 0 }, { x: 35, z: 0 }]), 'long');
    g.insert(boxOf([{ x: 200, z: 200 }]), 'far');
    expect(g.query(boxOf([{ x: 20, z: 5 }]), 6)).toEqual(['long']);
  });
});
