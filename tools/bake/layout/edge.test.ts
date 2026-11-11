// The map edge (P1-008): outlines, roads cut at an outline, boundary ports and their closures. These tests came with
// the code from the Phase 0 stitch bench (tools/bake/stitch/stitch.test.ts); in the seamless map they cover the places
// where the map really ends (a stage outline, a block's outer edge), not the edges of focus districts.
import { describe, expect, it } from 'vitest';
import districtsRaw from '../../../harness/data/districts.json?raw';
import clipCc from '../../../harness/data/districts/chandni_chowk.geojson?raw';
import clipCp from '../../../harness/data/districts/cp.geojson?raw';
import clipIg from '../../../harness/data/districts/india_gate.geojson?raw';
import clipLn from '../../../harness/data/districts/laxmi_nagar.geojson?raw';
import { ringArea } from '../geom';
import type { P2 } from '../geom';
import type { Road } from '../osm';
import { Sketch } from '../testmap';
import { closePorts, countClosures } from './closures';
import { clipRoads, mergePorts, offsetRing, portsByClass, rectRing, ringAt, ringGap, ringLength, ringOverlapArea, ringProject } from './edge';
import type { Port } from './edge';
import { ringPairs } from './gate';
import { outlineRing, readOutline, ringProblems } from './outline';
import type { LayoutFile } from './placement';

const file = JSON.parse(districtsRaw) as LayoutFile;
const outlines: Record<string, string> = { cp: clipCp, india_gate: clipIg, chandni_chowk: clipCc, laxmi_nagar: clipLn };
const square = (x: number, z: number, size: number): P2[] => rectRing({ x, z }, size, size);

/** Roads of a sketch: [x, north] points, so north is up when reading the numbers. */
function roads(build: (s: Sketch) => void): Road[] {
  const s = new Sketch();
  build(s);
  return s.map().roads;
}

describe('outlines, the map edge and its ports (DC2)', () => {
  it('has an outline per focus district: closed, WGS84, a simple ring near its own origin', () => {
    for (const d of file.districts) {
      const o = readOutline(outlines[d.id] as string, d.id);
      expect(d.outline).toBe(`districts/${d.id}.geojson`);
      expect(o.coords.length).toBeGreaterThan(8);
      expect(o.coords[0]).toEqual(o.coords[o.coords.length - 1]);
      const local = outlineRing(o.coords, d.origin as { lat: number; lon: number });
      expect(ringProblems(local), d.id).toEqual([]);
      for (const q of local) expect(Math.hypot(q.x, q.z)).toBeLessThan(2500);
      expect(Math.abs(ringArea(local))).toBeGreaterThan(0.3e6);
    }
  });

  it('walks a ring and knows its outside', () => {
    const ring = square(0, 0, 100);
    expect(ringLength(ring)).toBeCloseTo(400, 9);
    for (let s = 5; s < 400; s += 50) {
      const q = ringAt(ring, s);
      // a step along the normal leaves the square
      expect(Math.max(Math.abs(q.x + q.nx), Math.abs(q.z + q.nz))).toBeGreaterThan(50);
    }
    expect(ringProject(ring, { x: 60, z: 0 }).d).toBeCloseTo(10, 9);
    // grown by 10 m: the corners are cut, so the area lies between the rounded offset's and the square's
    const grown = offsetRing(ring, 10);
    expect(Math.abs(ringArea(grown))).toBeGreaterThan(14100);
    expect(Math.abs(ringArea(grown))).toBeLessThan(120 * 120 + 1);
  });

  it('cuts roads at the ring and reports where they leave', () => {
    const ring = square(0, 0, 200);
    const rs = roads((s) => {
      s.way([[-300, 0], [300, 0]], { highway: 'primary', name: 'Through Road' });
      s.way([[0, 0], [0, 300]], { highway: 'residential', name: 'North Lane' });
      s.way([[-50, 50], [50, 50]], { highway: 'service' });
      s.way([[200, -300], [200, 300]], { highway: 'trunk' });
    });
    const c = clipRoads(rs, ring);
    expect(c.inside).toHaveLength(3);
    expect(c.crossings).toHaveLength(3);
    const north = c.crossings.find((x) => x.road.name === 'North Lane') as { x: number; z: number; dx: number; dz: number };
    // north is -Z: the lane leaves the square at z = -100 heading -Z
    expect(north.z).toBeCloseTo(-100, 6);
    expect(north.dz).toBeCloseTo(-1, 6);
    const through = c.inside.find((x) => x.road.name === 'Through Road') as { pts: P2[] };
    expect((through.pts[0] as P2).x).toBeCloseTo(-100, 6);
    expect((through.pts[through.pts.length - 1] as P2).x).toBeCloseTo(100, 6);
  });

  it('keeps a short excursion whole and drops a nick', () => {
    const ring = square(0, 0, 200);
    const rs = roads((s) => {
      // leaves by 20 m and comes back: the far carriageway of the street the line follows
      s.way([[-80, 90], [-40, 90], [-20, 120], [20, 120], [40, 90], [80, 90]], { highway: 'secondary', name: 'Edge Road' });
      // clips a corner of the square for 14 m
      s.way([[60, 130], [130, 60]], { highway: 'residential', name: 'Corner Lane' });
    });
    const c = clipRoads(rs, ring);
    expect(c.excursions).toBe(1);
    expect(c.nicks).toBe(1);
    expect(c.crossings).toHaveLength(0);
    expect(c.inside).toHaveLength(1);
  });

  it('keeps the way out of the district when it starts just inside the line', () => {
    const ring = square(0, 0, 200);
    const s = new Sketch();
    // a street inside that ends 4 m before the line; a second way goes on from that node and leaves
    const end = s.node(96, 0);
    s.way([[0, 0], end], { highway: 'secondary', name: 'Inside Road' });
    s.way([end, [300, 0]], { highway: 'secondary', name: 'Way Out' });
    // a way that only starts 4 m inside, joined to nothing: a loose end, dropped
    s.way([[0, 97], [0, 300]], { highway: 'residential', name: 'Loose End' });
    const c = clipRoads(s.map().roads, ring);
    expect(c.crossings.map((x) => x.road.name)).toEqual(['Way Out']);
    expect(c.nicks).toBe(1);
    expect((c.crossings[0] as { x: number }).x).toBeCloseTo(100, 6);
    expect(c.inside.map((x) => x.road.name).sort()).toEqual(['Inside Road', 'Way Out']);
  });

  it('joins the two carriageways of a street into one port and counts ports by class', () => {
    const ring = square(0, 0, 200);
    const rs = roads((s) => {
      s.way([[0, 6], [300, 6]], { highway: 'primary', oneway: 'yes', name: 'Big Road' });
      s.way([[300, -6], [0, -6]], { highway: 'primary', oneway: 'yes', name: 'Big Road' });
      s.way([[0, 60], [300, 60]], { highway: 'residential' });
      s.way([[0, 0], [-300, 0]], { highway: 'service' });
    });
    const ports = mergePorts(clipRoads(rs, ring).crossings, ring, 't');
    expect(ports).toHaveLength(3);
    const big = ports.find((p) => p.big) as Port;
    expect(big.ways).toHaveLength(2);
    expect(big.x).toBeCloseTo(100, 6);
    expect(big.dx).toBeCloseTo(1, 6);
    expect(portsByClass(ports)).toEqual({ primary: 1, residential: 1, service: 1 });
    expect(ports.map((p) => p.id)).toEqual(['t:p00', 't:p01', 't:p02']);
  });

  it('measures overlap and gap between placed rings', () => {
    expect(ringOverlapArea(square(0, 0, 100), square(60, 0, 100))).toBeCloseTo(4000, 3);
    expect(ringOverlapArea(square(0, 0, 100), square(200, 0, 100))).toBe(0);
    expect(ringGap(square(0, 0, 100), square(200, 0, 100))).toBeCloseTo(100, 9);
    expect(ringGap(square(0, 0, 100), square(20, 0, 20))).toBe(0);
    const c = ringPairs([{ id: 'a', ring: square(0, 0, 100) }, { id: 'b', ring: square(60, 0, 100) }, { id: 'c', ring: square(400, 0, 100) }]);
    expect(c.overlapping).toBe(1);
    expect(c.overlapAreaM2).toBeCloseTo(4000, 0);
    expect(c.minGapM).toBe(0);
    const apart = ringPairs([{ id: 'a', ring: square(0, 0, 100) }, { id: 'c', ring: square(400, 0, 100) }]);
    expect(apart.overlapping).toBe(0);
    expect(apart.minGapM).toBeCloseTo(300, 6);
    expect(apart.minGapBetween).toEqual(['a', 'c']);
  });
});

describe('closing the ports at the map edge (FL1)', () => {
  const ring = square(0, 0, 400);
  const port = (id: string, x: number, z: number, cls: string, big = false): Port => {
    const dx = Math.abs(x) === 200 ? Math.sign(x) : 0;
    const dz = Math.abs(z) === 200 ? Math.sign(z) : 0;
    return { id, x, z, dx, dz, cls, link: false, name: id, ways: [`way/${id}`], width: big ? 14 : 5, s: ringProject(ring, { x, z }).s, big };
  };

  it('gives every port exactly one closure', () => {
    const ports = [port('a', -100, -200, 'residential'), port('b', -40, -200, 'residential'), port('c', 200, 0, 'residential'), port('d', 0, 200, 'service'), port('e', -200, 100, 'pedestrian'), port('f', 200, 150, 'primary', true), port('g', -200, -100, 'secondary', true)];
    const closures = closePorts(ports, ring, new Map([['f', 'ring_road']]));
    const kinds = new Map(closures.flatMap((c) => c.ports.map((id) => [id, c.kind] as [string, string])));
    expect(kinds.size).toBe(ports.length);
    expect(kinds.get('a')).toBe('street_net');
    expect(kinds.get('b')).toBe('street_net');
    expect(kinds.get('c')).toBe('loop');
    expect(kinds.get('d')).toBe('gate');
    expect(kinds.get('e')).toBe('dead_end');
    expect(kinds.get('f')).toBe('connector');
    expect(kinds.get('g')).toBe('open');
    const n = countClosures(ports, closures);
    expect(n.auto).toBe(5);
    expect(n.authored).toBe(1);
    expect(n.open).toBe(1);
    expect(n.autoShare).toBeCloseTo(5 / 7, 9);
    // the generated back street runs outside the ring
    const net = closures.find((c) => c.kind === 'street_net') as { streets: P2[][] };
    for (const p of net.streets[0] as P2[]) expect(p.z).toBeLessThan(-200);
    // every dead end and open port says why
    for (const c of closures) expect(c.reason.length).toBeGreaterThan(10);
  });

  it('does not run a back street across a big road, into a neighbour or without room', () => {
    const ports = [port('a', -60, -200, 'residential'), port('m', 0, -200, 'primary', true), port('b', 60, -200, 'residential')];
    const split = closePorts(ports, ring, new Map());
    expect(split.filter((c) => c.kind === 'street_net')).toHaveLength(0);
    expect(split.filter((c) => c.kind === 'loop')).toHaveLength(2);
    const two = [port('a', -60, -200, 'residential'), port('b', 60, -200, 'residential')];
    const blocked = closePorts(two, ring, new Map(), { chainGap: 140, setback: 26, loopRadius: 9, blocked: () => 'it runs into the river' });
    expect(blocked.map((c) => c.kind)).toEqual(['dead_end', 'dead_end']);
    expect(blocked.every((c) => c.review && c.reason.includes('river'))).toBe(true);
  });
});
