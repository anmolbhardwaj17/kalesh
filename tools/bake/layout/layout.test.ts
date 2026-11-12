// The layout of the signed seamless map (P1-008; TECH.md "World layout", MAP_REPAIR.md "District frames and
// stitching"): the placement method, rule R-STITCH (centre pairs, far blocks, translation only, block gaps, extent),
// landmark positions read back from tile bytes, and the far block outlines. The yardstick is the geodesic on the
// ellipsoid (geodesic.ts), which shares no code with the projection.
import { describe, expect, it } from 'vitest';
import connFlyover from '../../../harness/data/connectors/minto_road_flyover.json?raw';
import connArc from '../../../harness/data/connectors/ring_road_arc.json?raw';
import connBridge from '../../../harness/data/connectors/vikas_marg_bridge.json?raw';
import districtsRaw from '../../../harness/data/districts.json?raw';
import outlineAirport from '../../../harness/data/districts/airport_t3.geojson?raw';
import outlineCc from '../../../harness/data/districts/chandni_chowk.geojson?raw';
import outlineCp from '../../../harness/data/districts/cp.geojson?raw';
import outlineCyber from '../../../harness/data/districts/cyber_city.geojson?raw';
import outlineIg from '../../../harness/data/districts/india_gate.geojson?raw';
import outlineLn from '../../../harness/data/districts/laxmi_nagar.geojson?raw';
import outlinePilot from '../../../harness/data/districts/pilot_centre.geojson?raw';
import placesRaw from '../../../harness/data/districts/places.json?raw';
import outlineQutub from '../../../harness/data/districts/qutub_mehrauli.geojson?raw';
import outlineVk from '../../../harness/data/districts/vasant_kunj.geojson?raw';
import { geoToWorld, projector } from '../../geo/projection';
import type { P2 } from '../geom';
import { encodeT1 } from '../tile/codec';
import { TileSet, prism } from '../tileset';
import { rectRing } from './edge';
import { RULE, checkLayout, farBlockChecks, layoutPositions, pairRows, pairTable, placePoints } from './gate';
import type { BlockOutline, LayoutInput, Place } from './gate';
import { bearingDiffDeg, geodesic, layoutPair, worldBearingDeg } from './geodesic';
import { outlineAreaKm2, outlineContains, outlineRing, readOutline, ringProblems } from './outline';
import { landmarkErrors, layoutChecks, pinCentres, pinName } from './pincheck';
import type { LandmarkRef } from './pincheck';
import { blockFrame, blockOffset, blockPlacers, centreBlock, forbiddenTransformKeys, layoutProblems, placer, transformCheck } from './placement';
import type { Frame, LayoutFile, Placer } from './placement';

const file = JSON.parse(districtsRaw) as LayoutFile;
const places = (JSON.parse(placesRaw) as { places: (Place & { pilot?: boolean })[] }).places;
const FAR = ['qutub_mehrauli', 'vasant_kunj', 'airport_t3', 'cyber_city'] as const;
const farText: Record<string, string> = { qutub_mehrauli: outlineQutub, vasant_kunj: outlineVk, airport_t3: outlineAirport, cyber_city: outlineCyber };
const focusText: Record<string, string> = { cp: outlineCp, india_gate: outlineIg, chandni_chowk: outlineCc, laxmi_nagar: outlineLn };

/** Every outline that is drawn today: the far blocks, the focus districts, the pilot stage and the draft focus rings. */
function allOutlines(): BlockOutline[] {
  const out: BlockOutline[] = [];
  for (const id of FAR) out.push({ id, block: id, coords: readOutline(farText[id] as string, id).coords });
  for (const d of file.districts) out.push({ id: d.id, block: d.block, coords: readOutline(focusText[d.id] as string, d.id).coords });
  out.push({ id: 'pilot', block: 'centre', coords: readOutline(outlinePilot, 'pilot').coords });
  for (const d of file.planned ?? []) if (d.outline && typeof d.outline === 'object') out.push({ id: d.id, block: d.block, coords: d.outline.ring });
  return out;
}

const input: LayoutInput = { file, places, outlines: allOutlines() };
const check = checkLayout(input);
const frames: Frame[] = file.blocks.map((b) => blockFrame(file, b.id));
const centre = placer(blockFrame(file, 'centre'));
const place = (id: string): Place => {
  const p = places.find((x) => x.id === id);
  if (!p) throw new Error(`no place ${id}`);
  return p;
};
const copy = (): LayoutFile => JSON.parse(districtsRaw) as LayoutFile;
const result = (c: typeof check, id: string) => c.results.find((r) => r.id.startsWith(`${RULE}-${id}`));

describe('placement method', () => {
  it('is the signed one: pivot India Gate at (621.6, 467.2), the centre at 1.0, far blocks at 0.5', () => {
    const { pivot, centreFactor, farFactor } = file.method;
    expect(pivot.name).toBe('India Gate');
    expect(pivot.world).toEqual({ x: 621.6, z: 467.2 });
    expect(centreFactor).toBe(1);
    expect(farFactor).toBe(0.5);
    expect(file.blocks.map((b) => b.id)).toEqual(['centre', ...FAR]);
    expect(centreBlock(file).id).toBe('centre');
    expect(file.blocks.map((b) => b.factor)).toEqual([1, 0.5, 0.5, 0.5, 0.5]);
    expect(layoutProblems(file)).toEqual([]);
  });

  it('gives every block offset = pivot.world + factor x geoToWorld(origin, pivot), and the file records it', () => {
    const { pivot } = file.method;
    for (const b of file.blocks) {
      const v = geoToWorld(b.frameOrigin.lat, b.frameOrigin.lon, pivot);
      const want = { x: pivot.world.x + b.factor * v.x, z: pivot.world.z + b.factor * v.z };
      const got = blockOffset(pivot, b.factor, b.frameOrigin);
      expect(got.x).toBeCloseTo(want.x, 9);
      expect(got.z).toBeCloseTo(want.z, 9);
      expect(blockFrame(file, b.id).offset).toEqual(got);
      // the number in the file is a record of the method to 0.1 m, never a hand-set value
      expect(Math.hypot(b.offset.x - want.x, b.offset.z - want.z)).toBeLessThan(0.06);
    }
    expect(blockFrame(file, 'centre').offset).toEqual({ x: 621.6, z: 467.2 });
    expect(() => blockFrame(file, 'nowhere')).toThrow(/no block/);
  });

  it('reads focus districts as outlines inside a block, not as frames', () => {
    expect(file.districts.map((d) => d.id)).toEqual(['cp', 'india_gate', 'chandni_chowk', 'laxmi_nagar']);
    for (const d of file.districts) {
      expect(d.block).toBe('centre');
      expect(d.outline).toBe(`districts/${d.id}.geojson`);
      // the island bench fields are gone
      for (const key of ['offset', 'heightOffset', 'layoutBoxKm', 'layoutAnchor', 'draftRect', 'clip']) expect(d as unknown as Record<string, unknown>).not.toHaveProperty(key);
    }
    for (const key of ['layout', 'x2Origin', 'heightLevelM']) expect(file as unknown as Record<string, unknown>).not.toHaveProperty(key);
  });

  it('catches data that breaks the method', () => {
    const wrongFactor = copy();
    (wrongFactor.blocks[1] as { factor: number }).factor = 0.6;
    expect(layoutProblems(wrongFactor).join(' ')).toMatch(/qutub_mehrauli: factor 0.6/);
    const handSet = copy();
    (handSet.blocks[4] as { offset: P2 }).offset.x += 1;
    expect(layoutProblems(handSet).join(' ')).toMatch(/cyber_city: offset .* is 1\.0\d m off the method/);
    const turned = copy() as LayoutFile & { blocks: Record<string, unknown>[] };
    (turned.blocks[2] as Record<string, unknown>)['rotationDeg'] = 4;
    expect(layoutProblems(turned)).toContain('key blocks.2.rotationDeg could carry a rotation, a scale or a mirror');
    const lost = copy();
    (lost.districts[0] as { block: string }).block = 'south';
    expect(layoutProblems(lost)).toContain('district cp: block "south" is not in blocks');
    const twoCentres = copy();
    (twoCentres.blocks[3] as { factor: number }).factor = 1;
    expect(layoutProblems(twoCentres).join(' ')).toMatch(/exactly one centre block \(found 2\)/);
    expect(result(checkLayout({ ...input, file: wrongFactor }), '01')?.ok).toBe(false);
  });
});

describe('R-STITCH centre pairs', () => {
  const centrePlaces = places.filter((p) => p.block === 'centre');
  const points = placePoints(file, places, 'centre');

  it('has at least 12 named centre places, each read from a named source', () => {
    expect(centrePlaces.length).toBeGreaterThanOrEqual(12);
    expect(new Set(centrePlaces.map((p) => p.id)).size).toBe(centrePlaces.length);
    for (const p of centrePlaces) {
      expect(p.name.length).toBeGreaterThan(3);
      expect(p.from.length).toBeGreaterThan(10);
    }
    expect(points).toHaveLength(centrePlaces.length);
  });

  it('every pair keeps its real bearing within 0.5 degrees and its real distance within 0.5%', () => {
    const { gates } = file.method;
    expect(gates.centrePairBearingDeg).toBe(0.5);
    expect(gates.centrePairDistancePct).toBe(0.5);
    let pairs = 0;
    for (let i = 0; i < centrePlaces.length; i++) {
      for (let j = i + 1; j < centrePlaces.length; j++) {
        const a = centrePlaces[i] as Place;
        const b = centrePlaces[j] as Place;
        // the yardstick, straight from the two real positions
        const real = geodesic(a, b);
        const wa = centre.toWorld(a.lat, a.lon);
        const wb = centre.toWorld(b.lat, b.lon);
        const gameM = Math.hypot(wb.x - wa.x, wb.z - wa.z);
        const gameBearing = worldBearingDeg(wb.x - wa.x, wb.z - wa.z);
        expect(bearingDiffDeg(gameBearing, real.bearingDeg), `${a.name} to ${b.name}`).toBeLessThan(0.5);
        expect((Math.abs(gameM - real.distanceM) / real.distanceM) * 100, `${a.name} to ${b.name}`).toBeLessThan(0.5);
        pairs++;
      }
    }
    expect(pairs).toBe((centrePlaces.length * (centrePlaces.length - 1)) / 2);
    // the rule sees the same thing
    expect(check.pairs).toHaveLength(pairs);
    expect(check.pairs.every((p) => p.ok)).toBe(true);
    expect(result(check, '03')?.ok).toBe(true);
    // measured: grid north turns by 0.023 degrees 4.7 km east of India Gate, distances hold to a few millimetres
    expect(Math.max(...check.pairs.map((p) => p.bearingErrorDeg))).toBeLessThan(0.05);
    expect(Math.max(...check.pairs.map((p) => p.errorPct))).toBeLessThan(0.001);
    expect(pairRows(check.pairs)[0]).toMatchObject({ a: 'India Gate', b: 'Connaught Place', ok: true });
  });

  it('fails the island layout of the Phase 0 bench, a turned map and a stretched map', () => {
    // the island offsets the stitch bench used for Connaught Place and Chandni Chowk (decisions_archive.md P0-029)
    const islands: Record<string, Frame> = {
      connaught_place: { id: 'cp', origin: { lat: 28.6315, lon: 77.2167 }, offset: { x: -950, z: -1221.7 } },
      jantar_mantar: { id: 'cp', origin: { lat: 28.6315, lon: 77.2167 }, offset: { x: -950, z: -1221.7 } },
      red_fort: { id: 'cc', origin: { lat: 28.6506, lon: 77.2303 }, offset: { x: 590.5, z: -2334 } },
      jama_masjid: { id: 'cc', origin: { lat: 28.6506, lon: 77.2303 }, offset: { x: 590.5, z: -2334 } },
    };
    const island = checkLayout(input, (p) => (islands[p.id] ? placer(islands[p.id] as Frame) : centre).toWorld(p.lat, p.lon));
    expect(result(island, '03')?.ok).toBe(false);
    const cpFort = island.pairs.find((p) => p.a === 'Connaught Place' && p.b === 'the Red Fort');
    expect(cpFort?.ok).toBe(false);
    expect(cpFort?.errorPct).toBeGreaterThan(10);
    // pairs inside one island still hold: the bench passed its own checks and was still the wrong map
    expect(island.pairs.find((p) => p.a === 'the Red Fort' && p.b === 'Jama Masjid')?.ok).toBe(true);

    const turn = (deg: number) => (p: Place): P2 => {
      const w = centre.toWorld(p.lat, p.lon);
      const c = Math.cos((deg * Math.PI) / 180);
      const s = Math.sin((deg * Math.PI) / 180);
      return { x: w.x * c - w.z * s, z: w.x * s + w.z * c };
    };
    expect(result(checkLayout(input, turn(0.6)), '03')?.ok).toBe(false);
    expect(result(checkLayout(input, turn(0.2)), '03')?.ok).toBe(true);
    const stretched = checkLayout(input, (p) => ({ x: centre.toWorld(p.lat, p.lon).x * 1.01, z: centre.toWorld(p.lat, p.lon).z }));
    expect(result(stretched, '03')?.ok).toBe(false);
    const mirrored = checkLayout(input, (p) => ({ x: -centre.toWorld(p.lat, p.lon).x, z: centre.toWorld(p.lat, p.lon).z }));
    expect(result(mirrored, '03')?.ok).toBe(false);
    expect(result(checkLayout({ ...input, places: places.filter((p) => p.block !== 'centre') }), '03')?.ok).toBe(false);
  });
});

describe('R-STITCH far blocks', () => {
  it.each(FAR)('%s: its origin is on its real bearing from India Gate within 0.1 degree, at 0.5 of its real distance within 0.5%%', (id) => {
    const { pivot } = file.method;
    const b = file.blocks.find((x) => x.id === id);
    expect(b).toBeTruthy();
    const real = geodesic(pivot, b!.frameOrigin);
    const o = blockFrame(file, id).offset;
    const dx = o.x - pivot.world.x;
    const dz = o.z - pivot.world.z;
    expect(bearingDiffDeg(worldBearingDeg(dx, dz), real.bearingDeg)).toBeLessThan(0.1);
    const want = 0.5 * real.distanceM;
    expect((Math.abs(Math.hypot(dx, dz) - want) / want) * 100).toBeLessThan(0.5);
    // the far south really is south-west of India Gate: larger z, smaller x
    expect(o.z).toBeGreaterThan(pivot.world.z + 2500);
    expect(o.x).toBeLessThan(pivot.world.x - 1500);
    // the record in the file is the same point
    expect(Math.hypot(b!.offset.x - o.x, b!.offset.z - o.z)).toBeLessThan(0.06);
  });

  it('the rule agrees, and measures a few thousandths of a degree at most', () => {
    const far = farBlockChecks(file);
    expect(far.map((f) => f.block)).toEqual([...FAR]);
    expect(far.every((f) => f.ok)).toBe(true);
    expect(Math.max(...far.map((f) => f.bearingErrorDeg))).toBeLessThan(0.005);
    expect(Math.max(...far.map((f) => f.distanceErrorPct))).toBeLessThan(0.01);
    // Cyber City: 19.0 km from India Gate in reality, 9.5 km in the game
    const cyber = far.find((f) => f.block === 'cyber_city');
    expect(cyber?.realM).toBeGreaterThan(18900);
    expect(cyber?.gameM).toBeCloseTo(cyber!.realM / 2, 0);
    expect(result(check, '04')?.ok).toBe(true);
  });

  it('takes each frame origin from a checked real place', () => {
    const origins: Record<string, string> = { qutub_mehrauli: 'qutb_minar', vasant_kunj: 'dlf_promenade', airport_t3: 'igi_terminal_3', cyber_city: 'cyber_hub' };
    for (const id of FAR) {
      const b = file.blocks.find((x) => x.id === id)!;
      const p = place(origins[id] as string);
      expect(p.block).toBe(id);
      expect({ lat: b.frameOrigin.lat, lon: b.frameOrigin.lon }).toEqual({ lat: p.lat, lon: p.lon });
      expect(b.frameOrigin.from).toMatch(/^OSM way \d+/);
      // a place at the frame origin lands on the block offset
      const w = placer(blockFrame(file, id)).toWorld(p.lat, p.lon);
      expect(Math.hypot(w.x - blockFrame(file, id).offset.x, w.z - blockFrame(file, id).offset.z)).toBeLessThan(1e-6);
    }
  });
});

describe('R-STITCH translation only', () => {
  it.each(file.blocks.map((b) => b.id))('%s: north on -Z, east on +X, determinant +1, no scale', (id) => {
    const p = placer(blockFrame(file, id));
    const t = transformCheck(p);
    expect(t.ok).toBe(true);
    expect(t.jacobianError).toBeLessThan(1e-9);
    expect(Math.abs(t.northOffDeg)).toBeLessThan(1e-6);
    expect(Math.abs(t.eastOffDeg)).toBeLessThan(1e-6);
    expect(t.handed).toBe(1);
    expect(t.determinant).toBeCloseTo(1, 9);
    expect(Math.abs(t.scaleNorth - 1)).toBeLessThan(1e-5);
    expect(Math.abs(t.scaleEast - 1)).toBeLessThan(1e-5);
    // plain numbers: a step north lowers z and keeps x, a step east raises x and keeps z
    const { lat, lon } = p.frame.origin;
    const here = p.toWorld(lat, lon);
    const north = p.toWorld(lat + 0.001, lon);
    const east = p.toWorld(lat, lon + 0.001);
    expect(north.z).toBeLessThan(here.z - 100);
    expect(Math.abs(north.x - here.x)).toBeLessThan(1e-6);
    expect(east.x).toBeGreaterThan(here.x + 90);
    expect(Math.abs(east.z - here.z)).toBeLessThan(0.01);
    // block metres to world metres is the offset and nothing else, both ways
    const q = { x: 1234.5, z: -678.9 };
    expect(p.place(q)).toEqual({ x: q.x + p.frame.offset.x, z: q.z + p.frame.offset.z });
    expect(p.local(p.place(q)).x).toBeCloseTo(q.x, 9);
    const g = p.toGeo(p.toWorld(lat + 0.004, lon - 0.006));
    expect(g.lat).toBeCloseTo(lat + 0.004, 7);
    expect(g.lon).toBeCloseTo(lon - 0.006, 7);
  });

  it('the rule passes for all five blocks', () => {
    expect(check.transforms.map((t) => t.block)).toEqual(['centre', ...FAR]);
    expect(check.transforms.every((t) => t.ok)).toBe(true);
    expect(result(check, '02')?.ok).toBe(true);
    expect(blockPlacers(file)).toHaveLength(5);
  });

  it('catches a mirrored, a turned and a scaled placement', () => {
    const good = centre;
    const o = good.frame.offset;
    const mirrored: Placer = { ...good, toWorld: (lat, lon) => ({ x: -good.toWorld(lat, lon).x, z: good.toWorld(lat, lon).z }), place: (p) => ({ x: -p.x + o.x, z: p.z + o.z }) };
    const m = transformCheck(mirrored);
    expect(m.ok).toBe(false);
    expect(m.handed).toBe(-1);
    expect(m.determinant).toBeCloseTo(-1, 6);
    const flippedZ: Placer = { ...good, toWorld: (lat, lon) => ({ x: good.toWorld(lat, lon).x, z: -good.toWorld(lat, lon).z }), place: (p) => ({ x: p.x + o.x, z: -p.z + o.z }) };
    expect(transformCheck(flippedZ).handed).toBe(-1);
    expect(transformCheck(flippedZ).ok).toBe(false);
    const turned: Placer = { ...good, place: (p) => ({ x: p.x * 0.999 - p.z * 0.04 + o.x, z: p.x * 0.04 + p.z * 0.999 + o.z }) };
    expect(transformCheck(turned).ok).toBe(false);
    const c = Math.cos(0.01);
    const s = Math.sin(0.01);
    const spun: Placer = { ...good, toWorld: (lat, lon) => ({ x: good.proj.toWorld(lat, lon).x * c - good.proj.toWorld(lat, lon).z * s + o.x, z: good.proj.toWorld(lat, lon).x * s + good.proj.toWorld(lat, lon).z * c + o.z }) };
    const sp = transformCheck(spun);
    expect(sp.ok).toBe(false);
    expect(Math.abs(sp.northOffDeg)).toBeCloseTo(0.573, 2);
    const scaled: Placer = { ...good, toWorld: (lat, lon) => ({ x: good.proj.toWorld(lat, lon).x * 0.5 + o.x, z: good.proj.toWorld(lat, lon).z * 0.5 + o.z }) };
    const sc = transformCheck(scaled);
    expect(sc.ok).toBe(false);
    expect(sc.scaleNorth).toBeCloseTo(0.5, 6);
    expect(sc.handed).toBe(1);
  });

  it('no data file of the layout can carry a rotation, a scale or a mirror', () => {
    expect(forbiddenTransformKeys(file)).toEqual([]);
    expect(forbiddenTransformKeys(JSON.parse(placesRaw))).toEqual([]);
    for (const raw of [outlineQutub, outlineVk, outlineAirport, outlineCyber, outlinePilot, outlineCp, connArc, connFlyover, connBridge]) expect(forbiddenTransformKeys(JSON.parse(raw))).toEqual([]);
    expect(forbiddenTransformKeys({ blocks: [{ id: 'a', rotationDeg: 3, placement: { scale: 1 } }] })).toEqual(['blocks.0.rotationDeg', 'blocks.0.placement.scale']);
    expect(forbiddenTransformKeys({ a: { mirrorX: true, flipZ: false, Basis: [1, 0, 0, 1] } })).toEqual(['a.mirrorX', 'a.flipZ', 'a.Basis']);
  });
});

describe('landmarks', () => {
  const refs: LandmarkRef[] = ['india_gate', 'connaught_place', 'red_fort', 'jama_masjid', 'qutb_minar', 'cyber_hub'].map((id) => {
    const p = place(id);
    return { id, name: p.name, block: p.block, osm: p.from, points: [{ lat: p.lat, lon: p.lon }] };
  });
  /** Pins written into 250 m tiles by a placement, then encoded as the game will load them. */
  const bakeTiles = (toWorld: (ref: LandmarkRef, lat: number, lon: number) => P2): Uint8Array[] => {
    const set = new TileSet(190);
    for (const r of refs) {
      r.points.forEach((geo, k) => {
        const w = toWorld(r, geo.lat, geo.lon);
        prism(set, r.block, 'pin', rectRing(w, 0.6, 0.6), 215, 215.6, pinName(r.id, k), w);
      });
    }
    return set.contents().map((t) => encodeT1(t));
  };
  const byMethod = (r: LandmarkRef, lat: number, lon: number): P2 => placer(frames.find((f) => f.id === r.block) as Frame).toWorld(lat, lon);
  const baked = pinCentres(bakeTiles(byMethod));
  const at = (id: string): P2 => baked.get(pinName(id, 0)) as P2;

  it('India Gate lands at world (621.6, 467.2) within 0.5 m', () => {
    const ig = place('india_gate');
    const w = centre.toWorld(ig.lat, ig.lon);
    expect(Math.hypot(w.x - 621.6, w.z - 467.2)).toBeLessThan(0.5);
    // and so it does in the tile bytes the game loads
    expect(Math.hypot(at('india_gate').x - 621.6, at('india_gate').z - 467.2)).toBeLessThan(0.5);
    expect(Math.hypot(at('india_gate').x - 621.6, at('india_gate').z - 467.2)).toBeLessThan(0.001);
  });

  it('Connaught Place is north-west of India Gate, the Red Fort north-east', () => {
    const ig = at('india_gate');
    const cp = at('connaught_place');
    const fort = at('red_fort');
    expect(cp.x).toBeLessThan(ig.x);
    expect(cp.z).toBeLessThan(ig.z);
    expect(fort.x).toBeGreaterThan(ig.x);
    expect(fort.z).toBeLessThan(ig.z);
    // by how much: about 0.95 km west and 2.2 km north; about 1.05 km east and 4.8 km north
    expect(ig.x - cp.x).toBeGreaterThan(900);
    expect(ig.z - cp.z).toBeGreaterThan(2100);
    expect(fort.x - ig.x).toBeGreaterThan(1000);
    expect(ig.z - fort.z).toBeGreaterThan(4700);
  });

  it('reads every pin back from the tile bytes within a tenth of a millimetre of the method', () => {
    const errors = landmarkErrors(refs, frames, baked);
    for (const e of errors) {
      expect(e.missing).toBe(0);
      expect(e.maxM, e.name).toBeLessThan(0.0001);
    }
    // the Red Fort is north-east of Jama Masjid at the true distance (MAP_REPAIR.md "Landmark tests")
    const [pair] = layoutChecks([['jama_masjid', 'red_fort']], refs, errors);
    expect(pair!.bakedBearingDeg).toBeGreaterThan(20);
    expect(pair!.bakedBearingDeg).toBeLessThan(70);
    expect(pair!.errorM).toBeLessThan(0.01);
    expect(pair!.bearingErrorDeg).toBeLessThan(0.01);
    expect(() => layoutChecks([['red_fort', 'qutb_minar']], refs, errors)).toThrow(/different blocks/);
    // Qutub Minar: on its real bearing from India Gate, at half its real distance
    const real = geodesic(place('india_gate'), place('qutb_minar'));
    const q = at('qutb_minar');
    const ig = at('india_gate');
    expect(bearingDiffDeg(worldBearingDeg(q.x - ig.x, q.z - ig.z), real.bearingDeg)).toBeLessThan(0.1);
    expect(Math.hypot(q.x - ig.x, q.z - ig.z)).toBeCloseTo(real.distanceM / 2, 0);
  });

  it('catches a wrong offset, a mirror and a missing pin', () => {
    const shifted = landmarkErrors(refs, frames, pinCentres(bakeTiles((r, lat, lon) => ({ x: byMethod(r, lat, lon).x + 2, z: byMethod(r, lat, lon).z }))));
    expect(shifted[0]!.maxM).toBeCloseTo(2, 3);
    const mirrored = landmarkErrors(refs, frames, pinCentres(bakeTiles((r, lat, lon) => ({ x: -byMethod(r, lat, lon).x, z: byMethod(r, lat, lon).z }))));
    expect(mirrored[0]!.maxM).toBeGreaterThan(1000);
    const none = landmarkErrors(refs, frames, new Map());
    expect(none[0]!.missing).toBe(1);
    expect(() => landmarkErrors([{ ...(refs[0] as LandmarkRef), block: 'nowhere' }], frames, baked)).toThrow(/no block/);
  });
});

describe('far block outlines', () => {
  it.each(FAR)('%s: a closed simple ring that holds its frame origin and its places', (id) => {
    const b = file.blocks.find((x) => x.id === id)!;
    expect(b.outline).toBe(`districts/${id}.geojson`);
    const o = readOutline(farText[id] as string, id);
    expect(o.id).toBe(id);
    expect(o.properties['block']).toBe(id);
    expect(o.coords.length).toBeGreaterThanOrEqual(10);
    expect(o.coords[0]).toEqual(o.coords[o.coords.length - 1]);
    expect(ringProblems(outlineRing(o.coords, b.frameOrigin))).toEqual([]);
    expect(outlineContains(o.coords, b.frameOrigin.lat, b.frameOrigin.lon)).toBe(true);
    for (const p of places.filter((x) => x.block === id)) expect(outlineContains(o.coords, p.lat, p.lon), p.name).toBe(true);
    // compact: a far block is true scale inside but sits at half its real distance, so it must stay small
    const area = outlineAreaKm2(o.coords);
    expect(area).toBeGreaterThan(1);
    expect(area).toBeLessThan(4);
    expect(o.properties['areaKm2']).toBeCloseTo(area, 2);
    for (const q of outlineRing(o.coords, b.frameOrigin)) expect(Math.hypot(q.x, q.z)).toBeLessThan(2600);
    // the file says where its points and its origin come from
    const fo = o.properties['frameOrigin'] as { lat: number; lon: number };
    expect({ lat: fo.lat, lon: fo.lon }).toEqual({ lat: b.frameOrigin.lat, lon: b.frameOrigin.lon });
    const waypoints = o.properties['waypoints'] as { name: string; lat: number; lon: number }[];
    expect(waypoints.map((w) => [w.lon, w.lat])).toEqual(o.coords.slice(0, -1));
    expect(waypoints.every((w) => w.name.length > 5)).toBe(true);
    // no place of another block is inside it
    for (const p of places.filter((x) => x.block !== id)) expect(outlineContains(o.coords, p.lat, p.lon), p.name).toBe(false);
  });

  it('placed outlines of different blocks never overlap and keep the corridor gap', () => {
    expect(file.method.gates.blockGapMinM).toBe(250);
    expect(check.blocks.overlapping).toBe(0);
    expect(check.blocks.minGapM).toBeGreaterThanOrEqual(250);
    expect(check.blocks.minGapBetween).toEqual(['qutub_mehrauli', 'vasant_kunj']);
    expect(result(check, '05')?.ok).toBe(true);
    // every pair of far blocks is there, and every far block against every centre outline
    const far = check.blocks.pairs.filter((p) => (FAR as readonly string[]).includes(p.a) && (FAR as readonly string[]).includes(p.b));
    expect(far).toHaveLength(6);
    expect(check.blocks.pairs.length).toBe(6 + 4 * (input.outlines.length - 4));
  });

  it('catches a far block drawn too big: Aerocity inside the airport block lands on the Vasant Kunj malls', () => {
    // Aerocity is 3.6 km east of Terminal 3 in reality; the two block origins are only half their real distance apart
    const airport = readOutline(outlineAirport, 'airport_t3').coords;
    const grown: [number, number][] = [...airport.slice(0, 6), [77.1255, 28.546], [77.1255, 28.556], ...airport.slice(6)];
    expect(ringProblems(outlineRing(grown, { lat: 28.55485, lon: 77.08417 }))).toEqual([]);
    const c = checkLayout({ ...input, outlines: input.outlines.map((o) => (o.id === 'airport_t3' ? { ...o, coords: grown } : o)) });
    expect(result(c, '05')?.ok).toBe(false);
    expect(c.blocks.overlapping).toBeGreaterThan(0);
    expect(c.blocks.pairs.find((p) => p.a === 'vasant_kunj' && p.b === 'airport_t3')?.overlapM2).toBeGreaterThan(10000);
    // and a block pushed against its neighbour with no room for a corridor
    const vk = readOutline(outlineVk, 'vasant_kunj').coords;
    const near: [number, number][] = vk.map(([lon, lat]) => (lon === 77.165 && lat === 28.535 ? [77.1672, 28.5345] : [lon, lat]));
    const tight = checkLayout({ ...input, outlines: input.outlines.map((o) => (o.id === 'vasant_kunj' ? { ...o, coords: near } : o)) });
    expect(tight.blocks.overlapping).toBe(0);
    expect(tight.blocks.minGapM).toBeLessThan(250);
    expect(result(tight, '05')?.ok).toBe(false);
  });
});

describe('R-STITCH extent (FP1)', () => {
  const e = check.extent;

  it('with every planned block placed the map box is under 16 km wide', () => {
    expect(file.method.gates.mapWidthMaxKm).toBe(16);
    expect(e.widthM).toBeLessThan(16000);
    expect(e.depthM).toBeLessThan(16000);
    // every block is in: the box runs from the airport in the west to Laxmi Nagar in the east, Kashmere Gate to Cyber City
    const pts = layoutPositions(input);
    expect(e.positions).toBe(pts.length);
    for (const id of ['centre', ...FAR]) expect(pts.some((p) => p.name === `block ${id} origin`)).toBe(true);
    expect(pts.some((p) => p.name.startsWith('airport_t3 outline point') && p.x === e.box.minX)).toBe(true);
    expect(pts.some((p) => p.name.startsWith('laxmi_nagar outline point') && p.x === e.box.maxX)).toBe(true);
    expect(pts.some((p) => p.name.startsWith('cyber_city outline point') && p.z === e.box.maxZ)).toBe(true);
    // measured: 13.03 km by 13.37 km
    expect(e.widthM).toBeGreaterThan(12500);
    expect(e.depthM).toBeGreaterThan(13000);
  });

  it('the smallest circle round the map has a radius under 8 km, and the recentred origin keeps every position inside the float band', () => {
    // no world origin can bring every position nearer than the radius of the smallest circle: 7.98 km
    expect(e.circle.radiusM).toBeLessThan(8000);
    expect(e.circle.radiusM).toBeGreaterThan(7900);
    // the recentre puts the origin on that centre, snapped to whole 250 m tiles: 8.03 km at worst
    expect(Math.abs(e.originAfterRecentre.x - e.circle.centre.x)).toBeLessThanOrEqual(125);
    expect(Math.abs(e.originAfterRecentre.z - e.circle.centre.z)).toBeLessThanOrEqual(125);
    expect(e.originAfterRecentre.x % 250 === 0 && e.originAfterRecentre.z % 250 === 0).toBe(true);
    expect(e.reachAfterRecentreM).toBeLessThan(e.circle.radiusM + 177);
    // 8,192 m: up to there a 32-bit float steps by 0.49 mm, the band FP1 measured fine at 7 km
    expect(file.method.gates.reachMaxKm).toBe(8.192);
    expect(e.reachAfterRecentreM).toBeLessThanOrEqual(8192);
    // today, before any far block is baked, the centre block is at most 6.2 km from the origin
    expect(e.reachNowM).toBeLessThan(6500);
    expect(e.ok).toBe(true);
    expect(result(check, '06')?.ok).toBe(true);
  });

  it('the centre of the map box is not that origin: it leaves Cyber City 9 km out', () => {
    expect(e.reachAt).toMatch(/^cyber_city outline point/);
    expect(e.reachM).toBeGreaterThan(8192);
    expect(e.reachM).toBeGreaterThan(e.reachAfterRecentreM + 800);
  });

  it('catches a map that grows past the limits', () => {
    // Noida at factor 0.5 would be fine for the width, a block at the real distance of Cyber City would not
    const wide = copy();
    wide.method.farFactor = 1;
    for (const b of wide.blocks) if (b.id !== 'centre') (b as { factor: number }).factor = 1;
    const c = checkLayout({ ...input, file: wide });
    expect(c.extent.ok).toBe(false);
    expect(Math.max(c.extent.widthM, c.extent.depthM)).toBeGreaterThan(16000);
    expect(result(c, '06')?.ok).toBe(false);
    expect(result(c, '06')?.detail).toMatch(/^too wide/);
  });

  it('every part of the rule passes on the signed layout', () => {
    expect(check.results.map((r) => r.id)).toEqual([`${RULE}-01.data`, `${RULE}-02.translation`, `${RULE}-03.centrePairs`, `${RULE}-04.farBlocks`, `${RULE}-05.blockGaps`, `${RULE}-06.extent`]);
    expect(check.results.filter((r) => !r.ok)).toEqual([]);
    expect(check.problems).toEqual([]);
  });
});

describe('the geodesic yardstick', () => {
  it('shares no code with the projection and agrees with known lengths', () => {
    // one degree along the equator, and a quarter meridian
    expect(geodesic({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }).distanceM).toBeCloseTo(111319.491, 2);
    expect(geodesic({ lat: 0, lon: 0 }, { lat: 90, lon: 0 }).distanceM).toBeCloseTo(10001965.729, 1);
    expect(geodesic({ lat: 28.6, lon: 77.2 }, { lat: 28.61, lon: 77.2 }).bearingDeg).toBeCloseTo(0, 6);
    expect(geodesic({ lat: 28.6, lon: 77.2 }, { lat: 28.6, lon: 77.21 }).bearingDeg).toBeCloseTo(90, 1);
    expect(geodesic({ lat: 28.6, lon: 77.2 }, { lat: 28.6, lon: 77.2 })).toEqual({ distanceM: 0, bearingDeg: 0 });
    expect(worldBearingDeg(0, -1)).toBe(0);
    expect(worldBearingDeg(1, 0)).toBe(90);
    expect(worldBearingDeg(0, 1)).toBe(180);
    expect(worldBearingDeg(-1, 0)).toBe(270);
    expect(bearingDiffDeg(359.9, 0.1)).toBeCloseTo(0.2, 9);
  });

  it('the projection keeps a kilometre a kilometre inside a block', () => {
    const o = { lat: 28.6506, lon: 77.2303 };
    const a = { lat: o.lat + 0.004, lon: o.lon - 0.006 };
    const b = { lat: o.lat - 0.003, lon: o.lon + 0.007 };
    const proj = projector(file.method.pivot);
    const pair = layoutPair({ name: 'a', geo: a, world: proj.toWorld(a.lat, a.lon) }, { name: 'b', geo: b, world: proj.toWorld(b.lat, b.lon) });
    expect(pair.realM).toBeGreaterThan(1400);
    expect(pair.errorM).toBeLessThan(0.002);
    expect(pair.bearingErrorDeg).toBeLessThan(0.005);
    expect(pairTable([{ name: 'a', geo: a, world: proj.toWorld(a.lat, a.lon) }, { name: 'b', geo: b, world: proj.toWorld(b.lat, b.lon) }], file.method.gates)).toHaveLength(1);
  });
});
