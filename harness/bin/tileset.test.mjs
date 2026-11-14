import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkSet, expectedTiles, provideTiles, staleFixtures, writeExpected, TILES_DIR, HASH_FILE } from './tileset.mjs';
import { treeHash } from './lib.mjs';

// P1-018: a snapshot worktree or play copy gets the gitignored full tile set from the main checkout only when its bake
// hash is the one the commit expects (game/world/tiles.hash); the tree hash counts tiles.hash and never the tiles.

let main;
let dest;
const put = (root, f, text) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), text); };
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** A fake baked set: tiles of 10 bytes each and an index that lists them, with the given hash. */
function bake(root, hash, names = ['0_0', '1_0']) {
  const dir = path.join(root, TILES_DIR);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const n of names) put(root, `${TILES_DIR}/${n}.ktl`, `tile-${n}`.padEnd(10, '.'));
  put(root, `${TILES_DIR}/index.json`, JSON.stringify({ stage: 'pilot', bakeHash: hash, bytes: { total: names.length * 10 }, tiles: names.map((n) => ({ id: n, file: `${n}.ktl`, bytes: 10 })) }));
}

beforeEach(() => {
  main = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-tileset-main-'));
  dest = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-tileset-dest-'));
});
afterEach(() => { fs.rmSync(main, { recursive: true, force: true }); fs.rmSync(dest, { recursive: true, force: true }); });

describe('provideTiles (snapshot.mjs, playcopy.mjs)', () => {
  it('expects nothing when the commit has no tiles.hash', () => {
    expect(provideTiles(dest, main)).toMatchObject({ ok: true, status: 'none' });
    expect(fs.existsSync(path.join(dest, TILES_DIR))).toBe(false);
  });

  it('copies the full set when the main checkout carries the expected hash', () => {
    bake(main, 'abc123');
    put(main, HASH_FILE, JSON.stringify({ bakeHash: 'abc123' }));
    put(dest, HASH_FILE, JSON.stringify({ bakeHash: 'abc123' }));
    const r = provideTiles(dest, main);
    expect(r).toMatchObject({ ok: true, status: 'copied' });
    expect(fs.readdirSync(path.join(dest, TILES_DIR)).sort()).toEqual(['0_0.ktl', '1_0.ktl', 'index.json']);
    // a copy, not a link: a rebake in the main checkout leaves it alone
    bake(main, 'def456');
    expect(checkSet(dest, expectedTiles(dest)).ok).toBe(true);
    expect(provideTiles(dest, main)).toMatchObject({ ok: true, status: 'kept' });
  });

  it('stops with the rebake message when the hashes differ', () => {
    bake(main, 'old111');
    put(dest, HASH_FILE, JSON.stringify({ bakeHash: 'new222' }));
    const r = provideTiles(dest, main);
    expect(r.ok).toBe(false);
    expect(r.status).toBe('mismatch');
    expect(r.reason).toContain('old111');
    expect(r.reason).toContain('new222');
    expect(r.reason).toContain('rebake: npm run bake -- pilot');
    expect(fs.existsSync(path.join(dest, TILES_DIR))).toBe(false);
  });

  it('stops when the main checkout has no tiles, or a tile is cut short', () => {
    put(dest, HASH_FILE, JSON.stringify({ bakeHash: 'abc123' }));
    expect(provideTiles(dest, main)).toMatchObject({ ok: false, status: 'mismatch' });
    bake(main, 'abc123');
    fs.writeFileSync(path.join(main, TILES_DIR, '1_0.ktl'), 'short');
    const r = provideTiles(dest, main);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('1_0.ktl');
    expect(r.reason).toContain('rebake: npm run bake -- pilot');
  });

  it('replaces an old set in the destination', () => {
    bake(dest, 'old111');
    put(dest, HASH_FILE, JSON.stringify({ bakeHash: 'new222' }));
    bake(main, 'new222', ['5_5']);
    expect(provideTiles(dest, main)).toMatchObject({ ok: true, status: 'copied' });
    expect(fs.readdirSync(path.join(dest, TILES_DIR)).sort()).toEqual(['5_5.ktl', 'index.json']);
  });

  it('writeExpected records the hash of the tiles that are there', () => {
    bake(main, 'abc123');
    expect(writeExpected(main)).toMatchObject({ bakeHash: 'abc123', tiles: 2, bytes: 20 });
    expect(expectedTiles(main).bakeHash).toBe('abc123');
  });
});

describe('route fixtures read from the tiles (P1-034)', () => {
  it('names the fixtures made from other tiles than tiles.hash, with their generator', () => {
    expect(staleFixtures(main)).toEqual([]);
    put(main, HASH_FILE, JSON.stringify({ bakeHash: 'new' }));
    put(main, 'harness/data/fixtures/stream_routes.json', JSON.stringify({ bakeHash: 'new' }));
    put(main, 'harness/data/fixtures/city_routes.json', JSON.stringify({ bakeHash: 'old' }));
    expect(staleFixtures(main)).toEqual([{ file: 'harness/data/fixtures/city_routes.json', bakeHash: 'old', gen: 'node tools/fixtures/gen_city_routes.mjs' }]);
  });
});

describe('treeHash with tiles (P1-018)', () => {
  it('counts tiles.hash and the test block, never the full set', () => {
    put(main, '.gitignore', 'game/world/tiles/\n');
    put(main, 'game/project.godot', 'x\n');
    put(main, HASH_FILE, '{"bakeHash":"a"}\n');
    put(main, 'game/world/test_tiles/0_0.ktl', 'block');
    git(main, 'init', '-q');
    git(main, 'add', '-A');
    git(main, 'commit', '-q', '-m', 'base');
    const before = treeHash(main);
    expect(before).toMatch(/^[0-9a-f]{40}$/);
    bake(main, 'a');
    expect(treeHash(main)).toBe(before);
    bake(main, 'zzz', ['9_9']);
    expect(treeHash(main)).toBe(before);
    put(main, HASH_FILE, '{"bakeHash":"b"}\n');
    expect(treeHash(main)).not.toBe(before);
    put(main, HASH_FILE, '{"bakeHash":"a"}\n');
    expect(treeHash(main)).toBe(before);
    put(main, 'game/world/test_tiles/0_0.ktl', 'other block');
    expect(treeHash(main)).not.toBe(before);
  });
});
