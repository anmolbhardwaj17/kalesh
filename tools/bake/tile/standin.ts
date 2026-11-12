// Stand-in tile content of the Phase 0 data bench (P0-018, harness/bench/pilot_data/tiles.mjs): simple geometry from
// real map data (road ribbons, extruded footprints, a ground grid) in the final file form, and the MeshBuilder the
// cutters share. Moved here from tools/bake/tile.ts in P1-016; the production tiles are tools/bake/tile/write.ts.
// Pure.
import { triangulate } from '../geom.ts';
import type { P2 } from '../geom.ts';
import type { Footprint, Road } from '../osm.ts';
import { tileOf } from '../layout/grid.ts';
import type { ColliderChunk, MeshData, TileContent } from './codec.ts';

export interface TileInput {
  district: string;
  tx: number;
  tz: number;
  size: number;
  roads: readonly Road[];
  buildings: readonly Footprint[];
  /** Ground height in metres at district metres (x, z). */
  ground: (x: number, z: number) => number;
  /** Collider chunks per side (4 gives 16 chunks per tile). */
  chunks?: number;
  /** Also write facade module placements (one every 3 m of wall per floor). */
  placements?: boolean;
  /** Ground grid cell in metres. */
  groundCell?: number;
}

type V3 = [number, number, number];

const FLOOR_M = 3.2;
const DEFAULT_HEIGHT = 9;

export const buildingHeight = (b: Footprint): number => (b.height !== null && b.height > 2 ? b.height : b.levels !== null && b.levels >= 1 ? b.levels * FLOOR_M : DEFAULT_HEIGHT);

// Tile indices come from the one world grid (tools/bake/layout/grid.ts); the Phase 0 benches pass a size and metres
// of their own frame.
export { tileOf };

export class MeshBuilder {
  readonly mesh: MeshData;
  constructor(name: string, material: string) {
    this.mesh = { name, material, pos: [], nrm: [], idx: [] };
  }

  /** A triangle with a flat normal n, wound clockwise seen from the side n points to. */
  tri(a: V3, b: V3, c: V3, n: V3): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const facing = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
    const base = this.mesh.pos.length / 3;
    // Godot: for a front face (b - a) x (c - a) points away from the viewer
    const order = facing > 0 ? [a, c, b] : [a, b, c];
    for (const p of order) {
      this.mesh.pos.push(p[0], p[1], p[2]);
      this.mesh.nrm.push(n[0], n[1], n[2]);
    }
    this.mesh.idx.push(base, base + 1, base + 2);
  }

  quad(a: V3, b: V3, c: V3, d: V3, n: V3): void {
    this.tri(a, b, c, n);
    this.tri(a, c, d, n);
  }
}

/** Stand-in tile from real data: a ground grid, one ribbon per road segment, one extruded prism per footprint. */
export function buildTile(input: TileInput): TileContent {
  const { size, tx, tz } = input;
  const x0 = tx * size;
  const z0 = tz * size;
  const cell = input.groundCell ?? 12.5;
  const n = Math.round(size / cell);
  const heights: number[] = [];
  let low = Infinity;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const h = input.ground(x0 + i * cell, z0 + j * cell);
      heights.push(h);
      if (h < low) low = h;
    }
  }
  const y0 = Math.floor(low);
  const local = (x: number, z: number): { x: number; z: number; y: number } => ({ x: x - x0, z: z - z0, y: input.ground(x, z) - y0 });

  const ground = new MeshBuilder('ground', 'ground');
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const h = (di: number, dj: number) => (heights[(j + dj) * (n + 1) + i + di] as number) - y0;
      ground.quad([i * cell, h(0, 0), j * cell], [(i + 1) * cell, h(1, 0), j * cell], [(i + 1) * cell, h(1, 1), (j + 1) * cell], [i * cell, h(0, 1), (j + 1) * cell], [0, 1, 0]);
    }
  }

  const roads = new MeshBuilder('roads', 'road');
  for (const r of input.roads) {
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const a = r.pts[i] as P2;
      const b = r.pts[i + 1] as P2;
      const mid = tileOf((a.x + b.x) / 2, (a.z + b.z) / 2, size);
      if (mid.tx !== tx || mid.tz !== tz) continue;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 0.01) continue;
      const nx = (-(b.z - a.z) / len) * (r.width / 2);
      const nz = ((b.x - a.x) / len) * (r.width / 2);
      const lift = 0.05 + (r.bridge ? 6 * Math.max(1, r.layer) : 0);
      const pa = local(a.x, a.z);
      const pb = local(b.x, b.z);
      roads.quad([pa.x - nx, pa.y + lift, pa.z - nz], [pa.x + nx, pa.y + lift, pa.z + nz], [pb.x + nx, pb.y + lift, pb.z + nz], [pb.x - nx, pb.y + lift, pb.z - nz], [0, 1, 0]);
    }
  }

  const shells = new MeshBuilder('buildings', 'building');
  const facade: number[] = [];
  for (const b of input.buildings) {
    const t = tileOf(b.centre.x, b.centre.z, size);
    if (t.tx !== tx || t.tz !== tz) continue;
    const c = local(b.centre.x, b.centre.z);
    const base = c.y - 0.3;
    const top = c.y + buildingHeight(b);
    const ring = b.ring.map((p) => ({ x: p.x - x0, z: p.z - z0 }));
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i] as P2;
      const q = ring[(i + 1) % ring.length] as P2;
      const len = Math.hypot(q.x - p.x, q.z - p.z);
      if (len < 0.01) continue;
      // outward: away from the centroid
      let nx = (q.z - p.z) / len;
      let nz = -(q.x - p.x) / len;
      if (nx * ((p.x + q.x) / 2 - c.x) + nz * ((p.z + q.z) / 2 - c.z) < 0) {
        nx = -nx;
        nz = -nz;
      }
      shells.quad([p.x, base, p.z], [q.x, base, q.z], [q.x, top, q.z], [p.x, top, p.z], [nx, 0, nz]);
      if (input.placements) {
        const along = Math.floor(len / 3);
        const floors = Math.max(1, Math.round((top - c.y) / FLOOR_M));
        const ux = (q.x - p.x) / len;
        const uz = (q.z - p.z) / len;
        for (let k = 0; k < along; k++) {
          for (let f = 0; f < floors; f++) {
            const ox = p.x + ux * (k + 0.5) * 3;
            const oz = p.z + uz * (k + 0.5) * 3;
            // basis columns: x along the wall, y up, z outward; MultiMesh rows carry the origin in the fourth place
            facade.push(ux, 0, nx, ox, 0, 1, 0, c.y + f * FLOOR_M, uz, 0, nz, oz);
          }
        }
      }
    }
    const tris = triangulate(ring);
    for (let k = 0; k + 2 < tris.length; k += 3) {
      const a = ring[tris[k] as number] as P2;
      const d = ring[tris[k + 1] as number] as P2;
      const e = ring[tris[k + 2] as number] as P2;
      shells.tri([a.x, top, a.z], [d.x, top, d.z], [e.x, top, e.z], [0, 1, 0]);
    }
  }

  // collider chunks: every triangle of the surfaces and shells goes to the chunk of its centre
  const per = input.chunks ?? 4;
  const chunkSize = size / per;
  const chunks: ColliderChunk[] = [];
  for (let j = 0; j < per; j++) for (let i = 0; i < per; i++) chunks.push({ name: `col_${i}_${j}`, faces: [] });
  for (const m of [ground.mesh, roads.mesh, shells.mesh]) {
    for (let k = 0; k + 2 < m.idx.length; k += 3) {
      const ia = (m.idx[k] as number) * 3;
      const ib = (m.idx[k + 1] as number) * 3;
      const ic = (m.idx[k + 2] as number) * 3;
      const cx = ((m.pos[ia] as number) + (m.pos[ib] as number) + (m.pos[ic] as number)) / 3;
      const cz = ((m.pos[ia + 2] as number) + (m.pos[ib + 2] as number) + (m.pos[ic + 2] as number)) / 3;
      const ci = Math.min(per - 1, Math.max(0, Math.floor(cx / chunkSize)));
      const cj = Math.min(per - 1, Math.max(0, Math.floor(cz / chunkSize)));
      const faces = (chunks[cj * per + ci] as ColliderChunk).faces;
      for (const o of [ia, ib, ic]) faces.push(m.pos[o] as number, m.pos[o + 1] as number, m.pos[o + 2] as number);
    }
  }
  return {
    district: input.district, tx, tz, size, origin: [x0, y0, z0],
    meshes: [ground.mesh, roads.mesh, shells.mesh].filter((m) => m.idx.length > 0),
    colliders: chunks.filter((c) => c.faces.length > 0),
    placements: facade.length ? [{ module: 'facade_bay', xforms: facade }] : [],
  };
}

export function tileStats(t: TileContent): { vertices: number; triangles: number; colliderTriangles: number; colliderChunks: number; placements: number } {
  return {
    vertices: t.meshes.reduce((s, m) => s + m.pos.length / 3, 0), triangles: t.meshes.reduce((s, m) => s + m.idx.length / 3, 0),
    colliderTriangles: t.colliders.reduce((s, c) => s + c.faces.length / 9, 0), colliderChunks: t.colliders.length,
    placements: t.placements.reduce((s, p) => s + p.xforms.length / 12, 0),
  };
}

