// Heights of the ground (P1-015, MAP_REPAIR.md "Terrain that fits the roads": "road and ground share their edge").
// A vertex on a road edge at grade takes the road's own top height there: the ground is pinned to the road. Every
// other vertex takes the ground model plus a correction that the pins around it spread (the road was solved a
// little above or under the ground model; a block between two roads blends between them, and a road up to 2 m off
// the ground gets its bank this way). At a wall (a ramp on fill, an open cut, an open tunnel ramp) the ground ends
// at the wall at its own height, never above a ramp, never under a cut road. Under a deck it stays under the deck.
// Water lies flat a little under its banks with a bed under it. Where two road faces of different heights end at
// one vertex (a footpath end beside a carriageway end) the ground has a height per triangle corner and a small
// upright face closes the step. Pure.
import { smoothstep } from '../roads/curve.ts';
import { DECK_DEPTH, HEADROOM } from '../roads/model.ts';
import type { FaceSet } from '../mesh/faces.ts';
import { MEET_NONE } from './collect.ts';
import type { LandmarkGround, TerrainInput, TerrainOptions } from './collect.ts';
import { C_GROUND, C_LAWN, C_PLOT, C_WATER } from './triangulate.ts';
import type { Headwall } from '../mesh/structures.ts';
import { RingSet, bankSlope, levelAt, slopedRings } from './water.ts';
import type { WaterPlane } from './water.ts';
import type { Triangulation } from './triangulate.ts';

export interface WaterBody extends WaterPlane {
  /** Level of the surface at (cx, cz) (m); a flat body has gx = gz = 0. */
  level: number;
  /** Running water (a drain, a canal, P1-037): the surface follows the slope of its banks. */
  sloped: boolean;
  /** How far the surface falls across the body (m), its slope (m per km), and the least height of a land bank over it (m). */
  fallM: number;
  slopePerKm: number;
  bankRoomM: number | null;
  areaM2: number;
  triangles: number;
  /** Lowest and highest ground on its bank before the bank was lifted over the water. */
  bankMinM: number;
  bankMaxM: number;
  /** Block metres of a point in it. */
  x: number;
  z: number;
}

export interface Surface {
  /** Emitted triangles: three vertices each (turning the positive way in x, z), their class, their corner heights. */
  tri: Int32Array;
  cls: Uint8Array;
  cy: Float64Array;
  /** The water body of a water triangle, else -1. */
  body: Int32Array;
  /** Per vertex: its height (NaN: not used), its normal. */
  vy: Float64Array;
  nrm: Float32Array;
  /** Upright faces that close height steps: nine numbers per triangle and three for its normal. */
  skirts: number[];
  waters: WaterBody[];
  /** Per vertex: 1 pinned to a road edge at grade, 2 at a wall, 3 on a landmark pad (at the pad's level), 0 free. */
  role: Uint8Array;
  /** Per emitted triangle: the landmark ground piece it lies in (an index into `pieces`), else -1. */
  over: Int32Array;
  pieces: readonly LandmarkGround[];
  stats: {
    emitted: number; byClass: Record<string, number>; pinned: number; wallVertices: number; stepVertices: number; stepCorners: number; unresolvedSteps: number; skirts: number;
    underDeck: number; loweredUnderDeck: number; overTunnel: number; raisedOverTunnel: number; bedOverTunnel: number; mouthCorners: number; maxOffsetM: number; wallClamped: number;
    /** Landmark ground (P2-006): triangles by class, pad vertices at their level, pad corners a road pin holds off it, moat bed vertices. */
    landmark: { pad: number; forecourt: number; wallbase: number; moat: number; walkway: number; padVertices: number; padPinnedByRoad: number; moatBed: number };
  };
}

const pointInFace = (fs: FaceSet, f: number, x: number, z: number): boolean => {
  const s = fs.start[f] as number;
  const n = fs.len[f] as number;
  let inside = false;
  for (let k = 0, j = n - 1; k < n; j = k++) {
    const a = fs.ids[s + k] as number;
    const b = fs.ids[s + j] as number;
    const az = fs.vz[a] as number;
    const bz = fs.vz[b] as number;
    if (az > z !== bz > z && x < (((fs.vx[b] as number) - (fs.vx[a] as number)) * (z - az)) / (bz - az) + (fs.vx[a] as number)) inside = !inside;
  }
  return inside;
};

/** Points with a value by cell: the blend of the values near a place, fading out with the distance to the nearest. */
class Field {
  private readonly start: Int32Array;
  private readonly px: Float64Array;
  private readonly pz: Float64Array;
  private readonly po: Float64Array;
  private readonly cell: number;
  private readonly x0: number;
  private readonly z0: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly r: number;

  constructor(xs: readonly number[], zs: readonly number[], os: readonly number[], r: number) {
    this.r = r;
    this.cell = r / 3;
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < xs.length; i++) {
      x0 = Math.min(x0, xs[i] as number);
      x1 = Math.max(x1, xs[i] as number);
      z0 = Math.min(z0, zs[i] as number);
      z1 = Math.max(z1, zs[i] as number);
    }
    if (!xs.length) x0 = z0 = x1 = z1 = 0;
    this.x0 = x0;
    this.z0 = z0;
    this.cols = Math.floor((x1 - x0) / this.cell) + 1;
    this.rows = Math.floor((z1 - z0) / this.cell) + 1;
    const count = new Int32Array(this.cols * this.rows + 1);
    const cellOf = (i: number): number => Math.floor(((zs[i] as number) - z0) / this.cell) * this.cols + Math.floor(((xs[i] as number) - x0) / this.cell);
    for (let i = 0; i < xs.length; i++) count[cellOf(i) + 1] = (count[cellOf(i) + 1] as number) + 1;
    for (let c = 0; c < this.cols * this.rows; c++) count[c + 1] = (count[c + 1] as number) + (count[c] as number);
    this.start = count;
    const fill = count.slice();
    this.px = new Float64Array(xs.length);
    this.pz = new Float64Array(xs.length);
    this.po = new Float64Array(xs.length);
    for (let i = 0; i < xs.length; i++) {
      const c = cellOf(i);
      const at = fill[c] as number;
      fill[c] = at + 1;
      this.px[at] = xs[i] as number;
      this.pz[at] = zs[i] as number;
      this.po[at] = os[i] as number;
    }
  }

  /** The blended value at a place and the distance to the nearest point (Infinity: none within the radius). */
  at(x: number, z: number): { v: number; d: number } {
    const r = this.r;
    const c0 = Math.max(0, Math.floor((x - r - this.x0) / this.cell));
    const c1 = Math.min(this.cols - 1, Math.floor((x + r - this.x0) / this.cell));
    const r0 = Math.max(0, Math.floor((z - r - this.z0) / this.cell));
    const r1 = Math.min(this.rows - 1, Math.floor((z + r - this.z0) / this.cell));
    let sw = 0;
    let so = 0;
    let dmin = Infinity;
    for (let j = r0; j <= r1; j++) {
      for (let i = c0; i <= c1; i++) {
        const c = j * this.cols + i;
        for (let k = this.start[c] as number; k < (this.start[c + 1] as number); k++) {
          const d = Math.hypot((this.px[k] as number) - x, (this.pz[k] as number) - z);
          if (d >= r) continue;
          if (d < 1e-4) return { v: this.po[k] as number, d: 0 };
          const w = ((r - d) / (r * d)) ** 2;
          sw += w;
          so += w * (this.po[k] as number);
          if (d < dmin) dmin = d;
        }
      }
    }
    return sw > 0 ? { v: (so / sw) * (1 - smoothstep(dmin / r)), d: dmin } : { v: 0, d: Infinity };
  }
}

export function buildSurface(input: TerrainInput, tg: Triangulation, meet: Uint8Array, opt: TerrainOptions): Surface {
  const { cdt, vx, vz, road } = tg;
  const { fs } = input;
  const nv = vx.length;
  const nt = cdt.nt;
  const emits = (t: number): boolean => tg.cls[t] === C_GROUND || tg.cls[t] === C_LAWN || tg.cls[t] === C_PLOT || tg.cls[t] === C_WATER;
  let ne = 0;
  const emitOf = new Int32Array(nt).fill(-1);
  for (let t = 0; t < nt; t++) if (emits(t)) emitOf[t] = ne++;
  const tri = new Int32Array(ne * 3);
  const cls = new Uint8Array(ne);
  const tOf = new Int32Array(ne);
  const flags = new Uint8Array(nv);
  const byClass: Record<string, number> = { ground: 0, lawn: 0, plot: 0, water: 0 };
  for (let t = 0; t < nt; t++) {
    const e = emitOf[t] as number;
    if (e < 0) continue;
    tOf[e] = t;
    cls[e] = tg.cls[t] as number;
    const name = cls[e] === C_GROUND ? 'ground' : cls[e] === C_LAWN ? 'lawn' : cls[e] === C_PLOT ? 'plot' : 'water';
    byClass[name] = (byClass[name] as number) + 1;
    for (let i = 0; i < 3; i++) {
      const v = cdt.tv[t * 3 + i] as number;
      tri[e * 3 + i] = v;
      flags[v] = (flags[v] as number) | (cls[e] === C_WATER ? 2 : 1);
    }
  }

  // landmark ground (P2-006): the first piece that holds a triangle's centre gives it its material. A pad, a wall
  // strip and a moat lie over ground, lawn and plot; a forecourt only over plain ground.
  const pieces = input.landmarks ?? [];
  const over = new Int32Array(ne).fill(-1);
  const lmStats = { pad: 0, forecourt: 0, wallbase: 0, moat: 0, walkway: 0, padVertices: 0, padPinnedByRoad: 0, moatBed: 0 };
  const padLevel = new Float64Array(nv).fill(NaN);
  if (pieces.length) {
    const PC = 50;
    const cells = new Map<number, number[]>();
    const boxes = pieces.map((g) => {
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
      return { x0, x1, z0, z1 };
    });
    boxes.forEach((b, gi) => {
      for (let i = Math.floor(b.x0 / PC); i <= Math.floor(b.x1 / PC); i++) {
        for (let j = Math.floor(b.z0 / PC); j <= Math.floor(b.z1 / PC); j++) {
          const k = (i + 100000) * 262144 + (j + 100000);
          const list = cells.get(k);
          if (list) list.push(gi);
          else cells.set(k, [gi]);
        }
      }
    });
    const inRing = (ring: readonly { x: number; z: number }[], x: number, z: number): boolean => {
      let inside = false;
      for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
        const a = ring[k] as { x: number; z: number };
        const b = ring[j] as { x: number; z: number };
        if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
      }
      return inside;
    };
    for (let e = 0; e < ne; e++) {
      const k = cls[e] as number;
      if (k === C_WATER) continue;
      const a = tri[e * 3] as number;
      const b = tri[e * 3 + 1] as number;
      const c = tri[e * 3 + 2] as number;
      const cx = ((vx[a] as number) + (vx[b] as number) + (vx[c] as number)) / 3;
      const cz = ((vz[a] as number) + (vz[b] as number) + (vz[c] as number)) / 3;
      const list = cells.get((Math.floor(cx / PC) + 100000) * 262144 + (Math.floor(cz / PC) + 100000));
      if (!list) continue;
      // the list is in piece order: the first one that holds the centre wins
      for (const gi of list) {
        const g = pieces[gi] as LandmarkGround;
        if (g.cls === 'forecourt' && k !== C_GROUND) continue;
        // a walkway lies over plain ground, lawn and plot (a path through a park)
        if (g.cls === 'walkway' && k !== C_GROUND && k !== C_LAWN && k !== C_PLOT) continue;
        const bx = boxes[gi] as { x0: number; x1: number; z0: number; z1: number };
        if (cx < bx.x0 || cx > bx.x1 || cz < bx.z0 || cz > bx.z1 || !inRing(g.ring, cx, cz)) continue;
        if (g.holes && g.holes.some((h) => inRing(h, cx, cz))) continue;
        over[e] = gi;
        lmStats[g.cls]++;
        if (g.cls === 'pad') for (const v of [a, b, c]) padLevel[v] = g.level as number;
        break;
      }
    }
  }

  // pins and walls from the road's edge pieces
  const pinMax = new Float64Array(nv).fill(NaN);
  const pinMin = new Float64Array(nv).fill(NaN);
  const wallMax = new Float64Array(nv).fill(NaN);
  const wallMin = new Float64Array(nv).fill(NaN);
  const note = (hi: Float64Array, lo: Float64Array, v: number, y: number): void => {
    if (!(y <= (hi[v] as number))) hi[v] = y;
    if (!(y >= (lo[v] as number))) lo[v] = y;
  };
  for (let k = 0; k < road.a.length; k++) {
    if (!road.alive[k]) continue;
    const w = road.wall[k] === 1;
    note(w ? wallMax : pinMax, w ? wallMin : pinMin, road.a[k] as number, road.ya[k] as number);
    note(w ? wallMax : pinMax, w ? wallMin : pinMin, road.b[k] as number, road.yb[k] as number);
  }
  const role = new Uint8Array(nv);
  const vy = new Float64Array(nv).fill(NaN);
  const stats: Surface['stats'] = { emitted: ne, byClass, pinned: 0, wallVertices: 0, stepVertices: 0, stepCorners: 0, unresolvedSteps: 0, skirts: 0, underDeck: 0, loweredUnderDeck: 0, overTunnel: 0, raisedOverTunnel: 0, bedOverTunnel: 0, mouthCorners: 0, maxOffsetM: 0, wallClamped: 0, landmark: lmStats };
  const fxs: number[] = [];
  const fzs: number[] = [];
  const fos: number[] = [];
  for (let v = 0; v < nv; v++) {
    if (!flags[v]) continue;
    if (!Number.isNaN(pinMax[v] as number)) {
      role[v] = 1;
      vy[v] = pinMax[v] as number;
      stats.pinned++;
      const off = (pinMax[v] as number) - input.ground(vx[v] as number, vz[v] as number);
      stats.maxOffsetM = Math.max(stats.maxOffsetM, Math.abs(off));
      fxs.push(vx[v] as number);
      fzs.push(vz[v] as number);
      fos.push(off);
    } else if (!Number.isNaN(wallMax[v] as number)) {
      role[v] = 2;
      stats.wallVertices++;
    } else if (!Number.isNaN(padLevel[v] as number)) {
      // a pad vertex lies at the pad's level and pulls the ground around it there, as a road edge does
      role[v] = 3;
      vy[v] = padLevel[v] as number;
      lmStats.padVertices++;
      fxs.push(vx[v] as number);
      fzs.push(vz[v] as number);
      fos.push((padLevel[v] as number) - input.ground(vx[v] as number, vz[v] as number));
    }
    if (role[v] !== 3 && !Number.isNaN(padLevel[v] as number)) lmStats.padPinnedByRoad++;
  }
  const field = new Field(fxs, fzs, fos, opt.fieldRadius);

  // decks and roofed tunnels by cell: only vertices near one look further
  const special = new Set<number>();
  const CELL = 12;
  /** A water bed over a roofed tunnel stays this far over the roof's underside (m): the slab (P2-032). */
  const BED_OVER_ROOF_M = 0.8;
  /** ... for a bed vertex this near a roofed tunnel face (m): the lattice spacing, so no bed triangle dips over it. */
  const BED_ROOF_REACH_M = 13;
  for (let f = 0; f < fs.faces; f++) {
    if (meet[f] !== MEET_NONE) continue;
    const s = fs.start[f] as number;
    for (let k = 0; k < (fs.len[f] as number); k++) {
      const id = fs.ids[s + k] as number;
      for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) special.add((Math.floor((fs.vx[id] as number) / CELL) + dx + 100000) * 262144 + (Math.floor((fs.vz[id] as number) / CELL) + dz + 100000));
    }
  }
  /**
   * The highest roof underside of a roofed tunnel within `r` of (x, z) (its road plus the headroom), or -Infinity: a
   * ground triangle that spans a tunnel from a vertex beside it must not dip under the roof either (P2-032).
   */
  const tunnelRoofNear = (x: number, z: number, r: number): number => {
    const g = input.ground(x, z);
    let roof = -Infinity;
    for (const f of input.grid.near(x - r, z - r, x + r, z + r)) {
      if (meet[f] !== MEET_NONE) continue;
      const s = fs.start[f] as number;
      let hi = -Infinity;
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (let k = 0; k < (fs.len[f] as number); k++) {
        const id = fs.ids[s + k] as number;
        hi = Math.max(hi, fs.ys[s + k] as number);
        x0 = Math.min(x0, fs.vx[id] as number);
        x1 = Math.max(x1, fs.vx[id] as number);
        z0 = Math.min(z0, fs.vz[id] as number);
        z1 = Math.max(z1, fs.vz[id] as number);
      }
      if (hi >= g || x < x0 - r || x > x1 + r || z < z0 - r || z > z1 + r) continue;
      if (!pointInFace(fs, f, x, z) && Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1)) > r) continue;
      roof = Math.max(roof, hi + HEADROOM);
    }
    return roof;
  };
  for (let v = 0; v < nv; v++) {
    if (!flags[v] || role[v] === 1 || role[v] === 3) continue;
    const x = vx[v] as number;
    const z = vz[v] as number;
    const g = input.ground(x, z);
    let y = g + field.at(x, z).v;
    if (role[v] === 2) {
      // a ramp wall's foot is never above the ramp nor far under the wall; the top of a cut wall never under its road
      const fill = (wallMin[v] as number) >= g;
      const was = y;
      y = fill ? Math.max(Math.min(y, wallMin[v] as number), Math.min(g - 0.4, wallMin[v] as number)) : Math.max(y, wallMax[v] as number);
      // across a tunnel mouth (P1-037): over the slab on the roof and never over the headwall's parapet top
      const hw = headwallAt(input.portals, x, z);
      if (hw) y = Math.min(Math.max(y, hw.bottom + 0.5), hw.top);
      if (y !== was) stats.wallClamped++;
    } else if (special.has((Math.floor(x / CELL) + 100000) * 262144 + (Math.floor(z / CELL) + 100000))) {
      for (const f of input.grid.near(x, z, x, z)) {
        if (meet[f] !== MEET_NONE || !pointInFace(fs, f, x, z)) continue;
        const s = fs.start[f] as number;
        let lo = Infinity;
        let hi = -Infinity;
        for (let k = 0; k < (fs.len[f] as number); k++) {
          lo = Math.min(lo, fs.ys[s + k] as number);
          hi = Math.max(hi, fs.ys[s + k] as number);
        }
        if (hi < g) {
          stats.overTunnel++;
          if (y < hi + HEADROOM + 0.5) {
            y = hi + HEADROOM + 0.5;
            stats.raisedOverTunnel++;
          }
        } else {
          stats.underDeck++;
          if (y > lo - DECK_DEPTH - 0.3) {
            y = lo - DECK_DEPTH - 0.3;
            stats.loweredUnderDeck++;
          }
        }
      }
    }
    vy[v] = y;
  }

  // a moat: the vertices inside its band (every triangle around them is moat) go down to the bed
  if (lmStats.moat > 0) {
    const all = new Int32Array(nv);
    const moat = new Int32Array(nv);
    const depth = new Float64Array(nv);
    for (let e = 0; e < ne; e++) {
      const g = (over[e] as number) >= 0 ? (pieces[over[e] as number] as LandmarkGround) : null;
      for (let i = 0; i < 3; i++) {
        const v = tri[e * 3 + i] as number;
        all[v] = (all[v] as number) + 1;
        if (g && g.cls === 'moat') {
          moat[v] = (moat[v] as number) + 1;
          depth[v] = g.depth ?? 3;
        }
      }
    }
    for (let v = 0; v < nv; v++) {
      if (role[v] !== 0 || (moat[v] as number) === 0 || moat[v] !== all[v]) continue;
      vy[v] = (vy[v] as number) - (depth[v] as number);
      lmStats.moatBed++;
    }
  }

  // water: a little under its banks (flat, or for running water along the slope of its banks); the bank stays above
  // it and the bed goes down from the bank
  const slopedSet = new RingSet(slopedRings(input.water, input.waterLines ?? []));
  const body = new Int32Array(ne).fill(-1);
  const waters: WaterBody[] = [];
  const stamp = new Int32Array(nv).fill(-1);
  for (let e0 = 0; e0 < ne; e0++) {
    if (cls[e0] !== C_WATER || body[e0] !== -1) continue;
    const id = waters.length;
    const members = [e0];
    body[e0] = id;
    const verts: number[] = [];
    let area = 0;
    for (let k = 0; k < members.length; k++) {
      const e = members[k] as number;
      const t = tOf[e] as number;
      const a = tri[e * 3] as number;
      const b = tri[e * 3 + 1] as number;
      const c = tri[e * 3 + 2] as number;
      area += Math.abs(((vx[b] as number) - (vx[a] as number)) * ((vz[c] as number) - (vz[a] as number)) - ((vz[b] as number) - (vz[a] as number)) * ((vx[c] as number) - (vx[a] as number))) / 2;
      for (let i = 0; i < 3; i++) {
        const v = tri[e * 3 + i] as number;
        if (stamp[v] !== id) {
          stamp[v] = id;
          verts.push(v);
        }
        const m = cdt.tn[t * 3 + i] as number;
        const em = m >= 0 ? (emitOf[m] as number) : -1;
        if (em >= 0 && cls[em] === C_WATER && body[em] === -1) {
          body[em] = id;
          members.push(em);
        }
      }
    }
    const landV = verts.filter((v) => role[v] !== 1 && ((flags[v] as number) & 1) === 1);
    // running water (a drain, P1-037) follows the slope of its banks; a pool or the river lies flat
    // (by area: a drain that runs into a pond or the river leaves the pond and the river flat)
    let runArea = 0;
    if (slopedSet.size) {
      for (const e of members) {
        const a = tri[e * 3] as number;
        const b = tri[e * 3 + 1] as number;
        const c = tri[e * 3 + 2] as number;
        if (!slopedSet.has(((vx[a] as number) + (vx[b] as number) + (vx[c] as number)) / 3, ((vz[a] as number) + (vz[b] as number) + (vz[c] as number)) / 3)) continue;
        runArea += Math.abs(((vx[b] as number) - (vx[a] as number)) * ((vz[c] as number) - (vz[a] as number)) - ((vz[b] as number) - (vz[a] as number)) * ((vx[c] as number) - (vx[a] as number))) / 2;
      }
    }
    const sloped = runArea > area / 2;
    const fit = sloped ? bankSlope(landV.map((v) => ({ x: vx[v] as number, z: vz[v] as number, y: vy[v] as number }))) : { cx: 0, cz: 0, gx: 0, gz: 0 };
    const tilt = (v: number): number => fit.gx * ((vx[v] as number) - fit.cx) + fit.gz * ((vz[v] as number) - fit.cz);
    const land = landV.map((v) => (vy[v] as number) - tilt(v)).sort((p, q) => p - q);
    const fixed = verts.filter((v) => role[v] !== 0).map((v) => (vy[v] as number) - tilt(v));
    const all = verts.map((v) => (vy[v] as number) - tilt(v)).sort((p, q) => p - q);
    const low = (list: number[]): number => list[Math.floor((list.length - 1) * 0.1)] as number;
    let level = (land.length ? low(land) : low(all)) - 0.4;
    for (const y of fixed) level = Math.min(level, y - 0.3);
    const plane: WaterPlane = { cx: fit.cx, cz: fit.cz, level: Math.round(level * 1000) / 1000, gx: fit.gx, gz: fit.gz };
    const lv = (v: number): number => levelAt(plane, vx[v] as number, vz[v] as number);
    const bank: number[] = [];
    for (const v of verts) {
      if (role[v] !== 0 || ((flags[v] as number) & 1) === 1) bank.push(v);
      if (role[v] === 0 && ((flags[v] as number) & 1) === 1 && (vy[v] as number) < lv(v) + 0.15) vy[v] = lv(v) + 0.15;
    }
    for (const v of verts) {
      if (role[v] !== 0 || ((flags[v] as number) & 1) === 1) continue;
      let d = 8;
      for (const b of bank) d = Math.min(d, Math.hypot((vx[b] as number) - (vx[v] as number), (vz[b] as number) - (vz[v] as number)));
      vy[v] = Math.min(vy[v] as number, lv(v)) - (0.4 + 1.6 * smoothstep(d / 8));
      // a bed over a roofed tunnel (P2-032, the Pragati Maidan pond): never under the slab over the roof
      const roof = tunnelRoofNear(vx[v] as number, vz[v] as number, BED_ROOF_REACH_M);
      if (roof > -Infinity && (vy[v] as number) < roof + BED_OVER_ROOF_M) {
        vy[v] = roof + BED_OVER_ROOF_M;
        stats.bedOverTunnel++;
      }
    }
    // the fall of the surface over the body, and the least room under its land banks (0 or more)
    let lo = Infinity;
    let hi = -Infinity;
    let room = Infinity;
    for (const v of verts) {
      lo = Math.min(lo, lv(v));
      hi = Math.max(hi, lv(v));
      if (role[v] !== 1 && ((flags[v] as number) & 1) === 1) room = Math.min(room, (vy[v] as number) - lv(v));
    }
    const bankY = landV.map((v) => vy[v] as number).sort((p, q) => p - q);
    const allY = verts.map((v) => vy[v] as number).sort((p, q) => p - q);
    const p = tri[e0 * 3] as number;
    waters.push({
      ...plane, sloped, fallM: Math.round((hi - lo) * 1000) / 1000, slopePerKm: Math.round(Math.hypot(plane.gx, plane.gz) * 1000 * 1000) / 1000, bankRoomM: Number.isFinite(room) ? Math.round(room * 1000) / 1000 : null,
      areaM2: Math.round(area), triangles: members.length, bankMinM: Math.round((bankY[0] ?? allY[0] ?? level) * 100) / 100, bankMaxM: Math.round((bankY[bankY.length - 1] ?? allY[allY.length - 1] ?? level) * 100) / 100, x: Math.round((vx[p] as number) * 10) / 10, z: Math.round((vz[p] as number) * 10) / 10,
    });
  }

  // corner heights: the vertex height, except at a vertex where road faces of different heights end
  const cy = new Float64Array(ne * 3);
  for (let e = 0; e < ne; e++) for (let i = 0; i < 3; i++) cy[e * 3 + i] = vy[tri[e * 3 + i] as number] as number;
  // (a wall that starts at a pinned vertex counts with its own top: the ground beside it must not stand above it)
  const step = new Uint8Array(nv);
  for (let v = 0; v < nv; v++) {
    if (role[v] !== 1) continue;
    const hi = (wallMax[v] as number) > (pinMax[v] as number) ? (wallMax[v] as number) : (pinMax[v] as number);
    const lo = (wallMin[v] as number) < (pinMin[v] as number) ? (wallMin[v] as number) : (pinMin[v] as number);
    if (hi - lo > 0.002) {
      step[v] = 1;
      stats.stepVertices++;
    }
  }
  /** The road's height at v on the first road edge found going round v from triangle t: `out` through the edges that leave v, else through those that end in it. */
  const roadAt = (t0: number, v: number, out: boolean): { y: number; steps: number } => {
    let t = t0;
    for (let steps = 0; steps < 64; steps++) {
      const o = t * 3;
      const k = cdt.tv[o] === v ? 0 : cdt.tv[o + 1] === v ? 1 : 2;
      const other = cdt.tv[o + ((k + (out ? 1 : 2)) % 3)] as number;
      const piece = out ? road.find(other, v) : road.find(v, other);
      if (piece >= 0) return { y: (out ? road.yb[piece] : road.ya[piece]) as number, steps };
      const n = cdt.tn[o + ((k + (out ? 2 : 1)) % 3)] as number;
      if (n < 0 || (emitOf[n] as number) < 0) break;
      t = n;
    }
    return { y: NaN, steps: -1 };
  };
  for (let e = 0; e < ne; e++) {
    for (let i = 0; i < 3; i++) {
      const v = tri[e * 3 + i] as number;
      if (!step[v]) continue;
      const a = roadAt(tOf[e] as number, v, true);
      const b = roadAt(tOf[e] as number, v, false);
      const ya = Number.isNaN(a.y) ? -Infinity : a.y;
      const yb = Number.isNaN(b.y) ? -Infinity : b.y;
      let y = Math.max(ya, yb);
      if (a.steps === 0 && b.steps !== 0 && ya > -Infinity) y = ya;
      else if (b.steps === 0 && a.steps !== 0 && yb > -Infinity) y = yb;
      else if (a.steps === 0 && b.steps === 0 && Math.abs(ya - yb) > 0.002) stats.unresolvedSteps++;
      if (y === -Infinity) y = pinMax[v] as number;
      // a step on a tunnel mouth's line (P2-032): a corner that took the tunnel floor hung a skirt of ground down into
      // the mouth (the Pragati Maidan west mouth, 6.8 m); it stays over the slab, behind the headwall, like a wall vertex
      const hw = headwallAt(input.portals, vx[v] as number, vz[v] as number);
      if (hw && y < hw.bottom) {
        y = Math.min(hw.bottom + 0.5, hw.top);
        stats.mouthCorners++;
      }
      cy[e * 3 + i] = y;
      stats.stepCorners++;
    }
  }
  // an upright face wherever two triangles that share an edge differ in height along it
  const skirts: number[] = [];
  for (let e = 0; e < ne; e++) {
    const t = tOf[e] as number;
    for (let i = 0; i < 3; i++) {
      const a = tri[e * 3 + ((i + 1) % 3)] as number;
      const b = tri[e * 3 + ((i + 2) % 3)] as number;
      if (!step[a] && !step[b]) continue;
      const m = cdt.tn[t * 3 + i] as number;
      const em = m >= 0 ? (emitOf[m] as number) : -1;
      if (em <= e) continue;
      const ka = tri[em * 3] === a ? 0 : tri[em * 3 + 1] === a ? 1 : 2;
      const kb = tri[em * 3] === b ? 0 : tri[em * 3 + 1] === b ? 1 : 2;
      const ya = cy[e * 3 + ((i + 1) % 3)] as number;
      const yb = cy[e * 3 + ((i + 2) % 3)] as number;
      const na = cy[em * 3 + ka] as number;
      const nb = cy[em * 3 + kb] as number;
      if (Math.abs(ya - na) < 0.001 && Math.abs(yb - nb) < 0.001) continue;
      const dx = (vx[b] as number) - (vx[a] as number);
      const dz = (vz[b] as number) - (vz[a] as number);
      const len = Math.hypot(dx, dz) || 1;
      // seen from the lower side: this triangle lies on the left of a to b
      const sign = ya + yb > na + nb ? 1 : -1;
      const n = [(dz / len) * sign, 0, (-dx / len) * sign];
      const A = [vx[a] as number, ya, vz[a] as number];
      const B = [vx[b] as number, yb, vz[b] as number];
      const A2 = [vx[a] as number, na, vz[a] as number];
      const B2 = [vx[b] as number, nb, vz[b] as number];
      if (Math.abs(ya - na) >= 0.001) skirts.push(...A, ...B, ...A2, ...n);
      if (Math.abs(yb - nb) >= 0.001) skirts.push(...A2, ...B, ...B2, ...n);
      stats.skirts++;
    }
  }

  // normals: every triangle's own normal, added up at its corners
  const nrm = new Float32Array(nv * 3);
  for (let e = 0; e < ne; e++) {
    const a = tri[e * 3] as number;
    const b = tri[e * 3 + 1] as number;
    const c = tri[e * 3 + 2] as number;
    const ux = (vx[b] as number) - (vx[a] as number);
    const uy = (cy[e * 3 + 1] as number) - (cy[e * 3] as number);
    const uz = (vz[b] as number) - (vz[a] as number);
    const wx = (vx[c] as number) - (vx[a] as number);
    const wy = (cy[e * 3 + 2] as number) - (cy[e * 3] as number);
    const wz = (vz[c] as number) - (vz[a] as number);
    const nx = -(uy * wz - uz * wy);
    const ny = -(uz * wx - ux * wz);
    const nz = -(ux * wy - uy * wx);
    for (const v of [a, b, c]) {
      nrm[v * 3] = (nrm[v * 3] as number) + nx;
      nrm[v * 3 + 1] = (nrm[v * 3 + 1] as number) + ny;
      nrm[v * 3 + 2] = (nrm[v * 3 + 2] as number) + nz;
    }
  }
  for (let v = 0; v < nv; v++) {
    const len = Math.hypot(nrm[v * 3] as number, nrm[v * 3 + 1] as number, nrm[v * 3 + 2] as number);
    if (len > 1e-12) {
      nrm[v * 3] = (nrm[v * 3] as number) / len;
      nrm[v * 3 + 1] = (nrm[v * 3 + 1] as number) / len;
      nrm[v * 3 + 2] = (nrm[v * 3 + 2] as number) / len;
    } else nrm[v * 3 + 1] = 1;
  }
  stats.maxOffsetM = Math.round(stats.maxOffsetM * 100) / 100;
  return { tri, cls, cy, body, vy, nrm, skirts, waters, role, over, pieces, stats };
}

/** The tunnel headwall whose line a point lies on (within 5 cm, between its ends), if any (P1-037). */
export function headwallAt(list: readonly Headwall[] | undefined, x: number, z: number, tol = 0.05): Headwall | null {
  if (!list) return null;
  for (const h of list) {
    const ex = h.bx - h.ax;
    const ez = h.bz - h.az;
    const len2 = ex * ex + ez * ez;
    if (len2 <= 0) continue;
    const t = ((x - h.ax) * ex + (z - h.az) * ez) / len2;
    const len = Math.sqrt(len2);
    if (t < -tol / len || t > 1 + tol / len) continue;
    if (Math.abs((x - h.ax) * ez - (z - h.az) * ex) / len <= tol) return h;
  }
  return null;
}
