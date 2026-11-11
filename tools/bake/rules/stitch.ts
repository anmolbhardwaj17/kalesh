// The map data part of rule R-STITCH (MAP_REPAIR.md "Rule engine": "every boundary port at the map edge is closed").
// 01 to 06 check the layout itself and live in tools/bake/layout/gate.ts; they run before the first bake step. 07
// runs on the block graph: every road that leaves through the outline ends in a closure by rule (a street net, a
// loop, a gate, a wall) or in an authored connector. A big road with neither is reported; so is a closure the
// generator is not sure of. While the outline is a stage inside its block the road simply goes on in a later stage:
// the issue is marked explained. Pure.
import { CLOSE_DEFAULTS, closePorts } from '../layout/closures.ts';
import { isBigClass, ringProject } from '../layout/edge.ts';
import type { Port } from '../layout/edge.ts';
import type { Rule, RuleContext } from './context.ts';
import { patchOf } from './types.ts';
import type { Issue } from './types.ts';

/** The map edge ends of the graph as ports of its outline. */
export function mapEdgePorts(ctx: RuleContext): Port[] {
  const out: Port[] = [];
  for (const n of ctx.graph.nodes) {
    if (n.kind !== 'map_edge') continue;
    const end = (ctx.ends.get(n.id) ?? [])[0];
    if (!end) continue;
    const inward = ctx.dirFrom(end);
    const e = end.edge;
    out.push({ id: n.id, x: n.x, z: n.z, dx: -inward.x, dz: -inward.z, cls: e.road.cls, link: e.road.link, name: e.name, ways: e.pieces.map((p) => p.way), width: e.road.width, s: ringProject(ctx.graph.outline, n).s, big: isBigClass(e.road.cls) });
  }
  return out;
}

export const mapEdgeClosed: Rule = {
  id: 'R-STITCH-07',
  area: 'stitch',
  title: 'Road leaves the map with no closure',
  confidence: 0.8,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    const ports = mapEdgePorts(ctx);
    const byId = new Map(ports.map((p) => [p.id, p]));
    const stage = (ctx.env.mapEdge ?? 'map') === 'stage';
    for (const c of closePorts(ports, ctx.graph.outline, ctx.env.connectors ?? new Map<string, string>(), CLOSE_DEFAULTS)) {
      if (c.kind !== 'open' && !c.review) continue;
      for (const id of c.ports) {
        const p = byId.get(id) as Port;
        const e = (ctx.ends.get(id) ?? [])[0]?.edge;
        const bar = c.bar ? [c.bar[0], c.bar[1]] : [{ x: p.x, z: p.z }, { x: p.x + p.dx * 6, z: p.z + p.dz * 6 }];
        const issue = ctx.issue(mapEdgeClosed, p, [id], e ? [e] : [], 0.8, c.kind === 'open' ? `${p.name || `a ${p.cls} road`} leaves the map with no connector` : `closed by rule as a ${c.kind.replace('_', ' ')}, to be checked`, c.kind === 'open'
          ? [
            ctx.proposal('terminate', { node: id, with: 'barrier' }, 0.5, { kind: 'other' }, `${c.reason}. Until then it ends at a barrier across the road`, bar),
            ctx.proposal('connect', { op: 'connector', node: id }, 0.5, { kind: 'other' }, 'Author a connector that takes the road over (harness/data/connectors/)', [{ x: p.x, z: p.z }, { x: p.x + p.dx * 60, z: p.z + p.dz * 60 }]),
          ]
          : [
            ctx.proposal('terminate', { node: id, with: c.kind }, 0.6, { kind: 'other' }, c.reason, c.streets[0] && c.streets[0].length > 1 ? c.streets[0] : bar),
            ctx.proposal('terminate', { node: id, with: 'barrier' }, 0.4, { kind: 'other' }, 'Or a plain barrier across the road', bar),
          ]);
        if (stage) {
          issue.status = 'explained';
          issue.note += '; the outline is a stage inside its block: the road goes on when the stage grows';
        }
        out.push(issue);
      }
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};
