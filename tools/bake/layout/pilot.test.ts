// The pilot centre outline (P1-007, TECH.md "World layout" Stages, DELHI_WORLD.md 0.4): about 20 km2 of the centre
// block holding Connaught Place with Jantar Mantar, India Gate, ITO with Pragati Maidan, Chandni Chowk with Red Fort,
// Paharganj with the New Delhi station, GB Road, the Yamuna bank at ITO and everything between.
import { describe, expect, it } from 'vitest';
import districtsRaw from '../../../harness/data/districts.json?raw';
import clipCc from '../../../harness/data/districts/chandni_chowk.geojson?raw';
import clipCp from '../../../harness/data/districts/cp.geojson?raw';
import clipIg from '../../../harness/data/districts/india_gate.geojson?raw';
import pilotRaw from '../../../harness/data/districts/pilot_centre.geojson?raw';
import placesRaw from '../../../harness/data/districts/places.json?raw';
import { outlineAreaKm2, outlineBox, outlineContains, outlineRing, readOutline, ringProblems } from './outline';
import { glo30Tile, stagePlan } from './stages';
import type { DistrictsWithStages } from './stages';

const pilot = readOutline(pilotRaw, 'pilot');
const districts = JSON.parse(districtsRaw) as DistrictsWithStages & { planned: { id: string; focus: boolean; stage: string; outline?: { status: string; ring: [number, number][] } }[] };

/** The places the pilot must hold: read from the pilot stage's OSM extract, kept in districts/places.json (`pilot`). */
export const PILOT_PLACES = (JSON.parse(placesRaw) as { places: { name: string; lat: number; lon: number; from: string; block: string; pilot?: boolean }[] }).places.filter((p) => p.pilot === true);

describe('pilot centre outline', () => {
  it('is a simple ring of 18 to 23 km2', () => {
    const area = outlineAreaKm2(pilot.coords);
    expect(area).toBeGreaterThanOrEqual(18);
    expect(area).toBeLessThanOrEqual(23);
    expect(ringProblems(outlineRing(pilot.coords, { lat: 28.612894, lon: 77.229446 }))).toEqual([]);
    const first = pilot.coords[0];
    const last = pilot.coords[pilot.coords.length - 1];
    expect(first).toEqual(last);
  });

  it('names at least the eleven places the pilot was drawn round', () => {
    expect(PILOT_PLACES.length).toBeGreaterThanOrEqual(11);
    expect(PILOT_PLACES.every((p) => p.block === 'centre')).toBe(true);
  });

  it.each(PILOT_PLACES)('holds $name', ({ lat, lon }) => {
    expect(outlineContains(pilot.coords, lat, lon)).toBe(true);
  });

  it('holds the three focus districts drawn in Phase 0 (every point of their clip polygons)', () => {
    for (const raw of [clipCp, clipIg, clipCc]) {
      const o = readOutline(raw);
      const outside = o.coords.filter(([lon, lat]) => !outlineContains(pilot.coords, lat, lon));
      expect(outside, o.id).toEqual([]);
    }
  });

  it('holds the draft focus outlines of ito, paharganj_station and gb_road from districts.json', () => {
    for (const id of ['ito', 'paharganj_station', 'gb_road']) {
      const d = districts.planned.find((p) => p.id === id);
      expect(d, id).toBeTruthy();
      expect(d!.focus).toBe(true);
      expect(d!.stage).toBe('pilot');
      expect(d!.outline?.status).toBe('draft');
      const ring = d!.outline!.ring;
      expect(ring.length).toBeGreaterThanOrEqual(5);
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      expect(ringProblems(outlineRing(ring, { lat: 28.612894, lon: 77.229446 })), id).toEqual([]);
      const outside = ring.filter(([lon, lat]) => !outlineContains(pilot.coords, lat, lon));
      expect(outside, id).toEqual([]);
      expect(outlineAreaKm2(ring)).toBeGreaterThan(0.1);
    }
  });

  it('a place far outside is not inside (Karol Bagh, Kashmere Gate, Laxmi Nagar, Khan Market)', () => {
    for (const [lat, lon] of [[28.6519, 77.1909], [28.6675, 77.2283], [28.6304, 77.2777], [28.6003, 77.2270]] as const) {
      expect(outlineContains(pilot.coords, lat, lon)).toBe(false);
    }
  });

  it('defines the stage "pilot" with one box around the outline plus its margin, inside one GLO-30 tile', () => {
    const plan = stagePlan(districts, 'pilot', pilotRaw);
    expect(plan.def.block).toBe('centre');
    expect(plan.box).toEqual(outlineBox(pilot.coords, plan.def.marginM));
    expect(glo30Tile(plan.box)).toBe('N28_E077');
    const boxKm2 = (plan.box.north - plan.box.south) * 110.9 * (plan.box.east - plan.box.west) * 111.32 * Math.cos((28.63 * Math.PI) / 180);
    expect(boxKm2).toBeLessThan(45);
  });
});
