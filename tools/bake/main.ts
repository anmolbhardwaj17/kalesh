// The bake driver (P1-007, docs/ARCHITECTURE.md `bake/main.ts`, TECH.md "World pipeline (offline bake)"). It alone,
// with tools/bake/sources/, touches files and the network; every other file under tools/bake/ is pure functions
// (tools/bake/purity.test.ts). Usage in tools/bake/cli.ts; run through `npm run bake -- pilot`.
//
// Before any step: rule R-STITCH on the layout (tools/bake/layout/gate.ts: the placement method, translation only,
// the centre pair gate, far blocks, block gaps, the map extent), with the pair table written into the health report.
// Steps so far: sources (fetch or reuse every pinned file and print its hash), ground (GEDTM30 smoothed over 60 m,
// filtered GLO-30 as the fallback), graph (the block graph of tools/bake/graph/, written to <dataDir>/graph.json with
// a north-up picture in harness/reports/map/), repair (the rule catalogue and auto-repair of tools/bake/rules/ and
// tools/bake/repair/: the repaired graph in <dataDir>/graph_repaired.json, issues.json and repairs.jsonl beside the
// health report, a north-up picture of the issues), lanes (the lane model of tools/bake/roads/network.ts on the repaired
// graph: lanes.json and lane_graph.json in <dataDir>, the inspector's lanes layer and north-up pictures beside the
// health report), elevation (one height solve over the whole lane model, tools/bake/elevation/: elevation.json in
// <dataDir>, a north-up height map and the side view of the ITO flyover beside the health report), mesh (the road and
// junction mesh of tools/bake/mesh/ with its overlap proof and gate counts; stand-in tiles of a few sites for the road
// bench scene in game/bench/roads/gen/ and north-up pictures beside the health report), terrain (the ground of
// tools/bake/terrain/: cut to the road mesh's edges, footprints, water and the tile lines, with its checks; the bench
// tiles again on that ground), tiles (the KTL1 tiles of tools/bake/tile/ on the one 250 m world grid, written by
// sources/tilestage.ts to game/world/tiles (the stage's tile folder) with index.json, checked on the bytes read back). Invariants run
// after each step; a failed one stops the bake before tiles are written. harness/reports/map/health.json is written at the end of every run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projector } from '../geo/projection.ts';
import { pointInRing } from './geom.ts';
import type { Box2, P2 } from './geom.ts';
import { parseArgs } from './cli.ts';
import type { BakeArgs, Step } from './cli.ts';
import { groundInvariants, outlineInvariants, sourceInvariants } from './invariants.ts';
import { pickGround } from './heights.ts';
import { checkLayout, layoutRecord, pairRows } from './layout/gate.ts';
import type { BlockOutline, LayoutInput, Place } from './layout/gate.ts';
import { readOutline } from './layout/outline.ts';
import type { GeoBox } from './layout/outline.ts';
import type { LayoutFile } from './layout/placement.ts';
import { stageDefs, stagePlan } from './layout/stages.ts';
import type { DistrictsWithStages, StagePlan } from './layout/stages.ts';
import { inspectorContext } from './report/inspector.ts';
import { BakeStop, decisionCounts, emptyHealth, mapCounts, recordInvariants, undergroundHealth } from './report/health.ts';
import { issuesRemovedByUnderground } from './report/underground.ts';
import type { HealthReport } from './report/health.ts';
import { buildBlockGraph } from './graph/build.ts';
import type { BlockGraph, GraphInput } from './graph/build.ts';
import type { HeightGrid } from './ground.ts';
import type { GroundModel } from './heights.ts';
import { outlineRing } from './layout/outline.ts';
import { blockFrame } from './layout/placement.ts';
import { repairGraph } from './repair/engine.ts';
import { repairWithLanes } from './repair/feedback.ts';
import type { OverrideEntry } from './repair/overrides.ts';
import { buildRuleEnv } from './repair/env.ts';
import { issuesSvg } from './repair/render.ts';
import { timeRules } from './rules/catalogue.ts';
import { RuleContext } from './rules/context.ts';
import type { Issue } from './rules/types.ts';
import { readOverrides } from './sources/overridesio.ts';
import { readRepairInput, writeRepair } from './sources/repairio.ts';
import { checkGraph, graphCounts, graphHash, graphInvariants } from './graph/checks.ts';
import { graphSvg } from './graph/render.ts';
import type { RepairedGraph } from './repair/engine.ts';
import { checkLaneModel, checkPlanOverlap } from './roads/lanechecks.ts';
import type { LaneChecks } from './roads/lanechecks.ts';
import { explainGates, gateInvariant, gateLog } from './report/gates.ts';
import type { GateFile } from './report/gates.ts';
import { gateItems } from './report/gateitems.ts';
import type { MeshChecks } from './mesh/checks.ts';
import { NOT_TWICE, defaultBenchDir, infraSkyline, readInfraRules, readMedianRefs, runClearStep, runMeshStep, runTerrainStep } from './sources/meshstage.ts';
import { laneGraph, laneModelFile, laneModelHash, lanesLayer, lanesRecord } from './roads/laneout.ts';
import { lanesSvg } from './roads/lanerender.ts';
import { buildLaneModel, giveWaySolved } from './roads/network.ts';
import type { LaneBuild, LaneModelInput } from './roads/network.ts';
import { LANE_VIEWS, PROFILE_VIEWS, laneInputs } from './sites.ts';
import { checkElevation } from './elevation/checks.ts';
import { elevationFile, elevationHash, elevationRecord } from './elevation/elevout.ts';
import { elevationInput } from './elevation/input.ts';
import { heightMapSvg, profileSvg } from './elevation/render.ts';
import { solveBlockElevation } from './elevation/solve.ts';
import { readStructures } from './elevation/structures.ts';
import { overheadHeights } from './elevation/overhead.ts';
import { RAIL_EMBANKMENT_M } from './elevation/limits.ts';
import type { RoadMesh } from './mesh/build.ts';
import type { MeshInput } from './mesh/input.ts';
import type { LandmarkGround } from './terrain/collect.ts';
import type { Ground } from './terrain/build.ts';
import { writeElevation } from './sources/elevationio.ts';
import { writeLanes } from './sources/lanesio.ts';
import { readGedtmFile, readGlo30File } from './sources/ground.ts';
import { readGraphInput, writeGraph, writePicture } from './sources/graphinput.ts';
import { OfflineError, realNet } from './sources/net.ts';
import type { Net } from './sources/net.ts';
import { loadSources } from './sources/pinfile.ts';
import { runSourcesStage } from './sources/stage.ts';
import { roadFaceRings, runMassingStep, runPlaceStep } from './sources/landmarkstage.ts';
import { runAccessStep } from './sources/accessio.ts';
import { placeBarriers } from './mesh/barriers.ts';
import type { BarrierPlacement } from './mesh/barriers.ts';
import { walkwayGround } from './terrain/walkways.ts';
import type { SourceMesh } from './tile/cutter.ts';
import type { BarrierFeature } from './graph/features.ts';
import type { MassingStep } from './sources/landmarkstage.ts';
import { GroundHeights } from './tile/shells.ts';
import { buildInfra } from './infra/build.ts';
import { RoadProbe } from './infra/probe.ts';
import { platformSources } from './infra/platforms.ts';
import type { OverheadResult } from './elevation/overhead.ts';
import type { Shell } from './tile/shells.ts';
import { runTileStep } from './sources/tilestage.ts';
import { runCityStep, runParcelStep } from './sources/areastage.ts';
import type { AreaStep } from './sources/areastage.ts';
import { readWarm, warmKey, writeWarm } from './sources/warmstart.ts';
import type { SourceResult } from './sources/stage.ts';

interface Proc {
  argv: string[];
  exitCode?: number;
}
const proc = (globalThis as unknown as { process: Proc }).process;
const out = (globalThis as unknown as { console: { log(line: string): void } }).console;
const clock = (globalThis as unknown as { performance: { now(): number } }).performance;

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A network that refuses every request (--offline). */
export const offlineNet: Net = {
  request: (url) => Promise.reject(new OfflineError(`offline: no request to ${url.slice(0, 80)}`)),
  tiffWindow: (url) => Promise.reject(new OfflineError(`offline: no request to ${url.slice(0, 80)}`)),
  duckdb: () => Promise.reject(new OfflineError('offline: no DuckDB request')),
};

/** The stage box in block metres (the four corners projected around the block origin). */
export function boxMetres(plan: StagePlan, box: GeoBox = plan.box): Box2 {
  const proj = projector(plan.origin);
  const pts = [proj.toWorld(box.north, box.west), proj.toWorld(box.north, box.east), proj.toWorld(box.south, box.west), proj.toWorld(box.south, box.east)];
  return { minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minZ: Math.min(...pts.map((p) => p.z)), maxZ: Math.max(...pts.map((p) => p.z)) };
}

/**
 * The layout data rule R-STITCH reads: the places and every outline that is drawn (block outlines, focus outlines,
 * draft focus rings and the stage being baked). A file named in districts.json that is not there is listed, not thrown.
 */
export function readLayoutInput(dataDir: string, file: LayoutFile, stage: BlockOutline): { input: LayoutInput; missing: string[] } {
  const missing: string[] = [];
  const outlines: BlockOutline[] = [];
  const add = (id: string, block: string, rel: string): void => {
    const f = path.join(dataDir, rel);
    if (!fs.existsSync(f)) {
      missing.push(rel);
      return;
    }
    outlines.push({ id, block, coords: readOutline(fs.readFileSync(f, 'utf8'), id).coords });
  };
  for (const b of file.blocks) if (b.outline) add(b.id, b.id, b.outline);
  for (const d of [...file.districts, ...(file.planned ?? [])]) {
    if (typeof d.outline === 'string') add(d.id, d.block, d.outline);
    else if (d.outline) outlines.push({ id: d.id, block: d.block, coords: d.outline.ring });
  }
  outlines.push(stage);
  let places: Place[] = [];
  const placesFile = path.join(dataDir, 'districts', 'places.json');
  if (fs.existsSync(placesFile)) places = (JSON.parse(fs.readFileSync(placesFile, 'utf8')) as { places: Place[] }).places;
  else missing.push('districts/places.json');
  return { input: { file, places, outlines }, missing };
}

export interface BakeOptions {
  root: string;
  net: Net;
  today: string;
  log: (line: string) => void;
  /** Where health.json goes (default harness/reports/map/health.json under root). */
  healthFile?: string;
  /** Where the override files are read from (default harness/data/overrides under root). */
  overridesDir?: string;
  /** Where the mesh step writes the road bench scene's stand-in tiles (default game/bench/roads/gen under root); a test passes its own folder. */
  benchDir?: string;
  /** The layout instead of harness/data/districts.json (a test bakes a mirrored block). */
  districts?: DistrictsWithStages & LayoutFile;
  /** Faults a test puts in on purpose, to show the invariants stop the bake (a broken lane). */
  faults?: { lanes?: (b: LaneBuild) => void };
  /** Called after the terrain step with the inputs of the mesh and the ground (a dev script keeps them to rebuild those two steps alone). */
  tap?: (step: string, state: { meshed: { input: MeshInput; mesh: RoadMesh } | null; repaired: RepairedGraph | null; groundModel: GroundModel | null; landmarks: readonly LandmarkGround[] }) => void;
}

/** Runs a bake for parsed arguments; returns the report (also written to disk). Throws BakeStop after writing it. */
export async function bake(args: BakeArgs, opts: BakeOptions): Promise<HealthReport> {
  const dataDir = path.join(opts.root, 'harness', 'data');
  const t0Bake = clock.now();
  const districts = opts.districts ?? (JSON.parse(fs.readFileSync(path.join(dataDir, 'districts.json'), 'utf8')) as DistrictsWithStages & LayoutFile);
  // a partial bake (--tiles): one build of each model, no pictures, the lane feedback from the last whole bake's conflicts
  const quick = args.tiles !== null;
  const defs = stageDefs(districts);
  if (!defs[args.target]) {
    const block = districts.blocks.find((b) => b.id === args.target);
    throw new Error(block ? `block "${args.target}" has no bake stage yet: bake a stage of harness/data/districts.json "stages" (${Object.keys(defs).join(', ')})` : `"${args.target}" is neither a stage nor a block of harness/data/districts.json`);
  }
  const def = defs[args.target];
  const outlineFile = path.join(dataDir, def!.outline);
  const plan = stagePlan(districts, args.target, fs.readFileSync(outlineFile, 'utf8'));
  const b = plan.box;
  opts.log(`[bake] stage ${plan.id} (${plan.def.name}), block ${plan.def.block}: outline ${plan.areaKm2.toFixed(2)} km2, box ${b.south},${b.west} to ${b.north},${b.east} (margin ${plan.def.marginM} m)`);
  const report = emptyHealth(plan.id, plan.def.block, { file: path.relative(opts.root, outlineFile), areaKm2: Math.round(plan.areaKm2 * 1000) / 1000, box: b });
  report.tiles = { written: 0, out: args.out ?? tileFolder(plan), only: args.tiles ? args.tiles.map((t) => `${t.x}_${t.z}`) : null };
  const healthFile = opts.healthFile ?? path.join(opts.root, 'harness', 'reports', 'map', 'health.json');
  const stepMs: Record<string, number> = {};
  const finish = (): void => {
    fs.mkdirSync(path.dirname(healthFile), { recursive: true });
    // wall clock lives beside the report (timing.json), so the same inputs still give the same health.json
    fs.writeFileSync(path.join(path.dirname(healthFile), 'timing.json'), JSON.stringify({ stage: plan.id, partial: quick, tiles: report.tiles.only, totalMs: Math.round(clock.now() - t0Bake), steps: stepMs }, null, 1) + '\n');
    fs.writeFileSync(healthFile, JSON.stringify(report, null, 2) + '\n');
    // the pair table of the centre block (rule R-STITCH-03) on its own, for the pages that show it
    if (report.pairs.length) fs.writeFileSync(path.join(path.dirname(healthFile), 'pairs.json'), JSON.stringify({ version: 1, block: report.block, worstPairBearingDeg: report.layout?.worstPairBearingDeg ?? null, worstPairDistancePct: report.layout?.worstPairDistancePct ?? null, pairs: report.pairs }, null, 2) + '\n');
  };
  const check = (results: Parameters<typeof recordInvariants>[1]): void => {
    for (const r of results) opts.log(`[invariant] ${r.ok ? 'ok  ' : 'FAIL'} ${r.id}: ${r.detail}`);
    const failed = recordInvariants(report, results);
    if (failed.length) {
      finish();
      throw new BakeStop(failed);
    }
  };
  check(outlineInvariants(plan));
  // rule R-STITCH: the layout is checked in every bake, before any step runs (MAP_REPAIR.md "District frames and stitching")
  const layout = readLayoutInput(dataDir, districts, { id: `stage ${plan.id}`, block: plan.def.block, coords: plan.outline.coords });
  const lc = checkLayout(layout.input);
  report.pairs = pairRows(lc.pairs);
  report.layout = layoutRecord(districts, lc, layout.input.places.filter((p) => p.block === plan.def.block).length);
  check([
    layout.missing.length ? { id: 'R-STITCH-00.files', ok: false, detail: `named in districts.json but not there: ${layout.missing.join(', ')}` } : { id: 'R-STITCH-00.files', ok: true, detail: `${layout.input.outlines.length} outlines and ${layout.input.places.length} places read` },
    ...lc.results,
  ]);
  const sourcesFile = path.join(opts.root, 'data', 'SOURCES.json');
  let results: SourceResult[] = [];
  let groundModel: GroundModel | null = null;
  let heightSource: HeightGrid | null = null;
  let graphInput: GraphInput | null = null;
  /** The lane model the repair step's feedback built last, on the repaired graph. */
  let laneBuild: LaneBuild | null = null;
  let lanesHash = '';
  let graph: BlockGraph | null = null;
  let repaired: RepairedGraph | null = null;
  /** What the elevation step hands the mesh step: the junction centre heights and the kind of every station. */
  let elevated: { junctionHeights: ArrayLike<number>; kinds: readonly ArrayLike<number>[] } | null = null;
  /** What the mesh step hands the terrain step. */
  let meshed: { input: MeshInput; mesh: RoadMesh } | null = null;
  /** What the terrain step hands the tile step: the ground with its tiles (kept in memory, no file). */
  let grounded: Ground | null = null;
  /** What the landmark placement hands the tile step: the stand-in massing, the pins and the landmark file (P2-006). */
  let landmarked: MassingStep | null = null;
  /** The bollards and gates where the access changes (P2-042): their mesh goes into the tiles with colliders. */
  let barriered: { placements: BarrierPlacement[]; mesh: SourceMesh | null } | null = null;
  // the metro viaducts and foot bridges of the elevation step, for the infrastructure kits (P2-034)
  let overhead: OverheadResult | null = null;
  /** The area generator (P2-009): the parcels planned before the ground, and the landmark zones they keep out of. */
  let areaStep: AreaStep | null = null;
  let landmarkZones: P2[][] = [];
  let osmBarriers: BarrierFeature[] = [];
  let laneChecks: LaneChecks | null = null;
  let repairIssues: Issue[] = [];
  let meshChecks: MeshChecks | null = null;
  const conflictsFile = path.join(opts.root, plan.def.dataDir, 'lane_conflicts.json');
  const picture = async (file: string, svg: () => string, width: number): Promise<string[]> => (quick ? [] : writePicture(opts.root, file, svg(), width));
  const stepCtx = { root: opts.root, plan, offset: blockFrame(districts, plan.def.block).offset, benchDir: opts.benchDir ?? defaultBenchDir, quick, log: opts.log };
  let tStep = clock.now();
  for (const step of args.steps as Step[]) {
    if (report.steps.length) stepMs[report.steps[report.steps.length - 1] as string] = Math.round(clock.now() - tStep);
    tStep = clock.now();
    opts.log(`[bake] step ${step}`);
    report.steps.push(step);
    if (step === 'sources') {
      results = await runSourcesStage(plan, { root: opts.root, sourcesFile, net: opts.net, today: opts.today, log: opts.log, force: args.force });
      const pins = loadSources(sourcesFile);
      report.sources = results.map((r) => ({ id: r.id, kind: r.kind, action: r.action, file: r.file, sha256: r.sha256, licence: pins.files[r.id]?.licence ?? null, credit: pins.files[r.id]?.credit ?? null }));
      check(sourceInvariants(plan, results, pins));
    } else if (step === 'ground') {
      const pins = loadSources(sourcesFile);
      const fileOf = (kind: string): string | null => {
        const s = plan.sources.find((x) => x.kind === kind);
        const p = s ? pins.files[s.id] : undefined;
        return p ? path.resolve(opts.root, p.file) : null;
      };
      const gedtmFile = fileOf('gedtm30');
      const gloFile = fileOf('glo30');
      const gedtm30 = gedtmFile ? readGedtmFile(gedtmFile) : null;
      const glo30 = gedtm30 ? null : gloFile ? await readGlo30File(gloFile, plan.box) : null;
      const t0 = Date.now();
      const g = pickGround({ gedtm30, glo30 }, projector(plan.origin), boxMetres(plan));
      groundModel = g;
      heightSource = gedtm30 ?? glo30;
      report.ground = { source: g.source, method: g.method, cols: g.cols, rows: g.rows, cell: g.cell, minM: round(g.stats.min), maxM: round(g.stats.max), meanM: round(g.stats.mean), samples: g.stats.samples, holes: g.stats.holes };
      opts.log(`[ground] ${g.method}: ${g.cols} x ${g.rows} values, ${round(g.stats.min)} to ${round(g.stats.max)} m, ${g.stats.holes} holes (${Date.now() - t0} ms)`);
      check(groundInvariants(g));
    } else if (step === 'graph') {
      const input = readGraphInput(opts.root, plan);
      const t0 = Date.now();
      const g = buildBlockGraph(input);
      graphInput = input;
      graph = g;
      const buildMs = Date.now() - t0;
      const json = JSON.stringify(g);
      const counts = graphCounts(g);
      const c = checkGraph(g);
      const file = writeGraph(opts.root, plan, json);
      const pictures = await picture(`harness/reports/map/graph_${plan.id}.png`, () => graphSvg(g), 2400);
      report.graph = {
        file, picture: pictures, hash: graphHash(g), buildMs, counts,
        checks: { duplicateEdges: c.duplicateEdges.length, zeroLengthEdges: c.zeroLengthEdges.length, missingNodes: c.missingNodes.length, orphanNodes: c.orphanNodes.length, crossingsWithoutEnd: c.crossingsWithoutEnd, badMapEdgeNodes: c.badMapEdgeNodes.length, ok: c.ok },
        normalised: { ...g.normalised, duplicateWays: g.normalised.duplicateWays.length },
        footprintMerge: g.footprintSources,
      };
      opts.log(`[graph] built in ${(buildMs / 1000).toFixed(2)} s: ${counts.nodes} nodes, ${counts.edges} edges (${counts.roadKm} km), ${counts.mapEdgeEnds} map edge ends, ${counts.pairs} carriageway pairs on ${counts.pairedStreets} named streets, ${counts.footprints} footprints, ${counts.rail} rail and ${counts.metro} metro lines, ${counts.footBridges} foot bridges, ${counts.water} water areas, ${counts.open} open areas; hash ${report.graph.hash}`);
      report.underground = undergroundHealth(g.underground, g.undergroundMissing);
      opts.log(`[graph] ${g.underground.length} underground structures, left out of the footprints (no rule, shell or ground cut): ${g.underground.map((u) => `${u.name} (${u.reason})`).join('; ') || 'none'}${g.undergroundMissing.length ? `; list entries not in this extract: ${g.undergroundMissing.join(', ')}` : ''}`);
      opts.log(`[graph] wrote ${[file, ...pictures].join(', ')}`);
      check(graphInvariants(c, counts));
    } else if (step === 'repair') {
      if (!graph || !graphInput) throw new Error('the repair step needs the graph step before it');
      const extra = readRepairInput(opts.root);
      const proj = projector(plan.origin);
      const offset = blockFrame(districts, plan.def.block).offset;
      const stageRing = outlineRing(plan.outline.coords, plan.origin);
      const toBlock = (lat: number, lon: number) => proj.toWorld(lat, lon);
      // override patches (harness/data/overrides/): the ones whose anchor lies inside this stage's outline
      const entries: OverrideEntry[] = [];
      let outsideStage = 0;
      for (const e of readOverrides(opts.root, opts.overridesDir)) {
        const a = e.patch.target.anchor;
        if (pointInRing(toBlock(a.lat, a.lon), stageRing)) entries.push(e);
        else outsideStage++;
      }
      const focusIds = new Set(districts.districts.filter((d) => d.block === plan.def.block).map((d) => d.id));
      const ground = groundModel;
      const env = buildRuleEnv({
        proj, offset,
        focus: layout.input.outlines.filter((o) => focusIds.has(o.id)).map((o) => ({ id: o.id, ring: outlineRing(o.coords, plan.origin) })),
        ground: ground ? (x, z) => ground.at(x, z) : null, heightSource, heroSpecs: extra.heroSpecs, heroList: extra.heroList,
        places: extra.places.filter((p) => p.block === plan.def.block), elements: graphInput.elements, graph, mapEdge: 'stage',
      });
      // every rule once on the raw graph, timed; then the repair itself, and a second run on its result
      const timed = timeRules(new RuleContext(graph, env), () => clock.now());
      opts.log(`[rules] ${timed.issues.length} issues on the raw graph in ${timed.totalMs} ms: ${Object.entries(timed.ms).map(([id, ms]) => `${id} ${ms}`).join(', ')} (ms per rule)`);
      const t0 = clock.now();
      // the repair, then the lane model on its result: lane surfaces on each other go back as conflicts (R-LANE-06)
      const lin = laneInputs(graphInput, plan, readRepairInput(opts.root).heroSpecs, readMedianRefs(opts.root, toBlock));
      // the warm start of a partial bake: the conflicts of a whole bake with the same inputs (P1-050), else none
      const pins = loadSources(sourcesFile);
      const warm = warmKey(opts.root, [plan.id, graphHash(graph), entries.map((e) => e.patch), extra, lin.medianRefs ?? [], plan.sources.map((x) => pins.files[x.id]?.sha256 ?? null)]);
      const seed = quick ? readWarm(conflictsFile, warm) : [];
      const fb = repairWithLanes(graph, env, { overrides: { entries, project: toBlock } }, (g) => ({ nodes: g.nodes, edges: g.edges, marks: g.marks, ...lin }), seed.length ? 0 : undefined, seed);
      if (seed.length) opts.log(`[repair] partial bake: the lane feedback starts from the ${seed.length} conflicts of a whole bake with the same inputs (${path.relative(opts.root, conflictsFile)}), one round`);
      else if (quick) opts.log(`[repair] partial bake: no whole bake with the same inputs left its lane conflicts (${path.relative(opts.root, conflictsFile)}): the whole lane feedback runs`);
      else writeWarm(conflictsFile, warm, fb.conflicts);
      const res = fb.res;
      const repairMs = Math.round(clock.now() - t0);
      const again = repairGraph(res.graph, fb.env, { overrides: { entries, project: toBlock, applied: true } });
      opts.log(`[repair] lane feedback: ${fb.rounds.map((r, i) => `round ${i} ${r.overlapM2} m2 in ${r.pairs} pairs, ${r.conflicts} new conflicts (not handed back: ${Object.entries(r.skipped).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'})`).join('; ')}; ${fb.conflicts.length} conflicts in the rule environment`);
      repaired = res.graph;
      repairIssues = res.issues;
      laneBuild = fb.build;
      const s = res.summary;
      const c = checkGraph(res.graph);
      const noProposal = res.issues.filter((i) => i.status === 'open' && !i.proposals.some((p) => p.confidence > 0 && p.reasoning.length > 0 && p.preview.length > 0)).length;
      const files = writeRepair(opts.root, plan, path.dirname(healthFile), res, `production bake, stage ${plan.id}, graph ${graphHash(graph)}`, { offset, outline: stageRing, places: extra.places, toBlock });
      const pictures = await picture(`harness/reports/map/issues_${plan.id}.png`, () => issuesSvg(res.graph, res.issues), 2400);
      const ctx = new RuleContext(res.graph, fb.env, res.graph.marks);
      report.repair = { files: { ...files, picture: pictures }, hash: graphHash(res.graph), rulesMs: timed.ms, rulesTotalMs: timed.totalMs, repairMs, summary: s, secondRunRepairs: again.repairs.length, queuedWithoutProposal: noProposal, heroEdges: res.graph.edges.filter((e) => ctx.heroOf(e)).length, laneFeedback: { rounds: fb.rounds, conflicts: fb.conflicts.length } };
      const byRule: Record<string, number> = {};
      const autoByRule: Record<string, number> = {};
      for (const r of s.byRule) {
        if (r.issues) byRule[r.rule] = r.issues;
        if (r.auto) autoByRule[r.rule] = r.auto;
      }
      report.issues = { total: s.total, byRule, open: s.queued };
      report.repairs = { auto: s.auto, byRule: autoByRule };
      report.overrides = { ...res.overrideCounts, outsideStage, records: res.overrides };
      report.counts = mapCounts(res);
      report.decisions = decisionCounts(res);
      const dc = report.decisions;
      opts.log(`[decisions] owner queue ${dc.ownerQueue} (${dc.byPolicy} settled by the policy table, ${dc.byJudge} by the top-view judge pass); buildings on a road or footpath ${dc.buildings.issues}: the road gave way ${dc.buildings.roadGaveWay} (gali rule), the footpath ${dc.buildings.footpathGaveWay}, the building gives way ${dc.buildings.buildingGivesWay}, unresolved ${dc.buildings.unresolved}; roads on each other moved apart ${Object.entries(dc.overlaps.separated).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}, drawn twice and dropped ${dc.overlaps.duplicatesRemoved}, unresolved ${dc.overlaps.unresolved}; dead ends ${dc.deadEnds.issues}: joined by rule ${dc.deadEnds.connectedByRule}, closed by rule ${Object.entries(dc.deadEnds.closedByRule).map(([k, v]) => `${v} ${k.replace('_', ' ')}`).join(', ') || '0'}, joined by the judge ${dc.deadEnds.connectedByJudge}, closed by the judge ${dc.deadEnds.closedByJudge}, unresolved ${dc.deadEnds.unresolved}`);
      const removed = issuesRemovedByUnderground(graph, env);
      if (report.underground) report.underground = { ...report.underground, issuesRemoved: { total: removed.total, byRule: removed.byRule, byFeature: removed.byFeature }, overridesRetired: res.overrides.filter((o) => o.outcome === 'underground').map((o) => o.id) };
      opts.log(`[underground] the class keeps ${removed.total} issues off the raw graph (${Object.entries(removed.byRule).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}); ${res.overrideCounts.underground} override patches retired (their footprint is underground)`);
      for (const r of s.byRule) if (r.issues) opts.log(`[repair] ${r.rule.padEnd(14)} ${String(r.issues).padStart(5)} issues: ${r.auto} repaired, ${r.queued} queued, ${r.explained} explained${r.overridden ? `, ${r.overridden} settled by overrides` : ''} (${r.title})`);
      opts.log(`[repair] ${s.total} issues in ${s.passes} passes (${(repairMs / 1000).toFixed(2)} s): ${s.auto} repaired on their own (${(s.autoShare * 100).toFixed(1)} percent; ${(s.autoShareOfChanged * 100).toFixed(1)} percent of repaired plus queued; ${(s.withoutTerrainOutliers.autoShare * 100).toFixed(1)} percent without the terrain outlier rule), ${s.queued} queued for the owner (${s.highImpact} high impact), ${s.decidedPolicy} of the repaired settled by the policy table, ${s.decidedJudge} of the overrides by the judge pass, ${s.provisionalApplied} patches applied after the last pass, ${s.explained} explained, ${s.overridden} settled by overrides, ${s.drops} drops logged; a second run applies ${again.repairs.length} repairs`);
      const ov = res.overrideCounts;
      opts.log(`[overrides] ${ov.patches} patches in ${ov.files} files for this stage (${outsideStage} outside it): ${ov.byId} found by id, ${ov.byAnchor} by anchor, ${ov.stale} stale (kept in their files), ${ov.applied} applied, ${ov.switchedOff} repairs switched off, ${ov.idle} idle, ${ov.underground} retired (underground); ${ov.issuesSettled} issues settled`);
      opts.log(`[repair] wrote ${[files.graph, files.issues, files.repairs, ...pictures].join(', ')}`);
      check([
        { id: 'REPAIR-01.fixed_point', ok: again.repairs.length === 0 && s.unconverged === 0, detail: again.repairs.length === 0 && s.unconverged === 0 ? `a second run on the repaired graph applies 0 repairs (${s.passes} passes)` : `a second run applies ${again.repairs.length} repairs (${again.repairs.slice(0, 3).map((x) => x.issue).join(', ')}), ${s.unconverged} issues could still repair after ${s.passes} passes (${Object.entries(s.unconvergedBy).map(([k, v]) => `${k} ${v}`).join(', ')})` },
        { id: 'REPAIR-02.proposals', ok: noProposal === 0, detail: noProposal === 0 ? `every one of the ${s.queued} queued issues has a proposal with a confidence, a reasoning line and a preview` : `${noProposal} queued issues have no usable proposal` },
        { id: 'REPAIR-03.topology', ok: c.duplicateEdges.length + c.zeroLengthEdges.length + c.missingNodes.length + c.orphanNodes.length === 0, detail: `repaired graph: ${res.graph.nodes.length} nodes, ${res.graph.edges.length} edges, ${c.duplicateEdges.length} duplicate edges, ${c.zeroLengthEdges.length} zero length, ${c.missingNodes.length} missing nodes, ${c.orphanNodes.length} orphan nodes` },
      ]);
    } else if (step === 'lanes') {
      if (!repaired || !graphInput) throw new Error('the lanes step needs the repair step before it');
      const proj = projector(plan.origin);
      const offset = blockFrame(districts, plan.def.block).offset;
      const heroes = readRepairInput(opts.root).heroSpecs;
      const input: LaneModelInput = { nodes: repaired.nodes, edges: repaired.edges, marks: repaired.marks, ...laneInputs(graphInput, plan, heroes, readMedianRefs(opts.root, (lat, lon) => proj.toWorld(lat, lon))) };
      const t0 = clock.now();
      // the repair step's last lane model is this model (the same graph and inputs); built again for the hash check
      const build: LaneBuild = laneBuild ?? buildLaneModel(input);
      opts.faults?.lanes?.(build);
      // who may use each road (P2-042): the lane graph and the tiles carry the modes of every lane
      const acc = runAccessStep(opts.root, (lat, lon) => proj.toWorld(lat, lon), repaired);
      build.access = acc.access;
      report.access = acc.record;
      osmBarriers = acc.barriers;
      {
        const a = acc.record;
        opts.log(`[access] modes by edges: ${Object.entries(a.byMode).map(([m, v]) => `${m} ${v.edges} (${v.km} km)`).join(', ')}; closed to cars ${a.carFree.edges} edges (${a.carFree.km} km), private ${a.private.edges}`);
        opts.log(`[access] decided by: ${Object.entries(a.byReason).filter(([, v]) => v.edges > 0).map(([r, v]) => `${r} ${v.edges} (${v.closedToCars} closed to cars)`).join(', ')}; rules: ${a.rules.map((r) => `${r.id} ${r.edges}`).join(', ')}; OSM barrier nodes ${a.osmBarriers.total} (${a.osmBarriers.onEdges} on the road graph, ${a.osmBarriers.stopCar} stop a car)`);
      }
      const buildMs = laneBuild ? Math.round(laneBuild.ms['total'] ?? 0) : Math.round(clock.now() - t0);
      const model = laneModelFile(build, plan.def.block, plan.id);
      const hash = laneModelHash(model);
      laneBuild = build;
      lanesHash = hash;
      // the same input again: the model must not depend on anything but its input
      const again = quick ? hash : laneModelHash(laneModelFile(buildLaneModel(input), plan.def.block, plan.id));
      const c = checkLaneModel(build, heroes);
      laneChecks = c;
      const files = writeLanes(opts.root, plan, path.dirname(healthFile), model, laneGraph(build, plan.def.block, offset), lanesLayer(build, plan.def.block, offset, plan.origin));
      const pictures: string[] = [];
      for (const v of LANE_VIEWS) {
        const at = proj.toWorld(v.lat, v.lon);
        if (!pointInRing(at, outlineRing(plan.outline.coords, plan.origin))) continue;
        const box = { minX: at.x - v.halfM, maxX: at.x + v.halfM, minZ: at.z - v.halfM, maxZ: at.z + v.halfM };
        pictures.push(...(await picture(`harness/reports/map/lanes_${plan.id}_${v.id}.png`, () => lanesSvg(build, box, `${v.name}: lane model, north up (${plan.id})`), 2400)));
      }
      const rec = lanesRecord(build, c, hash, buildMs, { ...files, pictures });
      report.lanes = rec;
      if (report.decisions) report.decisions.overlaps.mergedZones = { merges: c.zones.merges, diverges: c.zones.diverges };
      report.gates['laneContinuityBreaks'] = c.continuity.breaks;
      report.gates['tapersOutOfLimits'] = c.tapers.violations;
      report.gates['widthSteps'] = c.widthSteps.steps;
      const n = rec.counts;
      opts.log(`[lanes] built in ${(buildMs / 1000).toFixed(2)} s (${build.rounds} rounds): ${n.strips} strips (${n.taperStrips} tapers, ${n.zoneStrips} split zones), ${n.stations} stations, ${n.driveLanes} driving lanes (${n.laneKm} lane km, ${n.galiLanes} gali lanes), ${n.junctions} junctions with ${n.junctionPaths} lane paths for ${n.junctionPairs} arm pairs; hash ${hash}`);
      opts.log(`[lanes] lane counts: ${Object.entries(rec.inference.from).map(([k, v]) => `${k} ${v}`).join(', ')}; ${rec.inference.changed} edges differ from their own tag or class default; ${n.fitted} took a count the model settled, ${n.widenings} widen before a junction`);
      opts.log(`[lanes] continuity breaks ${c.continuity.breaks} (${c.continuity.lanePairs} lane pairs at ${c.continuity.joints} joints; ends explained: ${Object.entries(c.explainedEnds).map(([k, v]) => `${k} ${v}`).join(', ')}); tapers ${c.tapers.tapers}, out of limits ${c.tapers.violations} (${c.tapers.violations - c.tapers.unexplained} explained, ${c.tapers.unexplained} findings listed)`);
      opts.log(`[lanes] zones ${c.zones.zones} (${c.zones.diverges} diverges, ${c.zones.merges} merges), without gore or nose ${c.zones.withoutGoreOrNose}, off a branch centre line ${c.zones.endsOffCentreLine} (largest ${c.zones.maxEndErrorM} m); ${n.forks} one-way forks are junctions (${Object.entries(rec.forks.byReason).map(([k, v]) => `${v}: ${k}`).join('; ')})`);
      opts.log(`[lanes] paths: ${c.paths.pairsWithoutPath} arm pairs without a path, ${c.paths.pairsBelowRadius} under the ${c.paths.minRadiusM === null ? '' : `radius (smallest ${c.paths.minRadiusM} m)`}, ${build.turns.uTurnsTooTight} U-turns left out, ${build.turns.droppedForRadius} turns left out for radius; left-hand side wrong on ${c.trafficSide.wrongSide} of ${c.trafficSide.twoWayStrips} two-way strips; ${c.widths.tooNarrow} lanes too narrow (narrowest ${c.widths.narrowestM} m, gali ${c.widths.narrowestGaliM} m)`);
      opts.log(`[lanes] hero: ${c.hero.map((h) => `${h.spec} ${h.mismatches} mismatches over ${h.fieldsCompared} comparisons`).join(', ') || 'no spec'}; strips on each other in plan: ${c.overlap?.areaM2 ?? 0} m2 in ${c.overlap?.pairs ?? 0} pairs; edges gave way on ${build.edgeTrims.strips} strips (${build.edgeTrims.stations} stations, ${build.edgeTrims.areaM2} m2)`);
      const tr = build.turnRules;
      opts.log(`[lanes] turn rules: ${tr.restrictions.relations} restriction relations (${Object.entries(tr.restrictions.byType).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}), ${tr.restrictions.mapped} on graph edges, ${tr.restrictions.applied} applied at their junction (${tr.restrictions.movementsRemoved} movements taken out)${tr.restrictions.unmapped.length + tr.restrictions.notApplied.length ? `; not applied: ${[...tr.restrictions.unmapped, ...tr.restrictions.notApplied].map((u) => `${u.id} (${u.why})`).join('; ')}` : ''}; turn lanes on ${tr.turnLanes.ways} ways (${Object.entries(tr.turnLanes.bySource).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}), used on ${tr.turnLanes.applied} arms (${tr.turnLanes.movementsRemoved} movements no lane allows), ${tr.turnLanes.mismatched.length} arms whose lane count differs`);
      const dv = build.dividers;
      if (dv) opts.log(`[lanes] reference dividers: ${dv.lanesSet ?? 0} carriageways took a lane count from the space up to their divider; ${dv.strips} strips widened at ${dv.stations} stations (up to ${dv.maxM} m), ${dv.reach.fitted} of ${dv.reach.asked} stations reach their divider (${Object.entries(dv.byStreet).map(([k, v]) => `${k} ${v.meanM} m`).join(', ')})`);
      const mc = build.crossingReport;
      opts.log(`[lanes] mid-block crossings: ${mc.placed} placed from ${mc.points} crossing points (${mc.pairedAdded} more on the other carriageway); skipped ${Object.entries(mc.skipped).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}`);
      const ws = rec.widthSteps;
      opts.log(`[lanes] width continuity: ${ws.steps} width steps over ${ws.corridors} corridors through junctions (${Object.entries(ws.byKind).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}); the width step settled ${ws.tapers} tapers at junction ends (${ws.shortTapers} shorter than their class asks, explained) and ${ws.whole} roads whole in ${ws.rounds} rounds${ws.left ? `, ${ws.left} left` : ''}`);
      opts.log(`[lanes] wrote ${files.model}, ${files.laneGraph}, ${files.layer} and ${pictures.join(', ')}`);
      const heroBad = c.hero.reduce((sum, h) => sum + h.mismatches, 0);
      check([
        { id: 'LANES-01.continuity', ok: c.continuity.breaks === 0, detail: c.continuity.breaks === 0 ? `every lane at a strip end has a successor or an explained end (${c.continuity.lanePairs} lane pairs, ${build.ends.length} explained ends)` : `${c.continuity.breaks} lanes end with nothing after them: ${c.continuity.list.slice(0, 3).map((x) => `${x.strip} lane ${x.lane}`).join(', ')}` },
        { id: 'LANES-02.zones', ok: c.zones.withoutGoreOrNose + c.zones.endsOffCentreLine === 0, detail: `${c.zones.zones} split zones: ${c.zones.withoutGoreOrNose} without a gore or a nose, ${c.zones.endsOffCentreLine} ending off a branch centre line (largest ${c.zones.maxEndErrorM} m)` },
        { id: 'LANES-03.same_twice', ok: hash === again, detail: quick ? NOT_TWICE : hash === again ? `the same hash twice (${hash})` : `two builds of one input differ: ${hash} and ${again}` },
        { id: 'LANES-04.left_hand_and_widths', ok: c.trafficSide.wrongSide + c.widths.tooNarrow === 0, detail: `${c.trafficSide.wrongSide} two-way strips on the wrong side, ${c.widths.tooNarrow} lanes under their width limit` },
        { id: 'LANES-05.hero', ok: heroBad === 0, detail: `${heroBad} hero spec mismatches` },
        { id: 'LANES-06.width_steps', ok: c.widthSteps.steps === 0, detail: c.widthSteps.steps === 0 ? `no width step along ${c.widthSteps.corridors} corridors through junctions: every width change lies in a taper` : `${c.widthSteps.steps} width steps of more than 1 m within 5 m: ${c.widthSteps.list.slice(0, 3).map((w) => `${w.where} ${w.fromM} to ${w.toM} m`).join(', ')}` },
      ]);
    } else if (step === 'elevation') {
      if (!laneBuild || !repaired || !groundModel || !lanesHash) throw new Error('the elevation step needs the ground and the lanes step before it');
      const build = laneBuild;
      const ground = groundModel;
      const offset = blockFrame(districts, plan.def.block).offset;
      // the same lane model the lanes step wrote; solved twice, the second time to show the heights do not depend on the run
      const input = elevationInput(build, repaired, (x, z) => ground.at(x, z));
      const first = solveBlockElevation(input);
      const before = build.strips.map((s) => s.st.map((st) => st.h));
      const res = quick ? first : solveBlockElevation(input);
      let twoRuns = 0;
      build.strips.forEach((s, si) => s.st.forEach((st, i) => (twoRuns = Math.max(twoRuns, Math.abs(st.h - ((before[si] as number[])[i] as number))))));
      res.junctionHeights.forEach((h, i) => (twoRuns = Math.max(twoRuns, Math.abs(h - (first.junctionHeights[i] as number)))));
      const c = checkElevation(build.strips, build.joints, input.junctions, res);
      const st = readStructures({ strips: build.strips, joints: build.joints, junctions: input.junctions, junctionHeights: res.junctionHeights, tunnels: res.tunnels, crossings: res.crossings, pairSamples: res.pairSamples, water: input.water ?? [], ties: input.ties ?? [], ground: input.ground });
      // metro viaducts and foot bridges stand over the solved roads (P1-035)
      const over = overheadHeights({
        strips: build.strips, junctions: input.junctions.map((j, ji) => ({ ...j, id: (build.junctions[ji] as { id: string }).id })), junctionHeights: res.junctionHeights,
        rails: input.rails ?? [], metro: repaired.features.rail.filter((r) => r.kind === 'metro').map((r) => ({ id: r.id, name: r.name, pts: r.pts, layer: r.layer, bridge: r.bridge, tunnel: r.tunnel })),
        footBridges: repaired.features.footBridges, water: input.water ?? [], ground: input.ground, railEmbankment: RAIL_EMBANKMENT_M,
      });
      overhead = over;
      // strips on each other only on the solved levels (a ramp on fill beside a road at grade): their edge lanes give
      // way, and the lane files are written again (P1-042)
      const solvedBefore = checkPlanOverlap(build.strips, build.joints, undefined, st.kinds);
      const solvedTrims = giveWaySolved(build, st.kinds);
      if (solvedTrims.stations > 0) {
        const model = laneModelFile(build, plan.def.block, plan.id);
        lanesHash = laneModelHash(model);
        writeLanes(opts.root, plan, path.dirname(healthFile), model, laneGraph(build, plan.def.block, offset), lanesLayer(build, plan.def.block, offset, plan.origin));
        if (report.lanes) report.lanes.hash = lanesHash;
      }
      if (report.lanes) report.lanes.solvedTrims = { ...solvedTrims, beforeM2: solvedBefore?.areaM2 ?? 0, beforePairs: solvedBefore?.pairs ?? 0 };
      opts.log(`[elevation] edges gave way on the solved levels: ${solvedTrims.strips} strips, ${solvedTrims.stations} stations, ${solvedTrims.areaM2} m2 (strips on each other before: ${solvedBefore?.areaM2 ?? 0} m2 in ${solvedBefore?.pairs ?? 0} pairs)`);
      const file = elevationFile(build.strips, build.junctions.map((j) => j.id), res, st, input.rails ?? [], plan.def.block, plan.id, lanesHash, over);
      const hash = elevationHash(file);
      const heights = writeElevation(opts.root, plan, file);
      const ring = outlineRing(plan.outline.coords, plan.origin);
      const box = { minX: Math.min(...ring.map((p) => p.x)), maxX: Math.max(...ring.map((p) => p.x)), minZ: Math.min(...ring.map((p) => p.z)), maxZ: Math.max(...ring.map((p) => p.z)) };
      const pictures = await picture(`harness/reports/map/elevation_${plan.id}.png`, () => heightMapSvg(build.strips, st.structures, box, `Heights above the ground model, north up (${plan.id}): ${st.structures.length} structures`), 2400);
      for (const v of PROFILE_VIEWS) {
        if (build.strips.some((s) => v.match.test(s.name))) pictures.push(...(await picture(`harness/reports/map/elevation_${plan.id}_${v.id}.png`, () => profileSvg(build.strips, (s) => v.match.test(s.name), `${v.name} (${plan.id})`), 2200)));
      }
      const rec = elevationRecord(build.strips, res, c, st, offset, hash, twoRuns, { heights, pictures }, over);
      rec.solveMs = first.report.ms['total'] ?? 0;
      rec.solver = first.report;
      report.elevation = rec;
      elevated = { junctionHeights: res.junctionHeights, kinds: st.kinds };
      // the lane model's plan overlap once more on the solved levels: a bridge left on fill lies beside the roads at grade
      if (report.lanes) {
        const ov = (report.lanes.overlapSolved = checkPlanOverlap(build.strips, build.joints, undefined, st.kinds));
        opts.log(`[elevation] strips on each other on the solved levels: ${ov.areaM2} m2 in ${ov.pairs} pairs (${ov.worst.slice(0, 3).map((w) => `${w.a} on ${w.b} ${w.areaM2} m2`).join(', ') || 'none'})`);
      }
      report.gates['floatingEnds'] = rec.openEnds.floating;
      const s = first.report;
      opts.log(`[elevation] solved in ${(rec.solveMs / 1000).toFixed(2)} s (${s.rounds} rounds, ${s.factorisations} factorisations, ${s.converged ? 'converged' : 'NOT converged'}): ${s.strips} strips and ${s.stations} stations in ${s.chains} chains, ${s.knots} knots, ${s.unknowns} unknowns (${s.branches} branches follow their main line, ${s.ties} map edge ties), matrix ${s.matrix} values, factor ${s.factor}; ms ${Object.entries(s.ms).map(([k, v]) => `${k} ${v}`).join(', ')}`);
      opts.log(`[elevation] limits held: ${Object.entries(s.active).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n} of ${s.limits[k as keyof typeof s.limits]}`).join(', ')}; given up ${res.unmet.length}`);
      opts.log(`[elevation] steps: largest mismatch ${c.steps.maxMismatchM} m at ${c.steps.joints} joints, steepest junction surface ${c.steps.steepestJunctionPct} percent over ${c.steps.junctionArms} arms; grades: ${c.grade.violations} over the class limit in ${c.grade.segments} segments (steepest ${c.grade.steepestPct} percent on ${c.grade.steepest?.strip ?? 'none'}, limit ${c.grade.steepest?.limitPct ?? 0}); vertical curves: ${c.curves.violations} under the class limit of ${c.curves.measured} measured (closest to its limit: ${c.curves.tightest?.radiusM ?? 0} m against ${c.curves.tightest?.limitM ?? 0} m on ${c.curves.tightest?.strip ?? 'none'})`);
      opts.log(`[elevation] clearances: ${c.clearance.violations} short; road over road ${c.clearance.roadCrossings} crossings (${c.clearance.roadSamples} places, least headroom ${c.clearance.minRoadM} m), ${c.clearance.junctionCrossings} over or under a junction (least ${c.clearance.minJunctionM} m), ${c.clearance.roadOverRail} places over a railway line (least ${c.clearance.minRoadOverRailM} m), ${c.clearance.roadUnderRail} under a railway bridge (least ${c.clearance.minRoadUnderRailM} m), ${c.clearance.waterCrossings} decks over water (least ${c.clearance.minOverWaterM} m above it), ${c.clearance.tunnelStations} tunnel stations (least cover ${c.clearance.minCoverM} m); crossfall: ${c.crossfall.violations} over the limit at ${c.crossfall.limited} places (worst ${c.crossfall.worstPct} percent); ties: ${c.ties.ends} map edge ends, ${c.ties.moved} moved by a clearance (largest ${c.ties.maxOffM} m)`);
      opts.log(`[elevation] structures: ${st.structures.length} (${Object.entries(rec.structureCounts).map(([k, n]) => `${n} ${k}`).join(', ')}), ${rec.structureM} m of road on or in them, ${rec.abutments} ends (${rec.openEnds.mapEdge} at the map edge, ${rec.openEnds.underGround} dead ends under the ground, ${rec.openEnds.floating} hanging in the air); two runs differ by at most ${twoRuns} m; hash ${hash}`);
      for (const x of st.structures.slice().sort((p, q) => q.structureM - p.structureM).slice(0, 8)) opts.log(`[elevation]   ${x.id} ${x.kind} ${x.name || '(no name)'}: structureM ${x.structureM}, sunk ${x.sunk}, up to ${x.maxAboveM} m above and ${x.maxBelowM} m under the ground`);
      const o = rec.overhead;
      if (o) opts.log(`[elevation] overhead: ${o.viaducts} metro viaducts (${o.viaductM} m, rail ${o.railAboveGroundM?.min ?? 0} to ${o.railAboveGroundM?.max ?? 0} m above the ground model, ${o.viaductCrossings} things under them, least road clearance ${o.viaductMinClearanceM ?? 'none'} m, short ${o.viaductShortM} m); ${o.footBridges} foot bridges (${o.solvedFootBridges} on the road graph, ${o.footCrossings} things under them, least road clearance ${o.footMinClearanceM ?? 'none'} m, short ${o.footShortM} m, ${o.stairs} stairs)`);
      for (const x of o?.short ?? []) opts.log(`[elevation]   short: ${x.name} ${x.over} over ${x.kind} ${x.under} at ${x.x}, ${x.z}: ${x.clearanceM} m of ${x.needM} m`);
      opts.log(`[elevation] wrote ${heights} and ${pictures.join(', ')}`);
      check([
        { id: 'ELEV-01.no_steps', ok: c.steps.maxMismatchM < 0.01, detail: `largest height mismatch where strips meet: ${c.steps.maxMismatchM} m (${c.steps.joints} joints)` },
        { id: 'ELEV-02.grades_and_curves', ok: c.grade.violations + c.curves.violations === 0 && c.steps.steepestJunctionPct <= 5.0001, detail: `${c.grade.violations} grades over the class limit, ${c.curves.violations} vertical curves under the class limit, steepest junction surface ${c.steps.steepestJunctionPct} percent` },
        { id: 'ELEV-03.clearances', ok: c.clearance.violations === 0, detail: c.clearance.violations === 0 ? `every one of ${c.clearance.roadCrossings} road crossings, ${c.clearance.junctionCrossings} junction crossings, ${c.clearance.roadOverRail + c.clearance.roadUnderRail} railway crossings and ${c.clearance.waterCrossings} decks over water has its clearance` : `${c.clearance.violations} clearances short: ${c.findings.filter((x) => x.kind === 'clearance').slice(0, 3).map((x) => `${x.strip} ${x.value} m (${x.why})`).join(', ')}` },
        { id: 'ELEV-04.solved', ok: s.converged && res.unmet.length === 0 && c.crossfall.violations === 0, detail: `the solve ${s.converged ? 'converged' : 'did not converge'} in ${s.rounds} rounds, ${res.unmet.length} limits given up, ${c.crossfall.violations} crossfalls over the limit` },
        { id: 'ELEV-05.same_twice', ok: twoRuns <= 1e-6, detail: quick ? NOT_TWICE : `two solves of the same lane model differ by at most ${twoRuns} m` },
        // the viaducts are built in P2-019: a headroom one of them cannot give is listed (overhead.short), not a stop
        { id: 'ELEV-06.overhead', ok: over.viaducts.every((v) => v.profile.length >= 2 && v.profile.every((p) => Number.isFinite(p[2]))) && over.footBridges.every((f) => Number.isFinite(f.deckH)), detail: `${over.viaducts.length} metro viaducts with a rail level and ${over.footBridges.length} foot bridges with a walking level; ${o?.short.length ?? 0} crossings under them short of their headroom (viaducts by ${o?.viaductShortM ?? 0} m at most, foot bridges by ${o?.footShortM ?? 0} m)` },
      ]);
    } else if (step === 'mesh') {
      if (!laneBuild || !elevated) throw new Error('the mesh step needs the lanes and the elevation step before it');
      const m = await runMeshStep(stepCtx, laneBuild, elevated, graph && repaired ? { raw: graph, repaired, issues: repairIssues } : undefined);
      meshed = { input: m.input, mesh: m.mesh };
      // bollards and gates where the access changes (P2-042), on the solved heights
      if (laneBuild.access) {
        const b = placeBarriers({ strips: laneBuild.strips, joints: laneBuild.joints, junctions: laneBuild.junctions, access: laneBuild.access, osm: osmBarriers });
        barriered = { placements: b.placements, mesh: b.mesh };
        const dir = path.join(path.dirname(healthFile), 'access');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, 'barriers.json');
        fs.writeFileSync(file, JSON.stringify({ _doc: 'Bollards and gates where the access changes (P2-042, tools/bake/mesh/barriers.ts). x, z block metres (world = block + offset), y the road height, dir the road direction; posts are block metres.', offset: [stepCtx.offset.x, stepCtx.offset.z], placements: b.placements }, null, 1) + '\n');
        b.record.file = path.relative(opts.root, file);
        if (report.access) report.access.barriers = b.record;
        const r = b.record;
        opts.log(`[access] barriers: ${r.lines} lines, ${r.posts} posts (${r.triangles} triangles): ${Object.entries(r.bySource).map(([k, v]) => `${k} ${v}`).join(', ')}; ${Object.entries(r.byKind).map(([k, v]) => `${k} ${v}`).join(', ')}; by rule ${Object.entries(r.byRule).map(([k, v]) => `${k} ${v}`).join(', ')}; widest gap of a car-stopping line ${r.maxGapM} m; missing ${r.missing.length}; OSM barrier nodes not placed (inside a junction) ${r.osmUnplaced.length}`);
        check([{ id: 'ACCESS-01.barriers', ok: r.missing.length === 0 && r.maxGapM <= 1.3, detail: r.missing.length === 0 && r.maxGapM <= 1.3 ? `${r.lines} barrier lines, every closed way that meets a road open to cars has its bollards, widest gap ${r.maxGapM} m` : `${r.missing.length} closed ways with no barrier line (${r.missing.slice(0, 3).map((x) => `${x.edge} at ${x.at}`).join(', ')}), widest gap ${r.maxGapM} m (limit 1.3)` }]);
      }
      meshChecks = m.checks;
      report.mesh = m.rec;
      for (const k of ['overlappingRoadFaces', 'openBoundaryEdges', 'unjoinedEnds', 'floatingEnds', 'railingsAtGrade', 'piersInLane'] as const) report.gates[k] = m.rec.gates[k];
      check(m.invariants);
      // buildings off the road faces just built (P1-030): the ground and the shells stand on the cleared footprints
      if (repaired) {
        const b = runClearStep(stepCtx, meshed, repaired, path.dirname(healthFile));
        report.buildings = b.rec;
        check(b.invariants);
        // the inspector and the judge sheets draw the footprints as they are now
        fs.writeFileSync(path.join(path.dirname(healthFile), 'context.json'), JSON.stringify(inspectorContext(repaired, blockFrame(districts, plan.def.block).offset, repaired.outline)));
      }
    } else if (step === 'terrain') {
      if (!meshed || !repaired || !groundModel) throw new Error('the terrain step needs the ground, the repair and the mesh step before it');
      // landmark placement (P2-006): the zones take their buildings out of the plain footprints and the pads, forecourts
      // and wall strips go into the ground; after the ground is built the pads are checked on it and the massing stands on it
      const model = groundModel;
      const placed = graphInput ? await runPlaceStep(stepCtx, districts, meshed, repaired, (x, z) => model.at(x, z), graphInput.elements, path.dirname(healthFile)) : null;
      if (placed) {
        report.landmarks = placed.rec;
        check(placed.invariants);
      }
      // the area generator, part one (P2-009): blueprints, odd outlines and the lots of block faces become the parcels
      // the ground is cut round; landmark zones are left out
      landmarkZones = placed ? placed.result.placements.flatMap((p) => [p.zone?.ring, p.pad?.ring].filter((r): r is P2[] => r !== undefined && r.length >= 3)) : [];
      areaStep = runParcelStep(stepCtx, meshed, repaired, landmarkZones, path.dirname(healthFile));
      if (areaStep) {
        report.areas = areaStep.rec;
        fs.writeFileSync(path.join(path.dirname(healthFile), 'context.json'), JSON.stringify(inspectorContext(repaired, blockFrame(districts, plan.def.block).offset, repaired.outline)));
      }
      // footways, paths, steps and pedestrian areas as paved walking surfaces (P2-042), after the landmark ground
      const walk = walkwayGround({ walkways: repaired.features.walkways ?? [], roads: roadFaceRings(meshed), footprints: repaired.footprints.map((f) => f.ring), water: repaired.features.water.map((w) => w.rings), outline: repaired.outline });
      if (report.access) report.access.walkways = walk.record;
      opts.log(`[access] walkways: ${walk.record.ways} ways (${Object.entries(walk.record.byKind).map(([k, v]) => `${k} ${v.ways}${v.m ? ` ${v.m} m` : ''}${v.m2 ? ` ${v.m2} m2` : ''}`).join(', ')}): ${walk.record.areaM2} m2 of paving in ${walk.record.pieces} pieces (${walk.record.holes} holes), ${walk.record.cutM2} m2 on roads, buildings and water left to them`);
      const t = await runTerrainStep(stepCtx, meshed, repaired, groundModel, [...(placed?.ground ?? []), ...walk.pieces]);
      grounded = t.ground;
      report.terrain = t.rec;
      for (const [k, n] of Object.entries(t.rec.gates)) report.gates[k] = n;
      check(t.invariants);
      if (placed) {
        landmarked = runMassingStep(stepCtx, placed, t.ground, new GroundHeights(t.ground), (x, z) => model.at(x, z));
        check(landmarked.invariants);
      }
      opts.tap?.(step, { meshed, repaired, groundModel, landmarks: placed?.ground ?? [] });
    } else if (step === 'tiles') {
      if (!laneBuild || !meshed || !grounded || !repaired || !laneChecks || !meshChecks) throw new Error('the tiles step needs the lanes, mesh and terrain steps before it');
      // the six gate counts with their items: each 0 or explained (harness/data/gate_explanations.json), or no tile is written
      report.gateReport = explainGates(gateItems(repaired, laneBuild, laneChecks, meshChecks), readGateFile(opts.root));
      report.gates['openPorts'] = report.gateReport.gates['openPorts']?.count ?? null;
      for (const l of gateLog(report.gateReport)) opts.log(`[gates] ${l}`);
      check([gateInvariant(report.gateReport)]);
      // the infrastructure kits (P2-034): every flyover, bridge, viaduct, rail stretch and foot bridge from its variant
      const finalGround = new GroundHeights(grounded);
      const probe = new RoadProbe(meshed.mesh.fs, meshed.mesh.grid);
      const model = groundModel;
      const blockProj = projector(plan.origin);
      const infra = buildInfra({
        strips: meshed.input.strips, variants: meshed.input.variants ?? [], kit: meshed.mesh.structures.kit, piers: meshed.mesh.structures.piers,
        rails: repaired.features.rail, viaducts: overhead?.viaducts ?? [], footBridges: repaired.features.footBridges, footHeights: overhead?.footBridges ?? [],
        ground: (x, z) => finalGround.at(x, z), groundModel: (x, z) => (model ? model.at(x, z) : 0), roadAt: (x, z, near) => probe.roadAt(x, z, near),
        blocked: (x, z, r, below) => probe.blocked(x, z, r, below), railEmbankment: RAIL_EMBANKMENT_M, rules: readInfraRules(opts.root),
        skyline: infraSkyline(opts.root).map((k) => {
          const w = blockProj.toWorld(k.lat, k.lon);
          return { ...k, x: w.x, z: w.z };
        }),
        platforms: graphInput ? platformSources(graphInput.elements, (lat, lon) => { const w = blockProj.toWorld(lat, lon); return { x: w.x, z: w.z }; }) : [],
        offset: blockFrame(districts, plan.def.block).offset, stage: plan.id, block: plan.def.block,
      });
      report.infra = infra.record;
      const ir = infra.record;
      opts.log(`[infra] kits: ${Object.entries(ir.variants).map(([k, v]) => `${k} ${v}`).join(', ')}; ${Math.round(ir.edgesM)} m of deck and ramp sides, ${ir.piers} road piers; ${ir.tracksKm} km of track (${ir.railBridges} rail bridges, ${ir.embankmentM} m on approach embankments, ${ir.levelCrossingSamples} level crossing samples), ${ir.masts} overhead line masts, ${ir.platforms} platforms (${ir.platformsSkipped} left out: no rail track beside them); ${ir.metroDecks} metro decks on ${ir.metroPiers} piers (${ir.metroPiersMoved} moved off a road, ${ir.metroPiersSkipped} left out); ${ir.footBridges} foot bridges on ${ir.footColumns} columns with ${ir.stairs} stairs; ${ir.tiles} tiles, ${ir.envelopeTriangles} collider triangles`);
      check([{ id: 'INFRA-01.every_structure_has_a_kit', ok: ir.withoutKit.length === 0, detail: ir.withoutKit.length === 0 ? `every flyover, bridge, viaduct, rail stretch and foot bridge is built from a variant kit (${Object.keys(ir.variants).length} variants)` : `${ir.withoutKit.length} structure strips have no variant: ${ir.withoutKit.slice(0, 5).join(', ')}` }]);
      // the area generator, part two (P2-009): buildings, shells and facade placements on the built ground
      let generated: { shells: Shell[]; placements: Map<string, { module: string; xforms: number[]; data: number[] }[]>; lines: number } | undefined;
      if (areaStep && groundModel) {
        const heights = new GroundHeights(grounded);
        const model = groundModel;
        const g = await runCityStep(stepCtx, areaStep, (x, z) => heights.at(x, z), (x, z) => model.at(x, z), meshed, repaired, landmarkZones);
        report.areas = g.rec;
        check(g.invariants);
        generated = { shells: g.city.shells, placements: new Map([...g.city.placements].map(([id, t]) => [id, t.list])), lines: g.city.lines.length };
      }
      const res = runTileStep({
        root: opts.root, out: report.tiles.out ?? tileFolder(plan), stage: plan.id, block: plan.def.block, origin: plan.origin, offset: blockFrame(districts, plan.def.block).offset,
        outline: repaired.outline, lanes: laneBuild, meshed, ground: grounded, repaired, places: layout.input.places, only: report.tiles.only, log: opts.log,
        ...(landmarked ? { landmarks: { meshes: landmarked.meshes, pins: landmarked.pins, file: landmarked.file } } : {}),
        ...(barriered ? { access: { meshes: barriered.mesh ? [barriered.mesh] : [], placements: barriered.placements } } : {}),
        infra: { meshes: infra.meshes, file: infra.file },
        ...(generated ? { generated } : {}),
        // the committed expected hash follows a whole bake of the game's own tile folder (never a partial bake or an --out folder)
        hashFile: report.tiles.only === null && report.tiles.out === DEFAULT_TILES ? TILES_HASH_FILE : undefined,
      });
      report.tiles = { ...report.tiles, written: res.written, record: res.record };
      check(res.invariants);
    }
  }
  if (report.steps.length) stepMs[report.steps[report.steps.length - 1] as string] = Math.round(clock.now() - tStep);
  finish();
  const totalMs = Math.round(clock.now() - t0Bake);
  opts.log(`[bake] ${quick ? `partial bake of ${report.tiles.only?.join(', ')}` : 'whole bake'} in ${(totalMs / 1000).toFixed(1)} s (${Object.entries(stepMs).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}`).join(', ')} s); ${report.tiles.written} tiles written`);
  opts.log(`[bake] health report: ${path.relative(opts.root, healthFile)}`);
  return report;
}

const round = (v: number): number => Math.round(v * 100) / 100;

/** The lane conflicts the last whole bake wrote; none when the file is missing or half written (a cold start). */
/** harness/data/gate_explanations.json: the entries that explain the gate items left, and the known findings. */
export function readGateFile(root: string): GateFile {
  const f = path.join(root, 'harness', 'data', 'gate_explanations.json');
  if (!fs.existsSync(f)) return { explanations: [], findings: [] };
  const j = JSON.parse(fs.readFileSync(f, 'utf8')) as Partial<GateFile>;
  return { explanations: j.explanations ?? [], findings: j.findings ?? [] };
}

/** The folder a stage's tiles go to: the stage's `tiles` field, else game/world/tiles (gitignored, read by the game). */
export const tileFolder = (plan: StagePlan): string => plan.def.tiles ?? DEFAULT_TILES;
export const DEFAULT_TILES = path.join('game', 'world', 'tiles');
/** The bake hash of the full tile set the repo expects (harness/bin/tileset.mjs checks a worktree's tiles against it). */
export const TILES_HASH_FILE = path.join('game', 'world', 'tiles.hash');

async function main(): Promise<void> {
  let args: BakeArgs;
  try {
    args = parseArgs(proc.argv.slice(2));
  } catch (e) {
    out.log(e instanceof Error ? e.message : String(e));
    proc.exitCode = 2;
    return;
  }
  try {
    await bake(args, { root: ROOT, net: args.offline ? offlineNet : realNet(), today: new Date().toISOString().slice(0, 10), log: (l) => out.log(l) });
  } catch (e) {
    out.log(e instanceof BakeStop ? `[bake] ${e.message}` : `[bake] failed: ${e instanceof Error ? e.message : String(e)}`);
    proc.exitCode = 1;
  }
}

// run only as a script (tests import bake() without starting a run)
if (proc.argv[1] && path.resolve(proc.argv[1]) === fileURLToPath(import.meta.url)) await main();
