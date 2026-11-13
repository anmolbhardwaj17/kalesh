#!/usr/bin/env node
// Writes harness/data/fixtures/stream_routes.json: scripted routes and staging points for the streaming scenarios
// (stream_200, stream_140, stream_memory, stream_teleport; P1-019). Read from the lane graph of the baked pilot tiles
// (game/world/tiles/, KTL1 header key `lanes`), so every point lies on a drawn lane at its height:
//   places   named places (harness/data/districts/places.json plus Chandni Chowk) snapped to the nearest lane at grade
//   routes   polylines along lanes: `across` (one way across the pilot centre, India Gate to the Red Fort side) and
//            `loop` (a closed lap: India Gate, Connaught Place and back)
// A route follows `next` links only (the way traffic drives), found with Dijkstra on piece length plus a turn cost and
// a cost for small roads, then thinned to 0.25 m. All positions are world metres (tile origin plus the tile-relative
// point; east +X, north -Z). Rerun after a bake that changes tiles.hash:  node tools/fixtures/gen_stream_routes.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoToWorld } from '../geo/projection.ts';
import { readLaneGraph, nearest as nearestIn, route as routeIn, polyline as polylineIn, lengthOf } from './lanegraph.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TILES = path.join(ROOT, 'game', 'world', 'tiles');
const OUT = path.join(ROOT, 'harness', 'data', 'fixtures', 'stream_routes.json');
// ---- the lane graph of every tile, in world metres (tools/fixtures/lanegraph.mjs)
const { index, pieces } = readLaneGraph(TILES);
const [offX, offZ] = index.offset;
const nearest = (x, z) => nearestIn(pieces, x, z);
const route = (a, b) => routeIn(pieces, a, b);
const polyline = (ids) => polylineIn(pieces, ids);

// ---- places
const placeList = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness', 'data', 'districts', 'places.json'), 'utf8')).places;
const WANT = ['india_gate', 'connaught_place', 'ito_crossing', 'red_fort', 'mandi_house', 'ndls_ajmeri_gate', 'pragati_maidan'];
const geo = Object.fromEntries(placeList.filter((p) => WANT.includes(p.id)).map((p) => [p.id, [p.lat, p.lon]]));
// Chandni Chowk is not in places.json (it is a street): its middle near Gurudwara Sis Ganj, read from the map by eye.
geo.chandni_chowk = [28.6561, 77.231];
const places = {};
for (const [id, [lat, lon]] of Object.entries(geo)) {
  const w = geoToWorld(lat, lon);
  const x = w.x + offX;
  const z = w.z + offZ;
  const n = nearest(x, z);
  if (!n) throw new Error(`no lane within 400 m of ${id} (${x.toFixed(0)}, ${z.toFixed(0)})`);
  places[id] = { lat, lon, world: [Math.round(x * 10) / 10, Math.round(z * 10) / 10], lane: n.id, at: n.at.map((v) => Math.round(v * 1000) / 1000), offM: Math.round(n.d * 10) / 10 };
}

// ---- routes
function leg(from, to) {
  const ids = route(places[from].lane, places[to].lane);
  if (!ids) throw new Error(`no lane route from ${from} to ${to}`);
  return ids;
}
const across = polyline([...leg('india_gate', 'ito_crossing'), ...leg('ito_crossing', 'red_fort').slice(1)]);
// the closed lap ends where it starts: the last leg stops before the first piece, and the first point closes it
const loopIds = [...leg('india_gate', 'connaught_place'), ...leg('connaught_place', 'india_gate').slice(1, -1)];
const loop = polyline(loopIds);
if (Math.hypot(loop[0][0] - loop[loop.length - 1][0], loop[0][2] - loop[loop.length - 1][2]) > 30) throw new Error('the loop does not close');
loop.push(loop[0]);
const out = {
  _doc: 'Scripted routes and staging points for the streaming scenarios (P1-019), written by tools/fixtures/gen_stream_routes.mjs from the lane graph of the baked pilot tiles. World metres [x, y, z] (east +X, north -Z), every point on a drawn lane at its height. places: named places snapped to the nearest lane at grade (`at`; `world` is the place itself, `offM` how far the lane is). routes.across: one way from India Gate to the Red Fort by the ITO crossing. routes.loop: a closed lap India Gate, Connaught Place and back, about 8.2 km: two laps in 5 minutes at 200 km/h (the last point is the first). Rerun the tool after a bake that changes game/world/tiles.hash.',
  bakeHash: index.bakeHash,
  places,
  routes: {
    across: { lengthM: Math.round(lengthOf(across)), points: across },
    loop: { lengthM: Math.round(lengthOf(loop)), closed: true, points: loop },
  },
};
fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
console.log(`stream routes: ${pieces.size} lane pieces; across ${out.routes.across.lengthM} m in ${across.length} points, loop ${out.routes.loop.lengthM} m in ${loop.length} points`);
for (const [id, p] of Object.entries(places)) console.log(`  ${id}: lane ${p.lane} ${p.offM} m from the place, at ${p.at.join(', ')}`);
