// The production tile writer (P1-016): the KTL1 round trip, the version and magnitude rules, the world grid cutter
// (snap, seams, overhang), collider chunks, building shells, lane pieces and the skip rules of bakeTiles.
import { describe, expect, it } from 'vitest';
import { badVertex, decodeContent, decodeT1, encodeT1, tileBadVertices } from './codec';
import type { TileContent } from './codec';
import { CHUNK_LIMIT, tileColliders } from './colliders';
import { SNAP, WorldCutter, snap } from './cutter';
import type { SourceMesh } from './cutter';
import { lanePieces } from './lanes';
import { sampleInputs, sampleProductionTile, SAMPLE_OFFSET } from './sample';
import { DEFAULT_HEIGHT_M, shellHeight, shellOf } from './shells';
import { TILE_MARGIN_M, bakeTiles } from './write';
import { TileRays, colliderVsDrawn, deckRays } from './checks';
import { MeshBuilder } from './standin';
import type { LaneGraphFile } from '../roads/laneout';
import type { Strip } from '../roads/model';

const sameWithin = (a: readonly number[] | undefined, b: readonly number[] | undefined, tol: number): boolean => !!a && !!b && a.length === b.length && a.every((v, i) => Math.abs(v - (b[i] as number)) <= tol);

describe('KTL1 codec', () => {
  it('write then read gives every array back within 0.000001 (the production sample tile)', () => {
    const { result, bytes } = sampleProductionTile();
    expect(result.records).toHaveLength(1);
    const back = decodeContent(bytes);
    // the content the writer encoded, rebuilt the same way, against what came back
    const again = decodeContent(encodeT1(back));
    for (const t of [back, again]) {
      expect(t.meshes.length).toBe(4);
      expect(t.lanes).toHaveLength(2);
      expect(t.pins).toHaveLength(1);
    }
    for (let i = 0; i < back.meshes.length; i++) {
      const a = back.meshes[i]!;
      const b = again.meshes[i]!;
      for (const k of ['pos', 'nrm', 'idx', 'uv', 'uv2'] as const) expect(a[k] === undefined || sameWithin(a[k], b[k], 1e-6), `${a.name} ${k}`).toBe(true);
    }
    back.colliders.forEach((c, i) => expect(sameWithin(c.faces, again.colliders[i]!.faces, 1e-6)).toBe(true));
    back.lanes!.forEach((l, i) => expect(sameWithin(l.pts, again.lanes![i]!.pts, 1e-6)).toBe(true));
    expect(again.pins).toEqual(back.pins);
  });

  it('a hand made tile comes back exactly, arrays of every kind', () => {
    const t: TileContent = {
      district: 'centre', tx: 3, tz: -2, size: 250, origin: [750, 205, -500], margin: 250,
      meshes: [{ name: 'road', material: 'road', pos: [0, 0, 0, 10.5, 0.25, 0, 10.5, 0.25, 7.125], nrm: [0, 1, 0, 0, 1, 0, 0, 1, 0], idx: [0, 2, 1], uv: [0, 0, 0.5, 1, 0.25, 0.75], uv2: [1, 2, 1, 2, 1, 2] }],
      colliders: [{ name: 'col_0_0_0', faces: [0, 0, 0, 10.5, 0.25, 7.125, 10.5, 0.25, 0] }],
      placements: [{ module: 'm', xforms: [1, 0, 0, 5, 0, 1, 0, 0, 0, 0, 1, 2] }],
      lanes: [{ id: 's1.0:0', kind: 'lane', of: 's1.0', part: 0, cls: 'primary', widthM: 3.5, layer: 0, next: ['j1.0:0'], pts: [1, 0.5, 2, 30, 0.75, 2] }],
      pins: [{ id: 'p', name: 'P', kind: 'place', pos: [12.5, 0.5, 100.25] }],
    };
    const back = decodeContent(encodeT1(t));
    expect(back.meshes[0]).toEqual(t.meshes[0]);
    expect(back.colliders).toEqual(t.colliders);
    expect(back.placements).toEqual(t.placements);
    expect(back.lanes).toEqual(t.lanes);
    expect(back.pins).toEqual(t.pins);
    expect(back.origin).toEqual(t.origin);
    expect(back.margin).toBe(250);
  });

  it('a wrong version, a wrong mark or a cut file fails loudly', () => {
    const { bytes } = sampleProductionTile();
    const v2 = bytes.slice();
    new DataView(v2.buffer).setUint32(4, 2, true);
    expect(() => decodeT1(v2)).toThrow(/KTL1 version 2 is not supported/);
    const junk = bytes.slice();
    junk[0] = 0x58;
    expect(() => decodeT1(junk)).toThrow(/not a KTL1 tile/);
    expect(() => decodeT1(bytes.slice(0, bytes.length - 64))).toThrow(/runs past the end/);
  });

  it('a vertex outside the tile plus its margin is rejected: on read, and by the writer', () => {
    expect(badVertex('m', [0, 0, 0, 250 + 250, 0, 0], 250, 250)).toBeNull();
    expect(badVertex('m', [0, 0, 0, 250 + 250.01, 0, 0], 250, 250)?.index).toBe(1);
    expect(badVertex('m', [-250.01, 0, 0], 250, 250)?.index).toBe(0);
    expect(badVertex('m', [0, Number.NaN, 0], 250, 250)?.index).toBe(0);
    expect(badVertex('m', [0, 2001, 0], 250, 250)?.index).toBe(0);
    const { bytes } = sampleProductionTile();
    const d = decodeT1(bytes);
    const bad = bytes.slice();
    // the first ground vertex moved 10 km east, as a vertex in the wrong frame would be
    const base = 12 + new DataView(bytes.buffer, bytes.byteOffset).getUint32(8, true);
    new DataView(bad.buffer).setFloat32(base + d.header.meshes[0]!.pos, 10000, true);
    expect(() => decodeT1(bad)).toThrow(/outside the tile plus its 250 m margin/);
    expect(() => decodeT1(bad, false)).not.toThrow();
    // the writer reports the tile and does not write it
    const inputs = sampleInputs();
    const far = new MeshBuilder('road', 'road');
    far.tri([100, 210, 100], [101, 210, 100], [1100, 210, 101], [0, 1, 0]);
    const written: string[] = [];
    const res = bakeTiles({ block: 'sample', offset: SAMPLE_OFFSET, ...inputs, road: [...inputs.road, { ...far.mesh, uv: [], uv2: [] }], pins: [] }, (r) => written.push(r.id));
    const hit = res.skipped.find((x) => x.id === '1_0');
    expect(hit?.reason).toMatch(/outside the tile plus 250 m/);
    expect(written).not.toContain('1_0');
    expect(written).toContain('0_0');
    expect(tileBadVertices(decodeContent(sampleProductionTile().bytes), TILE_MARGIN_M)).toEqual([]);
  });

  it('a tile over its byte budget is reported and skipped', () => {
    const written: string[] = [];
    const res = bakeTiles({ block: 'sample', offset: SAMPLE_OFFSET, ...sampleInputs(), pins: [], budgetBytes: 1000 }, (r) => written.push(r.id));
    expect(written).toEqual([]);
    expect(res.skipped[0]?.reason).toMatch(/over the budget of 1000/);
  });
});

describe('world grid cutter', () => {
  it('stores vertices relative to the tile, snapped to 1/1024 m, exact as float32, the same point in both tiles of a seam', () => {
    const offset = { x: 621.6, z: 467.2 };
    const c = new WorldCutter(offset);
    const m = new MeshBuilder('road', 'road');
    // two triangles sharing the edge on the world line x = 750 (block x 128.4), one each side
    m.tri([128.4, 210.123456, 10], [128.4, 210.2, 20], [120, 210.1, 15], [0, 1, 0]);
    m.tri([128.4, 210.123456, 10], [128.4, 210.2, 20], [137, 210.1, 15], [0, 1, 0]);
    c.addRoad([{ ...m.mesh, uv: [], uv2: [] } as SourceMesh]);
    const ids = c.tiles().map((t) => t.id);
    expect(ids).toEqual(['2_1', '3_1']);
    const a = c.cut(2, 1);
    const b = c.cut(3, 1);
    expect(a.origin[0]).toBe(500);
    expect(b.origin[0]).toBe(750);
    const world = (t: typeof a): string[] => {
      const p = t.meshes[0]!.pos;
      const out: string[] = [];
      for (let i = 0; i < p.length; i += 3) out.push(`${p[i]! + t.origin[0]},${p[i + 1]! + t.origin[1]},${p[i + 2]! + t.origin[2]}`);
      return out;
    };
    const shared = world(a).filter((v) => world(b).includes(v));
    expect(shared).toHaveLength(2);
    for (const t of [a, b]) for (const v of t.meshes[0]!.pos) {
      expect(Math.fround(v)).toBe(v);
      expect(Math.round(v / SNAP) * SNAP).toBe(v);
    }
    expect(snap(210.123456)).toBeCloseTo(210.123456, 3);
  });

  it('merges meshes per material (kerb faces into kerbs), welds vertices, keeps a building whole in the tile of its centroid', () => {
    const { result, bytes } = sampleProductionTile();
    const t = decodeContent(bytes);
    expect(t.meshes.map((m) => m.material)).toEqual(['ground', 'road', 'kerb', 'building']);
    expect(t.meshes[0]!.pos.length / 3).toBe(4);
    expect(result.stats.buildings).toBe(1);
    // a shell reaching over the tile line stays whole in its centroid's tile
    const c = new WorldCutter({ x: 0, z: 0 });
    const s = shellOf({ id: 'big', ring: [{ x: 200, z: 10 }, { x: 290, z: 10 }, { x: 290, z: 40 }, { x: 200, z: 40 }], height: 10, levels: null, tags: {} }, () => 0, () => 0)!;
    c.addShells([s]);
    expect(c.tiles().map((x) => x.id)).toEqual(['0_0']);
    const cut = c.cut(0, 0);
    expect(cut.buildings).toEqual([{ id: 'big', first: 0, end: s.tris.length / 9 }]);
    expect(cut.overhangM).toBeCloseTo(40, 6);
  });

  it('cuts a shell that would reach over 200 m past its tile (a city wall) into one part per tile', () => {
    const c = new WorldCutter({ x: 0, z: 0 });
    const wall = shellOf({ id: 'wall', ring: [{ x: 10, z: 100 }, { x: 610, z: 100 }, { x: 610, z: 104 }, { x: 10, z: 104 }], height: 8, levels: null, tags: { building: 'wall' } }, () => 0, () => 0)!;
    expect(c.addShells([wall])).toBe(1);
    expect(c.tiles().map((t) => t.id)).toEqual(['0_0', '1_0', '2_0']);
    let tris = 0;
    for (const t of c.tiles()) {
      const cut = c.cut(t.tx, t.tz);
      expect(cut.overhangM).toBeLessThanOrEqual(50);
      expect(cut.buildings).toHaveLength(1);
      tris += cut.meshes[0]!.idx.length / 3;
    }
    expect(tris).toBeGreaterThan(wall.tris.length / 9);
  });

  it('leaves out a needle the snap turns over', () => {
    const c = new WorldCutter({ x: 0, z: 0 });
    const m = new MeshBuilder('road', 'road');
    // three points within half a millimetre of one line: the snap puts them on it
    m.tri([10, 0, 10], [10.0004, 0, 11], [10, 0, 12], [0, 1, 0]);
    m.tri([10, 0, 10], [20, 0, 10], [20, 0, 20], [0, 1, 0]);
    c.addRoad([{ ...m.mesh, uv: [], uv2: [] }]);
    const cut = c.cut(0, 0);
    expect(cut.flipped).toBe(1);
    expect(cut.meshes[0]!.idx.length).toBe(3);
  });
});

describe('collider chunks', () => {
  const grid = (n: number, material = 'ground'): MeshBuilder => {
    const g = new MeshBuilder(material, material);
    const step = 250 / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) g.quad([i * step, 0, j * step], [(i + 1) * step, 0, j * step], [(i + 1) * step, 0, (j + 1) * step], [i * step, 0, (j + 1) * step], [0, 1, 0]);
    return g;
  };

  it('about 500 triangles a chunk and never over 600, from the drawn vertices; paint and water left out', () => {
    const g = grid(100);
    const paint = grid(4, 'marking');
    const { chunks, stats } = tileColliders([g.mesh, paint.mesh], [], 250);
    expect(stats.triangles).toBe(20000);
    expect(Math.max(...chunks.map((c) => c.faces.length / 9))).toBeLessThanOrEqual(CHUNK_LIMIT);
    expect(Math.max(...chunks.map((c) => c.faces.length / 9))).toBeLessThanOrEqual(500);
    expect(chunks.length).toBeLessThanOrEqual(Math.ceil(20000 / 500) + 16);
    const drawn = new Set<string>();
    for (let k = 0; k < g.mesh.idx.length; k += 3) drawn.add([0, 1, 2].map((i) => g.mesh.pos.slice(g.mesh.idx[k + i]! * 3, g.mesh.idx[k + i]! * 3 + 3).join(',')).join('|'));
    for (const c of chunks) for (let k = 0; k < c.faces.length; k += 9) expect(drawn.has([0, 3, 6].map((o) => c.faces.slice(k + o, k + o + 3).join(',')).join('|'))).toBe(true);
  });

  it('keeps each building shell in one chunk, splits only a shell over the limit, takes deck joints and leaves out slivers', () => {
    const b = new MeshBuilder('building', 'building');
    const ranges: { first: number; end: number }[] = [];
    for (let k = 0; k < 30; k++) {
      const first = b.mesh.idx.length / 3;
      for (let t = 0; t < 40; t++) b.tri([k * 5, t, 0], [k * 5 + 1, t, 0], [k * 5, t + 1, 0], [0, 0, -1]);
      ranges.push({ first, end: b.mesh.idx.length / 3 });
    }
    const huge = b.mesh.idx.length / 3;
    for (let t = 0; t < 700; t++) b.tri([200, t, 200], [201, t, 200], [200, t + 1, 200], [0, 0, -1]);
    ranges.push({ first: huge, end: b.mesh.idx.length / 3 });
    const j = new MeshBuilder('joint', 'joint');
    j.quad([0, 1, 0], [8, 1, 0], [8, 1, 0.08], [0, 1, 0.08], [0, 1, 0]);
    j.tri([50, 1, 50], [50.0000001, 1, 50], [50, 1, 50.0000001], [0, 1, 0]);
    const { chunks, stats } = tileColliders([b.mesh, j.mesh], ranges, 250);
    expect(stats.splitBuildings).toBe(1);
    expect(stats.joints).toBe(2);
    expect(stats.slivers).toBe(1);
    expect(Math.max(...chunks.map((c) => c.faces.length / 9))).toBeLessThanOrEqual(CHUNK_LIMIT);
    // every small building is whole in one chunk: its 40 triangles share an x
    for (let k = 0; k < 30; k++) {
      const holders = chunks.filter((c) => {
        for (let i = 0; i < c.faces.length; i += 9) if (c.faces[i] === k * 5 && c.faces[i + 2] === 0 && c.faces[i + 1]! < 41) return true;
        return false;
      });
      expect(holders).toHaveLength(1);
    }
  });
});

describe('building shells', () => {
  it('stand on the lowest ground, rise to the class height over the highest, walls facing out, roof facing up', () => {
    const ring = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 20 }, { x: 0, z: 20 }];
    const s = shellOf({ id: 'a', ring, height: null, levels: null, tags: { building: 'yes' } }, (x) => 200 + x * 0.1, () => 0)!;
    expect(s.base).toBeCloseTo(199.7, 9);
    expect(s.top).toBeCloseTo(201 + DEFAULT_HEIGHT_M, 9);
    expect(s.from).toBe('default');
    for (let t = 0; t < s.nrm.length / 3; t++) {
      const n = s.nrm.slice(t * 3, t * 3 + 3);
      const cx = (s.tris[t * 9]! + s.tris[t * 9 + 3]! + s.tris[t * 9 + 6]!) / 3;
      const cz = (s.tris[t * 9 + 2]! + s.tris[t * 9 + 5]! + s.tris[t * 9 + 8]!) / 3;
      if (n[1] === 1) continue;
      // outward: from the middle of the footprint towards the wall
      expect(n[0]! * (cx - 5) + n[2]! * (cz - 10)).toBeGreaterThan(0);
    }
    expect(s.nrm.filter((_, i) => i % 3 === 1 && s.nrm[i] === 1)).toHaveLength(2);
    // the same ring the other way round gives the same normals
    const r = shellOf({ id: 'b', ring: [...ring].reverse(), height: null, levels: null, tags: {} }, () => 0, () => 0)!;
    expect(r.nrm.filter((v, i) => i % 3 === 0 && v === -1)).toHaveLength(2);
    expect(shellHeight({ id: 'c', ring, height: 30, levels: 2, tags: {} })).toEqual({ height: 30, from: 'height' });
    expect(shellHeight({ id: 'c', ring, height: null, levels: 3, tags: {} }).height).toBeCloseTo(9.6, 9);
    expect(shellHeight({ id: 'c', ring, height: null, levels: null, tags: { building: 'garage' } })).toEqual({ height: 3.5, from: 'class' });
    expect(shellOf({ id: 'd', ring: ring.slice(0, 2), height: null, levels: null, tags: {} }, () => 0, () => 0)).toBeNull();
  });
});

describe('lane pieces', () => {
  it('cut a lane at the tile lines, give it its station heights and link the pieces and the paths', () => {
    const st = (x: number, h: number) => ({ x, z: 10, nx: 0, nz: 1, s: x, h, g: h, b: [1.75, -1.75], layer: 0, bridge: false, structure: 0 as const, edgeRaise: 0.15 });
    const strip = { id: 'a', name: 'A', lanes: [{ type: 'drive', dir: 1 }], st: [st(200, 1), st(240, 2), st(260, 3), st(300, 4)] } as unknown as Strip;
    const g: LaneGraphFile = {
      format: 'x', _doc: '', block: 'b', offset: [0, 0],
      lanes: [{ id: 's0.0', strip: 0, lane: 0, cls: 'primary', widthM: 3.5, lengthM: 100, layer: 0, pts: [[200, 10], [240, 10], [260, 10], [300, 10]], next: ['j1.0'], tile: '0_0' }],
      paths: [{ id: 'j1.0', junction: 'j1', turn: 'straight', radiusM: null, lengthM: 10, from: 's0.0', to: 's0.0', stop: false, pts: [[300, 10], [310, 10]], tile: '1_0' }],
      tiles: {},
    };
    const p = lanePieces(g, [strip], { x: 0, z: 0 });
    expect(p.map((x) => `${x.id}@${x.tile}`)).toEqual(['s0.0:0@0_0', 's0.0:1@1_0', 'j1.0:0@1_0']);
    expect(p[0]!.next).toEqual(['s0.0:1']);
    expect(p[1]!.next).toEqual(['j1.0:0']);
    expect(p[2]!.next).toEqual(['s0.0:0']);
    // pieces share their end point; heights from the stations; the path runs from the lane's last height
    expect(p[0]!.pts.slice(-3)).toEqual(p[1]!.pts.slice(0, 3));
    expect(p[0]!.pts.filter((_, i) => i % 3 === 1)).toEqual([1, 2]);
    expect(p[1]!.pts.filter((_, i) => i % 3 === 1)).toEqual([2, 3, 4]);
    expect(p[2]!.pts[1]).toBe(4);
  });
});

describe('collider and deck rays on the sample tile', () => {
  it('collider against drawn: every seeded point within 0.05 m, no holes', () => {
    const { bytes } = sampleProductionTile();
    const c = colliderVsDrawn(new Map([['0_0', bytes]]), 0, 0, 'sample', 500);
    expect(c.holes).toBe(0);
    expect(c.mismatched).toBe(0);
    expect(c.matched).toBe(500);
    const rays = new TileRays(new Map([['0_0', bytes]]), ['0_0']);
    // on the road: 0.02 m over the ground, at the snapped height
    expect(rays.colliders.top(100 + SAMPLE_OFFSET.x, 40 + SAMPLE_OFFSET.z)).toBeCloseTo(210.52, 2);
  });

  it('deck rays find no strip where there is no deck', () => {
    const { bytes } = sampleProductionTile();
    const d = deckRays(new Map([['0_0', bytes]]), [], [], /x/, 2, SAMPLE_OFFSET);
    expect(d.rays).toBe(0);
  });
});
