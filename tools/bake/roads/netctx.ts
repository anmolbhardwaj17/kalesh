// Shared types and constants of the lane model builder (network.ts and its phases netzones.ts, netclusters.ts,
// netstrips.ts). The public types of the model (LaneBuild, LaneJunction, ...) live here and are re-exported by
// network.ts, the module every caller imports. Pure.
import type { P2 } from '../geom.ts';
import type { GraphEdge, GraphNode } from '../graph/build.ts';
import type { RoadFilter, RoadGraph } from './blockgraph.ts';
import type { ArmView, Turn, TurnKind, TurnRestriction } from './connect.ts';
import type { EndClips } from './clip.ts';
import type { EdgeTrims } from './edges.ts';
import type { DividerFit } from './dividers.ts';
import type { MedianRef } from './medianrefs.ts';
import type { Graph } from './graph.ts';
import type { HeroSpec } from './hero.ts';
import type { JunctionPlan } from './junction.ts';
import type { EdgePlan, Zone } from './lanes.ts';
import { MIN_TURN_RADIUS_M } from './model.ts';
import type { Joint, Station, Strip, StripEnd } from './model.ts';
import type { StreetResult, WidthFixed } from './street.ts';
import type { MappedRestriction, RestrictionReport, TurnInputs } from './turns.ts';
import type { MidCrossingReport } from './crossings.ts';
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
  /** OSM turn restriction relations and turn lane tags (the osm_turns pin and harness/data/turn_lanes.json, P1-032). */
  turnInputs?: TurnInputs;
  /** Tagged crossings and traffic signals of the map, block metres; `marked` false for a crossing with no markings (P1-032). */
  points?: readonly { x: number; z: number; kind: 'crossing' | 'signals'; id?: string; marked?: boolean }[];
  filter?: RoadFilter;
  /** Station spacing in metres. */
  step?: number;
  /** false: no width step rounds (P1-046), for tests and the before picture of the width report. */
  widthContinuity?: boolean;
  /** Reference dividers of divided streets (harness/data/medians.json): the carriageways widen up to them (dividers.ts, P1-034). */
  medianRefs?: readonly MedianRef[];
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
  /**
   * Width of the raised edge (kerb, footpath, planter) on the arm's left and right, looking away from the junction, at
   * the strip end after the edges gave way (edges.ts) and free ends were clipped: what the junction's raised corners
   * must meet (P1-033). The junction plan itself (JunctionPlan bands) still holds the nominal cross-section.
   */
  edges: [number, number];
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
  /** What the width step settled (P1-046): tapers at junction ends and whole edges, with the rounds it took. */
  widthFixes: { tapers: WidthTaper[]; whole: (WidthFixed & { edge: string })[]; rounds: number; left: number };
  /** Roads that took the lane count they would have tapered to (too short for the taper). */
  fitted: { edge: string; lanes: number }[];
  /** U-turns and other turns the rules or the radius left out, and turns kept under the radius because a lane has no other way on. */
  turns: { uTurnsTooTight: number; restricted: number; droppedForRadius: number; tight: number };
  /** Turn rules from the map (P1-032): restrictions read, mapped and applied, turn lanes read and applied, by source. */
  turnRules: TurnRulesReport;
  /** Crossings away from every junction (P1-032): drawn across their strip with stop lines on both sides. */
  crossings: MidCrossing[];
  crossingReport: MidCrossingReport;
  /** Paths under the minimum radius, each with its reason: the only way on for a lane where the junction has no room. */
  tightPaths: { junction: string; fromArm: number; toArm: number; radius: number; why: string }[];
  /** Where the edge lanes (footpath, kerb, planter) of two strips beside each other give way so the surfaces do not overlap (edges.ts). */
  edgeTrims: EdgeTrims;
  /** Free ends (dead ends, the stage edge) shortened where they ran into another road's surface (clip.ts). */
  endClips: EndClips;
  /** Carriageways widened up to their reference divider (dividers.ts, P1-034). */
  dividers?: DividerFit;
  /** First and last strip of every edge that has strips, and the strip lane of every lane of its end cross-sections. */
  built: Map<number, { first: number; last: number; startLanes: number[]; endLanes: number[] }>;
  problems: string[];
  rounds: number;
  ms: Record<string, number>;
}

export interface TurnRulesReport {
  restrictions: RestrictionReport & {
    /** Mapped restrictions whose from and to edges are arms of the cluster that holds the via. */
    applied: number;
    /** Relations that were mapped but never applied, with why. */
    notApplied: { id: string; why: string }[];
    /** Movements (arm pairs) the restrictions took out. */
    movementsRemoved: number;
  };
  turnLanes: { ways: number; bySource: Record<string, number>; arms: number; applied: number; mismatched: { edge: string; why: string }[]; movementsRemoved: number };
}

/** A crossing away from the junctions: where it lies along its strip and which way traffic stops before it. */
export interface MidCrossing {
  id: string;
  source: 'osm' | 'patch';
  strip: number;
  /** Metres along the strip's reference line from its first station. */
  along: number;
  /** The station `s` there (metres along the source edge). */
  s: number;
  x: number;
  z: number;
  /** Width of the zebra along the road (m). */
  width: number;
}

/** Junction nodes joined by an edge up to this long are one junction (the same number as rule R-JUNC-03 reads). */
export const CLUSTER_GAP_M = 18;
export const MIN_STRIP_M = 1.5;
/** Paths are planned with a margin: the strips' own frames differ a little from the planned ones. */
export const PLAN_RADIUS_M = MIN_TURN_RADIUS_M + 0.35;
/** Only an edge shorter than this may become part of a junction to make room for a turn. */
export const ABSORB_MAX_M = 45;
/**
 * The longest cut a turn may ask an arm for (m): the minimum radius needs 10.5 m at 135 degrees. With no limit, turns
 * across a long cluster asked for cuts of 90 percent of an arm, edges of 290 m became part of the junction and the
 * cluster grew to 11 arms over 300 m (Kashmere Gate, P1-042).
 */
export const TURN_ASK_MAX_M = 30;
/**
 * The longest cut that keeps an arm clear of the other arms (m, junction.ts clearCuts): a slow fork. Arms on each
 * other further out are roads drawn too close: the lane feedback hands them to the repair (surfaces.ts).
 */
export const CLEAR_MAX_M = 60;
export const CUT_ESTIMATE_M = 9;

/** A taper at one end of an edge to the cross-section of the road it runs on into across a junction (P1-046). */
export interface WidthTaper extends WidthFixed {
  edge: string;
  atStart: boolean;
  /** The junction whose step it closes. */
  junction: string;
  /** Length the taper needs (m), for the room check of a taper at the edge's other end. */
  need?: number;
  /** No road on either side had room for the class length: the taper takes what the road has (listed, explained). */
  short?: true;
}
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
  /** Whole edges the width step settled (kept over rounds, netwidths.ts). */
  widthFixed: Map<string, WidthFixed>;
  /** Tapers the width step asked for at an edge end, by "<edge id>|start" or "|end" (kept over rounds, netwidths.ts). */
  widthTapers: Map<string, WidthTaper>;
  /** Edge ends ("<edge id>|start") that may not take a width taper: one came out too short (kept over rounds). */
  widthBlocked: Set<string>;
  /** How often the width step settled each edge whole (kept over rounds). */
  widthSettles: Map<string, number>;
  /** Turn restrictions on graph edges (turns.ts mapRestrictions), the same every round. */
  turnRules: readonly MappedRestriction[];
  turnReport: RestrictionReport;
  problems: string[];
  step: number;
  /** Planned junction clusters of earlier rounds of this build by their inputs (netclusters.ts, P1-034); kept over rounds. */
  clusterMemo?: Map<string, ClusterMemo>;
}

/**
 * One planned cluster and what planning it wrote (netclusters.ts planCluster): a later round whose cluster has the
 * same inputs (nodes, arms, their cross-sections, strip parts and asked cuts) takes it as it is (P1-034: a width round
 * changes a few roads, every other junction comes out the same).
 */
export interface ClusterMemo {
  res: Planned;
  /** The strip part of every arm's edge plan after planning (t0, t1 by edge index). */
  parts: [number, number, number][];
  /** The cut each arm asked for after planning (end key, metres). */
  asked: [number, number][];
  /** Edges the cluster handed to the absorb list. */
  absorb: number[];
  /** The arms' cross-sections when it was stored (a guard: they are never changed in place). */
  csSig: string;
}

/** A junction cluster with its arms, the turns the rules allow and the counts of the turns left out. */
export interface Planned {
  jp: JunctionPlan;
  views: ArmView[];
  turns: Turn[];
  pairs: { from: number; to: number; kind: TurnKind }[];
  uTurnsTooTight: number;
  restricted: number;
  laneRestricted: number;
  laneArms: number;
  /** The map's restrictions this cluster applies, on its arms (P1-032). */
  rules: MappedRestriction[];
  dropped: number;
  tight: number;
}
