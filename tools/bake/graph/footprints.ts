// Building footprints of the block graph (BS1 with our own merge rule, MAP_REPAIR.md "Pipeline" step 1). Overture's
// buildings theme already merges OSM, Microsoft, Google Open Buildings and Esri, but it drops the OSM tags the
// landmark join needs (wikidata, historic, amenity) and leaves out machine-made footprints that touch a road. Our rule:
// OSM footprints read from OSM itself come first and keep every tag; Overture's machine-made footprints (Microsoft,
// Google, Esri) follow where they do not cover one already taken; Overture's copies of OSM footprints come last and
// only fill a gap (an OSM building our extract cut off). Footprints below ground are split off before the merge
// (underground.ts; every Overture row comes back with its level fields in "overture:" tags). A footprint belongs to
// the stage when its centre is inside the outline. Ids are the source's own: "way/<id>", "relation/<id>" for OSM,
// "overture/<GERS id>" (plus "#<n>" for the parts of a multipolygon). Pure.
import { MERGE_DEFAULTS, footprint, mergeFootprints } from '../buildings.ts';
import type { MergeResult } from '../buildings.ts';
import { pointInRing } from '../geom.ts';
import type { P2 } from '../geom.ts';
import type { Footprint } from '../osm.ts';
import { overtureBelowGround, overtureTags } from './underground.ts';

/** One row of the Overture buildings file (data/<stage>/overture_buildings.json): only the fields the bake reads. */
export interface OvertureRow {
  id: string;
  sources?: { dataset?: string | null; provider?: string | null; record_id?: string | null }[] | null;
  names?: { primary?: string | null } | null;
  class?: string | null;
  level?: number | null;
  height?: number | null;
  num_floors?: number | null;
  num_floors_underground?: number | null;
  is_underground?: boolean | null;
  geojson: string | { type: string; coordinates: unknown };
}

/** Provider name of an Overture row, as one short word: osm, microsoft, google, esri or other. */
export function overtureProvider(row: OvertureRow): string {
  const s = row.sources?.[0];
  const v = `${s?.provider ?? ''} ${s?.dataset ?? ''}`.toLowerCase();
  if (v.includes('openstreetmap') || v.includes('osm')) return 'osm';
  if (v.includes('microsoft')) return 'microsoft';
  if (v.includes('google')) return 'google';
  if (v.includes('esri')) return 'esri';
  return 'other';
}

/** Outer rings ([lon, lat] lists) of a GeoJSON Polygon or MultiPolygon. */
function outerRings(geom: { type: string; coordinates: unknown }): [number, number][][] {
  if (geom.type === 'Polygon') return [((geom.coordinates as [number, number][][])[0] ?? [])];
  if (geom.type === 'MultiPolygon') return (geom.coordinates as [number, number][][][]).map((p) => p[0] ?? []);
  return [];
}

/** Overture rows as footprints in block metres (source "overture:<provider>"), every row: the level fields ride in
 * "overture:" tags for the underground class (underground.ts); `underground` counts the rows those fields put below
 * ground. */
export function overtureFootprints(rows: readonly OvertureRow[], project: (lat: number, lon: number) => P2): { list: Footprint[]; underground: number } {
  const list: Footprint[] = [];
  let underground = 0;
  const n = (v: number | null | undefined): number | null => (typeof v === 'number' ? v : null);
  for (const row of rows) {
    const fields = { record: row.sources?.[0]?.record_id ?? null, level: n(row.level), isUnderground: row.is_underground === true, floors: n(row.num_floors), floorsUnderground: n(row.num_floors_underground), name: row.names?.primary ?? null, cls: row.class ?? null };
    if (overtureBelowGround(fields)) underground++;
    const tags = overtureTags(fields);
    const geom = typeof row.geojson === 'string' ? (JSON.parse(row.geojson) as { type: string; coordinates: unknown }) : row.geojson;
    const rings = outerRings(geom);
    rings.forEach((ring, i) => {
      const pts = ring.map(([lon, lat]) => project(lat, lon));
      const f = footprint(i === 0 ? `overture/${row.id}` : `overture/${row.id}#${i}`, `overture:${overtureProvider(row)}`, pts, tags, n(row.height), n(row.num_floors));
      if (f) list.push(f);
    });
  }
  return { list, underground };
}

export interface FootprintSet {
  footprints: Footprint[];
  /** Per source: input, added, duplicate, conflict, tiny (see tools/bake/buildings.ts mergeFootprints). */
  bySource: MergeResult['bySource'];
  /** Footprints whose centre is outside the outline (dropped before the merge). */
  outside: number;
  underground: number;
}

const byId = (a: Footprint, b: Footprint): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The merged footprints of a stage: OSM first, then Overture's machine-made footprints, then Overture's OSM copies. */
export function mergeStageFootprints(osm: readonly Footprint[], overture: readonly Footprint[], ring: readonly P2[], osmUnderground = 0, overtureUnderground = 0): FootprintSet {
  let outside = 0;
  const inside = (f: Footprint): boolean => {
    const ok = pointInRing(f.centre, ring);
    if (!ok) outside++;
    return ok;
  };
  const layerOsm = osm.filter(inside).sort(byId);
  const layerMachine = overture.filter((f) => f.source !== 'overture:osm' && inside(f)).sort(byId);
  const layerCopies = overture.filter((f) => f.source === 'overture:osm' && inside(f)).sort(byId);
  const merged = mergeFootprints([layerOsm, layerMachine, layerCopies], MERGE_DEFAULTS);
  return { footprints: merged.merged.slice().sort(byId), bySource: merged.bySource, outside, underground: osmUnderground + overtureUnderground };
}
