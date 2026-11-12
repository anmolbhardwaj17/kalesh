// The one world grid (P1-008): tile ids from world metres, shared by the tile cutter, the overrides and the inspector.
import { describe, expect, it } from 'vitest';
import { worldTile, overrideFileName, TILE_SIZE } from '../../inspector/lib';
import { parseArgs } from '../cli';
import { rng } from '../rand';
import { tileOf as cutterTileOf } from '../tile/standin';
import { TILE, TileSet } from '../tileset';
import { TILE_M, overrideFile, parseTileId, tileBox, tileId, tileIdAt, tileOf, tileOrigin, tilesInBox } from './grid';

/** 1,000 seeded world positions across the whole planned map and beyond, negative coordinates included. */
function seededPoints(n = 1000): { x: number; z: number }[] {
  const r = rng(20261111);
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) out.push({ x: r.range(-9000, 9000), z: r.range(-9000, 9000) });
  return out;
}

describe('world grid', () => {
  it('is 250 m, with tile (0, 0) on the world origin, x east and z south', () => {
    expect(TILE_M).toBe(250);
    expect(tileOf(0, 0)).toEqual({ tx: 0, tz: 0 });
    expect(tileOf(249.999, 249.999)).toEqual({ tx: 0, tz: 0 });
    expect(tileOf(250, 0)).toEqual({ tx: 1, tz: 0 });
    // north is -Z: a point just north of the origin is in tile row -1
    expect(tileOf(0, -0.001)).toEqual({ tx: 0, tz: -1 });
    expect(tileOf(-0.001, 0)).toEqual({ tx: -1, tz: 0 });
    expect(tileOf(-250, -250)).toEqual({ tx: -1, tz: -1 });
    expect(tileOf(-250.001, -250.001)).toEqual({ tx: -2, tz: -2 });
    // India Gate, a point in Old Delhi and the Cyber City frame origin by their world metres
    expect(tileIdAt(621.6, 467.2)).toBe('2_1');
    expect(tileIdAt(1751.6, -4327.3)).toBe('7_-18');
    expect(tileIdAt(-6268.5, 7001.7)).toBe('-26_28');
  });

  it('round trips the tile id of 1,000 seeded points, negative coordinates included', () => {
    const pts = seededPoints();
    expect(pts).toHaveLength(1000);
    expect(pts.filter((p) => p.x < 0 && p.z < 0).length).toBeGreaterThan(150);
    expect(pts.filter((p) => p.x < 0).length).toBeGreaterThan(400);
    expect(pts.filter((p) => p.z < 0).length).toBeGreaterThan(400);
    const seen = new Set<string>();
    for (const p of pts) {
      const t = tileOf(p.x, p.z);
      const id = tileId(t.tx, t.tz);
      seen.add(id);
      // id to indices and back
      const back = parseTileId(id);
      expect(back).toEqual(t);
      expect(tileId(back.tx, back.tz)).toBe(id);
      expect(tileIdAt(p.x, p.z)).toBe(id);
      // the point lies in the square the id names, and nowhere else
      const box = tileBox(back.tx, back.tz);
      expect(p.x).toBeGreaterThanOrEqual(box.minX);
      expect(p.x).toBeLessThan(box.maxX);
      expect(p.z).toBeGreaterThanOrEqual(box.minZ);
      expect(p.z).toBeLessThan(box.maxZ);
      // the position relative to the tile origin is inside one tile, so a 32-bit float keeps it to 0.03 mm
      const o = tileOrigin(back.tx, back.tz);
      expect(p.x - o.x).toBeGreaterThanOrEqual(0);
      expect(p.x - o.x).toBeLessThan(TILE_M);
      expect(p.z - o.z).toBeGreaterThanOrEqual(0);
      expect(p.z - o.z).toBeLessThan(TILE_M);
      // the origin itself and the tile's centre name the same tile
      expect(tileIdAt(o.x, o.z)).toBe(id);
      expect(tileIdAt(o.x + TILE_M / 2, o.z + TILE_M / 2)).toBe(id);
    }
    expect(seen.size).toBeGreaterThan(800);
  });

  it('refuses ids and indices that are not whole numbers, and never writes minus zero', () => {
    expect(tileId(-0, 0)).toBe('0_0');
    expect(parseTileId('-0_0')).toEqual({ tx: 0, tz: 0 });
    expect(Object.is(parseTileId('-0_0').tx, -0)).toBe(false);
    expect(parseTileId('4_-19')).toEqual({ tx: 4, tz: -19 });
    for (const bad of ['4', '4_', '4_x', '4.5_2', ' 4_2', '4_2.json', '']) expect(() => parseTileId(bad)).toThrow(/not a tile id/);
    expect(() => tileId(1.5, 0)).toThrow(/whole numbers/);
  });

  it('lists the tiles of a box row by row from the north-west', () => {
    expect(tilesInBox({ minX: -10, maxX: 260, minZ: -260, maxZ: 10 }).map((t) => tileId(t.tx, t.tz))).toEqual(['-1_-2', '0_-2', '1_-2', '-1_-1', '0_-1', '1_-1', '-1_0', '0_0', '1_0']);
    // a box that ends exactly on a tile edge stays in its tile
    expect(tilesInBox({ minX: 0, maxX: 250, minZ: 0, maxZ: 250 })).toEqual([{ tx: 0, tz: 0 }]);
    expect(tilesInBox({ minX: 100, maxX: 100, minZ: -100, maxZ: -100 })).toEqual([{ tx: 0, tz: -1 }]);
  });
});

describe('one grid for the tile cutter, the overrides, the bake options and the inspector', () => {
  it('all name the same tile for 1,000 seeded points', () => {
    expect(TILE).toBe(TILE_M);
    expect(TILE_SIZE).toBe(TILE_M);
    for (const p of seededPoints()) {
      const t = tileOf(p.x, p.z);
      expect(cutterTileOf(p.x, p.z, TILE_M)).toEqual(t);
      const file = overrideFile(t.tx, t.tz);
      expect(file).toBe(`${tileId(t.tx, t.tz)}.json`);
      const insp = worldTile(p.x, p.z);
      expect(insp).toEqual([t.tx, t.tz]);
      expect(overrideFileName(insp)).toBe(file);
    }
  });

  it('the cutter files a triangle under the grid tile of its centre', () => {
    const set = new TileSet(0);
    for (const p of seededPoints(60)) set.tri('centre', 'ground', [p.x - 1, 0, p.z - 1], [p.x + 1, 0, p.z - 1], [p.x, 0, p.z + 2], [0, 1, 0]);
    const tiles = set.contents();
    const want = new Set(seededPoints(60).map((p) => tileIdAt(p.x, p.z)));
    expect(new Set(tiles.map((t) => tileId(t.tx, t.tz)))).toEqual(want);
    for (const t of tiles) expect([t.origin[0], t.origin[2]]).toEqual([tileOrigin(t.tx, t.tz).x, tileOrigin(t.tx, t.tz).z]);
  });

  it('the --tiles option of the bake reads the same ids', () => {
    const args = parseArgs(['pilot', '--tiles', `${tileIdAt(621.6, 467.2)},${tileIdAt(-6268.5, 7001.7)}`]);
    expect(args.tiles).toEqual([{ x: 2, z: 1 }, { x: -26, z: 28 }]);
    expect(args.tiles!.map((t) => tileId(t.x, t.z))).toEqual(['2_1', '-26_28']);
  });
});
