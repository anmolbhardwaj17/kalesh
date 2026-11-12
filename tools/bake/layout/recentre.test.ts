// The recentre step (P1-008; TECH.md "World layout" World origin): one vector subtracted from every stored world
// position, a whole number of tiles, so tiles keep their content. Written and tested now; first used by the bake that
// includes a far block (P8).
import { describe, expect, it } from 'vitest';
import districtsRaw from '../../../harness/data/districts.json?raw';
import placesRaw from '../../../harness/data/districts/places.json?raw';
import connArc from '../../../harness/data/connectors/ring_road_arc.json?raw';
import type { P2 } from '../geom';
import { rng } from '../rand';
import { decodeT1, encodeT1 } from '../tile/codec';
import type { TileContent } from '../tile/codec';
import { TileSet, prism } from '../tileset';
import { rectRing } from './edge';
import type { Place } from './gate';
import { TILE_M, tileId, tileIdAt, tileOf, tileOrigin } from './grid';
import { pinCentres, pinName } from './pincheck';
import { blockFrame, placer } from './placement';
import type { LayoutFile } from './placement';
import { mapExtent, onGrid, originShift, recentre, recentreTo, recentreVector, smallestCircle, snapToTiles } from './recentre';
import type { WorldRecords } from './recentre';

const file = JSON.parse(districtsRaw) as LayoutFile;
const places = (JSON.parse(placesRaw) as { places: Place[] }).places;
const MM = 0.001;

/** Every place as a landmark pin in world metres, placed by its block. */
const pins = places.map((p) => ({ id: p.id, block: p.block, ...placer(blockFrame(file, p.block)).toWorld(p.lat, p.lon), y: 215 }));

/** The pins baked into 250 m tiles of the one world grid. */
function bakeTiles(list: readonly { id: string; block: string; x: number; z: number }[]): TileContent[] {
  const set = new TileSet(190);
  for (const p of list) prism(set, p.block, 'pin', rectRing(p, 0.6, 0.6), 215, 215.6, pinName(p.id, 0), p);
  return set.contents();
}

const tiles = bakeTiles(pins);

/** A record set as the game and the bake store it today, with the pivot at (621.6, 467.2). */
function records(): WorldRecords {
  return {
    pivotWorld: { ...file.method.pivot.world },
    blocks: file.blocks.map((b) => ({ id: b.id, offset: blockFrame(file, b.id).offset })),
    tiles: tiles.map((t) => ({ block: t.district, tx: t.tx, tz: t.tz, origin: [...t.origin] as [number, number, number] })),
    pins,
    anchors: [
      { id: 'm01_station_forecourt', block: 'centre', x: 30.4, z: -2835.2, heading: 1.2 },
      { id: 'm02_cp_stand', block: 'centre', x: -330.9, z: -1738.6, heading: 0 },
      { id: 'airport_run_drop', block: 'airport_t3', x: -6401.3, z: 3702.8, heading: 4.4 },
      { id: 'cyber_hub_meet', block: 'cyber_city', x: -6270.1, z: 6990.4 },
    ],
    saves: [{ profile: 'bittu', block: 'centre', x: 5329.7, y: 211.4, z: -1493.2, heading: 2.5 }],
    connectors: [{ id: 'ring_road_arc', points: (JSON.parse(connArc) as { points: P2[] }).points }],
    overrides: ['2_1', '-4_-9', '7_-18', '-26_28'],
  };
}

describe('recentre vector', () => {
  const all = pins.map((p) => ({ name: p.id, x: p.x, z: p.z }));

  it('is the centre of the smallest circle round the positions, snapped to whole tiles', () => {
    const c = smallestCircle(all);
    for (const p of all) expect(Math.hypot(p.x - c.centre.x, p.z - c.centre.z)).toBeLessThanOrEqual(c.radiusM + 1e-6);
    // at least two positions lie on the circle: it cannot shrink
    expect(all.filter((p) => Math.abs(Math.hypot(p.x - c.centre.x, p.z - c.centre.z) - c.radiusM) < 1e-6).length).toBeGreaterThanOrEqual(2);
    const v = recentreVector(all);
    expect(onGrid(v)).toBe(true);
    expect(Math.abs(v.x - c.centre.x)).toBeLessThanOrEqual(TILE_M / 2);
    expect(Math.abs(v.z - c.centre.z)).toBeLessThanOrEqual(TILE_M / 2);
    expect(v).toEqual(snapToTiles(c.centre));
    // from the new origin the farthest position is nearer than from the box centre, and far nearer than from today's
    const fromNew = mapExtent(all, v).reachM;
    expect(fromNew).toBeLessThanOrEqual(c.radiusM + Math.hypot(TILE_M / 2, TILE_M / 2));
    expect(fromNew).toBeLessThan(mapExtent(all).reachM);
    expect(fromNew).toBeLessThan(mapExtent(all, { x: 0, z: 0 }).reachM - 1500);
  });

  it('finds the smallest circle of simple sets exactly', () => {
    expect(smallestCircle([{ x: 3, z: 4 }])).toEqual({ centre: { x: 3, z: 4 }, radiusM: 0 });
    const two = smallestCircle([{ x: -1000, z: 0 }, { x: 1000, z: 0 }, { x: 0, z: 10 }]);
    expect(two.centre).toEqual({ x: 0, z: 0 });
    expect(two.radiusM).toBe(1000);
    // an equilateral triangle: the circumcircle
    const tri = smallestCircle([{ x: 0, z: -1000 }, { x: 866.0254037844386, z: 500 }, { x: -866.0254037844386, z: 500 }, { x: 10, z: 10 }]);
    expect(tri.centre.x).toBeCloseTo(0, 6);
    expect(tri.centre.z).toBeCloseTo(0, 6);
    expect(tri.radiusM).toBeCloseTo(1000, 6);
    // a long thin box with one far corner block: the box centre is the same point here, the circle is never worse
    const r = rng(7);
    for (let k = 0; k < 20; k++) {
      const pts = Array.from({ length: 40 }, () => ({ x: r.range(-7000, 6000), z: r.range(-5500, 7800) }));
      const c = smallestCircle(pts);
      const box = mapExtent(pts.map((p, i) => ({ name: String(i), ...p })));
      expect(pts.every((p) => Math.hypot(p.x - c.centre.x, p.z - c.centre.z) <= c.radiusM + 1e-6)).toBe(true);
      expect(c.radiusM).toBeLessThanOrEqual(box.reachM + 1e-6);
    }
    expect(() => smallestCircle([])).toThrow(/no points/);
    expect(snapToTiles({ x: 124.9, z: -125.1 })).toEqual({ x: 0, z: -250 });
    expect(Object.is(snapToTiles({ x: -10, z: 10 }).x, -0)).toBe(false);
  });
});

describe('recentre step', () => {
  const before = records();
  const v = recentreVector(pins);
  const after = recentre(before, v);

  it('uses a real vector: thousands of metres, a whole number of tiles', () => {
    expect(onGrid(v)).toBe(true);
    expect(Math.hypot(v.x, v.z)).toBeGreaterThan(1500);
    expect(v.x).toBeLessThan(0);
    expect(v.z).toBeGreaterThan(0);
  });

  it('pins and anchors after the step equal their positions before minus the vector, within 1 mm', () => {
    expect(after.pins).toHaveLength(before.pins.length);
    before.pins.forEach((p, i) => {
      const q = after.pins[i]!;
      expect(q.id).toBe(p.id);
      expect(q.block).toBe(p.block);
      expect(Math.abs(q.x - (p.x - v.x))).toBeLessThan(MM);
      expect(Math.abs(q.z - (p.z - v.z))).toBeLessThan(MM);
      expect(q.y).toBe(p.y);
    });
    before.anchors.forEach((a, i) => {
      const b = after.anchors[i]!;
      expect(Math.abs(b.x - (a.x - v.x))).toBeLessThan(MM);
      expect(Math.abs(b.z - (a.z - v.z))).toBeLessThan(MM);
      // a recentre never turns anything
      expect(b.heading).toBe(a.heading);
      expect(b.block).toBe(a.block);
    });
    const s0 = before.saves[0]!;
    const s1 = after.saves[0]!;
    expect(Math.abs(s1.x - (s0.x - v.x))).toBeLessThan(MM);
    expect(Math.abs(s1.z - (s0.z - v.z))).toBeLessThan(MM);
    expect([s1.y, s1.heading, s1.profile, s1.block]).toEqual([s0.y, s0.heading, s0.profile, s0.block]);
    before.connectors[0]!.points.forEach((p, i) => {
      const q = after.connectors[0]!.points[i]!;
      expect(Math.abs(q.x - (p.x - v.x))).toBeLessThan(MM);
      expect(Math.abs(q.z - (p.z - v.z))).toBeLessThan(MM);
    });
    // the pivot and every block offset move by the same vector, so the placement method still holds
    expect(after.pivotWorld.x).toBeCloseTo(before.pivotWorld.x - v.x, 9);
    expect(after.pivotWorld.z).toBeCloseTo(before.pivotWorld.z - v.z, 9);
    before.blocks.forEach((b, i) => {
      expect(Math.abs(after.blocks[i]!.offset.x - (b.offset.x - v.x))).toBeLessThan(MM);
      expect(Math.abs(after.blocks[i]!.offset.z - (b.offset.z - v.z))).toBeLessThan(MM);
    });
    // distances and bearings between any two records are untouched
    const d0 = Math.hypot(before.pins[5]!.x - before.pins[30]!.x, before.pins[5]!.z - before.pins[30]!.z);
    const d1 = Math.hypot(after.pins[5]!.x - after.pins[30]!.x, after.pins[5]!.z - after.pins[30]!.z);
    expect(Math.abs(d1 - d0)).toBeLessThan(MM);
  });

  it('tiles after the step: origin minus the vector within 1 mm, index shifted by whole tiles, content untouched', () => {
    const dx = v.x / TILE_M;
    const dz = v.z / TILE_M;
    expect(Number.isInteger(dx) && Number.isInteger(dz)).toBe(true);
    before.tiles.forEach((t, i) => {
      const u = after.tiles[i]!;
      expect(Math.abs(u.origin[0] - (t.origin[0] - v.x))).toBeLessThan(MM);
      expect(Math.abs(u.origin[2] - (t.origin[2] - v.z))).toBeLessThan(MM);
      expect(u.origin[1]).toBe(t.origin[1]);
      expect([u.tx, u.tz]).toEqual([t.tx - dx, t.tz - dz]);
      // the moved tile is still a tile of the one world grid
      expect([u.origin[0], u.origin[2]]).toEqual([tileOrigin(u.tx, u.tz).x, tileOrigin(u.tx, u.tz).z]);
      expect(u.block).toBe(t.block);
    });
    expect(after.overrides).toEqual(before.overrides.map((id) => {
      const [x, z] = id.split('_').map(Number) as [number, number];
      return tileId(x - dx, z - dz);
    }));
  });

  it('pins read back from the moved tile bytes equal the pins before minus the vector, within 1 mm', () => {
    // the tile files as the game loads them: same vertices, new index and origin in the header
    const movedBytes = tiles.map((t, i) => {
      const ref = after.tiles[i]!;
      return encodeT1({ ...t, tx: ref.tx, tz: ref.tz, origin: ref.origin });
    });
    const was = pinCentres(tiles.map((t) => encodeT1(t)));
    const now = pinCentres(movedBytes);
    expect(now.size).toBe(pins.length);
    for (const p of pins) {
      const a = was.get(pinName(p.id, 0))!;
      const b = now.get(pinName(p.id, 0))!;
      expect(Math.abs(b.x - (a.x - v.x)), p.id).toBeLessThan(MM);
      expect(Math.abs(b.z - (a.z - v.z)), p.id).toBeLessThan(MM);
      expect(Math.abs(b.y - a.y)).toBeLessThan(MM);
      // and against the record itself
      expect(Math.abs(b.x - (p.x - v.x)), p.id).toBeLessThan(MM);
      expect(Math.abs(b.z - (p.z - v.z)), p.id).toBeLessThan(MM);
    }
    // no tile was cut again: every vertex array is byte for byte the same
    tiles.forEach((t, i) => {
      const a = decodeT1(encodeT1(t));
      const b = decodeT1(movedBytes[i]!);
      expect(b.header.meshes.length).toBe(a.header.meshes.length);
      a.header.meshes.forEach((m, k) => {
        const n = b.header.meshes[k]!;
        expect(Array.from(b.f32(n.pos, n.vertices * 3))).toEqual(Array.from(a.f32(m.pos, m.vertices * 3)));
      });
      expect([b.header.tile.x, b.header.tile.z]).toEqual([after.tiles[i]!.tx, after.tiles[i]!.tz]);
    });
    // a bake from scratch at the new origin cuts the same tiles: each moved pin is in the tile the grid names
    const fresh = bakeTiles(after.pins);
    expect(fresh.map((t) => tileId(t.tx, t.tz)).sort()).toEqual(after.tiles.map((t) => tileId(t.tx, t.tz)).sort());
    for (const p of after.pins) expect(after.tiles.some((t) => t.tx === tileOf(p.x, p.z).tx && t.tz === tileOf(p.x, p.z).tz)).toBe(true);
  });

  it('refuses a vector that is not a whole number of tiles: tiles would have to be cut again', () => {
    expect(() => recentre(before, { x: -934.6, z: 2271.1 })).toThrow(/not a whole number of 250 m tiles/);
    expect(() => recentre(before, { x: -1000, z: 2300 })).toThrow(/not a whole number/);
    expect(onGrid({ x: -1000, z: 2250 })).toBe(true);
    expect(onGrid({ x: 0, z: 0 })).toBe(true);
    // the zero vector changes nothing
    expect(recentre(before, { x: 0, z: 0 })).toEqual(before);
  });

  it('moves old records exactly once: the vector comes from the two pivot stamps', () => {
    const pivotNow = { x: before.pivotWorld.x - v.x, z: before.pivotWorld.z - v.z };
    expect(originShift(before.pivotWorld, pivotNow).x).toBeCloseTo(v.x, 9);
    const moved = recentreTo(before, pivotNow);
    expect(moved.pivotWorld).toEqual(pivotNow);
    moved.pins.forEach((p, i) => {
      expect(Math.abs(p.x - after.pins[i]!.x)).toBeLessThan(MM);
      expect(Math.abs(p.z - after.pins[i]!.z)).toBeLessThan(MM);
    });
    expect(moved.tiles.map((t) => [t.tx, t.tz])).toEqual(after.tiles.map((t) => [t.tx, t.tz]));
    // a save that already carries the current stamp is not moved again
    const twice = recentreTo(moved, pivotNow);
    expect(twice).toBe(moved);
    // back again: plus the vector
    const back = recentre(after, { x: -v.x, z: -v.z });
    back.pins.forEach((p, i) => {
      expect(Math.abs(p.x - before.pins[i]!.x)).toBeLessThan(MM);
      expect(Math.abs(p.z - before.pins[i]!.z)).toBeLessThan(MM);
    });
    expect(back.tiles.map((t) => tileId(t.tx, t.tz))).toEqual(before.tiles.map((t) => tileId(t.tx, t.tz)));
    // stamps that are not a whole number of tiles apart are refused
    expect(() => recentreTo(before, { x: 0, z: 0 })).toThrow(/not a whole number/);
  });

  it('keeps India Gate north-east of Qutub Minar and west of Laxmi Nagar: nothing flips', () => {
    const at = (r: WorldRecords, id: string) => r.pins.find((p) => p.id === id)!;
    for (const r of [before, after]) {
      expect(at(r, 'india_gate').z).toBeLessThan(at(r, 'qutb_minar').z);
      expect(at(r, 'india_gate').x).toBeGreaterThan(at(r, 'qutb_minar').x);
      expect(at(r, 'india_gate').x).toBeLessThan(at(r, 'laxmi_nagar_metro').x);
      expect(at(r, 'red_fort').z).toBeLessThan(at(r, 'india_gate').z);
    }
    expect(tileIdAt(at(after, 'india_gate').x, at(after, 'india_gate').z)).not.toBe(tileIdAt(at(before, 'india_gate').x, at(before, 'india_gate').z));
  });
});
