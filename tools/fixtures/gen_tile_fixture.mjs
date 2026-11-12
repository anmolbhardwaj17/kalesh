#!/usr/bin/env node
// Writes harness/data/fixtures/tile_t1_sample.json: a small production T1 tile (tools/bake/tile/sample.ts, written by
// the bake's own tile writer tools/bake/tile/write.ts) as base64, with the counts and a few values the readers must
// find in it. The GDScript reader (game/bench/tiles/tile_t1.gd) is checked against this file in
// game/tests/test_tiles.gd, and tools/bake/tile/fixture.test.ts checks the file still matches the TypeScript writer.
// Rerun after any change of the tile format or the writer:  node tools/fixtures/gen_tile_fixture.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeContent } from '../bake/tile/codec.ts';
import { sampleProductionTile } from '../bake/tile/sample.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'harness', 'data', 'fixtures', 'tile_t1_sample.json');
const { bytes, record } = sampleProductionTile();
const tile = decodeContent(bytes);
const shells = tile.meshes.find((m) => m.name === 'building');
const road = tile.meshes.find((m) => m.name === 'road');
const out = {
  _doc: 'A small production T1 tile (KTL1) as base64, written by tools/fixtures/gen_tile_fixture.mjs from tools/bake/tile/sample.ts through the bake tile writer. expect holds what a reader must find. Do not edit by hand.',
  bytes: bytes.length,
  expect: {
    triangles: record.triangles, colliderTriangles: record.colliderTriangles, colliderChunks: record.chunks, placements: 0, lanes: record.lanes, pins: record.pins,
    origin: tile.origin, margin: tile.margin, size: tile.size,
    meshes: tile.meshes.map((m) => ({ name: m.name, material: m.material, vertices: m.pos.length / 3, indices: m.idx.length, uv: m.uv !== undefined })),
    buildingFirstVertex: shells.pos.slice(0, 3), buildingMaxY: Math.max(...shells.pos.filter((_, i) => i % 3 === 1)),
    roadFirstUv: road.uv.slice(0, 2), roadFirstUv2: road.uv2.slice(0, 2),
    firstLane: { id: tile.lanes[0].id, next: tile.lanes[0].next, points: tile.lanes[0].pts.length / 3, first: tile.lanes[0].pts.slice(0, 3) },
    firstPin: tile.pins[0],
  },
  base64: Buffer.from(bytes).toString('base64'),
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${path.relative(ROOT, OUT)} (${bytes.length} bytes of tile)`);
