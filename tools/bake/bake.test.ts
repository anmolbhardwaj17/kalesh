import { describe, expect, it } from 'vitest';
import { geoToWorld, ORIGIN, projector, worldToGeo } from '../geo/projection';
import { coveredShare, footprint, footprintStats, mergeFootprints, osmTagLoss } from './buildings';
import { diffStats, fitGround, profileStats, sampleGrid } from './ground';
import type { GroundSample } from './ground';
import { distanceStats, haversine, joinLandmarks, osmLandmarks } from './landmarks';
import type { WikidataItem } from './landmarks';
import { tagCoverage } from './osm';
import { Sketch } from './testmap';
import { buildTile, tileOf, tileStats } from './tile/standin';
import { decodeT1, encodeT1 } from './tile/codec';
import { encodeGlb } from './tile/glb';

describe('projection with an origin argument', () => {
  it('the default origin is unchanged and a district origin maps to (0, 0)', () => {
    const cp = { lat: 28.6315, lon: 77.2167 };
    const world = geoToWorld(cp.lat, cp.lon);
    expect(world.x).toBeLessThan(-1200);
    expect(world.z).toBeLessThan(-2000);
    const local = geoToWorld(cp.lat, cp.lon, cp);
    expect(Math.abs(local.x)).toBeLessThan(1e-6);
    expect(Math.abs(local.z)).toBeLessThan(1e-6);
  });
  it('north of a district origin is -z, east is +x, and the round trip holds', () => {
    const cp = { lat: 28.6315, lon: 77.2167 };
    const p = projector(cp);
    const north = p.toWorld(cp.lat + 0.001, cp.lon);
    const east = p.toWorld(cp.lat, cp.lon + 0.001);
    expect(north.z).toBeLessThan(-100);
    expect(Math.abs(north.x)).toBeLessThan(1e-6);
    expect(east.x).toBeGreaterThan(90);
    const back = worldToGeo(east.x, east.z, cp);
    expect(Math.abs(back.lon - (cp.lon + 0.001))).toBeLessThan(1e-7);
    expect(p.toGeo(north.x, north.z).lat).toBeCloseTo(cp.lat + 0.001, 7);
    // a district frame and the world frame agree on distances to a few millimetres inside one district
    const a = geoToWorld(cp.lat + 0.005, cp.lon + 0.005);
    const o = geoToWorld(cp.lat, cp.lon);
    const b = p.toWorld(cp.lat + 0.005, cp.lon + 0.005);
    expect(Math.abs(Math.hypot(a.x - o.x, a.z - o.z) - Math.hypot(b.x, b.z))).toBeLessThan(0.01);
    expect(projector().origin).toBe(ORIGIN);
  });
});

describe('osm map model', () => {
  it('reads classes, layers, widths and tag coverage', () => {
    const s = new Sketch();
    s.way([[0, 0], [100, 0]], { highway: 'primary', lanes: '3', oneway: 'yes', name: 'A' });
    s.way([[0, 20], [100, 20]], { highway: 'residential', width: '4.5' });
    s.way([[0, 40], [100, 40]], { highway: 'trunk_link', bridge: 'yes', layer: '2' });
    s.way([[0, 60], [100, 60]], { highway: 'footway' });
    s.building([[0, 80], [10, 80], [10, 90], [0, 90]], { 'building:levels': '4' });
    s.building([[20, 80], [30, 80], [30, 90], [20, 90]]);
    s.building([[40, 80], [90, 80], [90, 130], [40, 130]], { building: 'train_station', layer: '-2' }); // a metro hall
    const map = s.map();
    expect(map.underground).toBe(1);
    expect(map.roads.map((r) => [r.cls, r.link, r.layer, r.width, r.widthFrom])).toEqual([
      ['primary', false, 0, 9.6, 'lanes'], ['residential', false, 0, 4.5, 'width'], ['trunk', true, 2, 7, 'class'],
    ]);
    expect(map.footways).toBe(1);
    expect(map.buildings[0]!.area).toBeCloseTo(100);
    const c = tagCoverage(map);
    expect(c).toMatchObject({ roads: 3, roadKm: 0.3, lanes: 0.3333, width: 0.3333, layer: 0.3333, bridges: 1, buildings: 2, levels: 0.5, heightOrLevels: 0.5 });
  });
});

describe('building sources', () => {
  const sq = (x: number, z: number, w = 10) => [{ x, z }, { x: x + w, z }, { x: x + w, z: z + w }, { x, z: z + w }];
  it('the merge keeps the first source and adds later footprints only where nothing stands', () => {
    const osm = [footprint('way/1', 'osm', sq(0, 0), { name: 'Shop' })!];
    const google = [footprint('g/1', 'google', sq(1, 1))!, footprint('g/2', 'google', sq(40, 0))!, footprint('g/3', 'google', sq(100, 0, 1))!];
    const ms = [footprint('m/1', 'ms', sq(41, 0))!, footprint('m/2', 'ms', sq(80, 0))!, footprint('m/3', 'ms', sq(-7, 0))!];
    const r = mergeFootprints([osm, google, ms]);
    expect(r.merged.map((f) => f.id)).toEqual(['way/1', 'g/2', 'm/2']);
    expect(r.bySource['google']).toMatchObject({ input: 3, added: 1, duplicate: 1, tiny: 1 });
    expect(r.bySource['ms']).toMatchObject({ input: 3, added: 1, duplicate: 1, conflict: 1 });
    expect(footprintStats(r.merged, 10000)).toMatchObject({ count: 3, duplicatePairs: 0, coverage: 0.03 });
    expect(footprintStats([...osm, ...google], 10000).duplicatePairs).toBe(1);
    expect(coveredShare(r.merged, { minX: 0, minZ: 0, maxX: 100, maxZ: 10 })).toBeCloseTo(0.3, 1);
  });
  it('counts which OSM tags a merged set keeps', () => {
    const osm = [footprint('way/1', 'osm', sq(0, 0), { building: 'yes', name: 'A', 'addr:street': 'x', wikidata: 'Q1' })!, footprint('way/2', 'osm', sq(20, 0), { building: 'yes' })!];
    const loss = osmTagLoss(osm, (id) => (id === 'way/1' ? new Set(['building', 'name']) : null));
    expect(loss).toMatchObject({ osmBuildings: 2, foundById: 1 });
    expect(loss.keys['name']).toEqual({ osm: 1, kept: 1 });
    expect(loss.keys['wikidata']).toEqual({ osm: 1, kept: 0 });
    expect(loss.keys['building']).toEqual({ osm: 2, kept: 1 });
  });
});

describe('ground height', () => {
  it('samples a grid by bilinear interpolation, north row first', () => {
    const g = { west: 77, north: 29, dLon: 0.5, dLat: -0.5, width: 3, height: 3, data: [0, 10, 20, 100, 110, 120, 200, 210, 220], cellCentre: false };
    expect(sampleGrid(g, 29, 77)).toBe(0);
    expect(sampleGrid(g, 28.75, 77.25)).toBeCloseTo(55);
    expect(sampleGrid(g, 28.5, 77.5)).toBe(110);
    expect(sampleGrid(g, 30, 77)).toBeNull();
  });
  it('the ground filter drops roofs and keeps the slope', () => {
    const samples: GroundSample[] = [];
    for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) samples.push({ x: i * 30, z: j * 30, h: 200 + i * 0.3 + ((i * 7 + j * 3) % 11 === 0 ? 8 : 0) });
    const s = fitGround(samples);
    expect(s.dropped).toBeGreaterThan(20);
    expect(Math.abs(s.at(300, 300)! - 203)).toBeLessThan(0.6);
    expect(s.at(5000, 5000)).toBeNull();
  });
  it('profile and difference measures', () => {
    expect(profileStats([0, 0, 3, 0, 0], 15)).toMatchObject({ maxStep: 3, maxGradePct: 20 });
    expect(profileStats([0, 1, 2, 3], 15).roughness).toBe(0);
    expect(diffStats([1, -1, 3])).toEqual({ n: 3, mean: 1, rms: 1.91, maxAbs: 3 });
  });
});

describe('tiles', () => {
  const s = new Sketch();
  s.way([[10, -10], [240, -10]], { highway: 'primary' });
  s.building([[20, -40], [50, -40], [50, -70], [20, -70]], { 'building:levels': '2' });
  s.building([[300, -40], [330, -40], [330, -70], [300, -70]]); // in the next tile
  const map = s.map();
  const tile = buildTile({ district: 'test', tx: 0, tz: 0, size: 250, roads: map.roads, buildings: map.buildings, ground: (x) => 210.4 + x * 0.01, placements: true });

  it('tile indices follow the axes, also for negative coordinates', () => {
    expect(tileOf(10, 10, 250)).toEqual({ tx: 0, tz: 0 });
    expect(tileOf(-1, -251, 250)).toEqual({ tx: -1, tz: -2 });
  });
  it('builds ground, road and building meshes relative to the tile origin', () => {
    expect(tile.origin).toEqual([0, 210, 0]);
    expect(tile.meshes.map((m) => m.name)).toEqual(['ground', 'roads', 'buildings']);
    const st = tileStats(tile);
    expect(st.triangles).toBe(800 + 2 + 8 + 2);
    expect(st.colliderTriangles).toBe(st.triangles);
    expect(st.placements).toBe(4 * 10 * 2);
    for (const m of tile.meshes) for (const v of m.pos) expect(v).toBeGreaterThanOrEqual(-1);
  });
  it('front faces are clockwise: (b - a) x (c - a) points against the normal', () => {
    for (const m of tile.meshes) {
      for (let k = 0; k < m.idx.length; k += 3) {
        const [a, b, c] = [m.idx[k]! * 3, m.idx[k + 1]! * 3, m.idx[k + 2]! * 3];
        const u = [m.pos[b]! - m.pos[a]!, m.pos[b + 1]! - m.pos[a + 1]!, m.pos[b + 2]! - m.pos[a + 2]!];
        const v = [m.pos[c]! - m.pos[a]!, m.pos[c + 1]! - m.pos[a + 1]!, m.pos[c + 2]! - m.pos[a + 2]!];
        const cross = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
        expect(cross[0]! * m.nrm[a]! + cross[1]! * m.nrm[a + 1]! + cross[2]! * m.nrm[a + 2]!).toBeLessThan(0);
      }
    }
  });
  it('a T1 file reads back to the same arrays', () => {
    const bytes = encodeT1(tile);
    expect(bytes.length % 4).toBe(0);
    const t = decodeT1(bytes);
    expect(t.header.tile).toEqual({ district: 'test', x: 0, z: 0, size: 250 });
    const m = t.header.meshes[2]!;
    expect(m.name).toBe('buildings');
    expect(Array.from(t.f32(m.pos, m.vertices * 3))).toEqual(tile.meshes[2]!.pos.map((v) => Math.fround(v)));
    expect(Array.from(t.u32(m.idx, m.indices))).toEqual(tile.meshes[2]!.idx);
    expect(t.header.colliders.reduce((n, c) => n + c.triangles, 0)).toBe(tileStats(tile).colliderTriangles);
    expect(t.header.placements[0]).toMatchObject({ module: 'facade_bay', count: 80 });
    expect(() => decodeT1(new Uint8Array(16))).toThrow();
  });
  it('the .glb has a JSON and a BIN chunk of the stated length', () => {
    const glb = encodeGlb(tile);
    const view = new DataView(glb.buffer);
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    expect(view.getUint32(8, true)).toBe(glb.length);
    const jsonLen = view.getUint32(12, true);
    const json = JSON.parse(String.fromCharCode(...glb.subarray(20, 20 + jsonLen)));
    expect(json.meshes).toHaveLength(tile.meshes.length + tile.colliders.length);
    expect(view.getUint32(20 + jsonLen, true)).toBe(json.buffers[0].byteLength);
  });
});

describe('landmark join (LM1)', () => {
  const wd = (qid: string, label: string, lat: number, lon: number, sitelinks: number, asi: string | null = null): WikidataItem => ({ qid, label, labelHi: null, lat, lon, sitelinks, asi, inception: null, heightM: null, instanceOf: [], heritage: [], commons: null });
  it('joins on the wikidata tag, flags name matches and far coordinates, and proposes tiers', () => {
    const s = new Sketch();
    const ring = (x: number, n: number, tags: Record<string, string>) => {
      const ids = [s.node(x, n), s.node(x + 0.001, n), s.node(x + 0.001, n + 0.001), s.node(x, n + 0.001)];
      s.way([...ids, ids[0]!], tags);
    };
    ring(77.2295, 28.6129, { historic: 'memorial', name: 'India Gate', wikidata: 'Q1' });
    ring(77.24, 28.656, { historic: 'fort', name: 'Old Fort Wall' });
    s.node(77.21, 28.63, { tourism: 'museum', name: 'Small Museum', wikidata: 'Q3' });
    s.node(77.2, 28.6, { amenity: 'cafe', name: 'Cafe' });
    const osm = osmLandmarks(s.elements);
    expect(osm.map((o) => o.name).sort()).toEqual(['India Gate', 'Old Fort Wall', 'Small Museum']);
    const items = [wd('Q1', 'India Gate', 28.6134, 77.23, 80), wd('Q2', 'Old Fort Wall', 28.6565, 77.2405, 3, 'N-DL-1'), wd('Q3', 'Small Museum', 28.631, 77.21, 1), wd('Q4', 'Lost Tomb', 28.62, 77.22, 2, 'N-DL-2')];
    const c = joinLandmarks(osm, items, { heroes: ['India Gate'], signatures: [], nameRadius: 150 });
    expect(c.map((x) => [x.name, x.match, x.tier])).toEqual([
      ['India Gate', 'wikidata_tag', 'hero'], ['Old Fort Wall', 'name_distance', 'signature'], ['Lost Tomb', 'none', 'marker'], ['Small Museum', 'wikidata_tag', 'marker'],
    ]);
    expect(c[1]!.flags).toContain('fallback_name_match');
    expect(c[3]!.flags).toContain('osm_wikidata_over_50m');
    expect(c[0]!.hasFootprint).toBe(true);
    const d = distanceStats(c);
    expect(d.n).toBe(3);
    expect(d.over50).toBe(1);
    expect(haversine(28.6, 77.2, 28.601, 77.2)).toBeCloseTo(111.2, 0);
  });
});
