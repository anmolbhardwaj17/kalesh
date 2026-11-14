// Auto-repair on small synthetic maps (MAP_REPAIR.md "Auto-repair bounds", "Repair log"): each bound from both
// sides, the things that are never automatic, the repair log, provisional proposals, and the fixed point (a second
// run on the repaired graph applies nothing). The pilot centre is tested in pilot_repair.test.mjs.
import { describe, expect, it } from 'vitest';
import raw from '../../../harness/data/hero_roads/cp_inner_circle.json?raw';
import type { HeroSpec } from '../roads/hero';
import { checkGraph, graphHash } from '../graph/checks';
import type { BlockGraph } from '../graph/build';
import { projectOn } from '../rules/context';
import { pairGaps } from '../rules/lanes';
import type { Issue, RuleEnv } from '../rules/types';
import { Sketch, rulesOn, testEnv } from '../testmap';
import { BOUNDS, POLICY, decide, isLowImpact, policyOf } from './bounds';
import { issueRecords, policyLines, repairGraph, repairLog } from './engine';
import type { RepairResult } from './engine';
import { issuesSvg } from './render';

/** A spec file for the test street "Janpath": with it the road is a hero road whose cross-section is frozen. */
const janpathSpec = { ...(JSON.parse(raw) as HeroSpec), id: 'janpath' };
const run = (s: Sketch, env: Partial<RuleEnv> = {}): RepairResult => repairGraph(s.graph(), testEnv({ nodeTags: s.nodeTags(), ...env }));
const of = (r: RepairResult, rule: string): Issue[] => r.issues.filter((i) => i.rule === rule);
const edge = (g: BlockGraph, id: string) => g.edges.find((e) => e.id === id)!;

/** A road along north 0 and a side road that stops `gap` metres short of it. */
function nearMiss(gap: number, tags: Record<string, string> = {}): Sketch {
  const s = new Sketch();
  s.way([[0, 0], [100, 0]], { highway: 'residential', ...tags });
  s.way([[50, 60], [50, gap]], { highway: 'residential' });
  return s;
}

/** The two carriageways of a street drawn `gap` metres apart (their lanes and the median need 7.2 m). */
function closePair(gap: number): Sketch {
  const s = new Sketch();
  s.way([[-200, gap / 2], [200, gap / 2]], { highway: 'secondary', oneway: 'yes', name: 'Vikas Marg' });
  s.way([[200, -gap / 2], [-200, -gap / 2]], { highway: 'secondary', oneway: 'yes', name: 'Vikas Marg' });
  return s;
}

/** A street of two edges: the first tagged with 3 lanes, the second with the class default. */
function laneStreet(cls: string): Sketch {
  const s = new Sketch();
  const n = s.node(0, 0);
  s.way([[-200, 0], n], { highway: cls, name: 'X Marg', lanes: '3' });
  s.way([n, [200, 0]], { highway: cls, name: 'X Marg' });
  s.way([n, [0, 90]], { highway: 'residential' });
  return s;
}

const spike = (m: number) => (x: number): number => 210 + (Math.abs(x - 150) < 1 ? m : 0);
const longRoad = (): Sketch => {
  const s = new Sketch();
  s.way([[0, 0], [300, 0]], { highway: 'secondary' });
  return s;
};

describe('auto-repair bounds (AR1)', () => {
  it('names every bound of MAP_REPAIR.md and compares in millimetres', () => {
    expect(BOUNDS).toEqual({ joinM: 5, buildingIntoRoadM: 1.5, heightOutlierM: 3, carriagewayShiftM: 2.5, joinSupportedM: 8, portalM: 15 });
    expect(isLowImpact({ kind: 'portal', m: 15 })).toBe(true);
    expect(isLowImpact({ kind: 'portal', m: 15.1 })).toBe(false);
    expect(isLowImpact({ kind: 'join', m: 5 })).toBe(true);
    expect(isLowImpact({ kind: 'join', m: 5.0000000001 })).toBe(true);
    expect(isLowImpact({ kind: 'join', m: 5.1 })).toBe(false);
    // P1-030: a join the geometry supports reaches 8 m; a dead end, a gali width, a building that gives way, a way
    // drawn twice and a hero road's own spec are the bake's to settle
    expect(isLowImpact({ kind: 'join', m: 8, supported: true })).toBe(true);
    expect(isLowImpact({ kind: 'join', m: 8.1, supported: true })).toBe(false);
    for (const kind of ['dead_end', 'hero_spec'] as const) expect(isLowImpact({ kind })).toBe(true);
    expect(isLowImpact({ kind: 'gali_width', m: 4 })).toBe(true);
    expect(isLowImpact({ kind: 'building_gives_way', m: 4 })).toBe(true);
    expect(isLowImpact({ kind: 'duplicate_way', share: 0.6 })).toBe(true);
    expect(isLowImpact({ kind: 'duplicate_way', share: 0.5 })).toBe(false);
    expect(isLowImpact({ kind: 'bridge_layer_tag' })).toBe(true);
    expect(isLowImpact({ kind: 'building_into_road', m: 1.5, classDefault: true, fits: true })).toBe(true);
    expect(isLowImpact({ kind: 'building_into_road', m: 1.6, classDefault: true, fits: true })).toBe(false);
    expect(isLowImpact({ kind: 'building_into_road', m: 1, classDefault: false, fits: true })).toBe(false);
    expect(isLowImpact({ kind: 'duplicate_footprint', exact: true })).toBe(true);
    expect(isLowImpact({ kind: 'duplicate_footprint', exact: false })).toBe(false);
    expect(isLowImpact({ kind: 'height_outlier', m: 3 })).toBe(true);
    expect(isLowImpact({ kind: 'height_outlier', m: 3.1 })).toBe(false);
    expect(isLowImpact({ kind: 'carriageway_shift', m: 2.5 })).toBe(true);
    expect(isLowImpact({ kind: 'carriageway_shift', m: 2.6 })).toBe(false);
    expect(isLowImpact({ kind: 'slip_redraw', m: 2.5 })).toBe(true);
    expect(isLowImpact({ kind: 'slip_redraw', m: 2.6 })).toBe(false);
    expect(isLowImpact({ kind: 'lane_count', cls: 'secondary' })).toBe(true);
    for (const cls of ['motorway', 'trunk', 'primary']) expect(isLowImpact({ kind: 'lane_count', cls })).toBe(false);
    expect(isLowImpact({ kind: 'other' })).toBe(false);
    expect(isLowImpact({ kind: 'one_way_no_pair' })).toBe(false);
  });

  it('a 5.0 m join repairs on its own: the end is joined, the other road is cut there', () => {
    const r = run(nearMiss(5.0));
    const [issue] = of(r, 'R-ROAD-01');
    expect(issue!.status).toBe('auto_repaired');
    expect(issue!.note).toBe('gap 5 m');
    expect(r.repairs).toHaveLength(1);
    const line = r.repairs[0]!;
    expect(line).toMatchObject({ rule: 'R-ROAD-01', issue: issue!.id, confidence: 0.85 });
    expect(line.before).toMatchObject({ len: 55 });
    expect(line.after).toMatchObject({ len: 60, at: [50, 0] });
    expect(line.patch).toMatchObject({ action: 'connect', issue: issue!.id, by: 'bake' });
    // one junction where the dead end was: three edges meet at (50, 0)
    const j = r.graph.nodes.find((n) => n.x === 50 && n.z === 0)!;
    expect(j).toMatchObject({ kind: 'junction', ends: 3 });
    expect(r.graph.edges).toHaveLength(3);
    expect(checkGraph(r.graph)).toMatchObject({ duplicateEdges: [], zeroLengthEdges: [], missingNodes: [], orphanNodes: [] });
  });

  it('a dead end is decided by the geometry: joined up to 8 m straight ahead, closed at a wall, a gate or beside the road (P1-030)', () => {
    // 8 m straight ahead with nothing between: joined
    expect(of(run(nearMiss(8)), 'R-ROAD-01')[0]!.status).toBe('auto_repaired');
    expect(run(nearMiss(8)).repairs[0]!.patch).toMatchObject({ action: 'connect', params: { op: 'join_end', gap_m: 8 } });
    // a building in the gap: a real dead end, closed there, and the rule does not ask again
    const wall = nearMiss(7);
    wall.building([[45, 2], [55, 2], [55, 5], [45, 5]]);
    const w = run(wall);
    expect(of(w, 'R-ROAD-01').map((i) => [i.status, i.proposals.map((p) => p.action).join()])).toEqual([['auto_repaired', 'connect,terminate']]);
    expect(w.repairs.find((l) => l.rule === 'R-ROAD-01')!.patch).toMatchObject({ action: 'terminate', params: { with: 'dead_end' } });
    expect(Object.values(w.graph.marks).filter((m) => m['closure'] === 'dead_end')).toHaveLength(1);
    expect(w.graph.nodes.some((n) => n.kind === 'junction')).toBe(false);
    expect(repairGraph(w.graph, testEnv()).repairs).toEqual([]);
    // a gate on the end node
    const gate = new Sketch();
    gate.way([[0, 0], [100, 0]], { highway: 'residential' });
    gate.way([[50, 60], gate.node(50, 4, { barrier: 'gate' })], { highway: 'service' });
    const g = run(gate);
    expect(g.repairs.find((l) => l.rule === 'R-ROAD-01')!.patch.params).toMatchObject({ with: 'gate' });
    // an end that runs past the road without pointing at it
    const past = new Sketch();
    past.way([[0, 0], [100, 0]], { highway: 'residential' });
    past.way([[10, 9], [60, 9]], { highway: 'service' });
    expect(run(past).repairs.filter((l) => l.rule === 'R-ROAD-01').map((l) => l.patch.action)).toEqual(['terminate', 'terminate']);
    // an end on the other road's surface is joined whatever way it points
    const on = new Sketch();
    on.way([[0, 0], [100, 0]], { highway: 'residential' });
    on.way([[10, 30], [50, 3]], { highway: 'service' });
    expect(run(on).repairs.find((l) => l.rule === 'R-ROAD-01')!.patch.action).toBe('connect');
  });

  it('a clear line to a road over 8 m ahead is left for the top view: queued, with ranked proposals, and provisional', () => {
    const r = run(nearMiss(8.1));
    const [issue] = of(r, 'R-ROAD-01');
    expect(issue!.status).toBe('open');
    expect(r.repairs).toEqual([]);
    expect(issue!.proposals.map((p) => [p.action, p.confidence, p.lowImpact])).toEqual([['connect', 0.5, false], ['terminate', 0.5, false]]);
    for (const p of issue!.proposals) {
      expect(p.reasoning.length).toBeGreaterThan(10);
      expect(p.preview.length).toBeGreaterThan(0);
    }
    // a queued issue never blocks the bake: the top proposal is in the map, marked provisional
    expect(issue!.provisional).toBe(true);
    expect(issue!.decided).toBeUndefined();
    expect(r.provisional).toMatchObject([{ rule: 'R-ROAD-01', action: 'connect', applied: true, how: 'graph' }]);
    expect(r.graph.nodes.some((n) => n.kind === 'junction')).toBe(true);
    expect(repairGraph(nearMiss(8.1).graph(), testEnv(), { provisional: false }).graph.nodes.some((n) => n.kind === 'junction')).toBe(false);
  });

  it('a 2.5 m carriageway shift repairs within the signed bounds; 2.6 m is settled by the policy table, with its reason', () => {
    const r = run(closePair(2.2));
    const [issue] = of(r, 'R-LANE-FIT-01');
    expect(issue!.proposals[0]!.params).toMatchObject({ shift_m: 2.5, min_sep: 7.2 });
    expect(issue!.status).toBe('auto_repaired');
    // away from their ends the two lines now keep their distance (within the rule's 0.25 m); the pair shift fades at
    // their end nodes, and R-LANE-05 then moves those (dead ends here) apart too
    const gaps = pairGaps(rulesOn(r.graph));
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.minD).toBeGreaterThanOrEqual(7.2 - 0.25);
    expect(gaps[0]!.minD).toBeLessThan(7.3);
    expect(r.repairs[0]!.after).toMatchObject({ a: { moved_m: 2.52 }, b: { moved_m: 2.52 } });
    expect(r.repairs.map((x) => x.rule)).toEqual(['R-LANE-FIT-01', 'R-LANE-05']);
    for (const e of r.graph.edges) {
      expect(Math.abs(e.pts[0]!.x)).toBe(200);
      expect(Math.abs(e.pts[0]!.z)).toBeGreaterThan(1.1);
    }
    const q = run(closePair(2.0));
    expect(of(q, 'R-LANE-FIT-01')[0]!.proposals[0]!.params).toMatchObject({ shift_m: 2.6 });
    // over the signed bound: no longer a question for the owner (P1-030). The same patch goes in, on the policy's word
    const over = of(q, 'R-LANE-FIT-01')[0]!;
    expect(decide(over)).toMatchObject({ mode: 'queued', why: 'over the low impact bound' });
    expect(over).toMatchObject({ status: 'auto_repaired', decided: 'policy', decision: POLICY['R-LANE-FIT-01'] });
    expect(over.provisional).toBeUndefined();
    expect(q.repairs.filter((l) => l.rule === 'R-LANE-FIT-01')).toEqual([]);
    expect(policyLines(q).filter((l) => l.rule === 'R-LANE-FIT-01')).toMatchObject([{ issue: over.id, decided: POLICY['R-LANE-FIT-01'], patch: { by: 'bake-policy' } }]);
    expect(q.summary.queued).toBe(0);
    expect(q.summary.decidedPolicy).toBeGreaterThanOrEqual(1);
    expect(pairGaps(rulesOn(q.graph))[0]!.minD).toBeGreaterThanOrEqual(7.2 - 0.25);
  });

  it('a 3.0 m height outlier repairs within the bounds; a bigger one is smoothed on the policy (the solver smooths in any case)', () => {
    const r = run(longRoad(), { heightSource: spike(3) });
    const [issue] = of(r, 'R-TERR-03');
    expect(issue!.proposals[0]!.params).toMatchObject({ mode: 'smooth_profile', max_m: 3 });
    expect(issue!.status).toBe('auto_repaired');
    expect(r.repairs[0]!.after).toMatchObject({ profile: 'smoothed' });
    expect(r.graph.marks[issue!.features[0]!]).toMatchObject({ profile: 'smoothed' });
    const q = run(longRoad(), { heightSource: spike(3.1) });
    expect(of(q, 'R-TERR-03')[0]).toMatchObject({ status: 'auto_repaired', decided: 'policy' });
    expect(q.repairs).toEqual([]);
    expect(q.graph.marks[of(q, 'R-TERR-03')[0]!.features[0]!]).toMatchObject({ profile: 'smoothed' });
  });

  it('a hero road with a spec file is never changed: a dead end beside it is closed, not joined; one without a spec is repaired like any road', () => {
    const heroList = [{ id: 'janpath', name: 'Janpath', osmNames: ['Janpath'] }];
    const s = nearMiss(3, { name: 'Janpath' });
    const before = s.graph();
    const r = run(s, { heroList, heroSpecs: [janpathSpec] });
    const [issue] = of(r, 'R-ROAD-01');
    expect(issue).toMatchObject({ hero: 'janpath', heroSpec: true });
    expect(issue!.impact).toBeGreaterThanOrEqual(0.9);
    // a road with a spec gets no new junction: the end beside it is closed, by rule, without a question
    expect(issue!.proposals.map((p) => [p.action, p.confidence])).toEqual([['connect', 0.2], ['terminate', 0.8]]);
    expect(issue!.status).toBe('auto_repaired');
    expect(r.repairs.map((l) => l.patch.action)).toEqual(['terminate']);
    expect(r.graph.edges.map((e) => [e.id, e.len, e.road.width, e.road.lanes])).toEqual(before.edges.map((e) => [e.id, e.len, e.road.width, e.road.lanes]));
    expect(of(r, 'R-HERO-03')).toEqual([]);
    // a fix that would change the hero road itself stays queued and is not applied, not even as provisional
    const lanes = laneStreet('secondary');
    const q = run(lanes, { heroList: [{ id: 'x_marg', name: 'X Marg', osmNames: ['X Marg'] }], heroSpecs: [{ ...janpathSpec, id: 'x_marg' }] });
    const [count] = of(q, 'R-LANE-FIT-03');
    expect(count).toMatchObject({ hero: 'x_marg', heroSpec: true, status: 'open' });
    expect(decide(count!)).toMatchObject({ mode: 'queued' });
    expect(policyOf(count!)).toBeNull();
    expect(q.repairs).toEqual([]);
    expect(q.provisional.find((p) => p.issue === count!.id)).toMatchObject({ applied: false, how: 'none' });
    expect(q.graph.edges.map((e) => e.road.lanes)).toEqual(lanes.graph().edges.map((e) => e.road.lanes));
    // listed as a hero road but no spec file yet: nothing authored to protect, the join is made, and the missing
    // spec is planned work (explained), not a question
    const plain = run(nearMiss(3, { name: 'Janpath' }), { heroList });
    expect(of(plain, 'R-ROAD-01')[0]).toMatchObject({ hero: 'janpath', heroSpec: false, status: 'auto_repaired' });
    expect(of(plain, 'R-HERO-01').map((i) => i.status)).toEqual(['explained']);
    // the same join with no hero road is automatic
    expect(of(run(nearMiss(3)), 'R-ROAD-01')[0]!.status).toBe('auto_repaired');
  });

  it('a one-way with no pair is marked explained and left unchanged', () => {
    const s = new Sketch();
    s.way([[0, 300], [240, 300]], { highway: 'secondary', oneway: 'yes', name: 'Radial Road 3' });
    const before = s.graph();
    const r = run(s);
    const [issue] = of(r, 'R-ROAD-04');
    expect(issue!.status).toBe('explained');
    expect(r.repairs).toEqual([]);
    expect(r.provisional).toEqual([]);
    expect(r.graph.marks).toEqual({});
    expect(JSON.stringify(r.graph.edges)).toBe(JSON.stringify(before.edges));
    expect(r.summary).toMatchObject({ total: 1, auto: 0, queued: 0, explained: 1 });
  });

  it('a lane count change on a trunk road is over the bounds and settled by the policy; on a secondary road it is within them', () => {
    const t = run(laneStreet('trunk'));
    const [trunk] = of(t, 'R-LANE-FIT-03');
    expect(trunk).toMatchObject({ status: 'auto_repaired', decided: 'policy' });
    expect(t.repairs).toEqual([]);
    expect(decide(trunk!)).toMatchObject({ mode: 'queued', why: 'over the low impact bound' });
    expect(edge(t.graph, trunk!.features[0]!).road).toMatchObject({ lanes: 3, lanesFrom: 'ahead' });
    const r = run(laneStreet('secondary'));
    const [sec] = of(r, 'R-LANE-FIT-03');
    expect(sec!.status).toBe('auto_repaired');
    expect(r.repairs[0]!.before).toMatchObject({ edges: [{ lanes: 4, lanesFrom: 'class', width: 13.2 }] });
    expect(r.repairs[0]!.after).toMatchObject({ edges: [{ lanes: 3, lanesFrom: 'ahead', width: 9.9 }] });
    expect(edge(r.graph, sec!.features[0]!).road).toMatchObject({ lanes: 3, lanesFrom: 'ahead', width: 9.9 });
  });

  it('a slip road redraw over 2.5 m is over the bounds: redrawn on the policy', () => {
    const s = new Sketch();
    const n = s.node(0, 0);
    s.way([[-300, 0], n], { highway: 'trunk', oneway: 'yes', name: 'Ring Road' });
    s.way([n, [300, 0]], { highway: 'trunk', oneway: 'yes', name: 'Ring Road' });
    s.way([n, [10, -8], [250, -8]], { highway: 'trunk_link', oneway: 'yes' });
    const r = run(s);
    const [issue] = of(r, 'R-LANE-FIT-02');
    expect(Number(issue!.proposals[0]!.params['move_m'])).toBeGreaterThan(2.5);
    expect(issue).toMatchObject({ status: 'auto_repaired', decided: 'policy' });
    expect(r.repairs.filter((l) => l.rule === 'R-LANE-FIT-02')).toEqual([]);
    expect(policyLines(r).filter((l) => l.rule === 'R-LANE-FIT-02')).toHaveLength(1);
  });

  it('a missing bridge layer tag, buildings on a road and an exact duplicate repair on their own', () => {
    const s = new Sketch();
    const a = s.node(0, 300);
    const b = s.node(60, 300);
    s.way([[-80, 300], a], { highway: 'primary' });
    s.way([a, b], { highway: 'primary', bridge: 'yes' });
    s.way([b, [140, 300]], { highway: 'primary' });
    s.way([[0, 0], [100, 0]], { highway: 'residential' }); // 6 m by class: the kerb is 3 m from the centre line
    s.building([[10, 1.5], [20, 1.5], [20, 12], [10, 12]]); // 1.5 m into the carriageway
    s.way([[0, -100], [100, -100]], { highway: 'residential' });
    s.building([[10, -98.6], [20, -98.6], [20, -88], [10, -88]]); // 1.6 m into the carriageway
    s.building([[200, 0], [210, 0], [210, 10], [200, 10]], { name: 'kept' });
    s.building([[200, 0], [210, 0], [210, 10], [200, 10]]);
    const r = run(s);
    expect(of(r, 'R-BRIDGE-01').map((i) => i.status)).toEqual(['auto_repaired']);
    expect(r.graph.edges.flatMap((e) => e.pieces).filter((p) => p.bridge).map((p) => p.layer)).toEqual([1]);
    const slivers = of(r, 'R-BLDG-01');
    // one building on an open road is no gali: the road keeps its width and the building gives way (the cut itself
    // is made on the road mesh's faces, repair/clear.ts), whatever its depth
    expect(slivers.map((i) => [i.note.slice(0, 5), i.status]).sort()).toEqual([['1.5 m', 'auto_repaired'], ['1.6 m', 'auto_repaired']]);
    const fixed = r.repairs.find((l) => l.rule === 'R-BLDG-01')!;
    expect(fixed.patch).toMatchObject({ action: 'replace_geometry', params: { op: 'give_way', on: 'way/104', road: 'w103.0' } });
    expect(fixed.after).toMatchObject({ id: 'way/104', gives_way: 'w103.0' });
    expect(r.graph.marks['way/104']).toMatchObject({ gives_way: 'w103.0' });
    expect(r.graph.edges.filter((e) => e.road.cls === 'residential').map((e) => e.road.width)).toEqual([6, 6]);
    expect(of(r, 'R-BLDG-03').map((i) => i.status)).toEqual(['auto_repaired']);
    // repair instead of drop, and every drop is logged with its source id
    expect(r.drops).toEqual([{ id: 'way/108', rule: 'R-BLDG-03', issue: of(r, 'R-BLDG-03')[0]!.id, provisional: false }]);
    expect(r.graph.footprints.map((f) => f.id)).not.toContain('way/108');
    expect(r.graph.footprints.find((f) => f.id === 'way/107')!.tags).toMatchObject({ name: 'kept' });
  });

  it('a tunnel tag that ends under a street crossing the mouth at grade moves past its far edge, and a second run moves nothing (R-TERR-04)', () => {
    const s = new Sketch();
    const n = s.node(0, 0);
    s.way([[-300, 0], n], { highway: 'primary', oneway: 'yes', name: 'Tunnel Marg', tunnel: 'yes', layer: '-1' });
    s.way([n, [300, 0]], { highway: 'primary', oneway: 'yes', name: 'Tunnel Marg' });
    // a street crossing at an angle, its centre line 1 m inside the tunnel tag: its width still reaches past the mouth
    s.way([[-61, -80], [59, 80]], { highway: 'tertiary', name: 'Over Road' });
    const r = run(s);
    expect(of(r, 'R-TERR-04').map((i) => i.status)).toEqual(['auto_repaired']);
    const t = r.graph.edges.find((e) => e.name === 'Tunnel Marg')!;
    const [tunnel, ramp] = t.pieces;
    expect(tunnel!.tunnel).toBe(true);
    expect(ramp!.s0).toBe(tunnel!.s1);
    // the street's far edge crosses the ramp's far edge a few metres past the old mouth (300 m along the edge)
    expect(tunnel!.s1 - 300).toBeGreaterThan(3);
    expect(tunnel!.s1 - 300).toBeLessThan(15);
    expect(r.graph.marks[t.id]).toMatchObject({ portal_moved_m: Math.round((tunnel!.s1 - 300) * 1000) / 1000 });
    expect(repairGraph(r.graph, testEnv({ nodeTags: s.nodeTags() })).repairs).toEqual([]);
  });

  it('writes one log line per applied repair with before and after, and a second run applies none', () => {
    const s = nearMiss(3);
    s.building([[10, 2.2], [20, 2.2], [20, 12], [10, 12]]);
    s.building([[70, -2.4], [80, -2.4], [80, -12], [70, -12]]);
    s.building([[300, 0], [310, 0], [310, 10], [300, 10]], { 'building:levels': '2' });
    const env = testEnv({ heightSource: spike(2) });
    const r = repairGraph(s.graph(), env);
    expect(r.summary.auto).toBe(r.repairs.length);
    expect(r.repairs.map((l) => l.rule)).toEqual(['R-ROAD-01', 'R-BLDG-01', 'R-BLDG-01']);
    const lines = repairLog(r.repairs).trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toHaveLength(r.repairs.length);
    for (const l of lines) {
      expect(Object.keys(l)).toEqual(expect.arrayContaining(['rule', 'issue', 'before', 'after', 'confidence', 'patch']));
      expect(JSON.stringify(l['before'])).not.toBe(JSON.stringify(l['after']));
      expect(l['patch']).toMatchObject({ issue: l['issue'], by: 'bake', source: 'rule' });
    }
    // two buildings on an open road: both give way, the road keeps its width
    expect(r.graph.edges.find((e) => e.id === 'w100.0')!.road.width).toBe(6);
    expect(Object.values(r.graph.marks).filter((m) => m['gives_way'] !== undefined)).toHaveLength(2);
    // a height the data gives through its levels is filled in, not an issue
    expect(r.summary.fills).toEqual({ heightFromLevels: 1, heightMissing: 2 });
    const again = repairGraph(r.graph, env);
    expect(again.repairs).toEqual([]);
    expect(again.summary.auto).toBe(0);
    expect(again.summary.unconverged).toBe(0);
    expect(graphHash(again.graph)).toBe(graphHash(r.graph));
  });

  it('gives the same result twice, and issue records in the form the inspector reads', () => {
    const s = nearMiss(8.1);
    s.building([[10, 2.2], [20, 2.2], [20, 12], [10, 12]]);
    const a = run(s);
    const b = run(s);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.summary.byRule.reduce((n, x) => n + x.issues, 0)).toBe(a.issues.length);
    const records = issueRecords(a.issues);
    for (const rec of records) {
      expect(Object.keys(rec)).toEqual(expect.arrayContaining(['id', 'rule', 'block', 'district', 'tile', 'lat', 'lon', 'x', 'z', 'features', 'impact', 'confidence', 'status', 'proposals']));
      for (const p of rec['proposals'] as Record<string, unknown>[]) expect(Object.keys(p).sort()).toEqual(['action', 'confidence', 'params', 'preview', 'reasoning']);
    }
    const svg = issuesSvg(a.graph, a.issues);
    expect(svg).toContain('repaired on its own: 1');
    expect(svg).toContain('queued: 1');
  });

  it('the repair layer never changes a hero road with a spec: the guard rule reports a change made behind its back', () => {
    const heroList = [{ id: 'janpath', name: 'Janpath', osmNames: ['Janpath'] }];
    const s = new Sketch();
    s.way([[0, 0], [300, 0]], { highway: 'secondary', name: 'Janpath' });
    const g = s.graph() as BlockGraph & { marks?: Record<string, Record<string, string>> };
    g.marks = { [g.edges[0]!.id]: { width_from: 'buildings', by: 'R-BLDG-01:way/1:w100.0' } };
    const r = repairGraph(g, testEnv({ heroList, heroSpecs: [janpathSpec] }));
    expect(of(r, 'R-HERO-03').map((i) => [i.status, i.proposals[0]!.action])).toEqual([['open', 'disable_repair']]);
    // without a spec file there is no authored cross-section: nothing to guard
    expect(of(repairGraph(g, testEnv({ heroList })), 'R-HERO-03')).toEqual([]);
  });

  it('the gali rule: a lane hemmed in by walls takes the width they leave, the buildings stay, and the odd one further in gives way', () => {
    const s = new Sketch();
    s.way([[0, 0], [100, 0]], { highway: 'residential' });
    // walls 1.6 m from the centre line on both sides along most of the lane, one building 0.9 m from it
    for (let x = 4; x < 96; x += 12) {
      s.building([[x, 1.6], [x + 10, 1.6], [x + 10, 9], [x, 9]]);
      if (x !== 40) s.building([[x, -1.6], [x + 10, -1.6], [x + 10, -9], [x, -9]]);
    }
    s.building([[40, -0.9], [50, -0.9], [50, -9], [40, -9]]);
    const r = run(s);
    const lane = r.graph.edges[0]!;
    // 2 x (1.6 - 0.45): the kerb row and a hand's width on each side
    expect(lane.road.width).toBe(2.3);
    expect(r.graph.marks[lane.id]).toMatchObject({ width_was: 6, width_from: 'buildings' });
    const issues = of(r, 'R-BLDG-01');
    expect(issues.every((i) => i.status === 'auto_repaired')).toBe(true);
    const gave = Object.entries(r.graph.marks).filter(([, m]) => m['gives_way'] !== undefined).map(([id]) => id);
    expect(gave).toHaveLength(1);
    expect(r.graph.footprints.find((f) => f.id === gave[0])!.ring[0]).toEqual({ x: 40, z: 0.9 });
    expect(repairGraph(r.graph, testEnv()).repairs).toEqual([]);
    // never under the lane model's gali limit: walls 1 m from the centre line leave 1.1 m, the lane takes 1.8 m and they give way
    const tight = new Sketch();
    tight.way([[0, 0], [100, 0]], { highway: 'residential' });
    for (let x = 4; x < 96; x += 12) {
      tight.building([[x, 1], [x + 10, 1], [x + 10, 9], [x, 9]]);
      tight.building([[x, -1], [x + 10, -1], [x + 10, -9], [x, -9]]);
    }
    const t = run(tight);
    expect(t.graph.edges[0]!.road.width).toBe(1.8);
    expect(Object.values(t.graph.marks).filter((m) => m['gives_way'] !== undefined)).toHaveLength(16);
    // a tagged width is the map's own word: the buildings give way, the road stays
    const tagged = new Sketch();
    tagged.way([[0, 0], [100, 0]], { highway: 'residential', width: '5' });
    for (let x = 4; x < 96; x += 12) tagged.building([[x, 1.6], [x + 10, 1.6], [x + 10, 9], [x, 9]]);
    expect(run(tagged).graph.edges[0]!.road.width).toBe(5);
  });

  it('a way drawn twice is dropped; a short stretch on top of another road is two real roads and both stay', () => {
    const twice = new Sketch();
    twice.way([[0, 0], [200, 0]], { highway: 'residential' });
    twice.way([[20, 0.5], [180, 0.5]], { highway: 'service' });
    const r = run(twice);
    const [issue] = of(r, 'R-ROAD-03');
    expect(issue!.status).toBe('auto_repaired');
    expect(issue!.proposals[0]).toMatchObject({ action: 'remove', confidence: 0.85, lowImpact: true, measure: { kind: 'duplicate_way' } });
    // (its two ends lay on the road and were joined first, so the road is in pieces: 200 m of it, and no service road)
    expect(r.graph.edges.every((e) => e.road.cls === 'residential')).toBe(true);
    expect(Math.round(r.graph.edges.reduce((n, e) => n + e.len, 0))).toBe(200);
    expect(r.drops.map((d) => d.rule)).toEqual(['R-ROAD-03']);
    // 30 m of a 300 m slip road on the main line: not a copy
    const slip = new Sketch();
    slip.way([[0, 0], [400, 0]], { highway: 'secondary', oneway: 'yes' });
    slip.way([[100, 0.6], [140, 0.6], [200, 30], [380, 60]], { highway: 'service', oneway: 'yes' });
    const q = run(slip);
    expect(of(q, 'R-ROAD-03').every((i) => i.proposals[0]!.confidence < 0.8)).toBe(true);
    expect(q.graph.edges.some((e) => e.road.cls === 'service')).toBe(true);
  });

  it('a class default footpath gives way to walls along it; a building on a footpath further in gives way itself', () => {
    const s = new Sketch();
    s.way([[0, 0], [100, 0]], { highway: 'tertiary' });
    // tertiary: 6.6 m carriageway, 1.8 m footpaths behind a 0.3 m kerb: the outer edge is 5.4 m from the centre line
    for (let x = 4; x < 96; x += 12) s.building([[x, 4.8], [x + 10, 4.8], [x + 10, 12], [x, 12]]);
    const r = run(s);
    const e = r.graph.edges[0]!;
    const side = e.road.footpath.left === 1.8 ? 'right' : 'left';
    // 4.8 - 3.3 - 0.3 - 0.15
    expect(e.road.footpath[side]).toBe(1);
    expect(e.road.footpath[side === 'left' ? 'right' : 'left']).toBe(1.8);
    expect(e.road.width).toBe(6.6);
    expect(Object.values(r.graph.marks).some((m) => m['gives_way'] !== undefined)).toBe(false);
    expect(of(r, 'R-FOOT-01')).toEqual([]);
    expect(repairGraph(r.graph, testEnv()).repairs).toEqual([]);
  });
});

describe('roads beside each other (R-LANE-05, P1-031)', () => {
  /** A service road drawn 4 m beside a one-way secondary road for 200 m, with a side street at each end. */
  function besideRoad(): Sketch {
    const s = new Sketch();
    s.way([[-200, 0], [200, 0]], { highway: 'secondary', oneway: 'yes', name: 'Barakhamba Road' });
    const m = s.node(-100, 4);
    const n = s.node(100, 4);
    s.way([[-100, 60], m], { highway: 'residential' });
    s.way([m, n], { highway: 'service' });
    s.way([n, [100, 60]], { highway: 'residential' });
    return s;
  }
  it('moves both roads apart, the node at the end too, and the road there follows; a second run applies none', () => {
    const r = run(besideRoad());
    // the side street's node cuts the main road there too: one issue per piece of it
    const hit = of(r, 'R-LANE-05');
    expect(hit.length).toBeGreaterThan(0);
    for (const i of hit) expect(i.status).toBe('auto_repaired');
    const line = r.repairs.find((x) => x.rule === 'R-LANE-05')!;
    expect((line.after as { nodes: unknown[] }).nodes.length).toBeGreaterThan(0);
    const g = r.graph;
    const main = g.edges.find((e) => e.road.cls === 'secondary')!;
    const service = g.edges.find((e) => e.road.cls === 'service')!;
    // 3.3 + 1.75 + 0.6: the service road keeps the separation (the shift adds 2 cm each); near its two end nodes the
    // main road's shift fades (1 m per 5 m) beyond the stretch they share, so the nearest point there is a little closer
    for (const p of service.pts.filter((q) => Math.abs(q.x) <= 90)) expect(projectOn(p, main.pts).d).toBeGreaterThanOrEqual(5.65 - 0.001);
    for (const p of [service.pts[0]!, service.pts[service.pts.length - 1]!]) expect(projectOn(p, main.pts).d).toBeGreaterThan(4.8);
    // the side street still starts at the node, which moved with the service road
    const node = g.nodes.find((x) => x.id === service.b)!;
    const side = g.edges.find((e) => e.a === node.id && e.road.cls === 'residential')!;
    expect(side.pts[0]).toEqual({ x: node.x, z: node.z });
    expect(Math.abs(node.z) - 4).toBeGreaterThan(0.8);
    expect(repairGraph(r.graph, testEnv()).repairs).toHaveLength(0);
  });
  it('a branch with no room for a gore moves out from the split node (R-LANE-04, on the policy), growing 1 m per slip ratio', () => {
    const s = new Sketch();
    const n = s.node(0, 0);
    s.way([[-300, 0], n], { highway: 'trunk', oneway: 'yes', name: 'Ring Road' });
    s.way([n, [300, 0]], { highway: 'trunk', oneway: 'yes', name: 'Ring Road' });
    const end = s.node(250, -6);
    s.way([n, [80, -5], end], { highway: 'trunk_link', oneway: 'yes' });
    s.way([end, [250, -120]], { highway: 'residential' });
    const r = run(s);
    const gore = of(r, 'R-LANE-04');
    expect(gore).toHaveLength(1);
    expect(gore[0]).toMatchObject({ status: 'auto_repaired', decided: 'policy' });
    const slip = r.graph.edges.find((e) => e.road.link)!;
    // the split node stays; out along the branch it moves away from the main line (north 0 is z 0, the slip is south)
    expect(slip.pts[0]).toEqual({ x: 0, z: 0 });
    const far = slip.pts[slip.pts.length - 1]!;
    // 8.5 m apart where the branch ends: the gore has room, and the road at its far node followed
    expect(far.z).toBeGreaterThan(8.4);
    expect(r.graph.edges.find((e) => e.road.cls === 'residential')!.pts[0]).toEqual(far);
    expect(of(run(s), 'R-LANE-04')[0]!.decided).toBe('policy');
    expect(r.summary.unconverged).toBe(0);
  });
});
