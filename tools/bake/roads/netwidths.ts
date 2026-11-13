// Lane model phase 4 (network.ts, P1-046): road width continuity across junctions. After a round is built, every
// corridor through a junction (widthsteps.ts: the same name or class, within 20 degrees of straight on) whose two sides
// differ by more than a metre of carriageway asks for a fix for the next round:
//   1. a taper on one side: that road meets the other side's width at the junction and tapers to its own over the
//      length its class asks for (the narrower side widens; a road whose width its walls set, a gali, stays and the
//      wider side narrows to it instead);
//   2. when neither side has room for its taper, the shorter road takes the other side's cross-section whole.
// The two one-way carriageways of a street that leave side by side are one side: a single road on the other side
// meets their lanes together. Fixes are kept over rounds (NetCtx widthTapers and widthFixed). Pure.
import type { GraphEdge } from '../graph/build.ts';
import { matchRows, rowBorders } from './lanes.ts';
import { stripOverlaps } from './overlap.ts';
import type { EdgePlan, Zone } from './lanes.ts';
import { GALI_MIN_LANE_M, MIN_DRIVE_LANE_M, classDefaults, csBorders, csWidth, lane } from './model.ts';
import type { CrossSection, LaneDef, Strip } from './model.ts';
import type { LaneBuild, NetCtx, WidthTaper } from './netctx.ts';
import { GALI_CLASSES, driveCount, streetCrossSection } from './street.ts';
import type { StreetResult, WidthFixed } from './street.ts';
import { STEP_M, armInfo, corridorPairs, junctionSides, pairedOf, ringOf } from './widthsteps.ts';
import type { ArmInfo, Side } from './widthsteps.ts';

/** Rounds the width step may add to the build (each one a whole build of the model). */
export const WIDTH_ROUNDS = 7;
/** How often one road may be settled whole (a second time where two runs of short roads meet). */
const MAX_SETTLES = 2;
/** Passes of the decisions over every corridor within one round. */
const PASSES = 8;
/** The widest drive lane a road takes from the road it runs on into (m). */
const MAX_LANE_M = 4.5;

/** Lanes and lane width for a road of class `cls` with `width` metres of carriageway, near `lanes` lanes. */
export function sectionFor(cls: string, link: boolean, width: number, lanes: number): WidthFixed | null {
  let n = Math.max(1, Math.round(lanes));
  while (n > 1 && width / n < MIN_DRIVE_LANE_M) n--;
  while (width / n > MAX_LANE_M && n < 8) n++;
  const lw = width / n;
  if (lw >= MIN_DRIVE_LANE_M) return { lanes: n, laneWidth: lw, gali: false };
  // one lane narrower than a drive lane is a gali: only on the classes whose narrow stretches are galis
  if (n === 1 && GALI_CLASSES.has(cls) && !link && lw >= GALI_MIN_LANE_M - 1e-6) return { lanes: 1, laneWidth: Math.max(GALI_MIN_LANE_M, lw), gali: true };
  return null;
}

/**
 * The road's own end section with other drive lanes: the edge lanes (footpath, kerb, median) stay as they are, the
 * drive lanes keep their direction pattern and their centre, or the right border with `rightAt` (a paired
 * carriageway that widens on its kerb side).
 */
export function withDrive(own: CrossSection, t: WidthFixed): CrossSection {
  const first = own.lanes.findIndex((l) => l.type === 'drive');
  let last = first;
  for (let i = own.lanes.length - 1; i >= 0; i--) {
    if ((own.lanes[i] as LaneDef).type === 'drive') {
      last = i;
      break;
    }
  }
  const dirs = own.lanes.slice(first, last + 1).map((l) => l.dir);
  const oneDir = dirs.every((d) => d === dirs[0]) && dirs[0] !== 0 ? (dirs[0] as 1 | -1) : null;
  const n = Math.max(1, t.lanes);
  const drive: LaneDef[] = [];
  for (let i = 0; i < n; i++) {
    const dir: 1 | -1 | 0 = oneDir ?? (n === 1 ? 0 : i < Math.ceil(n / 2) ? 1 : -1);
    drive.push({ ...lane('drive', t.laneWidth, dir), ...(t.gali ? { tag: 'gali' as const } : {}) });
  }
  const left = own.lanes.slice(0, first).map((l) => ({ ...l }));
  const right = own.lanes.slice(last + 1).map((l) => ({ ...l }));
  const lanes = [...left, ...drive, ...right];
  const b = csBorders(own);
  const leftW = left.reduce((x, l) => x + l.width, 0);
  const driveW = drive.reduce((x, l) => x + l.width, 0);
  if (t.rightAt !== undefined) return { lanes, offset: t.rightAt + lanes.reduce((x, l) => x + l.width, 0) };
  const centre = ((b[first] as number) + (b[last + 1] as number)) / 2;
  return { lanes, offset: centre + driveW / 2 + leftW };
}

interface Option {
  edge: number;
  atStart: boolean;
  target: WidthFixed;
  need: number;
  room: number;
  len: number;
  /** The road's own carriageway width at this end (m). */
  own: number;
  /** The road may take a section whole. */
  wholeOk: boolean;
}

/** What the decisions read: the plans of the round (cross-sections, attachments, strip parts), its zones and streets. */
interface View {
  plans: readonly EdgePlan[];
  zones: readonly Zone[];
  streets: StreetResult;
  /** Length the strips of an edge will have (m): the built strip part, or an estimate before the junctions cut it. */
  part: (e: number) => number;
}

export interface WidthOutcome {
  changed: boolean;
  left: number;
  why: string[];
}

/** One corridor's two sides through a junction, as the decisions take them. */
interface Pairing {
  junction: string;
  sides: [Side, Side][];
}

function decide(c: NetCtx, v: View, junctions: readonly Pairing[], out: WidthOutcome, force = false): void {
  const { indexOf, source, isHero, widthFixed, widthTapers, widthBlocked: blocked, widthSettles: settles } = c;
  const why = out.why;
  const atZone = new Set<number>();
  for (const z of v.zones) for (const g of [z.parent, z.left, z.right, ...(z.mid ? [z.mid] : [])]) atZone.add(g.edge);
  /** The arm a road end runs on into across its junction ("<edge id>|start" or "|end"), where both sides are one road. */
  const across = new Map<string, ArmInfo>();
  for (const jp of junctions) {
    for (const [P, Q] of jp.sides) {
      if (P.arms.length !== 1 || Q.arms.length !== 1) continue;
      const a = P.arms[0] as ArmInfo;
      const b = Q.arms[0] as ArmInfo;
      across.set(`${a.edge}|${a.end}`, b);
      across.set(`${b.edge}|${b.end}`, a);
    }
  }
  /** Every arm of an edge in the pairings: a fix decided in this call updates their widths at once (the next pass reads them). */
  const armsOf = new Map<string, ArmInfo[]>();
  for (const jp of junctions) for (const [P, Q] of jp.sides) for (const a of [...P.arms, ...Q.arms]) (armsOf.get(a.edge) ?? armsOf.set(a.edge, []).get(a.edge) as ArmInfo[]).push(a);
  let moved = false;
  const setArms = (id: string, end: 'start' | 'end' | null, t: WidthFixed): void => {
    for (const a of armsOf.get(id) ?? []) {
      if (end && a.end !== end) continue;
      a.width = t.lanes * t.laneWidth;
      a.drive = t.lanes;
    }
    moved = true;
  };
  let lastWhy = '';
  const no = (edge: string, w: string): null => {
    lastWhy += ` ${edge}: ${w};`;
    return null;
  };
  const walled = (i: number): boolean => {
    const r = v.streets.byEdge.get((source[i] as GraphEdge).id);
    return !!r && (r.gali || r.from === 'width');
  };
  const option = (arm: ArmInfo, other: { width: number; drive: number }): Option | null => {
    const s = { edge: arm.edge };
    const e = indexOf.get(s.edge);
    if (e === undefined || isHero(e)) return no(s.edge, 'hero');
    const p = v.plans[e] as EdgePlan;
    const atStart = arm.end === 'start';
    const att = atStart ? p.startAttach : p.endAttach;
    // an end at a split zone keeps its frame and section (a street's own widening before the junction gives way to this one)
    if (att && !att.own) return no(s.edge, 'zone at this end');
    if (blocked.has(`${s.edge}|${arm.end}`)) return no(s.edge, 'blocked');
    const src = source[e] as GraphEdge;
    const target = sectionFor(src.road.cls, src.road.link, other.width, other.drive);
    if (!target) return no(s.edge, 'no section');
    // (a road settled whole in this call has that section already)
    const settled = widthFixed.get(src.id);
    const own = settled ? streetCrossSection(src, settled, settled.lanes) : ((atStart ? p.cs[0] : p.cs[p.cs.length - 1]) as CrossSection);
    // more lanes than the room beside the street's other carriageway allows (EdgeLanes.cap): a carriageway with the
    // median on its right widens on its kerb side only, its right border stays where it is
    const info = v.streets.byEdge.get(src.id);
    // (a road that narrows needs no room: the cap holds for more lanes than the road has here only)
    if (info && target.lanes > info.cap && target.lanes > driveCount(own)) {
      // (a split zone plans its lanes about the branches' centre lines: a road at a zone keeps a centred section)
      if (src.road.carriageway !== 'paired' || src.road.footpath.right > 0 || atZone.has(e)) return no(s.edge, `cap ${info.cap} < ${target.lanes}`);
      target.rightAt = own.offset - csWidth(own);
    }
    // the taper's real sideways move: the target and the road's own section matched lane by lane
    // never more lanes than a road of the kind carries (a one-way carriageway 4, a two-way road 6) unless it has them
    const ownDrive = own.lanes.filter((l) => l.type === 'drive').length;
    if (target.lanes > Math.max(ownDrive, src.oneway ? 4 : 6)) return no(s.edge, `${target.lanes} lanes`);
    // a slip road keeps a width for its role: one or two lanes (the owner, 2026-11-13)
    if (src.road.link && target.lanes > Math.max(ownDrive, 2)) return no(s.edge, `a slip road with ${target.lanes} lanes`);
    const tcs = withDrive(own, target);
    const rows = atStart ? matchRows(tcs, own) : matchRows(own, tcs);
    const bd = atStart ? rowBorders(rows, tcs, own) : rowBorders(rows, own, tcs);
    let shift = 0;
    for (let k = 0; k < bd.a.length; k++) shift = Math.max(shift, Math.abs((bd.a[k] as number) - (bd.b[k] as number)));
    // the class length per metre of move (a minor road's short taper is not stretched to the 10 m the builder starts from)
    const need = classDefaults(src.road.cls).taper * shift;
    const otherEnd = atStart ? p.endAttach : p.startAttach;
    const otherKey = `${src.id}|${atStart ? 'end' : 'start'}`;
    // a taper at the other end (one this call asked for too) shares the strip part: each gets 45 percent of it, and
    // the one there must still fit in its share
    const otherAsked = widthTapers.get(otherKey);
    if (otherAsked && !widthFixed.has(src.id) && (otherAsked.need ?? 0) > v.part(e) * 0.45 + 1e-6) return no(s.edge, 'the taper at the other end needs the room');
    const part = v.part(e);
    const room = part * (otherEnd?.target || otherAsked ? 0.45 : 0.7);
    // a road that took a split zone's first section whole (netzones.ts adopt) keeps that section: no whole change
    const adopted = !settled && info !== undefined && driveCount(p.cs[0] as CrossSection) !== info.lanes;
    return { edge: e, atStart, target, need, room, len: part, own: arm.width, wholeOk: !adopted && !blocked.has(`${src.id}|whole`) };
  };
  const take = (o: Option, j: string, short = false): void => {
    const id = (source[o.edge] as GraphEdge).id;
    if (o.need <= o.room + 1e-6 || short) {
      const key = `${id}|${o.atStart ? 'start' : 'end'}`;
      const now = widthTapers.get(key);
      const next: WidthTaper = { edge: id, atStart: o.atStart, junction: j, ...o.target, need: o.need, ...(o.need > o.room + 1e-6 ? { short: true } : {}) };
      if (!now || now.lanes !== next.lanes || Math.abs(now.laneWidth - next.laneWidth) > 1e-6 || now.gali !== next.gali || now.rightAt !== next.rightAt) {
        widthTapers.set(key, next);
        setArms(id, o.atStart ? 'start' : 'end', o.target);
        out.changed = true;
      }
      return;
    }
    // no room for the taper: the whole road takes the cross-section, and so does every road after it along the corridor
    // that has no room either to taper to it (a run of short roads between junctions); the first road after the run with
    // room tapers in the next round. A road settled whole before stays as it is.
    if ((settles.get(id) ?? 0) >= MAX_SETTLES) {
      out.left++;
      why.push(`${j}: ${id} settled whole already`);
      return;
    }
    const tw = o.target.lanes * o.target.laneWidth;
    const run: { id: string; target: WidthFixed }[] = [{ id, target: o.target }];
    let cur = { id, end: o.atStart ? 'start' : 'end' };
    for (let k = 0; k < 25; k++) {
      const next = across.get(`${cur.id}|${cur.end === 'start' ? 'end' : 'start'}`);
      if (!next || Math.abs(next.width - tw) <= STEP_M || (settles.get(next.edge) ?? 0) >= MAX_SETTLES || run.some((r) => r.id === next.edge)) break;
      const opt = option(next, { width: tw, drive: o.target.lanes });
      if (!opt || opt.need <= opt.room + 1e-6 || opt.target.rightAt !== undefined || !opt.wholeOk || (tw <= next.width + 1e-6 && !walled(opt.edge))) break;
      run.push({ id: next.edge, target: opt.target });
      cur = { id: next.edge, end: next.end };
    }
    for (const r of run) {
      widthFixed.set(r.id, r.target);
      settles.set(r.id, (settles.get(r.id) ?? 0) + 1);
      setArms(r.id, null, r.target);
      for (const end of ['start', 'end']) widthTapers.delete(`${r.id}|${end}`);
    }
    out.changed = true;
  };
  /** One arm against what it runs on into: the narrower side widens, a walled road (gali) stays and the wider one narrows. */
  const settle = (p: ArmInfo, pw: { width: number; drive: number }, q: ArmInfo | null, qw: { width: number; drive: number }, j: string): void => {
    const narrowP = pw.width < qw.width;
    const ep = indexOf.get(p.edge);
    const eq = q ? indexOf.get(q.edge) : undefined;
    const pWalled = ep !== undefined && walled(ep);
    const qWalled = eq !== undefined && walled(eq);
    lastWhy = '';
    const op = option(p, qw);
    const oq = q ? option(q, pw) : null;
    // order: the narrower road first, unless its width comes from its walls
    let order: (Option | null)[] = narrowP ? [op, oq] : [oq, op];
    if ((narrowP && pWalled && !qWalled) || (!narrowP && qWalled && !pWalled)) order = order.reverse();
    const fits = order.find((o) => o && o.need <= o.room + 1e-6);
    if (fits) return take(fits, j);
    // neither fits: the shorter road takes the other side whole (with the short roads after it); where two runs meet,
    // the shorter road of the two takes the other's section once more
    // (a whole road keeps a centred section: it may be a split zone's branch in the next round)
    // a road is settled whole only to a wider section (a road never loses lanes along its whole length to a narrower
    // neighbour; it narrows at one end through a taper), unless its own width comes from its walls
    const widens = (o: Option): boolean => o.target.lanes * o.target.laneWidth > o.own + 1e-6 || walled(o.edge);
    const free = order.filter((o): o is Option => !!o && o.wholeOk && widens(o) && o.target.rightAt === undefined && !widthFixed.has((source[o.edge] as GraphEdge).id));
    const again = order.filter((o): o is Option => !!o && o.wholeOk && widens(o) && o.target.rightAt === undefined && (settles.get((source[o.edge] as GraphEdge).id) ?? 0) < MAX_SETTLES);
    const whole = (free.length ? free : again).slice().sort((u, v) => u.len - v.len)[0];
    if (whole) return take(whole, j);
    // the last round: the road with the most room tapers over what it has (the taper check lists it, explained)
    if (force) {
      const best = order.filter((o): o is Option => !!o).sort((u, v) => v.room / Math.max(v.need, 1e-6) - u.room / Math.max(u.need, 1e-6) || u.edge - v.edge)[0];
      if (best) return take(best, j, true);
    }
    out.left++;
    why.push(`${j}:${lastWhy} whole: ${order.filter((o) => o).map((o) => `${(source[(o as Option).edge] as GraphEdge).id} ${widthFixed.has((source[(o as Option).edge] as GraphEdge).id) ? 'settled' : 'free'} need ${Math.round((o as Option).need)} room ${Math.round((o as Option).room)}`).join(', ')}`);
  };
  // passes over every corridor until no fix moves an arm (a fix changes the widths the next corridor along sees)
  for (let pass = 0; pass < PASSES; pass++) {
    moved = false;
    const last = pass === PASSES - 1;
    if (!last) out.left = 0;
    why.length = 0;
    passOver();
    if (!moved) break;
  }
  function passOver(): void {
  for (const jp of junctions) {
    const j = { id: jp.junction };
    for (const [P, Q] of jp.sides) {
      for (const sd of [P, Q]) {
        sd.width = sd.arms.reduce((t, a) => t + a.width, 0);
        sd.drive = sd.arms.reduce((t, a) => t + a.drive, 0);
      }
      if (Math.abs(P.width - Q.width) <= STEP_M) continue;
      if (P.arms.length === 1 && Q.arms.length === 1) settle(P.arms[0] as ArmInfo, P, Q.arms[0] as ArmInfo, Q, j.id);
      else if (P.arms.length === 1 || Q.arms.length === 1) {
        // a single road against two carriageways side by side: the single road meets their lanes together; where it
        // cannot, each carriageway meets its share of the single road
        const [one, two] = (P.arms.length === 1 ? [P, Q] : [Q, P]) as [Side, Side];
        const before = out.left;
        settle(one.arms[0] as ArmInfo, one, null, two, j.id);
        if (out.left > before) {
          out.left = before;
          why.pop();
          for (const a of two.arms) {
            const share = { width: (one.width * a.width) / two.width, drive: Math.max(1, Math.round((one.drive * a.drive) / two.drive)) };
            if (Math.abs(share.width - a.width) > STEP_M / 4) settle(a, a, null, share, j.id);
          }
        }
      } else if (P.arms.length === Q.arms.length) {
        // carriageway against carriageway, in order across the road (Q looks the other way: its order is reversed)
        const across = (s: Side, d: { x: number; z: number }): ArmInfo[] => s.arms.slice().sort((u, v) => (u.x * d.z - u.z * d.x) - (v.x * d.z - v.z * d.x));
        const ps = across(P, P.d);
        const qs = across(Q, P.d);
        // two one-way carriageways each side: traffic runs on from an arm into the one that carries it away
        const byFlow = ps.every((a) => a.oneway) && qs.every((a) => a.oneway) && new Set(ps.map((a) => a.flow)).size === ps.length && new Set(qs.map((a) => a.flow)).size === qs.length;
        ps.forEach((a, k) => {
          const q = (byFlow ? qs.find((x) => x.flow !== a.flow) : qs[k]) as ArmInfo;
          if (Math.abs(a.width - q.width) > STEP_M / 2) settle(a, a, q, q, j.id);
        });
      } else {
        out.left++;
        why.push(`${j.id}: ${P.arms.length} carriageways against ${Q.arms.length}`);
      }
    }
  }
  }
}


/** Corridor sides at every junction of a built round (widthsteps.ts pairing). */
function builtPairings(b: LaneBuild, paired: (a: string, b: string) => boolean, ring: (edge: string) => boolean): Pairing[] {
  return b.junctions.map((j) => {
    const arms: ArmInfo[] = [];
    for (let k = 0; k < j.arms.length; k++) {
      const a = armInfo(b.strips, j, k, ring);
      if (a) arms.push(a);
    }
    return { junction: j.id, sides: corridorPairs(junctionSides(arms, paired)) };
  });
}

/**
 * Fixes for the width steps of a built round. `changed`: a fix was added or changed (the round must be built again);
 * `left` counts the steps no fix could take, `why` says why.
 */
export function planWidthFixes(c: NetCtx, b: LaneBuild, force = false): WidthOutcome {
  const { source, isHero, indexOf, widthFixed, widthTapers, widthBlocked: blocked } = c;
  const out: WidthOutcome = { changed: false, left: 0, why: [] };
  // a taper the last round asked for that came out shorter than its class asks (the strip part was shorter than the
  // estimate: a zone or a piece change on the same edge): the road takes the cross-section whole instead
  // (the same for a street that widens before a junction, netzones.ts planWidenings, when it could not take the count)
  // (not in the last round: what it settles is built once more and not looked at again)
  for (const [e, bi] of force ? [] : [...b.built].sort((u, v) => u[0] - v[0])) {
    const p = b.plans[e] as EdgePlan;
    const src = source[e] as GraphEdge;
    const id = src.id;
    if (isHero(e)) continue;
    for (const [att, k, end] of [[p.startAttach, bi.first, 'start'], [p.endAttach, bi.last, 'end']] as const) {
      const s = b.strips[k] as Strip;
      if (!att?.own || !att.target || s.kind !== 'taper' || !s.taper) continue;
      const need = (s.taper.ratio ?? classDefaults(s.cls).taper) * s.taper.shift;
      if (s.taper.length >= need * 0.98 - 0.05) continue;
      // (a short taper the last round settled for stays: it is listed and explained)
      if (att.width && widthTapers.get(`${id}|${end}`)?.short) continue;
      const cs = att.target.cs;
      const drive = cs.lanes.filter((l) => l.type === 'drive');
      const asked = widthTapers.get(`${id}|${end}`);
      const w: WidthFixed = asked ? { lanes: asked.lanes, laneWidth: asked.laneWidth, gali: asked.gali, ...(asked.rightAt !== undefined ? { rightAt: asked.rightAt } : {}) } : { lanes: drive.length, laneWidth: drive[0]?.width ?? 3, gali: drive[0]?.tag === 'gali' };
      const info = b.streets.byEdge.get(id);
      if (widthFixed.has(id) || (info && w.lanes > info.cap && w.rightAt === undefined)) {
        // settled whole already, or no room for the lanes: this end takes no taper (the street's own widening there is
        // left out too), the other side of the junction will
        if (!blocked.has(`${id}|${end}`)) {
          widthTapers.delete(`${id}|${end}`);
          blocked.add(`${id}|${end}`);
          out.changed = true;
        }
        continue;
      }
      widthFixed.set(id, w);
      widthTapers.delete(`${id}|start`);
      widthTapers.delete(`${id}|end`);
      out.changed = true;
    }
  }
  // a fix may never put a road on another one: a taper or a whole section whose strips lie on another strip in plan is
  // taken back, and that end (or that road whole) takes no width fix again; the other side of the junction will
  if (!force) {
    const touched = new Set<string>([...widthTapers.values()].map((t) => t.edge));
    for (const id of widthFixed.keys()) touched.add(id);
    const boxes = b.strips.map((s) => {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const st of s.st) {
        const r = Math.max(Math.abs(st.b[0] as number), Math.abs(st.b[st.b.length - 1] as number));
        x0 = Math.min(x0, st.x - r); z0 = Math.min(z0, st.z - r); x1 = Math.max(x1, st.x + r); z1 = Math.max(z1, st.z + r);
      }
      return { x0, z0, x1, z1 };
    });
    const mine = b.strips.map((s) => touched.has(s.edge));
    const near = new Set<number>();
    const cell = (v: number): number => Math.floor(v / 50);
    const grid = new Map<string, number[]>();
    boxes.forEach((q, i) => {
      if (!mine[i]) return;
      for (let gx = cell(q.x0); gx <= cell(q.x1); gx++) for (let gz = cell(q.z0); gz <= cell(q.z1); gz++) (grid.get(`${gx},${gz}`) ?? grid.set(`${gx},${gz}`, []).get(`${gx},${gz}`) as number[]).push(i);
    });
    boxes.forEach((q, i) => {
      for (let gx = cell(q.x0); gx <= cell(q.x1) && !near.has(i); gx++) for (let gz = cell(q.z0); gz <= cell(q.z1); gz++) if (grid.has(`${gx},${gz}`)) { near.add(i); break; }
    });
    const idx = new Map(b.strips.map((s, i) => [s, i]));
    const { overlaps } = stripOverlaps(b.strips, b.joints, (s) => near.has(idx.get(s) as number));
    const hit = new Map<number, number>();
    for (const o of overlaps) {
      if (o.area < 0.01) continue;
      for (const k of [o.a.strip, o.b.strip]) if (mine[k]) hit.set(k, (hit.get(k) ?? 0) + o.area);
    }
    for (const k of [...hit.keys()].sort((u, v) => u - v)) {
      const s = b.strips[k] as Strip;
      const e = indexOf.get(s.edge);
      if (e === undefined) continue;
      const bi = b.built.get(e);
      const p = b.plans[e] as EdgePlan;
      if (widthFixed.has(s.edge)) {
        widthFixed.delete(s.edge);
        blocked.add(`${s.edge}|whole`);
        out.changed = true;
        continue;
      }
      for (const [end, att, at] of [['start', p.startAttach, bi?.first], ['end', p.endAttach, bi?.last]] as const) {
        if (att?.width && at === k && !blocked.has(`${s.edge}|${end}`)) {
          widthTapers.delete(`${s.edge}|${end}`);
          blocked.add(`${s.edge}|${end}`);
          out.changed = true;
        }
      }
    }
  }
  decide(c, { plans: b.plans, zones: b.zones, streets: b.streets, part: (e) => (b.plans[e] as EdgePlan).t1 - (b.plans[e] as EdgePlan).t0 }, builtPairings(b, pairedOf(source), ringOf(source)), out, force);
  return out;
}

