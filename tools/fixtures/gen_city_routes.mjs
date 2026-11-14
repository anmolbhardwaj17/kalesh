#!/usr/bin/env node
// Writes harness/data/fixtures/city_routes.json: the routes and check points of the city scenarios and the FD0 play
// script (P1-024), read from the lane graph of the baked pilot tiles (game/world/tiles/, tools/fixtures/lanegraph.mjs).
//   spawns   each pin of game/data/spawn_pins.json snapped the way the game snaps it (lanes.gd snap: the nearest point
//            on a lane at grade within 60 m whose direction is within 60 degrees of the pin's heading)
//   routes   drive routes that start at a pin's snapped point and follow `next` links (Dijkstra, gen_stream_routes rules):
//            fd0 (Janpath north into the Connaught Place inner circle, a quarter of it clockwise), cp_lap (one lap of the
//            inner circle), ito_flyover (the Ring Road flyover near ITO, northbound over the deck), chandni_main
//            (Netaji Subhash Marg north, then west along the lane south of Chandni Chowk to a gali's mouth), rajpath (the
//            road from the south-west into the India Gate hexagon); P2-042/P2-045 access drives chandni_bollards,
//            gali_scooter, gali_car; chandni_main_target (the route line's target on the car-free main road and the
//            nearest point an auto reaches); and one walk, chandni_gali (from the auto's stop up a two-wheeler gali to
//            Chandni Chowk main road over pieces a walker may use, never through bollards; a minus walks one backwards).
//            Since P2-045 every drive from a start pin keeps to roads its vehicle may use (the pins left car-free roads)
//   probeTiles  the tiles of the collider probe (city_collide_probe): the pilot sites a player sees first
// World metres [x, y, z] (east +X, north -Z). Rerun after a bake that changes game/world/tiles.hash, or after a pin
// moves:  node tools/fixtures/gen_city_routes.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoToWorld } from '../geo/projection.ts';
import { allows, readLaneGraph, nearest, nearestReachable, route, thin, lengthOf, walkRoute } from './lanegraph.mjs';

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

/** The first `m` metres of a polyline (in plan), the last point put on the line there. */
function cutAt(pts, m) {
  const out = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]; const b = pts[i];
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (acc + L >= m) { const f = (m - acc) / L; out.push(a.map((v, j) => Math.round((v + (b[j] - v) * f) * 1000) / 1000)); return out; }
    out.push(b);
    acc += L;
  }
  return out;
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
  // Chandni Chowk (P2-045: the main road is car-free in the day, so the auto keeps off it): Netaji Subhash Marg
  // northbound, left into the residential lane south of Chandni Chowk, west to the mouth of a two-wheeler gali
  chandni_main: drive('chandni_chowk_east', [[1158, -4166]], { mode: 'auto' }),
  // the road from the south-west into the India Gate hexagon, India Gate ahead (P2-045: Kartavya Path is closed to cars)
  rajpath: drive('rajpath_india_gate', [[424, 633]], { mode: 'auto' }),
  // P2-042: a car turns from Netaji Subhash Marg into the Red Fort end of Chandni Chowk, into its bollards (on purpose)
  chandni_bollards: drive('chandni_bollards_nsm', [[1290, -4308.3]], { violation: 'a car drives into the bollards at the Red Fort end of Chandni Chowk: the access scenario checks that they stop it', trim: false }),
  // P2-042: a scooter rides from a residential lane open to cars into a gali that only two-wheelers and walkers may use
  gali_scooter: drive('gali_scooter_entry', [[660, -4399.8]], { mode: 'two_wheeler' }),
};
// P2-045: a car takes the scooter's way into the same gali (a violation: no bollards stand there) and stops 25 m in
{
  const sc = routes.gali_scooter;
  const s = spawns.gali_car_entry._s;
  const leg = route(pieces, s.id, nearest(pieces, 660, -4399.8, { mode: 'two_wheeler' }).id, { mode: 'two_wheeler' });
  const entryId = leg.find((id) => !allows(pieces.get(id), 'car'));
  if (!entryId) throw new Error('gali_car: the scooter way never enters a piece closed to cars');
  const entry = pieces.get(entryId).pts[0];
  // the distance along the drive to the entry: the nearest point of the polyline
  let run = 0;
  let entryM = 0;
  let best = Infinity;
  for (let i = 1; i < sc.points.length; i++) {
    const a = sc.points[i - 1]; const b = sc.points[i];
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1e-9;
    const t = Math.max(0, Math.min(1, ((entry[0] - a[0]) * (b[0] - a[0]) + (entry[2] - a[2]) * (b[2] - a[2])) / (L * L)));
    const d = Math.hypot(a[0] + (b[0] - a[0]) * t - entry[0], a[2] + (b[2] - a[2]) * t - entry[2]);
    if (d < best) { best = d; entryM = run + L * t; }
    run += L;
  }
  const pts = cutAt(sc.points, entryM + 25);
  routes.gali_car = {
    from: 'gali_car_entry', violation: 'a car drives into a gali closed to cars where no bollards stand: the access scenario checks for one access_violation',
    lengthM: Math.round(lengthOf(pts)), entryM: Math.round(entryM * 10) / 10, entry: r3(entry), entryPiece: entryId, entryModes: pieces.get(entryId).modes, points: pts,
  };
}
// P2-045: the route line's target on Chandni Chowk main road (car-free in the day) and the nearest point an auto from
// the chandni_chowk_east pin may reach (what the auto's route must end at)
{
  const ccAt = [1100, -4316];
  let at = null;
  const onSeg = (p, x, z) => {
    let b = null;
    for (let i = 1; i < p.pts.length; i++) {
      const a = p.pts[i - 1]; const c = p.pts[i];
      const L2 = (c[0] - a[0]) ** 2 + (c[2] - a[2]) ** 2;
      if (L2 < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * (c[0] - a[0]) + (z - a[2]) * (c[2] - a[2])) / L2));
      const q = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t];
      const d = Math.hypot(q[0] - x, q[2] - z);
      if (!b || d < b.d) b = { d, q };
    }
    return b;
  };
  for (const p of pieces.values()) {
    if (p.kind !== 'lane' || p.layer !== 0) continue;
    const b = onSeg(p, ccAt[0], ccAt[1]);
    if (b && (!at || b.d < at.d)) at = { ...b, id: p.id, modes: p.modes };
  }
  if (!at || at.modes.includes('auto')) throw new Error(`chandni_main_target: the lane nearest ${ccAt} is open to autos (${at && at.modes})`);
  const start = spawns.chandni_chowk_east._s.id;
  const cands = [];
  for (const p of pieces.values()) {
    if (p.kind !== 'lane' || !allows(p, 'auto')) continue;
    const b = onSeg(p, at.q[0], at.q[2]);
    if (b && b.d < 300) cands.push({ id: p.id, d: b.d });
  }
  cands.sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1));
  const reach = cands.find((c) => c.id === start || route(pieces, start, c.id, { mode: 'auto' }));
  if (!reach) throw new Error('chandni_main_target: no auto-reachable lane within 300 m');
  routes.chandni_main_target = { at: r3(at.q), piece: at.id, modes: at.modes, nearestAutoM: Math.round(reach.d * 100) / 100, nearestAutoPiece: reach.id };
}
// the walk (P2-045): from where the auto stops, into the two-wheeler gali north to Chandni Chowk main road and 30 m along
// it, over pieces a walker may use and never through a line of bollards (a scripted walker does not thread the posts)
const crossesAny = (p) => BARRIERS.some((b) => p.pts.some((q, i) => i > 0 && crossesBarrier(p.pts[i - 1], q, b) !== null));
function footWalk(from, to) {
  const w = walkRoute(pieces, from, to, { skip: crossesAny });
  if (!w) throw new Error(`walk: no walker route from ${from} to ${to}`);
  if (w.startOffM > 6 || w.endOffM > 6) throw new Error(`walk: the walk starts ${w.startOffM.toFixed(1)} m and ends ${w.endOffM.toFixed(1)} m off its points`);
  return walk(w.refs);
}
const cm = routes.chandni_main.points;
const walks = { chandni_gali: footWalk([cm[cm.length - 1][0], cm[cm.length - 1][2]], [1128, -4314]) };
// the auto stops 12 m short of the gali's mouth, so the walk starts ahead of it
routes.chandni_main.points = cutAt(cm, lengthOf(cm) - 12);
routes.chandni_main.lengthM = Math.round(lengthOf(routes.chandni_main.points));
for (const [id, r] of Object.entries(routes)) if (r.points && !(r.lengthM > 50)) throw new Error(`route ${id} is only ${r.lengthM} m`);
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
// P2-045: the start pins of the base tests stand on roads an auto may use, and their drives keep to them
for (const id of ['chandni_main', 'rajpath']) if (routes[id].carFree > 0 || !routes[id].mode) throw new Error(`route ${id} uses ${routes[id].carFree} car-free pieces`);
if (!walks.chandni_gali.pieces.some((ref) => !allows(pieces.get(ref.replace(/^-/, '')), 'car'))) throw new Error('the chandni_gali walk never enters a car-free street');

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
for (const [id, r] of Object.entries(routes)) console.log(r.points ? `route ${id}: ${r.lengthM} m, ${r.points.length} points, layer up to ${r.maxLayer}, y ${(r.yRange || []).join(' to ')}` : `${id}: ${JSON.stringify(r)}`);
for (const [id, w] of Object.entries(walks)) console.log(`walk ${id}: ${w.lengthM} m, ${w.points.length} points, widths ${w.widths.join(', ')}`);
