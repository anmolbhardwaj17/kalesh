#!/usr/bin/env node
// Writes harness/data/fixtures/tile_t1_sample.json: a small T1 tile (tools/bake/tile.ts encodeT1 of
// tools/bake/testmap.ts sampleTile) as base64, with the counts and a few values the readers must find in it.
// The GDScript reader (game/bench/tiles/tile_t1.gd) is checked against this file in game/tests/test_tiles.gd, and
// tools/bake/tile.fixture.test.ts checks the file still matches the TypeScript encoder. Rerun after any change of
// the tile format:  node tools/fixtures/gen_tile_fixture.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sampleTile } from '../bake/testmap.ts';
import { encodeT1, tileStats } from '../bake/tile.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'harness', 'data', 'fixtures', 'tile_t1_sample.json');
const tile = sampleTile();
const bytes = encodeT1(tile);
const shells = tile.meshes.find((m) => m.name === 'buildings');
const out = {
  _doc: 'A small T1 tile (KTL1) as base64, written by tools/fixtures/gen_tile_fixture.mjs from tools/bake/testmap.ts sampleTile. expect holds what a reader must find. Do not edit by hand.',
  bytes: bytes.length,
  expect: {
    ...tileStats(tile), origin: tile.origin, meshes: tile.meshes.map((m) => ({ name: m.name, vertices: m.pos.length / 3, indices: m.idx.length })),
    buildingFirstVertex: shells.pos.slice(0, 3).map((v) => Math.fround(v)), buildingMaxY: Math.fround(Math.max(...shells.pos.filter((_, i) => i % 3 === 1))),
    firstPlacement: tile.placements[0].xforms.slice(0, 12).map((v) => Math.fround(v)),
  },
  base64: Buffer.from(bytes).toString('base64'),
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${path.relative(ROOT, OUT)} (${bytes.length} bytes of tile)`);
