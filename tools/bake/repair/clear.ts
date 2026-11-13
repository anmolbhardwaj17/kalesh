// Buildings off the road (P1-030, MAP_REPAIR.md "The owner queue is for genuine questions only"). A footprint that
// stands on a road surface gives way: it is moved back a little when the ground behind it is free, else its outline is
// cut back to the edge of the road (the cut follows the road, so the building keeps a frontage along it), a footprint a
// road runs through becomes two, and what is left as a scrap is dropped. Every change is one line of the log with its
// action, so the bake can count them and prove that no footprint is left on a road. The road is whatever the caller
// hands in as faces: the bake uses the road mesh's own faces at ground level (carriageways, kerbs, footpaths, junction
// surfaces), so the test is on what is drawn, not on a width guessed from the graph. Pure.
import { EndType, FillRule, JoinType, areaD, differenceD, inflatePathsD, intersectD, unionD } from 'clipper2-ts';
import type { PathD, PathsD } from 'clipper2-ts';
import { Grid, boxOf, pointSegment } from '../geom.ts';
import type { Box2, P2 } from '../geom.ts';
import type { GraphFootprint } from '../graph/build.ts';

export const CLEAR = {
  /** A cut building ends this far from the road's edge (m): room for the ground between a wall and the kerb. */
  clearanceM: 0.25,
  /** A footprint counts as on the road from this much shared area (m2). */
  minOverlapM2: 0.01,
  /** A building is moved back at most this far (m), in steps. */
  shiftMaxM: 3,
  shiftStepM: 0.5,
  /** Only a footprint with at most this share of its area on the road is moved; a deeper one is cut. */
  shiftShare: 0.35,
  /** A moved footprint may lie on its neighbours by this much more than before (m2). */
  neighbourTolM2: 0.5,
  /** What is left of a cut footprint is kept from this area (m2) and this mean width (m, 2 x area / perimeter). */
  minPartM2: 8,
  minPartWidthM: 1.5,
} as const;

export type ClearAction = 'shifted' | 'trimmed' | 'split' | 'dropped';

export interface RoadFace {
  ring: PathD;
  box: Box2;
}

export interface ClearLine {
  id: string;
  source: string;
  action: ClearAction;
  /** Area of the footprint on the road before (m2). */
  overlapM2: number;
  areaBefore: number;
  areaAfter: number;
  /** A moved footprint: how far (m). */
  movedM?: number;
  /** A footprint cut in two or more: the ids of its parts. */
  parts?: string[];
  x: number;
  z: number;
}

export interface ClearCounts {
  footprints: number;
  onRoad: number;
  overlapM2: number;
  shifted: number;
  trimmed: number;
  split: number;
  dropped: number;
  /** Area taken off cut and dropped footprints (m2). */
  removedM2: number;
  /** Holes a cut left inside a footprint (a road piece wholly inside it), opened to the outside. */
  holesOpened: number;
  footprintsAfter: number;
}

export interface ClearResult {
  footprints: GraphFootprint[];
  lines: ClearLine[];
  counts: ClearCounts;
}

const PRECISION = 3;
const r1 = (v: number): number => Math.round(v * 10) / 10 + 0;
const r2 = (v: number): number => Math.round(v * 100) / 100 + 0;
const toPath = (ring: readonly P2[]): PathD => ring.map((p) => ({ x: p.x, y: p.z }));
const positive = (p: PathD): PathD => (areaD(p) < 0 ? p.slice().reverse() : p);
const areaOf = (paths: PathsD): number => paths.reduce((s, p) => s + areaD(p), 0);
const perimeter = (p: PathD): number => p.reduce((s, q, i) => s + Math.hypot((p[(i + 1) % p.length] as PathD[number]).x - q.x, (p[(i + 1) % p.length] as PathD[number]).y - q.y), 0);
const centroid = (paths: PathsD): P2 | null => {
  let a = 0;
  let x = 0;
  let z = 0;
  for (const p of paths) {
    for (let i = 0; i < p.length; i++) {
      const q = p[i] as PathD[number];
      const n = p[(i + 1) % p.length] as PathD[number];
      const c = q.x * n.y - n.x * q.y;
      a += c;
      x += (q.x + n.x) * c;
      z += (q.y + n.y) * c;
    }
  }
  return Math.abs(a) < 1e-9 ? null : { x: x / (3 * a), z: z / (3 * a) };
};

/** A road face for the index: any winding, kept counter clockwise so faces add up under the non-zero rule. */
export function roadFace(ring: readonly P2[]): RoadFace {
  return { ring: positive(toPath(ring)), box: boxOf(ring) };
}

/** An index of road faces. */
export function faceIndex(faces: readonly RoadFace[]): Grid<RoadFace> {
  const grid = new Grid<RoadFace>(25);
  for (const f of faces) grid.insert(f.box, f);
  return grid;
}

const meets = (a: Box2, b: Box2, pad = 0): boolean => a.minX - pad <= b.maxX && a.maxX + pad >= b.minX && a.minZ - pad <= b.maxZ && a.maxZ + pad >= b.minZ;

/** Area of a ring that lies on the road faces (m2). */
export function onRoadM2(ring: readonly P2[], faces: Grid<RoadFace>): number {
  const box = boxOf(ring);
  const near = faces.query(box).filter((f) => meets(f.box, box));
  if (!near.length) return 0;
  return areaOf(intersectD([positive(toPath(ring))], near.map((f) => f.ring), FillRule.NonZero, PRECISION));
}

/** Cuts a slit from every hole to the outside, so each part is one ring. */
function openHoles(paths: PathsD): { parts: PathsD; opened: number } {
  let cur = paths;
  let opened = 0;
  for (let round = 0; round < 8; round++) {
    const hole = cur.find((p) => areaD(p) < 0);
    if (!hole) break;
    const outers = cur.filter((p) => areaD(p) > 0);
    let best: { h: PathD[number]; q: P2; d: number } | null = null;
    for (const h of hole) {
      for (const o of outers) {
        for (let i = 0; i < o.length; i++) {
          const a = o[i] as PathD[number];
          const b = o[(i + 1) % o.length] as PathD[number];
          const c = pointSegment({ x: h.x, z: h.y }, { x: a.x, z: a.y }, { x: b.x, z: b.y });
          if (!best || c.d < best.d) best = { h, q: { x: c.x, z: c.z }, d: c.d };
        }
      }
    }
    if (!best) break;
    const l = best.d || 1;
    const ux = (best.q.x - best.h.x) / l;
    const uz = (best.q.z - best.h.y) / l;
    const w = 0.3;
    const a = { x: best.h.x - ux * 0.5, y: best.h.y - uz * 0.5 };
    const b = { x: best.q.x + ux * 0.5, y: best.q.z + uz * 0.5 };
    const slit: PathD = [{ x: a.x - uz * w, y: a.y + ux * w }, { x: b.x - uz * w, y: b.y + ux * w }, { x: b.x + uz * w, y: b.y - ux * w }, { x: a.x + uz * w, y: a.y - ux * w }];
    cur = differenceD(cur, [positive(slit)], FillRule.NonZero, PRECISION);
    opened++;
  }
  return { parts: cur.filter((p) => areaD(p) > 0), opened };
}

interface Live {
  f: GraphFootprint;
  path: PathD;
  box: Box2;
  dead: boolean;
}

/** Footprints with tags that pin them to a place (a landmark, a named building) are cut, never moved. */
const pinned = (f: GraphFootprint): boolean => f.tags['wikidata'] !== undefined || f.tags['historic'] !== undefined || f.tags['name'] !== undefined || f.tags['heritage'] !== undefined;

/**
 * Every footprint off the road faces: moved back, cut, cut in two or dropped. Footprints are worked in id order; the
 * result is sorted by id and has the same fields (a part of a split footprint is "<id>~<n>").
 */
export function clearFootprints(footprints: readonly GraphFootprint[], faces: Grid<RoadFace>, o: typeof CLEAR = CLEAR): ClearResult {
  const live: Live[] = footprints.map((f) => ({ f, path: positive(toPath(f.ring)), box: boxOf(f.ring), dead: false })).sort((a, b) => (a.f.id < b.f.id ? -1 : a.f.id > b.f.id ? 1 : 0));
  const grid = new Grid<Live>(25);
  for (const l of live) grid.insert(l.box, l);
  const lines: ClearLine[] = [];
  const counts: ClearCounts = { footprints: footprints.length, onRoad: 0, overlapM2: 0, shifted: 0, trimmed: 0, split: 0, dropped: 0, removedM2: 0, holesOpened: 0, footprintsAfter: 0 };
  const out: GraphFootprint[] = [];
  const reversed = (f: GraphFootprint): boolean => {
    let a = 0;
    for (let i = 0; i < f.ring.length; i++) a += (f.ring[i] as P2).x * (f.ring[(i + 1) % f.ring.length] as P2).z - (f.ring[(i + 1) % f.ring.length] as P2).x * (f.ring[i] as P2).z;
    return a < 0;
  };
  const ringOf = (path: PathD, flip: boolean): P2[] => {
    const pts = path.map((q) => ({ x: r2(q.x), z: r2(q.y) }));
    const clean: P2[] = [];
    for (const p of pts) if (!clean.length || Math.hypot(p.x - (clean[clean.length - 1] as P2).x, p.z - (clean[clean.length - 1] as P2).z) > 0.005) clean.push(p);
    if (clean.length > 1 && Math.hypot((clean[0] as P2).x - (clean[clean.length - 1] as P2).x, (clean[0] as P2).z - (clean[clean.length - 1] as P2).z) <= 0.005) clean.pop();
    return flip ? clean.reverse() : clean;
  };
  const onOthers = (self: Live, path: PathD, box: Box2): number => {
    const others = grid.query(box).filter((x) => x !== self && !x.dead && meets(x.box, box));
    return others.length ? areaOf(intersectD([path], others.map((x) => x.path), FillRule.NonZero, PRECISION)) : 0;
  };
  for (const l of live) {
    const f = l.f;
    const near = faces.query(l.box).filter((x) => meets(x.box, l.box));
    const area0 = areaD(l.path);
    const overlap = near.length ? areaOf(intersectD([l.path], near.map((x) => x.ring), FillRule.NonZero, PRECISION)) : 0;
    if (overlap < o.minOverlapM2) {
      out.push(f);
      continue;
    }
    counts.onRoad++;
    counts.overlapM2 += overlap;
    const mid = centroid([l.path]) ?? { x: (l.box.minX + l.box.maxX) / 2, z: (l.box.minZ + l.box.maxZ) / 2 };
    const base = { id: f.id, source: f.source, overlapM2: r2(overlap), areaBefore: r1(area0), x: r1(mid.x), z: r1(mid.z) };
    // the road around it, with the clearance: wide enough for a move back
    const pad = o.shiftMaxM + o.clearanceM + 0.5;
    const wide = faces.query(l.box, pad).filter((x) => meets(x.box, l.box, pad));
    const soft = inflatePathsD(unionD(wide.map((x) => x.ring), FillRule.NonZero), o.clearanceM, JoinType.Miter, EndType.Polygon, 2, PRECISION);
    // move it back when little of it is on the road and the ground behind is free
    let moved = false;
    if (!pinned(f) && overlap / area0 <= o.shiftShare) {
      const on = centroid(intersectD([l.path], near.map((x) => x.ring), FillRule.NonZero, PRECISION));
      const d = on ? Math.hypot(mid.x - on.x, mid.z - on.z) : 0;
      if (on && d > 0.05) {
        const ux = (mid.x - on.x) / d;
        const uz = (mid.z - on.z) / d;
        const before = onOthers(l, l.path, l.box);
        for (let t = o.shiftStepM; t <= o.shiftMaxM + 1e-9; t += o.shiftStepM) {
          const path = l.path.map((q) => ({ x: q.x + ux * t, y: q.y + uz * t }));
          if (areaOf(intersectD([path], soft, FillRule.NonZero, PRECISION)) > 1e-3) continue;
          const box = { minX: l.box.minX + ux * t, maxX: l.box.maxX + ux * t, minZ: l.box.minZ + uz * t, maxZ: l.box.maxZ + uz * t };
          if (onOthers(l, path, box) > before + o.neighbourTolM2) break;
          const nf: GraphFootprint = { ...f, ring: ringOf(path, reversed(f)) };
          l.dead = true;
          const nl: Live = { f: nf, path, box, dead: false };
          grid.insert(box, nl);
          out.push(nf);
          counts.shifted++;
          lines.push({ ...base, action: 'shifted', areaAfter: r1(area0), movedM: r1(t) });
          moved = true;
          break;
        }
      }
    }
    if (moved) continue;
    // cut it back to the road's edge
    const holes = openHoles(differenceD([l.path], soft, FillRule.NonZero, PRECISION));
    counts.holesOpened += holes.opened;
    const parts = holes.parts.filter((p) => {
      const a = areaD(p);
      return a >= o.minPartM2 && (2 * a) / (perimeter(p) || 1) >= o.minPartWidthM;
    }).sort((a, b) => areaD(b) - areaD(a) || (a[0] as PathD[number]).x - (b[0] as PathD[number]).x || (a[0] as PathD[number]).y - (b[0] as PathD[number]).y);
    l.dead = true;
    if (!parts.length) {
      counts.dropped++;
      counts.removedM2 += area0;
      lines.push({ ...base, action: 'dropped', areaAfter: 0 });
      continue;
    }
    const flip = reversed(f);
    const ids: string[] = [];
    let kept = 0;
    parts.forEach((p, k) => {
      const ring = ringOf(p, flip);
      if (ring.length < 3) return;
      const id = k === 0 ? f.id : `${f.id}~${k}`;
      const a = areaD(p);
      kept += a;
      const nf: GraphFootprint = { ...f, id, ring, area: r1(a), tags: { ...f.tags } };
      out.push(nf);
      grid.insert(boxOf(ring), { f: nf, path: p, box: boxOf(ring), dead: false });
      ids.push(id);
    });
    counts.removedM2 += area0 - kept;
    if (ids.length > 1) {
      counts.split++;
      lines.push({ ...base, action: 'split', areaAfter: r1(kept), parts: ids });
    } else {
      counts.trimmed++;
      lines.push({ ...base, action: 'trimmed', areaAfter: r1(kept) });
    }
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  counts.overlapM2 = r1(counts.overlapM2);
  counts.removedM2 = r1(counts.removedM2);
  counts.footprintsAfter = out.length;
  return { footprints: out, lines, counts };
}

/** What is still on the road after a clear: the footprints and the area (both 0 when the clear did its job). */
export function leftOnRoad(footprints: readonly GraphFootprint[], faces: Grid<RoadFace>, limitM2 = 0.01): { count: number; areaM2: number; worst: { id: string; areaM2: number }[] } {
  const worst: { id: string; areaM2: number }[] = [];
  let area = 0;
  for (const f of footprints) {
    const a = onRoadM2(f.ring, faces);
    if (a <= limitM2) continue;
    area += a;
    worst.push({ id: f.id, areaM2: r2(a) });
  }
  worst.sort((a, b) => b.areaM2 - a.areaM2 || (a.id < b.id ? -1 : 1));
  return { count: worst.length, areaM2: r2(area), worst: worst.slice(0, 12) };
}

/** What the building clear did (health.json `buildings`, P1-030). */
export interface BuildingsRecord {
  /** Road faces the ground meets (carriageways, kerbs, footpaths, junction surfaces at ground level): what a building may not stand on. */
  roadFaces: number;
  counts: ClearCounts;
  /** Footprints the clear touched that no R-BLDG-01 issue named (on a kerb, a junction corner or a lane the model built wider than the graph). */
  withoutIssue: number;
  bySource: Record<string, number>;
  /** Footprints still on a road face after the clear, and the area: 0 or the bake stops. */
  left: { count: number; areaM2: number; worst: { id: string; areaM2: number }[] };
  clearanceM: number;
  ms: number;
  /** The list of every change, one line each. */
  file: string;
}
