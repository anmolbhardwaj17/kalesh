// The world tile cutter (P1-008): triangles in world metres cut into the 250 m tiles of the one world grid, vertices
// relative to the tile. Moved with the code from the Phase 0 stitch bench (tools/bake/stitch/stitch.test.ts).
import { describe, expect, it } from 'vitest';
import type { P2 } from './geom';
import { rectRing } from './layout/edge';
import { tileId, tileOf } from './layout/grid';
import { TILE, TileSet, prism, ribbon } from './tileset';

const square = (x: number, z: number, size: number): P2[] => rectRing({ x, z }, size, size);

describe('the world tile cutter (FP1)', () => {
  it('cuts geometry into 250 m tiles with vertices relative to the tile', () => {
    const set = new TileSet(200);
    ribbon(set, 'd', 'road', [{ x: 3990, z: -1300 }, { x: 4010, z: -1300 }, { x: 4260, z: -1290 }, { x: 4500, z: -1290 }], 8, () => 215, 0.2);
    const tiles = set.contents();
    expect(tiles.map((t) => [t.tx, t.tz])).toEqual([[15, -6], [16, -6], [17, -6]]);
    for (const t of tiles) {
      expect(t.origin).toEqual([t.tx * TILE, 200, t.tz * TILE]);
      for (const m of t.meshes) {
        for (let i = 0; i < m.pos.length; i += 3) {
          expect(Math.abs(m.pos[i] as number)).toBeLessThan(TILE + 260);
          expect(m.pos[i + 1] as number).toBeCloseTo(15.2, 9);
        }
      }
    }
    // a 32-bit float keeps a tile-relative vertex to 0.03 mm, a world position 4 km out only to 0.25 mm
    const local = 123.4567891;
    expect(Math.abs(Math.fround(local) - local)).toBeLessThan(0.00002);
    expect(Math.abs(Math.fround(4000 + local) - (4000 + local))).toBeGreaterThan(0.00002);
  });

  it('keeps a small object whole in the tile of its anchor', () => {
    const set = new TileSet(0);
    const at = { x: 250.1, z: 0.1 };
    prism(set, 'd', 'pin', square(250, 0, 0.6), 0, 1, 'pin__x__0', at);
    const tiles = set.contents();
    expect(tiles).toHaveLength(1);
    expect((tiles[0] as { tx: number }).tx).toBe(1);
    expect(((tiles[0] as { meshes: { idx: number[] }[] }).meshes[0] as { idx: number[] }).idx.length / 3).toBe(10);
  });
});

describe('the cutter and the world grid', () => {
  it('files every triangle under the tile id of the one world grid, negative tiles included', () => {
    const set = new TileSet(0);
    prism(set, 'centre', 'pin', square(-10, -260, 0.6), 0, 1, 'pin__a__0', { x: -10, z: -260 });
    prism(set, 'centre', 'pin', square(621.6, 467.2, 0.6), 0, 1, 'pin__b__0', { x: 621.6, z: 467.2 });
    const ids = set.contents().map((t) => tileId(t.tx, t.tz));
    expect(ids).toEqual(['-1_-2', '2_1']);
    expect(tileOf(-10, -260)).toEqual({ tx: -1, tz: -2 });
    expect(tileOf(621.6, 467.2)).toEqual({ tx: 2, tz: 1 });
  });
});
