#!/usr/bin/env node
// P1-046: the India Gate hexagon (C-Hexagon) as one ring of even width. Esri World Imagery shows the ring with the same
// carriageway all round (on the west side about 22 m of asphalt between Kartavya Path and Ashoka Road); OSM tags 5 lanes
// on most of its ways and leaves the west and north pieces untagged (the repair took 4 from the road ahead) and tags 4
// on two short ways. Writes one set_lanes patch per such edge (5 lanes) into harness/data/overrides/, by builder, with
// the picture as its reference. Run once; a second run replaces the same patches (mergePatch by issue).
//   node tools/fixtures/hexagon_lanes.mjs
import fs from 'node:fs';
import path from 'node:path';
import { worldToGeo } from '../geo/projection.ts';
import { mergePatch, overrideFileName, worldTile } from '../inspector/lib.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const graph = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/pilot_centre/graph_repaired.json'), 'utf8'));
const layer = fs.readFileSync(path.join(ROOT, 'harness/reports/map/lanes.json'), 'utf8').slice(0, 2000);
const origin = { lat: Number(/"lat":([-\d.]+)/.exec(layer)[1]), lon: Number(/"lon":([-\d.]+)/.exec(layer)[1]) };
const off = /"offset":\[([-\d.]+),([-\d.]+)\]/.exec(layer);
const offset = [Number(off[1]), Number(off[2])];
const LANES = 5;
const REF = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=77.22627629489122,28.611630763624454,77.22913924700377,28.614157205659016&bboxSR=4326&imageSR=3857&size=1000,1000&format=jpg&f=image';
const ring = graph.edges.filter((e) => {
  if (!e.roundabout || e.road.cls !== 'secondary') return false;
  const m = e.pts[Math.floor(e.pts.length / 2)];
  const r = Math.hypot(m.x, m.z);
  return r > 150 && r < 460;
});
const byFile = new Map();
let n = 0;
for (const e of ring.sort((a, b) => (a.id < b.id ? -1 : 1))) {
  if (e.road.lanes === LANES) continue;
  const m = e.pts[Math.floor(e.pts.length / 2)];
  const geo = worldToGeo(m.x, m.z, origin);
  const tile = worldTile(m.x + offset[0], m.z + offset[1]);
  const file = path.join(ROOT, 'harness/data/overrides', overrideFileName(tile));
  const existing = byFile.get(file) ?? (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []);
  const patch = {
    issue: `lanes:${e.id}`, action: 'set_lanes',
    target: { ids: [e.id], anchor: { lat: Math.round(geo.lat * 1e7) / 1e7, lon: Math.round(geo.lon * 1e7) / 1e7 }, tolerance_m: 15 },
    params: { on: e.id, lanes: LANES, from: 'ahead' },
    why: `The India Gate hexagon is one ring of even width on Esri World Imagery (west side about 22 m of asphalt from Kartavya Path to Ashoka Road); OSM tags ${LANES} lanes on most of the ring, this piece had ${e.road.lanes} (${e.road.lanesFrom === 'tag' ? 'a tag' : 'taken from the road ahead'}): the ring keeps one cross section (P1-046)`,
    by: 'builder', source: 'satellite', date: '2026-11-13',
    reference: { link: REF, date: '2026-11-13', note: 'Esri World Imagery of the hexagon west side at Kartavya Path, about 0.28 m per pixel' },
  };
  byFile.set(file, mergePatch(existing, tile, patch).patches);
  n++;
  console.log(`${e.id}: ${e.road.lanes} -> ${LANES} lanes (${path.relative(ROOT, file)})`);
}
for (const [file, patches] of byFile) fs.writeFileSync(file, JSON.stringify(patches, null, 2) + '\n');
console.log(`${n} set_lanes patches`);
