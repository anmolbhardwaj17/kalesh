#!/usr/bin/env node
// Stitch bench driver (P0-029; ARCH_OPTIONS.md rows X, FP, DC, SC, FL, LP; MAP_REPAIR.md "District frames and
// stitching"). Puts the pilot districts of harness/data/districts.json into one world with the typed bake code of
// tools/bake/stitch/, on the data that P0-018 fetched (data/pilot/, pinned in data/SOURCES.json):
//
//   node harness/bench/stitch.mjs               bake, then the Godot scene (arch.mjs stitch) for the shots
//   node harness/bench/stitch.mjs --no-godot    bake and check only (tiles, plan pictures, stitch_bake.json)
//
// What it does: (1) frames: each district is projected around its own origin and moved by its offset (X1), and
// compared with one India Gate origin (X2); (2) clip: the draft rectangle (DC1) against the polygon along real
// edges (DC2), boundary ports by road class, and the edge band of shells (DC3) in tile bytes; (3) connectors: the
// three authored files of harness/data/connectors/ built by the lane model of tools/bake/roads/ (SC1), and one
// trial of a real road's shape shortened (SC2); (4) filler: every small port closed by a rule (FL1); (5) checks
// with counts; (6) 250 m tiles with vertices relative to the tile (FP1) in game/bench/stitch/gen/, camera poses,
// plan pictures in harness/reports/arch/stitch/ and every number in harness/reports/arch/stitch_bake.json. The
// Godot run (harness/bench/stitch.plan.mjs) folds that file into harness/reports/arch/stitch.json.
// Stand-in content: district roads are plain ribbons, buildings are extruded Overture footprints, the ground is one
// 12.5 m lattice (GEDTM30 smoothed over 60 m inside a district, blended between district edges outside).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { boxOf, boxesMeet, pointInRing, pointSegment, polylineLength, ringArea, segmentRing } from '../../tools/bake/geom.ts';
import { buildingHeight, encodeT1 } from '../../tools/bake/tile.ts';
import { smoothLine } from '../../tools/bake/roads/curve.ts';
import { forbiddenTransformKeys, frameDifference, placer, riverLine, transformCheck } from '../../tools/bake/stitch/frames.ts';
import { clipRoads, mergePorts, portsByClass, rectRing, ringAt, ringLength, ringProject, simplify } from '../../tools/bake/stitch/clip.ts';
import { CLOSE_DEFAULTS, closePorts, countClosures } from '../../tools/bake/stitch/ports.ts';
import { buildConnector, minRadius, radiusCheck, similarity, specProblems } from '../../tools/bake/stitch/connectors.ts';
import { Lattice, TILE, TileSet, bar, blendGround, prism, ribbon, riverDepth, verges } from '../../tools/bake/stitch/world.ts';
import { landmarkErrors, layoutChecks, pairCheck, pinCentres, pinName } from '../../tools/bake/stitch/checks.ts';
import { ROOT, REPORTS, pilotAreas, readJson, writeJson, rel } from './pilot_data/lib.mjs';
import { loadArea, overtureFootprints } from './pilot_data/load.mjs';
import { groundSampler } from './roads.mjs';

const args = process.argv.slice(2);
const GEN = path.join(ROOT, 'game', 'bench', 'stitch', 'gen');
const OUT = path.join(REPORTS, 'stitch');
const DATA = path.join(ROOT, 'harness', 'data');
const round = (v, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const BAND_M = 80;
const Y_BASE = 190;
const CELL = 12.5;
const RIVER = { depth: 3, bank: 45 };

/**
 * Landmarks whose position is checked (the first four are the ones the task names) and the pairs for the layout
 * check inside a district. Each is one OSM way of the pilot download; height is the stand-in block's height.
 */
const LANDMARKS = [
  { id: 'red_fort', name: 'Red Fort', district: 'chandni_chowk', osm: 'way/264863907', named: true, height: 12 },
  { id: 'jama_masjid', name: 'Jama Masjid', district: 'chandni_chowk', osm: 'way/265824669', named: true, height: 15 },
  { id: 'india_gate', name: 'India Gate', district: 'india_gate', osm: 'way/361709652', named: true, height: 42 },
  { id: 'cp_inner_circle', name: 'Connaught Place inner circle', district: 'cp', osm: 'way/23133486', named: true, height: 0 },
  { id: 'jantar_mantar', name: 'Jantar Mantar', district: 'cp', osm: 'way/223456559', named: false, height: 4 },
  { id: 'war_memorial', name: 'National War Memorial', district: 'india_gate', osm: 'way/839844477', named: false, height: 3 },
  { id: 'laxmi_nagar_metro', name: 'Laxmi Nagar Metro Station', district: 'laxmi_nagar', osm: 'way/700096133', named: false, height: 12 },
  { id: 'laxmi_nagar_hospital', name: 'Government Maternity Hospital, Laxmi Nagar', district: 'laxmi_nagar', osm: 'way/386327383', named: false, height: 12 },
];
const LAYOUT_PAIRS = [['jama_masjid', 'red_fort'], ['india_gate', 'war_memorial'], ['cp_inner_circle', 'jantar_mantar'], ['laxmi_nagar_metro', 'laxmi_nagar_hospital']];

const distToLine = (p, pts) => {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) best = Math.min(best, pointSegment(p, pts[i], pts[i + 1]).d);
  return best;
};
const lineAt = (pts, s) => {
  let left = Math.max(0, s);
  for (let i = 0; i + 1 < pts.length; i++) {
    const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
    if (left <= len || i + 2 === pts.length) {
      const t = len === 0 ? 0 : Math.min(1, left / len);
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, z: pts[i].z + (pts[i + 1].z - pts[i].z) * t, dx: (pts[i + 1].x - pts[i].x) / (len || 1), dz: (pts[i + 1].z - pts[i].z) / (len || 1) };
    }
    left -= len;
  }
  return { ...pts[pts.length - 1], dx: 1, dz: 0 };
};

/** Reads the districts file, the clip polygons and the pilot data of every district. Not part of the bake time. */
async function loadSources() {
  const t0 = Date.now();
  const file = readJson(path.join(DATA, 'districts.json'));
  if (!file) throw new Error('harness/data/districts.json is missing: run node harness/bench/stitch_draft.mjs');
  const areas = pilotAreas();
  const districts = [];
  for (const def of file.districts) {
    const area = areas.find((a) => a.id === def.area);
    const ctx = area && loadArea(area);
    if (!ctx) throw new Error(`data/pilot/osm/${def.area}.json is missing: run node harness/bench/pilot_data/fetch.mjs first`);
    // the map model is projected around the area centre: the district's frame origin must be that point
    if (Math.abs(area.centre.lat - def.origin.lat) > 1e-9 || Math.abs(area.centre.lon - def.origin.lon) > 1e-9) throw new Error(`${def.id}: the frame origin is not the centre of the pilot area ${def.area}`);
    const gj = readJson(path.join(DATA, def.clip));
    const coords = gj?.features?.[0]?.geometry?.coordinates?.[0];
    if (!coords) throw new Error(`${def.clip}: no polygon`);
    const p = placer(def);
    const ringGeo = coords.slice(0, -1).map(([lon, lat]) => ({ lat, lon }));
    const ringLocal = ringGeo.map((g) => p.proj.toWorld(g.lat, g.lon));
    const c = p.proj.toWorld(def.draftRect.centre.lat, def.draftRect.centre.lon);
    const ground = await groundSampler(ctx, { kind: 'box', ...ctx.box });
    const buildings = overtureFootprints(ctx) || ctx.map.buildings;
    districts.push({
      def, ctx, p, ringGeo, ringLocal, ring: ringLocal.map((q) => p.place(q)), rectLocal: rectRing(c, def.draftRect.widthM, def.draftRect.heightM), ground, buildings,
      buildingsFrom: buildings === ctx.map.buildings ? 'OSM footprints' : 'Overture footprints (BS1)', clipProps: gj.features[0].properties,
    });
  }
  const connectors = fs.existsSync(path.join(DATA, 'connectors')) ? fs.readdirSync(path.join(DATA, 'connectors')).filter((f) => f.endsWith('.json')).sort().map((f) => ({ file: `connectors/${f}`, spec: readJson(path.join(DATA, 'connectors', f)) })) : [];
  const ito = loadArea(areas.find((a) => a.id === 'ito'));
  return { file, districts, connectors, ito, ms: Date.now() - t0 };
}

/** Footprints that the line cuts: some corners inside the ring and some outside. */
function cutBuildings(buildings, ring) {
  const box = boxOf(ring);
  let n = 0;
  for (const b of buildings) {
    if (!boxesMeet(b.box, box)) continue;
    let inside = 0;
    for (const v of b.ring) if (pointInRing(v, ring)) inside++;
    if (inside > 0 && inside < b.ring.length) n++;
  }
  return n;
}

/** The whole stitch bake: frames, clip, ground, connectors, closures, content, tiles, checks. Pure but for its inputs. */
function bake(src) {
  const ms = {};
  let clock = Date.now();
  const t0 = clock;
  const lap = (name) => {
    const now = Date.now();
    ms[name] = (ms[name] ?? 0) + now - clock;
    clock = now;
  };
  const { file } = src;
  const problems = [];
  const layout = file.layout;

  // ---- frames and landmarks (X1 against X2)
  const landmarks = LANDMARKS.map((l) => {
    const d = src.districts.find((x) => x.def.id === l.district);
    const way = d.ctx.raw.elements.find((e) => e.type === 'way' && `way/${e.id}` === l.osm);
    if (!way) throw new Error(`landmark ${l.id}: ${l.osm} is not in the pilot download of ${l.district}`);
    const ids = way.nodes[0] === way.nodes[way.nodes.length - 1] ? way.nodes.slice(0, -1) : way.nodes;
    const n = Math.min(8, ids.length);
    const pick = Array.from({ length: n }, (_, k) => ids[Math.floor((k * ids.length) / n)]);
    const nodes = pick.map((id) => d.ctx.map.nodes.get(id));
    const ringLocal = ids.map((id) => d.ctx.map.nodes.get(id)).map((q) => ({ x: q.x, z: q.z }));
    return { ...l, d, points: nodes.map((q) => ({ lat: q.lat, lon: q.lon })), pinsLocal: nodes.map((q) => ({ x: q.x, z: q.z })), ringLocal, insideClip: pointInRing(ringLocal[0], d.ringLocal) };
  });
  const coordinates = src.districts.map((d) => {
    const b = boxOf(d.ringLocal);
    const corner = (name, x, z) => ({ name, ...d.p.proj.toGeo(x, z) });
    const pts = [corner('north west corner', b.minX, b.minZ), corner('north east corner', b.maxX, b.minZ), corner('south east corner', b.maxX, b.maxZ), corner('south west corner', b.minX, b.maxZ)];
    for (const l of landmarks.filter((x) => x.district === d.def.id)) pts.push({ name: l.name, lat: l.points.reduce((s, q) => s + q.lat, 0) / l.points.length, lon: l.points.reduce((s, q) => s + q.lon, 0) / l.points.length });
    const f = frameDifference(d.def, pts, file.x2Origin);
    return { district: f.district, originDistanceM: round(f.originDistanceM, 1), maxM: round(f.maxM, 4), maxAt: f.maxAt, convergenceDeg: round(f.convergenceDeg, 5), scaleMmPerKm: round(f.scaleMmPerKm, 3), points: f.points.map((q) => ({ name: q.name, dM: round(q.dM, 4), dxM: round(q.dxM, 4), dzM: round(q.dzM, 4) })) };
  });
  lap('frames');

  // ---- clip: DC1 against DC2, ports
  const clip = {};
  for (const d of src.districts) {
    const roads = d.ctx.map.roads;
    const c1 = clipRoads(roads, d.rectLocal);
    const c2 = clipRoads(roads, d.ringLocal);
    const p1 = mergePorts(c1.crossings, d.rectLocal, d.def.id);
    const p2 = mergePorts(c2.crossings, d.ringLocal, d.def.id);
    d.inside = c2.inside;
    // a kept road piece that ends on the clip line must end in a crossing (so in a port)
    let loose = 0;
    for (const piece of c2.inside) {
      for (const q of [piece.pts[0], piece.pts[piece.pts.length - 1]]) {
        if (ringProject(d.ringLocal, q).d < 0.5 && !c2.crossings.some((x) => Math.hypot(x.x - q.x, x.z - q.z) < 1)) loose++;
      }
    }
    d.endsOnLineWithoutPort = loose;
    // ports in world metres from here on
    d.ports = p2.map((q) => ({ ...q, ...d.p.place(q) }));
    const row = (ring, ports, c) => ({
      areaKm2: round(Math.abs(ringArea(ring)) / 1e6, 3), ringLengthM: round(ringLength(ring), 0), ports: ports.length, big: ports.filter((q) => q.big).length, small: ports.filter((q) => !q.big).length,
      byClass: portsByClass(ports), portsPerKmOfLine: round(ports.length / (ringLength(ring) / 1000), 1), buildingsCut: cutBuildings(d.buildings, ring), excursionsKept: c.excursions, nicksDropped: c.nicks,
    });
    clip[d.def.id] = { dc1: row(d.rectLocal, p1, c1), dc2: row(d.ringLocal, p2, c2), roadEndsOnTheLineWithoutAPort: loose, edges: d.clipProps.edges };
  }
  lap('clip');

  // ---- connectors: ends on ports
  const portOf = new Map();
  const connectors = src.connectors.map(({ file: f, spec }) => {
    const bad = [...specProblems(spec), ...forbiddenTransformKeys(spec).map((k) => `key ${k} could carry a rotation, a scale or a mirror`)];
    const end = (e, point) => {
      const d = src.districts.find((x) => x.def.id === e.district);
      const near = d ? d.ports.filter((q) => q.big && q.name === e.port && Math.hypot(q.x - point.x, q.z - point.z) < 45) : [];
      if (!near.length) {
        bad.push(`no big port named ${e.port} of ${e.district} within 45 m of the end point`);
        return null;
      }
      const x = near.reduce((s, q) => s + q.x, 0) / near.length;
      const z = near.reduce((s, q) => s + q.z, 0) / near.length;
      const len = Math.hypot(near.reduce((s, q) => s + q.dx, 0), near.reduce((s, q) => s + q.dz, 0)) || 1;
      return { d, ports: near, x, z, dx: near.reduce((s, q) => s + q.dx, 0) / len, dz: near.reduce((s, q) => s + q.dz, 0) / len, off: Math.hypot(x - point.x, z - point.z) };
    };
    const from = end(spec.from, spec.points[0]);
    const to = end(spec.to, spec.points[spec.points.length - 1]);
    for (const e of [from, to]) for (const q of e?.ports ?? []) portOf.set(q.id, spec.id);
    if (bad.length) problems.push(`${f}: ${bad.join('; ')}`);
    return { file: f, spec, from, to, bad };
  });
  lap('connectorEnds');

  // ---- ground: one lattice for the whole map
  const river = { line: riverLine(layout), width: (layout.river?.width ?? 0) * 1000, ...RIVER };
  const sources = src.districts.map((d) => ({ ring: d.ring, height: (x, z) => d.ground.at(x - d.def.offset.x, z - d.def.offset.z) + d.def.heightOffset }));
  const coarse = src.districts.map((d) => {
    const s = simplify([...d.ring, d.ring[0]], 20);
    s.pop();
    return s;
  });
  const boxes = src.districts.map((d) => boxOf(d.ring));
  const base = blendGround(sources, coarse);
  const inDistrict = (x, z) => {
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && pointInRing({ x, z }, src.districts[i].ring)) return i;
    }
    return -1;
  };
  const allPts = [...src.districts.flatMap((d) => d.ring), ...connectors.flatMap((c) => c.spec.points)];
  const wb = boxOf(allPts);
  const snap = (v, dir) => (dir < 0 ? Math.floor((v - 300) / TILE) : Math.ceil((v + 300) / TILE)) * TILE;
  const world = { minX: snap(wb.minX, -1), maxX: snap(wb.maxX, 1), minZ: snap(wb.minZ, -1), maxZ: snap(wb.maxZ, 1) };
  // the river: one water level, a little under the lowest bank inside the world box; the bed lies under it
  const unit = { ...river, depth: 1 };
  let lowBank = Infinity;
  for (let i = 0; i + 1 < river.line.length; i++) {
    const a = river.line[i];
    const c = river.line[i + 1];
    const len = Math.hypot(c.x - a.x, c.z - a.z) || 1;
    for (const side of [-1, 1]) {
      const q = { x: (a.x + c.x) / 2 + ((c.z - a.z) / len) * side * (river.width / 2 + 5), z: (a.z + c.z) / 2 - ((c.x - a.x) / len) * side * (river.width / 2 + 5) };
      if (q.x > world.minX && q.x < world.maxX && q.z > world.minZ && q.z < world.maxZ) lowBank = Math.min(lowBank, base(q.x, q.z));
    }
  }
  river.waterLevel = Number.isFinite(lowBank) ? lowBank - 1.2 : (file.heightLevelM ?? 215) - 2;
  river.bedLevel = river.waterLevel - river.depth;
  const lattice = new Lattice(world.minX, world.minZ, world.maxX, world.maxZ, CELL, (x, z) => {
    const i = inDistrict(x, z);
    if (i >= 0) return sources[i].height(x, z);
    const h = base(x, z);
    const t = river.line.length ? riverDepth(unit, { x, z }) : 0;
    return h + (Math.min(h, river.bedLevel) - h) * t;
  });
  lap('ground');

  // ---- connectors: the lane model builds them on the stitched ground (SC1)
  const corridors = [];
  for (const c of connectors) {
    if (c.bad.length || !c.from || !c.to) continue;
    const startH = lattice.at(c.from.x, c.from.z);
    const endH = lattice.at(c.to.x, c.to.z);
    try {
      c.build = buildConnector(c.spec, lattice.at, { x: c.from.dx, z: c.from.dz }, { x: -c.to.dx, z: -c.to.dz });
    } catch (e) {
      problems.push(`${c.spec.id}: the lane model could not build it (${String(e.message).split('\n')[0]})`);
      continue;
    }
    c.portGround = { start: startH, end: endH };
    const own = c.build.site.strips.filter((s) => s.ways.some((w) => w.startsWith(`connector/${c.spec.id}#`)));
    c.half = Math.max(...own.flatMap((s) => s.st.map((st) => Math.max(Math.abs(st.b[0]), Math.abs(st.b[st.b.length - 1])))));
    corridors.push({ id: c.spec.id, pts: c.build.line, half: c.half, box: boxOf(c.build.line) });
    for (const u of c.spec.under ?? []) corridors.push({ id: `${c.spec.id} (${u.name})`, pts: u.points, half: 6, box: boxOf(u.points) });
    for (const p of c.build.site.problems) problems.push(`${c.spec.id}: ${p}`);
  }
  // the ground under a connector at grade takes the connector's height
  const conformPts = [];
  for (const c of connectors) {
    for (const s of c.build?.site.strips ?? []) {
      for (const st of s.st) {
        if (st.structure !== 0) continue;
        conformPts.push({ x: st.x, z: st.z, h: st.h, reach: Math.max(Math.abs(st.b[0]), Math.abs(st.b[st.b.length - 1])) + CELL * 1.45 });
      }
    }
  }
  const conformed = lattice.conform(conformPts, 0.12);
  lap('connectors');

  // ---- filler: closing the ports (FL1)
  const blocked = (self) => (line) => {
    const lb = boxOf(line);
    for (const o of src.districts) {
      if (o === self || !boxesMeet(lb, boxOf(o.ring), 5)) continue;
      if (line.some((q) => pointInRing(q, o.ring))) return `it runs into ${o.def.name}`;
    }
    for (const k of corridors) {
      if (!boxesMeet(lb, k.box, k.half + 10)) continue;
      if (line.some((q) => distToLine(q, k.pts) < k.half + 6)) return `it crosses the connector ${k.id}`;
    }
    if (river.line.length && line.some((q) => riverDepth(river, q) > 0)) return 'it runs into the river';
    return null;
  };
  const closures = [];
  const filler = {};
  for (const d of src.districts) {
    d.closures = closePorts(d.ports, d.ring, portOf, { ...CLOSE_DEFAULTS, blocked: blocked(d) });
    const n = countClosures(d.ports, d.closures);
    const closed = new Set(d.closures.flatMap((c) => c.ports));
    filler[d.def.id] = { ...n, autoShare: round(n.autoShare, 3), withoutClosure: d.ports.filter((q) => !closed.has(q.id)).length, review: d.closures.filter((c) => c.review).map((c) => c.reason) };
    closures.push(...d.closures.map((c) => ({ ...c, district: d.def.id })));
  }
  lap('closures');

  // ---- content: tiles of the stitched world
  const set = new TileSet(Y_BASE);
  const g = lattice.at;
  const tris = {};
  const count = (layer, n) => (tris[layer] = (tris[layer] ?? 0) + n);
  // keep-clear lines for the edge band: generated streets, loops and connectors run through it
  const clear = [];
  for (const c of closures) for (const s of c.streets) clear.push({ pts: s, half: c.width / 2 + 1.5, box: boxOf(s) });
  for (const k of corridors) clear.push({ pts: k.pts, half: k.half + 4, box: k.box });
  let shellsDropped = 0;
  const dc3 = {};
  for (const d of src.districts) {
    const id = d.def.id;
    const band = `band_${id}`;
    const off = d.def.offset;
    const place = (ring) => ring.map((q) => ({ x: q.x + off.x, z: q.z + off.z }));
    for (const piece of d.inside) {
      if (piece.road.tunnel) continue;
      const big = ['motorway', 'trunk', 'primary', 'secondary'].includes(piece.road.cls);
      ribbon(set, id, big ? 'road' : 'road_minor', place(piece.pts), piece.road.width, g, big ? 0.2 : 0.15);
    }
    const lms = landmarks.filter((l) => l.district === id);
    const box = boxOf(d.ringLocal);
    let inside = 0;
    let shells = 0;
    for (const b of d.buildings) {
      if (b.centre.x < box.minX - BAND_M || b.centre.x > box.maxX + BAND_M || b.centre.z < box.minZ - BAND_M || b.centre.z > box.maxZ + BAND_M) continue;
      const isIn = pointInRing(b.centre, d.ringLocal);
      if (!isIn && ringProject(d.ringLocal, b.centre).d > BAND_M) continue;
      // a landmark's own block stands in for the footprints inside it
      if (lms.some((l) => l.height > 0 && pointInRing(b.centre, l.ringLocal))) continue;
      const ring = place(b.ring);
      const c = { x: b.centre.x + off.x, z: b.centre.z + off.z };
      const h = g(c.x, c.z);
      if (isIn) {
        prism(set, id, 'building', ring, h - 0.5, h + buildingHeight(b));
        inside++;
        continue;
      }
      const bb = boxOf(ring);
      if (clear.some((k) => boxesMeet(bb, k.box, k.half) && k.pts.some((q, i) => i + 1 < k.pts.length && segmentRing(q, k.pts[i + 1], ring) < k.half))) {
        shellsDropped++;
        continue;
      }
      prism(set, band, 'shell', ring, h - 0.5, h + buildingHeight(b));
      shells++;
    }
    for (const l of lms) {
      const ring = place(l.ringLocal);
      const c = ring.reduce((s, q) => ({ x: s.x + q.x / ring.length, z: s.z + q.z / ring.length }), { x: 0, z: 0 });
      const h = g(c.x, c.z);
      if (l.height > 0) prism(set, id, 'landmark', ring, h - 0.5, h + l.height, `landmark_${l.id}`);
      // pins: the reference points as the map model has them, each a small marker that stays in one tile
      l.pinsLocal.forEach((q, k) => {
        const w = { x: q.x + off.x, z: q.z + off.z };
        const y = g(w.x, w.z) + l.height;
        prism(set, id, 'pin', [{ x: w.x - 0.3, z: w.z - 0.3 }, { x: w.x + 0.3, z: w.z - 0.3 }, { x: w.x + 0.3, z: w.z + 0.3 }, { x: w.x - 0.3, z: w.z + 0.3 }], y, y + 0.6, pinName(l.id, k), w);
      });
    }
    // share of the clip line that has 80 m of downloaded data outside it
    let covered = 0;
    let samples = 0;
    for (let s = 0; s < ringLength(d.ringLocal); s += 25) {
      const q = ringAt(d.ringLocal, s);
      const o = { x: q.x + q.nx * BAND_M, z: q.z + q.nz * BAND_M };
      samples++;
      if (o.x > d.ctx.box.minX && o.x < d.ctx.box.maxX && o.z > d.ctx.box.minZ && o.z < d.ctx.box.maxZ) covered++;
    }
    dc3[id] = { buildingsInside: inside, shells, lineWithDataOutside: round(covered / samples, 2) };
  }
  for (const c of closures) {
    for (const s of c.streets) ribbon(set, 'filler', 'road_gen', s, c.width, g, 0.16);
    if (c.bar) {
      const mid = { x: (c.bar[0].x + c.bar[1].x) / 2, z: (c.bar[0].z + c.bar[1].z) / 2 };
      const kind = c.kind === 'gate' ? ['gate', 0.3, 2.4] : c.kind === 'open' ? ['barrier', 0.6, 1.2] : ['wall', 0.4, 3];
      bar(set, 'filler', kind[0], c.bar[0], c.bar[1], kind[1], g(mid.x, mid.z) - 0.3, kind[2] + 0.3);
    }
  }
  // connectors: the lane model's meshes cut into the world's tiles, verges down to the ground, aprons at the ports
  for (const c of connectors) {
    if (!c.build) continue;
    const t = c.build.site.tile;
    for (const m of t.meshes) {
      const at = (i) => [m.pos[i * 3] + t.origin[0], m.pos[i * 3 + 1] + t.origin[1], m.pos[i * 3 + 2] + t.origin[2]];
      for (let k = 0; k + 2 < m.idx.length; k += 3) {
        const i = m.idx[k];
        set.tri('connector', m.material, at(i), at(m.idx[k + 1]), at(m.idx[k + 2]), [m.nrm[i * 3], m.nrm[i * 3 + 1], m.nrm[i * 3 + 2]], m.name);
      }
    }
    verges(set, 'connector', c.build.site.strips, g, 0);
    for (const e of [c.from, c.to]) {
      for (const q of e.ports) {
        // a carriageway that crosses the clip line before the connector's end section: a short apron fills the gap
        const gap = (e.x - q.x) * e.dx + (e.z - q.z) * e.dz;
        if (gap > 0.5) ribbon(set, 'connector', 'road', [{ x: q.x, z: q.z }, { x: q.x + e.dx * gap, z: q.z + e.dz * gap }], q.width, g, 0.2);
      }
    }
  }
  if (river.line.length) ribbon(set, 'filler', 'water', river.line, river.width, () => river.waterLevel, 0);
  const cells = lattice.emit(set, (x, z) => {
    const i = inDistrict(x, z);
    if (i >= 0) return { layer: src.districts[i].def.id, material: 'ground' };
    return { layer: 'filler', material: river.line.length && riverDepth(unit, { x, z }) > 0.1 ? 'riverbed' : 'filler' };
  });
  lap('content');

  // ---- tiles: 250 m, vertices relative to the tile (FP1)
  const tiles = set.contents().map((t) => ({ t, bytes: encodeT1(t) }));
  const bytesBy = {};
  let maxLocal = 0;
  for (const { t, bytes } of tiles) {
    bytesBy[t.district] = (bytesBy[t.district] ?? 0) + bytes.length;
    for (const m of t.meshes) {
      count(t.district, m.idx.length / 3);
      for (let i = 0; i < m.pos.length; i += 3) maxLocal = Math.max(maxLocal, Math.abs(m.pos[i]), Math.abs(m.pos[i + 2]));
    }
  }
  lap('tiles');

  // ---- checks
  const baked = pinCentres(tiles.map((x) => x.bytes));
  const defs = src.districts.map((d) => d.def);
  const lmErrors = landmarkErrors(landmarks, defs, baked);
  const layoutPairs = layoutChecks(LAYOUT_PAIRS, landmarks, lmErrors);
  const pairs = pairCheck(src.districts.map((d) => ({ id: d.def.id, ring: d.ring })));
  const transforms = src.districts.map((d) => transformCheck(d.p));
  const forbidden = [...forbiddenTransformKeys(file), ...src.connectors.flatMap((c) => forbiddenTransformKeys(c.spec).map((k) => `${c.file}: ${k}`))];
  lap('checks');
  ms.total = Date.now() - t0;
  return { ms, problems, landmarks, coordinates, clip, connectors, corridors, river, lattice, world, conformed, closures, filler, dc3, shellsDropped, tiles, bytesBy, tris, cells, maxLocal, lmErrors, layoutPairs, pairs, transforms, forbidden };
}

/**
 * SC2 trial: the real Ring Road between the Red Fort and the Bhairon Marg junction (the stretch the authored ring
 * road arc stands for), shortened to fit between the arc's two ports. The middle is real data (the ITO pilot
 * download, with the ITO flyover and the cross street under it); the stretch north of the download is a straight
 * line (the real road runs straight along Rajghat there).
 */
function sc2Trial(src, b) {
  const arc = b.connectors.find((c) => c.spec.id === 'ring_road_arc');
  if (!arc?.from || !arc.to || !src.ito) return { tried: false, reason: 'the ring road arc or the ITO pilot data is missing' };
  const ito = src.ito;
  // the main line of the Ring Road in the ITO download, north to south: Mahatma Gandhi Marg and its flyover (trunk,
  // no slip roads; the Sachivalaya Road Flyover is a branch to the east and is left out)
  const adj = new Map();
  const link = (a, c, w, road) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ to: c, w, road });
  };
  const mainLine = (r) => !r.link && !r.tunnel && r.name !== 'Sachivalaya Road Flyover' && (r.cls === 'trunk' || r.name === 'Mahatma Gandhi Marg');
  for (const r of ito.map.roads) {
    if (!mainLine(r)) continue;
    for (let i = 0; i + 1 < r.nodes.length; i++) {
      const w = Math.hypot(r.pts[i].x - r.pts[i + 1].x, r.pts[i].z - r.pts[i + 1].z);
      link(r.nodes[i], r.nodes[i + 1], w, r);
      link(r.nodes[i + 1], r.nodes[i], w, r);
    }
  }
  const node = (id) => ito.map.nodes.get(id);
  const ids = [...adj.keys()];
  const start = ids.reduce((m, id) => (node(id).z < node(m).z ? id : m));
  // the south end: abeam of India Gate (the Bhairon Marg junction), as far east as the main line runs
  const igZ = ito.proj.toWorld(src.file.x2Origin.lat, src.file.x2Origin.lon).z;
  const dist = new Map([[start, 0]]);
  const prev = new Map();
  const heap = [[0, start]];
  while (heap.length) {
    let k = 0;
    for (let i = 1; i < heap.length; i++) if (heap[i][0] < heap[k][0]) k = i;
    const [dd, id] = heap.splice(k, 1)[0];
    if (dd > (dist.get(id) ?? Infinity)) continue;
    for (const e of adj.get(id) || []) {
      const nd = dd + e.w;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, { id, road: e.road });
        heap.push([nd, e.to]);
      }
    }
  }
  const reach = [...dist.keys()];
  const end = reach.reduce((m, id) => (Math.abs(node(id).z - igZ) < Math.abs(node(m).z - igZ) ? id : m));
  const chain = [];
  for (let id = end; id !== undefined; id = prev.get(id)?.id) chain.push({ id, road: prev.get(id)?.road ?? null });
  chain.reverse();
  // real shape in one frame (the ITO district frame): the port at the Red Fort, a straight stretch, then the data
  const cc = arc.from.d;
  const portGeo = cc.p.toGeo({ x: arc.from.x, z: arc.from.z });
  const p0 = ito.proj.toWorld(portGeo.lat, portGeo.lon);
  const real = [p0, ...chain.map((c) => ({ x: node(c.id).x, z: node(c.id).z }))];
  const bridge = [false, ...chain.map((c, i) => (i + 1 < chain.length ? Boolean(chain[i + 1].road?.bridge) : false))];
  const straightM = Math.hypot(real[1].x - p0.x, real[1].z - p0.z);
  const a = { x: arc.from.x, z: arc.from.z };
  const e = { x: arc.to.x, z: arc.to.z };
  const limit = minRadius('trunk');
  // bridge stretches of the real road
  const runs = [];
  for (let i = 0; i + 1 < real.length; i++) {
    if (!bridge[i]) continue;
    const last = runs[runs.length - 1];
    if (last && last.to === i) last.to = i + 1;
    else runs.push({ from: i, to: i + 1 });
  }
  // the roads under them: the carriageways of one cross street are one road under the deck
  const crossings = [];
  for (const run of runs) {
    const hits = [];
    for (const r of ito.map.roads) {
      if (r.bridge || r.tunnel || r.link || r.layer > 0 || !['primary', 'secondary', 'tertiary'].includes(r.cls)) continue;
      for (let i = run.from; i < run.to; i++) {
        for (let k = 0; k + 1 < r.pts.length; k++) {
          const u = r.pts[k];
          const v = r.pts[k + 1];
          const den = (real[i + 1].x - real[i].x) * (v.z - u.z) - (real[i + 1].z - real[i].z) * (v.x - u.x);
          if (Math.abs(den) < 1e-9) continue;
          const t = ((u.x - real[i].x) * (v.z - u.z) - (u.z - real[i].z) * (v.x - u.x)) / den;
          const w = ((u.x - real[i].x) * (real[i + 1].z - real[i].z) - (u.z - real[i].z) * (real[i + 1].x - real[i].x)) / den;
          if (t < 0 || t > 1 || w < 0 || w > 1) continue;
          const len = Math.hypot(v.x - u.x, v.z - u.z) || 1;
          hits.push({ x: real[i].x + (real[i + 1].x - real[i].x) * t, z: real[i].z + (real[i + 1].z - real[i].z) * t, dx: (v.x - u.x) / len, dz: (v.z - u.z) / len, name: r.name });
        }
      }
    }
    if (hits.length) crossings.push({ x: hits.reduce((s, h) => s + h.x, 0) / hits.length, z: hits.reduce((s, h) => s + h.z, 0) / hits.length, dx: hits[0].dx, dz: hits[0].dz, name: hits.find((h) => h.name)?.name || 'cross street', carriageways: hits.length });
  }
  const realRadius = radiusCheck(smoothLine(real, 4).pts, limit);

  /** The real shape moved so that its ends lie on `a` and `target`, built by the lane model. */
  const trial = (target) => {
    const sim = similarity(real[0], real[real.length - 1], a, target);
    const short = real.map(sim.map);
    // the cross street keeps its own width and length: only its place and direction follow the shape
    const unders = crossings.map((c, i) => {
      const at = sim.map(c);
      const d1 = sim.map({ x: c.x + c.dx, z: c.z + c.dz });
      const len = Math.hypot(d1.x - at.x, d1.z - at.z) || 1;
      const ux = (d1.x - at.x) / len;
      const uz = (d1.z - at.z) / len;
      return { id: `under_${i}`, name: c.name, class: 'secondary', lanes: 4, points: [{ x: round(at.x - ux * 70, 2), z: round(at.z - uz * 70, 2) }, { x: round(at.x + ux * 70, 2), z: round(at.z + uz * 70, 2) }] };
    });
    // control points: the moved nodes, thinned to 3 m apart, with the ends of every bridge stretch kept
    const keep = new Set([0, short.length - 1, ...runs.flatMap((r) => [r.from, r.to])]);
    const index = [];
    for (let i = 0; i < short.length; i++) {
      const last = index[index.length - 1];
      const near = last !== undefined && Math.hypot(short[i].x - short[last].x, short[i].z - short[last].z) < 3;
      if (keep.has(i) && near && !keep.has(last)) index.pop();
      if (keep.has(i) || !near) index.push(i);
    }
    const spec = {
      id: 'sc2_ring_road_trial', name: 'Ring Road (real shape, shortened)', standsFor: arc.spec.standsFor, kind: 'ring_arc', status: 'generated', class: 'trunk', lanes: arc.spec.lanes,
      from: arc.spec.from, to: arc.spec.to, points: index.map((i) => ({ x: round(short[i].x, 2), z: round(short[i].z, 2) })),
      spans: runs.map((r) => ({ from: index.indexOf(r.from), to: index.indexOf(r.to), kind: 'bridge', layer: 1, over: 'what the real bridge passes over' })).filter((x) => x.from >= 0 && x.to > x.from),
      under: unders,
    };
    const shortRadius = radiusCheck(smoothLine(short, 4).pts, limit);
    let inRiver = 0;
    let inDistricts = 0;
    for (let i = 0; i + 1 < short.length; i++) {
      const mid = { x: (short[i].x + short[i + 1].x) / 2, z: (short[i].z + short[i + 1].z) / 2 };
      const len = Math.hypot(short[i + 1].x - short[i].x, short[i + 1].z - short[i].z);
      if (b.river.line.length && riverDepth(b.river, mid) > 0) inRiver += len;
      if (src.districts.some((d) => pointInRing(mid, d.ring))) inDistricts += len;
    }
    const out = {
      ratio: round(sim.ratio, 3), turnDeg: round(sim.turnDeg, 1), gameLengthM: round(polylineLength(short), 0),
      radius: { limitM: limit, minM: round(shortRadius.minRadiusM, 0), violations: shortRadius.violations, lengthBelowM: shortRadius.lengthBelowM },
      bridges: runs.map((r) => ({ realLengthM: round(polylineLength(real.slice(r.from, r.to + 1)), 0), shortenedLengthM: round(polylineLength(short.slice(r.from, r.to + 1)), 0) })),
      layout: { metresInTheRiver: round(inRiver, 0), metresInsideOtherDistricts: round(inDistricts, 0) },
    };
    try {
      const built = buildConnector(spec, b.lattice.at, { x: arc.from.dx, z: arc.from.dz });
      out.built = true;
      out.grade = { limitPct: built.grade.limitPct, maxPct: built.grade.maxPct, violations: built.grade.violations };
      out.clearance = { minM: built.minClearanceM, violations: built.clearanceViolations, neededM: 5.5 };
      out.floating = built.floating;
      out.sunk = built.sunk;
      out.structureM = built.structureM;
      out.maxAboveGroundM = built.maxAboveGroundM;
      out.crossStreetBelowGroundM = built.site.checks.heights.maxBelowGroundM;
      out.laneModel = { taperViolations: built.site.checks.tapers.violations, overlapM2: built.site.checks.overlap.areaM2, problems: built.site.problems, buildMs: built.ms };
    } catch (err) {
      out.built = false;
      out.buildError = String(err.message).split('\n')[0];
    }
    return { out, spec };
  };
  const fit = trial(e);
  // the same shape at stronger compression (layout C shortens its longest links far more than this one)
  const sweep = [0.5, 0.4, 0.3, 0.2].map((r) => {
    const k = r / fit.out.ratio;
    const t = trial({ x: a.x + (e.x - a.x) * k, z: a.z + (e.z - a.z) * k }).out;
    return { ratio: t.ratio, gameLengthM: t.gameLengthM, radiusMinM: t.radius.minM, radiusViolations: t.radius.violations, bridgeLengthM: t.bridges.map((x) => x.shortenedLengthM), built: t.built, gradeMaxPct: t.grade?.maxPct ?? null, gradeViolations: t.grade?.violations ?? null, clearanceMinM: t.clearance?.minM ?? null, clearanceViolations: t.clearance?.violations ?? null, floating: t.floating ?? null, sunk: t.sunk ?? null, deckAboveGroundM: t.maxAboveGroundM ?? null, crossStreetBelowGroundM: t.crossStreetBelowGroundM ?? null, structureM: t.structureM ?? null, structureShare: t.structureM ? round(t.structureM / t.gameLengthM, 3) : null, ...(t.buildError ? { buildError: t.buildError } : {}) };
  });
  return {
    tried: true,
    what: 'the real Ring Road from the Red Fort port to the Bhairon Marg junction (abeam of India Gate), moved onto the two ports of the authored ring road arc by one similarity (one scale, one turn)',
    realLengthM: round(polylineLength(real), 0), fromDataM: round(polylineLength(real) - straightM, 0), straightFillM: round(straightM, 0), osmNodes: chain.length,
    authoredArcLengthM: round(arc.build?.lengthM ?? 0, 0), realRadius: { minM: round(realRadius.minRadiusM, 0), violations: realRadius.violations },
    under: crossings.map((c) => ({ name: c.name, carriageways: c.carriageways })),
    ...fit.out,
    sweep,
    sweepNote: 'the same real shape at smaller ratios, from the same start port and with the same turn. The cross street under the flyover keeps its width; the deck must still clear it by 5.5 m. The solver keeps the grade limit by starting the ramps earlier, outside the stretch that the real road has as a bridge: structureM grows past bridgeLengthM, and structureShare is the part of the whole connector that is ramp or deck.',
    spec: fit.spec,
  };
}

const KIND_COLOUR = { connector: '#d0312d', street_net: '#1f9d55', loop: '#12b5cb', gate: '#444', dead_end: '#8a6d3b', open: '#e0218a' };

/** A north-up plan of the stitched world (or of one box of it): rings, ports by closure, connectors, the river. */
async function renderPlan(outFile, src, b, view, title) {
  const pad = 30;
  const W = 2400;
  const sc = W / (view.maxX - view.minX);
  const H = Math.round((view.maxZ - view.minZ) * sc) + pad;
  const X = (x) => ((x - view.minX) * sc).toFixed(1);
  const Z = (z) => ((z - view.minZ) * sc + pad).toFixed(1);
  const poly = (pts) => pts.map((p) => `${X(p.x)},${Z(p.z)}`).join(' ');
  const detail = sc > 0.6;
  const o = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="Helvetica, Arial, sans-serif"><rect width="100%" height="100%" fill="#dfe6cf"/>`];
  if (b.river.line.length) o.push(`<polyline points="${poly(b.river.line)}" fill="none" stroke="#7fb3d5" stroke-width="${(b.river.width * sc).toFixed(1)}"/>`);
  for (const d of src.districts) {
    const off = d.def.offset;
    const pl = (pts) => pts.map((q) => ({ x: q.x + off.x, z: q.z + off.z }));
    o.push(`<polygon points="${poly(d.ring)}" fill="#f4f1ea" stroke="none"/>`);
    if (detail) for (const f of d.buildings) if (pointInRing(f.centre, d.ringLocal) || ringProject(d.ringLocal, f.centre).d <= BAND_M) o.push(`<polygon points="${poly(pl(f.ring))}" fill="${pointInRing(f.centre, d.ringLocal) ? '#d9cfc0' : '#b9b3a8'}"/>`);
    for (const piece of d.inside) {
      const big = ['motorway', 'trunk', 'primary', 'secondary'].includes(piece.road.cls);
      o.push(`<polyline points="${poly(pl(piece.pts))}" fill="none" stroke="${big ? '#55585f' : '#9a9da3'}" stroke-width="${Math.max(big ? 1.6 : 0.7, piece.road.width * sc).toFixed(1)}"/>`);
    }
    for (const l of b.landmarks.filter((x) => x.district === d.def.id)) o.push(`<polygon points="${poly(pl(l.ringLocal))}" fill="${l.height > 0 ? '#b5523b' : 'none'}" fill-opacity="0.7" stroke="#8a2f1c" stroke-width="1.5"/>`);
    o.push(`<polygon points="${poly(pl(d.rectLocal))}" fill="none" stroke="#e0f" stroke-width="1.5" stroke-dasharray="8 5"/>`);
    o.push(`<polygon points="${poly(d.ring)}" fill="none" stroke="#0033aa" stroke-width="2.5"/>`);
  }
  for (const c of b.closures) {
    for (const s of c.streets) o.push(`<polyline points="${poly(s)}" fill="none" stroke="${KIND_COLOUR[c.kind]}" stroke-width="${Math.max(1.4, c.width * sc).toFixed(1)}"/>`);
    if (c.bar) o.push(`<polyline points="${poly(c.bar)}" fill="none" stroke="${KIND_COLOUR[c.kind]}" stroke-width="${detail ? 4 : 3}"/>`);
  }
  for (const c of b.connectors) {
    if (!c.build) continue;
    for (const u of c.spec.under ?? []) o.push(`<polyline points="${poly(u.points)}" fill="none" stroke="#6b5b45" stroke-width="${Math.max(2, 7 * sc).toFixed(1)}"/>`);
    o.push(`<polyline points="${poly(c.build.line)}" fill="none" stroke="#d0312d" stroke-width="${Math.max(3, c.half * 2 * sc).toFixed(1)}" stroke-opacity="0.85"/>`);
    for (const s of c.build.site.strips) {
      const up = s.st.filter((st) => st.structure > 0);
      if (up.length > 1 && s.ways.some((w) => w.startsWith(`connector/${c.spec.id}#`))) o.push(`<polyline points="${poly(up)}" fill="none" stroke="#5b2a86" stroke-width="${Math.max(3, c.half * 2 * sc).toFixed(1)}"/>`);
    }
    const mid = lineAt(c.build.line, c.build.lengthM * 0.45);
    o.push(`<text x="${(+X(mid.x) + 10).toFixed(1)}" y="${(+Z(mid.z) - 8).toFixed(1)}" font-size="20" font-weight="bold" fill="#8a1410" stroke="#fff" stroke-width="4" paint-order="stroke">${c.spec.name} (${c.spec.kind.replace('_', ' ')})</text>`);
  }
  for (const d of src.districts) {
    const kindOf = new Map(d.closures.flatMap((c) => c.ports.map((id) => [id, c.kind])));
    for (const q of d.ports) {
      const k = kindOf.get(q.id) ?? 'open';
      o.push(`<circle cx="${X(q.x)}" cy="${Z(q.z)}" r="${q.big ? 7 : 4}" fill="${KIND_COLOUR[k]}" stroke="#fff" stroke-width="1.2"/>`);
      if (q.big && (detail || k === 'connector')) o.push(`<text x="${(+X(q.x) + 9).toFixed(1)}" y="${(+Z(q.z) + 4).toFixed(1)}" font-size="${detail ? 15 : 12}" fill="#222" stroke="#fff" stroke-width="3" paint-order="stroke">${q.name || q.cls}</text>`);
    }
    const c = boxOf(d.ring);
    o.push(`<text x="${X((c.minX + c.maxX) / 2)}" y="${Z(c.minZ - 40 / Math.max(sc, 0.4))}" text-anchor="middle" font-size="22" font-weight="bold" fill="#0033aa" stroke="#fff" stroke-width="4" paint-order="stroke">${d.def.name}</text>`);
  }
  o.push(`<circle cx="${X(0)}" cy="${Z(0)}" r="9" fill="none" stroke="#000" stroke-width="2"/><line x1="${+X(0) - 14}" y1="${Z(0)}" x2="${+X(0) + 14}" y2="${Z(0)}" stroke="#000" stroke-width="2"/><line x1="${X(0)}" y1="${+Z(0) - 14}" x2="${X(0)}" y2="${+Z(0) + 14}" stroke="#000" stroke-width="2"/><text x="${+X(0) + 14}" y="${+Z(0) + 24}" font-size="14">world origin</text>`);
  o.push(`<rect width="100%" height="${pad}" fill="#1d1f24"/><text x="10" y="21" font-size="16" fill="#fff">${title}</text>`);
  let lx = 300;
  for (const [k, col] of Object.entries(KIND_COLOUR)) {
    o.push(`<circle cx="${lx}" cy="${H - 16}" r="6" fill="${col}" stroke="#fff"/><text x="${lx + 10}" y="${H - 11}" font-size="14" fill="#111">${k.replace('_', ' ')}</text>`);
    lx += 130;
  }
  o.push(`<polygon points="${W - 40},${pad + 12} ${W - 49},${pad + 42} ${W - 40},${pad + 35} ${W - 31},${pad + 42}" fill="#111"/><text x="${W - 46}" y="${pad + 60}" font-size="16" font-weight="bold" fill="#111">N</text>`);
  const barM = detail ? 100 : 500;
  o.push(`<rect x="14" y="${H - 14}" width="${(barM * sc).toFixed(1)}" height="5" fill="#111"/><text x="14" y="${H - 20}" font-size="13" fill="#111">${barM} m</text></svg>`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await sharp(Buffer.from(o.join('\n')), { limitInputPixels: false }).png().toFile(outFile);
}

/** Camera poses of the stitched world in world metres. A top pose looks straight down with north up. */
function poses(src, b) {
  const g = b.lattice.at;
  const out = [];
  const w = b.world;
  const cx = (w.minX + w.maxX) / 2;
  const cz = (w.minZ + w.maxZ) / 2;
  out.push({ name: 'top_all', kind: 'top', pos: [cx, 1500, cz], target: [cx, 200, cz], size: round(Math.max(w.maxZ - w.minZ, (w.maxX - w.minX) / 1.6) * 1.02, 0), note: 'every district from above, north up: the districts at their offsets, the connectors between them, the river' });
  const eye = (name, from, to, note, fov = 62) => out.push({ name, kind: 'eye', pos: from.map((v) => round(v, 3)), target: to.map((v) => round(v, 3)), size: fov, note });
  const heightOn = (c, p) => {
    let best = Infinity;
    let h = g(p.x, p.z);
    for (const s of c.build.site.strips) for (const st of s.st) if (Math.hypot(st.x - p.x, st.z - p.z) < best) {
      best = Math.hypot(st.x - p.x, st.z - p.z);
      h = st.h;
    }
    return h;
  };
  const arc = b.connectors.find((c) => c.spec.id === 'ring_road_arc' && c.build);
  if (arc) {
    // on the ring road arc, 60 m before its port at the Red Fort end, looking into the district
    const a = lineAt(arc.build.line, 60);
    const side = { x: a.x - a.dz * 3, z: a.z + a.dx * 3 };
    eye('port_eye', [side.x, heightOn(arc, a) + 1.6, side.z], [arc.from.x - arc.from.dx * 60, g(arc.from.x, arc.from.z) + 3, arc.from.z - arc.from.dz * 60], 'player height on the Ring Road connector, 60 m before its port at Chandni Chowk: the connector meets the district road at the clip line');
    out.push({ name: 'port_top', kind: 'top', pos: [arc.from.x - 60, 900, arc.from.z + 20], target: [arc.from.x - 60, 200, arc.from.z + 20], size: 420, note: 'the south east corner of Chandni Chowk from above: the Ring Road connector on its port, street nets and gates on the small ports, a barrier on a big port with no connector yet, the edge band of shells' });
  }
  const bridge = b.connectors.find((c) => c.spec.id === 'vikas_marg_bridge' && c.build);
  if (bridge) {
    const deck = bridge.build.site.strips.flatMap((s) => s.st).filter((st) => st.structure === 2);
    if (deck.length) {
      // a quarter of the way along the deck, in a lane, looking along the bridge and a little towards the water
      const line = bridge.build.line;
      const arcOf = (st) => {
        let best = 0;
        for (let i = 1; i < line.length; i++) if (Math.hypot(line[i].x - st.x, line[i].z - st.z) < Math.hypot(line[best].x - st.x, line[best].z - st.z)) best = i;
        return polylineLength(line.slice(0, best + 1));
      };
      const arcs = deck.map(arcOf);
      const s0 = Math.min(...arcs);
      const s1 = Math.max(...arcs);
      const at = lineAt(line, s0 + (s1 - s0) * 0.25);
      const ahead = lineAt(line, s0 + (s1 - s0) * 0.25 + 220);
      eye('bridge_eye', [at.x + at.dz * 4, heightOn(bridge, at) + 1.6, at.z - at.dx * 4], [ahead.x + ahead.dz * 30, heightOn(bridge, ahead) + 0.5, ahead.z - ahead.dx * 30], 'player height on the Vikas Marg bridge over the river stand-in, looking east to Laxmi Nagar');
    }
  }
  const fly = b.connectors.find((c) => c.spec.id === 'minto_road_flyover' && c.build);
  if (fly) {
    const top = fly.build.site.strips.filter((s) => s.ways.some((x) => x.startsWith('connector/minto_road_flyover#'))).flatMap((s) => s.st).reduce((m, st) => (st.h - st.g > m.h - m.g ? st : m));
    eye('flyover_side', [top.x - 150, top.g + 30, top.z + 150], [top.x + 20, top.g + 4, top.z], 'the flyover connector from the south west: it climbs over the railway stand-in and comes back to the ground', 50);
  }
  // the far district: the road point farthest from the world origin that has 60 m of district around it
  const far = src.districts.reduce((m, d) => (Math.max(...d.ring.map((q) => Math.hypot(q.x, q.z))) > Math.max(...m.ring.map((q) => Math.hypot(q.x, q.z))) ? d : m));
  let best = null;
  for (const piece of far.inside) {
    if (piece.road.width < 6 || piece.pts.length < 2) continue;
    for (let i = 0; i < piece.pts.length; i++) {
      const q = far.p.place(piece.pts[i]);
      if (ringProject(far.ring, q).d < 60) continue;
      const r = Math.hypot(q.x, q.z);
      if (!best || r > best.r) best = { r, q, piece, i };
    }
  }
  let pan = null;
  if (best) {
    const pts = best.piece.pts.map((q) => far.p.place(q));
    const j = best.i > 0 ? best.i - 1 : 1;
    let dx = pts[j].x - best.q.x;
    let dz = pts[j].z - best.q.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const y = g(best.q.x, best.q.z) + 1.75;
    eye('far_eye', [best.q.x, y, best.q.z], [best.q.x + dx * 80, y - 1.2, best.q.z + dz * 80], `player height on ${best.piece.road.name || 'a street'} in ${far.def.name}, ${round(best.r, 0)} m from the world origin`);
    // a slow pan: 2 mm sideways and 0.01 degrees of yaw per frame
    pan = { name: 'far_pan', pose: 'far_eye', frames: 24, stepM: [round(-dz * 0.002, 6), 0, round(dx * 0.002, 6)], yawStepDeg: 0.01, distanceFromOriginM: round(best.r, 0), district: far.def.id, tileOrigin: [Math.floor(best.q.x / TILE) * TILE, 0, Math.floor(best.q.z / TILE) * TILE] };
  }
  return { out, pan, far: far.def.id };
}

async function main() {
  const src = await loadSources();
  // two runs: the first warms the code up, the report takes the second
  const first = bake(src);
  const b = bake(src);
  const sc2 = sc2Trial(src, b);
  const { file } = src;

  // tiles and the scene index
  fs.rmSync(GEN, { recursive: true, force: true });
  fs.mkdirSync(GEN, { recursive: true });
  fs.writeFileSync(path.join(GEN, '.gdignore'), '');
  const tileRows = [];
  for (const { t, bytes } of b.tiles) {
    const name = `${t.district}_${t.tx}_${t.tz}.ktl`;
    fs.writeFileSync(path.join(GEN, name), bytes);
    tileRows.push({ file: name, layer: t.district, tx: t.tx, tz: t.tz, origin: t.origin });
  }
  const p = poses(src, b);
  const pins = b.landmarks.flatMap((l) => l.points.map((geo, k) => ({ name: pinName(l.id, k), landmark: l.id, ...l.d.p.toWorld(geo.lat, geo.lon) })));
  writeJson(path.join(GEN, 'index.json'), { world: b.world, yBase: Y_BASE, tile: TILE, tiles: tileRows, poses: p.out, pan: p.pan, pins: pins.map((q) => ({ name: q.name, landmark: q.landmark, x: round(q.x, 4), z: round(q.z, 4) })) }, false);

  // plan pictures
  await renderPlan(path.join(OUT, 'plan.png'), src, b, b.world, 'Stitch bench: the pilot districts in one world, north up. Blue: clip polygons (DC2); pink dashes: draft rectangles (DC1); red: authored connectors (purple: on a structure); dots: boundary ports by how they are closed.');
  for (const d of src.districts) {
    const box = boxOf(d.ring);
    await renderPlan(path.join(OUT, `plan_${d.def.id}.png`), src, b, { minX: box.minX - 160, maxX: box.maxX + 160, minZ: box.minZ - 160, maxZ: box.maxZ + 160 }, `${d.def.name}: clip polygon, edge band shells (grey), ports and how each is closed. North up.`);
  }
  writeJson(path.join(OUT, 'sc2_trial.json'), sc2.spec ?? {});

  // ---- the report
  const far = src.districts.map((d) => ({ id: d.def.id, m: Math.max(...d.ring.map((q) => Math.hypot(q.x, q.z))) })).reduce((m, x) => (x.m > m.m ? x : m));
  const ulp = (v) => 2 ** (Math.floor(Math.log2(Math.abs(v))) - 23);
  const farAxis = Math.max(...src.districts.find((d) => d.def.id === far.id).ring.map((q) => Math.max(Math.abs(q.x), Math.abs(q.z))));
  const layoutAxis = Math.max(file.layout.boxKm.x1 - file.layout.boxKm.x0, file.layout.boxKm.y1 - file.layout.boxKm.y0) * 500;
  const load = round(os.loadavg()[0] / os.cpus().length, 2);
  const districtBytes = Object.fromEntries(src.districts.map((d) => [d.def.id, b.bytesBy[d.def.id] ?? 0]));
  const bandBytes = Object.fromEntries(src.districts.map((d) => [d.def.id, b.bytesBy[`band_${d.def.id}`] ?? 0]));
  const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);
  const totals = (key) => src.districts.reduce((s, d) => s + b.filler[d.def.id][key], 0);
  const allPorts = totals('ports');
  const byClass = {};
  const sc1 = b.connectors.map((c) => {
    if (!c.build) return { id: c.spec.id, file: c.file, built: false, problems: c.bad };
    const k = c.build;
    const cls = (byClass[c.spec.class] ??= { connectors: 0, gradeViolations: 0, radiusViolations: 0, clearanceViolations: 0 });
    cls.connectors++;
    cls.gradeViolations += k.grade.violations;
    cls.radiusViolations += k.radius.violations;
    cls.clearanceViolations += k.clearanceViolations;
    const ch = k.site.checks;
    return {
      id: c.spec.id, file: c.file, built: true, name: c.spec.name, standsFor: c.spec.standsFor, kind: c.spec.kind, class: c.spec.class, lanes: c.spec.lanes, controlPoints: c.spec.points.length,
      from: { district: c.spec.from.district, port: c.spec.from.port, ports: c.from.ports.map((q) => q.id), portAt: { x: round(c.from.x, 2), z: round(c.from.z, 2) }, portDirection: { x: round(c.from.dx, 3), z: round(c.from.dz, 3) }, endOffPortM: round(c.from.off, 2) },
      to: { district: c.spec.to.district, port: c.spec.to.port, ports: c.to.ports.map((q) => q.id), portAt: { x: round(c.to.x, 2), z: round(c.to.z, 2) }, portDirection: { x: round(c.to.dx, 3), z: round(c.to.dz, 3) }, endOffPortM: round(c.to.off, 2) },
      lengthM: round(k.lengthM, 0), widthM: round(c.half * 2, 1),
      radius: { minM: round(k.radius.minRadiusM, 0), limitM: k.radius.limitM, violations: k.radius.violations },
      grade: { maxPct: k.grade.maxPct, limitPct: round(k.grade.limitPct, 1), violations: k.grade.violations },
      clearance: { minM: k.minClearanceM, violations: k.clearanceViolations, neededM: 5.5 },
      structureM: k.structureM, maxAboveGroundM: k.maxAboveGroundM, floating: k.floating, sunk: k.sunk,
      heights: { startM: round(k.startH, 2), endM: round(k.endH, 2), climbM: round(k.endH - k.startH, 2), portGroundStartM: round(c.portGround.start, 2), portGroundEndM: round(c.portGround.end, 2), stepAtStartM: round(Math.abs(k.startH - c.portGround.start), 2), stepAtEndM: round(Math.abs(k.endH - c.portGround.end), 2) },
      laneModel: { strips: k.site.stats.strips, triangles: k.site.stats.triangles, overlapM2: ch.overlap.areaM2, continuityBreaks: ch.continuity.breaks, taperViolations: ch.tapers.violations, heightSteps: ch.heights.steps, problems: k.site.problems },
      buildMs: k.ms,
    };
  });
  const named = b.lmErrors.filter((e) => LANDMARKS.find((l) => l.id === e.id).named);
  const lmRow = (e) => ({ id: e.id, name: e.name, district: e.district, osm: e.osm, points: e.points, missing: e.missing, maxM: round(e.maxM, 6), meanM: round(e.meanM, 6), expected: { x: round(e.expected.x, 3), z: round(e.expected.z, 3) }, baked: { x: round(e.baked.x, 3), z: round(e.baked.z, 3) }, insideClip: b.landmarks.find((l) => l.id === e.id).insideClip });
  const open = b.closures.filter((c) => c.kind === 'open');
  const report = {
    writtenBy: 'node harness/bench/stitch.mjs', at: new Date().toISOString(), node: process.version,
    data: { osmBase: src.districts[0].ctx.osmBase, buildings: src.districts[0].buildingsFrom, ground: 'GEDTM30 v1.2 smoothed over 60 m (the P0-018 pick) inside a district; outside, the districts\' grounds blended by 1 / distance squared to each clip line; one 12.5 m lattice' },
    districts: src.districts.map((d) => {
      const box = boxOf(d.ring);
      return {
        id: d.def.id, name: d.def.name, stage: d.def.stage, group: d.def.group, layoutId: d.def.layoutId, origin: d.def.origin, offset: d.def.offset, heightOffset: d.def.heightOffset, clip: d.def.clip,
        clipAreaKm2: round(Math.abs(ringArea(d.ring)) / 1e6, 3), clipPoints: d.ring.length, worldBox: { minX: round(box.minX, 0), maxX: round(box.maxX, 0), minZ: round(box.minZ, 0), maxZ: round(box.maxZ, 0) },
        farthestFromOriginM: round(Math.max(...d.ring.map((q) => Math.hypot(q.x, q.z))), 0), roadPiecesInside: d.inside.length,
      };
    }),
    districtsNote: 'The task names three districts: Connaught Place with India Gate, Chandni Chowk with Red Fort, and Laxmi Nagar. Layout C has Connaught Place (D01 with D02) and India Gate (D03) as two boxes with their own offsets, and the pilot download has them as two extracts, so they are two frames here (group "core"): four frames in three groups.',
    layout: { id: file.layout.id, source: file.layout.source, worldOrigin: file.layout.worldOrigin, worldBox: b.world, river: file.layout.river, riverStandIn: { waterLevelM: round(b.river.waterLevel, 2), bedLevelM: round(b.river.bedLevel, 2), widthM: b.river.width, note: 'one water level, 1.2 m under the lowest bank in the world box; not a real river profile' } },
    coordinates: {
      x1: 'project(lat, lon, district origin) + offset', x2: `project(lat, lon, one origin at India Gate ${file.x2Origin.lat}, ${file.x2Origin.lon}) + a translation that puts the district's frame origin on the same world point`,
      perDistrict: b.coordinates, maxDifferenceM: Math.max(...b.coordinates.map((c) => c.maxM)), maxAt: b.coordinates.reduce((m, c) => (c.maxM > m.maxM ? c : m)).district,
      reading: 'X1 against X2 at the corners of each clip box and at the landmarks. The difference is the turn of north (meridian convergence) and the scale of the far origin; it is 0 for India Gate, whose frame origin is the X2 origin.',
    },
    clip: {
      perDistrict: b.clip,
      totals: { dc1Ports: sum(Object.fromEntries(Object.entries(b.clip).map(([k, v]) => [k, v.dc1.ports]))), dc2Ports: sum(Object.fromEntries(Object.entries(b.clip).map(([k, v]) => [k, v.dc2.ports]))), dc1BuildingsCut: sum(Object.fromEntries(Object.entries(b.clip).map(([k, v]) => [k, v.dc1.buildingsCut]))), dc2BuildingsCut: sum(Object.fromEntries(Object.entries(b.clip).map(([k, v]) => [k, v.dc2.buildingsCut]))) },
      portRule: 'a port is where a carriageway crosses the clip line; crossings within 32 m that leave the same way are one port; a road that leaves and is back inside within 160 m stays whole; a road inside for under 15 m is dropped',
      dc3: {
        bandM: BAND_M, shellsDroppedForStreetsAndConnectors: b.shellsDropped,
        perDistrict: Object.fromEntries(src.districts.map((d) => [d.def.id, { ...b.dc3[d.def.id], bandBytes: bandBytes[d.def.id], districtBytes: districtBytes[d.def.id], share: round(bandBytes[d.def.id] / districtBytes[d.def.id], 3) }])),
        bandBytes: sum(bandBytes), districtBytes: sum(districtBytes), share: round(sum(bandBytes) / sum(districtBytes), 3),
        note: 'T1 tile bytes of the band shells (extruded footprints whose centre is up to 80 m outside the clip line, no roads, no ground) against the tiles of the district itself (ground, road ribbons, footprints). Stand-in geometry on both sides.',
      },
    },
    connectors: { sc1, byClass, sc2 },
    filler: {
      rule: 'FL1: small ports closer than 140 m along the clip line are joined by a generated back street 26 m outside; a single through street ends in a turning loop; a service road in a gate; a lane at a wall. Big ports (secondary and up) need an authored connector.',
      perDistrict: b.filler,
      totals: { ports: allPorts, big: totals('big'), small: totals('small'), closedAutomatically: totals('auto'), automaticButToReview: totals('autoReview'), joinedByAuthoredConnector: totals('authored'), needAnAuthoredConnector: totals('open'), autoShare: round(totals('auto') / allPorts, 3), needAuthoredShare: round((totals('authored') + totals('open')) / allPorts, 3) },
      byKind: Object.fromEntries(['connector', 'street_net', 'loop', 'gate', 'dead_end', 'open'].map((k) => [k, src.districts.reduce((s, d) => s + b.filler[d.def.id].byKind[k], 0)])),
      needAnAuthoredConnector: open.map((c) => ({ district: c.district, port: c.ports[0], reason: c.reason })),
    },
    checks: {
      openBoundaryPorts: totals('withoutClosure'),
      openBoundaryPortsNote: 'ports with no closure at all (a road that would end in the air). Big ports with no connector yet are closed by a barrier and listed under portsWaitingForAConnector.',
      portsWaitingForAConnector: totals('open'),
      roadEndsOnTheClipLineWithoutAPort: src.districts.reduce((s, d) => s + d.endsOnLineWithoutPort, 0),
      connectorGradeViolations: sum(Object.fromEntries(Object.entries(byClass).map(([k, v]) => [k, v.gradeViolations]))),
      connectorRadiusViolations: sum(Object.fromEntries(Object.entries(byClass).map(([k, v]) => [k, v.radiusViolations]))),
      connectorViolationsByClass: byClass,
      connectorEndsOffPort: b.connectors.filter((c) => !c.from || !c.to || c.from.off > 0.5 || c.to.off > 0.5).length,
      overlappingClipPolygons: b.pairs.overlapping, overlapAreaM2: b.pairs.overlapAreaM2, minGapM: b.pairs.minGapM, minGapBetween: b.pairs.minGapBetween, clipPairs: b.pairs.pairs,
      landmarkErrorMaxM: round(Math.max(...named.map((e) => e.maxM)), 6), landmarkPinsMissing: b.lmErrors.reduce((s, e) => s + e.missing, 0),
      landmarks: named.map(lmRow), otherLandmarks: b.lmErrors.filter((e) => !named.includes(e)).map(lmRow),
      landmarkNote: 'expected: district offset plus the projection of the OSM node (degrees) around the district origin. baked: the pin of that node read back from the T1 tile bytes (32-bit floats relative to the tile, plus the tile origin). The pin was placed from the projected map model, so the error covers the origin, the offset, the tile cut and the float format.',
      relativeLayout: {
        maxDistanceErrorM: round(Math.max(...b.layoutPairs.map((q) => q.errorM)), 4), maxBearingErrorDeg: round(Math.max(...b.layoutPairs.map((q) => q.bearingErrorDeg)), 5),
        redFortNorthEastOfJamaMasjid: b.layoutPairs[0].bakedBearingDeg > 0 && b.layoutPairs[0].bakedBearingDeg < 90,
        pairs: b.layoutPairs.map((q) => ({ from: q.a, to: q.b, realM: round(q.realM, 3), bakedM: round(q.bakedM, 3), errorM: round(q.errorM, 4), realBearingDeg: round(q.realBearingDeg, 4), bakedBearingDeg: round(q.bakedBearingDeg, 4), bearingErrorDeg: round(q.bearingErrorDeg, 5) })),
        note: 'real: geodesic distance and bearing on the WGS84 ellipsoid (Vincenty), which shares no code with the projection. baked: between the mean pin positions read from the tiles.',
      },
      rotation: {
        transformsChecked: b.transforms.length, notPureTranslation: b.transforms.filter((t) => !t.ok).length, maxJacobianError: Math.max(...b.transforms.map((t) => t.jacobianError)), maxNorthOffDeg: Math.max(...b.transforms.map((t) => Math.abs(t.northOffDeg))),
        mirrored: b.transforms.filter((t) => t.handed !== 1).length, forbiddenKeysInData: b.forbidden, tilesCarry: 'an origin only: a T1 tile has no rotation or scale field',
        note: 'per district: the Jacobian of district metres to world metres against the identity, the angle between true north at the frame origin and -Z, and the sign of east x north. The Godot scene adds its own count of nodes whose basis is not the identity.',
      },
    },
    fp1: {
      farDistrict: far.id, farthestClipPointM: round(far.m, 0), largestCoordinateThereM: round(farAxis, 0), float32StepThereMm: round(ulp(farAxis) * 1000, 3),
      layoutCLargestCoordinateM: round(layoutAxis, 0), float32StepAtLayoutEdgeMm: round(ulp(layoutAxis) * 1000, 3), float32StepNote: 'a 32-bit float steps by 0.244 mm between 2,048 and 4,096 m and by 0.488 mm between 4,096 and 8,192 m, per axis',
      tileSizeM: TILE, maxVertexCoordinateInATileM: round(b.maxLocal, 1), float32StepInATileMm: round(ulp(TILE) * 1000, 4), pan: p.pan,
      note: 'vertices are stored relative to their 250 m tile, so their own rounding is 0.015 to 0.03 mm; what is left is the tile origin and the camera, which are world positions in 32-bit floats. The pan numbers are in the Godot part of the report.',
    },
    bake: {
      ms: b.ms, firstRunMs: first.ms.total, sourceLoadMs: src.ms, hostLoadPerCore: load,
      note: 'ms is the second of two runs in one Node process (the first includes code warm-up). It covers frames, clip, ports, the ground lattice, the three connectors through the lane model, closures, content, the T1 encode and the checks. sourceLoadMs is reading the pilot downloads and smoothing the height data, before the bake. The times double when another program keeps the machine busy (hostLoadPerCore over 1): a calm run is about 2.4 s.',
      tiles: b.tiles.length, bytes: sum(b.bytesBy), bytesByLayer: b.bytesBy, trianglesByLayer: b.tris, groundCells: b.cells, groundPointsLaidUnderConnectors: b.conformed,
    },
    problems: b.problems,
    productionNeeds: [
      'One road graph for a district and its connectors. Here a district road is a plain ribbon that stops at the clip line and the connector is a separate lane model site, so the join is two meshes that meet (with an apron where the clip line is oblique). Production cuts the district graph at the port node and gives that node to the connector, so lanes, kerbs and heights run through.',
      'Clip lines that cross a big road at a right angle, at a place with no slip road. Where the line is oblique the two carriageways of one street become two ports (Vikas Marg at Laxmi Nagar: 27 m apart along the road).',
      'A connector for every big port, or a rule that turns the port into a district-internal end. The list is in filler.needAnAuthoredConnector.',
      'The edge band and the generated back streets want the same strip of land. Here a shell is dropped where a generated street or a connector runs; production should run the back street behind the first row of shells, or pick per port.',
      'Filler ground with a height rule of its own (river banks, embankments) and filler blocks from area profiles along connectors: the bench has ground and water only.',
      'A constrained ground under connectors (TF2 from the road bench) in place of the lattice that is pressed to the connector height.',
      'Rail, river and metro as their own connector kinds: the thing under the flyover is a two lane road standing in for the railway.',
      'Clip polygons and connectors drawn and reviewed in the map inspector; the waypoint table lives in a script today.',
      'Height offsets solved over all districts and ports together (least squares over the port height steps), not one median per district.',
      'The download box of a district 100 m larger than its clip on every side, so the edge band is complete (clip.dc3.perDistrict.lineWithDataOutside).',
    ],
    files: { tiles: rel(GEN), index: rel(path.join(GEN, 'index.json')), plan: rel(path.join(OUT, 'plan.png')), districtPlans: src.districts.map((d) => rel(path.join(OUT, `plan_${d.def.id}.png`))), sc2Spec: rel(path.join(OUT, 'sc2_trial.json')) },
  };
  const bakeFile = path.join(REPORTS, 'stitch_bake.json');
  writeJson(bakeFile, report);

  const c = report.checks;
  console.log(`[stitch] bake ${b.ms.total} ms (first run ${first.ms.total} ms; sources ${src.ms} ms; host load per core ${load}): ${b.tiles.length} tiles, ${round(report.bake.bytes / 1e6, 1)} MB, ${sum(b.tris)} triangles`);
  console.log(`  X1 against X2: max ${report.coordinates.maxDifferenceM} m (${report.coordinates.maxAt})`);
  for (const d of src.districts) console.log(`  ${d.def.id}: DC1 ${b.clip[d.def.id].dc1.ports} ports ${JSON.stringify(b.clip[d.def.id].dc1.byClass)}, DC2 ${b.clip[d.def.id].dc2.ports} ports ${JSON.stringify(b.clip[d.def.id].dc2.byClass)}; closed: ${JSON.stringify(b.filler[d.def.id].byKind)}`);
  console.log(`  ports ${allPorts}: ${report.filler.totals.closedAutomatically} closed automatically (${round(report.filler.totals.autoShare * 100, 1)} percent), ${report.filler.totals.joinedByAuthoredConnector} on a connector, ${report.filler.totals.needAnAuthoredConnector} waiting for a connector, ${c.openBoundaryPorts} without a closure`);
  for (const k of sc1) console.log(k.built ? `  connector ${k.id}: ${k.lengthM} m, radius min ${k.radius.minM} m (limit ${k.radius.limitM}, ${k.radius.violations} violations), grade max ${k.grade.maxPct} percent (limit ${k.grade.limitPct}, ${k.grade.violations} violations), clearance ${k.clearance.minM ?? 'n/a'} m, ends off port ${k.from.endOffPortM} / ${k.to.endOffPortM} m, height steps ${k.heights.stepAtStartM} / ${k.heights.stepAtEndM} m, ${k.buildMs} ms` : `  connector ${k.id}: NOT BUILT (${k.problems.join('; ')})`);
  console.log(`  SC2 trial: ${sc2.tried ? `ratio ${sc2.ratio}, turn ${sc2.turnDeg} deg, radius min ${sc2.radius.minM} m (real ${sc2.realRadius.minM}), ${sc2.radius.violations} radius violations (real ${sc2.realRadius.violations}), ${sc2.built ? `grade max ${sc2.grade.maxPct} percent, ${sc2.grade.violations} grade violations, clearance ${sc2.clearance.minM} m (${sc2.clearance.violations} violations)` : `not built: ${sc2.buildError}`}` : sc2.reason}`);
  for (const t of sc2.sweep ?? []) console.log(`    at ratio ${t.ratio}: radius min ${t.radiusMinM} m (${t.radiusViolations} violations), ${t.built ? `grade max ${t.gradeMaxPct} percent (${t.gradeViolations} violations), clearance ${t.clearanceMinM} m (${t.clearanceViolations} violations), ramps and deck ${t.structureM} m for a real bridge of ${t.bridgeLengthM.join(' + ')} m, deck ${t.deckAboveGroundM} m up, cross street ${t.crossStreetBelowGroundM} m down (sunk ${t.sunk})` : `not built: ${t.buildError}`}`);
  console.log(`  clip polygons: ${c.overlappingClipPolygons} overlapping, min gap ${c.minGapM} m (${c.minGapBetween?.join(' and ')}); band ${round(report.clip.dc3.share * 100, 1)} percent of district tile bytes`);
  console.log(`  landmarks: max error ${c.landmarkErrorMaxM} m (${c.landmarkPinsMissing} pins missing); layout max ${c.relativeLayout.maxDistanceErrorM} m, ${c.relativeLayout.maxBearingErrorDeg} deg; transforms not pure translation ${c.rotation.notPureTranslation}, forbidden keys ${c.rotation.forbiddenKeysInData.length}`);
  for (const q of b.problems) console.log(`  problem: ${q}`);
  console.log(`wrote ${rel(bakeFile)}, ${rel(path.join(OUT, 'plan.png'))}`);
  if (args.includes('--no-godot')) return;
  const res = spawnSync(process.execPath, [path.join(ROOT, 'harness', 'bench', 'arch.mjs'), 'stitch'], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((e) => {
    console.error(e.stack || e.message);
    process.exit(1);
  });
}
