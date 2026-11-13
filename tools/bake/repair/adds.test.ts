// Patches that add what OSM lacks (P1-045): add_way, add_median, add_footpath, add_crossing, add_barrier. Each one is
// applied by the one patch applier, found by id then by its drawn points, and goes through the repair engine like an
// OSM way (a second run on the result applies nothing).
import { describe, expect, it } from 'vitest';
import type { GraphEdge } from '../graph/build';
import type { Patch, PatchAction } from '../rules/types';
import { Sketch, flat, testEnv } from '../testmap';
import { addProblems, parsePairs, projectAddParams } from './adds';
import { applyPatch } from './apply';
import type { RepairState } from './apply';
import { repairGraph } from './engine';
import { patchProblems } from './overrides';
import type { OverrideEntry } from './overrides';

/** A patch in the file form. Geometry is "north,east" (the flat test projection reads lat as north, lon as east). */
function add(action: PatchAction, params: Patch['params'], ids: string[] = [], id = 'ov_0_0_0001'): Patch {
  return {
    id, issue: `add:${id}`, action, target: { ids, anchor: { lat: 0, lon: 0 }, tolerance_m: 15 }, params,
    why: 'seen on the satellite view', by: 'builder', source: 'reference', date: '2026-11-13',
    reference: { link: 'https://example.org/satellite', date: '2026-11-13' },
  };
}
const path = (pts: [number, number][]): string => pts.map(([east, north]) => `${north},${east}`).join(';');
const at = (east: number, north: number): string => `${north},${east}`;

const env = (s: Sketch) => testEnv({ nodeTags: s.nodeTags() });
const entry = (patch: Patch): OverrideEntry => ({ file: '0_0.json', patch });
function run(s: Sketch, patches: Patch[]) {
  const r = repairGraph(s.graph(), env(s), { overrides: { entries: patches.map(entry), project: flat } });
  const again = repairGraph(r.graph, env(s), { overrides: { entries: patches.map(entry), project: flat, applied: true } });
  return { r, again };
}
/** Applies one patch straight to a sketch's graph (geometry projected the way the engine does). */
function apply(s: Sketch, patch: Patch) {
  const state: RepairState = { graph: s.graph(), marks: {}, geometryChanged: false };
  const res = applyPatch(state, { ...patch, params: projectAddParams(patch.params, flat) });
  return { state, res, g: state.graph };
}
const edge = (es: readonly GraphEdge[], id: string): GraphEdge => es.find((e) => e.id === id) as GraphEdge;

describe('add patches: format', () => {
  it('reads and projects the drawn geometry', () => {
    expect(parsePairs('1,2;3.5,-4')).toEqual([[1, 2], [3.5, -4]]);
    expect(parsePairs('1,2;x,4')).toBeNull();
    const p = projectAddParams({ path: '10,5;20,6', at: '3,4', width: 2 }, flat);
    expect(p).toMatchObject({ pts: '5,-10;6,-20', x: 4, z: -3, width: 2, path: '10,5;20,6' });
  });

  it('needs a reference with a link and a date, and geometry of the right shape', () => {
    const good = add('add_median', { path: path([[0, 0], [50, 0]]), width: 2, type: 'planter' });
    expect(patchProblems(good)).toEqual([]);
    const { reference: _r, ...noRef } = good;
    expect(addProblems(noRef as Patch).join(' ')).toMatch(/reference\.link/);
    expect(addProblems({ ...good, params: { path: '1,2', width: 2 } }).join(' ')).toMatch(/two or more/);
    expect(addProblems({ ...good, params: { ...good.params, width: 0.1 } }).join(' ')).toMatch(/median width/);
    expect(addProblems(add('add_crossing', { at: '1,2;3,4' })).join(' ')).toMatch(/one "lat,lon"/);
    expect(addProblems(add('add_way', { path: path([[0, 0], [1, 1]]) })).join(' ')).toMatch(/highway/);
    expect(patchProblems({ ...good, action: 'add_tree' })[0]).toMatch(/add_way, add_median/);
  });
});

describe('add_way', () => {
  /** A secondary road along north 0 from east 0 to 200. */
  const main = (): Sketch => {
    const s = new Sketch();
    s.way([[0, 0], [200, 0]], { highway: 'secondary', name: 'Main Road' });
    return s;
  };
  const lane = (join: Patch['params'] = {}) => add('add_way', { path: path([[100, 2], [100, 30], [130, 45]]), highway: 'service', service: 'driveway', lanes: 1, join_b: 'none', name: 'Bungalow drive', ...join }, ['w100.0']);

  it('joins the road it is drawn from, with a free far end, classified like an OSM way', () => {
    const { res, g, state } = apply(main(), lane());
    expect(res).toMatchObject({ applied: true, how: 'graph' });
    const e = edge(g.edges, 'add.ov_0_0_0001');
    expect(e.road).toMatchObject({ cls: 'service', lanes: 1, lanesFrom: 'ahead', carriageway: 'two_way' });
    expect(e.pts[0]).toEqual({ x: 100, z: 0 }); // snapped onto the road
    expect(e.pieces).toEqual([{ way: 'add/ov_0_0_0001', s0: 0, s1: e.len, layer: 0, bridge: false, tunnel: false }]);
    expect(g.edges.filter((x) => x.id.startsWith('w100.0'))).toHaveLength(2); // the road was cut at the join
    const join = g.nodes.find((n) => n.id === e.a);
    expect(join).toMatchObject({ kind: 'junction', ends: 3 });
    expect(g.nodes.find((n) => n.id === e.b)).toMatchObject({ kind: 'end', x: 130, z: -45 });
    expect(state.marks['add.ov_0_0_0001']).toMatchObject({ added: 'add_way', by: 'ov_0_0_0001' });
  });

  it('goes through the repair engine: applied once, and a second run changes nothing', () => {
    const { r, again } = run(main(), [lane()]);
    expect(r.overrides[0]).toMatchObject({ action: 'add_way', resolution: 'by_id', outcome: 'fixed' });
    expect(r.graph.edges.some((e) => e.id === 'add.ov_0_0_0001')).toBe(true);
    expect(r.summary.unconverged).toBe(0);
    expect(again.repairs).toHaveLength(0);
  });

  it('survives a new extract: a gone road id is found again under the drawn end', () => {
    const { r } = run(main(), [lane({ join_a: 'w777.0' })].map((p) => ({ ...p, target: { ...p.target, ids: ['w777.0'] } })));
    expect(r.overrides[0]).toMatchObject({ resolution: 'by_anchor', outcome: 'fixed', targets: ['w100.0'] });
    expect(r.overrides[0]!.note).toMatch(/join_a w777\.0 is gone/);
  });

  it('is stale when no road lies under a drawn end it must join', () => {
    const far = add('add_way', { path: path([[100, 40], [100, 80]]), highway: 'service', join_b: 'none' });
    const { r } = run(main(), [far]);
    expect(r.overrides[0]).toMatchObject({ outcome: 'stale' });
    expect(r.overrides[0]!.note).toMatch(/no road within 15 m/);
    expect(r.graph.edges.some((e) => e.id.startsWith('add.'))).toBe(false);
  });
});

describe('add_median', () => {
  /** A two-way secondary road along north 0 from east 0 to 300, a side road north at 100 and a crossing street at 200. */
  const street = (): Sketch => {
    const s = new Sketch();
    s.way([[0, 0], [100, 0], [200, 0], [300, 0]], { highway: 'secondary', name: 'Main Road' });
    const nodes = s.elements.filter((e) => e.type === 'node').map((e) => e.id);
    s.way([nodes[1] as number, [100, 60]], { highway: 'service' });
    s.way([[200, 60], nodes[2] as number, [200, -60]], { highway: 'residential', name: 'Cross Street' });
    return s;
  };
  const median = (extra: Patch['params'] = {}) => add('add_median', { path: path([[20, 0], [280, 0]]), width: 2, type: 'planter', ...extra }, ['w100.0']);

  it('splits the stretch into two one-way carriageways, left one eastbound on the north side', () => {
    const { res, g } = apply(street(), median());
    expect(res).toMatchObject({ applied: true });
    const made = g.edges.filter((e) => e.id.includes('~'));
    expect(made).toHaveLength(6); // three edges of the stretch, two carriageways each
    for (const e of made) {
      expect(e.oneway).toBe(true);
      expect(e.road).toMatchObject({ carriageway: 'paired', lanes: 2, width: 6.6, median: { width: 2, type: 'planter' } });
      expect(e.pairedWith).toHaveLength(1);
    }
    const left = made.filter((e) => e.id.endsWith('~L'));
    const right = made.filter((e) => e.id.endsWith('~R'));
    // Delhi keeps left: the eastbound carriageway is north (z negative), the westbound one south
    const mid = (e: GraphEdge) => e.pts[Math.floor(e.pts.length / 2)]!;
    for (const e of left) expect(e.tb.x).toBeGreaterThan(0.9);
    for (const e of right) expect(e.tb.x).toBeLessThan(-0.9);
    const l = left.find((e) => mid(e).x > 120 && mid(e).x < 180)!;
    const rr = right.find((e) => mid(e).x > 120 && mid(e).x < 180)!;
    expect(mid(l).z).toBeCloseTo(-(3.3 + 1 + 0.01), 2);
    expect(mid(rr).z).toBeCloseTo(3.3 + 1 + 0.01, 2);
    expect(g.pairs.filter((p) => p.a.includes('~'))).toHaveLength(3);
    // the stretch is gone: no two-way piece of the road between its tapers
    expect(g.edges.filter((e) => e.name === 'Main Road' && !e.oneway && !e.id.startsWith('add.') && e.pts.every((q) => q.x > 25 && q.x < 275))).toHaveLength(0);
  });

  it('puts side roads on their side and opens the median where a street crosses it', () => {
    const { res, g } = apply(street(), median());
    const after = res.after as { openings: string[]; moved: string[] };
    expect(after.openings).toHaveLength(1);
    const gap = edge(g.edges, after.openings[0]!);
    expect(gap.oneway).toBe(false);
    expect(gap.len).toBeCloseTo(2 * (3.3 + 1 + 0.01), 2);
    // the service road (north) meets only the eastbound carriageway: no opening there
    const service = g.edges.find((e) => e.road.cls === 'service')!;
    const node = g.nodes.find((n) => n.id === service.a || n.id === service.b)!;
    expect(node.z).toBeLessThan(-4);
    const at = g.edges.filter((e) => e.a === node.id || e.b === node.id).map((e) => e.id).sort();
    expect(at.some((id) => id.endsWith('~R'))).toBe(false);
    expect(after.moved).toHaveLength(3);
  });

  it('carries on from carriageways that are already there, with no taper', () => {
    const s = new Sketch();
    // west: two one-way carriageways converge on node A at east 0; east of it the road is drawn two-way
    const a = s.node(0, 0);
    const b = s.node(200, 0);
    // Delhi keeps left: the eastbound half (arriving at A) is north, the westbound half (leaving A) south
    s.way([[-150, 4], [-30, 4], a], { highway: 'secondary', oneway: 'yes', name: 'Main Road' });
    s.way([a, [-30, -4], [-150, -4]], { highway: 'secondary', oneway: 'yes', name: 'Main Road' });
    s.way([a, [100, 0], b], { highway: 'secondary', name: 'Main Road' });
    s.way([b, [300, 0]], { highway: 'secondary', name: 'Main Road' });
    const { res, g } = apply(s, add('add_median', { path: path([[0, 0], [200, 0]]), width: 1, type: 'kerb' }));
    expect(res).toMatchObject({ applied: true });
    expect((res.after as { ends: string[] }).ends).toEqual(['carries on', 'taper']);
    const l = g.edges.find((e) => e.id.endsWith('~L'))!;
    expect(l.pts[0]!.z).toBeCloseTo(-(3.3 + 0.5 + 0.01), 2); // full offset at the start
    expect(g.edges.find((e) => e.b === l.a)?.oneway).toBe(true); // the old arriving carriageway runs into it
    expect(g.nodes.some((n) => n.id === `n${a}`)).toBe(false); // node A is gone
  });

  it('goes through the repair engine with no repair left for a second run', () => {
    const { r, again } = run(street(), [median()]);
    expect(r.overrides[0]).toMatchObject({ action: 'add_median', outcome: 'fixed' });
    expect(r.summary.unconverged).toBe(0);
    expect(again.repairs).toHaveLength(0);
    expect(r.graph.edges.filter((e) => e.road.median).length).toBe(6);
  });

  it('refuses a line that leaves the road', () => {
    const { res } = apply(street(), add('add_median', { path: path([[20, 0], [150, 70]]), width: 2 }));
    expect(res.applied).toBe(false);
  });
});

describe('add_footpath, add_crossing, add_barrier', () => {
  const service = (): Sketch => {
    const s = new Sketch();
    s.way([[0, 0], [100, 0]], { highway: 'service' });
    return s;
  };

  it('add_footpath widens the footpath on the side it is drawn', () => {
    const { res, g, state } = apply(service(), add('add_footpath', { path: path([[0, 4], [100, 4]]), width: 2.5 }));
    expect(res.applied).toBe(true);
    // north of an eastbound edge is its left
    expect(g.edges[0]!.road.footpath.left).toBe(2.5);
    expect(state.marks[g.edges[0]!.id]).toMatchObject({ footpath_from: 'add' });
    const south = apply(service(), add('add_footpath', { path: path([[0, -4], [100, -4]]), width: 2 }));
    expect(south.g.edges[0]!.road.footpath.right).toBe(2);
  });

  it('add_crossing leaves a crossing the lane model reads like an OSM crossing node', () => {
    const { res, state } = apply(service(), add('add_crossing', { at: at(40, 3) }));
    expect(res).toMatchObject({ applied: true, how: 'mark' });
    expect(state.marks['crossing:ov_0_0_0001']).toMatchObject({ kind: 'crossing', x: 40, z: 0, on: 'w100.0' });
  });

  it('add_barrier cuts the road with two dead ends that no repair joins again', () => {
    const { r, again } = run(service(), [add('add_barrier', { at: at(50, 0), kind: 'bollards' })]);
    expect(r.overrides[0]).toMatchObject({ outcome: 'fixed' });
    const ends = r.graph.nodes.filter((n) => n.id.startsWith('xov_0_0_0001'));
    expect(ends).toHaveLength(2);
    for (const n of ends) expect(n.kind).toBe('end');
    expect(Math.abs((ends[0]!.x) - (ends[1]!.x))).toBeCloseTo(1, 3);
    expect(r.graph.edges).toHaveLength(2);
    expect(r.graph.marks[ends[0]!.id]).toMatchObject({ closure: 'barricade', barrier: 'bollards' });
    expect(r.repairs.filter((l) => !l.override)).toHaveLength(0);
    expect(again.repairs).toHaveLength(0);
  });
});
