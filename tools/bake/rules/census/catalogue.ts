// The rule catalogue (RE1): every rule in the fixed order the engine runs them, and the engine itself. The same
// input gives the same issues in the same order.
import { bridgeSupport, rampInAir } from './bridges.ts';
import { buildingOnRoad, duplicateFootprint } from './buildings.ts';
import { crossingNoNode, danglingEnd, unpairedOneway } from './roads.ts';
import { groundOutlier } from './terrain.ts';
import { autoProposal } from './types.ts';
import type { Issue, Rule, RuleContext } from './types.ts';

export const CATALOGUE: readonly Rule[] = [danglingEnd, crossingNoNode, unpairedOneway, bridgeSupport, rampInAir, buildingOnRoad, duplicateFootprint, groundOutlier];

/** Runs the rules in catalogue order. Issues of one rule are sorted by id; an id never appears twice. */
export function runRules(ctx: RuleContext, rules: readonly Rule[] = CATALOGUE): Issue[] {
  const out: Issue[] = [];
  const seen = new Set<string>();
  for (const rule of rules) {
    const found = rule.detect(ctx).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const i of found) {
      if (seen.has(i.id)) continue;
      seen.add(i.id);
      out.push(i);
    }
  }
  return out;
}

export interface RuleCount {
  rule: string;
  title: string;
  issues: number;
  /** Issues AR1 would repair on its own: a proposal with confidence 0.8 or more and a low impact. */
  auto: number;
  queued: number;
}

export function countByRule(issues: readonly Issue[], rules: readonly Rule[] = CATALOGUE): RuleCount[] {
  return rules.map((rule) => {
    const mine = issues.filter((i) => i.rule === rule.id);
    const auto = mine.filter((i) => autoProposal(i) !== null).length;
    return { rule: rule.id, title: rule.title, issues: mine.length, auto, queued: mine.length - auto };
  });
}

/** One line per rule for the generated catalogue. */
export function catalogueLines(rules: readonly Rule[] = CATALOGUE): { id: string; area: string; title: string; confidence: number; repairs: boolean }[] {
  return rules.map((r) => ({ id: r.id, area: r.area, title: r.title, confidence: r.confidence, repairs: r.repair !== undefined }));
}
