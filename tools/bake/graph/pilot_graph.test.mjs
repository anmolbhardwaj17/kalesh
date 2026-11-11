// The block graph of the pilot centre (P1-009 acceptance): built from the pinned stage files in data/pilot_centre/
// (gitignored; the test skips with the reason when they are missing). Checks the topology, the map edge ends, the
// divided streets of harness/data/fixtures/pilot_divided_streets.json, the CP radials, two runs with the same ids and
// hash, the build time, and that the bake driver writes the counts into the health report.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { projector } from '../../geo/projection.ts';
import { pointSegment } from '../geom.ts';
import { parseArgs } from '../cli.ts';
import { stagePlan } from '../layout/stages.ts';
import { bake, offlineNet } from '../main.ts';
import { readGraphInput } from '../sources/graphinput.ts';
import { buildBlockGraph } from './build.ts';
import { checkGraph, graphCounts, graphHash } from './checks.ts';
import { normName } from './pairs.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const districts = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness/data/districts.json'), 'utf8'));
const plan = stagePlan(districts, 'pilot', fs.readFileSync(path.join(ROOT, 'harness/data/districts/pilot_centre.geojson'), 'utf8'));
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness/data/fixtures/pilot_divided_streets.json'), 'utf8'));
const missing = ['osm.json', 'overture_buildings.json'].filter((f) => !fs.existsSync(path.join(ROOT, plan.def.dataDir, f)));
const reason = missing.length ? `pilot data missing (${missing.join(', ')} in ${plan.def.dataDir}): run npm run bake -- pilot --stage sources` : '';

describe.skipIf(missing.length > 0)(`pilot centre block graph${reason ? ` (skipped: ${reason})` : ''}`, () => {
  let input;
  let g1;
  let g2;
  const ms = [];
  const graph = () => {
    if (!g1) {
      input = readGraphInput(ROOT, plan);
      for (let i = 0; i < 2; i++) {
        const t0 = Date.now();
        const g = buildBlockGraph(input);
        ms.push(Date.now() - t0);
        if (i === 0) g1 = g;
        else g2 = g;
      }
      console.log(`[pilot graph] built in ${(ms[0] / 1000).toFixed(2)} s and ${(ms[1] / 1000).toFixed(2)} s; ${JSON.stringify(graphCounts(g1))}`);
    }
    return g1;
  };

  it('builds in under 20 s, twice, with the same ids and the same hash', () => {
    const g = graph();
    expect(Math.max(...ms)).toBeLessThan(20000);
    expect(g2.edges.map((e) => e.id)).toEqual(g.edges.map((e) => e.id));
    expect(g2.nodes.map((n) => n.id)).toEqual(g.nodes.map((n) => n.id));
    expect(g2.footprints.map((f) => f.id)).toEqual(g.footprints.map((f) => f.id));
    expect(graphHash(g2)).toBe(graphHash(g));
  }, 60000);

  it('has no duplicate or zero-length edge, every edge end is a node, every clipped road ends in a map edge end', () => {
    const g = graph();
    const c = checkGraph(g);
    expect(c.duplicateEdges).toEqual([]);
    expect(c.zeroLengthEdges).toEqual([]);
    expect(c.missingNodes).toEqual([]);
    expect(c.orphanNodes).toEqual([]);
    expect(c.crossingsWithoutEnd).toBe(0);
    expect(c.badMapEdgeNodes).toEqual([]);
    const mapEdge = g.nodes.filter((n) => n.kind === 'map_edge');
    expect(mapEdge.length).toBe(g.crossings.length);
    expect(mapEdge.length).toBeGreaterThan(50);
    // ids are source ids plus a part
    expect(g.edges.every((e) => /^w\d+\.\d+$/.test(e.id))).toBe(true);
    expect(g.nodes.every((n) => /^(n\d+|m\d+\.\d+)$/.test(n.id))).toBe(true);
    expect(new Set(g.edges.map((e) => e.id)).size).toBe(g.edges.length);
  }, 60000);

  it.each(fixture.divided.map((d) => [d.name, d]))('finds %s as a pair', (_name, d) => {
    const g = graph();
    const edges = new Map(g.edges.map((e) => [e.id, e]));
    const w = projector(g.origin).toWorld(d.lat, d.lon);
    const near = (e) => {
      let best = Infinity;
      for (let i = 0; i + 1 < e.pts.length; i++) best = Math.min(best, pointSegment(w, e.pts[i], e.pts[i + 1]).d);
      return best;
    };
    const hits = g.pairs.filter((p) => {
      const a = edges.get(p.a);
      const b = edges.get(p.b);
      if (near(a) > 40 || near(b) > 40) return false;
      return !d.osmName || normName(a.name) === normName(d.osmName) || normName(b.name) === normName(d.osmName);
    });
    expect(hits.length).toBeGreaterThan(0);
    for (const p of hits) expect([edges.get(p.a).road.carriageway, edges.get(p.b).road.carriageway]).toEqual(['paired', 'paired']);
  }, 60000);

  it('leaves the Connaught Place radials unpaired one-way streets', () => {
    const g = graph();
    const radials = g.edges.filter((e) => fixture.oneWay.includes(e.name));
    expect(new Set(radials.map((e) => e.name)).size).toBe(fixture.oneWay.length);
    for (const e of radials) {
      expect(e.oneway).toBe(true);
      expect(e.pairedWith).toEqual([]);
      expect(e.road.carriageway).toBe('one_way');
    }
  }, 60000);

  it('the bake driver writes the counts into the health report', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bake-graph-'));
    const healthFile = path.join(dir, 'health.json');
    const lines = [];
    try {
      const report = await bake(parseArgs(['pilot', '--stage', 'graph', '--offline']), { root: ROOT, net: offlineNet, today: '2026-11-11', log: (l) => lines.push(l), healthFile });
      const saved = JSON.parse(fs.readFileSync(healthFile, 'utf8'));
      expect(report.steps).toEqual(['sources', 'ground', 'graph']);
      for (const k of ['nodes', 'edges', 'pairs', 'footprints', 'rail', 'metro', 'water', 'open', 'footBridges', 'mapEdgeEnds']) expect(saved.graph.counts[k]).toBeGreaterThan(0);
      expect(saved.graph.checks.ok).toBe(true);
      expect(saved.graph.hash).toBe(graphHash(graph()));
      expect(lines.some((l) => /\[graph\] built in \d+\.\d\d s/.test(l))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);
});
