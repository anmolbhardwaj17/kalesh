// Whole-street lane inference (P1-012, decisions "Road prototype results (P0-019)" need 2). OSM has a lanes tag on
// under 9 percent of the pilot's ways, so a lane count taken way by way jumps up and down along one street and asks
// for tapers no road has room for (the 4 taper findings at ITO). Here a street is a chain of edges that run on into
// each other (same class, link flag, direction rule and name, within 30 degrees of straight on). Along a chain:
// an edge with a spec, a tag or a logged repair keeps its count; every other edge takes the count of the nearest such
// edge of the street (or of the street's other carriageway, or the class default); a stretch too short for the tapers
// its count would need takes the count of the street beside it. One count per edge: between two junctions the lane
// count never changes, and where it changes at a junction the narrower road widens over a taper inside the class
// limit. The cross-section of every edge comes from here: left-hand traffic, medians on the right of a paired
// carriageway, footpaths from the graph's road class, galis as one shared lane. Pure.
import type { GraphEdge } from '../graph/build.ts';
import type { HeroSpec } from './hero.ts';
import { heroCrossSection } from './hero.ts';
import { GALI_MIN_LANE_M, KERB_WIDTH, MIN_DRIVE_LANE_M, classDefaults, lane } from './model.ts';
import type { CrossSection, LaneDef } from './model.ts';

/** Classes whose narrow stretches are galis: the lane gives way to the buildings. Bigger roads keep their class lane width. */
export const GALI_CLASSES: ReadonlySet<string> = new Set(['residential', 'living_street', 'service', 'pedestrian', 'unclassified', 'road']);

export type LanesFrom = 'spec' | 'tag' | 'repair' | 'street' | 'pair' | 'corridor' | 'class' | 'fit' | 'width' | 'room';

export interface EdgeLanes {
  /** Drive lanes of the edge (both directions together on a two-way road). */
  lanes: number;
  from: LanesFrom;
  /** For a count a repair or an owner override set (from "repair"): the id of the issue or patch it came from (a mark of the repair step). */
  by?: string;
  laneWidth: number;
  gali: boolean;
  /** The street (chain) the edge belongs to. */
  street: number;
  /** The most lanes the edge may carry beside the other carriageway of its street (the repair step fitted the graph's own count). */
  cap: number;
  /** A section the width step settled on a paired carriageway keeps its right border here (WidthFixed.rightAt). */
  rightAt?: number;
}

export interface StreetGraph {
  nodes: readonly { id: string }[];
  edges: readonly GraphEdge[];
  marks?: Readonly<Record<string, Readonly<Record<string, string | number | boolean>>>>;
}

export interface StreetReport {
  streets: number;
  /** Edges by where their lane count came from. */
  from: Record<string, number>;
  /** Edges whose count differs from the graph's own (per edge) count. */
  changed: number;
  /** Roads above gali class whose width a building repair narrowed: they keep their class lane width (the building issue stays queued). */
  widthKept: number;
  galis: number;
}

export interface StreetResult {
  byEdge: Map<string, EdgeLanes>;
  /** Chains: edge ids in order along the street. */
  streets: string[][];
  report: StreetReport;
}

interface End {
  e: GraphEdge;
  atStart: boolean;
}

const dirFrom = (end: End, d = 8): { x: number; z: number } => {
  const pts = end.atStart ? end.e.pts : end.e.pts.slice().reverse();
  const p0 = pts[0] as { x: number; z: number };
  let left = Math.min(d, end.e.len / 2);
  let q = p0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1] as { x: number; z: number };
    const b = pts[i] as { x: number; z: number };
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (l >= left && l > 0) {
      q = { x: a.x + ((b.x - a.x) * left) / l, z: a.z + ((b.z - a.z) * left) / l };
      break;
    }
    left -= l;
    q = b;
  }
  const l = Math.hypot(q.x - p0.x, q.z - p0.z) || 1;
  return { x: (q.x - p0.x) / l, z: (q.z - p0.z) / l };
};

/** Taper length (m) a change of `lanes` lanes needs on a road of this class. */
export function taperNeedM(cls: string, laneWidth: number, lanes: number, oneway: boolean): number {
  const perSide = oneway ? lanes : Math.ceil(lanes / 2);
  return Math.max(10, classDefaults(cls).taper * perSide * laneWidth);
}

/** The median between two paired carriageways: two kerbs (the number rule R-LANE-FIT-01 keeps). */
const PAIR_MEDIAN_M = 0.6;

/** Smallest distance from the middle part of a's centre line to b's (the ends, where the two may meet at a junction, are left out). */
function gapBeside(a: GraphEdge, b: GraphEdge): number {
  const skip = Math.min(30, a.len / 3);
  let best = Infinity;
  let s = 0;
  for (let i = 0; i + 1 < a.pts.length; i++) {
    const p = a.pts[i] as { x: number; z: number };
    const q = a.pts[i + 1] as { x: number; z: number };
    const l = Math.hypot(q.x - p.x, q.z - p.z);
    const n = Math.max(1, Math.ceil(l / 8));
    for (let k = 0; k <= n; k++) {
      const at = s + (l * k) / n;
      if (at < skip || at > a.len - skip) continue;
      const x = p.x + ((q.x - p.x) * k) / n;
      const z = p.z + ((q.z - p.z) * k) / n;
      for (let j = 0; j + 1 < b.pts.length; j++) {
        const u = b.pts[j] as { x: number; z: number };
        const v = b.pts[j + 1] as { x: number; z: number };
        const dx = v.x - u.x;
        const dz = v.z - u.z;
        const l2 = dx * dx + dz * dz;
        const t = l2 === 0 ? 0 : ((x - u.x) * dx + (z - u.z) * dz) / l2;
        // beside b only: a point past b's ends has nothing beside it
        if (t < 0 || t > 1) continue;
        best = Math.min(best, Math.hypot(x - (u.x + dx * t), z - (u.z + dz * t)));
      }
    }
    s += l;
  }
  return best;
}

/** What a junction is expected to take from each end of an edge when the fit of a taper is judged (m). */
const CUT_ESTIMATE_M = 9;

/**
 * Lane counts for every edge. `wayLanes` is the lanes tag of every way that has one ("way/<id>"); `fixed` are counts
 * the lane model itself has settled in an earlier round (a road too short for the taper to its split zone).
 */
/** A whole edge that takes the cross-section of the road it runs on into (P1-046, netwidths.ts): too short for a taper either side. */
export interface WidthFixed {
  lanes: number;
  laneWidth: number;
  gali: boolean;
  /**
   * The right border of the section (lateral, m, as CrossSection borders) is kept here: a carriageway paired with the
   * street's other one widens on its kerb side only, so it never grows into the median and the other carriageway.
   */
  rightAt?: number;
}

export function inferStreets(g: StreetGraph, wayLanes: ReadonlyMap<string, number>, heroes: readonly HeroSpec[] = [], fixed: ReadonlyMap<string, number> = new Map(), widthFixed: ReadonlyMap<string, WidthFixed> = new Map()): StreetResult {
  const edges = g.edges.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ends = new Map<string, End[]>();
  for (const e of edges) {
    for (const atStart of [true, false]) {
      const id = atStart ? e.a : e.b;
      const list = ends.get(id);
      if (list) list.push({ e, atStart });
      else ends.set(id, [{ e, atStart }]);
    }
  }
  const same = (a: GraphEdge, b: GraphEdge): boolean => a.road.cls === b.road.cls && a.road.link === b.road.link && a.oneway === b.oneway && a.name === b.name;
  /** The end the road runs on into at the node of `end`. */
  const through = (end: End): End | null => {
    const id = end.atStart ? end.e.a : end.e.b;
    const others = (ends.get(id) ?? []).filter((o) => o.e !== end.e);
    if (end.e.a === end.e.b) return null;
    // a plain joint: the name may change there, the class and the direction rule may not
    if (others.length === 1) {
      const o = others[0] as End;
      return o.e.road.cls === end.e.road.cls && o.e.road.link === end.e.road.link && o.e.oneway === end.e.oneway ? o : null;
    }
    const d = dirFrom(end);
    const fit = others.filter((o) => {
      if (!same(o.e, end.e)) return false;
      const q = dirFrom(o);
      return d.x * q.x + d.z * q.z < -0.866;
    });
    if (fit.length === 1) return fit[0] as End;
    // a split or merge of one-way roads: the road runs on along its main line whatever the names say (a link never is it)
    if (end.e.oneway && others.length === 2 && others.every((o) => o.e.oneway)) {
      const on = others.filter((o) => o.atStart !== end.atStart && o.e.road.cls === end.e.road.cls && o.e.road.link === end.e.road.link);
      if (on.length === 1) return on[0] as End;
      if (on.length === 2) {
        const [p, q] = on.map((o) => {
          const v = dirFrom(o);
          return d.x * v.x + d.z * v.z;
        }) as [number, number];
        return (p <= q ? on[0] : on[1]) as End;
      }
    }
    return null;
  };
  const next = (end: End): End | null => {
    const t = through(end);
    if (!t || t.e === end.e) return null;
    // one-way roads run on in their direction of travel only
    if (end.e.oneway && t.atStart === end.atStart) return null;
    const back = through(t);
    return back && back.e === end.e ? t : null;
  };

  // chains
  const streetOf = new Map<string, number>();
  const streets: { e: GraphEdge; flipped: boolean }[][] = [];
  for (const e of edges) {
    if (streetOf.has(e.id)) continue;
    const chain: { e: GraphEdge; flipped: boolean }[] = [{ e, flipped: false }];
    const seen = new Set<GraphEdge>([e]);
    // forwards from the end of e, then backwards from its start
    let cur: End | null = next({ e, atStart: false });
    while (cur && !seen.has(cur.e)) {
      seen.add(cur.e);
      chain.push({ e: cur.e, flipped: !cur.atStart });
      cur = next({ e: cur.e, atStart: !cur.atStart });
    }
    cur = next({ e, atStart: true });
    while (cur && !seen.has(cur.e)) {
      seen.add(cur.e);
      chain.unshift({ e: cur.e, flipped: cur.atStart });
      cur = next({ e: cur.e, atStart: !cur.atStart });
    }
    for (const c of chain) streetOf.set(c.e.id, streets.length);
    streets.push(chain);
  }

  const heroOf = (e: GraphEdge): HeroSpec | null => {
    for (const h of heroes) {
      const ways = new Set(h.covers.osmWays.map((w) => `way/${w}`));
      if (e.pieces.every((p) => ways.has(p.way))) return h;
    }
    return null;
  };
  /** The count an edge brings itself: a spec, its tags (the share of its length that is tagged decides), a logged repair. */
  const own = (e: GraphEdge): { lanes: number; from: LanesFrom; by?: string } | null => {
    const hero = heroOf(e);
    if (hero) return { lanes: heroCrossSection(hero).lanes.filter((l) => l.type === 'drive').length, from: 'spec' };
    if (e.road.lanesFrom === 'spec') return { lanes: e.road.lanes, from: 'spec' };
    if (e.road.lanesFrom === 'ahead') {
      const by = g.marks?.[e.id]?.['by'];
      return { lanes: e.road.lanes, from: 'repair', ...(typeof by === 'string' ? { by } : {}) };
    }
    const byCount = new Map<number, number>();
    let tagged = 0;
    for (const p of e.pieces) {
      const n = wayLanes.get(p.way);
      if (n === undefined) continue;
      byCount.set(n, (byCount.get(n) ?? 0) + (p.s1 - p.s0));
      tagged += p.s1 - p.s0;
    }
    if (tagged > 0 && tagged >= 0.5 * e.len) {
      let best = e.road.lanes;
      let bestLen = -1;
      for (const [n, l] of [...byCount].sort((a, b) => a[0] - b[0])) {
        if (l > bestLen + 1e-9) {
          best = n;
          bestLen = l;
        }
      }
      return { lanes: best, from: 'tag' };
    }
    if (e.road.lanesFrom === 'tag') return { lanes: e.road.lanes, from: 'tag' };
    return null;
  };

  const byEdge = new Map<string, EdgeLanes>();
  const freeChains: number[] = [];
  streets.forEach((chain, si) => {
    const known = chain.map((c) => own(c.e));
    const mids: number[] = [];
    let s = 0;
    for (const c of chain) {
      mids.push(s + c.e.len / 2);
      s += c.e.len;
    }
    const any = known.some((k) => k !== null);
    if (!any) freeChains.push(si);
    chain.forEach((c, i) => {
      let k = known[i] ?? null;
      if (!k && any) {
        // the nearest edge of the street that knows its count; ahead wins a tie
        let best = -1;
        for (let j = 0; j < chain.length; j++) {
          if (!known[j]) continue;
          const d = Math.abs((mids[j] as number) - (mids[i] as number));
          const bd = best < 0 ? Infinity : Math.abs((mids[best] as number) - (mids[i] as number));
          if (d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && j > i && best < i)) best = j;
        }
        k = { lanes: (known[best] as { lanes: number }).lanes, from: 'street' };
      }
      if (!k) k = { lanes: c.e.road.lanes, from: 'class' };
      // a count the lane model settled itself holds for this edge only: the street beside it keeps its own
      const f = heroOf(c.e) ? undefined : fixed.get(c.e.id);
      if (f !== undefined) k = { lanes: f, from: 'fit' };
      byEdge.set(c.e.id, { lanes: k.lanes, from: k.from, ...(k.from === 'repair' && k.by ? { by: k.by } : {}), laneWidth: c.e.road.laneWidth, gali: false, street: si, cap: 12 });
    });
  });
  // a street with no count of its own takes the count of its other carriageway
  const edgeById = new Map(edges.map((e) => [e.id, e]));
  for (const si of freeChains) {
    const chain = streets[si] as { e: GraphEdge }[];
    const votes = new Map<number, number>();
    for (const c of chain) {
      for (const pid of c.e.pairedWith) {
        const p = byEdge.get(pid);
        const pe = edgeById.get(pid);
        if (!p || !pe || p.from === 'class' || p.from === 'pair' || p.from === 'fit') continue;
        votes.set(p.lanes, (votes.get(p.lanes) ?? 0) + Math.min(pe.len, c.e.len));
      }
    }
    if (votes.size === 0) continue;
    const best = [...votes].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] as [number, number];
    for (const c of chain) {
      const r = byEdge.get(c.e.id) as EdgeLanes;
      r.lanes = best[0];
      r.from = 'pair';
    }
  }

  // a street with no count of its own and no other carriageway takes the count of its corridor (P1-046): the nearest
  // edge that has one along roads that run on into each other through junctions (the same name, or the same class,
  // within 20 degrees of straight on), not a class default; and that edge's lane width, so the width carries too
  const carried = corridorCarry(edges, ends, streets, byEdge);
  for (const [id, c] of carried) {
    const r = byEdge.get(id) as EdgeLanes;
    r.lanes = c.lanes;
    r.from = 'corridor';
    r.laneWidth = c.laneWidth;
  }

  // widths: a gali's lanes give way to its width; a bigger road keeps its class lane width
  const report: StreetReport = { streets: streets.length, from: {}, changed: 0, widthKept: 0, galis: 0 };
  for (const e of edges) {
    const r = byEdge.get(e.id) as EdgeLanes;
    if (r.from === 'spec') continue;
    const narrowed = g.marks?.[e.id]?.['width_from'] === 'buildings';
    const widthGiven = e.road.widthFrom === 'tag' || narrowed;
    if (GALI_CLASSES.has(e.road.cls) && !e.road.link) {
      const width = widthGiven ? e.road.width : r.lanes * e.road.laneWidth;
      const cap = Math.max(1, Math.floor(width / MIN_DRIVE_LANE_M + 1e-9));
      if (r.lanes > cap) {
        r.lanes = cap;
        r.from = 'width';
      }
      r.laneWidth = Math.min(5, Math.max(GALI_MIN_LANE_M, width / r.lanes));
      if (r.lanes === 1 && r.laneWidth < MIN_DRIVE_LANE_M) {
        r.gali = true;
        report.galis++;
      }
    } else {
      if (narrowed) report.widthKept++;
      else if (e.road.widthFrom === 'tag') r.laneWidth = Math.min(4.5, Math.max(2.75, e.road.width / r.lanes));
      else if (r.from === 'corridor') r.laneWidth = carried.get(e.id)?.laneWidth ?? r.laneWidth;
    }
  }

  // a paired carriageway never grows into the other one: the repair step moved the two apart for the graph's own
  // counts, so a count taken from the street may only be as large as half the gap between the two centre lines allows
  for (const e of edges) {
    if (!e.pairedWith.length) continue;
    const r = byEdge.get(e.id) as EdgeLanes;
    let gap = Infinity;
    for (const pid of e.pairedWith) {
      const pe = edgeById.get(pid);
      if (pe) gap = Math.min(gap, gapBeside(e, pe));
    }
    if (!Number.isFinite(gap)) continue;
    r.cap = Math.max(e.road.lanes, Math.floor((gap - PAIR_MEDIAN_M) / r.laneWidth + 1e-9));
    if (r.from !== 'spec' && r.lanes > r.cap) {
      r.lanes = r.cap;
      r.from = 'room';
    }
  }

  // a stretch too short for the tapers its own count needs takes the count of the street beside it
  for (const chain of streets) {
    if (chain.length < 2) continue;
    for (let round = 0; round < 8; round++) {
      let moved = false;
      for (let i = 0; i < chain.length; i++) {
        const e = (chain[i] as { e: GraphEdge }).e;
        const r = byEdge.get(e.id) as EdgeLanes;
        // a spec, a width the buildings set and a count the lane model settled at a split zone stay
        if (r.from === 'spec' || r.from === 'width' || r.gali || fixed.has(e.id) || widthFixed.has(e.id)) continue;
        const prev = i > 0 ? (byEdge.get((chain[i - 1] as { e: GraphEdge }).e.id) as EdgeLanes) : null;
        const after = i + 1 < chain.length ? (byEdge.get((chain[i + 1] as { e: GraphEdge }).e.id) as EdgeLanes) : null;
        let need = 0;
        let top = r.lanes;
        for (const [o, oe] of [[prev, i > 0 ? (chain[i - 1] as { e: GraphEdge }).e : null], [after, i + 1 < chain.length ? (chain[i + 1] as { e: GraphEdge }).e : null]] as [EdgeLanes | null, GraphEdge | null][]) {
          // an extra lane the lane model gave a neighbour beside a split zone does not spread along the street
          if (!o || !oe || o.lanes <= r.lanes || o.from === 'width' || fixed.has(oe.id) || widthFixed.has(oe.id)) continue;
          need += taperNeedM(e.road.cls, r.laneWidth, o.lanes - r.lanes, e.oneway);
          top = Math.max(top, o.lanes);
        }
        if (need === 0) continue;
        const room = (e.len - 2 * CUT_ESTIMATE_M) * 0.7;
        if (need <= room) continue;
        if (Math.min(top, r.cap) <= r.lanes) continue;
        r.lanes = Math.min(top, r.cap);
        r.from = 'fit';
        moved = true;
      }
      if (!moved) break;
    }
  }
  // a whole edge the width step settled (too short for a taper on either side of a junction) takes that cross-section
  for (const e of edges) {
    const w = widthFixed.get(e.id);
    const r = byEdge.get(e.id) as EdgeLanes;
    if (!w || r.from === 'spec') continue;
    r.lanes = w.lanes;
    r.laneWidth = w.laneWidth;
    r.gali = w.gali;
    r.from = 'fit';
    if (w.rightAt !== undefined) r.rightAt = w.rightAt;
  }
  for (const e of edges) {
    const r = byEdge.get(e.id) as EdgeLanes;
    report.from[r.from] = (report.from[r.from] ?? 0) + 1;
    if (r.lanes !== e.road.lanes) report.changed++;
  }
  return { byEdge, streets: streets.map((c) => c.map((x) => x.e.id)), report };
}

/** Roads run on into each other through a junction: the same name or the same class and link flag, within this many degrees of straight on. */
export const CORRIDOR_DEG = 20;
const COS_CORRIDOR = Math.cos((CORRIDOR_DEG * Math.PI) / 180);

/**
 * The corridor step (P1-046, the owner 2026-11-13: "there won't be a 2-lane road there if it was a 3- or 4-lane road
 * above without proper merging"). Streets whose every edge has only its class default take the lane count of the
 * nearest edge with a count of its own (a spec, a tag, a repair, the street or its other carriageway)
 * along the corridor: chains joined through junctions where two ends of one corridor (the same name, or the same class
 * and link flag; both one-way or both two-way, in the direction of travel) leave within 20 degrees of straight on, each
 * end with its straightest partner. Nearest is measured along the corridor (edge lengths, Dijkstra from every edge that
 * knows its count). A street of a corridor where nothing knows a count keeps its class default.
 */
function corridorCarry(edges: readonly GraphEdge[], ends: ReadonlyMap<string, End[]>, streets: readonly { e: GraphEdge }[][], byEdge: ReadonlyMap<string, EdgeLanes>): Map<string, { lanes: number; laneWidth: number }> {
  const corridorOf = (a: GraphEdge, b: GraphEdge): boolean => (a.name !== '' && a.name === b.name) || (a.road.cls === b.road.cls && a.road.link === b.road.link);
  // links between edge ends at junction nodes: each end with its straightest partner, both ways
  const links = new Map<string, { to: string; len: number }[]>();
  const link = (a: GraphEdge, b: GraphEdge): void => {
    for (const [p, q] of [[a, b], [b, a]] as const) {
      const l = links.get(p.id);
      if (l) l.push({ to: q.id, len: q.len });
      else links.set(p.id, [{ to: q.id, len: q.len }]);
    }
  };
  const partner = (end: End): End | null => {
    const id = end.atStart ? end.e.a : end.e.b;
    const others = (ends.get(id) ?? []).filter((o) => o.e !== end.e);
    if (others.length < 2 || end.e.a === end.e.b) return null;
    const d = dirFrom(end);
    let best: End | null = null;
    let bestDot = -COS_CORRIDOR;
    for (const o of others) {
      // (a roundabout's ring runs on only into its ring)
      if (o.e.a === o.e.b || !corridorOf(o.e, end.e) || o.e.oneway !== end.e.oneway || !!o.e.roundabout !== !!end.e.roundabout) continue;
      // one-way roads run on in their direction of travel only
      if (end.e.oneway && o.atStart === end.atStart) continue;
      const q = dirFrom(o);
      const dot = d.x * q.x + d.z * q.z;
      if (dot < bestDot - 1e-9 || (best && Math.abs(dot - bestDot) <= 1e-9 && o.e.id < best.e.id)) {
        best = o;
        bestDot = dot;
      }
    }
    return best;
  };
  for (const e of edges) {
    for (const atStart of [true, false]) {
      const end = { e, atStart };
      const p = partner(end);
      if (!p) continue;
      const back = partner(p);
      // each pair once, from the end with the smaller key
      if (back?.e === e && back.atStart === atStart && `${e.id}:${atStart}` < `${p.e.id}:${p.atStart}`) link(e, p.e);
    }
  }
  // edges along their own street are neighbours too
  for (const chain of streets) {
    for (let i = 0; i + 1 < chain.length; i++) link((chain[i] as { e: GraphEdge }).e, (chain[i + 1] as { e: GraphEdge }).e);
  }
  const knows = (r: EdgeLanes): boolean => r.from !== 'class';
  // (a slip road keeps the width of its role, one wide lane by default: it takes no count from its corridor)
  const free = new Set<string>();
  for (const chain of streets) if (chain.every((c) => !knows(byEdge.get(c.e.id) as EdgeLanes))) for (const c of chain) if (!c.e.road.link) free.add(c.e.id);
  // Dijkstra from every edge that knows its count, through free edges only (a known edge is a source, never passed)
  const dist = new Map<string, number>();
  const from = new Map<string, string>();
  const heap: { d: number; id: string; src: string }[] = [];
  const push = (x: { d: number; id: string; src: string }): void => {
    heap.push(x);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const a = heap[p] as { d: number; id: string; src: string };
      if (a.d < x.d || (a.d === x.d && (a.id < x.id || (a.id === x.id && a.src <= x.src)))) break;
      heap[i] = a;
      i = p;
    }
    heap[i] = x;
  };
  const pop = (): { d: number; id: string; src: string } => {
    const top = heap[0] as { d: number; id: string; src: string };
    const last = heap.pop() as { d: number; id: string; src: string };
    if (heap.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        const lt = (u: { d: number; id: string; src: string }, v: { d: number; id: string; src: string }): boolean => u.d < v.d || (u.d === v.d && (u.id < v.id || (u.id === v.id && u.src < v.src)));
        const cur = (k: number): { d: number; id: string; src: string } => (k === i ? last : (heap[k] as { d: number; id: string; src: string }));
        if (l < heap.length && lt(heap[l] as { d: number; id: string; src: string }, cur(m))) m = l;
        if (r < heap.length && lt(heap[r] as { d: number; id: string; src: string }, cur(m))) m = r;
        if (m === i) break;
        heap[i] = heap[m] as { d: number; id: string; src: string };
        i = m;
      }
      heap[i] = last;
    }
    return top;
  };
  const byId = new Map(edges.map((e) => [e.id, e]));
  for (const e of edges) {
    const r = byEdge.get(e.id) as EdgeLanes;
    if (!knows(r) || !links.has(e.id)) continue;
    for (const n of links.get(e.id) ?? []) if (free.has(n.to)) push({ d: (e.len + n.len) / 2, id: n.to, src: e.id });
  }
  while (heap.length) {
    const x = pop();
    if (dist.has(x.id)) continue;
    dist.set(x.id, x.d);
    from.set(x.id, x.src);
    const e = byId.get(x.id) as GraphEdge;
    for (const n of links.get(x.id) ?? []) if (free.has(n.to) && !dist.has(n.to)) push({ d: x.d + (e.len + n.len) / 2, id: n.to, src: x.src });
  }
  const out = new Map<string, { lanes: number; laneWidth: number }>();
  for (const id of [...from.keys()].sort()) {
    const src = byEdge.get(from.get(id) as string) as EdgeLanes;
    const e = byId.get(id) as GraphEdge;
    // the count carries; the lane width is the road's own class width (a slip road's single wide lane, or a gali's
    // width, would make the street wider than its class lanes: where the widths still differ the width step tapers)
    out.set(id, { lanes: src.lanes, laneWidth: e.road.laneWidth });
  }
  return out;
}

/** Lane types a drawn median (add_median, P1-045) is built from: a painted divider is flat hatching, a planter is green. */
const MEDIAN_LANE: Record<string, LaneDef['type']> = { kerb: 'median', barrier: 'median', planter: 'planter', painted: 'gore' };

/** The right side of a paired carriageway: half of a drawn median, or one kerb (half of the two-kerb median). */
function medianLane(e: GraphEdge): LaneDef {
  const m = e.road.median;
  if (!m || !(m.width > 0)) return lane('median', KERB_WIDTH);
  return lane(MEDIAN_LANE[m.type] ?? 'median', Math.max(KERB_WIDTH, m.width / 2));
}

/**
 * The cross-section of an edge in its own orientation, with `lanes` drive lanes. Left-hand traffic: on a two-way road
 * the lanes left of the centre run with the edge, those right of it against it; a paired carriageway has its median
 * on the right. One lane on a two-way road is shared by both directions (dir 0).
 */
export function streetCrossSection(e: GraphEdge, r: Pick<EdgeLanes, 'laneWidth' | 'gali' | 'rightAt'>, lanes: number): CrossSection {
  const n = Math.max(1, Math.min(8, Math.round(lanes)));
  const drive: LaneDef[] = [];
  if (e.oneway) for (let i = 0; i < n; i++) drive.push(lane('drive', r.laneWidth, 1));
  else if (n === 1) drive.push(lane('drive', r.laneWidth, 0));
  else {
    const fwd = Math.ceil(n / 2);
    for (let i = 0; i < fwd; i++) drive.push(lane('drive', r.laneWidth, 1));
    for (let i = fwd; i < n; i++) drive.push(lane('drive', r.laneWidth, -1));
  }
  if (r.gali) for (const l of drive) l.tag = 'gali';
  const fl = e.road.footpath.left;
  const fr = e.road.footpath.right;
  const left: LaneDef[] = fl > 0 ? [lane('footpath', fl), lane('kerb', KERB_WIDTH)] : [lane('kerb', KERB_WIDTH)];
  const right: LaneDef[] = e.road.carriageway === 'paired' && fr <= 0 ? [medianLane(e)] : fr > 0 ? [lane('kerb', KERB_WIDTH), lane('footpath', fr)] : [lane('kerb', KERB_WIDTH)];
  const driveWidth = drive.reduce((s, l) => s + l.width, 0);
  const all = [...left, ...drive, ...right];
  // a section that keeps its right border (a paired carriageway that widened on its kerb side, P1-046)
  if (r.rightAt !== undefined) return { lanes: all, offset: r.rightAt + all.reduce((s, l) => s + l.width, 0) };
  return { lanes: all, offset: driveWidth / 2 + left.reduce((s, l) => s + l.width, 0) };
}

export const driveCount = (cs: CrossSection): number => cs.lanes.filter((l) => l.type === 'drive').length;
