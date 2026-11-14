// Carriageways fitted to their reference divider (P1-034). Where a photo or satellite reading gives a divided street's
// divider (harness/data/medians.json, medianrefs.ts) narrower than the space OSM's two centre lines leave, the two
// carriageways are wider than their lane counts say (Sansad Marg, Bahadur Shah Zafar Marg, Jawaharlal Nehru Marg,
// Tilak Marg, Janpath). Until P1-034 the mesh laid that space as flat asphalt beside the divider, outside every lane.
// Now the drive lanes take it: at every station each carriageway widens towards the divider by half of what the gap
// holds beyond the divider, shared over its drive lanes (each lane at most MAX_LANE_M wide); the kerb side stays where
// it is and no centre line moves. Along an edge the widening changes no faster than the class taper rate, so a kink in
// OSM's lines does not make the lanes jump. Changes the strips' borders in place. Pure.
import type { GraphEdge } from '../graph/build.ts';
import { refFor } from './medianrefs.ts';
import type { MedianRef } from './medianrefs.ts';
import { MIN_DRIVE_LANE_M, classDefaults } from './model.ts';
import type { Joint, LaneDef, Strip } from './model.ts';

/** A drive lane fitted to a divider is at most this wide (m); a gap it cannot take is left to the mesh as asphalt. */
export const MAX_LANE_M = 4.5;
/** Two carriageways further apart than this have a park or a block between them, not a divider (mesh/medianfaces.ts MAX_GAP_M). */
const MAX_GAP_M = 12;
/** Each side stops this short of half the gap (m): the two never meet in float noise. */
const SLACK_M = 0.01;

export interface DividerFit {
  /** Strips widened, stations widened, and the most a carriageway grew (m). */
  strips: number;
  stations: number;
  maxM: number;
  /** Stations with a reference divider across a gap wider than it, and of those the ones whose lanes reach it (not held back by the taper rate or MAX_LANE_M). */
  reach: { asked: number; fitted: number };
  byStreet: Record<string, { stations: number; meanM: number; maxM: number }>;
  /** Carriageways that took a higher lane count from the space up to their divider (dividerLanes, set by network.ts). */
  lanesSet?: number;
  /** The widening of every widened strip, station by station (m; not in the report). */
  widened: Record<number, Float64Array>;
}

const medianSide = (s: Strip): boolean => (s.lanes[s.lanes.length - 1] as LaneDef | undefined)?.type === 'median';

/** The median-side border points of a set of strips, in order (strip by strip). */
function borderOf(list: readonly number[], strips: readonly Strip[]): { x: number[]; z: number[]; edge: string[]; layer: number[] } {
  const out = { x: [] as number[], z: [] as number[], edge: [] as string[], layer: [] as number[] };
  for (const si of list) {
    const s = strips[si] as Strip;
    if (!medianSide(s)) continue;
    for (const st of s.st) {
      const b = st.b[st.b.length - 1] as number;
      out.x.push(st.x + st.nx * b);
      out.z.push(st.z + st.nz * b);
      out.edge.push(s.edge);
      out.layer.push(st.bridge ? 1000 + st.layer : st.layer);
    }
  }
  return out;
}

/**
 * The widening every station of a paired carriageway asks for to reach its reference divider (m, 0 where it has no
 * reference or no gap), from the borders as they are: both sides are read before either moves.
 */
export function dividerWants(strips: readonly Strip[], pairsOf: (s: number) => readonly number[], refs: readonly MedianRef[]): Map<number, Float64Array> {
  const raw = new Map<number, Float64Array>();
  strips.forEach((s, si) => {
    if (s.kind === 'zone' || !medianSide(s)) return;
    const other = pairsOf(si);
    if (!other.length) return;
    const B = borderOf(other, strips);
    if (B.x.length < 2) return;
    const bName = (strips[other[0] as number] as Strip).name;
    const want = new Float64Array(s.st.length);
    let any = false;
    s.st.forEach((st, i) => {
      const b = st.b[st.b.length - 1] as number;
      const x = st.x + st.nx * b;
      const z = st.z + st.nz * b;
      const ref = refFor(refs, s, bName, x, z);
      if (!ref) return;
      const level = st.bridge ? 1000 + st.layer : st.layer;
      let best = Infinity;
      for (let j = 0; j + 1 < B.x.length; j++) {
        if (B.edge[j] !== B.edge[j + 1] || B.layer[j] !== level || B.layer[j + 1] !== level) continue;
        const ax = B.x[j] as number;
        const az = B.z[j] as number;
        const dx = (B.x[j + 1] as number) - ax;
        const dz = (B.z[j + 1] as number) - az;
        const l2 = dx * dx + dz * dz;
        if (l2 > 400) continue;
        const t = l2 > 1e-12 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
        const px = ax + dx * t;
        const pz = az + dz * t;
        // the other carriageway lies on this one's median side (its right: against the left normal)
        if ((px - x) * -st.nx + (pz - z) * -st.nz <= 0) continue;
        best = Math.min(best, Math.hypot(px - x, pz - z));
      }
      if (best > MAX_GAP_M) return;
      // the divider is the two median kerb lanes and the median between them: what is left over goes to the lanes
      const kerbs = (s.lanes[s.lanes.length - 1] as LaneDef).width * 2;
      const keep = Math.max(0, ref.width - kerbs);
      const w = Math.max(0, (best - keep) / 2 - SLACK_M);
      if (w > 0) {
        want[i] = w;
        any = true;
      }
    });
    if (any) raw.set(si, want);
  });
  return raw;
}

/**
 * Widens the paired carriageways that have a reference divider. `pairs` lists, for each strip, the strips of the
 * other carriageway(s) of its street; `edges` gives each strip's graph edge.
 */
export function fitToDividers(strips: readonly Strip[], joints: readonly Joint[], pairsOf: (s: number) => readonly number[], refs: readonly MedianRef[], edges: ReadonlyMap<string, GraphEdge>, held: ReadonlyMap<number, { start?: boolean; end?: boolean }> = new Map()): DividerFit {
  const out: DividerFit = { strips: 0, stations: 0, maxM: 0, reach: { asked: 0, fitted: 0 }, byStreet: {}, widened: {} };
  if (!refs.length) return out;
  const raw = dividerWants(strips, pairsOf, refs);
  // strip ends held at the nominal width (a junction whose corridor would step, see network.ts)
  for (const [si, ends] of held) {
    const w = raw.get(si);
    if (!w) continue;
    if (ends.start) w[0] = 0;
    if (ends.end) w[w.length - 1] = 0;
  }
  // along each edge the widening changes no faster than the class taper (a lower envelope over the edge's stations),
  // and the two stations of a joint take the same value (lanes meet border to border), until nothing changes
  const env = new Map<number, Float64Array>([...raw].map(([si, w]) => [si, Float64Array.from(w)]));
  const byEdge = new Map<string, number[]>();
  for (const si of [...env.keys()].sort((p, q) => p - q)) (byEdge.get((strips[si] as Strip).edge) ?? byEdge.set((strips[si] as Strip).edge, []).get((strips[si] as Strip).edge) as number[]).push(si);
  const edgeList = [...byEdge].sort((p, q) => (p[0] < q[0] ? -1 : 1));
  const endIdx = (si: number, end: 'start' | 'end'): number => (end === 'start' ? 0 : (strips[si] as Strip).st.length - 1);
  for (let round = 0; round < 20; round++) {
    for (const [edge, list] of edgeList) {
      const cls = edges.get(edge)?.road.cls ?? (strips[list[0] as number] as Strip).cls;
      const rate = 1 / classDefaults(cls).taper;
      // every station of the edge's widened strips, by metres along the edge
      const pts: { w: Float64Array; i: number; s: number }[] = [];
      for (const si of list) (strips[si] as Strip).st.forEach((st, i) => pts.push({ w: env.get(si) as Float64Array, i, s: st.s }));
      pts.sort((p, q) => p.s - q.s);
      const val = (k: number): number => ((pts[k] as { w: Float64Array; i: number }).w[(pts[k] as { i: number }).i] as number);
      const set = (k: number, v: number): void => {
        const q = pts[k] as { w: Float64Array; i: number };
        q.w[q.i] = v;
      };
      for (let k = 1; k < pts.length; k++) set(k, Math.min(val(k), val(k - 1) + ((pts[k] as { s: number }).s - (pts[k - 1] as { s: number }).s) * rate));
      for (let k = pts.length - 2; k >= 0; k--) set(k, Math.min(val(k), val(k + 1) + ((pts[k + 1] as { s: number }).s - (pts[k] as { s: number }).s) * rate));
    }
    let changed = false;
    for (const jn of joints) {
      const wa = env.get(jn.a.strip);
      const wb = env.get(jn.b.strip);
      if (!wa && !wb) continue;
      const ia = endIdx(jn.a.strip, jn.a.end);
      const ib = endIdx(jn.b.strip, jn.b.end);
      // a strip with no widening, or one met the other way round (its median side is not this one's), holds the joint at 0
      const flip = jn.a.end === jn.b.end;
      const m = !wa || !wb || flip ? 0 : Math.min(wa[ia] as number, wb[ib] as number);
      if (wa && (wa[ia] as number) > m + 1e-9) {
        wa[ia] = m;
        changed = true;
      }
      if (wb && (wb[ib] as number) > m + 1e-9) {
        wb[ib] = m;
        changed = true;
      }
    }
    if (!changed) break;
  }
  const done: Record<number, Float64Array> = {};
  for (const [si, w] of [...env].sort((p, q) => p[0] - q[0])) {
    const s = strips[si] as Strip;
    const want = raw.get(si) as Float64Array;
    const drive: number[] = [];
    s.lanes.forEach((l, li) => {
      if (l.type === 'drive') drive.push(li);
    });
    if (!drive.length) continue;
    const applied = new Float64Array(s.st.length);
    let touched = false;
    s.st.forEach((st, i) => {
      // what the drive lanes can take: each up to MAX_LANE_M
      // (a lane opening from nothing or tapering to nothing takes no share: it stays a taper, and the two strips of a
      // joint share the widening over the same lanes)
      const roomOf = (li: number): number => {
        const lw = (st.b[li] as number) - (st.b[li + 1] as number);
        return lw < MIN_DRIVE_LANE_M ? 0 : Math.max(0, MAX_LANE_M - lw);
      };
      let room = 0;
      for (const li of drive) room += roomOf(li);
      const e = Math.min(w[i] as number, room);
      if ((want[i] as number) > 0) {
        out.reach.asked++;
        if (e >= (want[i] as number) - 0.05) out.reach.fitted++;
      }
      if (e <= 1e-4) return;
      // the drive lanes share it in proportion to the room each has; the borders past the last drive lane move by all of it
      const last = drive[drive.length - 1] as number;
      let moved = 0;
      const nb = st.b.slice();
      for (let li = drive[0] as number; li < st.b.length - 1; li++) {
        if (li <= last && s.lanes[li]?.type === 'drive') moved += room > 0 ? (e * roomOf(li)) / room : 0;
        nb[li + 1] = (st.b[li + 1] as number) - (li < last ? moved : e);
      }
      st.b = nb;
      applied[i] = e;
      touched = true;
      out.stations++;
      out.maxM = Math.max(out.maxM, e);
      const rec = out.byStreet[s.name || s.edge] ?? (out.byStreet[s.name || s.edge] = { stations: 0, meanM: 0, maxM: 0 });
      rec.meanM += e;
      rec.stations++;
      rec.maxM = Math.max(rec.maxM, e);
    });
    if (touched) {
      out.strips++;
      done[si] = applied;
    }
  }
  out.widened = done;
  for (const r of Object.values(out.byStreet)) {
    r.meanM = Math.round((r.meanM / Math.max(1, r.stations)) * 100) / 100;
    r.maxM = Math.round(r.maxM * 100) / 100;
  }
  out.maxM = Math.round(out.maxM * 100) / 100;
  return out;
}

/**
 * Lane counts the reference dividers call for (P1-034): when the carriageways of a street, with the space up to their
 * divider, hold more lanes of their class width than they have (the median over every station of the street that has
 * a reference beside it), every such edge of the street takes that count, one or two lanes more at most. One count per
 * street keeps the corridor even across its junctions (a count per edge made width steps). The lane model settles these
 * as fit counts before its rounds; the rest is taken by fitToDividers.
 */
export function dividerLanes(strips: readonly Strip[], pairsOf: (s: number) => readonly number[], refs: readonly MedianRef[], edges: ReadonlyMap<string, GraphEdge>): Map<string, number> {
  const raw = dividerWants(strips, pairsOf, refs);
  const byStreet = new Map<string, { widths: number[]; lanes: number; laneWidth: number; edges: Set<string> }>();
  for (const [si, want] of [...raw].sort((p, q) => p[0] - q[0])) {
    const s = strips[si] as Strip;
    const e = edges.get(s.edge);
    if (s.kind !== 'road' || s.hero || !s.name || !e) continue;
    const drive = s.lanes.flatMap((l, li) => (l.type === 'drive' ? [li] : []));
    if (!drive.length) continue;
    const rec = byStreet.get(s.name) ?? byStreet.set(s.name, { widths: [], lanes: 0, laneWidth: e.road.laneWidth, edges: new Set() }).get(s.name) as { widths: number[]; lanes: number; laneWidth: number; edges: Set<string> };
    rec.lanes = Math.max(rec.lanes, drive.length);
    rec.laneWidth = Math.min(rec.laneWidth, e.road.laneWidth);
    rec.edges.add(s.edge);
    s.st.forEach((st, i) => {
      if (!((want[i] as number) > 0)) return;
      rec.widths.push((st.b[drive[0] as number] as number) - (st.b[(drive[drive.length - 1] as number) + 1] as number) + (want[i] as number));
    });
  }
  const out = new Map<string, number>();
  for (const [, rec] of [...byStreet].sort((p, q) => (p[0] < q[0] ? -1 : 1))) {
    if (rec.widths.length < 10) continue;
    rec.widths.sort((p, q) => p - q);
    const mid = rec.widths[Math.floor(rec.widths.length / 2)] as number;
    const n = Math.min(rec.lanes + 2, Math.floor(mid / rec.laneWidth + 0.25));
    if (n > rec.lanes) for (const e of [...rec.edges].sort()) out.set(e, n);
  }
  return out;
}
