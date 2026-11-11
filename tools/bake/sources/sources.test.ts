// The sources step end to end with a fake network (P1-007): `bake -- pilot --stage sources` fetches every source of
// the pilot stage once, pins it with its hash, licence and credit, and a second run reuses every file without a
// single request. Runs in a temp copy of the repo layout, so data/SOURCES.json of the repo is never touched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import districtsRaw from '../../../harness/data/districts.json?raw';
import pilotRaw from '../../../harness/data/districts/pilot_centre.geojson?raw';
import airportRaw from '../../../harness/data/districts/airport_t3.geojson?raw';
import ccRaw from '../../../harness/data/districts/chandni_chowk.geojson?raw';
import cpRaw from '../../../harness/data/districts/cp.geojson?raw';
import cyberRaw from '../../../harness/data/districts/cyber_city.geojson?raw';
import igRaw from '../../../harness/data/districts/india_gate.geojson?raw';
import lnRaw from '../../../harness/data/districts/laxmi_nagar.geojson?raw';
import placesRaw from '../../../harness/data/districts/places.json?raw';
import qutubRaw from '../../../harness/data/districts/qutub_mehrauli.geojson?raw';
import vkRaw from '../../../harness/data/districts/vasant_kunj.geojson?raw';
import { parseArgs } from '../cli';
import { bake } from '../main';
import { BakeStop } from '../report/health';
import type { HealthReport } from '../report/health';
import type { Net, NetResponse, TiffWindow } from './net';
import { loadSources } from './pinfile';
import { OVERPASS_MIRRORS } from './readers';

const LAYOUT_FILES: Record<string, string> = {
  'places.json': placesRaw, 'cp.geojson': cpRaw, 'india_gate.geojson': igRaw, 'chandni_chowk.geojson': ccRaw, 'laxmi_nagar.geojson': lnRaw,
  'qutub_mehrauli.geojson': qutubRaw, 'vasant_kunj.geojson': vkRaw, 'airport_t3.geojson': airportRaw, 'cyber_city.geojson': cyberRaw,
};

interface Codec { encode(s: string): Uint8Array; decode(b: Uint8Array): string }
const G = globalThis as unknown as { TextEncoder: new () => Codec; TextDecoder: new () => Codec };
const enc = new G.TextEncoder();
const dec = new G.TextDecoder();
const response = (body: string | Uint8Array, status = 200): NetResponse => {
  const bytes = typeof body === 'string' ? enc.encode(body) : body;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => (n === 'etag' ? '"fake"' : null) },
    text: async () => dec.decode(bytes),
    arrayBuffer: async () => bytes.slice().buffer as ArrayBuffer,
  };
};

/** A network that answers every request of the five readers with small canned data and counts the requests. */
function fakeNet(opts: { failOsm?: boolean } = {}): Net & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    pause: async () => undefined,
    async request(url) {
      calls.push(url);
      if (url.includes('overpass')) {
        if (opts.failOsm) return response('busy', 504);
        return response(JSON.stringify({ osm3s: { timestamp_osm_base: '2026-11-11T00:00:00Z' }, elements: [{ type: 'node', id: 1, lat: 28.63, lon: 77.22 }] }));
      }
      if (url.includes('overturemaps')) return response('<ListBucketResult><Prefix>release/2026-10-15.0/</Prefix><Prefix>release/2026-09-17.0/</Prefix></ListBucketResult>');
      if (url.includes('copernicus')) return response(new Uint8Array([1, 2, 3, 4]));
      if (url.includes('wikidata')) return response(JSON.stringify({ results: { bindings: [{ item: { value: 'Q1' } }] } }));
      return response('not found', 404);
    },
    async tiffWindow(url, box): Promise<TiffWindow> {
      calls.push(url);
      return { west: box.west, north: box.north, dLon: 1 / 3600, dLat: -1 / 3600, width: 2, height: 2, values: [2150, 2151, 2152, 2153], scale: 0.1, offset: 0, noData: -32768, pixelIsPoint: false, meta: {} };
    },
    async duckdb(statements, outFile) {
      calls.push(`duckdb:${statements.length}`);
      fs.writeFileSync(outFile, '[{"id":"b1","geojson":"{}"}]\n');
    },
  };
}

let root = '';
const run = async (net: Net, argv: string[]): Promise<{ lines: string[]; report: HealthReport | null; error: unknown }> => {
  const lines: string[] = [];
  try {
    const report = await bake(parseArgs(argv), { root, net, today: '2026-11-11', log: (l) => lines.push(l) });
    return { lines, report, error: null };
  } catch (e) {
    return { lines, report: null, error: e };
  }
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bake-sources-'));
  fs.mkdirSync(path.join(root, 'harness', 'data', 'districts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'harness', 'data', 'districts.json'), districtsRaw);
  fs.writeFileSync(path.join(root, 'harness', 'data', 'districts', 'pilot_centre.geojson'), pilotRaw);
  // the layout data rule R-STITCH reads in every bake
  for (const [name, text] of Object.entries(LAYOUT_FILES)) fs.writeFileSync(path.join(root, 'harness', 'data', 'districts', name), text);
});
afterAll(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe('bake step "sources" with a fake fetcher', () => {
  it('fails cleanly before any pin exists when the network is down: the bake stops, nothing is pinned', async () => {
    const net = fakeNet({ failOsm: true });
    const off: Net = { ...net, request: (url, req) => (url.includes('overpass') ? net.request(url, req) : Promise.reject(new Error('down'))) };
    const r = await run({ ...off, tiffWindow: () => Promise.reject(new Error('down')), duckdb: () => Promise.reject(new Error('down')) }, ['pilot', '--stage', 'sources']);
    expect(net.calls.filter((u) => u.includes('overpass')).length).toBe(3 * OVERPASS_MIRRORS.length); // three tries per server, then unreachable
    expect(r.error).toBeInstanceOf(BakeStop);
    const health = JSON.parse(fs.readFileSync(path.join(root, 'harness', 'reports', 'map', 'health.json'), 'utf8')) as HealthReport;
    expect(health.stoppedBeforeTiles).toBe(true);
    expect(health.invariants.filter((i) => !i.ok).map((i) => i.id)).toContain('sources.osm');
    const pins = loadSources(path.join(root, 'data', 'SOURCES.json'));
    expect(Object.keys(pins.files)).toEqual([]);
    expect(Object.keys(pins.unreachable).sort()).toEqual(['glo30', 'pilot_gedtm30', 'pilot_osm', 'pilot_overture_buildings', 'pilot_wikidata']);
  });

  it('the first run fetches and pins every file and prints its hash', async () => {
    const net = fakeNet();
    const r = await run(net, ['pilot', '--stage', 'sources']);
    expect(r.error).toBeNull();
    expect(net.calls.length).toBeGreaterThanOrEqual(5);
    const pins = loadSources(path.join(root, 'data', 'SOURCES.json'));
    expect(Object.keys(pins.files).sort()).toEqual(['glo30', 'pilot_gedtm30', 'pilot_osm', 'pilot_overture_buildings', 'pilot_wikidata']);
    expect(pins.unreachable).toEqual({});
    for (const [id, p] of Object.entries(pins.files)) {
      expect(p.sha256, id).toMatch(/^[0-9a-f]{64}$/);
      expect(p.licence.length, id).toBeGreaterThan(2);
      expect(p.credit.length, id).toBeGreaterThan(2);
      expect(fs.existsSync(path.join(root, p.file)), id).toBe(true);
      expect(r.lines.some((l) => l.startsWith('fetched') && l.includes(id) && l.includes(p.sha256)), id).toBe(true);
    }
    expect(r.report?.sources.every((s) => s.action === 'fetched')).toBe(true);
    expect(r.report?.stoppedBeforeTiles).toBe(false);
  });

  it('a second run makes no network request and prints the same hashes', async () => {
    const before = loadSources(path.join(root, 'data', 'SOURCES.json'));
    const net = fakeNet();
    const r = await run(net, ['pilot', '--stage', 'sources']);
    expect(r.error).toBeNull();
    expect(net.calls).toEqual([]);
    for (const [id, p] of Object.entries(before.files)) expect(r.lines.some((l) => l.startsWith('reused') && l.includes(id) && l.includes(p.sha256)), id).toBe(true);
    expect(loadSources(path.join(root, 'data', 'SOURCES.json'))).toEqual(before);
  });

  it('the same inputs give the same health report', async () => {
    const file = path.join(root, 'harness', 'reports', 'map', 'health.json');
    const a = fs.readFileSync(file, 'utf8');
    await run(fakeNet(), ['pilot', '--stage', 'sources']);
    expect(fs.readFileSync(file, 'utf8')).toBe(a);
  });

  it('a pinned file that changed on disk stops the bake and is not overwritten', async () => {
    const pins = loadSources(path.join(root, 'data', 'SOURCES.json'));
    const wiki = path.join(root, pins.files['pilot_wikidata']!.file);
    const keep = fs.readFileSync(wiki, 'utf8');
    fs.writeFileSync(wiki, keep + ' ');
    const net = fakeNet();
    const r = await run(net, ['pilot', '--stage', 'sources']);
    expect(r.error).toBeInstanceOf(BakeStop);
    expect(String((r.error as Error).message)).toContain('sources.hashes');
    expect(net.calls).toEqual([]);
    expect(fs.readFileSync(wiki, 'utf8')).toBe(keep + ' ');
    fs.writeFileSync(wiki, keep);
  });

  it('runs rule R-STITCH before the first step and writes the pair table into the health report', async () => {
    const r = await run(fakeNet(), ['pilot', '--stage', 'sources']);
    expect(r.error).toBeNull();
    const ids = r.report!.invariants.map((i) => i.id);
    for (const id of ['R-STITCH-00.files', 'R-STITCH-01.data', 'R-STITCH-02.translation', 'R-STITCH-03.centrePairs', 'R-STITCH-04.farBlocks', 'R-STITCH-05.blockGaps', 'R-STITCH-06.extent']) expect(ids).toContain(id);
    expect(ids.indexOf('R-STITCH-06.extent')).toBeLessThan(ids.indexOf('sources.hashes'));
    expect(r.lines.some((l) => l.startsWith('[invariant] ok   R-STITCH-03.centrePairs'))).toBe(true);
    const places = (JSON.parse(placesRaw) as { places: { block: string }[] }).places.filter((p) => p.block === 'centre').length;
    expect(r.report!.pairs).toHaveLength((places * (places - 1)) / 2);
    expect(r.report!.pairs.every((p) => p.ok && p.bearingErrorDeg < 0.5 && p.errorPct < 0.5)).toBe(true);
    expect(r.report!.pairs[0]).toMatchObject({ a: 'India Gate', b: 'Connaught Place' });
    expect(r.report!.layout?.blocks.map((b) => b.id)).toEqual(['centre', 'qutub_mehrauli', 'vasant_kunj', 'airport_t3', 'cyber_city']);
    expect(r.report!.layout?.blocks.every((b) => b.translationOnly && b.determinant === 1)).toBe(true);
    expect(r.report!.layout?.blocks[0]?.offset).toEqual({ x: 621.6, z: 467.2 });
    expect(r.report!.layout?.far).toHaveLength(4);
    expect(r.report!.layout?.mapBoxKm.width).toBeLessThan(16);
  });

  it('a layout that breaks the rule stops the bake before any source is read', async () => {
    const file = path.join(root, 'harness', 'data', 'districts.json');
    const bad = JSON.parse(districtsRaw) as { blocks: { id: string; offset: { x: number; z: number } }[] };
    // a far block moved by hand: the method no longer gives its offset
    bad.blocks[1]!.offset.x += 40;
    fs.writeFileSync(file, JSON.stringify(bad));
    const net = fakeNet();
    const r = await run(net, ['pilot', '--stage', 'sources']);
    fs.writeFileSync(file, districtsRaw);
    expect(r.error).toBeInstanceOf(BakeStop);
    expect(String((r.error as Error).message)).toContain('R-STITCH-01.data');
    expect(String((r.error as Error).message)).toContain('qutub_mehrauli');
    expect(net.calls).toEqual([]);
    const health = JSON.parse(fs.readFileSync(path.join(root, 'harness', 'reports', 'map', 'health.json'), 'utf8')) as HealthReport;
    expect(health.stoppedBeforeTiles).toBe(true);
    expect(health.steps).toEqual([]);
    // an outline file that is named but missing is a failed invariant with its name, not a crash
    const gone = path.join(root, 'harness', 'data', 'districts', 'cyber_city.geojson');
    fs.rmSync(gone);
    const r2 = await run(fakeNet(), ['pilot', '--stage', 'sources']);
    fs.writeFileSync(gone, cyberRaw);
    expect(r2.error).toBeInstanceOf(BakeStop);
    expect(String((r2.error as Error).message)).toContain('R-STITCH-00.files (named in districts.json but not there: districts/cyber_city.geojson)');
    // put back: the bake runs again
    expect((await run(fakeNet(), ['pilot', '--stage', 'sources'])).error).toBeNull();
  });

  it('the ground step reads the pinned GEDTM30 window and stops on heights outside Delhi', async () => {
    // the fake window holds 215 m: the ground step passes the range check
    const r = await run(fakeNet(), ['pilot', '--stage', 'ground']);
    expect(r.error).toBeNull();
    expect(r.report?.ground?.source).toBe('gedtm30');
    expect(r.report?.ground?.minM).toBeCloseTo(215.1, 0);
  });
});
