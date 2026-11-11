// Rule engine types of the production bake (ARCH_OPTIONS RE1, MAP_REPAIR.md "Rule engine", "Issue record",
// "Overrides format"). A rule is a module with an id, an area, a detect function, an optional repair (the patch of a
// proposal, in the overrides form) and a confidence. Rules read the block graph of tools/bake/graph/ through a
// RuleContext (tools/bake/rules/context.ts); they never change it: tools/bake/repair/ applies patches. The Phase 0
// census rules, which read the raw OSM map model, are kept in tools/bake/rules/census/ until the inspector reads the
// production issues.json (P1-011). Pure.
import type { P2 } from '../geom.ts';
import type { Tags } from '../osm.ts';
import type { HeroSpec } from '../roads/hero.ts';

export type PatchAction = 'connect' | 'terminate' | 'remove' | 'set_tag' | 'move_node' | 'set_lanes' | 'set_height' | 'replace_geometry' | 'disable_repair';

/**
 * What a proposal changes, in the terms of MAP_REPAIR.md "Auto-repair bounds". tools/bake/repair/bounds.ts turns it
 * into "low impact" or not; a rule never decides that on its own.
 */
export type Measure =
  | { kind: 'join'; m: number }
  | { kind: 'bridge_layer_tag' }
  | { kind: 'building_into_road'; m: number; classDefault: boolean; fits: boolean }
  | { kind: 'duplicate_footprint'; exact: boolean }
  | { kind: 'height_outlier'; m: number }
  | { kind: 'carriageway_shift'; m: number }
  | { kind: 'slip_redraw'; m: number }
  | { kind: 'lane_count'; cls: string }
  | { kind: 'one_way_no_pair' }
  | { kind: 'other' };

export type Params = Record<string, string | number | boolean>;

export interface Proposal {
  action: PatchAction;
  params: Params;
  /** 0 to 1: how sure the rule is that this fix is right. */
  confidence: number;
  /** Set by the bounds (tools/bake/repair/bounds.ts) from `measure`: small enough to apply without a person. */
  lowImpact: boolean;
  measure: Measure;
  reasoning: string;
  /** A polyline in block metres that the inspector draws. */
  preview: P2[];
}

export type IssueStatus = 'open' | 'auto_repaired' | 'overridden' | 'explained';

export interface Issue {
  /** Stable: the rule id and the feature ids, for example "R-ROAD-01:w123.0:w456.2:n789". */
  id: string;
  rule: string;
  block: string;
  /** The focus district, if any. */
  district: string | null;
  /** World tile of the 250 m grid. */
  tile: [number, number];
  lat: number;
  lon: number;
  x: number;
  z: number;
  /** Stable ids of the features involved: graph edges ("w<way>.<part>"), nodes ("n<id>"), footprints and lines ("way/<id>", "overture/<id>"). */
  features: string[];
  /** 0 to 1, from the road class, hero status and distance to mission places. */
  impact: number;
  /** 0 to 1: how sure the rule is that this is a real fault and not real-world oddness. */
  confidence: number;
  status: IssueStatus;
  note: string;
  /** The hero road an involved edge belongs to: nothing on it is ever repaired automatically. */
  hero: string | null;
  proposals: Proposal[];
  /** A queued issue whose top proposal is in the baked map until a person picks. */
  provisional?: boolean;
}

export interface Patch {
  id: string;
  issue: string;
  action: PatchAction;
  target: { ids: string[]; anchor: { lat: number; lon: number }; tolerance_m: number };
  params: Params;
  why: string;
  by: string;
  source: string;
  date: string;
}

/** Decisions written on features by repairs ("this end is a dead end", "take the smoothed profile"): feature id, then key. */
export type Marks = Record<string, Params>;

export interface HeroListEntry {
  id: string;
  name: string;
  /** OSM street names that belong to this hero road. */
  osmNames: string[];
  /** OSM way ids, for a road with no name (the India Gate hexagon). */
  osmWays?: number[];
}

/** What the driver hands the rules besides the graph. Every field but the first two is optional. */
export interface RuleEnv {
  toGeo(x: number, z: number): { lat: number; lon: number };
  /** The world tile of a point given in block metres. */
  tile(x: number, z: number): [number, number];
  /** The focus district that holds a point, or null. */
  district?(x: number, z: number): string | null;
  /** The bake's ground model (smoothed) in metres at a point; null where there is no data. */
  ground?(x: number, z: number): number | null;
  /** The raw height source at a point (rule R-TERR-03 compares it with the road profile). */
  heightSource?(x: number, z: number): number | null;
  heroSpecs?: readonly HeroSpec[];
  heroList?: readonly HeroListEntry[];
  /** Mission places in block metres: an issue near one weighs more. */
  missionPlaces?: readonly P2[];
  /** OSM tags of graph nodes that have any (noexit, barrier), by graph node id. */
  nodeTags?: ReadonlyMap<string, Tags>;
  /** Foot ways that are not bridges, and platforms, as lines in block metres: where a foot over bridge may land. */
  walkways?: readonly (readonly P2[])[];
  /** 'stage': the outline is a stage inside its block, roads go on in a later stage; 'map': the true map edge. */
  mapEdge?: 'stage' | 'map';
  /** Map edge node id to the authored connector that takes the road over. */
  connectors?: ReadonlyMap<string, string>;
}

export type RuleArea = 'roads' | 'bridges' | 'junctions' | 'lanes' | 'footpaths' | 'buildings' | 'rail' | 'fob' | 'stitch' | 'hero' | 'terrain';

/** AR1: the confidence a repair needs to be applied without review. */
export const AUTO_CONFIDENCE = 0.8;

/** Ids of graph nodes ("n123", "m45.0", "x..."): not targets of an override patch. */
export const isNodeId = (id: string): boolean => /^(n\d|m\d|x)/.test(id);

/** The proposal AR1 could apply on its own: the first with confidence 0.8 or more and a low impact. */
export function autoProposal(i: Pick<Issue, 'proposals'>): Proposal | null {
  return i.proposals.find((p) => p.confidence >= AUTO_CONFIDENCE && p.lowImpact) ?? null;
}

/** The top proposal: the highest confidence, the first on a tie (the bake applies it as provisional). */
export function topProposal(i: Pick<Issue, 'proposals'>): Proposal | null {
  let best: Proposal | null = null;
  for (const p of i.proposals) if (!best || p.confidence > best.confidence) best = p;
  return best;
}

/** The override patch of a proposal (MAP_REPAIR.md "Overrides format"). */
export function patchOf(i: Issue, p: Proposal, by = 'bake', tolerance = 15): Patch {
  return {
    id: `auto_${i.id}`, issue: i.id, action: p.action, target: { ids: i.features.filter((f) => !isNodeId(f)), anchor: { lat: i.lat, lon: i.lon }, tolerance_m: tolerance },
    params: p.params, why: p.reasoning, by, source: 'rule', date: '',
  };
}
