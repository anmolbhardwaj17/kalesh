// The landmark registry build (P2-005; DELHI_WORLD.md section 1 and section 10 "Landmark registry pipeline", LM1 and
// LS2). OSM objects and Wikidata items are joined on ids (the OSM wikidata tag, or the two ids of an owner list line);
// a name and distance match is only a fallback and is always flagged. A score proposes the tier; the owner list wins
// over the score and an edit in harness/data/landmarks.overrides.json wins over both. A Wikidata point outside the
// OSM footprint and more than 50 m from its centre is an issue, and that entry is held (never placed) until an edit
// settles it. Every entry gets its block, district, far flag and area id. Pure: the same input gives the same files
// and the same hash; tools/bake/sources/landmarksio.ts reads the inputs and writes the files.
import { projector } from '../../geo/projection.ts';
import type { LatLon } from '../../geo/projection.ts';
import { pointInRing, pointSegment, ringArea, ringCentroid } from '../geom.ts';
import type { P2 } from '../geom.ts';
import { hashText } from '../graph/checks.ts';
import { osmBelowGround } from '../graph/underground.ts';
import type { UndergroundList } from '../graph/underground.ts';
import { geodesic } from '../layout/geodesic.ts';
import { tileOf } from '../layout/grid.ts';
import { outlineContains } from '../layout/outline.ts';
import { haversine, landmarkKind } from './osm.ts';
import { SCORE, proposeTier, resolveTier } from './tier.ts';
import { RULE_TITLES } from './types.ts';
import type { AreaRef, Edit, Entry, HeightSource, InfraVariant, LandmarkIssue, LandmarkList, ListEntry, Match, OsmLandmark, OverridesFile, SeenRoad, Tier, WikidataItem } from './types.ts';
import { isPerson, isWorshipClass, wikidataOnlyReject } from './wikidata.ts';

/** Sources further apart than this (and the point outside the footprint) disagree. */
export const AGREE_M = 50;
/** Radius of the name and distance fallback. */
export const NAME_RADIUS_M = 150;
/** Metres per floor when the only height source is OSM building:levels. */
const FLOOR_M = 3.2;

type LonLat = readonly [number, number];

export interface RegistryInput {
  /** The bake stage ("pilot") and the block it lies in. */
  stage: string;
  block: string;
  /** The block frame origin and its name (the pivot the far bearings are measured from). */
  origin: LatLon;
  originName: string;
  /** The block's world offset (issue records are in world metres). */
  offset: P2;
  /** The stage outline, [lon, lat] pairs. */
  outline: readonly LonLat[];
  /** Focus district outlines, [lon, lat] pairs. The first that holds a point names its district. */
  districts: readonly { id: string; coords: readonly LonLat[] }[];
  osm: readonly OsmLandmark[];
  /** Overpass timestamp of the OSM extract, for the evidence lines. */
  osmBase: string;
  wikidata: readonly WikidataItem[];
  /** Wikidata ids an OSM tag or the owner list names that are in no cache (Wikidata was not reachable). */
  notFetched: readonly string[];
  roads: readonly SeenRoad[];
  areaAt: (x: number, z: number) => AreaRef;
  underground: UndergroundList;
  /** Station and underground rows of the infrastructure variant map (by OSM id); empty when there is none. */
  infrastructure?: readonly InfraVariant[];
  list: LandmarkList;
  overrides: OverridesFile;
  nameRadiusM?: number;
}

export interface Rejected {
  id: string;
  name: string;
  why: string;
}

export interface RegistryStats {
  candidates: number;
  perTier: Record<Tier, number>;
  perMatch: Record<Match, number>;
  perSource: { osm: number; wikidata: number; asi: number };
  withFootprint: number;
  far: number;
  held: number;
  unplaced: number;
  worship: number;
  underground: number;
  flagged: Record<string, number>;
  issues: Record<string, number>;
  rejected: number;
  outsideStage: number;
  heightsMissing: string[];
  staleEdits: string[];
}

export interface RegistryResult {
  entries: Entry[];
  issues: LandmarkIssue[];
  rejected: Rejected[];
  /** Hard problems: an owner list line that found nothing. The driver prints them and exits with an error. */
  problems: string[];
  stats: RegistryStats;
  /** Repo path to file text: one file per hero and signature, and landmarks_markers.json. */
  files: Record<string, string>;
  /** The text of the registry's issues.json. */
  issuesText: string;
  hash: string;
}

const norm = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').trim();
const r1 = (v: number): number => Math.round(v * 10) / 10;
const r7 = (v: number): number => Math.round(v * 1e7) / 1e7;
const qn = (q: string): number => Number(q.slice(1));
const osmOrder = (a: OsmLandmark, b: OsmLandmark): number => Number(b.hasFootprint) - Number(a.hasFootprint) || b.areaM2 - a.areaM2 || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** A file-safe id: the name in ASCII plus the source id, so two places of one name never collide. */
export function entryId(name: string, sourceId: string): string {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48).replace(/_+$/, '');
  const src = sourceId.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return slug ? `${slug}_${src}` : src;
}

interface Raw {
  o: OsmLandmark | null;
  w: WikidataItem | null;
  match: Match;
  flags: string[];
  parts: string[];
  /** The OSM wikidata tag when it could not be used as a join (not fetched, or it names a person). */
  tagQid: string | null;
  list: ListEntry | null;
  nameDistanceM?: number;
}

/** Step 1: join the sources on ids; name and distance only as a flagged fallback. */
export function joinSources(input: RegistryInput): { raws: Raw[]; rejected: Rejected[]; problems: string[] } {
  const radius = input.nameRadiusM ?? NAME_RADIUS_M;
  const itemByQ = new Map<string, WikidataItem>();
  for (const w of input.wikidata) if (!itemByQ.has(w.qid)) itemByQ.set(w.qid, w);
  const osmById = new Map<string, OsmLandmark>();
  for (const o of input.osm) osmById.set(o.id, o);
  const notFetched = new Set(input.notFetched);
  const listByQ = new Map<string, ListEntry>();
  const listByOsm = new Map<string, ListEntry>();
  for (const l of input.list.landmarks) {
    if (l.ids.wikidata) listByQ.set(l.ids.wikidata, l);
    if (l.ids.osm) listByOsm.set(l.ids.osm, l);
  }
  const usedQ = new Set<string>();
  const usedOsm = new Set<string>();
  const raws: Raw[] = [];
  const rejected: Rejected[] = [];
  const problems: string[] = [];
  const byTag = new Map<string, OsmLandmark[]>();
  for (const o of input.osm) {
    if (!o.wikidata) continue;
    let g = byTag.get(o.wikidata);
    if (!g) byTag.set(o.wikidata, (g = []));
    g.push(o);
  }

  // a. owner list lines that name both ids: a join by hand, on ids
  for (const l of input.list.landmarks) {
    if (!l.ids.osm || !l.ids.wikidata) continue;
    const o = osmById.get(l.ids.osm) ?? null;
    const w = itemByQ.get(l.ids.wikidata) ?? null;
    if (!o && !w) {
      problems.push(`owner list ${l.id}: neither ${l.ids.osm} nor ${l.ids.wikidata} is in the stage data`);
      continue;
    }
    const flags: string[] = [];
    const parts: string[] = [];
    if (o) usedOsm.add(o.id);
    else flags.push('list_osm_object_not_in_extract');
    if (w) usedQ.add(w.qid);
    else flags.push(notFetched.has(l.ids.wikidata) ? 'wikidata_item_not_fetched' : 'list_wikidata_item_not_found');
    for (const p of (byTag.get(l.ids.wikidata) ?? []).slice().sort(osmOrder)) {
      if (o && p.id === o.id) continue;
      usedOsm.add(p.id);
      parts.push(p.id);
    }
    const byTagJoin = !!o && !!w && o.wikidata === w.qid;
    if (o && w && !byTagJoin) flags.push('joined_by_owner_list');
    raws.push({ o, w, match: o && w ? (byTagJoin ? 'wikidata_tag' : 'owner_list') : 'none', flags, parts, tagQid: w ? null : l.ids.wikidata, list: l });
  }

  // b. OSM objects that carry a wikidata tag: one landmark per item, the largest footprint first
  for (const q of [...byTag.keys()].sort((a, b) => qn(a) - qn(b))) {
    const group = (byTag.get(q) as OsmLandmark[]).filter((o) => !usedOsm.has(o.id)).sort(osmOrder);
    const first = group[0];
    if (!first || usedQ.has(q)) continue;
    const item = itemByQ.get(q) ?? null;
    if (item && (isPerson(item) || item.lat === null)) {
      // The tag names a subject, not this object: the person a memorial is for, or a body or a brand housed here (a
      // ministry, a chain) that Wikidata gives no place. Such an object is a landmark only when its own tags make it
      // one, and it takes no fame from the item. A person is no join at all; a body keeps its id on the first object.
      const person = isPerson(item);
      const kept: OsmLandmark[] = [];
      for (const o of group) {
        usedOsm.add(o.id);
        if (listByOsm.get(o.id) || listByQ.get(q) || (landmarkKind(o.tags) && o.name)) kept.push(o);
        else rejected.push({ id: o.id, name: o.name, why: `its wikidata tag ${q} names ${person ? 'a person' : 'a body or a brand with no place of its own'} and its own tags do not make it a landmark` });
      }
      if (person) for (const o of kept) raws.push({ o, w: null, match: 'none', flags: ['wikidata_tag_names_a_subject'], parts: [], tagQid: q, list: listByOsm.get(o.id) ?? null });
      else if (kept[0]) {
        usedQ.add(q);
        raws.push({ o: kept[0], w: item, match: 'wikidata_tag', flags: ['wikidata_item_has_no_coordinate'], parts: kept.slice(1).map((o) => o.id), tagQid: null, list: listByQ.get(q) ?? listByOsm.get(kept[0].id) ?? null });
      }
      continue;
    }
    for (const o of group) usedOsm.add(o.id);
    const parts = group.slice(1).map((o) => o.id);
    const list = listByQ.get(q) ?? listByOsm.get(first.id) ?? null;
    if (item) {
      usedQ.add(q);
      raws.push({ o: first, w: item, match: 'wikidata_tag', flags: [], parts, tagQid: null, list });
    } else {
      raws.push({ o: first, w: null, match: 'none', flags: [notFetched.has(q) ? 'wikidata_item_not_fetched' : 'wikidata_item_not_found'], parts, tagQid: q, list });
    }
  }

  // c. OSM objects with no tag: the nearest unused item of the same name within the radius (flagged)
  const rest = input.osm.filter((o) => !usedOsm.has(o.id)).sort(osmOrder);
  const free = [...itemByQ.values()].filter((w) => w.lat !== null && w.lon !== null).sort((a, b) => qn(a.qid) - qn(b.qid));
  for (const o of rest) {
    usedOsm.add(o.id);
    const n = norm(o.name);
    const nh = o.nameHi ? norm(o.nameHi) : '';
    let hit: WikidataItem | null = null;
    let best = Infinity;
    if (n || nh) {
      for (const w of free) {
        if (usedQ.has(w.qid)) continue;
        const same = (n && norm(w.label) === n) || (nh && w.labelHi !== null && norm(w.labelHi) === nh);
        if (!same) continue;
        const d = haversine(o.lat, o.lon, w.lat as number, w.lon as number);
        if (d <= radius && d < best) {
          hit = w;
          best = d;
        }
      }
    }
    if (hit) usedQ.add(hit.qid);
    raws.push({ o, w: hit, match: hit ? 'name_distance' : 'none', flags: hit ? ['fallback_name_match'] : [], parts: [], tagQid: null, list: listByOsm.get(o.id) ?? (hit ? listByQ.get(hit.qid) ?? null : null), ...(hit ? { nameDistanceM: r1(best) } : {}) });
  }

  // d. Wikidata items no OSM object names: kept only when they are structures some register or Wikipedia knows.
  // A coordinate that three or more items share to the last digit is a default (a city or district centre), not a place.
  const coordCount = new Map<string, number>();
  for (const w of itemByQ.values()) if (w.lat !== null) coordCount.set(`${w.lat},${w.lon}`, (coordCount.get(`${w.lat},${w.lon}`) ?? 0) + 1);
  for (const w of [...itemByQ.values()].sort((a, b) => qn(a.qid) - qn(b.qid))) {
    if (usedQ.has(w.qid)) continue;
    const list = listByQ.get(w.qid) ?? null;
    const no = list ? (w.lat === null ? 'no coordinate' : null) : wikidataOnlyReject(w);
    if (no) {
      if (list) problems.push(`owner list ${list.id}: Wikidata ${w.qid} has ${no}`);
      // an item the OSM tags only name as a subject (a person) is not a reject of the registry: it was never a place
      else if (w.lat !== null) rejected.push({ id: w.qid, name: w.label, why: no });
      continue;
    }
    usedQ.add(w.qid);
    const shared = (coordCount.get(`${w.lat},${w.lon}`) ?? 0) >= 3;
    raws.push({ o: null, w, match: 'none', flags: ['wikidata_only_no_osm_object', ...(shared ? ['wikidata_coordinate_shared_by_other_items'] : [])], parts: [], tagQid: null, list });
  }
  for (const l of input.list.landmarks) {
    const found = raws.some((r) => r.list === l);
    if (!found && !problems.some((p) => p.startsWith(`owner list ${l.id}:`))) {
      problems.push(`owner list ${l.id}: no candidate carries ${[l.ids.wikidata, l.ids.osm].filter(Boolean).join(' or ')}${l.ids.wikidata && notFetched.has(l.ids.wikidata) ? ' (Wikidata was not reachable and the item is in no cache)' : ''}`);
    }
  }
  return { raws, rejected, problems };
}

// ------------------------------------------------------------------ "seen from" a road

interface Seg {
  a: P2;
  b: P2;
  hero: boolean;
}
const CELL = 120;

function roadGrid(roads: readonly SeenRoad[]): Map<string, Seg[]> {
  const grid = new Map<string, Seg[]>();
  const pad = SCORE.seenM;
  for (const r of roads) {
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const a = r.pts[i] as P2;
      const b = r.pts[i + 1] as P2;
      const seg: Seg = { a, b, hero: r.hero };
      for (let ix = Math.floor((Math.min(a.x, b.x) - pad) / CELL); ix <= Math.floor((Math.max(a.x, b.x) + pad) / CELL); ix++) {
        for (let iz = Math.floor((Math.min(a.z, b.z) - pad) / CELL); iz <= Math.floor((Math.max(a.z, b.z) + pad) / CELL); iz++) {
          const k = `${ix},${iz}`;
          let list = grid.get(k);
          if (!list) grid.set(k, (list = []));
          list.push(seg);
        }
      }
    }
  }
  return grid;
}

/** Metres from the nearest of `pts` to the nearest arterial and hero road centre line, null beyond the seen distance. */
function seenFrom(grid: Map<string, Seg[]>, pts: readonly P2[]): { arterialM: number | null; heroRoadM: number | null } {
  let art = Infinity;
  let hero = Infinity;
  for (const p of pts) {
    for (const s of grid.get(`${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`) ?? []) {
      const d = pointSegment(p, s.a, s.b).d;
      if (s.hero) hero = Math.min(hero, d);
      else art = Math.min(art, d);
    }
  }
  return { arterialM: art <= SCORE.seenM ? r1(art) : null, heroRoadM: hero <= SCORE.seenM ? r1(hero) : null };
}

// ------------------------------------------------------------------ entry fields

const WORSHIP_BUILDING = new Set(['mosque', 'temple', 'church', 'cathedral', 'chapel', 'gurdwara', 'synagogue', 'shrine', 'monastery']);

function worshipOf(o: OsmLandmark | null, w: WikidataItem | null): { religion: string } | null {
  const t = o?.tags ?? {};
  const byOsm = t['amenity'] === 'place_of_worship' || WORSHIP_BUILDING.has(t['building'] ?? '') || t['landuse'] === 'religious';
  const byClass = !!w && isWorshipClass(w);
  if (!byOsm && !byClass) return null;
  let religion = t['religion'] ?? '';
  if (!religion && w) {
    const c = w.instanceOf.join(' ').toLowerCase();
    religion = /mosque|masjid|dargah/.test(c) ? 'muslim' : /jain/.test(c) ? 'jain' : /gurdwara|gurudwara/.test(c) ? 'sikh' : /church|cathedral/.test(c) ? 'christian' : /buddhist/.test(c) ? 'buddhist' : /bah[aá][.'’]?[ií]/.test(c) ? 'bahai' : /hindu|mandir|swaminarayan/.test(c) ? 'hindu' : '';
  }
  return { religion: religion || 'unknown' };
}

const STATION_CLASS = /\b((metro|railway|train|underground|elevated|rapid transit) station|station located on surface)\b/i;

function stationOf(o: OsmLandmark | null, w: WikidataItem | null): Entry['station'] | null {
  const t = o?.tags ?? {};
  const byOsm = t['railway'] === 'station' || t['station'] === 'subway' || t['building'] === 'train_station';
  const classes = w ? w.instanceOf.filter((l) => STATION_CLASS.test(l)) : [];
  if (!byOsm && classes.length === 0) return null;
  const metro = t['station'] === 'subway' || t['subway'] === 'yes' || /metro/i.test(t['network'] ?? '') || classes.some((l) => /metro|rapid transit|underground station|elevated station/i.test(l));
  const network = t['network'] ?? (metro ? 'Delhi Metro' : 'Indian Railways');
  const cls = classes.join(', ');
  if (/underground station/i.test(cls)) return { network, style: 'underground', style_from: `Wikidata class (${cls})` };
  if (/elevated station/i.test(cls)) return { network, style: 'elevated', style_from: `Wikidata class (${cls})` };
  if (/station located on surface/i.test(cls)) return { network, style: 'surface', style_from: `Wikidata class (${cls})` };
  const layer = Number(t['layer']);
  if (t['location'] === 'underground' || t['tunnel'] === 'yes' || (Number.isFinite(layer) && layer < 0 && t['location'] === undefined)) return { network, style: 'underground', style_from: `OSM tags (${t['location'] === 'underground' ? 'location=underground' : t['tunnel'] === 'yes' ? 'tunnel=yes' : `layer=${t['layer']}`})` };
  if (t['bridge'] === 'yes' || t['location'] === 'overground' || (Number.isFinite(layer) && layer > 0)) return { network, style: 'elevated', style_from: `OSM tags (${t['bridge'] === 'yes' ? 'bridge=yes' : t['location'] === 'overground' ? 'location=overground' : `layer=${t['layer']}`})` };
  if (!metro) return { network, style: 'surface', style_from: 'a railway station on the surface network' };
  return { network, style: 'unknown', style_from: 'neither the Wikidata class nor the OSM tags say underground, elevated or surface' };
}

const yearOf = (inception: string | null): string | null => {
  const m = /^(-?\d{1,4})-/.exec(inception ?? '');
  return m ? String(Number(m[1])) : null;
};

const typeOf = (o: OsmLandmark | null, w: WikidataItem | null): string => {
  // the shortest class label is the plainest one ("triumphal arch" before "Commonwealth War Graves Commission maintained memorial")
  const cls = w?.instanceOf.filter((l) => l !== 'human').sort((a, b) => a.length - b.length || (a < b ? -1 : 1))[0];
  if (cls) return cls;
  const kind = o?.kind ?? '';
  const v = kind.includes('=') ? kind.slice(kind.indexOf('=') + 1) : kind;
  return v && v !== 'yes' ? v.replace(/_/g, ' ') : 'structure';
};

interface Ctx {
  input: RegistryInput;
  proj: ReturnType<typeof projector>;
  grid: Map<string, Seg[]>;
  osmById: Map<string, OsmLandmark>;
  underground: Map<string, string>;
  surface: Set<string>;
  /** Variant rows by OSM id; a station row comes before an underground feature row of the same id. */
  infra: Map<string, InfraVariant>;
}

const editsFor = (edits: readonly Edit[], id: string, w: string | null, o: string | null): Edit[] =>
  edits.filter((e) => (e.target.id !== undefined && e.target.id === id) || (e.target.wikidata !== undefined && e.target.wikidata === w) || (e.target.osm !== undefined && e.target.osm === o));

/** Step 2: one registry entry from a joined candidate, with the edits laid on top. Null when an edit removes it. */
function makeEntry(ctx: Ctx, raw: Raw, edits: readonly Edit[]): { entry: Entry | null; removedWhy?: string } {
  const { input, proj } = ctx;
  const { o, w } = raw;
  const qid = w?.qid ?? null;
  const sourceId = qid ?? o?.id ?? raw.tagQid ?? '';
  const latin = (s: string): boolean => /[a-z]/i.test(s);
  const named = (o && latin(o.name) ? o.name : '') || w?.label || o?.name || '';
  const nameEn = named || sourceId;
  const id = raw.list?.id ?? entryId(named, sourceId);
  const mine = editsFor(edits, id, qid, o?.id ?? null);
  const removal = mine.find((e) => e.action === 'remove');
  if (removal) return { entry: null, removedWhy: `edit ${removal.id}: ${removal.why}` };
  const sets = mine.filter((e) => e.action === 'set' && e.set);
  const flags = [...raw.flags];

  // footprint: the OSM polygon, unless an edit names another OSM object or a ring read from a photo or satellite view
  let fp: Entry['footprint'] = o?.hasFootprint ? { source: 'osm', ref: o.ringRef, area_m2: o.areaM2, ring: o.ring } : null;
  let centre: { lat: number; lon: number } | null = o?.hasFootprint ? { lat: o.lat, lon: o.lon } : null;
  for (const e of sets) {
    const f = e.set?.footprint;
    if (!f) continue;
    if (f.source === 'osm' && f.ref) {
      const other = ctx.osmById.get(f.ref);
      if (!other || !other.hasFootprint) {
        flags.push('edit_footprint_not_in_extract');
        continue;
      }
      fp = { source: 'osm', ref: other.ringRef, area_m2: other.areaM2, ring: other.ring, evidence: `edit ${e.id}: ${e.why}` };
      centre = { lat: other.lat, lon: other.lon };
    } else if (f.ring && f.ring.length >= 3) {
      const ring = f.ring.map(([la, lo]) => proj.toWorld(la, lo));
      const c = ringCentroid(ring);
      const g = proj.toGeo(c.x, c.z);
      fp = { source: f.source, ref: f.ref ?? e.id, area_m2: Math.round(Math.abs(ringArea(ring))), ring: f.ring, evidence: `edit ${e.id}: ${e.why} (replaces the OSM shape)` };
      centre = { lat: g.lat, lon: g.lon };
      flags.push('footprint_from_photo_or_satellite');
    }
  }
  const ringM: P2[] = fp?.ring ? fp.ring.map(([la, lo]) => proj.toWorld(la, lo)) : [];

  // position
  let pos: Entry['position'];
  let lat: number;
  let lon: number;
  if (centre && fp) {
    lat = centre.lat;
    lon = centre.lon;
    pos = { source: 'osm_footprint_centre', ref: fp.ref, evidence: fp.source === 'osm' ? `area centroid of OSM ${fp.ref} (osmBase ${input.osmBase})` : `area centroid of the ${fp.source} ring of ${fp.ref}` };
  } else if (o) {
    lat = o.lat;
    lon = o.lon;
    pos = { source: 'osm_node', ref: o.id, evidence: `OSM ${o.id} (osmBase ${input.osmBase})${o.id.startsWith('node/') ? '' : ', mean of its points (not a closed shape)'}` };
  } else {
    lat = w?.lat ?? 0;
    lon = w?.lon ?? 0;
    pos = { source: 'wikidata', ref: qid ?? '', evidence: `Wikidata ${qid} P625; no OSM object to check it against` };
  }
  let positionChecked = false;
  for (const e of sets) {
    const s = e.set;
    if (!s) continue;
    if (s.lat !== undefined && s.lon !== undefined) {
      const off = centre ? r1(haversine(s.lat, s.lon, centre.lat, centre.lon)) : undefined;
      lat = s.lat;
      lon = s.lon;
      pos = { source: 'hand', ref: fp?.ref ?? o?.id ?? qid ?? '', evidence: `edit ${e.id}: ${s.position_evidence ?? e.why}`, ...(off !== undefined ? { footprint_centre_offset_m: off } : {}) };
    }
    if (s.position_checked) positionChecked = true;
  }

  // source agreement: the Wikidata point inside the footprint, or within 50 m of the centre
  let agreement: Entry['agreement'] = null;
  if (o && w && w.lat !== null && w.lon !== null) {
    const c = centre ?? { lat: o.lat, lon: o.lon };
    const d = r1(haversine(c.lat, c.lon, w.lat, w.lon));
    const inside = ringM.length >= 3 && pointInRing(proj.toWorld(w.lat, w.lon), ringM);
    agreement = { osm_to_wikidata_m: d, wikidata: [r7(w.lat), r7(w.lon)], inside_footprint: inside, ok: inside || d <= AGREE_M };
    if (!agreement.ok) flags.push('sources_disagree_over_50m');
  }

  // where it is: stage outline, district, area; far when outside the outline
  const inStage = outlineContains(input.outline, lat, lon);
  const m = proj.toWorld(lat, lon);
  const district = inStage ? input.districts.find((d) => outlineContains(d.coords, lat, lon))?.id ?? null : null;
  const areaRef = inStage ? input.areaAt(m.x, m.z) : null;
  const area = areaRef && areaRef.kind !== 'none' ? areaRef : null;
  const far = !inStage;

  // classes of their own: worship, stations, underground
  const worship = worshipOf(o, w);
  let station = stationOf(o, w);
  const ids = [o?.id, ...raw.parts].filter((v): v is string => !!v);
  // the infrastructure variant map names the kit of a station (or an underground feature) by OSM id; where neither
  // Wikidata nor the tags say how a station stands, its mode does
  const infraRow = ids.map((i) => ctx.infra.get(i)).find((v) => v !== undefined) ?? null;
  if (station && station.style === 'unknown' && infraRow?.mode && ['underground', 'elevated', 'surface'].includes(infraRow.mode)) station = { ...station, style: infraRow.mode as 'underground' | 'elevated' | 'surface', style_from: `infrastructure variant map, ${infraRow.id} (${infraRow.variant})` };
  let underWhy: string | null = null;
  if (!ids.some((i) => ctx.surface.has(i))) {
    const listed = ids.find((i) => ctx.underground.has(i));
    if (listed) underWhy = `harness/data/underground.json ${listed}: ${ctx.underground.get(listed)}`;
    else if (station?.style === 'underground') underWhy = `an underground station (${station.style_from})`;
    else if (o && !station) {
      const why = osmBelowGround(o.tags);
      if (why) underWhy = `OSM ${o.id} tags: ${why}`;
    }
  }

  // tier
  const subject = raw.flags.includes('wikidata_tag_names_a_subject');
  const noFame = subject || raw.flags.includes('wikidata_item_has_no_coordinate');
  const seen = seenFrom(ctx.grid, ringM.length ? [...ringM, m] : [m]);
  const proposal = proposeTier({ sitelinks: noFame ? 0 : w?.sitelinks ?? 0, asi: w?.asi ?? null, footprintM2: fp?.area_m2 ?? 0, hasObject: !!o, arterialM: seen.arterialM, heroRoadM: seen.heroRoadM, station: !!station });
  const tierEdit = [...sets].reverse().find((e) => e.set?.tier !== undefined);
  const tier = resolveTier(proposal, raw.list ? { tier: raw.list.tier, said: raw.list.said } : null, tierEdit ? { tier: tierEdit.set?.tier as Tier, why: tierEdit.why, id: tierEdit.id } : null);

  // height: by hand first, then Wikidata P2048, then the OSM height tag, then OSM floors (an estimate)
  let height: { m: number | null; source: HeightSource; evidence: string } = { m: null, source: 'none', evidence: 'no source gives a height: read one by hand before the stand-in is built' };
  const osmH = Number.parseFloat(o?.tags['height'] ?? '');
  const osmLv = Number.parseFloat(o?.tags['building:levels'] ?? '');
  if (underWhy) height = { m: null, source: 'none', evidence: 'underground: no shell above the ground, so no height' };
  else if (w?.heightM) height = { m: w.heightM, source: 'wikidata', evidence: `Wikidata ${w.qid} P2048 (height) ${w.heightM} m` };
  else if (Number.isFinite(osmH) && osmH > 0) height = { m: osmH, source: 'osm', evidence: `OSM ${o?.id} height=${o?.tags['height']}` };
  else if (Number.isFinite(osmLv) && osmLv > 0) height = { m: r1(osmLv * FLOOR_M), source: 'osm_levels', evidence: `OSM ${o?.id} building:levels=${o?.tags['building:levels']} at ${FLOOR_M} m a floor: an estimate until a reference is read` };
  for (const e of sets) {
    const s = e.set;
    if (s?.height_m !== undefined) height = { m: s.height_m, source: s.height_source ?? 'reference', evidence: `edit ${e.id}: ${s.height_evidence ?? e.why}` };
  }

  // evidence line and sources
  const asi = w?.asi ?? null;
  const osmPart = o ? `OSM ${o.id} (${o.kind}, osmBase ${input.osmBase})` : '';
  const wdPart = w ? `Wikidata ${w.qid} "${w.label}"${asi ? `, ASI ${asi} (P1371)` : ''}` : '';
  let evidence: string;
  if (o && w) {
    const how = raw.match === 'wikidata_tag' ? 'joined on the OSM wikidata tag' : raw.match === 'owner_list' ? `joined by the two ids of the owner list line ${raw.list?.id}` : `joined by name within ${raw.nameDistanceM} m (the fallback: flagged, to be checked)`;
    evidence = `${osmPart} and ${wdPart}, ${how}`;
  } else if (o) {
    evidence = `${osmPart}, name "${o.name}"; ${raw.tagQid ? (subject ? `its wikidata tag ${raw.tagQid} names a subject, not this object` : `its wikidata tag ${raw.tagQid} could not be read`) : 'no Wikidata item'}`;
  } else {
    evidence = `${wdPart} (${w?.instanceOf.join(', ') || 'no class'}), P625 coordinate; no OSM object in the extract carries its id`;
  }

  // issue and placement
  const joinChecked = sets.some((e) => e.set?.join_checked);
  let issue: string | undefined;
  if (flags.includes('sources_disagree_over_50m')) issue = `R-LM-01:${o?.id}:${qid}`;
  else if (raw.match === 'name_distance') issue = `R-LM-02:${o?.id}:${qid}`;
  // held: the sources disagree on where it is and nobody has read the site yet. A name match alone does not hold
  // the entry (the OSM object stands there either way); it is flagged and has its own issue.
  const held = flags.includes('sources_disagree_over_50m') && !positionChecked;
  const place: Entry['place'] = !o && !fp ? 'unplaced' : held ? 'held' : 'ok';
  if (positionChecked) flags.push('position_checked_by_hand');
  if (joinChecked) flags.push('join_checked_by_hand');
  if (far) flags.push('far_backdrop_only');

  const nameSet = sets.map((e) => e.set?.name).filter((n): n is NonNullable<typeof n> => !!n).pop();
  const last = <K extends 'type' | 'era' | 'front' | 'extent' | 'references'>(k: K) => sets.map((e) => e.set?.[k]).filter((v) => v !== undefined).pop();
  const bearing = far ? geodesic(input.origin, { lat, lon }) : null;
  const entry: Entry = {
    id,
    name: { en: nameSet?.en ?? nameEn, hi: nameSet?.hi ?? o?.nameHi ?? w?.labelHi ?? null },
    ids: { wikidata: qid ?? (raw.tagQid && !subject ? raw.tagQid : null), osm: o?.id ?? null, asi },
    match: raw.match,
    sources: [...(o ? ['osm'] : []), ...(w ? ['wikidata'] : []), ...(asi ? ['asi'] : [])],
    evidence,
    lat: r7(lat),
    lon: r7(lon),
    position: pos,
    footprint: fp,
    height_m: height.m,
    height_source: height.source,
    height_evidence: height.evidence,
    era: (last('era') as string | undefined) ?? yearOf(w?.inception ?? null) ?? (o?.tags['start_date'] ?? null),
    type: (last('type') as string | undefined) ?? typeOf(o, w),
    kind: o?.kind ?? 'wikidata',
    tier: tier.tier,
    tier_from: tier.from,
    tier_reason: tier.reason,
    score: proposal.score,
    ...(raw.list?.hero_later ? { hero_later: true } : {}),
    block: far ? null : input.block,
    ...(far && raw.list?.block_planned ? { block_planned: raw.list.block_planned } : {}),
    district,
    far,
    ...(bearing ? { bearing_deg: r1(bearing.bearingDeg), distance_m: Math.round(bearing.distanceM), bearing_from: `${input.originName} (${input.origin.lat}, ${input.origin.lon}), geodesic on WGS84` } : {}),
    area,
    flags: [...new Set(flags)].sort(),
    ...(issue ? { issue } : {}),
    place,
    agreement,
    ...(worship ? { worship: { religion: worship.religion, combat_arena: false as const, rule: 'DELHI_WORLD.md 3 Respect rule: placed only where the sources place it, never a combat arena' } } : {}),
    ...(underWhy ? { underground: { why: underWhy, shell: 'none' as const } } : {}),
    ...(station ? { station } : {}),
    ...(infraRow ? { infrastructure: { variant: infraRow.variant, ...(infraRow.line ? { line: infraRow.line } : {}), from: `harness/design/reference/infrastructure/variant_map.json stations, ${infraRow.id}` } } : {}),
    ...(raw.parts.length ? { parts: raw.parts } : {}),
    ...(last('front') ? { front: last('front') as string } : {}),
    ...(last('extent') ? { extent: last('extent') as Record<string, number | string> } : {}),
    ...(last('references') ? { references: last('references') as NonNullable<Entry['references']> } : {}),
    licence_notes: `${o || fp?.source === 'osm' ? 'Geometry ODbL (OpenStreetMap contributors). ' : ''}${w ? 'Facts from Wikidata, CC0. ' : ''}Photos are reference only, never shipped.`,
    art: { status: 'stand-in' },
    confidence: {
      position: pos.source === 'hand' || (fp && (agreement?.ok ?? false)) ? 'high' : fp || agreement?.ok ? 'medium' : 'low',
      footprint: !fp ? 'none' : fp.source !== 'osm' || sets.some((e) => e.set?.footprint) ? 'high' : 'medium',
      height: height.source === 'reference' ? 'high' : height.source === 'wikidata' || height.source === 'osm' ? 'medium' : height.source === 'osm_levels' ? 'low' : 'none',
    },
    ...(mine.length ? { edits: mine.map((e) => e.id) } : {}),
  };
  return { entry };
}

// ------------------------------------------------------------------ issues

function issueOf(ctx: Ctx, e: Entry): LandmarkIssue | null {
  if (!e.issue) return null;
  const rule = e.issue.startsWith('R-LM-01') ? 'R-LM-01' : 'R-LM-02';
  const { input, proj } = ctx;
  const world = (lat: number, lon: number): P2 => {
    const p = proj.toWorld(lat, lon);
    return { x: r1(p.x + input.offset.x), z: r1(p.z + input.offset.z) };
  };
  const here = world(e.lat, e.lon);
  const t = tileOf(here.x, here.z);
  const wd = e.agreement?.wikidata ?? [e.lat, e.lon];
  const there = world(wd[0], wd[1]);
  const d = e.agreement?.osm_to_wikidata_m ?? 0;
  const settled = rule === 'R-LM-01' ? e.flags.includes('position_checked_by_hand') : e.flags.includes('join_checked_by_hand');
  const impact = e.tier === 'hero' ? 1 : e.tier === 'signature' ? 0.7 : 0.3;
  const proposals: LandmarkIssue['proposals'] =
    rule === 'R-LM-01'
      ? [
          { action: 'set_position', params: { from: 'osm', lat: e.lat, lon: e.lon }, confidence: e.footprint ? 0.6 : 0.45, reasoning: e.footprint ? `Keep the centre of the OSM footprint ${e.footprint.ref}: OSM draws the structure itself, and a Wikidata point is often the gate or the label of a larger site` : `Keep the OSM point ${e.ids.osm}`, preview: [here] },
          { action: 'set_position', params: { from: 'wikidata', lat: wd[0], lon: wd[1] }, confidence: e.footprint ? 0.15 : 0.3, reasoning: `Use the Wikidata point of ${e.ids.wikidata}, ${d} m away`, preview: [there] },
          { action: 'unlink', params: { osm: e.ids.osm ?? '', wikidata: e.ids.wikidata ?? '' }, confidence: 0.25, reasoning: 'Not the same place: the OSM object and the Wikidata item are two things that share a tag or a name', preview: [here, there] },
        ]
      : [
          { action: 'confirm_join', params: { osm: e.ids.osm ?? '', wikidata: e.ids.wikidata ?? '' }, confidence: 0.6, reasoning: `Same name, ${d} m apart: one place. Confirm it and add the wikidata tag to the OSM object`, preview: [here, there] },
          { action: 'unlink', params: { osm: e.ids.osm ?? '', wikidata: e.ids.wikidata ?? '' }, confidence: 0.4, reasoning: 'Two places of one name: keep them apart', preview: [here, there] },
        ];
  return {
    id: e.issue, rule, block: e.block, district: e.district, tile: [t.tx, t.tz], lat: e.lat, lon: e.lon, x: here.x, z: here.z,
    features: [e.ids.osm, e.ids.wikidata].filter((v): v is string => !!v), impact, confidence: 0.6, status: settled ? 'overridden' : 'open',
    note: rule === 'R-LM-01' ? `${e.name.en}: the Wikidata point is ${d} m from the OSM ${e.footprint ? 'footprint centre and outside the footprint' : 'point'}; ${settled ? 'settled by an edit' : 'held, not placed'}` : `${e.name.en}: joined by name within ${d} m, not by id`,
    landmark: e.id, proposals,
  };
}

// ------------------------------------------------------------------ files

/** JSON with two-space indent, with every list of numbers on one line (rings stay readable and diffable). */
export function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/\[\s*(-?[\d.eE+-]+(?:,\s*-?[\d.eE+-]+)*)\s*\]/g, (_m, inner: string) => `[${inner.replace(/\s+/g, ' ')}]`) + '\n';
}

export const LANDMARK_DIR = 'harness/data/landmarks';
export const MARKERS_FILE = 'harness/data/landmarks_markers.json';
const GENERATED = 'Generated by the landmark registry build (node tools/bake/landmarks/build.mjs). Never edit this file: put an edit in harness/data/landmarks.overrides.json and build again.';

/** Marker rows leave out what is the same for every marker (kept once in the file header) and the footprint ring. */
function markerRow(e: Entry): Record<string, unknown> {
  const { licence_notes: _l, art: _a, footprint, ...rest } = e;
  void _l;
  void _a;
  return { ...rest, footprint: footprint ? { source: footprint.source, ref: footprint.ref, area_m2: footprint.area_m2 } : null };
}

function filesOf(input: RegistryInput, entries: readonly Entry[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const e of entries) if (e.tier !== 'marker') files[`${LANDMARK_DIR}/${e.id}.json`] = pretty({ _generated: GENERATED, ...e });
  const markers = entries.filter((e) => e.tier === 'marker');
  const head = {
    _doc: `Marker tier landmarks of the ${input.stage} stage (DELHI_WORLD.md 1 "Tiers": correct footprint and massing with the material of its area kit). ${GENERATED} One row per line. A row has the fields of a landmark file except the footprint ring (the bake reads it from the OSM object in footprint.ref), licence_notes and art (below, the same for every row).`,
    stage: input.stage,
    block: input.block,
    osm_base: input.osmBase,
    licence_notes: 'Geometry ODbL (OpenStreetMap contributors). Facts from Wikidata, CC0. Photos are reference only, never shipped.',
    art: { status: 'stand-in' },
    count: markers.length,
  };
  files[MARKERS_FILE] = `${JSON.stringify(head, null, 2).slice(0, -2)},\n  "markers": [\n${markers.map((e) => `    ${JSON.stringify(markerRow(e))}`).join(',\n')}\n  ]\n}\n`;
  return files;
}

const TIER_ORDER: Record<Tier, number> = { hero: 0, signature: 1, marker: 2 };

/** The whole build. */
export function buildRegistry(input: RegistryInput): RegistryResult {
  const proj = projector(input.origin);
  const osmById = new Map<string, OsmLandmark>();
  for (const o of input.osm) osmById.set(o.id, o);
  const ctx: Ctx = {
    input, proj, grid: roadGrid(input.roads), osmById,
    underground: new Map(input.underground.underground.map((u) => [u.id, u.why])),
    surface: new Set(input.underground.surface.map((u) => u.id)),
    infra: new Map(),
  };
  for (const v of input.infrastructure ?? []) if (!ctx.infra.has(v.id) || (ctx.infra.get(v.id)?.kind === 'underground feature' && v.kind !== 'underground feature')) ctx.infra.set(v.id, v);
  const { raws, rejected, problems } = joinSources(input);
  const edits = input.overrides.edits;
  const entries: Entry[] = [];
  let outsideStage = 0;
  const usedEdits = new Set<string>();
  const ids = new Set<string>();
  for (const raw of raws) {
    const { entry, removedWhy } = makeEntry(ctx, raw, edits);
    if (!entry) {
      rejected.push({ id: raw.w?.qid ?? raw.o?.id ?? '', name: raw.o?.name || raw.w?.label || '', why: removedWhy ?? 'removed' });
      for (const e of editsFor(edits, raw.list?.id ?? '', raw.w?.qid ?? null, raw.o?.id ?? null)) usedEdits.add(e.id);
      continue;
    }
    for (const id of entry.edits ?? []) usedEdits.add(id);
    // outside the stage outline: only the owner's named landmarks stay, as far landmarks of the backdrop
    if (entry.far && !raw.list) {
      outsideStage++;
      continue;
    }
    if (ids.has(entry.id)) {
      problems.push(`two landmarks share the id ${entry.id}`);
      continue;
    }
    ids.add(entry.id);
    entries.push(entry);
  }
  entries.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  rejected.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const issues = entries.map((e) => issueOf(ctx, e)).filter((i): i is LandmarkIssue => i !== null).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const staleEdits = edits.filter((e) => !usedEdits.has(e.id)).map((e) => e.id);

  const count = <K extends string>(keys: readonly K[], of: (e: Entry) => K): Record<K, number> => {
    const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
    for (const e of entries) out[of(e)]++;
    return out;
  };
  const flagged: Record<string, number> = {};
  for (const e of entries) for (const f of e.flags) flagged[f] = (flagged[f] ?? 0) + 1;
  const issueCounts: Record<string, number> = {};
  for (const i of issues) issueCounts[`${i.rule} ${i.status}`] = (issueCounts[`${i.rule} ${i.status}`] ?? 0) + 1;
  const stats: RegistryStats = {
    candidates: entries.length,
    perTier: count(['hero', 'signature', 'marker'] as const, (e) => e.tier),
    perMatch: count(['wikidata_tag', 'owner_list', 'name_distance', 'none'] as const, (e) => e.match),
    perSource: { osm: entries.filter((e) => e.sources.includes('osm')).length, wikidata: entries.filter((e) => e.sources.includes('wikidata')).length, asi: entries.filter((e) => e.sources.includes('asi')).length },
    withFootprint: entries.filter((e) => e.footprint).length,
    far: entries.filter((e) => e.far).length,
    held: entries.filter((e) => e.place === 'held').length,
    unplaced: entries.filter((e) => e.place === 'unplaced').length,
    worship: entries.filter((e) => e.worship).length,
    underground: entries.filter((e) => e.underground).length,
    flagged: Object.fromEntries(Object.entries(flagged).sort(([a], [b]) => (a < b ? -1 : 1))),
    issues: Object.fromEntries(Object.entries(issueCounts).sort(([a], [b]) => (a < b ? -1 : 1))),
    rejected: rejected.length,
    outsideStage,
    heightsMissing: entries.filter((e) => e.tier !== 'marker' && e.height_m === null && !e.underground).map((e) => e.id).sort(),
    staleEdits,
  };
  const files = filesOf(input, entries);
  const issuesText = JSON.stringify({ version: 1, block: input.block, source: `landmark registry, stage ${input.stage}, OSM ${input.osmBase}`, rules: RULE_TITLES, issues }) + '\n';
  const hash = hashText(Object.keys(files).sort().map((k) => `${k}\n${files[k]}`).join('\n') + issuesText);
  return { entries, issues, rejected, problems, stats, files, issuesText, hash };
}
