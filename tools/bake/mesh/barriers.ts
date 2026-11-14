// Bollards and gates where the access changes (P2-042): lines of posts across a carriageway, with colliders (the tile
// colliders take the `bollard` material), so a car stops where cars stop in reality and walkers, cycles and rickshaws
// pass between the posts. Two sources:
//   transition  where a road open to cars meets a way the access model closes with bollards (a rule of
//               harness/data/access.json with barrier bollards, or an OSM access=no or motor_vehicle=no tag): a line
//               across the closed way 1.5 m inside its strip, at that junction or joint;
//   osm         a barrier node of OSM on the road (bollard, block, gate, lift gate): a line of posts, a closed gate
//               (posts and a bar) or an open gate (two pillars beside the carriageway), where the node stands.
// Gali entries closed only by width or context get nothing: driving in is a violation, not a wall (the owner's rule).
// Pure: the lane build with its solved heights in, placements and one mesh out.
import type { P2 } from '../geom.ts';
import type { EdgeAccess } from '../graph/access.ts';
import { barrierStops } from '../graph/access.ts';
import type { BarrierFeature } from '../graph/features.ts';
import type { LaneDef, Station, Strip, StripEnd } from '../roads/model.ts';
import type { SourceMesh } from '../tile/cutter.ts';

/** Post centres no further apart than this (m): with 0.22 m posts the gap is under 1.3 m, too narrow for a car (1.7 m). */
export const POST_SPACING_M = 1.5;
/** Post radius, height over the road and depth into it (m). */
export const POST_R = 0.11;
export const POST_H = 0.95;
const SINK = 0.15;
/** The first and last post stand this far inside the carriageway edge (m): the gap to the kerb is under 0.5 m. */
export const POST_INSET_M = 0.6;
/** A transition line stands this far inside the closed strip from its end at the junction (m). */
export const LINE_INSIDE_M = 1.5;
/** The widest gap a car-stopping line may leave (m). */
export const MAX_GAP_M = 1.3;
const CARRIAGEWAY: ReadonlySet<LaneDef['type']> = new Set(['drive', 'parking', 'gore']);

export type BarrierKind = 'bollards' | 'gate_closed' | 'gate_open';

export interface BarrierPlacement {
  id: string;
  kind: BarrierKind;
  source: 'transition' | 'osm';
  /** The access rule (transition) or the OSM node (osm). */
  ref: string;
  edge: string;
  strip: string;
  /** Block metres of the line's middle, the road height there and the line's direction along the road (unit). */
  x: number;
  z: number;
  y: number;
  dir: [number, number];
  /** Carriageway width the line spans (m), posts, the widest gap between posts or to a kerb (m). */
  widthM: number;
  posts: [number, number][];
  maxGapM: number;
  stopsCar: boolean;
}

export interface BarriersRecord {
  lines: number;
  posts: number;
  triangles: number;
  bySource: Record<string, number>;
  byKind: Record<string, number>;
  byRule: Record<string, number>;
  /** The widest gap of a car-stopping line (m): under MAX_GAP_M. */
  maxGapM: number;
  /** Junctions and joints where a car road meets a way closed with bollards and no line could be placed. */
  missing: { at: string; edge: string; why: string }[];
  /** OSM barrier nodes on the road that got no placement (no strip at that place: inside a junction). */
  osmUnplaced: string[];
  file: string | null;
}

export interface BarrierInput {
  strips: readonly Strip[];
  joints: readonly { a: { strip: number; end: StripEnd }; b: { strip: number; end: StripEnd } }[];
  junctions: readonly { id: string; arms: readonly { strip: number; end: StripEnd; stopBack?: number; crossing?: boolean }[] }[];
  access: ReadonlyMap<string, EdgeAccess>;
  osm: readonly BarrierFeature[];
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;

/** The frame of a strip at `d` metres from one end, interpolated between its stations. */
export function frameAt(s: Strip, end: StripEnd, d: number): { st: Station; dir: [number, number] } | null {
  const st = end === 'start' ? s.st : s.st.slice().reverse();
  if (st.length < 2) return null;
  let acc = 0;
  for (let i = 1; i < st.length; i++) {
    const a = st[i - 1] as Station;
    const b = st[i] as Station;
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (acc + l >= d || i === st.length - 1) {
      const t = l > 0 ? Math.max(0, Math.min(1, (d - acc) / l)) : 0;
      const mix = (p: number, q: number): number => p + (q - p) * t;
      const nx = mix(a.nx, b.nx);
      const nz = mix(a.nz, b.nz);
      const nl = Math.hypot(nx, nz) || 1;
      // the frame keeps the strip's own left (station order), whichever end it was measured from
      const f: Station = { ...a, x: mix(a.x, b.x), z: mix(a.z, b.z), nx: nx / nl, nz: nz / nl, s: mix(a.s, b.s), h: mix(a.h, b.h), g: mix(a.g, b.g), b: a.b.map((v, k) => mix(v, b.b[k] as number)) };
      const dx = (s.st[s.st.length - 1] as Station).x - (s.st[0] as Station).x;
      const dz = (s.st[s.st.length - 1] as Station).z - (s.st[0] as Station).z;
      const dl = Math.hypot(dx, dz) || 1;
      return { st: f, dir: [dx / dl, dz / dl] };
    }
    acc += l;
  }
  return null;
}

/** Lateral runs of carriageway lanes (drive, parking, gore) at a station: [left border, right border] pairs. */
export function carriagewayRuns(lanes: readonly LaneDef[], b: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let k = 0; k <= lanes.length; k++) {
    const on = k < lanes.length && CARRIAGEWAY.has((lanes[k] as LaneDef).type) && (b[k] as number) - (b[k + 1] as number) > 0.05;
    if (on && start < 0) start = k;
    if (!on && start >= 0) {
      out.push([b[start] as number, b[k] as number]);
      start = -1;
    }
  }
  return out;
}

/** Post offsets across one run (left to right): evenly spaced, POST_INSET_M inside each edge, at most POST_SPACING_M apart. */
export function postOffsets(left: number, right: number): number[] {
  const w = left - right;
  if (w <= 2 * POST_INSET_M) return [(left + right) / 2];
  const span = w - 2 * POST_INSET_M;
  const n = Math.max(2, Math.ceil(span / POST_SPACING_M) + 1);
  return Array.from({ length: n }, (_, i) => left - POST_INSET_M - (span * i) / (n - 1));
}

/** The widest gap a line of posts leaves across its runs (between posts, and from the outer posts to the edges). */
export function widestGap(runs: readonly [number, number][], offsets: readonly number[][]): number {
  let g = 0;
  runs.forEach(([l, r], i) => {
    const o = offsets[i] ?? [];
    if (!o.length) return;
    g = Math.max(g, l - (o[0] as number) - POST_R, (o[o.length - 1] as number) - r - POST_R);
    for (let k = 1; k < o.length; k++) g = Math.max(g, (o[k - 1] as number) - (o[k] as number) - 2 * POST_R);
  });
  return r3(g);
}

class Tris {
  readonly pos: number[] = [];
  readonly nrm: number[] = [];
  count = 0;
  /** One triangle; wound for Godot (front faces clockwise seen from the side the normal points to). */
  add(a: readonly number[], b: readonly number[], c: readonly number[], n: readonly number[]): void {
    const ux = (b[0] as number) - (a[0] as number);
    const uy = (b[1] as number) - (a[1] as number);
    const uz = (b[2] as number) - (a[2] as number);
    const vx = (c[0] as number) - (a[0] as number);
    const vy = (c[1] as number) - (a[1] as number);
    const vz = (c[2] as number) - (a[2] as number);
    const facing = (uy * vz - uz * vy) * (n[0] as number) + (uz * vx - ux * vz) * (n[1] as number) + (ux * vy - uy * vx) * (n[2] as number);
    for (const p of facing > 0 ? [a, c, b] : [a, b, c]) {
      this.pos.push(p[0] as number, p[1] as number, p[2] as number);
      this.nrm.push(n[0] as number, n[1] as number, n[2] as number);
    }
    this.count++;
  }
  /** A convex prism over a ring (block metres) from y0 to y1, with a top. */
  prism(ring: readonly P2[], y0: number, y1: number): void {
    const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length;
    const cz = ring.reduce((s, p) => s + p.z, 0) / ring.length;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i] as P2;
      const q = ring[(i + 1) % ring.length] as P2;
      let nx = q.z - p.z;
      let nz = -(q.x - p.x);
      const l = Math.hypot(nx, nz) || 1;
      nx /= l;
      nz /= l;
      if (nx * ((p.x + q.x) / 2 - cx) + nz * ((p.z + q.z) / 2 - cz) < 0) {
        nx = -nx;
        nz = -nz;
      }
      this.add([p.x, y0, p.z], [q.x, y0, q.z], [q.x, y1, q.z], [nx, 0, nz]);
      this.add([p.x, y0, p.z], [q.x, y1, q.z], [p.x, y1, p.z], [nx, 0, nz]);
    }
    const c = [cx, y1, cz];
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i] as P2;
      const q = ring[(i + 1) % ring.length] as P2;
      this.add(c, [p.x, y1, p.z], [q.x, y1, q.z], [0, 1, 0]);
    }
  }
}

const octagon = (x: number, z: number, r: number): P2[] => Array.from({ length: 8 }, (_, i) => ({ x: x + r * Math.cos((i * Math.PI) / 4 + Math.PI / 8), z: z + r * Math.sin((i * Math.PI) / 4 + Math.PI / 8) }));
const box = (a: P2, b: P2, half: number): P2[] => {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l = Math.hypot(dx, dz) || 1;
  const nx = (-dz / l) * half;
  const nz = (dx / l) * half;
  return [{ x: a.x + nx, z: a.z + nz }, { x: b.x + nx, z: b.z + nz }, { x: b.x - nx, z: b.z - nz }, { x: a.x - nx, z: a.z - nz }];
};

/** A planned transition line: on which strip end, how far inside, for which rule, at which junction or joint. */
export interface TransitionLine {
  strip: number;
  end: StripEnd;
  d: number;
  ref: string;
  at: string;
  /** closed: across the closed way at its entry; mouth: across a car road's mouth onto a closed street that runs through. */
  side: 'closed' | 'mouth';
}

/** Unit direction of a strip leaving its end (pointing away from the junction). */
function awayFrom(s: Strip, end: StripEnd): [number, number] | null {
  if (s.st.length < 2) return null;
  const a = (end === 'start' ? s.st[0] : s.st[s.st.length - 1]) as Station;
  const b = (end === 'start' ? s.st[Math.min(3, s.st.length - 1)] : s.st[Math.max(0, s.st.length - 4)]) as Station;
  const l = Math.hypot(b.x - a.x, b.z - a.z);
  return l > 0 ? [(b.x - a.x) / l, (b.z - a.z) / l] : null;
}

/**
 * The transition lines of a lane build (P2-042), pure and shared by the barrier mesh and the lane graph (laneout.ts:
 * no car path crosses a line). At a junction with an arm open to cars and arms closed with bollards:
 * - where the closed way runs through the junction (two closed arms of one rule leave it in opposite directions, the
 *   middle of Chandni Chowk), the line goes across each car arm's mouth: cars cannot enter, the closed street stays
 *   open from end to end for walkers and rickshaws;
 * - else (the closed way starts here: the ends of Chandni Chowk, Kartavya Path at the hexagon) the line goes across
 *   each closed arm, at its entry.
 * At a joint where a car road runs on into a closed way, the line goes across the closed way.
 */
export function transitionLines(input: Pick<BarrierInput, 'strips' | 'joints' | 'junctions' | 'access'>): TransitionLine[] {
  const { strips, access } = input;
  const out: TransitionLine[] = [];
  const accOf = (si: number): EdgeAccess | undefined => {
    const s = strips[si];
    return s ? access.get(s.edge) : undefined;
  };
  const closed = (si: number): boolean => {
    const a = accOf(si);
    return !!a && !a.modes.includes('car') && a.barrier === 'bollards';
  };
  const car = (si: number): boolean => accOf(si)?.modes.includes('car') === true;
  const refOf = (si: number): string => accOf(si)?.rule ?? `osm_tag:${(strips[si] as Strip).edge}`;
  for (const j of input.junctions) {
    if (!j.arms.some((a) => car(a.strip)) || !j.arms.some((a) => closed(a.strip))) continue;
    const shut = j.arms.filter((a) => closed(a.strip));
    let through = false;
    for (let i = 0; i < shut.length && !through; i++) {
      for (let k = i + 1; k < shut.length && !through; k++) {
        const a = shut[i] as (typeof shut)[number];
        const b = shut[k] as (typeof shut)[number];
        if (refOf(a.strip) !== refOf(b.strip)) continue;
        const da = awayFrom(strips[a.strip] as Strip, a.end);
        const db = awayFrom(strips[b.strip] as Strip, b.end);
        if (da && db && da[0] * db[0] + da[1] * db[1] < -0.7) through = true;
      }
    }
    const ref = refOf((shut[0] as (typeof shut)[number]).strip);
    for (const a of through ? j.arms.filter((x) => car(x.strip)) : shut) {
      // past a zebra at the mouth, never on it
      const d = a.crossing && (a.stopBack ?? 0) > 0 ? (a.stopBack as number) + 0.8 : LINE_INSIDE_M;
      out.push({ strip: a.strip, end: a.end, d, ref: through ? ref : refOf(a.strip), at: j.id, side: through ? 'mouth' : 'closed' });
    }
  }
  for (const j of input.joints) {
    for (const [x, y] of [[j.a, j.b], [j.b, j.a]] as const) {
      const sx = strips[x.strip];
      const sy = strips[y.strip];
      if (!sx || !sy || sx.edge === sy.edge || !closed(x.strip) || !car(y.strip)) continue;
      out.push({ strip: x.strip, end: x.end, d: LINE_INSIDE_M, ref: refOf(x.strip), at: `joint ${sx.id}|${sy.id}`, side: 'closed' });
    }
  }
  return out;
}

/** Every barrier line and the one mesh of all posts, bars and pillars (material `bollard`), in block metres. */
export function placeBarriers(input: BarrierInput): { placements: BarrierPlacement[]; mesh: SourceMesh | null; record: BarriersRecord } {
  const { strips } = input;
  const placements: BarrierPlacement[] = [];
  const missing: BarriersRecord['missing'] = [];
  const done = new Set<string>();
  const tris = new Tris();
  const line = (si: number, end: StripEnd, d: number, kind: BarrierKind, source: BarrierPlacement['source'], ref: string, stopsCar: boolean): boolean => {
    const s = strips[si] as Strip;
    const key = `${si}:${end}:${kind}:${Math.round(d)}`;
    if (done.has(key)) return true;
    let len = 0;
    for (let i = 1; i < s.st.length; i++) len += Math.hypot((s.st[i] as Station).x - (s.st[i - 1] as Station).x, (s.st[i] as Station).z - (s.st[i - 1] as Station).z);
    const f = frameAt(s, end, Math.min(d, len / 2));
    if (!f) return false;
    const runs = carriagewayRuns(s.lanes, f.st.b);
    if (!runs.length) return false;
    done.add(key);
    const at = (lat: number): P2 => ({ x: f.st.x + f.st.nx * lat, z: f.st.z + f.st.nz * lat });
    const y0 = f.st.h - SINK;
    const posts: [number, number][] = [];
    let offsets: number[][];
    if (kind === 'gate_open') {
      // two pillars just outside the carriageway's outer edges
      const l = (runs[0] as [number, number])[0];
      const r = (runs[runs.length - 1] as [number, number])[1];
      offsets = [[l + 0.35, r - 0.35]];
      for (const o of offsets[0] as number[]) {
        const p = at(o);
        tris.prism(box({ x: p.x - f.dir[0] * 0.22, z: p.z - f.dir[1] * 0.22 }, { x: p.x + f.dir[0] * 0.22, z: p.z + f.dir[1] * 0.22 }, 0.22), y0, f.st.h + 1.8);
        posts.push([r3(p.x), r3(p.z)]);
      }
    } else {
      offsets = runs.map(([l, r]) => postOffsets(l, r));
      for (const o of offsets.flat()) {
        const p = at(o);
        tris.prism(octagon(p.x, p.z, POST_R), y0, f.st.h + POST_H);
        posts.push([r3(p.x), r3(p.z)]);
      }
      if (kind === 'gate_closed') {
        for (const [l, r] of runs) tris.prism(box(at(l - 0.1), at(r + 0.1), 0.05), f.st.h + 0.85, f.st.h + 0.97);
      }
    }
    const width = runs.reduce((w, [l, r]) => w + (l - r), 0);
    const mid = at((((runs[0] as [number, number])[0]) + ((runs[runs.length - 1] as [number, number])[1])) / 2);
    placements.push({
      id: `bar_${placements.length}`, kind, source, ref, edge: s.edge, strip: s.id, x: r3(mid.x), z: r3(mid.z), y: r3(f.st.h), dir: [r3(f.dir[0]), r3(f.dir[1])],
      widthM: r3(width), posts, maxGapM: kind === 'gate_open' ? r3(width) : kind === 'gate_closed' ? 0 : widestGap(runs, offsets), stopsCar,
    });
    return true;
  };
  // transitions: where a road open to cars meets a way closed with bollards (transitionLines)
  for (const t of transitionLines(input)) {
    const s = strips[t.strip] as Strip;
    if (!line(t.strip, t.end, t.d, 'bollards', 'transition', t.ref, true)) missing.push({ at: t.at, edge: s.edge, why: 'no carriageway on the strip end' });
  }
  // OSM barrier nodes on the road, where they stand
  const unplaced: string[] = [];
  const byEdge = new Map<string, number[]>();
  strips.forEach((s, i) => (byEdge.get(s.edge) ?? byEdge.set(s.edge, []).get(s.edge) as number[]).push(i));
  for (const b of input.osm) {
    if (b.edge === undefined || b.s === undefined) continue;
    const st = barrierStops(b.kind, b.tags);
    const kind: BarrierKind = /gate/.test(b.kind) && !b.kind.includes('bollard') ? (st.car ? 'gate_closed' : 'gate_open') : 'bollards';
    let placed = false;
    for (const si of byEdge.get(b.edge) ?? []) {
      const s = strips[si] as Strip;
      const s0 = Math.min((s.st[0] as Station).s, (s.st[s.st.length - 1] as Station).s);
      const s1 = Math.max((s.st[0] as Station).s, (s.st[s.st.length - 1] as Station).s);
      if (b.s < s0 || b.s > s1) continue;
      // distance from the strip's start along its stations (s grows or falls with the station order)
      const fromStart = Math.abs(b.s - (s.st[0] as Station).s);
      placed = line(si, 'start', fromStart, kind, 'osm', b.id, kind !== 'gate_open');
      break;
    }
    if (!placed) unplaced.push(b.id);
  }
  const mesh: SourceMesh | null = tris.count ? { material: 'bollard', pos: tris.pos, nrm: tris.nrm, uv: [], uv2: [], idx: Array.from({ length: tris.count * 3 }, (_, i) => i) } : null;
  const count = (key: (p: BarrierPlacement) => string): Record<string, number> => {
    const o: Record<string, number> = {};
    for (const p of placements) o[key(p)] = (o[key(p)] ?? 0) + 1;
    return o;
  };
  return {
    placements, mesh,
    record: {
      lines: placements.length, posts: placements.reduce((n, p) => n + p.posts.length, 0), triangles: tris.count, bySource: count((p) => p.source), byKind: count((p) => p.kind),
      byRule: count((p) => (p.source === 'transition' ? p.ref : 'osm node')), maxGapM: placements.filter((p) => p.stopsCar && p.kind === 'bollards').reduce((g, p) => Math.max(g, p.maxGapM), 0),
      missing, osmUnplaced: unplaced, file: null,
    },
  };
}
