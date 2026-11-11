// Terrain rule (R-TERR): ground height outliers along a road. The height source is sampled along each ground road;
// a sample far from the running median of its neighbours, or a step too steep for a road, is an outlier (a roof or
// a tree left in the height data, or a real cutting the road tags do not say).
import { resample } from '../../geom.ts';
import type { P2 } from '../../geom.ts';
import { classImpact } from '../../osm.ts';
import { issue, patchOf } from './types.ts';
import type { Issue, Rule, RuleContext } from './types.ts';

import { checkProfile, MAX_GRADE, OUTLIER_M, PROFILE_STEP } from '../terrain.ts';
import type { ProfileCheck } from '../terrain.ts';

// The profile measure moved to the production rule (tools/bake/rules/terrain.ts); the census keeps its names.
export { checkProfile, MAX_GRADE, OUTLIER_M, PROFILE_STEP };
export type { ProfileCheck };
/** Outliers up to this size are smoothed without review (AR1 low impact). */
export const SMOOTH_M = 3;

export const groundOutlier: Rule = {
  id: 'R-TERR-03',
  area: 'terrain',
  title: 'Ground height outlier along a road',
  confidence: 0.8,
  detect(ctx: RuleContext): Issue[] {
    const ground = ctx.ground;
    if (!ground) return [];
    const out: Issue[] = [];
    for (const road of ctx.map.roads) {
      if (road.bridge || road.tunnel || road.layer !== 0 || road.length < 4 * PROFILE_STEP) continue;
      const pts = resample(road.pts, PROFILE_STEP);
      const h: number[] = [];
      const used: P2[] = [];
      for (const p of pts) {
        const v = ground(p.x, p.z);
        if (v !== null && Number.isFinite(v)) {
          h.push(v);
          used.push(p);
        }
      }
      if (h.length < 4) continue;
      const c = checkProfile(h);
      if (c.outliers === 0) continue;
      out.push(issue(ctx, groundOutlier, used[c.worst] as P2, [road.id], classImpact(road.cls), 0.8, `${c.outliers} of ${c.samples} samples, worst ${c.maxDeviation} m off the median, steepest ${c.maxGradePct} percent`, [
        { action: 'set_height', params: { mode: 'smooth_profile', max_m: c.maxDeviation }, confidence: 0.85, lowImpact: c.maxDeviation <= SMOOTH_M, reasoning: 'A ground road cannot step like this: take the smoothed profile (the elevation solver does it from the grade limits)', preview: used },
      ]));
    }
    return out;
  },
  repair: (i) => patchOf(i),
};
