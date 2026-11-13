// The elevation solver (P1-013) on small synthetic maps, one per constraint: grade, clearance (road over road, a
// ramp that is too short, a railway bridge, a tunnel), vertical curve, crossfall, the map edge tie and the deck over
// water; and the parts under it: the sparse solver against the prototype's dense one, no step and no kink where a
// road splits, the structures read from the result, the same heights twice. The pilot centre itself is tested in
// pilot_elevation.test.mjs (it needs data/).
import { describe, expect, it } from 'vitest';
import type { BlockGraph } from '../graph/build';
import { solveSPD } from '../roads/elevation';
import type { Station, Strip } from '../roads/model';
import { buildLaneModel } from '../roads/network';
import type { LaneBuild } from '../roads/network';
import { Sketch } from '../testmap';
import { checkElevation } from './checks';
import { findCrossings } from './crossings';
import type { ElevationChecks } from './checks';
import { elevationFile, elevationHash, elevationRecord } from './elevout';
import { elevationInput } from './input';
import { CROSSFALL_MAX, DECK_DEPTH, DECK_OVER_WATER_M, HEADROOM, maxGrade, minCurveRadius, RAIL_DECK_DEPTH_M, RAIL_EMBANKMENT_M, RAIL_HEADROOM_M, RAIL_OVER_ROAD_M, ROAD_OVER_RAIL_M, ROAD_OVER_ROAD_CENTRE_M, ROAD_OVER_ROAD_M, TUNNEL_COVER_M, WATER_CLEARANCE_M } from './limits';
import { Profiles } from './profile';
import { heightMapSvg, profileSvg } from './render';
import { solveBlockElevation } from './solve';
import type { ElevationInput, ElevationResult } from './solve';
import { SparseSpd } from './sparse';
import { readStructures } from './structures';
import type { StructureResult } from './structures';

type Ground = (x: number, z: number) => number;
interface Solved { g: BlockGraph; b: LaneBuild; input: ElevationInput; res: ElevationResult; checks: ElevationChecks; st: StructureResult }

/** Graph, lane model, heights, checks and structures of a sketch. `change` may edit the solver input (drop the water, say). */
const solve = (s: Sketch, ground: Ground, h = 500, change: (i: ElevationInput) => void = () => {}): Solved => {
  const g = s.graph(h);
  const b = buildLaneModel({ nodes: g.nodes, edges: g.edges, wayLanes: new Map() });
  const input = elevationInput(b, g, ground);
  change(input);
  const res = solveBlockElevation(input);
  const checks = checkElevation(b.strips, b.joints, input.junctions, res);
  const st = readStructures({ strips: b.strips, joints: b.joints, junctions: input.junctions, junctionHeights: res.junctionHeights, tunnels: res.tunnels, crossings: res.crossings, pairSamples: res.pairSamples, water: input.water ?? [], ties: input.ties ?? [], ground });
  return { g, b, input, res, checks, st };
};
const flat: Ground = () => 200;
const stripsOf = (b: LaneBuild, way: number): Strip[] => b.strips.filter((s) => s.ways.includes(`way/${way}`));
const stationsOf = (b: LaneBuild, way: number): Station[] => stripsOf(b, way).flatMap((s) => s.st);
const hag = (st: Station): number => st.h - st.g;
const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

describe('the limits, by name', () => {
  it('a road over a road has 5.5 m of headroom under a 1.2 m deck; the other clearances follow from theirs', () => {
    expect(HEADROOM).toBe(5.5);
    expect(ROAD_OVER_ROAD_M).toBeCloseTo(HEADROOM + DECK_DEPTH, 9);
    expect(ROAD_OVER_ROAD_CENTRE_M).toBeCloseTo(7, 9);
    expect(ROAD_OVER_RAIL_M).toBeCloseTo(RAIL_HEADROOM_M + DECK_DEPTH, 9);
    expect(RAIL_HEADROOM_M).toBe(6.5);
    expect(RAIL_OVER_ROAD_M).toBeCloseTo(HEADROOM + RAIL_DECK_DEPTH_M, 9);
    expect(DECK_OVER_WATER_M).toBeCloseTo(WATER_CLEARANCE_M + DECK_DEPTH, 9);
    expect(WATER_CLEARANCE_M).toBe(2.5);
    expect(TUNNEL_COVER_M).toBeCloseTo(6.7, 9);
    expect(CROSSFALL_MAX).toBe(0.04);
    expect([maxGrade('trunk', false), maxGrade('tertiary', false), maxGrade('residential', false), maxGrade('trunk', true)]).toEqual([0.05, 0.07, 0.08, 0.06]);
    expect([minCurveRadius('trunk', false), minCurveRadius('secondary', false), minCurveRadius('tertiary', false), minCurveRadius('residential', false), minCurveRadius('trunk', true)]).toEqual([500, 400, 300, 150, 250]);
  });
});

describe('sparse solver', () => {
  it('gives the dense solver\'s answer on a banded system with far couplings, and the same bits twice', () => {
    const n = 90;
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const terms: { idx: number[]; c: number[]; w: number; target: number }[] = [];
    for (let i = 0; i < n; i++) terms.push({ idx: [i], c: [1], w: 0.5 + rnd(), target: rnd() * 10 });
    for (let i = 0; i + 2 < n; i++) terms.push({ idx: [i, i + 1, i + 2], c: [1, -2, 1], w: 40 * rnd(), target: 0 });
    for (let k = 0; k < 25; k++) terms.push({ idx: [Math.floor(rnd() * n), Math.floor(rnd() * n)], c: [1, -1], w: 5 * rnd(), target: rnd() });
    const usable = terms.filter((t) => new Set(t.idx).size === t.idx.length);
    const run = (): Float64Array => {
      const A = new SparseSpd(n, usable.map((t) => t.idx));
      const b = new Float64Array(n);
      for (const t of usable) {
        A.addTerm(t.idx, t.c, t.w);
        t.idx.forEach((v, p) => (b[v] = b[v]! + t.w * t.c[p]! * t.target));
      }
      A.factor();
      expect(A.lifted).toBe(0);
      return A.solve(b);
    };
    const x = run();
    const dense = new Float64Array(n * n);
    const rhs = new Float64Array(n);
    for (const t of usable) {
      t.idx.forEach((v, p) => {
        rhs[v] = rhs[v]! + t.w * t.c[p]! * t.target;
        t.idx.forEach((u, q) => (dense[v * n + u] = dense[v * n + u]! + t.w * t.c[p]! * t.c[q]!));
      });
    }
    const want = solveSPD(dense, rhs, n);
    for (let i = 0; i < n; i++) expect(x[i]).toBeCloseTo(want[i]!, 8);
    expect(Array.from(run())).toEqual(Array.from(x));
  });

  it('refuses a pair that is not in its pattern', () => {
    const A = new SparseSpd(3, [[0, 1]]);
    expect(() => A.addTerm([0, 2], [1, 1], 1)).toThrow(/not in the pattern/);
  });
});

describe('grade', () => {
  it('a street up a 30 percent bank never climbs steeper than its class limit: it cuts into the top and fills the foot', () => {
    const s = new Sketch();
    const way = s.way([[-300, 0], [300, 0]], { highway: 'residential' });
    const { b, checks, res } = solve(s, (x) => 200 + 6 * smooth((x + 15) / 30));
    expect(res.report.converged).toBe(true);
    expect(res.unmet).toEqual([]);
    expect(checks.grade.violations).toBe(0);
    // the limit is doing the work: the steepest stretch sits on it
    expect(checks.grade.steepestPct).toBeGreaterThan(7.9);
    expect(checks.grade.steepestPct).toBeLessThanOrEqual(8.0001);
    const st = stationsOf(b, way);
    expect(Math.max(...st.map(hag))).toBeGreaterThan(0.5);
    expect(Math.min(...st.map(hag))).toBeLessThan(-0.5);
    expect(res.report.active.grade).toBeGreaterThan(0);
  });
});

describe('clearance', () => {
  /** A primary street west to east; a tertiary street crosses it on a bridge tagged from 40 m before to 40 m after. */
  const crossing = (half: number): { s: Sketch; low: number; deck: number; ramps: number[] } => {
    const s = new Sketch();
    const low = s.way([[-400, 0], [400, 0]], { highway: 'primary', name: 'Low Road' });
    const a = s.node(0, -40);
    const c = s.node(0, 40);
    const south = s.way([[0, -half], a], { highway: 'tertiary', name: 'High Road' });
    const deck = s.way([a, c], { highway: 'tertiary', name: 'High Road', bridge: 'yes', layer: '1' });
    const north = s.way([c, [0, half]], { highway: 'tertiary', name: 'High Road' });
    return { s, low, deck, ramps: [south, north] };
  };

  it('a road over a road keeps 5.5 m of headroom at every place the two surfaces lie on each other, and comes back to the ground', () => {
    const { s, low, deck, ramps } = crossing(420);
    const { b, checks, res, st } = solve(s, flat);
    expect(res.report.converged).toBe(true);
    expect(res.unmet).toEqual([]);
    expect(checks.findings).toEqual([]);
    expect(checks.clearance.roadCrossings).toBeGreaterThan(0);
    expect(checks.clearance.roadSamples).toBeGreaterThan(4);
    expect(checks.clearance.minRoadM).toBeGreaterThanOrEqual(HEADROOM - 0.02);
    expect(checks.clearance.minRoadM).toBeLessThan(HEADROOM + 0.4);
    // the deck is as high as the clearance needs and no higher (the ceiling of the second phase). Only 80 m carry the
    // bridge tag, so the ramps are road on the ground model too; the road under the deck is held to the ground far
    // harder than they are, and the deck does nearly all of the climb
    const top = Math.max(...stationsOf(b, deck).map(hag));
    const under = Math.min(...stationsOf(b, low).map(hag));
    expect(top - under).toBeGreaterThanOrEqual(ROAD_OVER_ROAD_CENTRE_M - 0.01);
    expect(top - under).toBeLessThan(ROAD_OVER_ROAD_CENTRE_M + 0.2);
    expect(top).toBeGreaterThan(6.2);
    expect(under).toBeGreaterThan(-0.8);
    for (const w of ramps) expect(Math.min(...stationsOf(b, w).map((p) => Math.abs(hag(p))))).toBeLessThan(0.1);
    expect(checks.grade.violations + checks.curves.violations).toBe(0);
    // one deck, longer than its 80 m of bridge tag (the ramps start before the tag), nothing sunk
    expect(st.structures).toHaveLength(1);
    const x = st.structures[0]!;
    expect(x.kind).toBe('deck');
    expect(x.name).toBe('High Road');
    expect(x.structureM).toBeGreaterThan(150);
    expect(x.untaggedM).toBeGreaterThan(50);
    expect(x.sunk).toBeCloseTo(-under, 1);
    expect(x.crosses).toContain('Low Road');
    expect(x.openEnds).toBe(0);
    // every structure end touches the ground: the last station on the structure is one station (4 m at 7 percent) from being within 0.6 m of it
    for (const a of st.abutments) expect(Math.abs(a.hag)).toBeLessThanOrEqual(0.6 + 4.2 * 0.07);
  });

  it('the clearance holds over the whole width of the road below: where the edges of both roads pass over each other too (P1-043)', () => {
    // a 20 m wide road along x at grade, a 4 m wide bridge across it with a station every 8 m: no station of the bridge
    // stands over either edge of the road (z = -10 and 10)
    const strip = (id: string, pts: [number, number][], half: number, layer: number): Strip => ({
      id, edge: id, kind: 'road', cls: 'tertiary', link: false, name: id, ways: [`way/${id}`], hero: null,
      lanes: [{ type: 'drive', dir: 0, width: 2 * half, raise: 0 }],
      st: pts.map(([x, z], i) => {
        const [x1, z1] = (pts[Math.min(i + 1, pts.length - 1)] as [number, number]);
        const [x0, z0] = (pts[Math.max(i - 1, 0)] as [number, number]);
        const l = Math.hypot(x1 - x0, z1 - z0);
        return { x, z, nx: (z1 - z0) / l, nz: -(x1 - x0) / l, s: i, h: 0, g: 0, b: [half, -half], layer, bridge: layer > 0, structure: 0, edgeRaise: 0 };
      }),
    });
    const low = strip('low', Array.from({ length: 11 }, (_, i) => [-50 + 10 * i, 0] as [number, number]), 10, 0);
    const up = strip('up', Array.from({ length: 11 }, (_, i) => [0.5, -36 + 8 * i] as [number, number]), 2, 1);
    const c = findCrossings({ strips: [low, up], joints: [], junctions: [], ground: () => 0, railEmbankment: RAIL_EMBANKMENT_M });
    const edges = c.roads.filter((r) => !r.centre && Math.abs(Math.abs(r.z) - 10) < 1e-6);
    // the bridge's centre line and its two edges over both edges of the road: six samples, each tied to the right stations
    expect(edges).toHaveLength(6);
    for (const r of edges) {
      expect(r.up).toBe(1);
      expect(r.low).toBe(0);
      const a = up.st[r.upStation]!;
      const b = up.st[r.upStation + 1]!;
      expect(a.z + (b.z - a.z) * r.upT).toBeCloseTo(r.z, 6);
    }
    expect(c.roads.filter((r) => r.centre)).toHaveLength(1);
  });
  it('a ramp too short for its climb never breaks the grade limit: it starts before the tag and the road under it is lowered, and both are reported', () => {
    const { s, low, deck } = crossing(75);
    // the high road ends at a side street 75 m from the crossing on either side
    s.way([[-200, -75], [0, -75], [200, -75]].map((p) => p as [number, number]), { highway: 'residential' });
    s.way([[-200, 75], [0, 75], [200, 75]].map((p) => p as [number, number]), { highway: 'residential' });
    const { b, checks, res, st } = solve(s, flat);
    expect(res.report.converged).toBe(true);
    expect(res.unmet).toEqual([]);
    expect(checks.grade.violations).toBe(0);
    expect(checks.curves.violations).toBe(0);
    expect(checks.grade.steepestPct).toBeLessThanOrEqual(7.0001);
    expect(checks.clearance.violations).toBe(0);
    expect(checks.clearance.minRoadM).toBeGreaterThanOrEqual(HEADROOM - 0.02);
    // 75 m at 7 percent is 5.25 m at most (less with its curves). The ramps start at the side streets, which rise
    // with them; the rest comes from under the deck. Since P1-043 the clearance also holds where the deck passes the
    // edges of the road under it (between two of its stations, on the ramps): the deck stands about 0.2 m higher
    // there and the road under is lowered about 0.2 m less than when only the stations were held (over 0.7 m)
    const under = Math.min(...stationsOf(b, low).map(hag));
    expect(under).toBeLessThan(-0.4);
    expect(Math.max(...stationsOf(b, deck).map(hag))).toBeLessThan(6.6);
    const x = st.structures.find((q) => q.kind === 'deck')!;
    expect(x.sunk).toBeGreaterThan(0.4);
    expect(x.sunk).toBeCloseTo(-under, 1);
    expect(x.untaggedM).toBeGreaterThan(40);
    // lowered by more than 2 m, the road under the deck is a structure of its own: a cut between walls
    expect(st.structures.some((q) => q.kind === 'cut' && q.name === 'Low Road')).toBe(under < -2);
    // with room for the ramps (the first test) the road under the deck is lowered less
    const long = crossing(420);
    expect(Math.min(...stationsOf(solve(long.s, flat).b, long.low).map(hag))).toBeGreaterThan(under + 0.1);
  });

  it('a road dips under a railway bridge on its embankment and climbs over a railway line on the ground (the limits named above)', () => {
    const s = new Sketch();
    const under = s.way([[-300, 100], [300, 100]], { highway: 'secondary', name: 'Minto Road' });
    s.way([[0, 300], [0, -20]], { railway: 'rail', bridge: 'yes', layer: '1' });
    const a = s.node(-40, -200);
    const c = s.node(40, -200);
    s.way([[-300, -200], a], { highway: 'secondary', name: 'Over Road' });
    const over = s.way([a, c], { highway: 'secondary', name: 'Over Road', bridge: 'yes', layer: '1' });
    s.way([c, [300, -200]], { highway: 'secondary', name: 'Over Road' });
    s.way([[0, -60], [0, -400]], { railway: 'rail' });
    const { b, checks, res, st } = solve(s, flat);
    expect(res.unmet).toEqual([]);
    expect(checks.findings).toEqual([]);
    expect(checks.clearance.roadUnderRail).toBe(1);
    expect(checks.clearance.roadOverRail).toBe(1);
    expect(checks.clearance.minRoadUnderRailM).toBeGreaterThanOrEqual(HEADROOM - 0.02);
    expect(checks.clearance.minRoadOverRailM).toBeGreaterThanOrEqual(RAIL_HEADROOM_M - 0.02);
    // the rail stands RAIL_EMBANKMENT_M above the ground, so the road dips the rest of the way
    const dip = Math.min(...stationsOf(b, under).map(hag));
    expect(dip).toBeCloseTo(RAIL_EMBANKMENT_M - RAIL_OVER_ROAD_M, 1);
    expect(Math.max(...stationsOf(b, over).map(hag))).toBeGreaterThanOrEqual(ROAD_OVER_RAIL_M - 0.01);
    const cut = st.structures.find((q) => q.kind === 'cut')!;
    expect(cut.name).toBe('Minto Road');
    expect(cut.sunk).toBeCloseTo(-dip, 1);
    expect(cut.crosses).toContain('railway');
    expect(st.structures.find((q) => q.kind === 'deck')!.crosses).toContain('railway');
  });

  it('a tunnel lies under its cover and under the road that crosses it, with open cuts down to it', () => {
    const s = new Sketch();
    const a = s.node(-120, 0);
    const c = s.node(120, 0);
    s.way([[-450, 0], a], { highway: 'secondary', name: 'Tunnel Road' });
    const tunnel = s.way([a, c], { highway: 'secondary', name: 'Tunnel Road', tunnel: 'yes', layer: '-1' });
    s.way([c, [450, 0]], { highway: 'secondary', name: 'Tunnel Road' });
    const top = s.way([[0, -300], [0, 300]], { highway: 'primary', name: 'Top Road' });
    const { b, checks, res, st } = solve(s, flat);
    expect(res.unmet).toEqual([]);
    expect(checks.findings).toEqual([]);
    expect(checks.clearance.tunnelStations).toBeGreaterThan(40);
    expect(checks.clearance.minCoverM).toBeGreaterThanOrEqual(TUNNEL_COVER_M - 0.02);
    expect(checks.clearance.minRoadM).toBeGreaterThanOrEqual(HEADROOM - 0.02);
    expect(Math.min(...stationsOf(b, tunnel).map(hag))).toBeGreaterThan(-TUNNEL_COVER_M - 1);
    expect(Math.max(...stationsOf(b, top).map((p) => Math.abs(hag(p))))).toBeLessThan(0.3);
    expect(st.structures).toHaveLength(1);
    const x = st.structures[0]!;
    expect(x.kind).toBe('tunnel');
    expect(x.tunnelM).toBeGreaterThan(230);
    expect(x.cutM).toBeGreaterThan(100);
    expect(x.sunk).toBeGreaterThan(6.6);
    expect(x.crosses).toContain('Top Road');
    expect(checks.grade.violations).toBe(0);
  });

  it('a passage through a building (a tunnel tag at layer 0) stays on the ground', () => {
    const s = new Sketch();
    const a = s.node(-20, 0);
    const c = s.node(20, 0);
    s.way([[-200, 0], a], { highway: 'residential' });
    const passage = s.way([a, c], { highway: 'residential', tunnel: 'building_passage' });
    s.way([c, [200, 0]], { highway: 'residential' });
    const { b, st, checks } = solve(s, flat);
    expect(Math.max(...stationsOf(b, passage).map((p) => Math.abs(hag(p))))).toBeLessThan(0.05);
    expect(st.structures).toEqual([]);
    expect(checks.clearance.tunnelStations).toBe(0);
  });
});

describe('vertical curve', () => {
  it('a short bridge over a railway line crests no tighter than its class radius, and sags no tighter at its feet', () => {
    const s = new Sketch();
    const a = s.node(-30, 0);
    const c = s.node(30, 0);
    s.way([[-150, 0], a], { highway: 'tertiary', name: 'Mori Gate Road' });
    const deck = s.way([a, c], { highway: 'tertiary', name: 'Mori Gate Road', bridge: 'yes', layer: '1' });
    s.way([c, [150, 0]], { highway: 'tertiary', name: 'Mori Gate Road' });
    s.way([[-250, -150], [250, -150]], { highway: 'residential' });
    s.way([[-250, 150], [250, 150]], { highway: 'residential' });
    s.way([[-150, -150], [-150, 150]], { highway: 'residential' });
    s.way([[150, -150], [150, 150]], { highway: 'residential' });
    s.way([[0, 300], [0, -300]], { railway: 'rail' });
    const { b, checks, res } = solve(s, flat);
    expect(res.unmet).toEqual([]);
    expect(checks.curves.violations).toBe(0);
    expect(checks.grade.violations).toBe(0);
    expect(checks.clearance.violations).toBe(0);
    // the limit is doing the work: the tightest curve of the bridge road sits on the tertiary radius
    expect(res.report.active.curve).toBeGreaterThan(0);
    const limit = minCurveRadius('tertiary', false);
    let tightest = Infinity;
    for (const strip of b.strips.filter((q) => q.name === 'Mori Gate Road')) {
      for (let i = 1; i + 1 < strip.st.length; i++) {
        const [p, q, r] = [strip.st[i - 1]!, strip.st[i]!, strip.st[i + 1]!];
        const d1 = Math.hypot(q.x - p.x, q.z - p.z);
        const d2 = Math.hypot(r.x - q.x, r.z - q.z);
        if (d1 < 1 || d2 < 1) continue;
        const k = Math.abs((r.h - q.h) / d2 - (q.h - p.h) / d1) / ((d1 + d2) / 2);
        if (k > 0) tightest = Math.min(tightest, 1 / k);
      }
    }
    expect(tightest).toBeGreaterThanOrEqual(limit * (1 - 1e-6));
    expect(tightest).toBeLessThan(limit * 1.05);
    expect(Math.max(...stationsOf(b, deck).map(hag))).toBeGreaterThanOrEqual(ROAD_OVER_RAIL_M - 0.01);
  });
});

describe('crossfall', () => {
  it('the two carriageways of a street on a side slope never differ by more than 4 percent of the distance between them', () => {
    const s = new Sketch();
    const north = s.way([[-300, 8], [300, 8]], { highway: 'secondary', oneway: 'yes', name: 'Barakhamba Road' });
    const south = s.way([[300, -8], [-300, -8]], { highway: 'secondary', oneway: 'yes', name: 'Barakhamba Road' });
    // the ground steps up 1.2 m from the south carriageway to the north one: 7.5 percent across 16 m
    const ground: Ground = (_x, z) => 200 + 1.2 * smooth((2 - z) / 4);
    const { g, b, checks, res } = solve(s, ground);
    expect(g.pairs).toHaveLength(1);
    expect(res.unmet).toEqual([]);
    expect(res.pairSamples.length).toBeGreaterThan(30);
    expect(checks.crossfall.limited).toBeGreaterThan(30);
    expect(checks.crossfall.violations).toBe(0);
    expect(res.report.active.crossfall).toBeGreaterThan(0);
    expect(checks.crossfall.worstPct).toBeGreaterThan(3.9);
    expect(checks.crossfall.worstPct).toBeLessThanOrEqual(4.01);
    const mid = (w: number): number => stationsOf(b, w).find((p) => Math.abs(p.x) < 3)!.h;
    expect(mid(north) - mid(south)).toBeGreaterThan(0.5);
    expect(mid(north) - mid(south)).toBeLessThanOrEqual(CROSSFALL_MAX * 16 + 0.01);
  });
});

describe('map edge tie', () => {
  it('a road leaves the map at the height of the ground model there; a dead end is free', () => {
    const s = new Sketch();
    const through = s.way([[-700, 0], [700, 0]], { highway: 'primary' });
    const stub = s.way([[0, 0], [0, 300]], { highway: 'residential' });
    // rolling ground: a metre up and a metre down every 94 m
    const ground: Ground = (x, z) => 200 + 0.004 * x + Math.sin(x / 15) + 0.5 * Math.cos(z / 40);
    const { b, res, checks } = solve(s, ground);
    expect(b.ends.filter((e) => e.kind === 'map_edge')).toHaveLength(2);
    expect(res.ties).toHaveLength(2);
    for (const t of res.ties) {
      expect(t.kind).toBe('ground');
      expect(Math.abs(t.h - t.target)).toBeLessThan(0.02);
      const strip = b.strips[t.strip]!;
      const end = t.end === 'start' ? strip.st[0]! : strip.st[strip.st.length - 1]!;
      expect(Math.abs(Math.abs(end.x) - 500)).toBeLessThan(1);
      expect(t.target).toBeCloseTo(ground(end.x, end.z), 9);
    }
    expect(checks.ties).toEqual({ ends: 2, moved: 0, maxOffM: expect.any(Number) });
    // the road between is smoothed (it does not follow every bump), so the ties are what holds the ends
    expect(Math.max(...stationsOf(b, through).map((p) => Math.abs(hag(p))))).toBeGreaterThan(0.1);
    const dead = stationsOf(b, stub).reduce((p, q) => (q.z < p.z ? q : p));
    expect(res.ties.some((t) => b.strips[t.strip]!.st.includes(dead))).toBe(false);
  });

  it('a clearance next to the edge moves the tie, and says so: the road leaves the map in its dip under a railway bridge', () => {
    const s = new Sketch();
    s.way([[-700, 0], [700, 0]], { highway: 'secondary', name: 'Bhairon Marg' });
    s.way([[480, 300], [480, -300]], { railway: 'rail', bridge: 'yes', layer: '1' });
    const { b, res, checks } = solve(s, flat);
    expect(res.unmet).toEqual([]);
    expect(checks.clearance.violations).toBe(0);
    expect(checks.grade.violations).toBe(0);
    expect(checks.ties.moved).toBe(1);
    const east = res.ties.find((t) => (t.end === 'start' ? b.strips[t.strip]!.st[0]! : b.strips[t.strip]!.st[b.strips[t.strip]!.st.length - 1]!).x > 0)!;
    expect(east.h).toBeLessThan(east.target - 1);
    const rec = elevationRecord(b.strips, res, checks, readStructures({ strips: b.strips, joints: b.joints, junctions: [], junctionHeights: [], tunnels: res.tunnels, crossings: res.crossings, pairSamples: [], ground: flat }), { x: 0, z: 0 }, 'h', 0, {});
    expect(rec.ties.movedEnds).toHaveLength(1);
    expect(rec.ties.movedEnds[0]!.name).toBe('Bhairon Marg');
    expect(rec.ties.movedEnds[0]!.why).toMatch(/clearance next to the map edge/);
  });
});

describe('deck over water', () => {
  /** A river 120 m wide whose bed lies 1 m under its banks; a street crosses it on a bridge from bank to bank. */
  const river = (): { s: Sketch; deck: number; ground: Ground } => {
    const s = new Sketch();
    const a = s.node(-70, 0);
    const c = s.node(70, 0);
    s.way([[-400, 0], a], { highway: 'primary', name: 'Vikas Marg' });
    const deck = s.way([a, c], { highway: 'primary', name: 'Vikas Marg', bridge: 'yes', layer: '1' });
    s.way([c, [400, 0]], { highway: 'primary', name: 'Vikas Marg' });
    const ring = [s.node(-60, -300), s.node(60, -300), s.node(60, 300), s.node(-60, 300)];
    s.way([...ring, ring[0]!], { natural: 'water', water: 'river', name: 'Yamuna' });
    return { s, deck, ground: (x) => 205 - smooth((70 - Math.abs(x)) / 10) };
  };

  it('the deck is set by its clearance above the water, not only by its two banks', () => {
    const { s, deck, ground } = river();
    const { b, checks, res, st } = solve(s, ground);
    expect(res.unmet).toEqual([]);
    expect(checks.findings).toEqual([]);
    expect(checks.clearance.waterCrossings).toBe(1);
    expect(checks.clearance.minOverWaterM).toBeGreaterThanOrEqual(WATER_CLEARANCE_M - 0.02);
    expect(res.report.active.water).toBeGreaterThan(0);
    // the water is at 204: every deck station over it stands at 207.7 or higher, 2.7 m above the banks
    const wet = stationsOf(b, deck).filter((p) => Math.abs(p.x) < 60);
    expect(wet.length).toBeGreaterThan(20);
    expect(Math.min(...wet.map((p) => p.h))).toBeGreaterThanOrEqual(204 + DECK_OVER_WATER_M - 1e-4);
    expect(Math.max(...wet.map((p) => p.h))).toBeLessThan(204 + DECK_OVER_WATER_M + 0.3);
    const x = st.structures[0]!;
    expect(x.kind).toBe('deck');
    expect(x.crosses).toEqual(['water: Yamuna']);
    expect(x.untaggedM).toBeGreaterThan(20);
    expect(checks.grade.violations + checks.curves.violations).toBe(0);
  });

  it('without the rule the same bridge only joins its two banks, a metre above the bed', () => {
    const { s, deck, ground } = river();
    const { b, checks } = solve(s, ground, 500, (i) => {
      i.water = [];
    });
    expect(checks.clearance.waterCrossings).toBe(0);
    const wet = stationsOf(b, deck).filter((p) => Math.abs(p.x) < 60);
    expect(Math.max(...wet.map((p) => p.h))).toBeLessThan(205.2);
    expect(Math.min(...wet.map((p) => p.h))).toBeGreaterThan(204.7);
  });
});

describe('one solve: no steps, no kinks, the same twice', () => {
  /** A one-way road that splits in two; the left branch climbs onto a bridge over a cross street. */
  const fork = (): { s: Sketch; ground: Ground } => {
    const s = new Sketch();
    const n = s.node(0, 0);
    s.way([[-400, 0], n], { highway: 'primary', oneway: 'yes', lanes: '4', name: 'Main' });
    const a = s.node(260, 30);
    const c = s.node(340, 30);
    s.way([n, [120, 12], [200, 28], a], { highway: 'primary', oneway: 'yes', lanes: '2', name: 'Flyover' });
    s.way([a, c], { highway: 'primary', oneway: 'yes', lanes: '2', name: 'Flyover', bridge: 'yes', layer: '1' });
    s.way([c, [480, 30]], { highway: 'primary', oneway: 'yes', lanes: '2', name: 'Flyover' });
    s.way([n, [120, -12], [200, -28], [480, -30]], { highway: 'primary', oneway: 'yes', lanes: '2', name: 'Main' });
    s.way([[300, 200], [300, -10]], { highway: 'tertiary', name: 'Cross' });
    return { s, ground: (x, z) => 200 + 0.003 * x + 0.3 * Math.sin(z / 30) };
  };

  it('strips that meet have one height, and a branch leaves its main line on the main line\'s own grade', () => {
    const { s, ground } = fork();
    const { b, checks, res } = solve(s, ground);
    expect(b.joints.some((j) => j.kind === 'split')).toBe(true);
    expect(res.report.branches).toBeGreaterThan(0);
    expect(checks.steps.joints).toBe(b.joints.length);
    expect(checks.steps.maxMismatchM).toBeLessThan(1e-9);
    expect(checks.findings).toEqual([]);
    // across every joint the grade of the two strips is the same: the second difference over the joint is within the class curve limit
    for (const j of b.joints) {
      const grade = (e: { strip: number; end: 'start' | 'end' }): number => {
        const st = b.strips[e.strip]!.st;
        const [p, q] = e.end === 'start' ? [st[0]!, st[1]!] : [st[st.length - 1]!, st[st.length - 2]!];
        // rise per metre walking away from the joint
        return (q.h - p.h) / Math.hypot(q.x - p.x, q.z - p.z);
      };
      // walking through the joint the grade carries on: one side falls away as the other rises
      expect(Math.abs(grade(j.a) + grade(j.b))).toBeLessThan(8 / minCurveRadius('primary', false));
    }
  });

  it('two solves of one map agree to the last bit, and the heights file has every station', () => {
    const { s, ground } = fork();
    const one = solve(s, ground);
    const two = solve(s, ground);
    let diff = 0;
    one.b.strips.forEach((strip, si) => strip.st.forEach((p, i) => (diff = Math.max(diff, Math.abs(p.h - two.b.strips[si]!.st[i]!.h)))));
    expect(diff).toBe(0);
    expect(one.res.junctionHeights).toEqual(two.res.junctionHeights);
    const file = elevationFile(one.b.strips, one.b.junctions.map((j) => j.id), one.res, one.st, one.input.rails ?? [], 'test', 'test', 'lanes');
    expect(file.strips).toHaveLength(one.b.strips.length);
    file.strips.forEach((f, si) => {
      expect(f.h).toHaveLength(one.b.strips[si]!.st.length);
      expect(f.k).toHaveLength(f.h.length);
    });
    expect(file.junctions).toHaveLength(one.b.junctions.length);
    expect(file.structures.map((x) => x.kind)).toContain('deck');
    expect(elevationHash(file)).toBe(elevationHash(elevationFile(two.b.strips, two.b.junctions.map((j) => j.id), two.res, two.st, two.input.rails ?? [], 'test', 'test', 'lanes')));
    // every structure is in the record with its kind, sunk and structureM
    const rec = elevationRecord(one.b.strips, one.res, one.checks, one.st, { x: 100, z: -50 }, elevationHash(file), 0, {});
    expect(rec.structures.length).toBe(one.st.structures.length);
    for (const x of rec.structures) {
      expect(['deck', 'fill', 'cut', 'tunnel']).toContain(x.kind);
      expect(typeof x.sunk).toBe('number');
      expect(x.structureM).toBeGreaterThan(0);
    }
    expect(rec.structures[0]!.x).toBeCloseTo(one.st.structures[0]!.x + 100, 2);
    expect(rec.gates).toEqual({ heightSteps: 0, gradeViolations: 0, curveViolations: 0, clearanceViolations: 0, crossfallViolations: 0 });
  });

  it('a profile holds its grade and curve limits between the knots too (the spline never leaves the knot polygon\'s grades)', () => {
    const s = new Sketch();
    s.way([[-200, 0], [200, 0]], { highway: 'residential' });
    const g = s.graph();
    const b = buildLaneModel({ nodes: g.nodes, edges: g.edges, wayLanes: new Map() });
    const P = new Profiles(b.strips, b.joints, { spacing: 12 });
    expect(P.chains).toHaveLength(1);
    const c = P.chains[0]!;
    // a saw tooth on the knots: the height between them stays inside the knot values and its grade inside the steepest interval
    const x = new Float64Array(P.free);
    for (let i = 0; i <= c.m; i++) x[P.knot(0, i).idx[0]!] = i % 2 === 0 ? 0 : 0.6;
    const knots = P.knotValues(x);
    const hs = b.strips[0]!.st.map((_, i) => P.heightAt(knots, 0, i));
    expect(Math.min(...hs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...hs)).toBeLessThanOrEqual(0.6);
    const pos = P.pos[0]!;
    for (let i = 1; i < hs.length; i++) expect(Math.abs(hs[i]! - hs[i - 1]!) / (pos[i]! - pos[i - 1]!)).toBeLessThanOrEqual(0.6 / c.d + 1e-9);
    expect(hs[0]).toBe(0);
  });

  it('draws the height map north up and a side view', () => {
    const { s, ground } = fork();
    const { b, st } = solve(s, ground);
    const map = heightMapSvg(b.strips, st.structures, { minX: -500, maxX: 500, minZ: -500, maxZ: 500 }, 'test');
    expect(map).toContain('>N<');
    expect(map).toContain('deck');
    // north up, no flip: a point further north (smaller z) is drawn higher (smaller y)
    expect(map).toMatch(/viewBox="-500 -/);
    const side = profileSvg(b.strips, (strip) => strip.name === 'Flyover', 'Flyover');
    expect(side).toContain('<polyline');
    expect(profileSvg(b.strips, () => false, 'none')).toContain('no road found');
  });
});
