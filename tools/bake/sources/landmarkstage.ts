// The landmark placement step of the bake (P2-006): the files side of tools/bake/landmarks/place.ts. It runs after
// the road mesh and the building clear step and before the ground: it reads the registry files the registry build
// wrote (harness/data/landmarks/, landmarks_markers.json), places every landmark that may be placed, takes the
// buildings inside the landmark zones out of the plain footprints (logged) and hands the terrain step the ground
// pieces (pads, forecourts, wall strips, a moat). After the ground is built, `runMassingStep` checks the pads on it,
// builds the stand-in massing and the far silhouettes, and hands the tile step the meshes, the pins and the landmark
// file of the tile folder (landmarks.json). Reports and pictures go to harness/reports/map/landmarks/.
import fs from 'node:fs';
import path from 'node:path';
import { projector } from '../../geo/projection.ts';
import type { P2 } from '../geom.ts';
import { pointInRing, pointSegment } from '../geom.ts';
import type { Entry } from '../landmarks/types.ts';
import { buildKitInputs } from '../landmarks/kit.ts';
import { buildMassing, farSilhouette, heroSilhouette } from '../landmarks/massing.ts';
import type { Silhouette } from '../landmarks/massing.ts';
import { FAR_CLEAR_M, placeLandmarks } from '../landmarks/place.ts';
import type { LandmarkBudgets, PlaceFootprint, PlaceLine, PlaceResult, Placement } from '../landmarks/place.ts';
import { buildingsInZones, checkPads, landmarkFile, landmarkPins, massingInvariants, massingLog, placeInvariants, placeLog, placeRecord } from '../landmarks/placeout.ts';
import type { LandmarkFile, LandmarksRecord } from '../landmarks/placeout.ts';
import { placementSvg } from '../landmarks/placerender.ts';
import type { PlaceMap } from '../landmarks/placerender.ts';
import { geodesic } from '../layout/geodesic.ts';
import { TILE_M } from '../layout/grid.ts';
import { blockFrame, placer } from '../layout/placement.ts';
import type { LayoutFile } from '../layout/placement.ts';
import type { RoadMesh } from '../mesh/build.ts';
import type { MeshInput } from '../mesh/input.ts';
import type { OsmElement } from '../osm.ts';
import type { RepairedGraph } from '../repair/engine.ts';
import type { InvariantResult } from '../report/health.ts';
import type { Ground } from '../terrain/build.ts';
import { MEET_NONE, meetOf } from '../terrain/collect.ts';
import type { LandmarkGround } from '../terrain/collect.ts';
import type { SourceMesh } from '../tile/cutter.ts';
import type { WorldPin } from '../tile/write.ts';
import { writePicture } from './graphinput.ts';
import type { StepContext } from './meshstage.ts';

const clock = (globalThis as unknown as { performance: { now(): number } }).performance;

/** The landmark file of a tile folder. */
export const LANDMARK_FILE = 'landmarks.json';

/** Pictures of the placement: the whole stage and the sites of the pilot heroes and the first signature. */
export const PLACE_VIEWS: readonly { id: string; name: string; landmark: string; halfM: number }[] = [
  { id: 'india_gate', name: 'India Gate', landmark: 'india_gate', halfM: 320 },
  { id: 'red_fort', name: 'Red Fort', landmark: 'red_fort', halfM: 720 },
  { id: 'cp', name: 'Connaught Place', landmark: 'cp_circle', halfM: 420 },
  { id: 'jama_masjid', name: 'Jama Masjid', landmark: 'jama_masjid', halfM: 260 },
];

/** Heights of the solved ground (tools/bake/tile/shells.ts GroundHeights): NaN under a road. */
export interface HeightsLike {
  at(x: number, z: number): number;
}

export interface PlaceStep {
  result: PlaceResult;
  /** The footprints the landmarks took, by id (the massing of a site reads its parts from here). */
  takenFootprints: Map<string, PlaceFootprint>;
  ground: LandmarkGround[];
  rec: LandmarksRecord;
  invariants: InvariantResult[];
  map: PlaceMap;
  reportDir: string;
}

/** Registry entries on disk: the hero and signature files and the marker rows. Null when the registry is of another stage. */
export function readRegistry(root: string, stage: string): { entries: Entry[]; stage: string } | null {
  const dir = path.join(root, 'harness', 'data', 'landmarks');
  const markersFile = path.join(root, 'harness', 'data', 'landmarks_markers.json');
  if (!fs.existsSync(dir) || !fs.existsSync(markersFile)) return null;
  const markers = JSON.parse(fs.readFileSync(markersFile, 'utf8')) as { stage: string; markers: Entry[] };
  if (markers.stage !== stage) return { entries: [], stage: markers.stage };
  const entries: Entry[] = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) entries.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Entry);
  entries.push(...markers.markers);
  return { entries, stage: markers.stage };
}

function readBudgets(root: string): LandmarkBudgets {
  const j = JSON.parse(fs.readFileSync(path.join(root, 'harness', 'verify', 'perf_budgets.json'), 'utf8')) as { world: { landmarks: LandmarkBudgets } };
  return j.world.landmarks;
}

const BARRIERS = new Set(['wall', 'city_wall', 'retaining_wall', 'fence', 'hedge']);

/** Wall, fence and hedge lines of the OSM extract, in block metres. */
export function barrierLines(elements: readonly OsmElement[], project: (lat: number, lon: number) => P2): PlaceLine[] {
  const nodes = new Map<number, P2>();
  for (const e of elements) if (e.type === 'node' && e.lat !== undefined && e.lon !== undefined) nodes.set(e.id, project(e.lat, e.lon));
  const out: PlaceLine[] = [];
  for (const e of elements) {
    if (e.type !== 'way' || !e.tags || !e.nodes) continue;
    const kind = e.tags['barrier'] ?? (e.tags['historic'] === 'citywalls' ? 'city_wall' : undefined);
    if (kind === undefined || !BARRIERS.has(kind)) continue;
    const pts = e.nodes.map((id) => nodes.get(id)).filter((p): p is P2 => !!p);
    if (pts.length >= 2) out.push({ id: `way/${e.id}`, kind, name: e.tags['name'] ?? '', pts });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * Places the landmarks of the stage. Changes `repaired.footprints` in place: the footprints inside a landmark zone
 * leave the plain buildings (as the clear step takes buildings off the roads). Null when there is no registry for
 * this stage (a test bake of another layout).
 */
export async function runPlaceStep(
  ctx: StepContext, districts: LayoutFile, meshed: { input: MeshInput; mesh: RoadMesh }, repaired: RepairedGraph, model: (x: number, z: number) => number, elements: readonly OsmElement[], reportDir: string,
): Promise<PlaceStep | null> {
  const t0 = clock.now();
  const { plan, log } = ctx;
  const reg = readRegistry(ctx.root, plan.id);
  if (!reg || !reg.entries.length) {
    log(`[landmarks] no registry for stage ${plan.id}${reg ? ` (the files are of stage ${reg.stage})` : ''}: nothing placed`);
    return null;
  }
  const proj = projector(plan.origin);
  const project = (lat: number, lon: number): P2 => proj.toWorld(lat, lon);
  // every road face the ground meets
  const faces = meshed.mesh.fs;
  const meet = { fs: faces, strips: meshed.input.strips, kinds: meshed.input.kinds };
  const roads: P2[][] = [];
  for (let f = 0; f < faces.faces; f++) {
    if (meetOf(meet, f) === MEET_NONE) continue;
    const ring: P2[] = [];
    const start = faces.start[f] as number;
    for (let k = 0; k < (faces.len[f] as number); k++) {
      const v = faces.ids[start + k] as number;
      ring.push({ x: faces.vx[v] as number, z: faces.vz[v] as number });
    }
    if (ring.length >= 3) roads.push(ring);
  }
  // far landmarks: the frame of the block they will stand in, else of the nearest block
  const pivot = districts.method.pivot;
  const farWorld = (e: Entry): { x: number; z: number; block: string; factor: number } => {
    let block = districts.blocks.find((b) => b.id === e.block_planned);
    if (!block) {
      let best = Infinity;
      for (const b of districts.blocks) {
        const d = geodesic({ lat: b.frameOrigin.lat, lon: b.frameOrigin.lon }, { lat: e.lat, lon: e.lon }).distanceM;
        if (d < best) {
          best = d;
          block = b;
        }
      }
    }
    const b = block as LayoutFile['blocks'][number];
    const w = placer(blockFrame(districts, b.id)).toWorld(e.lat, e.lon);
    return { x: w.x, z: w.z, block: b.id, factor: b.factor };
  };
  // reachable: inside the stage outline, or nearer to it than the clear distance plus a tile's diagonal
  const outlineW = repaired.outline.map((p) => ({ x: p.x + ctx.offset.x, z: p.z + ctx.offset.z }));
  const reach = FAR_CLEAR_M + TILE_M * Math.SQRT2;
  const reachable = (x: number, z: number): boolean => {
    const p = { x, z };
    if (pointInRing(p, outlineW)) return true;
    for (let k = 0; k < outlineW.length; k++) if (pointSegment(p, outlineW[k] as P2, outlineW[(k + 1) % outlineW.length] as P2).d < reach) return true;
    return false;
  };
  const footprints: PlaceFootprint[] = repaired.footprints.map((f) => ({ id: f.id, ring: f.ring, height: f.height, levels: f.levels, tags: f.tags }));
  const barriers = barrierLines(elements, project);
  const result = placeLandmarks({
    stage: plan.id, block: plan.def.block, entries: reg.entries, project, offset: ctx.offset, outline: repaired.outline, footprints, roads,
    water: repaired.features.water, open: repaired.features.open, barriers, ground: model, budgets: readBudgets(ctx.root), farWorld, reachable, pivot: pivot.world,
  });
  // the buildings inside the zones leave the plain footprints
  const takenFootprints = new Map<string, PlaceFootprint>();
  for (const f of footprints) if (result.taken.has(f.id)) takenFootprints.set(f.id, f);
  const before = repaired.footprints.length;
  repaired.footprints = repaired.footprints.filter((f) => !result.taken.has(f.id));
  const left = buildingsInZones(result.placements, repaired.footprints);
  const farInReach = result.far.filter((f) => reachable(f.wx, f.wz)).map((f) => f.id);

  // beside the health report (a test bake keeps its reports in its own folder)
  const dir = path.join(reportDir, 'landmarks');
  const rel = path.relative(ctx.root, dir).split(path.sep).join('/');
  fs.mkdirSync(dir, { recursive: true });
  const placementFile = path.join(dir, 'placement.json');
  fs.writeFileSync(placementFile, JSON.stringify({
    _doc: 'Landmark placement of the last bake (P2-006, tools/bake/landmarks/place.ts). x, z are block metres, wx, wz world metres (block metres plus the block offset); yawDeg is the compass bearing the front faces (0 north, 90 east). pad: the flat ground under a structure; zone: the landmark\'s own ground, where no plain building stands; surroundings: what lies in the zone and where it comes from. far: landmarks outside the stage, on the backdrop on their real bearing, never reachable.',
    stage: plan.id, block: plan.def.block, offset: ctx.offset, limits: result.limits, stats: result.stats, placements: result.placements, far: result.far, skipped: result.skipped,
  }) + '\n');
  const logFile = path.join(dir, 'replaced.json');
  fs.writeFileSync(logFile, JSON.stringify({
    _doc: 'Every building footprint a landmark zone took out of the plain buildings (P2-006). how "replaced": the landmark\'s own massing stands in its place (a structure). how "part": the building stays as a part of the landmark (a site: a fort, a park, the Connaught Place rings), drawn with the landmark material, never by the area generator. x, z are world metres of its centre.',
    stage: plan.id, counts: { replaced: result.stats.replaced, parts: result.stats.parts, footprintsBefore: before, footprintsAfter: repaired.footprints.length }, lines: result.log,
  }) + '\n');

  // the map the pictures draw
  const takenRings = [...takenFootprints.values()].map((f) => ({ ring: f.ring, how: (result.taken.get(f.id) as { how: 'replaced' | 'part' }).how }));
  const named = new Set(result.placements.flatMap((p) => p.surroundings.filter((s) => s.source === 'osm' && (s.kind === 'wall' || s.kind === 'fence')).map((s) => s.ref)));
  const map: PlaceMap = {
    outline: repaired.outline, roads: repaired.edges.map((e) => ({ pts: e.pts, width: e.road.width })), open: repaired.features.open.flatMap((o) => o.rings), water: repaired.features.water.flatMap((w) => w.rings),
    buildings: repaired.footprints.map((f) => f.ring), taken: takenRings, lines: barriers.filter((b) => named.has(b.id)).map((b) => ({ pts: b.pts, wall: /wall/.test(b.kind) })),
  };
  const files: Record<string, string | string[]> = { placement: path.relative(ctx.root, placementFile), replaced: path.relative(ctx.root, logFile) };
  if (!ctx.quick) {
    const pictures: string[] = [];
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const p of repaired.outline) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    const whole = { minX: x0 - 150, maxX: x1 + 150, minZ: z0 - 150, maxZ: z1 + 150 };
    pictures.push(...(await writePicture(ctx.root, `${rel}/placement_${plan.id}.png`, placementSvg(result, map, whole, `Landmark placement, ${plan.id} stage, north up: pads, zones and surroundings`, { labels: 'named', far: true, pivot: { x: pivot.world.x - ctx.offset.x, z: pivot.world.z - ctx.offset.z }, offset: ctx.offset }), 2400)));
    for (const v of PLACE_VIEWS) {
      const p = result.placements.find((q) => q.id === v.landmark);
      if (!p) continue;
      const box = { minX: p.x - v.halfM, maxX: p.x + v.halfM, minZ: p.z - v.halfM, maxZ: p.z + v.halfM };
      pictures.push(...(await writePicture(ctx.root, `${rel}/placement_${plan.id}_${v.id}.png`, placementSvg(result, map, box, `${v.name}: pad, zone and surroundings, north up (${plan.id})`, { labels: 'all', far: false }), 2400)));
    }
    files['pictures'] = pictures;
  }
  const rec = placeRecord(reg.stage, reg.entries.length, result, left.length, files, Math.round(clock.now() - t0));
  for (const l of placeLog(rec)) log(`[landmarks] ${l}`);
  if (left.length) log(`[landmarks] plain buildings left in a zone: ${left.slice(0, 5).map((l) => `${l.id} in ${l.landmark}`).join(', ')}`);
  log(`[landmarks] wrote ${Object.values(files).flat().join(', ')} (${rec.ms} ms)`);
  return { result, takenFootprints, ground: result.ground, rec, invariants: placeInvariants(rec, farInReach), map, reportDir: dir };
}

export interface MassingStep {
  meshes: SourceMesh[];
  pins: WorldPin[];
  file: LandmarkFile;
  invariants: InvariantResult[];
}

/**
 * After the ground: checks every pad on the built ground, builds the stand-in massing on it and the far
 * silhouettes, and makes the pins and the landmark file. `heights` gives the solved ground (NaN under a road).
 */
export function runMassingStep(ctx: StepContext, step: PlaceStep, ground: Ground, heights: HeightsLike, model: (x: number, z: number) => number): MassingStep {
  const t0 = clock.now();
  const { result, rec } = step;
  const pads = checkPads(ground);
  const st = ground.surface.stats.landmark;
  rec.pads = {
    count: pads.length, maxOffLevelM: pads.reduce((m, p) => Math.max(m, p.offLevelM), 0), maxGapM: pads.reduce((m, p) => Math.max(m, p.gapM), 0), minCovered: pads.reduce((m, p) => Math.min(m, p.covered), 1),
    worst: pads.slice().sort((a, b) => b.offLevelM + b.gapM - (a.offLevelM + a.gapM) || a.covered - b.covered).slice(0, 5), pinnedByRoad: st.padPinnedByRoad,
  };
  rec.ground = { pad: st.pad, forecourt: st.forecourt, wallbase: st.wallbase, moat: st.moat, padVertices: st.padVertices, moatBed: st.moatBed };
  const at = (x: number, z: number): number => heights.at(x, z);
  const yOf = (p: Placement): number => {
    if (p.pad) return p.pad.level;
    const y = at(p.x, p.z);
    return r1x(Number.isFinite(y) ? y : model(p.x, p.z));
  };
  // the parts kit (P2-007) builds the landmarks with a recipe in the game: they leave the tile massing
  const kit = buildKitInputs(result.placements, step.takenFootprints, at, model, yOf);
  for (const p of result.placements) if (kit.inputs.has(p.id) || kit.builtBy.has(p.id)) for (const s of p.lod.slots) s.source = 'kit';
  const massing = buildMassing(result.placements, step.takenFootprints, at, model, { ids: new Set([...kit.inputs.keys(), ...kit.builtBy.keys()]), parts: kit.takenParts });
  const budget = result.limits.farSilhouetteTriangles;
  const silhouettes: Silhouette[] = [];
  for (const p of result.placements) if (p.lod.far) silhouettes.push(heroSilhouette(p, step.takenFootprints, yOf(p), budget));
  // a far landmark stands at the mean height of the stage's ground: the backdrop has no ground model of its own
  let sum = 0;
  let n = 0;
  for (const p of result.placements) {
    sum += p.y;
    n++;
  }
  const farY = r1x(n ? sum / n : 0);
  for (const f of result.far) silhouettes.push(farSilhouette(f, farY));
  const slot0 = new Map(result.placements.map((p) => [p.id, p.lod.slots[0]?.trianglesMax ?? 0]));
  const largest = massing.records.slice().sort((a, b) => b.triangles - a.triangles)[0] ?? null;
  rec.massing = { triangles: massing.triangles, landmarks: massing.records.length, largest: largest ? { id: largest.id, triangles: largest.triangles } : null, overBudget: massing.records.filter((m) => m.triangles > (slot0.get(m.id) ?? 0)).map((m) => `${m.id} ${m.triangles}`) };
  rec.silhouettes = { count: silhouettes.length, maxTriangles: silhouettes.reduce((m, s) => Math.max(m, s.triangles), 0), budget };
  const pins = landmarkPins(result.placements, yOf);
  rec.pins = pins.length;
  const file = landmarkFile(ctx.plan.id, ctx.plan.def.block, result, result.placements.find((p) => p.tier === 'hero')?.lod.slots.length ?? 3, yOf, farY, massing.records, silhouettes, kit.inputs, kit.builtBy);
  fs.writeFileSync(path.join(step.reportDir, 'massing.json'), JSON.stringify({ _doc: 'The stand-in massing of the placed landmarks and the pad check on the built ground (P2-006).', stage: ctx.plan.id, pads, massing: massing.records, silhouettes: silhouettes.map((s) => ({ id: s.id, triangles: s.triangles, heightM: s.heightM, from: s.from })) }) + '\n');
  rec.ms += Math.round(clock.now() - t0);
  for (const l of massingLog(rec)) ctx.log(`[landmarks] ${l}`);
  return { meshes: massing.meshes, pins, file, invariants: massingInvariants(rec) };
}

const r1x = (v: number): number => Math.round(v * 1000) / 1000;
