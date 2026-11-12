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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TILES = path.join(ROOT, 'game', 'world', 'tiles');
const OUT = path.join(ROOT, 'harness', 'data', 'fixtures', 'stream_routes.json');
const index = JSON.parse(fs.readFileSync(path.join(TILES, 'index.json'), 'utf8'));
const [offX, offZ] = index.offset;

// ---- the lane graph of every tile, in world metres
const pieces = new Map();
for (const rec of index.tiles) {
  const buf = fs.readFileSync(path.join(TILES, rec.file));
  const headLen = buf.readUInt32LE(8);
  const header = JSON.parse(buf.subarray(12, 12 + headLen).toString('latin1'));
  const lanes = header.lanes;
  if (!lanes || !Array.isArray(lanes.list)) continue;
  const base = 12 + headLen + lanes.pts;
  const [ox, oy, oz] = header.origin;
  for (const l of lanes.list) {
    const pts = [];
    for (let i = 0; i < l.count; i++) {
      const at = base + (l.start + i) * 12;
      pts.push([ox + buf.readFloatLE(at), oy + buf.readFloatLE(at + 4), oz + buf.readFloatLE(at + 8)]);
    }
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]);
    pieces.set(l.id, { id: l.id, cls: l.cls || '', kind: l.kind || '', layer: l.layer || 0, next: l.next || [], pts, len });
  }
}

const SMALL = { service: 4, residential: 2.5, living_street: 4, unclassified: 2, tertiary: 1.4, pedestrian: 6, track: 6 };
const dirOf = (a, b) => { const d = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1; return [(b[0] - a[0]) / d, (b[2] - a[2]) / d]; };
const endDir = (p) => dirOf(p.pts[Math.max(0, p.pts.length - 2)], p.pts[p.pts.length - 1]);
const startDir = (p) => dirOf(p.pts[0], p.pts[Math.min(1, p.pts.length - 1)]);

/** The lane piece at grade nearest to a world point: {id, d, at: [x, y, z]}. */
function nearest(x, z, { maxM = 400, minLen = 8 } = {}) {
  let best = null;
  for (const p of pieces.values()) {
    if (p.layer !== 0 || p.kind !== 'lane' || p.len < minLen || (SMALL[p.cls] || 1) > 2.5) continue;
    for (const q of p.pts) {
      const d = Math.hypot(q[0] - x, q[2] - z);
      if (d < maxM && (!best || d < best.d)) best = { id: p.id, d, at: q };
    }
  }
  return best;
}

/** Dijkstra over `next` links from piece a to piece b. Returns the piece ids, or null. */
function route(a, b) {
  const dist = new Map([[a, 0]]);
  const prev = new Map();
  const open = [[0, a]];
  const done = new Set();
  while (open.length) {
    let k = 0;
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[k][0]) k = i;
    const [d, id] = open.splice(k, 1)[0];
    if (done.has(id)) continue;
    done.add(id);
    if (id === b) break;
    const p = pieces.get(id);
    for (const n of p.next) {
      const q = pieces.get(n);
      if (!q || done.has(n)) continue;
      const e = endDir(p);
      const s = startDir(q);
      const turn = 1 - (e[0] * s[0] + e[1] * s[1]);
      const nd = d + q.len * (SMALL[q.cls] || 1) + turn * 60;
      if (nd < (dist.get(n) ?? Infinity)) { dist.set(n, nd); prev.set(n, id); open.push([nd, n]); }
    }
  }
  if (!done.has(b)) return null;
  const ids = [b];
  while (ids[0] !== a) ids.unshift(prev.get(ids[0]));
  return ids;
}

/** The points of a chain of pieces, thinned: a point stays when it is over `tol` off the line of its neighbours. */
function polyline(ids, tol = 0.25) {
  const all = [];
  for (const id of ids) for (const q of pieces.get(id).pts) {
    const last = all[all.length - 1];
    if (!last || Math.hypot(q[0] - last[0], q[1] - last[1], q[2] - last[2]) > 0.05) all.push(q);
  }
  const keep = [all[0]];
  for (let i = 1; i < all.length - 1; i++) {
    const a = keep[keep.length - 1];
    const b = all[i + 1];
    const q = all[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * (b[0] - a[0]) + (q[1] - a[1]) * (b[1] - a[1]) + (q[2] - a[2]) * (b[2] - a[2])) / (L * L)));
    const off = Math.hypot(q[0] - (a[0] + t * (b[0] - a[0])), q[1] - (a[1] + t * (b[1] - a[1])), q[2] - (a[2] + t * (b[2] - a[2])));
    if (off > tol || L > 60) keep.push(q);
  }
  keep.push(all[all.length - 1]);
  return keep.map((q) => q.map((v) => Math.round(v * 1000) / 1000));
}

const lengthOf = (pts) => pts.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - pts[i][0], q[2] - pts[i][2]), 0);

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
