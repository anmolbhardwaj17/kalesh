// The road mesh of the pilot centre (P1-014 acceptance), from the pinned stage files in data/pilot_centre/
// (gitignored; the test skips with the reason when they are missing). It runs the bake driver through the mesh step
// into a temp report folder and a temp bench folder and reads the health record: the overlap proof at every
// junction, the watertight surface, ends, parapets and piers, kerb heights, the lane UV, the stop lines, the build
// time, and the stand-in tiles of the road bench scene. Counts that are not zero on the pilot are held at what was
// measured, each with its reason, so a change shows.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../cli.ts';
import { stagePlan } from '../layout/stages.ts';
import { bake, offlineNet } from '../main.ts';
import { decodeT1 } from '../tile/codec.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const districts = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness/data/districts.json'), 'utf8'));
const plan = stagePlan(districts, 'pilot', fs.readFileSync(path.join(ROOT, 'harness/data/districts/pilot_centre.geojson'), 'utf8'));
const missing = ['osm.json', 'overture_buildings.json', 'gedtm30_window.json'].filter((f) => !fs.existsSync(path.join(ROOT, plan.def.dataDir, f)));
const reason = missing.length ? `pilot data missing (${missing.join(', ')} in ${plan.def.dataDir}): run npm run bake -- pilot --stage sources` : '';

describe.skipIf(missing.length > 0)(`pilot centre road mesh${reason ? ` (skipped: ${reason})` : ''}`, () => {
  let done;
  const baked = () => (done ??= run());
  const run = async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bake-mesh-'));
    const healthFile = path.join(dir, 'health.json');
    const benchDir = path.join(dir, 'gen');
    const lines = [];
    const report = await bake(parseArgs(['pilot', '--stage', 'mesh', '--offline']), { root: ROOT, net: offlineNet, today: '2026-11-12', log: (l) => lines.push(l), healthFile, benchDir });
    const health = JSON.parse(fs.readFileSync(healthFile, 'utf8'));
    for (const l of lines.filter((x) => x.startsWith('[mesh]'))) console.log(l);
    return { report, health, mesh: health.mesh, benchDir };
  };
  /** The whole bake runs once, inside the first test that asks for it (about two minutes; longer beside the other pilot tests). */
  const T = 600000;

  it('the bake runs through the mesh step: every mesh invariant holds, the meshes build in under 60 s, the same mesh twice', async () => {
    const { report, health, mesh } = await baked();
    expect(report.steps).toEqual(['sources', 'ground', 'graph', 'repair', 'lanes', 'elevation', 'mesh']);
    expect(report.stoppedBeforeTiles).toBe(false);
    const inv = Object.fromEntries(health.invariants.filter((i) => i.id.startsWith('MESH-')).map((i) => [i.id, i.ok]));
    expect(inv).toEqual({ 'MESH-01.no_overlap_at_junctions': true, 'MESH-02.watertight': true, 'MESH-03.structures': true, 'MESH-04.kerbs_uv_stop_lines': true, 'MESH-05.same_twice': true });
    console.log(`[mesh] build time ${mesh.buildMs} ms (${JSON.stringify(mesh.ms)}), checks ${mesh.checksMs} ms`);
    expect(mesh.buildMs).toBeLessThan(60000);
    expect(mesh.counts.triangles).toBeGreaterThan(1000000);
    expect(mesh.counts.laneQuads).toBeGreaterThan(300000);
    expect(mesh.counts.junctions).toBe(health.lanes.counts.junctions);
    expect(mesh.counts.j1 + mesh.counts.j2).toBe(mesh.counts.junctions);
    // nearly every junction is built as planned; the rest by the polygon set
    expect(mesh.counts.j1 / mesh.counts.junctions).toBeGreaterThan(0.95);
  }, T);

  it('no junction face shares more than 0.01 m2 with a strip or another junction; the total and the strip pairs are printed', async () => {
    const { mesh, health } = await baked();
    const o = mesh.overlap;
    expect(o.junctions).toBe(mesh.counts.junctions);
    expect(o.pairsOver).toBe(0);
    expect(o.junctionsOver).toBe(0);
    expect(o.maxPairM2).toBeLessThan(0.01);
    expect(o.maxSelfM2).toBeLessThan(0.01);
    expect(o.pairsTested).toBeGreaterThan(10000);
    console.log(`[mesh] total under more than one face ${o.totalM2} m2 (ground ${o.groundM2}); strip on strip ${o.stripPairs.pairs} pairs, ${o.stripPairs.areaM2} m2: ${o.stripPairs.worst.map((w) => `${w.a} on ${w.b} ${w.areaM2}`).join(', ')}`);
    // strip on strip is the lane model's: a ramp on fill beside a road at grade (13.4 m2, new with the height based
    // levels), two slivers the lanes step lists too. The tunnel mouth pair of the lanes step lies on two levels here.
    expect(o.stripPairs.pairs).toBeLessThanOrEqual(3);
    expect(o.stripPairs.areaM2).toBeLessThan(14);
    expect(o.totalM2).toBeLessThan(18);
    expect(health.gates.overlappingRoadFaces).toBe(o.pairsOver + o.stripPairs.pairs);
  }, T);

  it('the at-grade surface is watertight: every free edge on one closed loop, no edge used twice, no T joint left', async () => {
    const { mesh, health } = await baked();
    const w = mesh.watertight;
    expect(w.openBoundaryEdges).toBe(0);
    expect(w.unclosed + w.doubled + w.tJointsLeft).toBe(0);
    expect(health.gates.openBoundaryEdges).toBe(0);
    expect(w.loops).toBe(w.outerLoops + w.blockLoops);
    expect(w.blockLoops).toBeGreaterThan(1000);
    // hairlines between pieces that nearly touch are closed loops too; the ground cut may drop them
    expect(w.sliverM2).toBeLessThan(0.5);
  }, T);

  it('strip ends: joined, or explained by the lane model; the few that are neither are listed', async () => {
    const { mesh, health } = await baked();
    const e = mesh.ends;
    expect(e.joined + Object.values(e.explained).reduce((s, v) => s + v, 0) + e.unjoined).toBe(e.stripEnds);
    expect(e.explained.map_edge).toBe(169);
    console.log(`[mesh] unjoined ${e.unjoined}: ${e.unjoinedList.map((u) => `${u.strip} ${u.end}`).join(', ')}; floating ${e.floating}: ${e.floatingList.map((u) => `${u.strip} ${u.end} ${u.kind}`).join(', ')}`);
    // not zero on the pilot: arms of clusters the lane model cut too wide (a junction that joins a deck and the
    // ground, a tunnel arm under a ground road), and one raised dead end the elevation step lists too
    expect(e.unjoined).toBeLessThanOrEqual(6);
    expect(e.floating).toBeLessThanOrEqual(2);
    expect(health.gates.unjoinedEnds).toBe(e.unjoined);
    expect(health.gates.floatingEnds).toBe(e.floating);
  }, T);

  it('parapets stand on structures only; no pier stands in a lane of another level', async () => {
    const { mesh, health } = await baked();
    expect(mesh.railings.segments).toBeGreaterThan(5000);
    expect(mesh.railings.parapetTriangles).toBeGreaterThan(10000);
    expect(mesh.railings.atGrade).toBe(0);
    expect(health.gates.railingsAtGrade).toBe(0);
    expect(Object.keys(mesh.railings.byKind).sort()).toEqual(['cut', 'deck', 'fill', 'tunnel']);
    expect(mesh.piers.piers).toBeGreaterThan(100);
    expect(mesh.piers.inLane).toBe(0);
    expect(health.gates.piersInLane).toBe(0);
    expect(mesh.piers.joints).toBe(mesh.piers.piers);
  }, T);

  it('kerbs stand 0.15 m over the carriageway within 0.01 m, the lane UV test passes, every arm that stops has its stop line', async () => {
    const { mesh, health } = await baked();
    expect(mesh.kerbs.sampled).toBeGreaterThan(400000);
    expect(mesh.kerbs.off).toBe(0);
    expect(mesh.kerbs.minM).toBeGreaterThan(0.14);
    expect(mesh.kerbs.maxM).toBeLessThan(0.16);
    expect(mesh.uv.ok).toBe(true);
    expect(mesh.uv.badU + mesh.uv.badV + mesh.uv.borderMismatch + mesh.uv.jointMismatch + mesh.uv.unaligned + mesh.uv.badCodes).toBe(0);
    expect(mesh.uv.lanes).toBeGreaterThan(100000);
    expect(mesh.uv.markedTriangles).toBeGreaterThan(100000);
    // an arm stops when its paths stop in the lane graph: a stop line before a crossing, or signals
    const stops = health.lanes.counts.crossings;
    expect(mesh.stopLines.armsThatStop).toBeGreaterThan(1000);
    expect(mesh.stopLines.armsThatStop).toBeLessThanOrEqual(stops + health.lanes.counts.signals * 14);
    expect(mesh.stopLines.lines).toBe(mesh.stopLines.armsThatStop);
    expect(mesh.stopLines.missing).toBe(0);
  }, T);

  it('the road bench scene gets a stand-in tile of the production mesh for every site, with a top and an eye pose', async () => {
    const { mesh, benchDir } = await baked();
    for (const site of ['ito', 'cp', 'india_gate', 'chandni_chowk']) {
      const meta = JSON.parse(fs.readFileSync(path.join(benchDir, `${site}.json`), 'utf8'));
      expect(meta.poses.map((p) => p.name)).toEqual(['top', 'eye']);
      const t = decodeT1(new Uint8Array(fs.readFileSync(path.join(benchDir, `${site}.ktl`))));
      const names = t.header.meshes.map((m) => m.material);
      for (const m of ['road', 'kerb', 'footpath', 'marking', 'ground']) expect(names).toContain(m);
      expect(t.header.colliders.length).toBeGreaterThan(20);
    }
    expect(mesh.files.siteTiles).toHaveLength(8);
    // the ITO site has the flyover: decks, piers, parapets (drawn as wall)
    const ito = decodeT1(new Uint8Array(fs.readFileSync(path.join(benchDir, 'ito.ktl')))).header.meshes.map((m) => m.material);
    for (const m of ['underside', 'pier', 'wall']) expect(ito).toContain(m);
  }, T);
});
