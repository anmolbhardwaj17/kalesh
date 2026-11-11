// The road graph of one site, from the bake's map model (tools/bake/osm.ts): ways are clipped to the site, cut at
// every node they share, and chains through plain nodes are joined again, so an edge runs from one real node
// (a junction, a split, a merge, an end) to the next. An edge keeps the tags of every way piece along it.
import type { P2 } from '../geom.ts';
import type { Road, Tags } from '../osm.ts';
import { Curve, smoothLine } from './curve.ts';

export type Region = { kind: 'box'; minX: number; minZ: number; maxX: number; maxZ: number } | { kind: 'circle'; cx: number; cz: number; r: number };

export interface SiteSpec {
  id: string;
  name: string;
  region: Region;
  /** Road classes taken into the site (links of a class come with it). */
  classes: string[];
  /** Way ids ("way/123") left out. */
  exclude?: string[];
  /** Junction nodes joined by an edge shorter than this are one junction (metres). */
  clusterDist?: number;
}

export interface EdgePiece {
  s0: number;
  s1: number;
  way: string;
  lanes: number | null;
  width: number | null;
  layer: number;
  bridge: boolean;
  tags: Tags;
}

export interface GEdge {
  id: string;
  index: number;
  a: number;
  b: number;
  curve: Curve;
  len: number;
  cls: string;
  link: boolean;
  oneway: boolean;
  name: string;
  pieces: EdgePiece[];
}

export interface GEnd {
  edge: number;
  atStart: boolean;
}

export interface GNode extends P2 {
  id: number;
  ends: GEnd[];
  /** Made by the site clip: the road goes on outside the site. */
  clipped: boolean;
}

export interface Graph {
  nodes: Map<number, GNode>;
  edges: GEdge[];
}

export function inRegion(r: Region, p: P2): boolean {
  if (r.kind === 'box') return p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ;
  return Math.hypot(p.x - r.cx, p.z - r.cz) <= r.r;
}

export function regionRing(r: Region, pad = 0, step = 12): P2[] {
  if (r.kind === 'box') {
    return [{ x: r.minX - pad, z: r.minZ - pad }, { x: r.maxX + pad, z: r.minZ - pad }, { x: r.maxX + pad, z: r.maxZ + pad }, { x: r.minX - pad, z: r.maxZ + pad }];
  }
  const n = Math.max(24, Math.ceil((2 * Math.PI * (r.r + pad)) / step));
  const out: P2[] = [];
  for (let i = 0; i < n; i++) out.push({ x: r.cx + Math.cos((i / n) * 2 * Math.PI) * (r.r + pad), z: r.cz + Math.sin((i / n) * 2 * Math.PI) * (r.r + pad) });
  return out;
}

const num = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)/.exec(v);
  return m ? Number(m[1]) : null;
};

interface Raw {
  road: Road;
  nodes: number[];
  pts: P2[];
}

interface Draft {
  a: number;
  b: number;
  cls: string;
  link: boolean;
  oneway: boolean;
  name: string;
  /** Way pieces in order, each with its own points (the first point of a piece is the last of the one before). */
  parts: { road: Road; pts: P2[] }[];
}

/** The site graph. Every way of the listed classes that enters the region is taken and cut at the region's edge. */
export function buildGraph(roads: readonly Road[], site: SiteSpec): Graph {
  const exclude = new Set(site.exclude ?? []);
  let synthetic = -1;
  const clippedNodes = new Set<number>();
  const raws: Raw[] = [];
  for (const road of roads) {
    if (!site.classes.includes(road.cls) || exclude.has(road.id) || road.tunnel) continue;
    let nodes = road.nodes;
    let pts = road.pts;
    if (road.tags['oneway'] === '-1') {
      nodes = nodes.slice().reverse();
      pts = pts.slice().reverse();
    }
    let run: Raw | null = null;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i] as P2;
      const inside = inRegion(site.region, p);
      const prev = i > 0 ? (pts[i - 1] as P2) : null;
      if (prev && inside !== inRegion(site.region, prev)) {
        // the crossing of the region's edge, by bisection
        let lo = prev;
        let hi = p;
        for (let k = 0; k < 24; k++) {
          const mid = { x: (lo.x + hi.x) / 2, z: (lo.z + hi.z) / 2 };
          if (inRegion(site.region, mid) === inRegion(site.region, prev)) lo = mid;
          else hi = mid;
        }
        const id = synthetic--;
        clippedNodes.add(id);
        if (inside) {
          run = { road, nodes: [id], pts: [{ ...lo }] };
        } else if (run) {
          run.nodes.push(id);
          run.pts.push({ ...lo });
          if (run.pts.length >= 2) raws.push(run);
          run = null;
        }
      }
      if (inside) {
        if (!run) run = { road, nodes: [], pts: [] };
        run.nodes.push(nodes[i] as number);
        run.pts.push({ x: p.x, z: p.z });
      }
    }
    if (run && run.pts.length >= 2) raws.push(run);
  }

  // how often a node is used: an end counts once, a point inside a way twice
  const use = new Map<number, number>();
  for (const r of raws) {
    r.nodes.forEach((id, i) => use.set(id, (use.get(id) ?? 0) + (i === 0 || i === r.nodes.length - 1 ? 1 : 2)));
  }
  let drafts: Draft[] = [];
  const position = new Map<number, P2>();
  for (const r of raws) {
    let start = 0;
    for (let i = 1; i < r.nodes.length; i++) {
      const last = i === r.nodes.length - 1;
      if (!last && (use.get(r.nodes[i] as number) ?? 0) <= 2) continue;
      const pts = r.pts.slice(start, i + 1);
      drafts.push({ a: r.nodes[start] as number, b: r.nodes[i] as number, cls: r.road.cls, link: r.road.link, oneway: r.road.oneway, name: r.road.name, parts: [{ road: r.road, pts }] });
      position.set(r.nodes[start] as number, r.pts[start] as P2);
      position.set(r.nodes[i] as number, r.pts[i] as P2);
      start = i;
    }
  }

  // join chains through nodes that only two edge ends use
  const reverse = (d: Draft): void => {
    [d.a, d.b] = [d.b, d.a];
    d.parts = d.parts.reverse().map((p) => ({ road: p.road, pts: p.pts.slice().reverse() }));
  };
  for (let guard = 0; guard < 10000; guard++) {
    const at = new Map<number, Draft[]>();
    for (const d of drafts) {
      for (const id of d.a === d.b ? [d.a] : [d.a, d.b]) {
        const list = at.get(id);
        if (list) list.push(d);
        else at.set(id, [d]);
      }
    }
    let merged = false;
    for (const [id, list] of at) {
      if (list.length !== 2 || clippedNodes.has(id)) continue;
      const [p, q] = list as [Draft, Draft];
      if (p === q || p.a === p.b || q.a === q.b) continue;
      if (p.cls !== q.cls || p.link !== q.link || p.oneway !== q.oneway) continue;
      let first = p;
      let second = q;
      if (p.oneway) {
        if (p.b === id && q.a === id) [first, second] = [p, q];
        else if (q.b === id && p.a === id) [first, second] = [q, p];
        else continue;
      } else {
        if (first.b !== id) reverse(first);
        if (second.a !== id) reverse(second);
      }
      first.b = second.b;
      first.parts.push(...second.parts);
      if (!first.name) first.name = second.name;
      drafts = drafts.filter((d) => d !== second);
      merged = true;
      break;
    }
    if (!merged) break;
  }

  const graph: Graph = { nodes: new Map(), edges: [] };
  const nodeOf = (id: number): GNode => {
    let n = graph.nodes.get(id);
    if (!n) {
      const p = position.get(id) as P2;
      n = { id, x: p.x, z: p.z, ends: [], clipped: clippedNodes.has(id) };
      graph.nodes.set(id, n);
    }
    return n;
  };
  drafts.sort((x, y) => ((x.parts[0] as { road: Road }).road.id < (y.parts[0] as { road: Road }).road.id ? -1 : 1));
  // tangents at nodes: an edge that runs on into another (the nearest in direction, under 45 degrees apart) shares
  // one direction with it there, so the reference line does not kink at a node that only exists in the map
  const flat = (d: Draft): P2[] => d.parts.flatMap((part) => part.pts);
  const dirAt = (d: Draft, atStart: boolean): P2 => {
    const pts = flat(d);
    const a = (atStart ? pts[0] : pts[pts.length - 2]) as P2;
    const b = (atStart ? pts[1] : pts[pts.length - 1]) as P2;
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
  };
  const hint = new Map<Draft, { start?: P2; end?: P2 }>();
  const endsAt = new Map<number, { d: Draft; atStart: boolean }[]>();
  for (const d of drafts) {
    for (const [id, atStart] of [[d.a, true], [d.b, false]] as [number, boolean][]) {
      const list = endsAt.get(id);
      if (list) list.push({ d, atStart });
      else endsAt.set(id, [{ d, atStart }]);
    }
  }
  for (const [id, list] of endsAt) {
    if (clippedNodes.has(id) || list.length < 2) continue;
    // directions through the node: an end that arrives keeps its direction, an end that leaves too
    const cand: { i: number; j: number; dot: number }[] = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const p = list[i] as { d: Draft; atStart: boolean };
        const q = list[j] as { d: Draft; atStart: boolean };
        if (p.d === q.d) continue;
        // walking through the node from p to q: p's direction towards the node, q's away from it
        const dp = dirAt(p.d, p.atStart);
        const dq = dirAt(q.d, q.atStart);
        const tp = p.atStart ? { x: -dp.x, z: -dp.z } : dp;
        const tq = q.atStart ? dq : { x: -dq.x, z: -dq.z };
        if (p.d.oneway && q.d.oneway && p.atStart === q.atStart) continue; // two that arrive or two that leave
        cand.push({ i, j, dot: tp.x * tq.x + tp.z * tq.z });
      }
    }
    cand.sort((x, y) => y.dot - x.dot);
    const taken = new Set<number>();
    for (const c of cand) {
      if (c.dot < Math.cos(Math.PI / 4) || taken.has(c.i) || taken.has(c.j)) continue;
      taken.add(c.i);
      taken.add(c.j);
      const p = list[c.i] as { d: Draft; atStart: boolean };
      const q = list[c.j] as { d: Draft; atStart: boolean };
      const dp = dirAt(p.d, p.atStart);
      const dq = dirAt(q.d, q.atStart);
      const tp = p.atStart ? { x: -dp.x, z: -dp.z } : dp;
      const tq = q.atStart ? dq : { x: -dq.x, z: -dq.z };
      const len = Math.hypot(tp.x + tq.x, tp.z + tq.z) || 1;
      const through = { x: (tp.x + tq.x) / len, z: (tp.z + tq.z) / len };
      // as a direction along each edge's own order
      const hp = hint.get(p.d) ?? {};
      if (p.atStart) hp.start = { x: -through.x, z: -through.z };
      else hp.end = through;
      hint.set(p.d, hp);
      const hq = hint.get(q.d) ?? {};
      if (q.atStart) hq.start = through;
      else hq.end = { x: -through.x, z: -through.z };
      hint.set(q.d, hq);
    }
  }
  for (const d of drafts) {
    const pts: P2[] = flat(d);
    const h = hint.get(d) ?? {};
    const curve = smoothLine(pts, 1, h.start, h.end);
    if (curve.length < 0.5) continue;
    const pieces: EdgePiece[] = [];
    let s0 = 0;
    d.parts.forEach((part, i) => {
      const end = i === d.parts.length - 1 ? curve.length : Math.max(s0, nearestAhead(curve, part.pts[part.pts.length - 1] as P2, s0));
      const t = part.road.tags;
      pieces.push({ s0, s1: end, way: part.road.id, lanes: num(t['lanes']), width: num(t['width']), layer: part.road.layer, bridge: part.road.bridge, tags: t });
      s0 = end;
    });
    const index = graph.edges.length;
    const ways = [...new Set(d.parts.map((p) => p.road.id.replace('way/', '')))];
    graph.edges.push({ id: `e${index}_${ways[0]}`, index, a: d.a, b: d.b, curve, len: curve.length, cls: d.cls, link: d.link, oneway: d.oneway, name: d.name, pieces });
    nodeOf(d.a).ends.push({ edge: index, atStart: true });
    nodeOf(d.b).ends.push({ edge: index, atStart: false });
  }
  return graph;
}

/** Arc length of the curve point nearest to p at or after `from` (a closed way passes its first point twice). */
function nearestAhead(curve: Curve, p: P2, from: number): number {
  let best = from;
  let bestD = Infinity;
  for (let i = 0; i < curve.pts.length; i++) {
    const s = curve.cum[i] as number;
    if (s < from) continue;
    const q = curve.pts[i] as P2;
    const d = Math.hypot(q.x - p.x, q.z - p.z);
    if (d < bestD - 1e-9) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

export function pieceAt(e: GEdge, s: number): EdgePiece {
  for (const p of e.pieces) if (s <= p.s1 + 1e-9) return p;
  return e.pieces[e.pieces.length - 1] as EdgePiece;
}

/** The curve of an edge walked away from one of its nodes. */
export const outward = (e: GEdge, atStart: boolean): Curve => (atStart ? e.curve : e.curve.reversed());
