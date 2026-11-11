// District frames of the composite map (ARCH_OPTIONS X1 against X2, FP1; MAP_REPAIR.md "District frames and
// stitching"). A district is projected around its own frame origin and then moved by one placement offset:
//
//   world = offset + project(lat, lon, district origin)          (translation only)
//
// There is no rotation, scale or mirror anywhere: the checks at the end of this file prove it on the numbers.
// World axes: east +X, north -Z, up +Y, metres. The world origin is the centre of the layout's map box.
// Pure: the driver (harness/bench/stitch.mjs) reads harness/data/districts.json and passes it in.
import { projector } from '../../geo/projection.ts';
import type { LatLon, Projector } from '../../geo/projection.ts';
import type { P2 } from '../geom.ts';

export interface LayoutDef {
  id: string;
  /** The map box of the layout sketch in km (x east, y north). */
  boxKm: { x0: number; x1: number; y0: number; y1: number };
  /** The river of the sketch: a band that bends gently, from north (y1) to south (y2), in km. */
  river?: { x: number; width: number; y1: number; y2: number; bend: number };
}

export interface DistrictDef {
  id: string;
  name: string;
  stage: 'pilot' | 'release' | 'later';
  group?: string;
  /** The district of the layout sketch this entry stands for, its box (south west corner, width, height in km) and the real point that sits on the box centre. */
  layoutId: string;
  layoutBoxKm: [number, number, number, number];
  layoutAnchor: LatLon;
  /** Frame origin: the projection's own origin for this district (X1). */
  origin: LatLon;
  /** World position of the frame origin, metres. */
  offset: { x: number; z: number };
  /** Added to every ground height of the district, metres. */
  heightOffset: number;
  /** Clip polygon file (GeoJSON, WGS84), relative to harness/data/. */
  clip: string;
  /** DC1: the draft rectangle, centred on a real point. */
  draftRect: { centre: LatLon; widthM: number; heightM: number };
  /** The pilot download this district is cut from (harness/bench/pilot_areas.json id). */
  area: string;
  note?: string;
}

export interface DistrictsFile {
  status: string;
  layout: LayoutDef;
  x2Origin: LatLon;
  districts: DistrictDef[];
}

/** Centre of the layout's map box in km: the world origin. */
export const layoutCentreKm = (l: LayoutDef): { x: number; y: number } => ({ x: (l.boxKm.x0 + l.boxKm.x1) / 2, y: (l.boxKm.y0 + l.boxKm.y1) / 2 });

/** Layout km (x east, y north) to world metres (east +X, north -Z), origin at the centre of the map box. */
export function layoutToWorld(l: LayoutDef, xKm: number, yKm: number): P2 {
  const c = layoutCentreKm(l);
  return { x: (xKm - c.x) * 1000, z: -(yKm - c.y) * 1000 };
}

/** The centre line of the layout's river in world metres, north to south (the same curve as the sketch draws). */
export function riverLine(l: LayoutDef, steps = 48): P2[] {
  const r = l.river;
  if (!r) return [];
  const out: P2[] = [];
  for (let i = 0; i <= steps; i++) {
    const y = r.y1 + ((r.y2 - r.y1) * i) / steps;
    out.push(layoutToWorld(l, r.x + r.bend * Math.sin((i / steps) * Math.PI * 2), y));
  }
  return out;
}

/**
 * The placement offset that puts the district's layout anchor on the centre of its layout box.
 * (The offset is the world position of the frame origin, so the anchor's own position in the frame is taken off.)
 */
export function draftOffset(l: LayoutDef, boxKm: readonly [number, number, number, number], anchor: LatLon, origin: LatLon): { x: number; z: number } {
  const centre = layoutToWorld(l, boxKm[0] + boxKm[2] / 2, boxKm[1] + boxKm[3] / 2);
  const a = projector(origin).toWorld(anchor.lat, anchor.lon);
  return { x: centre.x - a.x, z: centre.z - a.z };
}

export interface Placer {
  readonly def: DistrictDef;
  readonly proj: Projector;
  /** WGS84 degrees to world metres. */
  toWorld(lat: number, lon: number): P2;
  /** District metres to world metres. */
  place(p: P2): P2;
  /** World metres to district metres. */
  local(p: P2): P2;
  toGeo(world: P2): LatLon;
}

/** X1: the district's own origin, then the offset. */
export function placer(def: DistrictDef): Placer {
  const proj = projector(def.origin);
  const { x: ox, z: oz } = def.offset;
  return {
    def, proj,
    toWorld: (lat, lon) => {
      const p = proj.toWorld(lat, lon);
      return { x: p.x + ox, z: p.z + oz };
    },
    place: (p) => ({ x: p.x + ox, z: p.z + oz }),
    local: (p) => ({ x: p.x - ox, z: p.z - oz }),
    toGeo: (w) => proj.toGeo(w.x - ox, w.z - oz),
  };
}

/**
 * X2: one origin for the whole city, then a translation that puts the district's frame origin on the same world
 * point as X1 does. Everything else about the two options is equal, so the difference is the projection alone.
 */
export function placerX2(def: DistrictDef, cityOrigin: LatLon): (lat: number, lon: number) => P2 {
  const proj = projector(cityOrigin);
  const o = proj.toWorld(def.origin.lat, def.origin.lon);
  return (lat, lon) => {
    const p = proj.toWorld(lat, lon);
    return { x: p.x - o.x + def.offset.x, z: p.z - o.z + def.offset.z };
  };
}

export interface FrameDiff {
  district: string;
  /** Metres from the X2 origin to the district's frame origin. */
  originDistanceM: number;
  points: { name: string; dM: number; dxM: number; dzM: number }[];
  maxM: number;
  maxAt: string;
  /** Meridian convergence of X2 at the district's frame origin, degrees (north is off -Z by this much). */
  convergenceDeg: number;
  /** Scale of X2 at the frame origin minus 1, in millimetres per kilometre. */
  scaleMmPerKm: number;
}

/** X1 against X2 at named points (corners, landmarks) of one district. */
export function frameDifference(def: DistrictDef, points: readonly { name: string; lat: number; lon: number }[], cityOrigin: LatLon): FrameDiff {
  const p1 = placer(def);
  const p2 = placerX2(def, cityOrigin);
  const city = projector(cityOrigin);
  const o = city.toWorld(def.origin.lat, def.origin.lon);
  const rows = points.map((p) => {
    const a = p1.toWorld(p.lat, p.lon);
    const b = p2(p.lat, p.lon);
    return { name: p.name, dM: Math.hypot(a.x - b.x, a.z - b.z), dxM: b.x - a.x, dzM: b.z - a.z };
  });
  const worst = rows.reduce((m, r) => (r.dM > m.dM ? r : m), { name: '', dM: 0, dxM: 0, dzM: 0 });
  // north and east steps of 100 m at the frame origin, seen in the X2 frame
  const d = 100 / 110_600;
  const n0 = city.toWorld(def.origin.lat, def.origin.lon);
  const n1 = city.toWorld(def.origin.lat + d, def.origin.lon);
  const own = projector(def.origin).toWorld(def.origin.lat + d, def.origin.lon);
  const len2 = Math.hypot(n1.x - n0.x, n1.z - n0.z);
  const len1 = Math.hypot(own.x, own.z);
  return {
    district: def.id, originDistanceM: Math.hypot(o.x, o.z), points: rows, maxM: worst.dM, maxAt: worst.name,
    convergenceDeg: (Math.atan2(n1.x - n0.x, -(n1.z - n0.z)) * 180) / Math.PI,
    scaleMmPerKm: (len2 / len1 - 1) * 1e6,
  };
}

const FORBIDDEN = /^(rot|rotation|rotate|yaw|angle|heading|scale|mirror|flip|basis|matrix|transform|skew)/i;

/** Keys in the districts file that could carry a rotation, a scale or a mirror: there must be none. */
export function forbiddenTransformKeys(value: unknown, path = ''): string[] {
  if (value === null || typeof value !== 'object') return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const here = path ? `${path}.${k}` : k;
    if (FORBIDDEN.test(k)) out.push(here);
    out.push(...forbiddenTransformKeys(v, here));
  }
  return out;
}

export interface TransformCheck {
  district: string;
  /** Largest difference of the district-to-world Jacobian from the identity (0 for a pure translation). */
  jacobianError: number;
  /** Angle between true north at the frame origin and -Z in the world, degrees. */
  northOffDeg: number;
  /** East is +X and north is -Z: the sign of the determinant is +1 (a mirror would give -1). */
  handed: 1 | -1;
  ok: boolean;
}

/** Proves on numbers that a placement is a translation and that north is -Z. */
export function transformCheck(p: Placer): TransformCheck {
  const o = p.place({ x: 0, z: 0 });
  const ex = p.place({ x: 1000, z: 0 });
  const ez = p.place({ x: 0, z: 1000 });
  const j = [(ex.x - o.x) / 1000, (ez.x - o.x) / 1000, (ex.z - o.z) / 1000, (ez.z - o.z) / 1000];
  const jacobianError = Math.max(Math.abs((j[0] as number) - 1), Math.abs(j[1] as number), Math.abs(j[2] as number), Math.abs((j[3] as number) - 1));
  const d = 200 / 110_600;
  const here = p.toWorld(p.def.origin.lat, p.def.origin.lon);
  const north = p.toWorld(p.def.origin.lat + d, p.def.origin.lon);
  const east = p.toWorld(p.def.origin.lat, p.def.origin.lon + d);
  const nx = north.x - here.x;
  const nz = north.z - here.z;
  const northOffDeg = (Math.atan2(nx, -nz) * 180) / Math.PI;
  // east x north in the (x, -z) plane: positive when the map is not mirrored
  const det = (east.x - here.x) * -(north.z - here.z) - -(east.z - here.z) * (north.x - here.x);
  const handed = det > 0 ? 1 : -1;
  return { district: p.def.id, jacobianError, northOffDeg, handed, ok: jacobianError < 1e-9 && Math.abs(northOffDeg) < 1e-6 && handed === 1 && nz < 0 };
}

const WGS_A = 6378137;
const WGS_F = 1 / 298.257223563;
const WGS_B = WGS_A * (1 - WGS_F);

/**
 * Geodesic distance and initial bearing on the WGS84 ellipsoid (Vincenty's inverse formula). It shares no code
 * with the projection, so it is the yardstick for "relative layout inside a district against reality".
 * Bearing in degrees clockwise from north.
 */
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

export interface LayoutPair {
  a: string;
  b: string;
  realM: number;
  bakedM: number;
  errorM: number;
  realBearingDeg: number;
  bakedBearingDeg: number;
  bearingErrorDeg: number;
}

/** A pair of points of one district: the baked distance and bearing against the geodesic ones. */
export function layoutPair(a: { name: string; geo: LatLon; world: P2 }, b: { name: string; geo: LatLon; world: P2 }): LayoutPair {
  const real = geodesic(a.geo, b.geo);
  const dx = b.world.x - a.world.x;
  const dz = b.world.z - a.world.z;
  const bakedM = Math.hypot(dx, dz);
  const bakedBearing = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
  let dB = bakedBearing - real.bearingDeg;
  if (dB > 180) dB -= 360;
  if (dB < -180) dB += 360;
  return { a: a.name, b: b.name, realM: real.distanceM, bakedM, errorM: Math.abs(bakedM - real.distanceM), realBearingDeg: real.bearingDeg, bakedBearingDeg: bakedBearing, bearingErrorDeg: Math.abs(dB) };
}
