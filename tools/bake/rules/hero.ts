// Hero road rules (R-HERO, MAP_REPAIR.md "Hero roads"): detect only. Nothing on a hero road is ever repaired
// automatically (tools/bake/repair/bounds.ts), and a queued issue on one is not applied as provisional either: its
// cross-section comes from its spec file and from nowhere else. 01: every road on the hero list has a spec file.
// 02: the road equals its spec (lanes, direction, footpaths). 03: no repair changed a hero road's cross-section.
// 04: every spec field has a reference with a link and a licence. Pure.
import type { P2 } from '../geom.ts';
import type { GraphEdge } from '../graph/build.ts';
import { specRefProblems } from '../roads/hero.ts';
import type { HeroSpec } from '../roads/hero.ts';
import { byId } from './context.ts';
import type { Rule, RuleContext } from './context.ts';
import { patchOf } from './types.ts';
import type { Issue } from './types.ts';

const longest = (edges: readonly GraphEdge[]): GraphEdge => edges.reduce((a, b) => (b.len > a.len ? b : a));
const centre = (ctx: RuleContext): P2 => {
  const o = ctx.graph.outline;
  return { x: o.reduce((s, p) => s + p.x, 0) / Math.max(1, o.length), z: o.reduce((s, p) => s + p.z, 0) / Math.max(1, o.length) };
};

/** The edges a spec covers: those with a piece of one of its OSM ways. */
export function specEdges(ctx: RuleContext, spec: HeroSpec): GraphEdge[] {
  const ways = new Set(spec.covers.osmWays.map((w) => `way/${w}`));
  return ctx.graph.edges.filter((e) => e.pieces.some((p) => ways.has(p.way))).sort(byId);
}

export const heroSpecFile: Rule = {
  id: 'R-HERO-01',
  area: 'hero',
  title: 'Hero road without a spec file',
  confidence: 0.9,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    const specs = ctx.env.heroSpecs ?? [];
    for (const h of ctx.env.heroList ?? []) {
      const names = new Set(h.osmNames);
      const listed = new Set((h.osmWays ?? []).map((w) => `way/${w}`));
      const edges = ctx.graph.edges.filter((e) => names.has(e.name) || e.pieces.some((p) => listed.has(p.way))).sort(byId);
      if (!edges.length) continue;
      const ways = new Set(edges.flatMap((e) => e.pieces.map((p) => p.way)));
      if (specs.some((s) => s.id === h.id || s.covers.osmWays.some((w) => ways.has(`way/${w}`)))) continue;
      const e = longest(edges);
      // planned work, not a question (P1-030): the spec is written in the hero road pass (P2-015, P2-016). Until then the
      // road has no authored cross-section to protect and is repaired like any other road
      const issue = ctx.issue(heroSpecFile, e.pts[Math.floor(e.pts.length / 2)] as P2, [`hero/${h.id}`], edges, 0.9, `${h.name}: ${edges.length} edges, no spec file yet (written in the hero road pass)`, [
        ctx.proposal('set_tag', { key: 'hero_spec', value: h.id, on: e.id }, 0.5, { kind: 'other' }, `${h.name} is on the hero road list and has no spec file (harness/data/hero_roads/${h.id}.json). Until the hero road pass writes one the class defaults apply and the road is repaired like any other`, e.pts),
      ]);
      issue.status = 'explained';
      out.push(issue);
    }
    return out;
  },
};

/** Where an edge differs from the spec that covers it. */
export function specMismatch(spec: HeroSpec, e: GraphEdge): string[] {
  const out: string[] = [];
  const drive = spec.crossSection.lanes.filter((l) => l.type === 'drive').reduce((n, l) => n + Math.max(1, l.count ?? 1), 0);
  if (e.road.lanes !== drive) out.push(`${e.road.lanes} lanes, the spec says ${drive}`);
  if (e.oneway !== spec.traffic.oneway) out.push(`${e.oneway ? 'one-way' : 'two-way'}, the spec says ${spec.traffic.oneway ? 'one-way' : 'two-way'}`);
  for (const side of ['left', 'right'] as const) {
    if (Math.abs(e.road.footpath[side] - spec.footpaths[side].width) > 0.05) out.push(`${side} footpath ${e.road.footpath[side]} m, the spec says ${spec.footpaths[side].width} m`);
  }
  return out;
}

export const heroEqualsSpec: Rule = {
  id: 'R-HERO-02',
  area: 'hero',
  title: 'Hero road differs from its spec',
  confidence: 0.9,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const spec of ctx.env.heroSpecs ?? []) {
      const edges = specEdges(ctx, spec);
      const bad = edges.filter((e) => specMismatch(spec, e).length > 0);
      if (!bad.length) continue;
      const first = bad[0] as GraphEdge;
      const drive = spec.crossSection.lanes.filter((l) => l.type === 'drive');
      const lanes = drive.reduce((n, l) => n + Math.max(1, l.count ?? 1), 0);
      const width = Math.round(drive.reduce((w, l) => w + Math.max(1, l.count ?? 1) * l.width, 0) * 10) / 10;
      out.push(ctx.issue(heroEqualsSpec, first.pts[Math.floor(first.pts.length / 2)] as P2, [`hero/${spec.id}`, ...bad.map((e) => e.id).slice(0, 3)], bad, 0.9, `${bad.length} of ${edges.length} edges differ: ${specMismatch(spec, first).join('; ')}`, [
        ctx.proposal('set_lanes', { on: bad.map((e) => e.id).join(','), lanes, from: 'spec', width, footpath_left: spec.footpaths.left.width, footpath_right: spec.footpaths.right.width, spec: spec.id }, 0.9, { kind: 'hero_spec' },
          `${spec.name} has a spec file and the map tags differ from it (${specMismatch(spec, first).join('; ')}): the spec overrides the tags`, first.pts),
      ]));
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};

/** Marks a repair leaves when it changes a cross-section, and the sources that are not a spec. */
const SECTION_MARKS: readonly [string, (v: unknown) => boolean][] = [
  ['lanes_from', (v) => v !== 'spec'],
  ['width_from', (v) => v !== 'spec'],
  ['footpath_from', (v) => v !== 'spec'],
  // a hero road held in place while the other road moved carries shifted_m 0: nothing changed
  ['shifted_m', (v) => Number(v) > 0.001],
];

export const heroUntouched: Rule = {
  id: 'R-HERO-03',
  area: 'hero',
  title: 'A repair changed a hero road',
  confidence: 0.95,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const e of ctx.graph.edges) {
      const hero = ctx.heroOf(e);
      // only a road with a spec file has a cross-section to protect
      if (!hero || !ctx.heroHasSpec(hero)) continue;
      const marks = ctx.marks[e.id];
      if (!marks) continue;
      const changed = SECTION_MARKS.filter(([k, bad]) => marks[k] !== undefined && bad(marks[k])).map(([k]) => `${k}=${String(marks[k])}`);
      if (!changed.length) continue;
      out.push(ctx.issue(heroUntouched, e.pts[Math.floor(e.pts.length / 2)] as P2, [e.id], [e], 0.95, `changed by the repair layer: ${changed.join(', ')}`, [
        ctx.proposal('disable_repair', { on: e.id, issue: String(marks['by'] ?? '') }, 0.9, { kind: 'other' }, `${e.id} is part of the hero road ${ctx.heroOf(e)} and a repair changed its cross-section (${changed.join(', ')}): switch that repair off, the spec decides`, e.pts),
      ]));
    }
    return out;
  },
};

export const heroReferences: Rule = {
  id: 'R-HERO-04',
  area: 'hero',
  title: 'Hero spec field without a reference',
  confidence: 0.95,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const spec of ctx.env.heroSpecs ?? []) {
      const r = specRefProblems(spec);
      if (!r.problems.length) continue;
      const edges = specEdges(ctx, spec);
      const at = edges.length ? ((edges[0] as GraphEdge).pts[0] as P2) : centre(ctx);
      out.push(ctx.issue(heroReferences, at, [`hero/${spec.id}`, 'refs'], edges, 0.95, `${r.problems.length} of ${r.fields} fields: ${r.problems.slice(0, 3).join('; ')}`, [
        ctx.proposal('disable_repair', { spec: spec.id, field: r.problems[0] as string }, 0.5, { kind: 'other' }, `Every field of a hero spec needs a reference photo with a link and a licence. Missing in ${spec.id}: ${r.problems.slice(0, 3).join('; ')}`, edges.length ? (edges[0] as GraphEdge).pts : [at]),
      ]));
    }
    return out;
  },
};
