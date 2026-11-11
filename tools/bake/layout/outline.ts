// Stage and focus outlines (P1-007, docs/ARCHITECTURE.md `bake/layout/`): a GeoJSON polygon in WGS84 turned into a
// ring in block metres, its area, point tests, the fetch box with a margin, and the simple-ring check. Pure.
import { projector } from '../../geo/projection.ts';
import type { LatLon } from '../../geo/projection.ts';
import { pointInRing, ringArea, segmentCrossing } from '../geom.ts';
import type { P2 } from '../geom.ts';

/** A box in degrees. */
export interface GeoBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface Outline {
  id: string;
  name: string;
  /** Closed ring as [lon, lat] pairs (GeoJSON order), first point repeated at the end. */
  coords: [number, number][];
  properties: Record<string, unknown>;
}

interface GeoJsonFeature {
  type: string;
  properties?: Record<string, unknown>;
  geometry?: { type: string; coordinates: unknown };
}

/** The first Polygon feature of a GeoJSON FeatureCollection (or a bare Feature). Throws on anything else. */
export function readOutline(text: string, id = ''): Outline {
  const json = JSON.parse(text) as { type: string; features?: GeoJsonFeature[] } & GeoJsonFeature;
  const feature = json.type === 'FeatureCollection' ? json.features?.[0] : json;
  if (!feature || feature.geometry?.type !== 'Polygon') throw new Error(`outline ${id}: need a Polygon feature`);
  const rings = feature.geometry.coordinates as [number, number][][];
  const ring = rings[0];
  if (!ring || ring.length < 4) throw new Error(`outline ${id}: the ring needs at least 3 points and the closing point`);
  const props = feature.properties ?? {};
  return { id: String(props['id'] ?? props['district'] ?? id), name: String(props['name'] ?? id), coords: ring, properties: props };
}

/** The ring in block metres around `origin`, open (the closing point dropped). */
export function outlineRing(coords: readonly (readonly [number, number])[], origin: Readonly<LatLon>): P2[] {
  const proj = projector(origin);
  const pts = coords.map(([lon, lat]) => proj.toWorld(lat, lon));
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first && last && pts.length > 1 && Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.z - last.z) < 1e-6) pts.pop();
  return pts;
}

/** Area of an outline in km2 (projected around its own first point, so it is true area for any block). */
export function outlineAreaKm2(coords: readonly (readonly [number, number])[]): number {
  const c = coords[0];
  if (!c) return 0;
  return Math.abs(ringArea(outlineRing(coords, { lat: c[1], lon: c[0] }))) / 1e6;
}

/** True when a point (lat, lon) is inside the outline. */
export function outlineContains(coords: readonly (readonly [number, number])[], lat: number, lon: number): boolean {
  const c = coords[0];
  if (!c) return false;
  const origin = { lat: c[1], lon: c[0] };
  return pointInRing(projector(origin).toWorld(lat, lon), outlineRing(coords, origin));
}

/** The box of the outline grown by `marginM` metres on every side (degrees, rounded outwards to 1e-5). */
export function outlineBox(coords: readonly (readonly [number, number])[], marginM: number): GeoBox {
  const lats = coords.map((c) => c[1]);
  const lons = coords.map((c) => c[0]);
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  const midLat = ((south + north) / 2) * (Math.PI / 180);
  const dLat = marginM / 110_900;
  const dLon = marginM / (111_320 * Math.cos(midLat));
  const down = (v: number): number => Math.floor(v * 1e5) / 1e5;
  const up = (v: number): number => Math.ceil(v * 1e5) / 1e5;
  return { south: down(south - dLat), west: down(Math.min(...lons) - dLon), north: up(north + dLat), east: up(Math.max(...lons) + dLon) };
}

/** True when box `outer` holds box `inner`. */
export const boxHolds = (outer: GeoBox, inner: GeoBox): boolean =>
  outer.south <= inner.south && outer.west <= inner.west && outer.north >= inner.north && outer.east >= inner.east;

/** Problems of a ring as an outline: too few points, a crossing of two edges, a repeated point. Empty when fine. */
export function ringProblems(ring: readonly P2[]): string[] {
  const out: string[] = [];
  const n = ring.length;
  if (n < 3) return [`only ${n} points`];
  for (let i = 0; i < n; i++) {
    const a = ring[i] as P2;
    const b = ring[(i + 1) % n] as P2;
    if (Math.hypot(a.x - b.x, a.z - b.z) < 0.01) out.push(`point ${i} repeats point ${(i + 1) % n}`);
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // neighbours across the closing edge
      const c = ring[j] as P2;
      const d = ring[(j + 1) % n] as P2;
      if (segmentCrossing(a, b, c, d)) out.push(`edge ${i} crosses edge ${j}`);
    }
  }
  return out;
}
