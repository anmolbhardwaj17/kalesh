// Lane model phase 3 (network.ts): the strips and joints of every edge and split zone, then every junction with its
// connecting lane paths, and the explained ends. A taper too short for its class asks for another round. Pure.
import type { P2 } from '../geom.ts';
import type { GraphEdge } from '../graph/build.ts';
import { turnPath } from './connect.ts';
import type { GEdge, GEnd, GNode } from './graph.ts';
import { edgePoint } from './junction.ts';
import type { ArmPlan, JunctionPlan } from './junction.ts';
import { buildEdgeStrips } from './lanes.ts';
import { MIN_TURN_RADIUS_M, classDefaults } from './model.ts';
import type { CrossSection, Joint, Strip, StripEnd } from './model.ts';
import type { ClusterPhase } from './netclusters.ts';
import { endOf } from './netctx.ts';
import type { EndKind, ExplainedEnd, LaneBuild, LaneJunction, LanePath, NetCtx, Planned } from './netctx.ts';
import type { ZonePhase } from './netzones.ts';
import { ROUTE_DEV_M, ROUTE_MIN_M, deviation, directPath, pathAlong, routeBetween, viaLine, wanders } from './routes.ts';
import type { RouteEdge } from './routes.ts';
import { driveCount } from './street.ts';

export interface StripPhase {
  strips: Strip[];
  joints: Joint[];
  zoneStrips: number[];
  built: LaneBuild['built'];
  /** A taper is too short: the round must be built again. */
  retry: boolean;
}

type At = { strip: number; end: StripEnd; lanes: number[] };

const stripAtOf = (built: LaneBuild['built']) => (e: GEnd): At | null => {
  const b = built.get(e.edge);
  if (!b) return null;
  return e.atStart ? { strip: b.first, end: 'start', lanes: b.startLanes } : { strip: b.last, end: 'end', lanes: b.endLanes };
};

export function buildStrips(c: NetCtx, z: ZonePhase): StripPhase {
  const { source, isHero, noZone, problems, step } = c;
  const { plans, zones, zoneNode, nominal, info, raise } = z;
  let retry = false;
  const strips: Strip[] = [];
  const joints: Joint[] = [];
  const built: LaneBuild['built'] = new Map();
  for (const plan of plans) {
    if (plan.internal) continue;
    if (plan.t1 - plan.t0 < 1) {
      problems.push(`${plan.edge.id}: nothing left between its junctions and zones (${(plan.t1 - plan.t0).toFixed(1)} m of ${plan.edge.len.toFixed(1)} m): no surface`);
      continue;
    }
    const es = buildEdgeStrips(plan, step);
    if (es.strips.length === 0) continue;
    const first = strips.length;
    strips.push(...es.strips);
    for (const j of es.joints) joints.push({ ...j, a: { strip: j.a.strip + first, end: j.a.end }, b: { strip: j.b.strip + first, end: j.b.end } });
    built.set(plan.edge.index, { first, last: strips.length - 1, startLanes: es.startLanes, endLanes: es.endLanes });
    // a taper too short for its class: the road takes the lane count it would have tapered to, in the next round
    for (const [att, s, atStart] of [[plan.startAttach, es.strips[0], true], [plan.endAttach, es.strips[es.strips.length - 1], false]] as const) {
      if (!att?.target || !s || s.kind !== 'taper' || !s.taper || isHero(plan.edge.index)) continue;
      const need = classDefaults(s.cls).taper * s.taper.shift;
      const r = info(plan.edge.index);
      if (s.taper.length >= need * 0.98 - 0.05 || r.from === 'width' || r.gali) continue;
      const want = driveCount(att.target.cs);
      const have = driveCount(nominal[plan.edge.index] as CrossSection);
      if (raise((source[plan.edge.index] as GraphEdge).id, want, have)) retry = true;
      else if (!att.own && want !== have) {
        // the lanes of the zone cannot be reached in the length there is, and the road may not carry more: the split
        // is built as a junction, where the lanes are joined by paths
        const node = atStart ? plan.edge.a : plan.edge.b;
        if (zoneNode.has(node)) {
          noZone.add(node);
          retry = true;
        }
      }
    }
  }
  const stripAt = stripAtOf(built);
  const zoneStrips: number[] = [];
  for (const zn of zones) {
    const zi = strips.length;
    zoneStrips.push(zi);
    strips.push(zn.strip);
    const p = stripAt(zn.parent);
    if (p) {
      const lanes: [number, number][] = [];
      for (let j = 0; j < zn.targetCount; j++) {
        const own = zn.parent.atStart ? zn.targetCount - 1 - j : j;
        const sl = p.lanes[own];
        if (sl !== undefined && sl >= 0) lanes.push([zn.targetToZone[j] as number, sl]);
      }
      joints.push({ a: { strip: zi, end: 'start' }, b: { strip: p.strip, end: p.end }, lanes, kind: 'split' });
    }
    for (const [branch, first, count] of [[zn.left, zn.leftFirst, zn.leftCount], [zn.right, zn.rightFirst, zn.rightCount]] as [GEnd, number, number][]) {
      const b = stripAt(branch);
      if (!b) continue;
      const lanes: [number, number][] = [];
      for (let kf = 0; kf < count; kf++) {
        const own = branch.atStart ? kf : count - 1 - kf;
        const sl = b.lanes[own];
        if (sl !== undefined && sl >= 0) lanes.push([first + kf, sl]);
      }
      joints.push({ a: { strip: zi, end: 'end' }, b: { strip: b.strip, end: b.end }, lanes, kind: 'split' });
    }
  }
  return { strips, joints, zoneStrips, built, retry };
}

export interface PathPhase {
  junctions: LaneJunction[];
  junctionPlans: JunctionPlan[];
  ends: ExplainedEnd[];
  turns: LaneBuild['turns'];
  tightPaths: LaneBuild['tightPaths'];
}

const MAIN = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);

export function buildPaths(c: NetCtx, cl: ClusterPhase, sp: StripPhase): PathPhase {
  const { input, graph, source, nodeId, nodeKind, problems } = c;
  const { planned, absorbed } = cl;
  const { strips } = sp;
  const stripAt = stripAtOf(sp.built);
  const junctions: LaneJunction[] = [];
  const junctionPlans: JunctionPlan[] = [];
  const ends: ExplainedEnd[] = [];
  const turns = { uTurnsTooTight: 0, restricted: 0, droppedForRadius: 0, tight: 0 };
  const tightPaths: LaneBuild['tightPaths'] = [];
  const signals = (input.points ?? []).filter((p) => p.kind === 'signals');
  const crossingsAt = (input.points ?? []).filter((p) => p.kind === 'crossing');
  const closure = (node: string): EndKind => {
    const k = input.marks?.[node]?.['closure'];
    return k === 'gate' || k === 'loop' || k === 'barricade' ? k : 'dead_end';
  };
  for (const root of [...planned.keys()].sort((a, b) => a - b)) {
    const pl = planned.get(root) as Planned;
    const jp = pl.jp;
    const arms = jp.arms.map((a) => stripAt(a.end));
    if (arms.some((a) => a === null)) {
      problems.push(`${jp.id}: an arm has no surface; the junction is left out`);
      continue;
    }
    const nodes = jp.nodes.map((n) => nodeId[n] as string);
    if (jp.arms.length === 1) {
      // every other road here is part of the junction: the one arm ends
      const a = arms[0] as At;
      ends.push({ strip: a.strip, end: a.end, node: nodes[0] as string, kind: 'junction_stub', why: 'the only road left at a junction whose other arms are shorter than its cuts' });
      continue;
    }
    const near = (list: readonly P2[], r: number): boolean => list.some((p) => jp.nodes.some((n) => Math.hypot((graph.nodes.get(n) as GNode).x - p.x, (graph.nodes.get(n) as GNode).z - p.z) <= r));
    const control = near(signals, 25) ? 'signals' : 'priority';
    // the edges inside the junction, for the paths between arms at different nodes (routes.ts)
    const inside: RouteEdge[] = [];
    if (jp.nodes.length > 1) {
      const set = new Set(jp.nodes);
      for (const i of absorbed.keys()) {
        const e = graph.edges[i] as GEdge;
        if (set.has(e.a) && set.has(e.b) && e.a !== e.b) inside.push({ a: e.a, b: e.b, len: e.len, oneway: e.oneway, pts: e.curve.pts });
      }
    }
    const nodeOf = (arm: number): number => {
      const end = (jp.arms[arm] as ArmPlan).end;
      const e = graph.edges[end.edge] as GEdge;
      return end.atStart ? e.a : e.b;
    };
    /** A lane's line along its arm from the node out to the cut line (`lat` to the left of the outward direction). */
    const armLine = (arm: number, lat: number): P2[] => {
      const ap = jp.arms[arm] as ArmPlan;
      const out: P2[] = [];
      for (let d = 0; d < ap.cut - 1; d += 4) out.push(edgePoint(ap, lat, d));
      return out;
    };
    const lanePoint = (arm: number, k: number): { strip: number; lane: number; x: number; z: number; ox: number; oz: number; lat: number } => {
      const a = arms[arm] as At;
      const ap = jp.arms[arm] as ArmPlan;
      const n = ap.cs.lanes.length;
      const sl = a.lanes[ap.end.atStart ? k : n - 1 - k] as number;
      const st = endOf(strips[a.strip] as Strip, a.end);
      const lat = ((st.b[sl] as number) + (st.b[sl + 1] as number)) / 2;
      // the tangent of the station order is (-nz, nx); away from the junction it points along a strip that starts here
      const sign = a.end === 'start' ? 1 : -1;
      // lat is to the left of the station order; `sign` turns it to the left of the outward direction
      return { strip: a.strip, lane: sl, x: st.x + st.nx * lat, z: st.z + st.nz * lat, ox: -st.nz * sign, oz: st.nx * sign, lat: lat * sign };
    };
    const paths: LanePath[] = [];
    /** Paths that run along the junction's own roads (routes.ts), by index. */
    const alongRoads = new Set<number>();
    for (const t of pl.turns) {
      const f = lanePoint(t.from, t.fromLane);
      const g = lanePoint(t.to, t.toLane);
      const p0 = { x: f.x, z: f.z, hx: -f.ox, hz: -f.oz };
      const p1 = { x: g.x, z: g.z, hx: g.ox, hz: g.oz };
      let geo = turnPath(p0, p1);
      // a path far from the line through the junction (in along its arm, between the nodes along the edges inside,
      // out along the arm it enters) runs along that line; arcs that loop give way to a short path
      const found = inside.length ? routeBetween(nodeOf(t.from), nodeOf(t.to), inside) : null;
      const route = found && Math.hypot((found[found.length - 1] as P2).x - (found[0] as P2).x, (found[found.length - 1] as P2).z - (found[0] as P2).z) >= ROUTE_MIN_M ? found : null;
      // travel runs against the outward direction on the arm it leaves: the lane's place to the left of travel flips
      const via = viaLine(armLine(t.from, f.lat).reverse(), route, -f.lat, g.lat, armLine(t.to, g.lat));
      if (wanders(geo) || deviation(geo.pts, [p0, ...via, p1]) > ROUTE_DEV_M) {
        // a line with corners too tight to drive never takes the place of a plain path that turns on the radius
        // (measured without this guard: 6.8 km of path off the road faces instead of 10.5, but 304 pairs under the radius)
        const r = pathAlong(p0, via, p1);
        if (r.radius >= MIN_TURN_RADIUS_M || wanders(geo) || geo.radius < MIN_TURN_RADIUS_M) geo = r;
      }
      if (wanders(geo)) geo = directPath(p0, p1);
      paths.push({
        from: [f.strip, f.lane], to: [g.strip, g.lane], fromArm: t.from, toArm: t.to, turn: t.kind, radius: Number.isFinite(geo.radius) ? Math.round(geo.radius * 100) / 100 : null,
        length: Math.round(geo.length * 100) / 100, pts: geo.pts.map((p) => ({ x: Math.round(p.x * 1000) / 1000 + 0, z: Math.round(p.z * 1000) / 1000 + 0 })),
      });
      if (geo.how === 'route' || geo.how === 'direct') alongRoads.add(paths.length - 1);
    }
    paths.forEach((p, k) => {
      if (p.radius === null || p.radius >= MIN_TURN_RADIUS_M) return;
      const why = alongRoads.has(k)
        ? 'the path keeps to the roads of a junction of several nodes, or is the short way between two lanes whose arcs would loop far outside it: a corner of those roads is tighter than the radius'
        : 'the only way on for this lane: the two roads meet side by side at a sharp angle and the junction has no room for a wider turn';
      tightPaths.push({ junction: jp.id, fromArm: p.fromArm, toArm: p.toArm, radius: p.radius, why });
    });
    turns.uTurnsTooTight += pl.uTurnsTooTight;
    turns.restricted += pl.restricted;
    turns.droppedForRadius += pl.dropped;
    turns.tight += pl.tight;
    junctionPlans.push(jp);
    junctions.push({
      id: jp.id, nodes, centre: { x: Math.round(jp.centre.x * 1000) / 1000 + 0, z: Math.round(jp.centre.z * 1000) / 1000 + 0 }, control,
      arms: jp.arms.map((ap, i) => {
        const a = arms[i] as At;
        const s = strips[a.strip] as Strip;
        const crossing = (control === 'signals' || near(crossingsAt, 30) || (MAIN.has(s.cls) && s.lanes.some((l) => l.type === 'footpath'))) && !s.link && Math.abs(endOf(s, 'end').s - endOf(s, 'start').s) > 14;
        return { strip: a.strip, end: a.end, edge: (source[ap.end.edge] as GraphEdge).id, cut: Math.round(ap.cut * 1000) / 1000, stopBack: crossing ? 4 : 0, crossing, edges: [0, 0] as [number, number] };
      }),
      pairs: pl.pairs, paths,
    });
  }
  for (const n of graph.nodes.values()) {
    if (n.ends.length !== 1 || absorbed.has((n.ends[0] as GEnd).edge)) continue;
    const s = stripAt(n.ends[0] as GEnd);
    if (!s) continue;
    const id = nodeId[n.id] as string;
    const kind: EndKind = nodeKind[n.id] === 'map_edge' ? 'map_edge' : closure(id);
    ends.push({ strip: s.strip, end: s.end, node: id, kind, why: kind === 'map_edge' ? 'the road goes on outside the stage being baked' : `the road ends here (${kind.replace('_', ' ')})` });
  }
  return { junctions, junctionPlans, ends, turns, tightPaths };
}
