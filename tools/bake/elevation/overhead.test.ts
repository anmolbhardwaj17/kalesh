// Metro viaducts and foot bridges over the solved roads (P1-035, overhead.ts), and the soft map edge tie of a road
// that must rise for something just inside the edge (solve.ts). Small synthetic maps; the pilot centre is checked in
// pilot_elevation.test.mjs.
import { describe, expect, it } from 'vitest';
import type { P2 } from '../geom';
import type { Strip } from '../roads/model';
import { buildLaneModel } from '../roads/network';
import { Sketch } from '../testmap';
import { checkElevation } from './checks';
import type { RailLine } from './crossings';
import { elevationInput } from './input';
import { FOOT_BRIDGE_DEPTH_M, HEADROOM, METRO_DECK_DEPTH_M, METRO_MAX_GRADE, METRO_VIADUCT_M, RAIL_EMBANKMENT_M, RAIL_HEADROOM_M } from './limits';
import { overheadHeights, overheadRecord } from './overhead';
import type { OverheadInput } from './overhead';
import { solveBlockElevation } from './solve';

const flat = (): number => 200;

/** A primary road along x at z = 0, solved on flat ground. */
const street = (): { strips: Strip[]; input: OverheadInput } => {
  const s = new Sketch();
  s.way([[-400, 0], [400, 0]], { highway: 'primary', name: 'Test Marg' });
  const g = s.graph(500);
  const b = buildLaneModel({ nodes: g.nodes, edges: g.edges, wayLanes: new Map() });
  const ein = elevationInput(b, g, flat);
  const res = solveBlockElevation(ein);
  return {
    strips: b.strips,
    input: { strips: b.strips, junctions: ein.junctions, junctionHeights: res.junctionHeights, rails: [], metro: [], footBridges: [], water: [], ground: flat, railEmbankment: RAIL_EMBANKMENT_M },
  };
};
const line = (id: string, pts: [number, number][], o: Partial<RailLine> = {}): RailLine => ({ id, name: o.name ?? 'Blue Line', pts: pts.map(([x, z]) => ({ x, z })), layer: o.layer ?? 2, bridge: o.bridge ?? true, tunnel: o.tunnel ?? false });

describe('metro viaduct', () => {
  it('keeps a road at grade under it everywhere, the headroom over a road it crosses, and comes down to the portal at 4 percent', () => {
    const { input } = street();
    const res = overheadHeights({ ...input, metro: [line('way/1', [[0, -600], [0, 300]]), line('way/2', [[0, 300], [0, 700]], { bridge: false, tunnel: true, layer: -2 })] });
    expect(res.viaducts).toHaveLength(1);
    const v = res.viaducts[0]!;
    expect(v.ends.map((e) => e.kind)).toEqual(['open', 'portal']);
    // the portal end is at the ground; the open end stands at the viaduct's height
    expect(v.ends[1]!.h).toBeCloseTo(200, 6);
    expect(v.ends[0]!.h - v.ends[0]!.g).toBeCloseTo(METRO_VIADUCT_M, 6);
    const road = v.crossings.find((c) => c.kind === 'road')!;
    expect(road.name).toBe('Test Marg');
    expect(road.needM).toBe(HEADROOM);
    expect(road.clearanceM).toBeGreaterThanOrEqual(HEADROOM - 1e-6);
    expect(v.shortM).toBe(0);
    // never steeper than the metro's ramp limit
    for (let i = 1; i < v.profile.length; i++) {
      const [x0, z0, h0] = v.profile[i - 1]!;
      const [x1, z1, h1] = v.profile[i]!;
      expect(Math.abs(h1 - h0) / Math.hypot(x1 - x0, z1 - z0)).toBeLessThanOrEqual(METRO_MAX_GRADE + 1e-3);
    }
  });

  it('a portal too close to a road: the headroom it cannot give is listed, never hidden', () => {
    const { input } = street();
    const res = overheadHeights({ ...input, metro: [line('way/1', [[0, -600], [0, 100]]), line('way/2', [[0, 100], [0, 500]], { bridge: false, tunnel: true, layer: -2 })] });
    const v = res.viaducts[0]!;
    // 100 m of ramp at 4 percent: 4 m of rail over the road, 8 m wanted
    expect(v.shortM).toBeGreaterThan(3);
    const rec = overheadRecord(res);
    expect(rec.short.length).toBeGreaterThan(0);
    expect(rec.short[0]!.under).toBe('Test Marg');
    expect(rec.short[0]!.clearanceM).toBeLessThan(rec.short[0]!.needM);
    expect(METRO_DECK_DEPTH_M + HEADROOM).toBeCloseTo(METRO_VIADUCT_M, 9);
  });

  it('two ways of one track are one viaduct, in order', () => {
    const { input } = street();
    const res = overheadHeights({ ...input, metro: [line('way/9', [[0, 0], [0, 300]]), line('way/8', [[0, -300], [0, 0]])] });
    expect(res.viaducts).toHaveLength(1);
    expect(res.viaducts[0]!.ways).toEqual(['way/8', 'way/9']);
    expect(res.viaducts[0]!.lenM).toBeCloseTo(600, 6);
  });
});

describe('foot bridge', () => {
  it('one walking level over the street with its headroom, stairs down at both ends', () => {
    const { input } = street();
    const res = overheadHeights({ ...input, footBridges: [{ id: 'way/5', ways: ['way/5'], pts: [[{ x: 10, z: -30 }, { x: 10, z: 30 }]] }] });
    const f = res.footBridges[0]!;
    expect(f.solved).toBe(false);
    const road = f.crossings.find((c) => c.kind === 'road')!;
    expect(road.clearanceM).toBeCloseTo(HEADROOM, 2);
    expect(f.deckH).toBeCloseTo(road.underH + HEADROOM + FOOT_BRIDGE_DEPTH_M, 2);
    expect(f.stairs).toHaveLength(2);
    for (const st of f.stairs) expect(st.riseM).toBeCloseTo(f.deckH - 200, 6);
  });

  it('over a railway line it keeps the wires headroom; a railway bridge beside it is not under it', () => {
    const { input } = street();
    const fb = { id: 'way/6', ways: ['way/6'], pts: [[{ x: 200, z: 40 }, { x: 260, z: 40 }]] as P2[][] };
    const atGrade = overheadHeights({ ...input, rails: [line('way/7', [[230, -100], [230, 200]], { bridge: false, layer: 0, name: 'railway' })], footBridges: [fb] }).footBridges[0]!;
    expect(atGrade.crossings.map((c) => c.kind)).toEqual(['railway']);
    expect(atGrade.deckH).toBeCloseTo(200 + RAIL_HEADROOM_M + FOOT_BRIDGE_DEPTH_M, 6);
    const besideBridge = overheadHeights({ ...input, rails: [line('way/7', [[230, -100], [230, 200]], { bridge: true, layer: 1, name: 'railway' })], footBridges: [fb] }).footBridges[0]!;
    expect(besideBridge.crossings).toEqual([]);
  });
});

describe('map edge tie of a ramp', () => {
  it('a road that must stand over another just inside the edge leaves the stage raised; the road under it stays near the ground', () => {
    const s = new Sketch();
    // a short bridge 40 m inside the map edge (x = 500), as the Geeta Colony slip's
    s.way([[-700, 0], [420, 0]], { highway: 'secondary', name: 'Flyover Marg' });
    s.way([[420, 0], [480, 0]], { highway: 'secondary', name: 'Flyover Marg', bridge: 'yes', layer: '1' });
    s.way([[480, 0], [700, 0]], { highway: 'secondary', name: 'Flyover Marg' });
    const under = s.way([[460, 300], [460, -300]], { highway: 'residential', name: 'Gali' });
    const g = s.graph(500);
    const b = buildLaneModel({ nodes: g.nodes, edges: g.edges, wayLanes: new Map() });
    const res = solveBlockElevation(elevationInput(b, g, flat));
    const checks = checkElevation(b.strips, b.joints, elevationInput(b, g, flat).junctions, res);
    expect(res.unmet).toEqual([]);
    expect(checks.clearance.violations).toBe(0);
    const east = res.ties.find((t) => {
      const st = b.strips[t.strip]!.st;
      return (t.end === 'start' ? st[0]! : st[st.length - 1]!).x > 400;
    })!;
    expect(east.ramp).toBe(true);
    expect(east.h - east.target).toBeGreaterThan(2);
    const low = Math.min(...b.strips.filter((x) => x.ways.includes(`way/${under}`)).flatMap((x) => x.st.map((st) => st.h - st.g)));
    expect(low).toBeGreaterThan(-1);
    // a tie with nothing to rise for stays stiff: the west end leaves at the ground
    const west = res.ties.find((t) => t !== east && b.strips[t.strip]!.name === 'Flyover Marg')!;
    expect(west.ramp).toBe(false);
    expect(Math.abs(west.h - west.target)).toBeLessThan(0.02);
  });
});
