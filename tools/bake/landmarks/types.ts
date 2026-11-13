// Types of the landmark registry (P2-005, DELHI_WORLD.md section 1 and section 10 "Landmark registry pipeline",
// ARCH_OPTIONS LM1 and LS2). Pure data shapes: the build is tools/bake/landmarks/registry.ts.

export type Tier = 'hero' | 'signature' | 'marker';
export const TIERS: readonly Tier[] = ['hero', 'signature', 'marker'];

/**
 * How OSM and Wikidata were joined: on the wikidata tag, by the two ids of an owner list line, by name and distance
 * (the fallback, always flagged), or not at all (one source only).
 */
export type Match = 'wikidata_tag' | 'owner_list' | 'name_distance' | 'none';
export const MATCHES: readonly Match[] = ['wikidata_tag', 'owner_list', 'name_distance', 'none'];

/** One Wikidata item, reduced to what the registry reads. */
export interface WikidataItem {
  qid: string;
  label: string;
  labelHi: string | null;
  /** P625; null when the item has no coordinate (a person, a company). */
  lat: number | null;
  lon: number | null;
  sitelinks: number;
  /** P1371, the ASI monument id (N-DL-*). */
  asi: string | null;
  /** P571 as written by Wikidata. */
  inception: string | null;
  /** P2048 in metres (the largest value when there are several). */
  heightM: number | null;
  /** P31 class labels, sorted. */
  instanceOf: string[];
  /** P1435 heritage status labels, sorted. */
  heritage: string[];
  /** P373, the Commons category. */
  commons: string | null;
}

/** An OSM object that may be a landmark. */
export interface OsmLandmark {
  /** "way/1", "node/2" or "relation/3". */
  id: string;
  name: string;
  nameHi: string | null;
  /** The value of the wikidata tag. */
  wikidata: string | null;
  /** The footprint centre (area centroid) for a closed way or a relation, the node itself otherwise. */
  lat: number;
  lon: number;
  hasFootprint: boolean;
  /** "way/<id>" of the ring when the object is a relation, else the object's own id. */
  ringRef: string;
  /** The outer ring as [lat, lon] pairs, open; empty without a footprint. */
  ring: [number, number][];
  areaM2: number;
  /** The landmark tag that made it a candidate ("historic=monument"), or "building=yes", or "other". */
  kind: string;
  tags: Readonly<Record<string, string>>;
}

/** A road the tier score counts as "seen from": an arterial or a hero road, in bake metres. */
export interface SeenRoad {
  id: string;
  hero: boolean;
  pts: { x: number; z: number }[];
}

/** One row of the infrastructure variant map's station list, by OSM id. */
export interface InfraVariant {
  id: string;
  variant: string;
  kind?: string;
  mode?: string;
  line?: string;
}

export interface AreaRef {
  /** The area id of harness/data/areas/, or the archetype of the 100 m rule cell. */
  id: string;
  kind: 'area' | 'rule' | 'none';
  archetype: string;
}

/** One line of the owner list harness/data/landmark_list.json. */
export interface ListEntry {
  /** The file name of the entry (harness/data/landmarks/<id>.json). */
  id: string;
  name: string;
  tier: Tier;
  /** Join keys: any one that matches a candidate claims it. Never a name. */
  ids: { wikidata?: string; osm?: string };
  /** Who named it and where that is recorded. */
  said: string;
  /** True for a landmark whose hero model comes later (Jama Masjid): it stays at `tier` until then. */
  hero_later?: boolean;
  /** The block it will stand in once that block is baked; a far landmark of this stage until then. */
  block_planned?: string;
}

export interface LandmarkList {
  _doc?: string;
  landmarks: ListEntry[];
}

/** Fields an edit may set. Every one needs the edit's `why` (the evidence line). */
export interface EditSet {
  tier?: Tier;
  name?: { en?: string; hi?: string };
  type?: string;
  era?: string;
  height_m?: number;
  height_source?: HeightSource;
  /** The evidence line of the height (the edit's `why` when left out). */
  height_evidence?: string;
  /** The hand-checked position; settles a source disagreement when `position_checked` is true. */
  lat?: number;
  lon?: number;
  position_checked?: boolean;
  /** The evidence line of the position (the edit's `why` when left out). */
  position_evidence?: string;
  /** True when a name and distance join was read and is right: settles its issue. */
  join_checked?: boolean;
  /** A footprint that replaces OSM's: another OSM object by id, or a ring read from a photo or satellite view. */
  footprint?: { source: 'osm' | 'photo' | 'satellite'; ref?: string; ring?: [number, number][] };
  front?: string;
  /** Free facts with their own source, kept as written (ring radii of Connaught Place, a wall height range). */
  extent?: Record<string, number | string>;
  references?: { url: string; what: string; licence: string }[];
}

export interface Edit {
  id: string;
  /** Join keys of the landmark the edit is for: the registry id, the Wikidata id or the OSM id. */
  target: { id?: string; wikidata?: string; osm?: string };
  action: 'set' | 'remove';
  set?: EditSet;
  /** The evidence line: what was read, where, and when. */
  why: string;
  by: string;
  source: string;
  date: string;
}

export interface OverridesFile {
  _doc?: string;
  edits: Edit[];
}

export type HeightSource = 'reference' | 'wikidata' | 'osm' | 'osm_levels' | 'none';

/** One landmark of the registry: a file of its own for a hero or a signature, a row of landmarks_markers.json for a marker. */
export interface Entry {
  id: string;
  name: { en: string; hi: string | null };
  ids: { wikidata: string | null; osm: string | null; asi: string | null };
  /** The join of the sources. */
  match: Match;
  sources: string[];
  /** One line: which source ids say this place exists, and how they were joined. */
  evidence: string;
  lat: number;
  lon: number;
  position: { source: 'osm_footprint_centre' | 'osm_node' | 'wikidata' | 'hand'; ref: string; evidence: string; footprint_centre_offset_m?: number };
  footprint: { source: 'osm' | 'photo' | 'satellite'; ref: string; area_m2: number; ring?: [number, number][]; evidence?: string } | null;
  height_m: number | null;
  height_source: HeightSource;
  height_evidence: string;
  era: string | null;
  type: string;
  /** The OSM tag that made it a candidate ("historic=monument"), or "wikidata" for an item with no OSM object. */
  kind: string;
  tier: Tier;
  tier_from: 'override' | 'owner_list' | 'score';
  tier_reason: string;
  score: number;
  hero_later?: boolean;
  block: string | null;
  block_planned?: string;
  district: string | null;
  far: boolean;
  /** Real bearing (degrees clockwise from north) and distance from the block pivot, for a far landmark. */
  bearing_deg?: number;
  distance_m?: number;
  bearing_from?: string;
  area: AreaRef | null;
  flags: string[];
  /** The id of the issue in issues.json, when the entry has one. */
  issue?: string;
  /** "ok": may be placed. "held": never placed until an edit settles its issue. "unplaced": no OSM object to place. */
  place: 'ok' | 'held' | 'unplaced';
  agreement: { osm_to_wikidata_m: number; wikidata: [number, number]; inside_footprint: boolean; ok: boolean } | null;
  /** Present on every place of worship. `combat_arena` is always false. */
  worship?: { religion: string; combat_arena: false; rule: string };
  /** Present on an underground structure: no shell, no ground cut. */
  underground?: { why: string; shell: 'none' };
  station?: { network: string; style: 'underground' | 'elevated' | 'surface' | 'unknown'; style_from: string };
  /** The variant id of harness/design/reference/infrastructure/variant_map.json for this object (a station kit, an underground feature). */
  infrastructure?: { variant: string; line?: string; from: string };
  parts?: string[];
  front?: string;
  extent?: Record<string, number | string>;
  references?: { url: string; what: string; licence: string }[];
  licence_notes: string;
  art: { status: 'stand-in' };
  confidence: { position: 'high' | 'medium' | 'low'; footprint: 'high' | 'medium' | 'low' | 'none'; height: 'high' | 'medium' | 'low' | 'none' };
  edits?: string[];
}

/** An issue of the registry, in the record format of MAP_REPAIR.md "Issue record" (world metres). */
export interface LandmarkIssue {
  id: string;
  rule: 'R-LM-01' | 'R-LM-02';
  block: string | null;
  district: string | null;
  tile: [number, number];
  lat: number;
  lon: number;
  x: number;
  z: number;
  features: string[];
  impact: number;
  confidence: number;
  status: 'open' | 'overridden';
  note: string;
  landmark: string;
  proposals: { action: string; params: Record<string, string | number>; confidence: number; reasoning: string; preview: { x: number; z: number }[] }[];
}

export const RULE_TITLES: Readonly<Record<LandmarkIssue['rule'], string>> = {
  'R-LM-01': 'Landmark sources disagree on the position by more than 50 m',
  'R-LM-02': 'Landmark joined by name and distance, not by id',
};
