// The map health report harness/reports/map/health.json (MAP_REPAIR.md "Verification"), skeleton of P1-007, and the
// bake invariants: a failed invariant stops the bake before it writes tiles (TECH.md "World pipeline"). Pure; the
// driver writes the file. The report holds no clock time, so the same inputs give the same file (except the graph
// step's build time, `graph.buildMs`, which the acceptance asks for).
import type { GraphCounts } from '../graph/checks.ts';
import type { RepairSummary } from '../repair/engine.ts';

export const HEALTH_VERSION = 4;

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
  /** Filled by the rule engine, auto-repair and overrides tasks; zero until they run in the production bake. */
  issues: { total: number; byRule: Record<string, number>; open: number };
  repairs: { auto: number; byRule: Record<string, number> };
  overrides: { applied: number; stale: number };
  /** The gate counts of MAP_REPAIR.md "Verification": null until the step that measures them exists. */
  gates: Record<string, number | null>;
  /** The block graph (tools/bake/graph/): counts, checks, hash and build time; null until the graph step runs. */
  graph: GraphRecord | null;
  /** The repair step (tools/bake/repair/): counts by rule, the automatic share, times and files; null until it runs. */
  repair: RepairRecord | null;
  /** The pair table of the centre block (rule R-STITCH-03): real against game bearing and distance for every pair of centre places. */
  pairs: PairRecord[];
  /** What rule R-STITCH measured on the layout (tools/bake/layout/gate.ts); null when it did not run. */
  layout: LayoutRecord | null;
  invariants: InvariantResult[];
  /** True when an invariant failed: no tile was written. */
  stoppedBeforeTiles: boolean;
  tiles: { written: number; out: string | null; only: string[] | null };
}

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
}

export const GATE_KEYS = ['openPorts', 'floatingEnds', 'unjoinedEnds', 'overlappingRoadFaces', 'laneContinuityBreaks', 'tapersOutOfLimits'] as const;

export function emptyHealth(stage: string, block: string, outline: HealthReport['outline']): HealthReport {
  const gates: Record<string, number | null> = {};
  for (const k of GATE_KEYS) gates[k] = null;
  return {
    _doc: 'Map health report of the last bake (MAP_REPAIR.md "Verification"), written by tools/bake/main.ts. issues, repairs, overrides and gates are filled by the steps that measure them; null means not measured yet. pairs and layout come from rule R-STITCH, which runs in every bake before the first step. graph holds the block graph counts (nodes, edges, paired carriageways, footprints, rail, water), its checks and hash. repair holds the rule engine and auto-repair result (issues by rule, repaired on their own, queued, explained, the time per rule). A failed invariant stops the bake before tiles are written (stoppedBeforeTiles).',
    version: HEALTH_VERSION,
    stage,
    block,
    outline,
    steps: [],
    sources: [],
    ground: null,
    issues: { total: 0, byRule: {}, open: 0 },
    repairs: { auto: 0, byRule: {} },
    overrides: { applied: 0, stale: 0 },
    gates,
    graph: null,
    repair: null,
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
