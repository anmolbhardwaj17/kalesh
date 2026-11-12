// The constrained Delaunay triangulation of the terrain step (P1-015) on its own: the exact predicates, points
// (every circle empty, every triangle turning the positive way, the box filled exactly), points on edges and on
// each other, forced segments (also through near vertices and across each other), labels that survive a split.
import { describe, expect, it } from 'vitest';
import { rngFor } from '../rand';
import { Cdt } from './cdt';
import { insertSegment, newSegmentStats } from './cdtsegments';
import { CH_BUILDING, CH_ROAD, GRID_LABEL, channelOf, flipLabel, joinLabels, label } from './labels';
import { incircle, orient } from './predicates';

const SIZE = 4000000;

/** Structure checks: neighbours point back, triangles turn the positive way, the areas fill the box. Returns the number of circles that are not empty (constrained edges left out). */
function audit(cdt: Cdt): { notDelaunay: number; area: number } {
  let area = 0;
  let notDelaunay = 0;
  for (let t = 0; t < cdt.nt; t++) {
    const [a, b, c] = [cdt.tv[t * 3] as number, cdt.tv[t * 3 + 1] as number, cdt.tv[t * 3 + 2] as number];
    const o = orient(cdt.x[a]!, cdt.z[a]!, cdt.x[b]!, cdt.z[b]!, cdt.x[c]!, cdt.z[c]!);
    expect(o).toBeGreaterThan(0);
    area += o / 2;
    for (let i = 0; i < 3; i++) {
      const n = cdt.tn[t * 3 + i] as number;
      if (n < 0) continue;
      const j = cdt.slotOf(n, t);
      expect(cdt.tn[n * 3 + j]).toBe(t);
      // the shared edge runs the other way in the neighbour
      expect(cdt.tv[n * 3 + ((j + 1) % 3)]).toBe(cdt.tv[t * 3 + ((i + 2) % 3)]);
      expect(cdt.tv[n * 3 + ((j + 2) % 3)]).toBe(cdt.tv[t * 3 + ((i + 1) % 3)]);
      expect(cdt.constrained(n, j)).toBe(cdt.constrained(t, i));
      if (cdt.constrained(t, i)) continue;
      const d = cdt.tv[n * 3 + j] as number;
      if (incircle(cdt.x[a]!, cdt.z[a]!, cdt.x[b]!, cdt.z[b]!, cdt.x[c]!, cdt.z[c]!, cdt.x[d]!, cdt.z[d]!) > 0) notDelaunay++;
    }
  }
  return { notDelaunay, area };
}

/** True when a chain of constrained edges runs from a to b within `eps` of the straight line. */
function chained(cdt: Cdt, a: number, b: number, eps: number): boolean {
  let at = a;
  for (let guard = 0; guard < 10000 && at !== b; guard++) {
    let next = -1;
    let best = Infinity;
    for (let t = 0; t < cdt.nt; t++) {
      for (let i = 0; i < 3; i++) {
        if (cdt.tv[t * 3 + ((i + 1) % 3)] !== at || !cdt.constrained(t, i)) continue;
        const v = cdt.tv[t * 3 + ((i + 2) % 3)] as number;
        const len = Math.hypot(cdt.x[b]! - cdt.x[a]!, cdt.z[b]! - cdt.z[a]!);
        const off = Math.abs(orient(cdt.x[a]!, cdt.z[a]!, cdt.x[b]!, cdt.z[b]!, cdt.x[v]!, cdt.z[v]!)) / len;
        const left = Math.hypot(cdt.x[b]! - cdt.x[v]!, cdt.z[b]! - cdt.z[v]!);
        if (off <= eps + 1 && left < best && left < Math.hypot(cdt.x[b]! - cdt.x[at]!, cdt.z[b]! - cdt.z[at]!)) {
          best = left;
          next = v;
        }
      }
    }
    if (next < 0) return false;
    at = next;
  }
  return at === b;
}

describe('exact predicates', () => {
  it('the turn test and the circle test give exact signs on whole units', () => {
    expect(orient(0, 0, 10, 0, 5, 1)).toBeGreaterThan(0);
    expect(orient(0, 0, 10, 0, 5, -1)).toBeLessThan(0);
    expect(orient(-20000000, -20000000, 20000000, 20000000, 1, 1)).toBe(0);
    // four corners of a square lie on one circle: exactly 0, also far from the origin
    expect(incircle(0, 0, 10, 0, 10, 10, 0, 10)).toBe(0);
    expect(incircle(19999990, 19999990, 20000000, 19999990, 20000000, 20000000, 19999990, 20000000)).toBe(0);
    expect(incircle(19999990, 19999990, 20000000, 19999990, 20000000, 20000000, 19999991, 19999999)).toBeGreaterThan(0);
    expect(incircle(19999990, 19999990, 20000000, 19999990, 20000000, 20000000, 19999989, 20000000)).toBeLessThan(0);
  });
});

describe('Delaunay points', () => {
  it('3,000 random points: every circle empty, the box filled exactly', () => {
    const r = rngFor(1, 2, 'cdt');
    const cdt = new Cdt(0, 0, SIZE, SIZE, 3000);
    for (let i = 0; i < 3000; i++) cdt.insert(r.int(1, SIZE - 1), r.int(1, SIZE - 1));
    const a = audit(cdt);
    expect(a.notDelaunay).toBe(0);
    expect(a.area).toBe(SIZE * SIZE);
    expect(cdt.nt).toBe(2 * cdt.x.length - 6);
  });

  it('a square lattice (four points on every circle), points on edges and the same point twice', () => {
    const cdt = new Cdt(0, 0, 1000, 1000);
    const ids: number[] = [];
    for (let i = 1; i < 10; i++) for (let j = 1; j < 10; j++) ids.push(cdt.insert(i * 100, j * 100));
    expect(cdt.insert(300, 300)).toBe(ids[2 * 9 + 2]);
    // on the edge between two lattice points, and on a diagonal
    cdt.insert(350, 300);
    cdt.insert(450, 450);
    const a = audit(cdt);
    expect(a.notDelaunay).toBe(0);
    expect(a.area).toBe(1000 * 1000);
  });
});

describe('labels', () => {
  it('count per channel, turn round with the edge and add up', () => {
    const road = label(CH_ROAD, 1);
    expect(channelOf(road, CH_ROAD)).toBe(1);
    expect(channelOf(road, CH_BUILDING)).toBe(0);
    expect(channelOf(flipLabel(road), CH_ROAD)).toBe(-1);
    const both = joinLabels(joinLabels(road, label(CH_BUILDING, 1)), GRID_LABEL);
    expect([channelOf(both, CH_ROAD), channelOf(both, CH_BUILDING)]).toEqual([1, 1]);
    expect(channelOf(joinLabels(road, flipLabel(road)), CH_ROAD)).toBe(0);
    expect(channelOf(flipLabel(flipLabel(both)), CH_BUILDING)).toBe(1);
  });
});

describe('forced segments', () => {
  const setup = (): { cdt: Cdt; ids: number[] } => {
    const r = rngFor(3, 4, 'segments');
    const cdt = new Cdt(0, 0, SIZE, SIZE, 1200);
    cdt.flipLabel = flipLabel;
    cdt.joinLabels = joinLabels;
    const ids: number[] = [];
    for (let i = 0; i < 1200; i++) ids.push(cdt.insert(r.int(1, SIZE - 1), r.int(1, SIZE - 1)));
    return { cdt, ids };
  };

  it('a long segment across 1,200 points becomes a chain of constrained edges and the rest stays a triangulation', () => {
    const { cdt } = setup();
    const a = cdt.insert(100000, 150000);
    const b = cdt.insert(3900000, 3700000);
    const stats = newSegmentStats();
    insertSegment(cdt, a, b, label(CH_ROAD, 1), 8, stats);
    expect(stats.failed).toBe(0);
    expect(chained(cdt, a, b, 8)).toBe(true);
    expect(audit(cdt).area).toBe(SIZE * SIZE);
  });

  it('two segments that cross get a vertex on the crossing, and both keep their labels on both sides of it', () => {
    const { cdt } = setup();
    const a = cdt.insert(500000, 500000);
    const b = cdt.insert(3500000, 3500000);
    const c = cdt.insert(500000, 3500000);
    const d = cdt.insert(3500000, 500000);
    const stats = newSegmentStats();
    const splits: number[] = [];
    cdt.onSplit = (_p, _q, v) => splits.push(v);
    insertSegment(cdt, a, b, label(CH_ROAD, 1), 8, stats);
    insertSegment(cdt, c, d, label(CH_BUILDING, 1), 8, stats);
    expect(stats.failed).toBe(0);
    expect(stats.crossings).toBe(1);
    const mid = splits.find((v) => cdt.x[v] === 2000000 && cdt.z[v] === 2000000);
    expect(mid).toBeDefined();
    expect(chained(cdt, a, b, 8)).toBe(true);
    expect(chained(cdt, c, d, 8)).toBe(true);
    // every constrained edge on the first diagonal carries the road count, seen from a towards b
    let roadEdges = 0;
    for (let t = 0; t < cdt.nt; t++) {
      for (let i = 0; i < 3; i++) {
        if (!cdt.constrained(t, i)) continue;
        const p = cdt.tv[t * 3 + ((i + 1) % 3)] as number;
        const q = cdt.tv[t * 3 + ((i + 2) % 3)] as number;
        const lab = cdt.labelOf(p, q) as number;
        expect(lab).toBeDefined();
        const onFirst = cdt.x[p] === cdt.z[p] && cdt.x[q] === cdt.z[q];
        if (onFirst && cdt.x[q]! > cdt.x[p]!) {
          expect(channelOf(lab, CH_ROAD)).toBe(1);
          roadEdges++;
        }
      }
    }
    expect(roadEdges).toBeGreaterThan(1);
    expect(audit(cdt).area).toBe(SIZE * SIZE);
  });

  it('a vertex two millimetres beside a segment becomes part of it', () => {
    const cdt = new Cdt(0, 0, SIZE, SIZE);
    const a = cdt.insert(1000000, 1000000);
    const b = cdt.insert(3000000, 1000000);
    const near = cdt.insert(2000000, 1000006);
    cdt.insert(2000000, 2500000);
    cdt.insert(2000000, 300000);
    const stats = newSegmentStats();
    insertSegment(cdt, a, b, label(CH_ROAD, 1), 8, stats);
    expect(stats.snapped).toBe(1);
    expect(cdt.findEdge(a, near)).not.toBeNull();
    expect(cdt.labelOf(a, near)).toBeDefined();
    expect(cdt.labelOf(near, b)).toBeDefined();
    expect(cdt.findEdge(a, b)).toBeNull();
  });

  it('400 random segments, many crossing: nothing fails and the triangles still fill the box', () => {
    const { cdt, ids } = setup();
    const r = rngFor(5, 6, 'many');
    const stats = newSegmentStats();
    for (let k = 0; k < 400; k++) {
      const a = ids[r.int(0, ids.length - 1)] as number;
      const b = ids[r.int(0, ids.length - 1)] as number;
      if (Math.hypot(cdt.x[a]! - cdt.x[b]!, cdt.z[a]! - cdt.z[b]!) < 900000) insertSegment(cdt, a, b, label(CH_BUILDING, 1), 8, stats);
    }
    expect(stats.failed).toBe(0);
    expect(stats.crossings).toBeGreaterThan(10);
    expect(audit(cdt).area).toBe(SIZE * SIZE);
  });
});
