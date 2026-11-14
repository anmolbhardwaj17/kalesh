#!/usr/bin/env node
// Writes harness/data/fixtures/city_routes.json: the routes and check points of the city scenarios and the FD0 play
// script (P1-024), read from the lane graph of the baked pilot tiles (game/world/tiles/, tools/fixtures/lanegraph.mjs).
//   spawns   each pin of game/data/spawn_pins.json snapped the way the game snaps it (lanes.gd snap: the nearest point
//            on a lane at grade within 60 m whose direction is within 60 degrees of the pin's heading)
//   routes   drive routes that start at a pin's snapped point and follow `next` links (Dijkstra, gen_stream_routes rules):
//            fd0 (Janpath north into the Connaught Place inner circle, a quarter of it clockwise), cp_lap (one lap of the
//            inner circle), ito_flyover (the Ring Road flyover near ITO, northbound over the deck), chandni_main
//            (Chandni Chowk main road westbound), rajpath (Kartavya Path east toward India Gate); and one walk,
//            chandni_gali (a 3 m residential lane south off the main road, pieces taken whole; a minus walks one backwards)
//   probeTiles  the tiles of the collider probe (city_collide_probe): the pilot sites a player sees first
// World metres [x, y, z] (east +X, north -Z). Rerun after a bake that changes game/world/tiles.hash, or after a pin
// moves:  node tools/fixtures/gen_city_routes.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoToWorld } from '../geo/projection.ts';
import { allows, readLaneGraph, nearest, nearestReachable, route, thin, lengthOf } from './lanegraph.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TILES = path.join(ROOT, 'game', 'world', 'tiles');
const OUT = path.join(ROOT, 'harness', 'data', 'fixtures', 'city_routes.json');
const PINS = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'spawn_pins.json'), 'utf8'));
const { index, pieces } = readLaneGraph(TILES);
const [offX, offZ] = index.offset;
const r3 = (q) => q.map((v) => Math.round(v * 1000) / 1000);

/** lanes.gd snap: {id, i (segment start), at: [x, y, z], heading, d}. */
function snap(x, z, heading, reach = 60, maxTurn = Math.PI / 3) {
  let best = null;
  for (const p of pieces.values()) {
    if (p.layer !== 0 || p.kind !== 'lane' || p.pts.length < 2) continue;
    for (let i = 0; i < p.pts.length - 1; i++) {
      const a = p.pts[i];
      const b = p.pts[i + 1];
      const abx = b[0] - a[0];
      const abz = b[2] - a[2];
      const L2 = abx * abx + abz * abz;
      if (L2 < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * abx + (z - a[2]) * abz) / L2));
      const qx = a[0] + abx * t;
      const qz = a[2] + abz * t;
      const d = Math.hypot(x - qx, z - qz);
      if (d >= (best ? best.d : reach)) continue;
      const h = Math.atan2(abx, -abz);
      let turn = h - heading;
      while (turn > Math.PI) turn -= 2 * Math.PI;
      while (turn < -Math.PI) turn += 2 * Math.PI;
      if (Math.abs(turn) > maxTurn) continue;
      best = { id: p.id, i, d, heading: h, at: [qx, a[1] + (b[1] - a[1]) * t, qz] };
    }
  }
  return best;
}

const spawns = {};
for (const [id, pin] of Object.entries(PINS.pins)) {
  const w = geoToWorld(pin.lat, pin.lon);
  const s = snap(w.x + offX, w.z + offZ, (pin.headingDeg * Math.PI) / 180);
  if (!s) throw new Error(`spawn pin ${id}: no lane within 60 m in its direction`);
  spawns[id] = { lane: s.id, at: r3(s.at), heading: Math.round(s.heading * 1e4) / 1e4, offM: Math.round(s.d * 100) / 100, _s: s };
}

// the bollard and gate lines of the bake (P2-042, access.json of the tile folder): a drive stops short of them
const BARRIERS = fs.existsSync(path.join(TILES, 'access.json')) ? JSON.parse(fs.readFileSync(path.join(TILES, 'access.json'), 'utf8')).barriers.filter((b) => b.stopsCar) : [];
/** Where segment p-q crosses barrier line b (across the road at b, half its width plus a metre each side): t on p-q or null. */
function crossesBarrier(p, q, b) {
  const nx = -b.dir[1];
  const nz = b.dir[0];
  const half = b.widthM / 2 + 1;
  const a = [b.x - nx * half, b.z - nz * half];
  const c = [b.x + nx * half, b.z + nz * half];
  const rx = q[0] - p[0]; const rz = q[2] - p[2];
  const sx = c[0] - a[0]; const sz = c[1] - a[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((a[0] - p[0]) * sz - (a[1] - p[2]) * sx) / den;
  const u = ((a[0] - p[0]) * rz - (a[1] - p[2]) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}
/** A route cut 8 m before the first car-stopping barrier line it would cross (a staged drive must not end in bollards). */
function trimAtBarriers(pts, label) {
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1]; const q = pts[i];
    const seg = Math.hypot(q[0] - p[0], q[2] - p[2]);
    for (const b of BARRIERS) {
      const t = crossesBarrier(p, q, b);
      if (t === null) continue;
      const stop = run + seg * t - 8;
      if (stop < 50) throw new Error(`${label}: a barrier line (${b.id}) lies ${Math.round(run + seg * t)} m along the drive`);
      const out = [pts[0]];
      let acc = 0;
      for (let k = 1; k < pts.length; k++) {
        const a = pts[k - 1]; const c = pts[k];
        const l = Math.hypot(c[0] - a[0], c[2] - a[2]);
        if (acc + l >= stop) {
          const f = (stop - acc) / l;
          out.push(a.map((v, j) => Math.round((v + (c[j] - v) * f) * 1000) / 1000));
          console.log(`${label}: stops ${Math.round(run + seg * t - stop)} m short of barrier line ${b.id} (${b.ref})`);
          return out;
        }
        out.push(c);
        acc += l;
      }
    }
    run += seg;
  }
  return pts;
}

/**
 * A drive from a pin's snapped point along `next` links to the lane nearest each target in turn. `mode` (P2-042): the
 * drive keeps to lanes that mode may use (a car never enters a car-free street); `violation` names a staged drive that
 * breaks the access rule on purpose (no mode filter; the reason is written into the route).
 */
function drive(pinId, targets, { close = false, mode = 'car', violation = null, trim = true } = {}) {
  const s = spawns[pinId]._s;
  const m = violation ? null : mode;
  let ids = [s.id];
  for (const [x, z] of targets) {
    const t = nearest(pieces, x, z, { mode: m });
    if (!t) throw new Error(`${pinId}: no lane near ${x}, ${z}`);
    // (P1-046: a lane a taper adds next to the target may lie nearest and lead nowhere: then the nearest one the drive reaches)
    const leg = route(pieces, ids[ids.length - 1], t.id, { mode: m }) ?? nearestReachable(pieces, ids[ids.length - 1], x, z, { mode: m })?.leg;
    if (!leg) throw new Error(`${pinId}: no lane route to ${x}, ${z}`);
    ids = ids.concat(leg.slice(1));
  }
  if (m && !ids.every((id) => allows(pieces.get(id), m))) throw new Error(`${pinId}: the ${m} drive uses a lane ${m} may not use`);
  if (close) {
    const back = route(pieces, ids[ids.length - 1], s.id, { mode: m });
    if (!back) throw new Error(`${pinId}: the lap does not close`);
    ids = ids.concat(back.slice(1, -1));
  }
  const all = [s.at, ...pieces.get(ids[0]).pts.slice(s.i + 1)];
  for (const id of ids.slice(1)) for (const q of pieces.get(id).pts) {
    const last = all[all.length - 1];
    if (Math.hypot(q[0] - last[0], q[1] - last[1], q[2] - last[2]) > 0.05) all.push(q);
  }
  if (close) {
    // the lap runs on to its own start point
    for (const q of pieces.get(s.id).pts.slice(0, s.i + 1)) all.push(q);
    all.push(s.at);
  }
  const pts = trim ? trimAtBarriers(thin(all), pinId) : thin(all);
  const layers = ids.map((id) => pieces.get(id).layer);
  return {
    from: pinId, ...(m ? { mode: m } : { violation }), lengthM: Math.round(lengthOf(pts)), maxLayer: Math.max(...layers), yRange: [Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[1]))],
    carFree: ids.filter((id) => !allows(pieces.get(id), 'car')).length, points: pts,
  };
}

/** A walk along lane pieces taken whole, each forwards or backwards (`-id`), as one thinned polyline. */
function walk(list) {
  const all = [];
  for (const ref of list) {
    const back = ref.startsWith('-');
    const p = pieces.get(back ? ref.slice(1) : ref);
    if (!p) throw new Error(`walk: no lane piece ${ref}`);
    all.push(...(back ? [...p.pts].reverse() : p.pts));
  }
  const pts = thin(all, 0.1);
  return { lengthM: Math.round(lengthOf(pts)), pieces: list, widths: list.map((ref) => pieces.get(ref.replace(/^-/, '')).widthM), points: pts };
}

const routes = {
  // Janpath north from the auto stand (about 320 m), into the inner circle, clockwise to its west side
  fd0: drive('cp_auto_stand', [[-451, -1745]]),
  // one clockwise lap of the inner circle from its south side (by the north side and back)
  cp_lap: drive('cp_inner_circle', [[-331, -1860]], { close: true }),
  // the Ring Road flyover near ITO: up the south ramp, over the deck (layer 1, 7 m up) and down the north ramp
  ito_flyover: drive('ito_flyover_south', [[2311.8, -1560]]),
  // Chandni Chowk main road, westbound from its east end, past the mouth of the gali at x 1022. The main road is a
  // non-motorised zone in the day (P2-042): the base test's auto starts inside it, between the bollard lines
  chandni_main: drive('chandni_chowk_east', [[1006, -4321]], { violation: 'the auto starts on Chandni Chowk main road, car-free in the day (P2-042); no bollard line lies on this stretch' }),
  // Kartavya Path east toward the India Gate hexagon, on the promenade closed to cars (P2-042), short of its bollards
  rajpath: drive('rajpath_india_gate', [[400, 445.7]], { violation: 'the auto starts on the Kartavya Path promenade, closed to cars (P2-042); the drive stops short of the bollards at the hexagon' }),
  // P2-042: a car turns from Netaji Subhash Marg into the Red Fort end of Chandni Chowk, into its bollards (on purpose)
  chandni_bollards: drive('chandni_bollards_nsm', [[1290, -4308.3]], { violation: 'a car drives into the bollards at the Red Fort end of Chandni Chowk: the access scenario checks that they stop it', trim: false }),
  // P2-042: a scooter rides from a residential lane open to cars into a gali that only two-wheelers and walkers may use
  gali_scooter: drive('gali_scooter_entry', [[660, -4399.8]], { mode: 'two_wheeler' }),
};
/**
 * The lane pieces a walk takes, found by place (P1-045): strip ids are numbered across the whole bake, so a map change
 * elsewhere renumbers them. The walk starts on a gali lane (at grade, 3.5 m wide or less) within 4 m of `from` and
 * ends on one within 4 m of `to`, following `next` links (one direction of the gali, the way its pieces join).
 */
function piecesAlong(from, to) {
  const gali = (p) => p.layer === 0 && p.kind === 'lane' && p.widthM <= 3.5 && p.pts.length > 1;
  const within = ([x, z]) => [...pieces.values()].filter((p) => gali(p) && p.pts.some((q, i) => {
    const b = p.pts[i + 1];
    if (!b) return false;
    const abx = b[0] - q[0]; const abz = b[2] - q[2]; const L2 = abx * abx + abz * abz || 1;
    const t = Math.max(0, Math.min(1, ((x - q[0]) * abx + (z - q[2]) * abz) / L2));
    return Math.hypot(x - (q[0] + abx * t), z - (q[2] + abz * t)) <= 4;
  }));
  let best = null;
  for (const a of within(from)) for (const b of within(to)) {
    const ids = a.id === b.id ? [a.id] : route(pieces, a.id, b.id);
    if (!ids) continue;
    const len = ids.reduce((m, id) => m + pieces.get(id).len, 0);
    if (!best || len < best.len) best = { ids, len };
  }
  if (!best) throw new Error(`walk: no gali lane route from ${from} to ${to}`);
  return best.ids;
}
// a gali walk south off the main road (3 m residential lanes between dense building shells, about 140 m)
const walks = { chandni_gali: walk(piecesAlong([1023.7, -4313], [1009.2, -4168.7])) };
for (const [id, r] of Object.entries(routes)) if (!(r.lengthM > 50)) throw new Error(`route ${id} is only ${r.lengthM} m`);
// the access scenario (P2-042): the bollard line the car route crosses, and the gali the scooter route ends in
{
  const r = routes.chandni_bollards;
  let run = 0;
  for (let i = 1; i < r.points.length && !r.bollards; i++) {
    const p = r.points[i - 1]; const q = r.points[i];
    const seg = Math.hypot(q[0] - p[0], q[2] - p[2]);
    for (const b of BARRIERS) {
      const t = crossesBarrier(p, q, b);
      if (t !== null) {
        r.bollards = { id: b.id, ref: b.ref, x: b.x, z: b.z, dir: b.dir, widthM: b.widthM, maxGapM: b.maxGapM, atM: Math.round((run + seg * t) * 100) / 100 };
        break;
      }
    }
    run += seg;
  }
  if (!r.bollards || r.bollards.ref !== 'chandni_chowk_main_nmv') throw new Error('the chandni_bollards route crosses no Chandni Chowk bollard line');
  if (routes.gali_scooter.carFree < 1) throw new Error('the gali_scooter route never enters a gali closed to cars');
}
if (routes.ito_flyover.maxLayer < 1) throw new Error('the ITO route does not use the flyover deck');

const out = {
  _doc: 'Routes of the city scenarios and the FD0 play script (P1-024), written by tools/fixtures/gen_city_routes.mjs from the lane graph of the baked pilot tiles and game/data/spawn_pins.json. World metres [x, y, z] (east +X, north -Z), every point on a drawn lane at its height. spawns: each pin snapped as the game snaps it (lanes.gd snap). routes: drives from a pin along the lanes the way traffic goes (lengthM, maxLayer 1 = on a deck, yRange). walks: lanes walked whole (a minus walks a piece backwards). probeTiles: the tiles of city_collide_probe. Rerun the tool after a bake that changes game/world/tiles.hash or a pin move.',
  bakeHash: index.bakeHash,
  spawns: Object.fromEntries(Object.entries(spawns).map(([k, v]) => [k, { lane: v.lane, at: v.at, heading: v.heading, offM: v.offM }])),
  routes,
  walks,
  probeTiles: ['-2_-7', '-1_-7', '-2_-6', '7_-5', '9_-5', '3_-18', '4_-18', '2_1', '4_-15', '0_-12'],
};
for (const id of out.probeTiles) if (!index.tiles.some((t) => t.id === id)) throw new Error(`probe tile ${id} is not in the bake`);
fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
for (const [id, s] of Object.entries(out.spawns)) console.log(`spawn ${id}: lane ${s.lane}, ${s.offM} m off, at ${s.at.join(', ')}, heading ${s.heading}`);
for (const [id, r] of Object.entries(routes)) console.log(`route ${id}: ${r.lengthM} m, ${r.points.length} points, layer up to ${r.maxLayer}, y ${r.yRange.join(' to ')}`);
for (const [id, w] of Object.entries(walks)) console.log(`walk ${id}: ${w.lengthM} m, ${w.points.length} points, widths ${w.widths.join(', ')}`);
