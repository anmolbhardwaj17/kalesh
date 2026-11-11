// The lane model of a whole block graph (P1-012, MAP_REPAIR.md "Lane-level road model"): the production builder on
// the prototype's modules (model, curve, lanes, junction, hero). Input is the repaired block graph: the fit steps of
// the road bench (carriageways pushed apart, slip roads redrawn, lane counts from the road ahead) already ran there as
// logged rule repairs, so nothing here moves a centre line.
//
// Order: lane counts along whole streets (street.ts); a cross-section per edge; split zones at every diverge and
// merge; streets that change their count at a junction widen over a taper on the narrower side; junction clusters with
// the cut of every arm; an edge too short to hold its cuts, or to give a turn its radius, becomes part of the
// junction; strips; joints; connecting lane paths; the explained ends. Then two fit rounds at most: a road too short
// for the taper it needs takes the lane count it would taper to, and the model is built again. Pure.
import type { P2 } from '../geom.ts';
import type { GraphEdge, GraphNode } from '../graph/build.ts';
import { roadGraph, filterEdges } from './blockgraph.ts';
import type { RoadFilter, RoadGraph } from './blockgraph.ts';
import { lanePose, planTurns, turnPath } from './connect.ts';
import type { ArmLane, ArmView, PathGeom, Turn, TurnKind, TurnRestriction } from './connect.ts';
import type { GEdge, GEnd, GNode } from './graph.ts';
import { heroCrossSection } from './hero.ts';
import type { HeroSpec } from './hero.ts';
import { edgePoint, planJunction, tangentAt } from './junction.ts';
import type { ArmPlan, JunctionPlan } from './junction.ts';
import { buildEdgeStrips, mainBranch, matchRows, planSplit, rowBorders, splitCandidate } from './lanes.ts';
import type { EdgePlan, Row, SplitCandidate, Zone } from './lanes.ts';
import { MIN_TURN_RADIUS_M, classDefaults } from './model.ts';
import type { CrossSection, Joint, Station, Strip, StripEnd } from './model.ts';
import { driveCount, inferStreets, streetCrossSection } from './street.ts';
import type { EdgeLanes, StreetResult } from './street.ts';

export interface LaneModelInput {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  /** Marks of the repair step (closures at dead ends, widths narrowed for buildings). */
  marks?: Readonly<Record<string, Readonly<Record<string, string | number | boolean>>>>;
  /** The lanes tag of every way that has one, by "way/<id>". */
  wayLanes: ReadonlyMap<string, number>;
  heroes?: readonly HeroSpec[];
  restrictions?: readonly TurnRestriction[];
  /** Tagged crossings and traffic signals of the map, block metres. */
  points?: readonly { x: number; z: number; kind: 'crossing' | 'signals' }[];
  filter?: RoadFilter;
  /** Station spacing in metres. */
  step?: number;
}

export interface LaneArm {
  strip: number;
  end: StripEnd;
  edge: string;
  /** Metres from the node to the cut line: where the strip ends and the junction begins. */
  cut: number;
  /** Metres from the strip end back to the stop line (a crossing lies between them); 0: the stop line is the cut line. */
  stopBack: number;
  crossing: boolean;
}

export interface LanePath {
  /** [strip, lane] of the lane the path leaves and of the lane it enters. */
  from: [number, number];
  to: [number, number];
  fromArm: number;
  toArm: number;
  turn: TurnKind;
  /** Smallest radius along the path in metres; null for a straight line. */
  radius: number | null;
  length: number;
  pts: P2[];
}

export interface LaneJunction {
  id: string;
  nodes: string[];
  centre: P2;
  control: 'signals' | 'priority';
  arms: LaneArm[];
  /** Arm pairs the turn rules allow; each has at least one path. */
  pairs: { from: number; to: number; kind: TurnKind }[];
  paths: LanePath[];
}

export type EndKind = 'map_edge' | 'dead_end' | 'gate' | 'loop' | 'barricade' | 'junction_stub';

export interface ExplainedEnd {
  strip: number;
  end: StripEnd;
  node: string;
  kind: EndKind;
  why: string;
}

export interface LaneBuild {
  road: RoadGraph;
  plans: EdgePlan[];
  streets: StreetResult;
  strips: Strip[];
  joints: Joint[];
  zones: Zone[];
  /** Strip index of each zone, in `zones` order. */
  zoneStrips: number[];
  junctions: LaneJunction[];
  junctionPlans: JunctionPlan[];
  ends: ExplainedEnd[];
  /** Edges with no strip of their own: inside a junction (too short for its cuts), by block graph id. */
  internal: { edge: string; why: string }[];
  /** One-way nodes that look like a diverge or merge and are built as a junction, with the reason. */
  forks: { node: string; kind: 'diverge' | 'merge'; why: string }[];
  /** Streets that change their lane count at a junction: the taper lies on this edge, from its own count to the count at the junction. */
  widenings: { edge: string; end: StripEnd; from: number; to: number }[];
  /** Roads that took the lane count they would have tapered to (too short for the taper). */
  fitted: { edge: string; lanes: number }[];
  /** U-turns and other turns the rules or the radius left out, and turns kept under the radius because a lane has no other way on. */
  turns: { uTurnsTooTight: number; restricted: number; droppedForRadius: number; tight: number };
  /** Paths under the minimum radius, each with its reason: the only way on for a lane where the junction has no room. */
  tightPaths: { junction: string; fromArm: number; toArm: number; radius: number; why: string }[];
  /** First and last strip of every edge that has strips, and the strip lane of every lane of its end cross-sections. */
  built: Map<number, { first: number; last: number; startLanes: number[]; endLanes: number[] }>;
  problems: string[];
  rounds: number;
  ms: Record<string, number>;
}

/** Junction nodes joined by an edge up to this long are one junction (the same number as rule R-JUNC-03 reads). */
export const CLUSTER_GAP_M = 18;
const MIN_STRIP_M = 1.5;
/** Paths are planned with a margin: the strips' own frames differ a little from the planned ones. */
const PLAN_RADIUS_M = MIN_TURN_RADIUS_M + 0.35;
/** Only an edge shorter than this may become part of a junction to make room for a turn. */
const ABSORB_MAX_M = 45;
const CUT_ESTIMATE_M = 9;
const MAX_ROUNDS = 4;
const PASSES = 7;
/** A road too short for a taper may carry this many lanes more than its street's count (an auxiliary lane between two slip roads). */
const EXTRA_LANES = 1;

const endOf = (s: Strip, end: StripEnd): Station => (end === 'start' ? s.st[0] : s.st[s.st.length - 1]) as Station;
const key = (e: GEnd): number => e.edge * 2 + (e.atStart ? 0 : 1);

interface Planned {
  jp: JunctionPlan;
  views: ArmView[];
  turns: Turn[];
  pairs: { from: number; to: number; kind: TurnKind }[];
  uTurnsTooTight: number;
  restricted: number;
  dropped: number;
  tight: number;
}

interface Attempt {
  build: LaneBuild;
  retry: boolean;
}

export function buildLaneModel(input: LaneModelInput): LaneBuild {
  const t0 = Date.now();
  const road = roadGraph(input.nodes, filterEdges(input.edges, input.filter));
  const graphMs = Date.now() - t0;
  const fixed = new Map<string, number>();
  const noZone = new Set<number>();
  let last: Attempt | null = null;
  let rounds = 0;
  while (rounds < MAX_ROUNDS) {
    rounds++;
    last = attempt(input, road, fixed, noZone);
    if (!last.retry) break;
  }
  const build = (last as Attempt).build;
  build.rounds = rounds;
  build.ms['graph'] = graphMs;
  build.ms['total'] = Date.now() - t0;
  const fitted = new Map(fixed);
  build.plans.forEach((p, i) => {
    const id = (road.source[i] as GraphEdge).id;
    const n = driveCount(p.cs[0] as CrossSection);
    if (build.streets.byEdge.get(id)?.lanes !== n && !p.hero) fitted.set(id, n);
  });
  build.fitted = [...fitted].map(([edge, lanes]) => ({ edge, lanes })).sort((a, b) => (a.edge < b.edge ? -1 : 1));
  roundModel(build);
  return build;
}

function attempt(input: LaneModelInput, road: RoadGraph, fixed: Map<string, number>, noZone: Set<number>): Attempt {
  const { graph, source, nodeId, nodeKind } = road;
  const ms: Record<string, number> = {};
  let clock = Date.now();
  const lap = (name: string): void => {
    const now = Date.now();
    ms[name] = (ms[name] ?? 0) + now - clock;
    clock = now;
  };
  const problems: string[] = [];
  const heroes = input.heroes ?? [];
  const step = input.step ?? 4;
  const heroOf = (e: GraphEdge): HeroSpec | null => {
    for (const h of heroes) if (e.pieces.every((p) => h.covers.osmWays.includes(Number(p.way.replace('way/', ''))))) return h;
    return null;
  };
  const heroBy = source.map(heroOf);
  const indexOf = new Map(source.map((e, i) => [e.id, i]));
  const isHero = (i: number): boolean => heroBy[i] !== null;

  // ---------------------------------------------------------------- lane counts, cross-sections, split zones
  let streets = inferStreets({ nodes: input.nodes, edges: source, ...(input.marks ? { marks: input.marks } : {}) }, input.wayLanes, heroes, fixed);
  let plans: EdgePlan[] = [];
  let nominal: CrossSection[] = [];
  let zones: Zone[] = [];
  let forks: LaneBuild['forks'] = [];
  const zoneCands: SplitCandidate[] = [];
  /** Roads that take the first section of the zone at this node as their own cross-section. */
  const adopt = new Map<string, number>();
  const zoneNode = new Set<number>();
  /** Edges that carry a zone at an end, with the zone's node. */
  const zoneEnds = new Map<number, number[]>();
  const info = (i: number): EdgeLanes => streets.byEdge.get((source[i] as GraphEdge).id) as EdgeLanes;
  const farReserve = (e: GEnd): number => {
    const edge = graph.edges[e.edge] as GEdge;
    const far = graph.nodes.get(e.atStart ? edge.b : edge.a);
    return far && far.ends.length > 1 ? Math.min(18, edge.len * 0.3) : 0;
  };
  /** A split with a junction node within the cluster gap along one of its three roads is part of that junction (a turn island), not a zone. */
  const insideJunction = (cand: { parent: GEnd; branches: [GEnd, GEnd] }): string | null => {
    // traffic entering a roundabout gives way at a line: an entry or exit is a junction with a splitter island, not lanes side by side
    if ([cand.parent, ...cand.branches].some((e) => (source[e.edge] as GraphEdge).roundabout)) return 'an entry or exit of a roundabout: a give-way junction';
    for (const e of [cand.parent, ...cand.branches]) {
      const edge = graph.edges[e.edge] as GEdge;
      const far = graph.nodes.get(e.atStart ? edge.b : edge.a) as GNode;
      if (edge.len <= CLUSTER_GAP_M && far.ends.length >= 3) return `${Math.round(edge.len * 10) / 10} m from the junction node ${nodeId[far.id]}: part of that junction (cluster rule, ${CLUSTER_GAP_M} m)`;
    }
    return null;
  };
  const shiftOf = (rows: readonly Row[], a: CrossSection, b: CrossSection): number => {
    const bd = rowBorders(rows, a, b);
    let m = 0;
    for (let k = 0; k < bd.a.length; k++) m = Math.max(m, Math.abs((bd.a[k] as number) - (bd.b[k] as number)));
    return m;
  };
  /** The count of every edge before the lane model settles anything itself: a road gains one extra lane at most. */
  const baseLanes = new Map<string, number>();
  for (const [id, r] of inferStreets({ nodes: input.nodes, edges: source, ...(input.marks ? { marks: input.marks } : {}) }, input.wayLanes, heroes).byEdge) baseLanes.set(id, r.lanes);
  const raise = (id: string, want: number, now: number): boolean => {
    const to = Math.min(want, (baseLanes.get(id) ?? now) + EXTRA_LANES, streets.byEdge.get(id)?.cap ?? want);
    if (to <= now || fixed.get(id) === to) return false;
    fixed.set(id, to);
    return true;
  };
  const settle = (): void => {
    streets = inferStreets({ nodes: input.nodes, edges: source, ...(input.marks ? { marks: input.marks } : {}) }, input.wayLanes, heroes, fixed);
  };
  // a split zone carries the lanes of both branches side by side: a branch whose count is only a default carries what
  // the road before the split can feed (or the road after a merge can take), one lane at least
  for (let pass = 0; pass < 4; pass++) {
    let lowered = false;
    for (const node of graph.nodes.values()) {
      const cand = splitCandidate(graph, node.id);
      if (!cand || noZone.has(node.id) || [cand.parent, ...cand.branches].some((e) => isHero(e.edge)) || insideJunction(cand)) continue;
      const { main, minor } = mainBranch(graph, cand);
      const r = info(minor.edge);
      if (r.from !== 'class' && r.from !== 'street' && r.from !== 'pair') continue;
      const want = Math.max(1, info(cand.parent.edge).lanes - info(main.edge).lanes);
      if (want < r.lanes) {
        fixed.set((source[minor.edge] as GraphEdge).id, want);
        lowered = true;
      }
    }
    if (!lowered) break;
    settle();
  }
  for (let pre = 0; pre < 5; pre++) {
    nominal = source.map((e, i) => (heroBy[i] ? heroCrossSection(heroBy[i] as HeroSpec) : streetCrossSection(e, info(i), info(i).lanes)));
    plans = graph.edges.map((e, i) => ({
      edge: e, cs: e.pieces.map(() => nominal[i] as CrossSection), hero: heroBy[i]?.id ?? null, t0: 0, t1: e.len, internal: false,
      paired: (source[i] as GraphEdge).pairedWith.map((id) => indexOf.get(id)).find((x) => x !== undefined) ?? null,
    }));
    zones = [];
    zoneCands.length = 0;
    forks = [];
    zoneNode.clear();
    zoneEnds.clear();
    // a first pass on a copy finds the gore side of every branch: a road that is the branch of one zone and the road
    // before another must have its final cross-section before the second zone names its lanes
    const scratch: EdgePlan[] = plans.map((p) => ({ ...p, cs: p.cs.slice() }));
    for (const node of graph.nodes.values()) {
      const cand = noZone.has(node.id) ? null : splitCandidate(graph, node.id);
      if (cand && ![cand.parent, ...cand.branches].some((e) => isHero(e.edge)) && !insideJunction(cand)) planSplit(graph, scratch, cand, farReserve, 3);
    }
    plans.forEach((p, i) => {
      p.cs = (scratch[i] as EdgePlan).cs;
    });
    for (const node of graph.nodes.values()) {
      const cand = splitCandidate(graph, node.id);
      if (!cand) continue;
      const three = [cand.parent, ...cand.branches];
      if (three.some((e) => isHero(e.edge))) continue;
      if (noZone.has(node.id)) {
        forks.push({ node: nodeId[node.id] as string, kind: cand.kind, why: 'the road before the split, or a branch, is too short for the lanes, tapers and junction cuts the zone would need' });
        continue;
      }
      const inside = insideJunction(cand);
      if (inside) {
        forks.push({ node: nodeId[node.id] as string, kind: cand.kind, why: inside });
        continue;
      }
      const zone = planSplit(graph, plans, cand, farReserve, 3);
      if (!zone) {
        forks.push({ node: nodeId[node.id] as string, kind: cand.kind, why: 'the branches do not come a nose gap apart within their own length' });
        continue;
      }
      zones.push(zone);
      zoneCands.push(cand);
      zoneNode.add(node.id);
      for (const e of three) zoneEnds.set(e.edge, [...(zoneEnds.get(e.edge) ?? []), node.id]);
    }
    // a road that takes the first section of its zone whole has no taper there
    for (const z of zones) {
      const p = plans[z.parent.edge] as EdgePlan;
      const att = z.parent.atStart ? p.startAttach : p.endAttach;
      if (adopt.get((source[z.parent.edge] as GraphEdge).id) !== z.node || !att?.target) continue;
      const cs = att.target.cs;
      p.cs = p.cs.map(() => cs);
      nominal[z.parent.edge] = cs;
      delete att.target;
    }
    // a road too short for the taper to its zone takes the lane count of the zone's first section
    let raised = false;
    for (const [zi, z] of zones.entries()) {
      const p = plans[z.parent.edge] as EdgePlan;
      const att = z.parent.atStart ? p.startAttach : p.endAttach;
      if (!att?.target || isHero(z.parent.edge)) continue;
      const own = (z.parent.atStart ? p.cs[0] : p.cs[p.cs.length - 1]) as CrossSection;
      const shift = z.parent.atStart ? shiftOf(att.target.rows, att.target.cs, own) : shiftOf(att.target.rows, own, att.target.cs);
      const need = classDefaults(p.edge.cls).taper * shift;
      const far = graph.nodes.get(z.parent.atStart ? p.edge.b : p.edge.a) as GNode;
      const both = (z.parent.atStart ? p.endAttach : p.startAttach)?.target !== undefined;
      const room = (p.t1 - p.t0 - (far.ends.length > 1 && !zoneNode.has(far.id) ? CUT_ESTIMATE_M : 0)) * (both ? 0.45 : 0.7);
      if (need <= room) continue;
      const id = (source[z.parent.edge] as GraphEdge).id;
      const want = driveCount(att.target.cs);
      // more lanes than the road may carry: the branch that leaves or joins brings fewer (one at least), whatever its tag says
      const most = Math.max(driveCount(own), (baseLanes.get(id) ?? 0) + EXTRA_LANES);
      const { minor } = mainBranch(graph, zoneCands[zi] as SplitCandidate);
      const minorId = (source[minor.edge] as GraphEdge).id;
      const now = info(minor.edge).lanes;
      const fewer = Math.max(1, now - (want - most));
      if (want > most && fewer < now && fixed.get(minorId) !== fewer) {
        fixed.set(minorId, fewer);
        raised = true;
        continue;
      }
      if (!(z.parent.atStart ? p.endAttach : p.startAttach)) {
        // the short road takes the zone's first section whole: the lanes that run on stay where they are, the extra
        // lane lies on the side of the branch that leaves or joins, and there is no taper
        adopt.set(id, z.node);
        raised = true;
        continue;
      }
      if (raise(id, want, driveCount(own))) raised = true;
    }
    if (!raised) break;
    settle();
  }
  const base0 = plans.map((p) => p.t0);
  const base1 = plans.map((p) => p.t1);
  lap('zones');

  // ---------------------------------------------------------------- a street that changes its count at a junction
  const widenings: LaneBuild['widenings'] = [];
  for (const chain of streets.streets) {
    for (let c = 0; c + 1 < chain.length; c++) {
      const i = indexOf.get(chain[c] as string);
      const j = indexOf.get(chain[c + 1] as string);
      if (i === undefined || j === undefined) continue;
      const ei = graph.edges[i] as GEdge;
      const ej = graph.edges[j] as GEdge;
      const shared = [ei.a, ei.b].filter((n) => n === ej.a || n === ej.b);
      if (shared.length !== 1 || ei.a === ei.b || ej.a === ej.b || zoneNode.has(shared[0] as number)) continue;
      const ni = driveCount(nominal[i] as CrossSection);
      const nj = driveCount(nominal[j] as CrossSection);
      if (ni === nj) continue;
      const narrow = ni < nj ? i : j;
      const wider = ni < nj ? j : i;
      // an extra lane beside a split zone ends at the junction: the street does not widen for it
      if (fixed.has((source[wider] as GraphEdge).id) || adopt.has((source[wider] as GraphEdge).id)) continue;
      const node = shared[0] as number;
      /** The taper on edge e towards `lanes` lanes at the shared node, when e may take one and how much room it has for it. */
      const taperOn = (e: number, lanes: number): { atStart: boolean; target: CrossSection; rows: Row[]; fits: boolean } | null => {
        const p = plans[e] as EdgePlan;
        const r = info(e);
        // a hero road keeps its spec, a gali its width, a zone branch its gore side
        if (isHero(e) || r.from === 'width' || r.gali || p.cs[0] !== nominal[e] || fixed.has((source[e] as GraphEdge).id)) return null;
        const atStart = (graph.edges[e] as GEdge).a === node;
        if (atStart ? p.startAttach : p.endAttach) return null;
        const own = nominal[e] as CrossSection;
        const target = streetCrossSection(source[e] as GraphEdge, r, lanes);
        const rows = atStart ? matchRows(target, own) : matchRows(own, target);
        const need = classDefaults(p.edge.cls).taper * (atStart ? shiftOf(rows, target, own) : shiftOf(rows, own, target));
        const far = graph.nodes.get(atStart ? p.edge.b : p.edge.a) as GNode;
        const other = atStart ? p.endAttach : p.startAttach;
        const room = (p.t1 - p.t0 - CUT_ESTIMATE_M - (far.ends.length > 1 && !zoneNode.has(far.id) ? CUT_ESTIMATE_M : 0)) * (other?.target ? 0.45 : 0.7);
        return { atStart, target, rows, fits: need <= room };
      };
      // the narrower road widens before the junction; where it has no room and the wider one has, the wider road
      // narrows to the junction instead; where neither has, the narrower one tries (and may take the wider count)
      const onNarrow = taperOn(narrow, Math.max(ni, nj));
      const onWide = onNarrow && !onNarrow.fits && ((source[wider] as GraphEdge).oneway || Math.min(ni, nj) > 1) ? taperOn(wider, Math.min(ni, nj)) : null;
      const [edge, t] = onWide?.fits ? [wider, onWide] : [narrow, onNarrow];
      if (!t) continue;
      const p = plans[edge] as EdgePlan;
      if (t.atStart) p.startAttach = { nx: 0, nz: 0, own: true, target: { cs: t.target, rows: t.rows } };
      else p.endAttach = { nx: 0, nz: 0, own: true, target: { cs: t.target, rows: t.rows } };
      widenings.push({ edge: (source[edge] as GraphEdge).id, end: t.atStart ? 'start' : 'end', from: driveCount(nominal[edge] as CrossSection), to: driveCount(t.target) });
    }
  }

  // ---------------------------------------------------------------- junction clusters and the cut of every arm
  const parent: number[] = [];
  for (let i = 0; i < graph.nodes.size; i++) parent.push(i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    while (parent[i] !== r) {
      const n = parent[i] as number;
      parent[i] = r;
      i = n;
    }
    return r;
  };
  const absorbed = new Map<number, string>();
  const dirty = new Set<number>();
  const planned = new Map<number, Planned>();
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    const r = Math.min(ra, rb);
    parent[ra] = r;
    parent[rb] = r;
    planned.delete(ra);
    planned.delete(rb);
    dirty.add(r);
  };
  const absorb = (i: number, why: string): void => {
    const e = graph.edges[i] as GEdge;
    absorbed.set(i, why);
    union(e.a, e.b);
  };
  const endsOf = (n: number): number => (graph.nodes.get(n) as GNode).ends.length;
  for (const e of graph.edges) {
    if (e.len <= CLUSTER_GAP_M && e.a !== e.b && endsOf(e.a) >= 3 && endsOf(e.b) >= 3 && !zoneNode.has(e.a) && !zoneNode.has(e.b) && !zoneEnds.has(e.index)) {
      absorb(e.index, `${Math.round(e.len * 10) / 10} m between two junction nodes: one junction (cluster rule, ${CLUSTER_GAP_M} m)`);
    }
  }
  const cutAt = new Map<number, number>();
  const ask = new Map<number, number>();
  const view = (a: ArmPlan): ArmView => {
    const p = edgePoint(a, 0, a.cut);
    const t = tangentAt(a, a.cut);
    const src = source[a.end.edge] as GraphEdge;
    const lanes: ArmLane[] = [];
    a.cs.lanes.forEach((l, k) => {
      if (l.type === 'drive') lanes.push({ k, lat: ((a.borders[k] as number) + (a.borders[k + 1] as number)) / 2, width: l.width, flow: l.dir });
    });
    return { x: p.x, z: p.z, ox: t.x, oz: t.z, edge: src.id, paired: src.pairedWith, lanes };
  };
  const members = (): Map<number, number[]> => {
    const groups = new Map<number, number[]>();
    for (const n of graph.nodes.values()) {
      const r = find(n.id);
      const list = groups.get(r);
      if (list) list.push(n.id);
      else groups.set(r, [n.id]);
    }
    return groups;
  };
  const wantAbsorb = new Set<number>();
  const planCluster = (root: number, ids: number[]): void => {
    const ends: GEnd[] = [];
    for (const id of ids) for (const end of (graph.nodes.get(id) as GNode).ends) if (!absorbed.has(end.edge)) ends.push(end);
    planned.delete(root);
    if (ends.length === 0) return;
    let res: Planned | null = null;
    const blocked = new Set<number>();
    for (let pass = 0; pass < PASSES; pass++) {
      for (const e of ends) {
        const p = plans[e.edge] as EdgePlan;
        p.t0 = base0[e.edge] as number;
        p.t1 = base1[e.edge] as number;
      }
      const jp = planJunction(graph, plans, `j${nodeId[ids[0] as number]}`, ids, ends, 1.5, (e) => ask.get(key(e)) ?? 0);
      const views = jp.arms.map(view);
      const pose = (arm: number, lane: ArmLane, into: boolean) => lanePose(views[arm] as ArmView, lane, into);
      const tp = planTurns(views, input.restrictions ?? [], (f, fl, t, tl) => turnPath(pose(f, fl, true), pose(t, tl, false)).radius, PLAN_RADIUS_M + 0.15);
      res = { jp, views, turns: tp.turns, pairs: tp.pairs, uTurnsTooTight: tp.uTurnsTooTight, restricted: tp.restricted, dropped: 0, tight: 0 };
      let changed = false;
      const failing: { t: Turn; g: PathGeom }[] = [];
      for (const t of tp.turns) {
        const va = views[t.from] as ArmView;
        const vb = views[t.to] as ArmView;
        const g = turnPath(lanePose(va, va.lanes.find((l) => l.k === t.fromLane) as ArmLane, true), lanePose(vb, vb.lanes.find((l) => l.k === t.toLane) as ArmLane, false));
        if (g.radius >= PLAN_RADIUS_M) continue;
        failing.push({ t, g });
        const needT = g.how === 'fillet' ? PLAN_RADIUS_M * Math.tan((g.phi as number) / 2) + 0.05 : 0;
        const grow = Math.max(1.5, 1.5 * (PLAN_RADIUS_M - g.radius));
        const more = g.how === 'fillet' ? [Math.max(0, needT - (g.a as number)), Math.max(0, needT - (g.b as number))] : [grow, grow];
        [t.from, t.to].forEach((armIndex, side) => {
          const arm = jp.arms[armIndex] as ArmPlan;
          if ((more[side] as number) <= 0) return;
          const free = (base1[arm.end.edge] as number) - (base0[arm.end.edge] as number);
          const limit = zoneEnds.has(arm.end.edge) ? arm.avail : free * 0.9;
          let want = arm.cut + (more[side] as number);
          if (want > limit) {
            want = limit;
            blocked.add(arm.end.edge);
          }
          if (want > (ask.get(key(arm.end)) ?? 0) + 1e-6 && want > arm.cut + 1e-6) {
            ask.set(key(arm.end), want);
            changed = true;
          }
        });
      }
      if (failing.length === 0) break;
      if (!changed || pass === PASSES - 1) {
        // no room left: the shortest blocked arm becomes part of the junction, or the turn is not allowed here
        for (const f of failing) {
          const cand = [f.t.from, f.t.to].map((a) => (jp.arms[a] as ArmPlan).end.edge).filter((e) => blocked.has(e) && !zoneEnds.has(e) && (graph.edges[e] as GEdge).len < ABSORB_MAX_M);
          if (cand.length) wantAbsorb.add(cand.sort((x, y) => (graph.edges[x] as GEdge).len - (graph.edges[y] as GEdge).len)[0] as number);
          else {
            // a lane with no other way on, or no other way in, keeps its turn on the radius there is room for
            const others = res.turns.filter((t) => t !== f.t);
            const needed = !others.some((t) => t.from === f.t.from && t.fromLane === f.t.fromLane) || !others.some((t) => t.to === f.t.to && t.toLane === f.t.toLane);
            if (needed) res.tight++;
            else {
              res.turns = others;
              res.dropped++;
            }
          }
        }
        res.pairs = res.pairs.filter((p) => res !== null && res.turns.some((t) => t.from === p.from && t.to === p.to));
        break;
      }
    }
    if (!res) return;
    for (const a of res.jp.arms) cutAt.set(key(a.end), a.cut);
    planned.set(root, res);
  };
  let retry = false;
  for (const n of graph.nodes.values()) if (n.ends.length >= 2 && !zoneNode.has(n.id)) dirty.add(find(n.id));
  for (let iter = 0; iter < 12 && dirty.size > 0; iter++) {
    const groups = members();
    const todo = [...new Set([...dirty].map((r) => find(r)))].sort((a, b) => a - b);
    dirty.clear();
    wantAbsorb.clear();
    for (const root of todo) {
      const ids = (groups.get(root) ?? []).filter((id) => !zoneNode.has(id)).sort((a, b) => a - b);
      if (ids.length === 0 || (ids.length === 1 && endsOf(ids[0] as number) < 2)) continue;
      planCluster(root, ids);
    }
    // an edge with too little left between its cuts is part of the junction
    for (const e of graph.edges) {
      if (absorbed.has(e.index)) continue;
      const a0 = Math.max(base0[e.index] as number, cutAt.get(e.index * 2) ?? 0);
      const a1 = Math.min(base1[e.index] as number, e.len - (cutAt.get(e.index * 2 + 1) ?? 0));
      if (a1 - a0 < MIN_STRIP_M && (cutAt.has(e.index * 2) || cutAt.has(e.index * 2 + 1))) wantAbsorb.add(e.index);
    }
    for (const i of [...wantAbsorb].sort((a, b) => a - b)) {
      const e = graph.edges[i] as GEdge;
      const z = zoneEnds.get(i);
      if (z) {
        for (const n of z) noZone.add(n);
        retry = true;
        continue;
      }
      cutAt.delete(i * 2);
      cutAt.delete(i * 2 + 1);
      absorb(i, `${Math.round(e.len * 10) / 10} m: too short for the cuts and turn radii of the junction${e.a === e.b ? '' : 's'} at its ends`);
    }
    if (retry) break;
  }
  lap('junctions');
  const emptyBuild = (): LaneBuild => ({
    road, plans, streets, strips: [], joints: [], zones, zoneStrips: [], junctions: [], junctionPlans: [], ends: [], internal: [], forks, widenings, fitted: [], tightPaths: [],
    turns: { uTurnsTooTight: 0, restricted: 0, droppedForRadius: 0, tight: 0 }, built: new Map(), problems, rounds: 0, ms,
  });
  if (retry) return { build: emptyBuild(), retry: true };
  for (const p of plans) {
    const i = p.edge.index;
    p.t0 = Math.max(base0[i] as number, cutAt.get(i * 2) ?? 0);
    p.t1 = Math.min(base1[i] as number, p.edge.len - (cutAt.get(i * 2 + 1) ?? 0));
    p.internal = absorbed.has(i);
  }

  // ---------------------------------------------------------------- strips and joints
  const strips: Strip[] = [];
  const joints: Joint[] = [];
  const built: LaneBuild['built'] = new Map();
  for (const plan of plans) {
    if (plan.internal) continue;
    if (plan.t1 - plan.t0 < 1) {
      problems.push(`${plan.edge.id}: nothing left between its junctions and zones (${(plan.t1 - plan.t0).toFixed(1)} m of ${plan.edge.len.toFixed(1)} m): no surface`);
      continue;
    }
    const es = buildEdgeStrips(plan, step);
    if (es.strips.length === 0) continue;
    const first = strips.length;
    strips.push(...es.strips);
    for (const j of es.joints) joints.push({ ...j, a: { strip: j.a.strip + first, end: j.a.end }, b: { strip: j.b.strip + first, end: j.b.end } });
    built.set(plan.edge.index, { first, last: strips.length - 1, startLanes: es.startLanes, endLanes: es.endLanes });
    // a taper too short for its class: the road takes the lane count it would have tapered to, in the next round
    for (const [att, s, atStart] of [[plan.startAttach, es.strips[0], true], [plan.endAttach, es.strips[es.strips.length - 1], false]] as const) {
      if (!att?.target || !s || s.kind !== 'taper' || !s.taper || isHero(plan.edge.index)) continue;
      const need = classDefaults(s.cls).taper * s.taper.shift;
      const r = info(plan.edge.index);
      if (s.taper.length >= need * 0.98 - 0.05 || r.from === 'width' || r.gali) continue;
      const want = driveCount(att.target.cs);
      const have = driveCount(nominal[plan.edge.index] as CrossSection);
      if (raise((source[plan.edge.index] as GraphEdge).id, want, have)) retry = true;
      else if (!att.own && want !== have) {
        // the lanes of the zone cannot be reached in the length there is, and the road may not carry more: the split
        // is built as a junction, where the lanes are joined by paths
        const node = atStart ? plan.edge.a : plan.edge.b;
        if (zoneNode.has(node)) {
          noZone.add(node);
          retry = true;
        }
      }
    }
  }
  const stripAt = (e: GEnd): { strip: number; end: StripEnd; lanes: number[] } | null => {
    const b = built.get(e.edge);
    if (!b) return null;
    return e.atStart ? { strip: b.first, end: 'start', lanes: b.startLanes } : { strip: b.last, end: 'end', lanes: b.endLanes };
  };
  const zoneStrips: number[] = [];
  for (const z of zones) {
    const zi = strips.length;
    zoneStrips.push(zi);
    strips.push(z.strip);
    const p = stripAt(z.parent);
    if (p) {
      const lanes: [number, number][] = [];
      for (let j = 0; j < z.targetCount; j++) {
        const own = z.parent.atStart ? z.targetCount - 1 - j : j;
        const sl = p.lanes[own];
        if (sl !== undefined && sl >= 0) lanes.push([z.targetToZone[j] as number, sl]);
      }
      joints.push({ a: { strip: zi, end: 'start' }, b: { strip: p.strip, end: p.end }, lanes, kind: 'split' });
    }
    for (const [branch, first, count] of [[z.left, z.leftFirst, z.leftCount], [z.right, z.rightFirst, z.rightCount]] as [GEnd, number, number][]) {
      const b = stripAt(branch);
      if (!b) continue;
      const lanes: [number, number][] = [];
      for (let kf = 0; kf < count; kf++) {
        const own = branch.atStart ? kf : count - 1 - kf;
        const sl = b.lanes[own];
        if (sl !== undefined && sl >= 0) lanes.push([first + kf, sl]);
      }
      joints.push({ a: { strip: zi, end: 'end' }, b: { strip: b.strip, end: b.end }, lanes, kind: 'split' });
    }
  }
  lap('strips');

  // ---------------------------------------------------------------- junctions with their paths, and the ends
  const junctions: LaneJunction[] = [];
  const junctionPlans: JunctionPlan[] = [];
  const ends: ExplainedEnd[] = [];
  const turnsReport = { uTurnsTooTight: 0, restricted: 0, droppedForRadius: 0, tight: 0 };
  const tightPaths: LaneBuild['tightPaths'] = [];
  const signals = (input.points ?? []).filter((p) => p.kind === 'signals');
  const crossingsAt = (input.points ?? []).filter((p) => p.kind === 'crossing');
  const MAIN = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
  const closure = (node: string): EndKind => {
    const c = input.marks?.[node]?.['closure'];
    return c === 'gate' || c === 'loop' || c === 'barricade' ? c : 'dead_end';
  };
  for (const root of [...planned.keys()].sort((a, b) => a - b)) {
    const pl = planned.get(root) as Planned;
    const jp = pl.jp;
    const arms = jp.arms.map((a) => stripAt(a.end));
    if (arms.some((a) => a === null)) {
      problems.push(`${jp.id}: an arm has no surface; the junction is left out`);
      continue;
    }
    const nodes = jp.nodes.map((n) => nodeId[n] as string);
    if (jp.arms.length === 1) {
      // every other road here is part of the junction: the one arm ends
      const a = arms[0] as { strip: number; end: StripEnd };
      ends.push({ strip: a.strip, end: a.end, node: nodes[0] as string, kind: 'junction_stub', why: 'the only road left at a junction whose other arms are shorter than its cuts' });
      continue;
    }
    const near = (list: readonly P2[], r: number): boolean => list.some((p) => jp.nodes.some((n) => Math.hypot((graph.nodes.get(n) as GNode).x - p.x, (graph.nodes.get(n) as GNode).z - p.z) <= r));
    const control = near(signals, 25) ? 'signals' : 'priority';
    const lanePoint = (arm: number, k: number): { strip: number; lane: number; x: number; z: number; ox: number; oz: number } => {
      const a = arms[arm] as { strip: number; end: StripEnd; lanes: number[] };
      const ap = jp.arms[arm] as ArmPlan;
      const n = ap.cs.lanes.length;
      const sl = a.lanes[ap.end.atStart ? k : n - 1 - k] as number;
      const st = endOf(strips[a.strip] as Strip, a.end);
      const lat = ((st.b[sl] as number) + (st.b[sl + 1] as number)) / 2;
      // the tangent of the station order is (-nz, nx); away from the junction it points along a strip that starts here
      const sign = a.end === 'start' ? 1 : -1;
      return { strip: a.strip, lane: sl, x: st.x + st.nx * lat, z: st.z + st.nz * lat, ox: -st.nz * sign, oz: st.nx * sign };
    };
    const paths: LanePath[] = [];
    for (const t of pl.turns) {
      const f = lanePoint(t.from, t.fromLane);
      const g = lanePoint(t.to, t.toLane);
      const geo = turnPath({ x: f.x, z: f.z, hx: -f.ox, hz: -f.oz }, { x: g.x, z: g.z, hx: g.ox, hz: g.oz });
      paths.push({
        from: [f.strip, f.lane], to: [g.strip, g.lane], fromArm: t.from, toArm: t.to, turn: t.kind, radius: Number.isFinite(geo.radius) ? Math.round(geo.radius * 100) / 100 : null,
        length: Math.round(geo.length * 100) / 100, pts: geo.pts.map((p) => ({ x: Math.round(p.x * 1000) / 1000 + 0, z: Math.round(p.z * 1000) / 1000 + 0 })),
      });
    }
    for (const p of paths) {
      if (p.radius !== null && p.radius < MIN_TURN_RADIUS_M) tightPaths.push({ junction: jp.id, fromArm: p.fromArm, toArm: p.toArm, radius: p.radius, why: 'the only way on for this lane: the two roads meet side by side at a sharp angle and the junction has no room for a wider turn' });
    }
    turnsReport.uTurnsTooTight += pl.uTurnsTooTight;
    turnsReport.restricted += pl.restricted;
    turnsReport.droppedForRadius += pl.dropped;
    turnsReport.tight += pl.tight;
    junctionPlans.push(jp);
    junctions.push({
      id: jp.id, nodes, centre: { x: Math.round(jp.centre.x * 1000) / 1000 + 0, z: Math.round(jp.centre.z * 1000) / 1000 + 0 }, control,
      arms: jp.arms.map((ap, i) => {
        const a = arms[i] as { strip: number; end: StripEnd };
        const s = strips[a.strip] as Strip;
        const crossing = (control === 'signals' || near(crossingsAt, 30) || (MAIN.has(s.cls) && s.lanes.some((l) => l.type === 'footpath'))) && !s.link && Math.abs(endOf(s, 'end').s - endOf(s, 'start').s) > 14;
        return { strip: a.strip, end: a.end, edge: (source[ap.end.edge] as GraphEdge).id, cut: Math.round(ap.cut * 1000) / 1000, stopBack: crossing ? 4 : 0, crossing };
      }),
      pairs: pl.pairs, paths,
    });
  }
  for (const n of graph.nodes.values()) {
    if (n.ends.length !== 1 || absorbed.has((n.ends[0] as GEnd).edge)) continue;
    const s = stripAt(n.ends[0] as GEnd);
    if (!s) continue;
    const id = nodeId[n.id] as string;
    const kind: EndKind = nodeKind[n.id] === 'map_edge' ? 'map_edge' : closure(id);
    ends.push({ strip: s.strip, end: s.end, node: id, kind, why: kind === 'map_edge' ? 'the road goes on outside the stage being baked' : `the road ends here (${kind.replace('_', ' ')})` });
  }
  lap('paths');
  const internal = [...absorbed].sort((a, b) => a[0] - b[0]).map(([i, why]) => ({ edge: (source[i] as GraphEdge).id, why }));
  return {
    build: { road, plans, streets, strips, joints, zones, zoneStrips, junctions, junctionPlans, ends, internal, forks, widenings, fitted: [], tightPaths, turns: turnsReport, built, problems, rounds: 0, ms },
    retry,
  };
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const r6 = (v: number): number => Math.round(v * 1e6) / 1e6 + 0;

/** Rounds every station to the millimetre (frames to a millionth), so the model in memory is the model on disk. */
function roundModel(b: LaneBuild): void {
  for (const s of b.strips) {
    for (const st of s.st) {
      st.x = r3(st.x);
      st.z = r3(st.z);
      st.s = r3(st.s);
      st.nx = r6(st.nx);
      st.nz = r6(st.nz);
      st.b = st.b.map(r3);
    }
    if (s.taper) s.taper = { length: r3(s.taper.length), shift: r3(s.taper.shift), needed: r3(s.taper.needed) };
  }
  for (const z of b.zones) {
    z.dNose = r3(z.dNose);
    z.dPainted = r3(z.dPainted);
  }
}
