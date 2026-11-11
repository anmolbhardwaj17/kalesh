// One site of the road bench, start to end (P0-019): graph, pairing, lane sections, split zones, junctions,
// strips, heights, structures, meshes, terrain and the gate counts. Pure: the driver (harness/bench/roads.mjs)
// reads the files and passes the map model, the ground sampler and the hero specs.
//
// About J2: the design names a polygon union (Clipper2) as the check and the fallback of the junction builder. The
// dependency could not be added in this run, so the check here is exact and done on the mesh itself (every pair of
// road triangles is clipped against each other, checks.ts), and the fallback is the plain polygon of junction.ts.
import type { P2 } from '../geom.ts';
import type { Road } from '../osm.ts';
import type { MeshData, Placement, TileContent } from '../tile.ts';
import { checkContinuity, checkEdgeColliders, checkHeights, checkOverlap, checkTapers, surfaceArea } from './checks.ts';
import type { ColliderCheck, ContinuityCheck, HeightCheck, OverlapCheck, TaperCheck } from './checks.ts';
import { lerp, selfCrossing } from './curve.ts';
import { markStructures, solveElevation } from './elevation.ts';
import type { SolveReport } from './elevation.ts';
import { limitDivergence, pushApart } from './fit.ts';
import type { FitRelation, FitReport } from './fit.ts';
import { buildGraph, outward, regionRing } from './graph.ts';
import type { GEdge, GEnd, Graph, SiteSpec } from './graph.ts';
import { buildHeroFurniture, checkHero, heroCrossSection } from './hero.ts';
import type { HeroCheck, HeroSpec } from './hero.ts';
import { planJunction } from './junction.ts';
import type { JunctionPlan, RingItem } from './junction.ts';
import { buildEdgeStrips, edgeCrossSections, pairCarriageways, planSplit, splitCandidate } from './lanes.ts';
import type { EdgePlan, Zone } from './lanes.ts';
import { borderPoint, buildMarkings, buildPiers, buildSurfaces, colliderChunks } from './mesh.ts';
import type { SurfTri } from './mesh.ts';
import { KERB_RAISE, NOSE_GAP, classDefaults, coreRange, csBorders } from './model.ts';
import type { Joint, Junction, JunctionBand, LaneDef, Station, Strip, StripEnd, V3 } from './model.ts';
import { buildTf1, buildTf2, gapTf2, surfaceBoundary } from './terrain.ts';
import type { GapStats } from './terrain.ts';
import { TriGrid } from './trigrid.ts';

export interface SiteInput {
  site: SiteSpec;
  roads: readonly Road[];
  ground: (x: number, z: number) => number;
  heroes?: readonly HeroSpec[];
  /** Station spacing in metres. */
  step?: number;
  /** false: no terrain is built (neither TF1 nor TF2) and no ground mesh is written: the caller brings its own ground (the stitch bench, whose roads lie in one ground for the whole map). */
  terrain?: boolean;
}

export interface Pose {
  name: string;
  kind: 'top' | 'eye';
  /** District metres; y is metres above the geoid. A top pose looks straight down with north up. */
  pos: [number, number, number];
  target: [number, number, number];
  /** Height of the picture in metres (top) or the field of view in degrees (eye). */
  size: number;
  note: string;
}

export interface SiteChecks {
  overlap: OverlapCheck;
  continuity: ContinuityCheck;
  tapers: TaperCheck;
  heights: HeightCheck;
  groundGap: { tf1: GapStats; tf2: GapStats };
  hero: HeroCheck[];
  colliders: ColliderCheck;
  mesh: { openBoundaryEdges: number; doubledEdges: number; boundaryLoops: number; groundPolygons: number; forcedEars: number; groundAreaErrorM2: number; groundNeedles: number };
}

export interface SiteResult {
  site: SiteSpec;
  graph: Graph;
  strips: Strip[];
  joints: Joint[];
  junctions: Junction[];
  zones: Zone[];
  pairs: [number, number][];
  problems: string[];
  /** Reference lines shifted apart to fit the lane widths, and lane counts taken over from the road ahead. */
  fit: FitReport & { lanesInherited: number; slipRoadsRedrawn: number; slipRoadMaxMoveM: number };
  checks: SiteChecks;
  solve: SolveReport;
  abutments: { strip: string; x: number; z: number; heightAboveGround: number }[];
  tile: TileContent;
  /** Ground height samples for the scene's ray probe: district metres and the drawn height. */
  probes: { x: number; y: number; z: number; what: string }[];
  stats: {
    edges: number; nodes: number; strips: number; stations: number; junctions: number; junctionsJ1: number; junctionsJ2: number; zones: number; pairs: number;
    triangles: number; trianglesByMaterial: Record<string, number>; colliderTriangles: number; colliderChunks: number;
    tf2Triangles: number; tf1Triangles: number; surfaceAreaM2: number; piers: number; placements: Record<string, number>;
    lengthM: number;
  };
  ms: Record<string, number>;
}

const endOf = (s: Strip, end: StripEnd): Station => (end === 'start' ? s.st[0] : s.st[s.st.length - 1]) as Station;

export function buildSite(input: SiteInput): SiteResult {
  const ms: Record<string, number> = {};
  let clock = Date.now();
  const lap = (name: string): void => {
    const now = Date.now();
    ms[name] = (ms[name] ?? 0) + now - clock;
    clock = now;
  };
  const t0 = clock;
  const problems: string[] = [];
  const step = input.step ?? 4;
  const graph = buildGraph(input.roads, input.site);
  // a road with no lanes tag that runs straight on into a tagged one takes its lane count (the main line of a split)
  let inherited = 0;
  for (const node of graph.nodes.values()) {
    const cand = splitCandidate(graph, node.id);
    if (!cand) continue;
    const main = cand.branches.find((b) => !(graph.edges[b.edge] as GEdge).link) ?? cand.branches[0];
    const mainEdge = graph.edges[main.edge] as GEdge;
    const parentEdge = graph.edges[cand.parent.edge] as GEdge;
    const mp = (main.atStart ? mainEdge.pieces[0] : mainEdge.pieces[mainEdge.pieces.length - 1]) as GEdge['pieces'][number];
    const pp = (cand.parent.atStart ? parentEdge.pieces[0] : parentEdge.pieces[parentEdge.pieces.length - 1]) as GEdge['pieces'][number];
    if (pp.lanes === null && mp.lanes !== null && parentEdge.cls === mainEdge.cls && parentEdge.link === mainEdge.link) {
      for (const piece of parentEdge.pieces) if (piece.lanes === null) piece.lanes = mp.lanes;
      inherited++;
    }
  }
  const pairs = pairCarriageways(graph);
  const pairedWith = new Map<number, number>();
  for (const [a, b] of pairs) {
    pairedWith.set(a, b);
    pairedWith.set(b, a);
  }
  const heroOf = (e: GEdge): HeroSpec | null => {
    for (const h of input.heroes ?? []) {
      const ways = new Set(h.covers.osmWays.map((w) => `way/${w}`));
      if (e.pieces.every((p) => ways.has(p.way))) return h;
    }
    return null;
  };
  const plans: EdgePlan[] = graph.edges.map((e) => {
    const hero = heroOf(e);
    return {
      edge: e, cs: hero ? e.pieces.map(() => heroCrossSection(hero)) : edgeCrossSections(e, pairedWith.has(e.index)), hero: hero ? hero.id : null,
      t0: 0, t1: e.len, internal: false, paired: pairedWith.get(e.index) ?? null,
    };
  });
  // shift reference lines apart where the map draws two roads closer than their lanes are wide
  const relations: FitRelation[] = [];
  const rightHalf = (p: EdgePlan): number => Math.max(...p.cs.map((cs) => -(csBorders(cs)[cs.lanes.length] as number)));
  const coreOf = (p: EdgePlan): number => Math.max(...p.cs.map((cs) => {
    const [f, l] = coreRange(cs.lanes);
    let w = 0;
    for (let i = f; i <= l; i++) w += (cs.lanes[i] as LaneDef).width;
    return w;
  }));
  for (const [a, b] of pairs) relations.push({ a, b, minSep: rightHalf(plans[a] as EdgePlan) + rightHalf(plans[b] as EdgePlan) + 0.6, wa: 1, wb: 1, kind: 'pair' });
  const movable = new Set<number>();
  let redrawn = 0;
  let redrawnMax = 0;
  for (const node of graph.nodes.values()) {
    const cand = splitCandidate(graph, node.id);
    if (!cand || [cand.parent, ...cand.branches].some((e) => (plans[e.edge] as EdgePlan).hero)) continue;
    movable.add(node.id);
    const [p, q] = cand.branches;
    const ep = graph.edges[p.edge] as GEdge;
    const eq = graph.edges[q.edge] as GEdge;
    // the minor branch is the slip road; of two equals, the one that turns away more
    const turn = (e: GEnd): number => {
      const c = outward(graph.edges[e.edge] as GEdge, e.atStart);
      const par = outward(graph.edges[cand.parent.edge] as GEdge, cand.parent.atStart).smoothAt(0, 6);
      const pt = c.at(Math.min(15, c.length * 0.5));
      const len = Math.hypot(pt.x - node.x, pt.z - node.z) || 1;
      return -((pt.x - node.x) * par.tx + (pt.z - node.z) * par.tz) / len;
    };
    const minorIsP = ep.link !== eq.link ? ep.link : turn(p) < turn(q);
    const [minor, main] = minorIsP ? [p, q] : [q, p];
    const ratio = classDefaults((graph.edges[cand.parent.edge] as GEdge).cls).taper * 0.4;
    const moved = limitDivergence(graph.edges[minor.edge] as GEdge, minor.atStart, graph.edges[main.edge] as GEdge, main.atStart, ratio);
    if (moved > 0) {
      redrawn++;
      redrawnMax = Math.max(redrawnMax, moved);
    }
    const minSep = (coreOf(plans[p.edge] as EdgePlan) + coreOf(plans[q.edge] as EdgePlan)) / 2 + NOSE_GAP + 0.3;
    relations.push({ a: minor.edge, b: main.edge, minSep, wa: 1, wb: 0, node: node.id, ramp: 1.5 * ratio * minSep, kind: 'split' });
  }
  // junction nodes stay where they are; a split node and a road end move with their roads
  const fixed = new Set<number>([...graph.nodes.values()].filter((n) => !movable.has(n.id) && n.ends.length >= 2).map((n) => n.id));
  const fit = pushApart(graph, relations, fixed);
  for (const p of plans) p.t1 = p.edge.len; // a shifted line has a new length
  lap('graph');

  // split zones first; a node whose zone does not fit is a plain junction
  const zones: Zone[] = [];
  const splitNodes = new Set<number>();
  const farReserve = (e: GEnd): number => {
    const edge = graph.edges[e.edge] as GEdge;
    const far = graph.nodes.get(e.atStart ? edge.b : edge.a);
    return far && far.ends.length > 1 ? Math.min(18, edge.len * 0.3) : 0;
  };
  for (const node of graph.nodes.values()) {
    const cand = splitCandidate(graph, node.id);
    if (!cand) continue;
    if ([cand.parent, ...cand.branches].some((e) => (plans[e.edge] as EdgePlan).hero)) continue;
    const zone = planSplit(graph, plans, cand, farReserve);
    if (zone) {
      zones.push(zone);
      splitNodes.add(node.id);
    } else problems.push(`node ${node.id}: a ${cand.kind} whose branches are too short to reach the nose; built as a junction`);
  }
  lap('splits');

  // junctions: every other node with two or more ends; nodes joined by a short edge are one junction
  const junctionNodes = [...graph.nodes.values()].filter((n) => n.ends.length >= 2 && !splitNodes.has(n.id) && !n.clipped);
  const cluster = new Map<number, number>();
  for (const n of junctionNodes) cluster.set(n.id, n.id);
  const root = (id: number): number => {
    let r = id;
    while (cluster.get(r) !== r) r = cluster.get(r) as number;
    return r;
  };
  const clusterDist = input.site.clusterDist ?? 30;
  for (const e of graph.edges) {
    if (e.len <= clusterDist && cluster.has(e.a) && cluster.has(e.b) && e.a !== e.b) cluster.set(root(e.a), root(e.b));
  }
  const groups = new Map<number, number[]>();
  for (const n of junctionNodes) {
    const r = root(n.id);
    const list = groups.get(r);
    if (list) list.push(n.id);
    else groups.set(r, [n.id]);
  }
  const junctionPlans: JunctionPlan[] = [];
  for (const ids of [...groups.values()].sort((a, b) => (a[0] as number) - (b[0] as number))) {
    const inside = new Set(ids);
    const ends: GEnd[] = [];
    for (const id of ids) {
      for (const end of (graph.nodes.get(id) as { ends: GEnd[] }).ends) {
        const e = graph.edges[end.edge] as GEdge;
        if (inside.has(e.a) && inside.has(e.b) && e.len <= clusterDist) (plans[end.edge] as EdgePlan).internal = true;
        else ends.push(end);
      }
    }
    if (ends.length === 0) continue;
    junctionPlans.push(planJunction(graph, plans, `j${junctionPlans.length}_${ids[0]}`, ids, ends));
  }
  lap('junctions');

  // strips
  const strips: Strip[] = [];
  const joints: Joint[] = [];
  interface Built { first: number; last: number; startLanes: number[]; endLanes: number[] }
  const built = new Map<number, Built>();
  for (const plan of plans) {
    if (plan.internal) continue;
    if (plan.t1 - plan.t0 < 1) {
      problems.push(`${plan.edge.id}: nothing left between its junctions and zones (${(plan.t1 - plan.t0).toFixed(1)} m of ${plan.edge.len.toFixed(1)} m): no surface`);
      continue;
    }
    const es = buildEdgeStrips(plan, step);
    if (es.strips.length === 0) continue;
    const base = strips.length;
    strips.push(...es.strips);
    for (const j of es.joints) joints.push({ ...j, a: { strip: j.a.strip + base, end: j.a.end }, b: { strip: j.b.strip + base, end: j.b.end } });
    built.set(plan.edge.index, { first: base, last: strips.length - 1, startLanes: es.startLanes, endLanes: es.endLanes });
  }
  const stripAt = (e: GEnd): { strip: number; end: StripEnd; lanes: number[] } | null => {
    const b = built.get(e.edge);
    if (!b) return null;
    return e.atStart ? { strip: b.first, end: 'start', lanes: b.startLanes } : { strip: b.last, end: 'end', lanes: b.endLanes };
  };
  for (const z of zones) {
    const zi = strips.length;
    strips.push(z.strip);
    const p = stripAt(z.parent);
    if (p) {
      // the parent's target cross-section, in the parent's own orientation: mirrored when it leaves the node
      const lanes: [number, number][] = [];
      for (let j = 0; j < z.targetCount; j++) {
        const own = z.parent.atStart ? z.targetCount - 1 - j : j;
        const sl = p.lanes[own];
        if (sl !== undefined && sl >= 0) lanes.push([z.targetToZone[j] as number, sl]);
      }
      joints.push({ a: { strip: zi, end: 'start' }, b: { strip: p.strip, end: p.end }, lanes, kind: 'split' });
    }
    for (const [branch, first, count] of [[z.left, z.leftFirst, z.leftCount], [z.right, z.rightFirst, z.rightCount]] as [GEnd, number, number][]) {
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
  lap('strips');

  // heights
  const armsOf = (jp: JunctionPlan): { strip: number; end: StripEnd; lanes: number[]; plan: number }[] => {
    const out: { strip: number; end: StripEnd; lanes: number[]; plan: number }[] = [];
    jp.arms.forEach((a, i) => {
      const s = stripAt(a.end);
      if (s) out.push({ ...s, plan: i });
    });
    return out;
  };
  const liveJunctions = junctionPlans.filter((jp) => armsOf(jp).length === jp.arms.length);
  for (const jp of junctionPlans) if (!liveJunctions.includes(jp)) problems.push(`${jp.id}: an arm has no surface; the junction is left out`);
  const stripPairs: [number, number][] = [];
  for (const [a, b] of pairs) {
    const ba = built.get(a);
    const bb = built.get(b);
    if (!ba || !bb) continue;
    for (let i = ba.first; i <= ba.last; i++) for (let j = bb.first; j <= bb.last; j++) stripPairs.push([i, j]);
  }
  const solved = solveElevation({
    strips, joints, pairs: stripPairs, ground: input.ground,
    junctions: liveJunctions.map((jp) => {
      const arms = armsOf(jp);
      const reach = Math.max(...arms.map((a) => {
        const st = endOf(strips[a.strip] as Strip, a.end);
        return Math.hypot(st.x - jp.centre.x, st.z - jp.centre.z) + Math.max(Math.abs(st.b[0] as number), Math.abs(st.b[st.b.length - 1] as number));
      }));
      return { centre: jp.centre, radius: reach, arms: arms.map((a) => ({ strip: a.strip, end: a.end })), layer: Math.min(...arms.map((a) => endOf(strips[a.strip] as Strip, a.end).layer)) };
    }),
  });
  const abut = markStructures(strips, joints);
  lap('heights');

  // junction surfaces from the exact strip vertices
  const junctions: Junction[] = liveJunctions.map((jp, ji) => {
    const arms = armsOf(jp);
    const hc = solved.junctionHeights[ji] as number;
    const armStation = (i: number): Station => endOf(strips[(arms[i] as { strip: number }).strip] as Strip, (arms[i] as { end: StripEnd }).end);
    const cutVertex = (i: number, border: number): P2 => {
      const a = arms[i] as { strip: number; end: StripEnd; lanes: number[] };
      const ap = jp.arms[i] as JunctionPlan['arms'][number];
      const n = ap.cs.lanes.length;
      // the plan's borders look away from the junction; the strip's own order is the edge's
      const kb = ap.end.atStart ? border : n - border;
      const idx = kb < n ? (a.lanes[kb] as number) : (a.lanes[n - 1] as number) + 1;
      return borderPoint(armStation(i), idx);
    };
    const resolve = (items: readonly RingItem[], raise: number): { ring: V3[]; outer: boolean[] } => {
      const ring: V3[] = [];
      const outer: boolean[] = [];
      items.forEach((it) => {
        let v: V3;
        let isOuter = false;
        if (it.kind === 'cut') {
          const p = cutVertex(it.arm, it.border);
          v = { x: p.x, y: armStation(it.arm).h + raise, z: p.z };
          isOuter = it.border === 0 || it.border === (jp.arms[it.arm] as JunctionPlan['arms'][number]).borders.length - 1;
        } else {
          const n = jp.arms.length;
          v = { x: it.x, y: lerp(armStation(it.corner).h, armStation((it.corner + 1) % n).h, it.frac) + raise, z: it.z };
        }
        const last = ring[ring.length - 1];
        if (last && Math.hypot(last.x - v.x, last.z - v.z) < 1e-6) return;
        ring.push(v);
        outer.push(isOuter);
      });
      if (ring.length > 1 && Math.hypot((ring[0] as V3).x - (ring[ring.length - 1] as V3).x, (ring[0] as V3).z - (ring[ring.length - 1] as V3).z) < 1e-6) {
        ring.pop();
        outer.pop();
      }
      return { ring, outer };
    };
    const ring = resolve(jp.ring, 0).ring;
    const bands: JunctionBand[] = [];
    for (const b of jp.bands) {
      // which ring points lie on the outer edge: the free points after the inner path, and the arms' outer cut vertices
      const ringB: V3[] = [];
      const outer: boolean[] = [];
      b.ring.forEach((it, k) => {
        const one = resolve([it], KERB_RAISE);
        const v = one.ring[0] as V3;
        const last = ringB[ringB.length - 1];
        if (last && Math.hypot(last.x - v.x, last.z - v.z) < 1e-6) return;
        ringB.push(v);
        outer.push(it.kind === 'pt' ? k >= b.inner : (one.outer[0] as boolean));
      });
      if (ringB.length > 1 && Math.hypot((ringB[0] as V3).x - (ringB[ringB.length - 1] as V3).x, (ringB[0] as V3).z - (ringB[ringB.length - 1] as V3).z) < 1e-6) {
        ringB.pop();
        outer.pop();
      }
      if (ringB.length < 3 || selfCrossing(ringB)) {
        problems.push(`${jp.id}: a corner band crosses itself and was left out`);
        continue;
      }
      const skirt = b.skirt && b.skirt.length === ringB.length ? b.skirt.slice() : ringB.map((_, k) => !((outer[k] as boolean) && (outer[(k + 1) % ringB.length] as boolean)));
      bands.push({ ring: ringB, inner: b.inner, raise: KERB_RAISE, skirt });
    }
    // connecting lanes: every lane that arrives gets a lane on every other arm that leaves
    const connections: Junction['connections'] = [];
    const lanesOf = (a: { strip: number; end: StripEnd }, arriving: boolean): number[] => {
      const s = strips[a.strip] as Strip;
      const towards = a.end === 'end' ? 1 : -1;
      return s.lanes.map((l, k) => ({ l, k })).filter(({ l }) => l.type === 'drive' && (l.dir === 0 || (l.dir === towards) === arriving)).map(({ k }) => k);
    };
    for (const from of arms) {
      const ins = lanesOf(from, true);
      for (const to of arms) {
        if (to === from) continue;
        const outs = lanesOf(to, false);
        if (outs.length === 0) continue;
        ins.forEach((k, i) => connections.push({ from: [from.strip, k], to: [to.strip, outs[Math.min(outs.length - 1, Math.round((i / Math.max(1, ins.length - 1)) * (outs.length - 1)))] as number] }));
        // every lane that leaves is reached by some lane that arrives
        outs.forEach((k, i) => {
          if (ins.length && !connections.some((c) => c.to[0] === to.strip && c.to[1] === k && c.from[0] === from.strip)) connections.push({ from: [from.strip, ins[Math.min(ins.length - 1, i)] as number], to: [to.strip, k] });
        });
      }
    }
    return {
      id: jp.id, nodes: jp.nodes, centre: jp.centre, h: hc, arms: arms.map((a) => ({ strip: a.strip, end: a.end, cut: (jp.arms[a.plan] as { cut: number }).cut })), method: jp.method, ring, bands,
      corners: jp.corners.map((c) => ({ radius: Math.round(c.radius * 100) / 100, kind: c.kind })), connections, ...(jp.why ? { why: jp.why } : {}),
    };
  });
  lap('junctionSurfaces');

  // meshes
  const { surf, set, forced: forcedSurface } = buildSurfaces(strips, junctions);
  if (forcedSurface > 0) problems.push(`${forcedSurface} forced ear(s) in junction surfaces or corner bands: a ring that touches itself`);
  buildMarkings(strips, set);
  const grid = new TriGrid<SurfTri>(6);
  for (const t of surf) grid.add(t);
  const piers = buildPiers(strips, grid, set);
  const placements: Placement[] = [];
  const placementCounts: Record<string, number> = {};
  const heroChecks: HeroCheck[] = [];
  for (const h of input.heroes ?? []) {
    const f = buildHeroFurniture(h, strips, set);
    placements.push(...f.placements);
    Object.assign(placementCounts, f.counts);
    const check = checkHero(h, strips);
    for (const [name, sp] of Object.entries(f.spacing)) {
      check.fieldsCompared++;
      // a line is spread evenly over each strip: the baked spacing may differ from the spec by the rounding per strip
      if (Math.abs(sp.baked - sp.spec) / sp.spec > 0.15) {
        check.mismatches++;
        check.list.push(`${name}: one every ${sp.baked} m, the spec says ${sp.spec} m`);
      }
    }
    heroChecks.push(check);
  }
  lap('meshes');

  // terrain
  const siteRing = regionRing(input.site.region, 30);
  const boundary = surfaceBoundary(surf);
  lap('boundary');
  const terrain = input.terrain !== false;
  const noGap: GapStats = { samples: 0, maxM: 0, meanM: 0, p95M: 0, missing: 0, pokeThrough: 0, pokeMaxM: 0, worst: null };
  const tf2 = terrain ? buildTf2(boundary, siteRing, input.ground) : { tris: [], polygons: 0, needles: 0, forced: 0, areaError: 0 };
  if (terrain) {
    const groundMesh = set.get('ground');
    // one normal for the whole ground: the ear clipped triangles are long needles and their own normals would show as streaks
    for (const t of tf2.tris) groundMesh.tri(t[0], t[1], t[2], [0, 1, 0]);
  }
  const gap2 = terrain ? gapTf2(boundary, tf2) : noGap;
  lap('tf2');
  const tf1 = terrain ? buildTf1(surf, boundary, siteRing, input.ground) : { gap: noGap, triangles: 0 };
  lap('tf1');

  // checks
  const name = (piece: number): string => (piece < strips.length ? (strips[piece] as Strip).id : (junctions[piece - strips.length] as Junction).id);
  const siteEnds = new Set<string>();
  for (const node of graph.nodes.values()) {
    if (node.ends.length !== 1) continue;
    const s = stripAt(node.ends[0] as GEnd);
    if (s) siteEnds.add(`${s.strip}:${s.end}`);
  }
  const overlap = checkOverlap(surf, name);
  lap('overlapCheck');
  const continuity = checkContinuity(strips, joints, junctions, siteEnds);
  const tapers = checkTapers(strips);
  const heights = checkHeights(strips, junctions, abut);

  // the tile: vertices relative to its own origin
  const minX = Math.min(...siteRing.map((p) => p.x));
  const minZ = Math.min(...siteRing.map((p) => p.z));
  const maxX = Math.max(...siteRing.map((p) => p.x));
  const maxZ = Math.max(...siteRing.map((p) => p.z));
  let minY = Infinity;
  for (const s of strips) for (const st of s.st) minY = Math.min(minY, st.h, st.g);
  for (const p of siteRing) minY = Math.min(minY, input.ground(p.x, p.z));
  const origin: [number, number, number] = [Math.floor(minX), Math.floor(minY) - 2, Math.floor(minZ)];
  const meshes: MeshData[] = set.meshes().map((m) => ({ ...m, pos: m.pos.map((v, i) => v - (origin[i % 3] as number)) }));
  const colliders = colliderChunks(meshes, ['road', 'parking', 'gore', 'kerb', 'footpath', 'planter', 'median', 'wall', 'ground', 'pier', 'hedge', 'colonnade', 'railing']);
  const local: Placement[] = placements.map((p) => ({ module: p.module, xforms: p.xforms.map((v, i) => (i % 4 === 3 ? v - (origin[((i % 12) - 3) / 4] as number) : v)) }));
  const tile: TileContent = { district: input.site.id, tx: 0, tz: 0, size: Math.ceil(Math.max(maxX - minX, maxZ - minZ)), origin, meshes, colliders, placements: local };
  const colliderCheck = checkEdgeColliders(strips, colliders.map((c) => c.faces), origin);
  lap('tile');

  const trianglesByMaterial: Record<string, number> = {};
  for (const m of meshes) trianglesByMaterial[m.material] = m.idx.length / 3;
  let lengthM = 0;
  let stations = 0;
  for (const s of strips) {
    stations += s.st.length;
    for (let i = 1; i < s.st.length; i++) lengthM += Math.hypot((s.st[i] as Station).x - (s.st[i - 1] as Station).x, (s.st[i] as Station).z - (s.st[i - 1] as Station).z);
  }
  // probe points for the scene: the drawn height at lane centres, for a ray down against the collider
  const probes: SiteResult['probes'] = [];
  strips.forEach((s, si) => {
    if (si % 3 !== 0 || s.st.length < 3) return;
    const st = s.st[Math.floor(s.st.length / 2)] as Station;
    const k = s.lanes.findIndex((l: LaneDef) => l.type === 'drive');
    if (k < 0 || (st.b[k] as number) - (st.b[k + 1] as number) < 1) return;
    const lat = ((st.b[k] as number) + (st.b[k + 1] as number)) / 2;
    probes.push({ x: st.x + st.nx * lat, y: st.h, z: st.z + st.nz * lat, what: `${s.id} lane ${k}${st.structure ? ' (structure)' : ''}` });
  });
  for (const j of junctions) {
    const hits = grid.heightsAt(j.centre.x, j.centre.z).filter((h) => (grid.tris[h.id] as SurfTri).piece >= strips.length);
    if (hits.length) probes.push({ x: j.centre.x, y: (hits[0] as { y: number }).y, z: j.centre.z, what: `${j.id} centre` });
  }
  ms['total'] = Date.now() - t0;
  return {
    site: input.site, graph, strips, joints, junctions, zones, pairs, problems, solve: solved.report, fit: { ...fit, lanesInherited: inherited, slipRoadsRedrawn: redrawn, slipRoadMaxMoveM: Math.round(redrawnMax * 100) / 100 },
    abutments: abut.map((a) => ({ strip: (strips[a.strip] as Strip).id, x: Math.round(a.x * 10) / 10, z: Math.round(a.z * 10) / 10, heightAboveGround: Math.round(a.hag * 100) / 100 })),
    checks: {
      overlap, continuity, tapers, heights, groundGap: { tf1: tf1.gap, tf2: gap2 }, hero: heroChecks, colliders: colliderCheck,
      mesh: { openBoundaryEdges: boundary.openEdges, doubledEdges: boundary.doubledEdges, boundaryLoops: boundary.loops.length, groundPolygons: tf2.polygons, forcedEars: tf2.forced, groundAreaErrorM2: Math.round(tf2.areaError * 1000) / 1000, groundNeedles: tf2.needles },
    },
    tile, probes,
    stats: {
      edges: graph.edges.length, nodes: graph.nodes.size, strips: strips.length, stations, junctions: junctions.length, junctionsJ1: junctions.filter((j) => j.method === 'J1').length,
      junctionsJ2: junctions.filter((j) => j.method === 'J2').length, zones: zones.length, pairs: pairs.length,
      triangles: meshes.reduce((s, m) => s + m.idx.length / 3, 0), trianglesByMaterial, colliderTriangles: colliders.reduce((s, c) => s + c.faces.length / 9, 0), colliderChunks: colliders.length,
      tf2Triangles: tf2.tris.length, tf1Triangles: tf1.triangles, surfaceAreaM2: surfaceArea(surf), piers, placements: placementCounts, lengthM: Math.round(lengthM),
    },
    ms,
  };
}

/** A small record of the lane model for the report and the inspector: what a production file would hold in full. */
export function modelSummary(r: SiteResult): Record<string, unknown> {
  const rd = (v: number, d = 2): number => Math.round(v * 10 ** d) / 10 ** d;
  return {
    format: 'kalesh-lanes-draft-1 (modelled on OpenDRIVE: reference line, lane sections, width functions, junctions, elevation)',
    strips: r.strips.map((s) => ({
      id: s.id, kind: s.kind, cls: s.cls + (s.link ? '_link' : ''), ways: s.ways, hero: s.hero, stations: s.st.length,
      lengthM: rd(Math.abs((s.st[s.st.length - 1] as Station).s - (s.st[0] as Station).s), 1),
      lanes: s.lanes.map((l, k) => ({ type: l.type, dir: l.dir, widthStart: rd(((s.st[0] as Station).b[k] as number) - ((s.st[0] as Station).b[k + 1] as number)), widthEnd: rd(((s.st[s.st.length - 1] as Station).b[k] as number) - ((s.st[s.st.length - 1] as Station).b[k + 1] as number)) })),
      heightStart: rd((s.st[0] as Station).h), heightEnd: rd((s.st[s.st.length - 1] as Station).h), maxAboveGround: rd(Math.max(...s.st.map((st) => st.h - st.g))),
      ...(s.taper ? { taper: { lengthM: rd(s.taper.length, 1), shiftM: rd(s.taper.shift), neededM: rd(s.taper.needed, 1) } } : {}),
    })),
    zones: r.zones.map((z) => ({ id: z.strip.id, kind: z.kind, paintedNoseM: rd(z.dPainted, 1), physicalNoseM: rd(z.dNose, 1), lanes: z.strip.lanes.map((l) => l.type) })),
    junctions: r.junctions.map((j) => ({ id: j.id, method: j.method, nodes: j.nodes, arms: j.arms.length, ringVertices: j.ring.length, corners: j.corners, bands: j.bands.length, connections: j.connections.length, ...(j.why ? { why: j.why } : {}) })),
    pairs: r.pairs.map(([a, b]) => [(r.graph.edges[a] as GEdge).id, (r.graph.edges[b] as GEdge).id]),
    joints: r.joints.length,
  };
}
