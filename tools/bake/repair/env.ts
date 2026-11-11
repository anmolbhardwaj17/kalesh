// The rule environment of a real bake (what tools/bake/rules/types.ts RuleEnv asks for), put together from what the
// driver has read: the block's projection and world offset, the focus district outlines, the ground model and the raw
// height source, the hero specs and list, the named places and the OSM node tags. Pure.
import type { Projector } from '../../geo/projection.ts';
import { pointInRing } from '../geom.ts';
import type { P2 } from '../geom.ts';
import { sampleGrid } from '../ground.ts';
import type { HeightGrid } from '../ground.ts';
import type { BlockGraph } from '../graph/build.ts';
import { tileOf } from '../layout/grid.ts';
import type { OsmElement, Tags } from '../osm.ts';
import type { HeroSpec } from '../roads/hero.ts';
import type { HeroListEntry, RuleEnv } from '../rules/types.ts';

export interface EnvInput {
  proj: Projector;
  /** World metres of the block's frame origin (tools/bake/layout/placement.ts). */
  offset: P2;
  /** Focus district outlines in block metres. */
  focus: readonly { id: string; ring: readonly P2[] }[];
  ground: ((x: number, z: number) => number) | null;
  heightSource: HeightGrid | null;
  heroSpecs: readonly HeroSpec[];
  heroList: readonly HeroListEntry[];
  /** Named places (mission anchors and landmarks) as latitude and longitude. */
  places: readonly { lat: number; lon: number }[];
  elements: readonly OsmElement[];
  graph: BlockGraph;
  mapEdge: 'stage' | 'map';
}

/** OSM tags of the graph's nodes that carry any, by graph node id ("n<osm id>"). */
export function graphNodeTags(elements: readonly OsmElement[], graph: BlockGraph): Map<string, Tags> {
  const wanted = new Set(graph.nodes.map((n) => n.id));
  const out = new Map<string, Tags>();
  for (const e of elements) if (e.type === 'node' && e.tags && wanted.has(`n${e.id}`)) out.set(`n${e.id}`, e.tags);
  return out;
}

const WALK = new Set(['footway', 'steps', 'path', 'pedestrian', 'corridor']);

/** Foot ways that are not bridges, and platforms, as lines in block metres (where a foot over bridge may land). */
export function walkways(elements: readonly OsmElement[], project: (lat: number, lon: number) => P2): P2[][] {
  const pos = new Map<number, P2>();
  for (const e of elements) if (e.type === 'node' && e.lat !== undefined && e.lon !== undefined) pos.set(e.id, project(e.lat, e.lon));
  const out: P2[][] = [];
  for (const e of elements) {
    if (e.type !== 'way' || !e.tags || !e.nodes) continue;
    const t = e.tags;
    const foot = t['highway'] !== undefined && WALK.has(t['highway']) && (t['bridge'] === undefined || t['bridge'] === 'no');
    if (!foot && t['railway'] !== 'platform' && t['public_transport'] !== 'platform') continue;
    const line = e.nodes.map((id) => pos.get(id)).filter((p): p is P2 => p !== undefined);
    if (line.length >= 2) out.push(line);
  }
  return out;
}

export function buildRuleEnv(i: EnvInput): RuleEnv {
  const source = i.heightSource;
  const ground = i.ground;
  return {
    toGeo: (x, z) => i.proj.toGeo(x, z),
    tile: (x, z) => {
      const t = tileOf(x + i.offset.x, z + i.offset.z);
      return [t.tx, t.tz];
    },
    district: (x, z) => i.focus.find((f) => pointInRing({ x, z }, f.ring))?.id ?? null,
    ...(ground ? { ground: (x: number, z: number) => { const h = ground(x, z); return Number.isFinite(h) ? h : null; } } : {}),
    ...(source ? { heightSource: (x: number, z: number) => { const g = i.proj.toGeo(x, z); return sampleGrid(source, g.lat, g.lon); } } : {}),
    heroSpecs: i.heroSpecs,
    heroList: i.heroList,
    missionPlaces: i.places.map((p) => i.proj.toWorld(p.lat, p.lon)).map((p) => ({ x: p.x, z: p.z })),
    nodeTags: graphNodeTags(i.elements, i.graph),
    walkways: walkways(i.elements, (lat, lon) => i.proj.toWorld(lat, lon)),
    mapEdge: i.mapEdge,
  };
}
