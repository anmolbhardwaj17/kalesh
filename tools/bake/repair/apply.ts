// The patch applier of the repair layer (AR1, MAP_REPAIR.md "Repair log", "Overrides format"). One function applies
// a patch in the overrides form to the block graph: the same one for an automatic repair, for the provisional top
// proposal of a queued issue and, from P1-011, for an override. Some patches change the graph itself (a join, a tag,
// a width, a dropped duplicate, a sideways shift); others are decisions a later stage reads, kept as marks on the
// feature (a dead end, "take the smoothed profile", a ramp for the elevation solver). Pure: it changes only the state
// it is handed.
import { ClipType, FillRule, booleanOpD } from 'clipper2-ts';
import type { PathD, PathsD } from 'clipper2-ts';
import { polylineLength, ringArea } from '../geom.ts';
import type { P2 } from '../geom.ts';
import type { BlockGraph, GraphEdge, GraphNode } from '../graph/build.ts';
import { projectOn, r3 } from '../rules/context.ts';
import type { End } from '../rules/context.ts';
import { shiftedAway, slipFit, slipRatio } from '../rules/lanes.ts';
import type { Marks, Params, Patch } from '../rules/types.ts';

export interface RepairState {
  graph: BlockGraph;
  marks: Marks;
  /** Set when points, edges, nodes or footprints changed: indexes built on the old state are stale. */
  geometryChanged: boolean;
}

export interface Applied {
  applied: boolean;
  /** graph: the map itself changed; mark: a decision recorded for a later stage; none: nothing to do or not possible. */
  how: 'graph' | 'mark' | 'none';
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  note: string;
  /** Ids of features left out by this patch (every drop is logged). */
  drops: string[];
}

const none = (note: string): Applied => ({ applied: false, how: 'none', before: {}, after: {}, note, drops: [] });
const ids = (v: unknown): string[] => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const rp = (p: P2): P2 => ({ x: r3(p.x), z: r3(p.z) });
const unit = (a: P2, b: P2): P2 => {
  const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: Math.round(((b.x - a.x) / l) * 1e6) / 1e6 + 0, z: Math.round(((b.z - a.z) / l) * 1e6) / 1e6 + 0 };
};

function mark(state: RepairState, id: string, values: Params): void {
  state.marks[id] = { ...(state.marks[id] ?? {}), ...values };
}

const edgeOf = (g: BlockGraph, id: string): GraphEdge | undefined => g.edges.find((e) => e.id === id);

/** An edge by id, or the part of it (after a split) that passes nearest to a point. */
function edgeAt(g: BlockGraph, id: string, p: P2, tol = 0.05): GraphEdge | null {
  let best: { e: GraphEdge; d: number } | null = null;
  for (const e of g.edges) {
    if (e.id !== id && !e.id.startsWith(`${id}/`)) continue;
    const d = projectOn(p, e.pts).d;
    if (!best || d < best.d) best = { e, d };
  }
  return best && best.d <= tol ? best.e : null;
}

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

/** Recounts the ends at every node, names its kind again and drops nodes no edge uses. */
export function refreshNodes(g: BlockGraph): void {
  const count = new Map<string, number>();
  for (const e of g.edges) for (const id of [e.a, e.b]) count.set(id, (count.get(id) ?? 0) + 1);
  g.nodes = g.nodes.filter((n) => count.has(n.id));
  for (const n of g.nodes) {
    n.ends = count.get(n.id) as number;
    if (n.kind !== 'map_edge') n.kind = n.ends >= 3 ? 'junction' : n.ends === 2 ? 'joint' : 'end';
  }
}

/**
 * Cuts an edge at the point of its line nearest to p and puts the node `nodeId` there (made when it does not
 * exist). The first part keeps the edge id; the second gets "<id>/<n>" and the same pairs. Returns the second part,
 * or null when p is at one of the edge's own ends (then that end's node id is in `at`).
 */
export function splitEdge(g: BlockGraph, e: GraphEdge, p: P2, nodeId: string): { second: GraphEdge | null; at: string } {
  const pr = projectOn(p, e.pts);
  const q = rp({ x: pr.x, z: pr.z });
  const first = e.pts[0] as P2;
  const last = e.pts[e.pts.length - 1] as P2;
  if (Math.hypot(q.x - first.x, q.z - first.z) < 0.75) return { second: null, at: e.a };
  if (Math.hypot(q.x - last.x, q.z - last.z) < 0.75) return { second: null, at: e.b };
  const same = (a: P2, b: P2): boolean => Math.hypot(a.x - b.x, a.z - b.z) < 0.001;
  const head = e.pts.slice(0, pr.i + 1);
  const tail = e.pts.slice(pr.i + 1);
  if (!same(head[head.length - 1] as P2, q)) head.push(q);
  if (!same(tail[0] as P2, q)) tail.unshift(q);
  const sA = r3(polylineLength(head));
  let n = 1;
  while (g.edges.some((x) => x.id === `${e.id}/${n}`)) n++;
  const second: GraphEdge = {
    ...e, id: `${e.id}/${n}`, a: nodeId, pts: tail, len: r3(polylineLength(tail)), ta: unit(tail[0] as P2, tail[1] as P2),
    pieces: e.pieces.filter((x) => x.s1 > sA + 0.001).map((x) => ({ ...x, s0: r3(Math.max(0, x.s0 - sA)), s1: r3(x.s1 - sA) })), road: { ...e.road, footpath: { ...e.road.footpath } }, pairedWith: [...e.pairedWith],
  };
  if (second.pieces.length) (second.pieces[second.pieces.length - 1] as GraphEdge['pieces'][number]).s1 = second.len;
  e.pieces = e.pieces.filter((x) => x.s0 < sA - 0.001).map((x) => ({ ...x, s1: r3(Math.min(x.s1, sA)) }));
  e.pts = head;
  e.len = sA;
  e.b = nodeId;
  e.tb = unit(head[head.length - 2] as P2, head[head.length - 1] as P2);
  if (e.pieces.length) (e.pieces[e.pieces.length - 1] as GraphEdge['pieces'][number]).s1 = e.len;
  g.edges.push(second);
  for (const pair of g.pairs.slice()) {
    if (pair.a !== e.id && pair.b !== e.id) continue;
    const other = pair.a === e.id ? pair.b : pair.a;
    const [a, b] = second.id < other ? [second.id, other] : [other, second.id];
    g.pairs.push({ ...pair, id: `${a}|${b}`, a, b });
    const o = edgeOf(g, other);
    if (o && !o.pairedWith.includes(second.id)) o.pairedWith = [...o.pairedWith, second.id].sort();
  }
  if (!g.nodes.some((x) => x.id === nodeId)) g.nodes.push({ id: nodeId, x: q.x, z: q.z, kind: 'junction', ends: 0 });
  else {
    const node = g.nodes.find((x) => x.id === nodeId) as GraphNode;
    node.x = q.x;
    node.z = q.z;
  }
  return { second, at: nodeId };
}

function removeEdge(g: BlockGraph, id: string): boolean {
  const before = g.edges.length;
  g.edges = g.edges.filter((e) => e.id !== id);
  if (g.edges.length === before) return false;
  g.pairs = g.pairs.filter((p) => p.a !== id && p.b !== id);
  for (const e of g.edges) if (e.pairedWith.includes(id)) e.pairedWith = e.pairedWith.filter((x) => x !== id);
  return true;
}

function joinEnd(state: RepairState, p: Params): Applied {
  const g = state.graph;
  const e = edgeOf(g, String(p['edge']));
  const node = g.nodes.find((n) => n.id === String(p['node']));
  if (!e || !node || node.ends !== 1 || (e.a !== node.id && e.b !== node.id)) return none('the dangling end is no longer there');
  const at = { x: Number(p['x']), z: Number(p['z']) };
  const target = edgeAt(g, String(p['to']), at);
  if (!target || target === e) return none('the road to join is no longer at that point');
  const before = { edge: e.id, end: node.id, len: e.len, at: [node.x, node.z] };
  const joinId = `x${node.id}`;
  const cut = splitEdge(g, target, at, joinId);
  const to = g.nodes.find((n) => n.id === cut.at) as GraphNode;
  const q = { x: to.x, z: to.z };
  // the old end stays as a point of the line; the edge now runs on to the join
  if (e.b === node.id) {
    setPoints(e, [...e.pts, q]);
    e.b = to.id;
    e.tb = unit(e.pts[e.pts.length - 2] as P2, q);
  } else {
    setPoints(e, [q, ...e.pts]);
    e.a = to.id;
    e.ta = unit(q, e.pts[1] as P2);
  }
  refreshNodes(g);
  state.geometryChanged = true;
  return { applied: true, how: 'graph', before, after: { edge: e.id, end: to.id, len: e.len, at: [q.x, q.z], joined: target.id, split: cut.second ? cut.second.id : null }, note: '', drops: [] };
}

function addJunction(state: RepairState, p: Params): Applied {
  const g = state.graph;
  const at = { x: Number(p['x']), z: Number(p['z']) };
  const a = edgeAt(g, String(p['a']), at);
  const b = edgeAt(g, String(p['b']), at);
  if (!a || !b || a === b) return none('the two roads no longer cross at that point');
  const id = `x${String(p['a'])}_${String(p['b'])}`;
  const ca = splitEdge(g, a, at, id);
  if (ca.at !== id) return none('the crossing is at the end of one of the roads');
  const cb = splitEdge(g, b, at, id);
  refreshNodes(g);
  state.geometryChanged = true;
  return { applied: true, how: 'graph', before: { a: a.id, b: b.id, node: null }, after: { node: id, at: [at.x, at.z], parts: [ca.second?.id ?? null, cb.second?.id ?? null] }, note: '', drops: [] };
}

function shiftApart(state: RepairState, p: Params, issue: string): Applied {
  const g = state.graph;
  const a = edgeOf(g, String(p['a']));
  const b = edgeOf(g, String(p['b']));
  if (!a || !b) return none('one of the two carriageways is no longer there');
  const minSep = Number(p['min_sep']);
  const na = shiftedAway(a, b, minSep);
  const nb = shiftedAway(b, a, minSep);
  if (na.maxShift < 0.001 && nb.maxShift < 0.001) return none('nothing to move');
  const before = { a: { id: a.id, pts: a.pts }, b: { id: b.id, pts: b.pts } };
  setPoints(a, na.pts);
  setPoints(b, nb.pts);
  mark(state, a.id, { shifted_m: Math.max(Number(state.marks[a.id]?.['shifted_m'] ?? 0), na.maxShift), by: issue });
  mark(state, b.id, { shifted_m: Math.max(Number(state.marks[b.id]?.['shifted_m'] ?? 0), nb.maxShift), by: issue });
  state.geometryChanged = true;
  return { applied: true, how: 'graph', before, after: { a: { id: a.id, pts: a.pts, moved_m: na.maxShift }, b: { id: b.id, pts: b.pts, moved_m: nb.maxShift }, min_sep: minSep }, note: '', drops: [] };
}

function slipRedraw(state: RepairState, p: Params, issue: string): Applied {
  const g = state.graph;
  const minor = edgeOf(g, String(p['on']));
  const main = edgeOf(g, String(p['main']));
  const node = String(p['node']);
  if (!minor || !main) return none('the slip road or its main line is no longer there');
  const endAt = (e: GraphEdge): End | null => (e.a === node ? { edge: e, atStart: true } : e.b === node ? { edge: e, atStart: false } : null);
  const me = endAt(minor);
  const ma = endAt(main);
  if (!me || !ma) return none('the slip road no longer leaves at that node');
  const fit = slipFit(me, ma, slipRatio(main.road.cls));
  if (!fit.caught || fit.worst < 0.001) return none('nothing to redraw');
  const before = { id: minor.id, pts: minor.pts };
  setPoints(minor, me.atStart ? fit.pts : fit.pts.slice().reverse());
  mark(state, minor.id, { slip_redrawn_m: fit.worst, by: issue });
  state.geometryChanged = true;
  return { applied: true, how: 'graph', before, after: { id: minor.id, pts: minor.pts, moved_m: fit.worst }, note: '', drops: [] };
}

function cleanRing(state: RepairState, id: string): Applied {
  const f = state.graph.footprints.find((x) => x.id === id);
  if (!f) return none('the footprint is no longer there');
  const subject: PathsD = [f.ring.map((q) => ({ x: q.x, y: q.z })) as PathD];
  const parts = booleanOpD(ClipType.Union, subject, [], FillRule.NonZero, 3);
  let best: PathD | null = null;
  let bestArea = 0;
  for (const path of parts) {
    const area = Math.abs(ringArea(path.map((q) => ({ x: q.x, z: q.y }))));
    if (area > bestArea) {
      best = path;
      bestArea = area;
    }
  }
  if (!best || best.length < 3) return none('nothing is left of the outline');
  const before = { id, ring: f.ring, area: f.area };
  f.ring = best.map((q) => ({ x: Math.round(q.x * 100) / 100 + 0, z: Math.round(q.y * 100) / 100 + 0 }));
  f.area = Math.round(bestArea * 10) / 10;
  state.geometryChanged = true;
  return { applied: true, how: 'graph', before, after: { id, ring: f.ring, area: f.area }, note: '', drops: [] };
}

function setTag(state: RepairState, p: Params, issue: string): Applied {
  const g = state.graph;
  const key = String(p['key']);
  const on = ids(p['on']);
  const edges = on.map((id) => edgeOf(g, id)).filter((e): e is GraphEdge => e !== undefined);
  if (key === 'layer' && edges.length) {
    const before: Record<string, number[]> = {};
    const after: Record<string, number[]> = {};
    let changed = false;
    for (const e of edges) {
      before[e.id] = e.pieces.map((x) => x.layer);
      for (const piece of e.pieces) {
        if (p['bridge'] === true && !piece.bridge && !piece.tunnel) {
          piece.bridge = true;
          piece.layer = Number(p['value']);
          changed = true;
        } else if (piece.bridge && piece.layer === 0) {
          piece.layer = Number(p['value']);
          changed = true;
        }
      }
      after[e.id] = e.pieces.map((x) => x.layer);
    }
    if (!changed) return none('no piece to tag');
    // levels are part of the segment index
    state.geometryChanged = true;
    return { applied: true, how: 'graph', before: { layers: before }, after: { layers: after }, note: '', drops: [] };
  }
  const e = edges[0];
  if (key === 'width' && e) {
    const before = { id: e.id, width: e.road.width };
    const value = Number(p['value']);
    if (state.marks[e.id]?.['width_was'] === undefined) mark(state, e.id, { width_was: e.road.width });
    e.road.width = p['force'] === true ? value : Math.min(e.road.width, value);
    mark(state, e.id, { width_from: p['force'] === true ? 'lanes' : 'buildings', by: issue });
    return { applied: true, how: 'graph', before, after: { id: e.id, width: e.road.width }, note: before.width === e.road.width ? 'already this narrow from an earlier repair' : '', drops: [] };
  }
  if ((key === 'footpath:left' || key === 'footpath:right') && e) {
    const side = key === 'footpath:left' ? 'left' : 'right';
    const before = { id: e.id, [side]: e.road.footpath[side] };
    e.road.footpath[side] = Number(p['value']);
    mark(state, e.id, { footpath_from: 'repair', by: issue });
    return { applied: true, how: 'graph', before, after: { id: e.id, [side]: e.road.footpath[side] }, note: '', drops: [] };
  }
  const target = on[0] ?? issue;
  const before = { id: target, [key]: state.marks[target]?.[key] ?? null };
  mark(state, target, { [key]: p['value'] as string | number | boolean });
  return { applied: true, how: 'mark', before, after: { id: target, [key]: p['value'] }, note: '', drops: [] };
}

function setLanes(state: RepairState, p: Params, issue: string): Applied {
  const edges = ids(p['on']).map((id) => edgeOf(state.graph, id)).filter((e): e is GraphEdge => e !== undefined);
  if (!edges.length) return none('the road is no longer there');
  const lanes = Math.max(1, Math.round(Number(p['lanes'])));
  const spec = p['from'] === 'spec';
  const before = edges.map((e) => ({ id: e.id, lanes: e.road.lanes, lanesFrom: e.road.lanesFrom, width: e.road.width, footpath: { ...e.road.footpath } }));
  for (const e of edges) {
    e.road.lanes = lanes;
    e.road.lanesFrom = spec ? 'spec' : 'ahead';
    if (typeof p['width'] === 'number') e.road.width = p['width'];
    else if (e.road.widthFrom === 'lanes') {
      const byLanes = Math.round(lanes * e.road.laneWidth * 10) / 10;
      // a width that buildings already narrowed stays narrow
      e.road.width = state.marks[e.id]?.['width_from'] === 'buildings' ? Math.min(e.road.width, byLanes) : byLanes;
    }
    if (typeof p['footpath_left'] === 'number') e.road.footpath.left = p['footpath_left'];
    if (typeof p['footpath_right'] === 'number') e.road.footpath.right = p['footpath_right'];
    mark(state, e.id, { lanes_from: String(p['from'] ?? 'ahead'), by: issue, ...(spec ? { width_from: 'spec', footpath_from: 'spec' } : {}) });
  }
  return { applied: true, how: 'graph', before: { edges: before }, after: { edges: edges.map((e) => ({ id: e.id, lanes: e.road.lanes, lanesFrom: e.road.lanesFrom, width: e.road.width, footpath: { ...e.road.footpath } })) }, note: '', drops: [] };
}

function remove(state: RepairState, p: Params): Applied {
  const g = state.graph;
  const drops: string[] = [];
  for (const id of ids(p['drop'])) {
    const before = g.footprints.length;
    g.footprints = g.footprints.filter((f) => f.id !== id);
    if (g.footprints.length !== before || removeEdge(g, id)) drops.push(id);
    else {
      const stations = g.features.stations ?? [];
      const kept = stations.filter((s) => s.id !== id);
      if (kept.length !== stations.length) {
        g.features.stations = kept;
        drops.push(id);
      }
    }
  }
  if (!drops.length) return none('nothing to drop: it is no longer there');
  refreshNodes(g);
  state.geometryChanged = true;
  return { applied: true, how: 'graph', before: { present: drops }, after: { dropped: drops, kept: p['keep'] ?? null }, note: '', drops };
}

function setHeight(state: RepairState, p: Params, issue: string): Applied {
  const on = String(p['on'] ?? '');
  const mode = String(p['mode'] ?? '');
  const f = state.graph.footprints.find((x) => x.id === on);
  if (f && typeof p['height'] === 'number') {
    const before = { id: on, height: f.height };
    f.height = p['height'];
    return { applied: true, how: 'graph', before, after: { id: on, height: f.height }, note: '', drops: [] };
  }
  if (!on) return none('no feature named');
  const key = mode === 'smooth_profile' ? 'profile' : mode === 'cut_corridor' ? 'corridor' : mode === 'lower_under' ? 'lower_m' : 'height_mode';
  const value = mode === 'smooth_profile' ? 'smoothed' : mode === 'cut_corridor' ? 'cut' : mode === 'lower_under' ? Number(p['by_m'] ?? 0) : mode;
  const before = { id: on, [key]: state.marks[on]?.[key] ?? null };
  mark(state, on, { [key]: value, by: issue });
  return { applied: true, how: 'mark', before, after: { id: on, [key]: value, max_m: p['max_m'] ?? null }, note: '', drops: [] };
}

/** A decision with no change to the graph: kept as a mark on the feature the patch names. */
function decision(state: RepairState, patch: Patch, key: string, value: string | number | boolean): Applied {
  const p = patch.params;
  const target = String(p['on'] ?? p['node'] ?? p['bridge'] ?? p['station'] ?? patch.target.ids[0] ?? patch.issue);
  const before = { id: target, [key]: state.marks[target]?.[key] ?? null };
  mark(state, target, { [key]: value });
  return { applied: true, how: 'mark', before, after: { id: target, [key]: value }, note: '', drops: [] };
}

/** Applies one patch. The caller logs the result; a patch that cannot be applied changes nothing. */
export function applyPatch(state: RepairState, patch: Patch): Applied {
  const p = patch.params;
  const op = String(p['op'] ?? '');
  switch (patch.action) {
    case 'connect':
      if (op === 'join_end') return joinEnd(state, p);
      if (op === 'add_junction') return addJunction(state, p);
      return decision(state, patch, 'link', op || 'connect');
    case 'terminate': return decision(state, patch, 'closure', String(p['with'] ?? 'dead_end'));
    case 'remove': return remove(state, p);
    case 'set_tag': return setTag(state, p, patch.issue);
    case 'set_lanes': return setLanes(state, p, patch.issue);
    case 'set_height': return setHeight(state, p, patch.issue);
    case 'move_node':
      if (op === 'shift_apart' && p['node'] === undefined) return shiftApart(state, p, patch.issue);
      return decision(state, patch, 'move', op || 'move_node');
    case 'replace_geometry':
      if (op === 'slip_redraw') return slipRedraw(state, p, patch.issue);
      if (op === 'clean_ring') return cleanRing(state, String(p['on']));
      return decision(state, patch, 'redraw', op || 'replace_geometry');
    case 'disable_repair': return decision(state, patch, 'keep', String(p['keep'] ?? p['field'] ?? 'as_is'));
    default: return none(`unknown action ${String(patch.action)}`);
  }
}
