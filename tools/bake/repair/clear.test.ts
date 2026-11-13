// Buildings off the road (P1-030, repair/clear.ts): moved back when the ground behind is free, else cut to the road's
// edge, cut in two by a road through them, or dropped as a scrap; nothing is left on a road face.
import { describe, expect, it } from 'vitest';
import type { P2 } from '../geom.ts';
import { ringArea } from '../geom.ts';
import type { GraphFootprint } from '../graph/build.ts';
import { CLEAR, clearFootprints, faceIndex, leftOnRoad, onRoadM2, roadFace } from './clear.ts';

const rect = (x0: number, z0: number, x1: number, z1: number): P2[] => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const fp = (id: string, ring: P2[], tags: Record<string, string> = {}): GraphFootprint => ({ id, source: 'overture:google', ring, area: Math.abs(ringArea(ring)), height: null, levels: null, tags });
/** A road 6 m wide along x from 0 to 100, its faces 10 m long. */
const road = (): ReturnType<typeof faceIndex> => faceIndex(Array.from({ length: 10 }, (_, k) => roadFace(rect(k * 10, -3, k * 10 + 10, 3))));

describe('buildings off the road', () => {
  it('moves a building back when little of it is on the road and the ground behind is free', () => {
    const r = clearFootprints([fp('a', rect(20, 2, 30, 12))], road());
    expect(r.counts).toMatchObject({ onRoad: 1, shifted: 1, trimmed: 0, dropped: 0 });
    const a = r.footprints[0] as GraphFootprint;
    expect(Math.min(...a.ring.map((p) => p.z))).toBeGreaterThanOrEqual(3 + CLEAR.clearanceM - 0.01);
    expect(a.area).toBeCloseTo(100, 0);
    expect(r.lines[0]).toMatchObject({ id: 'a', action: 'shifted', movedM: 1.5 });
    expect(leftOnRoad(r.footprints, road()).count).toBe(0);
  });

  it('cuts a building to the road edge when a neighbour stands behind it, and the cut runs along the road', () => {
    const r = clearFootprints([fp('a', rect(20, 2, 30, 12)), fp('b', rect(20, 12, 30, 22))], road());
    expect(r.counts).toMatchObject({ shifted: 0, trimmed: 1 });
    const a = r.footprints.find((f) => f.id === 'a') as GraphFootprint;
    // the frontage: an edge along the road, the clearance off its kerb
    expect(Math.min(...a.ring.map((p) => p.z))).toBeCloseTo(3 + CLEAR.clearanceM, 2);
    expect(a.area).toBeCloseTo(10 * (12 - 3 - CLEAR.clearanceM), 0);
    expect((r.footprints.find((f) => f.id === 'b') as GraphFootprint).ring).toEqual(rect(20, 12, 30, 22));
  });

  it('never moves a named building: it is cut where it stands', () => {
    const r = clearFootprints([fp('a', rect(20, 2, 30, 12), { name: 'Town Hall' })], road());
    expect(r.counts).toMatchObject({ shifted: 0, trimmed: 1 });
  });

  it('cuts a building a road runs through in two and keeps both parts', () => {
    const r = clearFootprints([fp('a', rect(20, -12, 30, 12))], road());
    expect(r.counts).toMatchObject({ split: 1 });
    expect(r.footprints.map((f) => f.id).sort()).toEqual(['a', 'a~1']);
    expect(r.lines[0]?.parts).toEqual(['a', 'a~1']);
    for (const f of r.footprints) expect(onRoadM2(f.ring, road())).toBe(0);
  });

  it('drops what is left as a scrap, and logs it', () => {
    const r = clearFootprints([fp('a', rect(20, -2.5, 24, 3.6))], road());
    expect(r.counts).toMatchObject({ dropped: 1, footprintsAfter: 0 });
    expect(r.lines[0]).toMatchObject({ id: 'a', action: 'dropped', areaAfter: 0 });
  });

  it('leaves a building beside the road alone and keeps the winding of a cut one', () => {
    const beside = fp('a', rect(20, 3.1, 30, 12));
    const reversed = fp('b', rect(40, 2, 50, 12).reverse(), { name: 'x' });
    const r = clearFootprints([beside, reversed], road());
    expect(r.footprints.find((f) => f.id === 'a')).toBe(beside);
    const b = r.footprints.find((f) => f.id === 'b') as GraphFootprint;
    expect(Math.sign(ringArea(b.ring))).toBe(Math.sign(ringArea(reversed.ring)));
    expect(r.counts.onRoad).toBe(1);
  });

  it('gives the same result twice', () => {
    const input = [fp('c', rect(60, -8, 70, 9)), fp('a', rect(20, 2, 30, 12)), fp('b', rect(20, 12, 30, 22))];
    expect(JSON.stringify(clearFootprints(input, road()))).toBe(JSON.stringify(clearFootprints(input.slice().reverse(), road())));
  });
});
