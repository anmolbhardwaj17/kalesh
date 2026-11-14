// Checks on the solved heights (P1-013 acceptance), measured on the stations themselves and not on the solver's
// knots: no step where strips meet, every grade and every vertical curve inside its class limit, the clearance at
// every place two levels meet (roads, junctions, railway lines, water, tunnel cover), the crossfall between the two
// carriageways of a street at grade, and the map edge ties. Heights between two stations are read in a straight
// line; the profile itself bows up to a centimetre from that on the tightest curve, so clearances are held to
// CLEARANCE_TOL_M. Pure.
import type { Joint, Station, Strip } from '../roads/model.ts';
import type { ElevationJunction } from './crossings.ts';
import { AT_GRADE_M, CROSSFALL_MAX, DECK_DEPTH, HEADROOM, JUNCTION_SLOPE_MAX, maxGrade, minCurveRadius, RAIL_DECK_DEPTH_M, RAIL_HEADROOM_M, TUNNEL_COVER_M, tunnelGradeCaps, WATER_CLEARANCE_M } from './limits.ts';
import type { ElevationResult } from './solve.ts';

export const CLEARANCE_TOL_M = 0.02;
const GRADE_TOL = 1e-6;
/** A curve is measured over three stations at least this far apart (shorter spans only measure rounding). */
const CURVE_MIN_SPAN_M = 1;

export interface Finding {
  kind: 'step' | 'grade' | 'curve' | 'clearance' | 'crossfall' | 'junction';
  strip: string;
  x: number;
  z: number;
  value: number;
  limit: number;
  why: string;
}

export interface ElevationChecks {
  steps: { joints: number; maxMismatchM: number; junctionArms: number; steepestJunctionPct: number };
  grade: { segments: number; violations: number; steepestPct: number; steepest: { strip: string; gradePct: number; limitPct: number } | null };
  curves: { measured: number; violations: number; tightestRadiusM: number | null; tightest: { strip: string; radiusM: number; limitM: number } | null };
  clearance: {
    /** Pairs of strips of two levels on each other, the stations measured there, and the least headroom under a deck (m). */
    roadCrossings: number;
    roadSamples: number;
    minRoadM: number | null;
    junctionCrossings: number;
    minJunctionM: number | null;
    /** Roads over a railway line (headroom over the rail) and under a railway bridge (headroom over the road). */
    roadOverRail: number;
    minRoadOverRailM: number | null;
    roadUnderRail: number;
    minRoadUnderRailM: number | null;
    waterCrossings: number;
    minOverWaterM: number | null;
    tunnelStations: number;
    minCoverM: number | null;
    violations: number;
  };
  crossfall: { samples: number; limited: number; violations: number; worstPct: number };
  ties: { ends: number; moved: number; maxOffM: number };
  /** Every limit that does not hold, with where and why (empty on a sound map). */
  findings: Finding[];
  ok: boolean;
}

const r = (v: number, d = 3): number => Math.round(v * 10 ** d) / 10 ** d + 0;
const least = (a: number | null, b: number): number => (a === null ? b : Math.min(a, b));

export function checkElevation(strips: readonly Strip[], joints: readonly Joint[], junctions: readonly ElevationJunction[], res: ElevationResult): ElevationChecks {
  const findings: Finding[] = [];
  const find = (kind: Finding['kind'], s: Strip, st: Station, value: number, limit: number, why: string): void => {
    findings.push({ kind, strip: s.id, x: r(st.x, 1), z: r(st.z, 1), value: r(value, 4), limit: r(limit, 4), why });
  };
  const end = (e: { strip: number; end: 'start' | 'end' }): Station => {
    const s = strips[e.strip] as Strip;
    return (e.end === 'start' ? s.st[0] : s.st[s.st.length - 1]) as Station;
  };
  const at = (strip: number, station: number, t: number): number => {
    const st = (strips[strip] as Strip).st;
    const a = st[station] as Station;
    return t > 0 && st[station + 1] ? a.h + ((st[station + 1] as Station).h - a.h) * t : a.h;
  };
  // steps
  let maxStep = 0;
  for (const j of joints) {
    const d = Math.abs(end(j.a).h - end(j.b).h);
    maxStep = Math.max(maxStep, d);
    if (d >= 0.01) find('step', strips[j.a.strip] as Strip, end(j.a), d, 0.01, `the two strips of a ${j.kind} joint differ in height`);
  }
  let arms = 0;
  let steepJunction = 0;
  junctions.forEach((jn, ji) => {
    for (const arm of jn.arms) {
      const st = end(arm);
      const d = Math.max(2, Math.hypot(st.x - jn.centre.x, st.z - jn.centre.z));
      const slope = Math.abs((res.junctionHeights[ji] as number) - st.h) / d;
      arms++;
      steepJunction = Math.max(steepJunction, slope);
      if (slope > JUNCTION_SLOPE_MAX + GRADE_TOL) find('junction', strips[arm.strip] as Strip, st, slope, JUNCTION_SLOPE_MAX, 'the junction surface is steeper than its limit from this arm to the centre');
    }
  });
  // grades and vertical curves, station by station
  const grade: ElevationChecks['grade'] = { segments: 0, violations: 0, steepestPct: 0, steepest: null };
  const curves: ElevationChecks['curves'] = { measured: 0, violations: 0, tightestRadiusM: null, tightest: null };
  let worstCurve = 0;
  const caps = tunnelGradeCaps(strips, joints, res.tunnels);
  for (const [si, s] of strips.entries()) {
    const gMax = Math.min(maxGrade(s.cls, s.link), caps[si] as number);
    const kMax = 1 / minCurveRadius(s.cls, s.link);
    let prevD = 0;
    let prevG = 0;
    for (let i = 0; i + 1 < s.st.length; i++) {
      const a = s.st[i] as Station;
      const b = s.st[i + 1] as Station;
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d < 0.05) continue;
      const g = (b.h - a.h) / d;
      grade.segments++;
      if (Math.abs(g) * 100 > grade.steepestPct) {
        grade.steepestPct = Math.abs(g) * 100;
        grade.steepest = { strip: s.id, gradePct: r(Math.abs(g) * 100), limitPct: r(gMax * 100, 1) };
      }
      if (Math.abs(g) > gMax + GRADE_TOL) {
        grade.violations++;
        find('grade', s, a, Math.abs(g), gMax, 'steeper than the class limit');
      }
      if (prevD >= CURVE_MIN_SPAN_M && d >= CURVE_MIN_SPAN_M) {
        const k = Math.abs(g - prevG) / ((d + prevD) / 2);
        curves.measured++;
        if (k / kMax > worstCurve) {
          worstCurve = k / kMax;
          curves.tightest = { strip: s.id, radiusM: Math.round(1 / Math.max(k, 1e-9)), limitM: Math.round(1 / kMax) };
        }
        if (k > 1e-9) curves.tightestRadiusM = least(curves.tightestRadiusM, Math.round(1 / k));
        if (k > kMax * (1 + 1e-6) + 1e-9) {
          curves.violations++;
          find('curve', s, a, 1 / k, 1 / kMax, 'a vertical curve tighter than the class limit');
        }
      }
      prevD = d;
      prevG = g;
    }
  }
  grade.steepestPct = r(grade.steepestPct);
  // clearances
  const c: ElevationChecks['clearance'] = {
    roadCrossings: res.crossings.roadPairs, roadSamples: res.crossings.roads.length, minRoadM: null, junctionCrossings: res.crossings.junctions.length, minJunctionM: null,
    roadOverRail: 0, minRoadOverRailM: null, roadUnderRail: 0, minRoadUnderRailM: null, waterCrossings: res.crossings.water.length, minOverWaterM: null, tunnelStations: 0, minCoverM: null, violations: 0,
  };
  const need = (clear: number, limit: number, s: Strip, st: Station, why: string): void => {
    if (clear < limit - CLEARANCE_TOL_M) {
      c.violations++;
      find('clearance', s, st, clear, limit, why);
    }
  };
  for (const x of res.crossings.roads) {
    const clear = at(x.up, x.upStation, x.upT) - at(x.low, x.lowStation, x.lowT) - DECK_DEPTH;
    c.minRoadM = least(c.minRoadM, clear);
    need(clear, HEADROOM, strips[x.up] as Strip, (strips[x.up] as Strip).st[x.upStation] as Station, `headroom over ${(strips[x.low] as Strip).name || (strips[x.low] as Strip).id}`);
  }
  for (const x of res.crossings.junctions) {
    for (const i of x.stations) {
      const st = (strips[x.strip] as Strip).st[i] as Station;
      const clear = (x.above ? st.h - (res.junctionHeights[x.junction] as number) : (res.junctionHeights[x.junction] as number) - st.h) - DECK_DEPTH;
      c.minJunctionM = least(c.minJunctionM, clear);
      need(clear, HEADROOM, strips[x.strip] as Strip, st, x.above ? 'headroom over a junction' : 'headroom under a junction on a deck');
    }
  }
  for (const x of res.crossings.rails) {
    const s = strips[x.strip] as Strip;
    const h = at(x.strip, x.station, x.t);
    if (x.roadAbove) {
      c.roadOverRail++;
      c.minRoadOverRailM = least(c.minRoadOverRailM, h - DECK_DEPTH - x.railH);
      need(h - DECK_DEPTH - x.railH, RAIL_HEADROOM_M, s, s.st[x.station] as Station, 'headroom over a railway line');
    } else {
      c.roadUnderRail++;
      c.minRoadUnderRailM = least(c.minRoadUnderRailM, x.railH - RAIL_DECK_DEPTH_M - h);
      need(x.railH - RAIL_DECK_DEPTH_M - h, HEADROOM, s, s.st[x.station] as Station, 'headroom under a railway bridge');
    }
  }
  for (const w of res.crossings.water) {
    const s = strips[w.strip] as Strip;
    for (let i = w.first; i <= w.last; i++) {
      const clear = (s.st[i] as Station).h - DECK_DEPTH - w.level;
      c.minOverWaterM = least(c.minOverWaterM, clear);
      need(clear, WATER_CLEARANCE_M, s, s.st[i] as Station, 'a deck too close to the water under it');
    }
  }
  strips.forEach((s, si) => {
    const t = res.tunnels[si];
    if (!t) return;
    s.st.forEach((st, i) => {
      if (t[i] !== 1) return;
      c.tunnelStations++;
      c.minCoverM = least(c.minCoverM, st.g - st.h);
      need(st.g - st.h, TUNNEL_COVER_M, s, st, 'a tunnel with too little ground over it');
    });
  });
  for (const k of ['minRoadM', 'minJunctionM', 'minRoadOverRailM', 'minRoadUnderRailM', 'minOverWaterM', 'minCoverM'] as const) if (c[k] !== null) c[k] = r(c[k] as number, 2);
  // crossfall between the two carriageways of a street, where both are at grade
  const crossfall: ElevationChecks['crossfall'] = { samples: res.pairSamples.length, limited: 0, violations: 0, worstPct: 0 };
  for (const p of res.pairSamples) {
    const a = (strips[p.a[0]] as Strip).st[p.a[1]] as Station;
    const b = (strips[p.b[0]] as Strip).st[p.b[1]] as Station;
    if (a.bridge || b.bridge || Math.abs(a.h - a.g) > AT_GRADE_M || Math.abs(b.h - b.g) > AT_GRADE_M) continue;
    crossfall.limited++;
    const fall = Math.abs(a.h - b.h) / p.dist;
    crossfall.worstPct = Math.max(crossfall.worstPct, fall * 100);
    if (fall > CROSSFALL_MAX + 1e-4) {
      crossfall.violations++;
      find('crossfall', strips[p.a[0]] as Strip, a, fall, CROSSFALL_MAX, 'the two carriageways of the street differ in height by more than the crossfall limit');
    }
  }
  crossfall.worstPct = r(crossfall.worstPct);
  const off = res.ties.map((t) => Math.abs(t.h - t.target));
  const ties = { ends: res.ties.length, moved: off.filter((d) => d > 0.05).length, maxOffM: r(Math.max(0, ...off)) };
  return {
    steps: { joints: joints.length, maxMismatchM: r(maxStep, 6), junctionArms: arms, steepestJunctionPct: r(steepJunction * 100) }, grade, curves, clearance: c, crossfall, ties, findings,
    ok: findings.length === 0,
  };
}
