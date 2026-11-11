// Checks of the lane model of a block (P1-012, MAP_REPAIR.md "Lane-level road model" checks and "Verification"):
// lane continuity through every joint, zone and junction with the explained ends; tapers inside the class limits;
// every split zone with its gore and nose, ending on both branches' own centre lines; left-hand traffic; lane widths;
// connecting lane paths and their radius; strips that lie on each other in plan. Each check reads the finished model
// (stations, joints, paths), not the builder's bookkeeping. Pure.
import type { GraphEdge } from '../graph/build.ts';
import { checkContinuity, checkTapers } from './checks.ts';
import type { ContinuityCheck, TaperCheck } from './checks.ts';
import type { GEnd } from './graph.ts';
import { checkHero } from './hero.ts';
import type { HeroCheck, HeroSpec } from './hero.ts';
import { GALI_MIN_LANE_M, MIN_DRIVE_LANE_M, MIN_TURN_RADIUS_M, NOSE_GAP } from './model.ts';
import type { Joint, Junction, LaneDef, Station, Strip, StripEnd } from './model.ts';
import type { LaneBuild } from './network.ts';
import { stripOverlaps } from './overlap.ts';

const r = (v: number, d = 3): number => Math.round(v * 10 ** d) / 10 ** d;
const endOf = (s: Strip, end: StripEnd): Station => (end === 'start' ? s.st[0] : s.st[s.st.length - 1]) as Station;

export interface ZoneCheck {
  zones: number;
  diverges: number;
  merges: number;
  /** Zones whose gore is not closed at the node, or not a nose gap wide at the nose, or has no gore lanes. */
  withoutGoreOrNose: number;
  /** Largest distance between a zone's end and the centre line of a branch (m), and the zones over 0.01 m. */
  maxEndErrorM: number;
  endsOffCentreLine: number;
  noseMinM: number;
  noseMaxM: number;
  list: string[];
}

/** Every zone has a gore that opens from nothing to the nose gap, and ends on both branches' own centre lines. */
export function checkZones(b: LaneBuild): ZoneCheck {
  const out: ZoneCheck = { zones: b.zones.length, diverges: 0, merges: 0, withoutGoreOrNose: 0, maxEndErrorM: 0, endsOffCentreLine: 0, noseMinM: Infinity, noseMaxM: 0, list: [] };
  const note = (t: string): void => {
    if (out.list.length < 12) out.list.push(t);
  };
  b.zones.forEach((z, zi) => {
    if (z.kind === 'diverge') out.diverges++;
    else out.merges++;
    const s = b.strips[b.zoneStrips[zi] as number] as Strip;
    const gore = s.lanes.map((l, k) => ({ l, k })).filter((x) => x.l.type === 'gore').map((x) => x.k);
    const first = s.st[0] as Station;
    const last = s.st[s.st.length - 1] as Station;
    const width = (st: Station): number => (gore.length ? (st.b[gore[0] as number] as number) - (st.b[(gore[gore.length - 1] as number) + 1] as number) : -1);
    out.noseMinM = Math.min(out.noseMinM, z.dNose);
    out.noseMaxM = Math.max(out.noseMaxM, z.dNose);
    if (gore.length !== 3 || Math.abs(width(first)) > 1e-3 || Math.abs(width(last) - NOSE_GAP) > 2e-3 || !(z.dNose > 0) || !(z.dPainted <= z.dNose)) {
      out.withoutGoreOrNose++;
      note(`${s.id}: gore ${r(width(first))} m at the node and ${r(width(last))} m at the nose (${gore.length} gore lanes)`);
    }
    // the centre of each branch's drive lanes at the zone's last station against the branch strip's own reference point
    for (const [branch, from, count] of [[z.left, z.leftFirst, z.leftCount], [z.right, z.rightFirst, z.rightCount]] as [GEnd, number, number][]) {
      const built = b.built.get(branch.edge);
      if (!built) {
        out.endsOffCentreLine++;
        note(`${s.id}: a branch has no strip`);
        continue;
      }
      const drive: number[] = [];
      for (let k = from; k < from + count; k++) if ((s.lanes[k] as LaneDef).type === 'drive') drive.push(k);
      const lat = ((last.b[drive[0] as number] as number) + (last.b[(drive[drive.length - 1] as number) + 1] as number)) / 2;
      const px = last.x + last.nx * lat;
      const pz = last.z + last.nz * lat;
      const own = endOf(b.strips[branch.atStart ? built.first : built.last] as Strip, branch.atStart ? 'start' : 'end');
      const err = Math.hypot(px - own.x, pz - own.z);
      out.maxEndErrorM = Math.max(out.maxEndErrorM, err);
      if (err > 0.01) {
        out.endsOffCentreLine++;
        note(`${s.id}: ends ${r(err)} m from the centre line of ${(b.road.source[branch.edge] as GraphEdge).id}`);
      }
    }
  });
  out.maxEndErrorM = r(out.maxEndErrorM, 5);
  if (!b.zones.length) out.noseMinM = 0;
  out.noseMinM = r(out.noseMinM, 1);
  out.noseMaxM = r(out.noseMaxM, 1);
  return out;
}

export interface TrafficSideCheck {
  twoWayStrips: number;
  /** Two-way strips with a lane against the station order left of a lane that runs with it (right-hand traffic). */
  wrongSide: number;
  /** Carriageways of a pair whose other carriageway lies on their left. */
  pairsOnTheLeft: number;
  list: string[];
}

/** Left-hand traffic: on a two-way strip every lane that runs with the station order lies left of every lane against it. */
export function checkLeftHand(strips: readonly Strip[]): TrafficSideCheck {
  const out: TrafficSideCheck = { twoWayStrips: 0, wrongSide: 0, pairsOnTheLeft: 0, list: [] };
  for (const s of strips) {
    const dirs = s.lanes.filter((l) => l.type === 'drive' && l.dir !== 0).map((l) => l.dir);
    if (!dirs.includes(1) || !dirs.includes(-1)) continue;
    out.twoWayStrips++;
    // lanes are listed left to right: no lane against the order before one with it
    if (dirs.lastIndexOf(1) > dirs.indexOf(-1)) {
      out.wrongSide++;
      if (out.list.length < 12) out.list.push(s.id);
    }
  }
  return out;
}

export interface WidthCheck {
  driveLanes: number;
  galiLanes: number;
  /** Drive lanes narrower than MIN_DRIVE_LANE_M that are not galis, and galis narrower than GALI_MIN_LANE_M. */
  tooNarrow: number;
  narrowestM: number;
  narrowestGaliM: number;
  list: string[];
}

/** Lane widths, measured on the stations of road and zone strips and on the two ends of every taper row that carries a lane there. */
export function checkWidths(strips: readonly Strip[]): WidthCheck {
  const out: WidthCheck = { driveLanes: 0, galiLanes: 0, tooNarrow: 0, narrowestM: Infinity, narrowestGaliM: Infinity, list: [] };
  for (const s of strips) {
    s.lanes.forEach((l, k) => {
      if (l.type !== 'drive') return;
      out.driveLanes++;
      const gali = l.tag === 'gali';
      if (gali) out.galiLanes++;
      const limit = gali ? GALI_MIN_LANE_M : MIN_DRIVE_LANE_M;
      let least = l.width;
      if (s.kind !== 'taper') for (const st of s.st) least = Math.min(least, (st.b[k] as number) - (st.b[k + 1] as number));
      if (gali) out.narrowestGaliM = Math.min(out.narrowestGaliM, least);
      else out.narrowestM = Math.min(out.narrowestM, least);
      if (least < limit - 2e-3) {
        out.tooNarrow++;
        if (out.list.length < 12) out.list.push(`${s.id} lane ${k}: ${r(least)} m${gali ? ' (gali)' : ''}`);
      }
    });
  }
  out.narrowestM = Number.isFinite(out.narrowestM) ? r(out.narrowestM) : 0;
  out.narrowestGaliM = Number.isFinite(out.narrowestGaliM) ? r(out.narrowestGaliM) : 0;
  return out;
}

export interface PathCheck {
  junctions: number;
  /** Arm pairs the turn rules allow, and those with no path or with no path on the minimum radius. */
  pairs: number;
  pairsWithoutPath: number;
  pairsBelowRadius: number;
  paths: number;
  pathsBelowRadius: number;
  minRadiusM: number | null;
  byTurn: Record<string, number>;
  signals: number;
  stopLines: number;
  crossings: number;
  list: string[];
}

/** Every allowed pair of junction arms has a connecting lane path that turns on MIN_TURN_RADIUS_M or more. */
export function checkPaths(b: LaneBuild): PathCheck {
  const out: PathCheck = { junctions: b.junctions.length, pairs: 0, pairsWithoutPath: 0, pairsBelowRadius: 0, paths: 0, pathsBelowRadius: 0, minRadiusM: null, byTurn: {}, signals: 0, stopLines: 0, crossings: 0, list: [] };
  let min = Infinity;
  for (const j of b.junctions) {
    if (j.control === 'signals') out.signals++;
    for (const a of j.arms) {
      const s = b.strips[a.strip] as Strip;
      const towards = a.end === 'end' ? 1 : -1;
      if (s.lanes.some((l) => l.type === 'drive' && (l.dir === 0 || l.dir === towards))) out.stopLines++;
      if (a.crossing) out.crossings++;
    }
    for (const p of j.paths) {
      out.paths++;
      out.byTurn[p.turn] = (out.byTurn[p.turn] ?? 0) + 1;
      const rad = p.radius ?? Infinity;
      min = Math.min(min, rad);
      if (rad < MIN_TURN_RADIUS_M) out.pathsBelowRadius++;
    }
    for (const pair of j.pairs) {
      out.pairs++;
      const of = j.paths.filter((p) => p.fromArm === pair.from && p.toArm === pair.to);
      if (of.length === 0) {
        out.pairsWithoutPath++;
        if (out.list.length < 12) out.list.push(`${j.id}: no path from arm ${pair.from} to arm ${pair.to}`);
      } else if (!of.some((p) => (p.radius ?? Infinity) >= MIN_TURN_RADIUS_M)) {
        out.pairsBelowRadius++;
        if (out.list.length < 12) out.list.push(`${j.id}: arm ${pair.from} to arm ${pair.to} turns on ${Math.max(...of.map((p) => p.radius ?? 0))} m`);
      }
    }
  }
  out.minRadiusM = Number.isFinite(min) ? r(min, 2) : null;
  return out;
}

export interface PlanOverlapCheck {
  /** Area (m2) strips share with other strips on the same level, seen from above, and the pairs of strips involved. */
  areaM2: number;
  pairs: number;
  trianglesTested: number;
  worst: { a: string; b: string; areaM2: number; x: number; z: number }[];
}

/**
 * Strips lying on each other in plan (overlap.ts): quads of two strips on one level that share area. The two quads at
 * a joint share its line and are one surface. Junction surfaces are the mesh builder's.
 */
export function checkPlanOverlap(strips: readonly Strip[], joints: readonly Joint[], only?: (s: Strip) => boolean): PlanOverlapCheck {
  const { overlaps, tested } = stripOverlaps(strips, joints, only);
  const pairs = new Map<string, { area: number; x: number; z: number }>();
  let area = 0;
  for (const o of overlaps) {
    area += o.area;
    const k = `${o.a.strip},${o.b.strip}`;
    const rec = pairs.get(k);
    const x = o.poly.reduce((t, p) => t + p[0], 0) / o.poly.length;
    const z = o.poly.reduce((t, p) => t + p[1], 0) / o.poly.length;
    if (rec) rec.area += o.area;
    else pairs.set(k, { area: o.area, x, z });
  }
  const worst = [...pairs].sort((p, q) => q[1].area - p[1].area || (p[0] < q[0] ? -1 : 1)).slice(0, 8).map(([k, v]) => {
    const [p, q] = k.split(',').map(Number) as [number, number];
    return { a: (strips[p] as Strip).id, b: (strips[q] as Strip).id, areaM2: r(v.area, 2), x: r(v.x, 1), z: r(v.z, 1) };
  });
  return { areaM2: r(area, 2), pairs: pairs.size, trianglesTested: tested, worst };
}

export interface LaneChecks {
  continuity: ContinuityCheck;
  /** Ends that are explained (the road leaves the stage, a dead end, a gate), by kind. */
  explainedEnds: Record<string, number>;
  tapers: TaperCheck & { explained: { strip: string; why: string }[]; unexplained: number };
  zones: ZoneCheck;
  trafficSide: TrafficSideCheck;
  widths: WidthCheck;
  paths: PathCheck;
  hero: HeroCheck[];
  overlap: PlanOverlapCheck | null;
}

/** All checks of a built lane model. `overlap` is left out when asked (it is the slowest). */
export function checkLaneModel(b: LaneBuild, heroes: readonly HeroSpec[] = [], overlap = true): LaneChecks {
  const siteEnds = new Set(b.ends.map((e) => `${e.strip}:${e.end}`));
  // the prototype's continuity check reads junctions as arms and lane connections
  const junctions = b.junctions.map((j) => ({ id: j.id, arms: j.arms.map((a) => ({ strip: a.strip, end: a.end, cut: a.cut })), connections: j.paths.map((p) => ({ from: p.from, to: p.to })) })) as unknown as Junction[];
  const continuity = checkContinuity(b.strips, b.joints, junctions, siteEnds);
  const explainedEnds: Record<string, number> = {};
  for (const e of b.ends) explainedEnds[e.kind] = (explainedEnds[e.kind] ?? 0) + 1;
  const tapers = checkTapers(b.strips);
  const stripEdge = new Map(b.strips.map((s) => [s.id, s.edge]));
  const explained: { strip: string; why: string }[] = [];
  let unexplained = 0;
  for (const t of tapers.list) {
    const info = b.streets.byEdge.get(stripEdge.get(t.strip) ?? '');
    const s = b.strips.find((x) => x.id === t.strip) as Strip;
    const first = s.st[0] as Station;
    const last = s.st[s.st.length - 1] as Station;
    const lanesAt = (st: Station): number => s.lanes.filter((l, k) => l.type === 'drive' && (st.b[k] as number) - (st.b[k + 1] as number) > 0.05).length;
    if (info && (info.gali || info.from === 'width')) explained.push({ strip: t.strip, why: 'a lane narrowed for the buildings beside it cannot take the lane count of the street: it widens over the length it has' });
    else if (lanesAt(first) === lanesAt(last)) explained.push({ strip: t.strip, why: `the lane count stays ${lanesAt(first)}: only lane widths change (${t.shiftM} m over ${t.lengthM} m)` });
    else unexplained++;
  }
  return {
    continuity, explainedEnds, tapers: { ...tapers, explained, unexplained }, zones: checkZones(b), trafficSide: checkLeftHand(b.strips), widths: checkWidths(b.strips), paths: checkPaths(b),
    hero: heroes.map((h) => checkHero(h, b.strips)), overlap: overlap ? checkPlanOverlap(b.strips, b.joints) : null,
  };
}
