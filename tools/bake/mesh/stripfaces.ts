// Top faces of the strips (P1-014): one quad per lane and station pair, with the lane UV the road shader draws the
// markings from, and the index of full width quads the junction builder and the overlap proof look neighbours up in.
// Kerb faces, walls and parapets are not made here: they follow from the faces (solids.ts, structures.ts). Pure.
import type { Joint, LaneDef, Station, Strip } from '../roads/model.ts';
import { CUT_EDGE, CUT_NONE, CUT_WALL, FaceSet } from './faces.ts';
import type { Corner } from './faces.ts';

export const K_GRADE = 0;
export const K_FILL = 1;
export const K_DECK = 2;
export const K_CUT = 3;
export const K_TUNNEL = 4;
/** A cut deeper than this is its own level: a road at grade may cross over it (m). */
export const LEVEL_GAP_M = 2.5;

export const borderX = (st: Station, k: number): number => st.x + st.nx * (st.b[k] as number);
export const borderZ = (st: Station, k: number): number => st.z + st.nz * (st.b[k] as number);

/** How the ground meets the stretch between two stations, from their kinds. */
export function cutOf(kp: number, kq: number): number {
  if (kp === K_DECK || kq === K_DECK || kp === K_TUNNEL || kq === K_TUNNEL) return CUT_NONE;
  if (kp !== K_GRADE || kq !== K_GRADE) return CUT_WALL;
  return CUT_EDGE;
}

/**
 * The level sheet of a station for the overlap proof: 0 the ground level (at grade, fills, shallow cuts); decks and
 * lowered roads (tunnels, cuts deeper than LEVEL_GAP_M) by their layer tag, so a road may pass over or under them.
 */
export function sheetOf(st: Station, kind: number): number {
  if (kind === K_DECK) return 1000 + (st.layer + 20) * 2 + (st.bridge ? 1 : 0);
  if (kind === K_TUNNEL || (kind === K_CUT && st.g - st.h > LEVEL_GAP_M)) return 2000 + (st.layer + 20) * 2;
  return 0;
}

/**
 * Marking code of every lane border of a cross-section (lanes.length + 1 codes): 0 none, 1 a dashed lane line
 * (two driving lanes of one direction), 2 a solid centre line (two directions), 3 a solid edge line (a driving
 * lane beside anything else). The lane UV carries the codes of a lane's two borders; the stand-in scene draws the
 * same codes as strips.
 */
export const MARK_NONE = 0;
export const MARK_DASHED = 1;
export const MARK_CENTRE = 2;
export const MARK_EDGE = 3;
export function borderMarks(lanes: readonly LaneDef[]): number[] {
  const out: number[] = [];
  for (let k = 0; k <= lanes.length; k++) {
    const l = k > 0 ? (lanes[k - 1] as LaneDef) : null;
    const r = k < lanes.length ? (lanes[k] as LaneDef) : null;
    const dl = l?.type === 'drive';
    const dr = r?.type === 'drive';
    if (!dl && !dr) out.push(MARK_NONE);
    else if (dl && dr) out.push((l as LaneDef).dir === (r as LaneDef).dir ? MARK_DASHED : MARK_CENTRE);
    // a gali has no paint: its one shared lane runs kerb to kerb
    else out.push((dl ? (l as LaneDef) : (r as LaneDef)).tag === 'gali' ? MARK_NONE : MARK_EDGE);
  }
  return out;
}

export interface StripFaces {
  /** First face of every strip (strips.length + 1 numbers): a strip's faces are a run. */
  first: number[];
  quads: number;
  /** Lane borders drawn back to the station before (or after) where a tight bend folded the lane over itself, and the strips they are on. */
  foldedBorders: number;
  foldedStrips: number;
  /** Lane quads left out because they still came out inside out. */
  foldedQuads: number;
}

/**
 * Plan position and source station of every lane border of a strip, with folds taken out: on the inside of a bend
 * tighter than the road is wide, a border runs backwards between two stations and its lane would lie on itself.
 * Such a border stays where it was at the station before (the bend's pivot). The two end stations never move: the
 * junctions and the joints are built on them, so a fold at the last station moves the one before it instead.
 */
export interface StripBorders {
  x: Float64Array;
  z: Float64Array;
  /** The station each border point was taken from (its own, unless a fold moved it). */
  from: Int32Array;
  moved: number;
}

/** Two strip ends at a joint are one cross-section: borders of the two that lie within this distance are one point (m). */
export const JOINT_PIN_M = 0.05;

/**
 * The lane borders every part of the mesh builds on, strip by strip: folds taken out (unfold), and at a joint the
 * second strip's end takes the first strip's border points for the lanes the joint pairs. The lane model rounds
 * to the millimetre and a split zone ends up to a few millimetres off its branches, so without this the two rows
 * of a joint would not share their vertices and the road would have a hairline across it.
 */
export class Borders {
  private readonly cache = new Map<number, StripBorders>();
  private readonly pins = new Map<number, Map<number, [number, number]>>();
  private readonly strips: readonly Strip[];
  /** Border points moved onto the other strip's at a joint, the largest move, and pairs further apart than JOINT_PIN_M (left alone). */
  pinned = 0;
  pinMaxM = 0;
  apart = 0;

  constructor(strips: readonly Strip[], joints: readonly Joint[]) {
    this.strips = strips;
    for (const j of joints) {
      const sa = strips[j.a.strip] as Strip;
      const sb = strips[j.b.strip] as Strip;
      const ia = j.a.end === 'start' ? 0 : sa.st.length - 1;
      const ib = j.b.end === 'start' ? 0 : sb.st.length - 1;
      const pa = sa.st[ia] as Station;
      const pb = sb.st[ib] as Station;
      // walking away from the joint the two strips run opposite ways, unless both ends are the same kind
      const flip = j.a.end === j.b.end;
      let pins = this.pins.get(j.b.strip);
      if (!pins) this.pins.set(j.b.strip, (pins = new Map()));
      for (const [la, lb] of j.lanes) {
        for (const [ka, kb] of [[la, flip ? lb + 1 : lb], [la + 1, flip ? lb : lb + 1]] as [number, number][]) {
          const x = borderX(pa, ka);
          const z = borderZ(pa, ka);
          const d = Math.hypot(x - borderX(pb, kb), z - borderZ(pb, kb));
          const key = ib * pb.b.length + kb;
          if (d > JOINT_PIN_M) this.apart++;
          else if (d > 0 && !pins.has(key)) {
            pins.set(key, [x, z]);
            this.pinned++;
            this.pinMaxM = Math.max(this.pinMaxM, d);
          }
        }
      }
    }
  }

  of(si: number): StripBorders {
    let b = this.cache.get(si);
    if (!b) {
      b = unfold(this.strips[si] as Strip);
      for (const [key, [x, z]] of this.pins.get(si) ?? []) {
        b.x[key] = x;
        b.z[key] = z;
      }
      this.cache.set(si, b);
    }
    return b;
  }
}

export function unfold(s: Strip): StripBorders {
  const n = s.st.length;
  const B = (s.st[0] as Station).b.length;
  const x = new Float64Array(n * B);
  const z = new Float64Array(n * B);
  const from = new Int32Array(n * B);
  for (let i = 0; i < n; i++) {
    const st = s.st[i] as Station;
    for (let k = 0; k < B; k++) {
      x[i * B + k] = borderX(st, k);
      z[i * B + k] = borderZ(st, k);
      from[i * B + k] = i;
    }
  }
  let moved = 0;
  const back = (i: number, j: number, k: number): boolean => {
    // the border between stations i and j (i before j) runs against the reference line
    const p = s.st[i] as Station;
    const q = s.st[j] as Station;
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    return ((x[j * B + k] as number) - (x[i * B + k] as number)) * dx + ((z[j * B + k] as number) - (z[i * B + k] as number)) * dz < -1e-9;
  };
  const take = (i: number, j: number, k: number): void => {
    x[i * B + k] = x[j * B + k] as number;
    z[i * B + k] = z[j * B + k] as number;
    from[i * B + k] = from[j * B + k] as number;
    moved++;
  };
  for (let k = 0; k < B; k++) {
    for (let i = 1; i < n - 1; i++) if (back(i - 1, i, k)) take(i, i - 1, k);
    for (let i = n - 2; i >= 1; i--) if (back(i, i + 1, k)) take(i, i + 1, k);
  }
  return { x, z, from, moved };
}

/** Adds the lane quads of every strip. Lanes with no width at both stations give no face. */
export function addStripFaces(fs: FaceSet, strips: readonly Strip[], kinds: readonly ArrayLike<number>[], borders: Borders): StripFaces {
  const out: StripFaces = { first: [], quads: 0, foldedBorders: 0, foldedStrips: 0, foldedQuads: 0 };
  // corners in the turning sense every face is stored in: left back, left front, right front, right back
  const c: Corner[] = [{ x: 0, z: 0, y: 0, u: 0, v: 0 }, { x: 0, z: 0, y: 0, u: 0, v: 0 }, { x: 0, z: 0, y: 0, u: 1, v: 0 }, { x: 0, z: 0, y: 0, u: 1, v: 0 }];
  const [A, D, C, B] = c as [Corner, Corner, Corner, Corner];
  strips.forEach((s, si) => {
    out.first.push(fs.faces);
    const L = s.lanes.length;
    const W = L + 1;
    const kind = kinds[si] as ArrayLike<number>;
    const u = borders.of(si);
    if (u.moved) {
      out.foldedBorders += u.moved;
      out.foldedStrips++;
    }
    const set = (corner: Corner, i: number, k: number, raise: number): void => {
      corner.x = u.x[i * W + k] as number;
      corner.z = u.z[i * W + k] as number;
      const src = s.st[u.from[i * W + k] as number] as Station;
      corner.y = src.h + raise;
      corner.v = src.s;
    };
    for (let i = 0; i + 1 < s.st.length; i++) {
      const p = s.st[i] as Station;
      const q = s.st[i + 1] as Station;
      const kp = kind[i] as number;
      const kq = kind[i + 1] as number;
      const cut = cutOf(kp, kq);
      const sheet = Math.max(sheetOf(p, kp), sheetOf(q, kq));
      for (let k = 0; k < L; k++) {
        if ((p.b[k] as number) - (p.b[k + 1] as number) < 1e-4 && (q.b[k] as number) - (q.b[k + 1] as number) < 1e-4) continue;
        const raise = (s.lanes[k] as LaneDef).raise;
        set(A, i, k, raise);
        set(B, i, k + 1, raise);
        set(C, i + 1, k + 1, raise);
        set(D, i + 1, k, raise);
        const f = fs.add(c, { piece: si, kind: (s.lanes[k] as LaneDef).type, cut, raise, sheet, station: i, lane: k }, true);
        if (f >= 0) out.quads++;
        else if (f === -2) out.foldedQuads++;
      }
    }
  });
  out.first.push(fs.faces);
  return out;
}

/** Full width quads of the strips (on the borders the faces are built on) on a grid: which stretches of road lie near a box. */
export class StripIndex {
  private readonly cells = new Map<number, number[]>();
  readonly strip: number[] = [];
  readonly station: number[] = [];
  private readonly cell: number;
  private readonly strips: readonly Strip[];
  private readonly kinds: readonly ArrayLike<number>[];
  private readonly borders: Borders;

  constructor(strips: readonly Strip[], kinds: readonly ArrayLike<number>[], borders: Borders, cell = 16) {
    this.cell = cell;
    this.strips = strips;
    this.kinds = kinds;
    this.borders = borders;
    strips.forEach((s, si) => {
      for (let i = 0; i + 1 < s.st.length; i++) {
        const r = this.quad(si, i);
        const id = this.strip.length;
        this.strip.push(si);
        this.station.push(i);
        const c0 = Math.floor(Math.min(r[0]![0], r[1]![0], r[2]![0], r[3]![0]) / cell);
        const c1 = Math.floor(Math.max(r[0]![0], r[1]![0], r[2]![0], r[3]![0]) / cell);
        const r0 = Math.floor(Math.min(r[0]![1], r[1]![1], r[2]![1], r[3]![1]) / cell);
        const r1 = Math.floor(Math.max(r[0]![1], r[1]![1], r[2]![1], r[3]![1]) / cell);
        for (let x = c0; x <= c1; x++) {
          for (let z = r0; z <= r1; z++) {
            const key = (x + 100000) * 262144 + (z + 100000);
            const list = this.cells.get(key);
            if (list) list.push(id);
            else this.cells.set(key, [id]);
          }
        }
      }
    });
  }

  /** The whole width of a strip between stations i and i + 1 as a ring. */
  quad(si: number, i: number): [number, number][] {
    const b = this.borders.of(si);
    const W = ((this.strips[si] as Strip).st[0] as Station).b.length;
    const at = (row: number, k: number): [number, number] => [b.x[row * W + k] as number, b.z[row * W + k] as number];
    return [at(i, 0), at(i, W - 1), at(i + 1, W - 1), at(i + 1, 0)];
  }

  sheet(si: number, i: number): number {
    const s = this.strips[si] as Strip;
    const k = this.kinds[si] as ArrayLike<number>;
    return Math.max(sheetOf(s.st[i] as Station, k[i] as number), sheetOf(s.st[i + 1] as Station, k[i + 1] as number));
  }

  /**
   * The carriageway height a strip face has at a plan point on one of its edges (a lane border between two stations,
   * or a station row across the strip), within `tol` metres, or null. Faces lie flat across, so it is the height of
   * the edge's two corners, blended along it.
   */
  edgeHeight(x: number, z: number, tol: number): number | null {
    for (const id of this.around(x, z)) {
      const si = this.strip[id] as number;
      const i = this.station[id] as number;
      const s = this.strips[si] as Strip;
      const b = this.borders.of(si);
      const W = (s.st[0] as Station).b.length;
      const hAt = (row: number, k: number): number => (s.st[b.from[row * W + k] as number] as Station).h;
      const P = (row: number, k: number): [number, number] => [b.x[row * W + k] as number, b.z[row * W + k] as number];
      const onSeg = (p: [number, number], q: [number, number], hp: number, hq: number): number | null => {
        const dx = q[0] - p[0];
        const dz = q[1] - p[1];
        const len2 = dx * dx + dz * dz;
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((x - p[0]) * dx + (z - p[1]) * dz) / len2)) : 0;
        return Math.hypot(x - p[0] - dx * t, z - p[1] - dz * t) <= tol ? hp + (hq - hp) * t : null;
      };
      for (let k = 0; k < W; k++) {
        const along = onSeg(P(i, k), P(i + 1, k), hAt(i, k), hAt(i + 1, k));
        if (along !== null) return along;
      }
      for (const row of [i, i + 1]) {
        for (let k = 0; k + 1 < W; k++) {
          const across = onSeg(P(row, k), P(row, k + 1), hAt(row, k), hAt(row, k + 1));
          if (across !== null) return across;
        }
      }
    }
    return null;
  }

  /** Entries (see `strip` and `station`) whose cells hold the point. */
  around(x: number, z: number): readonly number[] {
    return this.cells.get((Math.floor(x / this.cell) + 100000) * 262144 + (Math.floor(z / this.cell) + 100000)) ?? [];
  }

  /** Every cell's entries. */
  eachCell(fn: (ids: readonly number[]) => void): void {
    for (const ids of this.cells.values()) fn(ids);
  }

  /** Quads on `sheet` whose cells meet the box, grouped by strip: strip number to rings. */
  near(minX: number, minZ: number, maxX: number, maxZ: number, sheet: number): Map<number, [number, number][][]> {
    const seen = new Set<number>();
    const out = new Map<number, [number, number][][]>();
    for (let x = Math.floor(minX / this.cell); x <= Math.floor(maxX / this.cell); x++) {
      for (let z = Math.floor(minZ / this.cell); z <= Math.floor(maxZ / this.cell); z++) {
        for (const id of this.cells.get((x + 100000) * 262144 + (z + 100000)) ?? []) {
          if (seen.has(id)) continue;
          seen.add(id);
          const si = this.strip[id] as number;
          const i = this.station[id] as number;
          if (this.sheet(si, i) !== sheet) continue;
          const r = this.quad(si, i);
          if (Math.max(r[0]![0], r[1]![0], r[2]![0], r[3]![0]) < minX || Math.min(r[0]![0], r[1]![0], r[2]![0], r[3]![0]) > maxX) continue;
          if (Math.max(r[0]![1], r[1]![1], r[2]![1], r[3]![1]) < minZ || Math.min(r[0]![1], r[1]![1], r[2]![1], r[3]![1]) > maxZ) continue;
          const list = out.get(si);
          if (list) list.push(r);
          else out.set(si, [r]);
        }
      }
    }
    return out;
  }
}
