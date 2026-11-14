// Who may use each road on the pilot centre (P2-042 acceptance), from the shared whole bake (tools/testkit/sharedbake.mjs;
// skipped with the reason when the pilot data is missing): the modes and reasons in health.json, Chandni Chowk main road
// car-free with bollards at its entries, galis for two-wheelers and walkers, Kartavya Path's promenade closed to cars
// at the hexagon, walkways laid in the ground; the lane graph, the tile lanes and a car route never use a car-free lane.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeContent } from '../tile/codec.ts';
import { COLLIDER_MATERIALS } from '../tile/colliders.ts';
import { pilotMissing, sharedBake } from '../../testkit/sharedbake.mjs';
import { readLaneGraph, route } from '../../fixtures/lanegraph.mjs';

const { missing, reason } = pilotMissing();

describe.skipIf(missing.length > 0)(`pilot access model${reason ? ` (skipped: ${reason})` : ''}`, () => {
  let done;
  const baked = () => (done ??= build());
  const build = async () => {
    const sb = await sharedBake();
    const graph = JSON.parse(fs.readFileSync(sb.file(sb.health.lanes.files.laneGraph), 'utf8'));
    const model = JSON.parse(fs.readFileSync(sb.file(sb.health.lanes.files.model), 'utf8'));
    const access = JSON.parse(fs.readFileSync(path.join(sb.tiles, 'access.json'), 'utf8'));
    const nameOf = (l) => model.strips[l.strip]?.name ?? '';
    return { sb, health: sb.health, graph, model, access, nameOf };
  };
  const T = 1800000;

  it('health.json counts every mode and every reason; OSM, width, context and rules all decide some roads', async () => {
    const { health } = await baked();
    const a = health.access;
    for (const m of ['car', 'auto', 'two_wheeler', 'cycle', 'foot', 'emergency']) expect(a.byMode[m].edges).toBeGreaterThan(0);
    for (const r of ['class', 'osm_tag', 'width', 'context', 'rule']) expect(a.byReason[r].edges).toBeGreaterThan(0);
    expect(a.carFree.km).toBeGreaterThan(20);
    const rule = Object.fromEntries(a.rules.map((r) => [r.id, r.edges]));
    expect(rule['chandni_chowk_main_nmv']).toBeGreaterThanOrEqual(20);
    expect(rule['kartavya_path_promenade']).toBeGreaterThanOrEqual(1);
    expect(rule['old_city_galis']).toBeGreaterThan(50);
  }, T);

  it('Chandni Chowk main road is car-free, the galis off it take two-wheelers and walkers, Kartavya Path promenade is closed to cars', async () => {
    const { graph, nameOf } = await baked();
    const cc = graph.lanes.filter((l) => nameOf(l) === 'Chandni Chowk');
    expect(cc.length).toBeGreaterThan(20);
    for (const l of cc) {
      expect(l.modes).not.toContain('car');
      expect(l.modes).toEqual(expect.arrayContaining(['foot', 'cycle', 'emergency']));
    }
    for (const name of ['Dariba Kalan', 'Paranthe Wali Gali', 'Kinari Bazaar', 'Ballimaran']) {
      const g = graph.lanes.filter((l) => nameOf(l) === name);
      if (!g.length) continue;
      for (const l of g) {
        expect(l.modes, name).not.toContain('car');
        expect(l.modes, name).toEqual(expect.arrayContaining(['two_wheeler', 'foot']));
      }
    }
    const kp = graph.lanes.filter((l) => nameOf(l) === 'Kartavya Path');
    expect(kp.length).toBeGreaterThan(0);
    for (const l of kp) expect(l.modes).not.toContain('car');
    // a main road keeps its cars
    expect(graph.lanes.filter((l) => nameOf(l) === 'Netaji Subhash Marg').every((l) => l.modes.includes('car'))).toBe(true);
  }, T);

  it('no junction path lets a car onto a lane cars may not use', async () => {
    const { graph } = await baked();
    const lanes = new Map(graph.lanes.map((l) => [l.id, l]));
    let checked = 0;
    for (const p of graph.paths) {
      if (!p.modes.includes('car')) continue;
      expect(lanes.get(p.from)?.modes, p.id).toContain('car');
      expect(lanes.get(p.to)?.modes, p.id).toContain('car');
      checked++;
    }
    expect(checked).toBeGreaterThan(10000);
  }, T);

  it('bollards stand at both ends of Chandni Chowk and at the hexagon end of Kartavya Path, with gaps no car fits through, in the tiles with colliders', async () => {
    const { health, access, sb } = await baked();
    const b = health.access.barriers;
    expect(b.missing).toEqual([]);
    expect(b.maxGapM).toBeLessThanOrEqual(1.3);
    const cc = access.barriers.filter((x) => x.ref === 'chandni_chowk_main_nmv');
    // the Red Fort end (east, x over 1250 world) and the Fatehpuri end (west, x under 50 world)
    expect(cc.some((x) => x.x > 1250)).toBe(true);
    expect(cc.some((x) => x.x < 50)).toBe(true);
    expect(access.barriers.some((x) => x.ref === 'kartavya_path_promenade')).toBe(true);
    for (const x of access.barriers.filter((y) => y.stopsCar && y.kind === 'bollards')) expect(x.maxGapM).toBeLessThanOrEqual(1.3);
    expect(COLLIDER_MATERIALS).toContain('bollard');
    expect(COLLIDER_MATERIALS).toContain('walkway');
    // the tile that holds a Chandni Chowk line draws its posts
    const index = JSON.parse(fs.readFileSync(path.join(sb.tiles, 'index.json'), 'utf8'));
    const line = cc[0];
    const t = index.tiles.find((r) => line.x >= r.origin[0] && line.x < r.origin[0] + index.size && line.z >= r.origin[2] && line.z < r.origin[2] + index.size);
    const c = decodeContent(new Uint8Array(fs.readFileSync(path.join(sb.tiles, t.file))));
    expect(c.meshes.some((m) => m.material === 'bollard')).toBe(true);
    // its lane pieces carry their modes
    expect(c.lanes.some((l) => Array.isArray(l.modes) && !l.modes.includes('car'))).toBe(true);
  }, T);

  it('footways, paths and pedestrian areas are paved walking surfaces in the ground', async () => {
    const { health } = await baked();
    const w = health.access.walkways;
    expect(w.ways).toBeGreaterThan(500);
    expect(w.areaM2).toBeGreaterThan(50000);
  }, T);

  it('a car route across the old city never takes a car-free lane, though the shortest way would', async () => {
    const { sb } = await baked();
    const { pieces } = readLaneGraph(sb.tiles);
    // from Netaji Subhash Marg southbound north of the Red Fort end to the Fatehpuri end of Chandni Chowk
    const near = (x, z, mode) => {
      let best = null;
      for (const p of pieces.values()) {
        if (p.kind !== 'lane' || p.layer !== 0 || !p.modes.includes(mode) || p.len < 8) continue;
        for (const q of p.pts) {
          const d = Math.hypot(q[0] - x, q[2] - z);
          if (!best || d < best.d) best = { id: p.id, d };
        }
      }
      return best;
    };
    const a = near(1352, -4450, 'car');
    const b = near(0, -4340, 'car');
    expect(a && b).toBeTruthy();
    const car = route(pieces, a.id, b.id, { mode: 'car' });
    expect(car).not.toBeNull();
    expect(car.every((id) => pieces.get(id).modes.includes('car'))).toBe(true);
    const any = route(pieces, a.id, b.id);
    expect(any.some((id) => !pieces.get(id).modes.includes('car'))).toBe(true);
  }, T);
});
