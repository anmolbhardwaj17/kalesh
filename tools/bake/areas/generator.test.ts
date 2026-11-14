// The area profile generator (P2-009) on a small made-up town: two drawn areas side by side (an old quarter of shop
// houses and a quarter of offices), rule ground round them, one street with rows of buildings. Blending, the floor
// distributions, OSM tags, blueprints, odd footprints, lots from block faces, variety, shells, facade placements, and
// that the same input gives the same city while a change to one parcel stays in its tile.
import { describe, expect, it } from 'vitest';
import type { P2 } from '../geom';
import { ringArea } from '../geom';
import type { GraphFootprint } from '../graph/build';
import { tileOf } from '../layout/grid';
import { decodeContent, encodeT1, tileBadVertices } from '../tile/codec';
import type { TileContent } from '../tile/codec';
import { WorldCutter } from '../tile/cutter';
import { AreaSampler, BLEND, mixStep, transect } from './blend';
import { applyBlueprints, checkBlueprint } from './blueprints';
import type { Blueprint } from './blueprints';
import { MODULE_H, MODULE_W, facadeOf, packData } from './facade';
import { PLACEMENT_BUDGET_BYTES, generateCity, planParcels } from './generator';
import type { ParcelInput } from './generator';
import { checkFootprints, cutSpikes, dewobble, iou, selfCrosses, squared } from './oddshapes';
import { FLOOR_M, TYPES, applyVariety, draftParcel, finishParcel, floorCap, shareFloors, signature, typeFit } from './plan';
import type { PlanFootprint } from './plan';
import { buildIndex, parseAreaFiles } from './profiles';
import { buildShell, inset } from './shellgen';
import { RingIndex, orientedBox, ringBox } from './space';
import { allViews, floorPmf, floorsFor } from './views';

// ------------------------------------------------------------------ the made-up town

const J = (v: unknown): string => JSON.stringify(v);
const square = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];
const cells: [number, number, number][] = [];
for (let i = -6; i < 16; i++) for (let j = -6; j < 11; j++) cells.push([i, j, i >= 12 ? 1 : 0]);
const FILES: Record<string, string> = {
  'harness/data/areas/archetypes/_base.json': J({ buildings: { mix: { house: 1 }, floors: { p10: 2, p50: 4, p90: 8 }, setback_m: [0, 3], frontage_m: [6, 20], ground_floor: 'mixed shops and entrances', colours: ['cream', 'grey_concrete'] }, wear: 0.4 }),
  'harness/data/areas/archetypes/dense.json': J({ buildings: { mix: { shop_house: 0.6, haveli: 0.4 }, floors: { p10: 3, p50: 4, p90: 5 }, setback_m: [0, 0], ground_floor: 'shops on every street frontage', colours: ['cream', 'painted_blue', 'ochre'] }, wear: 0.9 }),
  'harness/data/areas/archetypes/offices.json': J({ buildings: { mix: { govt_slab: 0.5, office_slab: 0.3, shed: 0.2 }, floors: { p10: 3, p50: 8, p90: 15 }, colours: ['grey_concrete', 'cream'] }, wear: 0.3 }),
  'harness/data/areas/archetypes/plain.json': J({ buildings: { mix: { house: 0.5, flats_block: 0.5 } } }),
  'harness/data/areas/archetypes/park.json': J({ buildings: { mix: {} } }),
  'harness/data/areas/profiles/old.json': J({ id: 'old', archetype: 'dense' }),
  'harness/data/areas/profiles/work.json': J({ id: 'work', archetype: 'offices' }),
  'harness/data/areas/overrides.json': J({ areas: {} }),
  'harness/data/areas/areas.geojson': J({
    type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { id: 'old', name: 'Old', archetype: 'dense', blend_m: 40 }, geometry: { type: 'Polygon', coordinates: [square(0, 0, 500, 500)] } },
      { type: 'Feature', properties: { id: 'work', name: 'Work', archetype: 'offices', blend_m: 90 }, geometry: { type: 'Polygon', coordinates: [square(500, 0, 1000, 500)] } },
    ],
  }),
  'harness/data/areas/rules.json': J({ cell_m: 100, rules: [], fallback: 'plain' }),
  'harness/data/areas/rule_cells.json': J({ cell_m: 100, archetypes: ['plain', 'park'], summary: {}, rows: cells }),
  'harness/data/areas/palette.json': J({ cream: '#e8dcc0', grey_concrete: '#9a9a96', painted_blue: '#6f94c4', ochre: '#c79a45' }),
};
const data = parseAreaFiles(FILES);
const project = (lon: number, lat: number): P2 => ({ x: lon, z: lat });
const index = buildIndex(data, project);
const views = allViews(data);
const view = (k: string) => views.get(k)!;

const rect = (x0: number, z0: number, x1: number, z1: number): P2[] => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
const fp = (id: string, ring: P2[], extra: Partial<GraphFootprint> = {}): GraphFootprint => ({ id, source: 'osm', ring, area: Math.abs(ringArea(ring)), height: null, levels: null, tags: { building: 'yes' }, ...extra });

/** One street along z = 125 from x = -40 to 790 (8 m wide), rows of 8 by 10 m buildings on both sides, with holes. */
function town(): ParcelInput {
  const footprints: GraphFootprint[] = [];
  for (let k = 0; k < 92; k++) {
    const x = 6 + k * 8.4;
    // holes in the rows: a 25 m hole at k 20 to 22 on the north side, a long empty stretch at k 60 to 80 on the south
    if (!(k >= 20 && k <= 22)) footprints.push(fp(`way/n${k}`, rect(x, 107, x + 8, 120)));
    if (!(k >= 60 && k <= 80)) footprints.push(fp(`way/s${k}`, rect(x, 130, x + 8, 141)));
  }
  const road = rect(-40, 121, 790, 129);
  return {
    footprints, data, project, blueprints: [], keep: new Set(), roadFaces: [road], allFaces: [road], edges: [{ id: 'w1.0', pts: [{ x: -40, z: 125 }, { x: 790, z: 125 }], width: 8, cls: 'residential' }],
    rail: [], water: [], open: [], walk: [], walkLines: [], waterLines: [], zones: [], outline: rect(-100, -100, 1100, 600), offset: { x: 0, z: 0 },
  };
}
const flat = (): number => 200;

// ------------------------------------------------------------------ profiles as numbers

describe('floor distribution of a profile', () => {
  it('the shares add up to 1 and are what the draw gives', () => {
    for (const f of [{ p10: 3, p50: 4, p90: 5 }, { p10: 2, p50: 2, p90: 3 }, { p10: 3, p50: 8, p90: 15 }, { p10: 1, p50: 1, p90: 1 }]) {
      const pmf = floorPmf(f);
      expect(pmf.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
      const got = new Array(pmf.length).fill(0) as number[];
      const n = 20000;
      for (let i = 0; i < n; i++) got[floorsFor(f, (i + 0.5) / n)]!++;
      for (let k = 0; k < pmf.length; k++) expect(got[k]! / n).toBeCloseTo(pmf[k]!, 3);
      // at least half the draws are at or under p50 and nine in ten at or under p90
      const under = (k: number): number => pmf.slice(0, k + 1).reduce((a, b) => a + b, 0);
      expect(under(f.p50)).toBeGreaterThanOrEqual(0.5);
      expect(under(f.p90)).toBeGreaterThanOrEqual(0.9);
      expect(under(f.p10 - 1)).toBeLessThanOrEqual(0.1 + 1e-9);
    }
  });

  it('a view holds the mix, the colours as swatches and whether the street wall is continuous', () => {
    const old = view('area:old');
    expect(old.mix).toEqual([['haveli', 0.4], ['shop_house', 0.6]]);
    expect(old.colours.map((c) => c.word)).toEqual(['cream', 'painted_blue', 'ochre']);
    expect(old.colours[1]!.rgb).toBe(0x6f94c4);
    expect(old.continuous).toBe(true);
    expect(old.shops).toBe(true);
    expect(view('area:work').continuous).toBe(false);
    expect(view('rule:park').mix).toEqual([]);
  });
});

// ------------------------------------------------------------------ edge blending

describe('edge blending', () => {
  const sampler = new AreaSampler(index, []);
  const w = (x: number, z: number, key: string): number => sampler.weightsAt(x, z).find((v) => v.key === key)?.w ?? 0;

  it('weights add up to 1 everywhere; deep inside an area its profile is alone; on the line two areas share it half and half', () => {
    for (const [x, z] of [[250, 250], [499, 250], [501, 250], [-30, 250], [250, -200], [1200, 800], [500, 10]] as const) {
      expect(sampler.weightsAt(x, z).reduce((s, v) => s + v.w, 0)).toBeCloseTo(1, 9);
    }
    expect(sampler.weightsAt(250, 250)).toEqual([{ key: 'area:old', w: 1 }]);
    expect(w(499.99, 250, 'area:old')).toBeCloseTo(0.5, 2);
    expect(w(500.01, 250, 'area:old')).toBeCloseTo(0.5, 2);
    expect(w(500.01, 250, 'area:work')).toBeCloseTo(0.5, 2);
    // rule ground beyond the outer edge takes the other half there
    expect(w(-0.01, 250, 'area:old')).toBeCloseTo(0.5, 2);
    expect(w(-0.01, 250, 'rule:plain')).toBeCloseTo(0.5, 2);
  });

  it('across an edge the mix changes in one direction, with no step over 20 percent between samples 25 m apart', () => {
    for (const t of [
      transect(sampler, 'a', 'old to work', 'old', { x: 300, z: 250 }, { x: 700, z: 250 }),
      transect(sampler, 'b', 'old to rule ground', 'old', { x: 250, z: 250 }, { x: -200, z: 250 }),
      transect(sampler, 'c', 'work to rule ground, slantwise', 'work', { x: 800, z: 300 }, { x: 1150, z: 650 }),
    ]) {
      expect(t.maxStep).toBeLessThanOrEqual(0.2);
      expect(t.maxRise).toBeLessThanOrEqual(1e-9);
      expect(t.from).toBeCloseTo(1, 6);
      expect(t.to).toBeCloseTo(0, 6);
    }
    expect(mixStep([{ key: 'a', w: 1 }], [{ key: 'b', w: 1 }])).toBe(1);
    expect(mixStep([{ key: 'a', w: 0.6 }, { key: 'b', w: 0.4 }], [{ key: 'a', w: 0.5 }, { key: 'b', w: 0.5 }])).toBeCloseTo(0.1, 9);
  });

  it('the band is shorter where the edge runs along a road or a rail line', () => {
    // work has blend 90: a plain edge blends over 135 m a side, a seam over 85 m
    const plain = new AreaSampler(index, []);
    const seam = new AreaSampler(index, [[{ x: 1000, z: -100 }, { x: 1000, z: 600 }]]);
    const at = (s: AreaSampler, d: number): number => s.weightsAt(1000 + d, 250).find((v) => v.key === 'area:work')?.w ?? 0;
    expect(at(plain, 100)).toBeGreaterThan(0.1);
    expect(at(seam, 100)).toBe(0);
    expect(at(seam, 40)).toBeGreaterThan(0.2);
    expect(at(seam, 40)).toBeLessThan(at(plain, 40));
    // never under the depth the 20 percent rule needs
    expect(BLEND.sideMinM * 2).toBeGreaterThanOrEqual(125);
    // the rule cells mix without a step at a cell line (cells from x = 1200 on are park)
    const r = (x: number): number => plain.ruleMix(x, 800).get('rule:park') ?? 0;
    expect(r(1000)).toBe(0);
    expect(r(1400)).toBe(1);
    for (let x = 1000; x < 1400; x += 25) expect(r(x + 25) - r(x)).toBeLessThanOrEqual(0.2);
  });
});

// ------------------------------------------------------------------ odd footprints

describe('odd footprints', () => {
  const run = (list: GraphFootprint[], keep: string[] = [], onRoad: (r: readonly P2[]) => number = () => 0) => {
    const idx = new RingIndex();
    for (const f of list) idx.add({ id: f.id, ring: f.ring, box: ringBox(f.ring) });
    return checkFootprints({ footprints: list, keep: new Set(keep), onRoad, tallFloors: () => 5, index: idx });
  };
  const wobbly = (x: number): P2[] => [{ x, z: 0 }, { x: x + 5, z: 0.4 }, { x: x + 10, z: -0.3 }, { x: x + 10.3, z: 4 }, { x: x + 9.8, z: 8 }, { x: x + 5, z: 8.3 }, { x: x - 0.2, z: 7.9 }, { x: x + 0.3, z: 4 }];

  it('the shape tools: spikes, crossings, wobble, the rectangle of the same area', () => {
    expect(selfCrosses([{ x: 0, z: 0 }, { x: 10, z: 10 }, { x: 10, z: 0 }, { x: 0, z: 10 }])).toBe(true);
    expect(selfCrosses(rect(0, 0, 10, 10))).toBe(false);
    const spiky = [...rect(0, 0, 10, 10).slice(0, 2), { x: 30, z: 5 }, ...rect(0, 0, 10, 10).slice(2)];
    spiky[2] = { x: 40, z: 5.2 };
    expect(cutSpikes([{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 4.9 }, { x: 40, z: 5 }, { x: 10, z: 5.1 }, { x: 10, z: 10 }, { x: 0, z: 10 }], 15)!.cut).toBe(1);
    expect(dewobble(wobbly(0), 0.6).length).toBe(4);
    const sq = squared(wobbly(0));
    expect(sq).toHaveLength(4);
    expect(Math.abs(ringArea(sq))).toBeCloseTo(Math.abs(ringArea(wobbly(0))), 0);
    expect(iou(wobbly(0), sq)).toBeGreaterThan(0.85);
    const ob = orientedBox(rect(0, 0, 20, 6));
    expect([ob.a, ob.b]).toEqual([10, 3]);
  });

  it('a sliver is dropped, a spike cut off, a machine-made wobble squared, a hand-drawn shape left alone; each with a line', () => {
    const res = run([
      fp('way/sliver', rect(0, 0, 30, 1)),
      fp('way/spike', [{ x: 0, z: 20 }, { x: 10, z: 20 }, { x: 10, z: 24.9 }, { x: 40, z: 25 }, { x: 10, z: 25.1 }, { x: 10, z: 30 }, { x: 0, z: 30 }]),
      fp('overture/wobble', wobbly(60), { source: 'overture:google' }),
      fp('way/hand', wobbly(100)),
      fp('way/good', rect(0, 50, 12, 60)),
    ]);
    expect(res.footprints.map((f) => f.id)).toEqual(['overture/wobble', 'way/good', 'way/hand', 'way/spike']);
    const by = Object.fromEntries(res.lines.map((l) => [l.id, `${l.kind} ${l.action}`]));
    expect(by).toEqual({ 'way/sliver': 'sliver dropped', 'way/spike': 'spike regularised', 'overture/wobble': 'zigzag regularised' });
    expect(res.footprints.find((f) => f.id === 'overture/wobble')!.ring).toHaveLength(4);
    expect(res.footprints.find((f) => f.id === 'way/spike')!.ring).toHaveLength(6);
    expect(res.footprints.find((f) => f.id === 'way/hand')!.ring).toHaveLength(8);
    expect(res.counts).toMatchObject({ checked: 5, dropped: 1, regularised: 2, sliver: 1, spike: 1, zigzag: 1 });
  });

  it('the keep list wins, and a squared outline that would stand on a road or a neighbour is not taken', () => {
    const kept = run([fp('way/sliver', rect(0, 0, 30, 1)), fp('overture/wobble', wobbly(60), { source: 'overture:google' })], ['way/sliver', 'overture/wobble']);
    expect(kept.footprints.map((f) => f.ring.length)).toEqual([8, 4]);
    expect(kept.lines.map((l) => l.action)).toEqual(['kept']);
    const onRoad = run([fp('overture/wobble', wobbly(60), { source: 'overture:google' })], [], () => 2);
    expect(onRoad.footprints[0]!.ring).toHaveLength(8);
    expect(onRoad.lines[0]).toMatchObject({ kind: 'zigzag', action: 'flagged' });
    // a neighbour in the dent of the wobble: the rectangle would lie on it more than the old outline did
    const crowded = run([fp('overture/wobble', wobbly(60), { source: 'overture:google' }), fp('way/near', rect(52, 2, 60.29, 6))]);
    expect(crowded.footprints.find((f) => f.id === 'overture/wobble')!.ring).toHaveLength(8);
    // outliers are flagged and kept
    const big = run([fp('way/huge', rect(0, 0, 200, 150)), fp('way/tall', rect(300, 0, 320, 20), { height: 120 })]);
    expect(big.footprints).toHaveLength(2);
    expect(big.lines.map((l) => `${l.kind} ${l.action}`).sort()).toEqual(['height flagged', 'size flagged']);
  });
});

// ------------------------------------------------------------------ blueprints

describe('area blueprints', () => {
  const bp: Blueprint = {
    area: 'old', evidence: 'sheet old "Buildings": the uniform two storey ring, photo set refs_old_01..06',
    blocks: [
      { id: 'A', ring: square(100, 100, 140, 115) as [number, number][], type: 'colonnade_block', floors: 2, height_m: 12, roof: 'flat', tint: 'cream', evidence: 'sheet old "Buildings": two storey colonnade block' },
      { id: 'Z', ring: square(300, 300, 330, 320) as [number, number][], type: 'colonnade_block', floors: 2, evidence: 'sheet old "Buildings": two storey colonnade block' },
      { id: 'R', ring: square(200, 100, 230, 130) as [number, number][], type: 'shop_house', floors: 3, evidence: 'sheet old "Buildings": three storey shop houses' },
    ],
  };
  const apply = () => applyBlueprints({
    footprints: [fp('way/under', rect(105, 102, 120, 112)), fp('way/half', rect(135, 100, 150, 112)), fp('way/far', rect(400, 100, 410, 110))],
    blueprints: [bp], project, inZone: (x, z) => x > 290 && x < 340 && z > 290 && z < 340,
    // the road takes the south half of block R
    offRoad: (f) => (f.id === 'bp/old/R' ? [{ ...f, ring: rect(200, 100, 230, 115), area: 450 }] : [f]),
  });

  it('a block stands in for the map footprints under it; a landmark zone and a road win over a block', () => {
    const res = apply();
    expect(res.footprints.map((f) => f.id)).toEqual(['bp/old/A', 'bp/old/R', 'way/far']);
    expect(res.blocks).toBe(2);
    expect(res.replaced).toBe(2);
    const lines = Object.fromEntries(res.lines.map((l) => [l.id, l.action]));
    expect(lines).toEqual({ 'bp/old/A': 'placed', 'bp/old/Z': 'in_landmark_zone', 'bp/old/R': 'placed', 'way/under': 'replaced_footprint', 'way/half': 'replaced_footprint' });
    const a = res.footprints[0]!;
    expect(a).toMatchObject({ source: 'blueprint', height: 12, levels: 2 });
    expect(a.tags).toMatchObject({ 'gen:type': 'colonnade_block', 'gen:floors': '2', 'gen:roof': 'flat', 'gen:tint': 'cream' });
    expect(res.footprints[1]!.area).toBe(450);
  });

  it('a blueprint block keeps its type, floors, height and colour through the plan', () => {
    const a = apply().footprints[0]!;
    const p: PlanFootprint = { ...a, centre: { x: 120, z: 107 }, tx: 0, tz: 0 };
    const plan = finishParcel(draftParcel(p, [{ key: 'area:old', w: 1 }], views, view('rule:plain')));
    expect(plan).toMatchObject({ type: 'colonnade_block', floors: 2, height: 12, roof: 'flat', from: 'blueprint', colour: 0 });
  });

  it('a file with a wrong area, type, floor count, colour or no evidence is refused', () => {
    const ids = new Set(['old', 'work']);
    expect(checkBlueprint(bp, 'f', ids, data.palette)).toEqual([]);
    const bad: Blueprint = { area: 'nowhere', evidence: 'x', blocks: [{ id: 'a b', ring: [[0, 0]], type: 'castle', floors: 0, tint: 'mauve', evidence: '' }] };
    expect(checkBlueprint(bad, 'f', ids, data.palette)).toHaveLength(8);
  });
});

// ------------------------------------------------------------------ lots from block faces

describe('lots from block faces', () => {
  it('a hole in a street row is cut into lots; in a wall-to-wall profile every free frontage is; nothing stands on a road, open land or a zone', () => {
    const input = town();
    const plan = planParcels(input);
    const lots = plan.footprints.filter((f) => f.source === 'generator');
    expect(lots.length).toBeGreaterThan(0);
    // the hole on the north side (x 174 to 199, inside the old area): filled wall to wall
    const inHole = lots.filter((l) => l.ring.every((p) => p.x > 172 && p.x < 202 && p.z < 121));
    expect(inHole.length).toBeGreaterThanOrEqual(2);
    const covered = inHole.reduce((s, l) => s + Math.abs(l.ring[1]!.x - l.ring[0]!.x), 0);
    expect(covered).toBeGreaterThan(18);
    // the long empty stretch on the south side (x 510 to 686) lies in the offices area and the rule ground: open ground, no lots
    expect(lots.filter((l) => l.ring.some((p) => p.x > 520 && p.x < 680 && p.z > 129))).toEqual([]);
    for (const l of lots) {
      expect(l.tags['gen:origin']).toBe('infill');
      for (const p of l.ring) expect(p.z < 121 || p.z > 129).toBe(true);
      expect(l.id).toMatch(/^lot\/-?\d+_-?\d+$/);
    }
    expect(plan.infill.stats.leftOver40).toBe(0);
    expect(plan.counts.out).toBe(plan.counts.in + plan.counts.lots - plan.counts.dropped);
  });

  it('open land, water and a landmark zone keep their frontage free', () => {
    const base = planParcels(town()).footprints.filter((f) => f.source === 'generator').length;
    const blocked = town();
    blocked.zones = [rect(170, 100, 204, 121)];
    const lots = planParcels(blocked).footprints.filter((f) => f.source === 'generator');
    expect(lots.length).toBeLessThan(base);
    expect(lots.filter((l) => l.ring.some((p) => p.x > 172 && p.x < 202 && p.z < 121))).toEqual([]);
    // a footway through the hole keeps its width free, and a second road 10 m behind the frontage makes it a verge
    const lane = town();
    lane.walkLines = [{ pts: [{ x: 186, z: 121 }, { x: 186, z: 90 }], width: 2 }];
    for (const l of planParcels(lane).footprints.filter((f) => f.source === 'generator')) expect(l.ring.every((p) => p.x <= 184.6 || p.x >= 187.4 || p.z > 121)).toBe(true);
    const verge = town();
    const back = rect(160, 104, 215, 110);
    verge.footprints = verge.footprints.filter((f) => !(f.ring[0]!.x > 150 && f.ring[0]!.x < 215 && f.ring[0]!.z < 121));
    verge.roadFaces = [...verge.roadFaces, back];
    verge.allFaces = [...verge.allFaces, back];
    expect(planParcels(verge).footprints.filter((l) => l.source === 'generator' && l.ring.some((p) => p.x > 165 && p.x < 210 && p.z < 121))).toEqual([]);
    const park = town();
    park.open = [rect(170, 100, 204, 121)];
    expect(planParcels(park).footprints.filter((l) => l.source === 'generator' && l.ring.some((p) => p.x > 172 && p.x < 202 && p.z < 121))).toEqual([]);
  });
});

// ------------------------------------------------------------------ the building of a parcel

describe('the building of a parcel', () => {
  const parcel = (id: string, ring: P2[], extra: Partial<GraphFootprint> = {}): PlanFootprint => {
    const f = fp(id, ring, extra);
    return { ...f, centre: { x: (ring[0]!.x + ring[2]!.x) / 2, z: (ring[0]!.z + ring[2]!.z) / 2 }, tx: 0, tz: 0 };
  };
  const old = [{ key: 'area:old', w: 1 }];

  it('an OSM height or levels tag is kept within a floor; a small outbuilding keeps its class height', () => {
    const lv = finishParcel(draftParcel(parcel('way/1', rect(0, 0, 10, 10), { levels: 6 }), old, views, view('rule:plain')));
    expect(lv).toMatchObject({ floors: 6, from: 'levels' });
    expect(lv.height).toBeCloseTo(6 * FLOOR_M, 9);
    const h = finishParcel(draftParcel(parcel('way/2', rect(0, 0, 10, 10), { height: 25 }), old, views, view('rule:plain')));
    expect(h).toMatchObject({ floors: 8, height: 25, from: 'height', parapetM: 0 });
    expect(Math.abs(h.height / FLOOR_M - 25 / FLOOR_M)).toBeLessThanOrEqual(1);
    const g = finishParcel(draftParcel(parcel('way/3', rect(0, 0, 4, 5), { tags: { building: 'garage' } }), old, views, view('rule:plain')));
    expect(g).toMatchObject({ floors: 1, height: 3.5, from: 'class', type: 'shed' });
    const w = finishParcel(draftParcel(parcel('way/4', rect(0, 0, 12, 12), { tags: { building: 'yes', amenity: 'place_of_worship' } }), old, views, view('rule:plain')));
    expect(w).toMatchObject({ worship: true, type: 'other', roof: 'flat' });
  });

  it('the same parcel always gets the same building; another tile or id gives another draw', () => {
    const p = parcel('way/9', rect(0, 0, 9, 11));
    const one = () => {
      const d = draftParcel(p, old, views, view('rule:plain'));
      shareFloors({ tx: 0, tz: 0 }, [d]);
      return finishParcel(d);
    };
    expect(one()).toEqual(one());
    const us = new Set<number>();
    for (let k = 0; k < 40; k++) us.add(draftParcel({ ...p, id: `way/${k}` }, old, views, view('rule:plain')).u);
    expect(us.size).toBe(40);
  });

  it('the parcels of a tile share the profile floor distribution between them, bigger footprints leaning taller', () => {
    const list = [];
    for (let k = 0; k < 300; k++) list.push(parcel(`way/${k}`, rect(0, 0, 6 + (k % 20), 8 + (k % 7))));
    const drafts = list.map((p) => draftParcel(p, [{ key: 'area:work', w: 1 }], views, view('rule:plain')));
    shareFloors({ tx: 0, tz: 0 }, drafts);
    const plans = drafts.map(finishParcel).filter((p) => p.from === 'profile');
    expect(plans.length).toBeGreaterThan(200);
    const pmf = view('area:work').pmf;
    const hist = new Array(pmf.length + 1).fill(0) as number[];
    for (const p of plans) hist[p.floors]!++;
    let dist = 0;
    for (let k = 0; k < hist.length; k++) dist += Math.abs(hist[k]! / plans.length - (pmf[k] ?? 0));
    expect(dist / 2).toBeLessThan(0.06);
    // no draw over what the footprint can carry
    const area = new Map(list.map((p) => [p.id, p.area]));
    for (const p of plans) expect(p.floors).toBeLessThanOrEqual(floorCap(area.get(p.id)!));
    const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
    const tall = plans.filter((p) => p.floors >= 12).map((p) => area.get(p.id)!);
    const low = plans.filter((p) => p.floors <= 4).map((p) => area.get(p.id)!);
    expect(mean(tall)).toBeGreaterThan(mean(low) * 1.2);
    // footprints too small for the offices but big enough for a shed are sheds of one or two floors
    const small = drafts.map(finishParcel).filter((p) => p.from === 'small');
    expect(small.length).toBeGreaterThan(0);
    for (const p of small) expect(p).toMatchObject({ type: 'shed' });
  });

  it('a type fits by floors and footprint; the mix still shows where footprints are small', () => {
    expect(typeFit(TYPES.office_tower, 12, 600)).toBe(1);
    expect(typeFit(TYPES.office_tower, 3, 600)).toBeLessThan(0.001);
    expect(typeFit(TYPES.low_row_market, 6, 100)).toBeLessThan(0.001);
    expect(typeFit(TYPES.haveli, 4, 30)).toBeGreaterThan(0.3);
    expect(floorCap(16)).toBe(4);
    expect(floorCap(100)).toBe(12);
  });

  it('variety: no two parcels side by side in a tile end up the same', () => {
    // a row of forty equal footprints, wall to wall, all the same profile
    const row = [];
    for (let k = 0; k < 40; k++) row.push(parcel(`way/${k}`, rect(k * 6, 0, k * 6 + 6, 10)));
    const drafts = row.map((p) => draftParcel(p, old, views, view('rule:plain')));
    shareFloors({ tx: 0, tz: 0 }, drafts);
    const plans = drafts.map(finishParcel);
    const beside = new Map<string, string[]>();
    for (let k = 0; k < 40; k++) beside.set(`way/${k}`, [k > 0 ? `way/${k - 1}` : '', k < 39 ? `way/${k + 1}` : ''].filter(Boolean));
    const before = plans.filter((p, k) => k > 0 && signature(p) === signature(plans[k - 1]!)).length;
    const res = applyVariety({ tx: 0, tz: 0 }, plans, beside, views);
    expect(before).toBeGreaterThan(0);
    expect(res.varied).toBeGreaterThan(0);
    expect(res.stuck).toBe(0);
    for (let k = 1; k < 40; k++) expect(signature(plans[k]!)).not.toBe(signature(plans[k - 1]!));
  });
});

// ------------------------------------------------------------------ shells and facades

describe('shells and facade placements', () => {
  const plan = (over: Partial<ReturnType<typeof finishParcel>> = {}) => ({
    ...finishParcel(draftParcel({ ...fp('way/1', rect(0, 0, 12, 9)), centre: { x: 6, z: 4.5 }, tx: 0, tz: 0, levels: 4 }, [{ key: 'area:old', w: 1 }], views, view('rule:plain'))),
    ...over,
  });

  it('a shell is walls and a roof by kind, with a facade UV per vertex and its colour and wear', () => {
    for (const roof of ['flat', 'mumty', 'setback', 'crown', 'gable'] as const) {
      const p = plan({ roof, floors: roof === 'gable' ? 1 : 6, height: roof === 'gable' ? 4.5 : 6 * 3.2, groundM: 3.2, floorM: 3.2, parapetM: 0 });
      const sh = buildShell('way/1', rect(0, 0, 12, 9), p, 3, flat, flat)!;
      expect(sh.tris.length % 9).toBe(0);
      expect(sh.nrm.length).toBe(sh.tris.length / 3);
      expect(sh.uv.length).toBe((sh.tris.length / 9) * 6);
      for (let t = 0; t < sh.nrm.length; t += 3) expect(Math.hypot(sh.nrm[t]!, sh.nrm[t + 1]!, sh.nrm[t + 2]!)).toBeCloseTo(1, 6);
      expect(sh.base).toBeCloseTo(199.7, 6);
      expect(sh.groundY).toBe(200);
      expect(sh.roofY).toBeCloseTo(200 + p.height, 6);
      expect(sh.top).toBeGreaterThanOrEqual(sh.roofY);
      if (roof === 'mumty' || roof === 'crown' || roof === 'gable') expect(sh.top).toBeGreaterThan(sh.roofY);
      expect({ tint: sh.tint, wear: sh.wear }).toEqual({ tint: p.tint, wear: p.wear });
      // four walls with their bays; a setback adds the four walls of the top floor
      expect(sh.walls).toHaveLength(roof === 'setback' ? 8 : 4);
      expect(sh.walls[0]).toMatchObject({ bays: 4, floor0: 0 });
    }
    expect(buildShell('x', [{ x: 0, z: 0 }, { x: 1, z: 0 }], plan(), 3, flat, flat)).toBeNull();
    expect(inset(rect(0, 0, 12, 9), 1.8)).toHaveLength(4);
    expect(inset(rect(0, 0, 3, 3), 1.8)).toBeNull();
  });

  it('a street wall carries a module per bay and floor, an open wall its upper floors, a party wall nothing', () => {
    const p = plan();
    const sh = buildShell('way/1', rect(0, 0, 12, 9), p, 3, flat, flat)!;
    const spec = TYPES[p.type];
    // the wall along z = 0 looks on a street, the wall along x = 12 on open ground, the others on neighbours
    const look = (w: { nx: number; nz: number }) => (w.nz < -0.5 ? 'street' : w.nx > 0.5 ? 'open' : 'hidden') as 'street' | 'open' | 'hidden';
    const inst = facadeOf(sh, p, view('area:old'), spec, look, { tx: 0, tz: 0 });
    const street = inst.filter((i) => Math.abs(i.xform[11]!) < 1e-9);
    const open = inst.filter((i) => Math.abs(i.xform[3]! - 12) < 1e-9);
    expect(street.length + open.length).toBe(inst.length);
    const floors = p.floors;
    expect(street.filter((i) => !i.module.endsWith('roof_parapet'))).toHaveLength(4 * floors);
    expect(street.filter((i) => i.cls === 0)).toHaveLength(4);
    expect(open).toHaveLength(3 * (floors - 1));
    expect(open.every((i) => i.cls === 2)).toBe(true);
    expect(street.some((i) => i.module === `${p.type}.gf_door`)).toBe(true);
    for (const i of inst) {
      expect(i.module.startsWith(`${p.type}.`)).toBe(true);
      expect(i.data).toBe(packData(p.tint, p.wear));
      expect(i.xform).toHaveLength(12);
      // y scale is the floor height over the module height, the wall normal is the z axis of the module
      expect(i.xform[1]).toBe(0);
    }
    const g = street.find((i) => i.cls === 0)!;
    expect(g.xform[7]).toBe(200);
    expect(g.xform[5]).toBeCloseTo(p.groundM / MODULE_H, 9);
    expect(Math.hypot(g.xform[0]!, g.xform[8]!)).toBeCloseTo(3 / MODULE_W, 9);
    expect([g.xform[2], g.xform[10]]).toEqual([0, -1]);
    expect(packData(0xaabbcc, 1)).toBe(0xaabbccff);
    expect(facadeOf(sh, { ...p, worship: true }, view('area:old'), spec, look, { tx: 0, tz: 0 })).toEqual([]);
  });
});

// ------------------------------------------------------------------ the whole generator

describe('the generator on the town', () => {
  const digest = (city: ReturnType<typeof generateCity>, offset: P2 = { x: 0, z: 0 }): Map<string, string> => {
    const by = new Map<string, string[]>();
    for (const s of city.shells) {
      const t = tileOf(s.anchor.x + offset.x, s.anchor.z + offset.z);
      const k = `${t.tx}_${t.tz}`;
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(JSON.stringify([s.id, s.tris, s.uv, s.tint, s.wear]));
    }
    for (const [k, p] of city.placements) {
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(JSON.stringify(p.list));
    }
    return new Map([...by].map(([k, v]) => [k, v.sort().join('|')]));
  };

  it('every parcel gets a shell; picks follow the profile under the parcel and mix near an edge', () => {
    const plan = planParcels(town());
    const city = generateCity(plan, flat, flat);
    expect(city.stats.shells).toBe(plan.footprints.length);
    expect(city.stats.notAShape).toBe(0);
    expect(city.stats.variety.sameInTile).toBe(0);
    const at = (x: number): string[] => plan.footprints.filter((f) => f.ring[0]!.x >= x && f.ring[0]!.x < x + 60).map((f) => city.plans.get(f.id)!.profile);
    expect(new Set(at(200))).toEqual(new Set(['area:old']));
    expect(new Set(at(720))).toEqual(new Set(['area:work']));
    // round the shared edge at x = 500 both profiles build
    const near = new Set(plan.footprints.filter((f) => f.ring[0]!.x > 440 && f.ring[0]!.x < 560).map((f) => city.plans.get(f.id)!.profile));
    expect(near.has('area:old') && near.has('area:work')).toBe(true);
    // placements: only walls on the street or on open ground, inside the budget, in the tile they stand in
    expect(city.stats.placements.instances).toBeGreaterThan(500);
    expect(city.stats.placements.overBudget).toEqual([]);
    for (const [id, t] of city.placements) {
      expect(t.bytes).toBeLessThanOrEqual(PLACEMENT_BUDGET_BYTES);
      for (const m of t.list) {
        expect(m.xforms.length).toBe(m.data.length * 12);
        for (let i = 0; i < m.xforms.length; i += 12) {
          const w = tileOf(m.xforms[i + 3]!, m.xforms[i + 11]!);
          expect(`${w.tx}_${w.tz}`).toBe(id);
        }
      }
    }
  });

  it('the same input gives the same city, and a change to one parcel changes only the tile it stands in', () => {
    const a = digest(generateCity(planParcels(town()), flat, flat));
    const b = digest(generateCity(planParcels(town()), flat, flat));
    expect([...a.keys()].sort()).toEqual(['0_0', '1_0', '2_0', '3_0']);
    expect(b).toEqual(a);
    // one footprint in tile 1_0 grows a metre deeper
    const changed = town();
    changed.footprints = changed.footprints.map((f) => (f.id === 'way/n40' ? fp('way/n40', rect(342, 106, 350, 120)) : f));
    const c = digest(generateCity(planParcels(changed), flat, flat));
    const differ = [...a.keys()].filter((k) => a.get(k) !== c.get(k));
    expect(differ).toEqual(['1_0']);
    // and one taken away
    const fewer = town();
    fewer.footprints = fewer.footprints.filter((f) => f.id !== 'way/s50');
    const d = digest(generateCity(planParcels(fewer), flat, flat));
    expect([...a.keys()].filter((k) => a.get(k) !== d.get(k))).toEqual(['1_0']);
  });

  it('a generated shell goes into the tile with its facade UV, colour and wear; placements keep their custom data through the file', () => {
    const plan = planParcels(town());
    const city = generateCity(plan, flat, flat);
    const cutter = new WorldCutter({ x: 0, z: 0 });
    cutter.addShells(city.shells);
    const cut = cutter.cut(0, 0);
    const mesh = cut.meshes.find((m) => m.material === 'building')!;
    expect(mesh.uv!.length).toBe((mesh.pos.length / 3) * 2);
    expect(mesh.uv2!.length).toBe(mesh.uv!.length);
    const tints = new Set<number>();
    for (let i = 0; i < mesh.uv2!.length; i += 2) tints.add(mesh.uv2![i]!);
    const want = new Set(city.shells.filter((s) => tileOf(s.anchor.x, s.anchor.z).tx === 0).map((s) => s.tint));
    expect(tints).toEqual(want);
    expect(cut.buildings.length).toBe(city.shells.filter((s) => tileOf(s.anchor.x, s.anchor.z).tx === 0).length);
    // the file: placements with their custom data, origins inside the tile
    const p = city.placements.get('0_0')!;
    const content: TileContent = {
      district: 'centre', tx: 0, tz: 0, size: 250, origin: cut.origin, meshes: cut.meshes, colliders: [], margin: 250,
      placements: p.list.map((m) => ({ module: m.module, data: m.data, xforms: m.xforms.map((v, k) => (k % 12 === 7 ? v - cut.origin[1] : Math.fround(v))) })),
    };
    expect(tileBadVertices(content, 250)).toEqual([]);
    const back = decodeContent(encodeT1(content));
    expect(back.placements.map((m) => [m.module, m.data])).toEqual(p.list.map((m) => [m.module, m.data]));
    expect(back.placements[0]!.xforms).toHaveLength(p.list[0]!.xforms.length);
    const far: TileContent = { ...content, placements: [{ module: 'x.y', xforms: [1, 0, 0, 900, 0, 1, 0, 0, 0, 0, 1, 0], data: [0] }] };
    expect(tileBadVertices(far, 250).map((b) => b.array)).toEqual(['placement x.y']);
    expect(() => encodeT1({ ...content, placements: [{ module: 'x.y', xforms: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], data: [0, 1] }] })).toThrow(/custom data/);
  });
});
