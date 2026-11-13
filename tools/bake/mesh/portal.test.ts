// Portal piers (P1-036): two legs beside a deck where no pier can stand under it, the beam keeps the headroom over
// what it passes over; and the overlap levels of the lane model with and without the solved station kinds.
import { describe, expect, it } from 'vitest';
import type { Station, Strip } from '../roads/model';
import { overlapLevels, stripOverlaps } from '../roads/overlap';
import { CUT_EDGE, FaceSet } from './faces';
import { LEG_ACROSS_M, findPortal } from './portal';
import { FaceGrid } from './structures';

const station = (x: number, h: number, g: number, layer = 1, bridge = true): Station => ({ x, z: 0, nx: 0, nz: -1, s: x, h, g, b: [3.5, -3.5], layer, bridge, structure: 0, edgeRaise: 0.15 });
const square = (half: number, y: number): { x: number; z: number; y: number }[] => [{ x: -half, z: -half, y }, { x: half, z: -half, y }, { x: half, z: half, y }, { x: -half, z: half, y }];

describe('portal piers', () => {
  it('stands its legs beside the deck, outside the junction below, and keeps the headroom under its beam', () => {
    const fs = new FaceSet();
    // a junction surface 20 m across, 8 m under the deck
    fs.add(square(10, 200), { piece: 0, kind: 'junction', cut: CUT_EDGE, raise: 0, sheet: 0 });
    const grid = new FaceGrid(fs);
    const p = findPortal(fs, grid, station(0, 208, 200), 1043);
    expect(typeof p).not.toBe('string');
    if (typeof p === 'string') return;
    // the station's left is -z here: both legs stand clear of the 10 m half width of the junction
    for (const lat of p.at) expect(Math.abs(lat) - LEG_ACROSS_M / 2).toBeGreaterThanOrEqual(10);
    expect(p.at[0]).toBeGreaterThan(0);
    expect(p.at[1]).toBeLessThan(0);
    expect(p.beamBottom).toBeLessThan(208 - 1.2);
    expect(p.beamBottom - 200).toBeGreaterThanOrEqual(5.5);
  });

  it('gives a reason instead of a beam with too little headroom, or legs with nowhere to stand', () => {
    const fs = new FaceSet();
    fs.add(square(10, 202), { piece: 0, kind: 'junction', cut: CUT_EDGE, raise: 0, sheet: 0 });
    expect(findPortal(fs, new FaceGrid(fs), station(0, 208, 200), 1043)).toMatch(/beam would leave/);
    const wide = new FaceSet();
    wide.add(square(60, 200), { piece: 0, kind: 'junction', cut: CUT_EDGE, raise: 0, sheet: 0 });
    expect(findPortal(wide, new FaceGrid(wide), station(0, 208, 200), 1043)).toMatch(/no room for a leg/);
  });
});

describe('overlap levels of the lane model', () => {
  const strip = (st: Station[]): Strip => ({ id: 's', edge: 'e', kind: 'road', cls: 'secondary', link: false, name: '', ways: [], lanes: [{ type: 'drive', dir: 1, raise: 0 }], st } as unknown as Strip);

  it('reads the tags before the solve and the solved kinds after: a bridge left on fill lies on the ground level', () => {
    const ramp = strip([station(0, 201, 200, 0, false), station(10, 201.5, 200, 1, true), station(20, 202, 200, 1, true), station(30, 207, 200, 1, true)]);
    expect(Array.from(overlapLevels(ramp))).toEqual([0, 1043, 1043, 1043]);
    // solved: at grade, fill, fill, deck
    expect(Array.from(overlapLevels(ramp, [0, 1, 1, 2]))).toEqual([0, 0, 0, 1043]);
    // an embankment (layer 1 without a bridge) is on the ground; a lowered road keeps its layer
    expect(overlapLevels(strip([station(0, 201, 200, 1, false)]))[0]).toBe(0);
    expect(overlapLevels(strip([station(0, 195, 200, -1, false)]))[0]).toBe(2038);
  });

  it('finds a ramp on fill over a road at grade only with the solved kinds', () => {
    const ramp = strip([station(0, 201, 200, 1, true), station(10, 201.5, 200, 1, true), station(20, 202, 200, 1, true)]);
    const road: Strip = { ...strip([station(0, 200, 200, 0, false), station(10, 200, 200, 0, false), station(20, 200, 200, 0, false)].map((st) => ({ ...st, z: 4 }))), id: 'r' } as Strip;
    expect(stripOverlaps([ramp, road], []).overlaps).toHaveLength(0);
    const solved = stripOverlaps([ramp, road], [], undefined, [[1, 1, 1], [0, 0, 0]]).overlaps;
    expect(solved.length).toBeGreaterThan(0);
    expect(solved.reduce((t, o) => t + o.area, 0)).toBeGreaterThan(10);
  });
});
