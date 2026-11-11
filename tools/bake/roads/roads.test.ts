import { describe, expect, it } from 'vitest';
import raw from '../../../harness/data/hero_roads/cp_inner_circle.json?raw';
import type { Road } from '../osm';
import { Sketch } from '../testmap';
import { decodeT1, encodeT1 } from '../tile';
import { checkContinuity, checkOverlap } from './checks';
import { Curve, area2, smoothLine } from './curve';
import { solveSPD } from './elevation';
import { limitDivergence } from './fit';
import { buildGraph } from './graph';
import type { SiteSpec } from './graph';
import { checkHero, heroCrossSection, specRefProblems } from './hero';
import type { HeroSpec } from './hero';
import { matchRows, pairCarriageways, rowBorders } from './lanes';
import { csBorders, defaultCrossSection, flipCS } from './model';
import { buildSite } from './site';
import type { SiteResult } from './site';
import { triangulatePolygon } from './tri';
import { overlapArea } from './trigrid';

const spec = JSON.parse(raw) as HeroSpec;
const BOX: SiteSpec = { id: 't', name: 'test', region: { kind: 'box', minX: -500, minZ: -500, maxX: 500, maxZ: 500 }, classes: ['trunk', 'primary', 'secondary', 'tertiary'] };
const flat = (): number => 200;

function site(roads: readonly Road[], ground: (x: number, z: number) => number = flat, heroes: HeroSpec[] = [], region = BOX): SiteResult {
  return buildSite({ site: region, roads, ground, heroes });
}

/** A trunk road going east that splits into the main line and a slip road to the left (north). */
function diverge(): Sketch {
  const s = new Sketch();
  const x = s.node(0, 0);
  s.way([[-300, 0], x], { highway: 'trunk', oneway: 'yes' });
  s.way([x, [80, 0], [300, 0]], { highway: 'trunk', oneway: 'yes' });
  s.way([x, [60, 9], [120, 22], [300, 60]], { highway: 'trunk_link', oneway: 'yes' });
  return s;
}

describe('cross-sections and lane rows', () => {
  it('left-hand traffic: on a two-way road the lanes left of the centre run with the way', () => {
    const cs = defaultCrossSection({ cls: 'secondary', link: false, oneway: false, lanes: 4, width: null });
    const drive = cs.lanes.filter((l) => l.type === 'drive');
    expect(drive.map((l) => l.dir)).toEqual([1, 1, -1, -1]);
    const b = csBorders(cs);
    // the drive lanes are centred on the reference line
    const first = cs.lanes.findIndex((l) => l.type === 'drive');
    expect(b[first]! + b[first + 4]!).toBeCloseTo(0, 9);
    const back = flipCS(cs);
    expect(back.lanes.filter((l) => l.type === 'drive').map((l) => l.dir)).toEqual([1, 1, -1, -1]);
    expect(flipCS(back)).toEqual(cs);
  });
  it('class defaults give a link one wide lane and a trunk carriageway three', () => {
    expect(defaultCrossSection({ cls: 'trunk', link: true, oneway: true, lanes: null, width: null }).lanes.filter((l) => l.type === 'drive')).toHaveLength(1);
    expect(defaultCrossSection({ cls: 'trunk', link: false, oneway: true, lanes: null, width: null }).lanes.filter((l) => l.type === 'drive')).toHaveLength(3);
    expect(defaultCrossSection({ cls: 'tertiary', link: false, oneway: true, lanes: 3, width: 9 }).lanes.filter((l) => l.type === 'drive').map((l) => l.width)).toEqual([3, 3, 3]);
  });
  it('a lane gained on a one-way road opens on the kerb side (the left), the fast lane stays', () => {
    const a = defaultCrossSection({ cls: 'trunk', link: false, oneway: true, lanes: 2, width: null });
    const b = defaultCrossSection({ cls: 'trunk', link: false, oneway: true, lanes: 3, width: null });
    const rows = matchRows(a, b);
    expect(rows).toEqual([{ a: 0, b: 0 }, { a: null, b: 1 }, { a: 1, b: 2 }, { a: 2, b: 3 }, { a: 3, b: 4 }]);
    const bd = rowBorders(rows, a, b);
    // the new lane has no width where it starts and 3.5 m where it ends
    expect(bd.a[1]! - bd.a[2]!).toBe(0);
    expect(bd.b[1]! - bd.b[2]!).toBeCloseTo(3.5, 9);
  });
});

describe('helpers', () => {
  it('solves a small positive definite system', () => {
    const a = new Float64Array([4, 1, 0, 1, 3, 1, 0, 1, 2]);
    const x = solveSPD(a, new Float64Array([1, 2, 3]), 3);
    expect(4 * x[0]! + x[1]!).toBeCloseTo(1, 9);
    expect(x[0]! + 3 * x[1]! + x[2]!).toBeCloseTo(2, 9);
    expect(x[1]! + 2 * x[2]!).toBeCloseTo(3, 9);
  });
  it('triangulates a polygon with a hole and keeps a vertex in the middle of a straight edge', () => {
    const outer = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 20, z: 0 }, { x: 20, z: 20 }, { x: 0, z: 20 }];
    const hole = [{ x: 5, z: 5 }, { x: 15, z: 5 }, { x: 15, z: 15 }, { x: 5, z: 15 }];
    const t = triangulatePolygon(outer, [hole]);
    let area = 0;
    const used = new Set<number>();
    for (let k = 0; k < t.idx.length; k += 3) {
      const [p, q, r] = [t.pts[t.idx[k]!]!, t.pts[t.idx[k + 1]!]!, t.pts[t.idx[k + 2]!]!];
      area += Math.abs(area2([p, q, r]));
      // no triangle covers the middle of the hole
      const cx = (p.x + q.x + r.x) / 3;
      const cz = (p.z + q.z + r.z) / 3;
      expect(cx > 5.01 && cx < 14.99 && cz > 5.01 && cz < 14.99 && Math.abs(cx - 10) < 3 && Math.abs(cz - 10) < 3).toBe(false);
      for (const d of [0, 1, 2]) used.add(t.idx[k + d]!);
    }
    expect(area).toBeCloseTo(400 - 100, 6);
    expect(t.forced).toBe(0);
    expect(used.size).toBe(9);
  });
  it('measures the area two triangles share', () => {
    const a: [number, number, number][] = [[0, 0, 0], [4, 0, 0], [0, 0, 4]];
    expect(overlapArea(a, [[1, 0, 1], [5, 0, 1], [1, 0, 5]])).toBeCloseTo(2, 9);
    expect(overlapArea(a, [[4, 0, 0], [8, 0, 0], [4, 0, 4]])).toBeCloseTo(0, 9);
  });
  it('a smoothed line keeps its ends and takes a given end direction', () => {
    const c = smoothLine([{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 100, z: 20 }], 1, { x: 0, z: 1 });
    expect(c.pts[0]).toEqual({ x: 0, z: 0 });
    expect(c.pts[c.pts.length - 1]).toEqual({ x: 100, z: 20 });
    const t = c.smoothAt(0.5, 0.5);
    expect(t.tz).toBeGreaterThan(0.7);
  });
  it('a smoothed line bows out from its points by no more than maxDev (a service loop with right angle corners)', () => {
    const square = [{ x: 0, z: 0 }, { x: 60, z: 0 }, { x: 60, z: 40 }, { x: 0, z: 40 }, { x: 0, z: 0 }];
    const off = (c: ReturnType<typeof smoothLine>): number => Math.max(...c.pts.map((p) => {
      let d = Infinity;
      for (let i = 0; i + 1 < square.length; i++) {
        const a = square[i]!;
        const b = square[i + 1]!;
        const l2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2;
        const u = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / l2));
        d = Math.min(d, Math.hypot(p.x - a.x - u * (b.x - a.x), p.z - a.z - u * (b.z - a.z)));
      }
      return d;
    }));
    expect(off(smoothLine(square, 1))).toBeGreaterThan(4);
    expect(off(smoothLine(square, 1, undefined, undefined, 0.5))).toBeLessThan(0.51);
  });
});

describe('graph', () => {
  it('cuts ways at shared nodes, joins chains and clips at the site edge', () => {
    const s = new Sketch();
    const a = s.node(0, 0);
    const b = s.node(100, 0);
    s.way([[-100, 0], a], { highway: 'primary', oneway: 'yes' });
    s.way([a, b], { highway: 'primary', oneway: 'yes', lanes: '2' });
    s.way([b, [900, 0]], { highway: 'primary', oneway: 'yes' });
    s.way([b, [100, 200]], { highway: 'tertiary' });
    const g = buildGraph(s.map().roads, BOX);
    // the three primary ways: one edge up to the junction at b, one from b to the site edge
    expect(g.edges.filter((e) => e.cls === 'primary').map((e) => Math.round(e.len)).sort((p, q) => p - q)).toEqual([200, 400]);
    const first = g.edges.find((e) => e.cls === 'primary' && Math.round(e.len) === 200)!;
    expect(first.pieces.map((p) => p.lanes)).toEqual([null, 2]);
    expect([...g.nodes.values()].filter((n) => n.clipped)).toHaveLength(1);
    expect(g.nodes.get(b)!.ends).toHaveLength(3);
  });
  it('pairs the two carriageways of a street, each on the right of the other', () => {
    const s = new Sketch();
    s.way([[-200, 6], [200, 6]], { highway: 'trunk', oneway: 'yes' });
    s.way([[200, -6], [-200, -6]], { highway: 'trunk', oneway: 'yes' });
    // drawn as if traffic kept right: not a pair here
    const wrong = new Sketch();
    wrong.way([[-200, -6], [200, -6]], { highway: 'trunk', oneway: 'yes' });
    wrong.way([[200, 6], [-200, 6]], { highway: 'trunk', oneway: 'yes' });
    expect(pairCarriageways(buildGraph(s.map().roads, BOX))).toHaveLength(1);
    expect(pairCarriageways(buildGraph(wrong.map().roads, BOX))).toHaveLength(0);
  });
});

describe('split zones (LN1)', () => {
  const r = site(diverge().map().roads);
  const zone = r.zones[0]!;
  it('builds one zone with a taper before it, a painted nose and a physical nose', () => {
    expect(r.zones).toHaveLength(1);
    expect(zone.kind).toBe('diverge');
    expect(zone.dPainted).toBeGreaterThan(5);
    expect(zone.dNose).toBeGreaterThan(zone.dPainted);
    expect(r.strips.filter((s) => s.kind === 'taper')).toHaveLength(1);
    // three lanes arrive; the zone carries the slip road's lane and the main line's three side by side
    expect(zone.strip.lanes.filter((l) => l.type === 'drive')).toHaveLength(4);
    expect(zone.strip.lanes.filter((l) => l.type === 'gore')).toHaveLength(3);
  });
  it('the gore is closed at the node and exactly as wide as the nose gap at the nose', () => {
    const g = zone.strip.lanes.map((l, k) => ({ l, k })).filter((x) => x.l.type === 'gore').map((x) => x.k);
    const width = (i: number): number => zone.strip.st[i]!.b[g[0]!]! - zone.strip.st[i]!.b[g[2]! + 1]!;
    expect(width(0)).toBe(0);
    expect(width(zone.strip.st.length - 1)).toBeCloseTo(1, 6);
    for (let i = 1; i < zone.strip.st.length; i++) expect(width(i)).toBeGreaterThanOrEqual(width(i - 1) - 1e-9);
  });
  it('no road face overlaps another, every lane continues, the taper is long enough', () => {
    expect(r.checks.overlap.areaM2).toBe(0);
    expect(r.checks.continuity.breaks).toBe(0);
    expect(r.checks.continuity.splitJoints).toBe(3);
    expect(r.checks.tapers.violations).toBe(0);
    expect(r.checks.heights.steps).toBe(0);
    expect(r.checks.mesh.openBoundaryEdges).toBe(0);
  });
  it('the main line keeps its lanes on its own centre line through the zone', () => {
    // the main line is the right group: its lanes straddle z = 0 at every station of the zone (within the few
    // centimetres by which the gore opens early, so the nose has no kink), and exactly at the nose
    const first = zone.strip.lanes.length - 4;
    for (const st of zone.strip.st) {
      const mid = (st.b[first]! + st.b[first + 3]!) / 2;
      expect(Math.abs(st.z + st.nz * mid)).toBeLessThan(0.15);
    }
    const last = zone.strip.st[zone.strip.st.length - 1]!;
    expect(Math.abs(last.z + last.nz * ((last.b[first]! + last.b[first + 3]!) / 2))).toBeLessThan(1e-6);
  });
  it('a merge is the same construction walked the other way', () => {
    const s = new Sketch();
    const x = s.node(0, 0);
    s.way([x, [300, 0]], { highway: 'trunk', oneway: 'yes' });
    s.way([[-300, 0], [-80, 0], x], { highway: 'trunk', oneway: 'yes' });
    s.way([[-300, 60], [-120, 22], [-60, 9], x], { highway: 'trunk_link', oneway: 'yes' });
    const m = site(s.map().roads);
    expect(m.zones.map((z) => z.kind)).toEqual(['merge']);
    expect(m.checks.overlap.areaM2).toBe(0);
    expect(m.checks.continuity.breaks).toBe(0);
    expect(m.checks.mesh.openBoundaryEdges).toBe(0);
  });
  it('a slip road drawn as a short diagonal is redrawn to leave gently', () => {
    const s = new Sketch();
    const x = s.node(0, 0);
    s.way([[-300, 0], x], { highway: 'trunk', oneway: 'yes' });
    s.way([x, [300, 0]], { highway: 'trunk', oneway: 'yes' });
    s.way([x, [14, 12], [300, 14]], { highway: 'trunk_link', oneway: 'yes' });
    const g = buildGraph(s.map().roads, BOX);
    const link = g.edges.find((e) => e.link)!;
    const main = g.edges.find((e) => !e.link && e.a === x)!;
    const moved = limitDivergence(link, true, main, true, 6);
    expect(moved).toBeGreaterThan(3);
    // nowhere further from the main line than a sixth of the distance along it (with room for the smoothing)
    for (const p of link.curve.pts) if (p.x > 5 && p.x < 60) expect(p.z).toBeGreaterThan(-(p.x / 6) - 1.5);
    const built = site(s.map().roads);
    expect(built.fit.slipRoadsRedrawn).toBe(1);
    expect(built.checks.overlap.areaM2).toBe(0);
    expect(built.checks.continuity.breaks).toBe(0);
  });
});

describe('carriageways drawn too close (reference line fit)', () => {
  it('shifts the two carriageways of a street apart until their lanes fit', () => {
    const s = new Sketch();
    s.way([[-250, 3], [250, 3]], { highway: 'trunk', oneway: 'yes' });
    s.way([[250, -3], [-250, -3]], { highway: 'trunk', oneway: 'yes' });
    const r = site(s.map().roads);
    expect(r.pairs).toHaveLength(1);
    expect(r.fit.edgesMoved).toBe(2);
    expect(r.fit.maxShiftM).toBeGreaterThan(2);
    expect(r.checks.overlap.areaM2).toBe(0);
  });
});

describe('elevation and structures (EL1)', () => {
  // a flyover (bridge tag, layer 1) over a cross street, with a service lane beside it that stays on the ground
  const s = new Sketch();
  const a = s.node(-150, 0);
  const b = s.node(150, 0);
  s.way([[-400, 0], a], { highway: 'trunk', oneway: 'yes' });
  s.way([a, b], { highway: 'trunk', oneway: 'yes', bridge: 'yes', layer: '1' });
  s.way([b, [400, 0]], { highway: 'trunk', oneway: 'yes' });
  s.way([[0, -300], [0, 300]], { highway: 'secondary' });
  const ground = (x: number, z: number): number => 200 + 0.002 * x + 0.001 * z;
  const r = site(s.map().roads, ground);
  it('the deck clears the road under it and the grades hold', () => {
    expect(r.solve.crossings).toBe(1);
    expect(r.checks.overlap.gradeSeparated).toBe(1);
    expect(r.checks.overlap.clearanceViolations).toBe(0);
    expect(r.checks.overlap.minClearanceM!).toBeGreaterThanOrEqual(5.5);
    expect(r.checks.heights.gradeViolations).toBe(0);
    expect(r.checks.heights.maxGradePct).toBeLessThanOrEqual(5.3);
    expect(r.checks.overlap.areaM2).toBe(0);
  });
  it('the solver places the abutments: both structure ends come down to the ground, the cross street stays on it', () => {
    expect(r.abutments).toHaveLength(2);
    for (const ab of r.abutments) expect(ab.heightAboveGround).toBeLessThan(1);
    expect(r.checks.heights.abutmentsOffGround).toBe(0);
    expect(r.checks.heights.structureStations).toBeGreaterThan(20);
    const cross = r.strips.filter((st) => st.cls === 'secondary');
    for (const st of cross) for (const p of st.st) expect(Math.abs(p.h - p.g)).toBeLessThan(0.3);
    expect(r.checks.heights.floating + r.checks.heights.sunk).toBe(0);
  });
  it('the ground meets every road edge exactly (TF2) and a 2 m grid does not (TF1)', () => {
    expect(r.checks.groundGap.tf2.maxM).toBe(0);
    expect(r.checks.groundGap.tf2.missing).toBe(0);
    expect(r.checks.mesh.groundAreaErrorM2).toBeLessThan(0.01);
    expect(r.checks.groundGap.tf1.maxM).toBeGreaterThan(0.03);
    expect(r.stats.tf2Triangles).toBeLessThan(r.stats.tf1Triangles / 20);
  });
  it('kerbs and parapets are in the collider where they are drawn, and the tile survives the T1 round trip', () => {
    expect(r.checks.colliders.edgeVertices).toBeGreaterThan(100);
    expect(r.checks.colliders.missing).toBe(0);
    const back = decodeT1(encodeT1(r.tile));
    expect(back.header.meshes.map((m) => m.material)).toContain('wall');
    expect(back.header.colliders.every((c) => c.triangles <= 1300)).toBe(true);
  });
});

describe('junctions (J1, J3)', () => {
  const s = new Sketch();
  const x = s.node(0, 0);
  s.way([[-150, 0], x, [150, 0]], { highway: 'secondary' });
  s.way([[0, 130], x, [0, -120]], { highway: 'tertiary' });
  const r = site(s.map().roads);
  it('one surface from lane edges with corner radii and raised corners', () => {
    expect(r.junctions).toHaveLength(1);
    const j = r.junctions[0]!;
    expect(j.method).toBe('J1');
    expect(j.corners.map((c) => c.kind)).toEqual(['fillet', 'fillet', 'fillet', 'fillet']);
    for (const c of j.corners) expect(c.radius).toBeCloseTo(7.5, 6);
    expect(j.bands).toHaveLength(4);
    expect(j.arms).toHaveLength(4);
    // every arm is cut back behind its corner arcs
    for (const arm of j.arms) expect(arm.cut).toBeGreaterThan(7.5);
  });
  it('no overlap, a watertight mesh, connecting lanes for every lane', () => {
    expect(r.checks.overlap.areaM2).toBe(0);
    expect(r.checks.mesh.openBoundaryEdges).toBe(0);
    expect(r.checks.continuity.breaks).toBe(0);
    expect(r.junctions[0]!.connections.length).toBeGreaterThanOrEqual(12);
    expect(r.checks.groundGap.tf2.maxM).toBe(0);
  });
  it('the checks do find what is wrong: a crossing with no node overlaps, a moved border breaks a lane', () => {
    const bad = new Sketch();
    bad.way([[-150, 0], [150, 0]], { highway: 'secondary' });
    bad.way([[0, 130], [0, -120]], { highway: 'tertiary' });
    const o = site(bad.map().roads);
    expect(o.checks.overlap.areaM2).toBeGreaterThan(50);
    expect(o.checks.overlap.pairs).toBe(1);
    const d = site(diverge().map().roads);
    const taper = d.strips.find((st) => st.kind === 'taper')!;
    taper.st[taper.st.length - 1]!.b = taper.st[taper.st.length - 1]!.b.map((v) => v + 0.2);
    const again = checkContinuity(d.strips, d.joints, d.junctions, new Set());
    expect(again.breaks).toBeGreaterThan(0);
    expect(checkOverlap([], () => '').areaM2).toBe(0);
  });
});

describe('hero road spec (HR1)', () => {
  it('every field of the CP inner circle spec has a reference with a link and a licence', () => {
    const refs = specRefProblems(spec);
    expect(refs.problems).toEqual([]);
    expect(refs.fields).toBeGreaterThanOrEqual(15);
    for (const ref of Object.values(spec.refs)) {
      expect(ref.url).toMatch(/^https:\/\//);
      expect(ref.licence.length).toBeGreaterThan(2);
    }
  });
  it('the spec overrides the lanes tag and the baked cross-section equals the spec', () => {
    // a ring like the inner circle: one closed one-way way with the spec's OSM id, lanes=3 in the tags
    const s = new Sketch();
    const ids: number[] = [];
    for (let i = 0; i < 36; i++) ids.push(s.node(Math.cos((-i / 36) * 2 * Math.PI) * 125, Math.sin((-i / 36) * 2 * Math.PI) * 125));
    s.elements.push({ type: 'way', id: spec.covers.osmWays[0]!, nodes: [...ids, ids[0]!], tags: { highway: 'tertiary', oneway: 'yes', junction: 'roundabout', lanes: '3' } });
    s.way([ids[9]!, [0, -260]], { highway: 'tertiary', oneway: 'yes' });
    const r = site(s.map().roads, flat, [spec]);
    const check = r.checks.hero[0]!;
    expect(check.mismatches).toBe(0);
    expect(check.strips).toBeGreaterThan(0);
    expect(check.baked.map((l) => l.type)).toEqual(heroCrossSection(spec).lanes.map((l) => l.type));
    expect(check.baked.filter((l) => l.type === 'drive')).toHaveLength(4);
    expect(check.baked.map((l) => l.width)).toEqual(heroCrossSection(spec).lanes.map((l) => l.width));
    expect(r.junctions[0]!.method).toBe('J1');
    expect(r.checks.overlap.areaM2).toBe(0);
    // the check does find a difference: a strip with one lane narrowed
    const hero = r.strips.find((st) => st.hero === spec.id)!;
    for (const st of hero.st) st.b[st.b.length - 1] = st.b[st.b.length - 1]! + 0.5;
    expect(checkHero(spec, r.strips).mismatches).toBeGreaterThan(0);
  });
});

describe('curves', () => {
  it('projects a point onto a curve with and without a hint', () => {
    const c = new Curve([{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 100 }]);
    const p = c.project({ x: 40, z: 7 });
    expect(p.s).toBeCloseTo(40, 9);
    expect(p.d).toBeCloseTo(7, 9);
    expect(c.project({ x: 104, z: 50 }, 0, 2).s).toBeCloseTo(150, 9);
    expect(c.reversed().at(10).z).toBeCloseTo(90, 9);
  });
});
