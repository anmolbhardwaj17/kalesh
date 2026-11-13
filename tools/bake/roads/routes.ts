// Lane paths that stay on the junction (P1-042). connect.ts joins two lane ends with one arc or two: right for a
// junction at one node. In a junction of several nodes (a cluster) the straight way from one arm to another can run
// across the land between its roads, and two lane ends that do not face each other give a biarc that loops out over
// hundreds of metres (four paths of 4.1 km at Kashmere Gate). Here: the route between two nodes of a cluster along
// the edges inside it, a path that runs in along its own arm, along that route and out along the arm it enters (each
// lane keeps its place across the road; an arm cut 60 m out bends away from a straight line to its cut), a short
// direct path for a pair whose arcs wander, and the tests that say when the plain path will not do. Pure.
import { pointSegment } from '../geom.ts';
import type { P2 } from '../geom.ts';
import type { PathGeom, Pose } from './connect.ts';

/** A plain path further than this from the line through the junction (viaLine) is replaced by a path along that line (m). */
export const ROUTE_DEV_M = 8;
/** Nodes closer than this are one place: the route between them is left out of the line (m). */
export const ROUTE_MIN_M = 25;
/** The radius the rounded corners of a path aim for (m). */
const CORNER_RADIUS_M = 8;

export interface RouteEdge {
  a: number;
  b: number;
  len: number;
  oneway: boolean;
  /** Centre line from a to b. */
  pts: readonly P2[];
}

const dist = (p: P2, q: P2): number => Math.hypot(q.x - p.x, q.z - p.z);
const lengthOf = (pts: readonly P2[]): number => {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1] as P2, pts[i] as P2);
  return s;
};

/** A path over twice as long as the straight line between its ends plus 30 m: arcs that loop instead of joining. */
export const wanders = (g: PathGeom): boolean => g.pts.length >= 2 && g.length > 2 * dist(g.pts[0] as P2, g.pts[g.pts.length - 1] as P2) + 30;

/** The largest distance of a path's points from a polyline. */
export function deviation(path: readonly P2[], line: readonly P2[]): number {
  let worst = 0;
  for (const p of path) {
    let best = Infinity;
    for (let i = 0; i + 1 < line.length; i++) best = Math.min(best, pointSegment(p, line[i] as P2, line[i + 1] as P2).d);
    if (best !== Infinity) worst = Math.max(worst, best);
  }
  return worst;
}

/**
 * The centre line from node `from` to node `to` along the edges inside a junction: the shortest way, where going
 * against a one-way edge counts four times its length. Null when the edges do not join the two nodes.
 */
export function routeBetween(from: number, to: number, edges: readonly RouteEdge[]): P2[] | null {
  if (from === to) return null;
  const best = new Map<number, number>([[from, 0]]);
  const via = new Map<number, { edge: RouteEdge; forward: boolean; prev: number }>();
  const done = new Set<number>();
  for (;;) {
    let at: number | null = null;
    for (const [n, d] of best) if (!done.has(n) && (at === null || d < (best.get(at) as number) || (d === best.get(at) && n < at))) at = n;
    if (at === null) return null;
    if (at === to) break;
    done.add(at);
    for (const e of edges) {
      const forward = e.a === at;
      if (!forward && e.b !== at) continue;
      const next = forward ? e.b : e.a;
      const d = (best.get(at) as number) + e.len * (e.oneway && !forward ? 4 : 1);
      if (d < (best.get(next) ?? Infinity)) {
        best.set(next, d);
        via.set(next, { edge: e, forward, prev: at });
      }
    }
  }
  const legs: P2[][] = [];
  for (let n = to; n !== from; ) {
    const v = via.get(n) as { edge: RouteEdge; forward: boolean; prev: number };
    legs.push(v.forward ? v.edge.pts.slice() : v.edge.pts.slice().reverse());
    n = v.prev;
  }
  const out: P2[] = [];
  for (const leg of legs.reverse()) for (const p of leg) if (out.length === 0 || dist(out[out.length - 1] as P2, p) > 1e-6) out.push({ x: p.x, z: p.z });
  return out;
}

/**
 * A path through the corners of a control line, each corner rounded by an arc that takes at most half of the two
 * pieces beside it. The radius is the smallest arc's.
 */
export function roundedPath(ctrl: readonly P2[], how: PathGeom['how']): PathGeom {
  const c: P2[] = [];
  for (const p of ctrl) if (c.length === 0 || dist(c[c.length - 1] as P2, p) > 0.05) c.push(p);
  const pts: P2[] = [c[0] as P2];
  let radius = Infinity;
  for (let i = 1; i + 1 < c.length; i++) {
    const p = c[i] as P2;
    const l1 = dist(c[i - 1] as P2, p);
    const l2 = dist(p, c[i + 1] as P2);
    const u = { x: (p.x - (c[i - 1] as P2).x) / l1, z: (p.z - (c[i - 1] as P2).z) / l1 };
    const v = { x: ((c[i + 1] as P2).x - p.x) / l2, z: ((c[i + 1] as P2).z - p.z) / l2 };
    const theta = Math.acos(Math.max(-1, Math.min(1, u.x * v.x + u.z * v.z)));
    if (theta < 0.02) {
      pts.push(p);
      continue;
    }
    // the end pieces are the lanes' own lines: a corner may take all of them
    const t = Math.min(i === 1 ? l1 : l1 / 2, i + 2 === c.length ? l2 : l2 / 2, CORNER_RADIUS_M * Math.tan(theta / 2));
    radius = Math.min(radius, t / Math.tan(theta / 2));
    const a = { x: p.x - u.x * t, z: p.z - u.z * t };
    const b = { x: p.x + v.x * t, z: p.z + v.z * t };
    // the arc as a curve through the corner's two tangent points (a quadratic: within millimetres of the arc for these angles)
    const n = Math.max(2, Math.ceil(theta / ((12 * Math.PI) / 180)));
    for (let k = 0; k <= n; k++) {
      const s = k / n;
      const q = { x: (1 - s) * (1 - s) * a.x + 2 * s * (1 - s) * p.x + s * s * b.x, z: (1 - s) * (1 - s) * a.z + 2 * s * (1 - s) * p.z + s * s * b.z };
      if (dist(pts[pts.length - 1] as P2, q) > 1e-6) pts.push(q);
    }
  }
  const last = c[c.length - 1] as P2;
  if (dist(pts[pts.length - 1] as P2, last) > 1e-6) pts.push(last);
  return { pts, radius, length: lengthOf(pts), how };
}

/** A short path for two lane ends whose arcs wander: out along the first lane, across, in along the second. */
export function directPath(p0: Pose, p1: Pose): PathGeom {
  const d = Math.max(1, dist(p0, p1) / 3);
  return roundedPath([p0, { x: p0.x + p0.hx * d, z: p0.z + p0.hz * d }, { x: p1.x - p1.hx * d, z: p1.z - p1.hz * d }, p1], 'direct');
}

/**
 * The line a lane follows through a junction, between its two ends: in along its own arm to the node (`lead0`, from
 * the cut line to the node), along the route between the two nodes when they differ (`route`, node to node), out along
 * the arm it enters (`lead1`, from the node to the cut line). `lat0` and `lat1` are the lane's place across the road at
 * its two ends (metres to the left of the direction of travel): along the route it moves evenly from one to the other.
 */
export function viaLine(lead0: readonly P2[], route: readonly P2[] | null, lat0: number, lat1: number, lead1: readonly P2[]): P2[] {
  const out: P2[] = [...lead0];
  if (route && route.length > 2) {
    const total = Math.max(1e-6, lengthOf(route));
    let s = 0;
    for (let i = 1; i + 1 < route.length; i++) {
      const p = route[i] as P2;
      s += dist(route[i - 1] as P2, p);
      const a = route[i - 1] as P2;
      const b = route[i + 1] as P2;
      const l = Math.max(1e-9, dist(a, b));
      const lat = lat0 + ((lat1 - lat0) * s) / total;
      // the left of a heading (hx, hz) is (hz, -hx)
      out.push({ x: p.x + ((b.z - a.z) / l) * lat, z: p.z - ((b.x - a.x) / l) * lat });
    }
  }
  out.push(...lead1);
  return out;
}

/** The path along a line through a junction (viaLine): only its real corners stay, each rounded. */
export function pathAlong(p0: Pose, via: readonly P2[], p1: Pose): PathGeom {
  const ctrl = [p0, ...via, p1];
  // points along a straight piece would leave a corner no room for its arc
  return roundedPath(corners(ctrl, 0, ctrl.length - 1), 'route');
}

/** The points of a line that stand more than `tol` off the straight piece between their neighbours kept (Douglas and Peucker). */
function corners(pts: readonly P2[], from: number, to: number, tol = 0.4): P2[] {
  let worst = -1;
  let far = tol;
  for (let i = from + 1; i < to; i++) {
    const d = pointSegment(pts[i] as P2, pts[from] as P2, pts[to] as P2).d;
    if (d > far) {
      far = d;
      worst = i;
    }
  }
  if (worst < 0) return [pts[from] as P2, pts[to] as P2];
  return [...corners(pts, from, worst, tol).slice(0, -1), ...corners(pts, worst, to, tol)];
}
