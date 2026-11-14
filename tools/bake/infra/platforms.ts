// Railway platforms for the kits (P2-034, rail.md RAIL-PLAT): the OSM platforms of the Indian Railways stations
// (railway=platform, areas or lines), at the high-level platform height over the track beside them (top 0.76 to
// 0.84 m over the rail), with the long blue roof the New Delhi and Old Delhi platforms have. Metro platforms (under
// the ground, or with no rail track within reach) are left out. Pure.
import { pointSegment, polylineLength } from '../geom.ts';
import type { P2 } from '../geom.ts';
import type { OsmElement } from '../osm.ts';
import { RAIL_OVER_SLEEPER_BASE_M } from './rails.ts';
import type { Track } from './rails.ts';

/** Platform top over the rail top (rail.md: 760 to 840 mm). */
export const PLATFORM_OVER_RAIL_M = 0.8;
/** A line platform's width when OSM has none (rail.md: 4 m side, 6 m island). */
export const PLATFORM_WIDTH_M = 6;
/** A platform needs a rail track within this distance of its middle line (m). */
const TRACK_REACH_M = 12;

export interface Platform {
  id: string;
  name: string;
  /** The outline (an area, or a line widened to its width), in block metres. */
  ring: P2[];
  /** The middle line along its length (for the roof columns). */
  axis: [P2, P2];
  top: number;
  roof: boolean;
}

export interface PlatformSource {
  id: string;
  name: string;
  pts: P2[];
  area: boolean;
  width: number;
}

/** The platform ways of the extract with their points (block metres). */
export function platformSources(elements: readonly OsmElement[], project: (lat: number, lon: number) => P2): PlatformSource[] {
  const nodes = new Map<number, P2>();
  for (const e of elements) if (e.type === 'node' && typeof e.lat === 'number' && typeof e.lon === 'number') nodes.set(e.id, project(e.lat, e.lon));
  const out: PlatformSource[] = [];
  for (const e of elements) {
    const t = e.tags ?? {};
    if (e.type !== 'way' || t['railway'] !== 'platform') continue;
    if (Number(t['layer'] ?? 0) < 0 || Number(t['level'] ?? 0) < 0 || t['location'] === 'underground') continue;
    const ids = (e.nodes ?? []) as number[];
    const pts = ids.map((id) => nodes.get(id)).filter((p): p is P2 => p !== undefined);
    if (pts.length < 2) continue;
    const area = ids.length > 3 && ids[0] === ids[ids.length - 1];
    const w = Number.parseFloat(t['width'] ?? '');
    out.push({ id: `way/${e.id}`, name: t['name'] ?? '', pts: area ? pts.slice(0, -1) : pts, area, width: Number.isFinite(w) && w > 1 && w < 20 ? w : PLATFORM_WIDTH_M });
  }
  return out;
}

/** The long axis of a set of points: its two ends on the main direction through the middle. */
function axisOf(pts: readonly P2[]): [P2, P2] {
  let cx = 0;
  let cz = 0;
  for (const p of pts) {
    cx += p.x / pts.length;
    cz += p.z / pts.length;
  }
  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  for (const p of pts) {
    sxx += (p.x - cx) ** 2;
    sxz += (p.x - cx) * (p.z - cz);
    szz += (p.z - cz) ** 2;
  }
  const a = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const dx = Math.cos(a);
  const dz = Math.sin(a);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    const s = (p.x - cx) * dx + (p.z - cz) * dz;
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  }
  return [{ x: cx + dx * lo, z: cz + dz * lo }, { x: cx + dx * hi, z: cz + dz * hi }];
}

/** A line widened by w/2 each side into a ring (mitred, enough for the straight platforms of a station). */
function widen(pts: readonly P2[], w: number): P2[] {
  const left: P2[] = [];
  const right: P2[] = [];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[Math.max(0, k - 1)] as P2;
    const b = pts[Math.min(pts.length - 1, k + 1)] as P2;
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nx = -(b.z - a.z) / len;
    const nz = (b.x - a.x) / len;
    const p = pts[k] as P2;
    left.push({ x: p.x + nx * w * 0.5, z: p.z + nz * w * 0.5 });
    right.push({ x: p.x - nx * w * 0.5, z: p.z - nz * w * 0.5 });
  }
  return [...left, ...right.reverse()];
}

/** The platforms beside a rail track, at the platform height over the nearest track's rail. */
export function buildPlatforms(sources: readonly PlatformSource[], tracks: readonly Track[]): { platforms: Platform[]; skipped: number } {
  const platforms: Platform[] = [];
  let skipped = 0;
  for (const s of sources) {
    const ring = s.area ? s.pts.slice() : widen(s.pts, s.width);
    const axis = s.area ? axisOf(ring) : ([s.pts[0], s.pts[s.pts.length - 1]] as [P2, P2]);
    const mid = { x: (axis[0].x + axis[1].x) / 2, z: (axis[0].z + axis[1].z) / 2 };
    let best: { d: number; y: number } | null = null;
    for (const t of tracks) {
      if (t.bridge) continue;
      for (let k = 0; k + 1 < t.pts.length; k++) {
        const a = t.pts[k] as Track['pts'][number];
        const b = t.pts[k + 1] as Track['pts'][number];
        if (Math.abs(a.x - mid.x) > 400 || Math.abs(a.z - mid.z) > 400) continue;
        for (const q of [mid, axis[0], axis[1]]) {
          const ps = pointSegment(q, a, b);
          if (!best || ps.d < best.d) best = { d: ps.d, y: a.y + (b.y - a.y) * ps.t };
        }
      }
    }
    if (!best || best.d > TRACK_REACH_M + s.width || polylineLength(axis) < 8) {
      skipped++;
      continue;
    }
    platforms.push({ id: s.id, name: s.name, ring, axis, top: best.y + RAIL_OVER_SLEEPER_BASE_M + PLATFORM_OVER_RAIL_M, roof: polylineLength(axis) > 40 });
  }
  return { platforms, skipped };
}
