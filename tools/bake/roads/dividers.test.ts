// Carriageways fitted to their reference divider (P1-034, dividers.ts): two one-way carriageways of a divided street
// drawn further apart than their lanes and divider need.
import { describe, expect, it } from 'vitest';
import type { GraphEdge } from '../graph/build';
import { MAX_LANE_M, dividerLanes, fitToDividers } from './dividers';
import type { MedianRef } from './medianrefs';
import type { LaneDef, Station, Strip } from './model';

const lane = (type: LaneDef['type'], width: number, dir: LaneDef['dir'] = 0): LaneDef => ({ type, dir, width, raise: type === 'drive' ? 0 : 0.15 });

/** A straight carriageway along x at z = `z`, running east (dir 1) or west (-1): kerb, two lanes, median kerb on its right. */
function carriageway(id: string, z: number, dir: 1 | -1, gapAt?: (x: number) => number): Strip {
  const lanes = [lane('kerb', 0.3), lane('drive', 3.3, 1), lane('drive', 3.3, 1), lane('median', 0.3)];
  const st: Station[] = [];
  for (let k = 0; k <= 50; k++) {
    const x = dir === 1 ? k * 4 : 200 - k * 4;
    // the left of the station order: east-running has its left at -z (north), west-running at +z
    const nz = dir === 1 ? -1 : 1;
    // the carriageway's right (median) border sits `half` from its centre line
    const zc = gapAt ? (dir === 1 ? z - (gapAt(x) - 10) / 2 : z + (gapAt(x) - 10) / 2) : z;
    const b = [3.6, 3.3, 0, -3.3, -3.6];
    st.push({ x, z: zc, nx: 0, nz, s: k * 4, h: 0, g: 0, b, layer: 0, bridge: false, structure: 0, edgeRaise: 0 });
  }
  return { id: `${id}_0`, edge: id, kind: 'road', cls: 'secondary', link: false, name: 'Tilak Marg', ways: [], lanes, st, hero: null };
}

const edges = new Map<string, GraphEdge>([
  ['wa', { road: { cls: 'secondary', laneWidth: 3.3 } } as unknown as GraphEdge],
  ['wb', { road: { cls: 'secondary', laneWidth: 3.3 } } as unknown as GraphEdge],
]);
const ref = (width: number): MedianRef => ({ names: ['Tilak Marg'], width, type: 'kerb', source: 'satellite', ref: 'test' });
const medianX = (s: Strip, i: number): number => {
  const st = s.st[i] as Station;
  return st.z + st.nz * (st.b[st.b.length - 1] as number);
};

describe('carriageways fitted to their reference divider (P1-034)', () => {
  it('each side takes half the space beyond the divider over its drive lanes; the kerb side stays', () => {
    // centre lines 11.6 m apart: each carriageway's median border is 3.6 m from it, so 4.4 m lie between the two kerbs
    // (left-hand traffic: the eastbound carriageway is the north one, its median on its right, to the south)
    const a = carriageway('wa', -5.8, 1);
    const b = carriageway('wb', 5.8, -1);
    const strips = [a, b];
    const fit = fitToDividers(strips, [], (si) => (si === 0 ? [1] : [0]), [ref(1.0)], edges);
    expect(fit.strips).toBe(2);
    // the divider of 1 m is the two 0.3 m median kerbs and 0.4 m between them: each side widens (4.4 - 0.4) / 2 less a cm
    for (const i of [0, 25, 50]) {
      const gap = Math.abs(medianX(a, i) - medianX(b, 50 - i));
      expect(gap).toBeCloseTo(0.42, 2);
      // kerb side unchanged, the two drive lanes widened alike, the median kerb keeps its 0.3 m
      const st = a.st[i] as Station;
      expect(st.b[0]).toBe(3.6);
      expect(st.b[1]).toBe(3.3);
      expect((st.b[1] as number) - (st.b[2] as number)).toBeCloseTo((st.b[2] as number) - (st.b[3] as number), 6);
      expect((st.b[3] as number) - (st.b[4] as number)).toBeCloseTo(0.3, 6);
    }
    expect(fit.maxM).toBeCloseTo(1.99, 2);
    expect(fit.reach).toEqual({ asked: 102, fitted: 102 });
  });

  it('no wider than MAX_LANE_M a lane, no faster than the class taper along the edge, and no reference: nothing', () => {
    // centre lines 10 m apart, then 18 m from x 100: 2.8 m and 10.8 m between the kerbs
    const wide = (x: number): number => (x < 100 ? 10 : 18);
    const a = carriageway('wa', -5, 1, wide);
    const b = carriageway('wb', 5, -1, wide);
    const fit = fitToDividers([a, b], [], (si) => (si === 0 ? [1] : [0]), [ref(0.6)], edges);
    for (const s of [a, b]) for (const st of s.st) for (const k of [1, 2]) expect((st.b[k] as number) - (st.b[k + 1] as number)).toBeLessThanOrEqual(MAX_LANE_M + 1e-9);
    // the widening grows 1 m per 20 m (secondary class taper) from where the gap opens at x 100
    const w = fit.widened[0] as Float64Array;
    for (let i = 1; i < w.length; i++) expect(Math.abs((w[i] as number) - (w[i - 1] as number))).toBeLessThanOrEqual(4 / 20 + 1e-9);
    const c = carriageway('wa', -7, 1);
    const d = carriageway('wb', 7, -1);
    expect(fitToDividers([c, d], [], (si) => (si === 0 ? [1] : [0]), [], edges).strips).toBe(0);
  });

  it('a street whose space up to the divider holds a third lane takes it (one count for the street)', () => {
    // 6.8 m between the kerbs, a 0.6 m divider: each side has 6.6 + 3.4 = 10 m, three lanes of 3.3 m
    const a = carriageway('wa', -7, 1);
    const b = carriageway('wb', 7, -1);
    expect([...dividerLanes([a, b], (si) => (si === 0 ? [1] : [0]), [ref(0.6)], edges)]).toEqual([['wa', 3], ['wb', 3]]);
    // a 4 m divider leaves 1.7 m a side: two lanes stay
    expect([...dividerLanes([a, b], (si) => (si === 0 ? [1] : [0]), [ref(4)], edges)]).toEqual([]);
  });
});
