// What the ground is triangulated from (P1-015): points and segments in whole units. The segments are the free
// edges of the road mesh's own faces (the edge of everything the ground meets: at grade, the foot of a ramp wall,
// the top of a cut wall), the building footprints, water, open land, the stage outline and the lines of the 250 m
// world grid. The points are their ends, points along every long segment (a long edge beside a near vertex makes
// needle triangles) and a staggered lattice inside the blocks (the relief inside a block, and the height grid of
// open land). Points closer than a few millimetres are one point; a road vertex keeps its own coordinates. Pure.
import type { P2 } from '../geom.ts';
import { pointInRing } from '../geom.ts';
import { TILE_M } from '../layout/grid.ts';
import { edgeKey } from '../mesh/conform.ts';
import type { EdgeMap } from '../mesh/conform.ts';
import { CUT_EDGE, CUT_NONE, CUT_WALL } from '../mesh/faces.ts';
import type { FaceSet } from '../mesh/faces.ts';
import { K_DECK, K_TUNNEL } from '../mesh/stripfaces.ts';
import { ROOF_DEPTH_M } from '../mesh/structures.ts';
import type { FaceGrid, Headwall } from '../mesh/structures.ts';
import type { Station, Strip } from '../roads/model.ts';
import { CH_BUILDING, CH_OPEN, CH_OUTLINE, CH_ROAD, CH_WATER, GRID_LABEL, PLAIN_LABEL, label } from './labels.ts';
import { UNITS, toUnits } from './predicates.ts';
import { lineRings } from './water.ts';
import type { WaterLineInput } from './water.ts';

export interface WaterInput {
  id: string;
  name: string;
  /** The graph's kind (water=pond, water=drain, ...): a running kind gets a sloped surface (water.ts, P1-037). */
  kind?: string;
  /** Outer rings and holes (holes wind against the outer rings). */
  rings: readonly (readonly P2[])[];
}

/**
 * A piece of ground a landmark lays over the plain ground (P2-006, tools/bake/landmarks/place.ts): a flat pad at one
 * level, a forecourt, the footing strip of a wall or a moat band. Its ring is forced into the triangulation; the
 * first piece of the list that holds a triangle gives it its material.
 */
export interface LandmarkGround {
  landmark: string;
  cls: 'pad' | 'forecourt' | 'wallbase' | 'moat';
  ring: readonly P2[];
  /** A pad: its level (m). */
  level?: number;
  /** A moat: how far its bed lies under the ground (m). */
  depth?: number;
  material: string;
}

export interface TerrainInput {
  fs: FaceSet;
  edges: EdgeMap;
  grid: FaceGrid;
  strips: readonly Strip[];
  /** Per strip and station: 0 at grade, 1 fill, 2 deck, 3 cut, 4 tunnel. */
  kinds: readonly ArrayLike<number>[];
  /** The stage outline, block metres. */
  outline: readonly P2[];
  footprints: readonly (readonly P2[])[];
  water: readonly WaterInput[];
  open: readonly (readonly (readonly P2[])[])[];
  /** The ground model (block metres). */
  ground: (x: number, z: number) => number;
  /** Block metres to world metres: the tile lines are lines of the world grid. */
  offset: P2;
  /** Landmark ground pieces, in the order they win (pads first). */
  landmarks?: readonly LandmarkGround[];
  /** Water lines (OSM waterway): drains, ditches, streams and canals become channels of their class width (water.ts, P1-037). */
  waterLines?: readonly WaterLineInput[];
  /** Tunnel mouths of the road mesh (P1-037): the ground across a mouth stays between the slab over the roof and the headwall top. */
  portals?: readonly Headwall[];
}

export interface TerrainOptions {
  /** Spacing of the lattice inside blocks (m): a whole fraction of the tile size. */
  lattice: number;
  /** No segment is longer than this (m). */
  maxSeg: number;
  /** A lattice point keeps this far from every segment (m). */
  clear: number;
  /** How far a road edge pulls the ground towards its own height (m). */
  fieldRadius: number;
  /** A vertex this close to a segment is part of it (units). */
  eps: number;
  /** Points this close are one point (units). */
  weld: number;
}

export const TERRAIN_DEFAULTS: TerrainOptions = { lattice: 12.5, maxSeg: 6.25, clear: 3, fieldRadius: 30, eps: 8, weld: 6 };

/**
 * A junction surface that the mesh does not let the ground meet, on the ground level sheet (see meetOf), can climb
 * with a ramp: an edge of it more than this far off the ground model is met like a wall, not at its own height (m).
 */
export const MIXED_OFF_M = 2.2;

/** True for the free edge of such a junction face that stands off the ground: heights at both ends against the ground model there. */
export const offGround = (input: Pick<TerrainInput, 'fs' | 'ground'>, f: number, a: number, b: number, ya: number, yb: number): boolean => {
  const { fs } = input;
  if (fs.cut[f] !== CUT_NONE) return false;
  return Math.abs(ya - input.ground(fs.vx[a] as number, fs.vz[a] as number)) > MIXED_OFF_M || Math.abs(yb - input.ground(fs.vx[b] as number, fs.vz[b] as number)) > MIXED_OFF_M;
};

export const MEET_NONE = 0;
export const MEET_EDGE = 1;
export const MEET_WALL = 2;

/**
 * How the ground meets a face: at its edge (at grade), at a wall (a ramp on fill, an open cut, a tunnel ramp that
 * has no roof yet), or not at all (a deck, a roofed tunnel). The mesh marks every tunnel face as "not at all"; a
 * tunnel ramp open to the sky must cut the ground or the ground would lie on it like a lid.
 */
export function meetOf(input: Pick<TerrainInput, 'fs' | 'strips' | 'kinds'>, f: number): number {
  const { fs } = input;
  const cut = fs.cut[f] as number;
  if (cut === CUT_EDGE) return MEET_EDGE;
  if (cut === CUT_WALL) return MEET_WALL;
  const piece = fs.piece[f] as number;
  const i = fs.station[f] as number;
  // a junction on the ground level sheet with one arm on a deck or in a tunnel: the mesh says "not at all", but it lies on the ground
  if (piece >= input.strips.length) return fs.sheet[f] === 0 ? MEET_EDGE : MEET_NONE;
  if (i < 0) return MEET_NONE;
  const kind = input.kinds[piece] as ArrayLike<number>;
  const s = input.strips[piece] as Strip;
  const kp = kind[i] as number;
  const kq = kind[i + 1] as number;
  if (kp === K_DECK || kq === K_DECK) return MEET_NONE;
  const roofed = (st: Station, k: number): boolean => k === K_TUNNEL && st.g - st.h >= ROOF_DEPTH_M;
  return roofed(s.st[i] as Station, kp) && roofed(s.st[i + 1] as Station, kq) ? MEET_NONE : MEET_WALL;
}

export interface Collected {
  /** Points: whole units, and block metres (a road vertex: exactly the road mesh's numbers). */
  ix: number[];
  iz: number[];
  ox: number[];
  oz: number[];
  /** Segments between points, with their label as seen from a to b. */
  segA: number[];
  segB: number[];
  segLabel: number[];
  /** Pieces of the road's free edges: the road is on the left of a to b; the road's top height at both ends; 1 for a wall. */
  roadA: number[];
  roadB: number[];
  roadYa: number[];
  roadYb: number[];
  roadWall: number[];
  /** Per face: MEET_NONE, MEET_EDGE or MEET_WALL. */
  meet: Uint8Array;
  counts: { roadVertices: number; freeEdges: number; wallEdges: number; ringEdges: number; splitPoints: number; gridPoints: number; latticePoints: number; welded: number };
  box: { minX: number; minZ: number; maxX: number; maxZ: number };
}

class Points {
  readonly ix: number[] = [];
  readonly iz: number[] = [];
  readonly ox: number[] = [];
  readonly oz: number[] = [];
  welded = 0;
  private readonly head = new Map<number, number>();
  private readonly next: number[] = [];
  private readonly cell: number;
  private readonly weld: number;

  constructor(weld: number) {
    this.weld = weld;
    this.cell = Math.max(1, weld);
  }

  private key(cx: number, cz: number): number {
    return (cx + 8388608) * 16777216 + (cz + 8388608);
  }

  /** The point at these metres: one already there (the same units for `exact`, else within the weld distance), or a new one. */
  add(x: number, z: number, exact = false): number {
    const px = toUnits(x);
    const pz = toUnits(z);
    const cx = Math.floor(px / this.cell);
    const cz = Math.floor(pz / this.cell);
    let best = -1;
    let bd = exact ? 0.5 : this.weld + 0.5;
    for (let i = cx - 1; i <= cx + 1; i++) {
      for (let j = cz - 1; j <= cz + 1; j++) {
        for (let p = this.head.get(this.key(i, j)) ?? -1; p >= 0; p = this.next[p] as number) {
          const d = Math.max(Math.abs((this.ix[p] as number) - px), Math.abs((this.iz[p] as number) - pz));
          if (d < bd) {
            bd = d;
            best = p;
          }
        }
      }
    }
    if (best >= 0) {
      if (bd > 0) this.welded++;
      return best;
    }
    const id = this.ix.length;
    this.ix.push(px);
    this.iz.push(pz);
    this.ox.push(exact ? x : px / UNITS);
    this.oz.push(exact ? z : pz / UNITS);
    const k = this.key(cx, cz);
    this.next.push(this.head.get(k) ?? -1);
    this.head.set(k, id);
    return id;
  }
}

/** Segments by cell: how near is a point to any of them. */
class SegmentIndex {
  private readonly cells = new Map<number, number[]>();
  private readonly ax: number[] = [];
  private readonly az: number[] = [];
  private readonly bx: number[] = [];
  private readonly bz: number[] = [];
  private readonly cell: number;

  constructor(cell: number) {
    this.cell = cell;
  }

  add(ax: number, az: number, bx: number, bz: number): void {
    const id = this.ax.length;
    this.ax.push(ax);
    this.az.push(az);
    this.bx.push(bx);
    this.bz.push(bz);
    const c = this.cell;
    for (let i = Math.floor(Math.min(ax, bx) / c); i <= Math.floor(Math.max(ax, bx) / c); i++) {
      for (let j = Math.floor(Math.min(az, bz) / c); j <= Math.floor(Math.max(az, bz) / c); j++) {
        const k = (i + 100000) * 262144 + (j + 100000);
        const list = this.cells.get(k);
        if (list) list.push(id);
        else this.cells.set(k, [id]);
      }
    }
  }

  /** True when a segment passes within d metres of the point (d at most one cell). */
  within(x: number, z: number, d: number): boolean {
    const c = this.cell;
    const d2 = d * d;
    for (let i = Math.floor((x - d) / c); i <= Math.floor((x + d) / c); i++) {
      for (let j = Math.floor((z - d) / c); j <= Math.floor((z + d) / c); j++) {
        const list = this.cells.get((i + 100000) * 262144 + (j + 100000));
        if (!list) continue;
        for (const id of list) {
          const ax = this.ax[id] as number;
          const az = this.az[id] as number;
          const ex = (this.bx[id] as number) - ax;
          const ez = (this.bz[id] as number) - az;
          const len2 = ex * ex + ez * ez;
          const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / len2)) : 0;
          const qx = ax + ex * t - x;
          const qz = az + ez * t - z;
          if (qx * qx + qz * qz < d2) return true;
        }
      }
    }
    return false;
  }
}

const ringArea2 = (ring: readonly P2[]): number => {
  let a = 0;
  for (let k = 0; k < ring.length; k++) {
    const p = ring[k] as P2;
    const q = ring[(k + 1) % ring.length] as P2;
    a += p.x * q.z - q.x * p.z;
  }
  return a;
};

export function collect(input: TerrainInput, opt: TerrainOptions): Collected {
  const { fs, edges } = input;
  const pts = new Points(opt.weld);
  const near = new SegmentIndex(opt.maxSeg);
  const out: Collected = {
    ix: pts.ix, iz: pts.iz, ox: pts.ox, oz: pts.oz, segA: [], segB: [], segLabel: [], roadA: [], roadB: [], roadYa: [], roadYb: [], roadWall: [],
    meet: new Uint8Array(fs.faces), counts: { roadVertices: 0, freeEdges: 0, wallEdges: 0, ringEdges: 0, splitPoints: 0, gridPoints: 0, latticePoints: 0, welded: 0 },
    box: { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity },
  };
  const seg = (a: number, b: number, lab: number): void => {
    if (a === b) return;
    out.segA.push(a);
    out.segB.push(b);
    out.segLabel.push(lab);
    near.add(pts.ox[a] as number, pts.oz[a] as number, pts.ox[b] as number, pts.oz[b] as number);
  };
  /** A segment in pieces of at most maxSeg; `each` gets every piece with how far along the whole it starts and ends. */
  const pieces = (a: number, b: number, lab: number, each?: (p: number, q: number, t0: number, t1: number) => void): void => {
    const ax = pts.ox[a] as number;
    const az = pts.oz[a] as number;
    const bx = pts.ox[b] as number;
    const bz = pts.oz[b] as number;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / opt.maxSeg));
    let prev = a;
    for (let k = 1; k <= n; k++) {
      const p = k === n ? b : pts.add(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n);
      if (k < n) out.counts.splitPoints++;
      if (p !== prev) {
        seg(prev, p, lab);
        each?.(prev, p, (k - 1) / n, k / n);
      }
      prev = p;
    }
  };

  // the road: every edge of a face the ground meets that no such face shares
  for (let f = 0; f < fs.faces; f++) out.meet[f] = meetOf(input, f);
  const roadPoint = new Map<number, number>();
  const rp = (id: number): number => {
    let p = roadPoint.get(id);
    if (p === undefined) {
      p = pts.add(fs.vx[id] as number, fs.vz[id] as number, true);
      roadPoint.set(id, p);
    }
    return p;
  };
  for (const [key, c] of edges.at) {
    const f = edges.owner[c] as number;
    const kind = out.meet[f] as number;
    if (kind === MEET_NONE) continue;
    const a = Math.floor(key / 4194304);
    const b = key % 4194304;
    const twin = edges.at.get(edgeKey(b, a));
    if (twin !== undefined && out.meet[edges.owner[twin] as number] !== MEET_NONE) continue;
    const s = fs.start[f] as number;
    const ya = fs.ys[c] as number;
    const yb = fs.ys[s + ((c - s + 1) % (fs.len[f] as number))] as number;
    const wall = kind === MEET_WALL || offGround(input, f, a, b, ya, yb);
    out.counts.freeEdges++;
    if (wall) out.counts.wallEdges++;
    pieces(rp(a), rp(b), label(CH_ROAD, 1), (p, q, t0, t1) => {
      out.roadA.push(p);
      out.roadB.push(q);
      out.roadYa.push(ya + (yb - ya) * t0);
      out.roadYb.push(ya + (yb - ya) * t1);
      out.roadWall.push(wall ? 1 : 0);
    });
  }
  out.counts.roadVertices = roadPoint.size;

  // rings: the inside on the left of every edge
  const rings = (list: readonly (readonly P2[])[], channel: number): void => {
    let area = 0;
    for (const r of list) area += ringArea2(r);
    const lab = channel < 0 ? PLAIN_LABEL : label(channel, 1);
    for (const r of list) {
      if (r.length < 3) continue;
      const ids = r.map((p) => pts.add(p.x, p.z));
      for (let k = 0; k < ids.length; k++) {
        const a = ids[k] as number;
        const b = ids[(k + 1) % ids.length] as number;
        if (a === b) continue;
        out.counts.ringEdges++;
        if (area >= 0) pieces(a, b, lab);
        else pieces(b, a, lab);
      }
    }
  };
  rings([input.outline], CH_OUTLINE);
  for (const r of input.footprints) rings([r], CH_BUILDING);
  for (const w of input.water) rings(w.rings, CH_WATER);
  // drain channels: one ring per piece, each oriented on its own (they overlap; the water count is "not zero")
  for (const l of input.waterLines ?? []) for (const r of lineRings(l)) rings([r], CH_WATER);
  for (const o of input.open) rings(o, CH_OPEN);
  // landmark ground: rings of no class of their own (the surface gives their triangles a material), and points on
  // the bed of a moat so it has a floor to lower
  for (const g of input.landmarks ?? []) rings([g.ring], -1);
  for (const g of input.landmarks ?? []) {
    if (g.cls !== 'moat') continue;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const p of g.ring) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    const STEP = 5;
    for (let j = Math.ceil(z0 / STEP); j * STEP <= z1; j++) {
      for (let i = Math.ceil(x0 / STEP); i * STEP <= x1; i++) {
        const x = i * STEP;
        const z = j * STEP;
        if (!pointInRing({ x, z }, g.ring as P2[]) || near.within(x, z, 2.5)) continue;
        pts.add(x, z);
      }
    }
  }

  // points along the middle of every drain channel: the bed needs a floor under the water between its two banks
  // (the lattice keeps 3 m off every segment, so a channel 5 m wide would get none)
  for (const l of input.waterLines ?? []) {
    if (!lineRings(l).length) continue;
    for (let k = 0; k + 1 < l.pts.length; k++) {
      const a = l.pts[k] as P2;
      const b = l.pts[k + 1] as P2;
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (opt.maxSeg / 2)));
      for (let i = k === 0 ? 1 : 0; i < n; i++) {
        const x = a.x + ((b.x - a.x) * i) / n;
        const z = a.z + ((b.z - a.z) * i) / n;
        if (near.within(x, z, 0.4) || !pointInRing({ x, z }, input.outline as P2[])) continue;
        pts.add(x, z);
      }
    }
  }

  // the stage box, a little wider
  const box = out.box;
  for (const p of input.outline) {
    box.minX = Math.min(box.minX, p.x);
    box.maxX = Math.max(box.maxX, p.x);
    box.minZ = Math.min(box.minZ, p.z);
    box.maxZ = Math.max(box.maxZ, p.z);
  }
  const PAD = 30;
  const wx0 = box.minX - PAD + input.offset.x;
  const wx1 = box.maxX + PAD + input.offset.x;
  const wz0 = box.minZ - PAD + input.offset.z;
  const wz1 = box.maxZ + PAD + input.offset.z;

  // tile lines of the world grid: points every half lattice step where nothing else is near, joined along the line
  const step = opt.lattice / 2;
  const gridSegs: [number, number][] = [];
  const line = (fixed: number, from: number, to: number, alongZ: boolean): void => {
    let prev = -1;
    for (let j = Math.ceil(from / step); j * step <= to; j++) {
      const wx = alongZ ? fixed : j * step;
      const wz = alongZ ? j * step : fixed;
      const x = wx - input.offset.x;
      const z = wz - input.offset.z;
      const first = prev < 0;
      const last = (j + 1) * step > to;
      if (!first && !last && near.within(x, z, 1.5)) continue;
      const p = pts.add(x, z);
      out.counts.gridPoints++;
      if (prev >= 0 && prev !== p) gridSegs.push([prev, p]);
      prev = p;
    }
  };
  for (let k = Math.ceil(wx0 / TILE_M); k * TILE_M <= wx1; k++) line(k * TILE_M, wz0, wz1, true);
  for (let k = Math.ceil(wz0 / TILE_M); k * TILE_M <= wz1; k++) line(k * TILE_M, wx0, wx1, false);
  for (const [a, b] of gridSegs) seg(a, b, GRID_LABEL);

  // footprints by cell, for the lattice: no lattice point under a building
  const CELL = 25;
  const fpCells = new Map<number, number[]>();
  input.footprints.forEach((r, i) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const p of r) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    for (let a = Math.floor(x0 / CELL); a <= Math.floor(x1 / CELL); a++) {
      for (let b = Math.floor(z0 / CELL); b <= Math.floor(z1 / CELL); b++) {
        const k = (a + 100000) * 262144 + (b + 100000);
        const list = fpCells.get(k);
        if (list) list.push(i);
        else fpCells.set(k, [i]);
      }
    }
  });
  const inBuilding = (x: number, z: number): boolean => (fpCells.get((Math.floor(x / CELL) + 100000) * 262144 + (Math.floor(z / CELL) + 100000)) ?? []).some((i) => pointInRing({ x, z }, input.footprints[i] as P2[]));

  // the lattice: rows on the world grid, every other row shifted by half a step (near equilateral triangles, and no
  // four lattice points on one circle)
  const L = opt.lattice;
  for (let j = Math.ceil(wz0 / L); j * L <= wz1; j++) {
    const shift = j % 2 === 0 ? 0 : L / 2;
    for (let i = Math.ceil((wx0 - shift) / L); i * L + shift <= wx1; i++) {
      const x = i * L + shift - input.offset.x;
      const z = j * L - input.offset.z;
      if (near.within(x, z, opt.clear) || !pointInRing({ x, z }, input.outline as P2[]) || inBuilding(x, z)) continue;
      pts.add(x, z);
      out.counts.latticePoints++;
    }
  }
  out.counts.welded = pts.welded;
  return out;
}
