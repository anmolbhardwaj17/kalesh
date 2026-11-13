// The map health report harness/reports/map/health.json (MAP_REPAIR.md "Verification"), skeleton of P1-007, and the
// bake invariants: a failed invariant stops the bake before it writes tiles (TECH.md "World pipeline"). Pure; the
// driver writes the file. The report holds no clock time, so the same inputs give the same file (except the graph
// step's build time, `graph.buildMs`, which the acceptance asks for).
import type { GraphCounts } from '../graph/checks.ts';
import type { RepairResult, RepairSummary } from '../repair/engine.ts';
import type { BuildingsRecord } from '../repair/clear.ts';
import type { OverrideCounts, OverrideRecord } from '../repair/overrides.ts';

import type { ElevationRecord } from '../elevation/elevout.ts';
import type { LanesRecord } from '../roads/laneout.ts';
import type { MeshRecord } from '../mesh/meshout.ts';
import type { TerrainRecord } from '../terrain/terrainout.ts';
import type { TilesRecord } from '../tile/tilesout.ts';
import type { GateReport } from './gates.ts';

export const HEALTH_VERSION = 8;

export interface InvariantResult {
  id: string;
  ok: boolean;
  detail: string;
}

export interface HealthSource {
  id: string;
  kind: string;
  action: string;
  file: string;
  sha256: string | null;
  licence: string | null;
  credit: string | null;
}

export interface PairRecord {
  a: string;
  b: string;
  realM: number;
  gameM: number;
  errorPct: number;
  realBearingDeg: number;
  gameBearingDeg: number;
  bearingErrorDeg: number;
  ok: boolean;
}

export interface LayoutRecord {
  centrePlaces: number;
  centrePairs: number;
  worstPairBearingDeg: number;
  worstPairDistancePct: number;
  /** Every block: translation only (north on -Z, east on +X, determinant +1, no scale). */
  blocks: { id: string; offset: { x: number; z: number }; translationOnly: boolean; northOffDeg: number; determinant: number }[];
  far: { block: string; realM: number; realBearingDeg: number; gameM: number; gameBearingDeg: number; bearingErrorDeg: number; distanceErrorPct: number }[];
  blockGapMinM: number;
  blockGapBetween: [string, string] | null;
  mapBoxKm: { width: number; depth: number };
  /** Radius of the smallest circle round every position: no world origin can do better. */
  smallestCircleKm: number;
  reachFromBoxCentreKm: number;
  originAfterRecentre: { x: number; z: number };
  reachAfterRecentreKm: number;
  reachNowKm: number;
}

export interface HealthReport {
  _doc: string;
  version: number;
  stage: string;
  block: string;
  outline: { file: string; areaKm2: number; box: { south: number; west: number; north: number; east: number } };
  /** Steps that ran, in order. */
  steps: string[];
  sources: HealthSource[];
  ground: { source: string; method: string; cols: number; rows: number; cell: number; minM: number; maxM: number; meanM: number; samples: number; holes: number } | null;
  /** Filled by the repair step; zero until it runs in the production bake. */
  issues: { total: number; byRule: Record<string, number>; open: number };
  repairs: { auto: number; byRule: Record<string, number> };
  /** The override patches read (harness/data/overrides/) and what became of each; zero when the repair step did not run. */
  overrides: OverrideHealth;
  /** The headline counts the dashboard shows: found, repaired on their own, fixed by overrides, stale overrides, left open. */
  counts: MapCounts | null;
  /** The gate counts of MAP_REPAIR.md "Verification": null until the step that measures them exists. */
  gates: Record<string, number | null>;
  /** The block graph (tools/bake/graph/): counts, checks, hash and build time; null until the graph step runs. */
  graph: GraphRecord | null;
  /** The repair step (tools/bake/repair/): counts by rule, the automatic share, times and files; null until it runs. */
  repair: RepairRecord | null;
  /** The lane model (tools/bake/roads/network.ts): counts, checks with every explained end and taper finding, hash and build time; null until the lanes step runs. */
  lanes: LanesRecord | null;
  /** The elevation solve (tools/bake/elevation/): the solver's counts and time, the checks, every structure with its kind, sunk and structureM; null until the elevation step runs. */
  elevation: ElevationRecord | null;
  /** The road mesh (tools/bake/mesh/): counts, build time, the overlap proof, the watertight check, ends, structures, kerbs, lane UV and stop lines; null until the mesh step runs. */
  mesh: MeshRecord | null;
  /** The ground (tools/bake/terrain/): counts, build time, the road to ground gap, needles, tile seams, areas, water; null until the terrain step runs. */
  terrain: TerrainRecord | null;
  /** The pair table of the centre block (rule R-STITCH-03): real against game bearing and distance for every pair of centre places. */
  pairs: PairRecord[];
  /** What rule R-STITCH measured on the layout (tools/bake/layout/gate.ts); null when it did not run. */
  layout: LayoutRecord | null;
  invariants: InvariantResult[];
  /** True when an invariant failed: no tile was written. */
  stoppedBeforeTiles: boolean;
  /** The tile step (tools/bake/tile/): what was written, where, the checks on the bytes read back; record is null until it runs. */
  tiles: { written: number; out: string | null; only: string[] | null; record?: TilesRecord };
  /** The six gate counts item by item, each explained or not, and the known findings with their owners (P1-017); set before the tile step. */
  gateReport?: GateReport;
  /** What the bake decided on its own and what is left for the owner (P1-030); set by the repair step. */
  decisions?: DecisionCounts;
  /** Buildings taken off the road faces after the mesh step (P1-030, repair/clear.ts): counts by action, what is left (0). */
  buildings?: BuildingsRecord;
  /** Underground structures (P1-041, graph/underground.ts): every one with its reason, and what the class took out; set by the graph and repair steps. */
  underground?: UndergroundHealth;
}

export interface UndergroundHealth {
  count: number;
  /** By how the class was decided: "tag" or "list". */
  by: Record<string, number>;
  byKind: Record<string, number>;
  /** List entries the extract does not have. */
  missing: string[];
  features: { id: string; name: string; kind: string; reason: string; by: string; source: string; areaM2: number; copies: string[]; footprint: boolean }[];
  /** Issues the rules raise on the raw graph when the ones the source drew as buildings are put back as ordinary footprints: what the class removed. Null until the repair step runs. */
  issuesRemoved: { total: number; byRule: Record<string, number>; byFeature: Record<string, number> } | null;
  /** Override patches retired because they name an underground structure (kept in their files, not applied). */
  overridesRetired: string[];
}

/** The health record of the underground features of a graph (the repair step adds issuesRemoved and overridesRetired). */
export function undergroundHealth(features: readonly { id: string; name: string; kind: string; reason: string; by: string; source: string; area: number; copies: readonly string[]; footprint: boolean }[], missing: readonly string[]): UndergroundHealth {
  const tally = (xs: readonly string[]): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const x of xs) out[x] = (out[x] ?? 0) + 1;
    return out;
  };
  return {
    count: features.length, by: tally(features.map((f) => f.by)), byKind: tally(features.map((f) => f.kind)), missing: [...missing],
    features: features.map((f) => ({ id: f.id, name: f.name, kind: f.kind, reason: f.reason, by: f.by, source: f.source, areaM2: f.area, copies: [...f.copies], footprint: f.footprint })),
    issuesRemoved: null, overridesRetired: [],
  };
}

export interface OverrideHealth extends OverrideCounts {
  /** Patches of the files whose anchor lies outside this stage (another stage reads them): not counted above. */
  outsideStage: number;
  /** One record per patch of this stage. Stale ones stay in their files; they are listed here and in the dashboard. */
  records: OverrideRecord[];
}

export interface MapCounts {
  found: number;
  byRule: Record<string, number>;
  repairedAuto: number;
  /** Issues a patch of the owner (or a hand written patch) settled. */
  fixedByOverrides: number;
  /** Repairs a disable_repair patch switched off. */
  repairsSwitchedOff: number;
  staleOverrides: number;
  /** Queued for a person and not settled by a patch. */
  leftOpen: number;
  /** Of those, impact 0.7 or more. */
  highImpactOpen: number;
  explained: number;
}

/** The headline counts of a repair result: found by rule, repaired on their own, fixed by overrides, stale, left open. */
export function mapCounts(res: Pick<RepairResult, 'issues' | 'overrides' | 'overrideCounts' | 'summary'>): MapCounts {
  const s = res.summary;
  const byRule: Record<string, number> = {};
  for (const r of s.byRule) if (r.issues) byRule[r.rule] = r.issues;
  const settledBy = (outcome: string): number => res.issues.filter((i) => i.status === 'overridden' && res.overrides.some((o) => o.outcome === outcome && o.issues.includes(i.id))).length;
  return {
    found: s.total, byRule, repairedAuto: s.auto, fixedByOverrides: settledBy('fixed'), repairsSwitchedOff: settledBy('kept'),
    staleOverrides: res.overrideCounts.stale, leftOpen: s.queued, highImpactOpen: s.highImpact, explained: s.explained,
  };
}

/**
 * What the bake decided on its own and what is left for the owner (P1-030, health.json `decisions`): the owner queue,
 * buildings on roads by who gave way, roads on each other by how they were settled, dead ends by how they were closed.
 * The building counts by action (moved, cut, cut in two, dropped) are in `buildings`, measured on the road mesh.
 */
export interface DecisionCounts {
  /** Issues that wait for the owner, each with a plain question (the inspector's card). */
  ownerQueue: number;
  byPolicy: number;
  byJudge: number;
  buildings: { issues: number; roadGaveWay: number; footpathGaveWay: number; buildingGivesWay: number; unresolved: number };
  overlaps: {
    /** Roads beside or on each other moved apart, by rule. */
    separated: Record<string, number>;
    /** One road drawn twice: the copy dropped. */
    duplicatesRemoved: number;
    /** Roads that run into each other at a shared node: split and merge zones of the lane model (filled by the lanes step). */
    mergedZones: { merges: number; diverges: number } | null;
    unresolved: number;
  };
  deadEnds: { issues: number; connectedByRule: number; closedByRule: Record<string, number>; connectedByJudge: number; closedByJudge: number; unresolved: number };
}

export function decisionCounts(res: Pick<RepairResult, 'issues' | 'repairs' | 'summary'>): DecisionCounts {
  const of = (rule: string) => res.issues.filter((i) => i.rule === rule);
  const settled = (rule: string): number => of(rule).filter((i) => i.status === 'auto_repaired' || i.status === 'overridden').length;
  const b = of('R-BLDG-01');
  const top = (i: (typeof b)[number]): { key?: unknown; op?: unknown } => (i.proposals[0]?.params ?? {}) as { key?: unknown; op?: unknown };
  const done = b.filter((i) => i.status === 'auto_repaired' || i.status === 'overridden');
  const d = of('R-ROAD-01');
  const ruleLines = res.repairs.filter((l) => l.rule === 'R-ROAD-01' && !l.override);
  const closedByRule: Record<string, number> = {};
  for (const l of ruleLines) if (l.patch.action === 'terminate') closedByRule[String(l.patch.params['with'] ?? 'dead_end')] = (closedByRule[String(l.patch.params['with'] ?? 'dead_end')] ?? 0) + 1;
  const judged = res.repairs.filter((l) => l.rule === 'R-ROAD-01' && l.override && l.patch.by === 'judge');
  const separated: Record<string, number> = {};
  for (const rule of ['R-LANE-FIT-01', 'R-LANE-FIT-02', 'R-LANE-04', 'R-LANE-05', 'R-LANE-06']) if (settled(rule)) separated[rule] = settled(rule);
  const open = (rules: readonly string[]): number => res.issues.filter((i) => rules.includes(i.rule) && i.status === 'open').length;
  return {
    ownerQueue: res.summary.queued, byPolicy: res.summary.decidedPolicy, byJudge: res.summary.decidedJudge,
    buildings: {
      issues: b.length, roadGaveWay: done.filter((i) => top(i).key === 'width').length, footpathGaveWay: done.filter((i) => String(top(i).key ?? '').startsWith('footpath:')).length,
      buildingGivesWay: done.filter((i) => top(i).op === 'give_way').length, unresolved: b.length - done.length,
    },
    overlaps: { separated, duplicatesRemoved: settled('R-ROAD-03'), mergedZones: null, unresolved: open(['R-ROAD-03', 'R-LANE-FIT-01', 'R-LANE-FIT-02', 'R-LANE-04', 'R-LANE-05', 'R-LANE-06', 'R-ROAD-02']) },
    deadEnds: {
      issues: d.length, connectedByRule: ruleLines.filter((l) => l.patch.action === 'connect').length, closedByRule,
      connectedByJudge: judged.filter((l) => l.patch.action === 'connect').length, closedByJudge: judged.filter((l) => l.patch.action === 'terminate').length, unresolved: d.filter((i) => i.status === 'open').length,
    },
  };
}

export const emptyOverrides = (): OverrideHealth => ({ files: 0, patches: 0, byId: 0, byAnchor: 0, stale: 0, applied: 0, switchedOff: 0, idle: 0, issuesSettled: 0, underground: 0, outsideStage: 0, records: [] });

export interface GraphRecord {
  file: string;
  picture: string[];
  hash: string;
  buildMs: number;
  counts: GraphCounts;
  checks: { duplicateEdges: number; zeroLengthEdges: number; missingNodes: number; orphanNodes: number; crossingsWithoutEnd: number; badMapEdgeNodes: number; ok: boolean };
  normalised: { snappedNodes: number; duplicateWays: number; degenerateWays: number; nicks: number; excursions: number; footways: number };
  footprintMerge: Record<string, { input: number; added: number; duplicate: number; conflict: number; tiny: number }>;
}

export interface RepairRecord {
  files: { graph: string; issues: string; repairs: string; picture: string[] };
  /** Hash of the repaired graph. */
  hash: string;
  /** Time of each rule on the raw graph (ms), their sum, and the whole repair step. */
  rulesMs: Record<string, number>;
  rulesTotalMs: number;
  repairMs: number;
  summary: RepairSummary;
  /** Repairs a second run on the repaired graph applies: 0, or the bake stops. */
  secondRunRepairs: number;
  /** Queued issues with no proposal that has a confidence, a reasoning line and a preview: 0, or the bake stops. */
  queuedWithoutProposal: number;
  heroEdges: number;
  /** The lane model's feedback (repair/feedback.ts, rule R-LANE-06): each round's strip overlap and the conflicts handed back. */
  laneFeedback?: { rounds: { overlapM2: number; pairs: number; conflicts: number; skipped: Record<string, number> }[]; conflicts: number };
}

export const GATE_KEYS = ['openPorts', 'floatingEnds', 'unjoinedEnds', 'overlappingRoadFaces', 'laneContinuityBreaks', 'tapersOutOfLimits'] as const;

export function emptyHealth(stage: string, block: string, outline: HealthReport['outline']): HealthReport {
  const gates: Record<string, number | null> = {};
  for (const k of GATE_KEYS) gates[k] = null;
  return {
    _doc: 'Map health report of the last bake (MAP_REPAIR.md "Verification"), written by tools/bake/main.ts. issues, repairs, overrides, counts and gates are filled by the steps that measure them; null means not measured yet. counts is the short form for the dashboard (found by rule, repaired on their own, fixed by overrides, stale overrides, left open); overrides lists every patch read with its outcome (fixed, kept, idle, stale). pairs and layout come from rule R-STITCH, which runs in every bake before the first step. graph holds the block graph counts (nodes, edges, paired carriageways, footprints, rail, water), its checks and hash. elevation holds the height solve (its checks, every structure with its kind, sunk and structureM, the map edge ties). repair holds the rule engine and auto-repair result (issues by rule, repaired on their own, queued, explained, the time per rule). A failed invariant stops the bake before tiles are written (stoppedBeforeTiles).',
    version: HEALTH_VERSION,
    stage,
    block,
    outline,
    steps: [],
    sources: [],
    ground: null,
    issues: { total: 0, byRule: {}, open: 0 },
    repairs: { auto: 0, byRule: {} },
    overrides: emptyOverrides(),
    counts: null,
    gates,
    graph: null,
    repair: null,
    lanes: null,
    elevation: null,
    mesh: null,
    terrain: null,
    pairs: [],
    layout: null,
    invariants: [],
    stoppedBeforeTiles: false,
    tiles: { written: 0, out: null, only: null },
  };
}

/** Error thrown by the driver when an invariant fails: it carries the report to write before exiting. */
export class BakeStop extends Error {
  readonly failed: InvariantResult[];
  constructor(failed: InvariantResult[]) {
    super(`bake stopped before writing tiles: ${failed.map((f) => `${f.id} (${f.detail})`).join('; ')}`);
    this.failed = failed;
  }
}

/** Adds the results to the report and returns the failed ones. */
export function recordInvariants(report: HealthReport, results: readonly InvariantResult[]): InvariantResult[] {
  report.invariants.push(...results);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) report.stoppedBeforeTiles = true;
  return failed;
}
