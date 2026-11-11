// Building footprints of the block graph (BS1 with our own merge rule, MAP_REPAIR.md "Pipeline" step 1). Overture's
// buildings theme already merges OSM, Microsoft, Google Open Buildings and Esri, but it drops the OSM tags the
// landmark join needs (wikidata, historic, amenity) and leaves out machine-made footprints that touch a road. Our rule:
// OSM footprints read from OSM itself come first and keep every tag; Overture's machine-made footprints (Microsoft,
// Google, Esri) follow where they do not cover one already taken; Overture's copies of OSM footprints come last and
// only fill a gap (an OSM building our extract cut off). Footprints below ground are left out. A footprint belongs to
// the stage when its centre is inside the outline. Ids are the source's own: "way/<id>", "relation/<id>" for OSM,
// "overture/<GERS id>" (plus "#<n>" for the parts of a multipolygon). Pure.
import { MERGE_DEFAULTS, footprint, mergeFootprints } from '../buildings.ts';
import type { MergeResult } from '../buildings.ts';
import { pointInRing } from '../geom.ts';
import type { P2 } from '../geom.ts';
import type { Footprint } from '../osm.ts';

/** One row of the Overture buildings file (data/<stage>/overture_buildings.json): only the fields the bake reads. */
export interface OvertureRow {
  id: string;
  sources?: { dataset?: string | null; provider?: string | null }[] | null;
  height?: number | null;
  num_floors?: number | null;
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

/** Overture rows as footprints in block metres (source "overture:<provider>"). */
export function overtureFootprints(rows: readonly OvertureRow[], project: (lat: number, lon: number) => P2): { list: Footprint[]; underground: number } {
  const list: Footprint[] = [];
  let underground = 0;
  for (const row of rows) {
    if (row.is_underground) {
      underground++;
      continue;
    }
    const geom = typeof row.geojson === 'string' ? (JSON.parse(row.geojson) as { type: string; coordinates: unknown }) : row.geojson;
    const rings = outerRings(geom);
    rings.forEach((ring, i) => {
      const pts = ring.map(([lon, lat]) => project(lat, lon));
      const f = footprint(i === 0 ? `overture/${row.id}` : `overture/${row.id}#${i}`, `overture:${overtureProvider(row)}`, pts, {}, typeof row.height === 'number' ? row.height : null, typeof row.num_floors === 'number' ? row.num_floors : null);
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
