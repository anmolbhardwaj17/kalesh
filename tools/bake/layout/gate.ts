// Rule R-STITCH of the signed seamless map (P1-008; MAP_REPAIR.md "District frames and stitching", TECH.md "World
// layout" Gates). It runs in every bake, before any tile is written, and a failure stops the bake:
//
//   R-STITCH-01  data       districts.json follows the placement method (factors, offsets, no transform keys)
//   R-STITCH-02  translation  every block is placed by a translation only: north on -Z, east on +X, determinant +1, no scale
//   R-STITCH-03  centre pairs every pair of centre places keeps its real bearing within 0.5 degrees and its real
//                             distance within 0.5%
//   R-STITCH-04  far blocks   every far block's origin is on its real bearing from the pivot within 0.1 degree, at the
//                             far factor times its real distance within 0.5%
//   R-STITCH-05  block gaps   placed block outlines do not overlap and keep the least gap for a corridor
//   R-STITCH-06  extent       the map box is under 16 km wide and nothing is farther than the reach limit from the
//                             world origin, today and after the recentre step (FP1)
//
// The yardstick is the geodesic on the ellipsoid (geodesic.ts), which shares no code with the projection.
// The boundary port rules of the old island bench (every district edge a ring of ports) are gone: inside a block
// streets run on. Ports exist only at the map edge and at corridor ends (edge.ts, closures.ts). Pure.
import type { LatLon } from '../../geo/projection.ts';
import type { P2 } from '../geom.ts';
import type { InvariantResult, LayoutRecord, PairRecord } from '../report/health.ts';
import { ringGap, ringOverlapArea } from './edge.ts';
import { bearingDiffDeg, geodesic, layoutPair, worldBearingDeg } from './geodesic.ts';
import type { LayoutPair, PlacedPoint } from './geodesic.ts';
import { blockFrame, blockPlacers, layoutProblems, placer, transformCheck } from './placement.ts';
import type { LayoutFile, LayoutGates, Placer, TransformCheck } from './placement.ts';
import { mapExtent, recentreVector, smallestCircle } from './recentre.ts';
import type { Circle, Extent, NamedPoint } from './recentre.ts';

export const RULE = 'R-STITCH';

/** A named real place of a block (harness/data/districts/places.json). */
export interface Place extends LatLon {
  id: string;
  name: string;
  block: string;
  /** The source element the position was read from. */
  from: string;
}

/** A closed outline in WGS84 ([lon, lat] pairs, GeoJSON order) that belongs to a block. */
export interface BlockOutline {
  id: string;
  block: string;
  coords: [number, number][];
}

/** Places of one block placed by that block's frame: what the bake will write. */
export function placePoints(file: LayoutFile, places: readonly Place[], block: string): PlacedPoint[] {
  const p = placer(blockFrame(file, block));
  return places.filter((x) => x.block === block).map((x) => ({ name: x.name, geo: { lat: x.lat, lon: x.lon }, world: p.toWorld(x.lat, x.lon) }));
}

export interface PairRow extends LayoutPair {
  ok: boolean;
}

/** Every pair of the points: the game's bearing and distance against the real ones. */
export function pairTable(points: readonly PlacedPoint[], gates: Pick<LayoutGates, 'centrePairBearingDeg' | 'centrePairDistancePct'>): PairRow[] {
  const rows: PairRow[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const pair = layoutPair(points[i] as PlacedPoint, points[j] as PlacedPoint);
      rows.push({ ...pair, ok: pair.bearingErrorDeg <= gates.centrePairBearingDeg && pair.errorPct <= gates.centrePairDistancePct });
    }
  }
  return rows;
}

export interface FarCheck {
  block: string;
  factor: number;
  realM: number;
  realBearingDeg: number;
  gameM: number;
  gameBearingDeg: number;
  bearingErrorDeg: number;
  /** The game distance against factor times the real distance, in percent of the latter. */
  distanceErrorPct: number;
  ok: boolean;
}

/** Every far block's frame origin as seen from the pivot: real bearing, and the far factor times the real distance. */
export function farBlockChecks(file: LayoutFile): FarCheck[] {
  const { pivot, centreFactor, gates } = file.method;
  return file.blocks.filter((b) => b.factor !== centreFactor).map((b) => {
    const real = geodesic(pivot, b.frameOrigin);
    const o = blockFrame(file, b.id).offset;
    const dx = o.x - pivot.world.x;
    const dz = o.z - pivot.world.z;
    const gameM = Math.hypot(dx, dz);
    const gameBearingDeg = worldBearingDeg(dx, dz);
    const bearingErrorDeg = bearingDiffDeg(gameBearingDeg, real.bearingDeg);
    const want = b.factor * real.distanceM;
    const distanceErrorPct = want > 0 ? (Math.abs(gameM - want) / want) * 100 : 0;
    return {
      block: b.id, factor: b.factor, realM: real.distanceM, realBearingDeg: real.bearingDeg, gameM, gameBearingDeg, bearingErrorDeg, distanceErrorPct,
      ok: bearingErrorDeg <= gates.farBearingDeg && distanceErrorPct <= gates.farDistancePct,
    };
  });
}

/** An outline as an open ring in world metres, placed by its block's frame. */
export function placedRing(coords: readonly (readonly [number, number])[], p: Placer): P2[] {
  const pts = coords.map(([lon, lat]) => p.toWorld(lat, lon));
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first && last && pts.length > 1 && Math.hypot(first.x - last.x, first.z - last.z) < 1e-6) pts.pop();
  return pts;
}

export interface RingPairs {
  pairs: { a: string; b: string; overlapM2: number; gapM: number }[];
  /** Pairs of placed outlines that share area. */
  overlapping: number;
  overlapAreaM2: number;
  minGapM: number;
  minGapBetween: [string, string] | null;
}

/** Every pair of placed rings (world metres): shared area and the smallest distance between them. */
export function ringPairs(rings: readonly { id: string; ring: readonly P2[] }[]): RingPairs {
  const out: RingPairs = { pairs: [], overlapping: 0, overlapAreaM2: 0, minGapM: Infinity, minGapBetween: null };
  for (let i = 0; i < rings.length; i++) {
    for (let j = i + 1; j < rings.length; j++) {
      const a = rings[i] as { id: string; ring: readonly P2[] };
      const b = rings[j] as { id: string; ring: readonly P2[] };
      const overlapM2 = Math.round(ringOverlapArea(a.ring, b.ring) * 10) / 10;
      const gapM = Math.round(ringGap(a.ring, b.ring) * 10) / 10;
      out.pairs.push({ a: a.id, b: b.id, overlapM2, gapM });
      if (overlapM2 > 0.5) {
        out.overlapping++;
        out.overlapAreaM2 += overlapM2;
      }
      if (gapM < out.minGapM) {
        out.minGapM = gapM;
        out.minGapBetween = [a.id, b.id];
      }
    }
  }
  if (rings.length < 2) out.minGapM = 0;
  return out;
}

export interface LayoutInput {
  file: LayoutFile;
  /** Named real places; the centre ones feed the pair gate. */
  places: readonly Place[];
  /** Every outline that is drawn: block outlines, stage outlines, focus outlines. */
  outlines: readonly BlockOutline[];
}

export interface ExtentCheck extends Extent {
  /** The smallest circle round every position: no world origin can do better than its radius. */
  circle: Circle;
  /** The world origin after the recentre step: the circle's centre snapped to whole tiles. */
  originAfterRecentre: P2;
  /** Farthest position from that origin, metres. */
  reachAfterRecentreM: number;
  reachAfterRecentreAt: string;
  /** Farthest position of the centre block from today's world origin (what is baked before the recentre), metres. */
  reachNowM: number;
  reachNowAt: string;
  positions: number;
  ok: boolean;
}

/**
 * Every position the layout knows, in world metres: outline points placed by their block, places, and the origins of
 * focus and planned districts whose block exists (a "later" place on a block that is not planned yet is left out).
 */
export function layoutPositions(input: LayoutInput, onlyBlock?: string): NamedPoint[] {
  const { file } = input;
  const placers = new Map(blockPlacers(file).filter((p) => onlyBlock === undefined || p.frame.id === onlyBlock).map((p) => [p.frame.id, p]));
  const out: NamedPoint[] = [];
  for (const o of input.outlines) {
    const p = placers.get(o.block);
    if (!p) continue;
    placedRing(o.coords, p).forEach((q, i) => out.push({ name: `${o.id} outline point ${i}`, x: q.x, z: q.z }));
  }
  for (const pl of input.places) {
    const p = placers.get(pl.block);
    if (p) out.push({ name: pl.name, ...p.toWorld(pl.lat, pl.lon) });
  }
  for (const d of [...file.districts, ...(file.planned ?? [])]) {
    const p = placers.get(d.block);
    if (p && d.origin && d.stage !== 'later') out.push({ name: `${d.id} (${d.name})`, ...p.toWorld(d.origin.lat, d.origin.lon) });
  }
  for (const p of placers.values()) out.push({ name: `block ${p.frame.id} origin`, x: p.frame.offset.x, z: p.frame.offset.z });
  return out;
}

/**
 * The size of the planned map (FP1): the map box, the smallest circle round every position, and the farthest
 * position from the world origin, both today (the centre block from today's origin) and after the recentre step.
 */
export function extentCheck(input: LayoutInput): ExtentCheck {
  const { gates, centreFactor } = input.file.method;
  const limit = gates.reachMaxKm * 1000;
  const points = layoutPositions(input);
  const e = mapExtent(points);
  const circle = smallestCircle(points);
  const origin = recentreVector(points);
  const after = mapExtent(points, origin);
  const centre = input.file.blocks.find((b) => b.factor === centreFactor);
  const now = mapExtent(centre ? layoutPositions(input, centre.id) : points, { x: 0, z: 0 });
  const wide = Math.max(e.widthM, e.depthM);
  return {
    ...e, circle, originAfterRecentre: origin, reachAfterRecentreM: after.reachM, reachAfterRecentreAt: after.reachAt, reachNowM: now.reachM, reachNowAt: now.reachAt, positions: points.length,
    ok: wide < gates.mapWidthMaxKm * 1000 && after.reachM <= limit && now.reachM <= limit,
  };
}

export interface LayoutCheck {
  problems: string[];
  transforms: TransformCheck[];
  pairs: PairRow[];
  far: FarCheck[];
  /** Placed block outlines against each other (blocks that have an outline; the centre block by its stage outlines). */
  blocks: RingPairs;
  extent: ExtentCheck;
  results: InvariantResult[];
}

const r = (v: number, d = 3): number => Math.round(v * 10 ** d) / 10 ** d;
const ok = (id: string, detail: string): InvariantResult => ({ id, ok: true, detail });
const fail = (id: string, detail: string): InvariantResult => ({ id, ok: false, detail });

/** Runs rule R-STITCH on the layout. `world` lets a later step pass positions read back from baked tiles instead. */
export function checkLayout(input: LayoutInput, world?: (place: Place) => P2 | null): LayoutCheck {
  const { file, places } = input;
  const { gates, centreFactor } = file.method;
  const results: InvariantResult[] = [];

  const problems = layoutProblems(file);
  results.push(problems.length ? fail(`${RULE}-01.data`, problems.slice(0, 6).join('; ')) : ok(`${RULE}-01.data`, `${file.blocks.length} blocks follow the placement method; no key can carry a rotation, a scale or a mirror`));

  const transforms = blockPlacers(file).map((p) => transformCheck(p));
  const badT = transforms.filter((t) => !t.ok);
  results.push(
    badT.length
      ? fail(`${RULE}-02.translation`, badT.map((t) => `${t.block}: jacobian off by ${t.jacobianError.toExponential(1)}, north ${r(t.northOffDeg, 6)} deg off -Z, determinant ${r(t.determinant, 6)}, scale ${r(t.scaleNorth, 6)} / ${r(t.scaleEast, 6)}`).join('; '))
      : ok(`${RULE}-02.translation`, `${transforms.length} blocks: translation only, north on -Z, east on +X, determinant +1, no scale`),
  );

  const centre = file.blocks.find((b) => b.factor === centreFactor);
  const centrePlaces = centre ? places.filter((p) => p.block === centre.id) : [];
  let points: PlacedPoint[] = centre ? placePoints(file, centrePlaces, centre.id) : [];
  if (world && centre) {
    points = [];
    for (const p of centrePlaces) {
      const w = world(p);
      if (w) points.push({ name: p.name, geo: { lat: p.lat, lon: p.lon }, world: w });
    }
  }
  const pairs = pairTable(points, gates);
  const badP = pairs.filter((p) => !p.ok);
  const maxB = pairs.reduce((m, p) => Math.max(m, p.bearingErrorDeg), 0);
  const maxD = pairs.reduce((m, p) => Math.max(m, p.errorPct), 0);
  if (points.length < 2) results.push(fail(`${RULE}-03.centrePairs`, `only ${points.length} centre places: the pair gate needs at least two`));
  else if (badP.length) results.push(fail(`${RULE}-03.centrePairs`, `${badP.length} of ${pairs.length} pairs are off: ${badP.slice(0, 4).map((p) => `${p.a} to ${p.b} ${r(p.bearingErrorDeg, 2)} deg, ${r(p.errorPct, 2)}%`).join('; ')}`));
  else results.push(ok(`${RULE}-03.centrePairs`, `${pairs.length} pairs of ${points.length} centre places: worst bearing ${r(maxB, 4)} deg (limit ${gates.centrePairBearingDeg}), worst distance ${r(maxD, 5)}% (limit ${gates.centrePairDistancePct})`));

  const far = farBlockChecks(file);
  const badF = far.filter((f) => !f.ok);
  results.push(
    badF.length
      ? fail(`${RULE}-04.farBlocks`, badF.map((f) => `${f.block}: bearing ${r(f.bearingErrorDeg, 3)} deg off, distance ${r(f.distanceErrorPct, 3)}% off`).join('; '))
      : ok(`${RULE}-04.farBlocks`, far.length ? `${far.length} far blocks on their real bearing from ${file.method.pivot.name}: worst ${r(Math.max(...far.map((f) => f.bearingErrorDeg)), 4)} deg, distance ${r(Math.max(...far.map((f) => f.distanceErrorPct)), 4)}% off factor times real` : 'no far block'),
  );

  // one ring per far block; the centre block by every outline drawn inside it (stage and focus outlines)
  const placers = new Map(blockPlacers(file).map((p) => [p.frame.id, p]));
  const rings: { id: string; block: string; ring: P2[] }[] = [];
  for (const o of input.outlines) {
    const p = placers.get(o.block);
    if (p) rings.push({ id: o.id, block: o.block, ring: placedRing(o.coords, p) });
  }
  // outlines of one block may lie inside each other (a focus outline in a stage outline): only pairs of different blocks count
  const blocks: RingPairs = { pairs: [], overlapping: 0, overlapAreaM2: 0, minGapM: Infinity, minGapBetween: null };
  for (let i = 0; i < rings.length; i++) {
    for (let j = i + 1; j < rings.length; j++) {
      const a = rings[i] as { id: string; block: string; ring: P2[] };
      const b = rings[j] as { id: string; block: string; ring: P2[] };
      if (a.block === b.block) continue;
      const one = ringPairs([a, b]);
      blocks.pairs.push(...one.pairs);
      blocks.overlapping += one.overlapping;
      blocks.overlapAreaM2 += one.overlapAreaM2;
      if (one.minGapM < blocks.minGapM) {
        blocks.minGapM = one.minGapM;
        blocks.minGapBetween = one.minGapBetween;
      }
    }
  }
  if (!blocks.pairs.length) blocks.minGapM = 0;
  if (!blocks.pairs.length) results.push(ok(`${RULE}-05.blockGaps`, 'no two blocks have outlines yet'));
  else if (blocks.overlapping) results.push(fail(`${RULE}-05.blockGaps`, `${blocks.overlapping} pairs of block outlines overlap (${Math.round(blocks.overlapAreaM2)} m2): ${blocks.pairs.filter((p) => p.overlapM2 > 0.5).slice(0, 4).map((p) => `${p.a} and ${p.b}`).join('; ')}`));
  else if (blocks.minGapM < gates.blockGapMinM) results.push(fail(`${RULE}-05.blockGaps`, `${blocks.minGapBetween?.join(' and ')} are ${blocks.minGapM} m apart, under the ${gates.blockGapMinM} m a corridor needs`));
  else results.push(ok(`${RULE}-05.blockGaps`, `${blocks.pairs.length} pairs of outlines of different blocks: no overlap, least gap ${blocks.minGapM} m (${blocks.minGapBetween?.join(' and ')}; limit ${gates.blockGapMinM} m)`));

  const extent = extentCheck(input);
  const wideKm = Math.max(extent.widthM, extent.depthM) / 1000;
  const extentText =
    `map box ${r(extent.widthM / 1000, 2)} by ${r(extent.depthM / 1000, 2)} km (limit ${gates.mapWidthMaxKm}); farthest position after the recentre ${r(extent.reachAfterRecentreM / 1000, 3)} km at ${extent.reachAfterRecentreAt}, ` +
    `today ${r(extent.reachNowM / 1000, 3)} km at ${extent.reachNowAt} (limit ${gates.reachMaxKm}); the smallest circle round the map has a radius of ${r(extent.circle.radiusM / 1000, 3)} km, the box centre would leave ${r(extent.reachM / 1000, 3)} km`;
  results.push(extent.ok ? ok(`${RULE}-06.extent`, extentText) : fail(`${RULE}-06.extent`, `${wideKm >= gates.mapWidthMaxKm ? 'too wide: ' : 'too far from the world origin: '}${extentText}`));

  return { problems, transforms, pairs, far, blocks, extent, results };
}

/** The pair table as the health report keeps it: rounded, one row per pair. */
export function pairRows(pairs: readonly PairRow[]): PairRecord[] {
  return pairs.map((p) => ({ a: p.a, b: p.b, realM: r(p.realM, 1), gameM: r(p.bakedM, 1), errorPct: r(p.errorPct, 5), realBearingDeg: r(p.realBearingDeg, 4), gameBearingDeg: r(p.bakedBearingDeg, 4), bearingErrorDeg: r(p.bearingErrorDeg, 4), ok: p.ok }));
}

/** What the rule measured, as the health report keeps it. */
export function layoutRecord(file: LayoutFile, c: LayoutCheck, centrePlaces: number): LayoutRecord {
  const e = c.extent;
  return {
    centrePlaces,
    centrePairs: c.pairs.length,
    worstPairBearingDeg: r(c.pairs.reduce((m, p) => Math.max(m, p.bearingErrorDeg), 0), 4),
    worstPairDistancePct: r(c.pairs.reduce((m, p) => Math.max(m, p.errorPct), 0), 5),
    blocks: c.transforms.map((t) => {
      const o = blockFrame(file, t.block).offset;
      return { id: t.block, offset: { x: r(o.x, 1), z: r(o.z, 1) }, translationOnly: t.ok, northOffDeg: r(t.northOffDeg, 6), determinant: r(t.determinant, 9) };
    }),
    far: c.far.map((f) => ({ block: f.block, realM: r(f.realM, 1), realBearingDeg: r(f.realBearingDeg, 3), gameM: r(f.gameM, 1), gameBearingDeg: r(f.gameBearingDeg, 3), bearingErrorDeg: r(f.bearingErrorDeg, 4), distanceErrorPct: r(f.distanceErrorPct, 4) })),
    blockGapMinM: c.blocks.minGapM,
    blockGapBetween: c.blocks.minGapBetween,
    mapBoxKm: { width: r(e.widthM / 1000), depth: r(e.depthM / 1000) },
    smallestCircleKm: r(e.circle.radiusM / 1000),
    reachFromBoxCentreKm: r(e.reachM / 1000),
    originAfterRecentre: e.originAfterRecentre,
    reachAfterRecentreKm: r(e.reachAfterRecentreM / 1000),
    reachNowKm: r(e.reachNowM / 1000),
  };
}
