// Terrain rules (R-TERR) on the block graph and the height data. 01: the ground model stands above the road inside
// its own corridor (the corridor is cut). 02: a ground road lies in water with no bridge or tunnel tag (it would
// float or drown). 03: the height source steps along a ground road in a way no road can (a roof or a tree left in the
// data, or a real cutting the tags do not say): the smoothed profile is taken, up to 3 m on its own. Pure.
import { boxOf, pointInRing, Grid } from '../geom.ts';
import type { P2 } from '../geom.ts';
import type { GraphEdge } from '../graph/build.ts';
import type { AreaFeature } from '../graph/features.ts';
import { atGrade, leftOf } from './context.ts';
import type { Rule, RuleContext } from './context.ts';
import { patchOf } from './types.ts';
import type { Issue } from './types.ts';

export const PROFILE_STEP = 15;
/** A sample this far (m) from the running median is an outlier. */
export const OUTLIER_M = 1.5;
/** Above this grade (percent) between two samples the step is an outlier. */
export const MAX_GRADE = 10;

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

const onGround = (e: GraphEdge): boolean => e.pieces.every((p) => atGrade(p));

/** The ground may stand this far (m) above the centre line at the carriageway edge before the corridor needs a cut. */
export const CORRIDOR_RISE = 0.5;

export const groundAboveRoad: Rule = {
  id: 'R-TERR-01',
  area: 'terrain',
  title: 'Ground above the road inside its corridor',
  confidence: 0.85,
  detect(ctx: RuleContext): Issue[] {
    const ground = ctx.env.ground;
    if (!ground) return [];
    const out: Issue[] = [];
    for (const e of ctx.graph.edges) {
      if (e.len < 30 || !onGround(e) || ctx.mark(e.id, 'corridor') === 'cut') continue;
      let worst = 0;
      let at: P2 | null = null;
      let n = 0;
      for (const s of ctx.samples(e, 20, 5)) {
        const h0 = ground(s.x, s.z);
        if (h0 === null) continue;
        const nrm = leftOf(s.tx, s.tz);
        const k = e.road.width / 2 + 1;
        for (const side of [1, -1]) {
          const h = ground(s.x + nrm.x * k * side, s.z + nrm.z * k * side);
          if (h === null || h - h0 <= CORRIDOR_RISE) continue;
          n++;
          if (h - h0 > worst) {
            worst = h - h0;
            at = { x: s.x, z: s.z };
          }
        }
      }
      if (!at) continue;
      const rise = Math.round(worst * 100) / 100;
      out.push(ctx.issue(groundAboveRoad, at, [e.id], [e], 0.85, `the ground stands up to ${rise} m above the centre line at the carriageway edge (${n} places)`, [
        ctx.proposal('set_height', { mode: 'cut_corridor', on: e.id, max_m: rise }, 0.85, { kind: 'height_outlier', m: rise }, `Beside ${e.id} the ground model rises ${rise} m above the road inside its own corridor: cut the corridor level with the road (the ground fit does it; over 3 m a person looks first)`, e.pts),
      ]));
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};

/** A ground road must lie this far (m) in water before it counts. */
export const WET_MIN_M = 8;

export const roadInWater: Rule = {
  id: 'R-TERR-02',
  area: 'terrain',
  title: 'Ground road in water with no structure',
  confidence: 0.75,
  detect(ctx: RuleContext): Issue[] {
    const water = ctx.graph.features.water;
    if (!water.length) return [];
    const grid = new Grid<AreaFeature>(100);
    for (const w of water) grid.insert(boxOf(w.rings.flat()), w);
    // even-odd over the rings: a hole (an island) is dry
    const inside = (w: AreaFeature, p: P2): boolean => w.rings.reduce((n, r) => n + (pointInRing(p, r) ? 1 : 0), 0) % 2 === 1;
    const wet = new Map<string, { e: GraphEdge; w: AreaFeature; m: number; at: P2 }>();
    for (const s of ctx.segList) {
      if (!atGrade(s.lv)) continue;
      const len = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);
      const n = Math.max(1, Math.round(len / 4));
      for (let k = 0; k < n; k++) {
        const p = { x: s.a.x + ((s.b.x - s.a.x) * (k + 0.5)) / n, z: s.a.z + ((s.b.z - s.a.z) * (k + 0.5)) / n };
        for (const w of grid.query({ minX: p.x, minZ: p.z, maxX: p.x, maxZ: p.z })) {
          if (!inside(w, p)) continue;
          const key = `${s.edge.id}|${w.id}`;
          const prev = wet.get(key);
          if (prev) prev.m += len / n;
          else wet.set(key, { e: s.edge, w, m: len / n, at: p });
        }
      }
    }
    const out: Issue[] = [];
    for (const v of wet.values()) {
      if (v.m < WET_MIN_M) continue;
      const m = Math.round(v.m);
      out.push(ctx.issue(roadInWater, v.at, [v.e.id, v.w.id], [v.e], 0.75, `${m} m of the road lie in ${v.w.name || v.w.kind}`, [
        ctx.proposal('set_tag', { key: 'bridge', value: true, on: v.e.id, layer: 1, over: v.w.id }, 0.6, { kind: 'other' }, `${m} m of ${v.e.id} lie in the water of ${v.w.name || v.w.id} with no bridge or tunnel tag: it is a bridge, the deck is set by its clearance above the water`, v.e.pts),
        ctx.proposal('set_tag', { key: 'bake:causeway', value: true, on: v.e.id, over: v.w.id }, 0.4, { kind: 'other' }, 'Or a causeway on fill, or the water outline is drawn too wide', [v.at]),
      ]));
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};

export const groundOutlier: Rule = {
  id: 'R-TERR-03',
  area: 'terrain',
  title: 'Height source outlier along a road',
  confidence: 0.8,
  detect(ctx: RuleContext): Issue[] {
    const source = ctx.env.heightSource ?? ctx.env.ground;
    if (!source) return [];
    const out: Issue[] = [];
    for (const e of ctx.graph.edges) {
      if (e.len < 4 * PROFILE_STEP || !onGround(e) || ctx.mark(e.id, 'profile') === 'smoothed') continue;
      const h: number[] = [];
      const used: P2[] = [];
      for (const s of ctx.samples(e, PROFILE_STEP)) {
        const v = source(s.x, s.z);
        if (v !== null && Number.isFinite(v)) {
          h.push(v);
          used.push({ x: s.x, z: s.z });
        }
      }
      if (h.length < 4) continue;
      const c = checkProfile(h, e.len / Math.max(1, h.length - 1));
      if (c.outliers === 0) continue;
      out.push(ctx.issue(groundOutlier, used[c.worst] as P2, [e.id], [e], 0.8, `${c.outliers} of ${c.samples} samples, worst ${c.maxDeviation} m off the median, steepest ${c.maxGradePct} percent`, [
        ctx.proposal('set_height', { mode: 'smooth_profile', on: e.id, max_m: c.maxDeviation }, 0.85, { kind: 'height_outlier', m: c.maxDeviation }, `A ground road cannot step like this (${c.maxDeviation} m off its neighbours): take the smoothed profile for ${e.id} (the elevation solver does it from the grade limits)`, used),
      ]));
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};
