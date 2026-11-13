// Junction surfaces (P1-014, ARCH_OPTIONS J3). J1: the planned ring of junction.ts (the arms' cut lines joined by
// corner arcs, a median nose between the two carriageways of a street) with every cut vertex taken from the strip
// itself, and the raised corner bands outside it, their outer edge drawn in to the width the arm's edge has left
// after the edges gave way (LaneArm.edges). J2, the polygon set, in two roles. As the fallback for a cluster the
// construction cannot solve (the planner gave up, or the planned ring crosses itself on the strips' own vertices):
// the surface is the union of the corridors of the junction's connecting lane paths and a mouth at every arm, closed
// over gaps narrower than a lane, so it is road where traffic runs and nowhere else. As the guard for every face:
// a face that lies on a neighbour (a strip, another junction) is cut back to what is free; a band that crosses
// itself becomes its filled outline. A face that needs no help is never touched: its vertices stay the strips' own.
// Pure.
import { area2, lerp, selfCrossing } from '../roads/curve.ts';
import { KERB_RAISE } from '../roads/model.ts';
import type { Station, Strip } from '../roads/model.ts';
import { coreRange } from '../roads/model.ts';
import { CLIP_SCALE, minus, ringAreaM2, sharedArea, toPaths, pathsArea, trimWhiskers } from './clip.ts';
import type { Origin } from './clip.ts';
import type { Corner, FaceSet } from './faces.ts';
import type { MeshArm, MeshInput, MeshRingItem } from './input.ts';
import { StripIndex, borderX, borderZ, cutOf, sheetOf } from './stripfaces.ts';
import { EndType, FillRule, JoinType, inflatePaths, intersect, union } from 'clipper2-ts';
import type { Path64, Paths64 } from 'clipper2-ts';

/** A face may lie on its neighbours by this much before the polygon set cuts it (m2): float noise at shared edges. */
export const CLIP_EPS_M2 = 0.002;

/** Gaps between lane corridors narrower than twice this are closed (m): no island thinner than a lane. */
export const CLOSE_M = 2.5;
/** A corner the polygon set made within this distance of a vertex that is already there is that vertex (m). */
export const SNAP_M = 0.004;
/** A polygon set mouth reaches this far out over its arm before the arm's end quad is taken off (m). */
export const MOUTH_OUT_M = 0.2;
/** A corner the polygon set made this close to an arm's cut line is put on it (m): the closing works to millimetres. */
export const CUT_SNAP_M = 0.006;
/** A polygon set corner this close to the edge of a strip or a junction built before takes its height there (m) ... */
export const MEET_TOL_M = 0.003;
/** ... unless the two differ by more than this (m): then the step is a wall (a ramp on fill beside the junction). */
export const MEET_MAX_M = 1.0;
/** Each lane corridor is this much wider than its lane on both sides (m). */
export const CORRIDOR_MARGIN_M = 0.4;

export interface JunctionFaces {
  /** Face numbers of every junction, in input order. */
  faces: number[][];
  sheets: number[];
  j1: number;
  /** Surfaces the polygon set made from the lane path corridors: the planner's own fallback, no usable plan, or a planned ring that crossed itself. */
  j2: number;
  /** Face numbers the polygon set made or cut. */
  setFaces: Set<number>;
  /** Faces cut back because they lay on a neighbour, and the junctions they belong to. */
  clippedFaces: number;
  clippedJunctions: number;
  clippedAreaM2: number;
  bands: number;
  /** Bands whose ring crossed itself with the strips' own vertices: the polygon set took their filled outline. */
  crossedBands: number;
  /** Bands left out: no area left, or turned inside out (the outer edges of two arms cross). */
  droppedBands: number;
  /** Holes the polygon set found inside a face (a neighbour wholly inside it): the face was cut in two through each. */
  holes: number;
  /** Corners of polygon set faces that took the height of the strip edge they lie on. */
  heightsTaken: number;
  list: { id: string; what: string }[];
}

/** A polygon set surface reaches at most this far outside the hull of its arms' cut lines (m). */
export const HULL_MARGIN_M = 6;

/** Convex hull of integer points (monotone chain), counter-clockwise. */
function convexHull(pts: Path64): Path64 {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Path64[number], a: Path64[number], b: Path64[number]): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Path64 = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Path64 = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

const endStation = (strips: readonly Strip[], a: { strip: number; end: 'start' | 'end' }): Station => {
  const s = strips[a.strip] as Strip;
  return (a.end === 'start' ? s.st[0] : s.st[s.st.length - 1]) as Station;
};

interface Reg {
  ring: [number, number][];
  /** Carriageway height at every ring point (the top less the face's raise). */
  ys: number[];
  sheet: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const boxOf = (rings: readonly (readonly (readonly [number, number])[])[]): { minX: number; maxX: number; minZ: number; maxZ: number } => {
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const r of rings) {
    for (const [x, z] of r) {
      b.minX = Math.min(b.minX, x);
      b.maxX = Math.max(b.maxX, x);
      b.minZ = Math.min(b.minZ, z);
      b.maxZ = Math.max(b.maxZ, z);
    }
  }
  return b;
};

export function addJunctionFaces(fs: FaceSet, input: MeshInput, index: StripIndex): JunctionFaces {
  const { strips, kinds } = input;
  const out: JunctionFaces = { faces: [], sheets: [], j1: 0, j2: 0, setFaces: new Set(), clippedFaces: 0, clippedJunctions: 0, clippedAreaM2: 0, bands: 0, crossedBands: 0, droppedBands: 0, holes: 0, heightsTaken: 0, list: [] };
  const note = (id: string, what: string): void => {
    if (out.list.length < 400) out.list.push({ id, what });
  };
  // faces of the junctions built so far, on a grid
  const REG_CELL = 32;
  const reg = new Map<number, Reg[]>();
  const regKey = (x: number, z: number): number => (x + 100000) * 262144 + (z + 100000);
  const register = (r: Reg): void => {
    for (let x = Math.floor(r.minX / REG_CELL); x <= Math.floor(r.maxX / REG_CELL); x++) {
      for (let z = Math.floor(r.minZ / REG_CELL); z <= Math.floor(r.maxZ / REG_CELL); z++) {
        const list = reg.get(regKey(x, z));
        if (list) list.push(r);
        else reg.set(regKey(x, z), [r]);
      }
    }
  };
  /** The carriageway height of a junction face built before, at a point on one of its edges (within `tol`), or null. */
  const builtHeight = (x: number, z: number, sheet: number, tol: number): number | null => {
    for (const r of reg.get(regKey(Math.floor(x / REG_CELL), Math.floor(z / REG_CELL))) ?? []) {
      if (r.sheet !== sheet || x < r.minX - tol || x > r.maxX + tol || z < r.minZ - tol || z > r.maxZ + tol) continue;
      for (let k = 0; k < r.ring.length; k++) {
        const p = r.ring[k] as [number, number];
        const q = r.ring[(k + 1) % r.ring.length] as [number, number];
        const dx = q[0] - p[0];
        const dz = q[1] - p[1];
        const len2 = dx * dx + dz * dz;
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((x - p[0]) * dx + (z - p[1]) * dz) / len2)) : 0;
        if (Math.hypot(x - p[0] - dx * t, z - p[1] - dz * t) <= tol) return (r.ys[k] as number) + ((r.ys[(k + 1) % r.ring.length] as number) - (r.ys[k] as number)) * t;
      }
    }
    return null;
  };
  const registered = (b: { minX: number; maxX: number; minZ: number; maxZ: number }, sheet: number): [number, number][][] => {
    const seen = new Set<Reg>();
    for (let x = Math.floor(b.minX / REG_CELL); x <= Math.floor(b.maxX / REG_CELL); x++) {
      for (let z = Math.floor(b.minZ / REG_CELL); z <= Math.floor(b.maxZ / REG_CELL); z++) {
        for (const r of reg.get(regKey(x, z)) ?? []) if (r.sheet === sheet && r.minX <= b.maxX && r.maxX >= b.minX && r.minZ <= b.maxZ && r.maxZ >= b.minZ) seen.add(r);
      }
    }
    return [...seen].map((r) => r.ring);
  };

  input.junctions.forEach((j, ji) => {
    const piece = strips.length + ji;
    const n = j.arms.length;
    const st = j.arms.map((a) => endStation(strips, a));
    const kindAt = (a: MeshArm): number => (kinds[a.strip] as ArrayLike<number>)[a.end === 'start' ? 0 : (strips[a.strip] as Strip).st.length - 1] as number;
    const armKinds = j.arms.map(kindAt);
    // the junction lies on the sheet most of its arms end on, and the ground meets it as it meets them
    const sheets = j.arms.map((_, i) => sheetOf(st[i] as Station, armKinds[i] as number));
    const sheet = sheets.slice().sort((a, b) => sheets.filter((v) => v === b).length - sheets.filter((v) => v === a).length || a - b)[0] as number;
    const cut = armKinds.reduce((c, k) => Math.max(c, cutOf(k, k)), 0);
    // to the left of an arm, looking away from the junction
    const leftOf = (i: number): { x: number; z: number } => {
      const s = st[i] as Station;
      const sign = (j.arms[i] as MeshArm).end === 'start' ? 1 : -1;
      return { x: s.nx * sign, z: s.nz * sign };
    };
    const share = (i: number, side: 0 | 1): number => {
      const a = j.arms[i] as MeshArm;
      return a.nominal[side] > 1e-6 ? Math.min(1, a.edges[side] / a.nominal[side]) : 1;
    };
    const gapPoint = (it: Extract<MeshRingItem, { kind: 'pt' }>): [number, number] => {
      // a median nose: its two points follow the arms' outer edges where those gave way
      const i = it.frac < 0.5 ? it.corner : (it.corner + 1) % n;
      const side: 0 | 1 = it.frac < 0.5 ? 0 : 1;
      const a = j.arms[i] as MeshArm;
      const d = leftOf(i);
      const move = (a.edges[side] - a.nominal[side]) * (side === 0 ? 1 : -1);
      return [it.x + d.x * move, it.z + d.z * move];
    };
    const corner = (it: MeshRingItem, raise: number, kerbLine?: readonly Extract<MeshRingItem, { kind: 'pt' }>[]): Corner => {
      if (it.kind === 'cut') {
        const s = st[it.arm] as Station;
        return { x: borderX(s, it.border), z: borderZ(s, it.border), y: s.h + raise };
      }
      const y = lerp((st[it.corner] as Station).h, (st[(it.corner + 1) % n] as Station).h, it.frac) + raise;
      if (j.corners[it.corner]?.kind === 'gap') {
        const [x, z] = gapPoint(it);
        return { x, z, y };
      }
      if (kerbLine && kerbLine.length) {
        // the outer edge of a raised corner: drawn in towards the kerb line by what the arms' edges have left
        let best = kerbLine[0] as Extract<MeshRingItem, { kind: 'pt' }>;
        for (const p of kerbLine) if (Math.abs(p.frac - it.frac) < Math.abs(best.frac - it.frac)) best = p;
        const s = lerp(share(it.corner, 0), share((it.corner + 1) % n, 1), it.frac);
        return { x: best.x + (it.x - best.x) * s, z: best.z + (it.z - best.z) * s, y };
      }
      return { x: it.x, z: it.z, y };
    };
    const dedupe = (ring: Corner[]): Corner[] => {
      const o: Corner[] = [];
      for (const c of ring) {
        const last = o[o.length - 1];
        if (last && Math.hypot(last.x - c.x, last.z - c.z) < 1e-4) continue;
        o.push(c);
      }
      while (o.length > 1 && Math.hypot((o[0] as Corner).x - (o[o.length - 1] as Corner).x, (o[0] as Corner).z - (o[o.length - 1] as Corner).z) < 1e-4) o.pop();
      return o;
    };
    const flat = (ring: readonly Corner[]): [number, number][] => ring.map((c) => [c.x, c.z]);
    const simple = (ring: readonly Corner[], minArea: number): boolean => ring.length >= 3 && Math.abs(area2(ring)) >= minArea && !selfCrossing(ring);

    // every border of every arm's cut line, right to left looking away, arm after arm: where the heights of a set-made face come from
    const chordRing = (): Corner[] => {
      const ring: Corner[] = [];
      j.arms.forEach((a, i) => {
        const s = st[i] as Station;
        const last = s.b.length - 1;
        for (let k = 0; k <= last; k++) {
          const border = a.end === 'start' ? last - k : k;
          ring.push({ x: borderX(s, border), z: borderZ(s, border), y: s.h });
        }
      });
      return dedupe(ring);
    };

    const o: Origin = { x: j.centre.x, z: j.centre.z };
    // J2: the corridors of the connecting lane paths and a mouth across every arm's carriageway, closed over narrow gaps
    const corridors = (): [number, number][][] => {
      const at = (x: number, z: number): { x: number; y: number } => ({ x: Math.round((x - o.x) * CLIP_SCALE), y: Math.round((z - o.z) * CLIP_SCALE) });
      let all: Paths64 = [];
      for (const p of j.paths) {
        if (p.pts.length < 2) continue;
        all.push(...inflatePaths([p.pts.map(([x, z]) => at(x, z))], (p.width / 2 + CORRIDOR_MARGIN_M) * CLIP_SCALE, JoinType.Round, EndType.Butt, 2, 0.02 * CLIP_SCALE));
      }
      j.arms.forEach((a, i) => {
        const s = st[i] as Station;
        const [cf, cl] = coreRange((strips[a.strip] as Strip).lanes);
        const sign = a.end === 'start' ? -1 : 1;
        // towards the junction: against the station order at a start, with it at an end
        const tx = -s.nz * sign;
        const tz = s.nx * sign;
        // the mouth starts a little out on the arm: the arm's own end quad is taken off again below, so the surface
        // ends on the cut line exactly whatever level the arm is on
        all.push([at(borderX(s, cf) - tx * MOUTH_OUT_M, borderZ(s, cf) - tz * MOUTH_OUT_M), at(borderX(s, cl + 1) - tx * MOUTH_OUT_M, borderZ(s, cl + 1) - tz * MOUTH_OUT_M), at(borderX(s, cl + 1) + tx * 1.5, borderZ(s, cl + 1) + tz * 1.5), at(borderX(s, cf) + tx * 1.5, borderZ(s, cf) + tz * 1.5)]);
      });
      all = union(all, FillRule.NonZero);
      const closed = inflatePaths(inflatePaths(all, CLOSE_M * CLIP_SCALE, JoinType.Round, EndType.Polygon, 2, 0.05 * CLIP_SCALE), -CLOSE_M * CLIP_SCALE, JoinType.Round, EndType.Polygon, 2, 0.05 * CLIP_SCALE);
      // never wider than the arms' cut lines: lane paths of a cluster with no usable ring can wander a kilometre out
      // (a path between two arms that leave side by side runs out along one and back along the other)
      const hull = inflatePaths([convexHull(j.arms.flatMap((_, i) => {
        const s = st[i] as Station;
        return s.b.map((_, k) => at(borderX(s, k), borderZ(s, k)));
      }))], HULL_MARGIN_M * CLIP_SCALE, JoinType.Miter, EndType.Polygon, 2);
      return intersect(union(all, closed, FillRule.NonZero), hull, FillRule.NonZero).map((p) => p.map((q) => [q.x / CLIP_SCALE + o.x, q.y / CLIP_SCALE + o.z] as [number, number]));
    };

    let ring: Corner[] | null = j.method === 'J1' && j.ring ? dedupe(j.ring.map((it) => corner(it, 0))) : null;
    let method: 'J1' | 'J2' = j.method;
    let bands: { ring: Corner[]; crossed: boolean }[] = [];
    if (ring && !simple(ring, 0.5)) {
      note(j.id, 'the planned ring crosses itself on the strips\' own vertices: built by the polygon set');
      ring = null;
    }
    const sense = ring ? Math.sign(area2(ring)) : 0;
    if (!ring) method = 'J2';
    else {
      for (const b of j.bands) {
        const inner = b.ring.filter((it, k): it is Extract<MeshRingItem, { kind: 'pt' }> => it.kind === 'pt' && k < b.inner);
        const pts = dedupe(b.ring.map((it, k) => corner(it, KERB_RAISE, it.kind === 'pt' && k >= b.inner ? inner : undefined)));
        out.bands++;
        // no band where the edges gave way altogether; a band lies outside the ring, so it turns the other way
        if (pts.length < 3 || Math.abs(area2(pts)) < 0.01 || Math.sign(area2(pts)) === sense) out.droppedBands++;
        else {
          const crossed = selfCrossing(pts);
          if (crossed) out.crossedBands++;
          bands.push({ ring: pts, crossed });
        }
      }
    }
    if (method === 'J1') out.j1++;
    else out.j2++;

    // neighbours on the same sheet: the strips around (the arms too) and the junctions built before
    const heights = chordRing();
    const lanes = ring ? [] : corridors();
    const all = ring ? [flat(ring), ...bands.map((b) => flat(b.ring))] : lanes;
    if (!all.length) {
      note(j.id, 'no surface: the junction has no connecting lane path');
      out.faces.push([]);
      out.sheets.push(sheet);
      return;
    }
    const box = boxOf(all);
    const nearStrips = index.near(box.minX - 0.5, box.minZ - 0.5, box.maxX + 0.5, box.maxZ + 0.5, sheet);
    const neighbours: [number, number][][] = [];
    for (const rings of nearStrips.values()) neighbours.push(...rings);
    neighbours.push(...registered(box, sheet));
    // the arms' own end quads, on whatever level they are: no surface of the junction lies on its arms
    const cutLines: [number, number, number, number][] = [];
    const endLine = (si: number, end: 'start' | 'end'): [number, number][] | null => {
      const last = (strips[si] as Strip).st.length - 2;
      if (last < 0) return null;
      const q = index.quad(si, end === 'start' ? 0 : last);
      cutLines.push(end === 'start' ? [q[0]![0], q[0]![1], q[1]![0], q[1]![1]] : [q[3]![0], q[3]![1], q[2]![0], q[2]![1]]);
      return q;
    };
    for (const a of j.arms) {
      const q = endLine(a.strip, a.end);
      if (q) neighbours.push(q);
    }
    // corners made on the end line of any strip near (another junction's arm under a polygon set surface) go on it too
    for (const si of nearStrips.keys()) {
      endLine(si, 'start');
      endLine(si, 'end');
    }
    const onCut = (c: Corner): void => {
      for (const [ax, az, bx, bz] of cutLines) {
        const dx = bx - ax;
        const dz = bz - az;
        const len2 = dx * dx + dz * dz;
        if (len2 < 1e-12) continue;
        const t = ((c.x - ax) * dx + (c.z - az) * dz) / len2;
        if (t < 0 || t > 1) continue;
        const px = ax + dx * t;
        const pz = az + dz * t;
        if (Math.hypot(c.x - px, c.z - pz) > CUT_SNAP_M) continue;
        c.x = px;
        c.z = pz;
        return;
      }
    };

    const yAt = (x: number, z: number, from: readonly Corner[]): number => {
      // on a vertex or an edge of the planned face: its height there; inside: the nearest corners weighted by distance
      let wsum = 0;
      let ysum = 0;
      for (let k = 0; k < from.length; k++) {
        const a = from[k] as Corner;
        const b = from[(k + 1) % from.length] as Corner;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len2 = dx * dx + dz * dz;
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2)) : 0;
        const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
        const y = a.y + (b.y - a.y) * t;
        if (d < 5e-4) return y;
        const w = 1 / (d * d);
        wsum += w;
        ysum += w * y;
      }
      return ysum / wsum;
    };
    let clipped = 0;
    const settle = (face: Corner[], others: readonly [number, number][][], selfCross: boolean): Corner[][] => {
      let rings: [number, number][][] = [flat(face)];
      if (selfCross) {
        // a ring that crosses itself: its filled outline
        const u = union(toPaths(rings, o), FillRule.NonZero);
        rings = u.filter((p) => pathsArea([p]) > 0.005).map((p) => p.map((q) => [q.x / CLIP_SCALE + o.x, q.y / CLIP_SCALE + o.z] as [number, number]));
      }
      const lying = others.length ? sharedArea(rings, others, o) : 0;
      if (lying <= CLIP_EPS_M2 && !selfCross) return [face];
      clipped++;
      out.clippedAreaM2 += lying;
      const res = lying > CLIP_EPS_M2 ? minus(rings, others, o) : { rings, holes: 0 };
      out.holes += res.holes;
      return res.rings.map((r) => dedupe(trimWhiskers(r).map(([x, z]) => ({ x, z, y: yAt(x, z, face) })))).filter((r) => r.length >= 3);
    };
    const built: { ring: Corner[]; kind: 'junction' | 'band'; set: boolean }[] = [];
    const mine: [number, number][][] = [];
    if (ring) {
      const res = settle(ring, neighbours, false);
      for (const r of res) {
        built.push({ ring: r, kind: 'junction', set: res.length !== 1 || r !== ring });
        mine.push(flat(r));
      }
    } else {
      // the corridors, minus everything already there; heights from the arms' cut lines
      const res = minus(lanes, neighbours, o);
      out.holes += res.holes;
      for (const r of res.rings) {
        const c = dedupe(trimWhiskers(r).map(([x, z]) => ({ x, z, y: yAt(x, z, heights) })));
        if (c.length < 3) continue;
        built.push({ ring: c, kind: 'junction', set: true });
        mine.push(flat(c));
      }
    }
    for (const b of bands) {
      const res = settle(b.ring, [...neighbours, ...mine], b.crossed);
      for (const r of res) {
        if (ringAreaM2(flat(r)) < 0.01) continue;
        built.push({ ring: r, kind: 'band', set: res.length !== 1 || r !== b.ring });
        mine.push(flat(r));
      }
    }
    if (clipped) {
      out.clippedFaces += clipped;
      out.clippedJunctions++;
      note(j.id, `${clipped} face(s) lay on a neighbour and were cut back by the polygon set`);
    }
    const faces: number[] = [];
    for (const b of built) {
      if (b.set) {
        // the polygon set works to a tenth of a millimetre and its results drift by about one: a corner that is a
        // strip's own vertex goes back onto it
        for (const c of b.ring) {
          onCut(c);
          const id = fs.nearest(c.x, c.z, SNAP_M);
          if (id >= 0) {
            c.x = fs.vx[id] as number;
            c.z = fs.vz[id] as number;
          }
        }
        b.ring = dedupe(b.ring);
        if (b.ring.length < 3) continue;
        // where the face meets a strip or a junction built before, it meets it at that one's height (the spread
        // heights are a guess); a neighbour much higher or lower (a ramp on fill beside it) keeps its wall
        const raise = b.kind === 'band' ? KERB_RAISE : 0;
        for (const c of b.ring) {
          const h = index.edgeHeight(c.x, c.z, MEET_TOL_M) ?? builtHeight(c.x, c.z, sheet, MEET_TOL_M);
          if (h !== null && Math.abs(h + raise - c.y) <= MEET_MAX_M) {
            if (Math.abs(h + raise - c.y) > 1e-4) out.heightsTaken++;
            c.y = h + raise;
          }
        }
      }
      const f = fs.add(b.ring, { piece, kind: b.kind, cut, raise: b.kind === 'band' ? KERB_RAISE : 0, sheet });
      if (f < 0) continue;
      faces.push(f);
      if (b.set) out.setFaces.add(f);
      const fr = flat(b.ring);
      register({ ring: fr, ys: b.ring.map((c) => c.y - (b.kind === 'band' ? KERB_RAISE : 0)), sheet, ...boxOf([fr]) });
    }
    out.faces.push(faces);
    out.sheets.push(sheet);
  });
  out.clippedAreaM2 = Math.round(out.clippedAreaM2 * 1000) / 1000;
  return out;
}

