// The area generator on the pilot centre (P2-009 acceptance), from the shared whole bake (tools/testkit/sharedbake.mjs;
// skipped with the reason when the pilot source files are missing): every parcel gets a shell or a log line, OSM tagged
// buildings keep their height within a floor, each profile's floor histogram follows its profile, the blend transects
// change in one direction without a step over 20 percent, variety inside a tile, no parcel on a road face, the
// placement bytes of the densest tile and the average tile size, the generator's own time, and that a second bake of
// the densest tiles writes the same bytes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, logLines, memo, pilotMissing, sharedBake } from '../../testkit/sharedbake.mjs';
import { parseArgs } from '../cli.ts';
import { bake, offlineNet } from '../main.ts';
import { decodeT1 } from '../tile/codec.ts';
import { AREA_LIMITS } from './checks.ts';
import { INSTANCE_BYTES, PLACEMENT_BUDGET_BYTES } from './generator.ts';
import { PARTS } from './facade.ts';
import { BUILDING_TYPES } from './schema.ts';

const { missing, reason } = pilotMissing();
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const T = 1800000;

describe.skipIf(missing.length > 0)(`pilot centre area generator${reason ? ` (skipped: ${reason})` : ''}`, () => {
  const baked = async () => {
    const sb = await sharedBake();
    logLines(sb.lines, '[areas]');
    return { sb, rec: sb.health.areas, index: readJson(path.join(sb.tiles, 'index.json')), dir: path.join(sb.dir, 'areas') };
  };

  it('every footprint gets a shell or a log line; OSM tagged buildings are within a floor of their tag', async () => {
    const { sb, rec, dir } = await baked();
    const inv = Object.fromEntries(sb.health.invariants.filter((i) => i.id.startsWith('AREA-')).map((i) => [i.id, i.ok]));
    expect(inv).toEqual({ 'AREA-01.every_parcel': true, 'AREA-02.osm_tags': true, 'AREA-03.floors': true, 'AREA-04.blend': true, 'AREA-05.variety': true, 'AREA-06.off_the_road': true, 'AREA-07.placement_bytes': true });
    const c = rec.parcels;
    const s = rec.city;
    expect(c.in).toBeGreaterThan(30000);
    // what left has a line in a report file; what came is a blueprint block or a lot
    const odd = readJson(path.join(dir, 'odd_footprints.json'));
    const parcels = readJson(path.join(dir, 'parcels.json'));
    expect(odd.lines.filter((l) => l.action === 'dropped')).toHaveLength(c.dropped);
    expect(parcels.blueprints.filter((l) => l.action === 'replaced_footprint')).toHaveLength(c.replacedByBlueprint);
    expect(parcels.lots).toHaveLength(c.lots);
    expect(c.out).toBe(c.in - c.dropped - c.replacedByBlueprint + c.blueprintBlocks + c.lots);
    expect(s.shells + s.notAShape).toBe(c.out);
    expect(readJson(path.join(dir, 'generator.json')).lines).toHaveLength(s.notAShape);
    expect(sb.health.tiles.record.shells.shells).toBe(s.shells);
    // tags
    expect(s.tagged).toBeGreaterThan(150);
    expect(s.tagOverOne).toBe(0);
    expect(s.tagMaxFloorDiff).toBeLessThanOrEqual(1);
    // the odd-footprint check found and logged its kinds
    expect(odd.counts.checked).toBe(c.in);
    expect(odd.counts.regularised).toBeGreaterThan(100);
    for (const l of odd.lines) expect(['dropped', 'regularised', 'flagged', 'kept']).toContain(l.action);
  }, T);

  it('each profile with 40 buildings or more has its floor classes within 10 points of its profile', async () => {
    const { rec } = await baked();
    const tested = rec.city.profiles.filter((p) => p.drawn >= AREA_LIMITS.floorSample);
    expect(tested.length).toBeGreaterThanOrEqual(10);
    // the drawn areas of the pilot with buildings of their own
    for (const id of ['chandni_chowk_galis', 'chandni_chowk_main', 'paharganj_station', 'gb_road_ajmeri_gate', 'red_fort_surroundings', 'ito', 'janpath']) expect(tested.map((p) => p.key)).toContain(`area:${id}`);
    for (const p of tested) {
      console.log(`[areas] ${p.key}: ${p.drawn} drawn, classes ${p.classes.drawn.join(' ')} for ${p.classes.profile.join(' ')}, largest difference ${p.classDiff}; bin by bin ${p.distanceAll}`);
      expect(p.classDiff, `${p.key} floor classes`).toBeLessThanOrEqual(AREA_LIMITS.floorDistance);
      expect(p.classes.profile.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
    }
  }, T);

  it('edge blend transects: the mix changes in one direction with no step over 20 percent between samples 25 m apart', async () => {
    const { rec, dir } = await baked();
    expect(rec.transects.map((t) => t.id)).toEqual(['cp_to_paharganj', 'paharganj_to_cp', 'chandni_chowk_to_daryaganj']);
    const full = readJson(path.join(dir, 'generator.json')).transects;
    for (const t of full) {
      expect(t.samples.length).toBeGreaterThanOrEqual(10);
      expect(t.maxStep, `${t.id} largest step`).toBeLessThanOrEqual(AREA_LIMITS.blendStep);
      expect(t.maxRise, `${t.id} rise of its own weight`).toBeLessThanOrEqual(AREA_LIMITS.blendRise);
      expect(t.from).toBeGreaterThan(0.6);
      expect(t.to).toBe(0);
      for (const s of t.samples) expect(s.weights.reduce((a, w) => a + w.w, 0)).toBeCloseTo(1, 2);
      for (let k = 1; k < t.samples.length; k++) expect(t.samples[k].at - t.samples[k - 1].at).toBe(25);
    }
  }, T);

  it('variety per profile, and no parcel on a road face', async () => {
    const { rec } = await baked();
    const s = rec.city;
    expect(s.variety.pairs).toBeGreaterThan(10000);
    expect(s.variety.sameInTile).toBe(0);
    expect(s.variety.sameAcrossTiles).toBeLessThanOrEqual(s.variety.pairs * 0.005);
    for (const p of s.profiles.filter((x) => x.shells >= AREA_LIMITS.floorSample)) {
      expect(p.topShare, `${p.key} top type ${p.topType}`).toBeLessThanOrEqual(Math.max(AREA_LIMITS.topShare, p.mixTop + AREA_LIMITS.topShareOverMix));
      expect(p.types.length, `${p.key} types`).toBeGreaterThanOrEqual(2);
    }
    expect(rec.offRoad).toEqual({ count: 0, areaM2: 0 });
    // the wall-to-wall profiles have no free frontage of 40 m left but for a stretch or two with no room for a lot
    expect(rec.infill.lots).toBeGreaterThan(500);
    expect(rec.infill.leftOver40).toBeLessThanOrEqual(3);
  }, T);

  it('placements are 0.6 MB or less in the densest tile, the average tile 1.5 MB or less; every module id is a known type and part', async () => {
    const { sb, rec, index } = await baked();
    const st = sb.health.tiles.record.stats;
    console.log(`[areas] placements ${st.placements} instances, ${(st.placementBytes / 1048576).toFixed(1)} MB; densest tile ${st.largestPlacements.id} ${(st.largestPlacements.bytes / 1048576).toFixed(3)} MB; average tile ${(st.averageBytes / 1048576).toFixed(3)} MB, largest ${st.largest.id} ${(st.largest.bytes / 1048576).toFixed(3)} MB`);
    expect(st.largestPlacements.bytes).toBeLessThanOrEqual(0.6 * 1048576);
    expect(PLACEMENT_BUDGET_BYTES).toBe(Math.floor(0.6 * 1048576));
    expect(st.averageBytes).toBeLessThanOrEqual(1.5 * 1048576);
    expect(st.largest.bytes).toBeLessThanOrEqual(4 * 1048576);
    expect(st.placements).toBe(rec.city.placements.instances);
    expect(st.placementBytes).toBe(st.placements * INSTANCE_BYTES);
    // the densest tile as the game reads it
    const t = index.tiles.find((x) => x.id === st.largestPlacements.id);
    const d = decodeT1(new Uint8Array(fs.readFileSync(path.join(sb.tiles, t.file))));
    let n = 0;
    for (const p of d.header.placements) {
      const [type, part] = p.module.split('.');
      expect(BUILDING_TYPES).toContain(type);
      expect(PARTS).toContain(part);
      expect(p.data).toBeTypeOf('number');
      n += p.count;
      const x = d.f32(p.xforms, p.count * 12);
      for (let i = 0; i < x.length; i += 12) {
        // inside its tile (an instance at the stage's edge may stand a little outside: it goes with its building)
        expect(x[i + 3] >= -60 && x[i + 3] <= 310 && x[i + 11] >= -60 && x[i + 11] <= 310, `${p.module} instance inside its tile`).toBe(true);
        expect(x[i + 5]).toBeGreaterThan(0.2);
      }
      const data = d.u32(p.data, p.count);
      for (const v of data) expect(v & 0xff).toBeLessThanOrEqual(255);
    }
    expect(n).toBe(t.placements);
    // shells carry their colour and wear in UV2
    const b = d.header.meshes.find((m) => m.material === 'building');
    expect(b.uv).toBeTypeOf('number');
    const uv2 = d.f32(b.uv2, b.vertices * 2);
    for (let i = 0; i < uv2.length; i += 2) {
      expect(Number.isInteger(uv2[i]) && uv2[i] >= 0 && uv2[i] <= 0xffffff).toBe(true);
      expect(uv2[i + 1] >= 0 && uv2[i + 1] <= 1).toBe(true);
    }
  }, T);

  it('the generator runs in under 5 minutes; a second bake of the densest tiles writes the same bytes', async () => {
    const { sb, rec, index } = await baked();
    const ms = rec.ms.parcels + rec.ms.city;
    console.log(`[areas] generator ${(ms / 1000).toFixed(1)} s (parcels ${rec.ms.parcels} ms, buildings ${rec.ms.city} ms)`);
    expect(ms).toBeLessThan(300000);
    const dense = sb.health.tiles.record.stats.largestPlacements.id;
    const [x, z] = dense.split('_').map(Number);
    const want = [dense, `${x + 1}_${z}`].filter((id) => index.tiles.some((t) => t.id === id));
    const again = await memo('area_tiles_again', want.join(','), async (dir) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kalesh-areas-'));
      const out = path.join(dir, 'tiles');
      await bake(parseArgs(['pilot', '--tiles', want.join(','), '--out', path.relative(ROOT, out), '--offline']), { root: ROOT, net: offlineNet, today: '2026-11-11', log: () => {}, healthFile: path.join(tmp, 'health.json'), benchDir: path.relative(ROOT, path.join(tmp, 'gen')) });
      const idx = readJson(path.join(out, 'index.json'));
      fs.rmSync(tmp, { recursive: true, force: true });
      return { tiles: idx.tiles.map((t) => ({ id: t.id, hash: t.hash, bytes: t.bytes, placements: t.placements })) };
    });
    expect(again.tiles.map((t) => t.id).sort()).toEqual([...want].sort());
    for (const t of again.tiles) {
      const first = index.tiles.find((q) => q.id === t.id);
      expect(t.hash, `tile ${t.id} baked twice`).toBe(first.hash);
      expect(t.placements).toBe(first.placements);
    }
    console.log(`[areas] tiles ${want.join(', ')} baked twice: the same hashes`);
  }, T);
});
