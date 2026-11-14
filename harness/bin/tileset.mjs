// The full tile set of the city (P1-018). Baked tiles are gitignored (game/world/tiles/, hundreds of MB), so a fresh clone,
// the verify snapshot worktree (snapshot.mjs) and a play copy (playcopy.mjs) have none. The repo commits the hash the full
// set must carry (game/world/tiles.hash, written by every whole bake of the game's tile folder) and a small test block
// (game/world/test_tiles/, started with --tiles=test). A snapshot or play copy takes the full set from the main
// checkout only when its index.json bakeHash is the one the commit expects, and stops with the rebake message otherwise.
// The copy is a clone on APFS (cp -c: instant, no extra space, a later rebake in the main checkout cannot change it).
//   node harness/bin/tileset.mjs check [<checkout>]      does that checkout's game/world/tiles/ carry its tiles.hash?
//   node harness/bin/tileset.mjs write [<checkout>]      write tiles.hash from the tiles that are there (after a bake without it)
// `check` also names the route fixtures read from the tiles (harness/data/fixtures/stream_routes.json, city_routes.json,
// city_paths.json) whose bakeHash is not the commit's tiles.hash: rerun their generator (P1-034).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT } from './lib.mjs';

export const TILES_DIR = path.join('game', 'world', 'tiles');
export const HASH_FILE = path.join('game', 'world', 'tiles.hash');
export const REBAKE = 'rebake: npm run bake -- pilot';

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

/** The hash a checkout expects: {bakeHash, tiles, bytes, stage}, or null when it has no tiles.hash (it expects no full set). */
export function expectedTiles(checkout) {
  const j = readJson(path.join(checkout, HASH_FILE));
  return j && typeof j.bakeHash === 'string' ? j : null;
}

/** The tiles a checkout holds: {bakeHash, tiles} from index.json, or null. */
export function haveTiles(checkout) {
  const j = readJson(path.join(checkout, TILES_DIR, 'index.json'));
  return j && typeof j.bakeHash === 'string' ? { bakeHash: j.bakeHash, tiles: Array.isArray(j.tiles) ? j.tiles : [] } : null;
}

/**
 * Is the tile folder of `from` the full set that `want` (an expectedTiles result) names? Checks the hash in index.json and
 * that every listed tile file is there with the size the index gives (a half copied or cut folder fails).
 * Returns {ok, reason}; the reason names both hashes and ends with the rebake command.
 */
export function checkSet(from, want) {
  const have = haveTiles(from);
  if (!have) return { ok: false, reason: `no tiles in ${path.join(from, TILES_DIR)}; ${REBAKE}` };
  if (have.bakeHash !== want.bakeHash) {
    return { ok: false, reason: `the tiles in ${path.join(from, TILES_DIR)} have bake hash ${have.bakeHash}, but ${HASH_FILE} expects ${want.bakeHash}; ${REBAKE}` };
  }
  const dir = path.join(from, TILES_DIR);
  for (const t of have.tiles) {
    let size = -1;
    try { size = fs.statSync(path.join(dir, t.file)).size; } catch { /* missing */ }
    if (size !== t.bytes) return { ok: false, reason: `tile ${t.file} in ${dir} is ${size < 0 ? 'missing' : `${size} bytes (index: ${t.bytes})`}; ${REBAKE}` };
  }
  return { ok: true, reason: `${have.tiles.length} tiles, bake hash ${have.bakeHash}` };
}

function cloneDir(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // APFS clone: instant and copy on write. Other systems fall back to a plain recursive copy.
  if (process.platform === 'darwin') {
    const r = spawnSync('cp', ['-cR', src, dest], { stdio: 'ignore' });
    if (r.status === 0) return;
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.cpSync(src, dest, { recursive: true });
}

/**
 * Gives the checkout `dest` (a snapshot worktree or an unpacked play copy) the full tile set from `source` (the main
 * checkout). dest's own tiles.hash says which set it needs; none means it expects no tiles (an older commit) and nothing
 * happens. Returns {ok, status: 'none' | 'kept' | 'copied' | 'mismatch', reason}.
 */
export function provideTiles(dest, source = ROOT) {
  const want = expectedTiles(dest);
  if (!want) return { ok: true, status: 'none', reason: `${HASH_FILE} is not in this commit: no full tile set expected` };
  const target = path.join(dest, TILES_DIR);
  if (checkSet(dest, want).ok) return { ok: true, status: 'kept', reason: `tiles already there (bake hash ${want.bakeHash})` };
  if (path.resolve(source) === path.resolve(dest)) return { ok: false, status: 'mismatch', reason: checkSet(dest, want).reason };
  const c = checkSet(source, want);
  if (!c.ok) return { ok: false, status: 'mismatch', reason: c.reason };
  fs.rmSync(target, { recursive: true, force: true });
  cloneDir(path.join(source, TILES_DIR), target);
  const after = checkSet(dest, want);
  if (!after.ok) return { ok: false, status: 'mismatch', reason: `after the copy: ${after.reason}` };
  return { ok: true, status: 'copied', reason: c.reason };
}

/** Route fixtures read from the baked tiles, each with its generator: a bake that changes tiles.hash makes them stale. */
export const TILE_FIXTURES = [
  { file: 'harness/data/fixtures/stream_routes.json', gen: 'node tools/fixtures/gen_stream_routes.mjs' },
  { file: 'harness/data/fixtures/city_routes.json', gen: 'node tools/fixtures/gen_city_routes.mjs' },
  { file: 'harness/data/fixtures/city_paths.json', gen: 'node tools/fixtures/gen_city_paths.mjs' },
];

/** The tile fixtures of a checkout made from other tiles than its tiles.hash names: [{file, bakeHash, gen}] (none without tiles.hash). */
export function staleFixtures(checkout) {
  const want = expectedTiles(checkout);
  if (!want) return [];
  const out = [];
  for (const f of TILE_FIXTURES) {
    const j = readJson(path.join(checkout, f.file));
    if (!j) continue;
    if (j.bakeHash !== want.bakeHash) out.push({ file: f.file, bakeHash: j.bakeHash ?? null, gen: f.gen });
  }
  return out;
}

/** Writes tiles.hash from the tiles in a checkout (the bake does it itself; this is for a folder baked before it did). */
export function writeExpected(checkout) {
  const idx = readJson(path.join(checkout, TILES_DIR, 'index.json'));
  if (!idx) throw new Error(`no tiles in ${path.join(checkout, TILES_DIR)}; ${REBAKE}`);
  const doc = {
    _doc: 'The bake hash of the full tile set (game/world/tiles/index.json bakeHash) that the repo expects. Written by a whole bake; harness/bin/tileset.mjs gives a snapshot or play copy the tiles only when they carry this hash.',
    stage: idx.stage, bakeHash: idx.bakeHash, tiles: idx.tiles.length, bytes: idx.bytes.total,
  };
  fs.writeFileSync(path.join(checkout, HASH_FILE), JSON.stringify(doc, null, 1) + '\n');
  return doc;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, dir] = process.argv.slice(2);
  const root = path.resolve(dir || ROOT);
  if (cmd === 'write') console.log(JSON.stringify(writeExpected(root)));
  else if (cmd === 'check') {
    const want = expectedTiles(root);
    if (!want) { console.log(`TILES none expected (${HASH_FILE} missing)`); }
    else {
      const r = checkSet(root, want);
      console.log(`${r.ok ? 'TILES ok' : 'TILES MISMATCH'}: ${r.reason}`);
      for (const f of staleFixtures(root)) console.log(`FIXTURE STALE: ${f.file} was made from bake ${f.bakeHash}, tiles.hash is ${want.bakeHash}; run ${f.gen}`);
      process.exitCode = r.ok ? 0 : 1;
    }
  } else { console.log('usage: tileset.mjs check|write [<checkout>]'); process.exitCode = 2; }
}
