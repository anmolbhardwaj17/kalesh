// Terrain rule (R-TERR): ground height outliers along a road. The height source is sampled along each ground road;
// a sample far from the running median of its neighbours, or a step too steep for a road, is an outlier (a roof or
// a tree left in the height data, or a real cutting the road tags do not say).
import { resample } from '../geom.ts';
import type { P2 } from '../geom.ts';
import { classImpact } from '../osm.ts';
import { issue, patchOf } from './types.ts';
import type { Issue, Rule, RuleContext } from './types.ts';

export const PROFILE_STEP = 15;
/** A sample this far (m) from the running median is an outlier. */
export const OUTLIER_M = 1.5;
/** Above this grade (percent) between two samples the step is an outlier. */
export const MAX_GRADE = 10;
/** Outliers up to this size are smoothed without review (AR1 low impact). */
export const SMOOTH_M = 3;

const median = (v: number[]): number => {
  const s = v.slice().sort((a, b) => a - b);
  return s.length === 0 ? 0 : (s[Math.floor(s.length / 2)] as number);
};

export interface ProfileCheck {
  samples: number;
  outliers: number;
  maxDeviation: number;
  maxGradePct: number;
  /** Index of the worst sample. */
  worst: number;
}

/** Outliers of a height profile sampled every `step` metres. */
export function checkProfile(h: readonly number[], step = PROFILE_STEP): ProfileCheck {
  const res: ProfileCheck = { samples: h.length, outliers: 0, maxDeviation: 0, maxGradePct: 0, worst: 0 };
  for (let i = 0; i < h.length; i++) {
    const win: number[] = [];
    for (let k = Math.max(0, i - 3); k <= Math.min(h.length - 1, i + 3); k++) win.push(h[k] as number);
    const dev = Math.abs((h[i] as number) - median(win));
    const grade = i > 0 ? (Math.abs((h[i] as number) - (h[i - 1] as number)) / step) * 100 : 0;
    if (dev > OUTLIER_M || grade > MAX_GRADE) res.outliers++;
    if (dev > res.maxDeviation) {
      res.maxDeviation = dev;
      res.worst = i;
    }
    if (grade > res.maxGradePct) res.maxGradePct = grade;
  }
  res.maxDeviation = Math.round(res.maxDeviation * 100) / 100;
  res.maxGradePct = Math.round(res.maxGradePct * 10) / 10;
  return res;
}

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
