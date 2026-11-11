// The yardstick of the layout gates (moved here from the stitch bench in P1-008): geodesic distance and bearing on
// the WGS84 ellipsoid by Vincenty's inverse formula. It shares no code with the projection (tools/geo/projection.ts),
// so "the game keeps the real bearing and distance" is checked against something independent. Pure.
import type { LatLon } from '../../geo/projection.ts';
import type { P2 } from '../geom.ts';

const WGS_A = 6378137;
const WGS_F = 1 / 298.257223563;
const WGS_B = WGS_A * (1 - WGS_F);

/** Geodesic distance in metres and the initial bearing in degrees clockwise from north, from a to b. */
export function geodesic(a: LatLon, b: LatLon): { distanceM: number; bearingDeg: number } {
  const rad = Math.PI / 180;
  const u1 = Math.atan((1 - WGS_F) * Math.tan(a.lat * rad));
  const u2 = Math.atan((1 - WGS_F) * Math.tan(b.lat * rad));
  const l = (b.lon - a.lon) * rad;
  const su1 = Math.sin(u1);
  const cu1 = Math.cos(u1);
  const su2 = Math.sin(u2);
  const cu2 = Math.cos(u2);
  let lam = l;
  let sinSig = 0;
  let cosSig = 1;
  let sig = 0;
  let cos2Alpha = 1;
  let cos2SigM = 0;
  for (let i = 0; i < 100; i++) {
    const sl = Math.sin(lam);
    const cl = Math.cos(lam);
    sinSig = Math.hypot(cu2 * sl, cu1 * su2 - su1 * cu2 * cl);
    if (sinSig === 0) return { distanceM: 0, bearingDeg: 0 };
    cosSig = su1 * su2 + cu1 * cu2 * cl;
    sig = Math.atan2(sinSig, cosSig);
    const sinAlpha = (cu1 * cu2 * sl) / sinSig;
    cos2Alpha = 1 - sinAlpha * sinAlpha;
    cos2SigM = cos2Alpha === 0 ? 0 : cosSig - (2 * su1 * su2) / cos2Alpha;
    const c = (WGS_F / 16) * cos2Alpha * (4 + WGS_F * (4 - 3 * cos2Alpha));
    const next = l + (1 - c) * WGS_F * sinAlpha * (sig + c * sinSig * (cos2SigM + c * cosSig * (-1 + 2 * cos2SigM * cos2SigM)));
    const done = Math.abs(next - lam) < 1e-13;
    lam = next;
    if (done) break;
  }
  const uSq = (cos2Alpha * (WGS_A * WGS_A - WGS_B * WGS_B)) / (WGS_B * WGS_B);
  const bigA = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const bigB = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const dSig = bigB * sinSig * (cos2SigM + (bigB / 4) * (cosSig * (-1 + 2 * cos2SigM * cos2SigM) - (bigB / 6) * cos2SigM * (-3 + 4 * sinSig * sinSig) * (-3 + 4 * cos2SigM * cos2SigM)));
  const bearing = Math.atan2(cu2 * Math.sin(lam), cu1 * su2 - su1 * cu2 * Math.cos(lam));
  return { distanceM: WGS_B * bigA * (sig - dSig), bearingDeg: ((bearing * 180) / Math.PI + 360) % 360 };
}

/** Compass bearing of a world vector in degrees clockwise from north: north is -Z, east is +X. */
export const worldBearingDeg = (dx: number, dz: number): number => ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;

/** The smallest angle between two bearings, 0 to 180 degrees. */
export function bearingDiffDeg(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return Math.abs(d);
}

export interface LayoutPair {
  a: string;
  b: string;
  realM: number;
  bakedM: number;
  errorM: number;
  /** errorM as a share of the real distance, in percent. */
  errorPct: number;
  realBearingDeg: number;
  bakedBearingDeg: number;
  bearingErrorDeg: number;
}

export interface PlacedPoint {
  name: string;
  geo: LatLon;
  world: P2;
}

/** A pair of placed points: the game's distance and bearing against the geodesic ones. */
export function layoutPair(a: PlacedPoint, b: PlacedPoint): LayoutPair {
  const real = geodesic(a.geo, b.geo);
  const dx = b.world.x - a.world.x;
  const dz = b.world.z - a.world.z;
  const bakedM = Math.hypot(dx, dz);
  const bakedBearing = worldBearingDeg(dx, dz);
  const errorM = Math.abs(bakedM - real.distanceM);
  return {
    a: a.name, b: b.name, realM: real.distanceM, bakedM, errorM, errorPct: real.distanceM > 0 ? (errorM / real.distanceM) * 100 : 0,
    realBearingDeg: real.bearingDeg, bakedBearingDeg: bakedBearing, bearingErrorDeg: bearingDiffDeg(bakedBearing, real.bearingDeg),
  };
}
