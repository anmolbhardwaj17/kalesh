// Building rules (R-BLDG) on the merged footprints of the block graph: footprints that reach into a carriageway (the
// width gives way, the building stays), bad polygons (self-crossing, tiny, slivers), duplicates and nested
// footprints, and heights that cannot be right. Missing heights are not issues: tools/bake/repair/ fills them from
// the levels and counts them. Pure.
import { boxesMeet, overlapShare, segmentCrossing, segmentRing } from '../geom.ts';
import type { P2 } from '../geom.ts';
import type { GraphEdge } from '../graph/build.ts';
import { atGrade } from './context.ts';
import type { Fp, Rule, RuleContext, Seg } from './context.ts';
import { patchOf } from './types.ts';
import type { Issue, Proposal } from './types.ts';

/** A footprint must reach this far into the carriageway to count. */
export const OVERLAP_MIN = 0.3;
/** A carriageway is never narrowed below this (m) on its own. */
export const MIN_WIDTH = 2;
/** Metres per floor when a height comes from a levels tag. */
export const FLOOR_M = 3.2;

const r1 = (v: number): number => Math.round(v * 10) / 10;
/** The carriageway width before any repair narrowed it. */
export const widthWas = (ctx: RuleContext, e: GraphEdge): number => Number(ctx.mark(e.id, 'width_was') ?? e.road.width);

export const buildingOnRoad: Rule = {
  id: 'R-BLDG-01',
  area: 'buildings',
  title: 'Building overlaps a road',
  confidence: 0.8,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const b of ctx.footprints) {
      if (b.f.tags['building'] === 'roof') continue;
      const worst = new Map<GraphEdge, { seg: Seg; d: number }>();
      for (const seg of ctx.segs.query(b.box, 8)) {
        const half = seg.edge.road.width / 2;
        if (!atGrade(seg.lv)) continue;
        if (Math.min(seg.a.x, seg.b.x) - half > b.box.maxX || Math.max(seg.a.x, seg.b.x) + half < b.box.minX || Math.min(seg.a.z, seg.b.z) - half > b.box.maxZ || Math.max(seg.a.z, seg.b.z) + half < b.box.minZ) continue;
        const d = segmentRing(seg.a, seg.b, b.f.ring);
        if (half - d < OVERLAP_MIN) continue;
        const prev = worst.get(seg.edge);
        if (!prev || d < prev.d) worst.set(seg.edge, { seg, d });
      }
      for (const [e, w] of worst) {
        const r = e.road;
        const depth = r1(widthWas(ctx, e) / 2 - w.d);
        const proposals: Proposal[] = [];
        if (w.d === 0) {
          proposals.push(ctx.proposal('set_tag', { key: 'tunnel', value: 'building_passage', on: e.id, building: b.f.id }, 0.45, { kind: 'other' }, 'The centre line runs through the footprint: a passage or a gate, or the footprint is wrong', [w.seg.a, w.seg.b]));
          proposals.push(ctx.proposal('remove', { drop: b.f.id }, 0.3, { kind: 'other' }, 'Or the footprint is wrong: leave it out', b.f.ring));
        } else {
          const guessed = r.widthFrom === 'lanes' && r.lanesFrom === 'class';
          const free = 2 * w.d - 0.4;
          const fits = Math.max(MIN_WIDTH, r1(free));
          proposals.push(ctx.proposal('set_tag', { key: 'width', value: fits, on: e.id }, guessed ? 0.85 : 0.6, { kind: 'building_into_road', m: depth, classDefault: guessed, fits: free >= MIN_WIDTH },
            guessed ? `The ${r.width} m width of ${e.id} is only the class default; the buildings leave ${fits} m: narrow the road, the building stays` : `The tagged width ${r.width} m of ${e.id} does not fit between the buildings (${fits} m free)`, [w.seg.a, w.seg.b]));
          proposals.push(ctx.proposal('replace_geometry', { op: 'trim', on: b.f.id, by_m: depth }, 0.3, { kind: 'other' }, 'Or the footprint is drawn too far out: pull its edge back', b.f.ring));
        }
        out.push(ctx.issue(buildingOnRoad, b.centre, [b.f.id, e.id], [e], w.d === 0 ? 0.7 : 0.8, w.d === 0 ? 'the road centre line enters the footprint' : `${depth} m into a ${r.width} m carriageway (${r.widthFrom === 'tag' ? 'tagged' : r.lanesFrom === 'class' ? 'class default' : 'from its lanes'})`, proposals));
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
