// Gate counts of the road model (MAP_REPAIR.md "Verification"): every check reads the finished model or mesh, not
// the builder's own bookkeeping, so a count of zero is evidence and not an echo.
import { maxGrade, DECK_DEPTH, HEADROOM, classDefaults } from './model.ts';
import type { Joint, Junction, LaneDef, Station, Strip } from './model.ts';
import { borderPoint, laneRaise } from './mesh.ts';
import type { SurfTri } from './mesh.ts';
import { TriGrid, overlapArea, triArea } from './trigrid.ts';

const r = (v: number, d = 4): number => Math.round(v * 10 ** d) / 10 ** d;

export interface OverlapCheck {
  /** Road faces lying on top of each other at one level: total shared area (m2) and the pairs of pieces involved. */
  areaM2: number;
  pairs: number;
  worst: { a: string; b: string; areaM2: number; x: number; z: number }[];
  trianglesTested: number;
  /** Places where one road passes over another, and those with less than the headroom under the deck. */
  gradeSeparated: number;
  clearanceViolations: number;
  minClearanceM: number | null;
  lowest: { a: string; b: string; clearanceM: number; x: number; z: number }[];
}

/**
 * Overlap of top surfaces, triangle against triangle. Faces at one level (within 2.5 m) that share area are an
 * overlap; faces further apart are a road over a road, and the lower one needs headroom under the upper deck.
 */
export function checkOverlap(surf: readonly SurfTri[], name: (piece: number) => string): OverlapCheck {
  const grid = new TriGrid<SurfTri>(5);
  for (const t of surf) grid.add(t);
  const cell = grid.cellSize();
  const box = surf.map((t) => ({
    minX: Math.min(t.p[0][0], t.p[1][0], t.p[2][0]), maxX: Math.max(t.p[0][0], t.p[1][0], t.p[2][0]),
    minZ: Math.min(t.p[0][2], t.p[1][2], t.p[2][2]), maxZ: Math.max(t.p[0][2], t.p[1][2], t.p[2][2]),
  }));
  const same = new Map<string, { area: number; x: number; z: number }>();
  const over = new Map<string, { clearance: number; x: number; z: number }>();
  let area = 0;
  let tested = 0;
  grid.eachCell((ids, ci, cj) => {
    for (let x = 0; x < ids.length; x++) {
      for (let y = x + 1; y < ids.length; y++) {
        const i = ids[x] as number;
        const j = ids[y] as number;
        const a = box[i] as { minX: number; maxX: number; minZ: number; maxZ: number };
        const b = box[j] as { minX: number; maxX: number; minZ: number; maxZ: number };
        if (a.minX >= b.maxX || b.minX >= a.maxX || a.minZ >= b.maxZ || b.minZ >= a.maxZ) continue;
        // a pair is tested once: in the cell that holds the lower corner of the boxes' overlap
        if (Math.floor(Math.max(a.minX, b.minX) / cell) !== ci || Math.floor(Math.max(a.minZ, b.minZ) / cell) !== cj) continue;
        tested++;
        const ta = surf[i] as SurfTri;
        const tb = surf[j] as SurfTri;
        const shared = overlapArea(ta.p, tb.p);
        if (shared < 1e-6) continue;
        const cx = (Math.max(a.minX, b.minX) + Math.min(a.maxX, b.maxX)) / 2;
        const cz = (Math.max(a.minZ, b.minZ) + Math.min(a.maxZ, b.maxZ)) / 2;
        const key = ta.piece < tb.piece ? `${ta.piece},${tb.piece}` : `${tb.piece},${ta.piece}`;
        if (Math.abs(ta.hb - tb.hb) < 2.5) {
          area += shared;
          const s = same.get(key);
          if (s) s.area += shared;
          else same.set(key, { area: shared, x: cx, z: cz });
        } else {
          const clearance = Math.abs(ta.hb - tb.hb) - DECK_DEPTH;
          const o = over.get(key);
          if (!o || clearance < o.clearance) over.set(key, { clearance, x: cx, z: cz });
        }
      }
    }
  });
  const names = (key: string): [string, string] => {
    const [p, q] = key.split(',').map(Number) as [number, number];
    return [name(p), name(q)];
  };
  const worst = [...same].sort((p, q) => q[1].area - p[1].area).slice(0, 8).map(([k, v]) => ({ a: names(k)[0], b: names(k)[1], areaM2: r(v.area), x: r(v.x, 1), z: r(v.z, 1) }));
  const lows = [...over].sort((p, q) => p[1].clearance - q[1].clearance);
  return {
    areaM2: r(area), pairs: same.size, worst, trianglesTested: tested, gradeSeparated: over.size,
    clearanceViolations: lows.filter(([, v]) => v.clearance < HEADROOM - 0.02).length, minClearanceM: lows.length ? r((lows[0] as [string, { clearance: number }])[1].clearance, 2) : null,
    lowest: lows.slice(0, 5).map(([k, v]) => ({ a: names(k)[0], b: names(k)[1], clearanceM: r(v.clearance, 2), x: r(v.x, 1), z: r(v.z, 1) })),
  };
}

export interface ContinuityCheck {
  joints: number;
  splitJoints: number;
  lanePairs: number;
  /** A drive lane whose two borders do not meet the lane it continues into, or that has no continuation. */
  breaks: number;
  maxOffsetM: number;
  junctionLanesWithoutConnection: number;
  list: { strip: string; lane: number; why: string }[];
}

const endStation = (s: Strip, end: 'start' | 'end'): Station => (end === 'start' ? s.st[0] : s.st[s.st.length - 1]) as Station;

/** Lane continuity through every joint (section changes, split and merge zones) and every junction. */
export function checkContinuity(strips: readonly Strip[], joints: readonly Joint[], junctions: readonly Junction[], siteEnds: ReadonlySet<string>): ContinuityCheck {
  const out: ContinuityCheck = { joints: joints.length, splitJoints: joints.filter((j) => j.kind === 'split').length, lanePairs: 0, breaks: 0, maxOffsetM: 0, junctionLanesWithoutConnection: 0, list: [] };
  const covered = new Set<string>();
  const fail = (strip: Strip, laneIdx: number, why: string): void => {
    out.breaks++;
    if (out.list.length < 12) out.list.push({ strip: strip.id, lane: laneIdx, why });
  };
  for (const j of joints) {
    const sa = strips[j.a.strip] as Strip;
    const sb = strips[j.b.strip] as Strip;
    const pa = endStation(sa, j.a.end);
    const pb = endStation(sb, j.b.end);
    // walking away from the joint the two strips run opposite ways, unless both ends are the same kind
    const flip = j.a.end === j.b.end;
    for (const [la, lb] of j.lanes) {
      covered.add(`${j.a.strip}:${j.a.end}:${la}`);
      covered.add(`${j.b.strip}:${j.b.end}:${lb}`);
      const da = sa.lanes[la] as LaneDef;
      const db = sb.lanes[lb] as LaneDef;
      if (da.type !== 'drive' && db.type !== 'drive') continue;
      out.lanePairs++;
      const a0 = borderPoint(pa, la);
      const a1 = borderPoint(pa, la + 1);
      const b0 = borderPoint(pb, flip ? lb + 1 : lb);
      const b1 = borderPoint(pb, flip ? lb : lb + 1);
      const off = Math.max(Math.hypot(a0.x - b0.x, a0.z - b0.z), Math.hypot(a1.x - b1.x, a1.z - b1.z), Math.abs(pa.h - pb.h));
      out.maxOffsetM = Math.max(out.maxOffsetM, off);
      if (off > 0.01) fail(sa, la, `borders ${r(off, 3)} m apart at the joint with ${sb.id}`);
      else if (da.type !== db.type) fail(sa, la, `a ${da.type} lane continues as ${db.type} in ${sb.id}`);
    }
  }
  for (const jn of junctions) {
    for (const arm of jn.arms) {
      const s = strips[arm.strip] as Strip;
      s.lanes.forEach((l, k) => {
        if (l.type !== 'drive') return;
        covered.add(`${arm.strip}:${arm.end}:${k}`);
        const has = jn.connections.some((c) => (c.from[0] === arm.strip && c.from[1] === k) || (c.to[0] === arm.strip && c.to[1] === k));
        if (!has && jn.arms.length > 1) {
          out.junctionLanesWithoutConnection++;
          fail(s, k, `no connecting lane in junction ${jn.id}`);
        }
      });
    }
  }
  // a drive lane that just ends, anywhere but at the site's edge
  strips.forEach((s, si) => {
    for (const end of ['start', 'end'] as const) {
      if (siteEnds.has(`${si}:${end}`)) continue;
      const st = endStation(s, end);
      s.lanes.forEach((l, k) => {
        if (l.type !== 'drive' || covered.has(`${si}:${end}:${k}`)) return;
        if ((st.b[k] as number) - (st.b[k + 1] as number) < 0.05) return; // a lane that has tapered to nothing ends by design
        fail(s, k, `the lane ends at the ${end} of the strip with nothing after it`);
      });
    }
  });
  out.maxOffsetM = r(out.maxOffsetM, 5);
  return out;
}

export interface TaperCheck {
  tapers: number;
  violations: number;
  byClass: Record<string, { tapers: number; violations: number; ratio: number }>;
  list: { strip: string; cls: string; lengthM: number; shiftM: number; neededM: number }[];
}

/** Taper length per class: metres of length per metre of sideways shift (trunk 15, secondary 10, lanes 6). */
export function checkTapers(strips: readonly Strip[]): TaperCheck {
  const out: TaperCheck = { tapers: 0, violations: 0, byClass: {}, list: [] };
  for (const s of strips) {
    if (s.kind !== 'taper') continue;
    // measured on the strip itself: its length along the reference line and the largest move of any border
    const first = s.st[0] as Station;
    const last = s.st[s.st.length - 1] as Station;
    let length = 0;
    for (let i = 1; i < s.st.length; i++) length += Math.hypot((s.st[i] as Station).x - (s.st[i - 1] as Station).x, (s.st[i] as Station).z - (s.st[i - 1] as Station).z);
    let shift = 0;
    for (let k = 0; k < first.b.length; k++) shift = Math.max(shift, Math.abs((first.b[k] as number) - (last.b[k] as number)));
    const ratio = classDefaults(s.cls).taper;
    const needed = ratio * shift;
    const c = (out.byClass[s.cls] ??= { tapers: 0, violations: 0, ratio });
    out.tapers++;
    c.tapers++;
    if (length < needed * 0.98 - 0.05) {
      out.violations++;
      c.violations++;
      out.list.push({ strip: s.id, cls: s.cls, lengthM: r(length, 1), shiftM: r(shift, 2), neededM: r(needed, 1) });
    }
  }
  return out;
}

export interface HeightCheck {
  sharedVertices: number;
  /** Vertices used by more than one piece where the pieces disagree about the carriageway height. */
  steps: number;
  maxStepM: number;
  gradeSegments: number;
  gradeViolations: number;
  maxGradePct: number;
  worstGrade: { strip: string; gradePct: number; limitPct: number } | null;
  /** Stretches at grade that stand more than 0.6 m above the ground model, or lie more than 0.6 m under it (0.6 m is also where a structure ends). */
  floating: number;
  sunk: number;
  maxAboveGroundM: number;
  maxBelowGroundM: number;
  /** Structures: stations on a ramp or a deck, and structure ends that do not come down to the ground. */
  structureStations: number;
  abutments: number;
  abutmentsOffGround: number;
}

/** Height steps at shared vertices, grades per class, floating or sunk stretches, structure ends. */
export function checkHeights(strips: readonly Strip[], junctions: readonly Junction[], abutments: readonly { hag: number }[]): HeightCheck {
  // carriageway height (without the raise) of every top vertex, by plan position
  const seen = new Map<string, { h: number; piece: number; max: number; shared: boolean }>();
  let steps = 0;
  let maxStep = 0;
  const visit = (x: number, z: number, h: number, piece: number): void => {
    const key = `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
    const e = seen.get(key);
    if (!e) {
      seen.set(key, { h, piece, max: 0, shared: false });
      return;
    }
    if (e.piece !== piece) e.shared = true;
    const d = Math.abs(e.h - h);
    if (d > e.max) e.max = d;
  };
  strips.forEach((s, si) => {
    for (const st of s.st) for (let k = 0; k < st.b.length; k++) visit(st.x + st.nx * (st.b[k] as number), st.z + st.nz * (st.b[k] as number), st.h, si);
  });
  junctions.forEach((j, ji) => {
    for (const v of j.ring) visit(v.x, v.z, v.y, strips.length + ji);
  });
  let shared = 0;
  for (const e of seen.values()) {
    if (!e.shared) continue;
    shared++;
    if (e.max > 0.002) steps++;
    maxStep = Math.max(maxStep, e.max);
  }
  const out: HeightCheck = {
    sharedVertices: shared, steps, maxStepM: r(maxStep, 5), gradeSegments: 0, gradeViolations: 0, maxGradePct: 0, worstGrade: null,
    floating: 0, sunk: 0, maxAboveGroundM: 0, maxBelowGroundM: 0, structureStations: 0, abutments: abutments.length, abutmentsOffGround: abutments.filter((a) => a.hag > 2).length,
  };
  for (const s of strips) {
    const limit = maxGrade(s.cls, s.link);
    let floating = false;
    let sunk = false;
    for (let i = 0; i < s.st.length; i++) {
      const st = s.st[i] as Station;
      if (st.structure > 0) out.structureStations++;
      else {
        const hag = st.h - st.g;
        out.maxAboveGroundM = Math.max(out.maxAboveGroundM, hag);
        out.maxBelowGroundM = Math.max(out.maxBelowGroundM, -hag);
        if (hag > 0.6 && !floating) out.floating++;
        if (hag < -0.6 && !sunk) out.sunk++;
        floating = hag > 0.6;
        sunk = hag < -0.6;
      }
      if (i === 0) continue;
      const prev = s.st[i - 1] as Station;
      const d = Math.hypot(st.x - prev.x, st.z - prev.z);
      if (d < 0.5) continue;
      const g = Math.abs(st.h - prev.h) / d;
      out.gradeSegments++;
      if (g * 100 > out.maxGradePct) {
        out.maxGradePct = g * 100;
        out.worstGrade = { strip: s.id, gradePct: r(g * 100, 2), limitPct: r(limit * 100, 1) };
      }
      if (g > limit + 0.003) out.gradeViolations++;
    }
  }
  out.maxGradePct = r(out.maxGradePct, 2);
  out.maxAboveGroundM = r(out.maxAboveGroundM, 2);
  out.maxBelowGroundM = r(out.maxBelowGroundM, 2);
  return out;
}

export interface ColliderCheck {
  edgeVertices: number;
  /** Top vertices of raised lanes (kerb, parapet, footpath, planter) that are not corners of collider triangles. */
  missing: number;
}

/** Kerbs and parapets collide where they are drawn: every top vertex of a raised lane is a collider vertex. */
export function checkEdgeColliders(strips: readonly Strip[], colliderFaces: readonly number[][], origin: readonly [number, number, number]): ColliderCheck {
  const keys = new Set<string>();
  for (const faces of colliderFaces) {
    for (let i = 0; i + 2 < faces.length; i += 3) keys.add(`${Math.round((faces[i] as number) * 100)},${Math.round((faces[i + 1] as number) * 100)},${Math.round((faces[i + 2] as number) * 100)}`);
  }
  let n = 0;
  let missing = 0;
  for (const s of strips) {
    for (let k = 0; k < s.lanes.length; k++) {
      // every raised lane: kerbs, parapets, footpaths, planters
      if ((s.lanes[k] as LaneDef).raise < 0.01) continue;
      for (const st of s.st) {
        if ((st.b[k] as number) - (st.b[k + 1] as number) < 1e-3) continue;
        for (const b of [k, k + 1]) {
          const p = borderPoint(st, b);
          n++;
          const x = p.x - origin[0];
          const y = st.h + laneRaise(s.lanes, k, st) - origin[1];
          const z = p.z - origin[2];
          let found = false;
          for (const dx of [0, -0.004, 0.004]) for (const dy of [0, -0.004, 0.004]) for (const dz of [0, -0.004, 0.004]) if (!found && keys.has(`${Math.round((x + dx) * 100)},${Math.round((y + dy) * 100)},${Math.round((z + dz) * 100)}`)) found = true;
          if (!found) missing++;
        }
      }
    }
  }
  return { edgeVertices: n, missing };
}

export const surfaceArea = (surf: readonly SurfTri[]): number => r(surf.reduce((s, t) => s + triArea(t.p[0], t.p[1], t.p[2]), 0), 1);
