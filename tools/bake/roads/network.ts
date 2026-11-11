// The lane model of a whole block graph (P1-012, MAP_REPAIR.md "Lane-level road model"): the production builder on
// the prototype's modules (model, curve, lanes, junction, hero). Input is the repaired block graph: the fit steps of
// the road bench (carriageways pushed apart, slip roads redrawn, lane counts from the road ahead) already ran there as
// logged rule repairs, so nothing here moves a centre line.
//
// Order: lane counts along whole streets (street.ts); a cross-section per edge; split zones at every diverge and
// merge; streets that change their count at a junction widen over a taper on the narrower side (netzones.ts);
// junction clusters with the cut of every arm; an edge too short to hold its cuts, or to give a turn its radius,
// becomes part of the junction (netclusters.ts); strips; joints; connecting lane paths; the explained ends
// (netstrips.ts). Last, the edge lanes of strips side by side give way (edges.ts). Then two fit rounds at most: a road too short for the taper it needs takes the lane count it would
// taper to, and the model is built again. Pure.
import type { GraphEdge } from '../graph/build.ts';
import { roadGraph, filterEdges } from './blockgraph.ts';
import { giveWay } from './edges.ts';
import type { RoadGraph } from './blockgraph.ts';
import type { HeroSpec } from './hero.ts';
import type { CrossSection } from './model.ts';
import { planClusters } from './netclusters.ts';
import { MAX_ROUNDS } from './netctx.ts';
import type { LaneBuild, LaneModelInput, NetCtx } from './netctx.ts';
import { buildPaths, buildStrips } from './netstrips.ts';
import { planWidenings, planZones } from './netzones.ts';
import { driveCount } from './street.ts';

export { CLUSTER_GAP_M } from './netctx.ts';
export type { EndKind, ExplainedEnd, LaneArm, LaneBuild, LaneJunction, LaneModelInput, LanePath } from './netctx.ts';

interface Attempt {
  build: LaneBuild;
  retry: boolean;
}

export function buildLaneModel(input: LaneModelInput): LaneBuild {
  const t0 = Date.now();
  const road = roadGraph(input.nodes, filterEdges(input.edges, input.filter));
  const graphMs = Date.now() - t0;
  const fixed = new Map<string, number>();
  const noZone = new Set<number>();
  let last: Attempt | null = null;
  let rounds = 0;
  while (rounds < MAX_ROUNDS) {
    rounds++;
    last = attempt(input, road, fixed, noZone);
    if (!last.retry) break;
  }
  const build = (last as Attempt).build;
  build.rounds = rounds;
  build.ms['graph'] = graphMs;
  build.ms['total'] = Date.now() - t0;
  const fitted = new Map(fixed);
  build.plans.forEach((p, i) => {
    const id = (road.source[i] as GraphEdge).id;
    const n = driveCount(p.cs[0] as CrossSection);
    if (build.streets.byEdge.get(id)?.lanes !== n && !p.hero) fitted.set(id, n);
  });
  build.fitted = [...fitted].map(([edge, lanes]) => ({ edge, lanes })).sort((a, b) => (a.edge < b.edge ? -1 : 1));
  // the edge lanes of strips side by side give way, so no two surfaces share area outside the carriageways
  const te = Date.now();
  build.edgeTrims = giveWay(build.strips, build.joints);
  build.ms['edges'] = Date.now() - te;
  build.ms['total'] = Date.now() - t0;
  roundModel(build);
  return build;
}

function context(input: LaneModelInput, road: RoadGraph, fixed: Map<string, number>, noZone: Set<number>): NetCtx {
  const heroes = input.heroes ?? [];
  const heroOf = (e: GraphEdge): HeroSpec | null => {
    for (const h of heroes) if (e.pieces.every((p) => h.covers.osmWays.includes(Number(p.way.replace('way/', ''))))) return h;
    return null;
  };
  const heroBy = road.source.map(heroOf);
  return {
    input, road, graph: road.graph, source: road.source, nodeId: road.nodeId, nodeKind: road.nodeKind, heroes, heroBy, isHero: (i) => heroBy[i] !== null,
    indexOf: new Map(road.source.map((e, i) => [e.id, i])), fixed, noZone, problems: [], step: input.step ?? 4,
  };
}

function attempt(input: LaneModelInput, road: RoadGraph, fixed: Map<string, number>, noZone: Set<number>): Attempt {
  const ms: Record<string, number> = {};
  let clock = Date.now();
  const lap = (name: string): void => {
    const now = Date.now();
    ms[name] = (ms[name] ?? 0) + now - clock;
    clock = now;
  };
  const c = context(input, road, fixed, noZone);
  const z = planZones(c);
  lap('zones');
  const widenings = planWidenings(c, z);
  const cl = planClusters(c, z);
  lap('junctions');
  const base = {
    road, plans: z.plans, streets: z.streets, zones: z.zones, forks: z.forks, widenings, fitted: [], problems: c.problems, rounds: 0, ms,
    edgeTrims: { strips: 0, stations: 0, areaM2: 0, rounds: 0 },
  };
  if (cl.retry) {
    return {
      build: { ...base, strips: [], joints: [], zoneStrips: [], junctions: [], junctionPlans: [], ends: [], internal: [], tightPaths: [], turns: { uTurnsTooTight: 0, restricted: 0, droppedForRadius: 0, tight: 0 }, built: new Map() },
      retry: true,
    };
  }
  const sp = buildStrips(c, z);
  lap('strips');
  const pp = buildPaths(c, cl, sp);
  lap('paths');
  const internal = [...cl.absorbed].sort((a, b) => a[0] - b[0]).map(([i, why]) => ({ edge: (road.source[i] as GraphEdge).id, why }));
  return {
    build: { ...base, strips: sp.strips, joints: sp.joints, zoneStrips: sp.zoneStrips, built: sp.built, internal, ...pp },
    retry: sp.retry,
  };
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const r6 = (v: number): number => Math.round(v * 1e6) / 1e6 + 0;

/** Rounds every station to the millimetre (frames to a millionth), so the model in memory is the model on disk. */
function roundModel(b: LaneBuild): void {
  for (const s of b.strips) {
    for (const st of s.st) {
      st.x = r3(st.x);
      st.z = r3(st.z);
      st.s = r3(st.s);
      st.nx = r6(st.nx);
      st.nz = r6(st.nz);
      st.b = st.b.map(r3);
    }
    if (s.taper) s.taper = { length: r3(s.taper.length), shift: r3(s.taper.shift), needed: r3(s.taper.needed) };
  }
  for (const z of b.zones) {
    z.dNose = r3(z.dNose);
    z.dPainted = r3(z.dPainted);
  }
}
