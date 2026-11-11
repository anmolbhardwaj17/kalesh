// Files of the repair step (P1-010): reads the hero road specs, the hero list and the named places; writes the
// repaired graph (a build product under the stage's data folder), issues.json and repairs.jsonl beside the health
// report. The repair itself is pure (tools/bake/repair/).
import fs from 'node:fs';
import path from 'node:path';
import type { StagePlan } from '../layout/stages.ts';
import type { RepairResult } from '../repair/engine.ts';
import { issueRecords, repairLog } from '../repair/engine.ts';
import type { HeroSpec } from '../roads/hero.ts';
import { CATALOGUE } from '../rules/catalogue.ts';
import type { HeroListEntry } from '../rules/types.ts';

export interface RepairInput {
  heroSpecs: HeroSpec[];
  heroList: HeroListEntry[];
  places: { id: string; block: string; lat: number; lon: number }[];
}

/** Hero specs (harness/data/hero_roads/*.json), the hero list (harness/data/hero_list.json) and the named places. */
export function readRepairInput(root: string): RepairInput {
  const data = path.join(root, 'harness', 'data');
  const dir = path.join(data, 'hero_roads');
  const heroSpecs: HeroSpec[] = [];
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      const spec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as HeroSpec;
      if (spec.id && spec.covers && spec.crossSection) heroSpecs.push(spec);
    }
  }
  const listFile = path.join(data, 'hero_list.json');
  const heroList = fs.existsSync(listFile) ? (JSON.parse(fs.readFileSync(listFile, 'utf8')) as { roads: HeroListEntry[] }).roads : [];
  const placesFile = path.join(data, 'districts', 'places.json');
  const places = fs.existsSync(placesFile) ? (JSON.parse(fs.readFileSync(placesFile, 'utf8')) as { places: RepairInput['places'] }).places : [];
  return { heroSpecs, heroList, places };
}

/** Writes the repaired graph, issues.json and repairs.jsonl; returns their repo-relative (or absolute, outside root) paths. */
export function writeRepair(root: string, plan: StagePlan, reportDir: string, res: RepairResult, source: string): { graph: string; issues: string; repairs: string } {
  const graphFile = path.join(root, plan.def.dataDir, 'graph_repaired.json');
  fs.mkdirSync(path.dirname(graphFile), { recursive: true });
  fs.writeFileSync(graphFile, JSON.stringify(res.graph));
  fs.mkdirSync(reportDir, { recursive: true });
  const issuesFile = path.join(reportDir, 'issues.json');
  const rules: Record<string, string> = {};
  for (const r of CATALOGUE) rules[r.id] = r.title;
  fs.writeFileSync(issuesFile, JSON.stringify({ version: 1, block: res.graph.block, source, rules, issues: issueRecords(res.issues) }));
  const repairsFile = path.join(reportDir, 'repairs.jsonl');
  fs.writeFileSync(repairsFile, repairLog(res.repairs));
  const rel = (f: string): string => (f.startsWith(root) ? path.relative(root, f) : f);
  return { graph: rel(graphFile), issues: rel(issuesFile), repairs: rel(repairsFile) };
}
