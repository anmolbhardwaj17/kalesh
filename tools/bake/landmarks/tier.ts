// Tier of a landmark (P2-005, DELHI_WORLD.md 1 "Tiers" and 10 step 3): a score proposes hero, signature or marker;
// the owner list wins over the score, and an edit in landmarks.overrides.json wins over both. Pure.
import type { Tier } from './types.ts';

/** What the score reads. */
export interface ScoreInput {
  sitelinks: number;
  asi: string | null;
  footprintM2: number;
  /** An OSM object stands behind it. Fame alone is not a building, and neither is an ASI id on a Wikidata point. */
  hasObject: boolean;
  /** Metres from the footprint (or the point) to the nearest arterial centre line, null when none is near. */
  arterialM: number | null;
  /** The same for the nearest hero road. */
  heroRoadM: number | null;
  /** A metro or rail station. */
  station: boolean;
}

export const SCORE = {
  /** Points per Wikidata sitelink, up to the cap. */
  perSitelink: 2,
  sitelinkCap: 40,
  asi: 30,
  /** A footprint of this size or more is a site the player notices. */
  bigFootprintM2: 5000,
  bigFootprint: 10,
  /** "Seen from": the footprint lies within this distance of the road's centre line. */
  seenM: 60,
  arterial: 10,
  heroRoad: 15,
  station: 20,
  /** At or above this a landmark with an object behind it is proposed as a signature. */
  signatureAt: 45,
} as const;

export interface Proposal {
  score: number;
  tier: Tier;
  reason: string;
}

/** The automatic proposal. It never proposes a hero: heroes are named by the owner. */
export function proposeTier(c: ScoreInput): Proposal {
  let score = Math.min(SCORE.sitelinkCap, c.sitelinks * SCORE.perSitelink);
  const why: string[] = [];
  if (c.sitelinks > 0) why.push(`${c.sitelinks} Wikidata sitelinks`);
  if (c.asi) {
    score += SCORE.asi;
    why.push(`ASI ${c.asi}`);
  }
  if (c.footprintM2 >= SCORE.bigFootprintM2) {
    score += SCORE.bigFootprint;
    why.push(`footprint ${Math.round(c.footprintM2)} m2`);
  }
  if (c.heroRoadM !== null && c.heroRoadM <= SCORE.seenM) {
    score += SCORE.heroRoad;
    why.push(`${Math.round(c.heroRoadM)} m from a hero road`);
  } else if (c.arterialM !== null && c.arterialM <= SCORE.seenM) {
    score += SCORE.arterial;
    why.push(`${Math.round(c.arterialM)} m from an arterial`);
  }
  if (c.station) score += SCORE.station;
  if (!c.hasObject) return { score, tier: 'marker', reason: [...why, 'Wikidata only: no OSM object to build from, so it stays a marker until one is found or drawn'].join('; ') };
  if (c.station) return { score, tier: 'signature', reason: ['metro or rail station: signature kit per station style', ...why].join('; ') };
  if (score >= SCORE.signatureAt) return { score, tier: 'signature', reason: why.join('; ') };
  return { score, tier: 'marker', reason: why.join('; ') || 'named place with a landmark tag' };
}

export interface Resolved {
  tier: Tier;
  from: 'override' | 'owner_list' | 'score';
  reason: string;
}

/** The final tier: an edit wins over the owner list, the owner list wins over the score. */
export function resolveTier(p: Proposal, list: { tier: Tier; said: string } | null, edit: { tier: Tier; why: string; id: string } | null): Resolved {
  const scored = `score ${p.score} proposed ${p.tier}${p.reason ? ` (${p.reason})` : ''}`;
  if (edit) return { tier: edit.tier, from: 'override', reason: `edit ${edit.id}: ${edit.why}; ${list ? `owner list said ${list.tier}; ` : ''}${scored}` };
  if (list) return { tier: list.tier, from: 'owner_list', reason: `${list.said}; ${scored}` };
  return { tier: p.tier, from: 'score', reason: scored };
}
