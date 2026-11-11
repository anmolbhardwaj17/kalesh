// Rule engine types (ARCH_OPTIONS RE1, MAP_REPAIR.md "Rule engine"): a rule is a module with an id, an area, a detect
// function, an optional repair function and a confidence. Issues and patches use the record shapes of MAP_REPAIR.md
// ("Issue record", "Overrides format"), so the inspector, the repair log and the overrides all read one form.
import type { Box2, P2 } from '../geom.ts';
import type { MapData } from '../osm.ts';

export type PatchAction = 'connect' | 'terminate' | 'remove' | 'set_tag' | 'move_node' | 'set_lanes' | 'set_height' | 'replace_geometry' | 'disable_repair';

export interface Proposal {
  action: PatchAction;
  params: Record<string, string | number | boolean>;
  /** 0 to 1: how sure the rule is that this fix is right. */
  confidence: number;
  /**
   * True when the change is small enough to apply without a person (AR1): a join of a few metres, an exact
   * duplicate, a sliver. Each rule states its own bound.
   */
  lowImpact: boolean;
  reasoning: string;
  /** A polyline in district metres that the inspector draws. */
  preview: P2[];
}

export interface Issue {
  /** Stable: the rule id and the feature ids, for example "R-ROAD-01:way/123:way/456". */
  id: string;
  rule: string;
  district: string;
  x: number;
  z: number;
  lat: number;
  lon: number;
  /** Source ids of the features involved ("way/123", "node/45"). */
  features: string[];
  /** 0 to 1, from the road class (hero status and mission places join later). */
  impact: number;
  /** 0 to 1: how sure the rule is that this is a real fault and not real-world oddness. */
  confidence: number;
  status: 'open' | 'auto_repaired' | 'overridden' | 'explained';
  note: string;
  proposals: Proposal[];
}

export interface RuleContext {
  district: string;
  map: MapData;
  /** The district's download box in metres: ends outside it are cut by the extract, not dangling. */
  box: Box2;
  toGeo(x: number, z: number): { lat: number; lon: number };
  /** Ground height in metres at a point, from the chosen height source; null where there is no data. */
  ground?: (x: number, z: number) => number | null;
}

export interface Rule {
  id: string;
  area: 'roads' | 'bridges' | 'buildings' | 'terrain';
  title: string;
  /** Base confidence of a detection by this rule (single issues may differ). */
  confidence: number;
  detect(ctx: RuleContext): Issue[];
  /** The patch (overrides form) of the issue's best proposal, when the rule can repair it. */
  repair?(issue: Issue): Patch | null;
}

export interface Patch {
  id: string;
  issue: string;
  action: PatchAction;
  target: { ids: string[]; anchor: { lat: number; lon: number }; tolerance_m: number };
  params: Record<string, string | number | boolean>;
  why: string;
  by: string;
  source: string;
  date: string;
}

/** AR1: the confidence a repair needs to be applied without review. */
export const AUTO_CONFIDENCE = 0.8;

const r1 = (v: number) => Math.round(v * 10) / 10;
const r7 = (v: number) => Math.round(v * 1e7) / 1e7;

/** Builds an issue with its geographic position filled in. */
export function issue(ctx: RuleContext, rule: Rule, at: P2, features: string[], impact: number, confidence: number, note: string, proposals: Proposal[]): Issue {
  const g = ctx.toGeo(at.x, at.z);
  return {
    id: `${rule.id}:${features.join(':')}`, rule: rule.id, district: ctx.district, x: r1(at.x), z: r1(at.z), lat: r7(g.lat), lon: r7(g.lon),
    features, impact: Math.round(impact * 100) / 100, confidence, status: 'open', note, proposals,
  };
}

/** The proposal AR1 would apply on its own: the first with confidence 0.8 or more and a low impact. */
export function autoProposal(i: Issue): Proposal | null {
  return i.proposals.find((p) => p.confidence >= AUTO_CONFIDENCE && p.lowImpact) ?? null;
}

/** The default repair of a rule: the override patch of the issue's best proposal. */
export function patchOf(i: Issue, tolerance = 15): Patch | null {
  const p = autoProposal(i) ?? i.proposals[0];
  if (!p) return null;
  return {
    id: `auto_${i.id}`, issue: i.id, action: p.action, target: { ids: i.features.filter((f) => !f.startsWith('node/')), anchor: { lat: i.lat, lon: i.lon }, tolerance_m: tolerance },
    params: p.params, why: p.reasoning, by: 'bake', source: 'rule', date: '',
  };
}
