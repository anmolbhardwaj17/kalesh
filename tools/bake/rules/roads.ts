// Road rules (R-ROAD) on the block graph: dangling ends near another road, crossings without a shared node on one
// level, ways drawn on top of each other, one-way streets with no pair (explained, never changed), widths that do not
// fit their lanes, lane count changes with no room for a taper, and pairs whose halves carry two names. Pure.
import { boxOf, segmentCrossing, segmentRing } from '../geom.ts';
import type { P2 } from '../geom.ts';
import { classImpact } from '../osm.ts';
import type { GraphEdge } from '../graph/build.ts';
import { PAIR_CLASSES, normName } from '../graph/pairs.ts';
import { classDefaults } from '../roads/model.ts';
import { byId, r2, r3, sameLevel } from './context.ts';
import type { End, Level, Rule, RuleContext } from './context.ts';
import { patchOf } from './types.ts';
import type { Issue, Proposal } from './types.ts';

/** Search radius of the dangling end rule in metres. */
export const DANGLING_RADIUS = 12;
const mm = (v: number): number => Math.round(v * 1000);
const mid = (e: GraphEdge): P2 => e.pts[Math.floor(e.pts.length / 2)] as P2;

/** A join the geometry supports is looked for this far straight ahead of the end (m). */
export const AHEAD_M = 15;
/** OSM barrier values at a road's end that are a gate, and those that are a barricade. */
const GATES: ReadonlySet<string> = new Set(['gate', 'lift_gate', 'swing_gate', 'sliding_gate', 'entrance', 'toll_booth', 'border_control', 'chain']);

/** Does the straight line from a to b pass through a building? */
function blocked(ctx: RuleContext, a: P2, b: P2): string | null {
  for (const f of ctx.fps.query(boxOf([a, b]), 0.5)) {
    if (f.f.tags['building'] === 'roof') continue;
    if (segmentRing(a, b, f.f.ring) < 0.05) return f.f.id;
  }
  return null;
}

/**
 * Dead ends near another road (P1-030: "why is this road just ending out of nowhere, or there's a gap here"). The
 * rule decides by the geometry. The end lies on the other road's surface, or it points at the road, the road is
 * within reach straight ahead and nothing is built between them: the two are joined. A barrier on the end node, a
 * building in the gap, or an end that runs past the road without pointing at it: a real dead end, closed there. A
 * clear line to a road 8 to 15 m ahead is the one case left for the top view (it may be a gate or an unmapped link).
 */
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
      // closed by an earlier decision (this rule, the judge pass or the owner)
      if (ctx.marks[n.id]?.['closure'] !== undefined) continue;
      const e = end.edge;
      const lv = ctx.endLevel(end);
      const far = end.atStart ? e.b : e.a;
      // the other carriageway of the same divided street is never a road to join: the two end side by side
      const usable = (t: GraphEdge, d: number, level: Level): boolean => t !== e && sameLevel(level, lv) && !e.pairedWith.includes(t.id)
        // a short stub that leaves the other road close by is a driveway, not a near miss
        && !((t.a === far || t.b === far) && e.len <= Math.max(25, 3 * d));
      const hit = ctx.near(n, DANGLING_RADIUS).find((c) => usable(c.seg.edge, c.d, c.seg.lv));
      // the road straight ahead of the end, within AHEAD_M
      const away = ctx.dirFrom(end);
      const tip = { x: n.x - away.x * AHEAD_M, z: n.z - away.z * AHEAD_M };
      let ahead: { edge: GraphEdge; x: number; z: number; d: number } | null = null;
      for (const seg of ctx.segs.query(boxOf([n, tip]))) {
        const c = segmentCrossing(n, tip, seg.a, seg.b, 1e-6);
        if (!c) continue;
        const d = Math.hypot(c.x - n.x, c.z - n.z);
        if (d < 0.05 || !usable(seg.edge, d, seg.lv)) continue;
        if (!ahead || d < ahead.d) ahead = { edge: seg.edge, x: c.x, z: c.z, d };
      }
      if (!hit && !ahead) continue;
      const barrier = ctx.env.nodeTags?.get(n.id)?.['barrier'];
      // where a join would go: straight ahead when the road is there, else the nearest point
      const onSurface = hit !== undefined && hit.d <= hit.seg.edge.road.width / 2 + 1;
      const join = onSurface && hit ? { edge: hit.seg.edge, x: hit.x, z: hit.z, d: hit.d } : ahead ?? (hit ? { edge: hit.seg.edge, x: hit.x, z: hit.z, d: hit.d } : null);
      if (!join) continue;
      const t = join.edge;
      const d = r3(join.d);
      const gapM = Math.round(d * 10) / 10;
      const wall = blocked(ctx, n, join);
      const points = ahead !== null && ahead.edge === t;
      const bigRoad = classImpact(t.road.cls) >= 0.9 && classImpact(e.road.cls) < 0.5;
      let joinC: number;
      let why: string;
      let supported = false;
      const hero = ctx.heroOf(t);
      if (barrier !== undefined) {
        joinC = 0.1;
        why = `the end node is tagged barrier=${barrier}`;
      } else if (hero && ctx.heroHasSpec(hero)) {
        // a hero road with a spec file has its junctions and openings drawn in its spec: none is added by a rule
        // or the judge pass (P1-030: a drive joined to the Connaught Place inner circle put a junction on the lap route)
        joinC = 0.2;
        why = `${t.id} is the hero road ${hero}, whose junctions come from its spec file`;
      } else if (wall) {
        joinC = 0.15;
        why = `a building (${wall}) stands between the end and ${t.id}`;
      } else if (onSurface) {
        joinC = 0.9;
        supported = true;
        why = `the end lies on the surface of ${t.id} (${gapM} m from its centre line)`;
      } else if (points && mm(d) <= 8000 && !(bigRoad && mm(d) > 5000)) {
        joinC = 0.85;
        supported = true;
        why = `the end points at ${t.id}, ${gapM} m straight ahead, with nothing built between them`;
      } else if (points) {
        // a clear line to a road further ahead: a gate, a kerb or an unmapped link. The top view decides
        joinC = 0.5;
        why = `the end points at ${t.id} ${gapM} m ahead with nothing built between them: too far to join on the geometry alone`;
      } else {
        joinC = 0.2;
        why = `the end runs past ${t.id} (${gapM} m away) without pointing at it`;
      }
      const closure = barrier !== undefined ? (GATES.has(barrier) ? 'gate' : 'barricade') : 'dead_end';
      const proposals: Proposal[] = [
        ctx.proposal('connect', { op: 'join_end', edge: e.id, node: n.id, to: t.id, x: r3(join.x), z: r3(join.z), gap_m: gapM }, joinC, { kind: 'join', m: d, supported },
          `The end of ${e.id} stops ${gapM} m from ${t.id} on the same level: ${why}. Join them`, [n, { x: join.x, z: join.z }]),
        ctx.proposal('terminate', { node: n.id, with: closure }, r2(1 - joinC), { kind: joinC === 0.5 ? 'other' : 'dead_end' }, `A real dead end: ${why}. The road is closed here (${closure.replace('_', ' ')})`, [n]),
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
        // most of the lesser way lies on the other: one road drawn twice, the copy goes. A shorter stretch is two real
        // roads that run into each other (a slip road joining): the lane model merges them at their shared node, and the
        // stretch drawn on top is moved apart by the side by side rule
        const share = Math.min(1, Math.round((metres / Math.max(1, lesser.len)) * 100) / 100);
        const twice = share >= 0.6;
        out.push(ctx.issue(overlappingWays, v.at, [e.id, t.id], [e, t], 0.7, `about ${metres} m within ${OVERLAP_GAP} m of each other (${Math.round(share * 100)} percent of ${lesser.id})`, [
          ctx.proposal('remove', { drop: lesser.id }, twice ? 0.85 : 0.4, { kind: 'duplicate_way', share }, `${e.id} and ${t.id} run on top of each other over ${Math.round(share * 100)} percent of ${lesser.id}: one road drawn twice, keep the bigger one`, lesser.pts),
          ctx.proposal('disable_repair', { keep: 'both' }, twice ? 0.15 : 0.6, { kind: 'other' }, 'Two real roads drawn very close for a stretch (a slip road joining, a service lane): both stay, the lane model merges or separates them', [v.at]),
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
