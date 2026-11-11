// The block graph (tools/bake/graph/, after the repair step) as the road graph the lane model plans on (P1-012):
// every edge gets a smooth reference line that leaves its nodes on the tangent the graph gives it (shared with the
// edge it runs on into), numbered nodes, and its way pieces with their layer and bridge flags. An optional filter
// builds the model for a part of the block only (a class list, left out ways, a box): the Phase 0 road bench sites
// are checked that way. Pure.
import type { Box2, P2 } from '../geom.ts';
import type { GraphEdge, GraphNode } from '../graph/build.ts';
import { smoothLine } from './curve.ts';
import type { EdgePiece, GEdge, GNode, Graph } from './graph.ts';

/**
 * How far a reference line may bow out from the graph line between two of its points (P1-033): the repair rules
 * (R-LANE-05, the building rules) read the graph line, so a line smoothed several metres off it (a service loop drawn
 * with right angle corners and 60 m sides bowed 8 m) lands on roads the repair kept apart.
 */
export const MAX_LINE_DEV_M = 0.5;

export interface RoadFilter {
  /** Road classes taken (links of a class come with it). */
  classes?: readonly string[];
  /** Ways ("way/<id>") left out: an edge with one of them is left out whole. */
  exclude?: readonly string[];
  /** Only edges with a point inside this box (block metres). */
  box?: Box2;
}

export interface RoadGraph {
  graph: Graph;
  /** Block graph edge of every road graph edge, by index. */
  source: GraphEdge[];
  /** Block graph node id of every numbered node. */
  nodeId: string[];
  nodeKind: GraphNode['kind'][];
}

export function filterEdges(edges: readonly GraphEdge[], f: RoadFilter | undefined): GraphEdge[] {
  const exclude = new Set(f?.exclude ?? []);
  const box = f?.box;
  return edges.filter((e) => {
    if (f?.classes && !f.classes.includes(e.road.cls)) return false;
    if (e.pieces.some((p) => exclude.has(p.way))) return false;
    if (box && !e.pts.some((p) => p.x >= box.minX && p.x <= box.maxX && p.z >= box.minZ && p.z <= box.maxZ)) return false;
    return true;
  });
}

/** The road graph of a block graph (or of the part a filter keeps). Edges and nodes are numbered in id order. */
export function roadGraph(nodes: readonly GraphNode[], edgesIn: readonly GraphEdge[]): RoadGraph {
  const edges = edgesIn.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const used = new Set<string>();
  for (const e of edges) used.add(e.a).add(e.b);
  const list = nodes.filter((n) => used.has(n.id)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const number = new Map<string, number>();
  const graph: Graph = { nodes: new Map(), edges: [] };
  const nodeId: string[] = [];
  const nodeKind: GraphNode['kind'][] = [];
  list.forEach((n, i) => {
    number.set(n.id, i);
    nodeId.push(n.id);
    nodeKind.push(n.kind);
    const node: GNode = { id: i, x: n.x, z: n.z, ends: [], clipped: n.kind === 'map_edge' };
    graph.nodes.set(i, node);
  });
  const source: GraphEdge[] = [];
  for (const e of edges) {
    const a = number.get(e.a);
    const b = number.get(e.b);
    if (a === undefined || b === undefined) continue;
    const curve = smoothLine(e.pts as P2[], 1, e.ta, e.tb, MAX_LINE_DEV_M);
    if (curve.length < 0.5) continue;
    const scale = curve.length / (e.len || 1);
    const pieces: EdgePiece[] = e.pieces.map((p) => ({
      s0: p.s0 * scale, s1: p.s1 * scale, way: p.way, lanes: null, width: null,
      // a tunnel lies under the ground whatever its layer tag says
      layer: p.tunnel && p.layer >= 0 ? -1 : p.layer, bridge: p.bridge, tags: {},
    }));
    if (pieces.length) (pieces[pieces.length - 1] as EdgePiece).s1 = curve.length;
    const index = graph.edges.length;
    const ge: GEdge = { id: e.id, index, a, b, curve, len: curve.length, cls: e.road.cls, link: e.road.link, oneway: e.oneway, name: e.name, pieces };
    graph.edges.push(ge);
    source.push(e);
    (graph.nodes.get(a) as GNode).ends.push({ edge: index, atStart: true });
    (graph.nodes.get(b) as GNode).ends.push({ edge: index, atStart: false });
  }
  return { graph, source, nodeId, nodeKind };
}
