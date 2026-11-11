// Checks on the stitched world (ARCH_OPTIONS X1, LP2; MAP_REPAIR.md "District frames and stitching"): clip
// polygons after placement, and landmark positions read back from the baked tile bytes. Pure.
import type { LatLon } from '../../geo/projection.ts';
import type { P2 } from '../geom.ts';
import { decodeT1 } from '../tile.ts';
import { ringGap, ringOverlapArea } from './clip.ts';
import { layoutPair, placer } from './frames.ts';
import type { DistrictDef, LayoutPair } from './frames.ts';

export interface PairCheck {
  pairs: { a: string; b: string; overlapM2: number; gapM: number }[];
  /** Pairs of clip polygons that share area after placement. */
  overlapping: number;
  overlapAreaM2: number;
  minGapM: number;
  minGapBetween: [string, string] | null;
}

/** Every pair of placed clip rings (world metres): shared area and the smallest distance between them. */
export function pairCheck(rings: readonly { id: string; ring: readonly P2[] }[]): PairCheck {
  const out: PairCheck = { pairs: [], overlapping: 0, overlapAreaM2: 0, minGapM: Infinity, minGapBetween: null };
  for (let i = 0; i < rings.length; i++) {
    for (let j = i + 1; j < rings.length; j++) {
      const a = rings[i] as { id: string; ring: readonly P2[] };
      const b = rings[j] as { id: string; ring: readonly P2[] };
      const overlapM2 = Math.round(ringOverlapArea(a.ring, b.ring) * 10) / 10;
      const gapM = Math.round(ringGap(a.ring, b.ring) * 10) / 10;
      out.pairs.push({ a: a.id, b: b.id, overlapM2, gapM });
      if (overlapM2 > 0.5) {
        out.overlapping++;
        out.overlapAreaM2 += overlapM2;
      }
      if (gapM < out.minGapM) {
        out.minGapM = gapM;
        out.minGapBetween = [a.id, b.id];
      }
    }
  }
  if (rings.length < 2) out.minGapM = 0;
  return out;
}

/** The name of a pin mesh: one small marker per reference point of a landmark. */
export const pinName = (landmark: string, k: number): string => `pin__${landmark}__${k}`;

/**
 * Pin positions read back from baked T1 tiles: the mean of a pin mesh's vertices plus the tile origin, in world
 * metres. This is what the game will load (32-bit floats relative to the tile), not what the bake meant to write.
 */
export function pinCentres(tiles: readonly Uint8Array[]): Map<string, { x: number; y: number; z: number }> {
  const out = new Map<string, { x: number; y: number; z: number }>();
  for (const bytes of tiles) {
    const t = decodeT1(bytes);
    for (const m of t.header.meshes) {
      if (!m.name.startsWith('pin__')) continue;
      const pos = t.f32(m.pos, m.vertices * 3);
      let x = 0;
      let y = 0;
      let z = 0;
      for (let i = 0; i < m.vertices; i++) {
        x += pos[i * 3] as number;
        y += pos[i * 3 + 1] as number;
        z += pos[i * 3 + 2] as number;
      }
      out.set(m.name, { x: x / m.vertices + t.header.origin[0], y: y / m.vertices + t.header.origin[1], z: z / m.vertices + t.header.origin[2] });
    }
  }
  return out;
}

export interface LandmarkRef {
  id: string;
  name: string;
  district: string;
  /** The OSM object the points come from. */
  osm: string;
  /** Reference points in degrees, straight from the source (never from the projected map model). */
  points: LatLon[];
}

export interface LandmarkError {
  id: string;
  name: string;
  district: string;
  osm: string;
  points: number;
  /** Pins of this landmark that were not found in the tiles. */
  missing: number;
  maxM: number;
  meanM: number;
  /** Mean position: where it should be (district offset plus projection) and where the tiles have it. */
  expected: P2;
  baked: P2;
}

/** Expected position (district offset plus the projection around the district's own origin) against the baked pins. */
export function landmarkErrors(refs: readonly LandmarkRef[], districts: readonly DistrictDef[], baked: ReadonlyMap<string, { x: number; z: number }>): LandmarkError[] {
  return refs.map((ref) => {
    const def = districts.find((d) => d.id === ref.district);
    if (!def) throw new Error(`landmark ${ref.id}: no district ${ref.district}`);
    const p = placer(def);
    let max = 0;
    let sum = 0;
    let missing = 0;
    let n = 0;
    const e = { x: 0, z: 0 };
    const b = { x: 0, z: 0 };
    ref.points.forEach((geo, k) => {
      const want = p.toWorld(geo.lat, geo.lon);
      const got = baked.get(pinName(ref.id, k));
      if (!got) {
        missing++;
        return;
      }
      const d = Math.hypot(got.x - want.x, got.z - want.z);
      max = Math.max(max, d);
      sum += d;
      n++;
      e.x += want.x;
      e.z += want.z;
      b.x += got.x;
      b.z += got.z;
    });
    const k = Math.max(1, n);
    return { id: ref.id, name: ref.name, district: ref.district, osm: ref.osm, points: ref.points.length, missing, maxM: max, meanM: sum / k, expected: { x: e.x / k, z: e.z / k }, baked: { x: b.x / k, z: b.z / k } };
  });
}

const meanGeo = (pts: readonly LatLon[]): LatLon => ({ lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length });

/**
 * Relative layout inside a district against reality: for two landmarks of one district, the baked distance and
 * bearing between their centres against the geodesic ones on the ellipsoid (which share no code with the projection).
 */
export function layoutChecks(pairs: readonly [string, string][], refs: readonly LandmarkRef[], errors: readonly LandmarkError[]): LayoutPair[] {
  return pairs.map(([ia, ib]) => {
    const ra = refs.find((r) => r.id === ia);
    const rb = refs.find((r) => r.id === ib);
    const ea = errors.find((r) => r.id === ia);
    const eb = errors.find((r) => r.id === ib);
    if (!ra || !rb || !ea || !eb) throw new Error(`layout pair ${ia}, ${ib}: unknown landmark`);
    if (ra.district !== rb.district) throw new Error(`layout pair ${ia}, ${ib}: the two landmarks are in different districts`);
    return layoutPair({ name: ra.name, geo: meanGeo(ra.points), world: ea.baked }, { name: rb.name, geo: meanGeo(rb.points), world: eb.baked });
  });
}
