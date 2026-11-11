#!/usr/bin/env node
// Draws the draft data of the stitch bench (P0-029): harness/data/districts.json and one clip polygon per district
// in harness/data/districts/<id>.geojson. Run it again only to redraw; the bench (harness/bench/stitch.mjs) reads
// the files, and a person may edit them by hand afterwards.
//
//   node harness/bench/stitch_draft.mjs            write the files
//   node harness/bench/stitch_draft.mjs --dry      print what would be written
//
// Placement: layout C of harness/design/map_sketches/make_sketches.mjs. The world origin is the centre of its map
// box; a district's layout anchor (the real point the sketch calls its centre) is put on the centre of its sketch
// box. Offsets are translations only.
// DC2 clip polygons are "hand-drawn along real edges" like this: a person picks waypoints at road junctions (the
// WAYPOINTS table below, read off a map of the pilot data), the script walks the real roads between them (so the
// line follows the map exactly), and the ring is then moved 35 m outwards, so the road it follows stays inside the
// district with both carriageways. A leg marked straight cuts across open ground (a park edge).
// Height offsets bring the median ground height along every clip ring to one level.
import path from 'node:path';
import sharp from 'sharp';
import { projector } from '../../tools/geo/projection.ts';
import { draftOffset } from '../../tools/bake/stitch/frames.ts';
import { offsetRing, ringAt, ringLength, simplify } from '../../tools/bake/stitch/clip.ts';
import { ringArea } from '../../tools/bake/geom.ts';
import { selfCrossing } from '../../tools/bake/roads/curve.ts';
import { ROOT, REPORTS, pilotAreas, writeJson, rel } from './pilot_data/lib.mjs';
import { loadArea } from './pilot_data/load.mjs';
import { groundSampler } from './roads.mjs';

const DATA = path.join(ROOT, 'harness', 'data');
const dry = process.argv.includes('--dry');
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Layout C (make_sketches.mjs): the map box in km and, per district, its sketch box and the real point at its centre. */
export const LAYOUT = { id: 'C', source: 'harness/design/map_sketches/make_sketches.mjs', boxKm: { x0: -0.4, x1: 9.7, y0: -2.2, y1: 6.7 }, river: { x: 6.95, width: 0.5, y1: 6.7, y2: -2.2, bend: 0.2 }, riverNote: 'the Yamuna of the layout C sketch in km (x east, y north): a band that bends by bend * sin over its length; a stand-in until the river district is drawn' };
const OUTSET = 35;

/**
 * The task names three districts: Connaught Place with India Gate, Chandni Chowk with Red Fort, and Laxmi Nagar.
 * In layout C Connaught Place (D01 with D02) and India Gate (D03) are two boxes with their own offsets, and the
 * pilot download has them as two extracts, so they are two frames here, both in the group "core".
 */
const DISTRICTS = [
  {
    id: 'cp', name: 'Connaught Place with Jantar Mantar', stage: 'pilot', group: 'core', area: 'cp', layoutId: 'D0102', layoutBoxKm: [3.1, 2.45, 1.2, 1.6], layoutAnchor: { lat: 28.6295, lon: 77.2167 },
    draft: { widthM: 1200, heightM: 1600 },
    edges: 'south: Tolstoy Marg (Jantar Mantar stays inside); west: Sansad Marg, then the Outer Circle; north: the Outer Circle; east: the Outer Circle and Kasturba Gandhi Marg',
    waypoints: [
      { at: [28.6263, 77.2192], name: 'Tolstoy Marg at Janpath' },
      { at: [28.627, 77.215], name: 'Tolstoy Marg at Sansad Marg' },
      { at: [28.6303, 77.2177], name: 'Sansad Marg at the Outer Circle' },
      { at: [28.6316, 77.2167], name: 'Outer Circle at Baba Kharak Singh Marg' },
      { at: [28.633, 77.2164], name: 'Outer Circle at Shaheed Bhagat Singh Marg' },
      { at: [28.6343, 77.2164], name: 'Outer Circle at Panchkuian Road' },
      { at: [28.6357, 77.2187], name: 'Outer Circle at Chelmsford Road' },
      { at: [28.6352, 77.2215], name: 'Outer Circle at Minto Road' },
      { at: [28.6312, 77.2229], name: 'Outer Circle at Barakhamba Road' },
      { at: [28.6303, 77.2218], name: 'Outer Circle at Kasturba Gandhi Marg' },
      { at: [28.6264, 77.2238], name: 'Kasturba Gandhi Marg at Tolstoy Marg' },
    ],
  },
  {
    id: 'india_gate', name: 'India Gate', stage: 'pilot', group: 'core', area: 'india_gate', layoutId: 'D03', layoutBoxKm: [3.15, 1.45, 2.2, 0.8], layoutAnchor: { lat: 28.6135, lon: 77.219 },
    // the sketch box runs west to Vijay Chowk; the pilot download covers its east end, so the draft rectangle is the part around the hexagon
    draft: { widthM: 1300, heightM: 800, centre: { lat: 28.6129, lon: 77.2285 } },
    edges: 'the C-Hexagon all round; west: Man Singh Road between Ashoka Road and Akbar Road',
    waypoints: [
      { at: [28.6163, 77.2249], name: 'Ashoka Road at Man Singh Road (rotary 4)' },
      { at: [28.6149, 77.2279], name: 'Ashoka Road at the C-Hexagon' },
      { at: [28.6162, 77.2313], name: 'C-Hexagon at Copernicus Marg' },
      { at: [28.6146, 77.2341], name: 'C-Hexagon at Purana Quila Road' },
      { at: [28.6108, 77.2343], name: 'C-Hexagon at Sher Shah Road' },
      { at: [28.6094, 77.231], name: 'C-Hexagon at Pandara Road' },
      { at: [28.6105, 77.2287], name: 'C-Hexagon at Akbar Road' },
      { at: [28.6099, 77.2245], name: 'Akbar Road at Man Singh Road' },
    ],
  },
  {
    id: 'chandni_chowk', name: 'Chandni Chowk with Red Fort', stage: 'pilot', group: 'old_delhi', area: 'chandni_chowk', layoutId: 'D09', layoutBoxKm: [4.9, 4.3, 1.6, 1.1], layoutAnchor: { lat: 28.653, lon: 77.235 },
    draft: { widthM: 1600, heightM: 1100 },
    edges: 'north: Shyama Prasad Mukherji Marg (the rail yard beyond); east: Mahatma Gandhi Marg (the Ring Road) behind the Red Fort; south: Nishadraj Marg, the park edge, Urdu Bazaar Road and Chawri Bazar; west: Lal Kuan Bazar and Church Mission Road',
    waypoints: [
      { at: [28.6603, 77.2232], name: 'Shyama Prasad Mukherji Marg at Church Mission Road' },
      { at: [28.6601, 77.233], name: 'Shyama Prasad Mukherji Marg' },
      { at: [28.66, 77.2365], name: 'Shyama Prasad Mukherji Marg at Netaji Subhash Marg' },
      { at: [28.6605, 77.2415], name: 'Mahatma Gandhi Marg north of the Red Fort' },
      { at: [28.656, 77.2449], name: 'Mahatma Gandhi Marg behind the Red Fort' },
      { at: [28.6503, 77.2447], name: 'Mahatma Gandhi Marg at Nishadraj Marg' },
      { at: [28.6497, 77.2385], name: 'Nishadraj Marg at Netaji Subhash Marg' },
      { at: [28.6497, 77.2362], name: 'Urdu Bazaar Road', straight: true },
      { at: [28.6502, 77.23], name: 'Chawri Bazar' },
      { at: [28.6492, 77.2265], name: 'Hauz Qazi Chowk' },
      { at: [28.6572, 77.2231], name: 'Khari Baoli Road at Church Mission Road' },
    ],
  },
  {
    id: 'laxmi_nagar', name: 'Laxmi Nagar', stage: 'release', group: 'east', area: 'laxmi_nagar', layoutId: 'D12', layoutBoxKm: [7.45, 2.7, 1.2, 1.0], layoutAnchor: { lat: 28.631, lon: 77.277 },
    draft: { widthM: 1200, heightM: 1000 },
    edges: 'west: Dadri Road (the interchange with the river bank road stays outside); south: Vikas Marg and Mother Dairy Road; north and east have no hard edge: the line follows residential streets of Shakarpur and Laxmi Nagar',
    waypoints: [
      { at: [28.6283, 77.2738], name: 'Vikas Marg at Dadri Road' },
      { at: [28.63, 77.2724], name: 'Dadri Road', minor: true },
      { at: [28.6338, 77.274], name: 'Shakarpur north west', minor: true },
      { at: [28.6348, 77.279], name: 'Shakarpur north', minor: true },
      { at: [28.6342, 77.2832], name: 'Vikas Marg north east', minor: true },
      { at: [28.6268, 77.2797], name: 'Mother Dairy Road', minor: true },
    ],
  },
];

const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);

/** Shortest path along the district's roads between two points (nearest road nodes). Returns points and the road names used. */
export function route(map, from, to, any, minor = false) {
  const adj = new Map();
  const link = (a, b, w, name) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ to: b, w, name });
  };
  for (const r of map.roads) {
    const major = MAJOR.has(r.cls);
    if (!any && !major) continue;
    // minor: every street counts the same, so the line takes the direct way through a quarter with no big roads
    const factor = minor ? (r.cls === 'service' ? 1.5 : 1) : r.cls === 'tertiary' ? 1.15 : major ? 1 : r.cls === 'service' ? 3 : 1.8;
    for (let i = 0; i + 1 < r.nodes.length; i++) {
      const a = map.nodes.get(r.nodes[i]);
      const b = map.nodes.get(r.nodes[i + 1]);
      const w = Math.hypot(a.x - b.x, a.z - b.z) * factor;
      link(a.id, b.id, w, r.name);
      link(b.id, a.id, w, r.name);
    }
  }
  const nearest = (p) => {
    let best = null;
    let bd = Infinity;
    for (const id of adj.keys()) {
      const n = map.nodes.get(id);
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return { id: best, d: bd };
  };
  const a = nearest(from);
  const b = nearest(to);
  if (a.d > 120 || b.d > 120) throw new Error(`no road node within 120 m of a waypoint (${round(a.d)} m, ${round(b.d)} m)`);
  const dist = new Map([[a.id, 0]]);
  const prev = new Map();
  const heap = [[0, a.id]];
  while (heap.length) {
    let k = 0;
    for (let i = 1; i < heap.length; i++) if (heap[i][0] < heap[k][0]) k = i;
    const [d, id] = heap.splice(k, 1)[0];
    if (id === b.id) break;
    if (d > (dist.get(id) ?? Infinity)) continue;
    for (const e of adj.get(id) || []) {
      const nd = d + e.w;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, { id, name: e.name });
        heap.push([nd, e.to]);
      }
    }
  }
  if (!dist.has(b.id)) throw new Error('no road path between two waypoints');
  const pts = [];
  const names = new Map();
  for (let id = b.id; id !== undefined; id = prev.get(id)?.id) {
    const n = map.nodes.get(id);
    pts.push({ x: n.x, z: n.z });
    const step = prev.get(id);
    if (step?.name) names.set(step.name, (names.get(step.name) || 0) + 1);
  }
  pts.reverse();
  return { pts, names: [...names.entries()].sort((p, q) => q[1] - p[1]).map(([n]) => n) };
}

const ROAD_COLOUR = { motorway: '#d0312d', trunk: '#d0312d', primary: '#e07b00', secondary: '#c9a000', tertiary: '#3a7' };

/** A north-up picture of one district: its roads, the waypoints, the walked line, the clip ring and the draft rectangle. */
async function preview(file, ctx, d, line, outer, proj) {
  const b = ctx.box;
  const pad = 120;
  const W = 1600;
  const sc = W / (b.maxX - b.minX + 2 * pad);
  const H = Math.round((b.maxZ - b.minZ + 2 * pad) * sc);
  const X = (x) => ((x - b.minX + pad) * sc).toFixed(1);
  const Z = (z) => ((z - b.minZ + pad) * sc).toFixed(1);
  const poly = (pts) => pts.map((p) => `${X(p.x)},${Z(p.z)}`).join(' ');
  const o = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="Helvetica, Arial, sans-serif"><rect width="100%" height="100%" fill="#f4f1ea"/>`];
  for (const g of ctx.map.open) o.push(`<polygon points="${poly(g.ring)}" fill="#cfe3c0"/>`);
  for (const f of ctx.map.buildings) o.push(`<polygon points="${poly(f.ring)}" fill="#d9cfc0"/>`);
  const order = ['service', 'pedestrian', 'living_street', 'residential', 'unclassified', 'road', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway'];
  for (const r of ctx.map.roads.slice().sort((p, q) => order.indexOf(p.cls) - order.indexOf(q.cls))) {
    o.push(`<polyline points="${poly(r.pts)}" fill="none" stroke="${ROAD_COLOUR[r.cls] || '#999'}" stroke-width="${ROAD_COLOUR[r.cls] ? (r.link ? 1.5 : 3) : 1}"/>`);
  }
  o.push(`<rect x="${X(b.minX)}" y="${Z(b.minZ)}" width="${(b.maxX - b.minX) * sc}" height="${(b.maxZ - b.minZ) * sc}" fill="none" stroke="#000" stroke-width="1.5" stroke-dasharray="10 5"/>`);
  const c = proj.toWorld((d.draft.centre || d.layoutAnchor).lat, (d.draft.centre || d.layoutAnchor).lon);
  o.push(`<rect x="${X(c.x - d.draft.widthM / 2)}" y="${Z(c.z - d.draft.heightM / 2)}" width="${d.draft.widthM * sc}" height="${d.draft.heightM * sc}" fill="none" stroke="#e0f" stroke-width="2" stroke-dasharray="6 4"/>`);
  o.push(`<polygon points="${poly(line)}" fill="none" stroke="#06c" stroke-width="1.5"/>`);
  o.push(`<polygon points="${poly(outer)}" fill="#06c" fill-opacity="0.08" stroke="#0033aa" stroke-width="3"/>`);
  d.waypoints.forEach((w, i) => {
    const p = proj.toWorld(w.at[0], w.at[1]);
    o.push(`<circle cx="${X(p.x)}" cy="${Z(p.z)}" r="6" fill="#fff" stroke="#c00" stroke-width="2"/><text x="${(+X(p.x) + 9).toFixed(1)}" y="${(+Z(p.z) + 4).toFixed(1)}" font-size="13" fill="#900" stroke="#fff" stroke-width="3" paint-order="stroke">${i + 1} ${w.name}</text>`);
  });
  o.push(`<rect width="100%" height="30" fill="#1d1f24"/><text x="10" y="21" font-size="16" fill="#fff">${d.name}: clip (blue, DC2), the walked line (thin blue), the draft rectangle (pink dashes, DC1), the download box (black dashes). North up.</text></svg>`);
  await sharp(Buffer.from(o.join('\n'))).png().toFile(file).catch(async () => {
    const fs = await import('node:fs');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await sharp(Buffer.from(o.join('\n'))).png().toFile(file);
  });
}

export async function draft() {
  const areas = pilotAreas();
  const out = { districts: [], clips: {} };
  const medians = [];
  const problems = [];
  for (const d of DISTRICTS) {
    const area = areas.find((a) => a.id === d.area);
    const ctx = loadArea(area);
    if (!ctx) throw new Error(`data/pilot/osm/${d.area}.json is missing: run node harness/bench/pilot_data/fetch.mjs first`);
    const origin = area.centre;
    const proj = projector(origin);
    const ring = [];
    const legs = [];
    d.waypoints.forEach((w, i) => {
      const next = d.waypoints[(i + 1) % d.waypoints.length];
      const a = proj.toWorld(w.at[0], w.at[1]);
      const b = proj.toWorld(next.at[0], next.at[1]);
      if (next.straight) {
        // across open ground: from where the last leg ended to the next waypoint's road node
        legs.push({ from: w.name, to: next.name, along: ['straight across open ground'] });
        if (ring.length === 0) ring.push(a);
        ring.push(b);
        return;
      }
      const minor = Boolean(w.minor || next.minor);
      const r = route(ctx.map, ring.length ? ring[ring.length - 1] : a, b, minor || Boolean(w.any || next.any), minor);
      legs.push({ from: w.name, to: next.name, along: r.names.slice(0, 4) });
      ring.push(...r.pts);
    });
    // drop repeated points, then the closing point
    let line = ring.filter((p, i) => i === 0 || Math.hypot(p.x - ring[i - 1].x, p.z - ring[i - 1].z) > 0.01);
    // a waypoint a little way down a side road makes the walk go out and come back: cut those spikes off
    for (let i = 1; i + 1 < line.length; ) {
      if (Math.hypot(line[i - 1].x - line[i + 1].x, line[i - 1].z - line[i + 1].z) < 1) {
        line.splice(i, 2);
        i = Math.max(1, i - 1);
      } else i++;
    }
    line = simplify([...line, line[0]], 3);
    line.pop();
    const outer = offsetRing(line, OUTSET, 5);
    const geo = outer.map((p) => {
      const g = proj.toGeo(p.x, p.z);
      return [round(g.lon, 7), round(g.lat, 7)];
    });
    geo.push(geo[0]);
    const insideBox = geo.every(([lon, lat]) => lat > area.bbox.south && lat < area.bbox.north && lon > area.bbox.west && lon < area.bbox.east);
    await preview(path.join(REPORTS, 'stitch', `clip_${d.id}.png`), ctx, d, line, outer, proj);
    if (selfCrossing(outer)) problems.push(`${d.id}: the clip ring crosses itself (see harness/reports/arch/stitch/clip_${d.id}.png)`);
    if (!insideBox) problems.push(`${d.id}: the clip polygon leaves the pilot download box (see harness/reports/arch/stitch/clip_${d.id}.png)`);
    // height: the median ground along the ring
    const ground = await groundSampler(ctx, { kind: 'box', ...ctx.box });
    const hs = [];
    const total = ringLength(outer);
    for (let s = 0; s < total; s += 25) {
      const p = ringAt(outer, s);
      hs.push(ground.at(p.x, p.z));
    }
    hs.sort((p, q) => p - q);
    const median = hs[Math.floor(hs.length / 2)];
    medians.push(median);
    const centre = d.draft.centre || d.layoutAnchor;
    out.districts.push({
      id: d.id, name: d.name, stage: d.stage, group: d.group, area: d.area, layoutId: d.layoutId, layoutBoxKm: d.layoutBoxKm, layoutAnchor: d.layoutAnchor,
      origin: { lat: origin.lat, lon: origin.lon },
      offset: (() => {
        const o = draftOffset(LAYOUT, d.layoutBoxKm, d.layoutAnchor, origin);
        return { x: round(o.x, 1), z: round(o.z, 1) };
      })(),
      heightOffset: 0,
      clip: `districts/${d.id}.geojson`,
      draftRect: { centre, widthM: d.draft.widthM, heightM: d.draft.heightM },
      _medianGround: median,
    });
    out.clips[d.id] = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {
          district: d.id, name: d.name, status: 'draft', option: 'DC2', edges: d.edges, areaKm2: round(Math.abs(ringArea(outer)) / 1e6, 3),
          drawn: `waypoints picked by hand at road junctions, the line walked along the real roads between them (OSM of ${ctx.osmBase || 'the pilot download'}), then moved ${OUTSET} m outwards so the edge road stays inside`,
          waypoints: d.waypoints.map((w) => ({ name: w.name, lat: w.at[0], lon: w.at[1], ...(w.straight ? { straight: true } : {}), ...(w.minor ? { minor: true } : {}) })),
          legs,
        },
        geometry: { type: 'Polygon', coordinates: [geo] },
      }],
    };
  }
  if (problems.length) throw new Error(problems.join('; '));
  // one level for all: the mean of the medians, rounded to a metre
  const level = Math.round(medians.reduce((s, v) => s + v, 0) / medians.length);
  for (const d of out.districts) {
    d.heightOffset = round(level - d._medianGround, 1);
    d.note = `median ground along the clip ring ${round(d._medianGround, 1)} m (GEDTM30 smoothed over 60 m); the offset brings it to ${level} m`;
    delete d._medianGround;
  }
  const file = {
    _doc: 'Draft district list of the composite map (P0-029 stitch bench; MAP_REPAIR.md "District frames and stitching"). world = offset + project(lat, lon, origin): a translation only, no rotation, scale or mirror, north is -Z. offset is the world position of the frame origin in metres (east +X, north -Z); heightOffset is added to every ground height of the district; clip is a GeoJSON polygon (WGS84) in harness/data/. Written by node harness/bench/stitch_draft.mjs from layout C; edit by hand after that. Not signed off.',
    status: 'draft',
    layout: { ...LAYOUT, worldOrigin: 'the centre of the layout map box', worldOriginKm: [round((LAYOUT.boxKm.x0 + LAYOUT.boxKm.x1) / 2, 3), round((LAYOUT.boxKm.y0 + LAYOUT.boxKm.y1) / 2, 3)] },
    x2Origin: { lat: 28.612894, lon: 77.229446, name: 'India Gate (the one origin of option X2)' },
    heightLevelM: level,
    districts: out.districts,
  };
  return { file, clips: out.clips };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const { file, clips } = await draft();
  for (const d of file.districts) console.log(`${d.id}: offset ${d.offset.x}, ${d.offset.z} m; height offset ${d.heightOffset} m; clip ${clips[d.id].features[0].properties.areaKm2} km2, ${clips[d.id].features[0].geometry.coordinates[0].length} points`);
  for (const [id, c] of Object.entries(clips)) for (const l of c.features[0].properties.legs) console.log(`  ${id}: ${l.from} -> ${l.to}: ${l.along.join(', ')}`);
  if (!dry) {
    writeJson(path.join(DATA, 'districts.json'), file);
    for (const [id, c] of Object.entries(clips)) writeJson(path.join(DATA, 'districts', `${id}.geojson`), c);
    console.log(`wrote ${rel(path.join(DATA, 'districts.json'))} and ${Object.keys(clips).length} clip polygons`);
  }
}
