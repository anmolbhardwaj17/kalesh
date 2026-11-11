// The block graph (P1-009) on small sketches: topology, the map edge, stable ids, normalisation, pairing, classes,
// features, footprints and determinism. The pilot itself is tested in pilot_graph.test.mjs (it needs data/).
import { describe, expect, it } from 'vitest';
import { Sketch, flat } from '../testmap';
import type { OsmElement } from '../osm';
import { buildBlockGraph } from './build';
import type { BlockGraph, GraphInput } from './build';
import { checkGraph, duplicateEdges, graphCounts, graphHash } from './checks';
import { classifyRoad, taggedFootpaths } from './classify';
import { assembleRings, clipArea, clipLine, railKind } from './features';
import { mergeStageFootprints, overtureFootprints } from './footprints';
import type { OvertureRow } from './footprints';
import { namesAgree, normName, pairCarriageways } from './pairs';
import type { PairEdge } from './pairs';
import { graphSvg } from './render';

/** A square outline of half size h metres around 0 (in the sketch's [x, north] metres as [lon, lat]). */
const square = (h: number): [number, number][] => [[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]];

function graphOf(s: Sketch, h = 500, overture: OvertureRow[] = []): BlockGraph {
  const input: GraphInput = { block: 'test', stage: 'test', origin: { lat: 0, lon: 0 }, outline: square(h), elements: s.elements, overture, project: flat };
  return buildBlockGraph(input);
}

const edge = (g: BlockGraph, id: string) => g.edges.find((e) => e.id === id)!;

describe('block graph topology', () => {
  it('cuts at shared nodes, joins chains, and ends clipped roads in map edge nodes with stable ids', () => {
    const s = new Sketch();
    const a = s.node(0, 0);
    const b = s.node(100, 0);
    const w1 = s.way([[-900, 0], a], { highway: 'primary', oneway: 'yes' });
    const w2 = s.way([a, b], { highway: 'primary', oneway: 'yes', lanes: '2' });
    const w3 = s.way([b, [900, 0]], { highway: 'primary', oneway: 'yes' });
    const w4 = s.way([b, [100, 200]], { highway: 'tertiary' });
    const g = graphOf(s);
    expect(checkGraph(g).ok).toBe(true);
    // w1 and w2 join through a (a plain node); w3 starts at the junction b and leaves the stage
    expect(g.edges.map((e) => e.id).sort()).toEqual([`w${w1}.0`, `w${w3}.0`, `w${w4}.0`].sort());
    const first = edge(g, `w${w1}.0`);
    expect(first.a).toBe(`m${w1}.0`);
    expect(first.b).toBe(`n${b}`);
    expect(first.len).toBeCloseTo(600, 3);
    expect(first.pieces.map((p) => p.way)).toEqual([`way/${w1}`, `way/${w2}`]);
    const mapEdge = g.nodes.filter((n) => n.kind === 'map_edge');
    expect(mapEdge.map((n) => n.id).sort()).toEqual([`m${w1}.0`, `m${w3}.0`]);
    expect(mapEdge.every((n) => n.ends === 1 && (Math.abs(n.x) === 500 || Math.abs(n.z) === 500))).toBe(true);
    expect(g.nodes.find((n) => n.id === `n${b}`)!.kind).toBe('junction');
    expect(g.crossings).toHaveLength(2);
  });

  it('turns a oneway=-1 way to its direction of travel and keeps one tangent through a node', () => {
    const s = new Sketch();
    const m = s.node(0, 0);
    const w1 = s.way([[-200, 0], m], { highway: 'secondary' });
    // a class change at m: two edges, no join, but one direction through the node
    const w2 = s.way([m, [150, 20], [300, 80]], { highway: 'tertiary' });
    const w3 = s.way([[0, 300], [0, 150]], { highway: 'residential', oneway: '-1' });
    const g = graphOf(s);
    const e1 = edge(g, `w${w1}.0`);
    const e2 = edge(g, `w${w2}.0`);
    expect(e1.b).toBe(e2.a);
    expect(e1.tb.x).toBeCloseTo(e2.ta.x, 6);
    expect(e1.tb.z).toBeCloseTo(e2.ta.z, 6);
    // the through direction lies between the two arms (not either arm's own direction)
    expect(e1.tb.z).toBeLessThan(0);
    expect(e1.tb.z).toBeGreaterThan(-0.2);
    const e3 = edge(g, `w${w3}.0`);
    // drawn south to north... reversed: travel runs from north 150 to north 300 (towards -z)
    expect(e3.pts[0]!.z).toBeCloseTo(-150, 6);
    expect(e3.pts[e3.pts.length - 1]!.z).toBeCloseTo(-300, 6);
    expect(g.nodes.find((n) => n.id === e1.b)!.kind).toBe('joint');
  });

  it('snaps nodes at one spot, keeps a way drawn twice once, and has no zero-length edge', () => {
    const s = new Sketch();
    const a = s.node(0, 0);
    const a2 = s.node(0.005, 0); // 5 mm from a: one node
    const b = s.node(200, 0);
    s.way([[-200, 0], a], { highway: 'residential' });
    s.way([a2, b], { highway: 'residential' });
    s.way([a, a2], { highway: 'residential' });
    const dup = s.way([b, [200, 200]], { highway: 'service' });
    s.way([[200, 200], b], { highway: 'service' });
    const g = graphOf(s);
    const c = checkGraph(g);
    expect(c.zeroLengthEdges).toEqual([]);
    expect(c.duplicateEdges).toEqual([]);
    // a2 onto a, and the two separate nodes the sketch made at (200, 200)
    expect(g.normalised.snappedNodes).toBe(2);
    expect(g.normalised.degenerateWays).toBe(1);
    expect(g.normalised.duplicateWays).toEqual([`way/${dup + 1}`]);
  });

  it('finds an edge drawn twice between the same nodes', () => {
    const base = { a: 'n1', b: 'n2', len: 100 } as const;
    const e = (id: string, dz: number) => ({ ...base, id, pts: [{ x: 0, z: dz }, { x: 100, z: dz }] }) as unknown as Parameters<typeof duplicateEdges>[0][number];
    expect(duplicateEdges([e('w1.0', 0), e('w2.0', 0.2)])).toEqual(['w1.0=w2.0']);
    expect(duplicateEdges([e('w1.0', 0), e('w2.0', 6)])).toEqual([]);
  });

  it('gives the same graph, ids and hash for the same data in any element order', () => {
    const s = new Sketch();
    const hub = s.node(0, 0);
    s.way([[-700, 0], hub], { highway: 'primary', name: 'Main' });
    s.way([hub, [0, 700]], { highway: 'secondary', name: 'North' });
    s.way([hub, [300, -100], [700, -100]], { highway: 'tertiary' });
    s.way([[50, 50], [100, 50], [100, 100], [50, 50]], { highway: 'service' });
    s.building([[20, 20], [40, 20], [40, 40], [20, 40]]);
    const g1 = graphOf(s);
    const g2 = graphOf(s);
    const shuffled = new Sketch();
    (shuffled.elements as OsmElement[]).push(...s.elements.slice().reverse());
    const g3 = graphOf(shuffled);
    expect(graphHash(g1)).toBe(graphHash(g2));
    expect(graphHash(g3)).toBe(graphHash(g1));
    expect(g3.edges.map((e) => e.id)).toEqual(g1.edges.map((e) => e.id));
    expect(graphCounts(g1).mapEdgeEnds).toBe(3);
    expect(graphSvg(g1)).toContain('<svg');
  });
});

describe('carriageway pairs', () => {
  const pe = (index: number, pts: [number, number][], name = '', extra: Partial<PairEdge> = {}): PairEdge => {
    const p = pts.map(([x, z]) => ({ x, z }));
    let len = 0;
    for (let i = 1; i < p.length; i++) len += Math.hypot(p[i]!.x - p[i - 1]!.x, p[i]!.z - p[i - 1]!.z);
    return { index, pts: p, len, cls: 'secondary', name, ref: '', level: 0, pairable: true, ...extra };
  };

  it('pairs two carriageways each on the right of the other (Delhi keeps left), never the right-hand drawing', () => {
    // travelling east (+x) on the north side (-z): the other carriageway is south of it, on its right
    expect(pairCarriageways([pe(0, [[-200, -6], [200, -6]], 'Vikas Marg'), pe(1, [[200, 6], [-200, 6]], 'Vikas Marg')])).toHaveLength(1);
    expect(pairCarriageways([pe(0, [[-200, 6], [200, 6]], 'Vikas Marg'), pe(1, [[200, -6], [-200, -6]], 'Vikas Marg')])).toHaveLength(0);
  });

  it('pairs spellings of one name and an unnamed half, not two different streets, unless they run tight', () => {
    expect(namesAgree(pe(0, [], 'Inderprastha Marg'), pe(1, [], 'Indraprastha Marg'))).toBe(true);
    expect(namesAgree(pe(0, [], 'Tilak Marg'), pe(1, [], 'Tilak Road'))).toBe(true);
    expect(namesAgree(pe(0, [], 'Radial Road 3'), pe(1, [], 'Radial Road 4'))).toBe(false);
    expect(normName('Doctor  Zakir-Hussain Marg')).toBe('doctor zakir hussain');
    // two different names 30 m apart: two streets
    expect(pairCarriageways([pe(0, [[-200, -15], [200, -15]], 'Radial Road 3'), pe(1, [[200, 15], [-200, 15]], 'Radial Road 4')])).toHaveLength(0);
    // 9 m apart along their whole length at one level: one street drawn with two names
    const tight = pairCarriageways([pe(0, [[-200, -4.5], [200, -4.5]], 'Shivaji Flyover'), pe(1, [[200, 4.5], [-200, 4.5]], 'Maharaja Ranjeet Singh Marg')]);
    expect(tight).toHaveLength(1);
    expect(tight[0]!.namesDiffer).toBe(true);
    // a flyover over the road below is not its other half
    expect(pairCarriageways([pe(0, [[-200, -4.5], [200, -4.5]], 'Shivaji Flyover', { level: 1 }), pe(1, [[200, 4.5], [-200, 4.5]], 'Maharaja Ranjeet Singh Marg')])).toHaveLength(0);
  });

  it('pairs in the graph and leaves a lone one-way street and a roundabout alone', () => {
    const s = new Sketch();
    s.way([[-300, 8], [300, 8]], { highway: 'secondary', oneway: 'yes', name: 'Barakhamba Road' });
    s.way([[300, -8], [-300, -8]], { highway: 'secondary', oneway: 'yes', name: 'Barakhamba Road' });
    s.way([[-300, 200], [300, 200]], { highway: 'tertiary', oneway: 'yes', name: 'Radial Road 1' });
    s.way([[300, 230], [-300, 230]], { highway: 'tertiary', oneway: 'yes', name: 'Radial Road 2' });
    s.way([[0, -100], [40, -140], [0, -180], [-40, -140], [0, -100]], { highway: 'secondary', oneway: 'yes', junction: 'roundabout' });
    const g = graphOf(s);
    expect(g.pairs).toHaveLength(1);
    expect(g.pairs[0]!.name).toBe('Barakhamba Road');
    const bk = g.edges.filter((e) => e.name === 'Barakhamba Road');
    expect(bk.every((e) => e.road.carriageway === 'paired' && e.pairedWith.length === 1)).toBe(true);
    // left-hand traffic: footpath on the left of each carriageway, the median on the right
    expect(bk.every((e) => e.road.footpath.left > 0 && e.road.footpath.right === 0)).toBe(true);
    expect(g.edges.filter((e) => /Radial/.test(e.name)).every((e) => e.road.carriageway === 'one_way' && !e.pairedWith.length)).toBe(true);
    expect(g.edges.find((e) => e.roundabout)!.pairedWith).toEqual([]);
  });
});

describe('road classes (Delhi defaults)', () => {
  it('takes lanes and width from tags, else from the class, and always keeps left', () => {
    const two = classifyRoad('secondary', false, 'two_way', {});
    expect(two).toMatchObject({ lanes: 4, lanesFrom: 'class', laneWidth: 3.3, width: 13.2, traffic: 'left', footpath: { left: 2, right: 2 } });
    expect(classifyRoad('secondary', false, 'paired', {}).lanes).toBe(2);
    expect(classifyRoad('primary', false, 'one_way', { lanes: '3', width: '11' })).toMatchObject({ lanes: 3, lanesFrom: 'tag', width: 11, widthFrom: 'tag' });
    expect(classifyRoad('trunk', true, 'one_way', {})).toMatchObject({ lanes: 1, laneWidth: 4.5, footpath: { left: 0, right: 0 } });
    expect(classifyRoad('residential', false, 'two_way', {}).footpath).toEqual({ left: 0, right: 0 });
  });

  it('reads sidewalk tags and swaps them on an edge that runs against its way', () => {
    expect(taggedFootpaths({ sidewalk: 'left' }, 2)).toEqual({ left: 2, right: 0 });
    expect(taggedFootpaths({ sidewalk: 'separate' }, 2)).toEqual({ left: 0, right: 0 });
    expect(taggedFootpaths({ 'sidewalk:right': 'yes' }, 2)).toEqual({ left: 0, right: 2 });
    expect(taggedFootpaths({}, 2)).toBeNull();
    expect(classifyRoad('tertiary', false, 'two_way', { sidewalk: 'left' }, true).footpath).toEqual({ left: 0, right: 1.8 });
  });
});

describe('features', () => {
  it('tells metro from rail', () => {
    expect(railKind({ railway: 'subway' })).toBe('metro');
    expect(railKind({ railway: 'rail', operator: 'Delhi Metro Rail Corporation Limited' })).toBe('metro');
    expect(railKind({ railway: 'rail', usage: 'main' })).toBe('rail');
    expect(railKind({ railway: 'platform' })).toBeNull();
  });

  it('joins member ways into rings and counts the ones left open', () => {
    expect(assembleRings([[1, 2, 3], [3, 4], [1, 4], [7, 8]])).toEqual({ rings: [[1, 2, 3, 4, 1]], open: 1 });
  });

  it('cuts lines and areas at the outline', () => {
    const ring = [{ x: -10, z: -10 }, { x: 10, z: -10 }, { x: 10, z: 10 }, { x: -10, z: 10 }];
    const pieces = clipLine([{ x: -20, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 5 }], ring);
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toEqual([{ x: -10, z: 0 }, { x: 10, z: 0 }]);
    const cut = clipArea([[{ x: 0, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 30 }, { x: 0, z: 30 }]], ring);
    const area = Math.abs(cut.reduce((s, r) => s + r.reduce((t, p, i) => t + p.x * r[(i + 1) % r.length]!.z - r[(i + 1) % r.length]!.x * p.z, 0) / 2, 0));
    expect(area).toBeCloseTo(100, 3);
  });

  it('reads rail, foot over bridges, water and open ground from the sketch', () => {
    const s = new Sketch();
    s.way([[-900, 50], [900, 50]], { railway: 'rail', usage: 'main' });
    s.way([[-900, 60], [900, 60]], { railway: 'subway', tunnel: 'yes', name: 'Yellow Line' });
    const top = s.node(0, 100);
    s.way([[-20, 100], top], { highway: 'footway', bridge: 'yes' });
    s.way([top, [0, 110]], { highway: 'steps', bridge: 'yes' });
    const closed = (pts: [number, number][], tags: Record<string, string>): void => {
      const ids = pts.map(([x, n]) => s.node(x, n));
      s.way([...ids, ids[0]!], tags);
    };
    closed([[200, 200], [300, 200], [300, 300], [200, 300]], { natural: 'water' });
    closed([[-300, -300], [-200, -300], [-200, -200], [-300, -200]], { leisure: 'park' });
    const g = graphOf(s);
    expect(g.features.rail.map((l) => [l.kind, Math.round(l.len)])).toEqual([['rail', 1000], ['metro', 1000]]);
    expect(g.features.footBridges).toHaveLength(1);
    expect(g.features.footBridges[0]!.ways).toHaveLength(2);
    expect(g.features.water.map((w) => Math.round(w.area))).toEqual([10000]);
    expect(g.features.open.map((w) => w.kind)).toEqual(['leisure=park']);
  });
});

describe('footprints (BS1 with our merge rule)', () => {
  const row = (id: string, provider: string, ring: [number, number][], extra: Partial<OvertureRow> = {}): OvertureRow => ({ id, sources: [{ dataset: provider }], geojson: { type: 'Polygon', coordinates: [ring] }, ...extra });

  it('keeps OSM first, adds machine-made footprints only where they are new, and leaves out what is below ground', () => {
    const s = new Sketch();
    s.building([[0, 0], [20, 0], [20, 20], [0, 20]], { name: 'Old house', wikidata: 'Q1' });
    const rows = [
      row('a', 'Google Open Buildings', [[1, 1], [19, 1], [19, 19], [1, 19], [1, 1]]),
      row('b', 'Google Open Buildings', [[40, 0], [60, 0], [60, 20], [40, 20], [40, 0]]),
      row('c', 'OpenStreetMap', [[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]]),
      row('d', 'Microsoft ML Buildings', [[100, 0], [120, 0], [120, 20], [100, 20], [100, 0]], { is_underground: true }),
      row('e', 'Microsoft ML Buildings', [[900, 0], [920, 0], [920, 20], [900, 20], [900, 0]]),
    ];
    const g = graphOf(s, 500, rows);
    expect(g.footprints.map((f) => [f.id.startsWith('way/') ? 'osm' : f.id, f.source])).toEqual([['overture/b', 'overture:google'], ['osm', 'osm']]);
    expect(g.footprints.find((f) => f.source === 'osm')!.tags).toMatchObject({ name: 'Old house', wikidata: 'Q1' });
    const ov = overtureFootprints(rows, flat);
    expect(ov.underground).toBe(1);
    const set = mergeStageFootprints([], ov.list, square(500).slice(0, 4).map(([x, n]) => ({ x, z: -n })));
    expect(set.outside).toBe(1);
  });
});
