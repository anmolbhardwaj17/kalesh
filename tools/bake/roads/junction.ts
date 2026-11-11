// Junction surfaces (ARCH_OPTIONS J1, J3). A junction is a node, or a cluster of nodes, with arms. Each pair of
// neighbouring arms gets a corner: where their facing carriageway edges meet, a fillet arc of the class radius
// joins them; arms that run on through the junction (a ring road past a side road) keep their own edge curve; the
// two carriageways of one street are closed by a straight median nose. Every arm is cut back behind its corners,
// and the ring of cut lines and corners is one surface. Raised corners (kerb and footpath) are bands outside it.
// If the construction fails (a ring that crosses itself), the plain fallback takes over: every arm is cut on a
// circle and the cut lines are joined by straight chords (stand-in for the J2 polygon union, see site.ts).
import type { P2 } from '../geom.ts';
import { Curve, area2, leftOf, lerp, segCross, selfCrossing, unit } from './curve.ts';
import type { GEdge, GEnd, Graph } from './graph.ts';
import { outward } from './graph.ts';
import { endCrossSection } from './lanes.ts';
import type { EdgePlan } from './lanes.ts';
import { KERB_WIDTH, classDefaults, coreRange, csBorders, flipCS } from './model.ts';
import type { CrossSection } from './model.ts';

export interface ArmPlan {
  end: GEnd;
  curve: Curve;
  /** Cross-section looking away from the junction, and its borders. */
  cs: CrossSection;
  borders: number[];
  coreFirst: number;
  coreLast: number;
  angle: number;
  avail: number;
  cut: number;
  radius: number;
}

/** One vertex of a planned ring: a lane border on an arm's cut line (exact strip vertex later), or a free point. */
export type RingItem = { kind: 'cut'; arm: number; border: number } | { kind: 'pt'; x: number; z: number; corner: number; frac: number };

export interface CornerPlan {
  kind: 'fillet' | 'through' | 'gap';
  radius: number;
  /** Free points of the corner between arm i's left carriageway edge and the next arm's right one. */
  path: P2[];
  /** The same for the outer edge of the raised corner, point for point (empty: no band). */
  outer: P2[];
}

export interface JunctionPlan {
  id: string;
  nodes: number[];
  centre: P2;
  arms: ArmPlan[];
  corners: CornerPlan[];
  ring: RingItem[];
  /** skirt: which ring edges get a face down to the carriageway, when the builder cannot tell from the points. */
  bands: { ring: RingItem[]; inner: number; skirt?: boolean[] }[];
  method: 'J1' | 'J2';
  why?: string;
}

export const edgePoint = (a: ArmPlan, lateral: number, t: number): P2 => {
  if (t >= 0) {
    const f = a.curve.smoothAt(Math.min(t, a.curve.length));
    const n = leftOf(f.tx, f.tz);
    return { x: f.x + n.nx * lateral, z: f.z + n.nz * lateral };
  }
  const f = a.curve.smoothAt(0);
  const n = leftOf(f.tx, f.tz);
  return { x: f.x + f.tx * t + n.nx * lateral, z: f.z + f.tz * t + n.nz * lateral };
};

export const tangentAt = (a: ArmPlan, t: number): { x: number; z: number } => {
  const f = a.curve.smoothAt(Math.max(0, Math.min(t, a.curve.length)));
  return { x: f.tx, z: f.tz };
};

const BACK = 25;

/** First meeting of arm i's edge at `li` and arm j's edge at `lj`: the distances along each arm from its node. */
function meet(ai: ArmPlan, li: number, aj: ArmPlan, lj: number): { ti: number; tj: number; x: number; z: number } | null {
  const sample = (a: ArmPlan, l: number): { t: number; p: P2 }[] => {
    const out = [];
    const top = Math.min(a.curve.length, 60);
    for (let t = -BACK; t < top; t += 1) out.push({ t, p: edgePoint(a, l, t) });
    out.push({ t: top, p: edgePoint(a, l, top) });
    return out;
  };
  const pi = sample(ai, li);
  const pj = sample(aj, lj);
  let best: { ti: number; tj: number; x: number; z: number } | null = null;
  for (let i = 0; i + 1 < pi.length; i++) {
    const a = pi[i] as { t: number; p: P2 };
    const b = pi[i + 1] as { t: number; p: P2 };
    for (let j = 0; j + 1 < pj.length; j++) {
      const c = pj[j] as { t: number; p: P2 };
      const d = pj[j + 1] as { t: number; p: P2 };
      const x = segCross(a.p, b.p, c.p, d.p);
      if (!x) continue;
      const ti = lerp(a.t, b.t, x.t);
      const tj = lerp(c.t, d.t, x.u);
      if (!best || Math.max(ti, tj) < Math.max(best.ti, best.tj)) best = { ti, tj, x: x.x, z: x.z };
    }
  }
  return best;
}

function armPlan(graph: Graph, plans: EdgePlan[], end: GEnd, centre: P2): ArmPlan {
  const e = graph.edges[end.edge] as GEdge;
  const plan = plans[end.edge] as EdgePlan;
  const curve = outward(e, end.atStart);
  const raw = endCrossSection(plan, end.atStart);
  const cs = end.atStart ? raw : flipCS(raw);
  const [coreFirst, coreLast] = coreRange(cs.lanes);
  const p = curve.at(Math.min(12, curve.length * 0.5));
  return {
    end, curve, cs, borders: csBorders(cs), coreFirst, coreLast, angle: Math.atan2(-(p.z - centre.z), p.x - centre.x),
    avail: Math.max(1, (plan.t1 - plan.t0) * 0.45), cut: 1.5, radius: classDefaults(e.cls).cornerRadius,
  };
}

const samplesDown = (from: number, to: number, step = 2): number[] => {
  // parameters strictly between `from` and `to`, walking from `from` towards `to`
  const out: number[] = [];
  const n = Math.max(0, Math.ceil(Math.abs(from - to) / step) - 1);
  for (let k = 1; k <= n; k++) out.push(lerp(from, to, k / (n + 1)));
  return out;
};

/**
 * Plans one junction: the corners, the cut of every arm (written into the edge plans) and the ring. `minCut` keeps
 * a little of every arm inside the junction even when no corner asks for it; `minCutOf` is a longer cut one arm asks for.
 */
export function planJunction(graph: Graph, plans: EdgePlan[], id: string, nodeIds: number[], ends: GEnd[], minCut = 1.5, minCutOf?: (end: GEnd) => number): JunctionPlan {
  const pts = nodeIds.map((n) => graph.nodes.get(n) as P2);
  const centre = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, z: pts.reduce((s, p) => s + p.z, 0) / pts.length };
  const arms = ends.map((e) => armPlan(graph, plans, e, centre)).sort((a, b) => a.angle - b.angle);
  const n = arms.length;
  const cl = (a: ArmPlan): number => a.borders[a.coreFirst] as number;
  const cr = (a: ArmPlan): number => a.borders[a.coreLast + 1] as number;
  const ol = (a: ArmPlan): number => a.borders[0] as number;
  const or = (a: ArmPlan): number => a.borders[a.borders.length - 1] as number;

  interface Corner { kind: 'fillet' | 'through' | 'gap'; radius: number; di: number; dj: number; ti: number; tj: number; phi: number; fan?: { x: number; z: number; ti: number; tj: number } }
  const corners: Corner[] = [];
  for (let i = 0; i < n; i++) {
    const a = arms[i] as ArmPlan;
    const b = arms[(i + 1) % n] as ArmPlan;
    let corner: Corner | null = null;
    const m = n === 1 ? null : meet(a, cl(a), b, cr(b));
    if (m) {
      const ui = tangentAt(a, m.ti);
      const uj = tangentAt(b, m.tj);
      const phi = Math.acos(Math.max(-1, Math.min(1, ui.x * uj.x + ui.z * uj.z)));
      if (phi < (165 * Math.PI) / 180 && phi > (8 * Math.PI) / 180) {
        let r = Math.min(a.radius, b.radius);
        let tf = r / Math.tan(phi / 2);
        const room = Math.max(0, Math.min(a.avail - m.ti, b.avail - m.tj) - 0.5);
        if (tf > room) {
          tf = room;
          r = tf * Math.tan(phi / 2);
        }
        if (r < 1) {
          r = 0;
          tf = 0;
        }
        corner = { kind: 'fillet', radius: r, di: m.ti + tf, dj: m.tj + tf, ti: m.ti, tj: m.tj, phi };
        // a raised corner wider than the arc allows ends in a point: where the two outer edges meet. Both arms
        // are cut behind that point too, so the corner wraps the whole block corner
        const wi = ol(a) - cl(a);
        const wj = cr(b) - or(b);
        if (Math.max(wi, wj) > 0.8 * r && (wi > 1e-6 || wj > 1e-6)) {
          const o = meet(a, ol(a), b, or(b));
          if (o && o.ti < a.avail && o.tj < b.avail) {
            corner.fan = { x: o.x, z: o.z, ti: o.ti, tj: o.tj };
            corner.di = Math.max(corner.di, 0);
            a.cut = Math.max(a.cut, o.ti + 0.3);
            b.cut = Math.max(b.cut, o.tj + 0.3);
          }
        }
      }
    }
    if (!corner) {
      const p = edgePoint(a, cl(a), 0);
      const q = edgePoint(b, cr(b), 0);
      const near = Math.hypot(p.x - q.x, p.z - q.z) < 1.5;
      corner = { kind: near ? 'through' : 'gap', radius: 0, di: 0, dj: 0, ti: 0, tj: 0, phi: Math.PI };
    }
    corners.push(corner);
    a.cut = Math.max(a.cut, corner.di + 0.3, minCut);
    b.cut = Math.max(b.cut, corner.dj + 0.3, minCut);
  }
  // the whole surfaces of two neighbouring arms, raised edges too, are clear of each other beyond their cut lines:
  // both arms are cut behind the point where their outer edges cross (an acute corner, a footpath wider than the
  // arc). Arms that never cross within their room run side by side: the edges give way there (edges.ts)
  if (n > 1) {
    for (let i = 0; i < n; i++) {
      const a = arms[i] as ArmPlan;
      const b = arms[(i + 1) % n] as ArmPlan;
      const o = meet(a, ol(a), b, or(b));
      if (!o || o.ti < 0 || o.tj < 0 || o.ti > a.avail || o.tj > b.avail) continue;
      a.cut = Math.max(a.cut, o.ti + 0.3);
      b.cut = Math.max(b.cut, o.tj + 0.3);
    }
  }
  // an arm may ask for a longer cut of its own (room for a connecting lane path to turn on its radius)
  for (const a of arms) a.cut = Math.min(Math.max(a.cut, minCutOf ? minCutOf(a.end) : 0), Math.max(minCut, a.avail, minCutOf ? minCutOf(a.end) : 0));

  const plan: JunctionPlan = { id, nodes: nodeIds, centre, arms, corners: [], ring: [], bands: [], method: 'J1' };
  const fill = (): void => {
    plan.corners = [];
    plan.ring = [];
    plan.bands = [];
    for (let i = 0; i < n; i++) {
      const a = arms[i] as ArmPlan;
      const b = arms[(i + 1) % n] as ArmPlan;
      const c = corners[i] as Corner;
      // the cut line of arm i, from its right carriageway edge to its left one
      for (let k = a.coreLast + 1; k >= a.coreFirst; k--) plan.ring.push({ kind: 'cut', arm: i, border: k });
      const wi = ol(a) - cl(a);
      const wj = cr(b) - or(b);
      const band = wi > 1e-6 || wj > 1e-6;
      const path: P2[] = [];
      const outer: P2[] = [];
      const add = (p: P2, q: P2): void => {
        path.push(p);
        outer.push(q);
      };
      if (n === 1) {
        // a road end: no corner, the cut line closes the ring
      } else if (c.kind === 'fillet') {
        const q: P2 | null = band && c.fan ? { x: c.fan.x, z: c.fan.z } : null;
        // the outer edge of each arm, but never past the point where the two outer edges meet
        const outerA = (t: number): P2 => (q && c.fan && t < c.fan.ti ? q : edgePoint(a, ol(a), t));
        const outerB = (t: number): P2 => (q && c.fan && t < c.fan.tj ? q : edgePoint(b, or(b), t));
        for (const t of samplesDown(a.cut, c.di)) add(edgePoint(a, cl(a), t), outerA(t));
        if (c.radius > 0) {
          add(edgePoint(a, cl(a), c.di), outerA(c.di));
          const alpha = Math.PI - c.phi;
          const k = (4 / 3) * Math.tan(alpha / 4) * c.radius;
          const p0 = edgePoint(a, cl(a), c.di);
          const p3 = edgePoint(b, cr(b), c.dj);
          const ui = tangentAt(a, c.di);
          const uj = tangentAt(b, c.dj);
          const p1 = { x: p0.x - ui.x * k, z: p0.z - ui.z * k };
          const p2 = { x: p3.x - uj.x * k, z: p3.z - uj.z * k };
          const segs = Math.max(3, Math.ceil(alpha / ((12 * Math.PI) / 180)));
          for (let s = 1; s < segs; s++) {
            const t = s / segs;
            const u = 1 - t;
            const p = { x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, z: u * u * u * p0.z + 3 * u * u * t * p1.z + 3 * u * t * t * p2.z + t * t * t * p3.z };
            // tangent of the curve, then the side away from the junction (the right of the walk around it)
            const d = unit(3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x), 3 * u * u * (p1.z - p0.z) + 6 * u * t * (p2.z - p1.z) + 3 * t * t * (p3.z - p2.z));
            const w = lerp(wi, wj, t);
            add(p, q ?? { x: p.x - d.z * w, z: p.z + d.x * w });
          }
          add(edgePoint(b, cr(b), c.dj), outerB(c.dj));
        } else {
          // a sharp corner: the meeting point itself, and the meeting point of the outer edges
          const o = band ? meet(a, ol(a), b, or(b)) : null;
          add(edgePoint(a, cl(a), c.di), q ?? (o ? { x: o.x, z: o.z } : edgePoint(a, ol(a), c.di)));
        }
        for (const t of samplesDown(c.dj, b.cut)) add(edgePoint(b, cr(b), t), outerB(t));
      } else if (c.kind === 'through') {
        for (const t of samplesDown(a.cut, 0)) add(edgePoint(a, cl(a), t), edgePoint(a, ol(a), t));
        const p = edgePoint(a, cl(a), 0);
        const q = edgePoint(b, cr(b), 0);
        const po = edgePoint(a, ol(a), 0);
        const qo = edgePoint(b, or(b), 0);
        add({ x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 }, { x: (po.x + qo.x) / 2, z: (po.z + qo.z) / 2 });
        for (const t of samplesDown(0, b.cut)) add(edgePoint(b, cr(b), t), edgePoint(b, or(b), t));
      }
      if (c.kind === 'gap' && n > 1) {
        // two arms that do not meet (the two carriageways of a street, slip roads either side of a flyover): the
        // ring runs out along both cut lines to the arms' outer edges and closes with one chord, the median nose
        const j = (i + 1) % n;
        for (let k = a.coreFirst - 1; k >= 0; k--) plan.ring.push({ kind: 'cut', arm: i, border: k });
        // a kerb along the nose: a raised strip just inside the chord, between the ends of the two arms' kerbs
        const d = edgePoint(a, ol(a), a.cut);
        const e = edgePoint(b, or(b), b.cut);
        const din = edgePoint(a, ol(a), a.cut - KERB_WIDTH);
        const ein = edgePoint(b, or(b), b.cut - KERB_WIDTH);
        if (Math.hypot(e.x - d.x, e.z - d.z) > 0.5) {
          const pd: RingItem = { kind: 'pt', x: din.x, z: din.z, corner: i, frac: 0 };
          const pe: RingItem = { kind: 'pt', x: ein.x, z: ein.z, corner: i, frac: 1 };
          plan.ring.push(pd, pe);
          plan.bands.push({ ring: [pd, pe, { kind: 'cut', arm: j, border: b.borders.length - 1 }, { kind: 'cut', arm: i, border: 0 }], inner: 2, skirt: [true, true, false, true] });
        }
        for (let k = b.borders.length - 1; k > b.coreLast + 1; k--) plan.ring.push({ kind: 'cut', arm: j, border: k });
        plan.corners.push({ kind: 'gap', radius: 0, path: [], outer: [] });
        continue;
      }
      const len: number[] = [0];
      const startP = edgePoint(a, cl(a), a.cut);
      const all = [startP, ...path, edgePoint(b, cr(b), b.cut)];
      for (let k = 1; k < all.length; k++) len.push((len[k - 1] as number) + Math.hypot((all[k] as P2).x - (all[k - 1] as P2).x, (all[k] as P2).z - (all[k - 1] as P2).z));
      const total = Math.max(1e-9, len[len.length - 1] as number);
      const items: RingItem[] = path.map((p, k) => ({ kind: 'pt', x: p.x, z: p.z, corner: i, frac: (len[k + 1] as number) / total }));
      plan.ring.push(...items);
      plan.corners.push({ kind: n === 1 ? 'gap' : c.kind, radius: c.radius, path, outer: band ? outer : [] });
      if (band && n > 1) {
        const ring: RingItem[] = [{ kind: 'cut', arm: i, border: a.coreFirst }, ...items];
        const inner = ring.length + 1;
        // down arm j's cut line from its carriageway edge to its outer edge
        const j = (i + 1) % n;
        for (let k = b.coreLast + 1; k <= b.borders.length - 1; k++) ring.push({ kind: 'cut', arm: j, border: k });
        // back along the outer edge
        let lastKey = '';
        for (let k = outer.length - 1; k >= 0; k--) {
          const q = outer[k] as P2;
          const key = `${q.x.toFixed(4)},${q.z.toFixed(4)}`;
          if (key === lastKey) continue;
          lastKey = key;
          ring.push({ kind: 'pt', x: q.x, z: q.z, corner: i, frac: (len[k + 1] as number) / total });
        }
        // up arm i's cut line from its outer edge to (not including) its carriageway edge
        for (let k = 0; k < a.coreFirst; k++) ring.push({ kind: 'cut', arm: i, border: k });
        plan.bands.push({ ring, inner });
      }
    }
  };
  fill();
  const ok = (): string | null => {
    const ring = resolvePlan(plan, plan.ring);
    if (ring.length < 3) return 'fewer than three ring points';
    if (selfCrossing(ring)) return 'the ring crosses itself';
    if (Math.abs(area2(ring)) < 1) return 'the ring has no area';
    return null;
  };
  let why = n < 2 ? null : ok();
  if (why) {
    // the fallback: cut every arm on a circle and join the cut lines by chords
    plan.method = 'J2';
    plan.why = why;
    let radius = Math.max(...arms.map((a) => Math.hypot(a.curve.at(0).x - centre.x, a.curve.at(0).z - centre.z) + Math.max(ol(a), -or(a)) + 4));
    for (let tries = 0; tries < 8; tries++) {
      for (const a of arms) {
        let t = 0;
        while (t < a.avail && Math.hypot(a.curve.at(t).x - centre.x, a.curve.at(t).z - centre.z) < radius) t += 0.5;
        a.cut = Math.max(minCut, t, minCutOf ? minCutOf(a.end) : 0);
      }
      plan.ring = [];
      plan.bands = [];
      plan.corners = arms.map(() => ({ kind: 'gap' as const, radius: 0, path: [], outer: [] }));
      for (let i = 0; i < n; i++) {
        const a = arms[i] as ArmPlan;
        for (let k = a.borders.length - 1; k >= 0; k--) plan.ring.push({ kind: 'cut', arm: i, border: k });
      }
      why = ok();
      if (!why) break;
      radius *= 1.3;
    }
    if (why) plan.why = `${plan.why}; fallback: ${why}`;
  }
  for (const a of arms) {
    const p = plans[a.end.edge] as EdgePlan;
    if (a.end.atStart) p.t0 = Math.max(p.t0, a.cut);
    else p.t1 = Math.min(p.t1, p.edge.len - a.cut);
  }
  return plan;
}

/** The planned position of a ring (cut vertices from the arm curves, not yet the exact strip vertices). */
export function resolvePlan(plan: JunctionPlan, items: readonly RingItem[]): P2[] {
  const out: P2[] = [];
  for (const it of items) {
    let p: P2;
    if (it.kind === 'pt') p = { x: it.x, z: it.z };
    else {
      const a = plan.arms[it.arm] as ArmPlan;
      p = edgePoint(a, a.borders[it.border] as number, a.cut);
    }
    const last = out[out.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.z - p.z) > 1e-6) out.push(p);
  }
  if (out.length > 1 && Math.hypot((out[0] as P2).x - (out[out.length - 1] as P2).x, (out[0] as P2).z - (out[out.length - 1] as P2).z) < 1e-6) out.pop();
  return out;
}
