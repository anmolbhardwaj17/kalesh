// Lane rules (R-LANE) on the block graph, before the lane model builds strips: lane continuity through every split
// and merge, a short piece that would need two tapers back to back, two carriageways of a street that touch, a gore at
// every diverge; and the lane fit rules from the road bench (R-LANE-FIT): carriageways drawn closer than their lanes
// are wide (shifted apart), a slip road drawn as a short diagonal (redrawn beside its main line), and a class-default
// lane count beside a tagged one (taken from the road ahead). OSM centre lines are not lane accurate. Pure.
import type { P2 } from '../geom.ts';
import type { GraphEdge, GraphNode, GraphPair } from '../graph/build.ts';
import { PAIR_GAP } from '../graph/pairs.ts';
import { NOSE_GAP, classDefaults } from '../roads/model.ts';
import { besidePairs, blendLength, densify } from './beside.ts';
import { byId, leftOf, projectOn, r2, r3, sameLevel } from './context.ts';
import type { End, Rule, RuleContext } from './context.ts';
import { taperNeed } from './roads.ts';
import { patchOf } from './types.ts';
import type { Issue } from './types.ts';

export { blendLength, densify } from './beside.ts';

export interface Split {
  node: GraphNode;
  kind: 'diverge' | 'merge';
  /** The one-way road before a diverge or after a merge. */
  single: End;
  /** The branch that runs straight on, and the one that leaves or joins. */
  main: End;
  minor: End;
}

/** Every node where one one-way road becomes two, or two become one, on one level. */
export function splits(ctx: RuleContext): Split[] {
  const cached = ctx.cache.get('splits') as Split[] | undefined;
  if (cached) return cached;
  const out: Split[] = [];
  for (const node of ctx.graph.nodes) {
    const ends = ctx.ends.get(node.id) ?? [];
    if (ends.length !== 3 || ends.some((e) => !e.edge.oneway || e.edge.a === e.edge.b)) continue;
    const lv = ctx.endLevel(ends[0]!);
    if (ends.some((e) => !sameLevel(ctx.endLevel(e), lv))) continue;
    const outs = ends.filter((e) => e.atStart);
    const ins = ends.filter((e) => !e.atStart);
    const kind = ins.length === 1 && outs.length === 2 ? 'diverge' : ins.length === 2 && outs.length === 1 ? 'merge' : null;
    if (!kind) continue;
    const single = (kind === 'diverge' ? ins[0] : outs[0])!;
    const [p, q] = (kind === 'diverge' ? outs : ins) as [End, End];
    const ds = ctx.dirFrom(single);
    const straight = (e: End): number => {
      const d = ctx.dirFrom(e);
      return ds.x * d.x + ds.z * d.z;
    };
    let main = p;
    let minor = q;
    if (p.edge.road.link !== q.edge.road.link ? p.edge.road.link : straight(p) > straight(q)) [main, minor] = [q, p];
    out.push({ node, kind, single, main, minor });
  }
  ctx.cache.set('splits', out);
  return out;
}

/** The line of a road from the node of `end` outwards, running on through the nodes it passes, for up to `max` metres. */
export function lineFrom(ctx: RuleContext, end: End, max: number): { pts: P2[]; len: number } {
  const oriented = (e: End): P2[] => (e.atStart ? e.edge.pts : e.edge.pts.slice().reverse());
  const pts = oriented(end).slice();
  let len = end.edge.len;
  let far = ctx.otherEnd(end);
  const seen = new Set<GraphEdge>([end.edge]);
  while (len < max) {
    const next = ctx.through(far);
    if (!next || seen.has(next.edge)) break;
    seen.add(next.edge);
    pts.push(...oriented(next).slice(1));
    len += next.edge.len;
    far = ctx.otherEnd(next);
  }
  return { pts, len };
}

/** The point d metres along a line. */
function along(pts: readonly P2[], d: number): P2 {
  let left = d;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i] as P2;
    const b = pts[i + 1] as P2;
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= l && l > 0) return { x: a.x + ((b.x - a.x) * left) / l, z: a.z + ((b.z - a.z) * left) / l };
    left -= l;
  }
  return pts[pts.length - 1] as P2;
}
const mid = (e: GraphEdge): P2 => e.pts[Math.floor(e.pts.length / 2)] as P2;
/** One street running on: the same class, link flag, direction rule and name. */
const sameStreet = (a: GraphEdge, b: GraphEdge): boolean => a.road.cls === b.road.cls && a.road.link === b.road.link && a.oneway === b.oneway && a.name === b.name;

export const laneContinuity: Rule = {
  id: 'R-LANE-01',
  area: 'lanes',
  title: 'Lane count does not carry through a split or merge',
  confidence: 0.7,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const s of splits(ctx)) {
      const one = s.single.edge.road.lanes;
      const main = s.main.edge.road.lanes;
      const sum = main + s.minor.edge.road.lanes;
      // a lane may start or end at the nose (3 lanes become 3 and 1), but none appears on the main line and none is lost
      const appears = s.kind === 'diverge' ? main > one : one > sum;
      const lost = s.kind === 'diverge' ? sum < one : one < main;
      if (!appears && !lost) continue;
      const fix = s.kind === 'diverge' ? s.main.edge : s.single.edge;
      const lanes = s.kind === 'diverge' ? (appears ? one : one - s.minor.edge.road.lanes) : appears ? sum : main;
      const what = s.kind === 'diverge' ? `${one} lanes split into ${main} and ${s.minor.edge.road.lanes}` : `${main} and ${s.minor.edge.road.lanes} lanes merge into ${one}`;
      out.push(ctx.issue(laneContinuity, s.node, [s.single.edge.id, s.main.edge.id, s.minor.edge.id, s.node.id], [s.single.edge, s.main.edge, s.minor.edge], 0.7, what, [
        ctx.proposal('set_lanes', { on: fix.id, lanes: Math.max(1, lanes), from: 'split' }, 0.7, { kind: 'lane_count', cls: fix.road.cls }, `${what}: a lane ${appears ? 'appears from nowhere' : 'is lost'} at the ${s.kind}. ${fix.id} takes ${Math.max(1, lanes)} lanes so every lane has a successor`, fix.pts),
      ]));
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};

export const doubleTaper: Rule = {
  id: 'R-LANE-02',
  area: 'lanes',
  title: 'Short piece that needs two tapers back to back',
  confidence: 0.75,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const e of ctx.graph.edges) {
      const before = ctx.through({ edge: e, atStart: true });
      const after = ctx.through({ edge: e, atStart: false });
      if (!before || !after || !sameStreet(before.edge, e) || !sameStreet(after.edge, e)) continue;
      const lb = before.edge.road.lanes;
      const la = after.edge.road.lanes;
      if (lb === e.road.lanes || la === e.road.lanes) continue;
      const need = taperNeed(e.road.cls, e.road.laneWidth, Math.abs(lb - e.road.lanes)) + taperNeed(e.road.cls, e.road.laneWidth, Math.abs(la - e.road.lanes));
      if (need <= e.len) continue;
      const lanes = Math.max(lb, la);
      out.push(ctx.issue(doubleTaper, mid(e), [e.id], [e, before.edge, after.edge], 0.75, `${lb}, ${e.road.lanes}, ${la} lanes along one street; the ${Math.round(e.len)} m piece needs ${Math.round(need)} m of taper`, [
        ctx.proposal('set_lanes', { on: e.id, lanes, from: 'ahead' }, 0.75, { kind: 'lane_count', cls: e.road.cls }, `${e.id} carries ${e.road.lanes} lanes for ${Math.round(e.len)} m between ${lb} and ${la}: too short for a taper in and a taper out (${Math.round(need)} m by the class limit). It takes ${lanes} lanes, the count of the street`, e.pts),
      ]));
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};

/** Distance two paired carriageways must keep: half of each width and a median of two kerbs. */
export const pairSeparation = (a: GraphEdge, b: GraphEdge): number => r2(a.road.width / 2 + b.road.width / 2 + 0.6);

export interface PairGap {
  pair: GraphPair;
  a: GraphEdge;
  b: GraphEdge;
  minSep: number;
  /** Smallest distance between the two centre lines away from their ends, and where. */
  minD: number;
  at: P2;
}

function gapBetween(ctx: RuleContext, a: GraphEdge, b: GraphEdge): { d: number; at: P2 } | null {
  let best: { d: number; at: P2 } | null = null;
  const skipB = blendLength(b);
  const cb = ctx.cum(b);
  const skipA = blendLength(a);
  const ca = ctx.cum(a);
  // samples every 8 m and the line's own corners, where two lines drawn towards each other come closest
  const corners = a.pts.filter((_, i) => (ca[i] as number) > skipA && (ca[i] as number) < a.len - skipA);
  for (const s of [...ctx.samples(a, 8, skipA), ...corners]) {
    const pr = projectOn(s, b.pts);
    const sb = (cb[pr.i] as number) + pr.t * ((cb[pr.i + 1] as number) - (cb[pr.i] as number));
    if (sb < skipB || sb > b.len - skipB || pr.d > PAIR_GAP) continue;
    if (!best || pr.d < best.d) best = { d: pr.d, at: { x: s.x, z: s.z } };
  }
  return best;
}

/** How close the two carriageways of every pair come, measured away from the ends of both edges. */
export function pairGaps(ctx: RuleContext): PairGap[] {
  const cached = ctx.cache.get('pairGaps') as PairGap[] | undefined;
  if (cached) return cached;
  const out: PairGap[] = [];
  for (const pair of ctx.graph.pairs) {
    const a = ctx.edges.get(pair.a);
    const b = ctx.edges.get(pair.b);
    if (!a || !b) continue;
    const g1 = gapBetween(ctx, a, b);
    const g2 = gapBetween(ctx, b, a);
    const g = g1 && g2 ? (g1.d <= g2.d ? g1 : g2) : (g1 ?? g2);
    if (g) out.push({ pair, a, b, minSep: pairSeparation(a, b), minD: r3(g.d), at: g.at });
  }
  ctx.cache.set('pairGaps', out);
  return out;
}

/** Two carriageways closer than this (m) touch: they share a point of their reference lines. */
export const TOUCH_M = 0.5;

export const sharedIndexPoint: Rule = {
  id: 'R-LANE-03',
  area: 'lanes',
  title: 'Two carriageways share a point of their reference lines',
  confidence: 0.75,
  detect(ctx: RuleContext): Issue[] {
    return pairGaps(ctx).filter((g) => g.minD < TOUCH_M).map((g) => {
      const shift = r3((g.minSep - g.minD) / 2);
      return ctx.issue(sharedIndexPoint, g.at, [g.a.id, g.b.id], [g.a, g.b], 0.75, `the two carriageways come within ${g.minD} m of each other`, [
        ctx.proposal('move_node', { op: 'shift_apart', a: g.a.id, b: g.b.id, min_sep: g.minSep, shift_m: shift }, 0.7, { kind: 'carriageway_shift', m: shift }, `${g.a.id} and ${g.b.id} are the two carriageways of one street and touch (${g.minD} m apart): move each ${shift} m sideways so they keep ${g.minSep} m`, g.a.pts),
      ]);
    });
  },
  repair: (i, p) => patchOf(i, p),
};

/** A gore must close within this length (m). */
export const GORE_MAX = 200;

export const goreRoom: Rule = {
  id: 'R-LANE-04',
  area: 'lanes',
  title: 'No room for a gore at a diverge or merge',
  confidence: 0.7,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const s of splits(ctx)) {
      // the branch was moved out already (its shift ramps from the node): what is left is the zone's
      if (ctx.marks[s.minor.edge.id]?.['gore_shift_m'] !== undefined) continue;
      const minSep = r2((s.main.edge.road.width + s.minor.edge.road.width) / 2 + NOSE_GAP);
      // the branches as roads, not as single edges: a branch cut by a side street runs on
      const main = lineFrom(ctx, s.main, GORE_MAX);
      const minor = lineFrom(ctx, s.minor, GORE_MAX);
      const reach = Math.min(main.len, minor.len, GORE_MAX);
      let apart = 0;
      let open = false;
      for (let d = Math.min(5, reach); d <= reach && !open; d += 5) {
        const p = along(main.pts, d);
        const q = along(minor.pts, d);
        apart = Math.hypot(p.x - q.x, p.z - q.z);
        open = apart >= minSep - 0.05;
      }
      if (open) continue;
      const shift = r3(minSep - apart);
      out.push(ctx.issue(goreRoom, s.node, [s.main.edge.id, s.minor.edge.id, s.node.id], [s.main.edge, s.minor.edge], 0.7, `branches ${Math.round(apart * 10) / 10} m apart after ${Math.round(reach)} m, ${minSep} m needed`, [
        ctx.proposal('move_node', { op: 'shift_apart', a: s.main.edge.id, b: s.minor.edge.id, node: s.node.id, min_sep: minSep, shift_m: shift }, 0.6, { kind: 'carriageway_shift', m: shift }, `The two branches of the ${s.kind} at ${s.node.id} are only ${Math.round(apart * 10) / 10} m apart where the shorter one ends (${Math.round(reach)} m): no room for a gore and a nose. Move the branch ${s.minor.edge.id} out by ${shift} m`, s.minor.edge.pts),
        ctx.proposal('set_tag', { key: 'bake:gore', value: 'painted', on: s.minor.edge.id }, 0.3, { kind: 'other' }, 'Or a plain fork with a painted nose and no kerbed gore', [s.node]),
      ]));
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};

export const besideRoads: Rule = {
  id: 'R-LANE-05',
  area: 'lanes',
  title: 'Carriageways of two roads beside each other lie on each other',
  confidence: 0.8,
  detect(ctx: RuleContext): Issue[] {
    return besidePairs(ctx).map((g) => {
      const shift = r3((g.minSep - g.minD) / 2);
      return ctx.issue(besideRoads, g.at, [g.a.id, g.b.id], [g.a, g.b], 0.8, `${g.minD} m between the centre lines where they run alongside, ${g.minSep} m needed`, [
        ctx.proposal('move_node', { op: 'shift_apart', a: g.a.id, b: g.b.id, min_sep: g.minSep, shift_m: shift, move_nodes: true }, 0.8, { kind: 'carriageway_shift', m: shift }, `${g.a.id} and ${g.b.id} run alongside ${g.minD} m apart, but their carriageways and kerbs need ${g.minSep} m: each moves up to ${shift} m sideways, away from the other, and a node at the end of the stretch moves with it (the roads there follow)`, g.a.pts),
      ]);
    });
  },
  repair: (i, p) => patchOf(i, p),
};

const smoothstep = (t: number): number => {
  const v = Math.max(0, Math.min(1, t));
  return v * v * (3 - 2 * v);
};

/**
 * The centre line of `a` moved sideways away from `b` until the two keep `minSep` (a takes `share` of what is
 * missing), fading to nothing at a's ends so its nodes stay. Returns the new points and the largest move.
 */
export function shiftedAway(a: GraphEdge, b: GraphEdge, minSep: number, share = 0.5): { pts: P2[]; maxShift: number } {
  const pts = densify(a.pts, 8);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push((cum[i - 1] as number) + Math.hypot((pts[i] as P2).x - (pts[i - 1] as P2).x, (pts[i] as P2).z - (pts[i - 1] as P2).z));
  const len = cum[cum.length - 1] as number;
  const blend = blendLength(a);
  let maxShift = 0;
  const last = b.pts.length - 2;
  const out = pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return p;
    const pr = projectOn(p, b.pts);
    // beyond the end of b: nothing beside this point
    if ((pr.i === 0 && pr.t <= 0) || (pr.i === last && pr.t >= 1)) return p;
    const need = minSep - pr.d;
    if (need <= 0) return p;
    const move = (need * share + 0.02) * smoothstep(Math.min(cum[i] as number, len - (cum[i] as number)) / blend);
    if (move < 1e-4) return p;
    let ux = p.x - pr.x;
    let uz = p.z - pr.z;
    const ul = Math.hypot(ux, uz);
    if (ul < 1e-6) {
      const q = pts[i + 1] as P2;
      const l = Math.hypot(q.x - p.x, q.z - p.z) || 1;
      const n = leftOf((q.x - p.x) / l, (q.z - p.z) / l);
      ux = n.x;
      uz = n.z;
    } else {
      ux /= ul;
      uz /= ul;
    }
    maxShift = Math.max(maxShift, move);
    return { x: r3(p.x + ux * move), z: r3(p.z + uz * move) };
  });
  return { pts: out, maxShift: r3(maxShift) };
}

export const carriagewayFit: Rule = {
  id: 'R-LANE-FIT-01',
  area: 'lanes',
  title: 'Carriageways drawn closer than their lanes are wide',
  confidence: 0.85,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const g of pairGaps(ctx)) {
      const short = g.minSep - g.minD;
      // closer than TOUCH_M is rule R-LANE-03's case
      if (short <= 0.25 || g.minD < TOUCH_M) continue;
      const shift = r3(short / 2);
      out.push(ctx.issue(carriagewayFit, g.at, [g.a.id, g.b.id], [g.a, g.b], 0.85, `${g.minD} m between the centre lines, ${g.minSep} m needed`, [
        ctx.proposal('move_node', { op: 'shift_apart', a: g.a.id, b: g.b.id, min_sep: g.minSep, shift_m: shift }, 0.85, { kind: 'carriageway_shift', m: shift }, `The two carriageways of ${g.pair.name || 'this street'} are drawn ${g.minD} m apart but their lanes and the median need ${g.minSep} m: each moves ${shift} m sideways, away from the other`, g.a.pts),
      ]));
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};

export interface SlipFit {
  /** The slip road comes back within the allowed distance of its main line: only then is it redrawn. */
  caught: boolean;
  /** Largest sideways move (m). */
  worst: number;
  /** The slip road's points from the node outwards, redrawn. */
  pts: P2[];
}

/**
 * How a slip road leaves (or joins) its main line. Mappers often draw its first piece as a short diagonal from the
 * main line's node; built as drawn the lanes would turn sharply at the node. The fit lets it move away from the main
 * line by at most 1 m per `ratio` metres until it meets its own mapped line again. A ramp that turns away for good is
 * left as drawn. (The same step as tools/bake/roads/fit.ts limitDivergence, on graph edges.)
 */
export function slipFit(minor: End, main: End, ratio: number): SlipFit {
  const orient = (e: End): P2[] => (e.atStart ? e.edge.pts : e.edge.pts.slice().reverse());
  const pts = densify(orient(minor), 5);
  const ref = orient(main);
  const cum = [0];
  for (let i = 1; i < ref.length; i++) cum.push((cum[i - 1] as number) + Math.hypot((ref[i] as P2).x - (ref[i - 1] as P2).x, (ref[i] as P2).z - (ref[i - 1] as P2).z));
  const refLen = cum[cum.length - 1] as number;
  const out = pts.map((p) => ({ ...p }));
  let worst = 0;
  let lastS = 0;
  let caught = false;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i] as P2;
    const pr = projectOn(p, ref);
    const a = ref[pr.i] as P2;
    const b = ref[pr.i + 1] as P2;
    const sl = (cum[pr.i + 1] as number) - (cum[pr.i] as number) || 1;
    const s = (cum[pr.i] as number) + pr.t * sl;
    if (s >= refLen - 0.5 || s > 220 || s < lastS - 0.5) break;
    const tx = (b.x - a.x) / sl;
    const tz = (b.z - a.z) / sl;
    const q = pts[i - 1] as P2;
    const ml = Math.hypot(p.x - q.x, p.z - q.z) || 1;
    if (((p.x - q.x) * tx + (p.z - q.z) * tz) / ml < Math.cos((70 * Math.PI) / 180)) break;
    lastS = s;
    const allowed = s / ratio;
    if (s > 3 && pr.d <= allowed + 1e-6) {
      caught = true;
      break;
    }
    if (pr.d <= allowed) continue;
    const n = leftOf(tx, tz);
    const side = (p.x - pr.x) * n.x + (p.z - pr.z) * n.z >= 0 ? 1 : -1;
    const moved = { x: r3(pr.x + n.x * side * allowed), z: r3(pr.z + n.z * side * allowed) };
    worst = Math.max(worst, Math.hypot(moved.x - p.x, moved.z - p.z));
    out[i] = moved;
  }
  return { caught, worst: caught ? r3(worst) : 0, pts: caught ? out : pts };
}

/** How fast a slip road may leave a main line of this class: metres along per metre sideways. */
export const slipRatio = (cls: string): number => classDefaults(cls).taper * 0.4;

export const slipRoadFit: Rule = {
  id: 'R-LANE-FIT-02',
  area: 'lanes',
  title: 'Slip road drawn as a short diagonal',
  confidence: 0.85,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const s of splits(ctx)) {
      if (!s.minor.edge.road.link) continue;
      const fit = slipFit(s.minor, s.main, slipRatio(s.main.edge.road.cls));
      if (!fit.caught || fit.worst <= 0.3) continue;
      out.push(ctx.issue(slipRoadFit, s.node, [s.minor.edge.id, s.main.edge.id, s.node.id], [s.minor.edge, s.main.edge], 0.85, `leaves the main line ${fit.worst} m faster than 1 in ${slipRatio(s.main.edge.road.cls)}`, [
        ctx.proposal('replace_geometry', { op: 'slip_redraw', on: s.minor.edge.id, main: s.main.edge.id, node: s.node.id, move_m: fit.worst }, 0.85, { kind: 'slip_redraw', m: fit.worst }, `The slip road ${s.minor.edge.id} is drawn as a short diagonal from the node of ${s.main.edge.id}: its first stretch is redrawn beside the main line, moving out by 1 m per ${slipRatio(s.main.edge.road.cls)} m (largest move ${fit.worst} m)`, fit.pts),
      ]));
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};

/** The nearest edge with a tagged lane count along the street, walking on from one end of e. */
function taggedAlong(ctx: RuleContext, e: GraphEdge, atStart: boolean): GraphEdge | null {
  let end: End = { edge: e, atStart };
  let walked = 0;
  for (let hop = 0; hop < 12 && walked < 600; hop++) {
    const next = ctx.through(end);
    if (!next || next.edge === e || !sameStreet(next.edge, e)) return null;
    if (next.edge.road.lanesFrom === 'tag') return next.edge;
    walked += next.edge.len;
    end = ctx.otherEnd(next);
  }
  return null;
}

export const laneCountAhead: Rule = {
  id: 'R-LANE-FIT-03',
  area: 'lanes',
  title: 'Class-default lane count beside a tagged one',
  confidence: 0.85,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const e of ctx.graph.edges.slice().sort(byId)) {
      if (e.road.lanesFrom !== 'class') continue;
      const ahead = taggedAlong(ctx, e, false);
      const behind = taggedAlong(ctx, e, true);
      const from = ahead ?? behind;
      if (!from || from.road.lanes === e.road.lanes) continue;
      const agree = !ahead || !behind || ahead.road.lanes === behind.road.lanes;
      out.push(ctx.issue(laneCountAhead, mid(e), [e.id], [e], 0.85, `${e.road.lanes} lanes by class default, ${from.road.lanes} tagged ${ahead ? 'ahead' : 'behind'} on ${from.id}`, [
        ctx.proposal('set_lanes', { on: e.id, lanes: from.road.lanes, from: 'ahead' }, agree ? 0.85 : 0.8, { kind: 'lane_count', cls: e.road.cls }, `${e.id} has no lanes tag (${e.road.lanes} by class default); the same street carries ${from.road.lanes} tagged lanes ${ahead ? 'ahead' : 'behind'} (${from.id}): take the lane count from the road ahead, so no taper is made up`, e.pts),
      ]));
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};
