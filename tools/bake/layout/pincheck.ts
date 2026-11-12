// Landmark positions read back from the baked tile bytes (LP2; MAP_REPAIR.md "District frames and stitching",
// "Landmark tests": the position in the block frame, and the relative layout against reality). Moved in P1-008 from the
// Phase 0 stitch bench (tools/bake/stitch/checks.ts): a landmark now names its block, not an island district. Pure.
import type { LatLon } from '../../geo/projection.ts';
import type { P2 } from '../geom.ts';
import { decodeT1 } from '../tile/codec.ts';
import { layoutPair } from './geodesic.ts';
import type { LayoutPair } from './geodesic.ts';
import { placer } from './placement.ts';
import type { Frame } from './placement.ts';

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
  /** The block the landmark stands in. */
  block: string;
  /** The OSM object the points come from. */
  osm: string;
  /** Reference points in degrees, straight from the source (never from the projected map model). */
  points: LatLon[];
}

export interface LandmarkError {
  id: string;
  name: string;
  block: string;
  osm: string;
  points: number;
  /** Pins of this landmark that were not found in the tiles. */
  missing: number;
  maxM: number;
  meanM: number;
  /** Mean position: where it should be (block offset plus projection) and where the tiles have it. */
  expected: P2;
  baked: P2;
}

/** Expected position (block offset plus the projection around the block's own origin) against the baked pins. */
export function landmarkErrors(refs: readonly LandmarkRef[], frames: readonly Frame[], baked: ReadonlyMap<string, { x: number; z: number }>): LandmarkError[] {
  return refs.map((ref) => {
    const frame = frames.find((f) => f.id === ref.block);
    if (!frame) throw new Error(`landmark ${ref.id}: no block ${ref.block}`);
    const p = placer(frame);
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
    return { id: ref.id, name: ref.name, block: ref.block, osm: ref.osm, points: ref.points.length, missing, maxM: max, meanM: sum / k, expected: { x: e.x / k, z: e.z / k }, baked: { x: b.x / k, z: b.z / k } };
  });
}

const meanGeo = (pts: readonly LatLon[]): LatLon => ({ lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length });

/**
 * Relative layout inside a block against reality: for two landmarks of one block, the baked distance and bearing
 * between their centres against the geodesic ones on the ellipsoid (which share no code with the projection).
 */
export function layoutChecks(pairs: readonly [string, string][], refs: readonly LandmarkRef[], errors: readonly LandmarkError[]): LayoutPair[] {
  return pairs.map(([ia, ib]) => {
    const ra = refs.find((r) => r.id === ia);
    const rb = refs.find((r) => r.id === ib);
    const ea = errors.find((r) => r.id === ia);
    const eb = errors.find((r) => r.id === ib);
    if (!ra || !rb || !ea || !eb) throw new Error(`layout pair ${ia}, ${ib}: unknown landmark`);
    if (ra.block !== rb.block) throw new Error(`layout pair ${ia}, ${ib}: the two landmarks are in different blocks`);
    return layoutPair({ name: ra.name, geo: meanGeo(ra.points), world: ea.baked }, { name: rb.name, geo: meanGeo(rb.points), world: eb.baked });
  });
}
