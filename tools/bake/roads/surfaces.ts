// Lane surfaces on each other, back to the repair layer (P1-033). The repair rules read the graph: a centre line and
// one width per edge. The lane model builds wider than that in places the rules cannot see: a hero road with its full
// cross-section (parking and footpaths beside the carriageway), a split zone that carries both branches' lanes, a
// street whose inferred lane count is above its graph width. Where two strips of the model lie on each other there,
// this step names the two graph edges, where, and how far apart their centre lines must be (the distance they keep
// now plus the depth of the overlap); rule R-LANE-06 moves them apart and the model is built again (main.ts repair
// step). Pairs this step cannot hand back: two strips of one edge, roads on each other within 30 m of a node they
// share (a junction holds them, junction.ts clearCuts; further out they are two roads drawn too close, P1-042), roads
// that cross at an angle (a crossing, not a road alongside). Pure.
import { pointSegment } from '../geom.ts';
import type { P2 } from '../geom.ts';
import type { GraphEdge } from '../graph/build.ts';
import type { Station, Strip } from './model.ts';
import type { LaneBuild } from './netctx.ts';
import type { StripOverlap } from './overlap.ts';

/** Two graph edges whose lane surfaces lie on each other: their centre lines must keep `minSep` near (x, z). */
export interface LaneConflict {
  a: string;
  b: string;
  /** The OSM ways of each edge: a later repair run may have cut or joined the edge under another id. */
  waysA: string[];
  waysB: string[];
  x: number;
  z: number;
  /** Centre line distance needed near the point (m): what they keep now plus the overlap depth and a margin. */
  minSep: number;
  /** An edge that must stay (a hero road): the other one takes the whole move. */
  hold: string | null;
  /** Area of the overlap in the lane model (m2), for the report. */
  areaM2: number;
}

/** Strips within this angle of each other run alongside; at a wider angle they cross. */
export const CONFLICT_COS = Math.cos((35 * Math.PI) / 180);
/** Extra separation on top of the measured overlap depth (m). */
export const CONFLICT_MARGIN_M = 0.15;

/** Two roads that share a node are handed back only for surfaces on each other this far from it (m): where a side shift is whole (rules/beside.ts blendLength). */
export const SHARED_NODE_REACH_M = 30;

/** Nearest point of a polyline. */
function projectOn(p: P2, pts: readonly P2[]): { d: number; x: number; z: number } {
  let best = { d: Infinity, x: p.x, z: p.z };
  for (let i = 0; i + 1 < pts.length; i++) {
    const c = pointSegment(p, pts[i] as P2, pts[i + 1] as P2);
    if (c.d < best.d) best = { d: c.d, x: c.x, z: c.z };
  }
  return best;
}

const lateral = (st: Station, p: readonly [number, number]): number => (p[0] - st.x) * st.nx + (p[1] - st.z) * st.nz;

export function laneConflicts(build: LaneBuild, overlaps: readonly StripOverlap[]): { conflicts: LaneConflict[]; skipped: Record<string, number> } {
  const source = build.road.source;
  const byId = new Map(source.map((e) => [e.id, e]));
  const nodeAt = new Map<string, P2>();
  for (const e of source) {
    nodeAt.set(e.a, e.pts[0] as P2);
    nodeAt.set(e.b, e.pts[e.pts.length - 1] as P2);
  }
  // the graph edge a strip stands for: its own, or for a zone the branch whose centre line is nearest to the point
  const zoneOf = new Map<number, number>();
  build.zoneStrips.forEach((s, k) => zoneOf.set(s, k));
  const edgeOf = (strip: number, at: P2): GraphEdge | null => {
    const s = build.strips[strip] as Strip;
    if (s.kind !== 'zone') return byId.get(s.edge) ?? null;
    const z = build.zones[zoneOf.get(strip) ?? -1];
    if (!z) return null;
    const cands = [z.left.edge, z.right.edge].map((i) => source[i] as GraphEdge);
    let best: GraphEdge | null = null;
    let bestD = Infinity;
    for (const e of cands) {
      const d = projectOn(at, e.pts).d;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  };
  interface Acc {
    sa: number;
    sb: number;
    area: number;
    depth: number;
    cx: number;
    cz: number;
    cos: number;
  }
  const pairs = new Map<string, Acc>();
  for (const o of overlaps) {
    const key = `${o.a.strip}|${o.b.strip}`;
    const sa = build.strips[o.a.strip] as Strip;
    const sb = build.strips[o.b.strip] as Strip;
    const pa = sa.st[o.a.quad] as Station;
    const pb = sb.st[o.b.quad] as Station;
    // how deep the two surfaces lie on each other: the overlap's width across the first strip
    let lo = Infinity;
    let hi = -Infinity;
    let cx = 0;
    let cz = 0;
    for (const p of o.poly) {
      const l = lateral(pa, p);
      lo = Math.min(lo, l);
      hi = Math.max(hi, l);
      cx += p[0] / o.poly.length;
      cz += p[1] / o.poly.length;
    }
    const acc = pairs.get(key) ?? { sa: o.a.strip, sb: o.b.strip, area: 0, depth: 0, cx: 0, cz: 0, cos: 1 };
    acc.cx = (acc.cx * acc.area + cx * o.area) / (acc.area + o.area);
    acc.cz = (acc.cz * acc.area + cz * o.area) / (acc.area + o.area);
    acc.area += o.area;
    acc.depth = Math.max(acc.depth, hi - lo);
    acc.cos = Math.min(acc.cos, Math.abs(pa.nx * pb.nx + pa.nz * pb.nz));
    pairs.set(key, acc);
  }
  const skipped: Record<string, number> = {};
  const skip = (why: string): void => {
    skipped[why] = (skipped[why] ?? 0) + 1;
  };
  const merged = new Map<string, LaneConflict>();
  for (const acc of [...pairs.values()].sort((p, q) => p.sa - q.sa || p.sb - q.sb)) {
    const at = { x: acc.cx, z: acc.cz };
    const ea = edgeOf(acc.sa, at);
    const eb = edgeOf(acc.sb, at);
    if (!ea || !eb) {
      skip('no graph edge');
      continue;
    }
    if (ea === eb) {
      skip('one edge');
      continue;
    }
    // roads that share a node: the junction there holds them as far as its cuts reach (clearCuts, 45 percent of a long
    // edge at most). Surfaces on each other further out than a shift fades at an end are two roads drawn too close
    const shared = [ea.a, ea.b].filter((n) => n === eb.a || n === eb.b).map((n) => nodeAt.get(n) as P2);
    if (shared.some((n) => Math.hypot(n.x - at.x, n.z - at.z) < SHARED_NODE_REACH_M)) {
      skip('shared node');
      continue;
    }
    if (acc.cos < CONFLICT_COS) {
      skip('crossing');
      continue;
    }
    // the distance the two centre lines keep near the point now
    const qa = projectOn(at, ea.pts);
    const d = projectOn({ x: qa.x, z: qa.z }, eb.pts).d;
    const sa = build.strips[acc.sa] as Strip;
    const sb = build.strips[acc.sb] as Strip;
    const [x, y] = ea.id < eb.id ? [ea, eb] : [eb, ea];
    const heroOf = (e: GraphEdge): boolean => (e === ea ? sa.hero !== null : sb.hero !== null);
    const hold = heroOf(x) && !heroOf(y) ? x.id : heroOf(y) && !heroOf(x) ? y.id : null;
    const ways = (e: GraphEdge): string[] => [...new Set(e.pieces.map((p) => p.way))].sort();
    const c: LaneConflict = { a: x.id, b: y.id, waysA: ways(x), waysB: ways(y), x: r2(at.x), z: r2(at.z), minSep: r2(d + acc.depth + CONFLICT_MARGIN_M), hold, areaM2: r2(acc.area) };
    const key = `${x.id}|${y.id}`;
    const prev = merged.get(key);
    if (!prev) merged.set(key, c);
    else if (c.minSep > prev.minSep) merged.set(key, { ...c, areaM2: r2(prev.areaM2 + c.areaM2) });
    else prev.areaM2 = r2(prev.areaM2 + c.areaM2);
  }
  return { conflicts: [...merged.values()].sort((p, q) => (p.a < q.a ? -1 : p.a > q.a ? 1 : p.b < q.b ? -1 : p.b > q.b ? 1 : 0)), skipped };
}

const r2 = (v: number): number => Math.round(v * 100) / 100 + 0;
