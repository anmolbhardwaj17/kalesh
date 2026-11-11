// Foot over bridge rule (R-FOB) on the block graph: the stairs or ramps of a foot over bridge come down on a foot way
// or a platform, beside a road (on its footpath) or into a building at every end, never inside a carriageway and
// never nowhere. Foot ways are not part of the graph: the driver passes them in (RuleEnv.walkways). Pure.
import { segmentRing } from '../geom.ts';
import type { P2 } from '../geom.ts';
import { atGrade, r3 } from './context.ts';
import type { Rule, RuleContext } from './context.ts';
import { patchOf } from './types.ts';
import type { Issue } from './types.ts';

/** A landing further than this (m) from a foot way, a building or the footpath of a road is not connected. */
export const LANDING_REACH = 3;

/** The free ends of a bridge: line ends that no other line of the bridge starts or ends on. */
export function freeEnds(lines: readonly (readonly P2[])[]): P2[] {
  const count = new Map<string, { p: P2; n: number }>();
  for (const l of lines) {
    for (const p of [l[0], l[l.length - 1]]) {
      if (!p) continue;
      const key = `${Math.round(p.x * 100)},${Math.round(p.z * 100)}`;
      const c = count.get(key);
      if (c) c.n++;
      else count.set(key, { p, n: 1 });
    }
  }
  return [...count.values()].filter((c) => c.n === 1).map((c) => c.p).sort((a, b) => a.x - b.x || a.z - b.z);
}

export const fobLandings: Rule = {
  id: 'R-FOB-01',
  area: 'fob',
  title: 'Foot over bridge end not on a footpath',
  confidence: 0.7,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const b of ctx.graph.features.footBridges) {
      freeEnds(b.pts).forEach((p, k) => {
        // a bridge that walks into a building (a station hall, a mall) or on to a foot way or a platform is connected
        if (ctx.fps.query({ minX: p.x, minZ: p.z, maxX: p.x, maxZ: p.z }, LANDING_REACH).some((f) => segmentRing(p, p, f.f.ring) <= LANDING_REACH)) return;
        if (ctx.walkwayNear(p, LANDING_REACH) <= LANDING_REACH) return;
        const roads = ctx.near(p, 40).filter((c) => atGrade(c.seg.lv));
        const hit = roads[0];
        if (hit && hit.d < hit.seg.edge.road.width / 2 - 0.5) {
          const t = hit.seg.edge;
          const l = hit.d || 1;
          const edge = t.road.width / 2 + 0.5;
          const q = { x: hit.x + ((p.x - hit.x) / l) * edge, z: hit.z + ((p.z - hit.z) / l) * edge };
          out.push(ctx.issue(fobLandings, p, [b.id, `end${k}`], [t], 0.75, `an end comes down ${Math.round(hit.d * 10) / 10} m from the centre line of ${t.id}, inside its ${t.road.width} m carriageway`, [
            ctx.proposal('move_node', { op: 'fob_landing', bridge: b.id, end: k, to: t.id, x: r3(q.x), z: r3(q.z) }, 0.7, { kind: 'other' }, `The stairs of the foot over bridge ${b.id} end inside the carriageway of ${t.id}: move the landing to the footpath at its kerb`, [p, q]),
            ctx.proposal('set_tag', { key: 'width', value: Math.max(2, Math.round((2 * hit.d - 0.4) * 10) / 10), on: t.id }, 0.3, { kind: 'other' }, 'Or the road is narrower here than its class default', [hit.seg.a, hit.seg.b]),
          ]));
          return;
        }
        const reach = roads.find((c) => c.d <= c.seg.edge.road.width / 2 + Math.max(c.seg.edge.road.footpath.left, c.seg.edge.road.footpath.right) + LANDING_REACH);
        if (reach) return;
        out.push(ctx.issue(fobLandings, p, [b.id, `end${k}`], hit ? [hit.seg.edge] : [], 0.65, hit ? `an end comes down ${Math.round(hit.d)} m from the nearest road (${hit.seg.edge.id})` : 'an end comes down with no road within 40 m', [
          ctx.proposal('connect', { op: 'fob_link', bridge: b.id, end: k, to: hit ? hit.seg.edge.id : '', x: hit ? r3(hit.x) : r3(p.x), z: hit ? r3(hit.z) : r3(p.z) }, 0.6, { kind: 'other' }, `An end of the foot over bridge ${b.id} meets no footpath: generate a path from the landing to ${hit ? `the footpath of ${hit.seg.edge.id}` : 'the nearest street'}`, hit ? [p, { x: hit.x, z: hit.z }] : [p]),
          ctx.proposal('terminate', { node: `${b.id}#${k}`, with: 'closed_stair' }, 0.3, { kind: 'other' }, 'Or this end is closed off: a gate at the foot of the stair', [p]),
        ]));
      });
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};
