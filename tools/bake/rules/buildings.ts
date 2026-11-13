// Building rules (R-BLDG) on the merged footprints of the block graph: footprints that reach into a carriageway or a
// footpath (an old city lane narrows to what its buildings leave, the gali rule; on any other road, and where a
// building reaches further in than its neighbours, the building gives way: tools/bake/repair/clear.ts), bad polygons (self-crossing, tiny, slivers), duplicates and nested
// footprints, and heights that cannot be right. Missing heights are not issues: tools/bake/repair/ fills them from
// the levels and counts them. Pure.
import { boxesMeet, overlapShare, pointInRing, pointSegment, segmentCrossing, segmentRing } from '../geom.ts';
import type { P2 } from '../geom.ts';
import type { GraphEdge } from '../graph/build.ts';
import { GALI_MIN_LANE_M, KERB_WIDTH } from '../roads/model.ts';
import { GALI_CLASSES } from '../roads/street.ts';
import { atGrade } from './context.ts';
import type { Fp, Rule, RuleContext, Seg } from './context.ts';
import { patchOf } from './types.ts';
import type { Issue, Params, Proposal } from './types.ts';

/** A footprint must reach this far into the carriageway to count. */
export const OVERLAP_MIN = 0.3;
/** A carriageway is never narrowed below this (m) on its own. */
export const MIN_WIDTH = 2;
/** Metres per floor when a height comes from a levels tag. */
export const FLOOR_M = 3.2;

const r1 = (v: number): number => Math.round(v * 10) / 10;
/** The carriageway width before any repair narrowed it. */
export const widthWas = (ctx: RuleContext, e: GraphEdge): number => Number(ctx.mark(e.id, 'width_was') ?? e.road.width);

/** The narrowest a gali is made (m): the lane model's limit for its one shared lane. */
export const GALI_MIN_WIDTH = GALI_MIN_LANE_M;
/** Room a gali keeps on each side between its lane and a wall (m): its kerb row and a hand's width. */
export const GALI_SIDE_M = KERB_WIDTH + 0.15;
/** A gali is as wide as the buildings leave along this share of its length; the few that reach further in give way. */
export const GALI_LENGTH_SHARE = 0.75;
const GALI_STEP_M = 4;

/** A road gives way only when walls stand in its default width along at least this share of its length. */
export const HEMMED_SHARE = 0.4;
/** A footpath that keeps less than this (m) between the kerb and the walls is left out on that side. */
export const FOOTPATH_MIN_M = 1;

/** Distance from a point to a footprint outline and the nearest point of it; 0 inside it. */
function pointRing(p: P2, ring: readonly P2[]): { d: number; x: number; z: number } {
  if (pointInRing(p, ring)) return { d: 0, x: p.x, z: p.z };
  let best = { d: Infinity, x: p.x, z: p.z };
  for (let i = 0; i < ring.length; i++) {
    const c = pointSegment(p, ring[i] as P2, ring[(i + 1) % ring.length] as P2);
    if (c.d < best.d) best = { d: c.d, x: c.x, z: c.z };
  }
  return best;
}

/** May this road give way to the buildings beside it? A lane of a gali class whose width is only the class default. */
export function galiEligible(ctx: RuleContext, e: GraphEdge): boolean {
  const r = e.road;
  return GALI_CLASSES.has(r.cls) && !r.link && r.widthFrom === 'lanes' && r.lanesFrom === 'class' && !(ctx.heroOf(e) && ctx.heroHasSpec(ctx.heroOf(e) as string));
}

/** What the walls leave a road: the carriageway width and the footpath on each side that fit between them. */
export interface RoadFit {
  width: number;
  left: number;
  right: number;
}

/** The value that fits along GALI_LENGTH_SHARE of the samples that have a wall in reach, or null when too few have one. */
function fitOf(free: readonly number[], samples: number): number | null {
  if (free.length < 2 || free.length < samples * HEMMED_SHARE) return null;
  const sorted = free.slice().sort((p, q) => q - p);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * GALI_LENGTH_SHARE) - 1)] as number;
}

/**
 * The room the buildings leave a road (P1-030). Sampled every few metres along the edge: the gap to the nearest wall
 * on each side. The gali rule: a lane of a gali class with a class default width is as wide as the walls leave along
 * GALI_LENGTH_SHARE of the stretch that has walls in its default width (walls along at least HEMMED_SHARE of the
 * length, else the width stays and the odd building gives way), never under GALI_MIN_WIDTH. A class default footpath
 * gives way the same way on its side, down to FOOTPATH_MIN_M, under that it is left out. A width or footpath a
 * repair fitted before stays as it is.
 */
export function roadFit(ctx: RuleContext, e: GraphEdge): RoadFit {
  const cached = ctx.cache.get(`fit:${e.id}`) as RoadFit | undefined;
  if (cached) return cached;
  const r = e.road;
  const fit: RoadFit = { width: r.width, left: r.footpath.left, right: r.footpath.right };
  const frozen = ctx.heroOf(e) !== null && ctx.heroHasSpec(ctx.heroOf(e) as string);
  const lane = galiEligible(ctx, e) && ctx.mark(e.id, 'width_from') !== 'buildings';
  const foot = (side: 'left' | 'right'): boolean => !frozen && r.footpathFrom === 'class' && r.footpath[side] > 0 && ctx.mark(e.id, `footpath_fit_${side}`) === undefined && ctx.mark(e.id, 'footpath_from') !== 'spec';
  const sides = { left: foot('left'), right: foot('right') };
  if (lane || sides.left || sides.right) {
    const half = r.width / 2;
    const reach = half + Math.max(GALI_SIDE_M, KERB_WIDTH + Math.max(r.footpath.left, r.footpath.right) + 0.15);
    const laneFree: number[] = [];
    const footFree = { left: [] as number[], right: [] as number[] };
    let n = 0;
    for (const s of ctx.samples(e, GALI_STEP_M, Math.min(2, e.len / 4))) {
      if (!atGrade(ctx.levelAt(e, s.s))) continue;
      n++;
      const d = { left: reach, right: reach };
      for (const b of ctx.fps.query({ minX: s.x, minZ: s.z, maxX: s.x, maxZ: s.z }, reach)) {
        if (b.f.tags['building'] === 'roof' || s.x < b.box.minX - reach || s.x > b.box.maxX + reach || s.z < b.box.minZ - reach || s.z > b.box.maxZ + reach) continue;
        const c = pointRing(s, b.f.ring);
        if (c.d >= reach) continue;
        // the left of the direction of travel (x east, z south): the cross product is negative there
        const side = s.tx * (c.z - s.z) - s.tz * (c.x - s.x);
        if (c.d === 0 || side <= 0) d.left = Math.min(d.left, c.d);
        if (c.d === 0 || side >= 0) d.right = Math.min(d.right, c.d);
      }
      const near = Math.min(d.left, d.right);
      if (near < half + GALI_SIDE_M) laneFree.push(2 * (near - GALI_SIDE_M));
      for (const side of ['left', 'right'] as const) if (d[side] < half + KERB_WIDTH + r.footpath[side] + 0.15) footFree[side].push(d[side] - half - KERB_WIDTH - 0.15);
    }
    if (lane) {
      const w = fitOf(laneFree, n);
      if (w !== null) fit.width = Math.min(r.width, Math.max(GALI_MIN_WIDTH, Math.floor(w * 10) / 10));
    }
    for (const side of ['left', 'right'] as const) {
      if (!sides[side]) continue;
      const w = fitOf(footFree[side], n);
      if (w === null) continue;
      const v = Math.floor(w * 10) / 10;
      fit[side] = v >= FOOTPATH_MIN_M ? Math.min(r.footpath[side], v) : 0;
    }
  }
  ctx.cache.set(`fit:${e.id}`, fit);
  return fit;
}

export const buildingOnRoad: Rule = {
  id: 'R-BLDG-01',
  area: 'buildings',
  title: 'Building overlaps a road',
  confidence: 0.8,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const b of ctx.footprints) {
      if (b.f.tags['building'] === 'roof') continue;
      // a footprint that gives way already (cut or moved once the road mesh is built) is settled
      if (ctx.mark(b.f.id, 'gives_way') !== undefined) continue;
      const worst = new Map<GraphEdge, { seg: Seg; d: number; reach: number; foot: number; side: 'left' | 'right' }>();
      for (const seg of ctx.segs.query(b.box, 12)) {
        const r = seg.edge.road;
        if (!atGrade(seg.lv)) continue;
        // the side of the road the footprint stands on decides which footpath it can be on
        const left = (seg.b.x - seg.a.x) * (b.centre.z - seg.a.z) - (seg.b.z - seg.a.z) * (b.centre.x - seg.a.x) < 0;
        const foot = left ? r.footpath.left : r.footpath.right;
        const reach = r.width / 2 + (foot > 0 ? KERB_WIDTH + foot : 0);
        if (Math.min(seg.a.x, seg.b.x) - reach > b.box.maxX || Math.max(seg.a.x, seg.b.x) + reach < b.box.minX || Math.min(seg.a.z, seg.b.z) - reach > b.box.maxZ || Math.max(seg.a.z, seg.b.z) + reach < b.box.minZ) continue;
        const d = segmentRing(seg.a, seg.b, b.f.ring);
        if (reach - d < OVERLAP_MIN) continue;
        const prev = worst.get(seg.edge);
        if (!prev || reach - d > prev.reach - prev.d) worst.set(seg.edge, { seg, d, reach, foot, side: left ? 'left' : 'right' });
      }
      for (const [e, w] of worst) {
        const r = e.road;
        const half = r.width / 2;
        const onFootpath = w.d >= half;
        const depth = r1(onFootpath ? w.reach - w.d : widthWas(ctx, e) / 2 - w.d);
        const proposals: Proposal[] = [];
        const fit = roadFit(ctx, e);
        const named = b.f.source === 'osm' && (b.f.tags['name'] !== undefined || b.f.area >= 1000);
        if (!onFootpath && fit.width < r.width - 0.05 && 2 * (w.d - GALI_SIDE_M) >= fit.width) {
          proposals.push(ctx.proposal('set_tag', { key: 'width', value: fit.width, on: e.id }, 0.85, { kind: 'gali_width', m: depth },
            `The ${r.width} m width of ${e.id} is only the class default; the buildings leave ${fit.width} m along most of it: an old city lane, the road narrows and the building stays`, [w.seg.a, w.seg.b]));
        } else if (onFootpath && fit[w.side] < w.foot - 0.05 && w.d - half - KERB_WIDTH - 0.15 >= fit[w.side]) {
          proposals.push(ctx.proposal('set_tag', { key: `footpath:${w.side}`, value: fit[w.side], on: e.id, from: 'buildings' }, 0.85, { kind: 'gali_width', m: depth },
            `The ${w.foot} m footpath on the ${w.side} of ${e.id} is only the class default; the buildings leave ${fit[w.side] > 0 ? `${fit[w.side]} m` : 'no room for one'} along most of it: the footpath gives way and the building stays`, [w.seg.a, w.seg.b]));
        } else {
          const how = w.d === 0
            ? named ? 'The road runs through the building (a passage or a gate): the road stays and the footprint is opened along it' : 'The road centre line runs through the footprint: the road stays, the footprint is cut in two around it'
            : onFootpath ? `The building reaches ${depth} m into the footpath of ${e.id}: the footpath stays` : `The building reaches ${depth} m into the carriageway of ${e.id}${galiEligible(ctx, e) ? ', further than the buildings beside it' : ''}: the road stays`;
          // the road still takes the width (or footpath) the other walls leave it, also when this building is the first to be seen
          const fitted: Params = !onFootpath && fit.width < r.width - 0.05 ? { road_width: fit.width } : onFootpath && fit[w.side] < w.foot - 0.05 ? { foot_side: w.side, foot_width: fit[w.side] } : {};
          proposals.push(ctx.proposal('replace_geometry', { op: 'give_way', on: b.f.id, road: e.id, by_m: depth, ...fitted }, 0.85, { kind: 'building_gives_way', m: depth },
            `${how}. The building gives way once the road mesh is built: moved back when the ground behind it is free, else its outline is cut to the road's edge, and a scrap that is left is dropped`, b.f.ring));
        }
        const what = w.d === 0 ? 'the road centre line enters the footprint' : onFootpath ? `${depth} m into the ${w.foot} m footpath` : `${depth} m into a ${r.width} m carriageway (${r.widthFrom === 'tag' ? 'tagged' : r.lanesFrom === 'class' ? 'class default' : 'from its lanes'})`;
        out.push(ctx.issue(buildingOnRoad, b.centre, [b.f.id, e.id], [e], w.d === 0 ? 0.7 : 0.8, what, proposals));
      }
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};

/** A footprint smaller than this (m2), or thinner than SLIVER_WIDTH on average, is not a building. */
export const TINY_M2 = 4;
export const SLIVER_WIDTH = 0.75;

function selfCrossing(ring: readonly P2[]): P2 | null {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = segmentCrossing(ring[i] as P2, ring[(i + 1) % n] as P2, ring[j] as P2, ring[(j + 1) % n] as P2, 1e-9);
      if (c) return { x: c.x, z: c.z };
    }
  }
  return null;
}

export const badPolygon: Rule = {
  id: 'R-BLDG-02',
  area: 'buildings',
  title: 'Bad building polygon (self-crossing, tiny or a sliver)',
  confidence: 0.8,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const b of ctx.footprints) {
      const ring = b.f.ring;
      let perimeter = 0;
      for (let i = 0; i < ring.length; i++) perimeter += Math.hypot((ring[(i + 1) % ring.length] as P2).x - (ring[i] as P2).x, (ring[(i + 1) % ring.length] as P2).z - (ring[i] as P2).z);
      const cross = ring.length > 3 ? selfCrossing(ring) : null;
      const thin = perimeter > 0 ? (2 * b.f.area) / perimeter : 0;
      if (cross) {
        out.push(ctx.issue(badPolygon, cross, [b.f.id], [], 0.85, 'the outline crosses itself', [
          ctx.proposal('replace_geometry', { op: 'clean_ring', on: b.f.id }, 0.7, { kind: 'other' }, `The outline of ${b.f.id} crosses itself: untangle it and keep its largest part`, ring),
          ctx.proposal('remove', { drop: b.f.id }, 0.3, { kind: 'other' }, 'Or leave the footprint out', ring),
        ]));
      } else if (b.f.area < TINY_M2 || thin < SLIVER_WIDTH) {
        const what = b.f.area < TINY_M2 ? `${b.f.area} m2: too small to be a building` : `a sliver about ${Math.round(thin * 100) / 100} m wide`;
        out.push(ctx.issue(badPolygon, b.centre, [b.f.id], [], 0.8, what, [
          ctx.proposal('remove', { drop: b.f.id }, 0.7, { kind: 'other' }, `${b.f.id} is ${what}: leave it out (logged as a drop)`, ring),
          ctx.proposal('disable_repair', { keep: 'footprint' }, 0.3, { kind: 'other' }, 'Or keep it: a kiosk, a wall or a pillar', ring),
        ]));
      }
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};

/** Both shares at or above this: the same building drawn twice. */
export const EXACT_DUPLICATE = 0.85;
/** The smaller footprint's share inside the larger from which the pair counts as nested. */
export const INSIDE_SHARE = 0.6;

const boxArea = (b: Fp['box']): number => Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxZ - b.minZ);

export const duplicateFootprint: Rule = {
  id: 'R-BLDG-03',
  area: 'buildings',
  title: 'Duplicate or nested footprint',
  confidence: 0.8,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const f of ctx.footprints) {
      for (const g of ctx.fps.query(f.box)) {
        if (g.f.id <= f.f.id || !boxesMeet(f.box, g.box)) continue;
        const [small, large] = f.f.area <= g.f.area ? [f, g] : [g, f];
        // a nested or doubled footprint has most of its box inside the other's box: skip plain neighbours early
        const ix = Math.min(small.box.maxX, large.box.maxX) - Math.max(small.box.minX, large.box.minX);
        const iz = Math.min(small.box.maxZ, large.box.maxZ) - Math.max(small.box.minZ, large.box.minZ);
        if (ix <= 0 || iz <= 0 || ix * iz < INSIDE_SHARE * 0.8 * boxArea(small.box)) continue;
        const smallIn = overlapShare(small.f.ring, large.f.ring);
        if (smallIn < INSIDE_SHARE) continue;
        const exact = smallIn >= EXACT_DUPLICATE && overlapShare(large.f.ring, small.f.ring) >= EXACT_DUPLICATE;
        const tags = (x: Fp): number => Object.keys(x.f.tags).length + (x.f.source === 'osm' ? 0.5 : 0);
        const drop = exact ? (tags(f) < tags(g) ? f : tags(g) < tags(f) ? g : g) : small;
        const keep = drop === f ? g : f;
        const proposals: Proposal[] = exact
          ? [ctx.proposal('remove', { drop: drop.f.id, keep: keep.f.id }, 0.9, { kind: 'duplicate_footprint', exact: true }, `The same footprint twice: keep ${keep.f.id} (more tags, or the lower id), drop ${drop.f.id}`, drop.f.ring)]
          : [
            ctx.proposal('disable_repair', { keep: 'both' }, 0.55, { kind: 'duplicate_footprint', exact: false }, `${small.f.id} lies ${Math.round(smallIn * 100)} percent inside ${large.f.id}: a block inside a compound outline, keep both`, small.f.ring),
            ctx.proposal('remove', { drop: small.f.id, keep: large.f.id }, 0.45, { kind: 'duplicate_footprint', exact: false }, 'Or a part drawn as its own building: drop the smaller one', small.f.ring),
          ];
        out.push(ctx.issue(duplicateFootprint, small.centre, [f.f.id, g.f.id], [], exact ? 0.9 : 0.6, exact ? 'exact duplicate' : 'nested footprint', proposals, 0.2));
      }
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};

export const badHeight: Rule = {
  id: 'R-BLDG-04',
  area: 'buildings',
  title: 'Building height that cannot be right',
  confidence: 0.7,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const b of ctx.footprints) {
      const { height, levels } = b.f;
      if (height === null && levels === null) continue;
      const byLevels = levels !== null ? Math.round(levels * FLOOR_M * 10) / 10 : null;
      let why = '';
      if (levels !== null && (levels < 1 || levels > 60)) why = `${levels} levels`;
      else if (height !== null && (height < 2.2 || height > 200)) why = `${height} m high`;
      else if (height !== null && byLevels !== null && Math.abs(height - byLevels) > Math.max(6, byLevels * 0.6)) why = `${height} m high with ${levels} levels (about ${byLevels} m)`;
      if (!why) continue;
      const fix = byLevels !== null && levels !== null && levels >= 1 && levels <= 60 ? byLevels : Math.min(200, Math.max(3, height ?? FLOOR_M));
      out.push(ctx.issue(badHeight, b.centre, [b.f.id], [], 0.7, why, [
        ctx.proposal('set_height', { on: b.f.id, height: fix, mode: byLevels !== null ? 'from_levels' : 'clamp' }, 0.7, { kind: 'other' }, `${b.f.id} is tagged ${why}: take ${fix} m ${byLevels !== null ? 'from its levels' : '(the nearest height a building can have)'}`, b.f.ring),
        ctx.proposal('disable_repair', { keep: 'height' }, 0.3, { kind: 'other' }, 'Or the tag is right (a mast, a monument)', b.f.ring),
      ], 0.2));
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};
