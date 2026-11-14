// The T1 tile file "KTL1" (ARCH_OPTIONS T1, TECH.md "Tile format (T1, KTL1)"): the codec the bake writes and checks
// its own output with. Godot has its own reader (game/bench/tiles/tile_t1.gd), the map inspector another
// (tools/inspector/ktl1.ts); the fixture harness/data/fixtures/tile_t1_sample.json ties them together. Moved here
// from tools/bake/tile.ts in P1-016. Pure.
//
// Little endian:
//   bytes 0..3   "KTL1"
//   u32          version (1)
//   u32          header length in bytes (JSON, ASCII, padded with spaces to a multiple of 4)
//   header       { format, tile, origin, margin, meshes[], colliders[], placements[], lanes, pins[], nav, life }:
//                every array names its offset into the payload
//   payload      float32 and uint32 arrays, each starting on a multiple of 4 bytes
// Godot reads the header with JSON.parse and turns each array into a packed array in one call
// (PackedByteArray.to_vector3_array, to_int32_array, to_float32_array): no per-vertex script work.
//
// The format grows by header keys only (a reader ignores the keys it does not know), so the version stays 1 while
// the arrays stay what they are. `nav`, `life` and `placements` are reserved for P2 and P3 (null or empty).

export interface MeshData {
  name: string;
  material: string;
  /** x, y, z per vertex, metres from the tile origin. */
  pos: number[];
  nrm: number[];
  /** Three indices per triangle, clockwise seen from the front (Godot's front face). */
  idx: number[];
  /** Optional: u, v per vertex (the lane UV of the road mesh). */
  uv?: number[];
  /** Optional: two codes per vertex (the lane border codes of the road mesh). */
  uv2?: number[];
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
  /** Optional custom data, one uint32 per instance: the wall colour and the grime wear as 0xRRGGBBWW (P2-009). */
  data?: number[];
}

/** One piece of the lane graph inside a tile: a driving lane cut at the tile lines, or a junction path. */
export interface TileLane {
  id: string;
  kind: 'lane' | 'path';
  /** The whole lane or path this piece belongs to (the lane graph id of lane_graph.json). */
  of: string;
  /** Piece number along the whole lane (0 for a path). */
  part: number;
  cls: string;
  widthM: number;
  layer: number;
  /** Ids of the pieces that follow at the far end (in this tile or another). */
  next: string[];
  /** Both ways (one shared lane): pieces that follow at the near end. */
  back?: string[];
  gali?: true;
  /** Who may use it (P2-042, graph/access.ts MODES); absent in tiles written before. */
  modes?: string[];
  /** Allowed but private: never a through route for traffic. */
  private?: true;
  /** Path only: its junction, the turn and whether traffic stops before it. */
  junction?: string;
  turn?: string;
  stop?: boolean;
  /** x, y, z per point, metres from the tile origin, in the direction of travel. */
  pts: number[];
}

/** A named anchor (a landmark or a place, later mission anchors): position in metres from the tile origin. */
export interface TilePin {
  id: string;
  name: string;
  kind: string;
  pos: [number, number, number];
  /** A landmark pin (kind `landmark`, P2-006): its tier, how it is placed, the compass bearing its front faces, its height. */
  tier?: string;
  mode?: string;
  yaw?: number;
  height?: number;
  underground?: boolean;
  worship?: boolean;
}

export interface TileContent {
  /** The block id (the header calls it `district`, as the Phase 0 readers do). */
  district: string;
  tx: number;
  tz: number;
  size: number;
  /** World metres of the tile's north-west corner, y at its lowest ground height: vertices are relative to it. */
  origin: [number, number, number];
  meshes: MeshData[];
  colliders: ColliderChunk[];
  placements: Placement[];
  lanes?: TileLane[];
  pins?: TilePin[];
  /** How far past the tile square a vertex may lie (m); absent: no magnitude check is written for the reader. */
  margin?: number;
}

export const KTL1_VERSION = 1;
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

export interface T1MeshHeader {
  name: string;
  material: string;
  vertices: number;
  indices: number;
  pos: number;
  nrm: number;
  idx: number;
  uv?: number;
  uv2?: number;
}

export interface T1LaneHeader {
  id: string;
  kind: 'lane' | 'path';
  of: string;
  part: number;
  cls: string;
  widthM: number;
  layer: number;
  next: string[];
  back?: string[];
  gali?: true;
  modes?: string[];
  private?: true;
  junction?: string;
  turn?: string;
  stop?: boolean;
  /** First point in the lanes point array and the number of points. */
  start: number;
  count: number;
}

export interface T1Header {
  format: 'KTL1';
  tile: { district: string; x: number; z: number; size: number };
  origin: [number, number, number];
  /** How far past the tile square a vertex may lie (m); null: not checked (bench tiles). */
  margin: number | null;
  meshes: T1MeshHeader[];
  colliders: { name: string; triangles: number; faces: number }[];
  placements: { module: string; count: number; xforms: number; data?: number }[];
  /** The lane pieces of the tile and one float32 array of their points (x, y, z). */
  lanes: { points: number; pts: number; list: T1LaneHeader[] };
  pins: TilePin[];
  /** Reserved for P2 (navmesh) and P3 (life spawn points). */
  nav: null;
  life: null;
}

/** A vertex outside the tile square plus its margin, or not a number (the old game's silent coordinate faults). */
export interface BadVertex {
  array: string;
  index: number;
  value: [number, number, number];
}

/**
 * The magnitude rule: the first vertex of a position array that is not finite or lies outside the tile square
 * plus `margin` in x and z (and outside +-`margin * 8` in y), or null.
 */
export function badVertex(array: string, pos: ArrayLike<number>, size: number, margin: number): BadVertex | null {
  const lo = -margin;
  const hi = size + margin;
  const yLim = margin * 8;
  for (let i = 0; i + 2 < pos.length; i += 3) {
    const x = pos[i] as number;
    const y = pos[i + 1] as number;
    const z = pos[i + 2] as number;
    if (!(x >= lo && x <= hi && z >= lo && z <= hi && y >= -yLim && y <= yLim)) return { array, index: i / 3, value: [x, y, z] };
  }
  return null;
}

/** The origins of a placement's instances (places 3, 7 and 11 of each twelve) as x, y, z. */
export function placementOrigins(xforms: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i + 11 < xforms.length; i += 12) out.push(xforms[i + 3] as number, xforms[i + 7] as number, xforms[i + 11] as number);
  return out;
}

/** Every vertex array of a tile through the magnitude rule (meshes, colliders, lanes, pins): the bad ones. */
export function tileBadVertices(t: TileContent, margin: number): BadVertex[] {
  const out: BadVertex[] = [];
  const add = (b: BadVertex | null): void => {
    if (b) out.push(b);
  };
  for (const m of t.meshes) add(badVertex(`mesh ${m.name}`, m.pos, t.size, margin));
  for (const c of t.colliders) add(badVertex(`collider ${c.name}`, c.faces, t.size, margin));
  for (const l of t.lanes ?? []) add(badVertex(`lane ${l.id}`, l.pts, t.size, margin));
  for (const p of t.pins ?? []) add(badVertex(`pin ${p.id}`, p.pos, t.size, margin));
  for (const p of t.placements) add(badVertex(`placement ${p.module}`, placementOrigins(p.xforms), t.size, margin));
  return out;
}

export function encodeT1(t: TileContent): Uint8Array {
  const parts: { offset: number; f32?: readonly number[]; u32?: readonly number[] }[] = [];
  let at = 0;
  const f32 = (a: readonly number[]): number => {
    const offset = at;
    parts.push({ offset, f32: a });
    at += a.length * 4;
    return offset;
  };
  const u32 = (a: readonly number[]): number => {
    const offset = at;
    parts.push({ offset, u32: a });
    at += a.length * 4;
    return offset;
  };
  const meshes: T1MeshHeader[] = t.meshes.map((m) => {
    const n = m.pos.length / 3;
    if (m.nrm.length !== m.pos.length) throw new Error(`mesh ${m.name}: ${m.nrm.length / 3} normals for ${n} vertices`);
    const h: T1MeshHeader = { name: m.name, material: m.material, vertices: n, indices: m.idx.length, pos: f32(m.pos), nrm: f32(m.nrm), idx: u32(m.idx) };
    if (m.uv && m.uv.length) {
      if (m.uv.length !== n * 2) throw new Error(`mesh ${m.name}: ${m.uv.length / 2} UVs for ${n} vertices`);
      h.uv = f32(m.uv);
    }
    if (m.uv2 && m.uv2.length) {
      if (m.uv2.length !== n * 2) throw new Error(`mesh ${m.name}: ${m.uv2.length / 2} UV2s for ${n} vertices`);
      h.uv2 = f32(m.uv2);
    }
    return h;
  });
  const colliders = t.colliders.map((c) => ({ name: c.name, triangles: c.faces.length / 9, faces: f32(c.faces) }));
  const placements = t.placements.map((p) => {
    const count = p.xforms.length / 12;
    const h: { module: string; count: number; xforms: number; data?: number } = { module: p.module, count, xforms: f32(p.xforms) };
    if (p.data) {
      if (p.data.length !== count) throw new Error(`placement ${p.module}: ${p.data.length} custom data values for ${count} instances`);
      h.data = u32(p.data);
    }
    return h;
  });
  const lanePts: number[] = [];
  const list: T1LaneHeader[] = (t.lanes ?? []).map((l) => {
    const start = lanePts.length / 3;
    for (const v of l.pts) lanePts.push(v);
    const { pts, ...rest } = l;
    return { ...rest, start, count: pts.length / 3 };
  });
  const header: T1Header = {
    format: 'KTL1', tile: { district: t.district, x: t.tx, z: t.tz, size: t.size }, origin: t.origin, margin: t.margin ?? null,
    meshes, colliders, placements, lanes: { points: lanePts.length / 3, pts: f32(lanePts), list }, pins: t.pins ?? [], nav: null, life: null,
  };
  let json = JSON.stringify(header);
  while (json.length % 4 !== 0) json += ' ';
  const head = ascii(json);
  const out = new Uint8Array(12 + head.length + at);
  const view = new DataView(out.buffer);
  out.set(MAGIC, 0);
  view.setUint32(4, KTL1_VERSION, true);
  view.setUint32(8, head.length, true);
  out.set(head, 12);
  const base = 12 + head.length;
  for (const p of parts) {
    if (p.f32) for (let i = 0; i < p.f32.length; i++) view.setFloat32(base + p.offset + i * 4, p.f32[i] as number, true);
    if (p.u32) for (let i = 0; i < p.u32.length; i++) view.setUint32(base + p.offset + i * 4, p.u32[i] as number, true);
  }
  return out;
}

export interface DecodedT1 {
  header: T1Header;
  f32(offset: number, count: number): Float32Array;
  u32(offset: number, count: number): Uint32Array;
}

/**
 * Reads a T1 file back (the bake's own check and the tests; Godot has its own reader). A wrong mark or version
 * throws. With `checkMagnitude` (the default when the header names a margin) a vertex outside the tile plus the
 * margin throws too.
 */
export function decodeT1(bytes: Uint8Array, checkMagnitude = true): DecodedT1 {
  if (bytes.length < 12) throw new Error('not a KTL1 tile (too short)');
  for (let i = 0; i < 4; i++) if (bytes[i] !== MAGIC[i]) throw new Error('not a KTL1 tile');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4, true);
  if (version !== KTL1_VERSION) throw new Error(`KTL1 version ${version} is not supported (this reader reads version ${KTL1_VERSION})`);
  const headLen = view.getUint32(8, true);
  if (12 + headLen > bytes.length) throw new Error(`KTL1 header of ${headLen} bytes runs past the end of the file`);
  const raw = JSON.parse(asciiText(bytes.subarray(12, 12 + headLen))) as Partial<T1Header> & Pick<T1Header, 'format' | 'tile' | 'origin' | 'meshes' | 'colliders' | 'placements'>;
  // tiles written before P1-016 (the bench tiles) have no lanes, pins, margin, nav or life
  const header: T1Header = { margin: null, lanes: { points: 0, pts: 0, list: [] }, pins: [], nav: null, life: null, ...raw };
  const base = 12 + headLen;
  const f32 = (offset: number, count: number): Float32Array => {
    if (base + offset + count * 4 > bytes.length) throw new Error(`KTL1 array at ${offset} (${count} floats) runs past the end of the file`);
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) out[i] = view.getFloat32(base + offset + i * 4, true);
    return out;
  };
  const u32 = (offset: number, count: number): Uint32Array => {
    if (base + offset + count * 4 > bytes.length) throw new Error(`KTL1 array at ${offset} (${count} integers) runs past the end of the file`);
    const out = new Uint32Array(count);
    for (let i = 0; i < count; i++) out[i] = view.getUint32(base + offset + i * 4, true);
    return out;
  };
  if (checkMagnitude && header.margin !== null) {
    const size = header.tile.size;
    const m = header.margin;
    const bad =
      header.meshes.map((x) => badVertex(`mesh ${x.name}`, f32(x.pos, x.vertices * 3), size, m)).find((b) => b) ??
      header.colliders.map((c) => badVertex(`collider ${c.name}`, f32(c.faces, c.triangles * 9), size, m)).find((b) => b) ??
      badVertex('lanes', f32(header.lanes.pts, header.lanes.points * 3), size, m) ??
      header.placements.map((x) => badVertex(`placement ${x.module}`, placementOrigins(f32(x.xforms, x.count * 12)), size, m)).find((b) => b) ??
      header.pins.map((p) => badVertex(`pin ${p.id}`, p.pos, size, m)).find((b) => b);
    if (bad) throw new Error(`KTL1 tile ${header.tile.x}_${header.tile.z}: vertex ${bad.index} of ${bad.array} at (${bad.value.join(', ')}) is outside the tile plus its ${m} m margin`);
  }
  return { header, f32, u32 };
}

/** The whole tile back as content (the round trip tests and the bake's checks). */
export function decodeContent(bytes: Uint8Array): TileContent {
  const d = decodeT1(bytes);
  const h = d.header;
  const arr = (a: Float32Array | Uint32Array): number[] => Array.from(a);
  const lanePts = d.f32(h.lanes.pts, h.lanes.points * 3);
  return {
    district: h.tile.district, tx: h.tile.x, tz: h.tile.z, size: h.tile.size, origin: h.origin,
    meshes: h.meshes.map((m) => ({
      name: m.name, material: m.material, pos: arr(d.f32(m.pos, m.vertices * 3)), nrm: arr(d.f32(m.nrm, m.vertices * 3)), idx: arr(d.u32(m.idx, m.indices)),
      ...(m.uv !== undefined ? { uv: arr(d.f32(m.uv, m.vertices * 2)) } : {}), ...(m.uv2 !== undefined ? { uv2: arr(d.f32(m.uv2, m.vertices * 2)) } : {}),
    })),
    colliders: h.colliders.map((c) => ({ name: c.name, faces: arr(d.f32(c.faces, c.triangles * 9)) })),
    placements: h.placements.map((p) => ({ module: p.module, xforms: arr(d.f32(p.xforms, p.count * 12)), ...(p.data !== undefined ? { data: arr(d.u32(p.data, p.count)) } : {}) })),
    lanes: h.lanes.list.map(({ start, count, ...l }) => ({ ...l, pts: arr(lanePts.subarray(start * 3, (start + count) * 3)) })),
    pins: h.pins,
    ...(h.margin !== null ? { margin: h.margin } : {}),
  };
}
