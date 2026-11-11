// Building footprint sources: our own merge of several footprint sets (BS2) and the measures that compare it with
// the ready-made Overture merge (BS1): duplicates left, coverage, and which OSM tags survive.
import { Grid, boxOf, boxesMeet, openRing, overlapShare, ringArea, ringCentroid } from './geom.ts';
import type { P2 } from './geom.ts';
import type { Footprint, Tags } from './osm.ts';
import { duplicatePairs } from './rules/census/buildings.ts';

/** A footprint from any source, in district metres. */
export function footprint(id: string, source: string, ring: readonly P2[], tags: Tags = {}, height: number | null = null, levels: number | null = null): Footprint | null {
  const open = openRing(ring);
  if (open.length < 3) return null;
  const area = Math.abs(ringArea(open));
  if (!(area > 0)) return null;
  return { id, source, ring: open, area, centre: ringCentroid(open), box: boxOf(open), tags, height, levels };
}

export interface MergeOptions {
  /** A candidate that lies at least this share inside footprints already taken is the same building: dropped. */
  duplicateShare: number;
  /** A candidate with less overlap than this is a new building: added. In between it conflicts: dropped and logged. */
  freeShare: number;
  /** Footprints smaller than this many square metres are noise. */
  minArea: number;
}

export const MERGE_DEFAULTS: MergeOptions = { duplicateShare: 0.5, freeShare: 0.2, minArea: 6 };

export interface MergeResult {
  merged: Footprint[];
  /** Per source: how many were added, matched an earlier footprint, conflicted, or were too small. */
  bySource: Record<string, { input: number; added: number; duplicate: number; conflict: number; tiny: number }>;
}

/**
 * Merges footprint sets in priority order (the first set wins: OSM keeps its tags). A later footprint is added only
 * where it does not cover a footprint already taken.
 */
export function mergeFootprints(layers: readonly (readonly Footprint[])[], opts: MergeOptions = MERGE_DEFAULTS): MergeResult {
  const grid = new Grid<Footprint>(40);
  const merged: Footprint[] = [];
  const bySource: MergeResult['bySource'] = {};
  layers.forEach((layer, li) => {
    for (const f of layer) {
      const s = (bySource[f.source] ??= { input: 0, added: 0, duplicate: 0, conflict: 0, tiny: 0 });
      s.input++;
      if (f.area < opts.minArea) {
        s.tiny++;
        continue;
      }
      let covered = 0;
      if (li > 0) {
        for (const g of grid.query(f.box)) {
          if (!boxesMeet(f.box, g.box)) continue;
          covered += overlapShare(f.ring, g.ring, 8);
          // a small footprint already taken that sits inside this one makes this one a duplicate too
          if (covered < opts.duplicateShare && g.area < f.area && overlapShare(g.ring, f.ring, 8) >= opts.duplicateShare) covered = 1;
          if (covered >= opts.duplicateShare) break;
        }
      }
      if (covered >= opts.duplicateShare) s.duplicate++;
      else if (covered >= opts.freeShare) s.conflict++;
      else {
        s.added++;
        merged.push(f);
        grid.insert(f.box, f);
      }
    }
  });
  return { merged, bySource };
}

export interface FootprintStats {
  count: number;
  areaM2: number;
  /** Share of the box area under footprints (overlaps counted twice, so a set with duplicates reads high). */
  coverage: number;
  duplicatePairs: number;
  exactDuplicatePairs: number;
  medianAreaM2: number;
  withHeightOrLevels: number;
}

/** Count, coverage and duplicates left of one footprint set inside a box of `boxAreaM2`. */
export function footprintStats(set: readonly Footprint[], boxAreaM2: number): FootprintStats {
  const pairs = duplicatePairs(set);
  const areas = set.map((f) => f.area).sort((a, b) => a - b);
  const total = areas.reduce((s, a) => s + a, 0);
  return {
    count: set.length, areaM2: Math.round(total), coverage: Math.round((total / boxAreaM2) * 10000) / 10000, duplicatePairs: pairs.length,
    exactDuplicatePairs: pairs.filter((p) => p.smallInLarge >= 0.85 && p.largeInSmall >= 0.85).length,
    medianAreaM2: Math.round((areas[Math.floor(areas.length / 2)] ?? 0) * 10) / 10,
    withHeightOrLevels: set.filter((f) => f.height !== null || f.levels !== null).length,
  };
}

/** Share of a box (0 to 1) under any footprint of the set, from an n by n grid of sample points: no double count. */
export function coveredShare(set: readonly Footprint[], box: { minX: number; minZ: number; maxX: number; maxZ: number }, n = 120): number {
  const grid = new Grid<Footprint>(40);
  for (const f of set) grid.insert(f.box, f);
  let hit = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const p = { x: box.minX + ((i + 0.5) / n) * (box.maxX - box.minX), z: box.minZ + ((j + 0.5) / n) * (box.maxZ - box.minZ) };
      const pb = { minX: p.x, minZ: p.z, maxX: p.x, maxZ: p.z };
      for (const f of grid.query(pb)) {
        if (p.x < f.box.minX || p.x > f.box.maxX || p.z < f.box.minZ || p.z > f.box.maxZ) continue;
        if (insideRing(p, f.ring)) {
          hit++;
          break;
        }
      }
    }
  }
  return Math.round((hit / (n * n)) * 10000) / 10000;
}

function insideRing(p: P2, ring: readonly P2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as P2;
    const b = ring[j] as P2;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export interface TagLoss {
  osmBuildings: number;
  /** OSM buildings found again in the other set by their OSM id. */
  foundById: number;
  /** For OSM buildings found by id: tags the other set still carries, per key. */
  keys: Record<string, { osm: number; kept: number }>;
}

/**
 * Which OSM building tags survive in a merged set. `kept(osmId)` returns the tag keys the merged feature still
 * carries for that OSM id (in OSM key names), or null when the OSM building is not in the set.
 */
export function osmTagLoss(osm: readonly Footprint[], kept: (osmId: string) => ReadonlySet<string> | null): TagLoss {
  const out: TagLoss = { osmBuildings: osm.length, foundById: 0, keys: {} };
  for (const b of osm) {
    const k = kept(b.id);
    if (k) out.foundById++;
    for (const key of Object.keys(b.tags)) {
      const group = key.startsWith('addr:') ? 'addr:*' : key;
      const row = (out.keys[group] ??= { osm: 0, kept: 0 });
      row.osm++;
      if (k && (k.has(key) || k.has(group))) row.kept++;
    }
  }
  return out;
}
