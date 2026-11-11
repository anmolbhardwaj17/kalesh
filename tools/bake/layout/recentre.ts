// The world origin and the recentre step (P1-008; TECH.md "World layout": "World origin", float precision FP1).
//
// The world origin is fixed by one number pair: where the pivot (India Gate) sits in world metres. Today that is
// (621.6, 467.2), which puts the origin on the centre of the layout C map box. The first bake that includes a far
// block (P8) moves the origin to the centre of the smallest circle round the final map, so that 32-bit floats stay
// fine everywhere (measured in P1-008: the centre of the map box would leave Cyber City 9.0 km out, the circle's
// centre 8.0 km).
// Moving the origin means subtracting ONE vector from every stored world position: the pivot, tile origins, landmark
// pins, mission anchors, connector control points, save checkpoints. Nothing turns, nothing scales, nothing flips.
//
// The vector is always a whole number of 250 m tiles. That way no tile is cut again: a tile keeps its content and
// its tile-relative vertices, only its index and its origin change, and an overrides file is renamed, not re-filed.
//
// Every stored record set carries the pivot's world position it was written with (`pivotWorld`). The vector between
// two layouts is the difference of those two stamps, so an old save or an old tile index is moved exactly once.
// Pure.
import type { Box2, P2 } from '../geom.ts';
import { TILE_M, parseTileId, tileId } from './grid.ts';

export interface NamedPoint extends P2 {
  name: string;
}

export interface Extent {
  box: Box2;
  /** East to west and north to south size of the box, metres. */
  widthM: number;
  depthM: number;
  centre: P2;
  /** The point farthest from the box centre, and how far. */
  reachM: number;
  reachAt: string;
}

/** The map box of a set of world positions, its centre, and the farthest position from that centre. */
export function mapExtent(points: readonly NamedPoint[], centre?: P2): Extent {
  if (!points.length) throw new Error('mapExtent: no points');
  const box: Box2 = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const p of points) {
    box.minX = Math.min(box.minX, p.x);
    box.maxX = Math.max(box.maxX, p.x);
    box.minZ = Math.min(box.minZ, p.z);
    box.maxZ = Math.max(box.maxZ, p.z);
  }
  const c = centre ?? { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 };
  let reachM = 0;
  let reachAt = '';
  for (const p of points) {
    const d = Math.hypot(p.x - c.x, p.z - c.z);
    if (d > reachM) {
      reachM = d;
      reachAt = p.name;
    }
  }
  return { box, widthM: box.maxX - box.minX, depthM: box.maxZ - box.minZ, centre: c, reachM, reachAt };
}

/** True when a vector is a whole number of tiles on both axes. */
export const onGrid = (v: P2, size: number = TILE_M): boolean => Number.isInteger(v.x / size) && Number.isInteger(v.z / size);

export interface Circle {
  centre: P2;
  radiusM: number;
}

/** Convex hull of a point set (monotone chain), without repeated points. */
function hull(points: readonly P2[]): P2[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.z - b.z).filter((p, i, all) => i === 0 || p.x !== (all[i - 1] as P2).x || p.z !== (all[i - 1] as P2).z);
  if (pts.length < 3) return pts;
  const cross = (o: P2, a: P2, b: P2): number => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
  const half = (list: readonly P2[]): P2[] => {
    const out: P2[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2] as P2, out[out.length - 1] as P2, p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

/**
 * The smallest circle that holds every point: its centre is the one world origin from which the farthest position
 * is as near as it can be. (The centre of the map box is not that point: a far block in one corner of the box lies
 * a box half-diagonal away from it.) Exact and with no random step: pairs and triples of the convex hull.
 */
export function smallestCircle(points: readonly P2[]): Circle {
  if (!points.length) throw new Error('smallestCircle: no points');
  const h = hull(points);
  const first = h[0] as P2;
  if (h.length === 1) return { centre: { x: first.x, z: first.z }, radiusM: 0 };
  const holds = (c: P2, r: number): boolean => h.every((p) => Math.hypot(p.x - c.x, p.z - c.z) <= r * (1 + 1e-12) + 1e-9);
  let best: Circle | null = null;
  const take = (c: P2, r: number): void => {
    if ((!best || r < best.radiusM) && holds(c, r)) best = { centre: c, radiusM: r };
  };
  for (let i = 0; i < h.length; i++) {
    for (let j = i + 1; j < h.length; j++) {
      const a = h[i] as P2;
      const b = h[j] as P2;
      take({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, Math.hypot(a.x - b.x, a.z - b.z) / 2);
      for (let k = j + 1; k < h.length; k++) {
        const c = h[k] as P2;
        const d = 2 * (a.x * (b.z - c.z) + b.x * (c.z - a.z) + c.x * (a.z - b.z));
        if (Math.abs(d) < 1e-9) continue;
        const a2 = a.x * a.x + a.z * a.z;
        const b2 = b.x * b.x + b.z * b.z;
        const c2 = c.x * c.x + c.z * c.z;
        const u = { x: (a2 * (b.z - c.z) + b2 * (c.z - a.z) + c2 * (a.z - b.z)) / d, z: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d };
        take(u, Math.hypot(a.x - u.x, a.z - u.z));
      }
    }
  }
  return best as unknown as Circle;
}

/** A point snapped to whole tiles (at most half a tile off per axis). */
export function snapToTiles(p: P2, size: number = TILE_M): P2 {
  const snap = (v: number): number => {
    const r = Math.round(v / size) * size;
    return r === 0 ? 0 : r;
  };
  return { x: snap(p.x), z: snap(p.z) };
}

/**
 * The recentre vector for a set of world positions: the centre of their smallest circle, snapped to whole tiles.
 * Subtracting it puts the world origin where the farthest position is nearest (within half a tile per axis).
 */
export function recentreVector(points: readonly P2[], size: number = TILE_M): P2 {
  return snapToTiles(smallestCircle(points).centre, size);
}

/** The vector that takes records written with the pivot at `from` to a layout with the pivot at `to`: from - to. */
export function originShift(from: P2, to: P2): P2 {
  return { x: from.x - to.x, z: from.z - to.z };
}

export interface TileRef {
  /** Block id of the tile (the `district` field of a KTL1 header). */
  block: string;
  tx: number;
  tz: number;
  /** World metres of the tile's north-west corner at its height base; vertices are relative to it. */
  origin: [number, number, number];
}

export interface WorldPin extends P2 {
  id: string;
  block: string;
  y?: number;
}

export interface WorldAnchor extends P2 {
  id: string;
  block: string;
  /** Compass heading in radians, 0 is north: a recentre never touches it. */
  heading?: number;
}

export interface SaveCheckpoint extends P2 {
  profile: string;
  block: string;
  y: number;
  heading: number;
}

export interface WorldRecords {
  /** World position of the pivot these records were written with. */
  pivotWorld: P2;
  blocks: { id: string; offset: P2 }[];
  tiles: TileRef[];
  pins: WorldPin[];
  anchors: WorldAnchor[];
  saves: SaveCheckpoint[];
  /** Authored corridors: control points in world metres. */
  connectors: { id: string; points: P2[] }[];
  /** Tile ids of the overrides files ("<tileX>_<tileZ>"). */
  overrides: string[];
}

const moved = <T extends P2>(p: T, v: P2): T => ({ ...p, x: p.x - v.x, z: p.z - v.z });

/**
 * The recentre step: subtracts one vector from every world position of a record set. Heights, headings, block ids
 * and everything inside a tile stay as they are. Throws when the vector is not a whole number of tiles.
 */
export function recentre(r: WorldRecords, v: P2, size: number = TILE_M): WorldRecords {
  if (!onGrid(v, size)) throw new Error(`recentre: the vector (${v.x}, ${v.z}) is not a whole number of ${size} m tiles; tiles would have to be cut again`);
  const dx = v.x / size;
  const dz = v.z / size;
  return {
    pivotWorld: moved(r.pivotWorld, v),
    blocks: r.blocks.map((b) => ({ ...b, offset: moved(b.offset, v) })),
    tiles: r.tiles.map((t) => ({ ...t, tx: t.tx - dx, tz: t.tz - dz, origin: [t.origin[0] - v.x, t.origin[1], t.origin[2] - v.z] })),
    pins: r.pins.map((p) => moved(p, v)),
    anchors: r.anchors.map((a) => moved(a, v)),
    saves: r.saves.map((s) => moved(s, v)),
    connectors: r.connectors.map((c) => ({ ...c, points: c.points.map((p) => moved(p, v)) })),
    overrides: r.overrides.map((id) => {
      const t = parseTileId(id);
      return tileId(t.tx - dx, t.tz - dz);
    }),
  };
}

/**
 * Brings records written under an older world origin to the current one: the vector is read from the two pivot
 * stamps. Records that already carry the current stamp come back unchanged, so the step is safe to run twice.
 */
export function recentreTo(r: WorldRecords, pivotWorldNow: P2, size: number = TILE_M): WorldRecords {
  const raw = originShift(r.pivotWorld, pivotWorldNow);
  // two stamps written as decimals differ by a whole tile count only to float precision: take the rounding out
  const clean = (d: number): number => {
    const s = Math.round(d / size) * size;
    return Math.abs(s - d) < 1e-6 ? (s === 0 ? 0 : s) : d;
  };
  const v = { x: clean(raw.x), z: clean(raw.z) };
  if (v.x === 0 && v.z === 0) return r;
  const out = recentre(r, v, size);
  // the stamp is the target itself, not old minus vector: no float drift in the record that names the origin
  return { ...out, pivotWorld: { x: pivotWorldNow.x, z: pivotWorldNow.z } };
}
