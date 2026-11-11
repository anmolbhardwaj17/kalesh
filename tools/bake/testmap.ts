// Test helper: a tiny OSM extract written in metres. A node's "lon" is x (east) and its "lat" is metres north, so
// the projection of the tests is ({ x: lon, z: -lat }) and shapes are easy to read.
import { buildMap } from './osm.ts';
import type { MapData, OsmElement } from './osm.ts';
import { buildBlockGraph } from './graph/build.ts';
import type { BlockGraph } from './graph/build.ts';
import type { OvertureRow } from './graph/footprints.ts';
import { RuleContext } from './rules/context.ts';
import type { Marks, RuleEnv } from './rules/types.ts';
import { buildTile } from './tile.ts';
import type { TileContent } from './tile.ts';

export const flat = (lat: number, lon: number) => ({ x: lon, z: -lat });

export class Sketch {
  readonly elements: OsmElement[] = [];
  private nextNode = 1;
  private nextWay = 100;

  /** Adds a node at x metres east and n metres north; returns its id. */
  node(x: number, n: number, tags?: Record<string, string>): number {
    const id = this.nextNode++;
    this.elements.push({ type: 'node', id, lat: n, lon: x, ...(tags ? { tags } : {}) });
    return id;
  }

  /** Adds a way through existing node ids or new [x, north] points; returns the way id. */
  way(points: (number | [number, number])[], tags: Record<string, string>): number {
    const id = this.nextWay++;
    const nodes = points.map((p) => (typeof p === 'number' ? p : this.node(p[0], p[1])));
    this.elements.push({ type: 'way', id, nodes, tags });
    return id;
  }

  /** A closed building ring from [x, north] corners. */
  building(corners: [number, number][], tags: Record<string, string> = {}): number {
    const ids = corners.map((c) => this.node(c[0], c[1]));
    return this.way([...ids, ids[0] as number], { building: 'yes', ...tags });
  }

  map(): MapData {
    return buildMap(this.elements, flat);
  }

  /** The block graph of the sketch inside a square outline of half size h metres around 0. */
  graph(h = 500, overture: OvertureRow[] = []): BlockGraph {
    const outline: [number, number][] = [[-h, -h], [h, -h], [h, h], [-h, h], [-h, -h]];
    return buildBlockGraph({ block: 'test', stage: 'test', origin: { lat: 0, lon: 0 }, outline, elements: this.elements, overture, project: flat });
  }

  /** OSM tags of the sketch's nodes that have any, by graph node id. */
  nodeTags(): Map<string, Record<string, string>> {
    const out = new Map<string, Record<string, string>>();
    for (const e of this.elements) if (e.type === 'node' && e.tags) out.set(`n${e.id}`, e.tags);
    return out;
  }
}

/** The rule environment of the tests: flat metres, tile by 250 m, nothing else unless given. */
export function testEnv(extra: Partial<RuleEnv> = {}): RuleEnv {
  return { toGeo: (x, z) => ({ lat: -z, lon: x }), tile: (x, z) => [Math.floor(x / 250), Math.floor(z / 250)], ...extra };
}

/** A rule context on a graph (the production rules of tools/bake/rules/). */
export function rulesOn(g: BlockGraph, extra: Partial<RuleEnv> = {}, marks: Marks = {}): RuleContext {
  return new RuleContext(g, testEnv(extra), marks);
}

/**
 * The small tile of the cross-language fixture (harness/data/fixtures/tile_t1_sample.json): one road, one two-floor
 * building, sloping ground, placements on. Written by tools/fixtures/gen_tile_fixture.mjs, read by the GDScript
 * reader's test (game/tests/test_tiles.gd).
 */
export function sampleTile(): TileContent {
  const s = new Sketch();
  s.way([[10, -10], [240, -10]], { highway: 'primary' });
  s.building([[20, -40], [50, -40], [50, -70], [20, -70]], { 'building:levels': '2' });
  const map = s.map();
  return buildTile({ district: 'sample', tx: 0, tz: 0, size: 250, roads: map.roads, buildings: map.buildings, ground: (x) => 210.5 + x * 0.01, placements: true, groundCell: 62.5 });
}
