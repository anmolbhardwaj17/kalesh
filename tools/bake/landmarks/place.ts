// Landmark placement (P2-006, DELHI_WORLD.md "Placement rules" and section 10, LP2 and HM2). From the registry
// entries of a stage it works out, for every landmark that may be placed:
// - the position in the block frame (the projected point; world metres are that plus the block offset) and the
//   bearing its front faces (the registry's orientation, from the footprint's main axis and a front read from evidence);
// - the mode: a `structure` (the footprint is the thing itself: an arch, a gate, a mosque), a `site` (the footprint is
//   its grounds: a fort, a park, a stadium, the rings of Connaught Place) or a `point` (no footprint, or underground:
//   a pin only, never a shell or a pad);
// - the pad: a flat piece of ground under a structure (its footprint plus a margin) or under the part of a site an
//   edit names, cut back from every road and from water, at one level;
// - the zone: the pad plus a clear ring, or the whole site. Every repaired building footprint inside a zone leaves
//   the plain buildings: inside a structure's zone it is replaced by the landmark's own massing, inside a site it
//   becomes a part of the landmark. Each one is logged;
// - the surroundings: lawns and water of the map that lie in the zone, walls and fences, a forecourt (the zone's own
//   ground), the wall line of a fort and a moat band where an edit gives its width, with the ground pieces the
//   terrain step lays as ground classes;
// - the LOD slots of the tier and, for a hero, the far silhouette.
// A landmark outside the stage (far) is placed on the backdrop through the frame of the block it will stand in, on
// its real bearing, and moved outward when that point would lie in a reachable tile. Roads win over everything
// (DELHI_WORLD.md "OSM is reference": road corridor, then landmark zone, then blueprint, then the generator). Pure.
import { EndType, FillRule, JoinType, differenceD, inflatePathsD, intersectD, unionD } from 'clipper2-ts';
import type { PathD, PathsD } from 'clipper2-ts';
import { boxOf, boxesMeet, pointInRing, polylineLength, ringArea, ringCentroid } from '../geom.ts';
import type { Box2, P2 } from '../geom.ts';
import { bearingVector } from './orient.ts';
import type { Entry, Tier } from './types.ts';

export type Mode = 'structure' | 'site' | 'point';

/** A building footprint of the repaired graph (block metres). */
export interface PlaceFootprint {
  id: string;
  ring: readonly P2[];
  height: number | null;
  levels: number | null;
  tags: Readonly<Record<string, string>>;
}

export interface PlaceArea {
  id: string;
  kind: string;
  name: string;
  rings: readonly (readonly P2[])[];
}

export interface PlaceLine {
  id: string;
  /** wall, city_wall, retaining_wall, fence or hedge. */
  kind: string;
  name: string;
  pts: readonly P2[];
}

/** The limits of perf_budgets.json world.landmarks. */
export interface LandmarkBudgets {
  heroPartsMax: number;
  heroTrianglesPerPart: number;
  heroMaterialsMax: number;
  heroLods: number;
  farSilhouetteTriangles: number;
  heroesAtFullDetailInView: number;
  positionErrorM: Record<Tier, number>;
}

export interface PlaceInput {
  stage: string;
  block: string;
  /** Registry entries of the stage: heroes, signatures and markers. */
  entries: readonly Entry[];
  /** lat, lon to block metres (the block projection around its frame origin). */
  project: (lat: number, lon: number) => P2;
  /** Block metres to world metres. */
  offset: P2;
  /** The stage outline, block metres. */
  outline: readonly P2[];
  footprints: readonly PlaceFootprint[];
  /** Every road face the ground meets (block metres): nothing of a landmark lies on one. */
  roads: readonly (readonly P2[])[];
  water: readonly PlaceArea[];
  open: readonly PlaceArea[];
  barriers: readonly PlaceLine[];
  /** The ground model (block metres). */
  ground: (x: number, z: number) => number;
  budgets: LandmarkBudgets;
  /** World metres of a far landmark: through the frame of the block it will stand in (its real bearing from that block's pivot). */
  farWorld: (e: Entry) => { x: number; z: number; block: string; factor: number };
  /** True when a world point lies in a tile the player can reach, or within the clear distance of one. */
  reachable: (x: number, z: number) => boolean;
  /** The world pivot the far bearings are measured from. */
  pivot: P2;
}

/** A piece of ground the terrain step lays as a ground class (block metres). */
export interface GroundPiece {
  landmark: string;
  cls: 'pad' | 'forecourt' | 'wallbase' | 'moat';
  ring: P2[];
  /** A pad: its level. A moat: how far its bed lies under the ground. */
  level?: number;
  depth?: number;
  /** The ground material: pad, forecourt, lawn, wallbase or moat. */
  material: string;
}

export interface Surround {
  kind: 'lawn' | 'water' | 'wall' | 'fence' | 'forecourt' | 'moat';
  source: 'osm' | 'rule';
  ref: string;
  /** Area in m2, or length in m for a line. */
  size: number;
  note?: string;
}

export interface Replaced {
  /** The footprint id of the repaired graph. */
  id: string;
  landmark: string;
  /** `replaced`: the landmark's massing stands in its place. `part`: it stays as a part of the landmark. */
  how: 'replaced' | 'part';
  areaM2: number;
  /** World metres of its centroid. */
  x: number;
  z: number;
}

export interface LodSlot {
  level: number;
  /** Shown from this distance to the next one (m). */
  fromM: number;
  toM: number;
  /** Where the mesh comes from now: the stand-in massing in the tiles, the far silhouette, or nothing yet (P2-007 fills the slot). */
  source: 'tile_massing' | 'far_silhouette' | 'empty';
  trianglesMax: number;
}

export interface Placement {
  id: string;
  name: string;
  tier: Tier;
  mode: Mode;
  lat: number;
  lon: number;
  /** Block metres. */
  x: number;
  z: number;
  /** World metres (block metres plus the block offset). */
  wx: number;
  wz: number;
  /** The ground model there; the tile step replaces it with the solved ground or the pad level. */
  y: number;
  /** The bearing the front faces (0 north, 90 east); null when nothing says it. */
  yawDeg: number | null;
  yawSource: string;
  frontKnown: boolean;
  heightM: number | null;
  /** The stand-in shape of a structure: a gate or an arch has its passage, anything else is a block. */
  shape: 'block' | 'gate';
  /** The material of the stand-in massing: buff stone, or red sandstone for a fort and its precinct. */
  material: 'landmark' | 'landmark_red';
  /** The height the stand-in massing is built to: the registry height, else the class default of its footprint. */
  massingHeightM: number;
  massingHeightFrom: 'registry' | 'footprint' | 'default';
  underground: boolean;
  worship: boolean;
  area: { id: string; archetype: string } | null;
  style: ZoneStyle;
  /** The footprint in block metres, as the registry has it. */
  footprint: P2[] | null;
  /** What the massing stands on: the footprint off every road (a structure); empty for a site or a point. */
  body: P2[][];
  /**
   * The flat ground it stands on. `from`: its own footprint, the ring an edit names, or `shared`: it stands on the pad
   * another landmark laid (`sharedWith`: the gate of a fort that is a landmark of its own, a memorial inside another).
   */
  pad: { ring: P2[]; level: number; marginM: number; areaM2: number; cutFillM: number; clipped: boolean; from: 'footprint' | 'edit' | 'shared'; sharedWith?: string } | null;
  padWhy: string;
  zone: { ring: P2[]; clearM: number; areaM2: number; from: 'pad_and_clear_ring' | 'site' | 'radius' } | null;
  /** Wall lines of the stand-in massing (a fort's outline): block metres, with the height at each point. */
  walls: { pts: P2[]; heights: number[]; closed: boolean; source: string }[];
  surroundings: Surround[];
  /** Road faces under the footprint (m2): a map repair issue when not 0. */
  roadUnderFootprintM2: number;
  replaced: number;
  parts: number;
  /** Ids of the footprints that are its parts (a site), with the height the massing takes. */
  partIds: string[];
  lod: { slots: LodSlot[]; far: { fromM: number; toM: number; trianglesMax: number } | null; parts: number };
  flags: string[];
}

export interface FarPlacement {
  id: string;
  name: string;
  tier: Tier;
  lat: number;
  lon: number;
  /** World metres on the backdrop. */
  wx: number;
  wz: number;
  /** Real bearing and distance from the pivot (geodesic). */
  bearingDeg: number;
  distanceM: number;
  /** Bearing and distance of the backdrop point from the pivot in the world. */
  worldBearingDeg: number;
  worldDistanceM: number;
  blockPlanned: string;
  factor: number;
  /** How far it was moved outward along its bearing to leave the reachable tiles (m). */
  movedOutM: number;
  heightM: number | null;
  type: string;
  reachable: false;
  /** Never a map destination. */
  nav: false;
}

export interface Skipped {
  id: string;
  tier: Tier;
  why: string;
}

export interface PlaceResult {
  placements: Placement[];
  far: FarPlacement[];
  skipped: Skipped[];
  /** Footprints that leave the plain buildings, by id. */
  taken: Map<string, Replaced>;
  log: Replaced[];
  ground: GroundPiece[];
  limits: { heroesAtFullDetailInView: number; farSilhouetteTriangles: number };
  stats: {
    placed: number; byTier: Record<Tier, number>; byMode: Record<Mode, number>; pads: number; padM2: number; zones: number; zoneM2: number; replaced: number; parts: number;
    surroundings: Record<string, number>; roadCrossings: number; far: number; farMoved: number; skipped: number; maxCutFillM: number; clippedPads: number;
  };
}

// ------------------------------------------------------------------ rules

/** Kinds whose footprint is the grounds, not the structure. */
const SITE_KIND = /^(leisure=(park|garden|stadium|pitch)|historic=(castle|fort|cemetery|archaeological_site|ruins|citywalls)|amenity=grave_yard|landuse=)/;
/** A footprint over this size is a site whatever its tag says (a campus drawn as one ring). */
export const SITE_AREA_M2 = 25000;
/** Pad margin around the footprint by tier (m): the plinth a structure stands on. */
export const PAD_MARGIN_M: Readonly<Record<Tier, number>> = { hero: 4, signature: 3, marker: 1.5 };
/** The clear ring around the pad by tier (m): the landmark's own ground, never an ordinary building. */
export const CLEAR_RING_M: Readonly<Record<Tier, number>> = { hero: 12, signature: 6, marker: 3 };
/** A pad keeps this far from every road face (m): the ground between them blends from the road to the pad. */
export const PAD_ROAD_CLEAR_M = 2;
/** Width of the footing strip of a wall line in the ground (m) and of a fort's wall. */
export const WALL_STRIP_M = 1.2;
export const FORT_WALL_M = 3;
/** A footprint is replaced when this share of it lies on the pad. */
const REPLACE_SHARE = 0.3;
/** A far landmark keeps this far from every reachable tile (m). */
export const FAR_CLEAR_M = 500;
const FAR_STEP_M = 250;
/** LOD distances of a hero (m): full detail, two lower levels, then the far silhouette to its visibility distance. */
export const HERO_LOD_M = [0, 350, 900, 1800] as const;
export const HERO_FAR_TO_M = 6000;

export interface ZoneStyle {
  archetype: string;
  /** The ground material of the forecourt: `forecourt` (stone or paving) or `lawn`. */
  forecourt: 'forecourt' | 'lawn';
  /** What the paving is, for the kit that textures it later. */
  paving: string;
  /** The clear ring is this share of the tier's ring (0 in a dense bazaar: party walls on both sides). */
  clearShare: number;
}

/** The surroundings style of a landmark from the archetype of its area (harness/data/areas/archetypes/). */
export function zoneStyle(archetype: string): ZoneStyle {
  const a = archetype;
  if (a === 'ceremonial_avenue') return { archetype: a, forecourt: 'forecourt', paving: 'red sandstone paving between lawns', clearShare: 1 };
  if (a === 'heritage_fort_precinct') return { archetype: a, forecourt: 'forecourt', paving: 'red sandstone flags', clearShare: 1 };
  if (a === 'colonial_cbd') return { archetype: a, forecourt: 'forecourt', paving: 'pale stone paving', clearShare: 0.5 };
  if (a === 'old_city_dense' || a === 'old_city_lanes' || a === 'old_city_bazaar') return { archetype: a, forecourt: 'forecourt', paving: 'worn stone flags', clearShare: 0 };
  if (a === 'ridge_and_parks' || a === 'open_land' || a === 'water_and_wetland') return { archetype: a, forecourt: 'lawn', paving: 'grass', clearShare: 1 };
  if (a === 'low_density_compounds' || a === 'institutional_offices') return { archetype: a, forecourt: 'forecourt', paving: 'concrete paving', clearShare: 1 };
  return { archetype: a || 'none', forecourt: 'forecourt', paving: 'concrete paving', clearShare: 0.5 };
}

export function modeOf(e: Entry): Mode {
  if (!e.footprint?.ring || e.footprint.ring.length < 3 || e.underground) return 'point';
  if (e.zone_radius_m !== undefined) return 'site';
  if (SITE_KIND.test(e.kind) || e.footprint.area_m2 > SITE_AREA_M2) return 'site';
  return 'structure';
}

// ------------------------------------------------------------------ polygon sets

const PRECISION = 3;
const toPath = (ring: readonly P2[]): PathD => ring.map((p) => ({ x: p.x, y: p.z }));
const fromPath = (p: PathD): P2[] => p.map((q) => ({ x: Math.round(q.x * 1000) / 1000, z: Math.round(q.y * 1000) / 1000 }));
const inflate = (paths: PathsD, d: number): PathsD => inflatePathsD(paths, d, JoinType.Miter, EndType.Polygon, 2, PRECISION);
const inflateLine = (pts: readonly P2[], d: number): PathsD => inflatePathsD([toPath(pts)], d, JoinType.Miter, EndType.Butt, 2, PRECISION);
const unite = (a: PathsD): PathsD => unionD(a, [], FillRule.NonZero, PRECISION);
const minus = (a: PathsD, b: PathsD): PathsD => (b.length ? differenceD(a, b, FillRule.NonZero, PRECISION) : a);
const areaOf = (ring: readonly P2[]): number => Math.abs(ringArea(ring as P2[]));

/**
 * The footing of a wall line as strips without holes: the line in runs of three segments, each grown to the width.
 * (One strip round a closed wall would be a ring with a hole, and a polygon set that drops holes would fill the yard.)
 */
function wallStrips(pts: readonly P2[], closed: boolean, width: number): PathsD {
  const line = closed ? [...pts, pts[0] as P2] : pts;
  const out: PathsD = [];
  for (let k = 0; k + 1 < line.length; k += 3) out.push(...inflateLine(line.slice(k, Math.min(line.length, k + 4)), width / 2));
  return out;
}

/** The outer rings of a set, largest first, without holes and without scraps under `minArea`. */
function outers(paths: PathsD, minArea: number): P2[][] {
  const rings = paths.map(fromPath).filter((r) => r.length >= 3);
  // clipper winds outer rings one way and holes the other: the sign of the largest ring is the outer sign
  let big = 0;
  for (const r of rings) if (Math.abs(ringArea(r)) > Math.abs(big)) big = ringArea(r);
  return rings.filter((r) => Math.sign(ringArea(r)) === Math.sign(big) && Math.abs(ringArea(r)) >= minArea).sort((p, q) => Math.abs(ringArea(q)) - Math.abs(ringArea(p)));
}

/** A grid over boxed things: the ones whose box meets a box. */
class BoxIndex<T> {
  private readonly cells = new Map<number, number[]>();
  private readonly items: { box: Box2; item: T }[] = [];
  private readonly cell: number;
  constructor(cell: number) {
    this.cell = cell;
  }
  private key(i: number, j: number): number {
    return (i + 100000) * 262144 + (j + 100000);
  }
  add(box: Box2, item: T): void {
    const id = this.items.length;
    this.items.push({ box, item });
    for (let i = Math.floor(box.minX / this.cell); i <= Math.floor(box.maxX / this.cell); i++) {
      for (let j = Math.floor(box.minZ / this.cell); j <= Math.floor(box.maxZ / this.cell); j++) {
        const k = this.key(i, j);
        const list = this.cells.get(k);
        if (list) list.push(id);
        else this.cells.set(k, [id]);
      }
    }
  }
  near(box: Box2, pad = 0): T[] {
    const seen = new Set<number>();
    const out: T[] = [];
    for (let i = Math.floor((box.minX - pad) / this.cell); i <= Math.floor((box.maxX + pad) / this.cell); i++) {
      for (let j = Math.floor((box.minZ - pad) / this.cell); j <= Math.floor((box.maxZ + pad) / this.cell); j++) {
        for (const id of this.cells.get(this.key(i, j)) ?? []) {
          if (seen.has(id)) continue;
          seen.add(id);
          const it = this.items[id] as { box: Box2; item: T };
          if (boxesMeet(it.box, box, pad)) out.push(it.item);
        }
      }
    }
    return out;
  }
}

const circle = (c: P2, r: number, n = 96): P2[] => Array.from({ length: n }, (_, k) => ({ x: Math.round((c.x + r * Math.cos((2 * Math.PI * k) / n)) * 1000) / 1000, z: Math.round((c.z + r * Math.sin((2 * Math.PI * k) / n)) * 1000) / 1000 }));
const r1 = (v: number): number => Math.round(v * 10) / 10;
const r2 = (v: number): number => Math.round(v * 100) / 100;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const TIER_ORDER: Readonly<Record<Tier, number>> = { hero: 0, signature: 1, marker: 2 };
const MODE_ORDER: Readonly<Record<Mode, number>> = { structure: 0, site: 1, point: 2 };

/** Class default heights of a stand-in massing by landmark type, when neither the registry nor the footprint has one (m). */
function defaultHeight(e: Entry): number {
  const t = `${e.type} ${e.kind}`.toLowerCase();
  if (/minaret|tower/.test(t)) return 30;
  if (/gate|arch/.test(t)) return 14;
  if (/mosque|masjid|temple|mandir|church|gurdwara|gurudwara|worship|tomb|mausoleum/.test(t)) return 13;
  if (/museum|gallery|court|station|mall|stadium/.test(t)) return 14;
  if (/memorial|monument|statue/.test(t)) return 8;
  return 9;
}

/** The lod slots of a tier: a hero has its chain and a far silhouette, a signature two levels, a marker one. */
export function lodSlots(tier: Tier, b: LandmarkBudgets, hasMassing: boolean): Placement['lod'] {
  const src = hasMassing ? 'tile_massing' : 'empty';
  if (tier === 'hero') {
    const slots: LodSlot[] = [];
    for (let k = 0; k < b.heroLods; k++) slots.push({ level: k, fromM: HERO_LOD_M[k] as number, toM: HERO_LOD_M[k + 1] as number, source: k === 0 ? src : 'empty', trianglesMax: Math.round((b.heroTrianglesPerPart * b.heroPartsMax) / 4 ** k) });
    return { slots, far: { fromM: HERO_LOD_M[b.heroLods] as number, toM: HERO_FAR_TO_M, trianglesMax: b.farSilhouetteTriangles }, parts: b.heroPartsMax };
  }
  if (tier === 'signature') return { slots: [{ level: 0, fromM: 0, toM: 180, source: src, trianglesMax: 12000 }, { level: 1, fromM: 180, toM: 700, source: 'empty', trianglesMax: 1500 }], far: null, parts: 1 };
  return { slots: [{ level: 0, fromM: 0, toM: 700, source: src, trianglesMax: 1500 }], far: null, parts: 1 };
}

// ------------------------------------------------------------------ the placement

export function placeLandmarks(input: PlaceInput): PlaceResult {
  const { project, offset } = input;
  const skipped: Skipped[] = [];
  const far: FarPlacement[] = [];
  const todo: { e: Entry; mode: Mode; at: P2 }[] = [];
  for (const e of input.entries) {
    if (e.far) continue;
    if (e.place !== 'ok') {
      skipped.push({ id: e.id, tier: e.tier, why: e.place === 'held' ? `held: its sources disagree (${e.issue ?? 'R-LM-01'}); placed once an edit settles the position` : 'unplaced: no OSM object to place (a Wikidata item only)' });
      continue;
    }
    const at = project(e.lat, e.lon);
    if (!pointInRing(at, input.outline as P2[])) {
      skipped.push({ id: e.id, tier: e.tier, why: 'outside the stage outline' });
      continue;
    }
    todo.push({ e, mode: modeOf(e), at });
  }
  // structures first (they claim their own footprints), then sites (they take what is left inside them); heroes first
  todo.sort((p, q) => MODE_ORDER[p.mode] - MODE_ORDER[q.mode] || TIER_ORDER[p.e.tier] - TIER_ORDER[q.e.tier] || (p.e.id < q.e.id ? -1 : p.e.id > q.e.id ? 1 : 0));

  const roadIndex = new BoxIndex<readonly P2[]>(50);
  for (const r of input.roads) if (r.length >= 3) roadIndex.add(boxOf(r as P2[]), r);
  const waterIndex = new BoxIndex<{ a: PlaceArea; ring: readonly P2[] }>(100);
  for (const a of input.water) for (const ring of a.rings) if (ring.length >= 3) waterIndex.add(boxOf(ring as P2[]), { a, ring });
  const openIndex = new BoxIndex<{ a: PlaceArea; ring: readonly P2[] }>(100);
  for (const a of input.open) for (const ring of a.rings) if (ring.length >= 3) openIndex.add(boxOf(ring as P2[]), { a, ring });
  const fpIndex = new BoxIndex<{ f: PlaceFootprint; c: P2; area: number }>(50);
  for (const f of input.footprints) if (f.ring.length >= 3) fpIndex.add(boxOf(f.ring as P2[]), { f, c: ringCentroid(f.ring as P2[]), area: areaOf(f.ring) });
  const lineIndex = new BoxIndex<PlaceLine>(100);
  for (const l of input.barriers) if (l.pts.length >= 2) lineIndex.add(boxOf(l.pts as P2[]), l);
  const roadsNear = (box: Box2, pad: number): PathsD => roadIndex.near(box, pad).map(toPath);

  const taken = new Map<string, Replaced>();
  const log: Replaced[] = [];
  const ground: GroundPiece[] = [];
  const placements: Placement[] = [];
  const padsSoFar: PathsD = [];
  const take = (f: PlaceFootprint, c: P2, area: number, landmark: string, how: Replaced['how']): boolean => {
    if (taken.has(f.id)) return false;
    const rec: Replaced = { id: f.id, landmark, how, areaM2: r1(area), x: r1(c.x + offset.x), z: r1(c.z + offset.z) };
    taken.set(f.id, rec);
    log.push(rec);
    return true;
  };

  /** A flat pad from a ring: grown by the margin, off the roads, the water and the pads laid before; the piece under `at`, else the largest. */
  const padOf = (ring: readonly P2[], margin: number, at: P2): { ring: P2[]; clipped: boolean } | null => {
    const grown = inflate([toPath(ring)], margin);
    const box = boxOf(ring as P2[]);
    const roads = roadsNear(box, margin + PAD_ROAD_CLEAR_M + 1);
    const wet = waterIndex.near(box, margin + 1).map((w) => toPath(w.ring));
    let cut = grown;
    if (roads.length) cut = minus(cut, inflate(unite(roads), PAD_ROAD_CLEAR_M));
    if (wet.length) cut = minus(cut, inflate(unite(wet), 0.5));
    if (padsSoFar.length) cut = minus(cut, inflate(padsSoFar, 0.5));
    const pieces = outers(cut, 4);
    if (!pieces.length) return null;
    const pick = pieces.find((p) => pointInRing(at, p)) ?? (pieces[0] as P2[]);
    const whole = outers(grown, 1)[0];
    return { ring: pick, clipped: !whole || Math.abs(areaOf(pick) - areaOf(whole)) > 0.5 };
  };
  const levelOf = (ring: readonly P2[]): { level: number; cutFill: number } => {
    // the mean of the ground model along the ring and at its middle: the pad cuts as much as it fills
    const pts: P2[] = [ringCentroid(ring as P2[])];
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k] as P2;
      const b = ring[(k + 1) % ring.length] as P2;
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 5));
      for (let i = 0; i < n; i++) pts.push({ x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n });
    }
    let sum = 0;
    const hs = pts.map((p) => input.ground(p.x, p.z));
    for (const h of hs) sum += h;
    const level = r3(sum / hs.length);
    let off = 0;
    for (const h of hs) off = Math.max(off, Math.abs(h - level));
    return { level, cutFill: r2(off) };
  };
  /** Pads laid so far: a landmark that stands on one shares it, and a pad that holds earlier ones takes their level (one plinth, one level). */
  const laid: { landmark: string; pad: NonNullable<Placement['pad']>; piece: GroundPiece }[] = [];
  const layPad = (id: string, ring: readonly P2[], margin: number, at: P2, from: 'footprint' | 'edit'): { pad: Placement['pad']; why: string } => {
    const host = laid.find((l) => pointInRing(at, l.pad.ring));
    if (host) return { pad: { ...host.pad, from: 'shared', sharedWith: host.landmark }, why: `stands on the pad of ${host.landmark}: one plinth, one level` };
    const p = padOf(ring, margin, at);
    if (!p) return { pad: null, why: from === 'edit' ? 'the pad an edit names has no room off the roads' : 'no room for a pad off the roads and the water' };
    const lv = levelOf(p.ring);
    const inner = laid.filter((l) => pointInRing(l.pad.ring[0] as P2, p.ring));
    let level = lv.level;
    if (inner.length) {
      level = (inner[0] as { pad: { level: number } }).pad.level;
      for (const l of inner) {
        l.pad.level = level;
        l.piece.level = level;
      }
    }
    const pad: NonNullable<Placement['pad']> = { ring: p.ring, level, marginM: margin, areaM2: r1(areaOf(p.ring)), cutFillM: lv.cutFill, clipped: p.clipped, from };
    const piece: GroundPiece = { landmark: id, cls: 'pad', ring: p.ring, level, material: 'pad' };
    padsSoFar.push(toPath(p.ring));
    ground.push(piece);
    laid.push({ landmark: id, pad, piece });
    return { pad, why: `off every road by ${PAD_ROAD_CLEAR_M} m${p.clipped ? ' (cut back)' : ''}${inner.length ? `; one level with the pad of ${inner.map((l) => l.landmark).join(', ')} inside it` : ''}` };
  };

  for (const { e, mode, at } of todo) {
    const flags: string[] = [];
    let style = zoneStyle(e.area?.archetype ?? '');
    // a park or a garden is grass whatever the streets around it are
    if (/^leisure=(park|garden|pitch)/.test(e.kind)) style = { ...style, forecourt: 'lawn', paving: 'grass' };
    const fpRing: P2[] | null = e.footprint?.ring && e.footprint.ring.length >= 3 ? e.footprint.ring.map(([la, lo]) => project(la, lo)) : null;
    const surroundings: Surround[] = [];
    let pad: Placement['pad'] = null;
    let padWhy = '';
    let zone: Placement['zone'] = null;
    let body: P2[][] = [];
    const walls: Placement['walls'] = [];
    const partIds: string[] = [];
    let replaced = 0;
    let parts = 0;
    let roadUnder = 0;
    let massH = e.height_m ?? 0;
    let massFrom: Placement['massingHeightFrom'] = e.height_m !== null ? 'registry' : 'default';

    if (mode === 'point') {
      padWhy = e.underground ? `underground (${e.underground.why}): no shell, no pad, no ground cut` : 'no footprint: a pin only';
    } else if (fpRing) {
      const box = boxOf(fpRing);
      const roads = roadsNear(box, 2);
      if (roads.length) {
        const on = intersectD([toPath(fpRing)], unite(roads), FillRule.NonZero, PRECISION);
        roadUnder = r1(Math.abs(on.reduce((s, p) => s + ringArea(fromPath(p)), 0)));
        if (roadUnder > 1) flags.push('road_under_footprint');
      }
      if (mode === 'structure') {
        const tier = e.tier;
        const laidPad = layPad(e.id, fpRing, PAD_MARGIN_M[tier], at, 'footprint');
        // the massing stands on the footprint, off every road
        body = outers(roads.length ? minus([toPath(fpRing)], inflate(unite(roads), 0.2)) : [toPath(fpRing)], 2);
        pad = laidPad.pad;
        if (pad) {
          padWhy = pad.from === 'shared' ? laidPad.why : `the footprint ${e.footprint?.ref} plus ${PAD_MARGIN_M[tier]} m, ${laidPad.why}`;
          // only the part of the body on the pad is built: the massing never hangs over the pad's edge
          const onPad = intersectD(body.map(toPath), [toPath(pad.ring)], FillRule.NonZero, PRECISION);
          body = outers(onPad, 2);
        } else {
          padWhy = laidPad.why;
          flags.push('no_room_for_pad');
          body = [];
        }
        const clear = r1(CLEAR_RING_M[tier] * style.clearShare);
        const zr = outers(inflate([toPath(pad ? pad.ring : fpRing)], clear), 1)[0] ?? fpRing;
        zone = { ring: zr, clearM: clear, areaM2: r1(areaOf(zr)), from: 'pad_and_clear_ring' };
        // the buildings in the zone: replaced by the landmark's own massing
        const zbox = boxOf(zr);
        let own: PlaceFootprint | null = null;
        let ownShare = 0;
        for (const { f, c, area } of fpIndex.near(zbox)) {
          if (taken.has(f.id)) continue;
          const inZone = pointInRing(c, zr);
          let share = 0;
          if (pad && boxesMeet(boxOf(f.ring as P2[]), boxOf(pad.ring))) {
            const on = intersectD([toPath(f.ring)], [toPath(pad.ring)], FillRule.NonZero, PRECISION);
            share = on.reduce((s, q) => s + Math.abs(ringArea(fromPath(q))), 0) / Math.max(1e-6, area);
          }
          if (!inZone && share < REPLACE_SHARE) continue;
          if (take(f, c, area, e.id, 'replaced')) replaced++;
          if (share > ownShare || f.id === e.footprint?.ref) {
            ownShare = f.id === e.footprint?.ref ? 2 : share;
            own = f;
          }
        }
        if (e.height_m === null && own) {
          const h = own.height !== null && own.height >= 2.2 ? own.height : own.levels !== null && own.levels >= 1 ? own.levels * 3.2 : 0;
          if (h > 0) {
            massH = Math.min(200, h);
            massFrom = 'footprint';
          }
        }
        if (clear > 0 && style.forecourt) {
          ground.push({ landmark: e.id, cls: 'forecourt', ring: zr, material: style.forecourt });
          surroundings.push({ kind: 'forecourt', source: 'rule', ref: `clear ring of ${clear} m (${style.paving}; area ${style.archetype})`, size: r1(areaOf(zr) - (pad?.areaM2 ?? 0)) });
        }
      } else {
        // a site: the zone is the grounds (or the circle an edit gives); the buildings inside are its parts
        const zr = e.zone_radius_m !== undefined ? circle(at, e.zone_radius_m) : fpRing;
        zone = { ring: zr, clearM: 0, areaM2: r1(areaOf(zr)), from: e.zone_radius_m !== undefined ? 'radius' : 'site' };
        if (e.pad) {
          const pr = e.pad.ring.map(([la, lo]) => project(la, lo));
          const laidPad = layPad(e.id, pr, PAD_MARGIN_M[e.tier], ringCentroid(pr), 'edit');
          pad = laidPad.pad;
          padWhy = pad ? `${e.pad.evidence}: the ring of ${e.pad.ref}${pad.from === 'shared' ? '' : ` plus ${PAD_MARGIN_M[e.tier]} m`}, ${laidPad.why}` : laidPad.why;
          if (!pad) flags.push('no_room_for_pad');
        } else padWhy = 'a site: its footprint is the grounds; the parts stand on the ground as it is until an edit names a pad';
        const zbox = boxOf(zr);
        for (const { f, c, area } of fpIndex.near(zbox)) {
          if (taken.has(f.id) || !pointInRing(c, zr)) continue;
          if (take(f, c, area, e.id, 'part')) {
            parts++;
            partIds.push(f.id);
          }
        }
        // a fort's outline is its wall: a footing strip in the ground and the wall line of the stand-in
        if (/historic=(castle|fort)/.test(e.kind) && e.zone_radius_m === undefined) {
          const frontH = e.height_m ?? 12;
          const backH = Number(e.extent?.['wall_height_back_m'] ?? e.extent?.['wall_height_river_side_m'] ?? frontH);
          const front = e.orientation_deg !== null && e.orientation.front_known ? bearingVector(e.orientation_deg) : null;
          const c = ringCentroid(fpRing);
          const heightAt = (p: P2): number => {
            if (!front) return frontH;
            const len = Math.hypot(p.x - c.x, p.z - c.z) || 1;
            // the front height on the front half of the ring, the back height on the far side, blended across the flanks
            const t = Math.max(0, Math.min(1, (((p.x - c.x) * front.x + (p.z - c.z) * front.z) / len + 0.35) / 0.7));
            return r1(backH + (frontH - backH) * t);
          };
          // the walls the map draws inside the fort (barrier=wall, city_wall): when they make up a good part of the
          // outline they are the fort's wall (the Red Fort's outline in OSM is its grounds, out to the road); else
          // the outline itself is the wall
          const perimeter = polylineLength([...fpRing, fpRing[0] as P2]);
          const nearRing = outers(inflate([toPath(fpRing)], 8), 1)[0] ?? fpRing;
          const drawn = lineIndex.near(box, 8).filter((l) => /wall/.test(l.kind) && l.pts.every((q) => pointInRing(q, nearRing))).sort((p, q) => (p.id < q.id ? -1 : 1));
          const drawnM = drawn.reduce((sum, l) => sum + polylineLength(l.pts as P2[]), 0);
          if (drawnM >= 0.3 * perimeter) {
            for (const l of drawn) walls.push({ pts: l.pts.map((q) => ({ x: q.x, z: q.z })), heights: l.pts.map(heightAt), closed: false, source: `OSM ${l.id} (barrier=${l.kind}), ${frontH} m at the front, ${backH} m at the back` });
            flags.push('walls_from_osm_lines');
          } else {
            walls.push({ pts: fpRing, heights: fpRing.map(heightAt), closed: true, source: `the outline of ${e.footprint?.ref} (${e.kind}): a fort's outline is its wall` });
            const rds = roadsNear(box, 4);
            for (const part of wallStrips(fpRing, true, FORT_WALL_M)) {
              for (const ring of outers(rds.length ? minus([part], inflate(unite(rds), 0.5)) : [part], 2)) ground.push({ landmark: e.id, cls: 'wallbase', ring, material: 'wallbase' });
            }
            surroundings.push({ kind: 'wall', source: 'rule', ref: e.footprint?.ref ?? '', size: r1(perimeter), note: `a fort's outline is its wall: ${frontH} m at the front, ${backH} m at the back` });
          }
          // a moat band outside the wall, where an edit gives its width with evidence
          const mw = Number(e.extent?.['moat_width_m'] ?? 0);
          if (mw > 0) {
            const gap = Number(e.extent?.['moat_gap_m'] ?? 6);
            let band = minus(inflate([toPath(fpRing)], gap + mw), inflate([toPath(fpRing)], gap));
            // only on the front half (the river side of a river fort has no moat)
            if (front) {
              const far2 = Math.hypot(box.maxX - box.minX, box.maxZ - box.minZ) * 2;
              const side = { x: -front.z, z: front.x };
              const back: P2[] = [
                { x: c.x + side.x * far2, z: c.z + side.z * far2 }, { x: c.x - side.x * far2, z: c.z - side.z * far2 },
                { x: c.x - side.x * far2 - front.x * far2, z: c.z - side.z * far2 - front.z * far2 }, { x: c.x + side.x * far2 - front.x * far2, z: c.z + side.z * far2 - front.z * far2 },
              ];
              band = minus(band, [toPath(back)]);
            }
            const mbox = { minX: box.minX - gap - mw, maxX: box.maxX + gap + mw, minZ: box.minZ - gap - mw, maxZ: box.maxZ + gap + mw };
            const rds = roadsNear(mbox, 4);
            if (rds.length) band = minus(band, inflate(unite(rds), 1.5));
            const wet = waterIndex.near(mbox, 2).map((w) => toPath(w.ring));
            if (wet.length) band = minus(band, inflate(wet, 0.5));
            let size = 0;
            for (const ring of outers(band, 30)) {
              // no moat under a building that stays
              ground.push({ landmark: e.id, cls: 'moat', ring, depth: Number(e.extent?.['moat_depth_m'] ?? 3), material: 'moat' });
              size += areaOf(ring);
            }
            if (size > 0) surroundings.push({ kind: 'moat', source: 'rule', ref: e.footprint?.ref ?? '', size: r1(size), note: `a band ${mw} m wide, ${gap} m outside the wall, on the front half (edit: ${String(e.extent?.['moat_source'] ?? 'extent')})` });
          }
        }
        ground.push({ landmark: e.id, cls: 'forecourt', ring: zr, material: style.forecourt });
        surroundings.push({ kind: 'forecourt', source: 'rule', ref: `the grounds of the site (${style.paving}; area ${style.archetype})`, size: zone.areaM2 });
      }
      // what the map draws in the zone: lawns, water, walls and fences
      if (zone) {
        const zr = zone.ring;
        const zbox = boxOf(zr);
        const touches = (ring: readonly P2[]): boolean => ring.some((p) => pointInRing(p, zr)) || zr.some((p) => pointInRing(p, ring as P2[]));
        const seen = new Set<string>();
        for (const { a, ring } of openIndex.near(zbox)) {
          if (seen.has(a.id) || !touches(ring)) continue;
          seen.add(a.id);
          surroundings.push({ kind: 'lawn', source: 'osm', ref: a.id, size: r1(a.rings.reduce((s, q) => s + areaOf(q), 0)), ...(a.name ? { note: a.name } : {}) });
        }
        for (const { a, ring } of waterIndex.near(zbox)) {
          if (seen.has(a.id) || !touches(ring)) continue;
          seen.add(a.id);
          surroundings.push({ kind: 'water', source: 'osm', ref: a.id, size: r1(a.rings.reduce((s, q) => s + areaOf(q), 0)), ...(a.name ? { note: a.name } : {}) });
        }
        const reach = e.tier === 'hero' ? 30 : e.tier === 'signature' ? 12 : 4;
        const near = outers(inflate([toPath(zr)], reach), 1)[0] ?? zr;
        for (const l of lineIndex.near(zbox, reach)) {
          if (seen.has(l.id) || !l.pts.some((p) => pointInRing(p, near))) continue;
          seen.add(l.id);
          const isWall = /wall/.test(l.kind);
          surroundings.push({ kind: isWall ? 'wall' : 'fence', source: 'osm', ref: l.id, size: r1(polylineLength(l.pts as P2[])), note: l.name ? `${l.kind}, ${l.name}` : l.kind });
          // the footing of a wall as a ground strip, for heroes and signatures (a fence has none)
          if (isWall && e.tier !== 'marker') {
            const lb = boxOf(l.pts as P2[]);
            const rds = roadsNear(lb, 3);
            for (const part of wallStrips(l.pts, false, WALL_STRIP_M)) {
              for (const ring of outers(rds.length ? minus([part], inflate(unite(rds), 0.5)) : [part], 1.5)) ground.push({ landmark: e.id, cls: 'wallbase', ring, material: 'wallbase' });
            }
          }
        }
        surroundings.sort((p, q) => (p.kind < q.kind ? -1 : p.kind > q.kind ? 1 : p.ref < q.ref ? -1 : p.ref > q.ref ? 1 : 0));
      }
    }
    if (massFrom === 'default') massH = defaultHeight(e);
    if (!e.orientation.front_known && e.orientation_deg !== null) flags.push('front_side_not_known');
    if (e.worship) flags.push('worship_never_a_combat_arena');
    const hasMassing = body.length > 0 || parts > 0 || walls.length > 0;
    placements.push({
      id: e.id, name: e.name.en, tier: e.tier, mode, lat: e.lat, lon: e.lon, x: r3(at.x), z: r3(at.z), wx: r3(at.x + offset.x), wz: r3(at.z + offset.z), y: r3(pad ? pad.level : input.ground(at.x, at.z)),
      yawDeg: e.orientation_deg, yawSource: e.orientation.source, frontKnown: e.orientation.front_known, heightM: e.height_m, massingHeightM: r1(massH), massingHeightFrom: massFrom,
      shape: /\b(arch|gate|darwaza)\b/i.test(`${e.type} ${e.kind.replace(/[=_]/g, ' ')} ${e.name.en}`) ? 'gate' : 'block',
      material: /historic=(castle|fort)/.test(e.kind) || e.area?.archetype === 'heritage_fort_precinct' ? 'landmark_red' : 'landmark',
      underground: !!e.underground, worship: !!e.worship, area: e.area ? { id: e.area.id, archetype: e.area.archetype } : null, style,
      footprint: fpRing ? fpRing.map((p) => ({ x: r3(p.x), z: r3(p.z) })) : null, body, pad, padWhy, zone, walls, surroundings, roadUnderFootprintM2: roadUnder, replaced, parts, partIds,
      lod: lodSlots(e.tier, input.budgets, hasMassing), flags: flags.sort(),
    });
  }

  // far landmarks: on the backdrop through the frame of their block, moved outward off the reachable tiles
  for (const e of input.entries) {
    if (!e.far) continue;
    const w = input.farWorld(e);
    let { x, z } = w;
    const dx = x - input.pivot.x;
    const dz = z - input.pivot.z;
    const len = Math.hypot(dx, dz) || 1;
    let moved = 0;
    while (input.reachable(x, z) && moved < 60000) {
      moved += FAR_STEP_M;
      x = w.x + (dx / len) * moved;
      z = w.z + (dz / len) * moved;
    }
    far.push({
      id: e.id, name: e.name.en, tier: e.tier, lat: e.lat, lon: e.lon, wx: r1(x), wz: r1(z), bearingDeg: e.bearing_deg ?? 0, distanceM: e.distance_m ?? 0,
      worldBearingDeg: r2(((Math.atan2(x - input.pivot.x, -(z - input.pivot.z)) * 180) / Math.PI + 360) % 360), worldDistanceM: Math.round(Math.hypot(x - input.pivot.x, z - input.pivot.z)),
      blockPlanned: w.block, factor: w.factor, movedOutM: moved, heightM: e.height_m, type: e.type, reachable: false, nav: false,
    });
  }
  // a pad that took the level of the pads inside it, and the landmarks that share a pad: one level each
  const levels = new Map(laid.map((l) => [l.landmark, l.pad.level]));
  for (const p of placements) {
    if (!p.pad) continue;
    if (p.pad.sharedWith !== undefined) p.pad.level = levels.get(p.pad.sharedWith) ?? p.pad.level;
    p.y = p.pad.level;
  }
  far.sort((p, q) => (p.id < q.id ? -1 : 1));
  placements.sort((p, q) => TIER_ORDER[p.tier] - TIER_ORDER[q.tier] || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  // ground pieces in the order the terrain reads them: pads, moats, wall strips, then forecourts (the first that holds a triangle wins)
  const CLS_ORDER = { pad: 0, moat: 1, wallbase: 2, forecourt: 3 } as const;
  const rank = new Map(placements.map((p, i) => [p.id, i]));
  // (a small pad before a large one: a pad that holds smaller ones leaves them their own triangles)
  const order = ground
    .map((g, i) => ({ g, i, area: g.cls === 'pad' ? areaOf(g.ring) : 0 }))
    .sort((p, q) => CLS_ORDER[p.g.cls] - CLS_ORDER[q.g.cls] || p.area - q.area || (rank.get(p.g.landmark) ?? 0) - (rank.get(q.g.landmark) ?? 0) || p.i - q.i)
    .map((o) => o.g);

  const byTier: Record<Tier, number> = { hero: 0, signature: 0, marker: 0 };
  const byMode: Record<Mode, number> = { structure: 0, site: 0, point: 0 };
  const sur: Record<string, number> = {};
  let padM2 = 0;
  let zoneM2 = 0;
  let maxCut = 0;
  for (const p of placements) {
    byTier[p.tier]++;
    byMode[p.mode]++;
    for (const s of p.surroundings) sur[s.kind] = (sur[s.kind] ?? 0) + 1;
    padM2 += p.pad?.areaM2 ?? 0;
    zoneM2 += p.zone?.areaM2 ?? 0;
    maxCut = Math.max(maxCut, p.pad?.cutFillM ?? 0);
  }
  return {
    placements, far, skipped, taken, log, ground: order, limits: { heroesAtFullDetailInView: input.budgets.heroesAtFullDetailInView, farSilhouetteTriangles: input.budgets.farSilhouetteTriangles },
    stats: {
      placed: placements.length, byTier, byMode, pads: placements.filter((p) => p.pad && p.pad.from !== 'shared').length, padM2: Math.round(padM2), zones: placements.filter((p) => p.zone).length, zoneM2: Math.round(zoneM2),
      replaced: log.filter((l) => l.how === 'replaced').length, parts: log.filter((l) => l.how === 'part').length, surroundings: sur, roadCrossings: placements.filter((p) => p.roadUnderFootprintM2 > 1).length,
      far: far.length, farMoved: far.filter((f) => f.movedOutM > 0).length, skipped: skipped.length, maxCutFillM: maxCut, clippedPads: placements.filter((p) => p.pad?.clipped).length,
    },
  };
}
