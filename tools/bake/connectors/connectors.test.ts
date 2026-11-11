// Connectors (P1-008): the authored corridor format and its build through the lane model. Moved with the code from the
// Phase 0 stitch bench (tools/bake/stitch/stitch.test.ts). The three files in harness/data/connectors/ stay as data,
// marked bench_only: they were placed for the island layout.
import { describe, expect, it } from 'vitest';
import districtsRaw from '../../../harness/data/districts.json?raw';
import connFlyover from '../../../harness/data/connectors/minto_road_flyover.json?raw';
import connArc from '../../../harness/data/connectors/ring_road_arc.json?raw';
import connBridge from '../../../harness/data/connectors/vikas_marg_bridge.json?raw';
import type { P2 } from '../geom';
import type { Road } from '../osm';
import { forbiddenTransformKeys } from '../layout/placement';
import type { LayoutFile } from '../layout/placement';
import { buildConnector, connectorLine, connectorRoads, endBlock, minRadius, radiusCheck, shorten, similarity, specProblems } from './connectors';
import type { ConnectorSpec } from './connectors';

const file = JSON.parse(districtsRaw) as LayoutFile;
const connectors = [connArc, connFlyover, connBridge].map((raw) => JSON.parse(raw) as ConnectorSpec);

describe('connectors (SC1)', () => {
  it('has three authored connectors that pass the file rules', () => {
    expect(connectors.map((c) => c.kind).sort()).toEqual(['bridge', 'flyover', 'ring_arc']);
    for (const c of connectors) {
      expect(specProblems(c)).toEqual([]);
      expect(forbiddenTransformKeys(c)).toEqual([]);
      // the three files are bench only: their ends still name the island districts of the Phase 0 bench
      expect(c.status).toBe('bench_only');
      expect(file.districts.some((d) => d.id === endBlock(c.from))).toBe(true);
      expect(file.districts.some((d) => d.id === endBlock(c.to))).toBe(true);
      const line = connectorLine(c).pts;
      expect(radiusCheck(line, minRadius(c.class)).violations).toBe(0);
    }
    expect(specProblems({ ...(connectors[0] as ConnectorSpec), class: 'footway', lanes: { forward: 2, backward: 1 }, points: [{ x: 0, z: 0 }] })).toHaveLength(3);
    // a production connector names the block at each end
    expect(specProblems({ ...(connectors[0] as ConnectorSpec), from: { block: 'centre', port: 'Aurobindo Marg' }, to: { block: 'qutub_mehrauli', port: 'Aurobindo Marg' } })).toEqual([]);
    expect(specProblems({ ...(connectors[0] as ConnectorSpec), from: { port: 'Aurobindo Marg' } })).toEqual(['from must name a block and the road at its port']);
    expect(specProblems({ ...(connectors[0] as ConnectorSpec), rotation: 3 } as unknown as ConnectorSpec)).toEqual(['key rotation: a connector has no rotation, scale or mirror']);
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
    from: { block: 'a', port: 'A Road' }, to: { block: 'b', port: 'B Road' },
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
