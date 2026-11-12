// What the tile step hands on (P1-016): the record for the health report, the index of the tile folder, the log
// lines and the invariants. Pure; tools/bake/sources/tilestage.ts writes the files.
import { hashText } from '../graph/checks.ts';
import type { InvariantResult } from '../report/health.ts';
import type { ColliderCheck, DeckRayCheck } from './checks.ts';
import { CHUNK_LIMIT } from './colliders.ts';
import type { SkippedTile, TileBakeResult, TileRecord } from './write.ts';
import { TILE_AVERAGE_BYTES, TILE_BUDGET_BYTES, TILE_MARGIN_M } from './write.ts';

export interface TilesRecord {
  dir: string;
  index: string;
  bakeHash: string;
  margin: number;
  budgetBytes: number;
  averageBudgetBytes: number;
  stats: TileBakeResult['stats'];
  skipped: SkippedTile[];
  ms: Record<string, number>;
  colliders: ColliderCheck[];
  deck: DeckRayCheck | null;
  shells: { footprints: number; shells: number; rejected: number; byHeight: Record<string, number> };
}

export interface TileIndex {
  version: 1;
  _doc: string;
  stage: string;
  block: string;
  size: number;
  margin: number;
  bakeHash: string;
  /** World metres of the block origin: world = block + offset. */
  offset: [number, number];
  bytes: { total: number; average: number; largest: { id: string; bytes: number } | null };
  blocks: { id: string; tiles: number; bytes: number }[];
  tiles: TileRecord[];
  skipped: SkippedTile[];
}

export function tileIndex(stage: string, block: string, offset: { x: number; z: number }, res: TileBakeResult, records: readonly TileRecord[]): TileIndex {
  const total = records.reduce((n, r) => n + r.bytes, 0);
  const largest = records.reduce<{ id: string; bytes: number } | null>((a, r) => (!a || r.bytes > a.bytes ? { id: r.id, bytes: r.bytes } : a), null);
  const tiles = [...records].sort((p, q) => p.z - q.z || p.x - q.x);
  return {
    version: 1,
    _doc: 'Index of the KTL1 tiles of one bake stage (tools/bake/tile/write.ts, TECH.md "Tile format (T1, KTL1)"): one 250 m tile of the one world grid per file "<tileX>_<tileZ>.ktl", vertices relative to the tile origin (world metres of its north-west corner, y at its lowest ground). bakeHash changes when any tile byte changes. skipped lists tiles that were not written and why (a vertex outside the tile plus margin, or over the byte budget).',
    // over every tile in the folder, so a partial bake that writes the same bytes leaves the same hash
    stage, block, size: 250, margin: TILE_MARGIN_M, bakeHash: hashText(tiles.map((r) => `${r.id}:${r.hash}`).join('\n')), offset: [offset.x, offset.z],
    bytes: { total, average: records.length ? Math.round(total / records.length) : 0, largest },
    blocks: [{ id: block, tiles: records.length, bytes: total }],
    tiles, skipped: res.skipped,
  };
}

const mb = (b: number): string => `${(b / 1048576).toFixed(2)} MB`;

export function tilesLog(rec: TilesRecord): string[] {
  const s = rec.stats;
  const out = [
    `${s.tiles} tiles written to ${rec.dir} in ${((rec.ms['total'] ?? 0) / 1000).toFixed(1)} s (${Object.entries(rec.ms).filter(([k]) => k !== 'total').map(([k, v]) => `${k} ${v}`).join(', ')} ms); ${rec.skipped.length} skipped${rec.skipped.length ? ` (${rec.skipped.slice(0, 4).map((x) => `${x.id}: ${x.reason}`).join('; ')})` : ''}`,
    `bytes: ${mb(s.bytes)} in all, average ${mb(s.averageBytes)} (budget ${mb(rec.averageBudgetBytes)}), largest ${s.largest ? `${s.largest.id} ${mb(s.largest.bytes)}` : 'none'} (budget ${mb(rec.budgetBytes)}); bake hash ${rec.bakeHash}`,
    `content: ${s.triangles} drawn triangles, ${s.colliderTriangles} collider triangles in ${s.chunks} chunks (largest ${s.largestChunk}, limit ${CHUNK_LIMIT}; ${s.slivers} slivers left out, ${s.splitBuildings} buildings over one chunk, ${s.joints} deck joint triangles), ${s.buildings} building shells (${s.cutShells} shells over 200 m past their tile cut into parts per tile), ${s.lanes} lane pieces, ${s.pins} pins; farthest vertex ${s.maxOverhangM} m outside its tile (margin ${rec.margin} m); ${s.droppedUv} UV arrays left out, ${s.flipped} needles the 1 mm snap turned over left out`,
    `shells: ${rec.shells.shells} of ${rec.shells.footprints} footprints (${rec.shells.rejected} not a shape), heights from ${Object.entries(rec.shells.byHeight).map(([k, v]) => `${k} ${v}`).join(', ')}`,
  ];
  for (const c of rec.colliders) out.push(`collider against drawn, ${c.name} (tile ${c.tile}): ${c.points} points, ${c.matched} within 0.05 m, ${c.mismatched} off, ${c.holes} holes, largest difference ${c.maxDiffM} m`);
  const d = rec.deck;
  if (d) out.push(`deck rays: ${d.rays} rays every 5 cm along ${d.lanes} lanes of ${d.strips} deck strips (${d.lengthM} m, ${d.onStationLines} on station lines), ${d.misses} missed the collider${d.firstMiss ? ` (first ${JSON.stringify(d.firstMiss)})` : ''}, largest difference ${d.maxDiffM} m`);
  return out;
}

/** `named`: how many check tiles a whole bake must have measured (a partial bake checks the ones it wrote). */
export function tilesInvariants(rec: TilesRecord, partial: boolean, named: number): InvariantResult[] {
  const s = rec.stats;
  const off = rec.colliders.filter((c) => c.mismatched > 0 || c.holes > 0);
  const out: InvariantResult[] = [
    { id: 'TILE-01.none_skipped', ok: rec.skipped.length === 0, detail: rec.skipped.length === 0 ? `all ${s.tiles} tiles written` : `${rec.skipped.length} tiles skipped: ${rec.skipped.slice(0, 3).map((x) => `${x.id} ${x.reason}`).join('; ')}` },
    { id: 'TILE-02.chunks', ok: s.largestChunk <= CHUNK_LIMIT, detail: `largest collider chunk ${s.largestChunk} triangles (limit ${CHUNK_LIMIT}), ${s.chunks} chunks` },
    {
      id: 'TILE-03.colliders_match_drawn', ok: (partial || rec.colliders.length === named) && off.length === 0,
      detail: off.length === 0 ? `${rec.colliders.length} of ${named} named tiles, ${rec.colliders.reduce((n, c) => n + c.points, 0)} points, largest difference ${Math.max(0, ...rec.colliders.map((c) => c.maxDiffM))} m` : off.map((c) => `${c.name}: ${c.mismatched} off, ${c.holes} holes`).join('; '),
    },
    { id: 'TILE-04.deck_rays', ok: rec.deck === null ? partial : rec.deck.misses === 0 && rec.deck.rays > 0, detail: rec.deck ? `${rec.deck.misses} of ${rec.deck.rays} rays missed` : 'no deck to cast along' },
  ];
  if (!partial) out.push({ id: 'TILE-05.bytes', ok: s.averageBytes <= TILE_AVERAGE_BYTES && (s.largest?.bytes ?? 0) <= TILE_BUDGET_BYTES, detail: `average ${mb(s.averageBytes)} (budget ${mb(TILE_AVERAGE_BYTES)}), largest ${s.largest ? mb(s.largest.bytes) : 'none'} (budget ${mb(TILE_BUDGET_BYTES)})` });
  return out;
}
