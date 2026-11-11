// Footpath rules (R-FOOT) on the block graph. Footpaths are generated from road edges (tools/bake/graph/classify.ts:
// the class default where the tags say nothing). 01: a short piece with no footpath on a side where the street has
// one before and after it gets one, so the footpath runs on. 02: a footpath strip that lies in another road's
// carriageway (two roads drawn kerb to kerb). Pure.
import type { GraphEdge } from '../graph/build.ts';
import { classDefaults } from '../roads/model.ts';
import { leftOf, sameLevel } from './context.ts';
import type { End, Rule, RuleContext } from './context.ts';
import { patchOf } from './types.ts';
import type { Issue } from './types.ts';

type Side = 'left' | 'right';
const SIDES: readonly Side[] = ['left', 'right'];

/** A footpath gap longer than this (m) is left alone: the data may well be right. */
export const FOOT_GAP_MAX = 120;

/** The footpath width a neighbour has on the side that continues `side` of the edge at `end`. */
function widthBeside(next: End, end: End, side: Side): number {
  // the neighbour runs the same way when it starts where this edge ends (or ends where this one starts)
  const sameWay = next.atStart !== end.atStart;
  const s: Side = sameWay ? side : side === 'left' ? 'right' : 'left';
  return next.edge.road.footpath[s];
}

export const footpathGap: Rule = {
  id: 'R-FOOT-01',
  area: 'footpaths',
  title: 'Footpath missing on a short piece of a street that has one',
  confidence: 0.75,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const e of ctx.graph.edges) {
      if (e.road.link || e.len > FOOT_GAP_MAX || classDefaults(e.road.cls).footpath <= 0) continue;
      const a: End = { edge: e, atStart: true };
      const b: End = { edge: e, atStart: false };
      const before = ctx.through(a);
      const after = ctx.through(b);
      if (!before || !after || before.edge.road.cls !== e.road.cls || after.edge.road.cls !== e.road.cls) continue;
      for (const side of SIDES) {
        if (e.road.footpath[side] > 0) continue;
        // the right side of a paired carriageway is the median (Delhi keeps left)
        if (side === 'right' && e.road.carriageway === 'paired') continue;
        const wb = widthBeside(before, a, side);
        const wa = widthBeside(after, b, side);
        if (wb <= 0 || wa <= 0) continue;
        const width = Math.min(wb, wa);
        const mid = ctx.pointAt(e, e.len / 2);
        out.push(ctx.issue(footpathGap, mid, [e.id, side], [e], 0.75, `no footpath on the ${side} for ${Math.round(e.len)} m, ${wb} m before and ${wa} m after`, [
          ctx.proposal('set_tag', { key: `footpath:${side}`, value: width, on: e.id }, 0.75, { kind: 'other' }, `${e.id} has no footpath on its ${side} side for ${Math.round(e.len)} m while the street has one before and after it: generate ${width} m so the footpath runs on`, e.pts),
          ctx.proposal('disable_repair', { keep: 'gap' }, 0.25, { kind: 'other' }, 'A real gap (a wall or a shop front at the kerb)', [mid]),
        ]));
      }
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};

export const footpathInRoad: Rule = {
  id: 'R-FOOT-02',
  area: 'footpaths',
  title: 'Footpath inside another carriageway',
  confidence: 0.7,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    const step = 10;
    for (const e of ctx.graph.edges) {
      for (const side of SIDES) {
        const fp = e.road.footpath[side];
        if (fp <= 0) continue;
        const hits = new Map<GraphEdge, { n: number; x: number; z: number }>();
        for (const s of ctx.samples(e, step, 25)) {
          const n = leftOf(s.tx, s.tz);
          const k = (side === 'left' ? 1 : -1) * (e.road.width / 2 + fp / 2);
          const p = { x: s.x + n.x * k, z: s.z + n.z * k };
          const lv = ctx.levelAt(e, s.s);
          for (const c of ctx.near(p, 10)) {
            const t = c.seg.edge;
            if (t === e || !sameLevel(c.seg.lv, lv) || c.d > t.road.width / 2 - 0.3) continue;
            // arms of the same junctions meet by design; the other carriageway of the street is the lane fit rule's case
            if (t.a === e.a || t.a === e.b || t.b === e.a || t.b === e.b || e.pairedWith.includes(t.id)) continue;
            const prev = hits.get(t);
            if (prev) prev.n++;
            else hits.set(t, { n: 1, x: p.x, z: p.z });
          }
        }
        for (const [t, h] of hits) {
          if (h.n < 2) continue;
          out.push(ctx.issue(footpathInRoad, h, [e.id, t.id, side], [e, t], 0.7, `the ${side} footpath lies in the carriageway of ${t.id} for about ${h.n * step} m`, [
            ctx.proposal('set_tag', { key: `footpath:${side}`, value: 0, on: e.id }, 0.6, { kind: 'other' }, `The ${fp} m footpath on the ${side} of ${e.id} would lie in the carriageway of ${t.id} for about ${h.n * step} m: the two roads share a kerb here, so no footpath on this side`, e.pts),
            ctx.proposal('move_node', { op: 'shift_apart', a: e.id, b: t.id, min_sep: Math.round((e.road.width / 2 + fp + t.road.width / 2) * 10) / 10 }, 0.3, { kind: 'other' }, 'Or the two roads are drawn too close: move them apart until the footpath fits', t.pts),
          ]));
        }
      }
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};
