// The production tiles of a bake stage (P1-016, TECH.md "Tile format (T1, KTL1)", ARCH_OPTIONS T1 and K3): the road
// mesh, the ground and the building shells cut on the one 250 m world grid (cutter.ts), collider chunks from the
// drawn vertices (colliders.ts), the lane graph per tile (lanes.ts) and the pins, each tile encoded as KTL1 and
// read back once. A tile with a vertex outside its square plus the margin, or over its byte budget, is reported and
// skipped, never written. The header fields nav, life and placements stay reserved for P2 and P3. The files are
// written by tools/bake/sources/tilesio.ts through `emit`. Pure.
import type { P2 } from '../geom.ts';
import { hashText } from '../graph/checks.ts';
import { TILE_M, tileId, tileOf } from '../layout/grid.ts';
import { decodeT1, encodeT1, tileBadVertices } from './codec.ts';
import type { TileContent, TilePin } from './codec.ts';
import { tileColliders } from './colliders.ts';
import { WorldCutter, snap } from './cutter.ts';
import type { SourceMesh } from './cutter.ts';
import type { LanePiece } from './lanes.ts';
import type { GroundTile } from '../terrain/build.ts';
import type { Shell } from './shells.ts';

/**
 * How far past its square a tile's vertex may lie (m): the magnitude rule of the reader. One tile: a building shell
 * goes whole to the tile of its centroid and the largest pilot shells reach 165 m past it (a road triangle 141 m);
 * the streaming ring loads the neighbours anyway. A vertex in the wrong frame (block or world metres) is off by
 * kilometres in all but the tiles next to the origin.
 */
export const TILE_MARGIN_M = 250;
/** Byte budget of one tile (TECH.md: 1.5 MB on average, 4 MB at worst). */
export const TILE_BUDGET_BYTES = 4 * 1024 * 1024;
export const TILE_AVERAGE_BYTES = 1.5 * 1024 * 1024;

export interface WorldPin {
  id: string;
  name: string;
  kind: string;
  /** World metres. */
  x: number;
  y: number;
  z: number;
}

export interface TileBakeInput {
  block: string;
  /** Block metres to world metres. */
  offset: P2;
  road: Iterable<SourceMesh>;
  ground: Iterable<GroundTile>;
  shells: Iterable<Shell>;
  lanes: readonly LanePiece[];
  pins: readonly WorldPin[];
  /** A partial bake: only these tile ids are written. */
  only?: ReadonlySet<string> | null;
  margin?: number;
  budgetBytes?: number;
}

export interface TileRecord {
  id: string;
  x: number;
  z: number;
  file: string;
  bytes: number;
  hash: string;
  origin: [number, number, number];
  meshes: number;
  materials: string[];
  vertices: number;
  triangles: number;
  colliderTriangles: number;
  chunks: number;
  largestChunk: number;
  buildings: number;
  lanes: number;
  pins: number;
  overhangM: number;
}

export interface SkippedTile {
  id: string;
  reason: string;
}

export interface TileBakeResult {
  records: TileRecord[];
  skipped: SkippedTile[];
  /** Bytes of the tiles `keep` asked for (the checks read them back). */
  kept: Map<string, Uint8Array>;
  stats: {
    tiles: number; bytes: number; averageBytes: number; largest: { id: string; bytes: number } | null; triangles: number; colliderTriangles: number; chunks: number;
    largestChunk: number; slivers: number; splitBuildings: number; joints: number; buildings: number; lanes: number; pins: number; maxOverhangM: number; droppedUv: number; flipped: number; cutShells: number;
  };
  bakeHash: string;
  ms: Record<string, number>;
}

/** A 64-bit hash of bytes as hex (two 32-bit lanes, as hashText does for text). */
export function bytesHash(bytes: Uint8Array, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i] as number;
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

export const tileFile = (id: string): string => `${id}.ktl`;

export function bakeTiles(input: TileBakeInput, emit: (rec: TileRecord, bytes: Uint8Array) => void, keep: (id: string) => boolean = () => false): TileBakeResult {
  const margin = input.margin ?? TILE_MARGIN_M;
  const budget = input.budgetBytes ?? TILE_BUDGET_BYTES;
  const ms: Record<string, number> = {};
  let clock = Date.now();
  const lap = (name: string): void => {
    const now = Date.now();
    ms[name] = (ms[name] ?? 0) + now - clock;
    clock = now;
  };
  const cutter = new WorldCutter(input.offset);
  cutter.addRoad(input.road);
  cutter.addGround(input.ground);
  const cutShells = cutter.addShells(input.shells);
  const lanesBy = new Map<string, LanePiece[]>();
  for (const l of input.lanes) {
    let list = lanesBy.get(l.tile);
    if (!list) lanesBy.set(l.tile, (list = []));
    list.push(l);
  }
  const pinsBy = new Map<string, WorldPin[]>();
  for (const p of input.pins) {
    const w = tileOf(p.x, p.z);
    const id = tileId(w.tx, w.tz);
    let list = pinsBy.get(id);
    if (!list) pinsBy.set(id, (list = []));
    list.push(p);
  }
  lap('bin');
  const records: TileRecord[] = [];
  const skipped: SkippedTile[] = [];
  const kept = new Map<string, Uint8Array>();
  const s: TileBakeResult['stats'] = { tiles: 0, bytes: 0, averageBytes: 0, largest: null, triangles: 0, colliderTriangles: 0, chunks: 0, largestChunk: 0, slivers: 0, splitBuildings: 0, joints: 0, buildings: 0, lanes: 0, pins: 0, maxOverhangM: 0, droppedUv: 0, flipped: 0, cutShells };
  const hashes: string[] = [];
  for (const t of cutter.tiles()) {
    if (input.only && !input.only.has(t.id)) continue;
    const cut = cutter.cut(t.tx, t.tz);
    lap('cut');
    const { chunks, stats: cs } = tileColliders(cut.meshes, cut.buildings, TILE_M);
    lap('colliders');
    const [x0, y0, z0] = cut.origin;
    // lane points and pins take the vertex snap too: exact as float32, the same point in every tile
    const lanes = (lanesBy.get(t.id) ?? []).map(({ tile: _tile, pts, ...l }) => ({ ...l, pts: pts.map((v, i) => snap(v) - (i % 3 === 0 ? x0 : i % 3 === 1 ? y0 : z0)) }));
    const pins: TilePin[] = (pinsBy.get(t.id) ?? []).map((p) => ({ id: p.id, name: p.name, kind: p.kind, pos: [snap(p.x) - x0, snap(p.y) - y0, snap(p.z) - z0] }));
    const content: TileContent = { district: input.block, tx: t.tx, tz: t.tz, size: TILE_M, origin: cut.origin, meshes: cut.meshes, colliders: chunks, placements: [], lanes, pins, margin };
    const bad = tileBadVertices(content, margin);
    if (bad.length) {
      const b = bad[0]!;
      skipped.push({ id: t.id, reason: `${bad.length} arrays with a vertex outside the tile plus ${margin} m: first ${b.array} vertex ${b.index} at (${b.value.map((v) => Math.round(v * 100) / 100).join(', ')})` });
      continue;
    }
    const bytes = encodeT1(content);
    lap('encode');
    if (bytes.length > budget) {
      skipped.push({ id: t.id, reason: `${bytes.length} bytes, over the budget of ${budget}` });
      continue;
    }
    // read back once: what the game will load, not what the bake meant to write
    try {
      decodeT1(bytes);
    } catch (e) {
      skipped.push({ id: t.id, reason: `does not read back: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }
    lap('readback');
    const triangles = cut.meshes.reduce((n, m) => n + m.idx.length / 3, 0);
    const colliderTriangles = chunks.reduce((n, c) => n + c.faces.length / 9, 0);
    const largestChunk = chunks.reduce((n, c) => Math.max(n, c.faces.length / 9), 0);
    const rec: TileRecord = {
      id: t.id, x: t.tx, z: t.tz, file: tileFile(t.id), bytes: bytes.length, hash: bytesHash(bytes), origin: cut.origin, meshes: cut.meshes.length, materials: cut.meshes.map((m) => m.material),
      vertices: cut.meshes.reduce((n, m) => n + m.pos.length / 3, 0), triangles, colliderTriangles, chunks: chunks.length, largestChunk, buildings: cut.buildings.length,
      lanes: lanes.length, pins: pins.length, overhangM: Math.round(cut.overhangM * 100) / 100,
    };
    emit(rec, bytes);
    lap('emit');
    if (keep(t.id)) kept.set(t.id, bytes);
    records.push(rec);
    hashes.push(`${rec.id}:${rec.hash}`);
    s.tiles++;
    s.bytes += bytes.length;
    if (!s.largest || bytes.length > s.largest.bytes) s.largest = { id: t.id, bytes: bytes.length };
    s.triangles += triangles;
    s.colliderTriangles += colliderTriangles;
    s.chunks += chunks.length;
    s.largestChunk = Math.max(s.largestChunk, largestChunk);
    s.slivers += cs.slivers;
    s.splitBuildings += cs.splitBuildings;
    s.joints += cs.joints;
    s.buildings += cut.buildings.length;
    s.lanes += lanes.length;
    s.pins += pins.length;
    s.maxOverhangM = Math.max(s.maxOverhangM, rec.overhangM);
    s.droppedUv += cut.droppedUv;
    s.flipped += cut.flipped;
  }
  s.averageBytes = s.tiles ? Math.round(s.bytes / s.tiles) : 0;
  return { records, skipped, kept, stats: s, bakeHash: hashText(hashes.join('\n')), ms };
}
