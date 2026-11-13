// Split zones of three branches (P1-043): one one-way road that splits into three at one node, or three that join
// into one, all at a shallow angle (the Vikas Marg fork east of ITO: a slip road, the street and the flyover ramp part
// over the same 50 m). lanes.ts planSplit handles two branches; this is the same zone with a second gore.
//
// The zone is one strip from the node to where both gores are a nose gap wide. Its stations stand on the branch that
// runs straight on (the through branch: its lanes stay on their own line) and look across to the other two along one
// line; the other branches' places on that line are where their centre lines cross it, so each branch takes over at
// its own distance from the node, exactly on its own centre line, with the zone's last frame. Each branch's lanes
// are fed only by the parent's lanes in front of them: the parent tapers to the three cores side by side. Pure.
import { leftOf, lerp, smoothstep, unit } from './curve.ts';
import type { Curve } from './curve.ts';
import type { GEdge, GEnd, Graph } from './graph.ts';
import { outward, pieceAt } from './graph.ts';
import { coreWidth, flipRows, kerbOnly, matchRows, softPlus } from './lanes.ts';
import type { EdgePlan, SplitCandidate, Zone } from './lanes.ts';
import { KERB_WIDTH, NOSE_GAP, coreRange, csBorders, flipCS, lane } from './model.ts';
import type { CrossSection, LaneDef, Station, Strip } from './model.ts';

/** A node where one one-way road splits into three or three join into one, every branch within `maxAngleDeg` of straight on. */
export function threeWaySplit(graph: Graph, nodeId: number, maxAngleDeg = 50): SplitCandidate | null {
  const node = graph.nodes.get(nodeId);
  if (!node || node.ends.length !== 4) return null;
  const edges = node.ends.map((e) => graph.edges[e.edge] as GEdge);
  if (edges.some((e) => !e.oneway) || new Set(node.ends.map((e) => e.edge)).size !== 4) return null;
  const incoming = node.ends.filter((e) => !e.atStart);
  const outgoing = node.ends.filter((e) => e.atStart);
  let kind: 'diverge' | 'merge';
  let parent: GEnd;
  let branches: [GEnd, GEnd, GEnd];
  if (incoming.length === 1 && outgoing.length === 3) {
    kind = 'diverge';
    parent = incoming[0] as GEnd;
    branches = outgoing as [GEnd, GEnd, GEnd];
  } else if (incoming.length === 3 && outgoing.length === 1) {
    kind = 'merge';
    parent = outgoing[0] as GEnd;
    branches = incoming as [GEnd, GEnd, GEnd];
  } else return null;
  const head = (e: GEnd): { x: number; z: number } => {
    const c = outward(graph.edges[e.edge] as GEdge, e.atStart);
    const p = c.at(Math.min(12, c.length * 0.5));
    return unit(p.x - node.x, p.z - node.z);
  };
  const hp = head(parent);
  const cosMax = Math.cos((maxAngleDeg * Math.PI) / 180);
  for (const b of branches) {
    const hb = head(b);
    if (-hb.x * hp.x - hb.z * hp.z < cosMax) return null;
  }
  return { node: nodeId, kind, parent, branches };
}

/** The distance along a curve near `d0` where it crosses the line through `p` with normal `n` (Newton), and the place on the line. */
function crossing(c: Curve, d0: number, p: { x: number; z: number }, n: { nx: number; nz: number }): { d: number; lat: number } {
  // the line runs along n; its normal is m
  const mx = -n.nz;
  const mz = n.nx;
  let d = Math.max(0, Math.min(c.length, d0));
  for (let k = 0; k < 12; k++) {
    const f = c.smoothAt(d);
    const err = (f.x - p.x) * mx + (f.z - p.z) * mz;
    const slope = f.tx * mx + f.tz * mz;
    if (Math.abs(err) < 1e-7 || Math.abs(slope) < 1e-6) break;
    d = Math.max(0, Math.min(c.length, d - err / slope));
  }
  const f = c.smoothAt(d);
  return { d, lat: (f.x - p.x) * n.nx + (f.z - p.z) * n.nz };
}

/** Where the station turns from the parent's frame to the zone's own (m). */
const TURN_M = 12;

/**
 * Plans the zone of a three-way split: changes the plans of the four edges like planSplit and returns the zone, or
 * null when the branches do not come a nose gap apart within their own length (the node is then a junction). `feed`:
 * the drive lanes the road before will carry when it takes another zone's section at its other end.
 */
export function planSplit3(graph: Graph, plans: EdgePlan[], cand: SplitCandidate, reserve: (e: GEnd) => number = () => 0, step = 3, feed = 0): Zone | null {
  if (cand.branches.length !== 3) return null;
  const node = graph.nodes.get(cand.node) as { x: number; z: number };
  const planOf = (e: GEnd): EdgePlan => plans[e.edge] as EdgePlan;
  const pEdge = graph.edges[cand.parent.edge] as GEdge;
  const tp = outward(pEdge, cand.parent.atStart).smoothAt(0, 6);
  const t0 = { x: -tp.tx, z: -tp.tz };
  const n0 = leftOf(t0.x, t0.z);
  const lateral = (e: GEnd): number => {
    const c = outward(graph.edges[e.edge] as GEdge, e.atStart);
    const p = c.at(Math.min(15, c.length * 0.5));
    return (p.x - node.x) * n0.nx + (p.z - node.z) * n0.nz;
  };
  // left to right, looking away from the parent
  const br = [...cand.branches].sort((p, q) => lateral(q) - lateral(p)) as [GEnd, GEnd, GEnd];
  const edges = br.map((b) => graph.edges[b.edge] as GEdge);
  const curves = br.map((b, k) => outward(edges[k] as GEdge, b.atStart));
  const endCS = (e: GEnd, parent: boolean): CrossSection => {
    const plan = planOf(e);
    const cs = plan.cs[e.atStart ? 0 : plan.cs.length - 1] as CrossSection;
    return (parent ? e.atStart : !e.atStart) ? flipCS(cs) : cs;
  };
  const csP = endCS(cand.parent, true);
  const cs = [kerbOnly(endCS(br[0], false), 'right'), kerbOnly(kerbOnly(endCS(br[1], false), 'left'), 'right'), kerbOnly(endCS(br[2], false), 'left')];
  // each branch is fed only by the parent's lanes in front of it: when the branches have more lanes than the parent,
  // the widest branch starts with fewer and gains the rest on its kerb side after the zone (a taper on the branch)
  const drives = (c: CrossSection): number => c.lanes.filter((l) => l.type === 'drive').length;
  const narrowed: boolean[] = [false, false, false];
  // (`feed`: the lanes the road before carries once a zone at its other end has given it more)
  for (let excess = cs.reduce((n, c) => n + drives(c), 0) - Math.max(drives(csP), feed); excess > 0; excess--) {
    let k = -1;
    for (const i of [1, 0, 2]) if (drives(cs[i] as CrossSection) > 1 && (k < 0 || drives(cs[i] as CrossSection) > drives(cs[k] as CrossSection))) k = i;
    if (k < 0) break;
    cs[k] = withoutKerbSideLane(cs[k] as CrossSection);
    narrowed[k] = true;
  }
  const w = cs.map(coreWidth) as [number, number, number];
  const h01 = (w[0] + w[1]) / 2;
  const h12 = (w[1] + w[2]) / 2;
  const span = w[0] / 2 + w[1] + w[2] / 2;
  // the branch that runs straight on: a link never is; of the others the one that turns least
  const deflect = (k: number): number => {
    const c = curves[k] as Curve;
    const p = c.at(Math.min(15, c.length * 0.5));
    const u = unit(p.x - node.x, p.z - node.z);
    return Math.acos(Math.max(-1, Math.min(1, u.x * t0.x + u.z * t0.z))) + ((edges[k] as GEdge).link ? 10 : 0);
  };
  const T = [0, 1, 2].reduce((best, k) => (deflect(k) < deflect(best) ? k : best), 0);
  const room = (e: GEnd): number => Math.max(0, planOf(e).t1 - planOf(e).t0 - reserve(e)) * 0.85;
  const limit = Math.min(room(br[0]), room(br[1]), room(br[2]), 160);

  /** The station line at `d` along the through branch, the other branches' places on it and the two gores. */
  const at = (d: number) => {
    const a = (curves[0] as Curve).smoothAt(d);
    const b = (curves[2] as Curve).smoothAt(d);
    const tAvg = unit(a.tx + b.tx, a.tz + b.tz);
    const nAvg = d === 0 ? n0 : leftOf(tAvg.x, tAvg.z);
    const cx = a.x - b.x;
    const cz = a.z - b.z;
    const s = Math.hypot(cx, cz);
    const beta = s < 1e-6 ? 0 : smoothstep((s - 0.5) / Math.max(0.1, 0.6 * span - 0.5));
    const raw = s < 1e-6 ? { x: nAvg.nx, z: nAvg.nz } : unit(lerp(nAvg.nx, cx / s, beta), lerp(nAvg.nz, cz / s, beta));
    const turn = smoothstep(d / TURN_M);
    const nn = unit(lerp(n0.nx, raw.x, turn), lerp(n0.nz, raw.z, turn));
    const n = { nx: nn.x, nz: nn.z };
    const f = (curves[T] as Curve).smoothAt(d);
    const p = { x: f.x, z: f.z };
    const cr = [0, 1, 2].map((k) => (k === T ? { d, lat: 0 } : crossing(curves[k] as Curve, d, p, n)));
    const lat = cr.map((c) => c.lat) as [number, number, number];
    // lanes laid out from the through branch outwards, each gore as wide as its two lines are apart less the lanes
    const lay = [0, 0, 0];
    let x1: number;
    let x2: number;
    if (T === 2) {
      x2 = lat[1] - h12;
      lay[1] = h12 + softPlus(x2);
      x1 = lat[0] - (lay[1] as number) - h01;
      lay[0] = (lay[1] as number) + h01 + softPlus(x1);
    } else if (T === 1) {
      x1 = lat[0] - h01;
      x2 = -lat[2] - h12;
      lay[0] = h01 + softPlus(x1);
      lay[2] = -(h12 + softPlus(x2));
    } else {
      x1 = -lat[1] - h01;
      lay[1] = -(h01 + softPlus(x1));
      x2 = (lay[1] as number) - lat[2] - h12;
      lay[2] = (lay[1] as number) - h12 - softPlus(x2);
    }
    return { p, n, s, lay, cr, x1, x2 };
  };

  let dPainted = -1;
  let dNose = -1;
  for (let d = 0; d <= limit; d += 0.25) {
    const q = at(d);
    const x = Math.min(q.x1, q.x2);
    if (dPainted < 0 && x >= 0) dPainted = d;
    if (x >= NOSE_GAP) {
      dNose = d;
      break;
    }
  }
  if (dNose < 2) return null;
  if (dPainted < 0) dPainted = dNose;
  let lo = Math.max(0, dNose - 0.25);
  let hi = dNose;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    const q = at(mid);
    if (Math.min(q.x1, q.x2) >= NOSE_GAP) hi = mid;
    else lo = mid;
  }
  dNose = hi;

  // the three cores side by side at the node, placed on the parent's lanes on the side of the through branch
  const pb = csBorders(csP);
  const [p0, p1] = coreRange(csP.lanes);
  const delta0 = T === 2 ? (pb[p1 + 1] as number) + w[2] / 2 : T === 0 ? (pb[p0] as number) - w[0] / 2 : ((pb[p0] as number) + (pb[p1 + 1] as number)) / 2 - (w[0] - w[2]) / 2;
  const split = (c: CrossSection): { edgeL: LaneDef[]; core: LaneDef[]; edgeR: LaneDef[] } => {
    const [f, l] = coreRange(c.lanes);
    return { edgeL: c.lanes.slice(0, f), core: c.lanes.slice(f, l + 1), edgeR: c.lanes.slice(l + 1) };
  };
  const [sA, sB, sC] = cs.map(split) as [ReturnType<typeof split>, ReturnType<typeof split>, ReturnType<typeof split>];
  const leftEdgeW = sA.edgeL.reduce((s, l) => s + l.width, 0);
  const gore = (wd: number): LaneDef => lane('gore', wd, 0, 0);
  const gores = (): LaneDef[] => [gore(KERB_WIDTH), gore(NOSE_GAP - 2 * KERB_WIDTH), gore(KERB_WIDTH)];
  const zoneLanes: LaneDef[] = [...sA.edgeL, ...sA.core, ...gores(), ...sB.core, ...gores(), ...sC.core, ...sC.edgeR].map((l) => ({ ...l }));

  const count = Math.max(2, Math.ceil(dNose / step));
  const st: Station[] = [];
  let ends: { d: number }[] = [];
  for (let k = 0; k <= count; k++) {
    const d = (dNose * k) / count;
    const q = at(d);
    const g1 = q.lay[0]! - q.lay[1]! - h01;
    const g2 = q.lay[1]! - q.lay[2]! - h12;
    const gl1 = Math.min(KERB_WIDTH, g1 / 3);
    const gl2 = Math.min(KERB_WIDTH, g2 / 3);
    const widths = [...sA.edgeL, ...sA.core].map((l) => l.width).concat([gl1, g1 - 2 * gl1, gl1], sB.core.map((l) => l.width), [gl2, g2 - 2 * gl2, gl2], [...sC.core, ...sC.edgeR].map((l) => l.width));
    const bd = [q.lay[0]! + w[0] / 2 + leftEdgeW];
    for (const wd of widths) bd.push((bd[bd.length - 1] as number) - wd);
    const delta = delta0 * Math.max(0, 1 - q.s / span);
    const pieces = br.map((b, i) => pieceAt(edges[i] as GEdge, b.atStart ? d : (edges[i] as GEdge).len - d));
    st.push({
      x: q.p.x + q.n.nx * delta, z: q.p.z + q.n.nz * delta, nx: q.n.nx, nz: q.n.nz, s: d, h: 0, g: 0, b: bd,
      layer: Math.min(...pieces.map((p) => p.layer)), bridge: pieces.every((p) => p.bridge), structure: 0, edgeRaise: 0,
    });
    if (k === count) ends = q.cr;
  }

  // the cross-section the parent must reach at the node (zone orientation) and its lane rows
  const target: CrossSection = { lanes: [...sA.edgeL, ...sA.core, ...sB.core, ...sC.core, ...sC.edgeR].map((l) => ({ ...l })), offset: delta0 + ((st[0] as Station).b[0] as number) };
  const rows = matchRows(csP, target, T === 0 ? 'left' : 'right');

  for (const [b, side] of [[br[0], 'right'], [br[2], 'left']] as const) {
    const plan = planOf(b);
    const s = b.atStart ? side : side === 'left' ? 'right' : 'left';
    plan.cs = plan.cs.map((c) => kerbOnly(c, s));
  }
  const mid = planOf(br[1]);
  mid.cs = mid.cs.map((c) => kerbOnly(kerbOnly(c, 'left'), 'right'));
  const pPlan = planOf(cand.parent);
  if (cand.parent.atStart) {
    const mirrored = flipRows(rows, csP.lanes.length, target.lanes.length).map((r) => ({ a: r.b, b: r.a }));
    pPlan.startAttach = { nx: -n0.nx, nz: -n0.nz, target: { cs: flipCS(target), rows: mirrored } };
  } else {
    pPlan.endAttach = { nx: n0.nx, nz: n0.nz, target: { cs: target, rows } };
  }
  const last = st[st.length - 1] as Station;
  br.forEach((b, i) => {
    const plan = planOf(b);
    // each branch takes over where its own centre line crosses the zone's last station line
    const d = (ends[i] as { d: number }).d;
    // a narrowed branch starts with the zone's section and widens to its own (edge orientation)
    const zcs = cs[i] as CrossSection;
    if (b.atStart) {
      plan.t0 = Math.max(plan.t0, d);
      const own = plan.cs[0] as CrossSection;
      plan.startAttach = { nx: last.nx, nz: last.nz, ...(narrowed[i] ? { target: { cs: zcs, rows: matchRows(zcs, own) } } : {}) };
    } else {
      plan.t1 = Math.min(plan.t1, plan.edge.len - d);
      const own = plan.cs[plan.cs.length - 1] as CrossSection;
      plan.endAttach = { nx: -last.nx, nz: -last.nz, ...(narrowed[i] ? { target: { cs: flipCS(zcs), rows: matchRows(own, flipCS(zcs)) } } : {}) };
    }
  });
  const nA = sA.edgeL.length + sA.core.length;
  const nB = sB.core.length;
  const targetToZone = target.lanes.map((_, i) => (i < nA ? i : i < nA + nB ? i + 3 : i + 6));
  const strip: Strip = {
    id: `zone_${cand.kind}_${cand.node}`, edge: `node/${cand.node}`, kind: 'zone', cls: pEdge.cls, link: pEdge.link && edges.every((e) => e.link), name: pEdge.name || edges.map((e) => e.name).find((n) => n) || '',
    ways: [...new Set(edges.flatMap((e) => e.pieces.map((p) => p.way)))], lanes: zoneLanes, st, hero: null,
  };
  return {
    node: cand.node, kind: cand.kind, strip, parent: cand.parent, left: br[0], right: br[2], mid: br[1], dPainted, dNose, targetToZone, targetCount: target.lanes.length,
    leftFirst: 0, leftCount: nA + 1, midFirst: nA + 2, midCount: nB + 2, rightFirst: nA + 5 + nB, rightCount: 1 + sC.core.length + sC.edgeR.length,
  };
}

/** A one-way section with its kerb side drive lane (the leftmost) taken out, the core's centre where it was. */
function withoutKerbSideLane(c: CrossSection): CrossSection {
  const [f, l] = coreRange(c.lanes);
  const k = c.lanes.findIndex((x) => x.type === 'drive');
  const b = csBorders(c);
  const centre = ((b[f] as number) + (b[l + 1] as number)) / 2;
  const lanes = c.lanes.filter((_, i) => i !== k).map((x) => ({ ...x }));
  const out: CrossSection = { lanes, offset: 0 };
  const [f2, l2] = coreRange(lanes);
  const nb = csBorders(out);
  // shift the borders so the core keeps its centre
  out.offset = centre - ((nb[f2] as number) + (nb[l2 + 1] as number)) / 2;
  return out;
}
