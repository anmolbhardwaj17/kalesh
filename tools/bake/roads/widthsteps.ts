// Road width continuity (P1-046, the owner 2026-11-13: "Road is thick, then immediately it's small"). A road keeps one
// cross section along a corridor: the same name, or the same class, through a junction, collinear within 20 degrees.
// Where its carriageway width changes it does so over a taper, never as a step. This module measures that on the
// finished lane model: a width step is a change of the carriageway (the flush lanes between the kerbs) of more than
// 1 m within 5 m along a corridor that is not inside a taper strip. Three places can hold one: along a strip, at a
// joint between two strips, and across a junction between the arms of one corridor (the junction surface between
// two arms is a few metres long, so a different width on the far side reads as a step). Arms of the two one-way
// carriageways of one street that leave a junction side by side count as one side (their widths add up). A roundabout's
// ring runs on only into its own ring: a road that enters it is not its corridor. Pure.
import { coreRange } from './model.ts';
import type { LaneDef, Station, Strip, StripEnd } from './model.ts';
import type { LaneJunction } from './netctx.ts';
import type { Joint } from './model.ts';

/** A change of more than this (m) ... */
export const STEP_M = 1;
/** ... within this distance along the corridor (m) is a step. */
export const STEP_WITHIN_M = 5;
/** Arms run on into each other when they leave a junction within this many degrees of straight on. */
export const CORRIDOR_DEG = 20;
const COS_CORRIDOR = Math.cos((CORRIDOR_DEG * Math.PI) / 180);
/** Two one-way arms side by side (the carriageways of one street) are at most this far apart at the junction (m). */
const SIDE_GAP_M = 45;

const r2 = (v: number): number => Math.round(v * 100) / 100 + 0;

/** Width of the carriageway of a station: from the left border of the first flush lane to the right border of the last. */
export function carriagewayWidth(lanes: readonly LaneDef[], b: readonly number[]): number {
  if (!lanes.some((l) => l.type === 'drive')) return 0;
  const [f, l] = coreRange(lanes);
  return (b[f] as number) - (b[l + 1] as number);
}

const endStation = (s: Strip, end: StripEnd): Station => (end === 'start' ? s.st[0] : s.st[s.st.length - 1]) as Station;

/** Unit direction away from the strip end, over its first 12 m. */
export function awayFrom(s: Strip, end: StripEnd): { x: number; z: number } {
  const st = end === 'start' ? s.st : s.st.slice().reverse();
  const p = st[0] as Station;
  let q = st[st.length - 1] as Station;
  let acc = 0;
  for (let i = 1; i < st.length; i++) {
    acc += Math.hypot((st[i] as Station).x - (st[i - 1] as Station).x, (st[i] as Station).z - (st[i - 1] as Station).z);
    if (acc >= 12) {
      q = st[i] as Station;
      break;
    }
  }
  const l = Math.hypot(q.x - p.x, q.z - p.z) || 1;
  return { x: (q.x - p.x) / l, z: (q.z - p.z) / l };
}

export interface ArmInfo {
  arm: number;
  strip: number;
  end: StripEnd;
  edge: string;
  name: string;
  cls: string;
  link: boolean;
  /** Every drive lane runs one way. */
  oneway: boolean;
  /** One-way arms: traffic runs into the junction or out of it. */
  flow: 'in' | 'out' | 'both';
  /** The arm is part of a roundabout's ring: a ring runs on only into its own ring, never into a road that enters it. */
  ring: boolean;
  drive: number;
  width: number;
  /** Where the arm meets the junction, and the reference point's left at the end (looking away from the junction). */
  x: number;
  z: number;
  d: { x: number; z: number };
}

export function armInfo(strips: readonly Strip[], j: LaneJunction, k: number, ring?: (edge: string) => boolean): ArmInfo | null {
  const a = j.arms[k];
  if (!a) return null;
  const s = strips[a.strip];
  if (!s || s.kind === 'zone') return null;
  const st = endStation(s, a.end);
  const drive = s.lanes.filter((l) => l.type === 'drive');
  if (drive.length === 0) return null;
  const dir = (drive[0] as LaneDef).dir;
  const oneway = drive.every((l) => l.dir === dir) && dir !== 0;
  const flow = !oneway ? 'both' : (dir === 1) === (a.end === 'end') ? 'in' : 'out';
  return { arm: k, strip: a.strip, end: a.end, edge: s.edge, name: s.name, cls: s.cls, link: s.link, oneway, flow, ring: ring ? ring(s.edge) : false, drive: drive.length, width: carriagewayWidth(s.lanes, st.b), x: st.x, z: st.z, d: awayFrom(s, a.end) };
}

/** One corridor: the same name, or the same class (and link flag). */
export const sameCorridor = (p: Pick<ArmInfo, 'name' | 'cls' | 'link' | 'ring'>, q: Pick<ArmInfo, 'name' | 'cls' | 'link' | 'ring'>): boolean =>
  p.ring === q.ring && ((p.name !== '' && p.name === q.name) || (p.cls === q.cls && p.link === q.link));

export interface Side {
  arms: ArmInfo[];
  d: { x: number; z: number };
  width: number;
  drive: number;
}

/** Whether a graph edge is part of a roundabout's ring, from the lane model's source edges. */
export function ringOf(source: readonly { id: string; roundabout?: boolean }[]): (edge: string) => boolean {
  const ring = new Set(source.filter((e) => e.roundabout).map((e) => e.id));
  return (edge) => ring.has(edge);
}

/** Whether two graph edges are the two carriageways of one street (GraphEdge.pairedWith), from the lane model's source edges. */
export function pairedOf(source: readonly { id: string; pairedWith: readonly string[] }[]): (a: string, b: string) => boolean {
  const pairs = new Set<string>();
  for (const e of source) for (const p of e.pairedWith) pairs.add(`${e.id}|${p}`);
  return (a, b) => pairs.has(`${a}|${b}`);
}

/**
 * Arms grouped into sides: one arm, or the one-way carriageways of one street leaving side by side (paired in the
 * graph when `paired` is given: a slip road of the same name beside them is a side of its own).
 */
export function junctionSides(arms: readonly ArmInfo[], paired?: (a: string, b: string) => boolean): Side[] {
  const sides: Side[] = [];
  for (const a of arms) {
    const s = a.oneway
      ? sides.find((g) => {
          const b = g.arms[0] as ArmInfo;
          return b.oneway && b.name === a.name && b.cls === a.cls && b.link === a.link && g.d.x * a.d.x + g.d.z * a.d.z > COS_CORRIDOR && g.arms.every((c) => Math.hypot(c.x - a.x, c.z - a.z) < SIDE_GAP_M && (!paired || paired(c.edge, a.edge)));
        })
      : undefined;
    if (s) s.arms.push(a);
    else sides.push({ arms: [a], d: a.d, width: 0, drive: 0 });
  }
  for (const s of sides) {
    s.width = s.arms.reduce((t, a) => t + a.width, 0);
    s.drive = s.arms.reduce((t, a) => t + a.drive, 0);
  }
  return sides;
}

/**
 * A one-way road against the two carriageways of a street: traffic runs on into the carriageway that carries it on (in
 * against out), so that carriageway alone is what the road meets.
 */
export function effectiveSides(P: Side, Q: Side): [Side, Side] {
  for (const [one, two, flip] of [[P, Q, false], [Q, P, true]] as const) {
    const a = one.arms[0] as ArmInfo;
    if (one.arms.length !== 1 || two.arms.length < 2 || !a.oneway) continue;
    const on = two.arms.filter((b) => b.oneway && b.flow !== a.flow);
    if (on.length !== 1) continue;
    const b = on[0] as ArmInfo;
    const side: Side = { arms: [b], d: b.d, width: b.width, drive: b.drive };
    return flip ? [side, one] : [one, side];
  }
  return [P, Q];
}

/** Sides of a junction that run on into each other: opposite within 20 degrees and one corridor (each side once, the straightest pair first). */
export function corridorPairs(sides: readonly Side[]): [Side, Side][] {
  const cands: { p: number; q: number; dot: number }[] = [];
  for (let p = 0; p < sides.length; p++) {
    for (let q = p + 1; q < sides.length; q++) {
      const P = sides[p] as Side;
      const Q = sides[q] as Side;
      const dot = P.d.x * Q.d.x + P.d.z * Q.d.z;
      if (dot > -COS_CORRIDOR) continue;
      if (!P.arms.some((a) => Q.arms.some((b) => sameCorridor(a, b)))) continue;
      cands.push({ p, q, dot });
    }
  }
  cands.sort((u, v) => u.dot - v.dot || u.p - v.p || u.q - v.q);
  const used = new Set<number>();
  const out: [Side, Side][] = [];
  for (const c of cands) {
    if (used.has(c.p) || used.has(c.q)) continue;
    used.add(c.p).add(c.q);
    out.push(effectiveSides(sides[c.p] as Side, sides[c.q] as Side));
  }
  return out;
}

export interface WidthStep {
  kind: 'strip' | 'joint' | 'junction';
  /** The strip, the joint (a|b) or the junction id. */
  where: string;
  x: number;
  z: number;
  /** Carriageway width (m) on the two sides of the step. */
  fromM: number;
  toM: number;
  stepM: number;
  /** Strips on each side (a junction: the arms of each side). */
  a: string[];
  b: string[];
  names: string[];
  classes: string[];
}

export interface WidthStepCheck {
  steps: number;
  byKind: Record<string, number>;
  /** Corridors checked across junctions (pairs of sides). */
  corridors: number;
  /** Taper strips (width changes that are allowed). */
  tapers: number;
  list: WidthStep[];
}

/** Every width step of a lane model. Zone strips are left out (their width grows with the gore by design). */
export function checkWidthSteps(strips: readonly Strip[], joints: readonly Joint[], junctions: readonly LaneJunction[], paired?: (a: string, b: string) => boolean, ring?: (edge: string) => boolean): WidthStepCheck {
  const list: WidthStep[] = [];
  let tapers = 0;
  for (const s of strips) {
    if (s.kind === 'taper') tapers++;
    if (s.kind !== 'road' || !s.lanes.some((l) => l.type === 'drive')) continue;
    // along the strip: any two stations within 5 m
    let found = false;
    for (let i = 0; i < s.st.length && !found; i++) {
      const p = s.st[i] as Station;
      const wp = carriagewayWidth(s.lanes, p.b);
      let along = 0;
      for (let k = i + 1; k < s.st.length; k++) {
        along += Math.hypot((s.st[k] as Station).x - (s.st[k - 1] as Station).x, (s.st[k] as Station).z - (s.st[k - 1] as Station).z);
        if (along > STEP_WITHIN_M) break;
        const wq = carriagewayWidth(s.lanes, (s.st[k] as Station).b);
        if (Math.abs(wq - wp) > STEP_M) {
          list.push({ kind: 'strip', where: s.id, x: r2(p.x), z: r2(p.z), fromM: r2(wp), toM: r2(wq), stepM: r2(Math.abs(wq - wp)), a: [s.id], b: [s.id], names: [s.name], classes: [s.cls] });
          found = true;
          break;
        }
      }
    }
  }
  for (const j of joints) {
    if (j.kind !== 'section') continue;
    const A = strips[j.a.strip];
    const B = strips[j.b.strip];
    if (!A || !B || A.kind === 'zone' || B.kind === 'zone') continue;
    const sa = endStation(A, j.a.end);
    const sb = endStation(B, j.b.end);
    const wa = carriagewayWidth(A.lanes, sa.b);
    const wb = carriagewayWidth(B.lanes, sb.b);
    if (Math.abs(wa - wb) > STEP_M) list.push({ kind: 'joint', where: `${A.id}|${B.id}`, x: r2(sa.x), z: r2(sa.z), fromM: r2(wa), toM: r2(wb), stepM: r2(Math.abs(wa - wb)), a: [A.id], b: [B.id], names: [A.name, B.name], classes: [A.cls, B.cls] });
  }
  let corridors = 0;
  for (const j of junctions) {
    const arms: ArmInfo[] = [];
    for (let k = 0; k < j.arms.length; k++) {
      const a = armInfo(strips, j, k, ring);
      if (a) arms.push(a);
    }
    for (const [P, Q] of corridorPairs(junctionSides(arms, paired))) {
      corridors++;
      if (Math.abs(P.width - Q.width) <= STEP_M) continue;
      const a0 = P.arms[0] as ArmInfo;
      list.push({
        kind: 'junction', where: j.id, x: r2(a0.x), z: r2(a0.z), fromM: r2(P.width), toM: r2(Q.width), stepM: r2(Math.abs(P.width - Q.width)),
        a: P.arms.map((a) => (strips[a.strip] as Strip).id), b: Q.arms.map((a) => (strips[a.strip] as Strip).id),
        names: [...new Set([...P.arms, ...Q.arms].map((a) => a.name))], classes: [...new Set([...P.arms, ...Q.arms].map((a) => a.cls))],
      });
    }
  }
  const byKind: Record<string, number> = {};
  for (const s of list) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
  return { steps: list.length, byKind, corridors, tapers, list };
}
