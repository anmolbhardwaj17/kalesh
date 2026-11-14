// Landmark placement on the pilot centre (P2-006 acceptance), on the shared pilot bake (tools/testkit/sharedbake.mjs)
// and the committed registry files:
// 1. every registry entry with a high position confidence has a pin in the tiles within its tier's tolerance of its
//    own projection in the block frame (hero 5 m and 5 degrees, signature 10 m, marker 15 m);
// 2. the ground under every pad, read back from the tiles, is flat within 0.05 m and meets the ground around it with
//    no gap over 0.02 m;
// 3. no plain building stands in a landmark zone, and the ones a zone took are in the log;
// 4. India Gate to Red Fort and India Gate to Connaught Place keep bearing within 0.5 degrees and distance within 0.5%;
// (KALESH_BAKED=1 runs the same checks on the bake on disk, without the shared bake.)
// 5. a far landmark is never in a reachable tile; the tiles stay inside their byte budget; a partial bake of the
//    landmark tiles writes the whole bake's bytes again (the same hashes twice).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { projector } from '../../geo/projection.ts';
import { logLines, memo, pilotMissing, ROOT, sharedBake } from '../../testkit/sharedbake.mjs';
import { parseArgs } from '../cli.ts';
import { pointInRing } from '../geom.ts';
import { geodesic, bearingDiffDeg, worldBearingDeg } from '../layout/geodesic.ts';
import { tileId, tileOf, TILE_M } from '../layout/grid.ts';
import { blockFrame } from '../layout/placement.ts';
import { bake, offlineNet } from '../main.ts';
import { decodeT1 } from '../tile/codec.ts';
import { axisGap, bearingGap, mainAxis } from './orient.ts';
import { FAR_CLEAR_M } from './place.ts';
import { PAD_FLAT_M, PAD_GAP_M } from './placeout.ts';

const { missing, reason } = pilotMissing();
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const districts = readJson(path.join(ROOT, 'harness/data/districts.json'));
const budgets = readJson(path.join(ROOT, 'harness/verify/perf_budgets.json')).world.landmarks;
const registry = () => {
  const dir = path.join(ROOT, 'harness/data/landmarks');
  return [...fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(dir, f))), ...readJson(path.join(ROOT, 'harness/data/landmarks_markers.json')).markers];
};
const GROUND = new Set(['ground', 'lawn', 'plot', 'bed', 'forecourt', 'pad', 'wallbase', 'moat']);
const T = 1800000;

describe.skipIf(missing.length > 0)(`pilot centre landmark placement${reason ? ` (skipped: ${reason})` : ''}`, () => {
  let cache = null;
  const baked = async () => {
    if (cache) return cache;
    // KALESH_BAKED=1 checks the bake that is on disk (game/world/tiles and harness/reports/map) instead of baking the
    // pilot again: the same assertions on the tiles the game ships, for a machine too busy for the shared bake
    const onDisk = process.env.KALESH_BAKED === '1';
    const sb = onDisk ? { tiles: path.join(ROOT, 'game/world/tiles'), dir: path.join(ROOT, 'harness/reports/map'), health: readJson(path.join(ROOT, 'harness/reports/map/health.json')), lines: [] } : await sharedBake();
    logLines(sb.lines, '[landmarks]');
    const index = readJson(path.join(sb.tiles, 'index.json'));
    const pins = new Map();
    const tiles = new Map();
    for (const t of index.tiles) {
      const d = decodeT1(new Uint8Array(fs.readFileSync(path.join(sb.tiles, t.file))));
      tiles.set(t.id, d);
      for (const p of d.header.pins) pins.set(p.id, { ...p, x: d.header.origin[0] + p.pos[0], y: d.header.origin[1] + p.pos[1], z: d.header.origin[2] + p.pos[2], tile: t.id });
    }
    const dir = path.join(sb.dir, 'landmarks');
    cache = { sb, index, pins, tiles, placement: readJson(path.join(dir, 'placement.json')), replaced: readJson(path.join(dir, 'replaced.json')), file: readJson(path.join(sb.tiles, 'landmarks.json')), rec: sb.health.landmarks };
    return cache;
  };
  const frame = blockFrame(districts, 'centre');
  const proj = projector(frame.origin);
  /** The projection of a registry point in the block frame plus the block offset: world metres, by the layout's own code. */
  const world = (lat, lon) => {
    const p = proj.toWorld(lat, lon);
    return { x: p.x + frame.offset.x, z: p.z + frame.offset.z };
  };

  it('the placement invariants hold and the bake went through to the tiles', async () => {
    const { sb, rec } = await baked();
    const inv = Object.fromEntries(sb.health.invariants.filter((i) => i.id.startsWith('LM-')).map((i) => [i.id, i.ok]));
    expect(inv).toEqual({ 'LM-01.zones_clear': true, 'LM-03.far_unreachable': true, 'LM-02.pads_flat': true, 'LM-04.lod_budgets': true });
    expect(rec.registryStage).toBe('pilot');
    expect(rec.stats.byTier.hero).toBe(3);
    expect(rec.stats.placed).toBeGreaterThan(200);
    expect(sb.health.tiles.record.skipped).toEqual([]);
    console.log(`[landmarks] placed ${rec.stats.placed}: ${JSON.stringify(rec.stats.byMode)}, pads ${rec.stats.pads}, replaced ${rec.stats.replaced}, parts ${rec.stats.parts}, far ${rec.stats.far}, not placed ${rec.stats.skipped}`);
  }, T);

  it('position: every entry with a high position confidence is baked within its tier tolerance, heroes within 5 degrees', async () => {
    const { pins, placement } = await baked();
    const high = registry().filter((e) => e.confidence.position === 'high');
    expect(high.length).toBeGreaterThan(50);
    let worst = { id: '', d: 0 };
    const byTier = { hero: 0, signature: 0, marker: 0 };
    for (const e of high) {
      const pin = pins.get(`lm:${e.id}`);
      expect(pin, `a pin for ${e.id} (${e.tier}, place ${e.place})`).toBeDefined();
      const want = world(e.lat, e.lon);
      const d = Math.hypot(pin.x - want.x, pin.z - want.z);
      expect(d, `${e.id} position error`).toBeLessThanOrEqual(budgets.positionErrorM[e.tier]);
      // the vertex snap of the tiles is the only difference (under a millimetre)
      expect(d).toBeLessThan(0.002);
      expect(pin.tier).toBe(e.tier);
      expect(pin.kind).toBe('landmark');
      byTier[e.tier]++;
      if (d > worst.d) worst = { id: e.id, d };
      // the pin lies in the tile of its own position
      expect(pin.tile).toBe(tileId(tileOf(pin.x, pin.z).tx, tileOf(pin.x, pin.z).tz));
    }
    expect(byTier.hero).toBe(3);
    console.log(`[landmarks] ${high.length} entries with a high position confidence (${JSON.stringify(byTier)}), largest error ${(worst.d * 1000).toFixed(3)} mm (${worst.id})`);
    // orientation of the heroes: the baked front lies along a side of the footprint's own rectangle, worked out here
    // from the registry ring in the block frame, and on the side the evidence names
    for (const e of high.filter((x) => x.tier === 'hero')) {
      const pin = pins.get(`lm:${e.id}`);
      const ring = e.footprint.ring.map(([la, lo]) => proj.toWorld(la, lo));
      const ax = mainAxis(ring);
      if (e.orientation.source === 'round') {
        expect(ax.elongation).toBeLessThan(1.1);
        expect(pin.yaw).toBe(e.orientation_deg);
        continue;
      }
      const side = Math.min(axisGap(pin.yaw, ax.axisDeg), axisGap(pin.yaw, ax.axisDeg + 90));
      expect(side, `${e.id} front against its footprint`).toBeLessThanOrEqual(5);
      expect(bearingGap(pin.yaw, e.orientation.front_bearing_deg), `${e.id} front against the evidence`).toBeLessThanOrEqual(45);
      expect(bearingGap(pin.yaw, e.orientation_deg)).toBeLessThanOrEqual(5);
      console.log(`[landmarks] ${e.id}: front ${pin.yaw} deg, footprint axis ${ax.axisDeg.toFixed(1)} deg (${ax.lengthM.toFixed(0)} by ${ax.widthM.toFixed(0)} m), evidence ${e.orientation.front_bearing_deg} deg`);
    }
    // north is -Z, east is +X: the Red Fort lies north-east of India Gate, Connaught Place north-west
    const ig = pins.get('lm:india_gate');
    const rf = pins.get('lm:red_fort');
    const cp = pins.get('lm:cp_circle');
    expect(rf.z).toBeLessThan(ig.z - 4000);
    expect(rf.x).toBeGreaterThan(ig.x + 800);
    expect(cp.z).toBeLessThan(ig.z - 1800);
    expect(cp.x).toBeLessThan(ig.x - 700);
    // held and unplaced entries have no pin
    for (const s of placement.skipped) expect(pins.has(`lm:${s.id}`)).toBe(false);
    // an underground station is a pin only
    for (const p of placement.placements.filter((x) => x.underground)) {
      expect(p.mode).toBe('point');
      expect(p.pad).toBeNull();
      expect(p.body).toEqual([]);
      expect(pins.get(`lm:${p.id}`).underground).toBe(true);
    }
  }, T);

  it('pads: the ground under each pad, read from the tiles, is flat within 0.05 m and meets the ground around it within 0.02 m', async () => {
    const { tiles, placement, rec } = await baked();
    const off = placement.offset;
    const padded = placement.placements.filter((p) => p.pad);
    expect(padded.length).toBeGreaterThan(40);
    // landmarks on one plinth share one pad: the ground has one pad piece for each pad of its own
    expect(rec.pads.count).toBe(padded.filter((p) => p.pad.from !== 'shared').length);
    expect(rec.pads.pinnedByRoad).toBe(0);
    let worstFlat = 0;
    let worstGap = 0;
    let padVertices = 0;
    for (const p of padded) {
      const ring = p.pad.ring.map((q) => ({ x: q.x + off.x, z: q.z + off.z }));
      const xs = ring.map((q) => q.x);
      const zs = ring.map((q) => q.z);
      const box = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
      // every ground vertex of the tiles the pad touches, by its snapped place
      const at = new Map();
      const padPts = [];
      for (let tx = Math.floor(box.x0 / TILE_M); tx <= Math.floor(box.x1 / TILE_M); tx++) {
        for (let tz = Math.floor(box.z0 / TILE_M); tz <= Math.floor(box.z1 / TILE_M); tz++) {
          const d = tiles.get(tileId(tx, tz));
          if (!d) continue;
          const [ox, oy, oz] = d.header.origin;
          for (const m of d.header.meshes) {
            if (!GROUND.has(m.material)) continue;
            const pos = d.f32(m.pos, m.vertices * 3);
            for (let i = 0; i < m.vertices; i++) {
              const x = ox + pos[i * 3];
              const y = oy + pos[i * 3 + 1];
              const z = oz + pos[i * 3 + 2];
              if (x < box.x0 - 1 || x > box.x1 + 1 || z < box.z0 - 1 || z > box.z1 + 1) continue;
              const key = `${Math.round(x * 1024)}_${Math.round(z * 1024)}`;
              const e = at.get(key) ?? { lo: Infinity, hi: -Infinity };
              e.lo = Math.min(e.lo, y);
              e.hi = Math.max(e.hi, y);
              at.set(key, e);
              if (m.material === 'pad') padPts.push({ x, y, z, key });
            }
          }
        }
      }
      // the pad's own vertices (another pad's corner may lie in the box: only those in or on this ring)
      const mine = padPts.filter((v) => pointInRing(v, ring) || ring.some((q, k) => {
        const b = ring[(k + 1) % ring.length];
        const len = Math.hypot(b.x - q.x, b.z - q.z) || 1;
        const t = Math.max(0, Math.min(1, ((v.x - q.x) * (b.x - q.x) + (v.z - q.z) * (b.z - q.z)) / (len * len)));
        return Math.hypot(q.x + (b.x - q.x) * t - v.x, q.z + (b.z - q.z) * t - v.z) < 0.01;
      }));
      expect(mine.length, `pad vertices of ${p.id}`).toBeGreaterThanOrEqual(3);
      for (const v of mine) {
        const flat = Math.abs(v.y - p.pad.level);
        const gap = at.get(v.key).hi - at.get(v.key).lo;
        worstFlat = Math.max(worstFlat, flat);
        worstGap = Math.max(worstGap, gap);
        expect(flat, `${p.id} pad vertex at ${v.x.toFixed(2)}, ${v.z.toFixed(2)} off its level`).toBeLessThanOrEqual(PAD_FLAT_M);
        expect(gap, `${p.id} gap to the ground around at ${v.x.toFixed(2)}, ${v.z.toFixed(2)}`).toBeLessThanOrEqual(PAD_GAP_M);
      }
      padVertices += mine.length;
    }
    console.log(`[landmarks] ${padded.length} pads, ${padVertices} pad vertices read from the tiles: off level by at most ${worstFlat.toFixed(4)} m (limit ${PAD_FLAT_M}), gap at most ${worstGap.toFixed(4)} m (limit ${PAD_GAP_M}); on the built ground ${rec.pads.maxOffLevelM} and ${rec.pads.maxGapM}`);
    expect(rec.pads.maxOffLevelM).toBeLessThanOrEqual(PAD_FLAT_M);
    expect(rec.pads.maxGapM).toBeLessThanOrEqual(PAD_GAP_M);
  }, T);

  it('zones: no plain building stands in a landmark zone, the replaced ones are in the log, and nothing of a hero structure is under a building', async () => {
    const { tiles, placement, replaced, rec } = await baked();
    expect(rec.buildingsInZones).toBe(0);
    expect(replaced.lines.length).toBe(rec.stats.replaced + rec.stats.parts);
    expect(replaced.counts.footprintsBefore - replaced.counts.footprintsAfter).toBe(replaced.lines.length);
    expect(rec.stats.replaced).toBeGreaterThan(20);
    expect(rec.stats.parts).toBeGreaterThan(100);
    const ids = new Set(replaced.lines.map((l) => l.id));
    expect(ids.size).toBe(replaced.lines.length);
    for (const l of replaced.lines) expect(placement.placements.some((p) => p.id === l.landmark)).toBe(true);
    // read from the tiles: no vertex of the plain building mesh lies inside the footprint of a structure that has its pad
    const off = placement.offset;
    let checked = 0;
    for (const p of placement.placements.filter((x) => x.mode === 'structure' && x.pad && x.tier !== 'marker')) {
      const ring = p.footprint.map((q) => ({ x: q.x + off.x, z: q.z + off.z }));
      const c = { x: p.wx, z: p.wz };
      const t0 = tileOf(c.x, c.z);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const d = tiles.get(tileId(t0.tx + dx, t0.tz + dz));
        if (!d) continue;
        const [ox, , oz] = d.header.origin;
        for (const m of d.header.meshes) {
          if (m.material !== 'building') continue;
          const pos = d.f32(m.pos, m.vertices * 3);
          for (let i = 0; i < m.vertices; i++) {
            const v = { x: ox + pos[i * 3], z: oz + pos[i * 3 + 2] };
            // well inside: a neighbour's wall on the footprint's own edge is not in it
            if (Math.hypot(v.x - c.x, v.z - c.z) < 200 && pointInRing(v, ring) && pointInRing({ x: c.x + (v.x - c.x) * 1.15, z: c.z + (v.z - c.z) * 1.15 }, ring)) expect.fail(`a plain building vertex at ${v.x.toFixed(1)}, ${v.z.toFixed(1)} stands in ${p.id}`);
          }
        }
      }
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(5);
    // the massing is in the tiles with the landmark materials
    const materials = new Set([...tiles.values()].flatMap((d) => d.header.meshes.map((m) => m.material)));
    for (const m of ['pad', 'forecourt', 'landmark', 'landmark_red']) expect(materials.has(m), `material ${m} in the tiles`).toBe(true);
    console.log(`[landmarks] ${rec.stats.replaced} buildings replaced, ${rec.stats.parts} taken as parts, 0 plain buildings left in ${rec.stats.zones} zones; ${checked} structures read from the tiles`);
  }, T);

  it('relative layout: India Gate to Red Fort and to Connaught Place keep bearing within 0.5 degrees and distance within 0.5 percent', async () => {
    const { pins } = await baked();
    const reg = new Map(registry().map((e) => [e.id, e]));
    for (const [a, b] of [['india_gate', 'red_fort'], ['india_gate', 'cp_circle']]) {
      const pa = pins.get(`lm:${a}`);
      const pb = pins.get(`lm:${b}`);
      const real = geodesic({ lat: reg.get(a).lat, lon: reg.get(a).lon }, { lat: reg.get(b).lat, lon: reg.get(b).lon });
      const bakedM = Math.hypot(pb.x - pa.x, pb.z - pa.z);
      const bearing = worldBearingDeg(pb.x - pa.x, pb.z - pa.z);
      const errPct = (Math.abs(bakedM - real.distanceM) / real.distanceM) * 100;
      const errDeg = bearingDiffDeg(bearing, real.bearingDeg);
      console.log(`[landmarks] ${a} to ${b}: real ${real.distanceM.toFixed(1)} m at ${real.bearingDeg.toFixed(3)} deg, baked ${bakedM.toFixed(1)} m at ${bearing.toFixed(3)} deg (${errPct.toFixed(4)} percent, ${errDeg.toFixed(4)} deg)`);
      expect(errDeg).toBeLessThanOrEqual(0.5);
      expect(errPct).toBeLessThanOrEqual(0.5);
    }
  }, T);

  it('far landmarks: on their real bearing, in no reachable tile, with a silhouette under 2,000 triangles; heroes have their LOD chain', async () => {
    const { index, file, placement } = await baked();
    const tilesIn = new Set(index.tiles.map((t) => t.id));
    expect(file.far.map((f) => f.id).sort()).toEqual(['akshardham', 'humayuns_tomb', 'lotus_temple', 'qutub_minar', 'rashtrapati_bhavan']);
    const reg = new Map(registry().map((e) => [e.id, e]));
    const pivot = districts.method.pivot.world;
    for (const f of file.far) {
      const [x, , z] = f.pos;
      // no tile of the set within the clear distance: the player can never stand there
      for (let tx = Math.floor((x - FAR_CLEAR_M) / TILE_M); tx <= Math.floor((x + FAR_CLEAR_M) / TILE_M); tx++) {
        for (let tz = Math.floor((z - FAR_CLEAR_M) / TILE_M); tz <= Math.floor((z + FAR_CLEAR_M) / TILE_M); tz++) expect(tilesIn.has(tileId(tx, tz)), `far landmark ${f.id} near tile ${tileId(tx, tz)}`).toBe(false);
      }
      expect(f.reachable).toBe(false);
      expect(f.nav).toBe(false);
      // on its real bearing from the pivot
      const e = reg.get(f.id);
      expect(bearingDiffDeg(worldBearingDeg(x - pivot.x, z - pivot.z), e.bearing_deg), `${f.id} bearing`).toBeLessThanOrEqual(0.5);
      const s = file.silhouettes[f.silhouette];
      expect(s.id).toBe(f.id);
      expect(s.triangles).toBeGreaterThan(8);
      expect(s.triangles).toBeLessThanOrEqual(budgets.farSilhouetteTriangles);
      expect(s.pos.length).toBe(s.triangles * 9);
    }
    expect(file.limits).toEqual({ heroesAtFullDetailInView: budgets.heroesAtFullDetailInView, farSilhouetteTriangles: budgets.farSilhouetteTriangles, heroLods: budgets.heroLods });
    const heroes = file.landmarks.filter((l) => l.tier === 'hero');
    expect(heroes.map((h) => h.id).sort()).toEqual(['cp_circle', 'india_gate', 'red_fort']);
    for (const h of heroes) {
      expect(h.lod.slots.map((s) => s.level)).toEqual([0, 1, 2]);
      // the pilot heroes are built by the parts kit in the game (P2-007): their slots say so and the file gives the inputs
      expect(h.lod.slots.map((s) => s.source)).toEqual(['kit', 'kit', 'kit']);
      expect(h.kit?.recipe, `${h.id} has a kit recipe`).toBe(h.id);
      expect(h.lod.far.trianglesMax).toBe(budgets.farSilhouetteTriangles);
      const s = file.silhouettes[h.silhouette];
      expect(s.triangles).toBeGreaterThan(8);
      expect(s.triangles).toBeLessThanOrEqual(budgets.farSilhouetteTriangles);
      console.log(`[landmarks] hero ${h.id}: kit ${h.kit.recipe} (${h.kit.walls.length} wall runs, ${h.kit.gates.length} gates, ${h.kit.sectors.length} sectors), tile massing ${h.massing?.triangles ?? 0} triangles; far silhouette ${s.triangles} triangles`);
    }
    // the kit inputs: India Gate's body and axis, the Red Fort's wall line open at the roads with the Lahori Gate, the CP ring blocks
    const by = new Map(file.landmarks.map((l) => [l.id, l]));
    expect(by.get('india_gate').kit.body.length).toBeGreaterThan(0);
    expect(by.get('india_gate').kit.axis.lengthM).toBeGreaterThan(15);
    const fort = by.get('red_fort').kit;
    expect(fort.walls.length).toBeGreaterThan(0);
    expect(fort.walls.reduce((n, w) => n + w.pts.length, 0)).toBeGreaterThan(20);
    expect(fort.gates.map((g) => g.name)).toContain('Lahori Gate');
    const cp = by.get('cp_circle').kit;
    expect(cp.sectors.filter((s) => s.band === 'inner').length).toBeGreaterThanOrEqual(5);
    expect(cp.sectors.filter((s) => s.band === 'outer').length).toBeGreaterThanOrEqual(5);
    for (const s of cp.sectors) expect(s.r1 - s.r0, `CP block ${s.a0} deg depth`).toBeGreaterThan(8);
    expect(by.get('jama_masjid').kit.recipe).toBe('jama_masjid');
    // a placed landmark is in a tile of the set; a far one is not in the placements
    for (const l of file.landmarks) expect(tilesIn.has(l.tile), `${l.id} in tile ${l.tile}`).toBe(true);
    for (const f of file.far) expect(placement.placements.some((p) => p.id === f.id)).toBe(false);
  }, T);

  it('the tiles stay inside their byte budget, and a partial bake of the hero tiles writes the same bytes again', async () => {
    const { sb, index, file } = await baked();
    const rec = sb.health.tiles.record;
    expect(rec.stats.averageBytes).toBeLessThanOrEqual(1.5 * 1048576);
    expect(rec.stats.largest.bytes).toBeLessThanOrEqual(4 * 1048576);
    // the tiles of India Gate and the Lahori Gate front of the Red Fort, baked again on their own
    const want = ['india_gate', 'red_fort'].map((id) => file.landmarks.find((l) => l.id === id).tile);
    const again = await memo('landmark_tiles_again', want.join(','), async (dir) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kalesh-lm-'));
      const out = path.join(dir, 'tiles');
      await bake(parseArgs(['pilot', '--tiles', want.join(','), '--out', path.relative(ROOT, out), '--offline']), { root: ROOT, net: offlineNet, today: '2026-11-11', log: () => {}, healthFile: path.join(tmp, 'health.json'), benchDir: path.relative(ROOT, path.join(tmp, 'gen')) });
      const idx = readJson(path.join(out, 'index.json'));
      const lm = fs.readFileSync(path.join(out, 'landmarks.json'), 'utf8');
      fs.rmSync(tmp, { recursive: true, force: true });
      return { tiles: idx.tiles.map((t) => ({ id: t.id, hash: t.hash, bytes: t.bytes })), landmarks: lm };
    });
    expect(again.tiles.map((t) => t.id).sort()).toEqual([...want].sort());
    for (const t of again.tiles) {
      const first = index.tiles.find((x) => x.id === t.id);
      expect(t.hash, `tile ${t.id} baked twice`).toBe(first.hash);
      expect(t.bytes).toBe(first.bytes);
    }
    expect(again.landmarks).toBe(fs.readFileSync(path.join(sb.tiles, 'landmarks.json'), 'utf8'));
    console.log(`[landmarks] tiles ${want.join(', ')} baked twice: the same hashes; average tile ${(rec.stats.averageBytes / 1048576).toFixed(3)} MB, largest ${(rec.stats.largest.bytes / 1048576).toFixed(3)} MB`);
  }, T);
});
