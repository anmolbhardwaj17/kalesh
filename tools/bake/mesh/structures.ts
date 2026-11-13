// Edge treatments and supports of the road mesh (P1-014, MAP_REPAIR.md "Junction mesh builder": "every free deck
// edge gets an edge treatment"). Nothing here stands at grade: a parapet, a wall, an underside, a pier or a deck
// joint exists only where the elevation step marked the station as a structure (elevation/structures.ts kinds), and
// only along an edge of the strip that no other face shares (so the two carriageways of one deck get no wall between
// them where they touch). Deck: a parapet, the fascia under it and the underside. Fill (a walled ramp): a parapet and
// the retaining wall down to the ground. Cut: a retaining wall up to the ground with a parapet on top (the rule: an
// open cut is fenced). Tunnel: walls and a roof once the road is deep enough. Piers stand under decks about every
// 28 m, never on a face of another level; where none can stand for a long way, a portal (portal.ts). Pure.
import { smoothstep } from '../roads/curve.ts';
import { DECK_DEPTH, HEADROOM, KERB_RAISE, PARAPET_RAISE } from '../roads/model.ts';
import type { Station, Strip } from '../roads/model.ts';
import { edgeKey } from './conform.ts';
import type { EdgeMap } from './conform.ts';
import { CUT_NONE } from './faces.ts';
import type { FaceSet } from './faces.ts';
import type { MeshInput } from './input.ts';
import type { Sink, V3 } from './solids.ts';
import { K_CUT, K_DECK, K_FILL, K_GRADE, K_TUNNEL } from './stripfaces.ts';
import type { Borders } from './stripfaces.ts';
import { sharedArea } from './clip.ts';
import { PORTAL_AFTER_M, emitPortal, findPortal } from './portal.ts';

export const PARAPET_WIDTH_M = 0.25;
export const PIER_SPACING_M = 28;
/** A deck lower than this above the ground gets no pier (m): the abutment carries it. */
export const PIER_MIN_M = 3.5;
/** A pier may share this much area with a face of another level (m2): the check's limit, less a margin. */
export const PIER_AREA_EPS_M2 = 0.005;
/** The longest span the mesh builds without a portal: longer ones are listed (m). */
export const LONG_SPAN_M = 60;
/** A tunnel is roofed once the road lies this far under the ground (m): the headroom and the slab. */
export const ROOF_DEPTH_M = HEADROOM + 0.7;

export type EdgeKind = 'deck' | 'fill' | 'cut' | 'tunnel';

export interface EdgeSegment {
  strip: number;
  station: number;
  side: 'L' | 'R';
  kind: EdgeKind;
  /** True when the segment carries a parapet (not only a wall). */
  parapet: boolean;
}

export interface Pier {
  strip: number;
  station: number;
  /** Footprint in plan. */
  ring: [number, number][];
  /** The level sheet of the deck it carries. */
  sheet: number;
  bottom: number;
  top: number;
  /** A leg of a portal (portal.ts). */
  portal?: boolean;
}

export interface StructureReport {
  segments: EdgeSegment[];
  parapets: number;
  byKind: Record<string, number>;
  /** Sides of structure stretches left bare because another face shares the edge. */
  sharedSides: number;
  piers: Pier[];
  /** Pier places passed over because a face of another level lies under them, and the longest run between two piers (m). */
  piersMoved: number;
  maxSpanM: number;
  /** Portals: two legs beside the deck and a beam, where no pier can stand under it (portal.ts). */
  portals: number;
  /** Spans over LONG_SPAN_M, with why no portal stands in them. */
  longSpans: { strip: number; station: number; spanM: number; why: string }[];
  joints: number;
  undersides: number;
  roofs: number;
  abutmentWalls: number;
}

/** Faces by plan box on a grid: what lies under a pier. */
export class FaceGrid {
  private readonly cells = new Map<number, number[]>();
  private readonly cell: number;
  private readonly fs: FaceSet;

  constructor(fs: FaceSet, cell = 12) {
    this.fs = fs;
    this.cell = cell;
    for (let f = 0; f < fs.faces; f++) {
      const b = this.box(f);
      for (let x = Math.floor(b[0] / cell); x <= Math.floor(b[2] / cell); x++) {
        for (let z = Math.floor(b[1] / cell); z <= Math.floor(b[3] / cell); z++) {
          const k = (x + 100000) * 262144 + (z + 100000);
          const list = this.cells.get(k);
          if (list) list.push(f);
          else this.cells.set(k, [f]);
        }
      }
    }
  }

  private box(f: number): [number, number, number, number] {
    const s = this.fs.start[f] as number;
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (let k = 0; k < (this.fs.len[f] as number); k++) {
      const id = this.fs.ids[s + k] as number;
      x0 = Math.min(x0, this.fs.vx[id] as number);
      x1 = Math.max(x1, this.fs.vx[id] as number);
      z0 = Math.min(z0, this.fs.vz[id] as number);
      z1 = Math.max(z1, this.fs.vz[id] as number);
    }
    return [x0, z0, x1, z1];
  }

  /** Faces whose box meets the box. */
  near(x0: number, z0: number, x1: number, z1: number): number[] {
    const out = new Set<number>();
    for (let x = Math.floor(x0 / this.cell); x <= Math.floor(x1 / this.cell); x++) {
      for (let z = Math.floor(z0 / this.cell); z <= Math.floor(z1 / this.cell); z++) {
        for (const f of this.cells.get((x + 100000) * 262144 + (z + 100000)) ?? []) {
          const b = this.box(f);
          if (b[0] <= x1 && b[2] >= x0 && b[1] <= z1 && b[3] >= z0) out.add(f);
        }
      }
    }
    return [...out];
  }
}

/** True when a face may not have a pier of a deck on `sheet` standing in it: any other level, except a roofed tunnel under the ground. */
export const blocksPier = (fs: FaceSet, f: number, sheet: number): boolean => fs.sheet[f] !== sheet && !((fs.sheet[f] as number) >= 2000 && fs.cut[f] === CUT_NONE);

function pointInFace(fs: FaceSet, f: number, x: number, z: number): boolean {
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
}

const structureOf = (kp: number, kq: number): EdgeKind | null => (kp === K_DECK || kq === K_DECK ? 'deck' : kp === K_FILL || kq === K_FILL ? 'fill' : kp === K_TUNNEL || kq === K_TUNNEL ? 'tunnel' : kp === K_CUT || kq === K_CUT ? 'cut' : null);

export function buildStructures(input: MeshInput, fs: FaceSet, edges: EdgeMap, grid: FaceGrid, sink: Sink, borders: Borders, sheetOfStation: (strip: number, station: number) => number): StructureReport {
  const out: StructureReport = { segments: [], parapets: 0, byKind: {}, sharedSides: 0, piers: [], piersMoved: 0, maxSpanM: 0, portals: 0, longSpans: [], joints: 0, undersides: 0, roofs: 0, abutmentWalls: 0 };
  input.strips.forEach((s: Strip, si: number) => {
    const kind = input.kinds[si] as ArrayLike<number>;
    let any = false;
    for (let i = 0; i < s.st.length && !any; i++) any = kind[i] !== K_GRADE;
    if (!any) return;
    const L = s.lanes.length;
    const W = L + 1;
    const u = borders.of(si);
    const X = (i: number, k: number): number => u.x[i * W + k] as number;
    const Z = (i: number, k: number): number => u.z[i * W + k] as number;
    const roofed = (st: Station, k: number): boolean => k === K_TUNNEL && st.g - st.h >= ROOF_DEPTH_M;
    for (let i = 0; i + 1 < s.st.length; i++) {
      const p = s.st[i] as Station;
      const q = s.st[i + 1] as Station;
      const kp = kind[i] as number;
      const kq = kind[i + 1] as number;
      const sc = structureOf(kp, kq);
      if (!sc) continue;
      for (const side of ['L', 'R'] as const) {
        const kb = side === 'L' ? 0 : L;
        // the outermost lane that has width here: its top is where the edge treatment stands
        let lane = side === 'L' ? 0 : L - 1;
        const step = side === 'L' ? 1 : -1;
        while (lane >= 0 && lane < L && (p.b[lane] as number) - (p.b[lane + 1] as number) < 1e-4 && (q.b[lane] as number) - (q.b[lane + 1] as number) < 1e-4) lane += step;
        if (lane < 0 || lane >= L) continue;
        const va = fs.find(X(i, kb), Z(i, kb));
        const vb = fs.find(X(i + 1, kb), Z(i + 1, kb));
        if (va < 0 || vb < 0 || va === vb) continue;
        const own = side === 'L' ? edgeKey(va, vb) : edgeKey(vb, va);
        const twin = side === 'L' ? edgeKey(vb, va) : edgeKey(va, vb);
        if (!edges.at.has(own) || edges.at.has(twin)) {
          out.sharedSides++;
          continue;
        }
        const sign = side === 'L' ? 1 : -1;
        const raise = (s.lanes[lane] as { raise: number }).raise;
        const P = (st: Station, i2: number, y: number, off = 0): V3 => [X(i2, kb) + st.nx * sign * off, y, Z(i2, kb) + st.nz * sign * off];
        const outward: V3 = [p.nx * sign, 0, p.nz * sign];
        const inward: V3 = [-p.nx * sign, 0, -p.nz * sign];
        const grow = (st: Station): number => KERB_RAISE + (PARAPET_RAISE - KERB_RAISE) * smoothstep((Math.abs(st.h - st.g) - 0.6) / 1.2);
        const lt0 = p.h + raise;
        const lt1 = q.h + raise;
        let parapet = false;
        if (sc === 'deck' || sc === 'fill') {
          const t0 = p.h + Math.max(raise, grow(p));
          const t1 = q.h + Math.max(raise, grow(q));
          if (t0 - lt0 > 0.02 || t1 - lt1 > 0.02) {
            parapet = true;
            sink.quad('parapet', P(p, i, lt0, -PARAPET_WIDTH_M), P(q, i + 1, lt1, -PARAPET_WIDTH_M), P(q, i + 1, t1, -PARAPET_WIDTH_M), P(p, i, t0, -PARAPET_WIDTH_M), inward);
            sink.quad('parapet', P(p, i, t0, -PARAPET_WIDTH_M), P(q, i + 1, t1, -PARAPET_WIDTH_M), P(q, i + 1, t1), P(p, i, t0), [0, 1, 0]);
          }
          const bottom = (st: Station, k: number): number => (k === K_DECK ? st.h - DECK_DEPTH : st.g - 0.6);
          sink.quad('wall', P(p, i, t0), P(q, i + 1, t1), P(q, i + 1, Math.min(bottom(q, kq), t1)), P(p, i, Math.min(bottom(p, kp), t0)), outward);
        } else {
          // lowered: a wall up from the road edge; to the ground and a parapet above it in a cut, to the roof in a tunnel
          const top = (st: Station, k: number, lt: number): number => (roofed(st, k) ? st.h + HEADROOM : Math.max(lt, st.g + (st.g - st.h > 0.6 ? PARAPET_RAISE * smoothstep((st.g - st.h - 0.6) / 1.2) : 0)));
          const t0 = top(p, kp, lt0);
          const t1 = top(q, kq, lt1);
          if (t0 - lt0 < 0.02 && t1 - lt1 < 0.02) continue;
          sink.quad('wall', P(p, i, lt0), P(q, i + 1, lt1), P(q, i + 1, t1), P(p, i, t0), inward);
          if (!(roofed(p, kp) && roofed(q, kq))) {
            parapet = t0 - p.g > 0.05 || t1 - q.g > 0.05;
            sink.quad(parapet ? 'parapet' : 'wall', P(p, i, t0), P(q, i + 1, t1), P(q, i + 1, t1, PARAPET_WIDTH_M), P(p, i, t0, PARAPET_WIDTH_M), [0, 1, 0]);
            if (parapet) sink.quad('parapet', P(p, i, t0, PARAPET_WIDTH_M), P(q, i + 1, t1, PARAPET_WIDTH_M), P(q, i + 1, Math.min(q.g, t1), PARAPET_WIDTH_M), P(p, i, Math.min(p.g, t0), PARAPET_WIDTH_M), outward);
          }
        }
        out.segments.push({ strip: si, station: i, side, kind: sc, parapet });
        out.byKind[sc] = (out.byKind[sc] ?? 0) + 1;
        if (parapet) out.parapets++;
      }
      // across the whole width: the underside of a deck, the roof of a tunnel, the wall where a ramp becomes a deck
      const A = (i2: number, k: number, y: number): V3 => [X(i2, k), y, Z(i2, k)];
      if (kp === K_DECK && kq === K_DECK) {
        sink.quad('underside', A(i, 0, p.h - DECK_DEPTH), A(i, L, p.h - DECK_DEPTH), A(i + 1, L, q.h - DECK_DEPTH), A(i + 1, 0, q.h - DECK_DEPTH), [0, -1, 0]);
        out.undersides++;
      } else if (kp === K_DECK || kq === K_DECK) {
        const at = kp === K_DECK ? q : p;
        const ai = kp === K_DECK ? i + 1 : i;
        const tx = q.x - p.x;
        const tz = q.z - p.z;
        const len = Math.hypot(tx, tz) || 1;
        for (const sgn of [1, -1]) sink.quad('wall', A(ai, 0, at.h - 0.05), A(ai, L, at.h - 0.05), A(ai, L, at.g - 0.6), A(ai, 0, at.g - 0.6), [(tx / len) * sgn, 0, (tz / len) * sgn]);
        out.abutmentWalls++;
      }
      if (roofed(p, kp) && roofed(q, kq)) {
        sink.quad('underside', A(i, 0, p.h + HEADROOM), A(i, L, p.h + HEADROOM), A(i + 1, L, q.h + HEADROOM), A(i + 1, 0, q.h + HEADROOM), [0, -1, 0]);
        out.roofs++;
      }
    }
    // piers and deck joints
    // the deck joint over a pier or a portal: a line across the carriageway, flush with it
    const joint = (st: Station): void => {
      const J = (k: number, along: number): V3 => [st.x + st.nx * (st.b[k] as number) - st.nz * along, st.h + 0.012, st.z + st.nz * (st.b[k] as number) + st.nx * along];
      sink.quad('joint', J(0, -0.04), J(L, -0.04), J(L, 0.04), J(0, 0.04), [0, 1, 0]);
      out.joints++;
    };
    let since = PIER_SPACING_M / 2;
    let lastWhy = '';
    // a span longer than the portal limit is listed with the reason the last portal try gave
    const span = (at: number): void => {
      if (since > LONG_SPAN_M && out.longSpans.length < 40) out.longSpans.push({ strip: si, station: at, spanM: Math.round(since * 10) / 10, why: lastWhy || 'no portal tried' });
      lastWhy = '';
    };
    for (let i = 1; i < s.st.length; i++) {
      const st = s.st[i] as Station;
      const prev = s.st[i - 1] as Station;
      if (kind[i] !== K_DECK) {
        if (kind[i - 1] === K_DECK) {
          out.maxSpanM = Math.max(out.maxSpanM, since);
          span(i);
        }
        since = PIER_SPACING_M / 2;
        continue;
      }
      since += Math.hypot(st.x - prev.x, st.z - prev.z);
      if (since < PIER_SPACING_M || st.h - st.g < PIER_MIN_M) continue;
      const mid = ((st.b[0] as number) + (st.b[L] as number)) / 2;
      const half = Math.max(0.6, ((st.b[0] as number) - (st.b[L] as number)) * 0.3);
      const cx = st.x + st.nx * mid;
      const cz = st.z + st.nz * mid;
      const tx = -st.nz;
      const tz = st.nx;
      const ring: [number, number][] = [
        [cx + st.nx * half + tx * 0.5, cz + st.nz * half + tz * 0.5], [cx - st.nx * half + tx * 0.5, cz - st.nz * half + tz * 0.5],
        [cx - st.nx * half - tx * 0.5, cz - st.nz * half - tz * 0.5], [cx + st.nx * half - tx * 0.5, cz + st.nz * half - tz * 0.5],
      ];
      const sheet = sheetOfStation(si, i);
      // not on a face of another level: a corner, the centre or an edge middle inside one moves the pier on
      const probes: [number, number][] = [...ring, [cx, cz], ...ring.map((r, k) => [(r[0] + (ring[(k + 1) % 4] as [number, number])[0]) / 2, (r[1] + (ring[(k + 1) % 4] as [number, number])[1]) / 2] as [number, number])];
      const under = grid.near(cx - half - 1, cz - half - 1, cx + half + 1, cz + half + 1).filter((f) => blocksPier(fs, f, sheet));
      // (and, as the check measures it, no shared area: a thin face can pass between the probes)
      if (under.some((f) => probes.some(([x, z]) => pointInFace(fs, f, x, z)) || fs.ring(f).some(([x, z]) => Math.abs((x - cx) * st.nx + (z - cz) * st.nz) < half && Math.abs((x - cx) * tx + (z - cz) * tz) < 0.5)) || (under.length > 0 && sharedArea([ring], under.map((f) => fs.ring(f)), { x: cx, z: cz }) > PIER_AREA_EPS_M2)) {
        out.piersMoved++;
        // a long way since the last pier: two legs beside the deck and a beam under it
        const portal = since >= PORTAL_AFTER_M ? findPortal(fs, grid, st, sheet) : null;
        if (typeof portal === 'string') lastWhy = portal;
        if (!portal || typeof portal === 'string') continue;
        span(i);
        out.maxSpanM = Math.max(out.maxSpanM, since);
        since = 0;
        emitPortal(sink, st, portal);
        for (const leg of portal.legs) out.piers.push({ strip: si, station: i, ring: leg, sheet, bottom: portal.bottom, top: portal.beamBottom, portal: true });
        out.portals++;
        joint(st);
        continue;
      }
      out.maxSpanM = Math.max(out.maxSpanM, since);
      span(i);
      since = 0;
      const bottom = st.g - 1;
      const top = st.h - DECK_DEPTH;
      out.piers.push({ strip: si, station: i, ring, sheet, bottom, top });
      for (let k = 0; k < 4; k++) {
        const a = ring[k] as [number, number];
        const b = ring[(k + 1) % 4] as [number, number];
        const ex = b[0] - a[0];
        const ez = b[1] - a[1];
        const len = Math.hypot(ex, ez) || 1;
        let nx = ez / len;
        let nz = -ex / len;
        if (nx * ((a[0] + b[0]) / 2 - cx) + nz * ((a[1] + b[1]) / 2 - cz) < 0) {
          nx = -nx;
          nz = -nz;
        }
        sink.quad('pier', [a[0], bottom, a[1]], [b[0], bottom, b[1]], [b[0], top, b[1]], [a[0], top, a[1]], [nx, 0, nz]);
      }
      joint(st);
    }
  });
  out.maxSpanM = Math.round(out.maxSpanM * 10) / 10;
  return out;
}
