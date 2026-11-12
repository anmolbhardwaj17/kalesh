// Checks of the written tiles (P1-016 acceptance), on the bytes read back: what the game loads, 32-bit floats
// relative to each tile, not what the bake meant to write.
// - Collider against the drawn surface: rays straight down at seeded points of a tile, against that tile and its
//   eight neighbours (a road triangle of the next tile may cover a corner). The first collider hit and the first
//   drawn hit must both be there or both be missing and lie within 0.05 m.
// - Deck rays: straight down every 5 cm along every driving lane of a deck, and on every station line (where two
//   deck triangles, and possibly two chunks, meet): the collider is never missed.
// - Rays count only faces whose front looks up (Godot's concave shapes collide on the front only; a front face is
//   clockwise, so its normal is -(b - a) x (c - a)). Paint, the water surface and ceilings are drawn but no collider.
// Pure.
import { tileId, tileOf } from '../layout/grid.ts';
import type { P2 } from '../geom.ts';
import { rngFor } from '../rand.ts';
import type { Strip } from '../roads/model.ts';
import { decodeContent } from './codec.ts';

/** Drawn materials that are not solid: a ray is not meant to stop on them. */
const NOT_SOLID = new Set(['water']);
/** A collider hit within this of the drawn surface counts (TECH.md K3 rule). */
export const RAY_TOLERANCE_M = 0.05;

class TriSet {
  private readonly cell = 4;
  private readonly cells = new Map<number, number[]>();
  /** Nine world numbers per triangle. */
  readonly t: number[] = [];

  add(faces: ArrayLike<number>, origin: readonly [number, number, number]): void {
    for (let k = 0; k + 8 < faces.length; k += 9) {
      const a = [faces[k]! + origin[0], faces[k + 1]! + origin[1], faces[k + 2]! + origin[2]];
      const b = [faces[k + 3]! + origin[0], faces[k + 4]! + origin[1], faces[k + 5]! + origin[2]];
      const c = [faces[k + 6]! + origin[0], faces[k + 7]! + origin[1], faces[k + 8]! + origin[2]];
      // front face up only: -(b - a) x (c - a) has a positive y
      const ny = -((b[2]! - a[2]!) * (c[0]! - a[0]!) - (b[0]! - a[0]!) * (c[2]! - a[2]!));
      if (!(ny > 0)) continue;
      const id = this.t.length / 9;
      this.t.push(...a, ...b, ...c);
      const x0 = Math.floor(Math.min(a[0]!, b[0]!, c[0]!) / this.cell);
      const x1 = Math.floor(Math.max(a[0]!, b[0]!, c[0]!) / this.cell);
      const z0 = Math.floor(Math.min(a[2]!, b[2]!, c[2]!) / this.cell);
      const z1 = Math.floor(Math.max(a[2]!, b[2]!, c[2]!) / this.cell);
      for (let i = x0; i <= x1; i++) {
        for (let j = z0; j <= z1; j++) {
          const key = (i + 1048576) * 2097152 + (j + 1048576);
          let list = this.cells.get(key);
          if (!list) this.cells.set(key, (list = []));
          list.push(id);
        }
      }
    }
  }

  /** The highest hit of a ray straight down at (x, z) from `from` (or from above everything), or NaN. */
  top(x: number, z: number, from = Infinity): number {
    const list = this.cells.get((Math.floor(x / this.cell) + 1048576) * 2097152 + (Math.floor(z / this.cell) + 1048576));
    if (!list) return NaN;
    let best = NaN;
    const t = this.t;
    for (const id of list) {
      const o = id * 9;
      const ax = t[o]!;
      const az = t[o + 2]!;
      const bx = t[o + 3]!;
      const bz = t[o + 5]!;
      const cx = t[o + 6]!;
      const cz = t[o + 8]!;
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (d === 0) continue;
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      const l3 = 1 - l1 - l2;
      // edges count on both sides: a point on an edge two triangles share lands on one of them
      if (l1 < -1e-12 || l2 < -1e-12 || l3 < -1e-12) continue;
      const y = l1 * t[o + 1]! + l2 * t[o + 4]! + l3 * t[o + 7]!;
      if (y <= from + 1e-9 && !(y <= best)) best = y;
    }
    return best;
  }
}

/** The decoded tiles a check needs: their colliders and their solid drawn triangles, in world metres. */
export class TileRays {
  readonly colliders = new TriSet();
  readonly drawn = new TriSet();
  readonly loaded: string[] = [];

  constructor(tiles: ReadonlyMap<string, Uint8Array>, ids: Iterable<string>) {
    for (const id of new Set(ids)) {
      const bytes = tiles.get(id);
      if (!bytes) continue;
      const t = decodeContent(bytes);
      this.loaded.push(id);
      for (const c of t.colliders) this.colliders.add(c.faces, t.origin);
      for (const m of t.meshes) {
        if (NOT_SOLID.has(m.material)) continue;
        const faces: number[] = [];
        for (const i of m.idx) faces.push(m.pos[i * 3]!, m.pos[i * 3 + 1]!, m.pos[i * 3 + 2]!);
        this.drawn.add(faces, t.origin);
      }
    }
  }
}

/** A tile and its eight neighbours. */
export function withNeighbours(tx: number, tz: number): string[] {
  const out: string[] = [];
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) out.push(tileId(tx + i, tz + j));
  return out;
}

export interface ColliderCheck {
  tile: string;
  name: string;
  points: number;
  /** Both hit within the tolerance. */
  matched: number;
  /** Neither hit: a hole in the world. */
  holes: number;
  /** One hit and not the other, or the two more than the tolerance apart. */
  mismatched: number;
  maxDiffM: number;
  worst: { x: number; z: number; collider: number | null; drawn: number | null } | null;
}

/** Collider against drawn surface at `n` seeded points of a world tile (world metres). */
export function colliderVsDrawn(tiles: ReadonlyMap<string, Uint8Array>, tx: number, tz: number, name: string, n = 1000): ColliderCheck {
  const rays = new TileRays(tiles, withNeighbours(tx, tz));
  const r = rngFor(tx, tz, 'collider-check');
  const out: ColliderCheck = { tile: tileId(tx, tz), name, points: n, matched: 0, holes: 0, mismatched: 0, maxDiffM: 0, worst: null };
  for (let k = 0; k < n; k++) {
    const x = tx * 250 + r.next() * 250;
    const z = tz * 250 + r.next() * 250;
    const c = rays.colliders.top(x, z);
    const d = rays.drawn.top(x, z);
    if (Number.isNaN(c) && Number.isNaN(d)) {
      out.holes++;
      continue;
    }
    const diff = Number.isNaN(c) || Number.isNaN(d) ? Infinity : Math.abs(c - d);
    if (diff <= RAY_TOLERANCE_M) out.matched++;
    else out.mismatched++;
    if (diff > out.maxDiffM || (out.worst === null && diff > 0)) {
      out.maxDiffM = Math.max(out.maxDiffM, diff);
      out.worst = { x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, collider: Number.isNaN(c) ? null : Math.round(c * 1000) / 1000, drawn: Number.isNaN(d) ? null : Math.round(d * 1000) / 1000 };
    }
  }
  if (out.maxDiffM === Infinity) out.maxDiffM = -1;
  out.maxDiffM = Math.round(out.maxDiffM * 100000) / 100000;
  return out;
}

export interface DeckRayCheck {
  strips: number;
  lanes: number;
  rays: number;
  /** Rays on a station line (the edge between two deck triangles). */
  onStationLines: number;
  misses: number;
  maxDiffM: number;
  lengthM: number;
  firstMiss: { strip: string; x: number; z: number; collider: number | null; drawn: number | null } | null;
  tiles: string[];
}

/** World tiles a deck check reads (each deck station's tile and its neighbours). */
export function deckTiles(strips: readonly Strip[], kinds: readonly ArrayLike<number>[], match: RegExp, deck: number, offset: P2): string[] {
  const out = new Set<string>();
  strips.forEach((s, si) => {
    if (!match.test(s.name)) return;
    s.st.forEach((st, i) => {
      if ((kinds[si] as ArrayLike<number>)[i] !== deck) return;
      const t = tileOf(st.x + offset.x, st.z + offset.z);
      for (const id of withNeighbours(t.tx, t.tz)) out.add(id);
    });
  });
  return [...out].sort();
}

/** Rays straight down every `step` metres along every driving lane of the matching strips where both stations are on a deck. */
export function deckRays(tiles: ReadonlyMap<string, Uint8Array>, strips: readonly Strip[], kinds: readonly ArrayLike<number>[], match: RegExp, deck: number, offset: P2, step = 0.05): DeckRayCheck {
  const ids = deckTiles(strips, kinds, match, deck, offset);
  const rays = new TileRays(tiles, ids);
  const out: DeckRayCheck = { strips: 0, lanes: 0, rays: 0, onStationLines: 0, misses: 0, maxDiffM: 0, lengthM: 0, firstMiss: null, tiles: rays.loaded };
  const cast = (s: Strip, x: number, z: number, h: number): void => {
    out.rays++;
    // from 3 m over the deck: a road above it (none on the ITO flyover) would not count
    const d = rays.drawn.top(x, z, h + 3);
    const c = rays.colliders.top(x, z, h + 3);
    const diff = Number.isNaN(c) || Number.isNaN(d) ? Infinity : Math.abs(c - d);
    const onDeck = !Number.isNaN(c) && Math.abs(c - h) < 0.5;
    if (diff > RAY_TOLERANCE_M || !onDeck) {
      out.misses++;
      out.firstMiss ??= { strip: s.id, x: Math.round(x * 1000) / 1000, z: Math.round(z * 1000) / 1000, collider: Number.isNaN(c) ? null : Math.round(c * 1000) / 1000, drawn: Number.isNaN(d) ? null : Math.round(d * 1000) / 1000 };
    } else out.maxDiffM = Math.max(out.maxDiffM, diff);
  };
  strips.forEach((s, si) => {
    if (!match.test(s.name)) return;
    const kind = kinds[si] as ArrayLike<number>;
    let used = false;
    s.lanes.forEach((l, k) => {
      if (l.type !== 'drive') return;
      let any = false;
      for (let i = 0; i + 1 < s.st.length; i++) {
        if (kind[i] !== deck || kind[i + 1] !== deck) continue;
        any = true;
        const p = s.st[i]!;
        const q = s.st[i + 1]!;
        const lp = (p.b[k]! + p.b[k + 1]!) / 2;
        const lq = (q.b[k]! + q.b[k + 1]!) / 2;
        const ax = p.x + p.nx * lp + offset.x;
        const az = p.z + p.nz * lp + offset.z;
        const bx = q.x + q.nx * lq + offset.x;
        const bz = q.z + q.nz * lq + offset.z;
        const len = Math.hypot(bx - ax, bz - az);
        out.lengthM += len;
        // the station line itself, then every 5 cm after it
        out.onStationLines++;
        cast(s, ax, az, p.h);
        for (let d = step; d < len; d += step) {
          const t = d / len;
          cast(s, ax + (bx - ax) * t, az + (bz - az) * t, p.h + (q.h - p.h) * t);
        }
      }
      if (any) out.lanes++;
      used ||= any;
    });
    if (used) out.strips++;
  });
  out.maxDiffM = Math.round(out.maxDiffM * 100000) / 100000;
  out.lengthM = Math.round(out.lengthM);
  return out;
}
