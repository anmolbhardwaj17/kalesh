// Medians between paired carriageways and mid-block zebras in the road mesh (P1-032): a divided street on a sketch,
// filled from OSM's gap, then with a reference divider narrower than the gap (flat carriageway either side), and a
// crossing node away from the junctions drawn as a zebra with a stop line for each direction.
import { describe, expect, it } from 'vitest';
import { elevationInput } from '../elevation/input';
import { solveBlockElevation } from '../elevation/solve';
import { readStructures } from '../elevation/structures';
import { buildLaneModel } from '../roads/network';
import type { LaneModelInput } from '../roads/network';
import { Sketch } from '../testmap';
import { buildRoadMesh } from './build';
import { checkRoadMesh } from './checks';
import { LANE_KINDS } from './faces';
import { meshInput } from './input';
import type { MedianRef } from './medianfaces';

const ground = (): number => 200;

/** Two one-way carriageways of one street `gap` metres apart (centre lines), east-west, 600 m long. */
function divided(gap: number): Sketch {
  const s = new Sketch();
  s.way([[-300, gap / 2], [300, gap / 2]], { highway: 'secondary', oneway: 'yes', name: 'Divided Road', lanes: '2' });
  s.way([[300, -gap / 2], [-300, -gap / 2]], { highway: 'secondary', oneway: 'yes', name: 'Divided Road', lanes: '2' });
  return s;
}

function mesh(s: Sketch, refs: MedianRef[] = [], points: LaneModelInput['points'] = []) {
  const g = s.graph(500);
  const b = buildLaneModel({ nodes: g.nodes, edges: g.edges, wayLanes: new Map(), points });
  const ei = elevationInput(b, g, ground);
  const res = solveBlockElevation(ei);
  const st = readStructures({ strips: b.strips, joints: b.joints, junctions: ei.junctions, junctionHeights: res.junctionHeights, tunnels: res.tunnels, crossings: res.crossings, pairSamples: res.pairSamples, water: [], ties: ei.ties ?? [], ground });
  const input = meshInput(b, res.junctionHeights, st.kinds, refs);
  const m = buildRoadMesh(input);
  return { g, b, input, m, checks: checkRoadMesh(input, m) };
}

describe('medians between paired carriageways', () => {
  it('fills the gap OSM leaves between the two carriageways: watertight, no overlap, width from OSM', () => {
    const { g, input, m, checks } = mesh(divided(14));
    expect(g.edges.every((e) => e.pairedWith.length === 1)).toBe(true);
    expect(input.pairs.length).toBeGreaterThan(0);
    const md = m.medians;
    expect(md.metres.filled).toBeGreaterThan(500);
    expect(md.bySource.osm).toBeGreaterThan(500);
    expect(md.bySource.photo + md.bySource.satellite).toBe(0);
    // 14 m between centre lines, two lanes of 3.3 m each side: 7.4 m of median including the two 0.3 m kerbs
    expect(md.list[0]!.widthM).toBeCloseTo(7.4, 1);
    expect(checks.watertight.openBoundaryEdges).toBe(0);
    expect(checks.overlap.totalM2).toBeLessThan(0.05);
    expect(checks.kerbs.off).toBe(0);
  });

  it('a reference divider narrower than the gap stands in the middle with flat carriageway either side', () => {
    const ref: MedianRef = { names: ['Divided Road'], width: 2, type: 'planter', source: 'photo', ref: 'test' };
    const { m, checks } = mesh(divided(14), [ref]);
    const md = m.medians;
    expect(md.bySource.photo).toBeGreaterThan(500);
    expect(md.bySource.osm).toBe(0);
    expect(md.list[0]!.widthM).toBeCloseTo(2, 5);
    expect(md.flattened).toBeGreaterThan(0);
    const planter = LANE_KINDS.indexOf('planter');
    let area = 0;
    for (let f = 0; f < m.fs.faces; f++) if (m.fs.kind[f] === planter) area += m.fs.area(f);
    expect(area / 600).toBeGreaterThan(1.8);
    expect(area / 600).toBeLessThan(2.1);
    expect(checks.watertight.openBoundaryEdges).toBe(0);
    expect(checks.overlap.totalM2).toBeLessThan(0.05);
    expect(checks.uv.ok).toBe(true);
  });

  it('a side street on one carriageway only: the median stops at its junction and starts again after it, watertight', () => {
    const s = divided(14);
    // the south carriageway (z +7) is cut by a side street from the south: a T junction on that side only
    const south = s.elements.find((e) => e.type === 'way' && e.tags?.['oneway'] === 'yes' && (e.nodes?.length ?? 0) === 2 && s.elements.find((n) => n.id === e.nodes![0])!.lat! < 0)!;
    const mid = s.node(0, -7);
    south.nodes = [south.nodes![0]!, mid, south.nodes![1]!];
    s.way([[0, -80], mid], { highway: 'residential', name: 'Side Street' });
    const { m, checks } = mesh(s);
    expect(checks.watertight.openBoundaryEdges).toBe(0);
    expect(checks.overlap.totalM2).toBeLessThan(0.05);
    // the north carriageway runs through: beside the junction the median is left out (the junction's ring is the edge), never doubled
    expect(m.medians.metres.filled).toBeGreaterThan(450);
  });

  it('a gap over 12 m stays open; carriageways whose kerbs touch keep the two-kerb default', () => {
    const wide = mesh(divided(30)).m.medians;
    expect(wide.metres.filled).toBe(0);
    expect(wide.metres.wide).toBeGreaterThan(500);
    const touching = mesh(divided(7.2)).m.medians;
    expect(touching.metres.filled).toBe(0);
    expect(touching.bySource.default).toBeGreaterThan(500);
  });

  it('a crossing node away from every junction is drawn: a zebra across both carriageways, a stop line before each', () => {
    const points: LaneModelInput['points'] = [{ x: 0, z: -7, kind: 'crossing', id: 'node/1' }];
    const { b, m } = mesh(divided(14), [], points);
    // the node lies on one carriageway; the other one gets the zebra on the same line
    expect(b.crossings).toHaveLength(2);
    expect(b.crossingReport.pairedAdded).toBe(1);
    expect(m.midBlock.crossings).toBe(2);
    expect(m.midBlock.stopLines).toBe(2);
    for (const c of m.midBlock.list) expect(Math.abs(c.x)).toBeLessThan(0.5);
  });
});
