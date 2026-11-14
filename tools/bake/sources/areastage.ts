// The area generator steps of the bake (P2-009): the files side of tools/bake/areas/generator.ts.
//   runParcelStep  in the terrain step, after the landmark placement and before the ground: reads the area data
//                  (harness/data/areas/), the blueprints (harness/data/blueprints/*.json) and the keep list
//                  (harness/data/areas/footprint_keep.json), plans the parcels and puts them in place of the repaired
//                  footprints (`repaired.footprints` changes in place, as the clear step and the landmarks do).
//   runCityStep    in the tile step, on the built ground: buildings, shells and facade placements, the checks, and
//                  the reports and pictures under harness/reports/map/areas/.
// The area data is drawn in the frame of the centre block (origin India Gate); a stage of another block gets no
// generator and keeps the plain shells.
import fs from 'node:fs';
import path from 'node:path';
import { geoToWorld, worldToGeo } from '../../geo/projection.ts';
import type { Transect } from '../areas/blend.ts';
import { checkBlueprint } from '../areas/blueprints.ts';
import type { Blueprint } from '../areas/blueprints.ts';
import { INSTANCE_BYTES, PLACEMENT_BUDGET_BYTES, blendTransects, generateCity, planParcels } from '../areas/generator.ts';
import type { CityResult, ParcelPlan } from '../areas/generator.ts';
import { AREA_LIMITS, areaInvariants, mb } from '../areas/checks.ts';
import type { AreasRecord } from '../areas/checks.ts';
import { buildIndex, checkData, parseAreaFiles } from '../areas/profiles.ts';
import type { AreaData } from '../areas/profiles.ts';
import { citySvg, transectSvg } from '../areas/render.ts';
import type { P2 } from '../geom.ts';
import { ringCentroid } from '../geom.ts';
import type { RoadMesh } from '../mesh/build.ts';
import type { MeshInput } from '../mesh/input.ts';
import { faceIndex, leftOnRoad, roadFace } from '../repair/clear.ts';
import type { RepairedGraph } from '../repair/engine.ts';
import type { InvariantResult } from '../report/health.ts';
import { MEET_NONE, meetOf } from '../terrain/collect.ts';
import { writePicture } from './graphinput.ts';
import type { StepContext } from './meshstage.ts';

const clock = (globalThis as unknown as { performance: { now(): number } }).performance;
const AREAS_DIR = path.join('harness', 'data', 'areas');
const BLUEPRINT_DIR = path.join('harness', 'data', 'blueprints');
/** The block whose frame the area data is drawn in. */
export const AREA_BLOCK = 'centre';
export interface AreaStep {
  plan: ParcelPlan;
  data: AreaData;
  rec: AreasRecord;
  reportDir: string;
}

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir).slice().sort()) {
    const p = path.join(dir, name);
    if (/\.(json|geojson)$/.test(name)) out.push(p);
    else if (!name.includes('.')) walk(p, out);
  }
  return out;
}

/** The area data, the blueprints and the keep list from disk; null when the repo has no area data. */
export function readAreaFiles(root: string): { data: AreaData; blueprints: Blueprint[]; blueprintFiles: number; keep: Set<string>; transects: { id: string; name: string; area: string; from: [number, number]; to: [number, number] }[] } | null {
  const dir = path.join(root, AREAS_DIR);
  if (!fs.existsSync(path.join(dir, 'areas.geojson'))) return null;
  const files: Record<string, string> = {};
  for (const f of walk(dir)) if (/\.(json|geojson)$/.test(f)) files[path.relative(root, f).split(path.sep).join('/')] = fs.readFileSync(f, 'utf8');
  const data = parseAreaFiles(files);
  const problems = checkData(data);
  if (problems.length) throw new Error(`area data: ${problems.length} problems, first: ${problems[0]}`);
  const areaIds = new Set(data.areas.features.map((f) => f.properties.id));
  const blueprints: Blueprint[] = [];
  let blueprintFiles = 0;
  const bdir = path.join(root, BLUEPRINT_DIR);
  if (fs.existsSync(bdir)) {
    for (const name of fs.readdirSync(bdir).sort()) {
      if (!name.endsWith('.json') || name.startsWith('_')) continue;
      const bp = JSON.parse(fs.readFileSync(path.join(bdir, name), 'utf8')) as Blueprint;
      const bad = checkBlueprint(bp, `harness/data/blueprints/${name}`, areaIds, data.palette);
      if (bad.length) throw new Error(`blueprint: ${bad.length} problems, first: ${bad[0]}`);
      blueprints.push(bp);
      blueprintFiles++;
    }
  }
  const keepFile = path.join(dir, 'footprint_keep.json');
  const keep = new Set<string>(fs.existsSync(keepFile) ? Object.keys((JSON.parse(fs.readFileSync(keepFile, 'utf8')) as { keep?: Record<string, string> }).keep ?? {}) : []);
  const tFile = path.join(dir, 'transects.json');
  const transects = fs.existsSync(tFile) ? (JSON.parse(fs.readFileSync(tFile, 'utf8')) as { transects: { id: string; name: string; area: string; from: [number, number]; to: [number, number] }[] }).transects : [];
  return { data, blueprints, blueprintFiles, keep, transects };
}

/** Rings of the road mesh's faces: the ones the ground meets, and all of them (the decks too). */
function faceRings(meshed: { input: MeshInput; mesh: RoadMesh }): { ground: P2[][]; all: P2[][] } {
  const faces = meshed.mesh.fs;
  const meet = { fs: faces, strips: meshed.input.strips, kinds: meshed.input.kinds };
  const ground: P2[][] = [];
  const all: P2[][] = [];
  for (let f = 0; f < faces.faces; f++) {
    const ring: P2[] = [];
    const start = faces.start[f] as number;
    for (let k = 0; k < (faces.len[f] as number); k++) {
      const v = faces.ids[start + k] as number;
      ring.push({ x: faces.vx[v] as number, z: faces.vz[v] as number });
    }
    if (ring.length < 3) continue;
    all.push(ring);
    if (meetOf(meet, f) !== MEET_NONE) ground.push(ring);
  }
  return { ground, all };
}

/**
 * Part one. Changes `repaired.footprints` in place. Null when the stage is not in the block the area data is drawn
 * for, or the repo has no area data.
 */
export function runParcelStep(ctx: StepContext, meshed: { input: MeshInput; mesh: RoadMesh }, repaired: RepairedGraph, zones: readonly (readonly P2[])[], reportDir: string): AreaStep | null {
  if (ctx.plan.def.block !== AREA_BLOCK) {
    ctx.log(`[areas] the area data is drawn for block ${AREA_BLOCK}: stage ${ctx.plan.id} (block ${ctx.plan.def.block}) keeps the plain shells`);
    return null;
  }
  const read = readAreaFiles(ctx.root);
  if (!read) return null;
  const t0 = clock.now();
  const origin = ctx.plan.origin;
  // the area files are drawn with tools/geo/projection.ts at the block's origin
  const proj = (lon: number, lat: number): P2 => projectAt(lat, lon, origin);
  const rings = faceRings(meshed);
  const f = repaired.features;
  const map = {
    footprints: repaired.footprints, roadFaces: rings.ground, allFaces: rings.all,
    edges: repaired.edges.map((e) => ({ id: e.id, pts: e.pts, width: e.road.width, cls: e.road.cls })), rail: f.rail.map((l) => l.pts), water: f.water.flatMap((w) => w.rings.slice(0, 1)),
    open: f.open.flatMap((o) => o.rings.slice(0, 1)), walk: (f.walkways ?? []).filter((w) => w.area).flatMap((w) => (w.rings ?? [w.pts]).slice(0, 1)),
    walkLines: (f.walkways ?? []).filter((w) => !w.area).map((w) => ({ pts: w.pts, width: w.width })), waterLines: f.waterLines.map((l) => l.pts), zones, outline: repaired.outline, offset: ctx.offset,
  };
  // a developer aid: KALESH_AREAS_DUMP=<file> keeps the map side of the generator's input, so tools/bake/areas/try.mjs
  // can run the generator alone in seconds while a profile or a rule is tuned
  const dump = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env?.['KALESH_AREAS_DUMP'];
  if (dump) fs.writeFileSync(dump, JSON.stringify({ origin, ...map }));
  const plan = planParcels({ ...map, data: read.data, project: proj, blueprints: read.blueprints, keep: read.keep });
  repaired.footprints = plan.footprints;
  const dir = path.join(reportDir, 'areas');
  fs.mkdirSync(dir, { recursive: true });
  const world = <T extends { x: number; z: number }>(l: T): T => ({ ...l, x: Math.round((l.x + ctx.offset.x) * 100) / 100, z: Math.round((l.z + ctx.offset.z) * 100) / 100 });
  const oddFile = path.join(dir, 'odd_footprints.json');
  fs.writeFileSync(oddFile, JSON.stringify({
    _doc: 'The odd-footprint check of the last bake (P2-009, tools/bake/areas/oddshapes.ts): slivers, spikes, outlines that cross themselves, machine-made wobble and outliers of size or height. action: dropped, regularised (the new outline is in the tiles), flagged (kept as it is: check it against photos or the satellite view) or kept (on the keep list harness/data/areas/footprint_keep.json). x, z are world metres. The map inspector shows these as their own issue kind.',
    stage: ctx.plan.id, counts: plan.odd.counts, lines: plan.odd.lines.map(world),
  }) + '\n');
  const parcelFile = path.join(dir, 'parcels.json');
  fs.writeFileSync(parcelFile, JSON.stringify({
    _doc: 'The parcels of the last bake (P2-009, tools/bake/areas/generator.ts planParcels): what the blueprints placed and replaced, and the lots cut from block faces where a street row had a hole. x, z are world metres.',
    stage: ctx.plan.id, counts: plan.counts, infill: plan.infill.stats, blueprints: plan.blueprint.lines.map(world),
    lots: plan.infill.lots.map((l) => ({ id: l.id, profile: l.profile, edge: l.edge, widthM: l.widthM, depthM: l.depthM, areaM2: l.area, ...world(ringCentroid(l.ring)) })),
  }) + '\n');
  const ms = Math.round(clock.now() - t0);
  const rec: AreasRecord = {
    stage: ctx.plan.id, parcels: plan.counts, odd: plan.odd.counts, infill: plan.infill.stats, blueprints: { files: read.blueprintFiles, blocks: plan.blueprint.blocks, replaced: plan.blueprint.replaced },
    placementBudgetBytes: PLACEMENT_BUDGET_BYTES, files: { odd: path.relative(ctx.root, oddFile), parcels: path.relative(ctx.root, parcelFile) }, ms: { parcels: ms, city: 0, parts: { ...plan.ms } },
  };
  const c = plan.counts;
  const o = plan.odd.counts;
  ctx.log(`[areas] parcels: ${c.in} footprints in, ${c.out} parcels out: ${c.blueprintBlocks} blueprint blocks (${c.replacedByBlueprint} footprints replaced, ${read.blueprintFiles} files), ${c.lots} lots cut from block faces (${plan.infill.stats.holes} holes in street rows, ${plan.infill.stats.holeM} m; ${plan.infill.stats.tooLong} free stretches over 60 m left as open ground, ${plan.infill.stats.rejected} lots had no room); free frontage left in the wall-to-wall profiles ${plan.infill.stats.leftFreeM} m, ${plan.infill.stats.leftOver40} stretches of 40 m or more (longest ${plan.infill.stats.leftLongestM} m)`);
  ctx.log(`[areas] odd footprints: ${o.checked} checked: ${o.dropped} dropped, ${o.regularised} regularised, ${o.flagged} flagged, ${o.kept} on the keep list (sliver ${o.sliver}, spike ${o.spike}, self overlap ${o.self_overlap}, zigzag ${o.zigzag}, size ${o.size}, height ${o.height}); ${ms} ms (${Object.entries(plan.ms).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  return { plan, data: read.data, rec, reportDir: dir };
}

function projectAt(lat: number, lon: number, origin: { lat: number; lon: number }): P2 {
  const w = geoToWorld(lat, lon, origin);
  return { x: w.x, z: w.z };
}

/** Top views drawn on a whole bake: name, the area whose box it shows, and half the side (m). */
export const AREA_VIEWS: readonly { id: string; name: string; area: string; halfM: number }[] = [
  { id: 'chandni_chowk', name: 'Chandni Chowk, the galis', area: 'chandni_chowk_galis', halfM: 190 },
  { id: 'paharganj', name: 'Paharganj and the station', area: 'paharganj_station', halfM: 260 },
  { id: 'ito', name: 'ITO', area: 'ito', halfM: 330 },
  { id: 'cp_edge', name: 'Connaught Place, the outer circle and beyond', area: 'cp_outer_circle', halfM: 520 },
];

/** Part two: on the built ground. Returns the shells and placements for the tile writer, the record and the checks. */
export async function runCityStep(
  ctx: StepContext, step: AreaStep, ground: (x: number, z: number) => number, model: (x: number, z: number) => number, meshed: { input: MeshInput; mesh: RoadMesh }, repaired: RepairedGraph, zones: readonly (readonly P2[])[],
): Promise<{ city: CityResult; rec: AreasRecord; invariants: InvariantResult[] }> {
  const t0 = clock.now();
  const { plan, rec } = step;
  const city = generateCity(plan, ground, model);
  const origin = ctx.plan.origin;
  const read = readAreaFiles(ctx.root);
  const transects: Transect[] = blendTransects(plan, (read?.transects ?? []).map((t) => ({ id: t.id, name: t.name, area: t.area, a: projectAt(t.from[1], t.from[0], origin), b: projectAt(t.to[1], t.to[0], origin) })));
  // no shell on a road face
  const rings = faceRings(meshed);
  const left = leftOnRoad(plan.footprints, faceIndex(rings.ground.map((r) => roadFace(r))));
  rec.city = city.stats;
  rec.transects = transects.map((t) => ({ id: t.id, name: t.name, area: t.area, samples: t.samples.length, maxStep: Math.round(t.maxStep * 1000) / 1000, maxRise: Math.round(t.maxRise * 1000) / 1000, from: Math.round(t.from * 1000) / 1000, to: Math.round(t.to * 1000) / 1000 }));
  rec.offRoad = { count: left.count, areaM2: left.areaM2 };
  const dir = step.reportDir;
  const file = path.join(dir, 'generator.json');
  const s = city.stats;
  fs.writeFileSync(file, JSON.stringify({
    _doc: 'The area generator of the last bake (P2-009, tools/bake/areas/generator.ts generateCity). profiles: per profile the shells that follow it, the floor histogram of the shells whose footprint can carry any draw (`free`, index = floors) and its distance to the profile (half the sum of absolute differences of shares; limit 0.1 from 40 shells), the same over every drawn shell (`distanceAll`: small footprints are held down), the types. transects: the profile mix every 25 m (weights sum to 1). lines: parcels with no shell.',
    stage: ctx.plan.id, limits: AREA_LIMITS, stats: s, transects: transects.map((t) => ({ ...t, samples: t.samples.map((x) => ({ at: x.at, ...geoOf(x.x, x.z, origin), step: Math.round(x.step * 1000) / 1000, weights: x.weights.map((w) => ({ key: w.key, w: Math.round(w.w * 1000) / 1000 })) })) })),
    lines: city.lines,
  }) + '\n');
  rec.files['generator'] = path.relative(ctx.root, file);
  if (!ctx.quick) {
    const index = buildIndex(step.data, (lon, lat) => projectAt(lat, lon, origin));
    const regularised = new Set(plan.odd.lines.filter((l) => l.action === 'regularised').map((l) => l.id));
    const map = {
      roads: repaired.edges.map((e) => ({ pts: e.pts, width: e.road.width })), parcels: plan.footprints, plans: city.plans, regularised,
      areas: index.areas.map((a) => ({ id: a.id, rings: a.rings })), zones, transects,
    };
    const rel = path.relative(ctx.root, dir).split(path.sep).join('/');
    const pictures: string[] = [];
    for (const v of AREA_VIEWS) {
      const a = index.areas.find((x) => x.id === v.area);
      if (!a) continue;
      const cx = (a.box[0] + a.box[1]) / 2;
      const cz = (a.box[2] + a.box[3]) / 2;
      pictures.push(...(await writePicture(ctx.root, `${rel}/generator_${ctx.plan.id}_${v.id}.png`, citySvg(map, { minX: cx - v.halfM, maxX: cx + v.halfM, minZ: cz - v.halfM, maxZ: cz + v.halfM }, `${v.name}: generated buildings, north up (${ctx.plan.id})`), 2400)));
    }
    if (transects.length) pictures.push(...(await writePicture(ctx.root, `${rel}/blend_${ctx.plan.id}.png`, transectSvg(transects, `Edge blending: the profile mix every 25 m along each transect (${ctx.plan.id})`), 1800)));
    rec.files['pictures'] = pictures;
  }
  rec.ms.city = Math.round(clock.now() - t0);
  for (const [k, v] of Object.entries(s.ms)) rec.ms.parts[`city_${k}`] = v;
  const p = s.placements;
  ctx.log(`[areas] buildings: ${s.shells} shells for ${s.parcels} parcels (${s.notAShape} not a shape), ${s.triangles} triangles; heights from ${Object.entries(s.byFrom).map(([k, v]) => `${k} ${v}`).join(', ')}; roofs ${Object.entries(s.byRoof).map(([k, v]) => `${k} ${v}`).join(', ')}; ${s.byProfileKind['area'] ?? 0} follow a drawn area, ${s.byProfileKind['rule'] ?? 0} a rule archetype`);
  ctx.log(`[areas] OSM tags: ${s.tagged} buildings with a height or levels tag, largest difference ${s.tagMaxFloorDiff} floors, ${s.tagOverOne} over 1 floor`);
  for (const pr of s.profiles) ctx.log(`[areas] ${pr.key}: ${pr.shells} shells; ${pr.drawn} drew floors: p10 ${pr.p10}, p50 ${pr.p50}, p90 ${pr.p90}; floor classes ${pr.classes.drawn.join(' ')} for the profile's ${pr.classes.profile.join(' ')} (largest difference ${pr.classDiff}); bin by bin distance ${pr.distanceAll}; ${pr.capped} held down by a small footprint; top type ${pr.topType} ${Math.round(pr.topShare * 100)} percent (mix asks ${Math.round(pr.mixTop * 100)}), ${pr.entropyBits} bits`);
  ctx.log(`[areas] variety: ${s.variety.pairs} pairs side by side, ${s.variety.varied} parcels changed to differ, ${s.variety.sameInTile} pairs still the same inside a tile (${s.variety.stuck} found no alternate), ${s.variety.sameAcrossTiles} across a tile line (a pick never reads another tile)`);
  for (const t of transects) ctx.log(`[areas] blend transect ${t.name}: ${t.samples.length} samples 25 m apart, largest step ${(t.maxStep * 100).toFixed(1)} percent, the weight of ${t.area} goes ${t.from.toFixed(2)} to ${t.to.toFixed(2)} (largest rise ${t.maxRise.toFixed(3)})`);
  ctx.log(`[areas] placements: ${p.instances} facade instances of ${p.modules} modules in ${p.tiles} tiles, ${mb(p.bytes)} in all; densest tile ${p.largest ? `${p.largest.id} ${mb(p.largest.bytes)} (${p.largest.instances} instances)` : 'none'} (budget ${mb(PLACEMENT_BUDGET_BYTES)}, ${INSTANCE_BYTES} bytes an instance); ${p.trimmed} instances left out to stay inside it; walls: ${p.exposure.street} on a street, ${p.exposure.open} on open ground, ${p.exposure.hidden} hidden`);
  ctx.log(`[areas] generator ${rec.ms.parcels + rec.ms.city} ms (parcels ${rec.ms.parcels}, buildings ${rec.ms.city}: ${Object.entries(s.ms).map(([k, v]) => `${k} ${v}`).join(', ')}); ${left.count} parcels on a road face`);
  return { city, rec, invariants: areaInvariants(rec) };
}

const geoOf = (x: number, z: number, origin: { lat: number; lon: number }): { lat: number; lon: number } => {
  const g = worldToGeo(x, z, origin);
  return { lat: Math.round(g.lat * 1e6) / 1e6, lon: Math.round(g.lon * 1e6) / 1e6 };
};

