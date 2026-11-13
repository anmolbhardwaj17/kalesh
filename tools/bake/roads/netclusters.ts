// Lane model phase 2 (network.ts): junction clusters and the cut of every arm. Junction nodes close together are one
// junction; an edge too short to hold its cuts, or to give a turn its radius, becomes part of the junction; an arm
// may ask for a longer cut so a connecting lane path turns on its radius. Writes the strip part (t0, t1) of every
// edge plan. Pure.
import type { GraphEdge } from '../graph/build.ts';
import { lanePose, planTurns, turnPath } from './connect.ts';
import { arrivingTurns } from './turns.ts';
import type { MappedRestriction } from './turns.ts';
import type { ArmLane, ArmView, PathGeom, Turn } from './connect.ts';
import type { GEdge, GEnd, GNode } from './graph.ts';
import { edgePoint, planJunction, tangentAt } from './junction.ts';
import type { ArmPlan } from './junction.ts';
import type { EdgePlan } from './lanes.ts';
import { ABSORB_MAX_M, CLUSTER_GAP_M, MIN_STRIP_M, PASSES, CLEAR_MAX_M, PLAN_RADIUS_M, TURN_ASK_MAX_M, endKey as key } from './netctx.ts';
import type { NetCtx, Planned } from './netctx.ts';
import type { ZonePhase } from './netzones.ts';

export interface ClusterPhase {
  /** Edges inside a junction, with the reason. */
  absorbed: Map<number, string>;
  /** Every planned junction by the root node of its cluster. */
  planned: Map<number, Planned>;
  /** A split node became a junction: the round must be built again. */
  retry: boolean;
}

export function planClusters(c: NetCtx, z: ZonePhase): ClusterPhase {
  const { input, graph, source, nodeId, noZone } = c;
  const { plans, zoneNode, zoneEnds, base0, base1 } = z;
  const parent: number[] = [];
  for (let i = 0; i < graph.nodes.size; i++) parent.push(i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r] as number;
    while (parent[i] !== r) {
      const n = parent[i] as number;
      parent[i] = r;
      i = n;
    }
    return r;
  };
  const absorbed = new Map<number, string>();
  const dirty = new Set<number>();
  const planned = new Map<number, Planned>();
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    const r = Math.min(ra, rb);
    parent[ra] = r;
    parent[rb] = r;
    planned.delete(ra);
    planned.delete(rb);
    dirty.add(r);
  };
  const absorb = (i: number, why: string): void => {
    const e = graph.edges[i] as GEdge;
    absorbed.set(i, why);
    union(e.a, e.b);
  };
  const endsOf = (n: number): number => (graph.nodes.get(n) as GNode).ends.length;
  /** An edge too long to become part of a junction: it keeps a strip of its own. */
  const keeps = (i: number): boolean => (graph.edges[i] as GEdge).len >= ABSORB_MAX_M;
  for (const e of graph.edges) {
    if (e.len <= CLUSTER_GAP_M && e.a !== e.b && endsOf(e.a) >= 3 && endsOf(e.b) >= 3 && !zoneNode.has(e.a) && !zoneNode.has(e.b) && !zoneEnds.has(e.index)) {
      absorb(e.index, `${Math.round(e.len * 10) / 10} m between two junction nodes: one junction (cluster rule, ${CLUSTER_GAP_M} m)`);
    }
  }
  const cutAt = new Map<number, number>();
  const ask = new Map<number, number>();
  const view = (a: ArmPlan): ArmView => {
    const p = edgePoint(a, 0, a.cut);
    const t = tangentAt(a, a.cut);
    const src = source[a.end.edge] as GraphEdge;
    const lanes: ArmLane[] = [];
    a.cs.lanes.forEach((l, k) => {
      if (l.type === 'drive') lanes.push({ k, lat: ((a.borders[k] as number) + (a.borders[k + 1] as number)) / 2, width: l.width, flow: l.dir });
    });
    // turn lanes of the way piece at the arm's junction end (turn:lanes, P1-032)
    const piece = a.end.atStart ? src.pieces[0] : src.pieces[src.pieces.length - 1];
    const wt = piece ? input.turnInputs?.wayTurns.get(piece.way) : undefined;
    const turns = wt ? arrivingTurns(wt, a.end.atStart ? src.a : src.b, t.x, t.z) : null;
    return { x: p.x, z: p.z, ox: t.x, oz: t.z, edge: src.id, paired: src.pairedWith, lanes, ...(turns ? { turns } : {}) };
  };
  const members = (): Map<number, number[]> => {
    const groups = new Map<number, number[]>();
    for (const n of graph.nodes.values()) {
      const r = find(n.id);
      const list = groups.get(r);
      if (list) list.push(n.id);
      else groups.set(r, [n.id]);
    }
    return groups;
  };
  const wantAbsorb = new Set<number>();
  const planCluster = (root: number, ids: number[]): void => {
    const ends: GEnd[] = [];
    for (const id of ids) for (const end of (graph.nodes.get(id) as GNode).ends) if (!absorbed.has(end.edge)) ends.push(end);
    planned.delete(root);
    if (ends.length === 0) return;
    let res: Planned | null = null;
    const blocked = new Set<number>();
    for (let pass = 0; pass < PASSES; pass++) {
      for (const e of ends) {
        const p = plans[e.edge] as EdgePlan;
        p.t0 = base0[e.edge] as number;
        p.t1 = base1[e.edge] as number;
      }
      // an arm may be cut back to where it comes clear of the others, up to the room a turn may take on it, and no
      // further than a slow fork needs: arms on each other beyond that are two roads drawn too close (the repair's)
      const roomOf = (e: GEnd, arm: ArmPlan): number => (zoneEnds.has(e.edge) ? arm.avail : Math.min(CLEAR_MAX_M, ((base1[e.edge] as number) - (base0[e.edge] as number)) * 0.9));
      const jp = planJunction(graph, plans, `j${nodeId[ids[0] as number]}`, ids, ends, 1.5, (e) => ask.get(key(e)) ?? 0, roomOf);
      const views = jp.arms.map(view);
      const pose = (arm: number, lane: ArmLane, into: boolean) => lanePose(views[arm] as ArmView, lane, into);
      const here = new Set(ids.map((n) => nodeId[n] as string));
      const mapped = resolveRules(c.turnRules.filter((r) => here.has(r.via)), views, here, source);
      const rules = [...(input.restrictions ?? []), ...mapped];
      const tp = planTurns(views, rules, (f, fl, t, tl) => turnPath(pose(f, fl, true), pose(t, tl, false)).radius, PLAN_RADIUS_M + 0.15);
      res = { jp, views, turns: tp.turns, pairs: tp.pairs, uTurnsTooTight: tp.uTurnsTooTight, restricted: tp.restricted, laneRestricted: tp.laneRestricted, laneArms: tp.laneArms, rules: mapped, dropped: 0, tight: 0 };
      let changed = false;
      const failing: { t: Turn; g: PathGeom }[] = [];
      for (const t of tp.turns) {
        const va = views[t.from] as ArmView;
        const vb = views[t.to] as ArmView;
        const g = turnPath(lanePose(va, va.lanes.find((l) => l.k === t.fromLane) as ArmLane, true), lanePose(vb, vb.lanes.find((l) => l.k === t.toLane) as ArmLane, false));
        if (g.radius >= PLAN_RADIUS_M) continue;
        failing.push({ t, g });
        const needT = g.how === 'fillet' ? PLAN_RADIUS_M * Math.tan((g.phi as number) / 2) + 0.05 : 0;
        const grow = Math.max(1.5, 1.5 * (PLAN_RADIUS_M - g.radius));
        const more = g.how === 'fillet' ? [Math.max(0, needT - (g.a as number)), Math.max(0, needT - (g.b as number))] : [grow, grow];
        [t.from, t.to].forEach((armIndex, side) => {
          const arm = jp.arms[armIndex] as ArmPlan;
          if ((more[side] as number) <= 0) return;
          const free = (base1[arm.end.edge] as number) - (base0[arm.end.edge] as number);
          const limit = Math.min(TURN_ASK_MAX_M, zoneEnds.has(arm.end.edge) || keeps(arm.end.edge) ? arm.avail : free * 0.9);
          let want = arm.cut + (more[side] as number);
          if (want > limit) {
            want = limit;
            blocked.add(arm.end.edge);
          }
          if (want > (ask.get(key(arm.end)) ?? 0) + 1e-6 && want > arm.cut + 1e-6) {
            ask.set(key(arm.end), want);
            changed = true;
          }
        });
      }
      if (failing.length === 0) break;
      if (!changed || pass === PASSES - 1) {
        // no room left: the shortest blocked arm becomes part of the junction, or the turn is not allowed here
        for (const f of failing) {
          const cand = [f.t.from, f.t.to].map((a) => (jp.arms[a] as ArmPlan).end.edge).filter((e) => blocked.has(e) && !zoneEnds.has(e) && (graph.edges[e] as GEdge).len < ABSORB_MAX_M);
          if (cand.length) wantAbsorb.add(cand.sort((x, y) => (graph.edges[x] as GEdge).len - (graph.edges[y] as GEdge).len)[0] as number);
          else {
            // a lane with no other way on, or no other way in, keeps its turn on the radius there is room for
            const others = res.turns.filter((t) => t !== f.t);
            const needed = !others.some((t) => t.from === f.t.from && t.fromLane === f.t.fromLane) || !others.some((t) => t.to === f.t.to && t.toLane === f.t.toLane);
            if (needed) res.tight++;
            else {
              res.turns = others;
              res.dropped++;
            }
          }
        }
        res.pairs = res.pairs.filter((p) => res !== null && res.turns.some((t) => t.from === p.from && t.to === p.to));
        break;
      }
    }
    if (!res) return;
    for (const a of res.jp.arms) cutAt.set(key(a.end), a.cut);
    planned.set(root, res);
  };
  let retry = false;
  for (const n of graph.nodes.values()) if (n.ends.length >= 2 && !zoneNode.has(n.id)) dirty.add(find(n.id));
  for (let iter = 0; iter < 12 && dirty.size > 0; iter++) {
    const groups = members();
    const todo = [...new Set([...dirty].map((r) => find(r)))].sort((a, b) => a - b);
    dirty.clear();
    wantAbsorb.clear();
    for (const root of todo) {
      const ids = (groups.get(root) ?? []).filter((id) => !zoneNode.has(id)).sort((a, b) => a - b);
      if (ids.length === 0 || (ids.length === 1 && endsOf(ids[0] as number) < 2)) continue;
      planCluster(root, ids);
    }
    // an edge with too little left between its cuts is part of the junction
    for (const e of graph.edges) {
      if (absorbed.has(e.index)) continue;
      const a0 = Math.max(base0[e.index] as number, cutAt.get(e.index * 2) ?? 0);
      const a1 = Math.min(base1[e.index] as number, e.len - (cutAt.get(e.index * 2 + 1) ?? 0));
      if (a1 - a0 < MIN_STRIP_M && (cutAt.has(e.index * 2) || cutAt.has(e.index * 2 + 1))) wantAbsorb.add(e.index);
    }
    for (const i of [...wantAbsorb].sort((a, b) => a - b)) {
      const e = graph.edges[i] as GEdge;
      const zn = zoneEnds.get(i);
      if (zn) {
        for (const n of zn) noZone.add(n);
        retry = true;
        continue;
      }
      cutAt.delete(i * 2);
      cutAt.delete(i * 2 + 1);
      absorb(i, `${Math.round(e.len * 10) / 10} m: too short for the cuts and turn radii of the junction${e.a === e.b ? '' : 's'} at its ends`);
    }
    if (retry) break;
  }
  if (!retry) {
    for (const p of plans) {
      const i = p.edge.index;
      p.t0 = Math.max(base0[i] as number, cutAt.get(i * 2) ?? 0);
      p.t1 = Math.min(base1[i] as number, p.edge.len - (cutAt.get(i * 2 + 1) ?? 0));
      p.internal = absorbed.has(i);
    }
  }
  return { absorbed, planned, retry };
}

/**
 * Restrictions on the arms of one cluster (P1-032). A restriction may name an edge inside the cluster (the short
 * pieces of a chowk the cluster rule took in): the arm is then the one that edge leads to (a to edge, walking on with
 * the traffic) or comes from (a from edge, walking back), when that walk through the cluster's inside edges reaches
 * exactly one arm. Restrictions that still do not name two arms are left out here.
 */
export function resolveRules(rules: readonly MappedRestriction[], views: readonly ArmView[], here: ReadonlySet<string>, source: readonly GraphEdge[]): MappedRestriction[] {
  if (!rules.length) return [];
  const arms = new Set(views.map((v) => v.edge));
  const inside = source.filter((e) => here.has(e.a) && here.has(e.b) && !arms.has(e.id));
  const byId = new Map(source.map((e) => [e.id, e]));
  // the arms one walk reaches: forward leaves along the traffic, backward arrives against it
  const walk = (start: GraphEdge, forward: boolean): string[] => {
    const found = new Set<string>();
    const seen = new Set<string>([start.id]);
    let front = start.oneway ? [forward ? start.b : start.a] : [start.a, start.b];
    for (let step = 0; step < 12 && front.length; step++) {
      const next: string[] = [];
      for (const n of front) {
        for (const v of views) {
          const e = byId.get(v.edge);
          if (!e || seen.has(e.id)) continue;
          const ok = forward ? (e.a === n || (!e.oneway && e.b === n)) : (e.b === n || (!e.oneway && e.a === n));
          if (ok) found.add(e.id);
        }
        for (const e of inside) {
          if (seen.has(e.id)) continue;
          const on = forward ? (e.a === n ? e.b : !e.oneway && e.b === n ? e.a : null) : (e.b === n ? e.a : !e.oneway && e.a === n ? e.b : null);
          if (on === null) continue;
          seen.add(e.id);
          next.push(on);
        }
      }
      front = next;
    }
    return [...found];
  };
  const out: MappedRestriction[] = [];
  for (const r of rules) {
    const f = arms.has(r.from) ? [r.from] : byId.get(r.from) ? walk(byId.get(r.from) as GraphEdge, false) : [];
    const t = arms.has(r.to) ? [r.to] : byId.get(r.to) ? walk(byId.get(r.to) as GraphEdge, true) : [];
    if (f.length !== 1 || t.length !== 1) continue;
    out.push({ ...r, from: f[0] as string, to: t[0] as string });
  }
  return out;
}
