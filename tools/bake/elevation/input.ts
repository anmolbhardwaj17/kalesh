// What the elevation solver reads from a bake stage (P1-013): the lane model's strips, joints and junctions, the
// carriageway pairs, water and railway lines of the block graph, the map edge ends, and which stations lie in a
// tunnel. Nothing is built again here: the lane model is the one the lanes step made. Pure.
import type { BlockGraph, GraphEdge } from '../graph/build.ts';
import type { LaneBuild } from '../roads/network.ts';
import { junctionRing } from './crossings.ts';
import type { ElevationJunction } from './crossings.ts';
import type { ElevationInput } from './solve.ts';

/** Per strip and station: 1 in a tunnel under the ground, 2 in a passage through a building (a tunnel tag at layer 0), else 0. */
export function tunnelKinds(build: Pick<LaneBuild, 'strips' | 'road'>): (Uint8Array | undefined)[] {
  const byId = new Map<string, GraphEdge>();
  const byWay = new Map<string, GraphEdge[]>();
  for (const e of build.road.source) {
    byId.set(e.id, e);
    for (const p of e.pieces) {
      const list = byWay.get(p.way);
      if (list) list.push(e);
      else byWay.set(p.way, [e]);
    }
  }
  return build.strips.map((s) => {
    const edge = byId.get(s.edge);
    if (edge) {
      if (!edge.pieces.some((p) => p.tunnel)) return undefined;
      return Uint8Array.from(s.st, (st) => {
        const p = edge.pieces.find((q) => st.s <= q.s1 + 1e-6) ?? edge.pieces[edge.pieces.length - 1];
        return p?.tunnel ? (p.layer < 0 ? 1 : 2) : 0;
      });
    }
    // a split zone names its node: it is in a tunnel when its roads are
    const pieces = s.ways.flatMap((w) => (byWay.get(w) ?? []).flatMap((e) => e.pieces.filter((p) => p.way === w)));
    if (!pieces.some((p) => p.tunnel)) return undefined;
    const real = pieces.some((p) => p.tunnel && p.layer < 0);
    return Uint8Array.from(s.st, (st) => (st.layer < 0 && !st.bridge ? (real ? 1 : 2) : 0));
  });
}

export function elevationInput(build: LaneBuild, graph: Pick<BlockGraph, 'pairs' | 'features'>, ground: (x: number, z: number) => number): ElevationInput {
  const { strips } = build;
  const junctions: ElevationJunction[] = build.junctions.map((j) => {
    const arms = j.arms.map((a) => ({ strip: a.strip, end: a.end }));
    return { centre: j.centre, ring: junctionRing(strips, j.centre, arms), arms };
  });
  const indexOf = new Map(build.road.source.map((e, i) => [e.id, i]));
  const stripsOf = (edge: string): number[] => {
    const b = build.built.get(indexOf.get(edge) ?? -1);
    const out: number[] = [];
    if (b) for (let i = b.first; i <= b.last; i++) out.push(i);
    return out;
  };
  const pairs = graph.pairs.map((p) => ({ a: stripsOf(p.a), b: stripsOf(p.b) })).filter((p) => p.a.length && p.b.length);
  return {
    strips, joints: build.joints, junctions, pairs, ground,
    ties: build.ends.filter((e) => e.kind === 'map_edge').map((e) => ({ strip: e.strip, end: e.end })),
    tunnels: tunnelKinds(build),
    rails: graph.features.rail.filter((r) => r.kind === 'rail').map((r) => ({ id: r.id, name: r.name, pts: r.pts, layer: r.layer, bridge: r.bridge, tunnel: r.tunnel })),
    water: graph.features.water.map((w) => ({ id: w.id, name: w.name, rings: w.rings })),
  };
}
