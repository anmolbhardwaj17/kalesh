// Shared types and constants of the lane model builder (network.ts and its phases netzones.ts, netclusters.ts,
// netstrips.ts). The public types of the model (LaneBuild, LaneJunction, ...) live here and are re-exported by
// network.ts, the module every caller imports. Pure.
import type { P2 } from '../geom.ts';
import type { GraphEdge, GraphNode } from '../graph/build.ts';
import type { RoadFilter, RoadGraph } from './blockgraph.ts';
import type { ArmView, Turn, TurnKind, TurnRestriction } from './connect.ts';
import type { EdgeTrims } from './edges.ts';
import type { Graph } from './graph.ts';
import type { HeroSpec } from './hero.ts';
import type { JunctionPlan } from './junction.ts';
import type { EdgePlan, Zone } from './lanes.ts';
import { MIN_TURN_RADIUS_M } from './model.ts';
import type { Joint, Station, Strip, StripEnd } from './model.ts';
import type { StreetResult } from './street.ts';
import type { GEnd } from './graph.ts';

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
  /** Where the edge lanes (footpath, kerb, planter) of two strips beside each other give way so the surfaces do not overlap (edges.ts). */
  edgeTrims: EdgeTrims;
  /** First and last strip of every edge that has strips, and the strip lane of every lane of its end cross-sections. */
  built: Map<number, { first: number; last: number; startLanes: number[]; endLanes: number[] }>;
  problems: string[];
  rounds: number;
  ms: Record<string, number>;
}

/** Junction nodes joined by an edge up to this long are one junction (the same number as rule R-JUNC-03 reads). */
export const CLUSTER_GAP_M = 18;
export const MIN_STRIP_M = 1.5;
/** Paths are planned with a margin: the strips' own frames differ a little from the planned ones. */
export const PLAN_RADIUS_M = MIN_TURN_RADIUS_M + 0.35;
/** Only an edge shorter than this may become part of a junction to make room for a turn. */
export const ABSORB_MAX_M = 45;
export const CUT_ESTIMATE_M = 9;
export const MAX_ROUNDS = 4;
export const PASSES = 7;
/** A road too short for a taper may carry this many lanes more than its street's count (an auxiliary lane between two slip roads). */
export const EXTRA_LANES = 1;

export const endOf = (s: Strip, end: StripEnd): Station => (end === 'start' ? s.st[0] : s.st[s.st.length - 1]) as Station;
export const endKey = (e: GEnd): number => e.edge * 2 + (e.atStart ? 0 : 1);

/** One round of the builder: the inputs and the settled lane counts every phase reads. */
export interface NetCtx {
  input: LaneModelInput;
  road: RoadGraph;
  graph: Graph;
  source: GraphEdge[];
  nodeId: string[];
  nodeKind: GraphNode['kind'][];
  heroes: readonly HeroSpec[];
  heroBy: (HeroSpec | null)[];
  isHero: (i: number) => boolean;
  indexOf: Map<string, number>;
  /** Lane counts the model settled (kept over rounds). */
  fixed: Map<string, number>;
  /** Split nodes built as junctions (kept over rounds). */
  noZone: Set<number>;
  problems: string[];
  step: number;
}

/** A junction cluster with its arms, the turns the rules allow and the counts of the turns left out. */
export interface Planned {
  jp: JunctionPlan;
  views: ArmView[];
  turns: Turn[];
  pairs: { from: number; to: number; kind: TurnKind }[];
  uTurnsTooTight: number;
  restricted: number;
  dropped: number;
  tight: number;
}
