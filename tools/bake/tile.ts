// Tile content and tile files of the offline bake (ARCH_OPTIONS T1, T3, ST1). A tile holds final data: merged
// meshes per material, collider chunks and module placements, with vertices relative to the tile's own origin
// (FP1). buildTile makes simple stand-in geometry from real map data (road ribbons, extruded footprints, a ground
// grid); the lane model and the area generator replace it later and keep the same file form.
//
// T1 file ("KTL1"), little endian:
//   bytes 0..3   "KTL1"
//   u32          version (1)
//   u32          header length in bytes (JSON, ASCII, padded with spaces to a multiple of 4)
//   header       { tile, origin, meshes[], colliders[], placements[] }: every array names its offset into the payload
//   payload      float32 and uint32 arrays, each starting on a multiple of 4 bytes
// Godot reads the header with JSON.parse and turns each array into a packed array in one call
// (PackedByteArray.to_vector3_array, to_int32_array, to_float32_array): no per-vertex script work.
import { triangulate } from './geom.ts';
import type { P2 } from './geom.ts';
import type { Footprint, Road } from './osm.ts';

export interface MeshData {
  name: string;
  material: string;
  /** x, y, z per vertex, metres from the tile origin. */
  pos: number[];
  nrm: number[];
  /** Three indices per triangle, clockwise seen from the front (Godot's front face). */
  idx: number[];
}

export interface ColliderChunk {
  name: string;
  /** Nine numbers per triangle (three corners), metres from the tile origin. */
  faces: number[];
}

export interface Placement {
  module: string;
  /** Twelve numbers per instance in MultiMesh buffer order: the basis rows, each followed by the origin's part. */
  xforms: number[];
}

export interface TileContent {
  district: string;
  tx: number;
  tz: number;
  size: number;
  /** District metres of the tile's north-west corner at its lowest ground height: vertices are relative to it. */
  origin: [number, number, number];
  meshes: MeshData[];
  colliders: ColliderChunk[];
  placements: Placement[];
}

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

/** Tile indices of a point in district metres. */
export function tileOf(x: number, z: number, size: number): { tx: number; tz: number } {
  return { tx: Math.floor(x / size), tz: Math.floor(z / size) };
}

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

// ------------------------------------------------------------------ T1: our own binary tile

const MAGIC = [0x4b, 0x54, 0x4c, 0x31]; // "KTL1"

function ascii(text: string): Uint8Array {
  const safe = text.replace(/[\u0080-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const out = new Uint8Array(safe.length);
  for (let i = 0; i < safe.length; i++) out[i] = safe.charCodeAt(i);
  return out;
}

function asciiText(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + 8192)));
  return s;
}

export interface T1Header {
  format: 'KTL1';
  tile: { district: string; x: number; z: number; size: number };
  origin: [number, number, number];
  meshes: { name: string; material: string; vertices: number; indices: number; pos: number; nrm: number; idx: number }[];
  colliders: { name: string; triangles: number; faces: number }[];
  placements: { module: string; count: number; xforms: number }[];
}

export function encodeT1(t: TileContent): Uint8Array {
  const parts: { offset: number; f32?: number[]; u32?: number[] }[] = [];
  let at = 0;
  const f32 = (a: number[]): number => {
    const offset = at;
    parts.push({ offset, f32: a });
    at += a.length * 4;
    return offset;
  };
  const u32 = (a: number[]): number => {
    const offset = at;
    parts.push({ offset, u32: a });
    at += a.length * 4;
    return offset;
  };
  const header: T1Header = {
    format: 'KTL1', tile: { district: t.district, x: t.tx, z: t.tz, size: t.size }, origin: t.origin,
    meshes: t.meshes.map((m) => ({ name: m.name, material: m.material, vertices: m.pos.length / 3, indices: m.idx.length, pos: f32(m.pos), nrm: f32(m.nrm), idx: u32(m.idx) })),
    colliders: t.colliders.map((c) => ({ name: c.name, triangles: c.faces.length / 9, faces: f32(c.faces) })),
    placements: t.placements.map((p) => ({ module: p.module, count: p.xforms.length / 12, xforms: f32(p.xforms) })),
  };
  let json = JSON.stringify(header);
  while (json.length % 4 !== 0) json += ' ';
  const head = ascii(json);
  const out = new Uint8Array(12 + head.length + at);
  const view = new DataView(out.buffer);
  out.set(MAGIC, 0);
  view.setUint32(4, 1, true);
  view.setUint32(8, head.length, true);
  out.set(head, 12);
  const base = 12 + head.length;
  for (const p of parts) {
    if (p.f32) for (let i = 0; i < p.f32.length; i++) view.setFloat32(base + p.offset + i * 4, p.f32[i] as number, true);
    if (p.u32) for (let i = 0; i < p.u32.length; i++) view.setUint32(base + p.offset + i * 4, p.u32[i] as number, true);
  }
  return out;
}

/** Reads a T1 file back (the bake's own check and the tests; Godot has its own reader). */
export function decodeT1(bytes: Uint8Array): { header: T1Header; f32(offset: number, count: number): Float32Array; u32(offset: number, count: number): Uint32Array } {
  for (let i = 0; i < 4; i++) if (bytes[i] !== MAGIC[i]) throw new Error('not a KTL1 tile');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4, true);
  if (version !== 1) throw new Error(`KTL1 version ${version} is not supported`);
  const headLen = view.getUint32(8, true);
  const header = JSON.parse(asciiText(bytes.subarray(12, 12 + headLen))) as T1Header;
  const base = 12 + headLen;
  return {
    header,
    f32: (offset, count) => {
      const out = new Float32Array(count);
      for (let i = 0; i < count; i++) out[i] = view.getFloat32(base + offset + i * 4, true);
      return out;
    },
    u32: (offset, count) => {
      const out = new Uint32Array(count);
      for (let i = 0; i < count; i++) out[i] = view.getUint32(base + offset + i * 4, true);
      return out;
    },
  };
}

// ------------------------------------------------------------------ T3: glTF binary (.glb)

/** The same tile as a .glb: one node per material mesh, collider chunks as extra mesh nodes named col_*. */
export function encodeGlb(t: TileContent): Uint8Array {
  const views: { byteOffset: number; byteLength: number; target?: number }[] = [];
  const accessors: Record<string, unknown>[] = [];
  const chunks: { offset: number; f32?: number[]; u32?: number[] }[] = [];
  let at = 0;
  const add = (data: number[], kind: 'f32' | 'u32', target?: number): number => {
    views.push({ byteOffset: at, byteLength: data.length * 4, ...(target ? { target } : {}) });
    chunks.push(kind === 'f32' ? { offset: at, f32: data } : { offset: at, u32: data });
    at += data.length * 4;
    return views.length - 1;
  };
  const vec3 = (data: number[], withBounds: boolean): number => {
    const acc: Record<string, unknown> = { bufferView: add(data, 'f32', 34962), componentType: 5126, count: data.length / 3, type: 'VEC3' };
    if (withBounds) {
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < data.length; i++) {
        const v = Math.fround(data[i] as number);
        if (v < (min[i % 3] as number)) min[i % 3] = v;
        if (v > (max[i % 3] as number)) max[i % 3] = v;
      }
      acc['min'] = min;
      acc['max'] = max;
    }
    accessors.push(acc);
    return accessors.length - 1;
  };
  const indices = (data: number[]): number => {
    accessors.push({ bufferView: add(data, 'u32', 34963), componentType: 5125, count: data.length, type: 'SCALAR' });
    return accessors.length - 1;
  };
  // glTF front faces are counter-clockwise: swap two corners of every triangle
  const flip = (idx: number[]): number[] => {
    const out = idx.slice();
    for (let i = 0; i + 2 < out.length; i += 3) {
      const b = out[i + 1] as number;
      out[i + 1] = out[i + 2] as number;
      out[i + 2] = b;
    }
    return out;
  };
  const materials = [...new Set(t.meshes.map((m) => m.material))];
  const meshes: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];
  for (const m of t.meshes) {
    meshes.push({ name: m.name, primitives: [{ attributes: { POSITION: vec3(m.pos, true), NORMAL: vec3(m.nrm, false) }, indices: indices(flip(m.idx)), material: materials.indexOf(m.material) }] });
    nodes.push({ name: m.name, mesh: meshes.length - 1 });
  }
  for (const c of t.colliders) {
    const idx: number[] = [];
    for (let i = 0; i < c.faces.length / 3; i++) idx.push(i);
    meshes.push({ name: c.name, primitives: [{ attributes: { POSITION: vec3(c.faces, true) }, indices: indices(flip(idx)) }] });
    nodes.push({ name: c.name, mesh: meshes.length - 1 });
  }
  const gltf = {
    asset: { version: '2.0', generator: 'tools/bake/tile.ts' }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes,
    materials: materials.map((name) => ({ name, pbrMetallicRoughness: { baseColorFactor: [0.7, 0.7, 0.7, 1], metallicFactor: 0, roughnessFactor: 0.9 } })),
    accessors, bufferViews: views.map((v) => ({ buffer: 0, ...v })), buffers: [{ byteLength: at }],
    extras: { tile: { district: t.district, x: t.tx, z: t.tz, size: t.size }, origin: t.origin },
  };
  let json = JSON.stringify(gltf);
  while (json.length % 4 !== 0) json += ' ';
  const head = ascii(json);
  const total = 12 + 8 + head.length + 8 + at;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, head.length, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(head, 20);
  const bin = 20 + head.length;
  view.setUint32(bin, at, true);
  view.setUint32(bin + 4, 0x004e4942, true); // "BIN"
  for (const c of chunks) {
    if (c.f32) for (let i = 0; i < c.f32.length; i++) view.setFloat32(bin + 8 + c.offset + i * 4, c.f32[i] as number, true);
    if (c.u32) for (let i = 0; i < c.u32.length; i++) view.setUint32(bin + 8 + c.offset + i * 4, c.u32[i] as number, true);
  }
  return out;
}
