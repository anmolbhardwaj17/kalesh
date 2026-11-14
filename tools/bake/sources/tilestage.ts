// The tile step of the bake (P1-016): the files side of tools/bake/tile/. It takes what the earlier steps keep in
// memory (the lane model with its heights, the road mesh, the ground with its tiles, the repaired footprints) and
// builds none of them again; it writes one KTL1 file per world tile and index.json into the tile folder (default
// game/world/tiles, gitignored), then reads the named check tiles back for the collider and deck checks.
import type { BarrierPlacement } from '../mesh/barriers.ts';
import fs from 'node:fs';
import path from 'node:path';
import { projector } from '../../geo/projection.ts';
import type { P2 } from '../geom.ts';
import { pointInRing } from '../geom.ts';
import type { Place } from '../layout/gate.ts';
import { tileId, tileOf } from '../layout/grid.ts';
import type { RoadMesh } from '../mesh/build.ts';
import type { MeshInput } from '../mesh/input.ts';
import { K_DECK } from '../mesh/stripfaces.ts';
import type { RepairedGraph } from '../repair/engine.ts';
import { laneGraph } from '../roads/laneout.ts';
import type { LaneBuild } from '../roads/network.ts';
import { CHECK_TILES, DECK_ROADS } from '../sites.ts';
import type { Ground } from '../terrain/build.ts';
import { colliderVsDrawn, deckRays, deckTiles, withNeighbours } from '../tile/checks.ts';
import { lanePieces } from '../tile/lanes.ts';
import { GroundHeights, shellOf } from '../tile/shells.ts';
import type { Shell } from '../tile/shells.ts';
import type { SourceMesh } from '../tile/cutter.ts';
import { tileIndex, tilesInvariants, tilesLog } from '../tile/tilesout.ts';
import type { TileIndex, TilesRecord } from '../tile/tilesout.ts';
import { TILE_AVERAGE_BYTES, TILE_BUDGET_BYTES, TILE_MARGIN_M, bakeTiles } from '../tile/write.ts';
import type { TileRecord, WorldPin } from '../tile/write.ts';
import type { InvariantResult } from '../report/health.ts';

export interface TileStepInput {
  root: string;
  /** Tile folder, repo-relative or absolute. */
  out: string;
  stage: string;
  block: string;
  origin: { lat: number; lon: number };
  offset: P2;
  outline: readonly P2[];
  lanes: LaneBuild;
  meshed: { input: MeshInput; mesh: RoadMesh };
  ground: Ground;
  repaired: RepairedGraph;
  places: readonly Place[];
  /** A partial bake: only these tile ids. */
  only: readonly string[] | null;
  /** Repo-relative file that gets the bake hash of the written set (a whole bake of the game's tile folder). */
  hashFile?: string;
  /** The landmark placement (P2-006): the stand-in massing, the landmark pins and the landmark file of the folder. */
  landmarks?: { meshes: readonly SourceMesh[]; pins: readonly WorldPin[]; file: unknown };
  /** The bollards and gates where the access changes (P2-042): their mesh, and the placements for access.json. */
  access?: { meshes: readonly SourceMesh[]; placements: readonly BarrierPlacement[] };
  /** The infrastructure kits (P2-034): the plain shapes they stand on (colliders) and the kit file of the folder. */
  infra?: { meshes: readonly SourceMesh[]; file: unknown };
  log: (line: string) => void;
}

/** The barrier lines in world metres (P2-042): what the access scenario and the route fixtures read from a tile folder. */
export function accessFile(placements: readonly BarrierPlacement[], offset: P2): unknown {
  return {
    _doc: 'Bollards and gates where the access changes (P2-042, tools/bake/mesh/barriers.ts): world metres (x east, z south). dir is the unit direction of the road (station order); a car-stopping line has stopsCar true and gaps under 1.3 m.',
    barriers: placements.map((p) => ({ id: p.id, kind: p.kind, source: p.source, ref: p.ref, edge: p.edge, x: Math.round((p.x + offset.x) * 1000) / 1000, y: p.y, z: Math.round((p.z + offset.z) * 1000) / 1000, dir: p.dir, widthM: p.widthM, posts: p.posts.length, maxGapM: p.maxGapM, stopsCar: p.stopsCar })),
  };
}

export function runTileStep(s: TileStepInput): { record: TilesRecord; invariants: InvariantResult[]; written: number } {
  const t0 = Date.now();
  const dir = path.isAbsolute(s.out) ? s.out : path.join(s.root, s.out);
  fs.mkdirSync(dir, { recursive: true });
  const partial = s.only !== null;
  // a whole bake owns the folder: tiles of an older bake that this one no longer writes go
  if (!partial) for (const f of fs.readdirSync(dir)) if (f.endsWith('.ktl')) fs.rmSync(path.join(dir, f), { force: true });

  // building shells on the solved ground
  const heights = new GroundHeights(s.ground);
  const model = s.ground.input.ground;
  const shells: Shell[] = [];
  const byHeight: Record<string, number> = {};
  let rejected = 0;
  for (const f of s.repaired.footprints) {
    const sh = shellOf(f, (x, z) => heights.at(x, z), model);
    if (!sh) {
      rejected++;
      continue;
    }
    byHeight[sh.from] = (byHeight[sh.from] ?? 0) + 1;
    shells.push(sh);
  }
  // pins: the named places of this block inside the stage, on the ground
  const proj = projector(s.origin);
  const pins: WorldPin[] = [];
  for (const p of s.places) {
    if (p.block !== s.block) continue;
    const at = proj.toWorld(p.lat, p.lon);
    if (!pointInRing(at, s.outline)) continue;
    let y = heights.at(at.x, at.z);
    if (!Number.isFinite(y)) y = model(at.x, at.z);
    pins.push({ id: p.id, name: p.name, kind: 'place', x: at.x + s.offset.x, y, z: at.z + s.offset.z });
  }
  if (s.landmarks) pins.push(...s.landmarks.pins);
  const lanes = lanePieces(laneGraph(s.lanes, s.block, s.offset), s.meshed.input.strips, s.offset);

  // the tiles the checks read back: the five named tiles with their neighbours, and the tiles under the ITO deck
  const keep = new Set<string>();
  const named = CHECK_TILES.map((c) => {
    const at = proj.toWorld(c.lat, c.lon);
    const t = tileOf(at.x + s.offset.x, at.z + s.offset.z);
    for (const id of withNeighbours(t.tx, t.tz)) keep.add(id);
    return { ...c, tx: t.tx, tz: t.tz };
  });
  for (const id of deckTiles(s.meshed.input.strips, s.meshed.input.kinds, DECK_ROADS, K_DECK, s.offset)) keep.add(id);

  const old: TileRecord[] = partial && fs.existsSync(path.join(dir, 'index.json')) ? (JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')) as TileIndex).tiles : [];
  const res = bakeTiles(
    { block: s.block, offset: s.offset, road: [...s.meshed.mesh.sink.meshes.values(), ...(s.landmarks?.meshes ?? []), ...(s.access?.meshes ?? []), ...(s.infra?.meshes ?? [])], ground: s.ground.tiles, shells, lanes, pins, only: s.only ? new Set(s.only) : null },
    (rec, bytes) => fs.writeFileSync(path.join(dir, rec.file), bytes),
    (id) => keep.has(id),
  );
  const tc = Date.now();
  const colliders = named.filter((c) => res.kept.has(tileId(c.tx, c.tz))).map((c) => colliderVsDrawn(res.kept, c.tx, c.tz, c.name));
  const deckIds = deckTiles(s.meshed.input.strips, s.meshed.input.kinds, DECK_ROADS, K_DECK, s.offset);
  const deck = deckIds.some((id) => res.kept.has(id)) ? deckRays(res.kept, s.meshed.input.strips, s.meshed.input.kinds, DECK_ROADS, K_DECK, s.offset) : null;
  res.ms['checks'] = Date.now() - tc;
  res.ms['total'] = Date.now() - t0;
  const records = partial ? [...old.filter((r) => !res.records.some((n) => n.id === r.id)), ...res.records] : res.records;
  const index = tileIndex(s.stage, s.block, s.offset, res, records);
  const indexFile = path.join(dir, 'index.json');
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 1) + '\n');
  // the landmark file of the folder: LOD slots, far silhouettes, the cap on heroes at full detail (P2-006)
  if (s.landmarks) fs.writeFileSync(path.join(dir, 'landmarks.json'), JSON.stringify(s.landmarks.file) + '\n');
  // the barriers of the folder in world metres (P2-042): the route fixtures and the access scenario read them
  if (s.access) fs.writeFileSync(path.join(dir, 'access.json'), JSON.stringify(accessFile(s.access.placements, s.offset)) + '\n');
  // the infrastructure kits of the folder (P2-034): the game draws every structure from its variant's kit
  // (a partial bake writes the records of its own tiles only: the committed test block keeps a small file)
  if (s.infra) {
    const file = s.infra.file as { tiles: Record<string, unknown> };
    const keepOnly = s.only ? { ...file, tiles: Object.fromEntries(Object.entries(file.tiles).filter(([id]) => (s.only as readonly string[]).includes(id))) } : file;
    fs.writeFileSync(path.join(dir, 'infra.json'), JSON.stringify(keepOnly) + '\n');
  }
  if (s.hashFile) fs.writeFileSync(path.join(s.root, s.hashFile), JSON.stringify({ _doc: 'The bake hash of the full tile set (game/world/tiles/index.json bakeHash) that the repo expects. Written by a whole bake; harness/bin/tileset.mjs gives a snapshot or play copy the tiles only when they carry this hash.', stage: index.stage, bakeHash: index.bakeHash, tiles: records.length, bytes: index.bytes.total }, null, 1) + '\n');
  const rel = (f: string): string => (f.startsWith(s.root) ? path.relative(s.root, f) : f);
  const record: TilesRecord = {
    dir: rel(dir), index: rel(indexFile), bakeHash: index.bakeHash, margin: TILE_MARGIN_M, budgetBytes: TILE_BUDGET_BYTES, averageBudgetBytes: TILE_AVERAGE_BYTES,
    stats: res.stats, skipped: res.skipped, ms: res.ms, colliders, deck, shells: { footprints: s.repaired.footprints.length, shells: shells.length, rejected, byHeight },
  };
  for (const l of tilesLog(record)) s.log(`[tiles] ${l}`);
  return { record, invariants: tilesInvariants(record, partial, named.length), written: res.stats.tiles };
}
