// Footways, paths, steps, sidewalks drawn as their own ways and pedestrian areas as paved walking surfaces in the
// ground (P2-042: "footways, pedestrian streets and plazas built as walkable surfaces, not dropped"). Each line is
// grown to its width, the areas are taken as they are, everything is united, then cut off the road faces (they have
// their own footpaths and crossings), the buildings and the water, and kept inside the outline. The result goes into
// the ground triangulation like a landmark forecourt (terrain/collect.ts): its rings are forced edges and the
// triangles inside take the `walkway` material over plain ground, lawn and plot. Pure.
import { EndType, FillRule, JoinType, differenceD, inflatePathsD, intersectD, simplifyPathsD, unionD } from 'clipper2-ts';
import type { PathD, PathsD } from 'clipper2-ts';
import type { P2 } from '../geom.ts';
import { boxOf, pointInRing, ringArea } from '../geom.ts';
import type { WalkwayFeature } from '../graph/features.ts';
import type { LandmarkGround } from './collect.ts';

/** The walkway keeps this far off a road face, a building and the water (m): no sliver of ground between them. */
export const ROAD_CLEAR_M = 0.3;
const BUILDING_CLEAR_M = 0.2;
const WATER_CLEAR_M = 0.5;
/** Pieces smaller than this are dropped (m2), and ring points closer than this to the line are dropped (m). */
const MIN_AREA_M2 = 2;
const SIMPLIFY_M = 0.05;
const PRECISION = 2;

export interface WalkwayInput {
  walkways: readonly WalkwayFeature[];
  /** Every road face the ground meets (block metres). */
  roads: readonly (readonly P2[])[];
  footprints: readonly (readonly P2[])[];
  water: readonly (readonly (readonly P2[])[])[];
  outline: readonly P2[];
}

export interface WalkwaysRecord {
  /** Ways read and their length or area by kind. */
  ways: number;
  byKind: Record<string, { ways: number; m: number; m2: number }>;
  /** Paved walking surface laid in the ground (m2), its pieces and holes. */
  areaM2: number;
  pieces: number;
  holes: number;
  /** Walkway area the roads, buildings and water took (m2): drawn on a road it is the road's footpath or crossing. */
  cutM2: number;
}

const toPath = (ring: readonly P2[]): PathD => ring.map((p) => ({ x: p.x, y: p.z }));
const fromPath = (p: PathD): P2[] => p.map((q) => ({ x: Math.round(q.x * 100) / 100 + 0, z: Math.round(q.y * 100) / 100 + 0 }));
const areaOf = (paths: PathsD): number => paths.reduce((s, p) => s + ringArea(fromPath(p)), 0);

/** Things whose box meets a box (a plain grid of 50 m cells). */
function nearIndex(rings: readonly (readonly P2[])[]): (box: { minX: number; maxX: number; minZ: number; maxZ: number }) => number[] {
  const CELL = 50;
  const grid = new Map<string, number[]>();
  rings.forEach((r, i) => {
    if (r.length < 3) return;
    const b = boxOf(r as P2[]);
    for (let x = Math.floor(b.minX / CELL); x <= Math.floor(b.maxX / CELL); x++) for (let z = Math.floor(b.minZ / CELL); z <= Math.floor(b.maxZ / CELL); z++) (grid.get(`${x},${z}`) ?? grid.set(`${x},${z}`, []).get(`${x},${z}`) as number[]).push(i);
  });
  return (b) => {
    const out = new Set<number>();
    for (let x = Math.floor(b.minX / CELL); x <= Math.floor(b.maxX / CELL); x++) for (let z = Math.floor(b.minZ / CELL); z <= Math.floor(b.maxZ / CELL); z++) for (const i of grid.get(`${x},${z}`) ?? []) out.add(i);
    return [...out].sort((p, q) => p - q);
  };
}

/** The ground pieces of the walkways (material `walkway`) and their record. */
export function walkwayGround(input: WalkwayInput): { pieces: LandmarkGround[]; record: WalkwaysRecord } {
  const byKind: WalkwaysRecord['byKind'] = {};
  const subject: PathsD = [];
  for (const w of input.walkways) {
    const k = (byKind[w.kind] ??= { ways: 0, m: 0, m2: 0 });
    k.ways++;
    if (w.area) {
      const rings = (w.rings ?? [w.pts]).map(toPath);
      const u = unionD(rings, [], FillRule.EvenOdd, PRECISION);
      k.m2 += Math.abs(areaOf(u));
      subject.push(...u);
    } else {
      let len = 0;
      for (let i = 1; i < w.pts.length; i++) len += Math.hypot((w.pts[i] as P2).x - (w.pts[i - 1] as P2).x, (w.pts[i] as P2).z - (w.pts[i - 1] as P2).z);
      k.m += len;
      subject.push(...inflatePathsD([toPath(w.pts)], w.width / 2, JoinType.Round, EndType.Round, 2, PRECISION, 0.05));
    }
  }
  for (const k of Object.values(byKind)) {
    k.m = Math.round(k.m);
    k.m2 = Math.round(k.m2);
  }
  const empty: WalkwaysRecord = { ways: input.walkways.length, byKind, areaM2: 0, pieces: 0, holes: 0, cutM2: 0 };
  if (!subject.length) return { pieces: [], record: empty };
  const united = unionD(subject, [], FillRule.NonZero, PRECISION);
  const before = Math.abs(areaOf(united));
  // the roads, buildings and water near the walkways, each grown by its clearance
  const roadsNear = nearIndex(input.roads);
  const fpNear = nearIndex(input.footprints);
  const waterRings = input.water.flatMap((w) => w);
  const waterNear = nearIndex(waterRings);
  const cutters: PathsD = [];
  // per walkway piece, only what lies near it: a difference against every road face of the stage is slow
  const seen = { road: new Set<number>(), fp: new Set<number>(), water: new Set<number>() };
  for (const piece of united) {
    const b = boxOf(piece.map((q) => ({ x: q.x, z: q.y })));
    const pad = { minX: b.minX - 1, maxX: b.maxX + 1, minZ: b.minZ - 1, maxZ: b.maxZ + 1 };
    for (const i of roadsNear(pad)) seen.road.add(i);
    for (const i of fpNear(pad)) seen.fp.add(i);
    for (const i of waterNear(pad)) seen.water.add(i);
  }
  const grow = (rings: PathsD, d: number): PathsD => (rings.length ? inflatePathsD(unionD(rings, [], FillRule.NonZero, PRECISION), d, JoinType.Miter, EndType.Polygon, 2, PRECISION) : []);
  cutters.push(...grow([...seen.road].map((i) => toPath(input.roads[i] as P2[])), ROAD_CLEAR_M));
  cutters.push(...grow([...seen.fp].map((i) => toPath(input.footprints[i] as P2[])), BUILDING_CLEAR_M));
  cutters.push(...grow([...seen.water].map((i) => toPath(waterRings[i] as P2[])), WATER_CLEAR_M));
  let left = cutters.length ? differenceD(united, cutters, FillRule.NonZero, PRECISION) : united;
  const inside = inflatePathsD([toPath(input.outline)], -1, JoinType.Miter, EndType.Polygon, 2, PRECISION);
  left = intersectD(left, inside, FillRule.NonZero, PRECISION);
  left = simplifyPathsD(left, SIMPLIFY_M, true);
  const rings = left.map(fromPath).filter((r) => r.length >= 3 && Math.abs(ringArea(r)) >= MIN_AREA_M2 / 4);
  // clipper winds outer rings one way and holes the other: the sign of the largest ring is the outer sign
  let big = 0;
  for (const r of rings) if (Math.abs(ringArea(r)) > Math.abs(big)) big = ringArea(r);
  const outers = rings.filter((r) => Math.sign(ringArea(r)) === Math.sign(big) && Math.abs(ringArea(r)) >= MIN_AREA_M2);
  const holes = rings.filter((r) => Math.sign(ringArea(r)) !== Math.sign(big));
  const pieces: { ring: P2[]; area: number; holes: P2[][] }[] = outers
    .map((ring) => ({ ring, area: Math.abs(ringArea(ring)), holes: [] as P2[][] }))
    .sort((a, b) => a.area - b.area);
  let holeCount = 0;
  for (const h of holes) {
    const p0 = h[0] as P2;
    const owner = pieces.find((p) => pointInRing(p0, p.ring));
    if (owner) {
      owner.holes.push(h);
      holeCount++;
    }
  }
  const out: LandmarkGround[] = pieces.map((p, i) => ({ landmark: `walkway_${i}`, cls: 'walkway', ring: p.ring, ...(p.holes.length ? { holes: p.holes } : {}), material: 'walkway' }));
  const areaM2 = pieces.reduce((s, p) => s + p.area - p.holes.reduce((t, h) => t + Math.abs(ringArea(h)), 0), 0);
  return { pieces: out, record: { ...empty, areaM2: Math.round(areaM2), pieces: out.length, holes: holeCount, cutM2: Math.round(before - areaM2) } };
}
