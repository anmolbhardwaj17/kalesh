// The two small files the map inspector draws besides issues.json (tools/inspector/, MAP_REPAIR.md "Map inspector"):
// context.json, a plan of the repaired roads and footprints with the stage outline, and tiles/index.json, the named
// places and the tile list (empty until the tile step lands). Everything in world metres (east +X, north -Z), the
// grid the overrides files and the tiles use. Pure; tools/bake/sources/repairio.ts writes the files.
import { pointInRing } from '../geom.ts';
import type { P2 } from '../geom.ts';
import type { BlockGraph } from '../graph/build.ts';

const r1 = (v: number): number => Math.round(v * 10) / 10 + 0;

export interface InspectorContext {
  version: 1;
  block: string;
  /** The stage outline, closed, as [x, z] pairs. */
  outline: [number, number][];
  roads: { k: string; w: number; p: number[] }[];
  /** One flat list of x, y, z per footprint ring. */
  buildings: number[][];
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
    roads: graph.edges.map((e) => ({ k: e.road.cls, w: Math.round(e.road.width * 10) / 10, p: e.pts.flatMap(world) })),
    buildings: graph.footprints.map((f) => f.ring.flatMap(world)),
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
