// Checks and counts of the block graph (P1-009): the invariants the bake stops on (no duplicate or zero-length edge,
// every edge end is a node, every clipped road ends in a map edge node), the counts of the health report, and a hash
// of the whole graph so two runs can be compared. Pure.
import { pointSegment } from '../geom.ts';
import type { P2 } from '../geom.ts';
import type { BlockGraph, GraphEdge } from './build.ts';

export interface GraphChecks {
  duplicateEdges: string[];
  zeroLengthEdges: string[];
  /** Edge ends that name a node the graph does not have. */
  missingNodes: string[];
  /** Nodes no edge uses. */
  orphanNodes: string[];
  /** Clip crossings with no map edge node on them. */
  crossingsWithoutEnd: number;
  /** Map edge nodes that are not one edge end on the outline. */
  badMapEdgeNodes: string[];
  ok: boolean;
}

/** Largest distance (m) from any point of a to the line b. */
function farthest(a: readonly P2[], b: readonly P2[]): number {
  let worst = 0;
  for (const p of a) {
    let best = Infinity;
    for (let i = 0; i + 1 < b.length; i++) best = Math.min(best, pointSegment(p, b[i] as P2, b[i + 1] as P2).d);
    worst = Math.max(worst, best);
  }
  return worst;
}

/** Two edges between the same nodes along the same line (within half a metre everywhere) are one road drawn twice. */
export function duplicateEdges(edges: readonly GraphEdge[], tol = 0.5): string[] {
  const byEnds = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    const key = e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
    const list = byEnds.get(key);
    if (list) list.push(e);
    else byEnds.set(key, [e]);
  }
  const out: string[] = [];
  for (const list of byEnds.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i] as GraphEdge;
        const b = list[j] as GraphEdge;
        if (Math.abs(a.len - b.len) > 2 * tol) continue;
        if (farthest(a.pts, b.pts) <= tol && farthest(b.pts, a.pts) <= tol) out.push(`${a.id}=${b.id}`);
      }
    }
  }
  return out.sort();
}

function distToRing(p: P2, ring: readonly P2[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) best = Math.min(best, pointSegment(p, ring[i] as P2, ring[(i + 1) % ring.length] as P2).d);
  return best;
}

export function checkGraph(g: BlockGraph): GraphChecks {
  const nodes = new Map(g.nodes.map((n) => [n.id, n]));
  const used = new Set<string>();
  const missingNodes: string[] = [];
  for (const e of g.edges) {
    for (const id of [e.a, e.b]) {
      used.add(id);
      if (!nodes.has(id)) missingNodes.push(`${e.id}:${id}`);
    }
  }
  const orphanNodes = g.nodes.filter((n) => !used.has(n.id)).map((n) => n.id);
  const mapEdge = g.nodes.filter((n) => n.kind === 'map_edge');
  const badMapEdgeNodes = mapEdge.filter((n) => n.ends !== 1 || distToRing(n, g.outline) > 0.01).map((n) => n.id);
  let crossingsWithoutEnd = 0;
  for (const c of g.crossings) if (!mapEdge.some((n) => Math.abs(n.x - c.x) < 0.002 && Math.abs(n.z - c.z) < 0.002)) crossingsWithoutEnd++;
  const duplicates = duplicateEdges(g.edges);
  const zero = g.edges.filter((e) => !(e.len >= 0.01)).map((e) => e.id);
  const ok = !duplicates.length && !zero.length && !missingNodes.length && !orphanNodes.length && !badMapEdgeNodes.length && crossingsWithoutEnd === 0 && mapEdge.length === g.crossings.length;
  return { duplicateEdges: duplicates, zeroLengthEdges: zero, missingNodes, orphanNodes, crossingsWithoutEnd, badMapEdgeNodes, ok };
}

/** cyrb53-style 2 x 32 bit hash of a text, as 14 hex digits (not cryptographic: a change detector). */
export function hashText(text: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** Hash of the whole graph (its JSON text). */
export const graphHash = (g: BlockGraph): string => hashText(JSON.stringify(g));

export interface GraphCounts {
  nodes: number;
  nodesByKind: Record<string, number>;
  edges: number;
  roadKm: number;
  edgesByClass: Record<string, number>;
  mapEdgeEnds: number;
  pairs: number;
  pairedEdges: number;
  pairedStreets: number;
  oneWayUnpaired: number;
  lanesFromTag: number;
  footprints: number;
  footprintsBySource: Record<string, number>;
  rail: number;
  railKm: number;
  metro: number;
  metroKm: number;
  footBridges: number;
  water: number;
  waterLines: number;
  open: number;
}

const tally = (list: readonly string[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const k of [...list].sort()) out[k] = (out[k] ?? 0) + 1;
  return out;
};

export function graphCounts(g: BlockGraph): GraphCounts {
  const km = (v: number): number => Math.round(v / 10) / 100;
  const rail = g.features.rail.filter((l) => l.kind === 'rail');
  const metro = g.features.rail.filter((l) => l.kind === 'metro');
  return {
    nodes: g.nodes.length, nodesByKind: tally(g.nodes.map((n) => n.kind)), edges: g.edges.length, roadKm: km(g.edges.reduce((s, e) => s + e.len, 0)),
    edgesByClass: tally(g.edges.map((e) => (e.road.link ? `${e.road.cls}_link` : e.road.cls))),
    mapEdgeEnds: g.nodes.filter((n) => n.kind === 'map_edge').length,
    pairs: g.pairs.length, pairedEdges: g.edges.filter((e) => e.pairedWith.length).length,
    pairedStreets: new Set(g.pairs.map((p) => p.name).filter(Boolean)).size,
    oneWayUnpaired: g.edges.filter((e) => e.oneway && !e.pairedWith.length).length,
    lanesFromTag: g.edges.filter((e) => e.road.lanesFrom === 'tag').length,
    footprints: g.footprints.length, footprintsBySource: tally(g.footprints.map((f) => f.source)),
    rail: rail.length, railKm: km(rail.reduce((s, l) => s + l.len, 0)), metro: metro.length, metroKm: km(metro.reduce((s, l) => s + l.len, 0)),
    footBridges: g.features.footBridges.length, water: g.features.water.length, waterLines: g.features.waterLines.length, open: g.features.open.length,
  };
}

/** The graph invariants of the bake: a failed one stops it before tiles are written. */
export function graphInvariants(c: GraphChecks, counts: GraphCounts): { id: string; ok: boolean; detail: string }[] {
  const topo = c.duplicateEdges.length + c.zeroLengthEdges.length + c.missingNodes.length + c.orphanNodes.length;
  const edge = c.crossingsWithoutEnd + c.badMapEdgeNodes.length;
  return [
    {
      id: 'GRAPH-01.topology', ok: topo === 0,
      detail: topo === 0 ? `${counts.nodes} nodes, ${counts.edges} edges: no duplicate or zero-length edge, every edge end is a node` : `duplicate ${c.duplicateEdges.slice(0, 3).join(', ')} (${c.duplicateEdges.length}), zero length ${c.zeroLengthEdges.length}, missing nodes ${c.missingNodes.length}, orphan nodes ${c.orphanNodes.length}`,
    },
    {
      id: 'GRAPH-02.map_edge', ok: edge === 0,
      detail: edge === 0 ? `${counts.mapEdgeEnds} roads leave the stage, each ends in a map edge node on the outline` : `${c.crossingsWithoutEnd} clip crossings without a map edge node, ${c.badMapEdgeNodes.length} map edge nodes off the outline or shared (${c.badMapEdgeNodes.slice(0, 3).join(', ')})`,
    },
  ];
}
