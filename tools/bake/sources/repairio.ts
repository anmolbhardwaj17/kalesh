// Files of the repair step (P1-010): reads the hero road specs, the hero list and the named places; writes the
// repaired graph (a build product under the stage's data folder), issues.json and repairs.jsonl beside the health
// report. The repair itself is pure (tools/bake/repair/).
import fs from 'node:fs';
import path from 'node:path';
import type { P2 } from '../geom.ts';
import type { StagePlan } from '../layout/stages.ts';
import type { RepairResult } from '../repair/engine.ts';
import { inspectorContext, inspectorIndex } from '../report/inspector.ts';
import type { PlaceIn } from '../report/inspector.ts';
import { issueRecords, policyLines, repairLog } from '../repair/engine.ts';
import type { HeroSpec } from '../roads/hero.ts';
import { CATALOGUE } from '../rules/catalogue.ts';
import type { HeroListEntry } from '../rules/types.ts';

export interface RepairInput {
  heroSpecs: HeroSpec[];
  heroList: HeroListEntry[];
  places: (PlaceIn & { pilot?: boolean })[];
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

/** Where the stage sits in the world and what the inspector marks: the block's world offset, the outline ring and the places. */
export interface InspectorFrame {
  offset: P2;
  outline: readonly P2[];
  places: readonly PlaceIn[];
  toBlock: (lat: number, lon: number) => P2;
}

/**
 * Writes the repaired graph, issues.json (world metres, status overridden where a patch took over), repairs.jsonl and
 * the two files the map inspector draws (context.json, tiles/index.json); returns their repo-relative (or absolute,
 * outside root) paths.
 */
export function writeRepair(root: string, plan: StagePlan, reportDir: string, res: RepairResult, source: string, frame: InspectorFrame): { graph: string; issues: string; repairs: string; context: string } {
  const graphFile = path.join(root, plan.def.dataDir, 'graph_repaired.json');
  fs.mkdirSync(path.dirname(graphFile), { recursive: true });
  fs.writeFileSync(graphFile, JSON.stringify(res.graph));
  fs.mkdirSync(reportDir, { recursive: true });
  const issuesFile = path.join(reportDir, 'issues.json');
  const rules: Record<string, string> = {};
  for (const r of CATALOGUE) rules[r.id] = r.title;
  // sites the top-view judge pass left for the owner carry its note (tools/inspector/judge.mjs apply)
  const notesFile = path.join(root, 'harness', 'data', 'judge_notes.json');
  const notes = fs.existsSync(notesFile) ? (JSON.parse(fs.readFileSync(notesFile, 'utf8')) as { notes?: Record<string, { note: string }> }).notes ?? {} : {};
  fs.writeFileSync(issuesFile, JSON.stringify({ version: 1, block: res.graph.block, source, rules, issues: issueRecords(res.issues, frame.offset, notes) }));
  const repairsFile = path.join(reportDir, 'repairs.jsonl');
  fs.writeFileSync(repairsFile, repairLog([...res.repairs, ...policyLines(res)]));
  const contextFile = path.join(reportDir, 'context.json');
  fs.writeFileSync(contextFile, JSON.stringify(inspectorContext(res.graph, frame.offset, frame.outline)));
  fs.mkdirSync(path.join(reportDir, 'tiles'), { recursive: true });
  const indexFile = path.join(reportDir, 'tiles', 'index.json');
  fs.writeFileSync(indexFile, JSON.stringify(inspectorIndex(res.graph.block, frame.places, frame.toBlock, frame.offset, frame.outline)));
  const rel = (f: string): string => (f.startsWith(root) ? path.relative(root, f) : f);
  return { graph: rel(graphFile), issues: rel(issuesFile), repairs: rel(repairsFile), context: rel(contextFile) };
}
