// Edges give way (P1-031): where two strips lie side by side, closer than their footpaths and kerbs allow, the edge
// lanes (footpath, kerb, planter, a parking bay behind a planter) of each narrow until the two surfaces no longer
// share area. The carriageways are never touched: two carriageways on each other are the repair layer's (rule
// R-LANE-06 shifts the centre lines) or the junction's (its cut lines). A strip's edge is only the lane borders at its
// stations, so a footpath that narrows beside another road is plain data, like a taper (model.ts).
//
// Each round finds every pair of quads that share area (overlap.ts). For each strip of a pair whose shared polygon
// lies wholly in its edge band on one side, the outer border at the quad's two stations moves in: half way through
// the polygon when the other strip gives way too, all the way when it cannot (a hero road keeps its spec; a polygon
// that reaches its carriageway). Rounds repeat until nothing overlaps in the edge bands. Then each edge narrows at
// most one metre per two metres along the strip (only ever narrower, so no overlap comes back), and both strips at a
// joint take the narrower edge. With the solved station kinds (`kinds`, after the elevation step) the same runs once
// more on the levels the heights gave: a ramp on fill beside a road at grade has its kerb on that road's kerb, which
// the tags (a bridge) do not show (P1-042). Pure.
import { coreRange } from './model.ts';
import type { Joint, Station, Strip } from './model.ts';
import { stripOverlaps } from './overlap.ts';
import type { QuadTri } from './overlap.ts';

/** How fast a trimmed edge may change its width along the strip (m per m). */
export const EDGE_SLOPE = 0.5;
const MARGIN_M = 0.005;
const ROUNDS = 10;

export interface EdgeTrims {
  /** Strips with an edge narrowed somewhere, stations narrowed, and the edge area given up (m2). */
  strips: number;
  stations: number;
  areaM2: number;
  rounds: number;
}

type Side = 'L' | 'R';

interface Frame {
  cf: number;
  /** Border index of the right carriageway edge (coreLast + 1). */
  cr: number;
}

const lat = (st: Station, x: number, z: number): number => (x - st.x) * st.nx + (z - st.z) * st.nz;

/** Outer border lateral of one side, and its carriageway edge. */
const outerOf = (st: Station, side: Side): number => (side === 'L' ? (st.b[0] as number) : (st.b[st.b.length - 1] as number));
const coreOf = (st: Station, f: Frame, side: Side): number => (side === 'L' ? (st.b[f.cf] as number) : (st.b[f.cr] as number));
const widthOf = (st: Station, f: Frame, side: Side): number => Math.abs(outerOf(st, side) - coreOf(st, f, side));

/** Moves the outer border of one side to `outer` (never past the carriageway edge, never wider than now). */
function setOuter(st: Station, f: Frame, side: Side, outer: number): void {
  const n = st.b.length - 1;
  if (side === 'L') {
    const to = Math.max(st.b[f.cf] as number, Math.min(st.b[0] as number, outer));
    for (let k = 0; k < f.cf; k++) st.b[k] = Math.min(st.b[k] as number, to);
  } else {
    const to = Math.min(st.b[f.cr] as number, Math.max(st.b[n] as number, outer));
    for (let k = f.cr + 1; k <= n; k++) st.b[k] = Math.max(st.b[k] as number, to);
  }
}

/**
 * The side of the strip's edge band the polygon lies on at this station (the side of the carriageway's middle its
 * middle is on), or null when no edge there reaches into it (it lies on the carriageway, or that side has no edge).
 */
function bandSide(st: Station, f: Frame, poly: readonly [number, number][]): { side: Side; lo: number; hi: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const [x, z] of poly) {
    const l = lat(st, x, z);
    lo = Math.min(lo, l);
    hi = Math.max(hi, l);
  }
  const cl = st.b[f.cf] as number;
  const cr = st.b[f.cr] as number;
  if ((lo + hi) / 2 >= (cl + cr) / 2) return hi > cl + 1e-6 && (st.b[0] as number) - cl > 1e-6 ? { side: 'L', lo, hi } : null;
  return lo < cr - 1e-6 && cr - (st.b[st.b.length - 1] as number) > 1e-6 ? { side: 'R', lo, hi } : null;
}

export function giveWay(strips: readonly Strip[], joints: readonly Joint[], kinds?: readonly ArrayLike<number>[]): EdgeTrims {
  const frames: Frame[] = strips.map((s) => {
    const [cf, cl] = coreRange(s.lanes);
    return { cf, cr: cl + 1 };
  });
  const before = strips.map((s, i) => s.st.map((st) => [widthOf(st, frames[i] as Frame, 'L'), widthOf(st, frames[i] as Frame, 'R')] as [number, number]));
  const can = (t: QuadTri): boolean => (strips[t.strip] as Strip).hero === null;
  let rounds = 0;
  for (; rounds < ROUNDS; rounds++) {
    const { overlaps } = stripOverlaps(strips, joints, undefined, kinds);
    /** New outer border per strip station side: the smallest move wins. */
    const want = new Map<string, number>();
    const ask = (strip: number, k: number, side: Side, outer: number): void => {
      const key = `${strip}:${k}:${side}`;
      const now = want.get(key);
      if (now === undefined || (side === 'L' ? outer < now : outer > now)) want.set(key, outer);
    };
    for (const o of overlaps) {
      const sa = strips[o.a.strip] as Strip;
      const sb = strips[o.b.strip] as Strip;
      const fa = frames[o.a.strip] as Frame;
      const fb = frames[o.b.strip] as Frame;
      const ba = can(o.a) ? bandSide(sa.st[o.a.quad] as Station, fa, o.poly) : null;
      const bb = can(o.b) ? bandSide(sb.st[o.b.quad] as Station, fb, o.poly) : null;
      if (!ba && !bb) continue;
      for (const [t, s, side, other] of [[o.a, sa, ba, bb], [o.b, sb, bb, ba]] as const) {
        if (!side) continue;
        // half way through the shared polygon when the other strip gives way too, else all the way
        const keep = other ? 0.5 : 0;
        for (const k of [t.quad, t.quad + 1]) {
          const st = s.st[k] as Station;
          let lo = Infinity;
          let hi = -Infinity;
          for (const [x, z] of o.poly) {
            const l = lat(st, x, z);
            lo = Math.min(lo, l);
            hi = Math.max(hi, l);
          }
          const target = side.side === 'L' ? lo + keep * (hi - lo) - MARGIN_M : hi - keep * (hi - lo) + MARGIN_M;
          ask(t.strip, k, side.side, target);
        }
      }
    }
    if (want.size === 0) break;
    let moved = 0;
    for (const [key, outer] of want) {
      const [si, k, side] = key.split(':') as [string, string, Side];
      const s = strips[Number(si)] as Strip;
      const st = s.st[Number(k)] as Station;
      const f = frames[Number(si)] as Frame;
      const was = outerOf(st, side);
      setOuter(st, f, side, outer);
      if (Math.abs(outerOf(st, side) - was) > 1e-6) moved++;
    }
    if (moved === 0) break;
  }
  // an edge narrows over a length, not in a step; then both strips at a joint take the narrower edge
  for (let pass = 0; pass < 2; pass++) {
    strips.forEach((s, i) => {
      if (s.hero === null) smooth(s, frames[i] as Frame, before[i] as [number, number][]);
    });
    unifyJoints(strips, joints, frames);
  }
  let stations = 0;
  let area = 0;
  const touched = new Set<number>();
  strips.forEach((s, i) => {
    const was = before[i] as [number, number][];
    const f = frames[i] as Frame;
    s.st.forEach((st, k) => {
      const lost = (was[k] as [number, number])[0] - widthOf(st, f, 'L') + (was[k] as [number, number])[1] - widthOf(st, f, 'R');
      if (lost > 1e-4) {
        stations++;
        touched.add(i);
        const prev = s.st[k - 1];
        const next = s.st[k + 1];
        const span = ((prev ? Math.hypot(st.x - prev.x, st.z - prev.z) : 0) + (next ? Math.hypot(st.x - next.x, st.z - next.z) : 0)) / 2;
        area += lost * span;
      }
    });
  });
  return { strips: touched.size, stations, areaM2: Math.round(area * 10) / 10, rounds };
}

/**
 * The raised edge widths every junction arm meets at its strip end, [left, right] looking away from the junction
 * (P1-033): the junction builder's raised corners take these, not the nominal cross-section. Written into the arms.
 */
export function armEdges(strips: readonly Strip[], junctions: readonly { arms: { strip: number; end: 'start' | 'end'; edges: [number, number] }[] }[]): void {
  const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
  for (const j of junctions) {
    for (const a of j.arms) {
      const s = strips[a.strip] as Strip;
      const [cf, cl] = coreRange(s.lanes);
      const f: Frame = { cf, cr: cl + 1 };
      const st = (a.end === 'start' ? s.st[0] : s.st[s.st.length - 1]) as Station;
      const l = widthOf(st, f, 'L');
      const r = widthOf(st, f, 'R');
      // looking away from the junction runs with the station order at a start, against it at an end
      a.edges = a.end === 'start' ? [r3(l), r3(r)] : [r3(r), r3(l)];
    }
  }
}

/** Each edge narrows at most EDGE_SLOPE metres per metre along the strip: a trim spreads to its neighbours. */
function smooth(s: Strip, f: Frame, was: readonly [number, number][]): void {
  const n = s.st.length;
  const d: number[] = [0];
  for (let k = 1; k < n; k++) d.push(Math.hypot((s.st[k] as Station).x - (s.st[k - 1] as Station).x, (s.st[k] as Station).z - (s.st[k - 1] as Station).z));
  for (const [side, col] of [['L', 0], ['R', 1]] as const) {
    const w = s.st.map((st) => widthOf(st, f, side));
    if (!w.some((v, k) => v < ((was[k] as [number, number])[col] as number) - 1e-6)) continue;
    for (let k = 1; k < n; k++) w[k] = Math.min(w[k] as number, (w[k - 1] as number) + EDGE_SLOPE * (d[k] as number));
    for (let k = n - 2; k >= 0; k--) w[k] = Math.min(w[k] as number, (w[k + 1] as number) + EDGE_SLOPE * (d[k + 1] as number));
    s.st.forEach((st, k) => {
      const core = coreOf(st, f, side);
      setOuter(st, f, side, side === 'L' ? core + (w[k] as number) : core - (w[k] as number));
    });
  }
}

/** Both strips at a joint keep the same edge on a side whose carriageway edges meet there. */
function unifyJoints(strips: readonly Strip[], joints: readonly Joint[], frames: readonly Frame[]): void {
  const endSt = (s: Strip, end: 'start' | 'end'): Station => (end === 'start' ? s.st[0] : s.st[s.st.length - 1]) as Station;
  for (const j of joints) {
    const sa = strips[j.a.strip] as Strip;
    const sb = strips[j.b.strip] as Strip;
    if (sa.hero !== null || sb.hero !== null) continue;
    const pa = endSt(sa, j.a.end);
    const pb = endSt(sb, j.b.end);
    const fa = frames[j.a.strip] as Frame;
    const fb = frames[j.b.strip] as Frame;
    const same = pa.nx * pb.nx + pa.nz * pb.nz > 0;
    for (const side of ['L', 'R'] as const) {
      const other: Side = same ? side : side === 'L' ? 'R' : 'L';
      const ca = coreOf(pa, fa, side);
      const cb = coreOf(pb, fb, other);
      const ax = pa.x + pa.nx * ca;
      const az = pa.z + pa.nz * ca;
      const bx = pb.x + pb.nx * cb;
      const bz = pb.z + pb.nz * cb;
      if (Math.hypot(ax - bx, az - bz) > 0.05) continue;
      const w = Math.min(widthOf(pa, fa, side), widthOf(pb, fb, other));
      setOuter(pa, fa, side, side === 'L' ? ca + w : ca - w);
      setOuter(pb, fb, other, other === 'L' ? cb + w : cb - w);
    }
  }
}
