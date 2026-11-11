// Lane sections of the road model (ARCH_OPTIONS LN1): cross-sections per edge from tags, class defaults or a hero
// road spec; tapers where the cross-section changes; and the split zones of diverges and merges.
//
// A diverge in OSM is one node where two centre lines start. Built as ribbons they overlap until the lines are far
// enough apart. Here the stretch from the node to the nose is one strip (the zone) that carries the lanes of both
// branches side by side on one reference line: they share a lane line up to the painted nose, then a gore lane
// opens between them, and at the physical nose the zone hands each branch its own reference line, exactly on the
// branch's OSM centre line. Before the node the parent tapers to the zone's first cross-section. A merge is the
// same thing walked the other way. Two carriageways never share a vertex they should not.
import type { P2 } from '../geom.ts';
import { leftOf, lerp, smoothstep, unit } from './curve.ts';
import type { GEdge, GEnd, Graph } from './graph.ts';
import { outward, pieceAt } from './graph.ts';
import { KERB_WIDTH, NOSE_GAP, classDefaults, coreRange, csBorders, csWidth, defaultCrossSection, flipCS, lane } from './model.ts';
import type { CrossSection, Joint, LaneDef, Station, Strip } from './model.ts';

export { pairCarriageways } from './sitepairs.ts';

/** One lane row of a taper: the lane index on the side it starts from and on the side it ends at (null: no lane). */
export interface Row {
  a: number | null;
  b: number | null;
}

export interface Attach {
  /** The frame the strip end must take, in the edge's own orientation. */
  nx: number;
  nz: number;
  /** A cross-section the edge must reach at this end (the first section of a split zone), with the lane rows. */
  target?: { cs: CrossSection; rows: Row[] };
  /** The frame is the edge's own (a street that widens before a junction): nothing is blended. */
  own?: boolean;
}

export interface EdgePlan {
  edge: GEdge;
  /** Cross-section per edge piece, in the edge's orientation. */
  cs: CrossSection[];
  hero: string | null;
  /** The part of the edge that becomes strips: arc lengths. The rest belongs to a junction or a split zone. */
  t0: number;
  t1: number;
  startAttach?: Attach;
  endAttach?: Attach;
  /** Both ends in one junction: no surface of its own. */
  internal: boolean;
  paired: number | null;
}

export interface Zone {
  node: number;
  kind: 'diverge' | 'merge';
  strip: Strip;
  parent: GEnd;
  left: GEnd;
  right: GEnd;
  /** Distance from the node to the painted nose and to the physical nose. */
  dPainted: number;
  dNose: number;
  /** Zone lane index for every lane of the target cross-section (frame orientation). */
  targetToZone: number[];
  targetCount: number;
  /** Zone lane index of the first lane of each branch, in frame orientation, and their lane counts. */
  leftFirst: number;
  leftCount: number;
  rightFirst: number;
  rightCount: number;
}

/** The cross-section an edge has at one of its ends, in its own orientation: the target of an attachment, else its end piece. */
export function endCrossSection(plan: EdgePlan, atStart: boolean): CrossSection {
  const att = atStart ? plan.startAttach : plan.endAttach;
  if (att?.target) return att.target.cs;
  return (atStart ? plan.cs[0] : plan.cs[plan.cs.length - 1]) as CrossSection;
}

const csEqual = (a: CrossSection, b: CrossSection): boolean =>
  Math.abs(a.offset - b.offset) < 1e-6 && a.lanes.length === b.lanes.length && a.lanes.every((l, i) => {
    const m = b.lanes[i] as LaneDef;
    return l.type === m.type && l.dir === m.dir && Math.abs(l.width - m.width) < 1e-6 && Math.abs(l.raise - m.raise) < 1e-6;
  });

/** Cross-sections of an edge's pieces. A paired carriageway has no footpath on its median side (the right). */
export function edgeCrossSections(e: GEdge, paired: boolean): CrossSection[] {
  return e.pieces.map((p) => {
    const cs = defaultCrossSection({ cls: e.cls, link: e.link, oneway: e.oneway, lanes: p.lanes, width: p.width });
    if (paired) {
      const [, last] = coreRange(cs.lanes);
      cs.lanes = [...cs.lanes.slice(0, last + 1), lane('kerb', KERB_WIDTH)];
    }
    return cs;
  });
}

/** Keeps only a kerb on one side of a cross-section (the gore side of a split branch). */
export function kerbOnly(cs: CrossSection, side: 'left' | 'right'): CrossSection {
  const [first, last] = coreRange(cs.lanes);
  if (side === 'right') return { lanes: [...cs.lanes.slice(0, last + 1), lane('kerb', KERB_WIDTH)], offset: cs.offset };
  const b = csBorders(cs);
  return { lanes: [lane('kerb', KERB_WIDTH), ...cs.lanes.slice(first)], offset: (b[first] as number) + KERB_WIDTH };
}

/**
 * Lane rows between two cross-sections of one road. Edge lanes pair from the carriageway outwards. Drive lanes
 * pair from the centre: on a one-way carriageway from the right (the fast lane stays, lanes come and go on the
 * kerb side: left-hand traffic), on a two-way road each direction from the centre line.
 */
export function matchRows(a: CrossSection, b: CrossSection, align: 'auto' | 'left' | 'right' = 'auto'): Row[] {
  const [a0, a1] = coreRange(a.lanes);
  const [b0, b1] = coreRange(b.lanes);
  const rows: Row[] = [];
  // left edge: innermost pairs with innermost
  const la = a0;
  const lb = b0;
  const lmax = Math.max(la, lb);
  for (let i = 0; i < lmax; i++) {
    const ia = i - (lmax - la);
    const ib = i - (lmax - lb);
    rows.push({ a: ia >= 0 ? ia : null, b: ib >= 0 ? ib : null });
  }
  const core = (from: number, to: number, bf: number, bt: number, how: 'left' | 'right'): void => {
    const na = to - from + 1;
    const nb = bt - bf + 1;
    const k = Math.max(na, nb);
    for (let i = 0; i < k; i++) {
      const ia = how === 'right' ? i - (k - na) : i;
      const ib = how === 'right' ? i - (k - nb) : i;
      rows.push({ a: ia >= 0 && ia < na ? from + ia : null, b: ib >= 0 && ib < nb ? bf + ib : null });
    }
  };
  const split = (cs: CrossSection, f: number, l: number): number => {
    // index of the first lane that runs against the station order (two-way roads); l + 1 when there is none
    for (let i = f; i <= l; i++) if ((cs.lanes[i] as LaneDef).dir === -1) return i;
    return l + 1;
  };
  const sa = split(a, a0, a1);
  const sb = split(b, b0, b1);
  const twoWay = sa <= a1 && sa > a0 && sb <= b1 && sb > b0;
  if (align !== 'auto') core(a0, a1, b0, b1, align);
  else if (twoWay) {
    core(a0, sa - 1, b0, sb - 1, 'right');
    core(sa, a1, sb, b1, 'left');
  } else core(a0, a1, b0, b1, sa === a0 && sa <= a1 ? 'left' : 'right');
  // right edge: innermost first
  const ra = a.lanes.length - 1 - a1;
  const rb = b.lanes.length - 1 - b1;
  const rmax = Math.max(ra, rb);
  for (let i = 0; i < rmax; i++) rows.push({ a: i < ra ? a1 + 1 + i : null, b: i < rb ? b1 + 1 + i : null });
  return rows;
}

/** Border positions of the rows on side a and on side b (a missing lane has no width there). */
export function rowBorders(rows: readonly Row[], a: CrossSection, b: CrossSection): { a: number[]; b: number[] } {
  const ba = [a.offset];
  const bb = [b.offset];
  for (const r of rows) {
    ba.push((ba[ba.length - 1] as number) - (r.a === null ? 0 : (a.lanes[r.a] as LaneDef).width));
    bb.push((bb[bb.length - 1] as number) - (r.b === null ? 0 : (b.lanes[r.b] as LaneDef).width));
  }
  return { a: ba, b: bb };
}

const rowLanes = (rows: readonly Row[], a: CrossSection, b: CrossSection): LaneDef[] =>
  rows.map((r) => ({ ...((r.b !== null ? b.lanes[r.b] : a.lanes[r.a as number]) as LaneDef) }));

const flipRows = (rows: readonly Row[], na: number, nb: number): Row[] =>
  rows.slice().reverse().map((r) => ({ a: r.a === null ? null : na - 1 - r.a, b: r.b === null ? null : nb - 1 - r.b }));

/** Largest sideways move of any lane border across a taper. */
function maxShift(rows: readonly Row[], a: CrossSection, b: CrossSection): number {
  const bd = rowBorders(rows, a, b);
  let m = 0;
  for (let i = 0; i < bd.a.length; i++) m = Math.max(m, Math.abs((bd.a[i] as number) - (bd.b[i] as number)));
  return m;
}

// ------------------------------------------------------------------ split zones

const C1_WINDOW = 0.5;
/** max(0, x) with a smooth corner of half-width C1_WINDOW: exactly 0 below it and exactly x above it. */
const softPlus = (x: number): number => (x <= -C1_WINDOW ? 0 : x >= C1_WINDOW ? x : ((x + C1_WINDOW) * (x + C1_WINDOW)) / (4 * C1_WINDOW));

const coreWidth = (cs: CrossSection): number => {
  const [f, l] = coreRange(cs.lanes);
  let w = 0;
  for (let i = f; i <= l; i++) w += (cs.lanes[i] as LaneDef).width;
  return w;
};

export interface SplitCandidate {
  node: number;
  kind: 'diverge' | 'merge';
  parent: GEnd;
  branches: [GEnd, GEnd];
}

/** A node where one one-way road splits into two or two join into one, at a shallow angle. */
export function splitCandidate(graph: Graph, nodeId: number, maxAngleDeg = 50): SplitCandidate | null {
  const node = graph.nodes.get(nodeId);
  if (!node || node.ends.length !== 3) return null;
  const edges = node.ends.map((e) => graph.edges[e.edge] as GEdge);
  if (edges.some((e) => !e.oneway) || new Set(node.ends.map((e) => e.edge)).size !== 3) return null;
  const incoming = node.ends.filter((e) => !e.atStart);
  const outgoing = node.ends.filter((e) => e.atStart);
  let kind: 'diverge' | 'merge';
  let parent: GEnd;
  let branches: [GEnd, GEnd];
  if (incoming.length === 1 && outgoing.length === 2) {
    kind = 'diverge';
    parent = incoming[0] as GEnd;
    branches = [outgoing[0] as GEnd, outgoing[1] as GEnd];
  } else if (incoming.length === 2 && outgoing.length === 1) {
    kind = 'merge';
    parent = outgoing[0] as GEnd;
    branches = [incoming[0] as GEnd, incoming[1] as GEnd];
  } else return null;
  // headings away from the node, 12 m out
  const head = (e: GEnd): { x: number; z: number } => {
    const c = outward(graph.edges[e.edge] as GEdge, e.atStart);
    const p = c.at(Math.min(12, c.length * 0.5));
    return unit(p.x - node.x, p.z - node.z);
  };
  const hp = head(parent);
  const frame = { x: -hp.x, z: -hp.z };
  const cosMax = Math.cos((maxAngleDeg * Math.PI) / 180);
  for (const b of branches) {
    const hb = head(b);
    if (hb.x * frame.x + hb.z * frame.z < cosMax) return null;
  }
  return { node: nodeId, kind, parent, branches };
}

/** The branch of a split that runs straight on and the one that leaves or joins: a link is never the main line; of two equals the one that turns less is. */
export function mainBranch(graph: Graph, cand: SplitCandidate): { main: GEnd; minor: GEnd } {
  const node = graph.nodes.get(cand.node) as P2;
  const tp = outward(graph.edges[cand.parent.edge] as GEdge, cand.parent.atStart).smoothAt(0, 6);
  const deflect = (e: GEnd): number => {
    const c = outward(graph.edges[e.edge] as GEdge, e.atStart);
    const p = c.at(Math.min(15, c.length * 0.5));
    const u = unit(p.x - node.x, p.z - node.z);
    return Math.acos(Math.max(-1, Math.min(1, -u.x * tp.tx - u.z * tp.tz)));
  };
  const [p, q] = cand.branches;
  const lp = (graph.edges[p.edge] as GEdge).link;
  const lq = (graph.edges[q.edge] as GEdge).link;
  const mainIsP = lp !== lq ? !lp : deflect(p) <= deflect(q);
  return mainIsP ? { main: p, minor: q } : { main: q, minor: p };
}

/**
 * Plans the zone of one split. Changes the plans of the three edges (trims, attachments, the gore side of the
 * branches). Returns null when the branches are too short to reach the nose: the node is then a plain junction.
 */
export function planSplit(graph: Graph, plans: EdgePlan[], cand: SplitCandidate, reserve: (e: GEnd) => number = () => 0, step = 3): Zone | null {
  const node = graph.nodes.get(cand.node) as { x: number; z: number };
  const planOf = (e: GEnd): EdgePlan => plans[e.edge] as EdgePlan;
  const pEdge = graph.edges[cand.parent.edge] as GEdge;
  const cP = outward(pEdge, cand.parent.atStart);
  const tp = cP.smoothAt(0, 6);
  const t0 = { x: -tp.tx, z: -tp.tz };
  const n0 = leftOf(t0.x, t0.z);
  // which branch is left of the other, 15 m out
  const lateral = (e: GEnd): number => {
    const c = outward(graph.edges[e.edge] as GEdge, e.atStart);
    const p = c.at(Math.min(15, c.length * 0.5));
    return (p.x - node.x) * n0.nx + (p.z - node.z) * n0.nz;
  };
  const [bl, br] = lateral(cand.branches[0]) >= lateral(cand.branches[1]) ? [cand.branches[0], cand.branches[1]] : [cand.branches[1], cand.branches[0]];
  const eL = graph.edges[bl.edge] as GEdge;
  const eR = graph.edges[br.edge] as GEdge;
  const cL = outward(eL, bl.atStart);
  const cR = outward(eR, br.atStart);
  // the end piece of each edge at the node, as seen walking away from the parent (the zone's orientation)
  const endCS = (e: GEnd, parent: boolean): { cs: CrossSection; piece: number } => {
    const plan = planOf(e);
    const piece = e.atStart ? 0 : plan.cs.length - 1;
    const cs = plan.cs[piece] as CrossSection;
    const flip = parent ? e.atStart : !e.atStart;
    return { cs: flip ? flipCS(cs) : cs, piece };
  };
  // the gore side of each branch keeps only a kerb (on every piece of the branch, once the zone is known to fit)
  const goreSide = (e: GEnd, zoneSide: 'left' | 'right'): void => {
    const plan = planOf(e);
    const side = e.atStart ? zoneSide : zoneSide === 'left' ? 'right' : 'left';
    plan.cs = plan.cs.map((cs) => kerbOnly(cs, side));
  };
  const csP = endCS(cand.parent, true).cs;
  const csL = kerbOnly(endCS(bl, false).cs, 'right');
  const csR = kerbOnly(endCS(br, false).cs, 'left');
  const [l0, l1] = coreRange(csL.lanes);
  const [r0, r1] = coreRange(csR.lanes);
  const wL = coreWidth(csL);
  const wR = coreWidth(csR);
  const half = (wL + wR) / 2;
  const sep = (d: number): number => {
    const a = cL.at(d);
    const b = cR.at(d);
    return Math.hypot(a.x - b.x, a.z - b.z);
  };
  // room on each branch: what its other end has not already taken, and at most 80 percent of it
  const room = (e: GEnd): number => {
    const plan = planOf(e);
    return Math.max(0, plan.t1 - plan.t0 - reserve(e)) * 0.85;
  };
  const limit = Math.min(room(bl), room(br), 160);
  let dPainted = -1;
  let dNose = -1;
  for (let d = 0; d <= limit; d += 0.25) {
    const x = sep(d) - half;
    if (dPainted < 0 && x >= 0) dPainted = d;
    if (x >= NOSE_GAP) {
      dNose = d;
      break;
    }
  }
  if (dNose < 0 || dNose < 2) return null;
  if (dPainted < 0) dPainted = dNose;
  // refine the nose so the gore is exactly NOSE_GAP wide there
  let lo = Math.max(0, dNose - 0.25);
  let hi = dNose;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (sep(mid) - half >= NOSE_GAP) hi = mid;
    else lo = mid;
  }
  dNose = hi;

  // where the boundary between the two lane groups sits at the node, in the parent's frame
  const pb = csBorders(csP);
  const [p0, p1] = coreRange(csP.lanes);
  const deflect = (e: GEnd): number => {
    const c = outward(graph.edges[e.edge] as GEdge, e.atStart);
    const p = c.at(Math.min(15, c.length * 0.5));
    const u = unit(p.x - node.x, p.z - node.z);
    return Math.acos(Math.max(-1, Math.min(1, u.x * t0.x + u.z * t0.z)));
  };
  let through: 'left' | 'right';
  if (eL.link !== eR.link) through = eL.link ? 'right' : 'left';
  else through = deflect(bl) <= deflect(br) ? 'left' : 'right';
  const c0 = through === 'right' ? (pb[p1 + 1] as number) + wR : (pb[p0] as number) - wL;

  const leftEdge = csL.lanes.slice(0, l0);
  const leftCore = csL.lanes.slice(l0, l1 + 1);
  const rightCore = csR.lanes.slice(r0, r1 + 1);
  const rightEdge = csR.lanes.slice(r1 + 1);
  const leftEdgeW = leftEdge.reduce((s, l) => s + l.width, 0);
  const gore = (w: number): LaneDef => lane('gore', w, 0, 0);
  const zoneLanes: LaneDef[] = [...leftEdge, ...leftCore, gore(KERB_WIDTH), gore(NOSE_GAP - 2 * KERB_WIDTH), gore(KERB_WIDTH), ...rightCore, ...rightEdge].map((l) => ({ ...l }));

  const fL = wL / (wL + wR);
  const fR = 1 - fL;
  const count = Math.max(2, Math.ceil(dNose / step));
  const st: Station[] = [];
  const pieceL = (d: number) => pieceAt(eL, bl.atStart ? d : eL.len - d);
  const pieceR = (d: number) => pieceAt(eR, br.atStart ? d : eR.len - d);
  for (let k = 0; k <= count; k++) {
    const d = (dNose * k) / count;
    const a = cL.smoothAt(d);
    const b = cR.smoothAt(d);
    const tAvg = unit(a.tx + b.tx, a.tz + b.tz);
    const nAvg = k === 0 ? n0 : leftOf(tAvg.x, tAvg.z);
    const cx = a.x - b.x;
    const cz = a.z - b.z;
    const s = Math.hypot(cx, cz);
    const beta = s < 1e-6 ? 0 : smoothstep((s - 0.5) / Math.max(0.1, 0.6 * half - 0.5));
    const raw = s < 1e-6 ? { x: nAvg.nx, z: nAvg.nz } : unit(lerp(nAvg.nx, cx / s, beta), lerp(nAvg.nz, cz / s, beta));
    // the first metres turn from the parent's frame to the zone's own, so a bend at the node does not fold the surface
    const turn = smoothstep(d / Math.min(12, dNose * 0.6));
    const n = unit(lerp(n0.nx, raw.x, turn), lerp(n0.nz, raw.z, turn));
    const g = softPlus(s - half);
    // the lane group boundary moves from its place in the parent to the gore as the two lines separate: tied to the
    // separation itself, so the lanes that run straight on stay exactly on their own line
    const delta = c0 * Math.max(0, 1 - s / half);
    const mx = b.x + cx * fR;
    const mz = b.z + cz * fR;
    const gl = Math.min(KERB_WIDTH, g / 3);
    const widths = [...leftEdge.map((l) => l.width), ...leftCore.map((l) => l.width), gl, g - 2 * gl, gl, ...rightCore.map((l) => l.width), ...rightEdge.map((l) => l.width)];
    const bd = [g * fL + wL + leftEdgeW];
    for (const w of widths) bd.push((bd[bd.length - 1] as number) - w);
    const pl = pieceL(d);
    const pr = pieceR(d);
    st.push({ x: mx + n.x * delta, z: mz + n.z * delta, nx: n.x, nz: n.z, s: d, h: 0, g: 0, b: bd, layer: Math.min(pl.layer, pr.layer), bridge: pl.bridge && pr.bridge, structure: 0, edgeRaise: 0 });
  }

  // the cross-section the parent must reach at the node, in the zone's orientation, and its lane rows
  const target: CrossSection = { lanes: [...leftEdge, ...leftCore, ...rightCore, ...rightEdge].map((l) => ({ ...l })), offset: c0 + wL + leftEdgeW };
  const tCoreFirst = leftEdge.length;
  const tCoreLast = tCoreFirst + leftCore.length + rightCore.length - 1;
  const rows: Row[] = [];
  const lmax = Math.max(p0, tCoreFirst);
  for (let i = 0; i < lmax; i++) {
    const ia = i - (lmax - p0);
    const ib = i - (lmax - tCoreFirst);
    rows.push({ a: ia >= 0 ? ia : null, b: ib >= 0 ? ib : null });
  }
  const na = p1 - p0 + 1;
  const nb = tCoreLast - tCoreFirst + 1;
  const kk = Math.max(na, nb);
  for (let i = 0; i < kk; i++) {
    const ia = through === 'right' ? i - (kk - na) : i;
    const ib = through === 'right' ? i - (kk - nb) : i;
    rows.push({ a: ia >= 0 && ia < na ? p0 + ia : null, b: ib >= 0 && ib < nb ? tCoreFirst + ib : null });
  }
  const ra = csP.lanes.length - 1 - p1;
  const rb = target.lanes.length - 1 - tCoreLast;
  for (let i = 0; i < Math.max(ra, rb); i++) rows.push({ a: i < ra ? p1 + 1 + i : null, b: i < rb ? tCoreLast + 1 + i : null });

  goreSide(bl, 'right');
  goreSide(br, 'left');
  // attachments, each in its edge's own orientation
  const pPlan = planOf(cand.parent);
  if (cand.parent.atStart) {
    // the parent leaves the node against the zone's orientation (a merge): mirror, and the rows run target to nominal
    const t = flipCS(target);
    const mirrored = flipRows(rows, csP.lanes.length, target.lanes.length).map((r) => ({ a: r.b, b: r.a }));
    pPlan.startAttach = { nx: -n0.nx, nz: -n0.nz, target: { cs: t, rows: mirrored } };
  } else {
    pPlan.endAttach = { nx: n0.nx, nz: n0.nz, target: { cs: target, rows } };
  }
  const last = st[st.length - 1] as Station;
  for (const e of [bl, br]) {
    const plan = planOf(e);
    if (e.atStart) {
      plan.t0 = Math.max(plan.t0, dNose);
      plan.startAttach = { nx: last.nx, nz: last.nz };
    } else {
      plan.t1 = Math.min(plan.t1, plan.edge.len - dNose);
      plan.endAttach = { nx: -last.nx, nz: -last.nz };
    }
  }
  const targetToZone: number[] = [];
  for (let i = 0; i < target.lanes.length; i++) targetToZone.push(i < leftEdge.length + leftCore.length ? i : i + 3);
  const strip: Strip = {
    id: `zone_${cand.kind}_${cand.node}`, edge: `node/${cand.node}`, kind: 'zone', cls: pEdge.cls, link: pEdge.link && eL.link && eR.link, name: pEdge.name || eL.name || eR.name,
    ways: [...new Set([...eL.pieces.map((p) => p.way), ...eR.pieces.map((p) => p.way)])], lanes: zoneLanes, st, hero: null,
  };
  return {
    node: cand.node, kind: cand.kind, strip, parent: cand.parent, left: bl, right: br, dPainted, dNose, targetToZone, targetCount: target.lanes.length,
    leftFirst: 0, leftCount: leftEdge.length + leftCore.length + 1, rightFirst: leftEdge.length + leftCore.length + 2, rightCount: rightCore.length + rightEdge.length + 1,
  };
}

// ------------------------------------------------------------------ strips of one edge

export interface EdgeStrips {
  strips: Strip[];
  /** Joints between the strips of this edge, with strip numbers local to `strips`. */
  joints: Joint[];
  /** Strip lane index of every lane of the cross-section at each end (the nominal one, or the target of an attachment). */
  startLanes: number[];
  endLanes: number[];
}

interface Span {
  s0: number;
  s1: number;
  a: CrossSection;
  b: CrossSection;
  rows: Row[] | null;
  need: number;
  shift: number;
}

const BLEND_M = 12;

/** The strips of one edge between its trims: constant sections, tapers between them, tapers to split zones. */
export function buildEdgeStrips(plan: EdgePlan, step = 4): EdgeStrips {
  const e = plan.edge;
  const ratio = classDefaults(e.cls).taper;
  let spans: Span[] = [];
  e.pieces.forEach((p, i) => {
    const s0 = Math.max(p.s0, plan.t0);
    const s1 = Math.min(p.s1, plan.t1);
    if (s1 - s0 < 1e-6) return;
    const cs = plan.cs[i] as CrossSection;
    const prev = spans[spans.length - 1];
    if (prev && csEqual(prev.a, cs)) prev.s1 = s1;
    else spans.push({ s0, s1, a: cs, b: cs, rows: null, need: 0, shift: 0 });
  });
  if (spans.length === 0) return { strips: [], joints: [], startLanes: [], endLanes: [] };
  const out: Span[] = [];
  const taperSpan = (s0: number, s1: number, a: CrossSection, b: CrossSection, rows: Row[]): Span => {
    const shift = maxShift(rows, a, b);
    return { s0, s1, a, b, rows, need: Math.max(10, ratio * shift), shift };
  };
  // tapers where the cross-section changes along the edge: inside the wider section
  for (let i = 0; i < spans.length; i++) {
    const cur = spans[i] as Span;
    const next = spans[i + 1];
    out.push(cur);
    if (!next) break;
    const rows = matchRows(cur.a, next.a);
    const want = Math.max(10, ratio * maxShift(rows, cur.a, next.a));
    if (csWidth(next.a) >= csWidth(cur.a)) {
      const len = Math.min(want, (next.s1 - next.s0) * 0.6);
      out.push(taperSpan(next.s0, next.s0 + len, cur.a, next.a, rows));
      next.s0 += len;
    } else {
      const len = Math.min(want, (cur.s1 - cur.s0) * 0.6);
      cur.s1 -= len;
      out.push(taperSpan(cur.s1, cur.s1 + len, cur.a, next.a, rows));
    }
  }
  spans = out;
  // tapers to the first cross-section of a split zone
  if (plan.startAttach?.target) {
    const first = spans[0] as Span;
    const t = plan.startAttach.target;
    const want = Math.max(10, ratio * maxShift(t.rows, t.cs, first.a));
    const len = Math.min(want, (first.s1 - first.s0) * (plan.endAttach?.target ? 0.45 : 0.7));
    spans.unshift(taperSpan(first.s0, first.s0 + len, t.cs, first.a, t.rows));
    first.s0 += len;
  }
  if (plan.endAttach?.target) {
    const lastSpan = spans[spans.length - 1] as Span;
    const t = plan.endAttach.target;
    const want = Math.max(10, ratio * maxShift(t.rows, lastSpan.b, t.cs));
    const len = Math.min(want, (lastSpan.s1 - lastSpan.s0) * (plan.startAttach?.target ? 0.8 : 0.7));
    lastSpan.s1 -= len;
    spans.push(taperSpan(lastSpan.s1, lastSpan.s1 + len, lastSpan.b, t.cs, t.rows));
  }
  spans = spans.filter((s) => s.s1 - s.s0 > 0.05);

  const frameAt = (s: number): { x: number; z: number; nx: number; nz: number } => {
    const f = e.curve.smoothAt(s);
    let n = leftOf(f.tx, f.tz);
    const blend = (att: Attach | undefined, dist: number): void => {
      if (!att || att.own) return;
      const w = 1 - smoothstep(dist / BLEND_M);
      if (w <= 0) return;
      const u = unit(lerp(n.nx, att.nx, w), lerp(n.nz, att.nz, w));
      n = { nx: u.x, nz: u.z };
    };
    blend(plan.startAttach, s - plan.t0);
    blend(plan.endAttach, plan.t1 - s);
    return { x: f.x, z: f.z, nx: n.nx, nz: n.nz };
  };
  const strips: Strip[] = [];
  const joints: Joint[] = [];
  const ways = [...new Set(e.pieces.map((p) => p.way))];
  spans.forEach((sp, i) => {
    const n = Math.max(1, Math.ceil((sp.s1 - sp.s0) / step));
    const st: Station[] = [];
    const bd = sp.rows ? rowBorders(sp.rows, sp.a, sp.b) : null;
    const constant = csBorders(sp.a);
    for (let k = 0; k <= n; k++) {
      const s = lerp(sp.s0, sp.s1, k / n);
      const f = frameAt(s);
      const t = smoothstep(k / n);
      const b = bd ? bd.a.map((v, j) => lerp(v, bd.b[j] as number, t)) : constant.slice();
      const piece = pieceAt(e, s);
      st.push({ ...f, s, h: 0, g: 0, b, layer: piece.layer, bridge: piece.bridge, structure: 0, edgeRaise: 0 });
    }
    const strip: Strip = {
      id: `${e.id}_${i}`, edge: e.id, kind: sp.rows ? 'taper' : 'road', cls: e.cls, link: e.link, name: e.name, ways,
      lanes: sp.rows ? rowLanes(sp.rows, sp.a, sp.b) : sp.a.lanes.map((l) => ({ ...l })), st, hero: plan.hero,
    };
    if (sp.rows) strip.taper = { length: sp.s1 - sp.s0, shift: sp.shift, needed: sp.need };
    strips.push(strip);
  });
  // lane pairs between consecutive strips: both sides name the lanes of the cross-section they share
  const laneOf = (sp: Span, side: 'a' | 'b', idx: number): number => (sp.rows ? sp.rows.findIndex((r) => r[side] === idx) : idx);
  for (let i = 0; i + 1 < spans.length; i++) {
    const p = spans[i] as Span;
    const q = spans[i + 1] as Span;
    const shared = p.b;
    const lanes: [number, number][] = [];
    for (let k = 0; k < shared.lanes.length; k++) {
      const x = laneOf(p, 'b', k);
      const y = laneOf(q, 'a', k);
      if (x >= 0 && y >= 0) lanes.push([x, y]);
    }
    joints.push({ a: { strip: i, end: 'end' }, b: { strip: i + 1, end: 'start' }, lanes, kind: 'section' });
  }
  const firstSpan = spans[0] as Span;
  const lastSpan = spans[spans.length - 1] as Span;
  return {
    strips, joints,
    startLanes: firstSpan.a.lanes.map((_, k) => laneOf(firstSpan, 'a', k)),
    endLanes: lastSpan.b.lanes.map((_, k) => laneOf(lastSpan, 'b', k)),
  };
}
