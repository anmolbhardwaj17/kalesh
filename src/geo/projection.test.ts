import { describe, expect, it } from 'vitest';
import { geoToWorld, ORIGIN, worldToGeo } from './projection';

const near = (v: number, want: number, tol: number) => expect(Math.abs(v - want)).toBeLessThanOrEqual(tol);

describe('projection: landmarks', () => {
  it('the origin (India Gate) maps to (0, 0)', () => {
    const p = geoToWorld(ORIGIN.lat, ORIGIN.lon);
    expect(Math.abs(p.x)).toBeLessThan(1e-6);
    expect(Math.abs(p.z)).toBeLessThan(1e-6);
  });
  it('Connaught Place central park lands north-west of the origin', () => {
    const p = geoToWorld(28.6315, 77.2167);
    near(p.x, -1246, 25);
    near(p.z, -2071, 25);
    expect(p.x).toBeLessThan(0); // west is -X
    expect(p.z).toBeLessThan(0); // north is -Z
  });
  it('Red Fort lands north-north-east of the origin', () => {
    const p = geoToWorld(28.6562, 77.241);
    near(p.x, 1129, 25);
    near(p.z, -4821, 25);
    expect(p.x).toBeGreaterThan(0); // east is +X
    expect(p.z).toBeLessThan(0);
  });
});

describe('projection: axes', () => {
  it('a point due north has x 0 and negative z', () => {
    const p = geoToWorld(ORIGIN.lat + 0.05, ORIGIN.lon);
    expect(Math.abs(p.x)).toBeLessThan(1e-6);
    expect(p.z).toBeLessThan(0);
  });
  it('a point due south has positive z, due east positive x, due west negative x', () => {
    expect(geoToWorld(ORIGIN.lat - 0.05, ORIGIN.lon).z).toBeGreaterThan(0);
    expect(geoToWorld(ORIGIN.lat, ORIGIN.lon + 0.05).x).toBeGreaterThan(0);
    expect(geoToWorld(ORIGIN.lat, ORIGIN.lon - 0.05).x).toBeLessThan(0);
  });
  it('one degree of latitude is about 110.8 km here and one degree of longitude about 97.7 km', () => {
    near(-geoToWorld(ORIGIN.lat + 1, ORIGIN.lon).z, 110_800, 100);
    near(geoToWorld(ORIGIN.lat, ORIGIN.lon + 1).x, 97_700, 200);
  });
});

describe('projection: accuracy', () => {
  // Independent check: the meridian arc length by numerical integration of the meridian radius of curvature.
  const a = 6378137;
  const e2 = 2 * (1 / 298.257223563) - (1 / 298.257223563) ** 2;
  const arc = (lat0: number, lat1: number) => {
    const steps = 2000;
    let s = 0;
    for (let i = 0; i < steps; i++) {
      const phi = ((lat0 + ((i + 0.5) * (lat1 - lat0)) / steps) * Math.PI) / 180;
      const m = (a * (1 - e2)) / (1 - e2 * Math.sin(phi) ** 2) ** 1.5;
      s += (m * (((lat1 - lat0) / steps) * Math.PI)) / 180;
    }
    return s;
  };
  it('distance along the central meridian matches the ellipsoid within 0.5 m up to 25 km', () => {
    for (const dKm of [1, 10, 25]) {
      const lat1 = ORIGIN.lat + dKm / 110.77;
      const p = geoToWorld(lat1, ORIGIN.lon);
      near(-p.z, arc(ORIGIN.lat, lat1), 0.5);
    }
  });
  it('round trip world to geo to world is under 0.01 m over a 50 km box', () => {
    let worst = 0;
    for (let x = -25000; x <= 25000; x += 5000) {
      for (let z = -25000; z <= 25000; z += 5000) {
        const g = worldToGeo(x, z);
        const p = geoToWorld(g.lat, g.lon);
        worst = Math.max(worst, Math.hypot(p.x - x, p.z - z));
      }
    }
    expect(worst).toBeLessThan(0.01);
  });
  it('round trip geo to world to geo is under 1e-7 degrees (1 cm)', () => {
    for (const [lat, lon] of [[28.6315, 77.2167], [28.6562, 77.241], [28.4, 77.0], [28.85, 77.45]] as const) {
      const g = worldToGeo(geoToWorld(lat, lon).x, geoToWorld(lat, lon).z);
      expect(Math.abs(g.lat - lat)).toBeLessThan(1e-7);
      expect(Math.abs(g.lon - lon)).toBeLessThan(1e-7);
    }
  });
});
