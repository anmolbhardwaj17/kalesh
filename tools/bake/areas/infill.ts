// Parcels from the block faces (P2-009, DELHI_WORLD.md "The generator": "otherwise lots cut along road frontage at the
// profile's frontage width"). The map's footprints are the parcels wherever they exist. Where a row of buildings on a
// street is missing, free frontage is cut into lots of the profile's frontage width and each lot becomes a parcel:
// - in a profile whose buildings stand wall to wall on the street line (views.ts `continuous`: the old city lanes and
//   the bazaars) every stretch of free frontage, because there the map is short of footprints, not the city of walls;
// - elsewhere only a hole in a row (free frontage with a building at both ends, at most 60 m): a longer empty
//   frontage is open ground, for the plot edge and greenery tasks to dress.
// Open land, water, landmark zones, paved walking areas, the ground under a deck, a strip under 14 m deep between two
// roads and anything already built stay as they are.
// Lots are found by walking each road edge on both sides, so the rule is local: a change in one place moves only the
// lots beside it. Pure.
import type { P2 } from '../geom.ts';
import { rngFor } from '../rand.ts';
import { F_DECK, F_OPEN, F_OUT, F_ROAD, F_WALK, F_WATER, F_ZONE } from './space.ts';
import type { FlagRaster, RingIndex } from './space.ts';
import { ringBox } from './space.ts';
import type { ProfileView } from './views.ts';

export const INFILL = {
  stationM: 2,
  /** The road's outer edge is looked for up to this far past its half width (m). */
  edgeSearchM: 22,
  /** Probe depths behind the frontage line (m). */
  probesM: [1, 3.5, 6] as readonly number[],
  /** No lot where another road lies this near behind the frontage line (m): a strip between two roads is a verge, not a block. */
  stripProbesM: [8, 10, 12, 14] as readonly number[],
  /** A hole in a row is at most this long (m); longer free frontage is open ground. */
  maxGapM: 60,
  minDepthM: 4,
  maxDepthM: 18,
  /** A lot ends this far from the road's edge at least (m). */
  kerbClearM: 0.4,
} as const;

export interface InfillEdge {
  id: string;
  pts: readonly P2[];
  /** Carriageway width (m). */
  width: number;
}

export interface Lot {
  id: string;
  ring: P2[];
  area: number;
  /** The profile that asked for it and the edge it fronts. */
  profile: string;
  edge: string;
  widthM: number;
  depthM: number;
}

export interface InfillInput {
  edges: readonly InfillEdge[];
  raster: FlagRaster;
  /** The footprints; accepted lots are added so a later edge does not build on them. */
  index: RingIndex<{ id: string; ring: readonly P2[]; box: ReturnType<typeof ringBox> }>;
  /** The profile with the largest weight at a point. */
  viewAt: (x: number, z: number) => ProfileView | null;
  /** Area of a ring on the road faces (m2), exact. */
  onRoad: (ring: readonly P2[]) => number;
  /** Block metres to the world tile (the seed). */
  tileOf: (x: number, z: number) => { tx: number; tz: number };
}

export interface InfillResult {
  lots: Lot[];
  stats: {
    edges: number; stations: number; free: number; holes: number; holeM: number; lots: number; rejected: number; tooLong: number;
    /** After the lots, in the wall-to-wall profiles: free frontage left (m), and the stretches of 40 m or more with the longest. */
    leftFreeM: number; leftOver40: number; leftLongestM: number;
  };
}

const BLOCKED = F_ROAD | F_DECK | F_WATER | F_OPEN | F_ZONE | F_WALK | F_OUT;
const r2 = (v: number): number => Math.round(v * 100) / 100 + 0;

interface Station {
  /** The frontage point and the unit normal away from the road. */
  x: number;
  z: number;
  nx: number;
  nz: number;
  /** F free, B a building stands there, X anything else. */
  state: 'F' | 'B' | 'X';
  view: ProfileView | null;
}

export function infillLots(input: InfillInput): InfillResult {
  // twice: the second walk sees the lots of the first as buildings and cuts what they left free; then a count of the
  // free frontage that is still left in the wall-to-wall profiles
  const first = walkEdges(input, true);
  const second = walkEdges(input, true);
  const left = walkEdges(input, false);
  const a = first.stats;
  const b = second.stats;
  return {
    lots: [...first.lots, ...second.lots],
    stats: { ...a, holes: a.holes + b.holes, holeM: a.holeM + b.holeM, lots: a.lots + b.lots, rejected: b.rejected, leftFreeM: left.stats.leftFreeM, leftOver40: left.stats.leftOver40, leftLongestM: left.stats.leftLongestM },
  };
}

function walkEdges(input: InfillInput, cut: boolean): InfillResult {
  const { raster, index } = input;
  const stats = { edges: 0, stations: 0, free: 0, holes: 0, holeM: 0, lots: 0, rejected: 0, tooLong: 0, leftFreeM: 0, leftOver40: 0, leftLongestM: 0 };
  const lots: Lot[] = [];
  const edges = input.edges.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const clearAt = (x: number, z: number): 'F' | 'B' | 'X' => {
    if (raster.at(x, z) & BLOCKED) return 'X';
    return index.hit(x, z) ? 'B' : 'F';
  };
  /** A ring is free: every probe point inside and on its edge, then the road faces exactly. */
  const ringFree = (ring: readonly P2[]): boolean => {
    const [a, b, c, d] = ring as [P2, P2, P2, P2];
    const nu = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 1.2));
    const nv = Math.max(2, Math.ceil(Math.hypot(d.x - a.x, d.z - a.z) / 1.2));
    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j <= nv; j++) {
        const u = i / nu;
        const v = j / nv;
        const x = (a.x + (b.x - a.x) * u) * (1 - v) + (d.x + (c.x - d.x) * u) * v;
        const z = (a.z + (b.z - a.z) * u) * (1 - v) + (d.z + (c.z - d.z) * u) * v;
        if (clearAt(x, z) !== 'F') return false;
      }
    }
    // a footprint corner inside the lot (a building smaller than the probe grid)
    for (const n of index.near(ringBox(ring))) for (const p of n.ring) if (inQuad(p, ring)) return false;
    return input.onRoad(ring) <= 0.01;
  };
  for (const e of edges) {
    if (e.pts.length < 2) continue;
    stats.edges++;
    for (const side of [1, -1]) {
      // stations along the edge
      const st: Station[] = [];
      let carry = 0;
      for (let k = 0; k + 1 < e.pts.length; k++) {
        const p = e.pts[k] as P2;
        const q = e.pts[k + 1] as P2;
        const len = Math.hypot(q.x - p.x, q.z - p.z);
        if (len < 1e-6) continue;
        const tx = (q.x - p.x) / len;
        const tz = (q.z - p.z) / len;
        const nx = side * tz;
        const nz = -side * tx;
        for (let s = carry; s < len; s += INFILL.stationM) {
          const cx = p.x + tx * s;
          const cz = p.z + tz * s;
          stats.stations++;
          // the road's outer edge on this side: the first 1.5 m clear of road faces
          let off = Math.max(0.5, e.width / 2 - 1);
          let run = 0;
          let found = -1;
          for (; off <= e.width / 2 + INFILL.edgeSearchM; off += 0.5) {
            if (raster.at(cx + nx * off, cz + nz * off) & (F_ROAD | F_DECK)) run = 0;
            else if (++run >= 3) {
              found = off - 1;
              break;
            }
          }
          if (found < 0) {
            st.push({ x: cx, z: cz, nx, nz, state: 'X', view: null });
            continue;
          }
          const fx = cx + nx * (found + INFILL.kerbClearM);
          const fz = cz + nz * (found + INFILL.kerbClearM);
          let state: 'F' | 'B' | 'X' = 'F';
          for (const d of INFILL.probesM) {
            const c = clearAt(fx + nx * d, fz + nz * d);
            if (c === 'B') {
              state = 'B';
              break;
            }
            if (c === 'X') state = 'X';
          }
          // a strip between two roads (the verge between a main road and its ramp or its service lane) is no block face
          if (state === 'F') for (const d of INFILL.stripProbesM) if (raster.at(fx + nx * d, fz + nz * d) & (F_ROAD | F_DECK)) state = 'X';
          let view: ProfileView | null = null;
          if (state === 'F') {
            view = input.viewAt(fx + nx * 3, fz + nz * 3);
            if (!view || !view.mix.length || !view.continuous) state = 'X';
            else stats.free++;
          }
          st.push({ x: fx, z: fz, nx, nz, state, view });
        }
        carry = (carry + Math.ceil((len - carry) / INFILL.stationM) * INFILL.stationM) - len;
      }
      // free runs: in a wall-to-wall profile every one is cut into lots; elsewhere only a hole in a row (a building at
      // both ends, at most maxGapM long)
      for (let i = 0; i < st.length; i++) {
        if ((st[i] as Station).state !== 'F') continue;
        let j = i;
        while (j + 1 < st.length && (st[j + 1] as Station).state === 'F') j++;
        const first = st[i] as Station;
        const view = first.view as ProfileView;
        const span = (j - i) * INFILL.stationM;
        const hole = st[i - 1]?.state === 'B' && st[j + 1]?.state === 'B';
        const start = i;
        const end = j;
        i = j;
        if (!cut) {
          if (view.continuous) {
            stats.leftFreeM += span;
            if (span >= 40) stats.leftOver40++;
            stats.leftLongestM = Math.max(stats.leftLongestM, span);
          }
          continue;
        }
        if (span < Math.max(3, view.frontage[0] * 0.5)) continue;
        if (!view.continuous) {
          if (!hole) continue;
          if (span > INFILL.maxGapM) {
            stats.tooLong++;
            continue;
          }
        }
        stats.holes++;
        stats.holeM += span;
        const t = input.tileOf(first.x, first.z);
        const r = rngFor(t.tx, t.tz, `run/${Math.round(first.x * 2)}_${Math.round(first.z * 2)}`, 'lots');
        const want = r.range(view.frontage[0], Math.max(view.frontage[0], Math.min(view.frontage[1], 12)));
        const count = Math.max(1, Math.round(span / want));
        for (let k = 0; k < count; k++) {
          // the lot's own stations: its front is the chord between them, so a row follows a curved street
          const a = st[start + Math.round((k * (end - start)) / count)] as Station;
          const b = st[start + Math.round(((k + 1) * (end - start)) / count)] as Station;
          const w = Math.hypot(b.x - a.x, b.z - a.z);
          if (w < 2) continue;
          const ux = (b.x - a.x) / w;
          const uz = (b.z - a.z) / w;
          let nx = uz;
          let nz = -ux;
          if (nx * a.nx + nz * a.nz < 0) {
            nx = -nx;
            nz = -nz;
          }
          const setback = r.range(view.setback[0], view.setback[1]);
          const want = Math.max(INFILL.minDepthM, Math.min(INFILL.maxDepthM, w * r.range(1.1, 2.0)));
          // the deepest lot that fits: rows 1 m apart from the front; a front that does not fit is tried again 1.5 m
          // shorter at both ends
          let ring: P2[] | null = null;
          for (const trim of [0, 1.5]) {
            if (w - 2 * trim < 3) break;
            const ax = a.x + ux * trim + nx * setback;
            const az = a.z + uz * trim + nz * setback;
            const bx = b.x - ux * trim + nx * setback;
            const bz = b.z - uz * trim + nz * setback;
            const cols = Math.max(2, Math.ceil((w - 2 * trim) / 1.2));
            let depth = 0;
            for (let d = 0; d <= want + 1e-9; d += 1) {
              let ok = true;
              for (let c = 0; c <= cols && ok; c++) ok = clearAt(ax + ((bx - ax) * c) / cols + nx * d, az + ((bz - az) * c) / cols + nz * d) === 'F';
              if (!ok) break;
              depth = d;
            }
            depth = Math.min(want, depth);
            if (depth < INFILL.minDepthM) continue;
            const cand = [{ x: r2(ax), z: r2(az) }, { x: r2(bx), z: r2(bz) }, { x: r2(bx + nx * depth), z: r2(bz + nz * depth) }, { x: r2(ax + nx * depth), z: r2(az + nz * depth) }];
            if (ringFree(cand)) {
              ring = cand;
              break;
            }
            // a corner of a building between the rows: one more try a metre shallower
            const less = [cand[0] as P2, cand[1] as P2, { x: r2(bx + nx * (depth - 1)), z: r2(bz + nz * (depth - 1)) }, { x: r2(ax + nx * (depth - 1)), z: r2(az + nz * (depth - 1)) }];
            if (depth - 1 >= INFILL.minDepthM && ringFree(less)) {
              ring = less;
              break;
            }
          }
          if (!ring) {
            stats.rejected++;
            continue;
          }
          const cx = (ring[0]!.x + ring[1]!.x + ring[2]!.x + ring[3]!.x) / 4;
          const cz = (ring[0]!.z + ring[1]!.z + ring[2]!.z + ring[3]!.z) / 4;
          const lw = Math.hypot(ring[1]!.x - ring[0]!.x, ring[1]!.z - ring[0]!.z);
          const ld = Math.hypot(ring[3]!.x - ring[0]!.x, ring[3]!.z - ring[0]!.z);
          const lot: Lot = { id: `lot/${Math.round(cx * 2)}_${Math.round(cz * 2)}`, ring, area: r2(lw * ld), profile: view.key, edge: e.id, widthM: r2(lw), depthM: r2(ld) };
          lots.push(lot);
          index.add({ id: lot.id, ring, box: ringBox(ring) });
          stats.lots++;
        }
      }
    }
  }
  stats.holeM = Math.round(stats.holeM);
  return { lots, stats };
}

function inQuad(p: P2, ring: readonly P2[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as P2;
    const b = ring[j] as P2;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}
