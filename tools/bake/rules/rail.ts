// Metro and rail rules (R-RAIL) on the block graph: an elevated viaduct gets piers, so it may not run along the
// inside of a carriageway that has no median for them; a station links to its line and to the street. Pure.
import { pointInRing, pointSegment } from '../geom.ts';
import type { P2 } from '../geom.ts';
import type { GraphEdge } from '../graph/build.ts';
import type { LineFeature } from '../graph/features.ts';
import { atGrade, projectOn, r3 } from './context.ts';
import type { Rule, RuleContext } from './context.ts';
import { patchOf } from './types.ts';
import type { Issue } from './types.ts';

/** Distance between two piers of a viaduct (m). */
export const PIER_SPACING = 25;
/** Half the width a pier needs clear on the ground (m). */
export const PIER_HALF = 1;

/** Points every `step` metres along a line with the unit direction there. */
function along(pts: readonly P2[], step: number): (P2 & { tx: number; tz: number })[] {
  const out: (P2 & { tx: number; tz: number })[] = [];
  let carry = step / 2;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i] as P2;
    const b = pts[i + 1] as P2;
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (l < 1e-9) continue;
    while (carry <= l) {
      out.push({ x: a.x + ((b.x - a.x) * carry) / l, z: a.z + ((b.z - a.z) * carry) / l, tx: (b.x - a.x) / l, tz: (b.z - a.z) / l });
      carry += step;
    }
    carry -= l;
  }
  return out;
}

export const viaductPiers: Rule = {
  id: 'R-RAIL-01',
  area: 'rail',
  title: 'Viaduct piers would stand in a carriageway',
  confidence: 0.7,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const line of ctx.graph.features.rail) {
      if (!line.bridge || line.layer < 1 || line.len < 2 * PIER_SPACING) continue;
      const hits = new Map<GraphEdge, { n: number; at: P2 }>();
      for (const s of along(line.pts, PIER_SPACING)) {
        for (const c of ctx.near(s, 12)) {
          const t = c.seg.edge;
          if (!atGrade(c.seg.lv) || c.d > t.road.width / 2 - PIER_HALF) continue;
          const l = Math.hypot(c.seg.b.x - c.seg.a.x, c.seg.b.z - c.seg.a.z) || 1;
          // a road crossed at an angle is spanned; a road the viaduct runs along needs a place for every pier
          if (Math.abs((s.tx * (c.seg.b.x - c.seg.a.x) + s.tz * (c.seg.b.z - c.seg.a.z)) / l) < 0.8) continue;
          const prev = hits.get(t);
          if (prev) prev.n++;
          else hits.set(t, { n: 1, at: { x: s.x, z: s.z } });
        }
      }
      for (const [t, h] of hits) {
        if (h.n < 3) continue;
        out.push(ctx.issue(viaductPiers, h.at, [line.id, t.id], [t], 0.7, `${h.n} piers of the ${line.kind} viaduct ${line.name || line.id} fall inside the carriageway of ${t.id}`, [
          ctx.proposal('set_tag', { key: 'bake:median', value: 'pier_strip', on: t.id, width: 2 * PIER_HALF + 0.6, viaduct: line.id }, 0.6, { kind: 'other' }, `The viaduct runs along ${t.id} for about ${h.n * PIER_SPACING} m and the road has no median: give it a pier strip, the lanes pass on both sides`, t.pts),
          ctx.proposal('replace_geometry', { op: 'portal_piers', on: line.id, over: t.id }, 0.3, { kind: 'other' }, 'Or portal frames that stand on both kerbs and span the road', line.pts),
        ]));
      }
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};

/** A station further than this (m) from every line, or from every street, is not linked. */
export const STATION_LINE_M = 150;
export const STATION_STREET_M = 120;

function nearestLine(lines: readonly LineFeature[], p: P2): { line: LineFeature; d: number; x: number; z: number } | null {
  let best: { line: LineFeature; d: number; x: number; z: number } | null = null;
  for (const line of lines) {
    const c = projectOn(p, line.pts);
    if (!best || c.d < best.d) best = { line, d: c.d, x: c.x, z: c.z };
  }
  return best;
}

export const stationLinks: Rule = {
  id: 'R-RAIL-02',
  area: 'rail',
  title: 'Station not linked to its line or to the street',
  confidence: 0.6,
  detect(ctx: RuleContext): Issue[] {
    const out: Issue[] = [];
    for (const st of ctx.graph.features.stations ?? []) {
      const line = nearestLine(ctx.graph.features.rail, st);
      if (!line || line.d > STATION_LINE_M) {
        out.push(ctx.issue(stationLinks, st, [st.id, 'line'], [], 0.6, `${st.name || 'a station'}: ${line ? `the nearest line is ${Math.round(line.d)} m away` : 'no line in the stage'}`, [
          ctx.proposal('connect', { op: 'station_link', station: st.id, to: line ? line.line.id : '', what: 'line' }, 0.5, { kind: 'other' }, `The station ${st.name || st.id} has no track within ${STATION_LINE_M} m: tie it to ${line ? `${line.line.name || line.line.id}, ${Math.round(line.d)} m away` : 'its line when the line is mapped'}`, line ? [st, { x: line.x, z: line.z }] : [st]),
          ctx.proposal('remove', { drop: st.id }, 0.3, { kind: 'other' }, 'Or a station that is not built: leave it out', [st]),
        ], 0.6));
      }
      // a station inside an underground structure (P1-041) is reached by its entrances on the street, not by a forecourt
      const below = (ctx.graph.underground ?? []).some((u) => pointInRing(st, u.ring));
      if (!below && !ctx.near(st, STATION_STREET_M).length) {
        let best: { e: GraphEdge; d: number; x: number; z: number } | null = null;
        for (const s of ctx.segList) {
          const c = pointSegment(st, s.a, s.b);
          if (!best || c.d < best.d) best = { e: s.edge, d: c.d, x: c.x, z: c.z };
        }
        out.push(ctx.issue(stationLinks, st, [st.id, 'street'], best ? [best.e] : [], 0.6, `${st.name || 'a station'}: ${best ? `the nearest street is ${Math.round(best.d)} m away` : 'no street in the stage'}`, [
          ctx.proposal('connect', { op: 'station_link', station: st.id, to: best ? best.e.id : '', what: 'street', x: best ? r3(best.x) : 0, z: best ? r3(best.z) : 0 }, 0.6, { kind: 'other' }, `The station ${st.name || st.id} has no street within ${STATION_STREET_M} m: generate a forecourt path to ${best ? best.e.id : 'the nearest street'}`, best ? [st, { x: best.x, z: best.z }] : [st]),
        ], 0.6));
      }
    }
    return out;
  },
  repair: (i, p) => patchOf(i, p),
};
