// Building rules (R-BLDG): footprints that reach into a carriageway, and duplicate footprints.
import { Grid, boxesMeet, overlapShare, segmentRing } from '../geom.ts';
import { classImpact } from '../osm.ts';
import type { Footprint } from '../osm.ts';
import { roadSegments } from './roads.ts';
import type { RoadSegment } from './roads.ts';
import { issue, patchOf } from './types.ts';
import type { Issue, Proposal, Rule, RuleContext } from './types.ts';

/** A footprint must reach this far into the carriageway to count. */
export const OVERLAP_MIN = 0.3;
/** Up to this depth the fix is a sliver: narrow the road by that much (AR1 low impact). */
export const SLIVER = 1.5;

export const buildingOnRoad: Rule = {
  id: 'R-BLDG-01',
  area: 'buildings',
  title: 'Building overlaps a road',
  confidence: 0.8,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    const grid = roadSegments(ctx.map);
    for (const b of ctx.map.buildings) {
      if (b.tags['building'] === 'roof' || b.tags['man_made'] === 'bridge' || Number(b.tags['layer'] ?? 0) > 0) continue;
      const worst = new Map<string, { seg: RoadSegment; d: number }>();
      for (const seg of grid.query(b.box, 8)) {
        const r = seg.road;
        if (r.bridge || r.tunnel || r.layer !== 0 || r.tags['covered'] === 'yes') continue;
        if (!boxesMeet(seg.box, b.box, r.width / 2)) continue;
        const d = segmentRing(seg.a, seg.b, b.ring);
        if (r.width / 2 - d < OVERLAP_MIN) continue;
        const prev = worst.get(r.id);
        if (!prev || d < prev.d) worst.set(r.id, { seg, d });
      }
      for (const [roadId, w] of worst) {
        const r = w.seg.road;
        const depth = Math.round((r.width / 2 - w.d) * 10) / 10;
        const fits = Math.max(2, Math.round((2 * w.d - 0.4) * 10) / 10);
        const proposals: Proposal[] = [];
        if (w.d === 0) {
          proposals.push({ action: 'set_tag', params: { key: 'tunnel', value: 'building_passage', on: roadId }, confidence: 0.45, lowImpact: false, reasoning: 'The centre line runs through the footprint: a passage or a gate, or the footprint is wrong', preview: [w.seg.a, w.seg.b] });
        } else {
          const guessed = r.widthFrom === 'class';
          proposals.push({
            action: 'set_tag', params: { key: 'width', value: String(fits), on: roadId }, confidence: guessed ? 0.85 : 0.6, lowImpact: depth <= SLIVER,
            reasoning: guessed ? `The ${r.width} m width is only the class default; the buildings leave ${fits} m: narrow the road here` : `The tagged width ${r.width} m does not fit between the buildings (${fits} m free)`,
            preview: [w.seg.a, w.seg.b],
          });
          proposals.push({ action: 'replace_geometry', params: { trim: b.id, by_m: depth }, confidence: 0.3, lowImpact: false, reasoning: 'Or the footprint is drawn too far out: pull its edge back', preview: b.ring });
        }
        out.push(issue(ctx, buildingOnRoad, b.centre, [b.id, roadId], classImpact(r.cls), w.d === 0 ? 0.7 : 0.8, w.d === 0 ? 'the road centre line enters the footprint' : `${depth} m into a ${r.width} m carriageway (${r.widthFrom})`, proposals));
      }
    }
    return out;
  },
  repair: (i) => patchOf(i),
};

/** Both shares at or above this: the same building drawn twice. */
export const EXACT_DUPLICATE = 0.85;
/** The smaller footprint's share inside the larger from which the pair counts as overlapping. */
export const INSIDE_SHARE = 0.6;

export interface DuplicatePair {
  a: Footprint;
  b: Footprint;
  /** Share of the smaller footprint inside the larger, and of the larger inside the smaller. */
  smallInLarge: number;
  largeInSmall: number;
}

/** Pairs of footprints in one set that cover each other (the smaller at least INSIDE_SHARE inside the larger). */
export function duplicatePairs(footprints: readonly Footprint[], minShare = INSIDE_SHARE): DuplicatePair[] {
  const grid = new Grid<Footprint>(40);
  for (const f of footprints) grid.insert(f.box, f);
  const out: DuplicatePair[] = [];
  for (const f of footprints) {
    for (const g of grid.query(f.box)) {
      if (g.id <= f.id || !boxesMeet(f.box, g.box)) continue;
      const [small, large] = f.area <= g.area ? [f, g] : [g, f];
      const smallInLarge = overlapShare(small.ring, large.ring);
      if (smallInLarge < minShare) continue;
      out.push({ a: f, b: g, smallInLarge, largeInSmall: overlapShare(large.ring, small.ring) });
    }
  }
  return out;
}

export const duplicateFootprint: Rule = {
  id: 'R-BLDG-03',
  area: 'buildings',
  title: 'Duplicate or nested footprint',
  confidence: 0.8,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const p of duplicatePairs(ctx.map.buildings)) {
      const exact = p.smallInLarge >= EXACT_DUPLICATE && p.largeInSmall >= EXACT_DUPLICATE;
      const [small, large] = p.a.area <= p.b.area ? [p.a, p.b] : [p.b, p.a];
      const drop = exact ? (Object.keys(p.a.tags).length <= Object.keys(p.b.tags).length ? p.a : p.b) : small;
      const proposals: Proposal[] = [
        {
          action: 'remove', params: { drop: drop.id }, confidence: exact ? 0.9 : 0.5, lowImpact: exact,
          reasoning: exact ? 'The same footprint twice: keep the one with more tags' : `${small.id} lies ${Math.round(p.smallInLarge * 100)} percent inside ${large.id}: a part drawn as a building, or a courtyard block`,
          preview: drop.ring,
        },
      ];
      out.push(issue(ctx, duplicateFootprint, small.centre, [p.a.id, p.b.id], 0.2, exact ? 0.9 : 0.6, exact ? 'exact duplicate' : 'nested footprint', proposals));
    }
    return out;
  },
  repair: (i) => patchOf(i),
};
