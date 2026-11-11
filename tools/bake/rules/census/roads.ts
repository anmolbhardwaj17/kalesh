// Road rules (R-ROAD): dangling ends near another road, crossings without a shared node, one-way ways with no pair.
import { Grid, boxOf, dist, inBox, pointSegment, resample, segmentCrossing } from '../../geom.ts';
import type { Box2, P2 } from '../../geom.ts';
import { classImpact } from '../../osm.ts';
import type { MapData, Road } from '../../osm.ts';
import { issue, patchOf } from './types.ts';
import type { Issue, Proposal, Rule, RuleContext } from './types.ts';

export interface RoadSegment {
  road: Road;
  /** Index of the segment's first point in road.pts (and road.nodes). */
  i: number;
  a: P2;
  b: P2;
  box: Box2;
}

const segCache = new WeakMap<MapData, Grid<RoadSegment>>();

/** Every road segment in a grid, built once per map. */
export function roadSegments(map: MapData): Grid<RoadSegment> {
  let grid = segCache.get(map);
  if (grid) return grid;
  grid = new Grid<RoadSegment>(40);
  for (const road of map.roads) {
    for (let i = 0; i + 1 < road.pts.length; i++) {
      const a = road.pts[i] as P2;
      const b = road.pts[i + 1] as P2;
      const seg: RoadSegment = { road, i, a, b, box: boxOf([a, b]) };
      grid.insert(seg.box, seg);
    }
  }
  segCache.set(map, grid);
  return grid;
}

/** Roads on the same level: the same layer, both or neither a bridge, both or neither a tunnel. */
export const sameLevel = (a: Road, b: Road): boolean => a.layer === b.layer && a.bridge === b.bridge && a.tunnel === b.tunnel;

const isLoop = (r: Road): boolean => r.nodes.length > 2 && r.nodes[0] === r.nodes[r.nodes.length - 1];

/** Distance along a road from one of its ends to the nearest node it shares with `other`; Infinity when none. */
function alongToShared(road: Road, fromStart: boolean, other: Road): number {
  const shared = new Set(other.nodes);
  let along = 0;
  const n = road.pts.length;
  for (let k = 0; k < n; k++) {
    const i = fromStart ? k : n - 1 - k;
    if (k > 0) along += dist(road.pts[i] as P2, road.pts[fromStart ? i - 1 : i + 1] as P2);
    if (shared.has(road.nodes[i] as number)) return along;
  }
  return Infinity;
}

/** Search radius of the dangling end rule in metres. */
export const DANGLING_RADIUS = 12;
/** A join up to this long is a low impact repair (AR1). */
export const SHORT_JOIN = 5;

export const danglingEnd: Rule = {
  id: 'R-ROAD-01',
  area: 'roads',
  title: 'Dangling end near another road',
  confidence: 0.7,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    const grid = roadSegments(ctx.map);
    for (const road of ctx.map.roads) {
      if (isLoop(road)) continue;
      for (const fromStart of [true, false]) {
        const idx = fromStart ? 0 : road.pts.length - 1;
        const nodeId = road.nodes[idx] as number;
        if ((ctx.map.roadsAtNode.get(nodeId)?.length ?? 0) !== 1) continue;
        const end = road.pts[idx] as P2;
        if (!inBox(ctx.box, end, -5)) continue; // cut by the extract, not a real end
        const node = ctx.map.nodes.get(nodeId);
        if (node?.tags?.['noexit'] === 'yes') continue;
        let best: { d: number; seg: RoadSegment; x: number; z: number } | null = null;
        for (const seg of grid.query(boxOf([end]), DANGLING_RADIUS)) {
          if (seg.road === road || !sameLevel(seg.road, road)) continue;
          const c = pointSegment(end, seg.a, seg.b);
          if (c.d > DANGLING_RADIUS || (best && c.d >= best.d)) continue;
          // a short stub that leaves the other road close by is a driveway, not a near miss
          if (alongToShared(road, fromStart, seg.road) <= Math.max(25, 3 * c.d)) continue;
          best = { d: c.d, seg, x: c.x, z: c.z };
        }
        if (!best) continue;
        const prev = road.pts[fromStart ? 1 : road.pts.length - 2] as P2;
        const len = dist(prev, end) || 1;
        const gap = best.d || 1e-6;
        const toward = ((end.x - prev.x) * (best.x - end.x) + (end.z - prev.z) * (best.z - end.z)) / (len * gap);
        let confidence = best.d <= 2 ? 0.9 : best.d <= SHORT_JOIN ? 0.8 : best.d <= 8 ? 0.65 : 0.5;
        if (toward < 0.5 && best.d > 1) confidence = Math.round((confidence - 0.25) * 100) / 100;
        const gapM = Math.round(best.d * 10) / 10;
        const proposals: Proposal[] = [
          {
            action: 'connect', params: { to: best.seg.road.id, gap_m: gapM }, confidence, lowImpact: best.d <= SHORT_JOIN,
            reasoning: `The end of ${road.id} stops ${gapM} m from ${best.seg.road.id} on the same level${toward >= 0.5 ? ' and points at it' : ' but does not point at it'}: join them`,
            preview: [end, { x: best.x, z: best.z }],
          },
          { action: 'terminate', params: {}, confidence: Math.round((1 - confidence) * 100) / 100, lowImpact: true, reasoning: 'A real dead end (a gate, a wall or a kerb between them)', preview: [end] },
        ];
        out.push(issue(ctx, danglingEnd, end, [road.id, best.seg.road.id, `node/${nodeId}`], Math.max(classImpact(road.cls), classImpact(best.seg.road.cls)), 0.7, `gap ${gapM} m`, proposals));
      }
    }
    return out;
  },
  repair: (i) => patchOf(i),
};

export const crossingNoNode: Rule = {
  id: 'R-ROAD-02',
  area: 'roads',
  title: 'Crossing without a shared node on the same layer',
  confidence: 0.75,
  detect(ctx: RuleContext): Issue[] {
    const found = new Map<string, { a: Road; b: Road; at: P2; n: number }>();
    const grid = roadSegments(ctx.map);
    for (const road of ctx.map.roads) {
      for (let i = 0; i + 1 < road.pts.length; i++) {
        const a = road.pts[i] as P2;
        const b = road.pts[i + 1] as P2;
        for (const seg of grid.query(boxOf([a, b]))) {
          if (seg.road.id <= road.id || !sameLevel(seg.road, road)) continue;
          const n1 = road.nodes[i];
          const n2 = road.nodes[i + 1];
          const m1 = seg.road.nodes[seg.i];
          const m2 = seg.road.nodes[seg.i + 1];
          if (n1 === m1 || n1 === m2 || n2 === m1 || n2 === m2) continue;
          const c = segmentCrossing(a, b, seg.a, seg.b, 1e-6);
          if (!c || !inBox(ctx.box, c)) continue;
          const key = `${road.id}:${seg.road.id}`;
          const prev = found.get(key);
          if (prev) prev.n++;
          else found.set(key, { a: road, b: seg.road, at: { x: c.x, z: c.z }, n: 1 });
        }
      }
    }
    const out: Issue[] = [];
    for (const f of found.values()) {
      const impact = Math.max(classImpact(f.a.cls), classImpact(f.b.cls));
      const major = impact >= 0.7;
      const proposals: Proposal[] = [
        { action: 'connect', params: { at_x: Math.round(f.at.x * 10) / 10, at_z: Math.round(f.at.z * 10) / 10 }, confidence: major ? 0.4 : 0.6, lowImpact: false, reasoning: 'Both ways are on one level and cross: add a junction node', preview: [f.at] },
        { action: 'set_tag', params: { key: 'layer', value: '1', on: classImpact(f.a.cls) >= classImpact(f.b.cls) ? f.a.id : f.b.id }, confidence: major ? 0.5 : 0.3, lowImpact: false, reasoning: 'One way passes over the other and its bridge and layer tags are missing', preview: [f.at] },
      ];
      out.push(issue(ctx, crossingNoNode, f.at, [f.a.id, f.b.id], impact, 0.75, f.n > 1 ? `${f.n} crossings` : '1 crossing', proposals));
    }
    return out;
  },
  repair: (i) => patchOf(i),
};

const PAIR_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
/** How far apart the two carriageways of one street may be. */
export const PAIR_DISTANCE = 45;

function pairable(r: Road): boolean {
  return r.oneway && !r.link && r.name !== '' && PAIR_CLASSES.has(r.cls) && r.tags['junction'] === undefined && !isLoop(r);
}

/** Share (0 to 1) of a one-way road's length that has an opposite one-way road of the same name beside it. */
export function pairedShare(road: Road, grid: Grid<RoadSegment>): number {
  const pts = resample(road.pts, 25);
  if (pts.length < 2) return 0;
  const reversed = road.tags['oneway'] === '-1' ? -1 : 1;
  let paired = 0;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k] as P2;
    const q = pts[Math.min(pts.length - 1, k + 1)] as P2;
    const o = pts[Math.max(0, k - 1)] as P2;
    const dx = (q.x - o.x) * reversed;
    const dz = (q.z - o.z) * reversed;
    const dl = Math.hypot(dx, dz) || 1;
    let ok = false;
    for (const seg of grid.query(boxOf([p]), PAIR_DISTANCE)) {
      if (seg.road === road || seg.road.name !== road.name || !pairable(seg.road)) continue;
      if (pointSegment(p, seg.a, seg.b).d > PAIR_DISTANCE) continue;
      const rev = seg.road.tags['oneway'] === '-1' ? -1 : 1;
      const sx = (seg.b.x - seg.a.x) * rev;
      const sz = (seg.b.z - seg.a.z) * rev;
      if ((dx * sx + dz * sz) / (dl * (Math.hypot(sx, sz) || 1)) < -0.5) {
        ok = true;
        break;
      }
    }
    if (ok) paired++;
  }
  return paired / pts.length;
}

export const unpairedOneway: Rule = {
  id: 'R-ROAD-04',
  area: 'roads',
  title: 'One-way carriageway with no opposite pair',
  confidence: 0.5,
  detect(ctx: RuleContext): Issue[] {
    const grid = roadSegments(ctx.map);
    const byName = new Map<string, { roads: Road[]; metres: number }>();
    for (const road of ctx.map.roads) {
      if (!pairable(road) || road.length < 60) continue;
      if (pairedShare(road, grid) >= 0.5) continue;
      const g = byName.get(road.name);
      if (g) {
        g.roads.push(road);
        g.metres += road.length;
      } else byName.set(road.name, { roads: [road], metres: road.length });
    }
    const out: Issue[] = [];
    for (const [name, g] of byName) {
      const longest = g.roads.reduce((a, b) => (b.length > a.length ? b : a));
      const mid = longest.pts[Math.floor(longest.pts.length / 2)] as P2;
      const proposals: Proposal[] = [
        { action: 'set_tag', params: { key: 'bake:carriageway', value: 'single' }, confidence: 0.5, lowImpact: false, reasoning: `"${name}" is one-way with no opposite carriageway within ${PAIR_DISTANCE} m: a true one-way street, or the other half is missing or carries another name`, preview: longest.pts },
      ];
      out.push(issue(ctx, unpairedOneway, mid, g.roads.map((r) => r.id).slice(0, 4), classImpact(longest.cls), 0.5, `${g.roads.length} ways, ${Math.round(g.metres)} m of "${name}"`, proposals));
    }
    return out;
  },
};

/** Counts for the report: one-way ways that qualify as half of a street, and how many found their pair. */
export function onewayPairStats(map: MapData): { candidates: number; paired: number; metresPaired: number; metresUnpaired: number } {
  const grid = roadSegments(map);
  const s = { candidates: 0, paired: 0, metresPaired: 0, metresUnpaired: 0 };
  for (const road of map.roads) {
    if (!pairable(road) || road.length < 60) continue;
    s.candidates++;
    if (pairedShare(road, grid) >= 0.5) {
      s.paired++;
      s.metresPaired += road.length;
    } else s.metresUnpaired += road.length;
  }
  s.metresPaired = Math.round(s.metresPaired);
  s.metresUnpaired = Math.round(s.metresUnpaired);
  return s;
}
