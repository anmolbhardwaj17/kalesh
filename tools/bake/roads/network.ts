// The lane model of a whole block graph (P1-012, MAP_REPAIR.md "Lane-level road model"): the production builder on
// the prototype's modules (model, curve, lanes, junction, hero). Input is the repaired block graph: the fit steps of
// the road bench (carriageways pushed apart, slip roads redrawn, lane counts from the road ahead) already ran there as
// logged rule repairs, so nothing here moves a centre line.
//
// Order: lane counts along whole streets (street.ts); a cross-section per edge; split zones at every diverge and
// merge; streets that change their count at a junction widen over a taper on the narrower side (netzones.ts);
// junction clusters with the cut of every arm; an edge too short to hold its cuts, or to give a turn its radius,
// becomes part of the junction (netclusters.ts); strips; joints; connecting lane paths; the explained ends
// (netstrips.ts). Last, the edge lanes of strips side by side give way (edges.ts) and a free end that runs into another
// road stops short of it (clip.ts). Then two fit rounds at most: a road too short for the taper it needs takes the lane count it would
// taper to, and the model is built again. Pure.
import type { GraphEdge } from '../graph/build.ts';
import { roadGraph, filterEdges } from './blockgraph.ts';
import { clipEnds } from './clip.ts';
import { armEdges, giveWay } from './edges.ts';
import type { EdgeTrims } from './edges.ts';
import type { RoadGraph } from './blockgraph.ts';
import type { HeroSpec } from './hero.ts';
import type { CrossSection } from './model.ts';
import { planClusters } from './netclusters.ts';
import { MAX_ROUNDS } from './netctx.ts';
import type { ClusterMemo, LaneBuild, LaneModelInput, NetCtx, WidthTaper } from './netctx.ts';
import { WIDTH_ROUNDS, planWidthFixes } from './netwidths.ts';
import { buildPaths, buildStrips, junctionArms } from './netstrips.ts';
import { planWidenings, planZones } from './netzones.ts';
import { driveCount } from './street.ts';
import type { WidthFixed } from './street.ts';
import { mapRestrictions } from './turns.ts';
import { dividerLanes, fitToDividers } from './dividers.ts';
import type { DividerFit } from './dividers.ts';
import type { MedianRef } from './medianrefs.ts';
import { checkWidthSteps, pairedOf, ringOf } from './widthsteps.ts';

/** Fit rounds of the dividers at most (a round holds the arms of every width step it made). */
const DIVIDER_ROUNDS = 4;
import { midBlockCrossings } from './crossings.ts';
import type { CrossingPoint } from './crossings.ts';
import type { Strip } from './model.ts';

export { CLUSTER_GAP_M } from './netctx.ts';
export type { EndKind, ExplainedEnd, LaneArm, LaneBuild, LaneJunction, LaneModelInput, LanePath } from './netctx.ts';

interface Attempt {
  build: LaneBuild;
  ctx: NetCtx;
  retry: boolean;
  /** The lane paths of this round (buildPaths): built for the round the model keeps, not for every round (P1-034). */
  paths: (() => void) | null;
}

export function buildLaneModel(input: LaneModelInput): LaneBuild {
  const t0 = Date.now();
  const road = roadGraph(input.nodes, filterEdges(input.edges, input.filter));
  const graphMs = Date.now() - t0;
  const fixed = new Map<string, number>();
  const noZone = new Set<number>();
  const widthFixed = new Map<string, WidthFixed>();
  const widthTapers = new Map<string, WidthTaper>();
  const widthBlocked = new Set<string>();
  const widthSettles = new Map<string, number>();
  const clusterMemo = new Map<string, ClusterMemo>();
  let last: Attempt | null = null;
  let rounds = 0;
  let retries = 0;
  let widthRounds = 0;
  let left = 0;
  // carriageways whose space up to their reference divider holds more lanes take that count (P1-034): read on a first
  // build, settled as fit counts before the rounds below
  let dividerCounts = 0;
  if (input.medianRefs?.length && input.widthContinuity !== false) {
    const probe = attempt(input, road, fixed, noZone, widthFixed, widthTapers, widthBlocked, widthSettles, clusterMemo).build;
    rounds++;
    const pairsOf = pairStrips(probe);
    for (const [edge, n] of dividerLanes(probe.strips, (si) => pairsOf(probe.strips[si] as Strip), input.medianRefs, new Map(probe.road.source.map((e) => [e.id, e])))) {
      fixed.set(edge, n);
      dividerCounts++;
    }
  }
  for (;;) {
    rounds++;
    last = attempt(input, road, fixed, noZone, widthFixed, widthTapers, widthBlocked, widthSettles, clusterMemo);
    // a fit round (a taper too short, a split built as a junction): at most MAX_ROUNDS builds in all for them
    if (last.retry && retries < MAX_ROUNDS - 1) {
      retries++;
      continue;
    }
    // width continuity (P1-046): steps across junctions ask for tapers or whole sections, and the model is built again
    if (widthRounds >= WIDTH_ROUNDS || input.widthContinuity === false) break;
    const w = planWidthFixes(last.ctx, last.build, widthRounds >= WIDTH_ROUNDS - 4);
    left = w.left;
    if (!w.changed) break;
    widthRounds++;
  }
  const build = (last as Attempt).build;
  (last as Attempt).paths?.();
  build.rounds = rounds;
  build.widthFixes = {
    tapers: [...widthTapers.keys()].sort().map((k) => widthTapers.get(k) as WidthTaper),
    whole: [...widthFixed.keys()].sort().map((k) => ({ edge: k, ...(widthFixed.get(k) as WidthFixed) })),
    rounds: widthRounds, left,
  };
  build.ms['graph'] = graphMs;
  build.ms['total'] = Date.now() - t0;
  const fitted = new Map(fixed);
  build.plans.forEach((p, i) => {
    const id = (road.source[i] as GraphEdge).id;
    const n = driveCount(p.cs[0] as CrossSection);
    if (build.streets.byEdge.get(id)?.lanes !== n && !p.hero) fitted.set(id, n);
  });
  build.fitted = [...fitted].map(([edge, lanes]) => ({ edge, lanes })).sort((a, b) => (a.edge < b.edge ? -1 : 1));
  // carriageways wider than their lanes take the space up to their reference divider (P1-034)
  const td = Date.now();
  if (input.medianRefs?.length) build.dividers = { ...fitDividers(build, input.medianRefs), lanesSet: dividerCounts };
  build.ms['dividers'] = Date.now() - td;
  // the edge lanes of strips side by side give way, so no two surfaces share area outside the carriageways
  const te = Date.now();
  build.edgeTrims = giveWay(build.strips, build.joints);
  build.ms['edges'] = Date.now() - te;
  // a free end (a dead end, the stage edge) that runs into another road's surface stops where that surface begins
  const tc = Date.now();
  build.endClips = clipEnds(build.strips, build.joints, build.ends);
  build.ms['clips'] = Date.now() - tc;
  build.ms['total'] = Date.now() - t0;
  roundModel(build);
  // the raised edge widths each junction arm meets, after the edges gave way (for the junction mesh, P1-014)
  armEdges(build.strips, build.junctions);
  // crossings away from the junctions (P1-032): OSM crossing nodes and add_crossing marks, on their strips
  const mid = midBlockCrossings(build.strips, crossingPoints(input), junctionNodes(input, build), armZebras(build), pairStrips(build));
  build.crossings = mid.list;
  build.crossingReport = mid.report;
  return build;
}

/**
 * The carriageways fitted to their reference dividers (dividers.ts). A widening that would make a width step across a
 * junction (one side of the corridor widened more than the other, widthsteps.ts) is held at the nominal width at the
 * arms of that step and the fit runs again, at most DIVIDER_ROUNDS times.
 */
function fitDividers(build: LaneBuild, refs: readonly MedianRef[]): DividerFit {
  const edgeById = new Map(build.road.source.map((e) => [e.id, e]));
  const pairsOf = pairStrips(build);
  const index = new Map(build.strips.map((s, i) => [s.id, i]));
  const before = build.strips.map((s) => s.st.map((st) => st.b));
  const paired = pairedOf(build.road.source);
  const ring = ringOf(build.road.source);
  const held = new Map<number, { start?: boolean; end?: boolean }>();
  let fit: DividerFit | null = null;
  for (let round = 0; round < DIVIDER_ROUNDS; round++) {
    build.strips.forEach((s, si) => s.st.forEach((st, i) => (st.b = (before[si] as number[][])[i] as number[])));
    fit = fitToDividers(build.strips, build.joints, (si) => pairsOf(build.strips[si] as Strip), refs, edgeById, held);
    let more = false;
    for (const w of checkWidthSteps(build.strips, build.joints, build.junctions, paired, ring).list) {
      if (w.kind !== 'junction') continue;
      const jn = build.junctions.find((j) => j.id === w.where);
      for (const id of [...w.a, ...w.b]) {
        const si = index.get(id);
        if (si === undefined || !fit.widened[si]) continue;
        const arm = jn?.arms.find((a) => a.strip === si);
        if (!arm) continue;
        const h = held.get(si) ?? {};
        if (h[arm.end]) continue;
        h[arm.end] = true;
        held.set(si, h);
        more = true;
      }
    }
    if (!more) break;
  }
  return fit as DividerFit;
}

/** Crossing points of the map: OSM highway=crossing nodes and add_crossing marks ("crossing:<patch>"). */
function crossingPoints(input: LaneModelInput): CrossingPoint[] {
  const out: CrossingPoint[] = [];
  (input.points ?? []).forEach((p, k) => {
    if (p.kind === 'crossing') out.push({ x: p.x, z: p.z, id: p.id ?? `point${k}`, source: 'osm', ...(p.marked === false ? { marked: false } : {}) });
  });
  for (const [id, m] of Object.entries(input.marks ?? {})) {
    if (id.startsWith('crossing:') && m['kind'] !== 'signals') out.push({ x: Number(m['x']), z: Number(m['z']), id, source: 'patch' });
  }
  return out;
}

function junctionNodes(input: LaneModelInput, build: LaneBuild): { x: number; z: number }[] {
  const at = new Map(input.nodes.map((n) => [n.id, n]));
  const out: { x: number; z: number }[] = [];
  for (const j of build.junctions) for (const id of j.nodes) {
    const n = at.get(id);
    if (n) out.push({ x: n.x, z: n.z });
  }
  return out;
}

const armZebras = (build: LaneBuild): Set<string> => new Set(build.junctions.flatMap((j) => j.arms.filter((a) => a.crossing).map((a) => `${a.strip}:${a.end}`)));

/** The strips of the other carriageway of a strip's street (its graph edge's pairedWith). */
function pairStrips(build: LaneBuild): (s: Strip) => number[] {
  const index = new Map(build.road.source.map((e, i) => [e.id, i]));
  return (s: Strip): number[] => {
    const i = index.get(s.edge);
    if (i === undefined) return [];
    const out: number[] = [];
    for (const pid of (build.road.source[i] as GraphEdge).pairedWith) {
      const b = build.built.get(index.get(pid) ?? -1);
      if (b) for (let k = b.first; k <= b.last; k++) out.push(k);
    }
    return out;
  };
}

function emptyTurnRules(c: NetCtx): LaneBuild['turnRules'] {
  return { restrictions: { ...c.turnReport, applied: 0, notApplied: [], movementsRemoved: 0 }, turnLanes: { ways: c.input.turnInputs?.wayTurns.size ?? 0, bySource: {}, arms: 0, applied: 0, mismatched: [], movementsRemoved: 0 } };
}

function context(input: LaneModelInput, road: RoadGraph, fixed: Map<string, number>, noZone: Set<number>, widthFixed: Map<string, WidthFixed>, widthTapers: Map<string, WidthTaper>, widthBlocked: Set<string>, widthSettles: Map<string, number>): NetCtx {
  const heroes = input.heroes ?? [];
  const heroOf = (e: GraphEdge): HeroSpec | null => {
    for (const h of heroes) if (e.pieces.every((p) => h.covers.osmWays.includes(Number(p.way.replace('way/', ''))))) return h;
    return null;
  };
  const heroBy = road.source.map(heroOf);
  const turns = mapRestrictions(input.nodes, input.edges, input.turnInputs ?? { restrictions: [], unread: [], wayTurns: new Map() });
  return {
    turnRules: turns.list, turnReport: turns.report,
    input, road, graph: road.graph, source: road.source, nodeId: road.nodeId, nodeKind: road.nodeKind, heroes, heroBy, isHero: (i) => heroBy[i] !== null,
    indexOf: new Map(road.source.map((e, i) => [e.id, i])), fixed, noZone, widthFixed, widthTapers, widthBlocked, widthSettles, problems: [], step: input.step ?? 4,
  };
}

function attempt(input: LaneModelInput, road: RoadGraph, fixed: Map<string, number>, noZone: Set<number>, widthFixed: Map<string, WidthFixed>, widthTapers: Map<string, WidthTaper>, widthBlocked: Set<string>, widthSettles: Map<string, number>, clusterMemo?: Map<string, ClusterMemo>): Attempt {
  const ms: Record<string, number> = {};
  let clock = Date.now();
  const lap = (name: string): void => {
    const now = Date.now();
    ms[name] = (ms[name] ?? 0) + now - clock;
    clock = now;
  };
  const c = context(input, road, fixed, noZone, widthFixed, widthTapers, widthBlocked, widthSettles);
  if (clusterMemo) c.clusterMemo = clusterMemo;
  const z = planZones(c);
  lap('zones');
  const widenings = planWidenings(c, z);
  const cl = planClusters(c, z);
  lap('junctions');
  const base = {
    road, plans: z.plans, streets: z.streets, zones: z.zones, forks: z.forks, widenings, fitted: [], problems: c.problems, rounds: 0, ms,
    edgeTrims: { strips: 0, stations: 0, areaM2: 0, rounds: 0 }, endClips: { ends: 0, stations: 0, metres: 0 }, widthFixes: { tapers: [], whole: [], rounds: 0, left: 0 },
  };
  if (cl.retry) {
    return {
      build: { ...base, strips: [], joints: [], zoneStrips: [], junctions: [], junctionPlans: [], ends: [], internal: [], tightPaths: [], turns: { uTurnsTooTight: 0, restricted: 0, droppedForRadius: 0, tight: 0 }, turnRules: emptyTurnRules(c), crossings: [], crossingReport: { points: 0, placed: 0, pairedAdded: 0, skipped: {} }, built: new Map() },
      ctx: c,
      retry: true,
      paths: null,
    };
  }
  const sp = buildStrips(c, z);
  lap('strips');
  const internal = [...cl.absorbed].sort((a, b) => a[0] - b[0]).map(([i, why]) => ({ edge: (road.source[i] as GraphEdge).id, why }));
  // a width round reads only the junctions' arms; the lane paths are built once the model keeps this round
  const build: LaneBuild = {
    ...base, strips: sp.strips, joints: sp.joints, zoneStrips: sp.zoneStrips, built: sp.built, internal, crossings: [], crossingReport: { points: 0, placed: 0, pairedAdded: 0, skipped: {} },
    junctions: junctionArms(cl, sp), junctionPlans: [], ends: [], tightPaths: [], turns: { uTurnsTooTight: 0, restricted: 0, droppedForRadius: 0, tight: 0 }, turnRules: emptyTurnRules(c),
  };
  const paths = (): void => {
    clock = Date.now();
    Object.assign(build, buildPaths(c, cl, sp));
    lap('paths');
  };
  return { build, ctx: c, retry: sp.retry, paths };
}

/**
 * The edge lanes give way once more on the solved levels (P1-042): strips that lie on each other only once the
 * heights are known (the low end of a ramp on fill beside a road at grade: kerb on kerb). The repair's side shift
 * (R-LANE-06) is not used for these: it pushed the ramp across the road. Changes the strips' borders in place.
 */
export function giveWaySolved(build: LaneBuild, kinds: readonly ArrayLike<number>[]): EdgeTrims {
  const trims = giveWay(build.strips, build.joints, kinds);
  if (trims.stations > 0) {
    for (const s of build.strips) for (const st of s.st) st.b = st.b.map(r3);
    armEdges(build.strips, build.junctions);
  }
  return trims;
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
    if (s.taper) s.taper = { length: r3(s.taper.length), shift: r3(s.taper.shift), needed: r3(s.taper.needed), ...(s.taper.ratio !== undefined ? { ratio: s.taper.ratio } : {}) };
  }
  for (const z of b.zones) {
    z.dNose = r3(z.dNose);
    z.dPainted = r3(z.dPainted);
  }
}
