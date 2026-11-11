// Geographic projection: latitude and longitude (WGS84 degrees) to world metres and back, around one named origin.
// The only projection of the offline tooling: every function takes the origin as an argument (default: India Gate),
// so district frames (ARCH_OPTIONS X1) use this same code with their own origin.
// World axes (the one coordinate system of this game, TECH.md "Coordinates"): east +X, north -Z, up +Y, 1 unit = 1 metre.
// No mirroring and no axis flips: a point north of the origin has a negative z, a point east has a positive x.
//
// Method: transverse Mercator on the WGS84 ellipsoid (Krüger series, 3rd order), central meridian through the origin,
// scale factor 1 on that meridian, then the origin's northing is subtracted so the origin maps to (0, 0). The scale grows
// as 1 + (x / R)^2 / 2 away from the central meridian: 0.2 m at 25 km east or west, far under the 0.5 m budget.
// Provisional until the architecture sign-off (decisions.md 2026-11-10).

export interface LatLon {
  lat: number; // degrees north
  lon: number; // degrees east
}

export interface WorldXZ {
  x: number; // metres east of the origin
  z: number; // metres SOUTH of the origin (north is -Z)
}

/** India Gate, the world origin. */
export const ORIGIN: Readonly<LatLon> = Object.freeze({ lat: 28.612894, lon: 77.229446 });

const A = 6378137; // WGS84 semi-major axis, m
const F = 1 / 298.257223563; // WGS84 flattening
const N = F / (2 - F); // third flattening
const N2 = N * N;
const N3 = N2 * N;
const RECT = (A / (1 + N)) * (1 + N2 / 4 + (N2 * N2) / 64); // rectifying radius
const ALPHA = [N / 2 - (2 * N2) / 3 + (5 * N3) / 16, (13 * N2) / 48 - (3 * N3) / 5, (61 * N3) / 240] as const;
const BETA = [N / 2 - (2 * N2) / 3 + (37 * N3) / 96, N2 / 48 + N3 / 15, (17 * N3) / 480] as const;
const DELTA = [2 * N - (2 * N2) / 3 - 2 * N3, (7 * N2) / 3 - (8 * N3) / 5, (56 * N3) / 15] as const;
const RAD = Math.PI / 180;
const K = (2 * Math.sqrt(N)) / (1 + N);

/** Transverse Mercator easting and northing (metres) from the central meridian lon0, northing 0 at the equator. */
function tmForward(lat: number, lon: number, lon0: number): { e: number; n: number } {
  const phi = lat * RAD;
  const dl = (lon - lon0) * RAD;
  const sp = Math.sin(phi);
  const tau = Math.sinh(Math.atanh(sp) - K * Math.atanh(K * sp));
  const xi0 = Math.atan2(tau, Math.cos(dl));
  const eta0 = Math.atanh(Math.sin(dl) / Math.sqrt(1 + tau * tau));
  let xi = xi0;
  let eta = eta0;
  for (let j = 1; j <= 3; j++) {
    const a = ALPHA[j - 1] as number;
    xi += a * Math.sin(2 * j * xi0) * Math.cosh(2 * j * eta0);
    eta += a * Math.cos(2 * j * xi0) * Math.sinh(2 * j * eta0);
  }
  return { e: RECT * eta, n: RECT * xi };
}

function tmInverse(e: number, n: number, lon0: number): LatLon {
  const xi = n / RECT;
  const eta = e / RECT;
  let xi0 = xi;
  let eta0 = eta;
  for (let j = 1; j <= 3; j++) {
    const b = BETA[j - 1] as number;
    xi0 -= b * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    eta0 -= b * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xi0) / Math.cosh(eta0));
  let phi = chi;
  for (let j = 1; j <= 3; j++) phi += (DELTA[j - 1] as number) * Math.sin(2 * j * chi);
  const dl = Math.atan2(Math.sinh(eta0), Math.cos(xi0));
  return { lat: phi / RAD, lon: lon0 + dl / RAD };
}

const NORTHING_AT_ORIGIN = tmForward(ORIGIN.lat, ORIGIN.lon, ORIGIN.lon).n;

/** Northing of an origin on its own central meridian (cached for the world origin). */
function northingAt(origin: Readonly<LatLon>): number {
  return origin === ORIGIN ? NORTHING_AT_ORIGIN : tmForward(origin.lat, origin.lon, origin.lon).n;
}

/**
 * Latitude and longitude to metres around `origin` (default: the world origin, India Gate). East is +x, north is -z.
 * A district frame (ARCH_OPTIONS X1) passes its own origin: the central meridian runs through it.
 */
export function geoToWorld(lat: number, lon: number, origin: Readonly<LatLon> = ORIGIN): WorldXZ {
  const { e, n } = tmForward(lat, lon, origin.lon);
  // `0 -` keeps a due-north z of exactly 0 as +0 and a point due north has x exactly 0.
  return { x: e, z: -(n - northingAt(origin)) };
}

/** Metres around `origin` back to latitude and longitude. */
export function worldToGeo(x: number, z: number, origin: Readonly<LatLon> = ORIGIN): LatLon {
  return tmInverse(x, northingAt(origin) - z, origin.lon);
}

/** A projection bound to one origin, for code that converts many points of one district. */
export interface Projector {
  readonly origin: Readonly<LatLon>;
  toWorld(lat: number, lon: number): WorldXZ;
  toGeo(x: number, z: number): LatLon;
}

export function projector(origin: Readonly<LatLon> = ORIGIN): Projector {
  const n0 = northingAt(origin);
  return {
    origin,
    toWorld: (lat, lon) => {
      const { e, n } = tmForward(lat, lon, origin.lon);
      return { x: e, z: -(n - n0) };
    },
    toGeo: (x, z) => tmInverse(x, n0 - z, origin.lon),
  };
}
