// Overrides (ARCH_OPTIONS OV1, MAP_REPAIR.md "Overrides format"): one JSON patch file per tile, keyed by stable ids
// with a lat and lon anchor. On a new extract a patch finds its target by id first, then by the anchor within its
// tolerance. A patch whose target is not found is reported as stale and stays in the file: it is never dropped.
import { pointSegment } from './geom.ts';
import type { P2 } from './geom.ts';
import { roadWidth } from './osm.ts';
import type { Footprint, MapData, Road } from './osm.ts';
import type { Issue, Patch } from './rules/types.ts';

export type Resolution = 'by_id' | 'by_anchor' | 'stale';

export interface PatchResult {
  patch: Patch;
  resolution: Resolution;
  /** Ids the patch acts on in this extract (the same as target.ids when found by id). */
  targets: string[];
  applied: boolean;
  note: string;
}

/** The tile an override is filed under: the tile of its anchor in district metres. */
export function overrideTile(anchor: P2, size = 250): { tx: number; tz: number; file: string } {
  const tx = Math.floor(anchor.x / size);
  const tz = Math.floor(anchor.z / size);
  return { tx, tz, file: `${tx}_${tz}.json` };
}

function findFeature(map: MapData, id: string): Road | Footprint | null {
  return map.roads.find((r) => r.id === id) ?? map.buildings.find((b) => b.id === id) ?? null;
}

const isRoad = (f: Road | Footprint): f is Road => 'pts' in f;

/** The feature of the wanted kind nearest to the anchor, within the tolerance. */
function nearest(map: MapData, anchor: P2, tolerance: number, kind: 'road' | 'building', skip: ReadonlySet<string>): { id: string; d: number } | null {
  let best: { id: string; d: number } | null = null;
  if (kind === 'road') {
    for (const r of map.roads) {
      if (skip.has(r.id)) continue;
      if (anchor.x < r.box.minX - tolerance || anchor.x > r.box.maxX + tolerance || anchor.z < r.box.minZ - tolerance || anchor.z > r.box.maxZ + tolerance) continue;
      for (let i = 0; i + 1 < r.pts.length; i++) {
        const d = pointSegment(anchor, r.pts[i] as P2, r.pts[i + 1] as P2).d;
        if (d <= tolerance && (!best || d < best.d)) best = { id: r.id, d };
      }
    }
  } else {
    for (const b of map.buildings) {
      if (skip.has(b.id)) continue;
      const d = Math.hypot(b.centre.x - anchor.x, b.centre.z - anchor.z);
      if (d <= tolerance && (!best || d < best.d)) best = { id: b.id, d };
    }
  }
  return best;
}

/**
 * Finds a patch's targets in a map: every id present means by id; otherwise each missing id is looked for at the
 * anchor (a road for a way that was a road in the patch's params.kind, else a building). `kinds` gives the kind of
 * each target id (the patch writer records it in params.kinds as "road,building").
 */
export function resolvePatch(patch: Patch, map: MapData, project: (lat: number, lon: number) => P2): { resolution: Resolution; targets: string[]; note: string } {
  const ids = patch.target.ids;
  const found = ids.map((id) => findFeature(map, id));
  if (found.every((f) => f !== null)) return { resolution: 'by_id', targets: ids.slice(), note: 'every target id is in this extract' };
  const anchor = project(patch.target.anchor.lat, patch.target.anchor.lon);
  const kinds = String(patch.params['kinds'] ?? '').split(',');
  const targets: string[] = [];
  const taken = new Set<string>();
  const notes: string[] = [];
  for (let i = 0; i < ids.length; i++) {
    const f = found[i];
    if (f) {
      targets.push(f.id);
      taken.add(f.id);
      continue;
    }
    const kind = kinds[i] === 'building' ? 'building' : 'road';
    const hit = nearest(map, anchor, patch.target.tolerance_m, kind, taken);
    if (!hit) return { resolution: 'stale', targets: [], note: `${ids[i]} is not in this extract and no ${kind} lies within ${patch.target.tolerance_m} m of the anchor` };
    targets.push(hit.id);
    taken.add(hit.id);
    notes.push(`${ids[i]} is gone; ${hit.id} lies ${Math.round(hit.d * 10) / 10} m from the anchor`);
  }
  return { resolution: 'by_anchor', targets, note: notes.join('; ') };
}

/**
 * Applies patches to a map in place. set_tag and remove change the map, so the rule that raised the issue no longer
 * fires; the other actions are carried as resolved patches for the repair step that owns that geometry.
 * Returns one result per patch, stale ones included.
 */
export function applyPatches(map: MapData, patches: readonly Patch[], project: (lat: number, lon: number) => P2): PatchResult[] {
  const out: PatchResult[] = [];
  for (const patch of patches) {
    const res = resolvePatch(patch, map, project);
    let applied = false;
    if (res.resolution !== 'stale') {
      if (patch.action === 'set_tag') {
        const key = String(patch.params['key']);
        const value = String(patch.params['value']);
        const on = patch.params['on'] !== undefined ? res.targets[patch.target.ids.indexOf(String(patch.params['on']))] ?? res.targets[0] : res.targets[0];
        const f = on ? findFeature(map, on) : null;
        if (f) {
          const tags = { ...f.tags, [key]: value };
          if (isRoad(f)) {
            f.tags = tags;
            f.layer = Number(tags['layer'] ?? 0) || 0;
            const w = roadWidth(tags, f.cls, f.oneway, f.link);
            f.width = w.width;
            f.widthFrom = w.from;
          } else {
            f.tags = tags;
          }
          applied = true;
        }
      } else if (patch.action === 'remove') {
        const drop = patch.params['drop'] !== undefined ? res.targets[patch.target.ids.indexOf(String(patch.params['drop']))] ?? res.targets[0] : res.targets[0];
        const bi = map.buildings.findIndex((b) => b.id === drop);
        if (bi >= 0) {
          map.buildings.splice(bi, 1);
          applied = true;
        }
      } else {
        applied = true; // resolved; the repair step that owns the geometry applies it
      }
    }
    out.push({ patch, resolution: res.resolution, targets: res.targets, applied, note: res.note });
  }
  return out;
}

export function staleReport(results: readonly PatchResult[]): { id: string; issue: string; note: string }[] {
  return results.filter((r) => r.resolution === 'stale').map((r) => ({ id: r.patch.id, issue: r.patch.issue, note: r.note }));
}

/**
 * After a rule run on the patched map: an issue that a resolved patch names (same rule, the patch's targets among
 * its features) is marked overridden, so the inspector and the auto-repair leave it alone. Returns, per patch,
 * whether its issue is gone (the patch changed the map), overridden (still found, now marked), or stale.
 */
export function markOverridden(issues: Issue[], results: readonly PatchResult[]): { id: string; outcome: 'gone' | 'overridden' | 'stale' }[] {
  return results.map((r) => {
    if (r.resolution === 'stale') return { id: r.patch.id, outcome: 'stale' as const };
    const rule = r.patch.issue.split(':')[0];
    const hit = issues.filter((i) => i.rule === rule && r.targets.every((t) => i.features.includes(t)));
    for (const i of hit) i.status = 'overridden';
    return { id: r.patch.id, outcome: hit.length ? ('overridden' as const) : ('gone' as const) };
  });
}
