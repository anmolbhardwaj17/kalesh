#!/usr/bin/env node
// Map inspector adapter (P1-001). The production bake does not exist yet, so this turns the Phase 0 outputs into
// the two files the inspector reads (the contract P1-011 will fill from the production bake instead):
//
//   <out>/issues.json        { version: 1, block, source, rules: {id: title}, issues: [IssueRecord] }
//                            MAP_REPAIR.md "Issue record", positions in block metres of the centre block (origin India Gate)
//   <out>/tiles/index.json   { version: 1, block, datum, tiles: [{ file, x, z, size, origin: [x, y, z], label }], places: [...] }
//                            origin = where the tile's vertex origin sits in block metres (y has the datum taken off)
//   <out>/tiles/*.ktl        KTL1 tiles, copied as they are
//   <out>/context.json       optional: { version: 1, roads: [{ k: class, w: width, p: [x, y, z, ...] }], buildings: [[x, y, z, ...]] }
//                            a plan of the OSM roads and footprints outside the tiles, so an issue has its surroundings
//                            before the production tiles cover the whole map (the production bake leaves the file out)
//
//   node tools/inspector/adapter.mjs [--out harness/reports/inspector/data]
//
// Sources: the pilot census rules run on data/pilot (harness/bench/pilot_data, 4 pilot districts, 1,052 issues) and
// the bench tiles of ITO and Connaught Place (game/bench/roads/gen, made by harness/bench/roads.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORIGIN, geoToWorld } from '../geo/projection.ts';
import { CATALOGUE, runRules } from '../bake/rules/catalogue.ts';
import { autoProposal } from '../bake/rules/types.ts';
import { worldTile } from './lib.ts';
import { ROOT, pilotAreas, unionBox } from '../../harness/bench/pilot_data/lib.mjs';
import { loadArea, loadHeights, sampler } from '../../harness/bench/pilot_data/load.mjs';

export const DEFAULT_OUT = path.join(ROOT, 'harness', 'reports', 'inspector', 'data');
/** Heights in the tiles and on the issues are shown above this datum (about the lowest ground of the centre block). */
export const DATUM = 200;
const BENCH_TILES = path.join(ROOT, 'game', 'bench', 'roads', 'gen');
const BLOCK = 'centre';
const r1 = (v) => Math.round(v * 10) / 10;

/** Rectangles (district metres) of the bench tiles per pilot district: the plan leaves them out. */
function benchHole(areaId) {
  const site = { cp: 'cp', ito: 'ito' }[areaId];
  const file = site && path.join(BENCH_TILES, `${site}.ktl`);
  if (!file || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  const h = JSON.parse(bytes.subarray(12, 12 + bytes.readUInt32LE(8)).toString('latin1'));
  return { minX: h.origin[0], minZ: h.origin[2], maxX: h.origin[0] + h.tile.size, maxZ: h.origin[2] + h.tile.size };
}
const inRect = (p, r) => !!r && p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ;
/** The parts of a polyline outside a rectangle, each run keeping the first point inside so it meets the edge. */
function outsideRuns(pts, hole) {
  if (!hole) return [pts];
  const runs = [];
  let run = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!inRect(p, hole)) { if (!run.length && i > 0) run.push(pts[i - 1]); run.push(p); } else if (run.length) { run.push(p); runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  return runs;
}

/** Named places the page marks (they also prove north is up): lat and lon from the landmark draft. */
export const PLACES = [
  { id: 'india_gate', name: 'India Gate', lat: 28.612894, lon: 77.229446, note: 'the frame origin' },
  { id: 'red_fort', name: 'Red Fort', lat: 28.655547, lon: 77.240981 },
  { id: 'connaught_place', name: 'Connaught Place', lat: 28.632778, lon: 77.219722 },
];

export async function buildData(outDir = DEFAULT_OUT) {
  const areas = pilotAreas();
  const heights = await loadHeights(unionBox(areas));
  const issues = [];
  const roads = [];
  const buildings = [];
  const seen = new Set();
  let duplicates = 0;
  for (const area of areas.filter((a) => a.role === 'pilot')) {
    const ctx = loadArea(area);
    if (!ctx) continue;
    const ground = heights.gedtm ? sampler(heights.gedtm, ctx.proj) : undefined;
    const found = runRules({ district: area.id, map: ctx.map, box: ctx.box, toGeo: (x, z) => ctx.proj.toGeo(x, z), ...(ground ? { ground } : {}) });
    // the bench tiles of this district cover their own rectangle: the plan skips what lies inside it
    const hole = benchHole(area.id);
    const world = (p) => { const g = ctx.proj.toGeo(p.x, p.z); const w = geoToWorld(g.lat, g.lon, ORIGIN); const h = ground ? ground(p.x, p.z) : null; return [r1(w.x), h !== null && Number.isFinite(h) ? r1(h - DATUM) : 0, r1(w.z)]; };
    for (const road of ctx.map.roads) {
      for (const run of outsideRuns(road.pts, hole)) if (run.length >= 2) roads.push({ k: road.cls, w: Math.round(road.width * 10) / 10, p: run.flatMap(world) });
    }
    for (const b of ctx.map.buildings) if (!hole || !inRect(b.centre, hole)) buildings.push(b.ring.flatMap(world));
    const toWorld = (p) => geoToWorld(ctx.proj.toGeo(p.x, p.z).lat, ctx.proj.toGeo(p.x, p.z).lon, ORIGIN);
    for (const i of found) {
      // Where two district boxes overlap, both see the same fault under the same id. The census counted both (1,052),
      // so the later one keeps a distinct id with the district on the end; the production bake has one record.
      const id = seen.has(i.id) ? `${i.id}@${area.id}` : i.id;
      if (id !== i.id) duplicates++;
      seen.add(id);
      const w = geoToWorld(i.lat, i.lon, ORIGIN);
      const h = ground ? ground(i.x, i.z) : null;
      issues.push({
        id, rule: i.rule, block: BLOCK, district: area.id, tile: worldTile(w.x, w.z), lat: i.lat, lon: i.lon, x: r1(w.x), z: r1(w.z),
        ...(h !== null && Number.isFinite(h) ? { y: r1(h - DATUM) } : {}),
        features: i.features, impact: i.impact, confidence: i.confidence, status: autoProposal(i) ? 'auto_repaired' : 'open', note: i.note,
        proposals: i.proposals.map((p) => ({ action: p.action, params: p.params, confidence: p.confidence, reasoning: p.reasoning, preview: p.preview.map((q) => { const v = toWorld(q); return { x: r1(v.x), z: r1(v.z) }; }) })),
      });
    }
  }
  fs.mkdirSync(path.join(outDir, 'tiles'), { recursive: true });
  const file = {
    version: 1, block: BLOCK,
    source: `Phase 0 pilot census (${issues.length} issues from the rules of tools/bake/rules on the OSM extract of 2026-11-11; ${duplicates} appear twice because two district boxes overlap)`,
    rules: Object.fromEntries(CATALOGUE.map((r) => [r.id, r.title])),
    issues,
  };
  fs.writeFileSync(path.join(outDir, 'issues.json'), JSON.stringify(file));
  fs.writeFileSync(path.join(outDir, 'context.json'), JSON.stringify({ version: 1, roads, buildings }));

  // Bench tiles: their frame is the pilot district of the site, so the origin goes district metres -> geo -> block metres.
  const tiles = [];
  const sites = [{ id: 'cp', area: 'cp', label: 'Connaught Place (bench tile)' }, { id: 'ito', area: 'ito', label: 'ITO flyover (bench tile)' }];
  for (const s of sites) {
    const src = path.join(BENCH_TILES, `${s.id}.ktl`);
    if (!fs.existsSync(src)) continue;
    const ctx = loadArea(areas.find((a) => a.id === s.area));
    if (!ctx) continue;
    const bytes = fs.readFileSync(src);
    const header = JSON.parse(bytes.subarray(12, 12 + bytes.readUInt32LE(8)).toString('latin1'));
    const g = ctx.proj.toGeo(header.origin[0], header.origin[2]);
    const w = geoToWorld(g.lat, g.lon, ORIGIN);
    fs.copyFileSync(src, path.join(outDir, 'tiles', `${s.id}.ktl`));
    tiles.push({ file: `${s.id}.ktl`, x: header.tile.x, z: header.tile.z, size: header.tile.size, origin: [r1(w.x), r1(header.origin[1] - DATUM), r1(w.z)], label: s.label });
  }
  const places = PLACES.map((p) => { const w = geoToWorld(p.lat, p.lon, ORIGIN); return { id: p.id, name: p.name, x: r1(w.x), z: r1(w.z), ...(p.note ? { note: p.note } : {}) }; });
  fs.writeFileSync(path.join(outDir, 'tiles', 'index.json'), JSON.stringify({ version: 1, block: BLOCK, datum: DATUM, tiles, places }));
  return { issues: issues.length, high: issues.filter((i) => i.status === 'open' && i.impact >= 0.7).length, open: issues.filter((i) => i.status === 'open').length, tiles: tiles.length, duplicates, outDir };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--out');
  const out = at > 0 ? path.resolve(process.argv[at + 1] ?? DEFAULT_OUT) : DEFAULT_OUT;
  const t0 = Date.now();
  const r = await buildData(out);
  console.log(`inspector data: ${r.issues} issues (${r.high} high impact, ${r.open} open, ${r.duplicates} ids shared by two overlapping district boxes), ${r.tiles} tiles, ${Date.now() - t0} ms -> ${out}`);
}
