// Patches that add what OSM lacks (P1-045, MAP_REPAIR.md "OSM is the starting point, not the final word"): a road
// or service lane (add_way), a divider that splits a two-way road into two one-way carriageways (add_median), a
// footpath along a road (add_footpath), a zebra crossing (add_crossing) and a barrier across a road (add_barrier).
// Each patch carries the reference it was drawn from (a photo or satellite link and a date) and its geometry as
// latitude and longitude ("path": "lat,lon;lat,lon", "at": "lat,lon"), so it survives a recentre and a new extract:
// overrides.ts turns the geometry into block metres ("pts", "x", "z") and finds the roads it joins by id, then by
// the drawn points. The added features then go through the same rules, lane model, elevation solver, mesh and
// checks as OSM ways. Pure: it changes only the repair state it is handed.
import { polylineLength } from '../geom.ts';
import type { P2 } from '../geom.ts';
import type { BlockGraph, EdgePiece, GraphEdge, GraphNode } from '../graph/build.ts';
import { classifyRoad } from '../graph/classify.ts';
import type { Carriageway, RoadClass } from '../graph/classify.ts';
import { projectOn, r3 } from '../rules/context.ts';
import type { Params, Patch, PatchAction } from '../rules/types.ts';
import { edgeAt, mark, none, refreshNodes, removeEdge, rp, setPoints, splitEdge, unit } from './apply.ts';
import type { Applied, RepairState } from './apply.ts';

export const ADD_ACTIONS: readonly PatchAction[] = ['add_way', 'add_median', 'add_footpath', 'add_crossing', 'add_barrier'];
export const isAddAction = (a: string): boolean => (ADD_ACTIONS as readonly string[]).includes(a);
/** Add actions drawn as a line ("path"); the others are drawn as one point ("at"). */
export const LINE_ADDS: readonly PatchAction[] = ['add_way', 'add_median', 'add_footpath'];
export const MEDIAN_TYPES = ['kerb', 'planter', 'barrier', 'painted'] as const;
export const BARRIER_KINDS = ['barricade', 'bollards', 'gate', 'wall'] as const;

/** "a,b;c,d" to a list of number pairs (latitude and longitude, or x and z); null when it does not parse. */
export function parsePairs(v: unknown): [number, number][] | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const out: [number, number][] = [];
  for (const part of v.split(';')) {
    const [a, b, extra] = part.split(',').map((t) => Number(t.trim()));
    if (extra !== undefined || !Number.isFinite(a) || !Number.isFinite(b)) return null;
    out.push([a as number, b as number]);
  }
  return out;
}

export const pairsText = (pts: readonly P2[]): string => pts.map((p) => `${r3(p.x)},${r3(p.z)}`).join(';');
const ptsOf = (v: unknown): P2[] => (parsePairs(v) ?? []).map(([x, z]) => ({ x, z }));

/** The geometry of an add patch in block metres: "path" becomes "pts", "at" becomes "x" and "z". The rest is kept. */
export function projectAddParams(params: Params, project: (lat: number, lon: number) => P2): Params {
  const out: Params = { ...params };
  const path = parsePairs(params['path']);
  if (path) out['pts'] = pairsText(path.map(([lat, lon]) => project(lat, lon)));
  const at = parsePairs(params['at']);
  if (at && at.length === 1) {
    const p = project((at[0] as [number, number])[0], (at[0] as [number, number])[1]);
    out['x'] = r3(p.x);
    out['z'] = r3(p.z);
  }
  return out;
}

/** What is wrong with the parts of an add patch the bake needs (empty when it is fine); patchProblems adds these. */
export function addProblems(p: Pick<Patch, 'action' | 'params' | 'reference'>): string[] {
  const out: string[] = [];
  const ref = p.reference;
  if (!ref || typeof ref.link !== 'string' || !/^https?:\/\//.test(ref.link) || typeof ref.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ref.date)) {
    out.push('an add patch needs reference.link (a photo or satellite link) and reference.date (YYYY-MM-DD)');
  }
  if (LINE_ADDS.includes(p.action)) {
    const path = parsePairs(p.params['path']);
    if (!path || path.length < 2) out.push('params.path needs two or more "lat,lon" points separated by ";"');
  } else {
    const at = parsePairs(p.params['at']);
    if (!at || at.length !== 1) out.push('params.at needs one "lat,lon" point');
  }
  if (p.action === 'add_median') {
    const w = Number(p.params['width']);
    if (!(w >= 0.3 && w <= 30)) out.push('params.width (the median width) must be 0.3 to 30 m');
    if (p.params['type'] !== undefined && !(MEDIAN_TYPES as readonly string[]).includes(String(p.params['type']))) out.push(`params.type must be one of ${MEDIAN_TYPES.join(', ')}`);
  }
  if (p.action === 'add_way' && typeof p.params['highway'] !== 'string') out.push('params.highway (the road class) is missing');
  if (p.action === 'add_barrier' && p.params['kind'] !== undefined && !(BARRIER_KINDS as readonly string[]).includes(String(p.params['kind']))) out.push(`params.kind must be one of ${BARRIER_KINDS.join(', ')}`);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// small geometry

const sub = (a: P2, b: P2): P2 => ({ x: a.x - b.x, z: a.z - b.z });
/** Left of a direction of travel (east +X, north -Z): heading north, left is west. */
const leftOf = (d: P2): P2 => ({ x: d.z, z: -d.x });
const dot = (a: P2, b: P2): number => a.x * b.x + a.z * b.z;
const norm = (a: P2): P2 => {
  const l = Math.hypot(a.x, a.z) || 1;
  return { x: a.x / l, z: a.z / l };
};

/** Arc length along a polyline of the point nearest to p. */
function stationOn(p: P2, pts: readonly P2[]): { s: number; d: number } {
  const pr = projectOn(p, pts);
  let s = 0;
  for (let i = 0; i < pr.i; i++) s += Math.hypot((pts[i + 1] as P2).x - (pts[i] as P2).x, (pts[i + 1] as P2).z - (pts[i] as P2).z);
  const a = pts[pr.i] as P2;
  return { s: s + Math.hypot(pr.x - a.x, pr.z - a.z), d: pr.d };
}

/** The point at arc length s along a polyline (clamped to its ends). */
function pointAt(pts: readonly P2[], s: number): P2 {
  let left = s;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i] as P2;
    const b = pts[i + 1] as P2;
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= l || i + 2 === pts.length) {
      const t = l > 0 ? Math.max(0, Math.min(1, left / l)) : 0;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    left -= l;
  }
  return pts[0] as P2;
}

/** Drops points closer than 5 cm to the one before (a node snapped onto a drawn point). */
function clean(pts: readonly P2[]): P2[] {
  const out: P2[] = [];
  for (const p of pts) if (!out.length || Math.hypot(p.x - (out[out.length - 1] as P2).x, p.z - (out[out.length - 1] as P2).z) > 0.05) out.push(rp(p));
  return out;
}

const tolOf = (patch: Patch): number => (Number.isFinite(patch.target.tolerance_m) && patch.target.tolerance_m > 0 ? patch.target.tolerance_m : 15);

/** The road edge nearest to p within tol (metres), for which `ok` holds. */
export function nearestEdge(g: BlockGraph, p: P2, tol: number, ok: (e: GraphEdge) => boolean = () => true): { e: GraphEdge; d: number } | null {
  let best: { e: GraphEdge; d: number } | null = null;
  for (const e of g.edges) {
    if (!ok(e)) continue;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const q of e.pts) {
      minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minZ = Math.min(minZ, q.z); maxZ = Math.max(maxZ, q.z);
    }
    if (p.x < minX - tol || p.x > maxX + tol || p.z < minZ - tol || p.z > maxZ + tol) continue;
    const d = projectOn(p, e.pts).d;
    if (d <= tol && (!best || d < best.d || (d === best.d && e.id < best.e.id))) best = { e, d };
  }
  return best;
}

const applied = (before: Record<string, unknown>, after: Record<string, unknown>, how: 'graph' | 'mark' = 'graph', drops: string[] = []): Applied => ({ applied: true, how, before, after, note: '', drops });

// ---------------------------------------------------------------------------------------------------------------
// add_way

/**
 * Where an end of an added road meets the graph. `how` is a node id, an edge id, "snap" (the nearest road within the
 * tolerance) or "none" (a free end). Returns the node the end goes to, or a reason it cannot.
 */
function joinAt(state: RepairState, p: P2, how: string, nodeId: string, tol: number, skip: ReadonlySet<string>): { node: GraphNode } | { error: string } {
  const g = state.graph;
  if (how === 'none') {
    const node: GraphNode = { id: nodeId, x: r3(p.x), z: r3(p.z), kind: 'end', ends: 0 };
    g.nodes.push(node);
    return { node };
  }
  const named = how && how !== 'snap' ? g.nodes.find((n) => n.id === how) : undefined;
  if (named && Math.hypot(named.x - p.x, named.z - p.z) <= tol) return { node: named };
  let target: GraphEdge | null = null;
  if (how && how !== 'snap' && !named) {
    // an edge id, or a part of it after a split
    target = edgeAt(g, how, p, tol);
  }
  if (!target) {
    const hit = nearestEdge(g, p, tol, (e) => !skip.has(e.id));
    target = hit ? hit.e : null;
  }
  if (!target) return { error: how && how !== 'snap' ? `${how} is not within ${tol} m of the drawn end` : `no road within ${tol} m of the drawn end to join` };
  const cut = splitEdge(g, target, p, nodeId);
  return { node: g.nodes.find((n) => n.id === cut.at) as GraphNode };
}

/** The tags an added road is classified from (the same classifier as an OSM way). */
function tagsOf(p: Params): Record<string, string> {
  const tags: Record<string, string> = { highway: String(p['highway']) };
  if (typeof p['lanes'] === 'number') tags['lanes'] = String(p['lanes']);
  if (typeof p['width'] === 'number') tags['width'] = String(p['width']);
  if (typeof p['service'] === 'string') tags['service'] = p['service'];
  if (typeof p['sidewalk'] === 'string') tags['sidewalk'] = p['sidewalk'];
  return tags;
}

function addWay(state: RepairState, patch: Patch): Applied {
  const g = state.graph;
  const p = patch.params;
  const drawn = clean(ptsOf(p['pts']));
  if (drawn.length < 2) return none('the drawn road has fewer than two points');
  const id = `add.${patch.id}`;
  if (g.edges.some((e) => e.id === id)) return none('the road is already in the map');
  const tol = tolOf(patch);
  const a = joinAt(state, drawn[0] as P2, String(p['join_a'] ?? 'snap'), `x${id}.a`, tol, new Set());
  if ('error' in a) return none(`start: ${a.error}`);
  const b = joinAt(state, drawn[drawn.length - 1] as P2, String(p['join_b'] ?? 'snap'), `x${id}.b`, tol, new Set());
  if ('error' in b) return none(`end: ${b.error}`);
  if (a.node.id === b.node.id) return none('both ends meet the graph at the same point');
  // the ends move onto the node they join (a node further than a metre away is reached by one more point)
  const pts = drawn.slice();
  const at = (i: number, n: GraphNode): void => {
    const q = pts[i] as P2;
    if (Math.hypot(q.x - n.x, q.z - n.z) <= 1) pts[i] = { x: n.x, z: n.z };
    else if (i === 0) pts.unshift({ x: n.x, z: n.z });
    else pts.push({ x: n.x, z: n.z });
  };
  at(0, a.node);
  at(pts.length - 1, b.node);
  const line = clean(pts);
  if (line.length < 2 || polylineLength(line) < 2) return none('the drawn road is shorter than 2 m');
  const cls = String(p['highway']);
  const oneway = p['oneway'] === true;
  const road: RoadClass = classifyRoad(cls.replace(/_link$/, ''), cls.endsWith('_link'), oneway ? 'one_way' : 'two_way', tagsOf(p));
  if (typeof p['lanes'] === 'number') road.lanesFrom = 'ahead';
  if (typeof p['footpath_left'] === 'number') road.footpath.left = p['footpath_left'];
  if (typeof p['footpath_right'] === 'number') road.footpath.right = p['footpath_right'];
  const layer = typeof p['layer'] === 'number' ? Math.round(p['layer']) : 0;
  const len = r3(polylineLength(line));
  const piece: EdgePiece = { way: `add/${patch.id}`, s0: 0, s1: len, layer, bridge: layer > 0, tunnel: layer < 0 };
  const e: GraphEdge = {
    id, a: a.node.id, b: b.node.id, pts: line, len, oneway, name: typeof p['name'] === 'string' ? p['name'] : '', ref: '', roundabout: false,
    ta: unit(line[0] as P2, line[1] as P2), tb: unit(line[line.length - 2] as P2, line[line.length - 1] as P2), pieces: [piece], road, pairedWith: [],
  };
  g.edges.push(e);
  refreshNodes(g);
  state.geometryChanged = true;
  mark(state, id, { added: 'add_way', by: patch.id, ref: patch.reference?.link ?? '' });
  return applied({ edge: null }, { edge: id, a: e.a, b: e.b, len, cls, lanes: road.lanes, width: road.width });
}

// ---------------------------------------------------------------------------------------------------------------
// add_median

interface ChainLink {
  e: GraphEdge;
  /** True when the edge runs the way the chain does (from its a to its b). */
  fwd: boolean;
}

/** Two-way roads a median can split (not a link, not a roundabout). */
const splittable = (e: GraphEdge): boolean => !e.oneway && !e.road.link && !e.roundabout;

/**
 * The node where a drawn line starts or ends on a two-way road: the road is cut there (a node of the road within
 * 0.75 m is taken as it is).
 */
function cutAt(g: BlockGraph, p: P2, tol: number, nodeId: string): string | null {
  const hit = nearestEdge(g, p, tol, splittable);
  if (!hit) return null;
  return splitEdge(g, hit.e, p, nodeId).at;
}

/** The two-way edges from node `from` to node `to` that follow the drawn line, in order; null when the line leaves the road. */
function walk(g: BlockGraph, from: string, to: string, line: readonly P2[], tol: number): ChainLink[] | null {
  const chain: ChainLink[] = [];
  const used = new Set<string>();
  let at = from;
  let s = stationOn(g.nodes.find((n) => n.id === from) as GraphNode, line).s;
  for (let step = 0; step < 400 && at !== to; step++) {
    let best: { link: ChainLink; far: string; s: number; d: number } | null = null;
    for (const e of g.edges) {
      if (used.has(e.id) || !splittable(e) || (e.a !== at && e.b !== at) || e.a === e.b) continue;
      const fwd = e.a === at;
      const far = fwd ? e.b : e.a;
      const fn = g.nodes.find((n) => n.id === far) as GraphNode;
      const mid = pointAt(e.pts, e.len / 2);
      const m = stationOn(mid, line);
      const f = stationOn(fn, line);
      if (m.d > tol || f.d > tol || f.s <= s + 0.25) continue;
      const d = m.d + f.d;
      if (!best || d < best.d) best = { link: { e, fwd }, far, s: f.s, d };
    }
    if (!best) return null;
    chain.push(best.link);
    used.add(best.link.e.id);
    at = best.far;
    s = best.s;
  }
  return at === to && chain.length ? chain : null;
}

const smooth = (t: number): number => {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
};

/** Lane count, width and lane width of one carriageway made from a two-way road. */
function carriageway(r: RoadClass, lanes: number): { lanes: number; width: number } {
  const share = r.lanes > 0 ? lanes / r.lanes : 0.5;
  const width = r.widthFrom === 'tag' ? Math.max(lanes * 2.75, r.width * share) : lanes * r.laneWidth;
  return { lanes, width: Math.round(width * 10) / 10 };
}

function addMedian(state: RepairState, patch: Patch): Applied {
  const g = state.graph;
  const p = patch.params;
  const line = clean(ptsOf(p['pts']));
  if (line.length < 2) return none('the drawn median has fewer than two points');
  const width = Number(p['width']);
  if (!(width >= 0.3)) return none('no median width');
  const type = String(p['type'] ?? 'kerb');
  const tol = tolOf(patch);
  const pid = patch.id;
  const s0 = cutAt(g, line[0] as P2, tol, `x${pid}.s`);
  const s1 = s0 === null ? null : cutAt(g, line[line.length - 1] as P2, tol, `x${pid}.e`);
  if (s0 === null || s1 === null || s0 === s1) return none('no two-way road under both ends of the drawn median');
  const chain = walk(g, s0, s1, line, tol);
  if (!chain) return none('the drawn median does not follow one two-way road from end to end');
  const nodeOf = (id: string): GraphNode => g.nodes.find((n) => n.id === id) as GraphNode;
  // the centre line of the stretch, with the station of every node along it
  const centre: P2[] = [];
  const nodes: string[] = [s0];
  const stations: number[] = [0];
  for (const { e, fwd } of chain) {
    const pts = fwd ? e.pts : e.pts.slice().reverse();
    for (const q of centre.length ? pts.slice(1) : pts) centre.push(q);
    nodes.push(fwd ? e.b : e.a);
    stations.push(polylineLength(centre));
  }
  const total = stations[stations.length - 1] as number;
  const first = (chain[0] as ChainLink).e.road;
  const nL = typeof p['lanes_left'] === 'number' ? Math.max(1, Math.round(p['lanes_left'])) : Math.max(1, Math.ceil(first.lanes / 2));
  const nR = typeof p['lanes_right'] === 'number' ? Math.max(1, Math.round(p['lanes_right'])) : Math.max(1, first.lanes - Math.ceil(first.lanes / 2));
  const cwL = carriageway(first, nL);
  const cwR = carriageway(first, nR);
  // centre line to centre line: half of each carriageway and the median, and a centimetre so the pair rule never reads it as too close
  const offL = cwL.width / 2 + width / 2 + 0.01;
  const offR = cwR.width / 2 + width / 2 + 0.01;
  const chainIds = new Set(chain.map((c) => c.e.id));
  const others = (n: string): GraphEdge[] => g.edges.filter((e) => !chainIds.has(e.id) && (e.a === n || e.b === n));
  /** An end where the road already runs on as two carriageways: the new ones carry on from them, with no taper. */
  const carryOn = (n: string, atStart: boolean): { into: GraphEdge; out: GraphEdge } | null => {
    const o = others(n);
    if (o.length !== 2 || !o.every((e) => e.oneway && e.a !== e.b)) return null;
    // at the start, traffic arrives on the left one and leaves on the right one; at the end the other way round
    const arrive = o.find((e) => e.b === n);
    const leave = o.find((e) => e.a === n);
    if (!arrive || !leave) return null;
    // into the stretch from this end: forward at the start, backward at the end; the arriving edge runs that way
    const dir = norm(sub(pointAt(centre, atStart ? 1 : total - 1), pointAt(centre, atStart ? 0 : total)));
    if (dot(arrive.tb, dir) < 0.5) return null;
    return atStart ? { into: arrive, out: leave } : { into: leave, out: arrive };
  };
  const startCarry = carryOn(s0, true);
  const endCarry = carryOn(s1, false);
  const taper = Math.min(25, total / 3);
  const factor = (s: number): number => Math.min(startCarry ? 1 : smooth(s / taper), endCarry ? 1 : smooth((total - s) / taper));
  // samples every 4 m or less, with the nodes and the tapers' ends among them
  const at = new Set<number>(stations.map((s) => r3(s)));
  for (let s = 0; s < total; s += 4) at.add(r3(s));
  if (!startCarry) for (let s = 0; s <= taper; s += 2) at.add(r3(s));
  if (!endCarry) for (let s = total - taper; s <= total; s += 2) at.add(r3(Math.max(0, s)));
  const ss = [...at].filter((s) => s >= 0 && s <= r3(total) + 1e-6).sort((a, b) => a - b);
  const side = (s: number, sign: 1 | -1): P2 => {
    const q = pointAt(centre, s);
    const t = norm(sub(pointAt(centre, Math.min(total, s + 1)), pointAt(centre, Math.max(0, s - 1))));
    const n = leftOf(t);
    const o = (sign === 1 ? offL : offR) * factor(s);
    return { x: q.x + n.x * o * sign, z: q.z + n.z * o * sign };
  };
  const L = ss.map((s) => side(s, 1));
  const R = ss.map((s) => side(s, -1));
  const k0 = (k: number): number => ss.findIndex((s) => Math.abs(s - r3(stations[k] as number)) < 1e-6);
  // nodes of the two carriageways: the stretch's own end nodes where it tapers in, new nodes elsewhere
  const nodeL: string[] = [];
  const nodeR: string[] = [];
  for (let k = 0; k < nodes.length; k++) {
    const end = k === 0 || k === nodes.length - 1;
    const tapered = (k === 0 && !startCarry) || (k === nodes.length - 1 && !endCarry);
    if (end && tapered) {
      nodeL.push(nodes[k] as string);
      nodeR.push(nodes[k] as string);
      continue;
    }
    const i = k0(k);
    const l: GraphNode = { id: `x${pid}.L${k}`, ...rp(L[i] as P2), kind: 'joint', ends: 0 };
    const r: GraphNode = { id: `x${pid}.R${k}`, ...rp(R[i] as P2), kind: 'joint', ends: 0 };
    g.nodes.push(l, r);
    nodeL.push(l.id);
    nodeR.push(r.id);
  }
  const before = { edges: chain.map((c) => c.e.id), lanes: first.lanes, width: first.width };
  const made: string[] = [];
  const pairs: string[] = [];
  const median = { width: r3(width), type };
  for (let k = 0; k < chain.length; k++) {
    const { e, fwd } = chain[k] as ChainLink;
    const i0 = k0(k);
    const i1 = k0(k + 1);
    const lp = L.slice(i0, i1 + 1);
    const rpts = R.slice(i0, i1 + 1).reverse();
    // footpaths: the left carriageway keeps the road's footpath on the left of the stretch, the right one the other
    const fpL = fwd ? e.road.footpath.left : e.road.footpath.right;
    const fpR = fwd ? e.road.footpath.right : e.road.footpath.left;
    const road = (cw: { lanes: number; width: number }, fp: number): RoadClass => ({
      ...e.road, carriageway: 'paired' as Carriageway, lanes: cw.lanes, lanesFrom: 'ahead', width: cw.width, widthFrom: 'lanes', footpath: { left: fp, right: 0 }, median,
    });
    // the pieces (way ids, levels) follow the stretch; the right carriageway runs against it
    const pieces = (len: number, against: boolean): EdgePiece[] => {
      const scale = len / (e.len || 1);
      const list = (fwd !== against ? e.pieces : e.pieces.slice().reverse().map((x) => ({ ...x, s0: e.len - x.s1, s1: e.len - x.s0 })));
      const out = list.map((x) => ({ ...x, s0: r3(x.s0 * scale), s1: r3(x.s1 * scale) }));
      if (out.length) (out[out.length - 1] as EdgePiece).s1 = len;
      return out;
    };
    const mk = (id: string, a: string, b: string, pts: P2[], cw: { lanes: number; width: number }, fp: number, against: boolean): GraphEdge => {
      const line = clean(pts);
      const len = r3(polylineLength(line));
      return {
        id, a, b, pts: line, len, oneway: true, name: e.name, ref: e.ref, roundabout: false,
        ta: unit(line[0] as P2, line[1] as P2), tb: unit(line[line.length - 2] as P2, line[line.length - 1] as P2), pieces: pieces(len, against), road: road(cw, fp), pairedWith: [],
      };
    };
    const le = mk(`${e.id}~L`, nodeL[k] as string, nodeL[k + 1] as string, lp, cwL, fpL, false);
    const re = mk(`${e.id}~R`, nodeR[k + 1] as string, nodeR[k] as string, rpts, cwR, fpR, true);
    le.pairedWith = [re.id];
    re.pairedWith = [le.id];
    removeEdge(g, e.id);
    g.edges.push(le, re);
    const [pa, pb] = le.id < re.id ? [le.id, re.id] : [re.id, le.id];
    g.pairs.push({ id: `${pa}|${pb}`, a: pa, b: pb, name: e.name, matchedA: pa === le.id ? le.len : re.len, matchedB: pa === le.id ? re.len : le.len, gap: r3(offL + offR), namesDiffer: false });
    pairs.push(`${pa}|${pb}`);
    made.push(le.id, re.id);
    for (const x of [le, re]) mark(state, x.id, { added: 'add_median', by: patch.id, median_m: median.width, median_type: type, lanes_from: 'add' });
  }
  /** Moves the end of an edge at node `from` onto a new node (its end point follows). */
  const reattach = (x: GraphEdge, from: string, to: GraphNode): void => {
    const pts = x.pts.slice();
    if (x.a === from) {
      x.a = to.id;
      pts[0] = { x: to.x, z: to.z };
    }
    if (x.b === from) {
      x.b = to.id;
      pts[pts.length - 1] = { x: to.x, z: to.z };
    }
    const line = clean(pts);
    if (line.length >= 2) setPoints(x, line);
    x.ta = unit(x.pts[0] as P2, x.pts[1] as P2);
    x.tb = unit(x.pts[x.pts.length - 2] as P2, x.pts[x.pts.length - 1] as P2);
  };
  // roads that met the stretch in between go to the carriageway on their side; where roads meet it from both
  // sides (a crossing street) the median has an opening: a short two-way link across it
  const openings = String(p['openings'] ?? 'crossings');
  const gaps: string[] = [];
  const moved: string[] = [];
  for (let k = 1; k < nodes.length - 1; k++) {
    const n = nodes[k] as string;
    const s = stations[k] as number;
    const t = norm(sub(pointAt(centre, Math.min(total, s + 1)), pointAt(centre, Math.max(0, s - 1))));
    const left = leftOf(t);
    const lnode = nodeOf(nodeL[k] as string);
    const rnode = nodeOf(nodeR[k] as string);
    const sides = others(n).map((x) => {
      const away = x.a === n ? pointAt(x.pts, Math.min(5, x.len / 2)) : pointAt(x.pts, Math.max(0, x.len - Math.min(5, x.len / 2)));
      return { x, left: dot(sub(away, nodeOf(n)), left) >= 0 };
    });
    for (const { x, left: onLeft } of sides) {
      reattach(x, n, onLeft ? lnode : rnode);
      moved.push(x.id);
    }
    const both = sides.some((q) => q.left) && sides.some((q) => !q.left);
    if (openings === 'all' || (openings === 'crossings' && both)) {
      const gid = `add.${pid}.gap${k}`;
      const gpts = [{ x: lnode.x, z: lnode.z }, { x: rnode.x, z: rnode.z }];
      const glen = r3(polylineLength(gpts));
      g.edges.push({
        id: gid, a: lnode.id, b: rnode.id, pts: gpts, len: glen, oneway: false, name: (chain[0] as ChainLink).e.name, ref: '', roundabout: false,
        ta: unit(gpts[0] as P2, gpts[1] as P2), tb: unit(gpts[0] as P2, gpts[1] as P2), pieces: [{ way: `add/${pid}`, s0: 0, s1: glen, layer: 0, bridge: false, tunnel: false }],
        road: { ...first, carriageway: 'two_way', lanes: 2, lanesFrom: 'ahead', width: r3(2 * first.laneWidth), widthFrom: 'lanes', footpath: { left: 0, right: 0 } }, pairedWith: [],
      });
      mark(state, gid, { added: 'add_median', by: patch.id, opening: true });
      gaps.push(gid);
    }
  }
  // where the road already runs on as two carriageways, they now meet the new ones
  if (startCarry) {
    reattach(startCarry.into, s0, nodeOf(nodeL[0] as string));
    reattach(startCarry.out, s0, nodeOf(nodeR[0] as string));
    moved.push(startCarry.into.id, startCarry.out.id);
  }
  if (endCarry) {
    reattach(endCarry.into, s1, nodeOf(nodeL[nodes.length - 1] as string));
    reattach(endCarry.out, s1, nodeOf(nodeR[nodes.length - 1] as string));
    moved.push(endCarry.into.id, endCarry.out.id);
  }
  refreshNodes(g);
  state.geometryChanged = true;
  return applied(before, {
    edges: made, pairs, openings: gaps, moved, median, lanes: [nL, nR], widths: [cwL.width, cwR.width], length_m: r3(total),
    ends: [startCarry ? 'carries on' : 'taper', endCarry ? 'carries on' : 'taper'],
  });
}

// ---------------------------------------------------------------------------------------------------------------
// add_footpath, add_crossing, add_barrier

function addFootpath(state: RepairState, patch: Patch): Applied {
  const g = state.graph;
  const line = clean(ptsOf(patch.params['pts']));
  if (line.length < 2) return none('the drawn footpath has fewer than two points');
  const width = typeof patch.params['width'] === 'number' ? Math.max(0.6, patch.params['width']) : 2;
  const tol = tolOf(patch);
  const forced = patch.params['side'] === 'left' || patch.params['side'] === 'right' ? (patch.params['side'] as 'left' | 'right') : null;
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const e of g.edges) {
    // a road the footpath runs along: most of it lies within the tolerance of the drawn line
    const n = Math.max(2, Math.ceil(e.len / 5));
    let near = 0;
    let lean = 0;
    for (let k = 0; k <= n; k++) {
      const q = pointAt(e.pts, (e.len * k) / n);
      const pr = projectOn(q, line);
      if (pr.d > tol) continue;
      near++;
      const t = norm(sub(pointAt(e.pts, Math.min(e.len, (e.len * k) / n + 1)), pointAt(e.pts, Math.max(0, (e.len * k) / n - 1))));
      lean += dot({ x: pr.x - q.x, z: pr.z - q.z }, leftOf(t));
    }
    if (near < 0.6 * (n + 1)) continue;
    const side = forced ?? (lean >= 0 ? 'left' : 'right');
    // the right of a carriageway of a divided street is its median
    if (side === 'right' && e.road.carriageway === 'paired') continue;
    before[e.id] = { [side]: e.road.footpath[side] };
    e.road.footpath[side] = Math.max(e.road.footpath[side], width);
    after[e.id] = { [side]: e.road.footpath[side] };
    mark(state, e.id, { footpath_from: 'add', by: patch.id });
  }
  if (!Object.keys(after).length) return none(`no road runs along the drawn footpath within ${tol} m`);
  state.geometryChanged = true;
  return applied({ footpaths: before }, { footpaths: after, width });
}

function addCrossing(state: RepairState, patch: Patch): Applied {
  const g = state.graph;
  const p = { x: Number(patch.params['x']), z: Number(patch.params['z']) };
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return none('no place for the crossing');
  const tol = tolOf(patch);
  const on = typeof patch.params['on'] === 'string' ? edgeAt(g, patch.params['on'], p, tol) : null;
  const hit = on ? { e: on } : nearestEdge(g, p, tol);
  if (!hit) return none(`no road within ${tol} m of the crossing`);
  const pr = projectOn(p, hit.e.pts);
  const id = `crossing:${patch.id}`;
  const control = patch.params['control'] === 'signals' ? 'signals' : 'crossing';
  // a decision the lane model reads like an OSM crossing node: the junction arm within 30 m gets a zebra
  mark(state, id, { kind: control, x: r3(pr.x), z: r3(pr.z), on: hit.e.id, by: patch.id });
  return applied({ id, crossing: null }, { id, on: hit.e.id, at: [r3(pr.x), r3(pr.z)], kind: control }, 'mark');
}

function addBarrier(state: RepairState, patch: Patch): Applied {
  const g = state.graph;
  const p = { x: Number(patch.params['x']), z: Number(patch.params['z']) };
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return none('no place for the barrier');
  const tol = tolOf(patch);
  const kind = String(patch.params['kind'] ?? 'barricade');
  const on = typeof patch.params['on'] === 'string' ? edgeAt(g, patch.params['on'], p, tol) : null;
  const e = on ?? nearestEdge(g, p, tol)?.e ?? null;
  if (!e) return none(`no road within ${tol} m of the barrier`);
  const s = stationOn(p, e.pts).s;
  // a one metre gap in the road: two dead ends either side of the barrier
  if (s < 1.5 || s > e.len - 1.5) return none('the barrier is at the end of a road: end the road there instead (terminate)');
  const a = `x${patch.id}.a`;
  const b = `x${patch.id}.b`;
  const cut1 = splitEdge(g, e, pointAt(e.pts, s - 0.5), a);
  const mid = cut1.second;
  if (!mid) return none('the barrier is too close to a node');
  const cut2 = splitEdge(g, mid, pointAt(mid.pts, 1), b);
  if (!cut2.second) return none('the barrier is too close to a node');
  removeEdge(g, mid.id);
  refreshNodes(g);
  const closure = kind === 'gate' ? 'gate' : 'barricade';
  for (const n of [a, b]) mark(state, n, { closure, barrier: kind, by: patch.id });
  state.geometryChanged = true;
  return applied({ edge: e.id }, { parts: [e.id, cut2.second.id], ends: [a, b], kind, at: [r3(p.x), r3(p.z)] }, 'graph', [mid.id]);
}

/** Applies one add patch (the caller is apply.ts applyPatch). */
export function applyAdd(state: RepairState, patch: Patch): Applied {
  switch (patch.action) {
    case 'add_way': return addWay(state, patch);
    case 'add_median': return addMedian(state, patch);
    case 'add_footpath': return addFootpath(state, patch);
    case 'add_crossing': return addCrossing(state, patch);
    case 'add_barrier': return addBarrier(state, patch);
    default: return none(`not an add action: ${patch.action}`);
  }
}
