// Lane model phase 1 (network.ts): lane counts along whole streets, a cross-section per edge, split zones at every
// diverge and merge, and the streets that change their lane count at a junction (a taper on the narrower side). Pure.
import type { GraphEdge } from '../graph/build.ts';
import type { GEdge, GEnd, GNode } from './graph.ts';
import { heroCrossSection } from './hero.ts';
import type { HeroSpec } from './hero.ts';
import { mainBranch, matchRows, planSplit, rowBorders, splitCandidate } from './lanes.ts';
import type { EdgePlan, Row, SplitCandidate, Zone } from './lanes.ts';
import { classDefaults } from './model.ts';
import type { CrossSection } from './model.ts';
import { CLUSTER_GAP_M, CUT_ESTIMATE_M, EXTRA_LANES } from './netctx.ts';
import type { LaneBuild, NetCtx } from './netctx.ts';
import { driveCount, inferStreets, streetCrossSection } from './street.ts';
import type { EdgeLanes, StreetResult } from './street.ts';

export interface ZonePhase {
  streets: StreetResult;
  plans: EdgePlan[];
  nominal: CrossSection[];
  zones: Zone[];
  forks: LaneBuild['forks'];
  zoneCands: SplitCandidate[];
  /** Roads that take the first section of the zone at this node as their own cross-section. */
  adopt: Map<string, number>;
  zoneNode: Set<number>;
  /** Edges that carry a zone at an end, with the zone's node. */
  zoneEnds: Map<number, number[]>;
  /** The strip part of every edge before the junctions cut it. */
  base0: number[];
  base1: number[];
  info: (i: number) => EdgeLanes;
  /** Settle a raise of an edge's lane count (at most one lane over the street's own count). */
  raise: (id: string, want: number, now: number) => boolean;
}

const shiftOf = (rows: readonly Row[], a: CrossSection, b: CrossSection): number => {
  const bd = rowBorders(rows, a, b);
  let m = 0;
  for (let k = 0; k < bd.a.length; k++) m = Math.max(m, Math.abs((bd.a[k] as number) - (bd.b[k] as number)));
  return m;
};

export function planZones(c: NetCtx): ZonePhase {
  const { input, graph, source, nodeId, heroes, heroBy, isHero, indexOf, fixed, noZone } = c;
  const marks = input.marks ? { marks: input.marks } : {};
  let streets = inferStreets({ nodes: input.nodes, edges: source, ...marks }, input.wayLanes, heroes, fixed);
  let plans: EdgePlan[] = [];
  let nominal: CrossSection[] = [];
  let zones: Zone[] = [];
  let forks: LaneBuild['forks'] = [];
  const zoneCands: SplitCandidate[] = [];
  const adopt = new Map<string, number>();
  const zoneNode = new Set<number>();
  const zoneEnds = new Map<number, number[]>();
  const info = (i: number): EdgeLanes => streets.byEdge.get((source[i] as GraphEdge).id) as EdgeLanes;
  const farReserve = (e: GEnd): number => {
    const edge = graph.edges[e.edge] as GEdge;
    const far = graph.nodes.get(e.atStart ? edge.b : edge.a);
    return far && far.ends.length > 1 ? Math.min(18, edge.len * 0.3) : 0;
  };
  /** A split with a junction node within the cluster gap along one of its three roads is part of that junction (a turn island), not a zone. */
  const insideJunction = (cand: { parent: GEnd; branches: [GEnd, GEnd] }): string | null => {
    // traffic entering a roundabout gives way at a line: an entry or exit is a junction with a splitter island, not lanes side by side
    if ([cand.parent, ...cand.branches].some((e) => (source[e.edge] as GraphEdge).roundabout)) return 'an entry or exit of a roundabout: a give-way junction';
    for (const e of [cand.parent, ...cand.branches]) {
      const edge = graph.edges[e.edge] as GEdge;
      const far = graph.nodes.get(e.atStart ? edge.b : edge.a) as GNode;
      if (edge.len <= CLUSTER_GAP_M && far.ends.length >= 3) return `${Math.round(edge.len * 10) / 10} m from the junction node ${nodeId[far.id]}: part of that junction (cluster rule, ${CLUSTER_GAP_M} m)`;
    }
    return null;
  };
  /** The count of every edge before the lane model settles anything itself: a road gains one extra lane at most. */
  const baseLanes = new Map<string, number>();
  for (const [id, r] of inferStreets({ nodes: input.nodes, edges: source, ...marks }, input.wayLanes, heroes).byEdge) baseLanes.set(id, r.lanes);
  const raise = (id: string, want: number, now: number): boolean => {
    const to = Math.min(want, (baseLanes.get(id) ?? now) + EXTRA_LANES, streets.byEdge.get(id)?.cap ?? want);
    if (to <= now || fixed.get(id) === to) return false;
    fixed.set(id, to);
    return true;
  };
  const settle = (): void => {
    streets = inferStreets({ nodes: input.nodes, edges: source, ...marks }, input.wayLanes, heroes, fixed);
  };
  // a split zone carries the lanes of both branches side by side: a branch whose count is only a default carries what
  // the road before the split can feed (or the road after a merge can take), one lane at least
  for (let pass = 0; pass < 4; pass++) {
    let lowered = false;
    for (const node of graph.nodes.values()) {
      const cand = splitCandidate(graph, node.id);
      if (!cand || noZone.has(node.id) || [cand.parent, ...cand.branches].some((e) => isHero(e.edge)) || insideJunction(cand)) continue;
      const { main, minor } = mainBranch(graph, cand);
      const r = info(minor.edge);
      if (r.from !== 'class' && r.from !== 'street' && r.from !== 'pair') continue;
      const want = Math.max(1, info(cand.parent.edge).lanes - info(main.edge).lanes);
      if (want < r.lanes) {
        fixed.set((source[minor.edge] as GraphEdge).id, want);
        lowered = true;
      }
    }
    if (!lowered) break;
    settle();
  }
  for (let pre = 0; pre < 5; pre++) {
    nominal = source.map((e, i) => (heroBy[i] ? heroCrossSection(heroBy[i] as HeroSpec) : streetCrossSection(e, info(i), info(i).lanes)));
    plans = graph.edges.map((e, i) => ({
      edge: e, cs: e.pieces.map(() => nominal[i] as CrossSection), hero: heroBy[i]?.id ?? null, t0: 0, t1: e.len, internal: false,
      paired: (source[i] as GraphEdge).pairedWith.map((id) => indexOf.get(id)).find((x) => x !== undefined) ?? null,
    }));
    zones = [];
    zoneCands.length = 0;
    forks = [];
    zoneNode.clear();
    zoneEnds.clear();
    // a first pass on a copy finds the gore side of every branch: a road that is the branch of one zone and the road
    // before another must have its final cross-section before the second zone names its lanes
    const scratch: EdgePlan[] = plans.map((p) => ({ ...p, cs: p.cs.slice() }));
    for (const node of graph.nodes.values()) {
      const cand = noZone.has(node.id) ? null : splitCandidate(graph, node.id);
      if (cand && ![cand.parent, ...cand.branches].some((e) => isHero(e.edge)) && !insideJunction(cand)) planSplit(graph, scratch, cand, farReserve, 3);
    }
    plans.forEach((p, i) => {
      p.cs = (scratch[i] as EdgePlan).cs;
    });
    for (const node of graph.nodes.values()) {
      const cand = splitCandidate(graph, node.id);
      if (!cand) continue;
      const three = [cand.parent, ...cand.branches];
      if (three.some((e) => isHero(e.edge))) continue;
      if (noZone.has(node.id)) {
        forks.push({ node: nodeId[node.id] as string, kind: cand.kind, why: 'the road before the split, or a branch, is too short for the lanes, tapers and junction cuts the zone would need' });
        continue;
      }
      const inside = insideJunction(cand);
      if (inside) {
        forks.push({ node: nodeId[node.id] as string, kind: cand.kind, why: inside });
        continue;
      }
      const zone = planSplit(graph, plans, cand, farReserve, 3);
      if (!zone) {
        forks.push({ node: nodeId[node.id] as string, kind: cand.kind, why: 'the branches do not come a nose gap apart within their own length' });
        continue;
      }
      zones.push(zone);
      zoneCands.push(cand);
      zoneNode.add(node.id);
      for (const e of three) zoneEnds.set(e.edge, [...(zoneEnds.get(e.edge) ?? []), node.id]);
    }
    // a road that takes the first section of its zone whole has no taper there
    for (const z of zones) {
      const p = plans[z.parent.edge] as EdgePlan;
      const att = z.parent.atStart ? p.startAttach : p.endAttach;
      if (adopt.get((source[z.parent.edge] as GraphEdge).id) !== z.node || !att?.target) continue;
      const cs = att.target.cs;
      p.cs = p.cs.map(() => cs);
      nominal[z.parent.edge] = cs;
      delete att.target;
    }
    // a road too short for the taper to its zone takes the lane count of the zone's first section
    let raised = false;
    for (const [zi, z] of zones.entries()) {
      const p = plans[z.parent.edge] as EdgePlan;
      const att = z.parent.atStart ? p.startAttach : p.endAttach;
      if (!att?.target || isHero(z.parent.edge)) continue;
      const own = (z.parent.atStart ? p.cs[0] : p.cs[p.cs.length - 1]) as CrossSection;
      const shift = z.parent.atStart ? shiftOf(att.target.rows, att.target.cs, own) : shiftOf(att.target.rows, own, att.target.cs);
      const need = classDefaults(p.edge.cls).taper * shift;
      const far = graph.nodes.get(z.parent.atStart ? p.edge.b : p.edge.a) as GNode;
      const both = (z.parent.atStart ? p.endAttach : p.startAttach)?.target !== undefined;
      const room = (p.t1 - p.t0 - (far.ends.length > 1 && !zoneNode.has(far.id) ? CUT_ESTIMATE_M : 0)) * (both ? 0.45 : 0.7);
      if (need <= room) continue;
      const id = (source[z.parent.edge] as GraphEdge).id;
      const want = driveCount(att.target.cs);
      // more lanes than the road may carry: the branch that leaves or joins brings fewer (one at least), whatever its tag says
      const most = Math.max(driveCount(own), (baseLanes.get(id) ?? 0) + EXTRA_LANES);
      const { minor } = mainBranch(graph, zoneCands[zi] as SplitCandidate);
      const minorId = (source[minor.edge] as GraphEdge).id;
      const now = info(minor.edge).lanes;
      const fewer = Math.max(1, now - (want - most));
      if (want > most && fewer < now && fixed.get(minorId) !== fewer) {
        fixed.set(minorId, fewer);
        raised = true;
        continue;
      }
      if (!(z.parent.atStart ? p.endAttach : p.startAttach)) {
        // the short road takes the zone's first section whole: the lanes that run on stay where they are, the extra
        // lane lies on the side of the branch that leaves or joins, and there is no taper
        adopt.set(id, z.node);
        raised = true;
        continue;
      }
      if (raise(id, want, driveCount(own))) raised = true;
    }
    if (!raised) break;
    settle();
  }
  return {
    get streets() {
      return streets;
    },
    plans, nominal, zones, forks, zoneCands, adopt, zoneNode, zoneEnds, base0: plans.map((p) => p.t0), base1: plans.map((p) => p.t1), info, raise,
  };
}

/** Streets that change their lane count at a junction: the narrower road widens before it (or the wider one narrows). */
export function planWidenings(c: NetCtx, z: ZonePhase): LaneBuild['widenings'] {
  const { graph, source, indexOf, isHero, fixed } = c;
  const { plans, nominal, zoneNode, adopt, info } = z;
  const widenings: LaneBuild['widenings'] = [];
  for (const chain of z.streets.streets) {
    for (let k = 0; k + 1 < chain.length; k++) {
      const i = indexOf.get(chain[k] as string);
      const j = indexOf.get(chain[k + 1] as string);
      if (i === undefined || j === undefined) continue;
      const ei = graph.edges[i] as GEdge;
      const ej = graph.edges[j] as GEdge;
      const shared = [ei.a, ei.b].filter((n) => n === ej.a || n === ej.b);
      if (shared.length !== 1 || ei.a === ei.b || ej.a === ej.b || zoneNode.has(shared[0] as number)) continue;
      const ni = driveCount(nominal[i] as CrossSection);
      const nj = driveCount(nominal[j] as CrossSection);
      if (ni === nj) continue;
      const narrow = ni < nj ? i : j;
      const wider = ni < nj ? j : i;
      // an extra lane beside a split zone ends at the junction: the street does not widen for it
      if (fixed.has((source[wider] as GraphEdge).id) || adopt.has((source[wider] as GraphEdge).id)) continue;
      const node = shared[0] as number;
      /** The taper on edge e towards `lanes` lanes at the shared node, when e may take one and how much room it has for it. */
      const taperOn = (e: number, lanes: number): { atStart: boolean; target: CrossSection; rows: Row[]; fits: boolean } | null => {
        const p = plans[e] as EdgePlan;
        const r = info(e);
        // a hero road keeps its spec, a gali its width, a zone branch its gore side
        if (isHero(e) || r.from === 'width' || r.gali || p.cs[0] !== nominal[e] || fixed.has((source[e] as GraphEdge).id)) return null;
        const atStart = (graph.edges[e] as GEdge).a === node;
        if (atStart ? p.startAttach : p.endAttach) return null;
        const own = nominal[e] as CrossSection;
        const target = streetCrossSection(source[e] as GraphEdge, r, lanes);
        const rows = atStart ? matchRows(target, own) : matchRows(own, target);
        const need = classDefaults(p.edge.cls).taper * (atStart ? shiftOf(rows, target, own) : shiftOf(rows, own, target));
        const far = graph.nodes.get(atStart ? p.edge.b : p.edge.a) as GNode;
        const other = atStart ? p.endAttach : p.startAttach;
        const room = (p.t1 - p.t0 - CUT_ESTIMATE_M - (far.ends.length > 1 && !zoneNode.has(far.id) ? CUT_ESTIMATE_M : 0)) * (other?.target ? 0.45 : 0.7);
        return { atStart, target, rows, fits: need <= room };
      };
      // the narrower road widens before the junction; where it has no room and the wider one has, the wider road
      // narrows to the junction instead; where neither has, the narrower one tries (and may take the wider count)
      const onNarrow = taperOn(narrow, Math.max(ni, nj));
      const onWide = onNarrow && !onNarrow.fits && ((source[wider] as GraphEdge).oneway || Math.min(ni, nj) > 1) ? taperOn(wider, Math.min(ni, nj)) : null;
      const [edge, t] = onWide?.fits ? [wider, onWide] : [narrow, onNarrow];
      if (!t) continue;
      const p = plans[edge] as EdgePlan;
      if (t.atStart) p.startAttach = { nx: 0, nz: 0, own: true, target: { cs: t.target, rows: t.rows } };
      else p.endAttach = { nx: 0, nz: 0, own: true, target: { cs: t.target, rows: t.rows } };
      widenings.push({ edge: (source[edge] as GraphEdge).id, end: t.atStart ? 'start' : 'end', from: driveCount(nominal[edge] as CrossSection), to: driveCount(t.target) });
    }
  }
  return widenings;
}
