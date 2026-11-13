// Turn rules from the map and mid-block crossings (P1-032): restriction relations and turn:lanes read, mapped onto
// the block graph and applied by the junction planner; crossings away from the junctions placed on their strips.
import { describe, expect, it } from 'vitest';
import { taggedLanes } from '../graph/classify';
import { flat, Sketch } from '../testmap';
import { planTurns } from './connect';
import type { ArmView } from './connect';
import { checkLaneModel } from './lanechecks';
import { buildLaneModel } from './network';
import type { LaneModelInput } from './network';
import { arrivingTurns, mapRestrictions, parseTurnLanes, readTurnElements, wayTurnsOf } from './turns';

const wayLanesOf = (s: Sketch): Map<string, number> => {
  const out = new Map<string, number>();
  for (const e of s.elements) if (e.type === 'way' && e.tags?.['highway']) {
    const n = taggedLanes(e.tags);
    if (n !== null) out.set(`way/${e.id}`, n);
  }
  return out;
};
const nodeAt = (s: Sketch) => (id: number) => {
  const e = s.elements.find((x) => x.type === 'node' && x.id === id);
  return e && e.lat !== undefined && e.lon !== undefined ? { lat: e.lat, lon: e.lon } : null;
};

describe('turn lanes and restrictions from OSM', () => {
  it('reads turn:lanes per lane, an empty lane as none', () => {
    expect(parseTurnLanes('left|through;right|')).toEqual([['left'], ['through', 'right'], ['none']]);
    expect(parseTurnLanes('reverse;left|through')).toEqual([['reverse', 'left'], ['through']]);
  });

  it('reads restriction relations: turn values only, a vehicle restriction is unread', () => {
    const t = readTurnElements([
      { type: 'relation', id: 1, tags: { type: 'restriction', restriction: 'no_right_turn' }, members: [{ type: 'way', ref: 10, role: 'from' }, { type: 'node', ref: 5, role: 'via' }, { type: 'way', ref: 11, role: 'to' }] },
      { type: 'relation', id: 2, tags: { type: 'restriction', 'restriction:hgv': 'no_left_turn' }, members: [] },
      { type: 'relation', id: 3, tags: { type: 'restriction', restriction: 'no_entry' }, members: [] },
      { type: 'relation', id: 4, tags: { type: 'restriction', restriction: 'only_straight_on' }, members: [{ type: 'way', ref: 10, role: 'from' }, { type: 'way', ref: 12, role: 'via' }, { type: 'way', ref: 11, role: 'to' }] },
    ], flat, () => null);
    expect(t.restrictions.map((r) => [r.id, r.kind, r.viaNode, r.viaWays])).toEqual([['relation/1', 'no', 'n5', []], ['relation/4', 'only', null, ['way/12']]]);
    expect(t.unread.map((u) => u.id)).toEqual(['relation/2', 'relation/3']);
  });

  it('a restriction on a cross takes out its one movement in the lane model, mapped from OSM ways and the via node', () => {
    const s = new Sketch();
    const x = s.node(0, 0);
    const west = s.way([[-200, 0], x], { highway: 'secondary', name: 'West' });
    s.way([x, [200, 0]], { highway: 'secondary', name: 'East' });
    const north = s.way([[0, 200], x], { highway: 'tertiary', name: 'North' });
    s.way([x, [0, -200]], { highway: 'tertiary', name: 'South' });
    const g = s.graph();
    const rel = { type: 'relation' as const, id: 9, tags: { type: 'restriction', restriction: 'no_left_turn' }, members: [{ type: 'way', ref: west, role: 'from' }, { type: 'node', ref: x, role: 'via' }, { type: 'way', ref: north, role: 'to' }] };
    const turnInputs = readTurnElements([rel], flat, nodeAt(s));
    const m = mapRestrictions(g.nodes, g.edges, turnInputs);
    expect(m.report.mapped).toBe(1);
    expect(m.list).toHaveLength(1);
    const base: LaneModelInput = { nodes: g.nodes, edges: g.edges, wayLanes: wayLanesOf(s) };
    const free = buildLaneModel(base);
    const b = buildLaneModel({ ...base, turnInputs });
    expect(free.junctions[0]!.pairs).toHaveLength(12);
    expect(b.junctions[0]!.pairs).toHaveLength(11);
    expect(b.turnRules.restrictions).toMatchObject({ relations: 1, mapped: 1, applied: 1, movementsRemoved: 1 });
    const w = b.junctions[0]!.arms.findIndex((a) => a.edge === g.edges.find((e) => e.name === 'West')!.id);
    const n = b.junctions[0]!.arms.findIndex((a) => a.edge === g.edges.find((e) => e.name === 'North')!.id);
    expect(b.junctions[0]!.pairs.some((p) => p.from === w && p.to === n)).toBe(false);
    expect(checkLaneModel(b).continuity.breaks).toBe(0);
  });

  it('a restriction whose via node the graph does not have is listed as unmapped with why', () => {
    const s = new Sketch();
    const a = s.way([[-100, 0], [0, 0]], { highway: 'secondary' });
    const g = s.graph();
    const t = readTurnElements([{ type: 'relation', id: 7, tags: { type: 'restriction', restriction: 'no_u_turn' }, members: [{ type: 'way', ref: a, role: 'from' }, { type: 'node', ref: 999, role: 'via' }, { type: 'way', ref: a, role: 'to' }] }], flat, () => null);
    const m = mapRestrictions(g.nodes, g.edges, t);
    expect(m.report.unmapped).toEqual([{ id: 'relation/7', why: 'via node n999 is not a node of the graph (joined or cut by the repair)' }]);
  });

  it('turn lanes: the arriving direction is forward when the way runs into the node, backward when it runs away', () => {
    const s = new Sketch();
    const x = s.node(0, 0);
    const w = s.way([[-100, 0], x, [100, 0]], { highway: 'secondary', 'turn:lanes:forward': 'left|through', 'turn:lanes:backward': 'through|right' });
    const el = s.elements.find((e) => e.type === 'way' && e.id === w)!;
    const t = wayTurnsOf(el, flat, nodeAt(s), 'osm')!;
    // the west part arrives at x going east (with the way): forward; the east part arrives going west: backward
    expect(arrivingTurns(t, `n${x}`, -1, 0)).toEqual([['left'], ['through']]);
    expect(arrivingTurns(t, `n${x}`, 1, 0)).toEqual([['through'], ['right']]);
    expect(arrivingTurns(t, 'n12345', 1, 0)).toBeNull();
  });

  it('planTurns follows turn lanes: a left turn only from the lanes marked left, a movement no lane allows is taken out', () => {
    // three arms of a T: west (two lanes in, marked left and through), east, south; left of west's arrivals is north,
    // so with only "left|through" the right turn into south is not allowed
    const lanes = (ins: number, outs: number) => [
      ...Array.from({ length: ins }, (_, k) => ({ k, lat: -1.75 - 3.5 * k, width: 3.5, flow: -1 as const })),
      ...Array.from({ length: outs }, (_, k) => ({ k: ins + k, lat: 1.75 + 3.5 * k, width: 3.5, flow: 1 as const })),
    ];
    const west: ArmView = { x: -10, z: 0, ox: -1, oz: 0, edge: 'w', paired: [], lanes: lanes(2, 2), turns: [['left'], ['through']] };
    const east: ArmView = { x: 10, z: 0, ox: 1, oz: 0, edge: 'e', paired: [], lanes: lanes(2, 2) };
    const north: ArmView = { x: 0, z: -10, ox: 0, oz: -1, edge: 'n', paired: [], lanes: lanes(1, 1) };
    const south: ArmView = { x: 0, z: 10, ox: 0, oz: 1, edge: 's', paired: [], lanes: lanes(1, 1) };
    const free = planTurns([{ ...west, turns: undefined }, east, north, south]);
    const plan = planTurns([west, east, north, south]);
    expect(plan.laneArms).toBe(1);
    expect(plan.laneRestricted).toBe(1);
    expect(free.pairs.filter((p) => p.from === 0)).toHaveLength(3);
    expect(plan.pairs.filter((p) => p.from === 0).map((p) => p.kind).sort()).toEqual(['left', 'straight']);
    // the kerb lane (k 1, furthest left of the arriving traffic) is marked left, the fast lane (k 0) through
    expect(plan.turns.filter((t) => t.from === 0 && t.kind === 'left').map((t) => t.fromLane)).toEqual([1]);
    expect(plan.turns.filter((t) => t.from === 0 && t.kind === 'straight').map((t) => t.fromLane)).toEqual([0, 0]);
  });
});

describe('mid-block crossings', () => {
  const street = (marked = true): { s: Sketch; b: ReturnType<typeof buildLaneModel> } => {
    const s = new Sketch();
    const x = s.node(0, 0);
    s.way([[-300, 0], x], { highway: 'secondary', name: 'West', lanes: '4' });
    s.way([x, [300, 0]], { highway: 'secondary', name: 'East', lanes: '4' });
    s.way([x, [0, 300]], { highway: 'tertiary', name: 'North' });
    const g = s.graph();
    const points: LaneModelInput['points'] = [
      { x: -150, z: 0.5, kind: 'crossing', id: 'node/1', ...(marked ? {} : { marked: false }) },
      { x: 20, z: 0, kind: 'crossing', id: 'node/2' },
    ];
    return { s, b: buildLaneModel({ nodes: g.nodes, edges: g.edges, wayLanes: wayLanesOf(s), points }) };
  };

  it('a crossing node away from the junction is placed on its strip; one near the junction stays the arm zebra', () => {
    const { b } = street();
    expect(b.crossings).toHaveLength(1);
    const c = b.crossings[0]!;
    expect(c.id).toBe('node/1');
    expect(b.strips[c.strip]!.name).toBe('West');
    expect(Math.abs(c.x + 150)).toBeLessThan(0.01);
    expect(b.crossingReport.skipped['within 30 m of a junction (the arm zebra)']).toBe(1);
  });

  it('an unmarked crossing draws no zebra', () => {
    const { b } = street(false);
    expect(b.crossings).toHaveLength(0);
    expect(b.crossingReport.skipped['unmarked (no zebra in the map)']).toBe(1);
  });
});
