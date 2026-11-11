#!/usr/bin/env node
// Road bench driver (P0-019; ARCH_OPTIONS.md rows LN, HR, J, EL, TF). Runs the lane model prototype of
// tools/bake/roads/ on the pilot data that P0-018 fetched (data/pilot/, pinned in data/SOURCES.json):
//
//   node harness/bench/roads.mjs               bake both sites, then the Godot scene (arch.mjs roads) for the shots
//   node harness/bench/roads.mjs --no-godot    bake and check only (writes the tiles and roads_bake.json)
//   node harness/bench/roads.mjs --only ito    one site
//
// Sites: (a) the ITO flyover with its service lanes, the junction under it and the two loop ramps on the deck;
// (b) the Connaught Place inner circle with its radials, the inner circle built from the hero road spec
// harness/data/hero_roads/cp_inner_circle.json. For each site it writes a stand-in tile (T1) and the camera poses
// to game/bench/roads/gen/, a plan picture and the lane model summary to harness/reports/arch/roads/, and the
// check counts, build times and triangle counts to harness/reports/arch/roads_bake.json. The Godot run
// (harness/bench/roads.plan.mjs) folds that file into harness/reports/arch/roads.json and adds the shots.
// Ground: GEDTM30 smoothed over 60 m, the source P0-018 picked.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { fitGround } from '../../tools/bake/ground.ts';
import { encodeT1 } from '../../tools/bake/tile.ts';
import { buildSite, modelSummary } from '../../tools/bake/roads/site.ts';
import { specRefProblems } from '../../tools/bake/roads/hero.ts';
import { borderPoint } from '../../tools/bake/roads/mesh.ts';
import { ROOT, REPORTS, pilotAreas, readJson, writeJson, rel } from './pilot_data/lib.mjs';
import { loadArea, loadHeights } from './pilot_data/load.mjs';

const args = process.argv.slice(2);
const only = args.includes('--only') ? String(args[args.indexOf('--only') + 1]).split(',') : null;
const GEN = path.join(ROOT, 'game', 'bench', 'roads', 'gen');
const OUT = path.join(REPORTS, 'roads');
const HERO_DIR = path.join(ROOT, 'harness', 'data', 'hero_roads');
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Site boxes are in the district frame of their pilot area (origin at the area centre, x east, z south). */
export const SITES = [
  {
    id: 'ito', area: 'ito', name: 'ITO flyover with its service lanes',
    region: { kind: 'box', minX: 400, minZ: -560, maxX: 720, maxZ: 620 },
    classes: ['trunk', 'secondary'], clusterDist: 45,
    // left out on purpose, each a road that only touches the site: the far end of Velodrome Road's slip, a U-turn
    // link north of the flyover, and the long slip from Vikas Marg to the southbound ring road (it crosses the
    // loop ramp: a third level this prototype does not need for its checks)
    exclude: ['way/1313447926', 'way/70237516', 'way/776652308', 'way/699562875', 'way/70237518', 'way/70237521'],
    heroes: [],
  },
  {
    id: 'cp', area: 'cp', name: 'Connaught Place inner circle with its radials',
    region: { kind: 'circle', cx: 293.05, cz: -142.95, r: 186 },
    classes: ['tertiary'], clusterDist: 16, exclude: [], heroes: ['cp_inner_circle'],
  },
];

/** GEDTM30 smoothed over 60 m around a box, then put on a 10 m grid: a fast sampler in district metres. */
async function groundSampler(ctx, region) {
  const box = region.kind === 'box' ? region : { minX: region.cx - region.r, maxX: region.cx + region.r, minZ: region.cz - region.r, maxZ: region.cz + region.r };
  const heights = await loadHeights(ctx.area.bbox);
  const gd = heights.gedtm;
  if (!gd) throw new Error('data/pilot/dem/gedtm30_pilot_window.json is missing: run node harness/bench/pilot_data/fetch.mjs first');
  const all = [];
  for (let j = 0; j < gd.height; j++) {
    for (let i = 0; i < gd.width; i++) {
      const p = ctx.proj.toWorld(gd.north + (j + 0.5) * gd.dLat, gd.west + (i + 0.5) * gd.dLon);
      if (p.x < box.minX - 300 || p.x > box.maxX + 300 || p.z < box.minZ - 300 || p.z > box.maxZ + 300) continue;
      const h = gd.data[j * gd.width + i];
      if (Number.isFinite(h)) all.push({ x: p.x, z: p.z, h });
    }
  }
  const fit = fitGround(all, { sigma: 60, dropAbove: Infinity, passes: 1 }).at;
  const cell = 10;
  const x0 = box.minX - 80;
  const z0 = box.minZ - 80;
  const cols = Math.ceil((box.maxX - box.minX + 160) / cell) + 1;
  const rows = Math.ceil((box.maxZ - box.minZ + 160) / cell) + 1;
  const grid = new Float64Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) grid[j * cols + i] = fit(x0 + i * cell, z0 + j * cell) ?? 210;
  const at = (x, z) => {
    const fx = Math.max(0, Math.min(cols - 1.001, (x - x0) / cell));
    const fz = Math.max(0, Math.min(rows - 1.001, (z - z0) / cell));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    return (grid[j * cols + i] * (1 - u) + grid[j * cols + i + 1] * u) * (1 - v) + (grid[(j + 1) * cols + i] * (1 - u) + grid[(j + 1) * cols + i + 1] * u) * v;
  };
  return { at, samples: all.length };
}

const LANE_FILL = { drive: '#4a4a50', parking: '#6a6a72', gore: '#8a7f5a', kerb: '#c9c5bb', footpath: '#b9ad98', planter: '#6f9a55', median: '#9aa38c' };

/** A north-up plan of the lane model: lanes by type, structures tinted, junction rings, lane lines, the gores. */
async function renderPlan(file, r, title) {
  const ring = r.site.region.kind === 'box' ? r.site.region : { minX: r.site.region.cx - r.site.region.r, maxX: r.site.region.cx + r.site.region.r, minZ: r.site.region.cz - r.site.region.r, maxZ: r.site.region.cz + r.site.region.r };
  const pad = 20;
  const w = ring.maxX - ring.minX + 2 * pad;
  const h = ring.maxZ - ring.minZ + 2 * pad;
  const scale = Math.min(2400 / w, 3000 / h);
  const X = (x) => ((x - ring.minX + pad) * scale).toFixed(1);
  const Z = (z) => ((z - ring.minZ + pad) * scale + 40).toFixed(1);
  const o = [`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * scale)}" height="${Math.round(h * scale) + 40}" font-family="Helvetica, Arial, sans-serif"><rect width="100%" height="100%" fill="#7d8a66"/>`];
  const poly = (pts, fill, extra = '') => o.push(`<polygon points="${pts.map((p) => `${X(p.x)},${Z(p.z)}`).join(' ')}" fill="${fill}" ${extra}/>`);
  // at grade first, structures on top
  for (const level of [0, 1]) {
    r.strips.forEach((s) => {
      for (let i = 0; i + 1 < s.st.length; i++) {
        const p = s.st[i];
        const q = s.st[i + 1];
        const up = p.structure > 0 || q.structure > 0;
        if ((level === 1) !== up) continue;
        s.lanes.forEach((l, k) => {
          let fill = LANE_FILL[l.type];
          if (up && l.type === 'drive') fill = '#5a5f78';
          if (up && l.type === 'kerb') fill = '#e4e0d6';
          poly([borderPoint(p, k), borderPoint(p, k + 1), borderPoint(q, k + 1), borderPoint(q, k)], fill, `stroke="${fill}" stroke-width="0.4"`);
        });
      }
    });
    if (level === 0) {
      for (const j of r.junctions) {
        poly(j.ring, j.method === 'J1' ? '#4a4a50' : '#70504a', 'stroke="#2c2c30" stroke-width="0.5"');
        for (const b of j.bands) poly(b.ring, '#b9ad98', 'stroke="#8d8576" stroke-width="0.5"');
      }
    }
  }
  // lane lines
  for (const s of r.strips) {
    for (let k = 1; k < s.lanes.length; k++) {
      const a = s.lanes[k - 1];
      const b = s.lanes[k];
      if (a.type !== 'drive' && b.type !== 'drive') continue;
      const dashed = a.type === 'drive' && b.type === 'drive' && a.dir === b.dir;
      o.push(`<polyline points="${s.st.map((st) => { const p = borderPoint(st, k); return `${X(p.x)},${Z(p.z)}`; }).join(' ')}" fill="none" stroke="#f2f2ee" stroke-width="${Math.max(0.6, 0.14 * scale)}" ${dashed ? `stroke-dasharray="${(3 * scale).toFixed(1)} ${(4.5 * scale).toFixed(1)}"` : ''}/>`);
    }
  }
  for (const z of r.zones) {
    const st = z.strip.st[z.strip.st.length - 1];
    o.push(`<circle cx="${X(st.x)}" cy="${Z(st.z)}" r="5" fill="none" stroke="#ffd23f" stroke-width="2"/><text x="${(+X(st.x) + 8).toFixed(1)}" y="${Z(st.z)}" font-size="13" fill="#ffd23f">${z.kind} nose ${round(z.dNose, 0)} m</text>`);
  }
  for (const a of r.abutments) o.push(`<rect x="${(+X(a.x) - 3).toFixed(1)}" y="${(+Z(a.z) - 3).toFixed(1)}" width="6" height="6" fill="#ff5a5a"/>`);
  o.push(`<rect width="100%" height="36" fill="#1d1f24"/><text x="12" y="24" font-size="18" fill="#fff">${title}</text>`);
  const nx = Math.round(w * scale) - 40;
  o.push(`<polygon points="${nx},48 ${nx - 9},78 ${nx},71 ${nx + 9},78" fill="#fff"/><text x="${nx - 6}" y="96" font-size="16" font-weight="bold" fill="#fff">N</text>`);
  o.push(`<rect x="14" y="${Math.round(h * scale) + 22}" width="${(50 * scale).toFixed(1)}" height="5" fill="#fff"/><text x="14" y="${Math.round(h * scale) + 16}" font-size="13" fill="#fff">50 m</text></svg>`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp(Buffer.from(o.join('\n')), { limitInputPixels: false }).png().toFile(file);
}

/** Camera poses of a site, in tile metres (the scene adds nothing): tops look straight down with north up. */
function poses(r) {
  const o = r.tile.origin;
  const loc = (x, y, z) => [round(x - o[0], 2), round(y - o[1], 2), round(z - o[2], 2)];
  const out = [];
  const reg = r.site.region;
  const cx = reg.kind === 'box' ? (reg.minX + reg.maxX) / 2 : reg.cx;
  const cz = reg.kind === 'box' ? (reg.minZ + reg.maxZ) / 2 : reg.cz;
  const span = reg.kind === 'box' ? Math.max((reg.maxZ - reg.minZ) / 1.0, (reg.maxX - reg.minX) / 1.6) : reg.r * 2;
  const ground = r.strips[0].st[0].g;
  out.push({ name: 'top', kind: 'top', pos: loc(cx, ground + 400, cz), target: loc(cx, ground, cz), size: round(span * 1.06, 1), note: 'the whole site from above, north up' });
  const eye = (name, from, to, note, fov = 62) => out.push({ name, kind: 'eye', pos: loc(...from), target: loc(...to), size: fov, note });
  const point = (st, lateral, up) => [st.x + st.nx * lateral, st.h + up, st.z + st.nz * lateral];
  r.zones.forEach((z, i) => {
    const mid = z.strip.st[Math.floor(z.strip.st.length / 2)];
    out.push({ name: `zone${i}_top`, kind: 'top', pos: loc(mid.x, mid.h + 200, mid.z), target: loc(mid.x, mid.h, mid.z), size: round(Math.max(70, z.dNose * 1.9), 1), note: `${z.kind} at node ${z.node} from above: taper, shared lane line, gore, nose` });
    // at driver height on the parent side, looking along the zone to the nose
    const first = z.strip.st[0];
    const last = z.strip.st[z.strip.st.length - 1];
    const dx = last.x - first.x;
    const dz = last.z - first.z;
    const len = Math.hypot(dx, dz) || 1;
    const back = z.kind === 'diverge' ? 28 : -Math.min(60, z.dNose + 30);
    const from = [first.x - (dx / len) * back, first.h + 1.5, first.z - (dz / len) * back];
    const to = z.kind === 'diverge' ? [last.x + (dx / len) * 40, last.h + 1.5, last.z + (dz / len) * 40] : [first.x - (dx / len) * 40, first.h + 1, first.z - (dz / len) * 40];
    if (z.kind === 'merge') {
      // a merge is seen from the branch side, driving towards the node
      const h = last.h;
      eye(`zone${i}_eye`, [last.x + (dx / len) * 22, h + 1.5, last.z + (dz / len) * 22], [first.x, first.h + 0.5, first.z], `${z.kind} at node ${z.node} at driver height, driving into the merge`);
    } else eye(`zone${i}_eye`, from, to, `${z.kind} at node ${z.node} at driver height, driving towards the nose`);
  });
  r.junctions.forEach((j, i) => {
    const reach = Math.max(...j.ring.map((v) => Math.hypot(v.x - j.centre.x, v.z - j.centre.z)));
    out.push({ name: `junction${i}_top`, kind: 'top', pos: loc(j.centre.x, j.h + 200, j.centre.z), target: loc(j.centre.x, j.h, j.centre.z), size: round(Math.max(50, reach * 2.6), 1), note: `junction ${j.id} (${j.method}) from above` });
  });
  return { out, eye, point, loc };
}

async function bakeSite(def, areas) {
  const area = areas.find((a) => a.id === def.area);
  const ctx = loadArea(area);
  if (!ctx) throw new Error(`data/pilot/osm/${def.area}.json is missing: run node harness/bench/pilot_data/fetch.mjs first`);
  const ground = await groundSampler(ctx, def.region);
  const heroes = def.heroes.map((id) => readJson(path.join(HERO_DIR, `${id}.json`)));
  const site = { id: def.id, name: def.name, region: def.region, classes: def.classes, exclude: def.exclude, clusterDist: def.clusterDist };
  // three runs: the first warms the code up, the report takes the fastest of the other two
  let r = null;
  const totals = [];
  for (let run = 0; run < 3; run++) {
    r = buildSite({ site, roads: ctx.map.roads, ground: ground.at, heroes });
    totals.push(r.ms.total);
  }
  const p = poses(r);
  const st = (s, i) => s.st[Math.max(0, Math.min(s.st.length - 1, i))];
  if (def.id === 'ito') {
    // the flyover in profile, and the deck seen from the junction under it
    const deck = r.strips.filter((s) => s.st.some((x) => x.structure === 2));
    const top = deck.flatMap((s) => s.st).reduce((a, b) => (b.h - b.g > a.h - a.g ? b : a));
    p.out.push({ name: 'interchange_top', kind: 'top', pos: p.loc(top.x + 40, top.g + 300, top.z), target: p.loc(top.x + 40, top.g, top.z), size: 330, note: 'the interchange from above, north up: the two decks over the junction, the service lanes beside them, the loop ramps' });
    p.eye('flyover_side', [top.x - 150, top.g + 38, top.z + 90], [top.x + 10, top.g + 3, top.z - 20], 'the flyover from the west: the decks climb over the junction, the service lanes stay on the ground', 55);
    p.eye('under_deck', [top.x - 62, top.g + 1.6, top.z + 6], [top.x + 30, top.g + 4, top.z - 4], 'driver height on the cross street, looking under the decks', 70);
    const nb = r.zones.filter((z) => z.kind === 'diverge').sort((p, q) => q.strip.st[0].z - p.strip.st[0].z)[0];
    if (nb) {
      // the northbound diverge at the foot of the flyover: the service lanes leave to the left and stay on the
      // ground, the flyover lanes climb ahead
      const zs = nb.strip.st;
      const a = zs[0];
      const b = zs[zs.length - 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      const k = Math.max(0, zs.findIndex((x) => x.s >= nb.dPainted - 35));
      const at = zs[k];
      p.eye('climb_eye', [at.x - at.nx * 3, at.h + 1.5, at.z - at.nz * 3], [b.x + (dx / len) * 70, b.h + 2.5, b.z + (dz / len) * 70], 'driver height in the flyover lanes, 35 m before the painted nose: the gore ahead, the service lanes leave to the left and stay at grade, the flyover climbs', 60);
      p.eye('climb_oblique', [a.x - (dx / len) * 30 + a.nx * 10, a.h + 16, a.z - (dz / len) * 30 + a.nz * 10], [b.x + (dx / len) * 110, b.h + 3, b.z + (dz / len) * 110], 'the same diverge from 16 m up: taper, shared lane line, gore and nose, then the flyover climbing while the service lanes stay at grade', 55);
    }
  }
  if (def.id === 'cp') {
    const hero = r.strips.filter((s) => s.hero);
    // the reference pose of the spec: from the flower bed on the park side, across the carriageway to the colonnade
    const s = hero.reduce((a, b) => (b.st.length > a.st.length ? b : a));
    const at = Math.floor(s.st.length * 0.55);
    const m = st(s, at);
    const L = s.lanes.length;
    const from = p.point(m, (m.b[L - 2] + m.b[L - 1]) / 2, 0.15 + 1.5);
    // traffic passes from left to right in the photo: the view is across the road and a little upstream
    const up = st(s, at - 12);
    const to = p.point(up, up.b[0] + 1, 2.6);
    p.out.push({ name: 'hero_across', kind: 'eye', pos: p.loc(...from), target: p.loc(...to), size: 69, portrait: true, note: 'hero road pose matched to the reference photo cp_empty_road_2020: from the park side flower bed across the carriageway to the colonnade' });
    const j = r.junctions.find((x) => x.nodes.includes(1191294765)) || r.junctions[0];
    const arm = j.arms.map((a) => r.strips[a.strip]).find((x) => !x.hero);
    if (arm) {
      const away = (x) => Math.hypot(x.x - j.centre.x, x.z - j.centre.z);
      const far = away(arm.st[0]) > away(arm.st[arm.st.length - 1]) ? arm.st[0] : arm.st[arm.st.length - 1];
      const near = far === arm.st[0] ? arm.st[arm.st.length - 1] : arm.st[0];
      const dx = near.x - far.x;
      const dz = near.z - far.z;
      const len = Math.hypot(dx, dz) || 1;
      p.eye('radial_eye', [near.x - (dx / len) * 22, near.h + 1.5, near.z - (dz / len) * 22], [j.centre.x + (dx / len) * 30, j.h + 2, j.centre.z + (dz / len) * 30], 'driver height on Radial Road 1, driving into the inner circle: one junction surface, corner radii, the colonnade ahead', 62);
    }
    p.eye('circle_oblique', [j.centre.x + 60, j.h + 55, j.centre.z + 120], [j.centre.x - 10, j.h, j.centre.z - 30], 'the radial junction and the inner circle from above the outer blocks', 55);
  }
  fs.mkdirSync(GEN, { recursive: true });
  fs.writeFileSync(path.join(GEN, '.gdignore'), '');
  const bytes = encodeT1(r.tile);
  fs.writeFileSync(path.join(GEN, `${def.id}.ktl`), bytes);
  const o = r.tile.origin;
  writeJson(path.join(GEN, `${def.id}.json`), {
    site: def.id, name: def.name, tile: `${def.id}.ktl`, origin: o, poses: p.out,
    probes: r.probes.map((q) => ({ x: round(q.x - o[0], 3), y: round(q.y - o[1], 4), z: round(q.z - o[2], 3), what: q.what })),
  });
  await renderPlan(path.join(OUT, `${def.id}_plan.png`), r, `${def.name}: lane model plan (north up). Grey: lanes at grade, blue grey: on a structure, khaki: gore, red squares: abutments`);
  writeJson(path.join(OUT, `${def.id}_model.json`), modelSummary(r), false);
  const heroRefs = heroes.map((h) => {
    const refs = specRefProblems(h);
    return { spec: h.id, status: h.status, fieldsWithReferences: refs.fields, photos: Object.keys(h.refs).length, withoutReference: refs.problems };
  });
  const c = r.checks;
  return {
    id: def.id, name: def.name, area: def.area, region: def.region, classes: def.classes, excluded: def.exclude, osmBase: ctx.osmBase,
    ground: { source: 'GEDTM30 v1.2 smoothed over 60 m (the P0-018 pick), on a 10 m grid', samples: ground.samples },
    buildMs: { best: Math.min(...totals.slice(1)), runs: totals, steps: r.ms, note: 'the whole bake of the site in one Node process: graph to tile and checks; the first run includes code warm-up' },
    solver: r.solve,
    fit: r.fit,
    stats: r.stats,
    checks: {
      overlapAreaM2: c.overlap.areaM2, overlapPairs: c.overlap.pairs,
      laneContinuityBreaks: c.continuity.breaks,
      taperViolations: c.tapers.violations, taperViolationsByClass: c.tapers.byClass,
      nodeHeightSteps: c.heights.steps,
      gradeViolations: c.heights.gradeViolations, clearanceViolations: c.overlap.clearanceViolations,
      roadToGroundGapMaxM: { tf1: c.groundGap.tf1.maxM, tf2: c.groundGap.tf2.maxM },
      floatingSegments: c.heights.floating, sunkSegments: c.heights.sunk,
      heroSpecMismatches: c.hero.reduce((s, h) => s + h.mismatches, 0),
      heroFieldsWithoutReference: heroRefs.reduce((s, h) => s + h.withoutReference.length, 0),
      openMeshBoundaryEdges: c.mesh.openBoundaryEdges, edgeColliderVerticesMissing: c.colliders.missing,
    },
    detail: {
      overlap: c.overlap, continuity: c.continuity, tapers: c.tapers, heights: c.heights, groundGap: c.groundGap, hero: c.hero, heroRefs, colliders: c.colliders, mesh: c.mesh,
    },
    zones: r.zones.map((z) => ({ id: z.strip.id, kind: z.kind, node: z.node, paintedNoseM: round(z.dPainted, 1), physicalNoseM: round(z.dNose, 1), lanes: z.strip.lanes.filter((l) => l.type === 'drive').length })),
    junctions: r.junctions.map((j) => ({ id: j.id, method: j.method, nodes: j.nodes.length, arms: j.arms.length, corners: j.corners, bands: j.bands.length, connections: j.connections.length, why: j.why || null })),
    pairs: r.pairs.map(([a, b]) => [r.graph.edges[a].id, r.graph.edges[b].id]),
    abutments: r.abutments,
    problems: r.problems,
    files: { tile: rel(path.join(GEN, `${def.id}.ktl`)), tileBytes: bytes.length, poses: rel(path.join(GEN, `${def.id}.json`)), plan: rel(path.join(OUT, `${def.id}_plan.png`)), model: rel(path.join(OUT, `${def.id}_model.json`)) },
  };
}

async function main() {
  const areas = pilotAreas();
  const bakeFile = path.join(REPORTS, 'roads_bake.json');
  const prev = readJson(bakeFile, { sites: {} });
  const sites = { ...(prev.sites || {}) };
  for (const def of SITES) {
    if (only && !only.includes(def.id)) continue;
    const row = await bakeSite(def, areas);
    sites[def.id] = row;
    const c = row.checks;
    console.log(`[roads] ${def.id}: ${row.buildMs.best} ms, ${row.stats.triangles} triangles (${row.stats.strips} strips, ${row.stats.zones} zones, ${row.stats.junctionsJ1} J1 + ${row.stats.junctionsJ2} J2 junctions)`);
    console.log(`  overlap ${c.overlapAreaM2} m2, continuity breaks ${c.laneContinuityBreaks}, taper violations ${c.taperViolations}, height steps ${c.nodeHeightSteps}, grade ${c.gradeViolations}, clearance ${c.clearanceViolations}, gap TF1 ${c.roadToGroundGapMaxM.tf1} m TF2 ${c.roadToGroundGapMaxM.tf2} m, floating ${c.floatingSegments} sunk ${c.sunkSegments}, hero mismatches ${c.heroSpecMismatches}, open edges ${c.openMeshBoundaryEdges}`);
    for (const p of row.problems) console.log(`  problem: ${p}`);
  }
  writeJson(bakeFile, { writtenBy: 'node harness/bench/roads.mjs', at: new Date().toISOString(), node: process.version, sites });
  console.log(`wrote ${rel(bakeFile)}`);
  if (args.includes('--no-godot')) return;
  const res = spawnSync(process.execPath, [path.join(ROOT, 'harness', 'bench', 'arch.mjs'), 'roads', ...(only ? ['--only', only.join(',')] : [])], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((e) => {
    console.error(e.stack || e.message);
    process.exit(1);
  });
}
