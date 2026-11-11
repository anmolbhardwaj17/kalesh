// The carriageway pairs of the Phase 0 road bench site (site.ts): two one-way edges of one street, found on the
// smoothed curves of the prototype graph. The production pairing is graph/pairs.ts. Pure.
import type { P2 } from '../geom.ts';
import type { Curve } from './curve.ts';
import type { GEdge, Graph } from './graph.ts';

/**
 * Pairs of one-way edges that are the two carriageways of one street: same class, close, opposite directions,
 * each on the right of the other (left-hand traffic). One edge can pair with several (a flyover deck runs beside
 * three edges of the other carriageway).
 */
export function pairCarriageways(graph: Graph, maxGap = 40): [number, number][] {
  const out: [number, number][] = [];
  const samples = (c: Curve): { p: P2; tx: number; tz: number }[] => {
    const list = [];
    for (let i = 1; i <= 9; i++) {
      const f = c.smoothAt((c.length * i) / 10);
      list.push({ p: { x: f.x, z: f.z }, tx: f.tx, tz: f.tz });
    }
    return list;
  };
  const hits = (a: GEdge, b: GEdge): number => {
    let n = 0;
    for (const s of samples(a.curve)) {
      const pr = b.curve.project(s.p);
      if (pr.d > maxGap || pr.d < 1 || pr.s < 0.5 || pr.s > b.len - 0.5) continue;
      const f = b.curve.smoothAt(pr.s);
      if (f.tx * s.tx + f.tz * s.tz > -0.7) continue;
      // the other carriageway is on the right of the direction of travel
      if ((f.x - s.p.x) * s.tz + (f.z - s.p.z) * -s.tx > 0) continue;
      n++;
    }
    return n;
  };
  for (const a of graph.edges) {
    if (!a.oneway || a.link || a.len < 30) continue;
    for (const b of graph.edges) {
      if (b.index <= a.index || !b.oneway || b.link || b.cls !== a.cls || b.len < 30) continue;
      if (hits(a, b) >= 3 || hits(b, a) >= 3) out.push([a.index, b.index]);
    }
  }
  return out;
}
