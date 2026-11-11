// Auto-repair for a whole block (AR1, MAP_REPAIR.md "Pipeline" step 4, "Auto-repair bounds", "Repair log"). The rules
// run in catalogue order on a copy of the block graph; after each rule the issues the bounds allow are repaired at
// once, so the rules after it see the repaired map (joins before junction checks, lane fits before lane checks,
// shifted carriageways before the building rule). Passes repeat until one applies nothing: a second run on the
// result applies no repair. What is left is marked explained (never changed) or queued, and a queued issue never
// blocks the bake: its top proposal is applied as provisional, except on a hero road. Every applied repair is a line
// of the repair log; every dropped feature is listed. Deterministic: the same graph gives the same result. Pure.
import type { BlockGraph } from '../graph/build.ts';
import { CATALOGUE, countByRule, detect } from '../rules/catalogue.ts';
import type { RuleCount } from '../rules/catalogue.ts';
import { FLOOR_M } from '../rules/buildings.ts';
import { RuleContext, byId } from '../rules/context.ts';
import type { Rule } from '../rules/context.ts';
import { patchOf, topProposal } from '../rules/types.ts';
import type { Issue, Marks, Patch, RuleEnv } from '../rules/types.ts';
import { applyPatch } from './apply.ts';
import type { RepairState } from './apply.ts';
import { decide } from './bounds.ts';

/** The block graph after the repair step: the same form, with the marks repairs left for later stages. */
export type RepairedGraph = BlockGraph & { marks: Marks };

/** One line of repairs.jsonl: an applied automatic repair. */
export interface RepairLine {
  rule: string;
  issue: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  confidence: number;
  /** The patch in the same form as an override. */
  patch: Patch;
  pass: number;
  note?: string;
}

export interface ProvisionalLine {
  rule: string;
  issue: string;
  action: string;
  applied: boolean;
  how: 'graph' | 'mark' | 'none';
  note: string;
  patch: Patch | null;
}

export interface DropLine {
  id: string;
  rule: string;
  issue: string;
  provisional: boolean;
}

export interface RepairSummary {
  total: number;
  auto: number;
  queued: number;
  explained: number;
  /** auto / total, and auto / (auto + queued): the share of the issues that needed a change. */
  autoShare: number;
  autoShareOfChanged: number;
  /** Queued issues with impact 0.7 or more. */
  highImpact: number;
  byRule: RuleCount[];
  /** The same count without the terrain outlier rule, which finds the most issues (as the Phase 0 census reported it). */
  withoutTerrainOutliers: { total: number; auto: number; autoShare: number };
  provisionalApplied: number;
  provisionalNotApplied: number;
  drops: number;
  passes: number;
  /** Issues that could still be repaired on their own after the last pass (0 unless the passes ran out). */
  unconverged: number;
  fills: { heightFromLevels: number; heightMissing: number };
}

export interface RepairResult {
  graph: RepairedGraph;
  issues: Issue[];
  repairs: RepairLine[];
  provisional: ProvisionalLine[];
  drops: DropLine[];
  summary: RepairSummary;
}

export interface RepairOptions {
  rules?: readonly Rule[];
  maxPasses?: number;
  /** Apply the top proposal of queued issues (default true). */
  provisional?: boolean;
}

const share = (a: number, b: number): number => (b === 0 ? 1 : Math.round((a / b) * 1000) / 1000);

export function repairGraph(raw: BlockGraph, env: RuleEnv, opts: RepairOptions = {}): RepairResult {
  const rules = opts.rules ?? CATALOGUE;
  const order = new Map(rules.map((r, i) => [r.id, i]));
  const graph = JSON.parse(JSON.stringify(raw)) as BlockGraph & { marks?: Marks };
  const state: RepairState = { graph, marks: graph.marks ?? {}, geometryChanged: false };
  const repairs: RepairLine[] = [];
  const drops: DropLine[] = [];
  const repaired = new Map<string, Issue>();
  let ctx = new RuleContext(state.graph, env, state.marks);
  const fresh = (): void => {
    if (state.geometryChanged) ctx = new RuleContext(state.graph, env, state.marks);
    else ctx.cache.clear();
    state.geometryChanged = false;
  };
  const maxPasses = opts.maxPasses ?? 6;
  let passes = 0;
  /** Passes of every rule with its automatic repairs, until a pass applies nothing. */
  const settle = (): void => {
    for (let n = 0; n < maxPasses; n++) {
      const pass = passes++;
      let applied = 0;
      for (const rule of rules) {
        if (!rule.repair) continue;
        let mine = 0;
        for (const issue of detect(rule, ctx)) {
          const d = decide(issue);
          if (d.mode !== 'auto') continue;
          const patch = rule.repair(issue, d.proposal);
          if (!patch) continue;
          const r = applyPatch(state, patch);
          if (!r.applied) continue;
          issue.status = 'auto_repaired';
          repaired.set(issue.id, issue);
          repairs.push({ rule: rule.id, issue: issue.id, before: r.before, after: r.after, confidence: d.proposal.confidence, patch, pass, ...(r.note ? { note: r.note } : {}) });
          for (const id of r.drops) drops.push({ id, rule: rule.id, issue: issue.id, provisional: false });
          mine++;
        }
        if (mine) fresh();
        applied += mine;
      }
      if (!applied) break;
    }
  };
  settle();

  // what is left on the repaired map: explained, or queued for a person
  const left: Issue[] = [];
  for (const rule of rules) {
    for (const issue of detect(rule, ctx)) {
      const d = decide(issue);
      if (repaired.has(issue.id)) continue;
      issue.status = d.mode === 'explained' ? 'explained' : 'open';
      left.push(issue);
    }
  }

  // a queued issue never blocks the bake: its top proposal goes in as provisional (never on a hero road)
  const provisional: ProvisionalLine[] = [];
  if (opts.provisional !== false) {
    const byRule = new Map(rules.map((r) => [r.id, r]));
    for (const issue of left) {
      if (issue.status !== 'open') continue;
      const rule = byRule.get(issue.rule) as Rule;
      const top = topProposal(issue);
      const heroBlocked = issue.hero !== null && issue.rule !== 'R-HERO-02';
      if (!top || !rule.repair || heroBlocked) {
        provisional.push({ rule: issue.rule, issue: issue.id, action: top?.action ?? '', applied: false, how: 'none', note: heroBlocked ? `on the hero road ${issue.hero}: left as it is until a person picks` : 'detect only: nothing to apply', patch: null });
        continue;
      }
      const patch = patchOf(issue, top, 'bake-provisional');
      const r = applyPatch(state, patch);
      issue.provisional = r.applied;
      provisional.push({ rule: issue.rule, issue: issue.id, action: top.action, applied: r.applied, how: r.how, note: r.note, patch });
      for (const id of r.drops) drops.push({ id, rule: issue.rule, issue: issue.id, provisional: true });
    }
  }

  // a provisional change can open a repair the bounds allow (a new edge of a split road, a width that now fits):
  // settle again, so a second run on the result finds nothing to repair
  if (provisional.some((p) => p.applied)) {
    state.geometryChanged = true;
    fresh();
    settle();
  }
  let unconverged = 0;
  for (const rule of rules) if (rule.repair) for (const issue of detect(rule, ctx)) if (decide(issue).mode === 'auto') unconverged++;

  // heights the data gives through levels only; a footprint with neither waits for its area profile
  let heightFromLevels = 0;
  let heightMissing = 0;
  for (const f of state.graph.footprints) {
    if (f.height !== null) continue;
    if (f.levels !== null && f.levels >= 1) {
      f.height = Math.round(f.levels * FLOOR_M * 10) / 10;
      heightFromLevels++;
    } else heightMissing++;
  }

  state.graph.edges.sort(byId);
  state.graph.nodes.sort(byId);
  state.graph.pairs.sort(byId);
  const marks: Marks = {};
  for (const id of Object.keys(state.marks).sort()) marks[id] = state.marks[id] as Marks[string];
  const out = state.graph as RepairedGraph;
  out.marks = marks;

  const issues = [...repaired.values(), ...left].sort((a, b) => (order.get(a.rule) ?? 0) - (order.get(b.rule) ?? 0) || byId(a, b));
  const auto = issues.filter((i) => i.status === 'auto_repaired').length;
  const explained = issues.filter((i) => i.status === 'explained').length;
  const queued = issues.length - auto - explained;
  const rest = issues.filter((i) => i.rule !== 'R-TERR-03');
  const restAuto = rest.filter((i) => i.status === 'auto_repaired').length;
  return {
    graph: out, issues, repairs, provisional, drops,
    summary: {
      total: issues.length, auto, queued, explained, autoShare: share(auto, issues.length), autoShareOfChanged: share(auto, auto + queued),
      highImpact: issues.filter((i) => i.status === 'open' && i.impact >= 0.7).length, byRule: countByRule(issues, rules),
      withoutTerrainOutliers: { total: rest.length, auto: restAuto, autoShare: share(restAuto, rest.length) },
      provisionalApplied: provisional.filter((p) => p.applied).length, provisionalNotApplied: provisional.filter((p) => !p.applied).length,
      drops: drops.length, passes, unconverged, fills: { heightFromLevels, heightMissing },
    },
  };
}

/** The issue records of issues.json (MAP_REPAIR.md "Issue record"): the fields the inspector reads, nothing internal. */
export function issueRecords(issues: readonly Issue[]): Record<string, unknown>[] {
  return issues.map((i) => ({
    id: i.id, rule: i.rule, block: i.block, district: i.district, tile: i.tile, lat: i.lat, lon: i.lon, x: i.x, z: i.z, features: i.features, impact: i.impact, confidence: i.confidence, status: i.status, note: i.note,
    ...(i.hero ? { hero: i.hero } : {}), ...(i.provisional !== undefined ? { provisional: i.provisional } : {}),
    proposals: i.proposals.map((p) => ({ action: p.action, params: p.params, confidence: p.confidence, reasoning: p.reasoning, preview: p.preview })),
  }));
}

/** repairs.jsonl: one JSON object per line. */
export const repairLog = (lines: readonly RepairLine[]): string => lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : '');
