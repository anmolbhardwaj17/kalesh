// The ground builder (P1-015) on small synthetic maps: a crossroads at grade with a building, a building that lies
// across a road edge, a pond and a lawn (the road to ground gap, nothing above the road, the tile seams, the areas
// against the outline, classes by plain geometry, water under its bank, the same ground twice), and a flyover
// (the ground runs on under the deck and ends at the ramp walls). The triangulation itself is in cdt.test.ts, the
// pilot centre in pilot_terrain.test.mjs.
import { describe, expect, it } from 'vitest';
import { elevationInput } from '../elevation/input';
import { solveBlockElevation } from '../elevation/solve';
import { readStructures } from '../elevation/structures';
import type { P2 } from '../geom';
import { buildRoadMesh } from '../mesh/build';
import { meshInput } from '../mesh/input';
import { K_DECK, K_FILL } from '../mesh/stripfaces';
import { MIN_COLLIDER_AREA2, colliderChunks } from '../roads/mesh';
import { buildLaneModel } from '../roads/network';
import { Sketch } from '../testmap';
import { buildGround, emitGround } from './build';
import type { Ground } from './build';
import { checkGround } from './checks';
import type { TerrainChecks } from './checks';
import { MEET_EDGE, MEET_NONE, MEET_WALL } from './collect';
import type { TerrainInput } from './collect';
import { groundHash, groundInBox, terrainInvariants, terrainRecord } from './terrainout';
import { C_GROUND, C_LAWN, C_PLOT, C_WATER } from './triangulate';

const slope = (x: number): number => 200 + 0.004 * x;
const box = (x0: number, z0: number, x1: number, z1: number): P2[] => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];

interface Built { g: Ground; c: TerrainChecks; input: TerrainInput }
const build = (s: Sketch, extra: Partial<TerrainInput>, half = 150): Built => {
  const gr = s.graph(500);
  const b = buildLaneModel({ nodes: gr.nodes, edges: gr.edges, wayLanes: new Map() });
  const ei = elevationInput(b, gr, slope);
  const res = solveBlockElevation(ei);
  const st = readStructures({ strips: b.strips, joints: b.joints, junctions: ei.junctions, junctionHeights: res.junctionHeights, tunnels: res.tunnels, crossings: res.crossings, pairSamples: res.pairSamples, water: [], ties: ei.ties ?? [], ground: slope });
  const mi = meshInput(b, res.junctionHeights, st.kinds);
  const mesh = buildRoadMesh(mi);
  const input: TerrainInput = { fs: mesh.fs, edges: mesh.edges, grid: mesh.grid, strips: mi.strips, kinds: mi.kinds, outline: box(-half, -half, half, half), footprints: [], water: [], open: [], ground: slope, offset: { x: 13.3, z: -7.7 }, ...extra };
  const g = buildGround(input);
  return { g, c: checkGround(g), input };
};

describe('a crossroads at grade with a building, a pond and a lawn', () => {
  const s = new Sketch();
  s.way([[-200, 0], [0, 0], [200, 0]].map((p) => p as [number, number]), { highway: 'primary', name: 'Main Road' });
  const mid = s.elements.find((e) => e.type === 'node' && e.lon === 0 && e.lat === 0)!.id;
  s.way([[0, -200], mid, [0, 200]], { highway: 'tertiary', name: 'Cross Street' });
  const house = box(40, 40, 80, 70);
  // a footprint that lies across the edge of Main Road, and one that lies on the first
  const across = box(-90, -3, -60, 30);
  const onHouse = box(70, 60, 100, 90);
  const pond = box(-110, -110, -50, -60);
  const lawn = box(30, -120, 120, -40);
  const { g, c, input } = build(s, { footprints: [house, across, onHouse], water: [{ id: 'w1', name: 'Pond', rings: [pond] }], open: [[lawn]] });

  it('the ground shares the road edge: no gap on any point, no ground vertex in a road face, every piece of road edge has ground along it', () => {
    expect(c.gap.samples).toBeGreaterThan(200);
    expect(c.gap.maxM).toBeLessThan(0.002);
    expect(c.gap.over2cm).toBe(0);
    expect(c.gap.uncoveredM.other).toBe(0);
    // the roads run on past the outline: their edges out there have no ground
    expect(c.gap.uncoveredM.outsideStage).toBeGreaterThan(100);
    expect(c.above.vertices).toBeGreaterThan(100);
    expect(c.above.insideRoadFace + c.above.aboveRoad + c.above.throughDeck).toBe(0);
  });

  it('every triangle knows what it lies in: counts agree, classes match plain geometry, the areas add up to the outline', () => {
    expect(g.tg.stats.inconsistent).toBe(0);
    expect(g.tg.stats.segments.failed).toBe(0);
    expect(c.classes.samples).toBeGreaterThan(800);
    expect(c.classes.mismatches).toBe(0);
    expect(c.classes.holes).toBe(0);
    expect(c.area.outlineM2).toBe(90000);
    expect(c.area.holeShare).toBeLessThan(0.001);
    // the two footprints that overlap count once; the one across the road edge loses what the road covers
    const whole = 40 * 30 + 30 * 30 - 10 * 10 + 30 * 33;
    expect(c.area.plotM2).toBeLessThan(whole);
    expect(c.area.plotM2).toBeGreaterThan(whole - 30 * 14);
    expect(c.area.waterM2).toBeCloseTo(60 * 50, 0);
    expect(c.area.lawnM2).toBeCloseTo(90 * 80, 0);
    const cls = new Set(Array.from(g.surface.cls));
    expect([...cls].sort()).toEqual([C_PLOT, C_WATER, C_LAWN, C_GROUND]);
  });

  it('needles are rare, and the lattice gives relief inside the blocks', () => {
    expect(c.needles.triangles).toBeGreaterThan(500);
    expect(c.needles.share).toBeLessThan(0.02);
    expect(g.collected.counts.latticePoints).toBeGreaterThan(100);
    // a free vertex follows the ground model and the roads near it: the model slopes 1.2 m across the stage
    const ys = Array.from(g.surface.vy).filter((y) => !Number.isNaN(y));
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.8);
  });

  it('the tiles of the world grid meet exactly: every edge on a tile line has its equal across the seam', () => {
    expect(g.tiles.length).toBeGreaterThanOrEqual(4);
    expect(c.seams.edges).toBeGreaterThan(40);
    expect(c.seams.matched).toBe(c.seams.edges);
    expect(c.seams.mismatched).toBe(0);
    expect(c.seams.maxDiffM).toBeLessThanOrEqual(0.0001);
    // no triangle crosses a tile line: every vertex lies inside its tile's square
    for (const t of g.tiles) for (const m of t.meshes) for (let k = 0; k < m.pos.length; k += 3) for (const axis of [0, 2]) {
      expect(m.pos[k + axis]).toBeGreaterThanOrEqual(-0.001);
      expect(m.pos[k + axis]).toBeLessThanOrEqual(250.001);
    }
  });

  it('the pond lies flat under its bank, with a bed under it', () => {
    expect(g.surface.waters).toHaveLength(1);
    const w = g.surface.waters[0]!;
    expect(w.areaM2).toBe(3000);
    expect(w.level).toBeLessThan(w.bankMinM);
    const meshes = groundInBox(g, { minX: -150, maxX: 150, minZ: -150, maxZ: 150 });
    expect(meshes.map((m) => m.material)).toEqual(['ground', 'lawn', 'plot', 'bed', 'water']);
    const water = meshes.find((m) => m.material === 'water')!;
    const bed = meshes.find((m) => m.material === 'bed')!;
    for (let k = 1; k < water.pos.length; k += 3) expect(water.pos[k]).toBe(w.level);
    let lowest = Infinity;
    for (let k = 1; k < bed.pos.length; k += 3) lowest = Math.min(lowest, bed.pos[k] as number);
    expect(lowest).toBeLessThan(w.level - 0.4);
    // every ground triangle turns Godot's way: clockwise seen from above
    const gm = meshes.find((m) => m.material === 'ground')!;
    for (let k = 0; k + 2 < gm.idx.length; k += 3) {
      const [a, b, d] = [gm.idx[k]! * 3, gm.idx[k + 1]! * 3, gm.idx[k + 2]! * 3];
      const up = (gm.pos[b + 2]! - gm.pos[a + 2]!) * (gm.pos[d]! - gm.pos[a]!) - (gm.pos[b]! - gm.pos[a]!) * (gm.pos[d + 2]! - gm.pos[a + 2]!);
      if (Math.abs(gm.nrm[a + 1]!) > 0.5) expect(up).toBeLessThan(0);
    }
  });

  it('a footpath end beside a carriageway end: the ground has both heights there and an upright face between them', () => {
    // the four road ends lie outside the outline here; inside it the kerbs of the raised corners end on the junction
    expect(g.surface.stats.unresolvedSteps).toBe(0);
    expect(g.surface.stats.skirts * 3 * 4).toBeLessThanOrEqual(g.surface.skirts.length);
  });

  it('the same input gives the same ground, and the record carries the acceptance numbers', () => {
    const again = buildGround(input);
    expect(groundHash(again)).toBe(groundHash(g));
    const rec = terrainRecord(g, c, 1, groundHash(g), {});
    expect(terrainInvariants(rec, groundHash(again)).map((r) => [r.id, r.ok])).toEqual([
      ['TERR-01.gap', true], ['TERR-02.nothing_above_the_road', true], ['TERR-03.needles', true], ['TERR-04.seams', true], ['TERR-05.no_hole', true], ['TERR-06.same_twice_in_time', true],
    ]);
    expect(rec.gates).toEqual({ groundGapMaxM: c.gap.maxM, groundAboveRoad: 0, needleShare: c.needles.share, seamMismatches: 0, holeShare: c.area.holeShare });
    // one group for everything gives the same triangles as the tiles together
    const one = emitGround(g, () => 0, () => ({ x: 0, z: 0 })).get(0)!;
    const count = (list: { idx: number[] }[]): number => list.reduce((n, m) => n + m.idx.length / 3, 0);
    expect(count(one)).toBe(g.tiles.reduce((n, t) => n + count(t.meshes), 0));
  });
});

describe('a flyover over a road at grade', () => {
  const s = new Sketch();
  s.way([[-400, 0], [400, 0]], { highway: 'primary', name: 'Low Road' });
  const a = s.node(0, -40);
  const d = s.node(0, 40);
  s.way([[0, -420], a], { highway: 'tertiary', name: 'High Road' });
  s.way([a, d], { highway: 'tertiary', name: 'High Road', bridge: 'yes', layer: '1' });
  s.way([d, [0, 420]], { highway: 'tertiary', name: 'High Road' });
  const { g, c, input } = build(s, {}, 380);

  it('the ground meets a deck not at all, a ramp on fill at its walls, a road at grade at its edge', () => {
    const kinds = new Set(input.kinds.flatMap((k) => Array.from(k)));
    expect(kinds.has(K_DECK) && kinds.has(K_FILL)).toBe(true);
    const meets = new Set(Array.from(g.collected.meet));
    expect([...meets].sort()).toEqual([MEET_NONE, MEET_EDGE, MEET_WALL]);
    expect(g.collected.counts.wallEdges).toBeGreaterThan(20);
  });

  it('the ground runs on under the deck without touching it, and ends at the ramp walls on the right side of them', () => {
    expect(c.above.underDeck).toBeGreaterThan(0);
    expect(c.above.throughDeck).toBe(0);
    expect(c.above.aboveRoad).toBe(0);
    expect(c.gap.wallSamples).toBeGreaterThan(40);
    expect(c.gap.wallWrongSide).toBe(0);
    // the ramp walls stand well over a metre above the ground at their highest
    expect(c.gap.wallMaxHeightM).toBeGreaterThan(1.5);
    expect(c.gap.maxM).toBeLessThan(0.002);
    expect(c.gap.over2cm).toBe(0);
    expect(c.area.holeShare).toBeLessThan(0.001);
    expect(c.classes.holes).toBe(0);
    expect(c.seams.mismatched).toBe(0);
    expect(c.needles.share).toBeLessThan(0.02);
  });
});

describe('collider chunks', () => {
  it('a needle with no area as 32-bit floats stays out', () => {
    const pos = [0, 0, 0, 4, 0, 0, 0, 0, 3, /* a needle 0.01 mm wide, 300 m from the tile origin */ 300, 5, 300, 302, 5, 300, 301, 5, 300.00001];
    const chunks = colliderChunks([{ name: 'ground', material: 'ground', pos, nrm: [], idx: [0, 1, 2, 3, 4, 5] }], ['ground'], 1000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.faces).toHaveLength(9);
    expect(MIN_COLLIDER_AREA2).toBe(2e-6);
  });
});

