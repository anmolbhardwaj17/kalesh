// Lane paths that stay on the junction (P1-042, routes.ts) and the cluster rules that came with them.
import { describe, expect, it } from 'vitest';
import { Sketch } from '../testmap';
import { planTurns, turnPath } from './connect';
import type { ArmView } from './connect';
import { checkLaneModel, checkPlanOverlap } from './lanechecks';
import { buildLaneModel, giveWaySolved } from './network';
import type { LaneBuild } from './network';
import { deviation, directPath, outsideRing, pathAlong, routeBetween, viaLine, wanders } from './routes';
import { taggedLanes } from '../graph/classify';

const model = (s: Sketch, h = 500): LaneBuild => {
  const g = s.graph(h);
  const wayLanes = new Map<string, number>();
  for (const el of s.elements) {
    if (el.type !== 'way' || !el.tags?.['highway']) continue;
    const n = taggedLanes(el.tags);
    if (n !== null) wayLanes.set(`way/${el.id}`, n);
  }
  return buildLaneModel({ nodes: g.nodes, edges: g.edges, wayLanes });
};

describe('paths through a junction of several nodes', () => {
  const edges = [
    { a: 1, b: 2, len: 30, oneway: false, pts: [{ x: 0, z: 0 }, { x: 30, z: 0 }] },
    { a: 2, b: 3, len: 40, oneway: false, pts: [{ x: 30, z: 0 }, { x: 30, z: 40 }] },
    { a: 3, b: 1, len: 20, oneway: true, pts: [{ x: 30, z: 40 }, { x: 0, z: 0 }] },
  ];
  it('the route between two nodes runs along the edges inside, and avoids a one-way edge against its direction', () => {
    // 1 to 3: the one-way edge 3 to 1 is 20 m but counts four times against its direction; round by node 2 is 70 m
    expect(routeBetween(1, 3, edges)).toEqual([{ x: 0, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 40 }]);
    expect(routeBetween(3, 1, edges)).toEqual([{ x: 30, z: 40 }, { x: 0, z: 0 }]);
    expect(routeBetween(1, 1, edges)).toBeNull();
    expect(routeBetween(1, 9, edges)).toBeNull();
  });
  it('a path along the line through the junction stays within its corners; a corner with room turns on 4 m or more', () => {
    const p0 = { x: -20, z: -1.75, hx: 1, hz: 0 };
    const p1 = { x: 31.75, z: 60, hx: 0, hz: 1 };
    const route = routeBetween(1, 3, edges)!;
    // heading +x the left is (0, -1): the lane lies 1.75 m to the left at both ends
    const via = viaLine([{ x: 0, z: -1.75 }], route, 1.75, 1.75, [{ x: 31.75, z: 40 }]);
    const g = pathAlong(p0, via, p1);
    expect(g.how).toBe('route');
    expect(g.radius).toBeGreaterThanOrEqual(4);
    expect(deviation(g.pts, [p0, ...via, p1])).toBeLessThan(4);
    expect(g.pts[0]).toEqual(p0);
    expect(g.pts[g.pts.length - 1]).toEqual(p1);
    expect(g.length).toBeLessThan(20 + 31.75 + 61.75);
  });
  it('the length of a path outside a ring: a path inside is 0, one that bulges out counts the metres out (P1-043)', () => {
    const ring = [{ x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 10 }, { x: 0, z: 10 }];
    expect(outsideRing([{ x: 1, z: 5 }, { x: 39, z: 5 }], ring)).toBe(0);
    // within 0.3 m of the edge counts as in
    expect(outsideRing([{ x: 5, z: 10.2 }, { x: 35, z: 10.2 }], ring)).toBe(0);
    // 10 m of 30 m run 5 m outside
    expect(outsideRing([{ x: 5, z: 5 }, { x: 15, z: 5 }, { x: 15, z: 15 }, { x: 25, z: 15 }, { x: 25, z: 5 }, { x: 35, z: 5 }], ring)).toBeCloseTo(20, 0);
  });
  it('a looser corner tolerance leaves fewer corners with longer sides: wider arcs that stand a little further off the line', () => {
    // a lane along a road that wiggles by 0.6 m every 3 m, then turns right
    const via = [];
    for (let x = 0; x <= 30; x += 3) via.push({ x, z: (x / 3) % 2 ? 0.6 : 0 });
    via.push({ x: 32, z: 2 }, { x: 33, z: 6 });
    const p0 = { x: -5, z: 0, hx: 1, hz: 0 };
    const p1 = { x: 33, z: 20, hx: 0, hz: 1 };
    const tight = pathAlong(p0, via, p1, 0.4);
    const loose = pathAlong(p0, via, p1, 3);
    expect(loose.radius).toBeGreaterThan(tight.radius);
    expect(loose.radius).toBeGreaterThanOrEqual(4);
    expect(deviation(loose.pts, [p0, ...via, p1])).toBeLessThan(4);
  });
  it('two lane ends that do not face each other: the biarc loops, the direct path does not', () => {
    // the target lies behind the start and to the side, heading nearly the same way: two arcs of 900 m
    const p0 = { x: 0, z: 0, hx: 1, hz: 0 };
    const a = (3 * Math.PI) / 180;
    const p1 = { x: -50, z: -40, hx: Math.cos(a), hz: Math.sin(a) };
    const loop = turnPath(p0, p1);
    expect(loop.length).toBeGreaterThan(5000);
    expect(wanders(loop)).toBe(true);
    const d = directPath(p0, p1);
    expect(wanders(d)).toBe(false);
    expect(d.length).toBeLessThan(160);
  });
});

describe('junction clusters stay small (P1-042)', () => {
  it('a lane the U-turn of its own street does not reach takes the least sharp other movement', () => {
    const arm = (x: number, z: number, ox: number, oz: number, edge: string, paired: string[], flows: (1 | -1)[]): ArmView => ({
      x, z, ox, oz, edge, paired, lanes: flows.map((flow, k) => ({ k, lat: flow === 1 ? 3.5 - 3.5 * k : -(3.5 - 3.5 * k), width: 3.5, flow })),
    });
    // a and b are the two halves of one street (a arrives, b leaves with two lanes); c arrives beside them
    const arms = [arm(-10, 8, -1, 0, 'a', ['b'], [-1, -1]), arm(-10, -8, -1, 0, 'b', ['a'], [1, 1]), arm(-10, 30, -1, 0, 'c', [], [-1])];
    const plan = planTurns(arms, []);
    for (const l of arms[1]!.lanes) expect(plan.turns.some((t) => t.to === 1 && t.toLane === l.k)).toBe(true);
    expect(plan.pairs.some((p) => p.from === 2 && p.to === 1)).toBe(true);
  });
  const fork = (tunnel: boolean): LaneBuild => {
    // a branch that runs 4 m beside the road that goes on for 90 m; with `tunnel` it dives under after 20 m
    const s = new Sketch();
    const m = s.node(0, 0);
    const k = s.node(20, 0.9);
    s.way([[-200, 0], m], { highway: 'secondary', oneway: 'yes' });
    s.way([m, [300, 0]], { highway: 'secondary', oneway: 'yes' });
    s.way([m, k], { highway: 'secondary', oneway: 'yes' });
    s.way([k, [90, 4], [300, 80]], { highway: 'secondary', oneway: 'yes', ...(tunnel ? { tunnel: 'yes', layer: '-1' } : {}) });
    s.way([m, [0, -150]], { highway: 'residential' });
    return model(s);
  };
  it('an arm is not cut back for a stretch of another arm on another level (a road over a tunnel)', () => {
    const cuts = (b: LaneBuild): number => Math.max(...b.junctionPlans.find((p) => p.arms.length === 4)!.arms.map((a) => a.cut));
    expect(cuts(fork(false))).toBeGreaterThan(55);
    expect(cuts(fork(true))).toBeLessThan(35);
  });
  it('the crotch of a fork is a nose: three roads that leave one node side by side make a junction under 60 m long', () => {
    const s = new Sketch();
    const m = s.node(0, 0);
    s.way([[-200, 0], m], { highway: 'secondary', oneway: 'yes', lanes: '4' });
    s.way([m, [50, -5], [300, -5]], { highway: 'secondary', oneway: 'yes', lanes: '1' });
    s.way([m, [50, 4], [300, 4]], { highway: 'secondary', oneway: 'yes', lanes: '2' });
    // a two-way slip road: with all four one-way the node is a three-way split zone since P1-043 (split3.ts)
    s.way([m, [100, 40], [200, 100]], { highway: 'secondary_link' });
    const b = model(s);
    const j = b.junctionPlans.find((p) => p.arms.length === 4)!;
    expect(j.method).toBe('J1');
    expect(Math.max(...j.arms.map((a) => a.cut))).toBeLessThan(60);
    const c = checkLaneModel(b);
    expect(c.continuity.breaks).toBe(0);
    expect(c.paths.pairsWithoutPath).toBe(0);
  });
  it('edges give way on the solved levels: a bridge the heights leave on the ground beside a road', () => {
    const s = new Sketch();
    s.way([[-200, 0], [200, 0]], { highway: 'secondary', oneway: 'yes' });
    s.way([[200, 9], [-200, 9]], { highway: 'secondary', oneway: 'yes', bridge: 'yes', layer: '1' });
    const b = model(s);
    // by the tags the two are on different levels: nothing gave way
    expect(b.edgeTrims.stations).toBe(0);
    const ground = b.strips.map((st) => new Uint8Array(st.st.length));
    expect(checkPlanOverlap(b.strips, b.joints, undefined, ground)!.areaM2).toBeGreaterThan(100);
    const trims = giveWaySolved(b, ground);
    expect(trims.strips).toBe(2);
    expect(checkPlanOverlap(b.strips, b.joints, undefined, ground)!.areaM2).toBe(0);
  });
});
