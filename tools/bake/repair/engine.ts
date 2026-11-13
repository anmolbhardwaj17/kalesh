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
import type { P2 } from '../geom.ts';
import { applyPatch } from './apply.ts';
import type { RepairState } from './apply.ts';
import { decide, policyOf } from './bounds.ts';
import { isDisable, overrideCounts, overrideFor, overrideRecords, resolveOverrides, unresolved } from './overrides.ts';
import type { OverrideCounts, OverrideEntry, OverrideRecord, ResolvedOverride } from './overrides.ts';

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
  /** True for a patch of harness/data/overrides/ (an owner pick or a hand written patch), not a rule's repair. */
  override?: boolean;
}

export interface ProvisionalLine {
  rule: string;
  issue: string;
  action: string;
  applied: boolean;
  how: 'graph' | 'mark' | 'none';
  note: string;
  patch: Patch | null;
  /** Settled by the policy table (bounds.ts POLICY): the reason. The patch is then a final one, logged like a repair. */
  decided?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
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
  /** Issues a patch of harness/data/overrides/ took the place of (a fix, or a repair switched off). */
  overridden: number;
  /** Of `auto`: settled by the policy table beyond the signed low impact bounds (P1-030). */
  decidedPolicy: number;
  /** Of `overridden`: settled by a patch of the top-view judge pass (P1-030). */
  decidedJudge: number;
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
  /** The issues that could still repair, by rule. */
  unconvergedBy: Record<string, number>;
  fills: { heightFromLevels: number; heightMissing: number };
}

export interface RepairResult {
  graph: RepairedGraph;
  issues: Issue[];
  repairs: RepairLine[];
  provisional: ProvisionalLine[];
  drops: DropLine[];
  summary: RepairSummary;
  /** One record per override patch read, with what became of it (empty when no overrides were given). */
  overrides: OverrideRecord[];
  overrideCounts: OverrideCounts;
}

export interface RepairOptions {
  rules?: readonly Rule[];
  maxPasses?: number;
  /** Apply the top proposal of queued issues (default true). */
  provisional?: boolean;
  /**
   * Override patches (harness/data/overrides/) and the projection that turns an anchor into block metres. A patch takes
   * the place of the repair of its issue. `applied` says the graph already holds them (the second run of the bake
   * checking the fixed point): they then only switch repairs off.
   */
  overrides?: { entries: readonly OverrideEntry[]; project: (lat: number, lon: number) => P2; applied?: boolean };
}

const share = (a: number, b: number): number => (b === 0 ? 1 : Math.round((a / b) * 1000) / 1000);

/** Rounds of provisional proposals: a provisional change can open new queued issues (P1-033). */
const PROVISIONAL_ROUNDS = 5;

export function repairGraph(raw: BlockGraph, env: RuleEnv, opts: RepairOptions = {}): RepairResult {
  const rules = opts.rules ?? CATALOGUE;
  const order = new Map(rules.map((r, i) => [r.id, i]));
  const graph = JSON.parse(JSON.stringify(raw)) as BlockGraph & { marks?: Marks };
  const state: RepairState = { graph, marks: graph.marks ?? {}, geometryChanged: false };
  const repairs: RepairLine[] = [];
  const drops: DropLine[] = [];
  const repaired = new Map<string, Issue>();
  // override patches: found in the raw graph by id, then by anchor; they take the place of a repair
  const ovs: ResolvedOverride[] = opts.overrides ? resolveOverrides(raw, opts.overrides.entries, opts.overrides.project) : [];
  if (opts.overrides?.applied) for (const o of ovs) if (!isDisable(o) && !unresolved(o)) o.applied = true;
  const refused = new Map<ResolvedOverride, string>();
  const settled = new Map<string, Issue>();
  const claim = (issue: Issue, o: ResolvedOverride): void => {
    issue.status = 'overridden';
    if (o.entry.patch.by === 'judge') {
      issue.decided = 'judge';
      issue.decision = o.entry.patch.why;
    }
    settled.set(issue.id, issue);
    if (!o.issues.includes(issue.id)) o.issues.push(issue.id);
  };
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
          const ov = overrideFor(ovs, issue);
          if (ov) {
            claim(issue, ov);
            continue;
          }
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
  /** Applies the patches of the owner that no repair has met yet; true when one changed the graph or a decision. */
  const applyOverrides = (): boolean => {
    let any = false;
    for (const o of ovs) {
      if (o.applied || isDisable(o) || unresolved(o) || refused.has(o)) continue;
      const r = applyPatch(state, o.patch);
      if (!r.applied) {
        refused.set(o, r.note);
        continue;
      }
      o.applied = true;
      any = true;
      const p = o.entry.patch;
      repairs.push({ rule: p.issue.split(':')[0] as string, issue: p.issue, before: r.before, after: r.after, confidence: 1, patch: o.patch, pass: passes, override: true, note: `${o.entry.file} ${p.id}${r.note ? `: ${r.note}` : ''}` });
      for (const id of r.drops) drops.push({ id, rule: p.issue.split(':')[0] as string, issue: p.issue, provisional: false });
    }
    if (any) {
      state.geometryChanged = true;
      fresh();
    }
    return any;
  };
  settle();
  if (applyOverrides()) settle();

  // what is left on the repaired map: explained, or queued for a person
  const left: Issue[] = [];
  const leftIds = new Set<string>();
  /** Issues not repaired and not seen before; an owner's patch settles its own. */
  const collect = (): Issue[] => {
    const found: Issue[] = [];
    for (const rule of rules) {
      for (const issue of detect(rule, ctx)) {
        const d = decide(issue);
        if (repaired.has(issue.id) || leftIds.has(issue.id)) continue;
        const ov = overrideFor(ovs, issue);
        if (ov) {
          claim(issue, ov);
          continue;
        }
        issue.status = d.mode === 'explained' ? 'explained' : 'open';
        const policy = d.mode === 'queued' ? policyOf(issue) : null;
        if (policy) {
          issue.decided = 'policy';
          issue.decision = policy;
        }
        leftIds.add(issue.id);
        left.push(issue);
        found.push(issue);
      }
    }
    return found;
  };

  // a queued issue never blocks the bake: its top proposal goes in as provisional (never on a hero road)
  const provisional: ProvisionalLine[] = [];
  const byRule = new Map(rules.map((r) => [r.id, r]));
  const applyProvisional = (list: readonly Issue[]): boolean => {
    let any = false;
    for (const issue of list) {
      if (issue.status !== 'open') continue;
      const rule = byRule.get(issue.rule) as Rule;
      const top = topProposal(issue);
      const heroBlocked = issue.hero !== null && issue.heroSpec !== false && issue.rule !== 'R-HERO-02';
      const decided = issue.decided === 'policy' ? issue.decision ?? '' : undefined;
      if (!top || !rule.repair || heroBlocked) {
        provisional.push({ rule: issue.rule, issue: issue.id, action: top?.action ?? '', applied: false, how: 'none', note: heroBlocked ? `on the hero road ${issue.hero}: left as it is until a person picks` : 'detect only: nothing to apply', patch: null, ...(decided !== undefined ? { decided } : {}) });
        if (decided !== undefined) issue.status = 'auto_repaired';
        continue;
      }
      const patch = patchOf(issue, top, decided !== undefined ? 'bake-policy' : 'bake-provisional');
      const r = applyPatch(state, patch);
      any = any || r.applied;
      if (decided !== undefined) issue.status = 'auto_repaired';
      else issue.provisional = r.applied;
      provisional.push({ rule: issue.rule, issue: issue.id, action: top.action, applied: r.applied, how: r.how, note: r.note, patch, ...(decided !== undefined ? { decided, before: r.before, after: r.after } : {}) });
      for (const id of r.drops) drops.push({ id, rule: issue.rule, issue: issue.id, provisional: true });
    }
    return any;
  };
  // a provisional change can open a repair the bounds allow (a new edge of a split road, a width that now fits) or a
  // new queued issue (a branch moved closer to another road): settle again and give the new queued issues their
  // provisional too (PROVISIONAL_ROUNDS at most), so a second run on the result finds nothing to repair
  let batch = collect();
  for (let round = 0; round < PROVISIONAL_ROUNDS && opts.provisional !== false; round++) {
    if (!applyProvisional(batch)) break;
    state.geometryChanged = true;
    fresh();
    settle();
    batch = collect();
  }
  let unconverged = 0;
  const unconvergedBy: Record<string, number> = {};
  for (const rule of rules) {
    if (!rule.repair) continue;
    for (const issue of detect(rule, ctx)) {
      if (decide(issue).mode !== 'auto' || overrideFor(ovs, issue)) continue;
      unconverged++;
      unconvergedBy[rule.id] = (unconvergedBy[rule.id] ?? 0) + 1;
    }
  }

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

  const issues = [...repaired.values(), ...left, ...settled.values()].sort((a, b) => (order.get(a.rule) ?? 0) - (order.get(b.rule) ?? 0) || byId(a, b));
  const auto = issues.filter((i) => i.status === 'auto_repaired').length;
  const explained = issues.filter((i) => i.status === 'explained').length;
  const overridden = issues.filter((i) => i.status === 'overridden').length;
  const queued = issues.length - auto - explained - overridden;
  const records = overrideRecords(ovs, refused);
  const rest = issues.filter((i) => i.rule !== 'R-TERR-03');
  const restAuto = rest.filter((i) => i.status === 'auto_repaired').length;
  return {
    graph: out, issues, repairs, provisional, drops, overrides: records, overrideCounts: overrideCounts(records, overridden),
    summary: {
      total: issues.length, auto, queued, explained, overridden, decidedPolicy: issues.filter((i) => i.status === 'auto_repaired' && i.decided === 'policy').length, decidedJudge: issues.filter((i) => i.status === 'overridden' && i.decided === 'judge').length, autoShare: share(auto, issues.length), autoShareOfChanged: share(auto, auto + queued),
      highImpact: issues.filter((i) => i.status === 'open' && i.impact >= 0.7).length, byRule: countByRule(issues, rules),
      withoutTerrainOutliers: { total: rest.length, auto: restAuto, autoShare: share(restAuto, rest.length) },
      provisionalApplied: provisional.filter((p) => p.applied).length, provisionalNotApplied: provisional.filter((p) => !p.applied).length,
      drops: drops.length, passes, unconverged, unconvergedBy, fills: { heightFromLevels, heightMissing },
    },
  };
}

const r1 = (v: number): number => Math.round(v * 10) / 10 + 0;

/**
 * The issue records of issues.json (MAP_REPAIR.md "Issue record"): the fields the inspector reads, nothing internal.
 * `offset` is the block's world offset: with it x, z and every preview point are world metres (the inspector, the
 * overrides files and the tiles all use the one world grid); without it they stay block metres.
 */
export function issueRecords(issues: readonly Issue[], offset: P2 = { x: 0, z: 0 }, judgeNotes: Readonly<Record<string, { note: string }>> = {}): Record<string, unknown>[] {
  const shift = offset.x !== 0 || offset.z !== 0;
  const pt = (p: P2): P2 => (shift ? { x: r1(p.x + offset.x), z: r1(p.z + offset.z) } : p);
  return issues.map((i) => ({
    id: i.id, rule: i.rule, block: i.block, district: i.district, tile: i.tile, lat: i.lat, lon: i.lon, x: shift ? r1(i.x + offset.x) : i.x, z: shift ? r1(i.z + offset.z) : i.z, features: i.features, impact: i.impact, confidence: i.confidence, status: i.status, note: i.note,
    ...(i.hero ? { hero: i.hero } : {}), ...(i.provisional !== undefined ? { provisional: i.provisional } : {}), ...(i.decided ? { decided: i.decided, decision: i.decision ?? '' } : {}), ...(i.status === 'open' && judgeNotes[i.id] ? { judgeNote: (judgeNotes[i.id] as { note: string }).note } : {}),
    proposals: i.proposals.map((p) => ({ action: p.action, params: p.params, confidence: p.confidence, reasoning: p.reasoning, preview: p.preview.map(pt) })),
  }));
}

/** repairs.jsonl: one JSON object per line. */
export const repairLog = (lines: readonly RepairLine[]): string => lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : '');

/** The repair log lines of the issues the policy table settled (their patch went in after the last pass). */
export function policyLines(res: Pick<RepairResult, 'provisional' | 'summary'>): (RepairLine & { decided: string })[] {
  return res.provisional.filter((p) => p.decided !== undefined && p.patch !== null && p.applied).map((p) => ({ rule: p.rule, issue: p.issue, before: p.before ?? {}, after: p.after ?? {}, confidence: 1, patch: p.patch as Patch, pass: res.summary.passes, decided: p.decided as string, ...(p.note ? { note: p.note } : {}) }));
}
