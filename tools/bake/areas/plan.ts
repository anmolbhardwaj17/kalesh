// The building of one parcel (P2-009, DELHI_WORLD.md "The generator"): which profile it follows (a seeded pick with
// the blend weights at its centre), its floor count (the OSM height or levels tag where the map has one, else a draw
// from the profile's floor distribution), its type (from the profile's mix, weighted by how well a type fits the floor
// count and the footprint), its roof, wall colour and wear. Every pick is seeded from the world tile of the parcel
// and its id (rand.ts), so a rebake gives the same city.
//
// Two rules look at the other parcels of the same tile, and never past it (a change in one tile stays there):
// - Floors: the parcels of one tile that follow one profile share the profile's floor distribution between them. They
//   are ranked by footprint size (with a seeded spread, so it is a leaning, not a law) and the draws are spread evenly
//   over the ranks: bigger footprints lean taller, and the area's floor histogram follows its profile even where it
//   has few buildings. A draw that a footprint cannot carry (floorCap) changes places with a lower one in the tile;
//   only where the tile has no footprint big enough is the draw held down (`capped`).
// - Variety: no two parcels that stand side by side end up the same (type, floors, colour and roof).
// Pure.
import type { P2 } from '../geom.ts';
import { rngFor, seedFor } from '../rand.ts';
import type { Rand } from '../rand.ts';
import type { Weight } from './blend.ts';
import { BUILDING_TYPES } from './schema.ts';
import { floorsFor } from './views.ts';
import type { ProfileView } from './views.ts';

export type RoofKind = 'flat' | 'mumty' | 'setback' | 'crown' | 'gable';
export type BuildingType = (typeof BUILDING_TYPES)[number];

/** Metres per floor where the map gives a height or a level count (the repair's levels rule). */
export const FLOOR_M = 3.2;
/** The parapet round a flat roof: the walls stand this far over the roof slab (m). */
export const PARAPET_M = 0.9;

export interface TypeSpec {
  /** Height of an upper floor and of the ground floor (m). */
  floorM: number;
  groundM: number;
  /** Footprint area the type fits (m2) and its floor counts. */
  minArea: number;
  maxArea: number;
  minFloors: number;
  maxFloors: number;
  /** Width of a facade bay (m). */
  bayM: number;
  roofs: [RoofKind, number][];
  /** Ground floor bays on a street front and the upper bays, with their shares. */
  gf: [string, number][];
  up: [string, number][];
}

const T = (floorM: number, groundM: number, minArea: number, maxArea: number, minFloors: number, maxFloors: number, bayM: number, roofs: [RoofKind, number][], gf: [string, number][], up: [string, number][]): TypeSpec => ({ floorM, groundM, minArea, maxArea, minFloors, maxFloors, bayM, roofs, gf, up });
const BIG = 1e9;

/**
 * What each building type is as a shell: sizes are look decisions for the stand-in kit (the area sheets give the floor
 * counts and the facade habits; the kit of P2-010 gives each part its mesh). Part names are the module vocabulary:
 * a placement's module id is "<type>.<part>".
 */
export const TYPES: Readonly<Record<BuildingType, TypeSpec>> = {
  colonnade_block: T(5.0, 5.4, 150, BIG, 2, 3, 3.6, [['flat', 1]], [['gf_colonnade', 1]], [['up_window', 0.85], ['up_blank', 0.15]]),
  arcade_row: T(4.2, 4.6, 60, BIG, 1, 3, 3.2, [['flat', 1]], [['gf_arcade', 1]], [['up_window', 0.8], ['up_blank', 0.2]]),
  shop_house: T(3.1, 3.4, 10, 320, 1, 6, 2.8, [['flat', 0.5], ['mumty', 0.35], ['setback', 0.15]], [['gf_shop', 0.8], ['gf_door', 0.2]], [['up_window', 0.5], ['up_balcony', 0.35], ['up_blank', 0.15]]),
  haveli: T(3.3, 3.6, 45, 1500, 2, 5, 2.6, [['flat', 0.5], ['mumty', 0.3], ['setback', 0.2]], [['gf_shop', 0.4], ['gf_door', 0.3], ['gf_plain', 0.3]], [['up_jharokha', 0.35], ['up_balcony', 0.3], ['up_window', 0.25], ['up_blank', 0.1]]),
  hotel_stack: T(3.0, 3.4, 30, 700, 3, 8, 2.8, [['flat', 0.5], ['mumty', 0.3], ['crown', 0.2]], [['gf_shop', 0.6], ['gf_door', 0.4]], [['up_window', 0.5], ['up_balcony', 0.4], ['up_blank', 0.1]]),
  trade_row: T(3.1, 3.4, 12, 450, 1, 5, 3.0, [['flat', 0.6], ['mumty', 0.4]], [['gf_shop', 0.9], ['gf_door', 0.1]], [['up_window', 0.5], ['up_balcony', 0.2], ['up_blank', 0.3]]),
  bazaar_block: T(3.2, 3.6, 35, 4000, 2, 6, 3.0, [['flat', 0.6], ['mumty', 0.25], ['setback', 0.15]], [['gf_shop', 0.85], ['gf_door', 0.15]], [['up_window', 0.45], ['up_balcony', 0.3], ['up_blank', 0.25]]),
  commercial_block: T(3.4, 4.0, 60, BIG, 2, 10, 3.4, [['flat', 0.6], ['crown', 0.4]], [['gf_shop', 0.6], ['gf_door', 0.2], ['gf_plain', 0.2]], [['up_strip', 0.5], ['up_window', 0.4], ['up_blank', 0.1]]),
  office_slab: T(3.5, 4.2, 110, BIG, 3, 20, 3.6, [['crown', 0.6], ['flat', 0.4]], [['gf_plain', 0.8], ['gf_door', 0.2]], [['up_strip', 0.8], ['up_blank', 0.2]]),
  office_tower: T(3.6, 4.5, 300, BIG, 8, 60, 3.6, [['crown', 0.8], ['flat', 0.2]], [['gf_plain', 0.7], ['gf_door', 0.3]], [['up_glass', 0.7], ['up_strip', 0.3]]),
  govt_slab: T(3.5, 4.0, 140, BIG, 2, 20, 3.6, [['crown', 0.5], ['flat', 0.5]], [['gf_plain', 0.8], ['gf_door', 0.2]], [['up_strip', 0.5], ['up_window', 0.4], ['up_blank', 0.1]]),
  low_row_market: T(3.2, 3.4, 8, 700, 1, 2, 2.6, [['flat', 1]], [['gf_shop', 0.95], ['gf_door', 0.05]], [['up_window', 0.4], ['up_blank', 0.6]]),
  bungalow: T(3.8, 4.2, 60, 2000, 1, 2, 3.4, [['flat', 0.7], ['mumty', 0.3]], [['gf_plain', 0.6], ['gf_door', 0.2], ['gf_colonnade', 0.2]], [['up_window', 0.7], ['up_blank', 0.3]]),
  flats_block: T(3.0, 3.0, 60, BIG, 3, 14, 3.2, [['mumty', 0.5], ['flat', 0.3], ['crown', 0.2]], [['gf_plain', 0.6], ['gf_door', 0.2], ['gf_gate', 0.2]], [['up_window', 0.45], ['up_balcony', 0.45], ['up_blank', 0.1]]),
  civic_hall: T(4.5, 5.0, 250, BIG, 1, 3, 4.0, [['flat', 1]], [['gf_plain', 0.5], ['gf_door', 0.3], ['gf_colonnade', 0.2]], [['up_window', 0.6], ['up_blank', 0.4]]),
  admin_block: T(3.5, 4.0, 60, BIG, 1, 6, 3.4, [['flat', 0.7], ['mumty', 0.3]], [['gf_plain', 0.75], ['gf_door', 0.25]], [['up_window', 0.7], ['up_strip', 0.2], ['up_blank', 0.1]]),
  station_building: T(4.5, 5.5, 200, BIG, 1, 3, 4.0, [['flat', 1]], [['gf_arcade', 0.5], ['gf_door', 0.3], ['gf_plain', 0.2]], [['up_window', 0.5], ['up_blank', 0.5]]),
  shed: T(4.5, 4.5, 4, BIG, 1, 2, 4.0, [['gable', 0.6], ['flat', 0.4]], [['gf_plain', 0.7], ['gf_gate', 0.3]], [['up_blank', 1]]),
  house: T(3.1, 3.1, 12, 450, 1, 5, 3.0, [['mumty', 0.5], ['flat', 0.35], ['setback', 0.15]], [['gf_gate', 0.3], ['gf_door', 0.3], ['gf_plain', 0.4]], [['up_window', 0.45], ['up_balcony', 0.45], ['up_blank', 0.1]]),
  other: T(3.2, 3.2, 0, BIG, 1, 8, 3.0, [['flat', 0.7], ['mumty', 0.3]], [['gf_plain', 0.7], ['gf_door', 0.3]], [['up_window', 0.6], ['up_blank', 0.4]]),
};

/** OSM building classes that name a generated type (the data says so: the mix is not asked). */
const CLASS_TYPE: Readonly<Record<string, BuildingType>> = {
  train_station: 'station_building', transportation: 'station_building', industrial: 'shed', warehouse: 'shed', hotel: 'hotel_stack', office: 'office_slab',
  retail: 'commercial_block', commercial: 'commercial_block', apartments: 'flats_block', house: 'house', detached: 'house', semidetached_house: 'house', terrace: 'house',
  government: 'govt_slab', public: 'admin_block', civic: 'civic_hall', school: 'admin_block', college: 'admin_block', university: 'admin_block', hospital: 'govt_slab',
};
/** Small outbuildings: one floor of their class height, whatever the profile says. */
const ANCILLARY_M: Readonly<Record<string, number>> = { garage: 3.5, garages: 3.5, shed: 3.5, roof: 4, hut: 3.5, kiosk: 3.2, toilets: 3.2, service: 4, construction: 6, ruins: 4, carport: 3, guardhouse: 3.2 };
const WORSHIP = new Set(['temple', 'mosque', 'church', 'gurudwara', 'religious', 'shrine', 'cathedral', 'chapel', 'synagogue', 'monastery', 'mausoleum']);

export interface PlanFootprint {
  id: string;
  source: string;
  ring: readonly P2[];
  area: number;
  centre: P2;
  height: number | null;
  levels: number | null;
  tags: Readonly<Record<string, string>>;
  /** The world tile of its centre. */
  tx: number;
  tz: number;
}

export interface BuildingPlan {
  id: string;
  /** The profile it follows. */
  profile: string;
  type: BuildingType;
  floors: number;
  /** Wall height over the highest ground at the footprint, parapet included (m). */
  height: number;
  /** Height of the ground floor and of each upper floor (m). */
  groundM: number;
  floorM: number;
  /** The parapet's share of the height (0 for a pitched roof or a tagged height). */
  parapetM: number;
  roof: RoofKind;
  /** Index into the profile's colours, the swatch after the parcel's own shade, and wear 0 to 1. */
  colour: number;
  tint: number;
  wear: number;
  /**
   * Where the height comes from: an OSM height or levels tag, a class of outbuilding, a blueprint, the profile's floor
   * draw, or `small`: a footprint too small for every type of the profile but its low ones (a shed, a market row),
   * built as that type with its one or two floors.
   */
  from: 'height' | 'levels' | 'class' | 'blueprint' | 'profile' | 'small';
  /** The floor draw was held down by the footprint (too small to carry it), and the most floors it can carry. */
  capped: boolean;
  cap: number;
  /** A place of worship from the map: a plain shell, no facade modules (the registry builds those with care). */
  worship: boolean;
  /** The variety rule changed it (colour, roof or floors) to differ from a neighbour. */
  varied: boolean;
}

/** The most floors a footprint can carry: a 4 m square takes four, a 6 m square seven, a 10 m square twelve (the narrow houses and lodges of the old city stand five floors on 25 m2). */
export function floorCap(area: number): number {
  return Math.max(2, Math.floor(1.2 * Math.sqrt(Math.max(0, area))));
}

function pickWeighted<V>(r: Rand, list: readonly (readonly [V, number])[]): V {
  let total = 0;
  for (const [, w] of list) total += w;
  let u = r.next() * total;
  for (const [v, w] of list) {
    u -= w;
    if (u < 0) return v;
  }
  return (list[list.length - 1] as readonly [V, number])[0];
}

/** A swatch a little lighter or darker (factor 0.92 to 1.06). */
export function shade(rgb: number, f: number): number {
  const c = (v: number): number => Math.max(0, Math.min(255, Math.round(v * f)));
  return (c((rgb >> 16) & 255) << 16) | (c((rgb >> 8) & 255) << 8) | c(rgb & 255);
}

const isType = (s: string | undefined): s is BuildingType => s !== undefined && (BUILDING_TYPES as readonly string[]).includes(s);

/** What is settled about a parcel before the floors of its tile are shared out. */
export interface Draft {
  f: PlanFootprint;
  view: ProfileView;
  wear: number;
  from: BuildingPlan['from'];
  /** Floors and height from a tag, a class or a blueprint; null when the profile draws them. */
  floors: number | null;
  tagHeight: number | null;
  worship: boolean;
  /** `small`: the low type it is built as. */
  type: BuildingType | null;
  /** The draw of the floor distribution (0 to 1), set by `shareFloors`. */
  u: number;
  capped: boolean;
}

/** The profile, the wear and what the map already says about the height: from the parcel's own seed alone. */
export function draftParcel(f: PlanFootprint, weights: readonly Weight[], views: ReadonlyMap<string, ProfileView>, fallback: ProfileView): Draft {
  const r = rngFor(f.tx, f.tz, f.id, 'profile');
  // the profile: a seeded pick with the blend weights; one that generates nothing hands over to the others
  const live = weights.filter((w) => (views.get(w.key)?.mix.length ?? 0) > 0);
  const uProfile = r.next();
  let view = fallback;
  const asked = f.tags['gen:profile'] !== undefined ? views.get(f.tags['gen:profile'] as string) : undefined;
  if (asked && asked.mix.length) view = asked; // a lot cut for a profile follows it
  else if (live.length) {
    let total = 0;
    for (const w of live) total += w.w;
    let u = uProfile * total;
    view = views.get((live[live.length - 1] as Weight).key) as ProfileView;
    for (const w of live) {
      u -= w.w;
      if (u < 0) {
        view = views.get(w.key) as ProfileView;
        break;
      }
    }
  }
  // wear: the blended value of every profile at the point, with the parcel's own spread
  let wear = 0;
  let wsum = 0;
  for (const w of weights) {
    const v = views.get(w.key);
    if (!v) continue;
    wear += v.wear * w.w;
    wsum += w.w;
  }
  wear = Math.max(0, Math.min(1, (wsum > 0 ? wear / wsum : view.wear) + (r.next() - 0.5) * 0.16));
  const cls = f.tags['building'] ?? '';
  const worship = WORSHIP.has(cls) || f.tags['amenity'] === 'place_of_worship';
  const bpFloors = f.tags['gen:floors'] !== undefined ? Number(f.tags['gen:floors']) : NaN;
  let from: BuildingPlan['from'] = 'profile';
  let floors: number | null = null;
  let tagHeight: number | null = null;
  if (f.source === 'blueprint' && Number.isFinite(bpFloors)) {
    floors = Math.max(1, Math.round(bpFloors));
    from = 'blueprint';
    if (f.height !== null) tagHeight = f.height;
  } else if (f.height !== null && f.height >= 2.2) {
    tagHeight = Math.min(200, f.height);
    floors = Math.max(1, Math.round(tagHeight / FLOOR_M));
    from = 'height';
  } else if (f.levels !== null && f.levels >= 1) {
    floors = Math.min(60, Math.round(f.levels));
    tagHeight = floors * FLOOR_M;
    from = 'levels';
  } else if (ANCILLARY_M[cls] !== undefined) {
    floors = 1;
    tagHeight = ANCILLARY_M[cls] as number;
    from = 'class';
  }
  // too small for every type of the profile that fits its floors: an outbuilding of the profile's low type
  let type: BuildingType | null = null;
  const uSmall = r.next();
  const uFloor = r.next();
  if (from === 'profile' && !worship && f.source !== 'blueprint' && CLASS_TYPE[cls] === undefined && view.floors.p50 > 2) {
    const fits = view.mix.filter(([t]) => isType(t) && f.area >= TYPES[t as BuildingType].minArea && f.area <= TYPES[t as BuildingType].maxArea);
    if (fits.length && fits.every(([t]) => TYPES[t as BuildingType].maxFloors <= 2)) {
      let total = 0;
      for (const [, w] of fits) total += w;
      let u = uSmall * total;
      type = (fits[fits.length - 1] as [string, number])[0] as BuildingType;
      for (const [t, w] of fits) {
        u -= w;
        if (u < 0) {
          type = t as BuildingType;
          break;
        }
      }
      from = 'small';
      floors = uFloor < 0.3 && f.area >= 20 ? 2 : 1;
    }
  }
  return { f, view, wear, from, floors, tagHeight, worship, type, u: r.next(), capped: false };
}

/** How strongly the floor draw leans on the footprint size: the spread of the seeded noise added to ln(area). */
export const SIZE_SPREAD = 0.9;

/**
 * Shares the floor draws of one tile: per profile, the parcels that draw their floors are ranked by ln(area) plus a
 * seeded spread, and parcel number i of n takes the draw (i + its own jitter) / n. One parcel alone keeps a plain draw.
 */
export function shareFloors(tile: { tx: number; tz: number }, drafts: readonly Draft[]): void {
  const pools = new Map<string, Draft[]>();
  for (const d of drafts) {
    if (d.floors !== null) continue;
    let p = pools.get(d.view.key);
    if (!p) pools.set(d.view.key, (p = []));
    p.push(d);
  }
  for (const pool of pools.values()) {
    const scored = pool.map((d) => {
      const r = rngFor(tile.tx, tile.tz, d.f.id, 'floors');
      // two uniform draws make a bell-shaped spread without a table
      const noise = (r.next() + r.next() + r.next() - 1.5) * 2 * SIZE_SPREAD;
      return { d, score: Math.log(Math.max(1, d.f.area)) + noise, jitter: r.next() };
    }).sort((a, b) => a.score - b.score || (a.d.f.id < b.d.f.id ? -1 : 1));
    scored.forEach((s, i) => {
      s.d.u = (i + s.jitter) / scored.length;
    });
    // a draw a footprint cannot carry changes places with a lower draw on a footprint that can, where the tile has
    // one: the pool keeps its histogram, only who gets which draw changes
    const view = (scored[0] as { d: Draft }).d.view;
    const fl = (d: Draft): number => floorsFor(view.floors, d.u);
    const over = scored.filter((s) => fl(s.d) > floorCap(s.d.f.area)).sort((a, b) => b.d.u - a.d.u);
    if (over.length) {
      const free = scored.filter((s) => fl(s.d) <= floorCap(s.d.f.area)).sort((a, b) => b.d.f.area - a.d.f.area || (a.d.f.id < b.d.f.id ? -1 : 1));
      const used = new Set<Draft>();
      for (const o of over) {
        const need = fl(o.d);
        const cap = floorCap(o.d.f.area);
        const partner = free.find((c) => !used.has(c.d) && floorCap(c.d.f.area) >= need && fl(c.d) <= cap);
        if (!partner) continue;
        used.add(partner.d);
        const u = o.d.u;
        o.d.u = partner.d.u;
        partner.d.u = u;
      }
    }
  }
}

/** The plan of a parcel once its floor draw is set. */
export function finishParcel(d: Draft): BuildingPlan {
  const { f, view, worship } = d;
  const r = rngFor(f.tx, f.tz, f.id, 'building');
  const cls = f.tags['building'] ?? '';
  const bpType = f.tags['gen:type'];
  let floors: number;
  let capped = false;
  const cap = floorCap(f.area);
  if (d.floors !== null) floors = d.floors;
  else {
    floors = floorsFor(view.floors, d.u);
    if (floors > cap) {
      // the draw again, inside what the footprint can carry
      floors = Math.min(cap, floorsFor(view.floors, d.u * shareUnder(view, cap)));
      capped = true;
    }
  }
  const { from, tagHeight } = d;
  // the type: a blueprint's, the map's class, else the mix weighted by how well each type fits
  let type: BuildingType;
  const uType = r.next();
  if (isType(bpType)) type = bpType;
  else if (d.type) type = d.type;
  else if (worship) type = 'other';
  else if (from === 'class') type = 'shed';
  else if (CLASS_TYPE[cls] !== undefined) type = CLASS_TYPE[cls] as BuildingType;
  else {
    const list: [BuildingType, number][] = view.mix.filter(([t]) => isType(t)).map(([t, w]) => [t as BuildingType, w * typeFit(TYPES[t as BuildingType], floors, f.area)] as [BuildingType, number]).filter(([, w]) => w > 0);
    if (!list.length) type = 'other';
    else {
      let total = 0;
      for (const [, w] of list) total += w;
      let u = uType * total;
      type = (list[list.length - 1] as [BuildingType, number])[0];
      for (const [t, w] of list) {
        u -= w;
        if (u < 0) {
          type = t;
          break;
        }
      }
    }
  }
  const spec = TYPES[type];
  const roofTag = f.tags['gen:roof'];
  let roof: RoofKind = roofTag === 'flat' || roofTag === 'mumty' || roofTag === 'setback' || roofTag === 'crown' || roofTag === 'gable' ? roofTag : pickWeighted(r, spec.roofs);
  if (worship) roof = 'flat';
  if (roof === 'setback' && floors < 3) roof = 'flat';
  if (roof === 'crown' && floors < 5) roof = 'flat';
  if (roof === 'gable' && floors > 2) roof = 'flat';
  const colourTag = f.tags['gen:tint'];
  const tagged = colourTag !== undefined ? view.colours.findIndex((c) => c.word === colourTag) : -1;
  const colour = tagged >= 0 ? tagged : r.int(0, view.colours.length - 1);
  const shadeF = 0.92 + r.next() * 0.14;
  const parapetM = roof === 'gable' || tagHeight !== null ? 0 : PARAPET_M;
  const groundM = tagHeight !== null ? tagHeight / floors : spec.groundM;
  const floorM = tagHeight !== null ? tagHeight / floors : spec.floorM;
  const height = tagHeight !== null ? tagHeight : spec.groundM + (floors - 1) * spec.floorM + parapetM;
  return { id: f.id, profile: view.key, type, floors, height, groundM, floorM, parapetM, roof, colour, tint: shade((view.colours[colour] as { rgb: number }).rgb, shadeF), wear: d.wear, from, capped, cap, worship, varied: false };
}

/**
 * How well a type fits a floor count and a footprint (0 to 1): 1 inside the type's ranges; outside the area range it
 * falls off with the ratio, so a profile's mix still shows where the footprints are small; outside the floor range a
 * type is nearly ruled out (a market row is never eight floors).
 */
export function typeFit(s: TypeSpec, floors: number, area: number): number {
  let fit = 1;
  if (area < s.minArea) fit *= Math.max(0.02, Math.pow(area / s.minArea, 1.5));
  else if (area > s.maxArea) fit *= Math.max(0.02, Math.pow(s.maxArea / area, 1.5));
  if (floors < s.minFloors) fit *= Math.pow(0.15, s.minFloors - floors);
  else if (floors > s.maxFloors) fit *= Math.pow(0.15, floors - s.maxFloors);
  return fit;
}

/** The share of a profile's floor draws at or under a floor count. */
export function shareUnder(view: ProfileView, floors: number): number {
  let s = 0;
  for (let k = 0; k < view.pmf.length && k <= floors; k++) s += view.pmf[k] as number;
  return Math.max(1e-6, Math.min(1, s));
}

/** What makes two buildings the same to the eye. */
export const signature = (p: BuildingPlan): string => `${p.type}|${p.floors}|${p.profile}#${p.colour}|${p.roof}`;

/**
 * The variety rule inside one tile. Parcels are taken in a seeded order; each keeps its first plan unless a parcel
 * beside it that came earlier has the same signature, then it takes the first of its own alternates that differs
 * from every earlier neighbour: another colour of the palette, another roof, or one floor more or less (a tagged
 * height or a blueprint keeps its floors). A pick never reads another tile, so a change in one tile stays there.
 * Returns how many parcels changed and how many found no alternate.
 */
export function applyVariety(tile: { tx: number; tz: number }, plans: BuildingPlan[], neighbours: ReadonlyMap<string, readonly string[]>, views: ReadonlyMap<string, ProfileView>): { varied: number; stuck: number } {
  const order = plans.map((p) => ({ p, rank: seedFor(tile.tx, tile.tz, p.id, 'rank') })).sort((a, b) => a.rank - b.rank || (a.p.id < b.p.id ? -1 : 1));
  const done = new Map<string, string>();
  let varied = 0;
  let stuck = 0;
  for (const { p } of order) {
    const taken = new Set<string>();
    for (const n of neighbours.get(p.id) ?? []) {
      const s = done.get(n);
      if (s !== undefined) taken.add(s);
    }
    if (taken.has(signature(p))) {
      const view = views.get(p.profile);
      const spec = TYPES[p.type];
      const r = rngFor(tile.tx, tile.tz, p.id, 'variety');
      const tries: (() => void)[] = [];
      const base = { ...p };
      if (view) {
        const start = r.int(0, view.colours.length - 1);
        for (let k = 0; k < view.colours.length; k++) {
          const c = (start + k) % view.colours.length;
          if (c !== base.colour) tries.push(() => {
            p.colour = c;
            p.tint = shade((view.colours[c] as { rgb: number }).rgb, 0.92 + ((base.tint & 15) / 15) * 0.14);
          });
        }
      }
      if (!p.worship) for (const [roof] of spec.roofs) {
        if (roof === base.roof || (roof === 'setback' && p.floors < 3) || (roof === 'crown' && p.floors < 5) || (roof === 'gable' && p.floors > 2)) continue;
        if ((roof === 'gable') !== (base.roof === 'gable')) continue; // the parapet is part of the height
        tries.push(() => {
          p.roof = roof;
        });
      }
      if (p.from === 'profile') for (const d of r.chance(0.5) ? [1, -1] : [-1, 1]) {
        const fl = base.floors + d;
        if (fl < 1 || fl < spec.minFloors || fl > spec.maxFloors || fl > p.cap) continue;
        tries.push(() => {
          p.floors = fl;
          p.height = spec.groundM + (fl - 1) * spec.floorM + p.parapetM;
        });
      }
      let ok = false;
      for (const t of tries) {
        Object.assign(p, base);
        t();
        if (!taken.has(signature(p))) {
          ok = true;
          break;
        }
      }
      if (ok) {
        p.varied = true;
        varied++;
      } else {
        Object.assign(p, base);
        stuck++;
      }
    }
    done.set(p.id, signature(p));
  }
  return { varied, stuck };
}
