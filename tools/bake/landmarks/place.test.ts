// Landmark placement (P2-006) on small synthetic maps: a structure beside a road (its pad, zone, the buildings it
// replaces), a fort (its parts, its wall, a pad an edit names, a moat), an underground station (a pin only), held
// and far entries; then the pads on a built ground (flat, no gap) and the stand-in massing and silhouettes.
import { describe, expect, it } from 'vitest';
import { elevationInput } from '../elevation/input';
import { solveBlockElevation } from '../elevation/solve';
import { readStructures } from '../elevation/structures';
import type { P2 } from '../geom';
import { pointInRing, ringArea } from '../geom';
import { buildRoadMesh } from '../mesh/build';
import { meshInput } from '../mesh/input';
import { buildLaneModel } from '../roads/network';
import { buildGround } from '../terrain/build';
import { checkGround } from '../terrain/checks';
import { MEET_NONE, meetOf } from '../terrain/collect';
import type { TerrainInput } from '../terrain/collect';
import { groundHash } from '../terrain/terrainout';
import { Sketch } from '../testmap';
import { GroundHeights } from '../tile/shells';
import { buildMassing, farSilhouette, heroSilhouette, simplifyRing, structureShapes, tiersOf } from './massing';
import { mainAxis, orientationOf } from './orient';
import { CLEAR_RING_M, FAR_CLEAR_M, PAD_MARGIN_M, PAD_ROAD_CLEAR_M, lodSlots, modeOf, placeLandmarks, zoneStyle } from './place';
import type { LandmarkBudgets, PlaceFootprint, PlaceInput } from './place';
import { PAD_FLAT_M, PAD_GAP_M, buildingsInZones, checkPads, landmarkFile, landmarkPins } from './placeout';
import type { Entry, Tier } from './types';

const BUDGETS: LandmarkBudgets = { heroPartsMax: 8, heroTrianglesPerPart: 25000, heroMaterialsMax: 6, heroLods: 3, farSilhouetteTriangles: 2000, heroesAtFullDetailInView: 2, positionErrorM: { hero: 5, signature: 10, marker: 15 } };
const slope = (x: number, z: number): number => 200 + 0.004 * x + 0.002 * z;
const box = (x0: number, z0: number, x1: number, z1: number): P2[] => [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
/** The test projection: lat is metres north (z = -lat), lon metres east. */
const project = (lat: number, lon: number): P2 => ({ x: lon, z: -lat });
const geo = (ring: P2[]): [number, number][] => ring.map((p) => [-p.z, p.x]);

function entry(id: string, tier: Tier, kind: string, ring: P2[] | null, more: Partial<Entry> = {}): Entry {
  const c = ring ? { x: ring.reduce((s, p) => s + p.x, 0) / ring.length, z: ring.reduce((s, p) => s + p.z, 0) / ring.length } : { x: 0, z: 0 };
  const front = (more as { front_bearing?: number }).front_bearing ?? null;
  const o = orientationOf(ring ? mainAxis(ring) : null, front);
  return {
    id, name: { en: id, hi: null }, ids: { wikidata: null, osm: 'way/1', asi: null }, match: 'none', sources: ['osm'], evidence: 'OSM way/1 (test)', lat: -c.z, lon: c.x,
    position: { source: 'osm_footprint_centre', ref: 'way/1', evidence: 'test' }, footprint: ring ? { source: 'osm', ref: `way/${id}`, area_m2: Math.abs(ringArea(ring)), ring: geo(ring) } : null,
    height_m: null, height_source: 'none', height_evidence: 'none', era: null, type: 'monument', kind, tier, tier_from: 'score', tier_reason: 'test', score: 0, block: 'centre', district: null, far: false,
    area: { kind: 'rule', id: 'institutional_offices', archetype: 'institutional_offices' }, flags: [], place: 'ok', agreement: null, orientation_deg: o.deg,
    orientation: { source: o.source, axis_deg: o.axisDeg, elongation: o.elongation, front_known: o.frontKnown }, licence_notes: 'test', art: { status: 'stand-in' },
    confidence: { position: 'high', footprint: 'medium', height: 'none' }, ...more,
  };
}

const fp = (id: string, ring: P2[], height: number | null = null): PlaceFootprint => ({ id, ring, height, levels: null, tags: { building: 'yes' } });

function input(entries: Entry[], more: Partial<PlaceInput> = {}): PlaceInput {
  return {
    stage: 'test', block: 'centre', entries, project, offset: { x: 600, z: 400 }, outline: box(-1000, -1000, 1000, 1000), footprints: [], roads: [], water: [], open: [], barriers: [], ground: slope, budgets: BUDGETS,
    farWorld: (e) => ({ x: e.lon + 600, z: -e.lat + 400, block: 'centre', factor: 1 }), reachable: (x, z) => Math.abs(x - 600) < 1000 + FAR_CLEAR_M && Math.abs(z - 400) < 1000 + FAR_CLEAR_M, pivot: { x: 600, z: 400 }, ...more,
  };
}

describe('a structure beside a road', () => {
  const arch = box(100, -40, 118, -13); // 18 m east to west, 27 m north to south
  const road = box(-500, 0, 500, 14); // a road face 13 m south of the arch
  const copy = fp('overture/copy', box(101, -39, 117, -14)); // the same arch drawn by another source
  const kiosk = fp('way/kiosk', box(122, -30, 126, -26)); // stands in the clear ring
  const far = fp('way/far', box(200, -60, 230, -30));
  const res = placeLandmarks(input([entry('arch', 'hero', 'historic=monument', arch, { height_m: 42, front_bearing: 270 } as Partial<Entry>)], { footprints: [copy, kiosk, far], roads: [road], open: [{ id: 'way/lawn', kind: 'leisure=park', name: 'Lawn', rings: [box(60, -90, 160, -5)] }] }));
  const p = res.placements[0]!;

  it('stands at its projected position plus the block offset, facing the front the evidence gives', () => {
    expect(p.mode).toBe('structure');
    expect(p.x).toBeCloseTo(109, 6);
    expect(p.z).toBeCloseTo(-26.5, 6);
    expect(p.wx).toBeCloseTo(709, 6);
    expect(p.wz).toBeCloseTo(373.5, 6);
    expect(p.yawDeg).toBeCloseTo(270, 1);
    expect(p.frontKnown).toBe(true);
    expect(p.massingHeightM).toBe(42);
  });

  it('gets a flat pad of its footprint plus the margin, off the road, at the mean ground level', () => {
    const m = PAD_MARGIN_M.hero;
    expect(p.pad).not.toBeNull();
    // grown by 4 m it would reach z = -9: 9 m from the road, so nothing is cut
    expect(p.pad!.clipped).toBe(false);
    expect(p.pad!.areaM2).toBeCloseTo((18 + 2 * m) * (27 + 2 * m), 0);
    expect(p.pad!.level).toBeCloseTo(slope(109, -26.5), 2);
    expect(p.pad!.cutFillM).toBeLessThan(0.1);
    expect(res.ground.find((g) => g.cls === 'pad')).toMatchObject({ landmark: 'arch', level: p.pad!.level, material: 'pad' });
  });

  it('a pad that would reach a road is cut back from it', () => {
    const near = placeLandmarks(input([entry('gate', 'signature', 'historic=city_gate', box(100, -20, 118, -3))], { roads: [road] })).placements[0]!;
    expect(near.pad!.clipped).toBe(true);
    for (const q of near.pad!.ring) expect(q.z).toBeLessThanOrEqual(-PAD_ROAD_CLEAR_M + 1e-6);
    // the body stands on the pad only
    for (const ring of near.body) for (const q of ring) expect(pointInRing({ x: q.x, z: q.z + 1e-3 > -PAD_ROAD_CLEAR_M ? q.z - 0.01 : q.z }, near.pad!.ring) || q.z <= -PAD_ROAD_CLEAR_M + 1e-6).toBe(true);
  });

  it('its zone is the pad plus the clear ring, and the buildings in it are replaced and logged', () => {
    expect(p.zone!.from).toBe('pad_and_clear_ring');
    expect(p.zone!.clearM).toBe(CLEAR_RING_M.hero * zoneStyle('institutional_offices').clearShare);
    expect(res.log.map((l) => `${l.id}:${l.how}`).sort()).toEqual(['overture/copy:replaced', 'way/kiosk:replaced']);
    expect(res.taken.has('way/far')).toBe(false);
    expect(p.replaced).toBe(2);
    const kept = [far];
    expect(buildingsInZones(res.placements, kept)).toEqual([]);
    expect(buildingsInZones(res.placements, [copy, far])).toEqual([{ id: 'overture/copy', landmark: 'arch' }]);
    // world metres in the log
    expect(res.log.find((l) => l.id === 'way/kiosk')).toMatchObject({ landmark: 'arch', x: 724, z: 372 });
  });

  it('its surroundings name the lawn of the map and its own forecourt, with their sources', () => {
    expect(p.surroundings.map((s) => `${s.kind}:${s.source}`)).toEqual(['forecourt:rule', 'lawn:osm']);
    expect(p.surroundings.find((s) => s.kind === 'lawn')).toMatchObject({ ref: 'way/lawn', note: 'Lawn' });
    expect(res.ground.map((g) => g.cls)).toEqual(['pad', 'forecourt']);
  });

  it('a hero has its LOD chain and a far silhouette slot inside the budgets; a marker one level', () => {
    expect(p.lod.slots.map((s) => s.level)).toEqual([0, 1, 2]);
    expect(p.lod.slots[0]).toMatchObject({ fromM: 0, source: 'tile_massing' });
    for (let k = 1; k < p.lod.slots.length; k++) expect(p.lod.slots[k]!.fromM).toBe(p.lod.slots[k - 1]!.toM);
    expect(p.lod.far).toMatchObject({ fromM: p.lod.slots[2]!.toM, trianglesMax: 2000 });
    expect(lodSlots('marker', BUDGETS, true).far).toBeNull();
    expect(res.limits).toEqual({ heroesAtFullDetailInView: 2, farSilhouetteTriangles: 2000 });
  });
});

describe('a fort, an underground station, held and far entries', () => {
  const fort = box(-400, -300, -100, 200); // 300 by 500 m, long side north to south
  const gate = box(-110, -70, -95, -30);
  const hall = fp('way/hall', box(-300, -100, -260, -60), 12);
  const shed = fp('way/shed', box(-200, 100, -190, 110));
  const outside = fp('way/outside', box(-80, -60, -60, -40));
  const roadIn = box(-90, -55, 200, -45); // a road that ends at the gate
  const e = [
    entry('fort', 'hero', 'historic=castle', fort, { height_m: 33, front_bearing: 90, extent: { wall_height_back_m: 18, moat_width_m: 20, moat_source: 'test' }, pad: { source: 'osm', ref: 'way/gate', ring: geo(gate), evidence: 'edit t1' } } as Partial<Entry>),
    entry('pavilion', 'marker', 'historic=monument', box(-250, 0, -230, 15)),
    entry('station', 'signature', 'railway=station', box(300, 300, 360, 340), { underground: { why: 'list', shell: 'none' } }),
    entry('held', 'signature', 'railway=station', null, { place: 'held', issue: 'R-LM-01:x' }),
    entry('node', 'marker', 'historic=memorial', null, { lat: 500, lon: 500 }),
    entry('tower', 'signature', 'wikidata', null, { far: true, lat: -9000, lon: 4000, place: 'unplaced', bearing_deg: 156, distance_m: 9850, height_m: 72, type: 'minaret' }),
    entry('near_far', 'signature', 'wikidata', null, { far: true, lat: 0, lon: 1100, place: 'unplaced', bearing_deg: 90, distance_m: 1100, height_m: 40, type: 'temple' }),
  ];
  const res = placeLandmarks(input(e, { footprints: [hall, shed, outside, fp('way/pav', box(-250, 0, -230, 15))], roads: [roadIn], barriers: [{ id: 'way/w1', kind: 'wall', name: '', pts: [{ x: -150, z: -200 }, { x: -150, z: 100 }] }, { id: 'way/f1', kind: 'fence', name: '', pts: [{ x: 700, z: 700 }, { x: 720, z: 700 }] }] }));
  const by = (id: string) => res.placements.find((p) => p.id === id)!;

  it('a site takes the buildings inside it as its parts; a landmark inside it keeps its own footprint', () => {
    expect(modeOf(e[0]!)).toBe('site');
    expect(by('fort').zone!.from).toBe('site');
    expect(by('fort').partIds.sort()).toEqual(['way/hall', 'way/shed']);
    expect(res.taken.get('way/pav')).toMatchObject({ landmark: 'pavilion', how: 'replaced' });
    expect(res.taken.has('way/outside')).toBe(false);
    expect(res.stats).toMatchObject({ replaced: 1, parts: 2 });
  });

  it('a fort has its wall line with the two heights, a footing strip, a moat band on the front half and the pad the edit names', () => {
    const f = by('fort');
    expect(f.walls).toHaveLength(1);
    const w = f.walls[0]!;
    // the east side is the front (33 m), the west side the back (18 m)
    w.pts.forEach((q, i) => expect(w.heights[i]).toBe(q.x > -250 ? 33 : 18));
    expect(f.pad!.from).toBe('edit');
    // the gate's pad is cut back from the road that ends at it
    expect(f.pad!.clipped).toBe(true);
    const kinds = res.ground.filter((g) => g.landmark === 'fort').map((g) => g.cls);
    expect(kinds).toContain('wallbase');
    expect(kinds).toContain('moat');
    expect(kinds).toContain('forecourt');
    // no moat behind the fort
    for (const g of res.ground.filter((x) => x.cls === 'moat')) for (const q of g.ring) expect(q.x).toBeGreaterThan(-251);
    expect(f.surroundings.map((s) => s.kind)).toEqual(expect.arrayContaining(['wall', 'moat', 'forecourt']));
    expect(f.surroundings.find((s) => s.ref === 'way/w1')).toMatchObject({ kind: 'wall', source: 'osm', size: 300 });
    expect(f.surroundings.some((s) => s.ref === 'way/f1')).toBe(false);
    // ground pieces in the order they win: pads, moats, wall strips, forecourts
    const order = res.ground.map((g) => ['pad', 'moat', 'wallbase', 'forecourt'].indexOf(g.cls));
    expect(order).toEqual(order.slice().sort((a, b) => a - b));
  });

  it('an underground station and a node are pins only: no pad, no zone, no massing', () => {
    for (const id of ['station', 'node']) {
      const p = by(id);
      expect(p.mode).toBe('point');
      expect(p.pad).toBeNull();
      expect(p.zone).toBeNull();
      expect(p.body).toEqual([]);
      expect(p.lod.slots[0]!.source).toBe('empty');
    }
    expect(by('station').padWhy).toMatch(/underground.*no shell, no pad/);
    expect(by('station').underground).toBe(true);
    expect(res.ground.some((g) => g.landmark === 'station')).toBe(false);
  });

  it('a held entry is not placed, and says why', () => {
    expect(res.skipped).toEqual([{ id: 'held', tier: 'signature', why: expect.stringContaining('held') }]);
    expect(res.placements.some((p) => p.id === 'held')).toBe(false);
  });

  it('a far landmark stands on its bearing outside every reachable tile, moved outward when it must be', () => {
    const tower = res.far.find((f) => f.id === 'tower')!;
    expect(tower.movedOutM).toBe(0);
    expect(tower.worldBearingDeg).toBeCloseTo(156.04, 1);
    expect(tower).toMatchObject({ reachable: false, nav: false, heightM: 72 });
    const near = res.far.find((f) => f.id === 'near_far')!;
    expect(near.movedOutM).toBeGreaterThan(0);
    expect(near.worldBearingDeg).toBeCloseTo(90, 3);
    expect(near.wx - 600).toBeGreaterThanOrEqual(1000 + FAR_CLEAR_M);
    for (const f of res.far) expect(input(e).reachable(f.wx, f.wz)).toBe(false);
  });

  it('the same input gives the same placement', () => {
    const again = placeLandmarks(input(e, { footprints: [hall, shed, outside, fp('way/pav', box(-250, 0, -230, 15))], roads: [roadIn] }));
    const first = placeLandmarks(input(e, { footprints: [hall, shed, outside, fp('way/pav', box(-250, 0, -230, 15))], roads: [roadIn] }));
    expect(JSON.stringify(again.placements)).toBe(JSON.stringify(first.placements));
    expect(JSON.stringify(again.ground)).toBe(JSON.stringify(first.ground));
  });
});

describe('landmarks that stand on one plinth', () => {
  const fort = box(-400, -300, -100, 200);
  const gate = box(-110, -70, -95, -30);
  const memorial = box(0, 0, 60, 40);
  const flame = box(25, 15, 31, 21);
  const walls = [
    { id: 'way/n', kind: 'wall', name: '', pts: [{ x: -390, z: -290 }, { x: -110, z: -290 }] }, { id: 'way/e', kind: 'wall', name: '', pts: [{ x: -110, z: -290 }, { x: -110, z: 190 }] },
    { id: 'way/far', kind: 'wall', name: '', pts: [{ x: 500, z: 500 }, { x: 600, z: 500 }] },
  ];
  const res = placeLandmarks(input([
    entry('fort', 'hero', 'historic=castle', fort, { height_m: 33, front_bearing: 90, pad: { source: 'osm', ref: 'way/gate', ring: geo(gate), evidence: 'edit t1' } } as Partial<Entry>),
    entry('gate', 'marker', 'historic=city_gate', gate),
    entry('memorial', 'signature', 'historic=memorial', memorial),
    entry('flame', 'marker', 'historic=memorial', flame),
    entry('park', 'marker', 'leisure=park', box(200, 200, 300, 300)),
  ], { barriers: walls }));
  const by = (id: string) => res.placements.find((p) => p.id === id)!;

  it('a hero whose pad is the gate that is a landmark of its own shares the gate\'s pad', () => {
    expect(by('gate').pad!.from).toBe('footprint');
    expect(by('fort').pad).toMatchObject({ from: 'shared', sharedWith: 'gate', level: by('gate').pad!.level, ring: by('gate').pad!.ring });
    expect(by('fort').y).toBe(by('gate').pad!.level);
    expect(res.ground.filter((g) => g.cls === 'pad').map((g) => g.landmark).sort()).toEqual(['gate', 'memorial']);
  });

  it('a landmark inside another one\'s pad stands on it; pads are counted once', () => {
    // the memorial (a signature) is laid first; the flame inside it shares its pad
    expect(by('flame').pad).toMatchObject({ from: 'shared', sharedWith: 'memorial', level: by('memorial').pad!.level });
    expect(by('flame').body.length).toBe(1);
    expect(res.stats.pads).toBe(2);
  });

  it('the walls the map draws inside a fort are its wall when they make up a good part of its outline', () => {
    const f = by('fort');
    expect(f.flags).toContain('walls_from_osm_lines');
    expect(f.walls.map((w) => w.source.split(' ')[1])).toEqual(['way/e', 'way/n']);
    expect(f.walls.every((w) => !w.closed)).toBe(true);
    // the east wall is the front (33 m)
    expect(f.walls[0]!.heights).toEqual([33, 33]);
    expect(f.surroundings.filter((x) => x.kind === 'wall').map((x) => x.ref)).toEqual(['way/e', 'way/n']);
    expect(res.ground.filter((g) => g.cls === 'wallbase' && g.landmark === 'fort').length).toBe(2);
    // a wall that closes on itself leaves its yard open: strips, never one filled ring
    const yard = placeLandmarks(input([entry('keep', 'signature', 'historic=fort', box(0, 0, 100, 100), { height_m: 10 })]));
    const strips = yard.ground.filter((g) => g.cls === 'wallbase');
    expect(strips.length).toBeGreaterThan(1);
    expect(strips.some((g) => pointInRing({ x: 50, z: 50 }, g.ring))).toBe(false);
    expect(strips.reduce((sum, g) => sum + Math.abs(ringArea(g.ring)), 0)).toBeLessThan(400 * 3 * 1.2);
  });

  it('a park is grass whatever its area is', () => {
    expect(by('park').style.forecourt).toBe('lawn');
    expect(res.ground.find((g) => g.landmark === 'park')).toMatchObject({ cls: 'forecourt', material: 'lawn' });
  });
});

describe('pads, forecourts and a moat on a built ground', () => {
  const s = new Sketch();
  s.way([[-200, 0], [0, 0], [200, 0]].map((p) => p as [number, number]), { highway: 'primary', name: 'Main Road' });
  const mid = s.elements.find((x) => x.type === 'node' && x.lon === 0 && x.lat === 0)!.id;
  s.way([[0, -200], mid, [0, 200]], { highway: 'tertiary', name: 'Cross Street' });
  const gr = s.graph(500);
  const b = buildLaneModel({ nodes: gr.nodes, edges: gr.edges, wayLanes: new Map() });
  const ei = elevationInput(b, gr, slope);
  const sol = solveBlockElevation(ei);
  const st = readStructures({ strips: b.strips, joints: b.joints, junctions: ei.junctions, junctionHeights: sol.junctionHeights, tunnels: sol.tunnels, crossings: sol.crossings, pairSamples: sol.pairSamples, water: [], ties: ei.ties ?? [], ground: slope });
  const mi = meshInput(b, sol.junctionHeights, st.kinds);
  const mesh = buildRoadMesh(mi);
  const roads: P2[][] = [];
  for (let f = 0; f < mesh.fs.faces; f++) {
    if (meetOf({ fs: mesh.fs, strips: mi.strips, kinds: mi.kinds }, f) === MEET_NONE) continue;
    const ring: P2[] = [];
    for (let k = 0; k < (mesh.fs.len[f] as number); k++) {
      const v = mesh.fs.ids[(mesh.fs.start[f] as number) + k] as number;
      ring.push({ x: mesh.fs.vx[v] as number, z: mesh.fs.vz[v] as number });
    }
    roads.push(ring);
  }
  // an arch 4 m from Main Road (its pad is cut back), a gate whose footprint the cross street runs under, a small fort with a moat
  const arch = box(40, 12, 58, 39);
  const gate = box(-6, -90, 6, -70);
  const fort = box(-130, -130, -50, -50);
  const house = fp('way/house', box(44, 16, 54, 30));
  const stays = fp('way/stays', box(90, 60, 120, 90));
  const entries = [
    entry('arch', 'hero', 'historic=monument', arch, { height_m: 42, front_bearing: 270 } as Partial<Entry>),
    entry('gate', 'signature', 'historic=city_gate', gate, { height_m: 15 }),
    entry('fort', 'signature', 'historic=fort', fort, { height_m: 12, front_bearing: 90, extent: { moat_width_m: 18, moat_gap_m: 4, moat_depth_m: 3, moat_source: 'test' } } as Partial<Entry>),
  ];
  const placed = placeLandmarks(input(entries, { outline: box(-150, -150, 150, 150), footprints: [house, stays, fp('way/inside', box(-100, -100, -80, -80), 9)], roads }));
  const kept = [house, stays].filter((f) => !placed.taken.has(f.id));
  const tin: TerrainInput = { fs: mesh.fs, edges: mesh.edges, grid: mesh.grid, strips: mi.strips, kinds: mi.kinds, outline: box(-150, -150, 150, 150), footprints: kept.map((f) => f.ring), water: [], open: [[box(30, 45, 80, 100)]], ground: slope, offset: { x: 13.3, z: -7.7 }, landmarks: placed.ground };
  const g = buildGround(tin);
  const c = checkGround(g);
  const pads = checkPads(g);

  it('every pad is flat within 0.05 m and meets the ground around it with no gap over 0.02 m', () => {
    expect(pads.map((p) => p.landmark).sort()).toEqual(['arch', 'gate']);
    for (const p of pads) {
      expect(p.triangles).toBeGreaterThan(0);
      expect(p.offLevelM).toBeLessThanOrEqual(PAD_FLAT_M);
      expect(p.offLevelM).toBe(0);
      expect(p.gapM).toBeLessThanOrEqual(PAD_GAP_M);
      expect(p.covered).toBeGreaterThan(0.97);
    }
    expect(g.surface.stats.landmark.padPinnedByRoad).toBe(0);
    expect(g.surface.stats.landmark.padVertices).toBeGreaterThan(10);
  });

  it('a pad keeps off the road: the arch pad is cut back, the gate under which the street runs keeps one side', () => {
    const a = placed.placements.find((p) => p.id === 'arch')!;
    expect(a.pad!.clipped).toBe(true);
    const gt = placed.placements.find((p) => p.id === 'gate')!;
    expect(gt.roadUnderFootprintM2).toBeGreaterThan(20);
    expect(gt.flags).toContain('road_under_footprint');
    expect(gt.pad!.areaM2).toBeLessThan(12 * 20);
    // the massing stands on the pad, never on the road
    for (const ring of gt.body) for (const q of ring) expect(roads.some((r) => pointInRing(q, r))).toBe(false);
  });

  it('the ground around is still whole: it shares the road edge, has no hole, and is the same twice', () => {
    expect(c.gap.maxM).toBeLessThan(0.002);
    expect(c.above.insideRoadFace + c.above.aboveRoad).toBe(0);
    expect(c.classes.holes).toBe(0);
    expect(c.area.holeShare).toBeLessThan(0.001);
    expect(c.seams.mismatched).toBe(0);
    expect(g.tg.stats.segments.failed).toBe(0);
    expect(groundHash(buildGround(tin))).toBe(groundHash(g));
  });

  it('the landmark ground is drawn with its own materials, and the moat has a bed under its banks', () => {
    const materials = new Set(g.tiles.flatMap((t) => t.meshes.map((m) => m.material)));
    for (const m of ['pad', 'forecourt', 'wallbase', 'moat']) expect(materials.has(m)).toBe(true);
    const st2 = g.surface.stats.landmark;
    expect(st2.moat).toBeGreaterThan(4);
    expect(st2.moatBed).toBeGreaterThan(0);
    expect(st2.forecourt).toBeGreaterThan(10);
    // a lawn of the map stays a lawn inside a zone: the forecourt only covers plain ground
    expect(materials.has('lawn')).toBe(true);
  });

  it('the stand-in massing stands on the pads and the solved ground, closed and facing outward', () => {
    const heights = new GroundHeights(g);
    const taken = new Map([house, stays, fp('way/inside', box(-100, -100, -80, -80), 9)].filter((f) => placed.taken.has(f.id)).map((f) => [f.id, f]));
    const m = buildMassing(placed.placements, taken, (x, z) => heights.at(x, z), slope);
    const a = placed.placements.find((p) => p.id === 'arch')!;
    const rec = m.records.find((r) => r.id === 'arch')!;
    expect(rec.heightM).toBeCloseTo(42, 1);
    expect(rec.baseM).toBeCloseTo(a.pad!.level - 0.3, 2);
    const f = m.records.find((r) => r.id === 'fort')!;
    expect(f.parts).toBe(1);
    expect(f.wallM).toBeGreaterThan(250);
    // every triangle is wound Godot's way: (b - a) x (c - a) points against its normal
    const mesh0 = m.meshes[0]!;
    expect(mesh0.material).toBe('landmark');
    let wrong = 0;
    let volume = 0;
    for (let t = 0; t < mesh0.idx.length; t += 3) {
      const [pa, pb, pc] = [0, 1, 2].map((i) => [mesh0.pos[(t + i) * 3]!, mesh0.pos[(t + i) * 3 + 1]!, mesh0.pos[(t + i) * 3 + 2]!]) as [number[], number[], number[]];
      const u = [pb[0]! - pa[0]!, pb[1]! - pa[1]!, pb[2]! - pa[2]!];
      const v = [pc[0]! - pa[0]!, pc[1]! - pa[1]!, pc[2]! - pa[2]!];
      const cr = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      if (cr[0]! * mesh0.nrm[t * 3]! + cr[1]! * mesh0.nrm[t * 3 + 1]! + cr[2]! * mesh0.nrm[t * 3 + 2]! > 1e-9) wrong++;
      volume += (pa[0]! * (pb[1]! * pc[2]! - pb[2]! * pc[1]!) - pa[1]! * (pb[0]! * pc[2]! - pb[2]! * pc[0]!) + pa[2]! * (pb[0]! * pc[1]! - pb[1]! * pc[0]!)) / 6;
    }
    expect(wrong).toBe(0);
    // Godot's winding: a closed outward solid has a negative signed volume (the prisms have no floor, so only the sign is read)
    expect(volume).toBeLessThan(0);
    // no edge over 60 m
    for (let t = 0; t < mesh0.idx.length; t += 3) for (let i = 0; i < 3; i++) {
      const p = (t + i) * 3;
      const q = (t + ((i + 1) % 3)) * 3;
      expect(Math.hypot(mesh0.pos[p]! - mesh0.pos[q]!, mesh0.pos[p + 1]! - mesh0.pos[q + 1]!, mesh0.pos[p + 2]! - mesh0.pos[q + 2]!)).toBeLessThanOrEqual(60.001);
    }
    // pins on the pad, the landmark file with its limits
    const pins = landmarkPins(placed.placements, (p) => (p.pad ? p.pad.level : p.y));
    expect(pins.find((p) => p.id === 'lm:arch')).toMatchObject({ kind: 'landmark', x: a.wx, z: a.wz, y: a.pad!.level, extra: { tier: 'hero', mode: 'structure', yaw: a.yawDeg, height: 42 } });
    const sil = heroSilhouette(a, taken, a.pad!.level, 2000);
    expect(sil.triangles).toBeLessThanOrEqual(2000);
    expect(sil.heightM).toBeCloseTo(42, 1);
    const file = landmarkFile('test', 'centre', placed, 3, (p) => p.y, 210, m.records, [sil]);
    expect(file.limits).toEqual({ heroesAtFullDetailInView: 2, farSilhouetteTriangles: 2000, heroLods: 3 });
    expect(file.landmarks.find((l) => l.id === 'arch')).toMatchObject({ tier: 'hero', silhouette: 0, massing: { triangles: rec.triangles } });
  });
});

describe('massing shapes and silhouettes', () => {
  it('a tall structure is one block, a broad one a body with a crown that reaches the height', () => {
    expect(tiersOf(box(0, 0, 18, 27), 42)).toEqual({ bodyH: 42, crown: null });
    const broad = tiersOf(box(0, 0, 120, 110), 41);
    expect(broad.bodyH).toBeCloseTo(16.4, 1);
    expect(broad.crown).toHaveLength(4);
    for (const q of broad.crown!) expect(pointInRing(q, box(0, 0, 120, 110))).toBe(true);
  });

  it('a gate or an arch is two piers and a lintel over its passage, as high as the registry says', () => {
    const shapes = structureShapes(box(0, 0, 18, 27), 42, 'gate');
    expect(shapes).toHaveLength(3);
    // the long side runs north to south: the piers are its two ends, the passage the middle third
    expect(shapes[0]!.to).toBeCloseTo(26, 0);
    expect(shapes[2]).toMatchObject({ from: shapes[0]!.to, to: 42 });
    const zs = shapes.slice(0, 2).map((x) => x.ring.map((q) => q.z)).map((v) => [Math.min(...v), Math.max(...v)]).sort((a, b) => a[0]! - b[0]!);
    expect(zs[0]![1]).toBeCloseTo(13.5 - 13.5 * 0.34, 3);
    expect(zs[1]![0]).toBeCloseTo(13.5 + 13.5 * 0.34, 3);
    expect(structureShapes(box(0, 0, 18, 27), 42, 'block')).toEqual([{ ring: box(0, 0, 18, 27), from: 0, to: 42 }]);
    expect(structureShapes(box(0, 0, 120, 110), 41, 'block')).toHaveLength(2);
  });

  it('a ring is simplified within its tolerance and a far silhouette stays under the budget', () => {
    const circle = Array.from({ length: 200 }, (_, k) => ({ x: 100 * Math.cos((2 * Math.PI * k) / 200), z: 100 * Math.sin((2 * Math.PI * k) / 200) }));
    const s = simplifyRing(circle, 1);
    expect(s.length).toBeLessThan(40);
    expect(s.length).toBeGreaterThan(8);
    expect(Math.abs(ringArea(s))).toBeGreaterThan(Math.PI * 100 * 100 * 0.97);
    for (const type of ['minaret', 'temple', 'garden tomb', 'presidential palace', 'house of worship', 'office']) {
      const f = farSilhouette({ id: 'x', name: 'x', tier: 'signature', lat: 0, lon: 0, wx: 10, wz: 20, bearingDeg: 0, distanceM: 0, worldBearingDeg: 0, worldDistanceM: 0, blockPlanned: 'centre', factor: 1, movedOutM: 0, heightM: 50, type, reachable: false, nav: false }, 200);
      expect(f.triangles).toBeGreaterThan(8);
      expect(f.triangles).toBeLessThanOrEqual(2000);
      let top = 0;
      for (let i = 1; i < f.pos.length; i += 3) top = Math.max(top, f.pos[i]!);
      expect(top).toBeCloseTo(50, 1);
      expect(f.origin).toEqual([10, 200, 20]);
    }
  });
});
