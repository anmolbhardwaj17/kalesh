// The ground of the pilot centre (P1-015 acceptance), from the pinned stage files in data/pilot_centre/ (gitignored;
// the test skips with the reason when they are missing). It runs the bake driver through the terrain step into a
// temp report folder and a temp bench folder and reads the health record: the road to ground gap on the sampled
// boundary points, ground above a road, needle triangles, the tile seams, the areas against the stage outline, the
// build time and the same hash twice, and the site tiles of the road bench scene on the production ground with the
// poses the acceptance shots are taken from.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../cli.ts';
import { stagePlan } from '../layout/stages.ts';
import { bake, offlineNet } from '../main.ts';
import { decodeT1 } from '../tile.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const districts = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness/data/districts.json'), 'utf8'));
const plan = stagePlan(districts, 'pilot', fs.readFileSync(path.join(ROOT, 'harness/data/districts/pilot_centre.geojson'), 'utf8'));
const missing = ['osm.json', 'overture_buildings.json', 'gedtm30_window.json'].filter((f) => !fs.existsSync(path.join(ROOT, plan.def.dataDir, f)));
const reason = missing.length ? `pilot data missing (${missing.join(', ')} in ${plan.def.dataDir}): run npm run bake -- pilot --stage sources` : '';

describe.skipIf(missing.length > 0)(`pilot centre ground${reason ? ` (skipped: ${reason})` : ''}`, () => {
  let done;
  const baked = () => (done ??= run());
  const run = async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bake-terrain-'));
    const healthFile = path.join(dir, 'health.json');
    const benchDir = path.join(dir, 'gen');
    const lines = [];
    const report = await bake(parseArgs(['pilot', '--stage', 'terrain', '--offline']), { root: ROOT, net: offlineNet, today: '2026-11-12', log: (l) => lines.push(l), healthFile, benchDir });
    const health = JSON.parse(fs.readFileSync(healthFile, 'utf8'));
    for (const l of lines.filter((x) => x.startsWith('[terrain]'))) console.log(l);
    return { report, health, terrain: health.terrain, benchDir };
  };
  /** The whole bake runs once, inside the first test that asks for it (about two and a half minutes; longer beside the other pilot tests). */
  const T = 600000;

  it('the bake runs through the terrain step: every terrain invariant holds, the ground builds in under 120 s, the same ground twice', async () => {
    const { report, health, terrain } = await baked();
    expect(report.steps).toEqual(['sources', 'ground', 'graph', 'repair', 'lanes', 'elevation', 'mesh', 'terrain']);
    expect(report.stoppedBeforeTiles).toBe(false);
    const inv = Object.fromEntries(health.invariants.filter((i) => i.id.startsWith('TERR-')).map((i) => [i.id, i.ok]));
    expect(inv).toEqual({ 'TERR-01.gap': true, 'TERR-02.nothing_above_the_road': true, 'TERR-03.needles': true, 'TERR-04.seams': true, 'TERR-05.no_hole': true, 'TERR-06.same_twice_in_time': true });
    console.log(`[terrain] build time ${terrain.buildMs} ms (${JSON.stringify(terrain.ms)}), checks ${terrain.checksMs} ms`);
    expect(terrain.buildMs).toBeLessThan(120000);
    expect(terrain.counts.emitted).toBeGreaterThan(500000);
    expect(terrain.counts.tiles).toBeGreaterThan(300);
    expect(terrain.triangulation.segments.failed).toBe(0);
    expect(terrain.triangulation.inconsistent).toBe(0);
  }, T);

  it('road to ground gap 0.02 m or less on the sampled boundary points; 0 ground vertices above a road inside its corridor', async () => {
    const { terrain, health } = await baked();
    expect(terrain.gap.samples).toBeGreaterThan(500000);
    expect(terrain.gap.maxM).toBeLessThanOrEqual(0.02);
    expect(terrain.gap.over2cm).toBe(0);
    expect(health.gates.groundGapMaxM).toBe(terrain.gap.maxM);
    // road edges with no ground along them lie outside the stage or under another road face (the lane model's
    // overlaps); what is left over is a few metres
    expect(terrain.gap.uncoveredM.other).toBeLessThan(10);
    expect(terrain.above.vertices).toBeGreaterThan(300000);
    expect(terrain.above.aboveRoad).toBe(0);
    expect(terrain.above.insideRoadFace).toBe(0);
    expect(terrain.above.underDeck).toBeGreaterThan(500);
    expect(terrain.above.throughDeck).toBe(0);
    expect(terrain.gap.wallSamples).toBeGreaterThan(5000);
    expect(terrain.gap.wallWrongSide).toBe(0);
    expect(health.gates.groundAboveRoad).toBe(0);
    // no height step is left open
    expect(terrain.counts.unresolvedSteps).toBe(0);
  }, T);

  it('triangles with a smallest angle under 1 degree are under 2 percent of the ground (the prototype had 80 percent)', async () => {
    const { terrain, health } = await baked();
    expect(terrain.needles.triangles).toBeGreaterThan(500000);
    expect(terrain.needles.share).toBeLessThan(0.02);
    expect(terrain.needles.under1deg / terrain.needles.triangles).toBeLessThan(0.02);
    expect(health.gates.needleShare).toBe(terrain.needles.share);
    expect(terrain.counts.latticePoints).toBeGreaterThan(30000);
  }, T);

  it('vertices on both sides of every tile seam are equal within 0.0001 m', async () => {
    const { terrain, health } = await baked();
    expect(terrain.seams.edges).toBeGreaterThan(30000);
    expect(terrain.seams.mismatched).toBe(0);
    expect(terrain.seams.matched + terrain.seams.open).toBe(terrain.seams.edges);
    expect(terrain.seams.maxDiffM).toBeLessThanOrEqual(0.0001);
    expect(health.gates.seamMismatches).toBe(0);
  }, T);

  it('no hole: ground plus road plus footpath plus building footprint area equals the stage outline area within 0.1 percent', async () => {
    const { terrain, health } = await baked();
    const a = terrain.area;
    expect(Math.abs(a.outlineM2 - health.outline.areaKm2 * 1e6)).toBeLessThan(a.outlineM2 * 0.001);
    const sum = a.groundM2 + a.lawnM2 + a.waterM2 + a.plotM2 + a.roadFacesM2 + a.droppedM2;
    expect(Math.abs(sum - a.outlineM2) / a.outlineM2).toBeLessThan(0.001);
    expect(a.holeShare).toBeLessThan(0.001);
    // the road faces cut to the outline and the triangles the triangulation gave to the road agree (faces of two levels over each other count twice in the first)
    expect(Math.abs(a.roadFacesM2 - a.roadTrianglesM2)).toBeLessThan(a.roadFacesM2 * 0.001);
    expect(terrain.classes.samples).toBeGreaterThan(200000);
    expect(terrain.classes.holes).toBe(0);
    expect(terrain.classes.mismatches).toBeLessThan(10);
    // hairlines between road pieces that nearly touch are dropped, not drawn
    expect(a.droppedM2).toBeLessThan(0.5);
    expect(health.gates.holeShare).toBe(a.holeShare);
  }, T);

  it('the Yamuna lies flat under its bank; the road bench scene gets every site on the production ground with the poses of the acceptance shots', async () => {
    const { terrain, benchDir } = await baked();
    const river = terrain.waters[0];
    expect(river.areaM2).toBeGreaterThan(200000);
    expect(river.level).toBeLessThan(river.bankMinM);
    const shots = [];
    for (const site of ['ito', 'cp', 'india_gate', 'chandni_chowk', 'yamuna']) {
      const meta = JSON.parse(fs.readFileSync(path.join(benchDir, `${site}.json`), 'utf8'));
      expect(meta.poses[0].name).toBe('top');
      shots.push(...meta.poses.map((p) => p.shot).filter(Boolean));
      const t = decodeT1(new Uint8Array(fs.readFileSync(path.join(benchDir, `${site}.ktl`))));
      const names = t.header.meshes.map((m) => m.material);
      for (const m of ['road', 'ground', 'plot']) expect(names).toContain(m);
      expect(meta.note).toContain('production ground');
    }
    for (const s of ['ground_cp_eye', 'ground_ito_ramp_foot', 'ground_yamuna_bank']) expect(shots).toContain(s);
    const yamuna = decodeT1(new Uint8Array(fs.readFileSync(path.join(benchDir, 'yamuna.ktl')))).header.meshes.map((m) => m.material);
    for (const m of ['water', 'bed']) expect(yamuna).toContain(m);
  }, T);
});
