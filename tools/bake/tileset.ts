// The world tile cutter (FP1, ST1; TECH.md "Tile format"): triangles in world metres are sorted into the 250 m tiles
// of the one world grid (tools/bake/layout/grid.ts), with every vertex stored relative to its tile's own origin, so
// 32-bit floats stay fine far from the world origin. Moved here in P1-008 from the Phase 0 stitch bench
// (tools/bake/stitch/world.ts); the island parts of that file (the filler ground lattice between districts, the
// stand-in river bed, connector verges) are retired. `ribbon` and `prism` are simple shapes for tests and stand-ins.
// Pure: no file access.
import { pointInRing, triangulate } from './geom.ts';
import type { P2 } from './geom.ts';
import { TILE_M, tileOf, tileOrigin } from './layout/grid.ts';
import { MeshBuilder } from './tile/standin.ts';
import type { MeshData, TileContent } from './tile/codec.ts';

export type V3 = [number, number, number];
/** Side of a world tile, metres (the one world grid). */
export const TILE = TILE_M;

/** Triangles in world metres, sorted into 250 m world tiles per layer. A layer (a block id) becomes the tile's `district` field. */
export class TileSet {
  private readonly tiles = new Map<string, { layer: string; tx: number; tz: number; meshes: Map<string, MeshBuilder> }>();
  readonly yBase: number;
  constructor(yBase: number) {
    this.yBase = yBase;
  }

  /** A triangle goes to the tile of its centre, or to the tile of `anchor` (a small object that must stay whole). */
  tri(layer: string, material: string, a: V3, b: V3, c: V3, n: V3, name = material, anchor?: P2): void {
    const { tx, tz } = anchor ? tileOf(anchor.x, anchor.z) : tileOf((a[0] + b[0] + c[0]) / 3, (a[2] + b[2] + c[2]) / 3);
    const key = `${layer}|${tx}|${tz}`;
    let tile = this.tiles.get(key);
    if (!tile) {
      tile = { layer, tx, tz, meshes: new Map() };
      this.tiles.set(key, tile);
    }
    let mesh = tile.meshes.get(name);
    if (!mesh) {
      mesh = new MeshBuilder(name, material);
      tile.meshes.set(name, mesh);
    }
    const { x: x0, z: z0 } = tileOrigin(tx, tz);
    const y0 = this.yBase;
    mesh.tri([a[0] - x0, a[1] - y0, a[2] - z0], [b[0] - x0, b[1] - y0, b[2] - z0], [c[0] - x0, c[1] - y0, c[2] - z0], n);
  }

  quad(layer: string, material: string, a: V3, b: V3, c: V3, d: V3, n: V3, name = material, anchor?: P2): void {
    this.tri(layer, material, a, b, c, n, name, anchor);
    this.tri(layer, material, a, c, d, n, name, anchor);
  }

  /** Tile content per layer and tile: origin is the tile's north-west corner in world metres at the height base. */
  contents(): TileContent[] {
    const out: TileContent[] = [];
    for (const t of this.tiles.values()) {
      const meshes: MeshData[] = [...t.meshes.values()].map((m) => m.mesh);
      out.push({ district: t.layer, tx: t.tx, tz: t.tz, size: TILE, origin: [t.tx * TILE, this.yBase, t.tz * TILE], meshes, colliders: [], placements: [] });
    }
    out.sort((a, b) => (a.district < b.district ? -1 : a.district > b.district ? 1 : a.tz - b.tz || a.tx - b.tx));
    return out;
  }
}

/** A road ribbon along a polyline: one mitred strip, `lift` metres above the ground. */
export function ribbon(set: TileSet, layer: string, material: string, pts: readonly P2[], width: number, ground: (x: number, z: number) => number, lift: number): void {
  if (pts.length < 2) return;
  const half = width / 2;
  const left: V3[] = [];
  const right: V3[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as P2;
    const a = pts[Math.max(0, i - 1)] as P2;
    const b = pts[Math.min(pts.length - 1, i + 1)] as P2;
    // the normal at a vertex: the mean of the two segment normals, stretched so the strip keeps its width (clamped)
    const d1 = i > 0 ? Math.hypot(p.x - a.x, p.z - a.z) || 1 : 0;
    const d2 = i + 1 < pts.length ? Math.hypot(b.x - p.x, b.z - p.z) || 1 : 0;
    let nx = 0;
    let nz = 0;
    if (d1 > 0) {
      nx += (p.z - a.z) / d1;
      nz += -(p.x - a.x) / d1;
    }
    if (d2 > 0) {
      nx += (b.z - p.z) / d2;
      nz += -(b.x - p.x) / d2;
    }
    const len = Math.hypot(nx, nz);
    if (len < 1e-9) {
      nx = 0;
      nz = 1;
    } else {
      nx /= len;
      nz /= len;
    }
    const cos = d1 > 0 && d2 > 0 ? Math.max(0.5, len / 2) : 1;
    const w = half / cos;
    // level across: the highest ground under the centre and the two edges, so no edge dips into a slope
    const y = Math.max(ground(p.x, p.z), ground(p.x + nx * w, p.z + nz * w), ground(p.x - nx * w, p.z - nz * w)) + lift;
    left.push([p.x + nx * w, y, p.z + nz * w]);
    right.push([p.x - nx * w, y, p.z - nz * w]);
  }
  for (let i = 0; i + 1 < pts.length; i++) set.quad(layer, material, left[i] as V3, left[i + 1] as V3, right[i + 1] as V3, right[i] as V3, [0, 1, 0]);
}

/** An extruded footprint: walls and a flat roof. */
export function prism(set: TileSet, layer: string, material: string, ring: readonly P2[], base: number, top: number, name = material, anchor?: P2): void {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i] as P2;
    const b = ring[(i + 1) % n] as P2;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-6) continue;
    // outward: away from the ring's inside; the mid point of the edge pushed along the normal must lie outside
    let nx = (b.z - a.z) / len;
    let nz = -(b.x - a.x) / len;
    if (pointInRing({ x: (a.x + b.x) / 2 + nx * 0.05, z: (a.z + b.z) / 2 + nz * 0.05 }, ring)) {
      nx = -nx;
      nz = -nz;
    }
    set.quad(layer, material, [a.x, base, a.z], [b.x, base, b.z], [b.x, top, b.z], [a.x, top, a.z], [nx, 0, nz], name, anchor);
  }
  const idx = triangulate(ring);
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const p = ring[idx[i] as number] as P2;
    const q = ring[idx[i + 1] as number] as P2;
    const r = ring[idx[i + 2] as number] as P2;
    set.tri(layer, material, [p.x, top, p.z], [q.x, top, q.z], [r.x, top, r.z], [0, 1, 0], name, anchor);
  }
}
