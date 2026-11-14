#!/usr/bin/env node
// Writes the metro forecourt circles of harness/data/access.json "zones" (P2-043) from the OSM extract of the pilot:
// every subway entrance node (railway=subway_entrance) and every subway station node (station=subway) is the centre of
// a circle. A road of minor class that lies inside one circle is a forecourt (foot only, rules "metro_forecourt_*").
//   node tools/bake/graph/gen_access_zones.mjs [data/pilot_centre/osm.json]
// The Lutyens government zone ring is drawn by hand in the same file and kept as it is.
import fs from 'node:fs';
import path from 'node:path';
import { readAccessFile, writeAccessFile } from './accessfile.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const osmFile = path.resolve(ROOT, process.argv[2] ?? 'data/pilot_centre/osm.json');
const accessFile = path.join(ROOT, 'harness', 'data', 'access.json');
const ENTRANCE_R = 22;
const STATION_R = 32;

const osm = JSON.parse(fs.readFileSync(osmFile, 'utf8'));
const circles = [];
const seen = new Set();
for (const e of osm.elements) {
  if (e.type !== 'node' || e.tags === undefined) continue;
  const t = e.tags;
  const entrance = t['railway'] === 'subway_entrance';
  const station = t['station'] === 'subway' && (t['railway'] === 'station' || t['public_transport'] === 'station');
  if (!entrance && !station) continue;
  const key = `${e.lat.toFixed(5)},${e.lon.toFixed(5)}`;
  if (seen.has(key)) continue;
  seen.add(key);
  circles.push({ name: t['name'] ?? (entrance ? 'Metro entrance' : 'Metro station'), lat: Math.round(e.lat * 1e7) / 1e7, lon: Math.round(e.lon * 1e7) / 1e7, radiusM: entrance ? ENTRANCE_R : STATION_R, osm: `node/${e.id}` });
}
circles.sort((a, b) => a.lat - b.lat || a.lon - b.lon);
const file = readAccessFile(accessFile);
file.zones = file.zones ?? [];
const zone = {
  id: 'metro_forecourts',
  why: `Delhi Metro station forecourts: ${circles.length} circles of ${ENTRANCE_R} m around a subway entrance and ${STATION_R} m around a subway station node of the OSM extract. The road in front of an entrance is for walkers.`,
  refs: ['OpenStreetMap railway=subway_entrance and station=subway nodes of the pilot extract (data/pilot_centre/osm.json)', 'DMRC station forecourts are pedestrian plazas with a service drive at some stations (references in harness/data/access.json rules metro_forecourt_*)'],
  circles,
};
const at = file.zones.findIndex((z) => z.id === zone.id);
if (at >= 0) file.zones[at] = zone;
else file.zones.unshift(zone);
writeAccessFile(accessFile, file);
console.log(`metro_forecourts: ${circles.length} circles`);
