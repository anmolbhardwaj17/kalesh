// The one world grid (P1-008, TECH.md "Tile format": "One world grid of 250 m tiles; tiles ignore district
// outlines"). A tile id comes from world metres only (east +X, north -Z), never from a block or a district frame, so
// the tile cutter, the overrides files (harness/data/overrides/<tileX>_<tileZ>.json), the bake's --tiles option and
// the map inspector all name the same square the same way. Tile (0, 0) has its north-west corner on the world origin;
// tile x grows east, tile z grows south. Pure, and it imports nothing, so a page can load it as it is.

/** Side of a world tile in metres. */
export const TILE_M = 250;

export interface TileXZ {
  tx: number;
  tz: number;
}

/** The tile that holds a world position. A point on a tile's west or north edge belongs to that tile. */
export function tileOf(x: number, z: number, size: number = TILE_M): TileXZ {
  return { tx: Math.floor(x / size), tz: Math.floor(z / size) };
}

/** The id of a tile: "<tileX>_<tileZ>", for example "4_-19". Also the stem of its overrides file. */
export function tileId(tx: number, tz: number): string {
  if (!Number.isInteger(tx) || !Number.isInteger(tz)) throw new Error(`tile indices must be whole numbers (got ${tx}, ${tz})`);
  // no "-0": a tile index of minus zero is tile 0
  return `${tx === 0 ? 0 : tx}_${tz === 0 ? 0 : tz}`;
}

/** The id of the tile that holds a world position. */
export const tileIdAt = (x: number, z: number): string => {
  const t = tileOf(x, z);
  return tileId(t.tx, t.tz);
};

const ID_RE = /^(-?\d+)_(-?\d+)$/;

/** Reads a tile id back. Throws on anything that is not "<whole number>_<whole number>". */
export function parseTileId(id: string): TileXZ {
  const m = ID_RE.exec(id);
  if (!m) throw new Error(`"${id}" is not a tile id (<tileX>_<tileZ>, whole numbers)`);
  const tx = Number(m[1]);
  const tz = Number(m[2]);
  return { tx: tx === 0 ? 0 : tx, tz: tz === 0 ? 0 : tz };
}

/** World metres of a tile's north-west corner (its lowest x and lowest z): every vertex of the tile is relative to it. */
export function tileOrigin(tx: number, tz: number, size: number = TILE_M): { x: number; z: number } {
  return { x: tx * size, z: tz * size };
}

/** The square of a tile in world metres. */
export function tileBox(tx: number, tz: number, size: number = TILE_M): { minX: number; maxX: number; minZ: number; maxZ: number } {
  return { minX: tx * size, maxX: (tx + 1) * size, minZ: tz * size, maxZ: (tz + 1) * size };
}

/** The file an override is filed under: the tile of its anchor in world metres. */
export const overrideFile = (tx: number, tz: number): string => `${tileId(tx, tz)}.json`;

/** Every tile that touches a box of world metres, row by row from the north-west. */
export function tilesInBox(box: { minX: number; maxX: number; minZ: number; maxZ: number }, size: number = TILE_M): TileXZ[] {
  const a = tileOf(box.minX, box.minZ, size);
  // a box that ends exactly on a tile edge does not reach into the next tile
  const b = { tx: Math.ceil(box.maxX / size) - 1, tz: Math.ceil(box.maxZ / size) - 1 };
  const out: TileXZ[] = [];
  for (let tz = a.tz; tz <= Math.max(a.tz, b.tz); tz++) for (let tx = a.tx; tx <= Math.max(a.tx, b.tx); tx++) out.push({ tx, tz });
  return out;
}
