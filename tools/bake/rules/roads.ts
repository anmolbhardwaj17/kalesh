// Road rules (R-ROAD) on the block graph: dangling ends near another road, crossings without a shared node on one
// level, ways drawn on top of each other, one-way streets with no pair (explained, never changed), widths that do not
// fit their lanes, lane count changes with no room for a taper, and pairs whose halves carry two names. Pure.
import { boxOf, segmentCrossing } from '../geom.ts';
import type { P2 } from '../geom.ts';
import { classImpact } from '../osm.ts';
import type { GraphEdge } from '../graph/build.ts';
import { PAIR_CLASSES, normName } from '../graph/pairs.ts';
import { classDefaults } from '../roads/model.ts';
import { byId, r2, r3, sameLevel } from './context.ts';
import type { End, Rule, RuleContext } from './context.ts';
import { patchOf } from './types.ts';
import type { Issue, Proposal } from './types.ts';

/** Search radius of the dangling end rule in metres. */
export const DANGLING_RADIUS = 12;
const mm = (v: number): number => Math.round(v * 1000);
const mid = (e: GraphEdge): P2 => e.pts[Math.floor(e.pts.length / 2)] as P2;

export const danglingEnd: Rule = {
  id: 'R-ROAD-01',
  area: 'roads',
  title: 'Dangling end near another road',
  confidence: 0.7,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const n of ctx.graph.nodes) {
      if (n.kind !== 'end') continue;
      const ends = ctx.ends.get(n.id) ?? [];
      const end = ends[0];
      if (ends.length !== 1 || !end || end.edge.a === end.edge.b) continue;
      if (ctx.env.nodeTags?.get(n.id)?.['noexit'] === 'yes') continue;
      // either side of a barrier an add_barrier patch put across the road (P1-045): a dead end on purpose
      if (ctx.marks[n.id]?.['barrier'] !== undefined) continue;
      const e = end.edge;
      const lv = ctx.endLevel(end);
      const far = end.atStart ? e.b : e.a;
      const hit = ctx.near(n, DANGLING_RADIUS).find((c) => {
        const t = c.seg.edge;
        if (t === e || !sameLevel(c.seg.lv, lv)) return false;
        // a short stub that leaves the other road close by is a driveway, not a near miss
        return !((t.a === far || t.b === far) && e.len <= Math.max(25, 3 * c.d));
      });
      if (!hit) continue;
      const t = hit.seg.edge;
      const d = r3(hit.d);
      const away = ctx.dirFrom(end);
      const gap = d || 1e-6;
      const toward = (-away.x * (hit.x - n.x) - away.z * (hit.z - n.z)) / gap;
      let confidence = mm(d) <= 2000 ? 0.9 : mm(d) <= 5000 ? 0.8 : mm(d) <= 8000 ? 0.65 : 0.5;
      if (toward < 0.5 && d > 1) confidence = r2(confidence - 0.25);
      const gapM = Math.round(d * 10) / 10;
      const proposals: Proposal[] = [
        ctx.proposal('connect', { op: 'join_end', edge: e.id, node: n.id, to: t.id, x: r3(hit.x), z: r3(hit.z), gap_m: gapM }, confidence, { kind: 'join', m: d },
          `The end of ${e.id} stops ${gapM} m from ${t.id} on the same level${toward >= 0.5 ? ' and points at it' : ' but does not point at it'}: join them`, [n, { x: hit.x, z: hit.z }]),
        ctx.proposal('terminate', { node: n.id, with: 'dead_end' }, 1 - confidence, { kind: 'other' }, 'A real dead end (a gate, a wall or a kerb between them)', [n]),
      ];
      out.push(ctx.issue(danglingEnd, n, [e.id, t.id, n.id], [e, t], 0.7, `gap ${gapM} m`, proposals));
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};

export const crossingNoNode: Rule = {
  id: 'R-ROAD-02',
  area: 'roads',
  title: 'Crossing without a shared node on the same layer',
  confidence: 0.75,
  detect(ctx: RuleContext): Issue[] {
    const found = new Map<string, { a: GraphEdge; b: GraphEdge; at: P2; n: number }>();
    for (const s of ctx.segList) {
      for (const o of ctx.segs.query(boxOf([s.a, s.b]))) {
        if (o.edge.id <= s.edge.id || !sameLevel(o.lv, s.lv)) continue;
        const c = segmentCrossing(s.a, s.b, o.a, o.b, 1e-6);
        if (!c) continue;
        const key = `${s.edge.id}:${o.edge.id}`;
        const prev = found.get(key);
        if (prev) prev.n++;
        else found.set(key, { a: s.edge, b: o.edge, at: { x: c.x, z: c.z }, n: 1 });
      }
    }
    const out: Issue[] = [];
    for (const f of found.values()) {
      const major = Math.max(classImpact(f.a.road.cls), classImpact(f.b.road.cls)) >= 0.7;
      const over = classImpact(f.a.road.cls) >= classImpact(f.b.road.cls) ? f.a : f.b;
      const proposals: Proposal[] = [
        ctx.proposal('connect', { op: 'add_junction', a: f.a.id, b: f.b.id, x: r3(f.at.x), z: r3(f.at.z) }, major ? 0.4 : 0.6, { kind: 'other' }, 'Both ways are on one level and cross: add a junction node', [f.at]),
        ctx.proposal('set_tag', { key: 'layer', value: 1, on: over.id, bridge: true }, major ? 0.5 : 0.3, { kind: 'other' }, 'One way passes over the other and its bridge and layer tags are missing', over.pts),
      ];
      out.push(ctx.issue(crossingNoNode, f.at, [f.a.id, f.b.id], [f.a, f.b], 0.75, f.n > 1 ? `${f.n} crossings` : '1 crossing', proposals));
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};

/** Two centre lines closer than this (m) along OVERLAP_MIN_M metres are one road drawn twice, or a drawing error. */
export const OVERLAP_GAP = 1;
export const OVERLAP_MIN_M = 15;

export const overlappingWays: Rule = {
  id: 'R-ROAD-03',
  area: 'roads',
  title: 'Ways drawn on top of each other',
  confidence: 0.7,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    const step = 8;
    for (const e of ctx.graph.edges) {
      if (e.len < OVERLAP_MIN_M + 8) continue;
      const along = new Map<GraphEdge, { n: number; at: P2 }>();
      for (const s of ctx.samples(e, step, Math.min(12, e.len / 4))) {
        const lv = ctx.levelAt(e, s.s);
        for (const c of ctx.near(s, OVERLAP_GAP)) {
          const t = c.seg.edge;
          if (t === e || t.id < e.id || !sameLevel(c.seg.lv, lv)) continue;
          const tl = Math.hypot(c.seg.b.x - c.seg.a.x, c.seg.b.z - c.seg.a.z) || 1;
          if (Math.abs((s.tx * (c.seg.b.x - c.seg.a.x) + s.tz * (c.seg.b.z - c.seg.a.z)) / tl) < 0.9) continue;
          const prev = along.get(t);
          if (prev) prev.n++;
          else along.set(t, { n: 1, at: s });
        }
      }
      for (const [t, v] of along) {
        const metres = v.n * step;
        if (metres < OVERLAP_MIN_M) continue;
        const lesser = classImpact(e.road.cls) !== classImpact(t.road.cls) ? (classImpact(e.road.cls) < classImpact(t.road.cls) ? e : t) : e.len <= t.len ? e : t;
        out.push(ctx.issue(overlappingWays, v.at, [e.id, t.id], [e, t], 0.7, `about ${metres} m within ${OVERLAP_GAP} m of each other`, [
          ctx.proposal('remove', { drop: lesser.id }, 0.6, { kind: 'other' }, `${e.id} and ${t.id} run on top of each other: one road drawn twice, keep the bigger one`, lesser.pts),
          ctx.proposal('disable_repair', { keep: 'both' }, 0.3, { kind: 'other' }, 'Two real lanes drawn very close (a service lane beside the road)', [v.at]),
        ]));
      }
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};

/** One-way edges that could be half of a divided street and found no pair. */
export function unpairedCandidates(ctx: RuleContext): GraphEdge[] {
  return ctx.graph.edges.filter((e) => e.oneway && !e.road.link && !e.roundabout && e.a !== e.b && e.pairedWith.length === 0 && PAIR_CLASSES.has(e.road.cls));
}

export const unpairedOneway: Rule = {
  id: 'R-ROAD-04',
  area: 'roads',
  title: 'One-way carriageway with no opposite pair',
  confidence: 0.5,
  detect(ctx: RuleContext): Issue[] {
    const cand = unpairedCandidates(ctx);
    const set = new Set(cand);
    // a named street is one group; unnamed edges group along the road they run on into
    const group = new Map<string, GraphEdge[]>();
    const seen = new Set<GraphEdge>();
    for (const e of cand) {
      const name = normName(e.name);
      if (name) {
        const g = group.get(name);
        if (g) g.push(e);
        else group.set(name, [e]);
        continue;
      }
      if (seen.has(e)) continue;
      const chain: GraphEdge[] = [];
      const todo = [e];
      while (todo.length) {
        const x = todo.pop() as GraphEdge;
        if (seen.has(x)) continue;
        seen.add(x);
        chain.push(x);
        for (const atStart of [true, false]) {
          const next = ctx.through({ edge: x, atStart });
          if (next && set.has(next.edge) && !next.edge.name && !seen.has(next.edge)) todo.push(next.edge);
        }
      }
      chain.sort(byId);
      group.set(`#${(chain[0] as GraphEdge).id}`, chain);
    }
    const out: Issue[] = [];
    for (const [key, edges] of group) {
      const metres = edges.reduce((s, e) => s + e.len, 0);
      if (metres < 60) continue;
      edges.sort(byId);
      const longest = edges.reduce((a, b) => (b.len > a.len ? b : a));
      const label = key.startsWith('#') ? 'an unnamed one-way road' : `"${longest.name}"`;
      const issue = ctx.issue(unpairedOneway, mid(longest), edges.map((e) => e.id).slice(0, 4), edges, 0.5, `${edges.length} edges, ${Math.round(metres)} m of ${label}`, [
        ctx.proposal('set_tag', { key: 'bake:carriageway', value: 'single', on: longest.id }, 0.5, { kind: 'one_way_no_pair' },
          `${label} is one-way with no opposite carriageway beside it: a true one-way street (the Connaught Place radials are), or its other half is missing or carries another name. Left as it is`, longest.pts),
      ]);
      issue.status = 'explained';
      out.push(issue);
    }
    return out;
  },
};

const WIDTH_CLASSES = new Set([...PAIR_CLASSES, 'unclassified', 'residential']);

export const widthSanity: Rule = {
  id: 'R-ROAD-05',
  area: 'roads',
  title: 'Width does not fit the class and lane count',
  confidence: 0.7,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const e of ctx.graph.edges) {
      const r = e.road;
      // a width the building rule narrowed is not the tag any more: the width gave way
      if (r.widthFrom !== 'tag' || !WIDTH_CLASSES.has(r.cls) || ctx.mark(e.id, 'width_from') === 'buildings') continue;
      const per = r.width / r.lanes;
      const min = PAIR_CLASSES.has(r.cls) ? 2.2 : 1.5;
      if (per >= min && per <= 6) continue;
      const byLanes = Math.round(r.lanes * r.laneWidth * 10) / 10;
      const lanes = Math.max(1, Math.round(r.width / r.laneWidth));
      const proposals: Proposal[] = [];
      if (r.lanesFrom === 'tag' || per < min) proposals.push(ctx.proposal('set_tag', { key: 'width', value: byLanes, on: e.id, force: true }, r.lanesFrom === 'tag' ? 0.7 : 0.55, { kind: 'other' }, `The width tag ${r.width} m gives ${r2(per)} m a lane for ${r.lanes} lanes: take ${byLanes} m from the lane count`, e.pts));
      if (r.lanesFrom !== 'tag' && lanes !== r.lanes) proposals.push(ctx.proposal('set_lanes', { on: e.id, lanes, from: 'width' }, 0.6, { kind: 'lane_count', cls: r.cls }, `The lane count ${r.lanes} is only the class default; the tagged width ${r.width} m holds ${lanes}`, e.pts));
      if (!proposals.length) continue;
      out.push(ctx.issue(widthSanity, mid(e), [e.id], [e], 0.7, `${r.width} m for ${r.lanes} lanes (${r2(per)} m a lane)`, proposals));
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};

/** Metres of taper a lane count change needs on this class. */
export const taperNeed = (cls: string, laneWidth: number, lanes: number): number => Math.max(10, lanes * laneWidth * classDefaults(cls).taper);

/** Pairs of edge ends where one street runs on with another lane count: [the end, the end it runs on into], each pair once. */
export function laneChanges(ctx: RuleContext): [End, End][] {
  const out: [End, End][] = [];
  for (const e of ctx.graph.edges) {
    for (const atStart of [true, false]) {
      const end = { edge: e, atStart };
      const next = ctx.through(end);
      if (!next || next.edge.id <= e.id || next.edge.road.lanes === e.road.lanes) continue;
      if (next.edge.road.cls !== e.road.cls || next.edge.road.link !== e.road.link || next.edge.oneway !== e.oneway || next.edge.name !== e.name) continue;
      out.push([end, next]);
    }
  }
  return out;
}

export const noTaperRoom: Rule = {
  id: 'R-ROAD-06',
  area: 'roads',
  title: 'Lane count change with no room for a taper',
  confidence: 0.7,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const [a, b] of laneChanges(ctx)) {
      // a class default beside a tagged count is the lane fit rule's case (R-LANE-FIT-03)
      if (a.edge.road.lanesFrom === 'class' || b.edge.road.lanesFrom === 'class') continue;
      const need = taperNeed(a.edge.road.cls, a.edge.road.laneWidth, Math.abs(a.edge.road.lanes - b.edge.road.lanes));
      if (Math.max(a.edge.len, b.edge.len) >= need) continue;
      const [short, long] = a.edge.len <= b.edge.len ? [a.edge, b.edge] : [b.edge, a.edge];
      const node = ctx.nodeOf(a);
      out.push(ctx.issue(noTaperRoom, node, [a.edge.id, b.edge.id, node.id], [a.edge, b.edge], 0.7, `${short.road.lanes} to ${long.road.lanes} lanes needs ${Math.round(need)} m, the longer edge has ${Math.round(long.len)} m`, [
        ctx.proposal('set_lanes', { on: short.id, lanes: long.road.lanes, from: 'ahead' }, 0.7, { kind: 'lane_count', cls: short.road.cls }, `No room for a taper between ${short.id} (${short.road.lanes} lanes, ${Math.round(short.len)} m) and ${long.id} (${long.road.lanes} lanes): the short edge takes the lane count of the road ahead`, short.pts),
      ]));
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};

export const pairNamesDiffer: Rule = {
  id: 'R-ROAD-07',
  area: 'roads',
  title: 'Paired carriageways with two different names',
  confidence: 0.6,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const p of ctx.graph.pairs) {
      if (!p.namesDiffer) continue;
      const a = ctx.edges.get(p.a);
      const b = ctx.edges.get(p.b);
      if (!a || !b) continue;
      out.push(ctx.issue(pairNamesDiffer, mid(a), [a.id, b.id], [a, b], 0.6, `"${a.name}" and "${b.name}", ${p.gap} m apart`, [
        ctx.proposal('set_tag', { key: 'bake:pair', value: 'keep', on: a.id, with: b.id }, 0.6, { kind: 'other' }, `"${a.name}" and "${b.name}" run side by side ${p.gap} m apart on one level, in opposite directions: one street drawn with two names, keep them paired`, a.pts),
        ctx.proposal('set_tag', { key: 'bake:pair', value: 'split', on: a.id, with: b.id }, 0.4, { kind: 'other' }, 'Two separate one-way streets that happen to run side by side: do not pair them', b.pts),
      ]));
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};
