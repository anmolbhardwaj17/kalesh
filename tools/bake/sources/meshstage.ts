// The mesh and terrain steps of the bake driver (P1-014, P1-015; moved out of tools/bake/main.ts in P1-017 to keep
// the driver short). The meshes and the ground are pure (tools/bake/mesh/, tools/bake/terrain/); this file writes the
// road bench scene's site tiles and the north-up pictures. A partial bake (`quick`) builds each once and writes no
// site tile or picture: the whole bake proves the same-twice checks and draws the pictures.
import path from 'node:path';
import { projector } from '../../geo/projection.ts';
import { pointInRing } from '../geom.ts';
import type { P2 } from '../geom.ts';
import type { StagePlan } from '../layout/stages.ts';
import { outlineRing } from '../layout/outline.ts';
import { buildRoadMesh } from '../mesh/build.ts';
import type { RoadMesh } from '../mesh/build.ts';
import { checkRoadMesh } from '../mesh/checks.ts';
import type { MeshChecks } from '../mesh/checks.ts';
import { meshInput } from '../mesh/input.ts';
import type { MeshInput } from '../mesh/input.ts';
import { meshHash, meshRecord, siteTile } from '../mesh/meshout.ts';
import type { MeshRecord } from '../mesh/meshout.ts';
import { PAIR_LIMIT_M2 } from '../mesh/proof.ts';
import { meshSvg } from '../mesh/render.ts';
import type { RepairedGraph } from '../repair/engine.ts';
import type { InvariantResult } from '../report/health.ts';
import type { LaneBuild } from '../roads/network.ts';
import { GROUND_SITES, JUNCTION_VIEWS, MESH_SITES, REPAIR_SITES } from '../sites.ts';
import type { BlockGraph } from '../graph/build.ts';
import type { Issue } from '../rules/types.ts';
import { repairSiteSvg } from '../report/sitepics.ts';
import { buildGround } from '../terrain/build.ts';
import type { Ground } from '../terrain/build.ts';
import { checkGround } from '../terrain/checks.ts';
import type { LandmarkGround, TerrainInput } from '../terrain/collect.ts';
import { groundHash, groundInBox, groundPoses, groundSvg, terrainInvariants, terrainLog, terrainRecord } from '../terrain/terrainout.ts';
import type { TerrainRecord } from '../terrain/terrainout.ts';
import type { GroundModel } from '../heights.ts';
import { CLEAR, clearFootprints, faceIndex, leftOnRoad, roadFace } from '../repair/clear.ts';
import type { BuildingsRecord, ClearLine, RoadFace } from '../repair/clear.ts';
import { MEET_NONE, meetOf } from '../terrain/collect.ts';
import fs from 'node:fs';
import { writePicture } from './graphinput.ts';
import { writeSiteTile } from './meshio.ts';

export interface StepContext {
  root: string;
  plan: StagePlan;
  offset: P2;
  /** Folder of the road bench scene's site tiles. */
  benchDir: string;
  /** A partial bake: one build, no site tiles, no pictures. */
  quick: boolean;
  log: (line: string) => void;
}

const clock = (globalThis as unknown as { performance: { now(): number } }).performance;
const round = (v: number): number => Math.round(v * 100) / 100;
export const NOT_TWICE = 'not built twice in a partial bake: the whole bake checks it';

export async function runMeshStep(ctx: StepContext, laneBuild: LaneBuild, elevated: { junctionHeights: ArrayLike<number>; kinds: readonly ArrayLike<number>[] }, repair?: { raw: BlockGraph; repaired: RepairedGraph; issues: readonly Issue[] }): Promise<{ input: MeshInput; mesh: RoadMesh; rec: MeshRecord; checks: MeshChecks; invariants: InvariantResult[] }> {
  const { plan, log } = ctx;
  const proj = projector(plan.origin);
  const input = meshInput(laneBuild, elevated.junctionHeights, elevated.kinds);
  // built twice: the mesh must not depend on anything but the lane model and the heights
  const mesh = buildRoadMesh(input);
  const hash = meshHash(mesh);
  const again = ctx.quick ? hash : meshHash(buildRoadMesh(input));
  const tc = clock.now();
  const c = checkRoadMesh(input, mesh);
  const checksMs = Math.round(clock.now() - tc);
  const ring = outlineRing(plan.outline.coords, plan.origin);
  const tiles: string[] = [];
  const pictures: string[] = [];
  for (const v of ctx.quick ? [] : MESH_SITES) {
    const at = proj.toWorld(v.lat, v.lon);
    if (!pointInRing(at, ring)) continue;
    const site = siteTile(input, mesh, { id: v.id, name: v.name, x: at.x, z: at.z, halfM: v.halfM, eye: v.eye });
    const w = writeSiteTile(ctx.root, ctx.benchDir, site);
    tiles.push(w.tile, w.poses);
    const box = { minX: at.x - v.halfM, maxX: at.x + v.halfM, minZ: at.z - v.halfM, maxZ: at.z + v.halfM };
    const marks = {
      setFaces: mesh.junctions.setFaces,
      polys: mesh.structures.piers.map((p) => ({ ring: p.ring, fill: '#f2c14e' })),
      lines: mesh.stops.lines.map((l) => ({ a: l.a, b: l.b, stroke: '#ffffff', width: 0.3 })),
    };
    pictures.push(...(await writePicture(ctx.root, `harness/reports/map/mesh_${plan.id}_${v.id}.png`, meshSvg(mesh.fs, box, `${v.name}: road mesh faces, north up (${plan.id}). Junction surfaces outlined blue (as planned) or red (made or cut by the polygon set); yellow: piers; white: stop lines`, marks, input.strips.length), 2400)));
    log(`[mesh] site ${v.id}: ${site.triangles} triangles, ${w.bytes} bytes, poses ${site.meta.poses.map((p) => p.name).join(', ')}`);
  }
  // the repaired sites, before (raw graph and issues) and after (the mesh)
  for (const v of REPAIR_SITES) {
    if (ctx.quick || !repair) break;
    const at = proj.toWorld(v.lat, v.lon);
    if (!pointInRing(at, ring)) continue;
    const box = { minX: at.x - v.halfM, maxX: at.x + v.halfM, minZ: at.z - v.halfM, maxZ: at.z + v.halfM };
    const marks = { setFaces: mesh.junctions.setFaces, lines: mesh.stops.lines.map((l) => ({ a: l.a, b: l.b, stroke: '#ffffff', width: 0.3 })) };
    pictures.push(...(await writePicture(ctx.root, `harness/reports/map/repair_${plan.id}_${v.id}.png`, repairSiteSvg(repair.raw, repair.repaired, repair.issues, mesh.fs, marks, input.strips.length, box, `${v.name} (${plan.id}), north up, ${2 * v.halfM} m across`), 3200)));
  }
  // top views of the junction surfaces at the sites that had the widest ones
  for (const v of JUNCTION_VIEWS) {
    if (ctx.quick) break;
    const at = proj.toWorld(v.lat, v.lon);
    if (!pointInRing(at, ring)) continue;
    const box = { minX: at.x - v.halfM, maxX: at.x + v.halfM, minZ: at.z - v.halfM, maxZ: at.z + v.halfM };
    const marks = { setFaces: mesh.junctions.setFaces, polys: mesh.structures.piers.map((p) => ({ ring: p.ring, fill: p.portal ? '#ff7a00' : '#f2c14e' })), lines: [] };
    pictures.push(...(await writePicture(ctx.root, `harness/reports/map/junctions_${plan.id}_${v.id}.png`, meshSvg(mesh.fs, box, `${v.name}: road mesh faces, north up (${plan.id}). Junctions outlined blue (as planned) or red (polygon set); yellow piers, orange portal legs`, marks, input.strips.length), 2400)));
  }
  const rec = meshRecord(input, mesh, c, checksMs, ctx.offset, hash, { siteTiles: tiles, pictures });
  const n = rec.counts;
  log(`[mesh] built in ${(rec.buildMs / 1000).toFixed(2)} s (${Object.entries(rec.ms).filter(([k]) => k !== 'total').map(([k, v]) => `${k} ${v}`).join(', ')} ms), checks ${(checksMs / 1000).toFixed(2)} s: ${n.faces} faces over ${n.vertices} vertices (${n.laneQuads} lane quads), ${n.triangles} triangles; hash ${hash}`);
  log(`[mesh] junctions: ${n.junctions} (${n.j1} as planned, ${n.j2} from lane path corridors by the polygon set); ${n.clippedFaces} faces of ${n.clippedJunctions} junctions cut back off a neighbour (${n.clippedAreaM2} m2); raised corners ${n.bands} (${n.crossedBands} crossed and redrawn, ${n.droppedBands} left out); ${n.heightsTaken} polygon set corners took a neighbour's height; ${rec.oversize.length} surfaces over 3,000 m2${rec.oversize.length ? ` (${rec.oversize.map((o) => `${o.id} ${o.areaM2} m2`).join(', ')})` : ''}`);
  log(`[mesh] overlap: ${c.overlap.pairsOver} pairs over ${PAIR_LIMIT_M2} m2 at ${c.overlap.junctionsOver} of ${c.overlap.junctions} junctions (${c.overlap.pairsTested} pairs tested, largest ${c.overlap.maxPairM2} m2, a junction on itself ${c.overlap.maxSelfM2} m2); strip on strip ${c.overlap.stripPairs.pairs} pairs, ${c.overlap.stripPairs.areaM2} m2${c.overlap.stripPairs.worst[0] ? ` (largest ${c.overlap.stripPairs.worst[0].a} on ${c.overlap.stripPairs.worst[0].b}: ${c.overlap.stripPairs.worst[0].areaM2} m2)` : ''}; total under more than one face ${c.overlap.totalM2} m2 (ground level ${c.overlap.groundM2} m2)`);
  log(`[mesh] watertight: open boundary edges ${c.watertight.openBoundaryEdges} (unclosed ${c.watertight.unclosed}, used twice ${c.watertight.doubled}, T joints left ${c.watertight.tJointsLeft}; ${c.watertight.tJointsRepaired} repaired), ${c.watertight.freeEdges} free edges in ${c.watertight.loops} loops (${c.watertight.outerLoops} around road, ${c.watertight.blockLoops} around blocks, ${c.watertight.sliverLoops} hairlines of ${c.watertight.sliverM2} m2)`);
  log(`[mesh] ends: ${c.ends.stripEnds} strip ends, ${c.ends.joined} joined, explained ${Object.entries(c.ends.explained).map(([k, v]) => `${k} ${v}`).join(', ')}; unjoined ${c.ends.unjoined}${c.ends.unjoinedList.length ? ` (${c.ends.unjoinedList.slice(0, 6).map((e) => `${e.strip} ${e.end}`).join(', ')})` : ''}; floating ${c.ends.floating}${c.ends.floatingList.length ? ` (${c.ends.floatingList.map((e) => `${e.strip} ${e.end} ${e.kind} ${e.aboveGroundM} m up`).join(', ')})` : ''}`);
  log(`[mesh] structures: ${c.railings.segments} edge segments (${Object.entries(c.railings.byKind).map(([k, v]) => `${k} ${v}`).join(', ')}), ${c.railings.parapets} with a parapet, ${c.railings.atGrade} of ${c.railings.parapetTriangles} parapet triangles at grade away from a structure; piers ${c.piers.piers} (${c.piers.portals} portals, ${c.piers.moved} places passed over, longest span ${c.piers.maxSpanM} m, ${c.piers.longSpans.length} over 60 m${c.piers.longSpans.length ? `: ${c.piers.longSpans.map((l) => `${l.strip} ${l.spanM} m (${l.why})`).join(', ')}` : ''}), in a lane below: ${c.piers.inLane}; deck joints ${c.piers.joints}`);
  log(`[mesh] lane paths: ${c.paths.totalM} m in ${c.paths.junctions} junctions, ${c.paths.offFaceM} m on no road face (most: ${c.paths.worst.slice(0, 5).map((w) => `${w.junction} ${w.offM} m`).join(', ') || 'none'})`);
  log(`[mesh] kerbs: ${c.kerbs.sampled} kerb faces sampled, ${c.kerbs.minM} to ${c.kerbs.maxM} m, ${c.kerbs.off} off 0.15 m by over 0.01 m (beside a surface the polygon set made: ${c.kerbs.beside.off} of ${c.kerbs.beside.sampled}); lane UV ${c.uv.ok ? 'ok' : 'FAILED'}: ${c.uv.lanes} lane quads, ${c.uv.corners} corners, bad u ${c.uv.badU}, bad v ${c.uv.badV}, border mismatches ${c.uv.borderMismatch}, joint mismatches ${c.uv.jointMismatch} of ${c.uv.jointPairs}; stop lines ${c.stopLines.lines} on ${c.stopLines.armsThatStop} arms that stop, missing ${c.stopLines.missing}, crossings ${c.stopLines.crossings}`);
  if (tiles.length + pictures.length) log(`[mesh] wrote ${[...tiles, ...pictures].join(', ')}`);
  const invariants: InvariantResult[] = [
    { id: 'MESH-01.no_overlap_at_junctions', ok: c.overlap.pairsOver === 0, detail: c.overlap.pairsOver === 0 ? `no junction face shares more than ${PAIR_LIMIT_M2} m2 with a strip or another junction (${c.overlap.pairsTested} pairs, largest ${c.overlap.maxPairM2} m2)` : `${c.overlap.pairsOver} pairs over ${PAIR_LIMIT_M2} m2: ${c.overlap.worst.slice(0, 3).map((w) => `${w.a} on ${w.b} ${w.areaM2} m2`).join(', ')}` },
    { id: 'MESH-02.watertight', ok: c.watertight.openBoundaryEdges === 0, detail: `${c.watertight.openBoundaryEdges} open boundary edges (${c.watertight.unclosed} unclosed, ${c.watertight.doubled} used twice, ${c.watertight.tJointsLeft} T joints left)` },
    { id: 'MESH-03.structures', ok: c.railings.atGrade === 0 && c.piers.inLane === 0, detail: `${c.railings.atGrade} parapet triangles at grade away from a structure, ${c.piers.inLane} piers in a lane of another level` },
    { id: 'MESH-04.kerbs_uv_stop_lines', ok: c.kerbs.off === 0 && c.uv.ok && c.stopLines.missing === 0, detail: `${c.kerbs.off} of ${c.kerbs.sampled} kerbs off 0.15 m, lane UV ${c.uv.ok ? 'ok' : 'failed'}, ${c.stopLines.missing} of ${c.stopLines.armsThatStop} stop lines missing` },
    { id: 'MESH-05.same_twice', ok: hash === again, detail: ctx.quick ? NOT_TWICE : hash === again ? `the same hash twice (${hash})` : `two builds of one input differ: ${hash} and ${again}` },
  ];
  return { input, mesh, rec, checks: c, invariants };
}

export async function runTerrainStep(ctx: StepContext, meshed: { input: MeshInput; mesh: RoadMesh }, repaired: RepairedGraph, model: GroundModel, landmarks: readonly LandmarkGround[] = []): Promise<{ ground: Ground; rec: TerrainRecord; invariants: InvariantResult[] }> {
  const { plan, log } = ctx;
  const proj = projector(plan.origin);
  const { input: mi, mesh } = meshed;
  const input: TerrainInput = {
    fs: mesh.fs, edges: mesh.edges, grid: mesh.grid, strips: mi.strips, kinds: mi.kinds, outline: repaired.outline, footprints: repaired.footprints.map((f) => f.ring),
    water: repaired.features.water.map((w) => ({ id: w.id, name: w.name, rings: w.rings })), open: repaired.features.open.map((o) => o.rings), ground: (x, z) => model.at(x, z), offset: ctx.offset,
    // landmark ground pieces of the placement step (P2-006): pads, forecourts, wall strips, a moat
    ...(landmarks.length ? { landmarks } : {}),
  };
  // built twice: the ground must not depend on anything but the road mesh, the map and the ground model
  const ground = buildGround(input);
  const hash = groundHash(ground);
  const again = ctx.quick ? hash : groundHash(buildGround(input));
  const tc = clock.now();
  const c = checkGround(ground);
  const checksMs = Math.round(clock.now() - tc);
  const files: string[] = [];
  for (const v of ctx.quick ? [] : GROUND_SITES) {
    const at = proj.toWorld(v.lat, v.lon);
    if (!pointInRing(at, repaired.outline)) continue;
    const box = { minX: at.x - v.halfM, maxX: at.x + v.halfM, minZ: at.z - v.halfM, maxZ: at.z + v.halfM };
    // the site tiles of the road bench scene again, now on the production ground, with the poses that look at it
    const site = siteTile(mi, mesh, { id: v.id, name: v.name, x: at.x, z: at.z, halfM: v.halfM, eye: v.eye }, groundInBox(ground, box));
    const o = site.meta.origin;
    for (const p of site.meta.poses) if (p.kind === 'eye') p.shot = `ground_${v.id}_eye`;
    for (const p of groundPoses(ground, { id: v.id, x: at.x, z: at.z, halfM: v.halfM })) site.meta.poses.push({ ...p, pos: [round(p.pos[0] - o[0]), round(p.pos[1] - o[1]), round(p.pos[2] - o[2])], target: [round(p.target[0] - o[0]), round(p.target[1] - o[1]), round(p.target[2] - o[2])] });
    const w = writeSiteTile(ctx.root, ctx.benchDir, site);
    files.push(w.tile, w.poses, ...(await writePicture(ctx.root, `harness/reports/map/ground_${plan.id}_${v.id}.png`, groundSvg(ground, box, `${v.name}: ground triangles, north up (${plan.id}). Grey: ground, green: open land, sand: building footprints, blue: water; dark: the road mesh`), 2400)));
    log(`[terrain] site ${v.id}: ${site.triangles} triangles, ${w.bytes} bytes, poses ${site.meta.poses.map((p) => p.name).join(', ')}`);
  }
  const rec = terrainRecord(ground, c, checksMs, hash, { files });
  for (const l of terrainLog(rec)) log(`[terrain] ${l}`);
  const invariants = terrainInvariants(rec, again).map((r) => (ctx.quick && r.id === 'TERR-06.same_twice_in_time' ? { ...r, detail: `${NOT_TWICE}; one build ${rec.buildMs} ms` } : r));
  return { ground, rec, invariants };
}

/**
 * Buildings off the road (P1-030): every footprint that stands on a road face of the mesh gives way (moved back, cut,
 * cut in two or dropped: tools/bake/repair/clear.ts). Runs after the road mesh and before the ground, so the ground
 * and the building shells are built on the cleared footprints. Changes `repaired.footprints` in place.
 */
export function runClearStep(ctx: StepContext, meshed: { input: MeshInput; mesh: RoadMesh }, repaired: RepairedGraph, reportDir: string): { rec: BuildingsRecord; invariants: InvariantResult[] } {
  const t0 = clock.now();
  const { fs: faces } = meshed.mesh;
  const meet = { fs: faces, strips: meshed.input.strips, kinds: meshed.input.kinds };
  const list: RoadFace[] = [];
  for (let f = 0; f < faces.faces; f++) {
    if (meetOf(meet, f) === MEET_NONE) continue;
    const ring: P2[] = [];
    const start = faces.start[f] as number;
    for (let k = 0; k < (faces.len[f] as number); k++) {
      const v = faces.ids[start + k] as number;
      ring.push({ x: faces.vx[v] as number, z: faces.vz[v] as number });
    }
    if (ring.length >= 3) list.push(roadFace(ring));
  }
  const index = faceIndex(list);
  const marked = new Set(Object.entries(repaired.marks).filter(([, m]) => m['gives_way'] !== undefined).map(([id]) => id));
  const res = clearFootprints(repaired.footprints, index);
  repaired.footprints = res.footprints;
  const left = leftOnRoad(res.footprints, index);
  const bySource: Record<string, number> = {};
  for (const l of res.lines) bySource[l.source] = (bySource[l.source] ?? 0) + 1;
  const file = path.join(reportDir, 'buildings_cleared.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines: (ClearLine & { issue: boolean })[] = res.lines.map((l) => ({ ...l, x: round(l.x + ctx.offset.x), z: round(l.z + ctx.offset.z), issue: marked.has(l.id) }));
  fs.writeFileSync(file, JSON.stringify({ _doc: 'Every building footprint the bake took off a road (P1-030, tools/bake/repair/clear.ts): moved back (shifted), cut to the road edge (trimmed), cut in two by a road through it (split) or dropped as a scrap. x, z are world metres. issue: an R-BLDG-01 issue named it.', stage: ctx.plan.id, counts: res.counts, lines }) + '\n');
  const rec: BuildingsRecord = {
    roadFaces: list.length, counts: res.counts, withoutIssue: res.lines.filter((l) => !marked.has(l.id)).length, bySource, left, clearanceM: CLEAR.clearanceM, ms: Math.round(clock.now() - t0),
    file: path.relative(ctx.root, file),
  };
  const c = res.counts;
  ctx.log(`[buildings] ${c.onRoad} of ${c.footprints} footprints stood on a road face (${c.overlapM2} m2): ${c.shifted} moved back, ${c.trimmed} cut to the road edge, ${c.split} cut in two, ${c.dropped} dropped (${c.removedM2} m2 taken off; ${rec.withoutIssue} had no issue of their own); ${left.count} left on a road (${left.areaM2} m2); ${c.footprintsAfter} footprints now; ${rec.ms} ms`);
  return { rec, invariants: [{ id: 'BLDG-01.off_the_road', ok: left.count === 0, detail: left.count === 0 ? `no footprint shares more than 0.01 m2 with a road face (${c.onRoad} cleared: ${c.shifted} moved, ${c.trimmed} cut, ${c.split} cut in two, ${c.dropped} dropped)` : `${left.count} footprints still on a road (${left.areaM2} m2): ${left.worst.slice(0, 3).map((w) => `${w.id} ${w.areaM2} m2`).join(', ')}` }] };
}

export const defaultBenchDir = path.join('game', 'bench', 'roads', 'gen');
