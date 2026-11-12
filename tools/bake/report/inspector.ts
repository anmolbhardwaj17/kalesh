// The two small files the map inspector draws besides issues.json (tools/inspector/, MAP_REPAIR.md "Map inspector"):
// context.json, a plan of the repaired roads and footprints with the stage outline, and tiles/index.json, the named
// places and the tile list (empty until the tile step lands). Everything in world metres (east +X, north -Z), the
// grid the overrides files and the tiles use. Pure; tools/bake/sources/repairio.ts writes the files.
import { pointInRing } from '../geom.ts';
import type { P2 } from '../geom.ts';
import type { BlockGraph } from '../graph/build.ts';
import { undergroundLabel } from '../graph/underground.ts';

const r1 = (v: number): number => Math.round(v * 10) / 10 + 0;

export interface InspectorContext {
  version: 1;
  block: string;
  /** The stage outline, closed, as [x, z] pairs. */
  outline: [number, number][];
  /** k class, w width, p x y z points; id the edge id the issues name, n its name and r its ref when it has them (P1-039). */
  roads: { id: string; k: string; w: number; p: number[]; n?: string; r?: string }[];
  /** One flat list of x, y, z per footprint ring. */
  buildings: number[][];
  /** Footprints with a name (P1-039): id, name, centre and a kind word (station, temple, building) for the inspector's labels. */
  named: { id: string; n: string; x: number; z: number; k: string }[];
  /** Underground structures (P1-041): id, label ("Underground: Rajiv Chowk metro station"), kind, middle and the ring as one flat x, y, z list. Drawn dashed, never an issue. */
  underground?: { id: string; n: string; k: string; x: number; z: number; p: number[] }[];
}

/** One word for what a named footprint is, from its tags. */
function footprintKind(tags: Record<string, string | undefined>): string {
  const t = (k: string): string => tags[k] ?? '';
  if (t('railway') === 'station' || t('public_transport') === 'station' || t('building') === 'train_station') return 'station';
  if (t('amenity') === 'place_of_worship') return t('religion') === 'muslim' ? 'mosque' : t('religion') === 'hindu' ? 'temple' : t('religion') === 'sikh' ? 'gurdwara' : t('religion') === 'christian' ? 'church' : 'place of worship';
  if (t('historic')) return 'monument';
  if (t('amenity')) return t('amenity').replace(/_/g, ' ');
  if (t('shop')) return 'shop';
  const b = t('building');
  return b && b !== 'yes' ? b.replace(/_/g, ' ') : 'building';
}

/** A plan of the repaired graph: road ribbons (class, width, x y z points) and footprint rings. */
export function inspectorContext(graph: BlockGraph, offset: P2, outline: readonly P2[]): InspectorContext {
  const world = (p: P2): number[] => [r1(p.x + offset.x), 0, r1(p.z + offset.z)];
  const ring = outline.map((p): [number, number] => [r1(p.x + offset.x), r1(p.z + offset.z)]);
  if (ring.length) ring.push(ring[0] as [number, number]);
  return {
    version: 1,
    block: graph.block,
    outline: ring,
    roads: graph.edges.map((e) => ({ id: e.id, k: e.road.cls, w: Math.round(e.road.width * 10) / 10, p: e.pts.flatMap(world), ...(e.name ? { n: e.name } : {}), ...(e.ref ? { r: e.ref } : {}) })),
    buildings: graph.footprints.map((f) => f.ring.flatMap(world)),
    named: graph.footprints.filter((f) => f.tags['name']).map((f) => {
      const c = f.ring.reduce((a, q) => ({ x: a.x + q.x / f.ring.length, z: a.z + q.z / f.ring.length }), { x: 0, z: 0 });
      return { id: f.id, n: String(f.tags['name']), x: r1(c.x + offset.x), z: r1(c.z + offset.z), k: footprintKind(f.tags as Record<string, string | undefined>) };
    }),
    underground: (graph.underground ?? []).map((u) => {
      const c = u.ring.reduce((a, q) => ({ x: a.x + q.x / u.ring.length, z: a.z + q.z / u.ring.length }), { x: 0, z: 0 });
      return { id: u.id, n: undergroundLabel(u), k: u.kind, x: r1(c.x + offset.x), z: r1(c.z + offset.z), p: u.ring.flatMap(world) };
    }),
  };
}

export interface PlaceIn {
  id: string;
  name: string;
  block: string;
  lat: number;
  lon: number;
}

export interface InspectorIndex {
  version: 1;
  block: string;
  datum: number;
  tiles: { file: string; x: number; z: number; size: number; origin: [number, number, number]; label: string }[];
  places: { id: string; name: string; x: number; z: number }[];
}

/** The named places of the block that lie inside the stage outline, in world metres. */
export function inspectorIndex(block: string, places: readonly PlaceIn[], toBlock: (lat: number, lon: number) => P2, offset: P2, outline: readonly P2[]): InspectorIndex {
  const out: InspectorIndex['places'] = [];
  for (const p of places) {
    if (p.block !== block) continue;
    const b = toBlock(p.lat, p.lon);
    if (outline.length && !pointInRing(b, outline)) continue;
    out.push({ id: p.id, name: p.name, x: r1(b.x + offset.x), z: r1(b.z + offset.z) });
  }
  return { version: 1, block, datum: 0, tiles: [], places: out };
}
