#!/usr/bin/env node
// Writes harness/data/fixtures/city_paths.json: the four fixed vehicle paths of the city perf scenarios (P1-026), read from the
// lane graph of the baked pilot tiles (game/world/tiles/, tools/fixtures/lanegraph.mjs). Each path follows the lanes from a
// start point to an end point, then comes back the same way, so it is a closed loop (`loop: true`, the last point is the
// first): the scripted drive (`stream('path')`) never ends while a perf window with the GPU ballast runs (about 40 s).
//   cp_radial     Janpath north into the Connaught Place inner circle and round a quarter of it
//   ito_flyover   the Ring Road south of ITO, up the ramp, over the deck and down the north ramp
//   chandni_main  Chandni Chowk main road, west from the Red Fort end
//   india_gate    Kartavya Path east into the India Gate hexagon and a quarter of the way round it
// World metres [x, y, z] (east +X, north -Z). Rerun after a bake that changes game/world/tiles.hash:
//   node tools/fixtures/gen_city_paths.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLaneGraph, route, polyline, lengthOf } from './lanegraph.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { index, pieces } = readLaneGraph(path.join(ROOT, 'game', 'world', 'tiles'));

/** The lane at grade nearest to a point whose direction there is within 60 degrees of `heading` (radians, compass: 0 north). */
function snap(x, z, heading, reach = 60) {
  let best = null;
  for (const p of pieces.values()) {
    if (p.kind !== 'lane' || p.len < 8) continue;
    for (let i = 0; i < p.pts.length - 1; i++) {
      const a = p.pts[i]; const b = p.pts[i + 1];
      const abx = b[0] - a[0]; const abz = b[2] - a[2];
      const L2 = abx * abx + abz * abz;
      if (L2 < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * abx + (z - a[2]) * abz) / L2));
      const d = Math.hypot(x - (a[0] + abx * t), z - (a[2] + abz * t));
      if (d >= (best ? best.d : reach)) continue;
      let turn = Math.atan2(abx, -abz) - heading;
      while (turn > Math.PI) turn -= 2 * Math.PI;
      while (turn < -Math.PI) turn += 2 * Math.PI;
      if (Math.abs(turn) > Math.PI / 3) continue;
      best = { id: p.id, d };
    }
  }
  return best;
}

/** One way along the lanes (the way traffic goes) from the lane at `from` through the lane at each of `via`: [x, z, heading]. */
function oneWay(from, via) {
  const a = snap(...from);
  if (!a) throw new Error(`no lane at ${from}`);
  let ids = [a.id];
  for (const q of via) {
    const t = snap(...q);
    if (!t) throw new Error(`no lane at ${q}`);
    const leg = route(pieces, ids[ids.length - 1], t.id);
    if (!leg) throw new Error(`no lane route to ${q} from ${ids[ids.length - 1]}`);
    ids = ids.concat(leg.slice(1));
  }
  return { ids, pts: polyline(pieces, ids) };
}

const N = 0; const E = Math.PI / 2; const W = -Math.PI / 2;
const SPECS = {
  cp_radial: { name: 'Janpath north into the Connaught Place circle', from: [-357, -800, N], via: [[-451, -1745, N]] },
  ito_flyover: { name: 'the Ring Road over the ITO flyover', from: [2380, -500, N], via: [[2311.8, -1560, N]] },
  chandni_main: { name: 'Chandni Chowk main road westbound', from: [1345, -4292, W], via: [[762, -4335, W]] },
  india_gate: { name: 'Kartavya Path east into the India Gate hexagon', from: [40, 436, E], via: [[461, 454, E], [658, 169, E]] },
};

const paths = {};
for (const [id, s] of Object.entries(SPECS)) {
  const { ids, pts } = oneWay(s.from, s.via);
  const back = [...pts].reverse().slice(1);
  const loop = [...pts, ...back, pts[0]];
  paths[id] = {
    name: s.name, oneWayM: Math.round(lengthOf(pts)), lengthM: Math.round(lengthOf(loop)), pieces: ids.length,
    maxLayer: Math.max(...ids.map((i) => pieces.get(i).layer)), yRange: [Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[1]))].map((v) => Math.round(v * 10) / 10),
    points: loop,
  };
  console.log(`path ${id}: ${paths[id].oneWayM} m one way, ${loop.length} points, layer up to ${paths[id].maxLayer}, y ${paths[id].yRange.join(' to ')}`);
}
const out = {
  _doc: 'Fixed vehicle paths of the city perf scenarios city_path_* (P1-026), written by tools/fixtures/gen_city_paths.mjs from the lane graph of the baked pilot tiles. Each is one way along the lanes and back the same way, a closed loop (the last point is the first) for stream(path, {loop: true}). World metres [x, y, z] (east +X, north -Z). Rerun the tool after a bake that changes game/world/tiles.hash.',
  bakeHash: index.bakeHash,
  paths,
};
fs.writeFileSync(path.join(ROOT, 'harness', 'data', 'fixtures', 'city_paths.json'), JSON.stringify(out) + '\n');
