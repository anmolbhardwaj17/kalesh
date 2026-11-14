// The world grid cutter of the production tiles (P1-016, TECH.md "Tile format", FP1): every drawn triangle of the
// stage goes to one 250 m tile of the one world grid (tools/bake/layout/grid.ts) and is stored relative to that
// tile's origin, merged into one mesh per material with shared vertices.
//
// - Road and junction faces (block metres, three vertices per triangle) go to the tile of their centre: a triangle
//   may reach a little past its tile; the magnitude rule bounds how far (codec.ts badVertex).
// - The ground comes cut at the tile lines by the terrain step (Ground.tiles); it is taken as it is.
// - A building shell goes whole to the tile of its centroid, so a building never splits between two tiles.
// - Every vertex is snapped to a step of 1/1024 m in world metres before the tile origin is taken off. Origins are
//   whole metres, so every stored number is exact as a 32-bit float and a vertex two tiles share (a road edge on
//   the ground, a seam) is the same point in both: no hairline between tiles for a wheel ray to fall through.
// Pure.
import { TILE_M, tileId, tileOf } from '../layout/grid.ts';
import type { P2 } from '../geom.ts';
import type { GroundTile } from '../terrain/build.ts';
import type { MeshData } from './codec.ts';
import type { Shell } from './shells.ts';

/** The snap step of every stored vertex (m): a power of two, so tile-relative numbers stay exact as float32. */
export const SNAP = 1 / 1024;
export const snap = (v: number): number => Math.round(v / SNAP) * SNAP;

/** A draw mesh of the road builder: three vertices per triangle (mesh/solids.ts Sink), block metres. */
export interface SourceMesh {
  material: string;
  pos: readonly number[];
  nrm: readonly number[];
  uv: readonly number[];
  uv2: readonly number[];
  idx: readonly number[];
}

/** Materials of the road builder that are merged into another one in the tile (one draw call fewer each). */
export const MERGED: Readonly<Record<string, string>> = { kerbface: 'kerb', parapet: 'wall' };
/** Draw order of the materials in a tile (others follow by name). */
export const MATERIAL_ORDER = ['ground', 'lawn', 'plot', 'bed', 'water', 'forecourt', 'pad', 'wallbase', 'moat', 'walkway', 'road', 'parking', 'gore', 'marking', 'joint', 'median', 'planter', 'footpath', 'kerb', 'wall', 'pier', 'underside', 'building', 'landmark', 'landmark_red', 'bollard'];

interface TileBin {
  tx: number;
  tz: number;
  /** Road triangles by output material: mesh index and triangle index. */
  road: Map<string, number[]>;
  ground: GroundTile | null;
  shells: number[];
}

export interface CutTile {
  tx: number;
  tz: number;
  id: string;
  /** World metres of the tile's north-west corner, y at its lowest ground (whole metres). */
  origin: [number, number, number];
  meshes: MeshData[];
  /** Triangle ranges of the `building` mesh, one per shell: [first, end) in triangles. */
  buildings: { id: string; first: number; end: number }[];
  /** How far the farthest vertex lies outside the tile square (m, 0 when all are inside). */
  overhangM: number;
  /** UV arrays of a source mesh that did not have one pair per vertex (left out). */
  droppedUv: number;
  /** Needle triangles the snap turned over or flattened (left out). */
  flipped: number;
}

type V3 = [number, number, number];
/** A triangle whose least height is under this (m) is a needle and covers nothing (the snap is 1/1024 m). */
const NEEDLE_M = 0.001;

const cross = (a: V3, b: V3, c: V3): V3 => {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
};

/** Tile-relative meshes per material with shared vertices (exact keys after the snap). */
class Welder {
  readonly mesh: MeshData;
  private readonly ids = new Map<string, number>();
  private readonly withUv: boolean;
  constructor(material: string, withUv: boolean) {
    this.mesh = { name: material, material, pos: [], nrm: [], idx: [], ...(withUv ? { uv: [], uv2: [] } : {}) };
    this.withUv = withUv;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u = 0, v = 0, u2 = 0, v2 = 0): number {
    const f = Math.fround;
    const key = this.withUv ? `${x},${y},${z},${f(nx)},${f(ny)},${f(nz)},${f(u)},${f(v)},${f(u2)},${f(v2)}` : `${x},${y},${z},${f(nx)},${f(ny)},${f(nz)}`;
    const old = this.ids.get(key);
    if (old !== undefined) return old;
    const id = this.mesh.pos.length / 3;
    // positions are exact float32 numbers after the snap; the rest is stored as the float32 the file will hold
    this.mesh.pos.push(x, y, z);
    this.mesh.nrm.push(f(nx), f(ny), f(nz));
    if (this.withUv) {
      this.mesh.uv!.push(f(u), f(v));
      this.mesh.uv2!.push(f(u2), f(v2));
    }
    this.ids.set(key, id);
    return id;
  }
}

export class WorldCutter {
  private readonly bins = new Map<string, TileBin>();
  private readonly roads: SourceMesh[] = [];
  private readonly shells: Shell[] = [];
  /** Block metres to world metres. */
  readonly offset: P2;
  constructor(offset: P2) {
    this.offset = offset;
  }

  private bin(tx: number, tz: number): TileBin {
    const key = tileId(tx, tz);
    let b = this.bins.get(key);
    if (!b) this.bins.set(key, (b = { tx, tz, road: new Map(), ground: null, shells: [] }));
    return b;
  }

  /** Road builder meshes (block metres). Triangles go to the tile of their centre. */
  addRoad(meshes: Iterable<SourceMesh>): void {
    const { x: ox, z: oz } = this.offset;
    for (const m of meshes) {
      const mi = this.roads.length;
      this.roads.push(m);
      const material = MERGED[m.material] ?? m.material;
      for (let t = 0; t * 3 + 2 < m.idx.length; t++) {
        const a = (m.idx[t * 3] as number) * 3;
        const b = (m.idx[t * 3 + 1] as number) * 3;
        const c = (m.idx[t * 3 + 2] as number) * 3;
        const cx = ((m.pos[a] as number) + (m.pos[b] as number) + (m.pos[c] as number)) / 3 + ox;
        const cz = ((m.pos[a + 2] as number) + (m.pos[b + 2] as number) + (m.pos[c + 2] as number)) / 3 + oz;
        const { tx, tz } = tileOf(cx, cz);
        const road = this.bin(tx, tz).road;
        let list = road.get(material);
        if (!list) road.set(material, (list = []));
        list.push(mi, t);
      }
    }
  }

  /** The ground of the terrain step, already cut at the tile lines. */
  addGround(tiles: Iterable<GroundTile>): void {
    for (const g of tiles) this.bin(g.tx, g.tz).ground = g;
  }

  /**
   * Building shells (block metres), each whole in the tile of its anchor. A shell that would reach more than
   * `SHELL_REACH_M` past that tile (a city wall or a station roof 300 to 600 m long) is cut instead: its triangles are
   * halved until no edge is over 50 m and each piece goes to the tile of its own centre, as one part per tile.
   * Returns how many shells were cut.
   */
  addShells(shells: Iterable<Shell>): number {
    let cut = 0;
    for (const s of shells) {
      const { tx, tz } = tileOf(s.anchor.x + this.offset.x, s.anchor.z + this.offset.z);
      if (shellReach(s, tx, tz, this.offset) <= SHELL_REACH_M) {
        this.bin(tx, tz).shells.push(this.shells.length);
        this.shells.push(s);
        continue;
      }
      cut++;
      const parts = new Map<string, Shell>();
      const put = (a: V3, b: V3, c: V3, n: V3): void => {
        const t = tileOf((a[0] + b[0] + c[0]) / 3 + this.offset.x, (a[2] + b[2] + c[2]) / 3 + this.offset.z);
        const key = tileId(t.tx, t.tz);
        let part = parts.get(key);
        if (!part) {
          // the halved pieces carry no facade UV (a shell this long is a station roof or a fort wall)
          part = { ...s, id: `${s.id}#${parts.size}`, anchor: { x: (a[0] + b[0] + c[0]) / 3, z: (a[2] + b[2] + c[2]) / 3 }, tris: [], nrm: [], uv: undefined };
          parts.set(key, part);
        }
        part.tris.push(...a, ...b, ...c);
        part.nrm.push(...n);
      };
      for (let t = 0; t * 9 + 8 < s.tris.length; t++) {
        const at = (i: number): V3 => [s.tris[t * 9 + i * 3] as number, s.tris[t * 9 + i * 3 + 1] as number, s.tris[t * 9 + i * 3 + 2] as number];
        halve(at(0), at(1), at(2), [s.nrm[t * 3] as number, s.nrm[t * 3 + 1] as number, s.nrm[t * 3 + 2] as number], put);
      }
      for (const part of parts.values()) {
        const p = tileOf(part.anchor.x + this.offset.x, part.anchor.z + this.offset.z);
        this.bin(p.tx, p.tz).shells.push(this.shells.length);
        this.shells.push(part);
      }
    }
    return cut;
  }

  /** Tile ids that hold anything, sorted north to south, then west to east. */
  tiles(): { tx: number; tz: number; id: string }[] {
    return [...this.bins.values()].map((b) => ({ tx: b.tx, tz: b.tz, id: tileId(b.tx, b.tz) })).sort((p, q) => p.tz - q.tz || p.tx - q.tx);
  }

  /** The meshes of one tile. */
  cut(tx: number, tz: number): CutTile {
    const bin = this.bins.get(tileId(tx, tz));
    if (!bin) throw new Error(`tile ${tileId(tx, tz)} holds nothing`);
    const { x: ox, z: oz } = this.offset;
    const x0 = tx * TILE_M;
    const z0 = tz * TILE_M;
    // the height origin: the lowest ground of the tile (else the lowest vertex), in whole metres
    let low = Infinity;
    if (bin.ground) for (const m of bin.ground.meshes) for (let i = 1; i < m.pos.length; i += 3) low = Math.min(low, m.pos[i] as number);
    if (low === Infinity) {
      for (const [, list] of bin.road) for (let k = 0; k < list.length; k += 2) {
        const m = this.roads[list[k] as number] as SourceMesh;
        const t = list[k + 1] as number;
        for (let i = 0; i < 3; i++) low = Math.min(low, m.pos[(m.idx[t * 3 + i] as number) * 3 + 1] as number);
      }
      for (const si of bin.shells) low = Math.min(low, (this.shells[si] as Shell).base);
    }
    const y0 = Number.isFinite(low) ? Math.floor(low) : 0;
    const welders = new Map<string, Welder>();
    const uvMaterials = new Set<string>();
    let droppedUv = 0;
    for (const [material, list] of bin.road) {
      for (let k = 0; k < list.length; k += 2) {
        const m = this.roads[list[k] as number] as SourceMesh;
        if (m.uv.length && m.uv.length === (m.pos.length / 3) * 2 && m.uv2.length === m.uv.length) uvMaterials.add(material);
      }
    }
    // generated shells carry a facade UV and their colour and wear in UV2 (P2-009)
    if (bin.shells.some((si) => (this.shells[si] as Shell).tint !== undefined)) uvMaterials.add('building');
    const welder = (material: string): Welder => {
      let w = welders.get(material);
      if (!w) welders.set(material, (w = new Welder(material, uvMaterials.has(material))));
      return w;
    };
    let over = 0;
    const local = (x: number, y: number, z: number): V3 => {
      const lx = snap(x) - x0;
      const lz = snap(z) - z0;
      over = Math.max(over, -lx, lx - TILE_M, -lz, lz - TILE_M);
      return [lx, snap(y) - y0, lz];
    };
    // a triangle the snap turned over or flattened (a needle of under a square millimetre whose corners lie nearly on
    // one line) is left out: its other side would face up, and it covers nothing
    let flipped = 0;
    // (also a needle whose corners the snap left within a millimetre of one line, P1-046: its side is snap noise, a
    // footpath sliver on a widened kerb faced sideways against its vertex normals in the game's reader)
    const keeps = (r: readonly V3[], q: readonly V3[]): boolean => {
      const n1 = cross(r[0]!, r[1]!, r[2]!);
      const n2 = cross(q[0]!, q[1]!, q[2]!);
      const twice = Math.hypot(n2[0], n2[1], n2[2]);
      let longest = 0;
      for (let i = 0; i < 3; i++) {
        const u = q[i]!;
        const v = q[(i + 1) % 3]!;
        longest = Math.max(longest, Math.hypot(v[0] - u[0], v[1] - u[1], v[2] - u[2]));
      }
      const needle = longest > 0 && twice / longest < NEEDLE_M;
      if (!needle && n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2] > 0) return true;
      flipped++;
      return false;
    };
    const raw = (x: number, y: number, z: number): V3 => [x - x0, y - y0, z - z0];
    // ground: x and z are already relative to the tile corner; back to world metres for the one snap rule
    if (bin.ground) {
      for (const m of bin.ground.meshes) {
        const w = welder(m.material);
        for (let k = 0; k + 2 < m.idx.length; k += 3) {
          const vs = [0, 1, 2].map((i) => (m.idx[k + i] as number) * 3);
          const r = vs.map((v) => raw((m.pos[v] as number) + x0, m.pos[v + 1] as number, (m.pos[v + 2] as number) + z0));
          const q = vs.map((v) => local((m.pos[v] as number) + x0, m.pos[v + 1] as number, (m.pos[v + 2] as number) + z0));
          if (!keeps(r, q)) continue;
          vs.forEach((v, i) => w.mesh.idx.push(w.vertex(q[i]![0], q[i]![1], q[i]![2], m.nrm[v] as number, m.nrm[v + 1] as number, m.nrm[v + 2] as number)));
        }
      }
    }
    const seenUv = new Set<SourceMesh>();
    for (const [material, list] of bin.road) {
      const w = welder(material);
      for (let k = 0; k < list.length; k += 2) {
        const m = this.roads[list[k] as number] as SourceMesh;
        const t = list[k + 1] as number;
        const hasUv = m.uv.length === (m.pos.length / 3) * 2 && m.uv2.length === m.uv.length;
        if (!hasUv && m.uv.length && !seenUv.has(m)) {
          seenUv.add(m);
          droppedUv++;
        }
        const vis = [0, 1, 2].map((i) => m.idx[t * 3 + i] as number);
        const r = vis.map((vi) => raw((m.pos[vi * 3] as number) + ox, m.pos[vi * 3 + 1] as number, (m.pos[vi * 3 + 2] as number) + oz));
        const q = vis.map((vi) => local((m.pos[vi * 3] as number) + ox, m.pos[vi * 3 + 1] as number, (m.pos[vi * 3 + 2] as number) + oz));
        if (!keeps(r, q)) continue;
        vis.forEach((vi, i) => {
          const v = vi * 3;
          const p = q[i]!;
          const uv = hasUv ? [m.uv[vi * 2] as number, m.uv[vi * 2 + 1] as number, m.uv2[vi * 2] as number, m.uv2[vi * 2 + 1] as number] : [0, 0, 0, 0];
          w.mesh.idx.push(w.vertex(p[0], p[1], p[2], m.nrm[v] as number, m.nrm[v + 1] as number, m.nrm[v + 2] as number, uv[0], uv[1], uv[2], uv[3]));
        });
      }
    }
    const buildings: CutTile['buildings'] = [];
    if (bin.shells.length) {
      const w = welder('building');
      for (const si of bin.shells) {
        const s = this.shells[si] as Shell;
        const first = w.mesh.idx.length / 3;
        for (let t = 0; t * 9 + 8 < s.tris.length; t++) {
          const n: [number, number, number] = [s.nrm[t * 3] as number, s.nrm[t * 3 + 1] as number, s.nrm[t * 3 + 2] as number];
          const c = [0, 1, 2].map((i) => local((s.tris[t * 9 + i * 3] as number) + ox, s.tris[t * 9 + i * 3 + 1] as number, (s.tris[t * 9 + i * 3 + 2] as number) + oz));
          if (!keeps([0, 1, 2].map((i) => raw((s.tris[t * 9 + i * 3] as number) + ox, s.tris[t * 9 + i * 3 + 1] as number, (s.tris[t * 9 + i * 3 + 2] as number) + oz)), c)) continue;
          const [a, b, d] = c as [V3, V3, V3];
          // Godot front faces: (b - a) x (c - a) points away from the side the normal shows
          const ux = b[0] - a[0];
          const uy = b[1] - a[1];
          const uz = b[2] - a[2];
          const vx = d[0] - a[0];
          const vy = d[1] - a[1];
          const vz = d[2] - a[2];
          const facing = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
          const uvOf = (i: number): [number, number] => (s.uv ? [s.uv[t * 6 + i * 2] as number, s.uv[t * 6 + i * 2 + 1] as number] : [0, 0]);
          const corners: [V3, [number, number]][] = facing > 0 ? [[a, uvOf(0)], [d, uvOf(2)], [b, uvOf(1)]] : [[a, uvOf(0)], [b, uvOf(1)], [d, uvOf(2)]];
          for (const [p, uv] of corners) w.mesh.idx.push(w.vertex(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1], s.tint ?? 0, s.wear ?? 0));
        }
        buildings.push({ id: s.id, first, end: w.mesh.idx.length / 3 });
      }
    }
    const rank = (m: string): number => {
      const i = MATERIAL_ORDER.indexOf(m);
      return i < 0 ? MATERIAL_ORDER.length : i;
    };
    const meshes = [...welders.values()].map((w) => w.mesh).filter((m) => m.idx.length > 0).sort((p, q) => rank(p.material) - rank(q.material) || (p.material < q.material ? -1 : p.material > q.material ? 1 : 0));
    return { tx, tz, id: tileId(tx, tz), origin: [x0, y0, z0], meshes, buildings, overhangM: Math.max(0, over), droppedUv, flipped };
  }
}

/** How far a shell would reach past the square of tile (tx, tz) (m). */
function shellReach(s: Shell, tx: number, tz: number, offset: P2): number {
  let over = 0;
  for (let i = 0; i + 2 < s.tris.length; i += 3) {
    const x = (s.tris[i] as number) + offset.x - tx * TILE_M;
    const z = (s.tris[i + 2] as number) + offset.z - tz * TILE_M;
    over = Math.max(over, -x, x - TILE_M, -z, z - TILE_M);
  }
  return over;
}

/** Halves a triangle across its longest edge until no edge is over `HALVE_M` (the pieces keep the plane and the winding). */
function halve(a: V3, b: V3, c: V3, n: V3, put: (a: V3, b: V3, c: V3, n: V3) => void): void {
  const d = (p: V3, q: V3): number => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const ab = d(a, b);
  const bc = d(b, c);
  const ca = d(c, a);
  const m = Math.max(ab, bc, ca);
  if (m <= HALVE_M) return put(a, b, c, n);
  const mid = (p: V3, q: V3): V3 => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
  if (m === ab) {
    const e = mid(a, b);
    halve(a, e, c, n, put);
    halve(e, b, c, n, put);
  } else if (m === bc) {
    const e = mid(b, c);
    halve(a, b, e, n, put);
    halve(a, e, c, n, put);
  } else {
    const e = mid(c, a);
    halve(a, b, e, n, put);
    halve(e, b, c, n, put);
  }
}

/** A shell that reaches farther than this past its tile is cut into parts (m); the tile margin is 250 m. */
export const SHELL_REACH_M = 200;
const HALVE_M = 50;

/** The world tile of a block point. */
export const worldTileOf = (p: P2, offset: P2): { tx: number; tz: number } => tileOf(p.x + offset.x, p.z + offset.z);
