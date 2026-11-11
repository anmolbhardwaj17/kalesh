// Fitting reference lines to lane widths. OSM centre lines are not lane accurate: the two carriageways of a street
// are often drawn closer than their lanes are wide, and a slip road is drawn as a straight line that converges on
// the main line for hundreds of metres. Built as they are, such roads overlap. This step shifts reference lines
// sideways until every listed pair of roads keeps its distance ("lanes shift sideways and separate"). It is a map
// repair with a log: how many relations, how many edges moved and by how much at most.
import type { P2 } from '../geom.ts';
import { Curve, leftOf, smoothLine, smoothstep, unit } from './curve.ts';
import type { GEdge, Graph } from './graph.ts';

export interface FitRelation {
  a: number;
  b: number;
  /** Distance the two reference lines must keep. */
  minSep: number;
  /** Share of a needed shift each edge takes (a pair: half each; a slip road beside its main line: all of it). */
  wa: number;
  wb: number;
  /** The node both edges start from or end at, when they are the branches of a split: the distance grows from zero there. */
  node?: number;
  /** Length over which the distance of a split grows to minSep (it never grows faster than the class allows). */
  ramp?: number;
  kind: 'pair' | 'split';
}

export interface FitReport {
  relations: number;
  edgesMoved: number;
  maxShiftM: number;
  /** Relations still closer than their distance after the last round, and the largest shortfall. */
  unresolved: number;
  maxShortM: number;
  moved: { edge: string; maxShiftM: number }[];
}

const RAMP_M = 45;
const NODE_BLEND_M = 30;

/** Shifts the edges' curves apart. Nodes that only split or merge move with their edges; junction nodes stay. */
export function pushApart(graph: Graph, relations: readonly FitRelation[], fixedNodes: ReadonlySet<number>, rounds = 5): FitReport {
  const total = new Map<number, number>();
  let unresolved = 0;
  let maxShort = 0;
  for (let round = 0; round <= rounds; round++) {
    const last = round === rounds;
    unresolved = 0;
    maxShort = 0;
    const disp = new Map<number, { x: number[]; z: number[] }>();
    const dispOf = (e: GEdge): { x: number[]; z: number[] } => {
      let d = disp.get(e.index);
      if (!d) {
        d = { x: e.curve.pts.map(() => 0), z: e.curve.pts.map(() => 0) };
        disp.set(e.index, d);
      }
      return d;
    };
    for (const rel of relations) {
      const ea = graph.edges[rel.a] as GEdge;
      const eb = graph.edges[rel.b] as GEdge;
      let short = 0;
      const side = (e: GEdge, other: GEdge, share: number): void => {
        const d = dispOf(e);
        const nodeAtStart = rel.node !== undefined && e.a === rel.node;
        const nodeAtEnd = rel.node !== undefined && e.b === rel.node;
        let seg = -1;
        e.curve.pts.forEach((p, i) => {
          // a full search every 16 points, a search near the last answer in between
          const pr = other.curve.project(p, i % 16 === 0 ? -1 : seg);
          seg = pr.seg;
          let need = rel.minSep;
          if (rel.node !== undefined) {
            const along = nodeAtStart ? (e.curve.cum[i] as number) : nodeAtEnd ? e.len - (e.curve.cum[i] as number) : Infinity;
            need *= smoothstep(along / (rel.ramp ?? RAMP_M));
          }
          if (pr.d >= need || pr.d < 1e-6) return;
          const f = e.curve.smoothAt(e.curve.cum[i] as number);
          const g = other.curve.smoothAt(pr.s);
          if (Math.abs(f.tx * g.tx + f.tz * g.tz) < 0.8) return; // a crossing, not a road alongside
          const q = other.curve.at(pr.s);
          const u = unit(p.x - q.x, p.z - q.z);
          short = Math.max(short, need - pr.d);
          const move = (need - pr.d) * share * 1.02;
          // several relations may ask for a shift at one point: keep the largest
          if (move > Math.hypot(d.x[i] as number, d.z[i] as number)) {
            d.x[i] = u.x * move;
            d.z[i] = u.z * move;
          }
        });
      };
      const sum = rel.wa + rel.wb || 1;
      if (!last) {
        if (rel.wa > 0) side(ea, eb, rel.wa / sum);
        if (rel.wb > 0) side(eb, ea, rel.wb / sum);
      } else {
        // the last round only measures
        for (const p of ea.curve.pts) {
          const pr = eb.curve.project(p);
          let need = rel.minSep;
          if (rel.node !== undefined) {
            const along = ea.a === rel.node ? ea.curve.project(p).s : ea.b === rel.node ? ea.len - ea.curve.project(p).s : Infinity;
            need *= smoothstep(along / (rel.ramp ?? RAMP_M));
          }
          const f = ea.curve.smoothAt(ea.curve.project(p).s);
          const g = eb.curve.smoothAt(pr.s);
          if (pr.d < need - 0.05 && pr.d > 1e-6 && Math.abs(f.tx * g.tx + f.tz * g.tz) >= 0.8) short = Math.max(short, need - pr.d);
        }
      }
      if (short > 0.05) {
        unresolved++;
        maxShort = Math.max(maxShort, short);
      }
    }
    if (last || disp.size === 0) break;
    // smooth every shift along its edge (a grown maximum, then an average), so no kink is made
    const nodeShift = new Map<number, { x: number; z: number; n: number }>();
    for (const [index, d] of disp) {
      const n = d.x.length;
      for (const arr of [d.x, d.z]) {
        const src = arr.slice();
        for (let i = 0; i < n; i++) {
          let s = 0;
          let c = 0;
          for (let k = Math.max(0, i - 8); k <= Math.min(n - 1, i + 8); k++) {
            s += src[k] as number;
            c++;
          }
          // never less than what was asked at this point
          arr[i] = Math.abs(s / c) > Math.abs(src[i] as number) ? s / c : (src[i] as number);
        }
        const again = arr.slice();
        for (let i = 0; i < n; i++) {
          let s = 0;
          let c = 0;
          for (let k = Math.max(0, i - 4); k <= Math.min(n - 1, i + 4); k++) {
            s += again[k] as number;
            c++;
          }
          arr[i] = s / c;
        }
      }
      const e = graph.edges[index] as GEdge;
      for (const [id, i] of [[e.a, 0], [e.b, n - 1]] as [number, number][]) {
        const ns = nodeShift.get(id) ?? { x: 0, z: 0, n: 0 };
        ns.x += d.x[i] as number;
        ns.z += d.z[i] as number;
        ns.n++;
        nodeShift.set(id, ns);
      }
    }
    // every end of a node moves by the node's own shift: the mean of its edges, zero for a fixed node
    const shiftOf = (id: number): { x: number; z: number } => {
      const node = graph.nodes.get(id);
      const ns = nodeShift.get(id);
      if (!node || !ns || fixedNodes.has(id)) return { x: 0, z: 0 };
      return { x: ns.x / node.ends.length, z: ns.z / node.ends.length };
    };
    const touched = new Set<number>(disp.keys());
    for (const [id] of nodeShift) {
      const node = graph.nodes.get(id);
      if (node) for (const end of node.ends) touched.add(end.edge);
    }
    const moves = new Map<number, P2>();
    for (const index of touched) {
      const e = graph.edges[index] as GEdge;
      const d = dispOf(e);
      const n = d.x.length;
      const sa = shiftOf(e.a);
      const sb = shiftOf(e.b);
      const ea = { x: (d.x[0] as number) - sa.x, z: (d.z[0] as number) - sa.z };
      const eb = { x: (d.x[n - 1] as number) - sb.x, z: (d.z[n - 1] as number) - sb.z };
      let worst = 0;
      const pts = e.curve.pts.map((p, i) => {
        const wa = 1 - smoothstep((e.curve.cum[i] as number) / NODE_BLEND_M);
        const wb = 1 - smoothstep((e.len - (e.curve.cum[i] as number)) / NODE_BLEND_M);
        const dx = (d.x[i] as number) - ea.x * wa - eb.x * wb;
        const dz = (d.z[i] as number) - ea.z * wa - eb.z * wb;
        worst = Math.max(worst, Math.hypot(dx, dz));
        return { x: p.x + dx, z: p.z + dz };
      });
      if (worst < 1e-4) continue;
      total.set(index, (total.get(index) ?? 0) + worst);
      const scale = e.len;
      e.curve = new Curve(pts);
      e.len = e.curve.length;
      for (const piece of e.pieces) {
        piece.s0 = (piece.s0 / scale) * e.len;
        piece.s1 = (piece.s1 / scale) * e.len;
      }
      moves.set(e.a, pts[0] as P2);
      moves.set(e.b, pts[pts.length - 1] as P2);
    }
    for (const [id, p] of moves) {
      const node = graph.nodes.get(id);
      if (node) {
        node.x = p.x;
        node.z = p.z;
      }
    }
  }
  const moved = [...total].map(([index, m]) => ({ edge: (graph.edges[index] as GEdge).id, maxShiftM: Math.round(m * 100) / 100 })).sort((p, q) => q.maxShiftM - p.maxShiftM);
  return { relations: relations.length, edgesMoved: moved.length, maxShiftM: moved[0]?.maxShiftM ?? 0, unresolved, maxShortM: Math.round(maxShort * 100) / 100, moved: moved.slice(0, 8) };
}

/**
 * Limits how fast a slip road leaves (or joins) its main line. Mappers often draw the first piece of a slip road
 * as a short diagonal from the main line's centre to the slip road's own line: built as drawn, the lanes would
 * turn by 30 degrees and more at the node. Here the slip road's first stretch is redrawn beside the main line,
 * moving away from it by at most 1 m per `ratio` metres, until it meets its own mapped line again.
 * `atStart`: the node is the start of the edge. Returns the largest sideways move in metres.
 */
export function limitDivergence(minor: GEdge, minorAtStart: boolean, main: GEdge, mainAtStart: boolean, ratio: number): number {
  const out = minorAtStart ? minor.curve : minor.curve.reversed();
  const ref = mainAtStart ? main.curve : main.curve.reversed();
  const pts = out.pts.map((p) => ({ x: p.x, z: p.z }));
  // first find where the slip road is back within the allowed distance, walking while it still runs along the main
  // line. A ramp that turns away for good (a loop) never comes back: it is left as drawn.
  let caught = -1;
  let seg = -1;
  let lastS = 0;
  const proj: { s: number; d: number }[] = [{ s: 0, d: 0 }];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i] as P2;
    const pr = ref.project(p, i % 16 === 1 ? -1 : seg);
    seg = pr.seg;
    if (pr.s >= ref.length - 0.5 || pr.s > 220 || pr.s < lastS - 0.5) break;
    const f = ref.smoothAt(pr.s);
    const t = out.smoothAt(out.cum[i] as number);
    if (f.tx * t.tx + f.tz * t.tz < Math.cos((70 * Math.PI) / 180)) break;
    lastS = pr.s;
    proj.push(pr);
    if (pr.s > 3 && pr.d <= pr.s / ratio) {
      caught = i;
      break;
    }
  }
  if (caught < 0) return 0;
  let worst = 0;
  for (let i = 1; i < caught; i++) {
    const p = pts[i] as P2;
    const pr = proj[i] as { s: number; d: number };
    const allowed = pr.s / ratio;
    if (pr.d <= allowed) continue;
    const f = ref.smoothAt(pr.s);
    const n = leftOf(f.tx, f.tz);
    const side = (p.x - f.x) * n.nx + (p.z - f.z) * n.nz >= 0 ? 1 : -1;
    const q = { x: f.x + n.nx * side * allowed, z: f.z + n.nz * side * allowed };
    worst = Math.max(worst, Math.hypot(q.x - p.x, q.z - p.z));
    pts[i] = q;
  }
  if (worst < 0.05) return 0;
  // points may have bunched up or swapped along the line: keep those that go forward, then smooth through every 6th
  const kept: P2[] = [pts[0] as P2];
  for (let i = 1; i < pts.length; i++) {
    const a = kept[kept.length - 1] as P2;
    const b = pts[i] as P2;
    if (Math.hypot(b.x - a.x, b.z - a.z) >= 5.5 || i === pts.length - 1) kept.push(b);
  }
  // it leaves the node along the main line
  const refDir = ref.smoothAt(0, 6);
  const curve = smoothLine(kept, 1, { x: refDir.tx, z: refDir.tz });
  const old = minor.len;
  minor.curve = minorAtStart ? curve : curve.reversed();
  minor.len = minor.curve.length;
  for (const piece of minor.pieces) {
    piece.s0 = (piece.s0 / old) * minor.len;
    piece.s1 = (piece.s1 / old) * minor.len;
  }
  return worst;
}
