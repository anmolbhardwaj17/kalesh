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
import { VARIANTS } from '../infra/variants.ts';
import type { PierShape } from '../infra/variants.ts';

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
  /** How it stands (P2-034, the strip's kit variant): the collider is this shape inside the ring. */
  shape?: PierShape;
  /** Deck width over it and the deck's direction in plan (unit), for the kit's cap beam. */
  deckW?: number;
  dir?: [number, number];
}

/**
 * What the infrastructure kits (P2-034, game/world/infra/) build on a deck or a fill, in block metres. The bake keeps
 * the plain shapes as colliders (materials barrier, fascia, retaining, abutment, pier, underside); the game draws
 * the variant's kit on the same lines instead.
 */
export interface KitEdge {
  strip: number;
  station: number;
  side: 'L' | 'R';
  kind: 'deck' | 'fill';
  /** The road edge at the lane top at both stations: x, y, z. */
  a: V3;
  b: V3;
  /** Barrier top and wall foot (the deck's underside, or the ground under a fill) at both stations. */
  top: [number, number];
  foot: [number, number];
  /** Outward unit normal in plan. */
  out: [number, number];
}

/** The underside of a deck between two stations: the left and right edge at both (x, y, z). */
export interface KitSoffit {
  strip: number;
  station: number;
  l0: V3;
  r0: V3;
  l1: V3;
  r1: V3;
}

/** A portal's beam (portal.ts): its four plan corners and its bottom and top. */
export interface KitBeam {
  strip: number;
  station: number;
  ring: [number, number][];
  bottom: number;
  top: number;
}

/** A plain concrete face of a structure the kit draws as it is (the wall where a ramp becomes a deck). */
export interface KitFace {
  strip: number;
  pts: [V3, V3, V3, V3];
}

export interface KitRecords {
  edges: KitEdge[];
  soffits: KitSoffit[];
  beams: KitBeam[];
  faces: KitFace[];
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
  /** Tunnel portals (P1-037): where an open ramp meets its roofed part, the wall from the roof up to the parapet. */
  headwalls: Headwall[];
  /** Inputs of the infrastructure kits (P2-034). */
  kit: KitRecords;
}

/** The face across a tunnel mouth from the roof's underside up to the parapet, so the ground above never shows an open slit. */
export interface Headwall {
  strip: number;
  station: number;
  /** The two ends on the wall lines of the carriageway (block metres). */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Height of the roof's underside (the wall's foot) and of the parapet top (m). */
  bottom: number;
  top: number;
  /** Unit normal in plan, towards the open ramp. */
  nx: number;
  nz: number;
  /** A road at grade lies over the roof at the mouth: the wall reaches its surface and has no parapet. */
  underRoad: boolean;
}

/** The back of a headwall goes this far above the roof's underside (m): under the ground over the roof, which keeps 0.5 m over it. */
export const HEADWALL_BACK_M = 0.4;

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
  const out: StructureReport = { segments: [], parapets: 0, byKind: {}, sharedSides: 0, piers: [], piersMoved: 0, maxSpanM: 0, portals: 0, longSpans: [], joints: 0, undersides: 0, roofs: 0, abutmentWalls: 0, headwalls: [], kit: { edges: [], soffits: [], beams: [], faces: [] } };
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
    /** A segment is roofed when both its stations are: walls to the roof, the roof's underside, no ground cut. */
    const segRoofed = (j: number): boolean => roofed(s.st[j] as Station, kind[j] as number) && roofed(s.st[j + 1] as Station, kind[j + 1] as number);
    /** Top of a lowered side wall at a station of a segment that is open to the sky: the ground and a parapet over it. */
    const openTop = (st: Station, lt: number): number => Math.max(lt, st.g + (st.g - st.h > 0.6 ? PARAPET_RAISE * smoothstep((st.g - st.h - 0.6) / 1.2) : 0));
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
          // P2-034: the crash barrier and the deck's side face (or a ramp's retaining wall) keep their plain shapes as
          // colliders under their own materials; the game draws the variant's kit on the same lines
          if (t0 - lt0 > 0.02 || t1 - lt1 > 0.02) {
            parapet = true;
            sink.quad('barrier', P(p, i, lt0, -PARAPET_WIDTH_M), P(q, i + 1, lt1, -PARAPET_WIDTH_M), P(q, i + 1, t1, -PARAPET_WIDTH_M), P(p, i, t0, -PARAPET_WIDTH_M), inward);
            sink.quad('barrier', P(p, i, t0, -PARAPET_WIDTH_M), P(q, i + 1, t1, -PARAPET_WIDTH_M), P(q, i + 1, t1), P(p, i, t0), [0, 1, 0]);
          }
          const bottom = (st: Station, k: number): number => (k === K_DECK ? st.h - DECK_DEPTH : st.g - 0.6);
          const f0 = Math.min(bottom(p, kp), t0);
          const f1 = Math.min(bottom(q, kq), t1);
          sink.quad(sc === 'deck' ? 'fascia' : 'retaining', P(p, i, t0), P(q, i + 1, t1), P(q, i + 1, f1), P(p, i, f0), outward);
          out.kit.edges.push({ strip: si, station: i, side, kind: sc, a: P(p, i, lt0), b: P(q, i + 1, lt1), top: [t0, t1], foot: [f0, f1], out: [outward[0], outward[2]] });
        } else {
          // lowered: a wall up from the road edge; to the ground and a parapet above it in a cut, to the roof in a tunnel
          // (a segment open to the sky keeps the parapet top at both ends, also where its far station is roofed: the
          // headwall across the mouth closes the face from the roof up to it, P1-037)
          const roof = segRoofed(i);
          const top = (st: Station, lt: number): number => (roof ? st.h + HEADROOM : openTop(st, lt));
          const t0 = top(p, lt0);
          const t1 = top(q, lt1);
          if (t0 - lt0 < 0.02 && t1 - lt1 < 0.02) continue;
          sink.quad('wall', P(p, i, lt0), P(q, i + 1, lt1), P(q, i + 1, t1), P(p, i, t0), inward);
          if (!roof) {
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
        out.kit.soffits.push({ strip: si, station: i, l0: A(i, 0, p.h - DECK_DEPTH), r0: A(i, L, p.h - DECK_DEPTH), l1: A(i + 1, 0, q.h - DECK_DEPTH), r1: A(i + 1, L, q.h - DECK_DEPTH) });
        out.undersides++;
      } else if (kp === K_DECK || kq === K_DECK) {
        const at = kp === K_DECK ? q : p;
        const ai = kp === K_DECK ? i + 1 : i;
        const tx = q.x - p.x;
        const tz = q.z - p.z;
        const len = Math.hypot(tx, tz) || 1;
        for (const sgn of [1, -1]) sink.quad('abutment', A(ai, 0, at.h - 0.05), A(ai, L, at.h - 0.05), A(ai, L, at.g - 0.6), A(ai, 0, at.g - 0.6), [(tx / len) * sgn, 0, (tz / len) * sgn]);
        out.kit.faces.push({ strip: si, pts: [A(ai, 0, at.h - 0.05), A(ai, L, at.h - 0.05), A(ai, L, at.g - 0.6), A(ai, 0, at.g - 0.6)] });
        out.abutmentWalls++;
      }
      if (roofed(p, kp) && roofed(q, kq)) {
        sink.quad('underside', A(i, 0, p.h + HEADROOM), A(i, L, p.h + HEADROOM), A(i + 1, L, q.h + HEADROOM), A(i + 1, 0, q.h + HEADROOM), [0, -1, 0]);
        out.roofs++;
      }
    }
    // tunnel portals (P1-037): where a roofed segment meets one open to the sky, a wall across the mouth from the roof's
    // underside up to the parapet top of the side walls, with a cap and a back face down into the slab, so the ground
    // above the roof never shows an open slit between itself and the roof. Inside a strip, and at a strip end whose
    // roofed segment runs on into an open one of the next strip (a cut that becomes a tunnel at a joint).
    const headwall = (i: number, dx: number, dz: number): void => {
      const st = s.st[i] as Station;
      const bottom = st.h + HEADROOM;
      let top = openTop(st, st.h);
      const ax = X(i, 0);
      const az = Z(i, 0);
      const bx = X(i, L);
      const bz = Z(i, L);
      // a road at grade over the roof right at the mouth: the wall stops under its surface and the road is the top
      let road = Infinity;
      for (const t of [0.15, 0.5, 0.85]) {
        const px = ax + (bx - ax) * t - dx * 0.3;
        const pz = az + (bz - az) * t - dz * 0.3;
        for (const f of grid.near(px, pz, px, pz)) {
          if (fs.cut[f] === CUT_NONE || fs.piece[f] === si || !pointInFace(fs, f, px, pz)) continue;
          const fst = fs.start[f] as number;
          for (let k = 0; k < (fs.len[f] as number); k++) road = Math.min(road, fs.ys[fst + k] as number);
        }
      }
      const underRoad = road < top;
      if (underRoad) top = Math.max(bottom + 0.05, road - 0.02);
      const pw = PARAPET_WIDTH_M;
      // the cap and the back reach a parapet width past the wall lines, over the ends of the side parapets
      const C = (x: number, z: number, y: number, along: number, out: number): V3 => [x - dx * along + st.nx * out, y, z - dz * along + st.nz * out];
      sink.quad('wall', [ax, bottom, az], [bx, bottom, bz], [bx, top, bz], [ax, top, az], [dx, 0, dz]);
      if (!underRoad) {
        sink.quad('parapet', C(ax, az, top, 0, pw), C(bx, bz, top, 0, -pw), C(bx, bz, top, pw, -pw), C(ax, az, top, pw, pw), [0, 1, 0]);
        sink.quad('parapet', C(ax, az, top, pw, pw), C(bx, bz, top, pw, -pw), C(bx, bz, bottom + HEADWALL_BACK_M, pw, -pw), C(ax, az, bottom + HEADWALL_BACK_M, pw, pw), [-dx, 0, -dz]);
      }
      out.headwalls.push({ strip: si, station: i, ax, az, bx, bz, bottom, top, nx: dx, nz: dz, underRoad });
    };
    const towards = (i: number, j: number): [number, number] => {
      const a = s.st[i] as Station;
      const b = s.st[j] as Station;
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      return [(b.x - a.x) / len, (b.z - a.z) / len];
    };
    const n = s.st.length;
    for (let i = 1; i + 1 < n; i++) {
      const before = segRoofed(i - 1);
      if (before === segRoofed(i)) continue;
      const [dx, dz] = towards(i, before ? i + 1 : i - 1);
      headwall(i, dx, dz);
    }
    for (const [e, inner] of [[0, 1], [n - 1, n - 2]] as const) {
      if (n < 2 || !segRoofed(Math.min(e, inner))) continue;
      const [dx, dz] = towards(inner, e);
      const st = s.st[e] as Station;
      const mid = ((st.b[0] as number) + (st.b[L] as number)) / 2;
      const px = st.x + st.nx * mid + dx * 0.3;
      const pz = st.z + st.nz * mid + dz * 0.3;
      const open = grid.near(px, pz, px, pz).some((f) => {
        const piece = fs.piece[f] as number;
        const j = fs.station[f] as number;
        if (piece === si || piece >= input.strips.length || j < 0 || !pointInFace(fs, f, px, pz)) return false;
        const ok = input.kinds[piece] as ArrayLike<number>;
        const os = input.strips[piece] as Strip;
        const lowered = (k: number): boolean => k === K_CUT || k === K_TUNNEL;
        if (!lowered(ok[j] as number) && !lowered(ok[j + 1] as number)) return false;
        return !(roofed(os.st[j] as Station, ok[j] as number) && roofed(os.st[j + 1] as Station, ok[j + 1] as number));
      });
      if (open) headwall(e, dx, dz);
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
        const beam = emitPortal(sink, st, portal);
        for (const leg of portal.legs) out.piers.push({ strip: si, station: i, ring: leg, sheet, bottom: portal.bottom, top: portal.beamBottom, portal: true, shape: 'wall', deckW: (st.b[0] as number) - (st.b[L] as number), dir: [-st.nz, st.nx] });
        out.kit.beams.push({ strip: si, station: i, ring: beam, bottom: portal.beamBottom, top: portal.top });
        out.portals++;
        joint(st);
        continue;
      }
      out.maxSpanM = Math.max(out.maxSpanM, since);
      span(i);
      since = 0;
      const bottom = st.g - 1;
      const top = st.h - DECK_DEPTH;
      const variant = input.variants?.[si];
      const shape: PierShape = variant ? (VARIANTS[variant]?.pier ?? 'wall') : 'wall';
      out.piers.push({ strip: si, station: i, ring, sheet, bottom, top, shape, deckW: (st.b[0] as number) - (st.b[L] as number), dir: [tx, tz] });
      // the collider is the kit's pier inside the ring (P2-034): every shape lies inside it, so the ring's checks hold
      for (const col of pierColumns(shape, cx, cz, st.nx, st.nz, half)) prismSides(sink, 'pier', col, bottom, top);
      joint(st);
    }
  });
  out.maxSpanM = Math.round(out.maxSpanM * 10) / 10;
  return out;
}

/** Pier columns (plan rings, counter-clockwise seen from above is not needed: prismSides orients by the centre) of a shape inside a ring of half width `half` across the deck and 0.5 m along it. */
export function pierColumns(shape: PierShape, cx: number, cz: number, nx: number, nz: number, half: number): [number, number][][] {
  const tx = -nz;
  const tz = nx;
  const rect = (c: number, w: number, along: number): [number, number][] => [
    [cx + nx * (c + w) + tx * along, cz + nz * (c + w) + tz * along], [cx + nx * (c - w) + tx * along, cz + nz * (c - w) + tz * along],
    [cx + nx * (c - w) - tx * along, cz + nz * (c - w) - tz * along], [cx + nx * (c + w) - tx * along, cz + nz * (c + w) - tz * along],
  ];
  if (shape === 'twin' && half >= 2) return [rect(half - 0.6, 0.6, 0.5), rect(-(half - 0.6), 0.6, 0.5)];
  if (shape === 'single' || shape === 'twin') return [rect(0, Math.min(half, 1.1), 0.5)];
  if (shape === 'round') {
    // an octagon in the deck's frame whose flat sides lie 0.5 m from the centre (inside the ring's 0.5 m along)
    const r = 0.5 / Math.cos(Math.PI / 8);
    return [Array.from({ length: 8 }, (_, k) => {
      const a = (k + 0.5) * (Math.PI / 4);
      return [cx + (nx * Math.cos(a) + tx * Math.sin(a)) * r, cz + (nz * Math.cos(a) + tz * Math.sin(a)) * r] as [number, number];
    })];
  }
  return [rect(0, half, 0.5)];
}

/** The side faces of a vertical prism over a plan ring, facing away from its centre. */
export function prismSides(sink: Sink, material: string, ring: readonly [number, number][], bottom: number, top: number): void {
  let cx = 0;
  let cz = 0;
  for (const [x, z] of ring) {
    cx += x / ring.length;
    cz += z / ring.length;
  }
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k] as [number, number];
    const b = ring[(k + 1) % ring.length] as [number, number];
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const len = Math.hypot(ex, ez) || 1;
    let nx = ez / len;
    let nz = -ex / len;
    if (nx * ((a[0] + b[0]) / 2 - cx) + nz * ((a[1] + b[1]) / 2 - cz) < 0) {
      nx = -nx;
      nz = -nz;
    }
    sink.quad(material, [a[0], bottom, a[1]], [b[0], bottom, b[1]], [b[0], top, b[1]], [a[0], top, a[1]], [nx, 0, nz]);
  }
}
