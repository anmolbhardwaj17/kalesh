// The production tiles of the pilot centre (P1-016 acceptance), from the pinned stage files in data/pilot_centre/
// (gitignored; the test skips with the reason when they are missing). It runs the whole bake driver into a temp
// report folder and a temp tile folder and reads the health record and the files: every tile written (none over its
// budget or with a bad vertex), collider against drawn on 1,000 seeded points in each of five named tiles, rays every
// 5 cm along the ITO flyover deck, no chunk over 600 triangles, the byte budgets, and every file read back.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../cli.ts';
import { stagePlan } from '../layout/stages.ts';
import { bake, offlineNet } from '../main.ts';
import { decodeT1 } from './codec.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const districts = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness/data/districts.json'), 'utf8'));
const plan = stagePlan(districts, 'pilot', fs.readFileSync(path.join(ROOT, 'harness/data/districts/pilot_centre.geojson'), 'utf8'));
const missing = ['osm.json', 'overture_buildings.json', 'gedtm30_window.json'].filter((f) => !fs.existsSync(path.join(ROOT, plan.def.dataDir, f)));
const reason = missing.length ? `pilot data missing (${missing.join(', ')} in ${plan.def.dataDir}): run npm run bake -- pilot --stage sources` : '';

describe.skipIf(missing.length > 0)(`pilot centre tiles${reason ? ` (skipped: ${reason})` : ''}`, () => {
  let done;
  const baked = () => (done ??= run());
  const run = async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bake-tiles-'));
    const healthFile = path.join(dir, 'health.json');
    const benchDir = path.join(dir, 'gen');
    const out = path.join(dir, 'tiles');
    const lines = [];
    const report = await bake(parseArgs(['pilot', '--offline', '--out', out]), { root: ROOT, net: offlineNet, today: '2026-11-12', log: (l) => lines.push(l), healthFile, benchDir });
    const health = JSON.parse(fs.readFileSync(healthFile, 'utf8'));
    for (const l of lines.filter((x) => x.startsWith('[tiles]'))) console.log(l);
    return { report, health, rec: health.tiles.record, out, index: JSON.parse(fs.readFileSync(path.join(out, 'index.json'), 'utf8')) };
  };
  /** The whole bake runs once, inside the first test that asks for it (about three minutes; longer beside the other pilot tests). */
  const T = 900000;

  it('the bake runs through the tile step: every tile invariant holds, nothing skipped, index.json names every file', async () => {
    const { report, health, rec, index, out } = await baked();
    expect(report.steps).toEqual(['sources', 'ground', 'graph', 'repair', 'lanes', 'elevation', 'mesh', 'terrain', 'tiles']);
    const inv = Object.fromEntries(health.invariants.filter((i) => i.id.startsWith('TILE-')).map((i) => [i.id, i.ok]));
    expect(inv).toEqual({ 'TILE-01.none_skipped': true, 'TILE-02.chunks': true, 'TILE-03.colliders_match_drawn': true, 'TILE-04.deck_rays': true, 'TILE-05.bytes': true });
    expect(rec.skipped).toEqual([]);
    expect(rec.stats.tiles).toBeGreaterThan(300);
    expect(health.tiles.written).toBe(rec.stats.tiles);
    expect(index.tiles).toHaveLength(rec.stats.tiles);
    expect(index.bakeHash).toBe(rec.bakeHash);
    expect(index.blocks).toEqual([{ id: 'centre', tiles: rec.stats.tiles, bytes: rec.stats.bytes }]);
    const files = fs.readdirSync(out).filter((f) => f.endsWith('.ktl')).sort();
    expect(files).toEqual(index.tiles.map((t) => t.file).sort());
    console.log(`[tiles] step ${rec.ms.total} ms (${JSON.stringify(rec.ms)})`);
  }, T);

  it('collider against drawn surface within 0.05 m on 1,000 seeded points in each of the five named tiles', async () => {
    const { rec } = await baked();
    expect(rec.colliders.map((c) => c.name)).toEqual(['Connaught Place', 'the ITO flyover', 'Chandni Chowk', 'India Gate', 'the Yamuna bank']);
    for (const c of rec.colliders) {
      expect(c.points).toBe(1000);
      expect(c.matched).toBe(1000);
      expect(c.holes).toBe(0);
      expect(c.maxDiffM).toBeLessThanOrEqual(0.05);
    }
  }, T);

  it('deck joint test: rays down every 5 cm along the ITO flyover deck never miss the collider', async () => {
    const { rec } = await baked();
    expect(rec.deck.rays).toBeGreaterThan(20000);
    expect(rec.deck.lengthM).toBeGreaterThan(1000);
    expect(rec.deck.misses).toBe(0);
    expect(rec.stats.joints).toBeGreaterThan(100);
  }, T);

  it('no collider chunk has more than 600 triangles; average tile 1.5 MB or less, largest 4 MB or less; every file reads back', async () => {
    const { rec, out, index } = await baked();
    expect(rec.stats.largestChunk).toBeLessThanOrEqual(600);
    console.log(`[tiles] ${rec.stats.tiles} tiles, average ${(rec.stats.averageBytes / 1048576).toFixed(3)} MB, largest ${rec.stats.largest.id} ${(rec.stats.largest.bytes / 1048576).toFixed(3)} MB, ${rec.stats.chunks} chunks (largest ${rec.stats.largestChunk})`);
    expect(rec.stats.averageBytes).toBeLessThanOrEqual(1.5 * 1048576);
    expect(rec.stats.largest.bytes).toBeLessThanOrEqual(4 * 1048576);
    let largest = 0;
    for (const t of index.tiles) {
      const d = decodeT1(new Uint8Array(fs.readFileSync(path.join(out, t.file))));
      expect(d.header.tile).toMatchObject({ district: 'centre', x: t.x, z: t.z, size: 250 });
      for (const c of d.header.colliders) largest = Math.max(largest, c.triangles);
      expect(d.header.nav).toBeNull();
      expect(d.header.life).toBeNull();
      expect(d.header.placements).toEqual([]);
    }
    expect(largest).toBeLessThanOrEqual(600);
  }, T);
});
