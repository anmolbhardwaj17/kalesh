// Mid-block crossings (P1-032, MAP_REPAIR.md "Lane-level road model"): a crossing the map marks away from every
// junction (an OSM highway=crossing node, or an add_crossing patch's mark) is placed on the strip it lies on, by
// metres along the strip from its first station. The mesh draws a zebra across every driving lane there and a stop
// line before it for each direction (mesh/paint.ts paintMidBlock). Crossings within 30 m of a junction node stay the
// junction arm's zebra (netstrips.ts). Pure.
import type { P2 } from '../geom.ts';
import type { Station, Strip } from './model.ts';
import type { MidCrossing } from './netctx.ts';

/** A crossing this near a junction node belongs to the junction's arm (the rule netstrips.ts uses). */
export const JUNCTION_CLAIM_M = 30;
/** Width of a mid-block zebra along the road (m), and the gap from its edge to each stop line. */
export const ZEBRA_M = 3;
export const STOP_GAP_M = 2;
/** A crossing needs this much strip on both sides of its middle (zebra half, gap, stop line). */
export const END_ROOM_M = ZEBRA_M / 2 + STOP_GAP_M + 0.5;
/** Two crossing points on one strip closer than this are one crossing (m). */
const SAME_M = 8;
const ROAD_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);

export interface CrossingPoint extends P2 {
  id: string;
  source: 'osm' | 'patch';
  marked?: boolean;
}

export interface MidCrossingReport {
  points: number;
  placed: number;
  /** The second carriageway of a divided road that had no crossing node of its own on the line. */
  pairedAdded: number;
  skipped: Record<string, number>;
}

/** Where a point lies on a strip: metres along its polyline from the first station, and sideways from the reference line. */
export function onStrip(s: Strip, p: P2): { along: number; lat: number; i: number; t: number } | null {
  let best: { along: number; lat: number; i: number; t: number; d: number } | null = null;
  let done = 0;
  for (let i = 0; i + 1 < s.st.length; i++) {
    const a = s.st[i] as Station;
    const b = s.st[i + 1] as Station;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-9) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (len * len)));
    const qx = a.x + dx * t;
    const qz = a.z + dz * t;
    const d = Math.hypot(p.x - qx, p.z - qz);
    if (!best || d < best.d) {
      // left of the station order is (nx, nz)
      const nx = a.nx + (b.nx - a.nx) * t;
      const nz = a.nz + (b.nz - a.nz) * t;
      best = { along: done + len * t, lat: (p.x - qx) * nx + (p.z - qz) * nz, i, t, d };
    }
    done += len;
  }
  return best ? { along: best.along, lat: best.lat, i: best.i, t: best.t } : null;
}

export const stripLength = (s: Strip): number => {
  let l = 0;
  for (let i = 0; i + 1 < s.st.length; i++) l += Math.hypot((s.st[i + 1] as Station).x - (s.st[i] as Station).x, (s.st[i + 1] as Station).z - (s.st[i] as Station).z);
  return l;
};

/** The driving lanes' span at a station: left and right border (lateral, left positive). */
function driveSpan(s: Strip, st: Station): [number, number] | null {
  const ks = s.lanes.map((l, k) => (l.type === 'drive' ? k : -1)).filter((k) => k >= 0);
  if (!ks.length) return null;
  return [st.b[ks[0] as number] as number, st.b[(ks[ks.length - 1] as number) + 1] as number];
}

/**
 * Mid-block crossings of a lane build. `junctionNodes` are the plan positions of every junction cluster's nodes;
 * `armEnds` the strip ends that are junction arms with a zebra (a crossing within reach of one is that zebra);
 * `pairOf` the strips of the other carriageway of a strip's street (by graph edge).
 */
export function midBlockCrossings(strips: readonly Strip[], points: readonly CrossingPoint[], junctionNodes: readonly P2[], armEnds: ReadonlySet<string>, pairOf: (s: Strip) => readonly number[]): { list: MidCrossing[]; report: MidCrossingReport } {
  const report: MidCrossingReport = { points: points.length, placed: 0, pairedAdded: 0, skipped: {} };
  const skip = (why: string): void => {
    report.skipped[why] = (report.skipped[why] ?? 0) + 1;
  };
  // strips by box, for the nearest strip of a point
  const boxes = strips.map((s) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const st of s.st) {
      const w = Math.max(Math.abs(st.b[0] as number), Math.abs(st.b[st.b.length - 1] as number));
      x0 = Math.min(x0, st.x - w);
      x1 = Math.max(x1, st.x + w);
      z0 = Math.min(z0, st.z - w);
      z1 = Math.max(z1, st.z + w);
    }
    return [x0, x1, z0, z1] as const;
  });
  const lens = strips.map(stripLength);
  const list: MidCrossing[] = [];
  const fits = (si: number, along: number): string | null => {
    const s = strips[si] as Strip;
    if (s.kind !== 'road' || !ROAD_CLASSES.has(s.cls)) return 'not a road with crossings (a service road, a taper or a split zone)';
    if (s.lanes.some((l) => l.tag === 'gali')) return 'a gali (no paint)';
    if (s.st.some((st) => st.bridge || st.layer !== 0)) return 'on a bridge or another level';
    const len = lens[si] as number;
    if (along < END_ROOM_M || along > len - END_ROOM_M) return 'too near the end of its strip';
    if ((along < 15 && armEnds.has(`${si}:start`)) || (along > len - 15 && armEnds.has(`${si}:end`))) return 'the junction arm zebra is there';
    if (list.some((c) => c.strip === si && Math.abs(c.along - along) < SAME_M)) return 'a second node of the same crossing';
    return null;
  };
  const place = (si: number, along: number, p: CrossingPoint, idSuffix = ''): MidCrossing => {
    const s = strips[si] as Strip;
    const st = sectionAlong(s, along);
    const c: MidCrossing = { id: `${p.id}${idSuffix}`, source: p.source, strip: si, along: Math.round(along * 1000) / 1000, s: Math.round(st.s * 1000) / 1000, x: Math.round(st.x * 1000) / 1000, z: Math.round(st.z * 1000) / 1000, width: ZEBRA_M };
    list.push(c);
    return c;
  };
  for (const p of [...points].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (p.marked === false) {
      skip('unmarked (no zebra in the map)');
      continue;
    }
    if (junctionNodes.some((n) => Math.hypot(n.x - p.x, n.z - p.z) <= JUNCTION_CLAIM_M)) {
      skip('within 30 m of a junction (the arm zebra)');
      continue;
    }
    let best: { si: number; along: number; lat: number } | null = null;
    strips.forEach((s, si) => {
      const b = boxes[si] as readonly [number, number, number, number];
      if (p.x < b[0] - 2 || p.x > b[1] + 2 || p.z < b[2] - 2 || p.z > b[3] + 2) return;
      const o = onStrip(s, p);
      if (!o) return;
      const st = sectionAlong(s, o.along);
      const span = driveSpan(s, st);
      if (!span || o.lat > span[0] + 1 || o.lat < span[1] - 1) return;
      if (!best || Math.abs(o.lat) < Math.abs(best.lat)) best = { si, along: o.along, lat: o.lat };
    });
    if (!best) {
      skip('on no driving lane');
      continue;
    }
    const { si, along } = best as { si: number; along: number };
    const why = fits(si, along);
    if (why) {
      skip(why);
      continue;
    }
    const c = place(si, along, p);
    report.placed++;
    // the other carriageway of a divided street on the same line, when it has no crossing of its own there
    for (const pj of pairOf(strips[si] as Strip)) {
      const ps = strips[pj] as Strip;
      const o = onStrip(ps, c);
      if (!o) continue;
      const st = sectionAlong(ps, o.along);
      const span = driveSpan(ps, st);
      if (!span) continue;
      // the line across: within 30 m of the crossing beside it, square to the road
      const off = Math.hypot(st.x - c.x, st.z - c.z);
      if (off > 30 || o.along < 0.5 || o.along > (lens[pj] as number) - 0.5) continue;
      const near = points.some((q) => q !== p && Math.hypot(q.x - st.x, q.z - st.z) < 15);
      if (near || fits(pj, o.along)) continue;
      place(pj, o.along, p, '~pair');
      report.pairedAdded++;
    }
  }
  list.sort((a, b) => a.strip - b.strip || a.along - b.along);
  return { list, report };
}

/** The station frame at `along` metres from a strip's first station (borders blended). */
export function sectionAlong(s: Strip, along: number): Station {
  let done = 0;
  for (let i = 0; i + 1 < s.st.length; i++) {
    const p = s.st[i] as Station;
    const q = s.st[i + 1] as Station;
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    if (done + len >= along || i + 2 === s.st.length) {
      const t = len > 1e-9 ? Math.max(0, Math.min(1, (along - done) / len)) : 0;
      const l = (a: number, b: number): number => a + (b - a) * t;
      const nl = Math.hypot(l(p.nx, q.nx), l(p.nz, q.nz)) || 1;
      return { ...p, x: l(p.x, q.x), z: l(p.z, q.z), nx: l(p.nx, q.nx) / nl, nz: l(p.nz, q.nz) / nl, s: l(p.s, q.s), h: l(p.h, q.h), g: l(p.g, q.g), b: p.b.map((v, k) => l(v, q.b[k] as number)) };
    }
    done += len;
  }
  return s.st[0] as Station;
}
