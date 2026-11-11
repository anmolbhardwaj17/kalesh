// The stitched world of the stitch bench as tile content (ARCH_OPTIONS FP1, DC3, FL1): one ground lattice for the
// whole map (district ground with its height offset, filler ground blended between district edges, the river bed),
// stand-in district content (road ribbons, extruded footprints, edge band shells), closures and the connector
// surfaces from the lane model. Everything is in world metres and is cut into 250 m tiles whose vertices are
// relative to the tile's own origin (FP1). Pure: no file access.
import { pointInRing, triangulate } from '../geom.ts';
import type { P2 } from '../geom.ts';
import type { Strip } from '../roads/model.ts';
import { MeshBuilder } from '../tile.ts';
import type { MeshData, TileContent } from '../tile.ts';
import { ringProject } from './clip.ts';

export type V3 = [number, number, number];
export const TILE = 250;

/** Triangles in world metres, sorted into 250 m tiles per layer. A layer becomes the tile's `district` field. */
export class TileSet {
  private readonly tiles = new Map<string, { layer: string; tx: number; tz: number; meshes: Map<string, MeshBuilder> }>();
  readonly yBase: number;
  constructor(yBase: number) {
    this.yBase = yBase;
  }

  /** A triangle goes to the tile of its centre, or to the tile of `anchor` (a small object that must stay whole). */
  tri(layer: string, material: string, a: V3, b: V3, c: V3, n: V3, name = material, anchor?: P2): void {
    const tx = Math.floor((anchor ? anchor.x : (a[0] + b[0] + c[0]) / 3) / TILE);
    const tz = Math.floor((anchor ? anchor.z : (a[2] + b[2] + c[2]) / 3) / TILE);
    const key = `${layer}|${tx}|${tz}`;
    let tile = this.tiles.get(key);
    if (!tile) {
      tile = { layer, tx, tz, meshes: new Map() };
      this.tiles.set(key, tile);
    }
    let mesh = tile.meshes.get(name);
    if (!mesh) {
      mesh = new MeshBuilder(name, material);
      tile.meshes.set(name, mesh);
    }
    const x0 = tx * TILE;
    const z0 = tz * TILE;
    const y0 = this.yBase;
    mesh.tri([a[0] - x0, a[1] - y0, a[2] - z0], [b[0] - x0, b[1] - y0, b[2] - z0], [c[0] - x0, c[1] - y0, c[2] - z0], n);
  }

  quad(layer: string, material: string, a: V3, b: V3, c: V3, d: V3, n: V3, name = material, anchor?: P2): void {
    this.tri(layer, material, a, b, c, n, name, anchor);
    this.tri(layer, material, a, c, d, n, name, anchor);
  }

  /** Tile content per layer and tile: origin is the tile's north-west corner in world metres at the height base. */
  contents(): TileContent[] {
    const out: TileContent[] = [];
    for (const t of this.tiles.values()) {
      const meshes: MeshData[] = [...t.meshes.values()].map((m) => m.mesh);
      out.push({ district: t.layer, tx: t.tx, tz: t.tz, size: TILE, origin: [t.tx * TILE, this.yBase, t.tz * TILE], meshes, colliders: [], placements: [] });
    }
    out.sort((a, b) => (a.district < b.district ? -1 : a.district > b.district ? 1 : a.tz - b.tz || a.tx - b.tx));
    return out;
  }
}

const faceNormal = (a: V3, b: V3, c: V3, up = true): V3 => {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  let n: V3 = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  n = [n[0] / len, n[1] / len, n[2] / len];
  return up && n[1] < 0 ? [-n[0], -n[1], -n[2]] : n;
};

/** A road ribbon along a polyline: one mitred strip, `lift` metres above the ground. */
export function ribbon(set: TileSet, layer: string, material: string, pts: readonly P2[], width: number, ground: (x: number, z: number) => number, lift: number): void {
  if (pts.length < 2) return;
  const half = width / 2;
  const left: V3[] = [];
  const right: V3[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as P2;
    const a = pts[Math.max(0, i - 1)] as P2;
    const b = pts[Math.min(pts.length - 1, i + 1)] as P2;
    // the normal at a vertex: the mean of the two segment normals, stretched so the strip keeps its width (clamped)
    const d1 = i > 0 ? Math.hypot(p.x - a.x, p.z - a.z) || 1 : 0;
    const d2 = i + 1 < pts.length ? Math.hypot(b.x - p.x, b.z - p.z) || 1 : 0;
    let nx = 0;
    let nz = 0;
    if (d1 > 0) {
      nx += (p.z - a.z) / d1;
      nz += -(p.x - a.x) / d1;
    }
    if (d2 > 0) {
      nx += (b.z - p.z) / d2;
      nz += -(b.x - p.x) / d2;
    }
    const len = Math.hypot(nx, nz);
    if (len < 1e-9) {
      nx = 0;
      nz = 1;
    } else {
      nx /= len;
      nz /= len;
    }
    const cos = d1 > 0 && d2 > 0 ? Math.max(0.5, len / 2) : 1;
    const w = half / cos;
    // level across: the highest ground under the centre and the two edges, so no edge dips into a slope
    const y = Math.max(ground(p.x, p.z), ground(p.x + nx * w, p.z + nz * w), ground(p.x - nx * w, p.z - nz * w)) + lift;
    left.push([p.x + nx * w, y, p.z + nz * w]);
    right.push([p.x - nx * w, y, p.z - nz * w]);
  }
  for (let i = 0; i + 1 < pts.length; i++) set.quad(layer, material, left[i] as V3, left[i + 1] as V3, right[i + 1] as V3, right[i] as V3, [0, 1, 0]);
}

/** An extruded footprint: walls and a flat roof. */
export function prism(set: TileSet, layer: string, material: string, ring: readonly P2[], base: number, top: number, name = material, anchor?: P2): void {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i] as P2;
    const b = ring[(i + 1) % n] as P2;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-6) continue;
    // outward: away from the ring's inside; the mid point of the edge pushed along the normal must lie outside
    let nx = (b.z - a.z) / len;
    let nz = -(b.x - a.x) / len;
    if (pointInRing({ x: (a.x + b.x) / 2 + nx * 0.05, z: (a.z + b.z) / 2 + nz * 0.05 }, ring)) {
      nx = -nx;
      nz = -nz;
    }
    set.quad(layer, material, [a.x, base, a.z], [b.x, base, b.z], [b.x, top, b.z], [a.x, top, a.z], [nx, 0, nz], name, anchor);
  }
  const idx = triangulate(ring);
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const p = ring[idx[i] as number] as P2;
    const q = ring[idx[i + 1] as number] as P2;
    const r = ring[idx[i + 2] as number] as P2;
    set.tri(layer, material, [p.x, top, p.z], [q.x, top, q.z], [r.x, top, r.z], [0, 1, 0], name, anchor);
  }
}

/** A wall, gate or barrier between two points: a box `thick` metres deep. */
export function bar(set: TileSet, layer: string, material: string, a: P2, b: P2, thick: number, base: number, height: number): void {
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const nx = ((b.z - a.z) / len) * (thick / 2);
  const nz = (-(b.x - a.x) / len) * (thick / 2);
  prism(set, layer, material, [{ x: a.x + nx, z: a.z + nz }, { x: b.x + nx, z: b.z + nz }, { x: b.x - nx, z: b.z - nz }, { x: a.x - nx, z: a.z - nz }], base, base + height);
}

/** A regular grid of ground heights over a box: the one ground of the stitched world. */
export class Lattice {
  readonly x0: number;
  readonly z0: number;
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  readonly h: Float64Array;

  constructor(x0: number, z0: number, x1: number, z1: number, cell: number, height: (x: number, z: number) => number) {
    this.x0 = x0;
    this.z0 = z0;
    this.cell = cell;
    this.cols = Math.round((x1 - x0) / cell) + 1;
    this.rows = Math.round((z1 - z0) / cell) + 1;
    this.h = new Float64Array(this.cols * this.rows);
    for (let j = 0; j < this.rows; j++) for (let i = 0; i < this.cols; i++) this.h[j * this.cols + i] = height(x0 + i * cell, z0 + j * cell);
  }

  /** The drawn ground height: the two triangles of a cell are split from its north-west to its south-east corner. */
  at = (x: number, z: number): number => {
    const fx = Math.max(0, Math.min(this.cols - 1.000001, (x - this.x0) / this.cell));
    const fz = Math.max(0, Math.min(this.rows - 1.000001, (z - this.z0) / this.cell));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const h00 = this.h[j * this.cols + i] as number;
    const h10 = this.h[j * this.cols + i + 1] as number;
    const h01 = this.h[(j + 1) * this.cols + i] as number;
    const h11 = this.h[(j + 1) * this.cols + i + 1] as number;
    // the diagonal runs from (0, 0) to (1, 1): above it u >= v
    return u >= v ? h00 + (h10 - h00) * u + (h11 - h10) * v : h00 + (h01 - h00) * v + (h11 - h01) * u;
  };

  /**
   * Lays the ground under roads built elsewhere (the connectors): every lattice point within `reach` of a road
   * point takes the height of the nearest one, less `under`. Returns the lattice points changed.
   */
  conform(points: readonly { x: number; z: number; h: number; reach: number }[], under: number): number {
    const best = new Float32Array(this.h.length).fill(Infinity);
    let n = 0;
    for (const p of points) {
      const i0 = Math.max(0, Math.floor((p.x - p.reach - this.x0) / this.cell));
      const i1 = Math.min(this.cols - 1, Math.ceil((p.x + p.reach - this.x0) / this.cell));
      const j0 = Math.max(0, Math.floor((p.z - p.reach - this.z0) / this.cell));
      const j1 = Math.min(this.rows - 1, Math.ceil((p.z + p.reach - this.z0) / this.cell));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const d = Math.hypot(this.x0 + i * this.cell - p.x, this.z0 + j * this.cell - p.z);
          const k = j * this.cols + i;
          if (d > p.reach || d >= (best[k] as number)) continue;
          if (best[k] === Infinity) n++;
          best[k] = d;
          this.h[k] = p.h - under;
        }
      }
    }
    return n;
  }

  /** The ground as triangles: `pick` names the layer and the surface of a cell from its centre (null leaves the cell out). */
  emit(set: TileSet, pick: (x: number, z: number, h: number) => { layer: string; material: string } | null): number {
    let cells = 0;
    for (let j = 0; j + 1 < this.rows; j++) {
      for (let i = 0; i + 1 < this.cols; i++) {
        const x = this.x0 + i * this.cell;
        const z = this.z0 + j * this.cell;
        const h00 = this.h[j * this.cols + i] as number;
        const h10 = this.h[j * this.cols + i + 1] as number;
        const h01 = this.h[(j + 1) * this.cols + i] as number;
        const h11 = this.h[(j + 1) * this.cols + i + 1] as number;
        const m = pick(x + this.cell / 2, z + this.cell / 2, (h00 + h10 + h01 + h11) / 4);
        if (m === null) continue;
        const a: V3 = [x, h00, z];
        const b: V3 = [x + this.cell, h10, z];
        const c: V3 = [x + this.cell, h11, z + this.cell];
        const d: V3 = [x, h01, z + this.cell];
        set.tri(m.layer, m.material, a, b, c, faceNormal(a, b, c));
        set.tri(m.layer, m.material, a, c, d, faceNormal(a, c, d));
        cells++;
      }
    }
    return cells;
  }
}

export interface GroundSource {
  /** The district's clip ring in world metres. */
  ring: readonly P2[];
  /** Ground height at world metres, height offset included. Valid on the ring and a little outside it. */
  height: (x: number, z: number) => number;
}

/**
 * Ground of the stitched world before the river: inside a district its own ground; outside every district a blend
 * of the districts' edge heights (each district's ground at the point of its clip ring nearest to the place),
 * weighted by 1 / distance^2 to that ring, so the filler meets every district edge at that district's own height.
 * `coarse` are simplified rings for the distance search.
 */
export function blendGround(sources: readonly GroundSource[], coarse: readonly (readonly P2[])[]): (x: number, z: number) => number {
  return (x, z) => {
    const p = { x, z };
    for (const s of sources) if (pointInRing(p, s.ring)) return s.height(x, z);
    let sum = 0;
    let wSum = 0;
    sources.forEach((s, i) => {
      const q = ringProject(coarse[i] ?? s.ring, p);
      const w = 1 / (q.d * q.d + 1);
      sum += w * s.height(q.x, q.z);
      wSum += w;
    });
    return wSum > 0 ? sum / wSum : 0;
  };
}

export interface River {
  /** Centre line in world metres, north to south. */
  line: P2[];
  width: number;
  depth: number;
  /** Width of each bank slope, metres. */
  bank: number;
}

/** How far the river bed lies under the ground at a point: 0 outside the river, `depth` in the channel. */
export function riverDepth(r: River, p: P2): number {
  let d = Infinity;
  for (let i = 0; i + 1 < r.line.length; i++) {
    const a = r.line[i] as P2;
    const b = r.line[i + 1] as P2;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
    d = Math.min(d, Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t)));
  }
  const edge = r.width / 2;
  if (d >= edge) return 0;
  const t = Math.min(1, (edge - d) / r.bank);
  return r.depth * t * t * (3 - 2 * t);
}

/**
 * Verges of the connector surfaces: a sloped shoulder from each outer edge of a strip at grade down to the drawn
 * ground, so a road that the solver lifted a little off the ground does not show a gap under its kerb.
 */
export function verges(set: TileSet, layer: string, strips: readonly Strip[], ground: (x: number, z: number) => number, lift: number, reach = 2.5): number {
  let quads = 0;
  for (const s of strips) {
    for (let i = 0; i + 1 < s.st.length; i++) {
      const p = s.st[i] as Strip['st'][number];
      const q = s.st[i + 1] as Strip['st'][number];
      if (p.structure > 0 || q.structure > 0) continue;
      for (const side of [0, 1]) {
        const k = side === 0 ? 0 : p.b.length - 1;
        const sign = side === 0 ? 1 : -1;
        const edge = (st: Strip['st'][number]): { top: V3; foot: V3 } => {
          const lat = st.b[k] as number;
          const laneK = side === 0 ? 0 : s.lanes.length - 1;
          const raise = (s.lanes[laneK] as Strip['lanes'][number]).raise;
          const x = st.x + st.nx * lat;
          const z = st.z + st.nz * lat;
          const fx = x + st.nx * sign * reach;
          const fz = z + st.nz * sign * reach;
          return { top: [x, st.h + raise + lift, z], foot: [fx, Math.min(ground(fx, fz), st.h + lift) - 0.05, fz] };
        };
        const a = edge(p);
        const b = edge(q);
        set.quad(layer, 'verge', a.top, b.top, b.foot, a.foot, faceNormal(a.top, b.top, b.foot));
        quads++;
      }
    }
  }
  return quads;
}
