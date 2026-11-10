import { describe, expect, it } from 'vitest';
import raw from '../../harness/data/fixtures/projection_points.json?raw';
import { geoToWorld, ORIGIN } from './projection';

// harness/data/fixtures/projection_points.json is the cross-check for the GDScript port (game/geo/projection.gd).
// It must stay in step with this TypeScript reference: regenerate with `node tools/fixtures/gen_projection_points.mjs`.
interface Fixture {
  origin: { lat: number; lon: number };
  points: { name: string; lat: number; lon: number; x: number; z: number }[];
}
const fixture = JSON.parse(raw) as Fixture;

describe('projection fixture for the GDScript port', () => {
  it('has 20 points around the same origin', () => {
    expect(fixture.points).toHaveLength(20);
    expect(fixture.origin).toEqual({ lat: ORIGIN.lat, lon: ORIGIN.lon });
  });
  it('matches the TypeScript projection within 1e-5 m', () => {
    for (const p of fixture.points) {
      const w = geoToWorld(p.lat, p.lon);
      expect(Math.abs(w.x - p.x), p.name).toBeLessThan(1e-5);
      expect(Math.abs(w.z - p.z), p.name).toBeLessThan(1e-5);
    }
  });
});
