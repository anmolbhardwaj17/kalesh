// The rule catalogue of the production bake (RE1): every rule in the fixed order the engine runs them, and the
// engine itself. The same graph gives the same issues in the same order. Order: road topology first (joins,
// crossings, doubles), then structures, then the lane fits (so the checks after them see fitted lines and lane
// counts), lane checks, junctions, footpaths, buildings (against the fitted lines), rail, foot over bridges, the map
// edge, hero roads and terrain. Rule R-STITCH 01 to 06 check the layout and run before the first bake step
// (tools/bake/layout/gate.ts). Pure, except that timeRules reads a clock the caller passes in.
import { bridgeNoGround, bridgeSupport, deckClearance, rampGrade, rampInAir } from './bridges.ts';
import { badHeight, badPolygon, buildingOnRoad, duplicateFootprint } from './buildings.ts';
import type { Rule, RuleContext } from './context.ts';
import { fobLandings } from './fob.ts';
import { footpathGap, footpathInRoad } from './footpaths.ts';
import { heroEqualsSpec, heroReferences, heroSpecFile, heroUntouched } from './hero.ts';
import { approachAngle, junctionCluster, shortArm, surfaceOverJunction } from './junctions.ts';
import { besideRoads, carriagewayFit, laneSurfaces, doubleTaper, goreRoom, laneContinuity, laneCountAhead, sharedIndexPoint, slipRoadFit } from './lanes.ts';
import { stationLinks, viaductPiers } from './rail.ts';
import { crossingNoNode, danglingEnd, noTaperRoom, overlappingWays, pairNamesDiffer, unpairedOneway, widthSanity } from './roads.ts';
import { mapEdgeClosed } from './stitch.ts';
import { groundAboveRoad, groundOutlier, roadInWater, tunnelPortal } from './terrain.ts';
import type { Issue, RuleArea } from './types.ts';

export const CATALOGUE: readonly Rule[] = [
  danglingEnd, crossingNoNode, overlappingWays, unpairedOneway, widthSanity, pairNamesDiffer,
  bridgeSupport, rampInAir, deckClearance, rampGrade, bridgeNoGround, tunnelPortal,
  carriagewayFit, slipRoadFit, laneCountAhead,
  noTaperRoom, laneContinuity, doubleTaper, sharedIndexPoint, goreRoom, besideRoads, laneSurfaces,
  approachAngle, surfaceOverJunction, junctionCluster, shortArm,
  footpathGap, footpathInRoad,
  buildingOnRoad, badPolygon, duplicateFootprint, badHeight,
  viaductPiers, stationLinks,
  fobLandings,
  mapEdgeClosed,
  heroSpecFile, heroEqualsSpec, heroUntouched, heroReferences,
  groundAboveRoad, roadInWater, groundOutlier,
];

/** Every rule area of MAP_REPAIR.md "Rule engine" and the file that holds its rules. */
export const AREA_FILES: Readonly<Record<RuleArea, string>> = {
  roads: 'tools/bake/rules/roads.ts',
  bridges: 'tools/bake/rules/bridges.ts',
  junctions: 'tools/bake/rules/junctions.ts',
  lanes: 'tools/bake/rules/lanes.ts',
  footpaths: 'tools/bake/rules/footpaths.ts',
  buildings: 'tools/bake/rules/buildings.ts',
  rail: 'tools/bake/rules/rail.ts',
  fob: 'tools/bake/rules/fob.ts',
  stitch: 'tools/bake/rules/stitch.ts',
  hero: 'tools/bake/rules/hero.ts',
  terrain: 'tools/bake/rules/terrain.ts',
};

/** The issues of one rule, sorted by id, each id once. */
export function detect(rule: Rule, ctx: RuleContext): Issue[] {
  const seen = new Set<string>();
  const out: Issue[] = [];
  for (const i of rule.detect(ctx).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (seen.has(i.id)) continue;
    seen.add(i.id);
    out.push(i);
  }
  return out;
}

/** Runs the rules in catalogue order on one graph state. Nothing is changed. */
export function runRules(ctx: RuleContext, rules: readonly Rule[] = CATALOGUE): Issue[] {
  const out: Issue[] = [];
  for (const rule of rules) out.push(...detect(rule, ctx));
  return out;
}

/** runRules with the time each rule took (ms), by the clock passed in (the driver's; tests pass their own). */
export function timeRules(ctx: RuleContext, now: () => number, rules: readonly Rule[] = CATALOGUE): { issues: Issue[]; ms: Record<string, number>; totalMs: number } {
  const issues: Issue[] = [];
  const ms: Record<string, number> = {};
  const start = now();
  for (const rule of rules) {
    const t0 = now();
    issues.push(...detect(rule, ctx));
    ms[rule.id] = Math.round((now() - t0) * 10) / 10;
  }
  return { issues, ms, totalMs: Math.round((now() - start) * 10) / 10 };
}

export interface RuleCount {
  rule: string;
  title: string;
  issues: number;
  auto: number;
  queued: number;
  explained: number;
  /** Settled by a patch of harness/data/overrides/. */
  overridden: number;
  /** Of `auto`: settled by the policy table (P1-030). Of `overridden`: by a patch of the top-view judge pass. */
  policy: number;
  judged: number;
}

/** Counts by rule from issues that carry their final status. */
export function countByRule(issues: readonly Issue[], rules: readonly Rule[] = CATALOGUE): RuleCount[] {
  return rules.map((rule) => {
    const mine = issues.filter((i) => i.rule === rule.id);
    const auto = mine.filter((i) => i.status === 'auto_repaired').length;
    const explained = mine.filter((i) => i.status === 'explained').length;
    const overridden = mine.filter((i) => i.status === 'overridden').length;
    return {
      rule: rule.id, title: rule.title, issues: mine.length, auto, queued: mine.length - auto - explained - overridden, explained, overridden,
      policy: mine.filter((i) => i.status === 'auto_repaired' && i.decided === 'policy').length, judged: mine.filter((i) => i.status === 'overridden' && i.decided === 'judge').length,
    };
  });
}

/** One line per rule for the generated catalogue. */
export function catalogueLines(rules: readonly Rule[] = CATALOGUE): { id: string; area: string; title: string; confidence: number; repairs: boolean }[] {
  return rules.map((r) => ({ id: r.id, area: r.area, title: r.title, confidence: r.confidence, repairs: r.repair !== undefined }));
}
