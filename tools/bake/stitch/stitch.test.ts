import { describe, expect, it } from 'vitest';
import districtsRaw from '../../../harness/data/districts.json?raw';
import clipCc from '../../../harness/data/districts/chandni_chowk.geojson?raw';
import clipCp from '../../../harness/data/districts/cp.geojson?raw';
import clipIg from '../../../harness/data/districts/india_gate.geojson?raw';
import clipLn from '../../../harness/data/districts/laxmi_nagar.geojson?raw';
import connFlyover from '../../../harness/data/connectors/minto_road_flyover.json?raw';
import connArc from '../../../harness/data/connectors/ring_road_arc.json?raw';
import connBridge from '../../../harness/data/connectors/vikas_marg_bridge.json?raw';
import { projector } from '../../geo/projection';
import { ringArea } from '../geom';
import type { P2 } from '../geom';
import type { Road } from '../osm';
import { Sketch } from '../testmap';
import { decodeT1, encodeT1 } from '../tile';
import { landmarkErrors, layoutChecks, pairCheck, pinCentres, pinName } from './checks';
import type { LandmarkRef } from './checks';
import { clipRoads, mergePorts, offsetRing, portsByClass, rectRing, ringAt, ringGap, ringLength, ringOverlapArea, ringProject } from './clip';
import type { Port } from './clip';
import { buildConnector, connectorLine, connectorRoads, minRadius, radiusCheck, shorten, similarity, specProblems } from './connectors';
import type { ConnectorSpec } from './connectors';
import { draftOffset, forbiddenTransformKeys, frameDifference, geodesic, layoutPair, layoutToWorld, placer, riverLine, transformCheck } from './frames';
import type { DistrictDef, DistrictsFile, Placer } from './frames';
import { closePorts, countClosures } from './ports';
import { Lattice, TILE, TileSet, blendGround, prism, ribbon, riverDepth } from './world';

const file = JSON.parse(districtsRaw) as DistrictsFile;
const clips: Record<string, string> = { cp: clipCp, india_gate: clipIg, chandni_chowk: clipCc, laxmi_nagar: clipLn };
const connectors = [connArc, connFlyover, connBridge].map((raw) => JSON.parse(raw) as ConnectorSpec);
const def = (id: string): DistrictDef => file.districts.find((d) => d.id === id) as DistrictDef;
const square = (x: number, z: number, size: number): P2[] => rectRing({ x, z }, size, size);

/** Roads of a sketch: [x, north] points, so north is up when reading the numbers. */
function roads(build: (s: Sketch) => void): Road[] {
  const s = new Sketch();
  build(s);
  return s.map().roads;
}

describe('district frames (X1)', () => {
  it('puts the world origin at the centre of the layout box, with north on -Z', () => {
    const c = { x: (file.layout.boxKm.x0 + file.layout.boxKm.x1) / 2, y: (file.layout.boxKm.y0 + file.layout.boxKm.y1) / 2 };
    expect(layoutToWorld(file.layout, c.x, c.y)).toEqual({ x: 0, z: -0 });
    expect(layoutToWorld(file.layout, c.x + 1, c.y).x).toBeCloseTo(1000, 9);
    expect(layoutToWorld(file.layout, c.x, c.y + 1).z).toBeCloseTo(-1000, 9);
  });

  it('places every district by the signed seamless method: pivot plus factor times the real vector from India Gate', () => {
    // signed 2026-11-11 (P0-022): the centre block is at factor 1.0, far blocks at 0.5 (decisions.md "Architecture record (P0-022)")
    const seamless = file as unknown as {
      method: { pivot: { lat: number; lon: number; world: { x: number; z: number } }; centreFactor: number; farFactor: number };
      blocks: { id: string; factor: number; frameOrigin: { lat: number; lon: number }; offset: { x: number; z: number } }[];
      districts: (DistrictDef & { block: string })[];
      planned: { id: string; block: string; origin: { lat: number; lon: number }; offset?: { x: number; z: number } }[];
    };
    const { pivot, centreFactor, farFactor } = seamless.method;
    expect(centreFactor).toBe(1);
    expect(farFactor).toBe(0.5);
    const piv = projector(pivot);
    const blockOf = (id: string) => seamless.blocks.find((b) => b.id === id) as { factor: number; frameOrigin: { lat: number; lon: number }; offset: { x: number; z: number } };
    const want = (origin: { lat: number; lon: number }, factor: number) => {
      const v = piv.toWorld(origin.lat, origin.lon);
      return { x: pivot.world.x + factor * v.x, z: pivot.world.z + factor * v.z };
    };
    expect(seamless.districts.map((d) => d.id)).toEqual(['cp', 'india_gate', 'chandni_chowk', 'laxmi_nagar']);
    for (const d of seamless.districts) {
      expect(d.block).toBe('centre');
      const o = want(d.origin, blockOf(d.block).factor);
      expect(Math.abs(o.x - d.offset.x)).toBeLessThan(0.06);
      expect(Math.abs(o.z - d.offset.z)).toBeLessThan(0.06);
      expect(d.heightOffset).toBe(0);
    }
    for (const b of seamless.blocks) {
      const o = want(b.frameOrigin, b.factor);
      expect(Math.abs(o.x - b.offset.x)).toBeLessThan(0.06);
      expect(Math.abs(o.z - b.offset.z)).toBeLessThan(0.06);
    }
    for (const p of seamless.planned.filter((q) => q.offset)) {
      const o = want(p.origin, blockOf(p.block).factor);
      expect(Math.hypot(o.x - (p.offset as { x: number }).x, o.z - (p.offset as { z: number }).z)).toBeLessThan(0.1);
    }
    // centre gate: every pair of centre districts keeps its real bearing within 0.5 degrees and its real distance within 0.5%
    const centre = seamless.districts;
    for (let i = 0; i < centre.length; i++) {
      for (let j = i + 1; j < centre.length; j++) {
        const a = centre[i] as DistrictDef;
        const b = centre[j] as DistrictDef;
        const pair = layoutPair({ name: a.id, geo: a.origin, world: placer(a).toWorld(a.origin.lat, a.origin.lon) }, { name: b.id, geo: b.origin, world: placer(b).toWorld(b.origin.lat, b.origin.lon) });
        expect(pair.bearingErrorDeg).toBeLessThan(0.5);
        expect(pair.errorM / pair.realM).toBeLessThan(0.005);
      }
    }
    // the island draft of layout C is gone: draftOffset no longer gives the placement of Connaught Place
    const cp = def('cp');
    const draft = draftOffset(file.layout, cp.layoutBoxKm, cp.layoutAnchor, cp.origin);
    expect(Math.hypot(draft.x - cp.offset.x, draft.z - cp.offset.z)).toBeGreaterThan(100);
  });

  it('places by translation only: no rotation, no scale, no mirror, north is -Z', () => {
    for (const d of file.districts) {
      const t = transformCheck(placer(d));
      expect(t.ok).toBe(true);
      expect(t.jacobianError).toBeLessThan(1e-9);
      expect(t.handed).toBe(1);
      const p = placer(d);
      const north = p.toWorld(d.origin.lat + 0.001, d.origin.lon);
      const east = p.toWorld(d.origin.lat, d.origin.lon + 0.001);
      expect(north.z).toBeLessThan(d.offset.z);
      expect(east.x).toBeGreaterThan(d.offset.x);
      // a round trip through the world and back
      const g = p.toGeo(p.toWorld(d.layoutAnchor.lat, d.layoutAnchor.lon));
      expect(g.lat).toBeCloseTo(d.layoutAnchor.lat, 7);
      expect(g.lon).toBeCloseTo(d.layoutAnchor.lon, 7);
    }
    expect(forbiddenTransformKeys(file)).toEqual([]);
  });

  it('catches a mirrored or turned placement', () => {
    const d = def('cp');
    const good = placer(d);
    const mirrored: Placer = { ...good, toWorld: (lat, lon) => ({ x: -good.toWorld(lat, lon).x, z: good.toWorld(lat, lon).z }), place: (p) => ({ x: -p.x + d.offset.x, z: p.z + d.offset.z }) };
    const m = transformCheck(mirrored);
    expect(m.ok).toBe(false);
    expect(m.handed).toBe(-1);
    const turned: Placer = { ...good, place: (p) => ({ x: p.x * 0.999 - p.z * 0.04 + d.offset.x, z: p.x * 0.04 + p.z * 0.999 + d.offset.z }) };
    expect(transformCheck(turned).ok).toBe(false);
    expect(forbiddenTransformKeys({ districts: [{ id: 'a', rotationDeg: 3, placement: { scale: 1 } }] })).toEqual(['districts.0.rotationDeg', 'districts.0.placement.scale']);
  });

  it('measures X1 against X2: nothing at the X2 origin, decimetres at the far district', () => {
    const corners = (d: DistrictDef): { name: string; lat: number; lon: number }[] => {
      const p = projector(d.origin);
      return [[-600, -500], [600, -500], [600, 500], [-600, 500]].map(([x, z], i) => ({ name: `corner ${i}`, ...p.toGeo(x as number, z as number) }));
    };
    const ig = frameDifference(def('india_gate'), corners(def('india_gate')), file.x2Origin);
    expect(ig.maxM).toBeLessThan(1e-6);
    const ln = frameDifference(def('laxmi_nagar'), corners(def('laxmi_nagar')), file.x2Origin);
    expect(ln.originDistanceM).toBeGreaterThan(4500);
    expect(ln.maxM).toBeGreaterThan(0.1);
    expect(ln.maxM).toBeLessThan(1);
    // the convergence of X2 there is the longitude difference times the sine of the latitude
    const want = (def('laxmi_nagar').origin.lon - file.x2Origin.lon) * Math.sin((28.63 * Math.PI) / 180);
    expect(Math.abs(Math.abs(ln.convergenceDeg) - want)).toBeLessThan(0.002);
  });

  it('has a geodesic yardstick that shares no code with the projection', () => {
    // one degree along the equator, and a quarter meridian
    expect(geodesic({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }).distanceM).toBeCloseTo(111319.491, 2);
    expect(geodesic({ lat: 0, lon: 0 }, { lat: 90, lon: 0 }).distanceM).toBeCloseTo(10001965.729, 1);
    expect(geodesic({ lat: 28.6, lon: 77.2 }, { lat: 28.61, lon: 77.2 }).bearingDeg).toBeCloseTo(0, 6);
    expect(geodesic({ lat: 28.6, lon: 77.2 }, { lat: 28.6, lon: 77.21 }).bearingDeg).toBeCloseTo(90, 1);
    // the projection keeps a kilometre a kilometre inside a district
    const d = def('chandni_chowk');
    const a = { lat: d.origin.lat + 0.004, lon: d.origin.lon - 0.006 };
    const b = { lat: d.origin.lat - 0.003, lon: d.origin.lon + 0.007 };
    const p = placer(d);
    const pair = layoutPair({ name: 'a', geo: a, world: p.toWorld(a.lat, a.lon) }, { name: 'b', geo: b, world: p.toWorld(b.lat, b.lon) });
    expect(pair.realM).toBeGreaterThan(1400);
    expect(pair.errorM).toBeLessThan(0.002);
    expect(pair.bearingErrorDeg).toBeLessThan(0.005);
  });

  it('draws the layout river west of Laxmi Nagar and east of the core', () => {
    const line = riverLine(file.layout);
    expect(line.length).toBeGreaterThan(10);
    for (const p of line) {
      expect(p.x).toBeGreaterThan(def('chandni_chowk').offset.x + 1400);
      expect(p.x).toBeLessThan(def('laxmi_nagar').offset.x - 500);
    }
    expect((line[0] as P2).z).toBeLessThan((line[line.length - 1] as P2).z);
  });
});

describe('clip polygons and ports (DC1, DC2)', () => {
  it('has a clip polygon per district: closed, WGS84, inside reach of its frame origin', () => {
    for (const d of file.districts) {
      const gj = JSON.parse(clips[d.id] as string) as { features: { geometry: { type: string; coordinates: number[][][] } }[] };
      const ring = (gj.features[0] as { geometry: { type: string; coordinates: number[][][] } }).geometry.coordinates[0] as number[][];
      expect((gj.features[0] as { geometry: { type: string } }).geometry.type).toBe('Polygon');
      expect(ring.length).toBeGreaterThan(8);
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      const p = projector(d.origin);
      const local = ring.slice(0, -1).map(([lon, lat]) => p.toWorld(lat as number, lon as number));
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
    const c = pairCheck([{ id: 'a', ring: square(0, 0, 100) }, { id: 'b', ring: square(60, 0, 100) }, { id: 'c', ring: square(400, 0, 100) }]);
    expect(c.overlapping).toBe(1);
    expect(c.overlapAreaM2).toBeCloseTo(4000, 0);
    expect(c.minGapM).toBe(0);
    const apart = pairCheck([{ id: 'a', ring: square(0, 0, 100) }, { id: 'c', ring: square(400, 0, 100) }]);
    expect(apart.overlapping).toBe(0);
    expect(apart.minGapM).toBeCloseTo(300, 6);
    expect(apart.minGapBetween).toEqual(['a', 'c']);
  });
});

describe('closing the ports (FL1)', () => {
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

describe('connectors (SC1, SC2)', () => {
  it('has three authored connectors that pass the file rules', () => {
    expect(connectors.map((c) => c.kind).sort()).toEqual(['bridge', 'flyover', 'ring_arc']);
    for (const c of connectors) {
      expect(specProblems(c)).toEqual([]);
      expect(forbiddenTransformKeys(c)).toEqual([]);
      expect(file.districts.some((d) => d.id === c.from.district)).toBe(true);
      expect(file.districts.some((d) => d.id === c.to.district)).toBe(true);
      const line = connectorLine(c).pts;
      expect(radiusCheck(line, minRadius(c.class)).violations).toBe(0);
    }
    expect(specProblems({ ...(connectors[0] as ConnectorSpec), class: 'footway', lanes: { forward: 2, backward: 1 }, points: [{ x: 0, z: 0 }] })).toHaveLength(3);
  });

  it('reads the curve radius of a line', () => {
    const circle: P2[] = [];
    for (let i = 0; i <= 90; i++) circle.push({ x: Math.cos((i * Math.PI) / 180) * 60, z: Math.sin((i * Math.PI) / 180) * 60 });
    const tight = radiusCheck(circle, 80);
    expect(tight.minRadiusM).toBeGreaterThan(59);
    expect(tight.minRadiusM).toBeLessThan(61);
    expect(tight.violations).toBe(1);
    expect(radiusCheck(circle, 50).violations).toBe(0);
    expect(radiusCheck([{ x: 0, z: 0 }, { x: 500, z: 0 }], 120).violations).toBe(0);
  });

  it('shortens a real shape by one similarity: every radius shrinks by the ratio', () => {
    const real: P2[] = [];
    for (let i = 0; i <= 180; i += 2) real.push({ x: -Math.cos((i * Math.PI) / 180) * 300, z: -Math.sin((i * Math.PI) / 180) * 300 });
    const s = shorten(real, { x: 1000, z: 1000 }, { x: 1000, z: 1240 });
    expect(s.ratio).toBeCloseTo(0.4, 9);
    expect(s.turnDeg).toBeCloseTo(90, 6);
    expect(s.pts[0]).toEqual({ x: 1000, z: 1000 });
    expect((s.pts[s.pts.length - 1] as P2).z).toBeCloseTo(1240, 6);
    expect(s.lengthM).toBeCloseTo(s.realLengthM * 0.4, 6);
    expect(radiusCheck(real, 200).violations).toBe(0);
    const r = radiusCheck(s.pts, 200);
    expect(r.minRadiusM).toBeGreaterThan(115);
    expect(r.minRadiusM).toBeLessThan(125);
    expect(r.violations).toBe(1);
    const sim = similarity({ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 5, z: 5 }, { x: 5, z: 10 });
    expect(sim.map({ x: 5, z: 0 }).z).toBeCloseTo(7.5, 9);
  });

  const flyover: ConnectorSpec = {
    id: 'test_flyover', name: 'Test Flyover', standsFor: 'a test', kind: 'flyover', status: 'draft', class: 'secondary', lanes: { forward: 2, backward: 2 },
    from: { district: 'a', port: 'A Road' }, to: { district: 'b', port: 'B Road' },
    points: [{ x: 0, z: 0 }, { x: 250, z: 0 }, { x: 650, z: 0 }, { x: 900, z: 40 }],
    spans: [{ from: 1, to: 2, kind: 'bridge', layer: 1, over: 'a cross road' }],
    under: [{ id: 'cross', name: 'Cross Road', class: 'tertiary', lanes: 2, points: [{ x: 450, z: -150 }, { x: 450, z: 150 }] }],
  };

  it('turns a connector into roads of the map model: at grade, bridge, at grade, and what it passes over', () => {
    const rs = connectorRoads(flyover, { x: 1, z: 0 });
    expect(rs.map((r) => r.bridge)).toEqual([false, true, false, false]);
    expect((rs[1] as Road).layer).toBe(1);
    expect((rs[0] as Road).nodes[(rs[0] as Road).nodes.length - 1]).toBe((rs[1] as Road).nodes[0]);
    expect((rs[0] as Road).tags['lanes']).toBe('4');
    expect((rs[3] as Road).name).toBe('Cross Road');
    const line = connectorLine(flyover).pts;
    expect(line[0]).toEqual({ x: 0, z: 0 });
    expect(line[line.length - 1]).toEqual({ x: 900, z: 40 });
  });

  it('builds a connector with the lane model: grades from the ground at its two ends, headroom over the road under it', () => {
    // the far district sits 4 m higher: the connector climbs to it
    const ground = (x: number): number => 210 + Math.max(0, Math.min(4, ((x - 600) / 300) * 4));
    const b = buildConnector(flyover, ground, { x: 1, z: 0 });
    expect(b.site.problems).toEqual([]);
    expect(b.grade.violations).toBe(0);
    expect(b.grade.maxPct).toBeLessThanOrEqual(6.3);
    expect(b.clearanceViolations).toBe(0);
    expect(b.minClearanceM as number).toBeGreaterThanOrEqual(5.5);
    expect(b.structureM).toBeGreaterThan(100);
    expect(Math.abs(b.startH - 210)).toBeLessThan(0.3);
    expect(Math.abs(b.endH - 214)).toBeLessThan(0.3);
    expect(b.radius.violations).toBe(0);
    expect(b.site.checks.overlap.areaM2).toBe(0);
    expect(b.site.checks.continuity.breaks).toBe(0);
    expect(b.site.checks.heights.steps).toBe(0);
    // no ground mesh: the stitched world owns the ground
    expect(b.site.tile.meshes.some((m) => m.material === 'ground')).toBe(false);
  });
});

describe('the stitched world as tiles (FP1)', () => {
  it('cuts geometry into 250 m tiles with vertices relative to the tile', () => {
    const set = new TileSet(200);
    ribbon(set, 'd', 'road', [{ x: 3990, z: -1300 }, { x: 4010, z: -1300 }, { x: 4260, z: -1290 }, { x: 4500, z: -1290 }], 8, () => 215, 0.2);
    const tiles = set.contents();
    expect(tiles.map((t) => [t.tx, t.tz])).toEqual([[15, -6], [16, -6], [17, -6]]);
    for (const t of tiles) {
      expect(t.origin).toEqual([t.tx * TILE, 200, t.tz * TILE]);
      for (const m of t.meshes) {
        for (let i = 0; i < m.pos.length; i += 3) {
          expect(Math.abs(m.pos[i] as number)).toBeLessThan(TILE + 260);
          expect(m.pos[i + 1] as number).toBeCloseTo(15.2, 9);
        }
      }
    }
    // a 32-bit float keeps a tile-relative vertex to 0.03 mm, a world position 4 km out only to 0.25 mm
    const local = 123.4567891;
    expect(Math.abs(Math.fround(local) - local)).toBeLessThan(0.00002);
    expect(Math.abs(Math.fround(4000 + local) - (4000 + local))).toBeGreaterThan(0.00002);
  });

  it('keeps a small object whole in the tile of its anchor', () => {
    const set = new TileSet(0);
    const at = { x: 250.1, z: 0.1 };
    prism(set, 'd', 'pin', square(250, 0, 0.6), 0, 1, 'pin__x__0', at);
    const tiles = set.contents();
    expect(tiles).toHaveLength(1);
    expect((tiles[0] as { tx: number }).tx).toBe(1);
    expect(((tiles[0] as { meshes: { idx: number[] }[] }).meshes[0] as { idx: number[] }).idx.length / 3).toBe(10);
  });

  it('has one ground: the lattice answers the height of the triangles it draws', () => {
    const lat = new Lattice(0, 0, 250, 250, 12.5, (x, z) => 200 + 0.01 * x + 0.02 * z + 0.3 * Math.sin(x / 20));
    const set = new TileSet(190);
    expect(lat.emit(set, () => ({ layer: 'g', material: 'ground' }))).toBe(400);
    const t = set.contents()[0] as { meshes: { pos: number[]; idx: number[] }[]; origin: number[] };
    const m = t.meshes[0] as { pos: number[]; idx: number[] };
    // the centre of every drawn triangle lies on lattice.at
    for (let k = 0; k + 2 < m.idx.length; k += 3 * 37) {
      const v = [0, 1, 2].map((j) => [0, 1, 2].map((c) => m.pos[(m.idx[k + j] as number) * 3 + c] as number));
      const cx = ((v[0] as number[])[0] as number) / 3 + ((v[1] as number[])[0] as number) / 3 + ((v[2] as number[])[0] as number) / 3;
      const cy = ((v[0] as number[])[1] as number) / 3 + ((v[1] as number[])[1] as number) / 3 + ((v[2] as number[])[1] as number) / 3;
      const cz = ((v[0] as number[])[2] as number) / 3 + ((v[1] as number[])[2] as number) / 3 + ((v[2] as number[])[2] as number) / 3;
      expect(lat.at(cx, cz)).toBeCloseTo(cy + 190, 6);
    }
    // the ground under a connector takes its height
    const n = lat.conform([{ x: 100, z: 100, h: 205, reach: 20 }], 0.12);
    expect(n).toBeGreaterThan(4);
    expect(lat.at(100, 100)).toBeCloseTo(204.88, 6);
    expect(lat.at(200, 200)).toBeGreaterThan(205.5);
  });

  it('blends filler ground between district edges and lowers the river bed', () => {
    const a = { ring: square(0, 0, 200), height: () => 210 };
    const b = { ring: square(1000, 0, 200), height: () => 216 };
    const g = blendGround([a, b], [a.ring, b.ring]);
    expect(g(0, 0)).toBe(210);
    expect(g(1000, 50)).toBe(216);
    expect(g(101, 0)).toBeCloseTo(210, 1);
    expect(g(899, 0)).toBeCloseTo(216, 1);
    expect(g(500, 0)).toBeCloseTo(213, 6);
    // the filler takes each district's height at its edge, not the district's ground far outside its data
    const sloped = blendGround([{ ring: a.ring, height: (x: number) => 210 + x * 0.01 }], [a.ring]);
    expect(sloped(5000, 0)).toBeCloseTo(211, 6);
    const river = { line: [{ x: 500, z: -500 }, { x: 500, z: 500 }], width: 200, depth: 5, bank: 40 };
    expect(riverDepth(river, { x: 500, z: 0 })).toBe(5);
    expect(riverDepth(river, { x: 600, z: 0 })).toBe(0);
    expect(riverDepth(river, { x: 580, z: 0 })).toBeCloseTo(2.5, 6);
  });
});

describe('landmarks in the district frame (LP2)', () => {
  const d = def('chandni_chowk');
  const refs: LandmarkRef[] = [
    { id: 'fort', name: 'Fort', district: d.id, osm: 'way/1', points: [{ lat: 28.6562, lon: 77.241 }, { lat: 28.6558, lon: 77.2415 }] },
    { id: 'mosque', name: 'Mosque', district: d.id, osm: 'way/2', points: [{ lat: 28.6507, lon: 77.2334 }] },
  ];
  const bakeTiles = (place: (p: P2) => P2): Uint8Array[] => {
    const set = new TileSet(190);
    const proj = projector(d.origin);
    for (const r of refs) {
      r.points.forEach((geo, k) => {
        const w = place(proj.toWorld(geo.lat, geo.lon));
        prism(set, d.id, 'pin', square(w.x, w.z, 0.6), 215, 215.6, pinName(r.id, k), w);
      });
    }
    return set.contents().map((t) => encodeT1(t));
  };

  it('reads the pins back from the tile bytes within a tenth of a millimetre', () => {
    const tiles = bakeTiles((p) => ({ x: p.x + d.offset.x, z: p.z + d.offset.z }));
    expect(decodeT1(tiles[0] as Uint8Array).header.tile.district).toBe(d.id);
    const errors = landmarkErrors(refs, file.districts, pinCentres(tiles));
    for (const e of errors) {
      expect(e.missing).toBe(0);
      expect(e.maxM).toBeLessThan(0.0001);
    }
    const [pair] = layoutChecks([['mosque', 'fort']], refs, errors);
    // the fort is north east of the mosque, at the true distance
    expect((pair as { bakedBearingDeg: number }).bakedBearingDeg).toBeGreaterThan(20);
    expect((pair as { bakedBearingDeg: number }).bakedBearingDeg).toBeLessThan(70);
    expect((pair as { errorM: number }).errorM).toBeLessThan(0.01);
    expect((pair as { bearingErrorDeg: number }).bearingErrorDeg).toBeLessThan(0.01);
  });

  it('catches a wrong offset, a mirror and a missing pin', () => {
    const shifted = landmarkErrors(refs, file.districts, pinCentres(bakeTiles((p) => ({ x: p.x + d.offset.x + 2, z: p.z + d.offset.z }))));
    expect((shifted[0] as { maxM: number }).maxM).toBeCloseTo(2, 3);
    const mirrored = landmarkErrors(refs, file.districts, pinCentres(bakeTiles((p) => ({ x: -p.x + d.offset.x, z: p.z + d.offset.z }))));
    expect((mirrored[0] as { maxM: number }).maxM).toBeGreaterThan(1000);
    const none = landmarkErrors(refs, file.districts, new Map());
    expect((none[0] as { missing: number }).missing).toBe(2);
  });
});
