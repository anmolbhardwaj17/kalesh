// The production lane model (P1-012) on small sketches: left-hand traffic, lane widths and galis, lane counts along a
// whole street, split zones, junction paths with their turn rules and radius, the explained ends, the lane graph and
// determinism. The pilot centre itself is tested in pilot_lanes.test.mjs (it needs data/).
import { describe, expect, it } from 'vitest';
import { taggedLanes } from '../graph/classify';
import type { BlockGraph } from '../graph/build';
import { Sketch } from '../testmap';
import { lanePose, planTurns, turnPath } from './connect';
import type { ArmView } from './connect';
import { checkLaneModel, checkLeftHand, checkPlanOverlap, checkWidths } from './lanechecks';
import { laneGraph, laneModelFile, laneModelHash, lanesLayer } from './laneout';
import { lanesSvg } from './lanerender';
import { GALI_MIN_LANE_M, MIN_DRIVE_LANE_M, MIN_TURN_RADIUS_M } from './model';
import type { Station, Strip } from './model';
import { CLEAR_MAX_M } from './netctx';
import { buildLaneModel } from './network';
import { stripOverlaps } from './overlap';
import { laneConflicts } from './surfaces';
import type { LaneBuild, LaneModelInput } from './network';
import { inferStreets } from './street';

const wayLanesOf = (s: Sketch): Map<string, number> => {
  const out = new Map<string, number>();
  for (const e of s.elements) {
    if (e.type !== 'way' || !e.tags?.['highway']) continue;
    const n = taggedLanes(e.tags);
    if (n !== null) out.set(`way/${e.id}`, n);
  }
  return out;
};
const model = (s: Sketch, extra: Partial<LaneModelInput> = {}, h = 500): { g: BlockGraph; b: LaneBuild } => {
  const g = s.graph(h);
  return { g, b: buildLaneModel({ nodes: g.nodes, edges: g.edges, wayLanes: wayLanesOf(s), ...extra }) };
};
const drive = (s: Strip): number => s.lanes.filter((l) => l.type === 'drive').length;
const stripsOf = (b: LaneBuild, way: number): Strip[] => b.strips.filter((s) => s.edge.startsWith(`w${way}.`));

describe('left-hand traffic and lane widths', () => {
  /** Two-way streets drawn west to east, one per class, each with a dead end at both ends. */
  const FIXTURES: { tags: Record<string, string>; lanes: number }[] = [
    { tags: { highway: 'primary', lanes: '6' }, lanes: 6 },
    { tags: { highway: 'secondary' }, lanes: 4 },
    { tags: { highway: 'tertiary' }, lanes: 2 },
    { tags: { highway: 'tertiary', lanes: '3' }, lanes: 3 },
    { tags: { highway: 'residential' }, lanes: 2 },
    { tags: { highway: 'unclassified' }, lanes: 2 },
  ];
  const s = new Sketch();
  const ways = FIXTURES.map((f, i) => s.way([[-300, 60 * i - 200], [300, 60 * i - 200]], f.tags));
  const { b } = model(s);
  it('on every two-way street of the fixture list the lanes left of the centre run with the direction of travel', () => {
    FIXTURES.forEach((f, i) => {
      const strips = stripsOf(b, ways[i]!);
      expect(strips.length).toBeGreaterThan(0);
      for (const st of strips) {
        expect(drive(st)).toBe(f.lanes);
        const lanes = st.lanes.map((l, k) => ({ l, k })).filter((x) => x.l.type === 'drive');
        const mid = st.st[Math.floor(st.st.length / 2)] as Station;
        for (const { l, k } of lanes) {
          // the way runs east: the left of travel is north (-z). A lane that runs east lies north of every lane that runs west
          const z = mid.z + mid.nz * ((mid.b[k]! + mid.b[k + 1]!) / 2);
          const north = lanes.filter((o) => o.l.dir === 1).map((o) => mid.z + mid.nz * ((mid.b[o.k]! + mid.b[o.k + 1]!) / 2));
          if (l.dir === -1) for (const n of north) expect(n).toBeLessThan(z);
        }
        expect(lanes.filter((x) => x.l.dir === 1).length).toBe(Math.ceil(f.lanes / 2));
      }
    });
    const c = checkLeftHand(b.strips);
    expect(c.twoWayStrips).toBe(FIXTURES.length);
    expect(c.wrongSide).toBe(0);
  });
  it('the check finds a strip drawn for right-hand traffic', () => {
    const wrong = stripsOf(b, ways[1]!).map((st) => ({ ...st, lanes: st.lanes.map((l) => ({ ...l, dir: (l.dir === 0 ? 0 : -l.dir) as 1 | -1 | 0 })) }));
    expect(checkLeftHand(wrong).wrongSide).toBe(wrong.length);
  });
  it(`no driving lane is narrower than ${MIN_DRIVE_LANE_M} m, except a gali lane, which is never under ${GALI_MIN_LANE_M} m`, () => {
    const t = new Sketch();
    const wide = t.way([[-300, 0], [300, 0]], { highway: 'residential', width: '5' });
    const one = t.way([[-300, 50], [300, 50]], { highway: 'residential', width: '4.4' });
    const gali = t.way([[-300, 100], [300, 100]], { highway: 'residential', width: '2' });
    const thin = t.way([[-300, 150], [300, 150]], { highway: 'living_street', width: '1.2' });
    const main = t.way([[-300, 200], [300, 200]], { highway: 'secondary', width: '6' });
    const m = model(t).b;
    const widths = (way: number): number[] => stripsOf(m, way)[0]!.lanes.filter((l) => l.type === 'drive').map((l) => l.width);
    expect(widths(wide)).toEqual([2.5, 2.5]);
    expect(widths(one)).toEqual([4.4]);
    expect(widths(gali)).toEqual([2]);
    expect(stripsOf(m, gali)[0]!.lanes.find((l) => l.type === 'drive')!.tag).toBe('gali');
    // a tag narrower than a rickshaw: the gali limit holds
    expect(widths(thin)).toEqual([GALI_MIN_LANE_M]);
    // a main road keeps a lane width a vehicle fits: four lanes on a 6 m tag are 2.75 m each
    expect(widths(main)).toEqual([2.75, 2.75, 2.75, 2.75]);
    const c = checkWidths(m.strips);
    expect(c.tooNarrow).toBe(0);
    expect(c.galiLanes).toBe(2);
    expect(c.narrowestM).toBeGreaterThanOrEqual(MIN_DRIVE_LANE_M);
    expect(c.narrowestGaliM).toBeGreaterThanOrEqual(GALI_MIN_LANE_M);
    // the check does find a lane squeezed under the limit
    const bad = m.strips.map((st) => ({ ...st, st: st.st.map((p) => ({ ...p, b: p.b.map((v, k) => (k === 2 ? v + 0.4 : v)) })) }));
    expect(checkWidths(bad).tooNarrow).toBeGreaterThan(0);
  });
});

describe('lane counts along a whole street', () => {
  /** A one-way secondary street going east, cut by side streets every `gap` metres; tags per piece. */
  const street = (pieces: { len: number; lanes?: string }[]): { s: Sketch; ways: number[] } => {
    const s = new Sketch();
    const ways: number[] = [];
    let x = -400;
    let prev = s.node(x, 0);
    pieces.forEach((p, i) => {
      x += p.len;
      const next = s.node(x, 0);
      ways.push(s.way([prev, next], { highway: 'secondary', oneway: 'yes', name: 'Marg', ...(p.lanes ? { lanes: p.lanes } : {}) }));
      if (i + 1 < pieces.length) s.way([next, [x, 120]], { highway: 'residential' });
      prev = next;
    });
    return { s, ways };
  };
  it('an untagged stretch takes the count of the tagged street, not its class default', () => {
    const { s, ways } = street([{ len: 150 }, { len: 150, lanes: '3' }, { len: 150 }, { len: 150 }]);
    const g = s.graph();
    const r = inferStreets(g, wayLanesOf(s));
    expect(ways.map((w) => r.byEdge.get(`w${w}.0`)!.lanes)).toEqual([3, 3, 3, 3]);
    expect(ways.map((w) => r.byEdge.get(`w${w}.0`)!.from)).toEqual(['street', 'tag', 'street', 'street']);
    expect(new Set(ways.map((w) => r.byEdge.get(`w${w}.0`)!.street)).size).toBe(1);
  });
  it('a stretch too short for its tapers takes the count of the street; a long one keeps its own and tapers inside the class limit', () => {
    const { s, ways } = street([{ len: 150, lanes: '3' }, { len: 40, lanes: '2' }, { len: 150, lanes: '3' }, { len: 300, lanes: '2' }]);
    const { b } = model(s);
    const counts = ways.map((w) => stripsOf(b, w).filter((st) => st.kind === 'road').map(drive));
    // one count between two junctions
    for (const c of counts) expect(new Set(c).size).toBe(1);
    expect(counts.map((c) => c[0])).toEqual([3, 3, 3, 2]);
    expect(b.streets.byEdge.get(`w${ways[1]}.0`)!.from).toBe('fit');
    // the count changes once, on a taper strip of the long two-lane stretch, inside the limit of its class (1 in 10)
    const tapers = b.strips.filter((st) => st.kind === 'taper');
    expect(tapers.map((t) => t.edge)).toEqual([`w${ways[3]}.0`]);
    expect(tapers[0]!.taper!.length).toBeGreaterThanOrEqual(10 * tapers[0]!.taper!.shift * 0.98);
    const c = checkLaneModel(b);
    expect(c.tapers.violations).toBe(0);
    expect(c.continuity.breaks).toBe(0);
    expect(b.widenings).toEqual([{ edge: `w${ways[3]}.0`, end: 'start', from: 2, to: 3 }]);
  });
});

describe('split zones on the block graph', () => {
  const diverge = (before: number): Sketch => {
    const s = new Sketch();
    const x = s.node(0, 0);
    const j = s.node(-before, 0);
    s.way([[-450, 0], j], { highway: 'trunk', oneway: 'yes' });
    s.way([j, x], { highway: 'trunk', oneway: 'yes' });
    s.way([j, [-before, 150]], { highway: 'residential' });
    s.way([x, [80, 0], [450, 0]], { highway: 'trunk', oneway: 'yes' });
    s.way([x, [60, 9], [120, 22], [300, 60], [450, 90]], { highway: 'trunk_link', oneway: 'yes' });
    return s;
  };
  it('a diverge has a gore and a nose and ends on both branches centre lines within 0.01 m', () => {
    const { b } = model(diverge(300));
    expect(b.zones).toHaveLength(1);
    const c = checkLaneModel(b);
    expect(c.zones).toMatchObject({ zones: 1, diverges: 1, withoutGoreOrNose: 0, endsOffCentreLine: 0 });
    expect(c.zones.maxEndErrorM).toBeLessThanOrEqual(0.01);
    expect(c.continuity.breaks).toBe(0);
    expect(c.continuity.splitJoints).toBe(3);
    expect(c.tapers.violations).toBe(0);
    expect(c.overlap!.areaM2).toBe(0);
    // three lanes arrive, the slip road's lane opens on a taper before the node
    expect(b.strips.filter((st) => st.kind === 'taper')).toHaveLength(1);
    // the check does find a zone that ends beside its branch
    const zone = b.strips[b.zoneStrips[0]!]!;
    const last = zone.st[zone.st.length - 1]!;
    last.x += 0.05;
    expect(checkLaneModel(b, [], false).zones.endsOffCentreLine).toBeGreaterThan(0);
  });
  it('a road too short for the taper takes the first section of the zone whole: four lanes, no taper on it; the road before the junction widens to the four lanes (P1-046)', () => {
    const { b } = model(diverge(45));
    expect(b.zones).toHaveLength(1);
    const tapers = b.strips.filter((st) => st.kind === 'taper');
    expect(tapers.map((t) => t.edge)).toEqual(['w100.0']);
    expect(b.widthFixes.tapers).toMatchObject([{ edge: 'w100.0', atStart: false, lanes: 4 }]);
    const short = b.strips.find((st) => st.kind === 'road' && Math.abs(st.st[0]!.x) < 45 && st.st[0]!.x < 0 && st.cls === 'trunk')!;
    expect(drive(short)).toBe(4);
    expect(b.fitted.map((f) => f.lanes)).toEqual([4]);
    const c = checkLaneModel(b);
    expect(c.continuity.breaks).toBe(0);
    expect(c.tapers.violations).toBe(0);
  });
  /** One one-way street west to east that splits into three at x = 0: a slip road left, the street, a ramp right (P1-043). */
  const threeWay = (lanes: number): Sketch => {
    const s = new Sketch();
    const x = s.node(0, 0);
    s.way([[-400, 0], x], { highway: 'secondary', oneway: 'yes', lanes: String(lanes) });
    s.way([x, [60, -14], [200, -60], [400, -130]], { highway: 'secondary_link', oneway: 'yes' });
    s.way([x, [100, 0], [400, 0]], { highway: 'secondary', oneway: 'yes', lanes: '2' });
    s.way([x, [60, 14], [200, 60], [400, 130]], { highway: 'primary', oneway: 'yes', lanes: '1' });
    return s;
  };
  it('a three-way split is one zone with two gores; each branch is fed only by the lanes in front of it (P1-043)', () => {
    const { b } = model(threeWay(4));
    expect(b.zones).toHaveLength(1);
    const z = b.zones[0]!;
    expect(z.mid).toBeDefined();
    expect(b.junctions).toHaveLength(0);
    const c = checkLaneModel(b);
    expect(c.zones).toMatchObject({ zones: 1, diverges: 1, withoutGoreOrNose: 0, endsOffCentreLine: 0 });
    expect(c.zones.maxEndErrorM).toBeLessThanOrEqual(0.01);
    expect(c.continuity.breaks).toBe(0);
    expect(c.continuity.splitJoints).toBe(4);
    const zone = b.strips[b.zoneStrips[0]!]!;
    expect(zone.lanes.filter((l) => l.type === 'gore')).toHaveLength(6);
    expect(drive(zone)).toBe(4);
    // the parent's four lanes go one, two and one to the slip road, the street and the ramp: no lane feeds two branches
    const into = b.joints.filter((j) => j.a.strip === b.zoneStrips[0] && j.a.end === 'start')[0]!;
    const out = b.joints.filter((j) => j.a.strip === b.zoneStrips[0] && j.a.end === 'end');
    const fed = out.map((j) => j.lanes.filter(([k]) => zone.lanes[k]!.type === 'drive').length).sort();
    expect(fed).toEqual([1, 1, 2]);
    expect(into.lanes.filter(([k]) => zone.lanes[k]!.type === 'drive')).toHaveLength(4);
    // the check finds a three-way zone whose second gore does not open
    const last = zone.st[zone.st.length - 1]!;
    const g = zone.lanes.map((l, k) => (l.type === 'gore' ? k : -1)).filter((k) => k >= 0);
    last.b[g[4]!] = last.b[g[3]!]!;
    last.b[g[5]!] = last.b[g[3]!]!;
    last.b[g[5]! + 1] = last.b[g[3]!]!;
    expect(checkLaneModel(b, [], false).zones.withoutGoreOrNose).toBe(1);
  });
  it('a three-way split with more lanes after it than before: the widest branch starts narrower and widens on its kerb side', () => {
    const { b } = model(threeWay(3));
    expect(b.zones).toHaveLength(1);
    const zone = b.strips[b.zoneStrips[0]!]!;
    expect(drive(zone)).toBe(3);
    const c = checkLaneModel(b);
    expect(c.zones.withoutGoreOrNose + c.zones.endsOffCentreLine + c.continuity.breaks).toBe(0);
    // the street gets its second lane on a taper after the zone
    const street = b.strips.filter((st) => st.cls === 'secondary' && !st.link && st.st[0]!.x > 0);
    expect(street.some((st) => st.kind === 'taper')).toBe(true);
    expect(Math.max(...street.map(drive))).toBe(2);
  });
  it('an entry of a roundabout is a give-way junction, with the reason', () => {
    const s = new Sketch();
    const ids: number[] = [];
    for (let i = 0; i < 24; i++) ids.push(s.node(Math.cos((-i / 24) * 2 * Math.PI) * 60, Math.sin((-i / 24) * 2 * Math.PI) * 60));
    s.way([...ids, ids[0]!], { highway: 'secondary', oneway: 'yes', junction: 'roundabout' });
    // an entry that runs in almost along the ring, and an exit elsewhere (so the ring is two edges)
    s.way([[-80, -300], [-70, -60], ids[13]!], { highway: 'secondary', oneway: 'yes' });
    s.way([ids[2]!, [200, -80]], { highway: 'tertiary' });
    const { b } = model(s);
    expect(b.zones).toHaveLength(0);
    expect(b.forks.map((f) => f.why)).toEqual(['an entry or exit of a roundabout: a give-way junction']);
    expect(checkLaneModel(b).continuity.breaks).toBe(0);
  });
});

describe('connecting lane paths through a junction', () => {
  const cross = (): Sketch => {
    const s = new Sketch();
    const x = s.node(0, 0);
    s.way([[-200, 0], x], { highway: 'secondary', name: 'West' });
    s.way([x, [200, 0]], { highway: 'secondary', name: 'East' });
    s.way([[0, 200], x], { highway: 'tertiary', name: 'North' });
    s.way([x, [0, -200]], { highway: 'tertiary', name: 'South' });
    return s;
  };
  it('every pair of arms the turn rules allow has a path that turns on 4 m or more; a left turn runs kerb lane to kerb lane', () => {
    const { b } = model(cross());
    expect(b.junctions).toHaveLength(1);
    const j = b.junctions[0]!;
    expect(j.arms).toHaveLength(4);
    expect(j.pairs).toHaveLength(12);
    const c = checkLaneModel(b);
    expect(c.paths).toMatchObject({ pairs: 12, pairsWithoutPath: 0, pairsBelowRadius: 0, pathsBelowRadius: 0 });
    expect(c.paths.minRadiusM!).toBeGreaterThanOrEqual(MIN_TURN_RADIUS_M);
    expect(c.continuity.breaks).toBe(0);
    expect(c.paths.stopLines).toBe(4);
    for (const p of j.paths.filter((q) => q.turn === 'left')) {
      // the lane it leaves and the lane it enters are both the outermost driving lane of their strip
      for (const [strip, lane] of [p.from, p.to]) {
        const st = b.strips[strip]!;
        const drives = st.lanes.map((l, k) => ({ l, k })).filter((x) => x.l.type === 'drive').map((x) => x.k);
        expect([drives[0], drives[drives.length - 1]]).toContain(lane);
      }
      // a left turn in left-hand traffic is the short way round: shorter than the right turn between the same arms would be
      expect(p.length).toBeLessThan(Math.min(...j.paths.filter((q) => q.turn === 'right').map((q) => q.length)));
    }
    // every path starts and ends on its lanes: on the stations of the two strips
    for (const p of j.paths) {
      const a = b.strips[p.from[0]]!;
      const ends = [a.st[0]!, a.st[a.st.length - 1]!].map((st) => ({ x: st.x + st.nx * ((st.b[p.from[1]]! + st.b[p.from[1] + 1]!) / 2), z: st.z + st.nz * ((st.b[p.from[1]]! + st.b[p.from[1] + 1]!) / 2) }));
      expect(Math.min(...ends.map((e) => Math.hypot(e.x - p.pts[0]!.x, e.z - p.pts[0]!.z)))).toBeLessThan(0.01);
    }
  });
  it('turn restrictions: "no" takes one movement out, "only" every other one', () => {
    const s = cross();
    const g = s.graph();
    const id = (name: string): string => g.edges.find((e) => e.name === name)!.id;
    const base = { nodes: g.nodes, edges: g.edges, wayLanes: wayLanesOf(s) };
    const no = buildLaneModel({ ...base, restrictions: [{ from: id('West'), to: id('North'), kind: 'no' }] });
    expect(no.junctions[0]!.pairs).toHaveLength(11);
    expect(no.turns.restricted).toBe(1);
    const only = buildLaneModel({ ...base, restrictions: [{ from: id('West'), to: id('East'), kind: 'only' }] });
    expect(only.junctions[0]!.pairs).toHaveLength(10);
    const west = only.junctions[0]!.arms.findIndex((a) => a.edge === id('West'));
    expect(only.junctions[0]!.pairs.filter((p) => p.from === west).map((p) => p.kind)).toEqual(['straight']);
    expect(checkLaneModel(only).continuity.breaks).toBe(0);
  });
  it('one-way rules: nothing turns into a one-way street against its direction, and a U-turn needs a median opening', () => {
    const s = new Sketch();
    const x = s.node(0, 0);
    s.way([[-200, 0], x, [200, 0]], { highway: 'secondary', oneway: 'yes', name: 'One way' });
    s.way([[0, 200], x, [0, -200]], { highway: 'tertiary', name: 'Cross' });
    const { b } = model(s);
    const j = b.junctions[0]!;
    const arriving = j.arms.map((a, i) => ({ a, i })).filter(({ a }) => a.edge === j.arms.find((q) => b.strips[q.strip]!.cls === 'secondary' && q.end === 'end')!.edge).map((x) => x.i);
    // no path ends on the arm where the one-way street arrives
    expect(j.pairs.filter((p) => arriving.includes(p.to))).toHaveLength(0);
    expect(j.pairs.some((p) => p.kind === 'u')).toBe(false);
    expect(checkLaneModel(b).continuity.breaks).toBe(0);
  });
  it('path shapes: a fillet as wide as its shorter side, two arcs for a shift sideways and for a U-turn', () => {
    const corner = turnPath({ x: 0, z: 0, hx: 1, hz: 0 }, { x: 6, z: -6, hx: 0, hz: -1 });
    expect(corner.how).toBe('fillet');
    expect(corner.radius).toBeCloseTo(6, 6);
    expect(corner.length).toBeCloseTo((Math.PI / 2) * 6, 1);
    const shift = turnPath({ x: 0, z: 0, hx: 1, hz: 0 }, { x: 20, z: 2, hx: 1, hz: 0 });
    expect(shift.how).toBe('biarc');
    expect(shift.radius).toBeCloseTo((20 * 20 + 2 * 2) / (4 * 2), 3);
    const u = turnPath({ x: 0, z: 0, hx: 1, hz: 0 }, { x: 0, z: -9, hx: -1, hz: 0 });
    expect(u.radius).toBeCloseTo(4.5, 6);
    const last = u.pts[u.pts.length - 1]!;
    expect([last.x, last.z]).toEqual([0, -9]);
    expect(turnPath({ x: 0, z: 0, hx: 1, hz: 0 }, { x: 30, z: 0, hx: 1, hz: 0 }).radius).toBe(Infinity);
  });
  it('a U-turn between the two carriageways of a street ends in a lane it reaches on the radius, or is left out', () => {
    const arm = (x: number, z: number, ox: number, oz: number, edge: string, paired: string[], flows: (1 | -1)[]): ArmView => ({
      x, z, ox, oz, edge, paired, lanes: flows.map((flow, k) => ({ k, lat: flow === 1 ? 5.25 - 3.5 * k : -(5.25 - 3.5 * k), width: 3.5, flow })),
    });
    // two carriageways 12 m apart seen from a median opening: one arrives (lanes on the right looking out), one leaves
    const arms = [arm(-10, 6, -1, 0, 'a', ['b'], [-1, -1, -1]), arm(-10, -6, -1, 0, 'b', ['a'], [1, 1, 1])];
    const radius = (f: number, fl: ArmView['lanes'][number], t: number, tl: ArmView['lanes'][number]): number => turnPath(lanePose(arms[f]!, fl, true), lanePose(arms[t]!, tl, false)).radius;
    const plan = planTurns(arms, [], radius);
    expect(plan.pairs).toEqual([{ from: 0, to: 1, kind: 'u' }]);
    expect(radius(0, arms[0]!.lanes[plan.turns[0]!.fromLane]!, 1, arms[1]!.lanes[plan.turns[0]!.toLane]!)).toBeGreaterThanOrEqual(MIN_TURN_RADIUS_M);
    // carriageways too close for any lane: the U-turn is left out and counted
    const close = [arm(-10, 2, -1, 0, 'a', ['b'], [-1]), arm(-10, -2, -1, 0, 'b', ['a'], [1])];
    const tight = planTurns(close, [], (f, fl, t, tl) => turnPath(lanePose(close[f]!, fl, true), lanePose(close[t]!, tl, false)).radius);
    expect(tight.uTurnsTooTight).toBe(1);
  });
});

describe('ends, the lane graph and the files', () => {
  const s = new Sketch();
  const x = s.node(0, 0);
  s.way([[-900, 0], x], { highway: 'secondary', name: 'In' });
  s.way([x, [300, 0]], { highway: 'secondary', name: 'Out' });
  s.way([x, [0, 200]], { highway: 'residential' });
  const { g, b } = model(s);
  it('a lane that ends is explained: the road leaves the stage, or it is a dead end', () => {
    expect(b.ends.map((e) => e.kind).sort()).toEqual(['dead_end', 'dead_end', 'map_edge']);
    const c = checkLaneModel(b);
    expect(c.continuity.breaks).toBe(0);
    expect(c.explainedEnds).toEqual({ dead_end: 2, map_edge: 1 });
    // without the explanations the same lanes are breaks
    b.ends.length = 0;
    expect(checkLaneModel(b, [], false).continuity.breaks).toBeGreaterThan(0);
  });
  it('the lane graph follows a lane through the junction: lane, path, lane', () => {
    const m = model(s).b;
    const lg = laneGraph(m, 'test', { x: 1000, z: 2000 });
    const byId = new Map(lg.lanes.map((l) => [l.id, l]));
    const path = lg.paths.find((p) => p.turn === 'straight')!;
    expect(byId.get(path.from)!.next).toContain(path.id);
    expect(byId.has(path.to)).toBe(true);
    // points run in the direction of travel: the path starts where its lane ends
    const from = byId.get(path.from)!;
    const end = from.pts[from.pts.length - 1]!;
    expect(Math.hypot(end[0] - path.pts[0]![0], end[1] - path.pts[0]![1])).toBeLessThan(0.02);
    // filed under world tiles: block metres plus the offset
    expect(Object.keys(lg.tiles).every((t) => /^-?\d+_-?\d+$/.test(t))).toBe(true);
    expect(Object.values(lg.tiles).reduce((n, t) => n + t.lanes.length, 0)).toBe(lg.lanes.length);
    const layer = lanesLayer(m, 'test', { x: 1000, z: 2000 });
    expect(layer.strips).toHaveLength(m.strips.length);
    expect(layer.strips[0]!.ref[0]![0]).toBeCloseTo(m.strips[0]!.st[0]!.x + 1000, 2);
    expect(lanesSvg(m, { minX: -300, maxX: 300, minZ: -300, maxZ: 300 }, 'test')).toContain('<svg');
  });
  it('the same input gives the same model and the same hash twice; a filter builds a part of it', () => {
    const input = { nodes: g.nodes, edges: g.edges, wayLanes: wayLanesOf(s) };
    const h1 = laneModelHash(laneModelFile(buildLaneModel(input), 'test', 'test'));
    const h2 = laneModelHash(laneModelFile(buildLaneModel(input), 'test', 'test'));
    expect(h1).toBe(h2);
    const part = buildLaneModel({ ...input, filter: { classes: ['secondary'] } });
    expect(part.strips.every((st) => st.cls === 'secondary')).toBe(true);
    expect(part.junctions).toHaveLength(1);
    expect(checkPlanOverlap(part.strips, part.joints).areaM2).toBe(0);
  });
});

describe('edges give way (P1-031)', () => {
  // two one-way secondary roads (6.6 m carriageway, 2 m footpath on the left) drawn 9 m apart: the carriageways and
  // kerbs keep clear (7.2 m), the footpaths between them do not
  const s = new Sketch();
  const west = s.way([[-200, 0], [200, 0]], { highway: 'secondary', oneway: 'yes', name: 'Upper Road' });
  const east = s.way([[200, 9], [-200, 9]], { highway: 'secondary', oneway: 'yes', name: 'Lower Road' });
  const { b } = model(s);
  /** The narrower footpath of a strip at a station: the one that faces the other road. */
  const footOf = (st: Strip, at: Station): number => Math.min(...st.lanes.map((l, k) => (l.type === 'footpath' ? at.b[k]! - at.b[k + 1]! : Infinity)));
  it('the facing footpaths narrow until the two strips share no area; the carriageways stay as they are', () => {
    expect(checkPlanOverlap(b.strips, b.joints).areaM2).toBe(0);
    expect(b.edgeTrims.strips).toBe(2);
    for (const way of [west, east]) {
      for (const st of stripsOf(b, way)) {
        const mid = st.st[Math.floor(st.st.length / 2)]!;
        // 9 m between the centre lines: 3.3 + 0.3 on each side leaves 1.8 m, shared by the two footpaths
        expect(footOf(st, mid)).toBeCloseTo(0.9, 1);
        st.lanes.forEach((l, k) => {
          if (l.type === 'drive') expect(mid.b[k]! - mid.b[k + 1]!).toBeCloseTo(l.width, 6);
        });
      }
    }
  });
  it('roads far enough apart keep their edges whole', () => {
    const one = new Sketch();
    one.way([[-200, 0], [200, 0]], { highway: 'secondary', oneway: 'yes' });
    const far = one.way([[200, 30], [-200, 30]], { highway: 'secondary', oneway: 'yes' });
    const { b: apart } = model(one);
    expect(apart.edgeTrims.stations).toBe(0);
    expect(stripsOf(apart, far).length).toBeGreaterThan(0);
  });
});

describe('slow forks and free ends (P1-033)', () => {
  it('a fork built as a junction (a side street at the split node) is cut back to where its branches come apart', () => {
    // a one-way road splits at a node a side street also meets (so it is a junction, not a split zone); the branch
    // that leaves runs 4 m from the one that goes on for 45 m before it bends away
    const fork = (besideM: number): LaneBuild => {
      const s = new Sketch();
      const m = s.node(0, 0);
      s.way([[-200, 0], m], { highway: 'secondary', oneway: 'yes' });
      s.way([m, [300, 0]], { highway: 'secondary', oneway: 'yes' });
      s.way([m, [besideM, 4], [300, 80]], { highway: 'secondary', oneway: 'yes' });
      s.way([m, [0, -150]], { highway: 'residential' });
      return model(s).b;
    };
    const b = fork(45);
    expect(b.zones.length).toBe(0);
    expect(checkPlanOverlap(b.strips, b.joints).areaM2).toBe(0);
    const j = b.junctionPlans.find((p) => p.arms.length === 4)!;
    // the two branches leave the junction where their carriageways (6.6 m each) are clear of each other
    const branches = j.arms.filter((a) => Math.abs(a.angle) < 0.5);
    expect(branches.length).toBe(2);
    // one of them is enough: its strip starts where the other one's surface has gone
    expect(Math.max(...branches.map((a) => a.cut))).toBeGreaterThan(40);
    // beside each other for 90 m: the junction stops 60 m out (CLEAR_MAX_M) and what lies on each other beyond is
    // handed back to the repair as two roads drawn too close, although they share the node (P1-042)
    const far = fork(90);
    const farCuts = far.junctionPlans.find((p) => p.arms.length === 4)!.arms.filter((a) => Math.abs(a.angle) < 0.5).map((a) => a.cut);
    expect(Math.max(...farCuts)).toBeGreaterThan(55);
    expect(Math.max(...farCuts)).toBeLessThanOrEqual(CLEAR_MAX_M + 0.5);
    const back = laneConflicts(far, stripOverlaps(far.strips, far.joints).overlaps);
    expect(back.conflicts.length).toBe(1);
    expect(back.skipped['shared node'] ?? 0).toBe(0);
    // every arm names the raised edge widths its strip end has, looking away from the junction
    const lj = b.junctions.find((x) => x.arms.length === 4)!;
    for (const a of lj.arms) {
      const st = b.strips[a.strip]!;
      const end = a.end === 'start' ? st.st[0]! : st.st[st.st.length - 1]!;
      const drv = st.lanes.map((l, k) => (l.type === 'drive' ? k : -1)).filter((k) => k >= 0);
      const left = end.b[0]! - end.b[drv[0]!]!;
      const right = end.b[drv[drv.length - 1]! + 1]! - end.b[end.b.length - 1]!;
      expect(a.edges[0]).toBeCloseTo(a.end === 'start' ? left : right, 2);
      expect(a.edges[1]).toBeCloseTo(a.end === 'start' ? right : left, 2);
    }
  });
  it('a dead end drawn into another road stops where that road begins, and keeps its explained end', () => {
    const s = new Sketch();
    s.way([[-200, 0], [200, 0]], { highway: 'secondary', oneway: 'yes' });
    const lane = s.way([[0, 80], [0, 1]], { highway: 'service' });
    const { b } = model(s);
    expect(checkPlanOverlap(b.strips, b.joints).areaM2).toBe(0);
    expect(b.endClips.ends).toBe(1);
    const st = stripsOf(b, lane);
    expect(st.length).toBe(1);
    expect(b.ends.some((e) => e.strip === b.strips.indexOf(st[0]!) && e.kind === 'dead_end')).toBe(true);
    // drawn to 1 m from the secondary road's centre line, it stops at its carriageway edge (3.3 m) or before
    const end = st[0]!.st[st[0]!.st.length - 1]!;
    expect(Math.abs(end.z)).toBeGreaterThan(3.3);
  });
});
