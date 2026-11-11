// Shifts that may move nodes (P1-031), for the applier (apply.ts). Two roads beside each other (rule R-LANE-05) each
// move half of what is missing away from the other, right up to an end whose node may move: the node moves with
// the road and every other road at it follows over its own blend length (rules/beside.ts blendLength), so its far
// node stays. A branch of a split with no room for a gore (rule R-LANE-04) moves out from the split node, growing
// 1 m per slipRatio metres, so the branches open within their length and the lane model builds a zone. A node the
// two roads share, a node at the map edge and a loop's node stay where they are. Pure.
import { polylineLength } from '../geom.ts';
import type { P2 } from '../geom.ts';
import type { BlockGraph, GraphEdge, GraphNode } from '../graph/build.ts';
import { blendLength, shiftField } from '../rules/beside.ts';
import { r3 } from '../rules/context.ts';
import { slipRatio } from '../rules/lanes.ts';
import type { Marks, Params } from '../rules/types.ts';

export interface ShiftState {
  graph: BlockGraph;
  marks: Marks;
  geometryChanged: boolean;
}

export interface ShiftResult {
  applied: boolean;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  note: string;
}

const smoothstep = (t: number): number => {
  const v = Math.max(0, Math.min(1, t));
  return v * v * (3 - 2 * v);
};
const rp = (p: P2): P2 => ({ x: r3(p.x), z: r3(p.z) });

/** New points for an edge: its length and the positions of its pieces follow. */
function setPoints(e: GraphEdge, pts: readonly P2[]): void {
  const old = e.len || 1;
  e.pts = pts.map(rp);
  e.len = r3(polylineLength(e.pts));
  for (const piece of e.pieces) {
    piece.s0 = r3((piece.s0 / old) * e.len);
    piece.s1 = r3((piece.s1 / old) * e.len);
  }
  if (e.pieces.length) (e.pieces[e.pieces.length - 1] as GraphEdge['pieces'][number]).s1 = e.len;
}

function addMark(marks: Marks, id: string, values: Params): void {
  marks[id] = { ...(marks[id] ?? {}), ...values };
}

const withList = (v: unknown, add: string): string => [...new Set([...String(v ?? '').split(',').filter(Boolean), add])].sort().join(',');

/** Moves a node by v; every road at it except `own` follows, fading over its blend length. */
function moveNode(g: BlockGraph, id: string, v: P2, own: ReadonlySet<GraphEdge>): string[] {
  const node = g.nodes.find((n) => n.id === id) as GraphNode | undefined;
  if (!node) return [];
  node.x = r3(node.x + v.x);
  node.z = r3(node.z + v.z);
  const moved: string[] = [];
  for (const c of g.edges) {
    if (own.has(c) || (c.a !== id && c.b !== id)) continue;
    moved.push(c.id);
    if (c.a === id && c.b === id) {
      setPoints(c, c.pts.map((p) => ({ x: p.x + v.x, z: p.z + v.z })));
      continue;
    }
    const blend = Math.max(1e-3, blendLength(c));
    let s = 0;
    const fromA = c.pts.map((p, i) => {
      if (i > 0) s += Math.hypot(p.x - (c.pts[i - 1] as P2).x, p.z - (c.pts[i - 1] as P2).z);
      return s;
    });
    const len = s;
    setPoints(c, c.pts.map((p, i) => {
      const t = c.a === id ? (fromA[i] as number) : len - (fromA[i] as number);
      const w = 1 - smoothstep(t / blend);
      return { x: p.x + v.x * w, z: p.z + v.z * w };
    }));
  }
  return moved;
}

const nodeKind = (g: BlockGraph, id: string): GraphNode['kind'] | null => g.nodes.find((n) => n.id === id)?.kind ?? null;

/** Rule R-LANE-05: both roads move apart; the ends whose nodes may move go with them. */
export function shiftBeside(state: ShiftState, a: GraphEdge, b: GraphEdge, p: Params, issue: string): ShiftResult {
  const g = state.graph;
  const minSep = Number(p['min_sep']);
  const shared = new Set([a.a, a.b].filter((n) => n === b.a || n === b.b));
  const stays = (e: GraphEdge, id: string): boolean => e.a === e.b || shared.has(id) || nodeKind(g, id) === 'map_edge';
  const fa = shiftField(a, b.pts, minSep, 0.5, { start: stays(a, a.a), end: stays(a, a.b) }, blendLength(a));
  const fb = shiftField(b, a.pts, minSep, 0.5, { start: stays(b, b.a), end: stays(b, b.b) }, blendLength(b));
  const done = (e: GraphEdge, other: GraphEdge, m: number): void => {
    addMark(state.marks, e.id, { shifted_m: Math.max(Number(state.marks[e.id]?.['shifted_m'] ?? 0), m), beside_with: withList(state.marks[e.id]?.['beside_with'], other.id), by: issue });
  };
  if (fa.maxShift < 0.001 && fb.maxShift < 0.001) {
    // the two come close only where both fade (beside a fixed end): the pair is settled as drawn
    done(a, b, 0);
    done(b, a, 0);
    return { applied: false, before: {}, after: {}, note: 'nothing to move: the roads come close only beside an end that stays' };
  }
  const before = { a: { id: a.id, pts: a.pts }, b: { id: b.id, pts: b.pts } };
  const follow: string[] = [];
  const moves: { node: string; by: P2 }[] = [];
  for (const [e, f] of [[a, fa], [b, fb]] as const) {
    setPoints(e, f.pts.map((q, i) => ({ x: q.x + (f.move[i] as P2).x, z: q.z + (f.move[i] as P2).z })));
    for (const [id, v] of [[e.a, f.move[0]], [e.b, f.move[f.move.length - 1]]] as [string, P2][]) {
      if (stays(e, id) || Math.hypot(v.x, v.z) < 1e-4) continue;
      moves.push({ node: id, by: rp(v) });
      follow.push(...moveNode(g, id, v, new Set([a, b])));
    }
  }
  done(a, b, fa.maxShift);
  done(b, a, fb.maxShift);
  state.geometryChanged = true;
  return { applied: true, before, after: { a: { id: a.id, pts: a.pts, moved_m: fa.maxShift }, b: { id: b.id, pts: b.pts, moved_m: fb.maxShift }, min_sep: minSep, nodes: moves, followed: [...new Set(follow)].sort() }, note: '' };
}

/** Rule R-LANE-04: the minor branch moves away from the main one, from nothing at the split node. */
export function shiftBranch(state: ShiftState, main: GraphEdge, minor: GraphEdge, p: Params, issue: string): ShiftResult {
  const g = state.graph;
  const node = String(p['node']);
  if ((minor.a !== node && minor.b !== node) || (main.a !== node && main.b !== node)) return { applied: false, before: {}, after: {}, note: 'the branch no longer leaves at that node' };
  const atStart = minor.a === node;
  const far = atStart ? minor.b : minor.a;
  const farStays = minor.a === minor.b || far === main.a || far === main.b || nodeKind(g, far) === 'map_edge';
  // the field runs from the split node outwards
  const oriented: GraphEdge = atStart ? minor : { ...minor, pts: minor.pts.slice().reverse() };
  const f = shiftField(oriented, main.pts, Number(p['min_sep']), 1, { start: true, end: farStays }, blendLength(minor), slipRatio(main.road.cls));
  if (f.maxShift < 0.001) return { applied: false, before: {}, after: {}, note: 'nothing to move' };
  const before = { id: minor.id, pts: minor.pts };
  const pts = f.pts.map((q, i) => ({ x: q.x + (f.move[i] as P2).x, z: q.z + (f.move[i] as P2).z }));
  setPoints(minor, atStart ? pts : pts.reverse());
  const v = f.move[f.move.length - 1] as P2;
  const follow = !farStays && Math.hypot(v.x, v.z) >= 1e-4 ? moveNode(g, far, v, new Set([minor])) : [];
  addMark(state.marks, minor.id, { gore_shift_m: f.maxShift, by: issue });
  state.geometryChanged = true;
  return { applied: true, before, after: { id: minor.id, pts: minor.pts, moved_m: f.maxShift, node: follow.length ? { id: far, by: rp(v) } : null, followed: follow.sort() }, note: '' };
}
