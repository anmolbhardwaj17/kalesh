// The road mesh builder (P1-014) on small synthetic maps and on its parts: welded faces, the T joint repair and the
// boundary loops, the polygon set (minus with holes, whiskers), the triangulator that keeps every vertex, folds,
// border codes; then whole maps: a crossroads with footpaths (junction built as planned: no overlap, watertight,
// kerbs at 0.15 m, lane UV, stop lines, no parapet), a flyover (parapets only on the structure, piers clear of
// the road below), a one-way split (the joint rows share their vertices), a junction with no usable plan (the
// polygon set builds it from the lane paths), and the same mesh twice. The pilot centre is in pilot_mesh.test.mjs.
import { describe, expect, it } from 'vitest';
import { elevationInput } from '../elevation/input';
import { solveBlockElevation } from '../elevation/solve';
import { readStructures } from '../elevation/structures';
import { KERB_RAISE } from '../roads/model';
import type { Station, Strip } from '../roads/model';
import { buildLaneModel } from '../roads/network';
import { Sketch } from '../testmap';
import { buildRoadMesh } from './build';
import type { RoadMesh } from './build';
import { checkRoadMesh } from './checks';
import type { MeshChecks } from './checks';
import { minus, ringAreaM2, sharedArea, trimWhiskers, unionArea } from './clip';
import { boundaryLoops, buildEdges, conform, edgeKey } from './conform';
import { CUT_EDGE, FaceSet } from './faces';
import { meshInput } from './input';
import type { MeshInput } from './input';
import { meshHash, siteTile } from './meshout';
import { triangulateRing } from './solids';
import { K_DECK, K_GRADE, MARK_CENTRE, MARK_DASHED, MARK_EDGE, MARK_NONE, borderMarks, unfold } from './stripfaces';

const flat = (): number => 200;
interface Built { input: MeshInput; mesh: RoadMesh; checks: MeshChecks }

/** Lane model, heights, structures, mesh and checks of a sketch. `change` may edit the mesh input (drop a plan, say). */
const build = (s: Sketch, h = 500, change: (i: MeshInput) => void = () => {}): Built => {
  const g = s.graph(h);
  const b = buildLaneModel({ nodes: g.nodes, edges: g.edges, wayLanes: new Map() });
  const ei = elevationInput(b, g, flat);
  const res = solveBlockElevation(ei);
  const st = readStructures({ strips: b.strips, joints: b.joints, junctions: ei.junctions, junctionHeights: res.junctionHeights, tunnels: res.tunnels, crossings: res.crossings, pairSamples: res.pairSamples, water: [], ties: ei.ties ?? [], ground: flat });
  const input = meshInput(b, res.junctionHeights, st.kinds);
  change(input);
  const mesh = buildRoadMesh(input);
  return { input, mesh, checks: checkRoadMesh(input, mesh) };
};
const meta = { piece: 0, kind: 'drive' as const, cut: CUT_EDGE, raise: 0, sheet: 0 };
const sq = (x0: number, z0: number, x1: number, z1: number, y = 0): { x: number; z: number; y: number }[] => [{ x: x0, z: z0, y }, { x: x1, z: z0, y }, { x: x1, z: z1, y }, { x: x0, z: z1, y }];

describe('faces', () => {
  it('two points under a millimetre apart are one vertex; a face keeps one turning sense', () => {
    const fs = new FaceSet();
    const a = fs.add(sq(0, 0, 4, 3), meta);
    const b = fs.add(sq(4.0004, 0, 8, 3).reverse(), meta);
    expect(a).toBe(0);
    expect(b).toBe(1);
    expect(fs.vx).toHaveLength(6);
    expect(fs.area(0)).toBeCloseTo(12, 9);
    expect(fs.area(1)).toBeGreaterThan(0);
    // the shared edge is named by both faces, in opposite directions
    const e = buildEdges(fs);
    const p = fs.find(4, 0);
    const q = fs.find(4, 3);
    expect(e.at.has(edgeKey(p, q)) && e.at.has(edgeKey(q, p))).toBe(true);
    expect(e.doubled).toBe(0);
    // corners that weld to the one before are dropped; a face without three corners is not added
    expect(fs.add([{ x: 0, z: 0, y: 0 }, { x: 0.0002, z: 0, y: 0 }, { x: 1, z: 0, y: 0 }], meta)).toBe(-1);
    // a face that must already turn the stored way and does not is refused
    expect(fs.add(sq(20, 0, 24, 3), meta, true)).toBeGreaterThan(0);
    expect(fs.add(sq(30, 0, 34, 3).reverse(), meta, true)).toBe(-2);
    expect(fs.find(100, 100)).toBe(-1);
    expect(fs.nearest(4.002, 0.001, 0.004)).toBe(p);
  });

  it('a vertex of one face in the middle of another face\'s edge is put into that edge: no T joint, one loop', () => {
    const fs = new FaceSet();
    fs.add(sq(0, 0, 8, 3, 5).map((c, k) => ({ ...c, u: k === 1 || k === 2 ? 1 : 0, v: c.z })), meta);
    fs.add(sq(0, 3, 4, 6), meta);
    fs.add(sq(4, 3, 8, 6), meta);
    const before = boundaryLoops(fs, buildEdges(fs));
    expect(before.loops.length).toBeGreaterThan(1); // the long edge and its two halves do not match
    const rep = conform(fs);
    expect(rep.inserted).toBe(1);
    expect(rep.tJointsLeft).toBe(0);
    expect(fs.len[0]).toBe(5);
    // the new corner takes the height and the lane UV of its place on the edge
    const k = fs.ring(0).findIndex(([x, z]) => x === 4 && z === 3);
    expect(fs.ys[(fs.start[0] as number) + k]).toBeCloseTo(5, 9);
    expect(fs.us[(fs.start[0] as number) + k]).toBeCloseTo(0.5, 9);
    expect(fs.vs[(fs.start[0] as number) + k]).toBeCloseTo(3, 9);
    const e = buildEdges(fs);
    const after = boundaryLoops(fs, e);
    expect(e.doubled).toBe(0);
    expect(after.unclosed).toBe(0);
    expect(after.loops).toHaveLength(1);
    expect(after.loops[0]!.area).toBeCloseTo(48, 6);
    expect(after.sliverLoops).toBe(0);
  });
});

describe('the polygon set', () => {
  const o = { x: 0, z: 0 };
  const ring = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

  it('a face minus something wholly inside it comes back as faces without holes that cover the rest exactly', () => {
    const res = minus([ring(0, 0, 10, 10)], [ring(4, 4, 6, 6), ring(1, 1, 2, 2)], o);
    expect(res.holes).toBe(2);
    expect(res.rings.length).toBeGreaterThan(1);
    expect(res.rings.reduce((s, r) => s + ringAreaM2(r), 0)).toBeCloseTo(100 - 4 - 1, 3);
    expect(unionArea(res.rings, o)).toBeCloseTo(95, 3);
    expect(sharedArea(res.rings, [ring(4, 4, 6, 6), ring(1, 1, 2, 2)], o)).toBeLessThan(1e-4);
  });

  it('two neighbours that do not quite touch leave no hairline between them', () => {
    // a 1 mm gap between the two clips: the strip of face left in it is not a face
    const res = minus([ring(0, 0, 10, 4)], [ring(-1, -1, 5, 5), ring(5.001, -1, 11, 5)], o);
    expect(res.rings).toHaveLength(0);
  });

  it('a whisker (out and straight back) is taken out of a ring', () => {
    const clean = trimWhiskers([[0, 0], [10, 0], [10, 5], [14, 5.001], [10, 5.002], [10, 10], [0, 10]]);
    expect(clean.some(([x]) => x === 14)).toBe(false);
    expect(ringAreaM2(clean)).toBeCloseTo(100, 1);
    expect(trimWhiskers(ring(0, 0, 4, 4))).toHaveLength(4);
  });

  it('the triangulator keeps every vertex, also one in the middle of a straight edge', () => {
    const r: [number, number][] = [[0, 0], [5, 0], [10, 0], [10, 10], [5, 10], [0, 10], [0, 5]];
    const idx = triangulateRing(r);
    expect(new Set(idx).size).toBe(r.length);
    let area = 0;
    for (let k = 0; k + 2 < idx.length; k += 3) {
      const [a, b, c] = [r[idx[k]!]!, r[idx[k + 1]!]!, r[idx[k + 2]!]!];
      area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    }
    expect(area).toBeCloseTo(100, 9);
  });
});

describe('strips', () => {
  it('border codes: dashed between lanes of one direction, a centre line between two directions, edge lines beside the rest, no paint in a gali', () => {
    const d = (dir: 1 | -1 | 0, tag?: 'gali') => ({ type: 'drive' as const, dir, width: 3.3, raise: 0, ...(tag ? { tag } : {}) });
    const k = { type: 'kerb' as const, dir: 0 as const, width: 0.3, raise: KERB_RAISE };
    expect(borderMarks([k, d(1), d(1), d(-1), k])).toEqual([MARK_NONE, MARK_EDGE, MARK_DASHED, MARK_CENTRE, MARK_EDGE, MARK_NONE]);
    expect(borderMarks([k, d(0, 'gali'), k])).toEqual([MARK_NONE, MARK_NONE, MARK_NONE, MARK_NONE]);
  });

  it('a lane border never runs backwards on the inside of a tight bend, and the two end stations stay', () => {
    // a 12 m wide strip that turns 80 degrees between stations 2 m apart: its inside edge folds
    const st: Station[] = [];
    for (let i = 0; i < 6; i++) {
      const a = i < 3 ? 0 : (80 * Math.PI) / 180;
      const x = i < 3 ? i * 2 : 4 + Math.cos(a) * (i - 2) * 2;
      const z = i < 3 ? 0 : -Math.sin(a) * (i - 2) * 2;
      st.push({ x, z, nx: Math.sin(a), nz: -Math.cos(a) * -1 * -1, s: i * 2, h: 0, g: 0, b: [6, 0, -6], layer: 0, bridge: false, structure: 0, edgeRaise: 0 });
    }
    const strip = { id: 't', edge: 't', kind: 'road', cls: 'residential', link: false, name: '', ways: [], lanes: [{ type: 'drive', dir: 1, width: 6, raise: 0 }, { type: 'drive', dir: -1, width: 6, raise: 0 }], st, hero: null } as Strip;
    const u = unfold(strip);
    expect(u.moved).toBeGreaterThan(0);
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i + 1 < st.length; i++) {
        const dx = st[i + 1]!.x - st[i]!.x;
        const dz = st[i + 1]!.z - st[i]!.z;
        expect((u.x[(i + 1) * 3 + k]! - u.x[i * 3 + k]!) * dx + (u.z[(i + 1) * 3 + k]! - u.z[i * 3 + k]!) * dz).toBeGreaterThanOrEqual(-1e-9);
      }
      for (const i of [0, st.length - 1]) expect(u.from[i * 3 + k]).toBe(i);
    }
  });
});

describe('a crossroads at grade', () => {
  const s = new Sketch();
  s.way([[-200, 0], [0, 0], [200, 0]].map((p) => p as [number, number]), { highway: 'primary', name: 'Main Road' });
  const mid = s.elements.find((e) => e.type === 'node' && e.lon === 0 && e.lat === 0)!.id;
  s.way([[0, -200], mid, [0, 200]], { highway: 'tertiary', name: 'Cross Street' });
  const { input, mesh, checks } = build(s);

  it('the junction is built as planned, with raised corners, and shares no area with its arms', () => {
    expect(input.junctions).toHaveLength(1);
    expect(mesh.junctions.j1).toBe(1);
    expect(mesh.junctions.clippedFaces).toBe(0);
    expect(mesh.junctions.bands).toBe(4);
    expect(mesh.junctions.droppedBands).toBe(0);
    expect(checks.overlap.pairsOver).toBe(0);
    expect(checks.overlap.maxPairM2).toBeLessThan(0.01);
    expect(checks.overlap.totalM2).toBeLessThan(0.01);
    expect(checks.overlap.stripPairs.pairs).toBe(0);
  });

  it('the surface is watertight and every arm joins the junction; the four far ends are dead ends, each closed by a kerb (P1-037)', () => {
    expect(checks.watertight.openBoundaryEdges).toBe(0);
    expect(checks.watertight.loops).toBe(1);
    expect(checks.watertight.sliverLoops).toBe(0);
    expect(checks.ends.unjoined).toBe(0);
    expect(checks.ends.floating).toBe(0);
    // a kerb across each dead end joins its lanes' end edges
    expect(mesh.endKerbs).toMatchObject({ deadEnds: 4, kerbs: 4, notAtGrade: 0, blocked: 0 });
    expect(checks.ends.explained).toEqual({});
    expect(checks.ends.joined).toBe(checks.ends.stripEnds);
    // the kerb stands 0.15 m over the carriageway and a kerb face rises to it
    for (const f of mesh.endKerbs.faces) {
      expect(mesh.fs.raise[f]).toBe(0.15);
      const r = mesh.fs.ring(f);
      expect(r.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('kerbs stand 0.15 m over the carriageway, lanes carry their UV, the arms that stop have a stop line, nothing is fenced', () => {
    expect(checks.kerbs.sampled).toBeGreaterThan(100);
    expect(checks.kerbs.off).toBe(0);
    expect(checks.kerbs.minM).toBeCloseTo(KERB_RAISE, 6);
    expect(checks.kerbs.maxM).toBeCloseTo(KERB_RAISE, 6);
    expect(checks.uv.ok).toBe(true);
    expect(checks.uv.badU + checks.uv.badV + checks.uv.borderMismatch).toBe(0);
    expect(checks.uv.markedTriangles).toBeGreaterThan(0);
    expect(checks.uv.stretchMin).toBeCloseTo(1, 2);
    expect(checks.stopLines.armsThatStop).toBe(4);
    expect(checks.stopLines.missing).toBe(0);
    expect(checks.stopLines.crossings).toBe(4);
    expect(checks.railings.segments).toBe(0);
    expect(mesh.sink.meshes.has('parapet')).toBe(false);
    expect(checks.piers.piers).toBe(0);
    // every top mesh has a UV and two border codes for each vertex
    const road = mesh.sink.meshes.get('road')!;
    expect(road.uv).toHaveLength((road.pos.length / 3) * 2);
    expect(road.uv2).toHaveLength((road.pos.length / 3) * 2);
  });

  it('the same input gives the same mesh; a stand-in tile holds the meshes, lane lines and two poses', () => {
    expect(meshHash(buildRoadMesh(input))).toBe(meshHash(mesh));
    const site = siteTile(input, mesh, { id: 'x', name: 'crossroads', x: 0, z: 0, halfM: 150, eye: /^Main Road/ });
    expect(site.meta.poses.map((p) => p.name)).toEqual(['top', 'eye']);
    const names = site.tile.meshes.map((m) => m.material);
    for (const m of ['road', 'kerb', 'footpath', 'marking', 'ground']) expect(names).toContain(m);
    expect(site.tile.colliders.length).toBeGreaterThan(0);
    for (const m of site.tile.meshes) expect(m.pos.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('with no usable plan the polygon set builds the surface from the lane paths: still no overlap, watertight, every arm joined', () => {
    const r = build(s, 500, (i) => {
      i.junctions[0]!.ring = null;
      i.junctions[0]!.bands = [];
      i.junctions[0]!.method = 'J2';
    });
    expect(r.mesh.junctions.j2).toBe(1);
    expect(r.mesh.junctions.faces[0]!.length).toBeGreaterThan(0);
    expect(r.checks.overlap.pairsOver).toBe(0);
    expect(r.checks.watertight.openBoundaryEdges).toBe(0);
    expect(r.checks.ends.unjoined).toBe(0);
    // the kerbs beside it are counted apart: its heights are spread from the arms, and where a corner of it lies on a
    // strip's edge it takes the strip's height (P1-036), so the kerb beside it stands 0.15 m too
    expect(r.checks.kerbs.off).toBe(0);
    expect(r.checks.kerbs.beside.off).toBe(0);
  });

  it('a polygon set surface stays inside the hull of its arms\' cut lines, even when a lane path wanders far out (P1-036)', () => {
    const r = build(s, 500, (i) => {
      const j = i.junctions[0]!;
      j.ring = null;
      j.bands = [];
      j.method = 'J2';
      // a lane path that runs 150 m out along one arm and back, as the paths of the widest pilot clusters do
      const p = j.paths[0]!;
      j.paths.push({ pts: [p.pts[0]!, [p.pts[0]![0] + 150, p.pts[0]![1] + 40], p.pts[p.pts.length - 1]!], width: p.width });
    });
    const xs: number[] = [];
    const zs: number[] = [];
    for (const f of r.mesh.junctions.faces[0]!) for (const [x, z] of r.mesh.fs.ring(f)) {
      xs.push(x);
      zs.push(z);
    }
    const cuts = r.input.junctions[0]!.arms.map((a) => {
      const st = r.input.strips[a.strip]!.st;
      return Math.hypot(...(a.end === 'start' ? [st[0]!.x, st[0]!.z] : [st[st.length - 1]!.x, st[st.length - 1]!.z]) as [number, number]);
    });
    const reach = Math.max(...xs.map((x, k) => Math.hypot(x, zs[k]!)));
    expect(reach).toBeLessThan(Math.max(...cuts) + 20);
    expect(r.checks.ends.unjoined).toBe(0);
    expect(r.checks.watertight.openBoundaryEdges).toBe(0);
  });
});

describe('a flyover', () => {
  const s = new Sketch();
  s.way([[-400, 0], [400, 0]], { highway: 'primary', name: 'Low Road' });
  const a = s.node(0, -40);
  const c = s.node(0, 40);
  s.way([[0, -420], a], { highway: 'tertiary', name: 'High Road' });
  s.way([a, c], { highway: 'tertiary', name: 'High Road', bridge: 'yes', layer: '1' });
  s.way([c, [0, 420]], { highway: 'tertiary', name: 'High Road' });
  const { input, mesh, checks } = build(s);

  it('parapets, walls and undersides stand on the structure only', () => {
    const deck = input.kinds.some((k) => Array.from(k).includes(K_DECK));
    expect(deck).toBe(true);
    expect(checks.railings.segments).toBeGreaterThan(10);
    expect(checks.railings.parapets).toBeGreaterThan(10);
    expect(checks.railings.parapetTriangles).toBeGreaterThan(0);
    expect(checks.railings.atGrade).toBe(0);
    for (const seg of mesh.structures.segments) {
      const k = input.kinds[seg.strip]!;
      expect(k[seg.station] !== K_GRADE || k[seg.station + 1] !== K_GRADE).toBe(true);
    }
    expect(mesh.structures.undersides).toBeGreaterThan(0);
    expect(mesh.structures.abutmentWalls).toBeGreaterThan(0);
  });

  it('no pier stands in the road under the deck; the two levels share no face', () => {
    expect(checks.piers.inLane).toBe(0);
    for (const p of mesh.structures.piers) for (const [, z] of p.ring) expect(Math.abs(z)).toBeGreaterThan(5);
    expect(checks.overlap.pairsOver).toBe(0);
    expect(checks.overlap.stripPairs.pairs).toBe(0);
    expect(checks.overlap.sheets.length).toBeGreaterThan(1);
    expect(checks.watertight.openBoundaryEdges).toBe(0);
    expect(checks.ends.unjoined).toBe(0);
    expect(checks.ends.floating).toBe(0);
    expect(checks.kerbs.off).toBe(0);
  });
});

describe('a one-way split', () => {
  it('the rows of a joint share their vertices: no end is left unjoined at a split zone', () => {
    const s = new Sketch();
    const n = s.node(0, 0);
    s.way([[-300, 0], n], { highway: 'trunk', oneway: 'yes', lanes: '3', name: 'Ring Road' });
    s.way([n, [150, 0], [300, 0]], { highway: 'trunk', oneway: 'yes', lanes: '2', name: 'Ring Road' });
    s.way([n, [150, -25], [300, -60]], { highway: 'trunk_link', oneway: 'yes', name: 'Slip' });
    const { input, mesh, checks } = build(s);
    expect(input.joints.length).toBeGreaterThan(0);
    expect(mesh.borders.apart).toBe(0);
    expect(checks.ends.unjoined).toBe(0);
    expect(checks.watertight.openBoundaryEdges).toBe(0);
    expect(checks.overlap.pairsOver).toBe(0);
    expect(checks.uv.ok).toBe(true);
  });
});
