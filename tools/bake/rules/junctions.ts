// Intersection rules (R-JUNC) on the block graph: arms that leave a junction almost on top of each other, a road
// whose surface covers a junction it is not part of, node clusters too big to be one junction object, and dead-end
// arms shorter than their corner radius. The junction mesh builder reads the clusters (junctionClusters). Pure.
import type { P2 } from '../geom.ts';
import type { GraphEdge, GraphNode } from '../graph/build.ts';
import { classDefaults } from '../roads/model.ts';
import { byId, r3, sameLevel } from './context.ts';
import type { Rule, RuleContext } from './context.ts';
import { patchOf } from './types.ts';
import type { Issue } from './types.ts';

/** Two arms closer than this (degrees) leave a junction on top of each other. */
export const MIN_ARM_ANGLE = 12;

export const approachAngle: Rule = {
  id: 'R-JUNC-01',
  area: 'junctions',
  title: 'Junction arms leave almost on top of each other',
  confidence: 0.7,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    const limit = Math.cos((MIN_ARM_ANGLE * Math.PI) / 180);
    for (const n of ctx.graph.nodes) {
      if (n.kind !== 'junction') continue;
      const ends = ctx.ends.get(n.id) ?? [];
      for (let i = 0; i < ends.length; i++) {
        for (let j = i + 1; j < ends.length; j++) {
          const a = ends[i]!;
          const b = ends[j]!;
          if (a.edge === b.edge || !sameLevel(ctx.endLevel(a), ctx.endLevel(b))) continue;
          // slip roads and the two carriageways of a street leave at a fine angle by design: the lane rules check them
          if (a.edge.road.link || b.edge.road.link || (a.edge.oneway && b.edge.oneway)) continue;
          const da = ctx.dirFrom(a, 10);
          const db = ctx.dirFrom(b, 10);
          const dot = da.x * db.x + da.z * db.z;
          if (dot < limit) continue;
          const deg = Math.round(((Math.acos(Math.min(1, dot)) * 180) / Math.PI) * 10) / 10;
          const minor = classDefaults(a.edge.road.cls).cornerRadius <= classDefaults(b.edge.road.cls).cornerRadius ? a : b;
          out.push(ctx.issue(approachAngle, n, [a.edge.id, b.edge.id, n.id], [a.edge, b.edge], 0.7, `arms ${deg} degrees apart`, [
            ctx.proposal('replace_geometry', { op: 'square_arm', on: minor.edge.id, node: n.id, min_deg: 30 }, 0.6, { kind: 'other' }, `${a.edge.id} and ${b.edge.id} leave the junction ${deg} degrees apart, so their surfaces lie on each other: turn the last metres of the smaller arm to meet at 30 degrees`, minor.edge.pts),
            ctx.proposal('remove', { drop: minor.edge.id }, 0.25, { kind: 'other' }, 'Or the smaller arm is the same road drawn twice: drop it', minor.edge.pts),
          ]));
        }
      }
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};

/** Junction nodes joined by an edge up to this long (m) are one junction. */
export const CLUSTER_GAP = 18;

export interface Cluster {
  /** The lowest node id. */
  id: string;
  nodes: GraphNode[];
  /** Edges with both ends in the cluster. */
  inside: GraphEdge[];
  /** Largest distance between two of its nodes. */
  span: number;
}

/** Junction nodes (three or more ends) joined by short edges, as clusters of two or more: one junction object each. */
export function junctionClusters(ctx: RuleContext): Cluster[] {
  const cached = ctx.cache.get('clusters') as Cluster[] | undefined;
  if (cached) return cached;
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let p = parent.get(id) ?? id;
    while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p;
    parent.set(id, p);
    return p;
  };
  const isJ = (id: string): boolean => (ctx.nodes.get(id)?.ends ?? 0) >= 3;
  const short = ctx.graph.edges.filter((e) => e.len <= CLUSTER_GAP && e.a !== e.b && isJ(e.a) && isJ(e.b));
  for (const e of short) parent.set(find(e.a), find(e.b));
  const groups = new Map<string, Set<string>>();
  for (const e of short) {
    for (const id of [e.a, e.b]) {
      const r = find(id);
      const g = groups.get(r);
      if (g) g.add(id);
      else groups.set(r, new Set([id]));
    }
  }
  const out: Cluster[] = [];
  for (const set of groups.values()) {
    const nodes = [...set].sort().map((id) => ctx.nodes.get(id) as GraphNode);
    let span = 0;
    for (const a of nodes) for (const b of nodes) span = Math.max(span, Math.hypot(a.x - b.x, a.z - b.z));
    out.push({ id: (nodes[0] as GraphNode).id, nodes, inside: short.filter((e) => set.has(e.a) && set.has(e.b)).sort(byId), span: r3(span) });
  }
  out.sort(byId);
  ctx.cache.set('clusters', out);
  return out;
}

export const surfaceOverJunction: Rule = {
  id: 'R-JUNC-02',
  area: 'junctions',
  title: 'A road surface covers a junction it is not part of',
  confidence: 0.7,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const n of ctx.graph.nodes) {
      if (n.kind !== 'junction') continue;
      const ends = ctx.ends.get(n.id) ?? [];
      const lv = ctx.endLevel(ends[0]!);
      const mine = new Set(ends.map((e) => e.edge));
      // nodes one short edge away are the same junction cluster: their roads belong here
      const close = new Set<string>([n.id]);
      for (const e of mine) if (e.len <= CLUSTER_GAP) close.add(e.a).add(e.b);
      const paired = new Set(ends.flatMap((e) => e.edge.pairedWith));
      for (const c of ctx.near(n, 12)) {
        const t = c.seg.edge;
        if (mine.has(t) || close.has(t.a) || close.has(t.b) || paired.has(t.id) || !sameLevel(c.seg.lv, lv)) continue;
        if (c.d > t.road.width / 2 - 0.3) continue;
        const at: P2 = { x: c.x, z: c.z };
        out.push(ctx.issue(surfaceOverJunction, n, [t.id, n.id], [t, ...mine], 0.7, `${t.id} passes ${Math.round(c.d * 10) / 10} m from the junction, inside its own ${t.road.width} m width`, [
          ctx.proposal('connect', { op: 'attach', node: n.id, to: t.id, x: r3(c.x), z: r3(c.z) }, 0.55, { kind: 'other' }, `${t.id} runs over the junction ${n.id} on the same level without meeting it: make it an arm of the junction`, [n, at]),
          ctx.proposal('set_tag', { key: 'layer', value: 1, on: t.id, bridge: true }, 0.3, { kind: 'other' }, 'Or it passes over the junction and its bridge and layer tags are missing', t.pts),
        ]));
      }
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};

/** A cluster wider than this (m), or with more nodes, is too big to be one junction without a person's look. */
export const CLUSTER_MAX_SPAN = 45;
export const CLUSTER_MAX_NODES = 8;

export const junctionCluster: Rule = {
  id: 'R-JUNC-03',
  area: 'junctions',
  title: 'Node cluster too big to be one junction object',
  confidence: 0.6,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const c of junctionClusters(ctx)) {
      if (c.span <= CLUSTER_MAX_SPAN && c.nodes.length <= CLUSTER_MAX_NODES) continue;
      const cx = c.nodes.reduce((s, n) => s + n.x, 0) / c.nodes.length;
      const cz = c.nodes.reduce((s, n) => s + n.z, 0) / c.nodes.length;
      const longest = c.inside.reduce((a, b) => (b.len > a.len ? b : a));
      const ring = c.nodes.map((n) => ({ x: n.x, z: n.z }));
      out.push(ctx.issue(junctionCluster, { x: cx, z: cz }, c.nodes.map((n) => n.id).slice(0, 4), c.inside, 0.6, `${c.nodes.length} junction nodes joined by short edges, ${Math.round(c.span)} m across`, [
        ctx.proposal('set_tag', { key: 'bake:junction', value: 'one', on: c.id, nodes: c.nodes.length }, 0.5, { kind: 'other' }, `${c.nodes.length} nodes within ${CLUSTER_GAP} m steps of each other: one big junction (the ITO crossing is one)`, ring),
        ctx.proposal('replace_geometry', { op: 'split_cluster', on: c.id, at: longest.id }, 0.45, { kind: 'other' }, `Or two junctions: split the cluster at its longest inner edge ${longest.id} (${Math.round(longest.len)} m)`, longest.pts),
      ]));
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};

export const shortArm: Rule = {
  id: 'R-JUNC-04',
  area: 'junctions',
  title: 'Junction arm shorter than its corner radius',
  confidence: 0.7,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const e of ctx.graph.edges) {
      const radius = classDefaults(e.road.cls).cornerRadius;
      if (e.len >= radius || e.a === e.b) continue;
      const a = ctx.nodes.get(e.a);
      const b = ctx.nodes.get(e.b);
      if (!a || !b) continue;
      // a dead-end stub at a junction: the corner arcs of the junction are longer than the arm itself
      const [junction, tip] = a.kind === 'junction' && b.kind === 'end' ? [a, b] : b.kind === 'junction' && a.kind === 'end' ? [b, a] : [null, null];
      if (!junction || !tip) continue;
      out.push(ctx.issue(shortArm, tip, [e.id, junction.id], [e], 0.7, `a ${Math.round(e.len * 10) / 10} m arm, corner radius ${radius} m`, [
        ctx.proposal('remove', { drop: e.id }, 0.6, { kind: 'other' }, `${e.id} is a ${Math.round(e.len * 10) / 10} m stub at the junction ${junction.id}, shorter than the ${radius} m corner radius of its class: leave the stub out`, e.pts),
        ctx.proposal('terminate', { node: tip.id, with: 'kerb' }, 0.4, { kind: 'other' }, 'Or keep it as a short bay closed by a kerb', [tip]),
      ]));
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};
