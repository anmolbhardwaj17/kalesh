// What the underground class (graph/underground.ts, P1-041) takes out of the repair: the rules run once more on the
// raw graph with every underground structure the source drew as a building put back as an ordinary footprint (a
// market mapped as land use or a parking area never was one), and the issues that name one are the issues the class
// removed. Counted for health.json; nothing here changes the bake. Pure.
import type { BlockGraph, GraphFootprint } from '../graph/build.ts';
import { undergroundIds } from '../graph/underground.ts';
import { runRules } from '../rules/catalogue.ts';
import { RuleContext } from '../rules/context.ts';
import type { RuleEnv } from '../rules/types.ts';

export interface RemovedIssues {
  total: number;
  byRule: Record<string, number>;
  /** By underground feature id. */
  byFeature: Record<string, number>;
  /** The ids of those issues (as the rules would have named them). */
  ids: string[];
}

/** The issues the rules raise on `graph` only because of its underground structures (zero when it has none). */
export function issuesRemovedByUnderground(graph: BlockGraph, env: RuleEnv): RemovedIssues {
  const out: RemovedIssues = { total: 0, byRule: {}, byFeature: {}, ids: [] };
  const under = (graph.underground ?? []).filter((u) => u.footprint);
  if (!under.length) return out;
  const back: GraphFootprint[] = under.map((u) => ({ id: u.id, source: u.source, ring: u.ring, area: u.area, height: null, levels: null, tags: {} }));
  const ids = undergroundIds(under);
  const issues = runRules(new RuleContext({ ...graph, footprints: [...graph.footprints, ...back] }, env));
  for (const i of issues) {
    const hit = i.features.find((f) => ids.has(f));
    if (hit === undefined) continue;
    const owner = (ids.get(hit) as { id: string }).id;
    out.total++;
    out.byRule[i.rule] = (out.byRule[i.rule] ?? 0) + 1;
    out.byFeature[owner] = (out.byFeature[owner] ?? 0) + 1;
    out.ids.push(i.id);
  }
  out.ids.sort();
  return out;
}
