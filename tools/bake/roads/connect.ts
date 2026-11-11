// Connecting lane paths through a junction (P1-012, MAP_REPAIR.md "Lane-level road model": "junctions are objects
// with connecting lanes for every allowed movement"). The turn rules say which arm may reach which; the lane rule says
// from which lane into which (left-hand traffic: a left turn runs kerb lane to kerb lane, a right turn fast lane to
// fast lane, straight on pairs the lanes from the fast side); the path is a fillet arc between the two lane lines, or
// a biarc when they do not cross ahead. Traffic, pursuit and barricades follow these paths. Pure.
//
// Turn rules, in order:
//   1. No turn back into the arm a lane came from.
//   2. One-way rules: a path starts on a lane that arrives and ends on a lane that leaves.
//   3. A turn of more than 135 degrees is only allowed as a U-turn between the two carriageways of one street (a
//      median opening), and only into a lane it can reach on the minimum radius. The rule never closes a road: an arm
//      with no other way out (or in) keeps its least sharp movement.
//   4. Restrictions (from the map or an override): "no" forbids one movement, "only" forbids every other one.
import type { P2 } from '../geom.ts';
import { MIN_TURN_RADIUS_M } from './model.ts';

export interface ArmLane {
  /** The caller's name for the lane (an index into the arm's cross-section). */
  k: number;
  /** Lateral position of the lane centre: positive is left of the arm's outward direction. */
  lat: number;
  width: number;
  /** 1 the lane leaves the junction, -1 it arrives, 0 it does both (the one lane of a narrow street). */
  flow: 1 | -1 | 0;
}

export interface ArmView {
  /** The reference point at the arm's cut line and the unit vector along the arm, away from the junction. */
  x: number;
  z: number;
  ox: number;
  oz: number;
  /** Block graph edge id, and the edges of the street's other carriageway. */
  edge: string;
  paired: readonly string[];
  lanes: ArmLane[];
}

export type TurnKind = 'left' | 'straight' | 'right' | 'u';

export interface TurnRestriction {
  from: string;
  to: string;
  kind: 'no' | 'only';
}

export interface Turn {
  from: number;
  to: number;
  fromLane: number;
  toLane: number;
  kind: TurnKind;
}

export interface PathGeom {
  pts: P2[];
  /** Smallest radius along the path (Infinity for a straight line). */
  radius: number;
  length: number;
  how: 'straight' | 'fillet' | 'biarc';
  /** fillet: the distances from the two ends to the point where the lane lines cross, and the turning angle. */
  a?: number;
  b?: number;
  phi?: number;
}

export interface Pose extends P2 {
  hx: number;
  hz: number;
}

const DEG = Math.PI / 180;
export const HAIRPIN_DEG = 135;
const STRAIGHT_DEG = 30;

/** The pose of a lane at the cut line: where a path starts (arriving) or ends (leaving). */
export function lanePose(arm: ArmView, lane: ArmLane, arriving: boolean): Pose {
  // the left of the outward direction (ox, oz) is (oz, -ox)
  const x = arm.x + arm.oz * lane.lat;
  const z = arm.z - arm.ox * lane.lat;
  return arriving ? { x, z, hx: -arm.ox, hz: -arm.oz } : { x, z, hx: arm.ox, hz: arm.oz };
}

/** Signed angle from heading a to heading b in radians: positive turns left. */
export function turnAngle(ax: number, az: number, bx: number, bz: number): number {
  return Math.atan2(bx * az - bz * ax, ax * bx + az * bz);
}

export function turnKindOf(from: ArmView, to: ArmView): { kind: TurnKind; deg: number } {
  const deg = turnAngle(-from.ox, -from.oz, to.ox, to.oz) / DEG;
  const kind: TurnKind = Math.abs(deg) > HAIRPIN_DEG ? 'u' : deg > STRAIGHT_DEG ? 'left' : deg < -STRAIGHT_DEG ? 'right' : 'straight';
  return { kind, deg };
}

/** Arriving lanes of an arm, kerb side first (the driver's left), and leaving lanes, kerb side first. */
export const arriving = (a: ArmView): ArmLane[] => a.lanes.filter((l) => l.flow <= 0).sort((p, q) => p.lat - q.lat);
export const leaving = (a: ArmView): ArmLane[] => a.lanes.filter((l) => l.flow >= 0).sort((p, q) => q.lat - p.lat);

/** Points of an arc from p, heading (hx, hz), turning by `angle` radians (positive left) on radius r. The start is left out. */
function arc(p: P2, hx: number, hz: number, angle: number, r: number, out: P2[]): { x: number; z: number; hx: number; hz: number } {
  const sign = angle >= 0 ? 1 : -1;
  // the centre lies on the left of the heading for a left turn
  const cx = p.x + hz * r * sign;
  const cz = p.z - hx * r * sign;
  const n = Math.max(2, Math.ceil(Math.abs(angle) / (9 * DEG)));
  let ex = hx;
  let ez = hz;
  for (let k = 1; k <= n; k++) {
    const a = (angle * k) / n;
    // rotate the heading to the left by a: h cos a + left(h) sin a
    ex = hx * Math.cos(a) + hz * Math.sin(a);
    ez = hz * Math.cos(a) - hx * Math.sin(a);
    out.push({ x: cx - ez * r * sign, z: cz + ex * r * sign });
  }
  return { x: (out[out.length - 1] as P2).x, z: (out[out.length - 1] as P2).z, hx: ex, hz: ez };
}

const lengthOf = (pts: readonly P2[]): number => {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot((pts[i] as P2).x - (pts[i - 1] as P2).x, (pts[i] as P2).z - (pts[i - 1] as P2).z);
  return s;
};

/**
 * The path from one lane end to another lane start. Where the two lane lines cross ahead of both, a straight piece,
 * one arc and a straight piece (the arc as large as the shorter side allows); otherwise two arcs that meet on one
 * tangent (a biarc: a lane that shifts sideways, a U-turn).
 */
export function turnPath(p0: Pose, p1: Pose): PathGeom {
  const f = filletPath(p0, p1);
  // a fillet is as tight as its shorter side: where that is tight, two arcs may turn wider
  if (f && f.radius >= 8) return f;
  const b = biarcPath(p0, p1);
  return f && f.radius >= b.radius ? f : b;
}

function filletPath(p0: Pose, p1: Pose): PathGeom | null {
  const dx = p1.x - p0.x;
  const dz = p1.z - p0.z;
  const dist = Math.hypot(dx, dz);
  const dot = Math.max(-1, Math.min(1, p0.hx * p1.hx + p0.hz * p1.hz));
  const theta = turnAngle(p0.hx, p0.hz, p1.hx, p1.hz);
  if (dist < 1e-6) return { pts: [{ x: p0.x, z: p0.z }], radius: Infinity, length: 0, how: 'straight' };
  // straight on: the same heading and no sideways shift
  const side = Math.abs(dx * p0.hz - dz * p0.hx);
  if (Math.abs(theta) < 0.5 * DEG && side < 0.02 && dx * p0.hx + dz * p0.hz > 0) {
    return { pts: [{ x: p0.x, z: p0.z }, { x: p1.x, z: p1.z }], radius: Infinity, length: dist, how: 'straight' };
  }
  const det = p0.hx * p1.hz - p0.hz * p1.hx;
  if (Math.abs(det) > Math.sin(3 * DEG) && Math.abs(theta) < 172 * DEG) {
    const a = (dx * p1.hz - dz * p1.hx) / det;
    const b = (p0.hx * dz - p0.hz * dx) / det;
    if (a > 0.05 && b > 0.05) {
      const phi = Math.acos(dot);
      const t = Math.min(a, b);
      const r = t / Math.tan(phi / 2);
      const pts: P2[] = [{ x: p0.x, z: p0.z }];
      const start = { x: p0.x + p0.hx * (a - t), z: p0.z + p0.hz * (a - t) };
      if (a - t > 1e-3) pts.push(start);
      arc(start, p0.hx, p0.hz, theta, r, pts);
      if (b - t > 1e-3) pts.push({ x: p1.x, z: p1.z });
      else pts[pts.length - 1] = { x: p1.x, z: p1.z };
      return { pts, radius: r, length: lengthOf(pts), how: 'fillet', a, b, phi };
    }
  }
  return null;
}

function biarcPath(p0: Pose, p1: Pose): PathGeom {
  const dx = p1.x - p0.x;
  const dz = p1.z - p0.z;
  const dist = Math.hypot(dx, dz);
  const dot = Math.max(-1, Math.min(1, p0.hx * p1.hx + p0.hz * p1.hz));
  if (dist < 1e-6) return { pts: [{ x: p0.x, z: p0.z }], radius: Infinity, length: 0, how: 'straight' };
  // biarc with equal tangent lengths d at both ends
  const tx = p0.hx + p1.hx;
  const tz = p0.hz + p1.hz;
  const vt = dx * tx + dz * tz;
  const c = 1 - dot;
  let d: number;
  if (c < 1e-9) {
    const along = dx * p0.hx + dz * p0.hz;
    d = along > 1e-9 ? (dist * dist) / (4 * along) : dist / 2;
  } else d = (-vt + Math.sqrt(vt * vt + 2 * c * dist * dist)) / (2 * c);
  const q0 = { x: p0.x + p0.hx * d, z: p0.z + p0.hz * d };
  const q1 = { x: p1.x - p1.hx * d, z: p1.z - p1.hz * d };
  const ml = Math.hypot(q1.x - q0.x, q1.z - q0.z);
  const ux = ml < 1e-9 ? p0.hx : (q1.x - q0.x) / ml;
  const uz = ml < 1e-9 ? p0.hz : (q1.z - q0.z) / ml;
  const a1 = turnAngle(p0.hx, p0.hz, ux, uz);
  const a2 = turnAngle(ux, uz, p1.hx, p1.hz);
  const pts: P2[] = [{ x: p0.x, z: p0.z }];
  let radius = Infinity;
  const mid = { x: (q0.x + q1.x) / 2, z: (q0.z + q1.z) / 2 };
  if (Math.abs(a1) > 0.2 * DEG) {
    const r1 = d / Math.tan(Math.abs(a1) / 2);
    radius = Math.min(radius, r1);
    arc(p0, p0.hx, p0.hz, a1, r1, pts);
    pts[pts.length - 1] = mid;
  } else pts.push(mid);
  if (Math.abs(a2) > 0.2 * DEG) {
    const r2 = d / Math.tan(Math.abs(a2) / 2);
    radius = Math.min(radius, r2);
    arc(mid, ux, uz, a2, r2, pts);
    pts[pts.length - 1] = { x: p1.x, z: p1.z };
  } else pts.push({ x: p1.x, z: p1.z });
  return { pts, radius, length: lengthOf(pts), how: 'biarc' };
}

export interface TurnPlan {
  turns: Turn[];
  /** Arm pairs the turn rules allow (each has at least one turn). */
  pairs: { from: number; to: number; kind: TurnKind }[];
  /** U-turns at a median opening left out because no lane can be reached on the minimum radius. */
  uTurnsTooTight: number;
  /** Movements a restriction took out. */
  restricted: number;
}

/**
 * The turns of one junction. `radiusOf` measures the path between two lanes (used to pick the lane a U-turn ends in).
 * Every arriving lane gets a turn and every leaving lane is reached by one, where the rules leave any movement.
 */
export function planTurns(arms: readonly ArmView[], restrictions: readonly TurnRestriction[] = [], radiusOf: (from: number, fromLane: ArmLane, to: number, toLane: ArmLane) => number = () => Infinity, minRadius = MIN_TURN_RADIUS_M): TurnPlan {
  const out: TurnPlan = { turns: [], pairs: [], uTurnsTooTight: 0, restricted: 0 };
  const ins = arms.map(arriving);
  const outs = arms.map(leaving);
  const seen = new Set<string>();
  const add = (from: number, to: number, a: ArmLane, b: ArmLane, kind: TurnKind): void => {
    const key = `${from}:${a.k}>${to}:${b.k}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.turns.push({ from, to, fromLane: a.k, toLane: b.k, kind });
  };
  const only = new Map<string, Set<string>>();
  const no = new Set<string>();
  for (const r of restrictions) {
    if (r.kind === 'no') no.add(`${r.from}>${r.to}`);
    else {
      const s = only.get(r.from);
      if (s) s.add(r.to);
      else only.set(r.from, new Set([r.to]));
    }
  }
  for (let i = 0; i < arms.length; i++) {
    const a = arms[i] as ArmView;
    const ai = ins[i] as ArmLane[];
    if (ai.length === 0) continue;
    const onlyTo = only.get(a.edge);
    // an "only" restriction counts when its target is an arm of this junction
    const onlyHere = onlyTo && arms.some((b) => onlyTo.has(b.edge)) ? onlyTo : null;
    for (let j = 0; j < arms.length; j++) {
      if (j === i) continue;
      const b = arms[j] as ArmView;
      const bo = outs[j] as ArmLane[];
      if (bo.length === 0 || a.edge === b.edge) continue;
      const { kind } = turnKindOf(a, b);
      if (no.has(`${a.edge}>${b.edge}`) || (onlyHere && !onlyHere.has(b.edge))) {
        out.restricted++;
        continue;
      }
      if (kind === 'u') {
        if (!a.paired.includes(b.edge)) continue;
        // from the lane beside the median into the first lane the minimum radius reaches, trying the nearest first
        const from = ai[ai.length - 1] as ArmLane;
        let done = false;
        for (let k = bo.length - 1; k >= 0 && !done; k--) {
          if (radiusOf(i, from, j, bo[k] as ArmLane) >= minRadius) {
            add(i, j, from, bo[k] as ArmLane, kind);
            done = true;
          }
        }
        if (done) out.pairs.push({ from: i, to: j, kind });
        else out.uTurnsTooTight++;
        continue;
      }
      out.pairs.push({ from: i, to: j, kind });
      if (kind === 'left') add(i, j, ai[0] as ArmLane, bo[0] as ArmLane, kind);
      else if (kind === 'right') add(i, j, ai[ai.length - 1] as ArmLane, bo[bo.length - 1] as ArmLane, kind);
      else {
        // straight on: lanes pair from the fast side; what is left over on the kerb side shares the kerb lane
        const n = Math.max(ai.length, bo.length);
        for (let t = 0; t < n; t++) add(i, j, ai[Math.max(0, ai.length - 1 - t)] as ArmLane, bo[Math.max(0, bo.length - 1 - t)] as ArmLane, kind);
      }
    }
  }
  // rule 3 never closes a road: an arm no movement leaves, or none reaches, gets its least sharp one, however sharp
  const sharp = (i: number, j: number): void => {
    const a = arms[i] as ArmView;
    const b = arms[j] as ArmView;
    const { deg } = turnKindOf(a, b);
    const kind: TurnKind = deg >= 0 ? 'left' : 'right';
    out.pairs.push({ from: i, to: j, kind });
    const ai = ins[i] as ArmLane[];
    const bo = outs[j] as ArmLane[];
    if (kind === 'left') add(i, j, ai[0] as ArmLane, bo[0] as ArmLane, kind);
    else add(i, j, ai[ai.length - 1] as ArmLane, bo[bo.length - 1] as ArmLane, kind);
  };
  const open = (i: number, j: number): boolean => {
    const a = arms[i] as ArmView;
    const b = arms[j] as ArmView;
    const onlyTo = only.get(a.edge);
    const onlyHere = onlyTo && arms.some((x) => onlyTo.has(x.edge)) ? onlyTo : null;
    return i !== j && a.edge !== b.edge && (ins[i] as ArmLane[]).length > 0 && (outs[j] as ArmLane[]).length > 0 && !no.has(`${a.edge}>${b.edge}`) && !(onlyHere && !onlyHere.has(b.edge));
  };
  const least = (list: number[], deg: (k: number) => number): number | null => {
    let best: number | null = null;
    for (const k of list) if (best === null || Math.abs(deg(k)) < Math.abs(deg(best)) - 1e-9) best = k;
    return best;
  };
  const all = arms.map((_, k) => k);
  for (let i = 0; i < arms.length; i++) {
    if ((ins[i] as ArmLane[]).length > 0 && !out.pairs.some((p) => p.from === i)) {
      const j = least(all.filter((k) => open(i, k)), (k) => turnKindOf(arms[i] as ArmView, arms[k] as ArmView).deg);
      if (j !== null) sharp(i, j);
    }
  }
  for (let j = 0; j < arms.length; j++) {
    if ((outs[j] as ArmLane[]).length > 0 && !out.pairs.some((p) => p.to === j)) {
      const i = least(all.filter((k) => open(k, j)), (k) => turnKindOf(arms[k] as ArmView, arms[j] as ArmView).deg);
      if (i !== null) sharp(i, j);
    }
  }
  // every arriving lane goes somewhere, every leaving lane is reached: along the straightest movement the rules allow
  const straightest = (list: { from: number; to: number; kind: TurnKind }[]): { from: number; to: number; kind: TurnKind } | null => {
    let best: { from: number; to: number; kind: TurnKind } | null = null;
    let bestDeg = Infinity;
    for (const p of list) {
      if (p.kind === 'u') continue;
      const d = Math.abs(turnKindOf(arms[p.from] as ArmView, arms[p.to] as ArmView).deg);
      if (d < bestDeg) {
        best = p;
        bestDeg = d;
      }
    }
    return best;
  };
  const nearest = (list: readonly ArmLane[], share: number): ArmLane => list[Math.min(list.length - 1, Math.max(0, Math.round(share * (list.length - 1))))] as ArmLane;
  for (let i = 0; i < arms.length; i++) {
    const ai = ins[i] as ArmLane[];
    ai.forEach((l, idx) => {
      if (out.turns.some((t) => t.from === i && t.fromLane === l.k)) return;
      const p = straightest(out.pairs.filter((q) => q.from === i));
      if (!p) return;
      add(i, p.to, l, nearest(outs[p.to] as ArmLane[], ai.length > 1 ? idx / (ai.length - 1) : 0), p.kind);
    });
    const bo = outs[i] as ArmLane[];
    bo.forEach((l, idx) => {
      if (out.turns.some((t) => t.to === i && t.toLane === l.k)) return;
      const p = straightest(out.pairs.filter((q) => q.to === i));
      if (!p) return;
      add(p.from, i, nearest(ins[p.from] as ArmLane[], bo.length > 1 ? idx / (bo.length - 1) : 0), l, p.kind);
    });
  }
  return out;
}
