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
// sources/tilestage.ts to <stage data folder>/tiles with index.json, checked on the bytes read back). Invariants run
// after each step; a failed one stops the bake before tiles are written. harness/reports/map/health.json is written at the end of every run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projector } from '../geo/projection.ts';
import { pointInRing } from './geom.ts';
import type { Box2 } from './geom.ts';
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
import { BakeStop, emptyHealth, mapCounts, recordInvariants } from './report/health.ts';
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
import { readOverrides } from './sources/overridesio.ts';
import { readRepairInput, writeRepair } from './sources/repairio.ts';
import { checkGraph, graphCounts, graphHash, graphInvariants } from './graph/checks.ts';
import { graphSvg } from './graph/render.ts';
import type { RepairedGraph } from './repair/engine.ts';
import { checkLaneModel } from './roads/lanechecks.ts';
import { laneGraph, laneModelFile, laneModelHash, lanesLayer, lanesRecord } from './roads/laneout.ts';
import { lanesSvg } from './roads/lanerender.ts';
import { buildLaneModel } from './roads/network.ts';
import type { LaneBuild, LaneModelInput } from './roads/network.ts';
import { GROUND_SITES, LANE_VIEWS, MESH_SITES, PROFILE_VIEWS, laneInputs } from './sites.ts';
import { checkElevation } from './elevation/checks.ts';
import { elevationFile, elevationHash, elevationRecord } from './elevation/elevout.ts';
import { elevationInput } from './elevation/input.ts';
import { heightMapSvg, profileSvg } from './elevation/render.ts';
import { solveBlockElevation } from './elevation/solve.ts';
import { readStructures } from './elevation/structures.ts';
import { buildRoadMesh } from './mesh/build.ts';
import type { RoadMesh } from './mesh/build.ts';
import { checkRoadMesh } from './mesh/checks.ts';
import { meshInput } from './mesh/input.ts';
import type { MeshInput } from './mesh/input.ts';
import { buildGround } from './terrain/build.ts';
import type { Ground } from './terrain/build.ts';
import { checkGround } from './terrain/checks.ts';
import type { TerrainInput } from './terrain/collect.ts';
import { groundHash, groundInBox, groundPoses, groundSvg, terrainInvariants, terrainLog, terrainRecord } from './terrain/terrainout.ts';
import { meshHash, meshRecord, siteTile } from './mesh/meshout.ts';
import { PAIR_LIMIT_M2 } from './mesh/proof.ts';
import { meshSvg } from './mesh/render.ts';
import { writeSiteTile } from './sources/meshio.ts';
import { writeElevation } from './sources/elevationio.ts';
import { writeLanes } from './sources/lanesio.ts';
import { readGedtmFile, readGlo30File } from './sources/ground.ts';
import { readGraphInput, writeGraph, writePicture } from './sources/graphinput.ts';
import { OfflineError, realNet } from './sources/net.ts';
import type { Net } from './sources/net.ts';
import { loadSources } from './sources/pinfile.ts';
import { runSourcesStage } from './sources/stage.ts';
import { runTileStep } from './sources/tilestage.ts';
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
}

/** Runs a bake for parsed arguments; returns the report (also written to disk). Throws BakeStop after writing it. */
export async function bake(args: BakeArgs, opts: BakeOptions): Promise<HealthReport> {
  const dataDir = path.join(opts.root, 'harness', 'data');
  const districts = JSON.parse(fs.readFileSync(path.join(dataDir, 'districts.json'), 'utf8')) as DistrictsWithStages & LayoutFile;
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
  report.tiles = { written: 0, out: args.out ?? path.join(plan.def.dataDir, 'tiles'), only: args.tiles ? args.tiles.map((t) => `${t.x}_${t.z}`) : null };
  const healthFile = opts.healthFile ?? path.join(opts.root, 'harness', 'reports', 'map', 'health.json');
  const finish = (): void => {
    fs.mkdirSync(path.dirname(healthFile), { recursive: true });
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
  for (const step of args.steps as Step[]) {
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
      const picture = await writePicture(opts.root, `harness/reports/map/graph_${plan.id}.png`, graphSvg(g), 2400);
      report.graph = {
        file, picture, hash: graphHash(g), buildMs, counts,
        checks: { duplicateEdges: c.duplicateEdges.length, zeroLengthEdges: c.zeroLengthEdges.length, missingNodes: c.missingNodes.length, orphanNodes: c.orphanNodes.length, crossingsWithoutEnd: c.crossingsWithoutEnd, badMapEdgeNodes: c.badMapEdgeNodes.length, ok: c.ok },
        normalised: { ...g.normalised, duplicateWays: g.normalised.duplicateWays.length },
        footprintMerge: g.footprintSources,
      };
      opts.log(`[graph] built in ${(buildMs / 1000).toFixed(2)} s: ${counts.nodes} nodes, ${counts.edges} edges (${counts.roadKm} km), ${counts.mapEdgeEnds} map edge ends, ${counts.pairs} carriageway pairs on ${counts.pairedStreets} named streets, ${counts.footprints} footprints, ${counts.rail} rail and ${counts.metro} metro lines, ${counts.footBridges} foot bridges, ${counts.water} water areas, ${counts.open} open areas; hash ${report.graph.hash}`);
      opts.log(`[graph] wrote ${file} and ${picture.join(', ')}`);
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
      const lin = laneInputs(graphInput, plan, readRepairInput(opts.root).heroSpecs);
      const fb = repairWithLanes(graph, env, { overrides: { entries, project: toBlock } }, (g) => ({ nodes: g.nodes, edges: g.edges, marks: g.marks, ...lin }));
      const res = fb.res;
      const repairMs = Math.round(clock.now() - t0);
      const again = repairGraph(res.graph, fb.env, { overrides: { entries, project: toBlock, applied: true } });
      opts.log(`[repair] lane feedback: ${fb.rounds.map((r, i) => `round ${i} ${r.overlapM2} m2 in ${r.pairs} pairs, ${r.conflicts} new conflicts (not handed back: ${Object.entries(r.skipped).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'})`).join('; ')}; ${fb.conflicts.length} conflicts in the rule environment`);
      repaired = res.graph;
      laneBuild = fb.build;
      const s = res.summary;
      const c = checkGraph(res.graph);
      const noProposal = res.issues.filter((i) => i.status === 'open' && !i.proposals.some((p) => p.confidence > 0 && p.reasoning.length > 0 && p.preview.length > 0)).length;
      const files = writeRepair(opts.root, plan, path.dirname(healthFile), res, `production bake, stage ${plan.id}, graph ${graphHash(graph)}`, { offset, outline: stageRing, places: extra.places, toBlock });
      const picture = await writePicture(opts.root, `harness/reports/map/issues_${plan.id}.png`, issuesSvg(res.graph, res.issues), 2400);
      const ctx = new RuleContext(res.graph, fb.env, res.graph.marks);
      report.repair = { files: { ...files, picture }, hash: graphHash(res.graph), rulesMs: timed.ms, rulesTotalMs: timed.totalMs, repairMs, summary: s, secondRunRepairs: again.repairs.length, queuedWithoutProposal: noProposal, heroEdges: res.graph.edges.filter((e) => ctx.heroOf(e)).length, laneFeedback: { rounds: fb.rounds, conflicts: fb.conflicts.length } };
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
      for (const r of s.byRule) if (r.issues) opts.log(`[repair] ${r.rule.padEnd(14)} ${String(r.issues).padStart(5)} issues: ${r.auto} repaired, ${r.queued} queued, ${r.explained} explained${r.overridden ? `, ${r.overridden} settled by overrides` : ''} (${r.title})`);
      opts.log(`[repair] ${s.total} issues in ${s.passes} passes (${(repairMs / 1000).toFixed(2)} s): ${s.auto} repaired on their own (${(s.autoShare * 100).toFixed(1)} percent; ${(s.autoShareOfChanged * 100).toFixed(1)} percent of repaired plus queued; ${(s.withoutTerrainOutliers.autoShare * 100).toFixed(1)} percent without the terrain outlier rule), ${s.queued} queued (${s.highImpact} high impact, ${s.provisionalApplied} top proposals applied as provisional), ${s.explained} explained, ${s.overridden} settled by overrides, ${s.drops} drops logged; a second run applies ${again.repairs.length} repairs`);
      const ov = res.overrideCounts;
      opts.log(`[overrides] ${ov.patches} patches in ${ov.files} files for this stage (${outsideStage} outside it): ${ov.byId} found by id, ${ov.byAnchor} by anchor, ${ov.stale} stale (kept in their files), ${ov.applied} applied, ${ov.switchedOff} repairs switched off, ${ov.idle} idle; ${ov.issuesSettled} issues settled`);
      opts.log(`[repair] wrote ${files.graph}, ${files.issues}, ${files.repairs} and ${picture.join(', ')}`);
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
      const input: LaneModelInput = { nodes: repaired.nodes, edges: repaired.edges, marks: repaired.marks, ...laneInputs(graphInput, plan, heroes) };
      const t0 = clock.now();
      // the repair step's last lane model is this model (the same graph and inputs); built again for the hash check
      const build: LaneBuild = laneBuild ?? buildLaneModel(input);
      const buildMs = laneBuild ? Math.round(laneBuild.ms['total'] ?? 0) : Math.round(clock.now() - t0);
      const model = laneModelFile(build, plan.def.block, plan.id);
      const hash = laneModelHash(model);
      laneBuild = build;
      lanesHash = hash;
      // the same input again: the model must not depend on anything but its input
      const again = laneModelHash(laneModelFile(buildLaneModel(input), plan.def.block, plan.id));
      const c = checkLaneModel(build, heroes);
      const files = writeLanes(opts.root, plan, path.dirname(healthFile), model, laneGraph(build, plan.def.block, offset), lanesLayer(build, plan.def.block, offset));
      const pictures: string[] = [];
      for (const v of LANE_VIEWS) {
        const at = proj.toWorld(v.lat, v.lon);
        if (!pointInRing(at, outlineRing(plan.outline.coords, plan.origin))) continue;
        const box = { minX: at.x - v.halfM, maxX: at.x + v.halfM, minZ: at.z - v.halfM, maxZ: at.z + v.halfM };
        pictures.push(...(await writePicture(opts.root, `harness/reports/map/lanes_${plan.id}_${v.id}.png`, lanesSvg(build, box, `${v.name}: lane model, north up (${plan.id})`), 2400)));
      }
      const rec = lanesRecord(build, c, hash, buildMs, { ...files, pictures });
      report.lanes = rec;
      report.gates['laneContinuityBreaks'] = c.continuity.breaks;
      report.gates['tapersOutOfLimits'] = c.tapers.violations;
      const n = rec.counts;
      opts.log(`[lanes] built in ${(buildMs / 1000).toFixed(2)} s (${build.rounds} rounds): ${n.strips} strips (${n.taperStrips} tapers, ${n.zoneStrips} split zones), ${n.stations} stations, ${n.driveLanes} driving lanes (${n.laneKm} lane km, ${n.galiLanes} gali lanes), ${n.junctions} junctions with ${n.junctionPaths} lane paths for ${n.junctionPairs} arm pairs; hash ${hash}`);
      opts.log(`[lanes] lane counts: ${Object.entries(rec.inference.from).map(([k, v]) => `${k} ${v}`).join(', ')}; ${rec.inference.changed} edges differ from their own tag or class default; ${n.fitted} took a count the model settled, ${n.widenings} widen before a junction`);
      opts.log(`[lanes] continuity breaks ${c.continuity.breaks} (${c.continuity.lanePairs} lane pairs at ${c.continuity.joints} joints; ends explained: ${Object.entries(c.explainedEnds).map(([k, v]) => `${k} ${v}`).join(', ')}); tapers ${c.tapers.tapers}, out of limits ${c.tapers.violations} (${c.tapers.violations - c.tapers.unexplained} explained, ${c.tapers.unexplained} findings listed)`);
      opts.log(`[lanes] zones ${c.zones.zones} (${c.zones.diverges} diverges, ${c.zones.merges} merges), without gore or nose ${c.zones.withoutGoreOrNose}, off a branch centre line ${c.zones.endsOffCentreLine} (largest ${c.zones.maxEndErrorM} m); ${n.forks} one-way forks are junctions (${Object.entries(rec.forks.byReason).map(([k, v]) => `${v}: ${k}`).join('; ')})`);
      opts.log(`[lanes] paths: ${c.paths.pairsWithoutPath} arm pairs without a path, ${c.paths.pairsBelowRadius} under the ${c.paths.minRadiusM === null ? '' : `radius (smallest ${c.paths.minRadiusM} m)`}, ${build.turns.uTurnsTooTight} U-turns left out, ${build.turns.droppedForRadius} turns left out for radius; left-hand side wrong on ${c.trafficSide.wrongSide} of ${c.trafficSide.twoWayStrips} two-way strips; ${c.widths.tooNarrow} lanes too narrow (narrowest ${c.widths.narrowestM} m, gali ${c.widths.narrowestGaliM} m)`);
      opts.log(`[lanes] hero: ${c.hero.map((h) => `${h.spec} ${h.mismatches} mismatches over ${h.fieldsCompared} comparisons`).join(', ') || 'no spec'}; strips on each other in plan: ${c.overlap?.areaM2 ?? 0} m2 in ${c.overlap?.pairs ?? 0} pairs; edges gave way on ${build.edgeTrims.strips} strips (${build.edgeTrims.stations} stations, ${build.edgeTrims.areaM2} m2)`);
      opts.log(`[lanes] wrote ${files.model}, ${files.laneGraph}, ${files.layer} and ${pictures.join(', ')}`);
      const heroBad = c.hero.reduce((sum, h) => sum + h.mismatches, 0);
      check([
        { id: 'LANES-01.continuity', ok: c.continuity.breaks === 0, detail: c.continuity.breaks === 0 ? `every lane at a strip end has a successor or an explained end (${c.continuity.lanePairs} lane pairs, ${build.ends.length} explained ends)` : `${c.continuity.breaks} lanes end with nothing after them: ${c.continuity.list.slice(0, 3).map((x) => `${x.strip} lane ${x.lane}`).join(', ')}` },
        { id: 'LANES-02.zones', ok: c.zones.withoutGoreOrNose + c.zones.endsOffCentreLine === 0, detail: `${c.zones.zones} split zones: ${c.zones.withoutGoreOrNose} without a gore or a nose, ${c.zones.endsOffCentreLine} ending off a branch centre line (largest ${c.zones.maxEndErrorM} m)` },
        { id: 'LANES-03.same_twice', ok: hash === again, detail: hash === again ? `the same hash twice (${hash})` : `two builds of one input differ: ${hash} and ${again}` },
        { id: 'LANES-04.left_hand_and_widths', ok: c.trafficSide.wrongSide + c.widths.tooNarrow === 0, detail: `${c.trafficSide.wrongSide} two-way strips on the wrong side, ${c.widths.tooNarrow} lanes under their width limit` },
        { id: 'LANES-05.hero', ok: heroBad === 0, detail: `${heroBad} hero spec mismatches` },
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
      const res = solveBlockElevation(input);
      let twoRuns = 0;
      build.strips.forEach((s, si) => s.st.forEach((st, i) => (twoRuns = Math.max(twoRuns, Math.abs(st.h - ((before[si] as number[])[i] as number))))));
      res.junctionHeights.forEach((h, i) => (twoRuns = Math.max(twoRuns, Math.abs(h - (first.junctionHeights[i] as number)))));
      const c = checkElevation(build.strips, build.joints, input.junctions, res);
      const st = readStructures({ strips: build.strips, joints: build.joints, junctions: input.junctions, junctionHeights: res.junctionHeights, tunnels: res.tunnels, crossings: res.crossings, pairSamples: res.pairSamples, water: input.water ?? [], ties: input.ties ?? [], ground: input.ground });
      const file = elevationFile(build.strips, build.junctions.map((j) => j.id), res, st, input.rails ?? [], plan.def.block, plan.id, lanesHash);
      const hash = elevationHash(file);
      const heights = writeElevation(opts.root, plan, file);
      const ring = outlineRing(plan.outline.coords, plan.origin);
      const box = { minX: Math.min(...ring.map((p) => p.x)), maxX: Math.max(...ring.map((p) => p.x)), minZ: Math.min(...ring.map((p) => p.z)), maxZ: Math.max(...ring.map((p) => p.z)) };
      const pictures = await writePicture(opts.root, `harness/reports/map/elevation_${plan.id}.png`, heightMapSvg(build.strips, st.structures, box, `Heights above the ground model, north up (${plan.id}): ${st.structures.length} structures`), 2400);
      for (const v of PROFILE_VIEWS) {
        if (build.strips.some((s) => v.match.test(s.name))) pictures.push(...(await writePicture(opts.root, `harness/reports/map/elevation_${plan.id}_${v.id}.png`, profileSvg(build.strips, (s) => v.match.test(s.name), `${v.name} (${plan.id})`), 2200)));
      }
      const rec = elevationRecord(build.strips, res, c, st, offset, hash, twoRuns, { heights, pictures });
      rec.solveMs = first.report.ms['total'] ?? 0;
      rec.solver = first.report;
      report.elevation = rec;
      elevated = { junctionHeights: res.junctionHeights, kinds: st.kinds };
      report.gates['floatingEnds'] = rec.openEnds.floating;
      const s = first.report;
      opts.log(`[elevation] solved in ${(rec.solveMs / 1000).toFixed(2)} s (${s.rounds} rounds, ${s.factorisations} factorisations, ${s.converged ? 'converged' : 'NOT converged'}): ${s.strips} strips and ${s.stations} stations in ${s.chains} chains, ${s.knots} knots, ${s.unknowns} unknowns (${s.branches} branches follow their main line, ${s.ties} map edge ties), matrix ${s.matrix} values, factor ${s.factor}; ms ${Object.entries(s.ms).map(([k, v]) => `${k} ${v}`).join(', ')}`);
      opts.log(`[elevation] limits held: ${Object.entries(s.active).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n} of ${s.limits[k as keyof typeof s.limits]}`).join(', ')}; given up ${res.unmet.length}`);
      opts.log(`[elevation] steps: largest mismatch ${c.steps.maxMismatchM} m at ${c.steps.joints} joints, steepest junction surface ${c.steps.steepestJunctionPct} percent over ${c.steps.junctionArms} arms; grades: ${c.grade.violations} over the class limit in ${c.grade.segments} segments (steepest ${c.grade.steepestPct} percent on ${c.grade.steepest?.strip ?? 'none'}, limit ${c.grade.steepest?.limitPct ?? 0}); vertical curves: ${c.curves.violations} under the class limit of ${c.curves.measured} measured (closest to its limit: ${c.curves.tightest?.radiusM ?? 0} m against ${c.curves.tightest?.limitM ?? 0} m on ${c.curves.tightest?.strip ?? 'none'})`);
      opts.log(`[elevation] clearances: ${c.clearance.violations} short; road over road ${c.clearance.roadCrossings} crossings (${c.clearance.roadSamples} places, least headroom ${c.clearance.minRoadM} m), ${c.clearance.junctionCrossings} over or under a junction (least ${c.clearance.minJunctionM} m), ${c.clearance.roadOverRail} places over a railway line (least ${c.clearance.minRoadOverRailM} m), ${c.clearance.roadUnderRail} under a railway bridge (least ${c.clearance.minRoadUnderRailM} m), ${c.clearance.waterCrossings} decks over water (least ${c.clearance.minOverWaterM} m above it), ${c.clearance.tunnelStations} tunnel stations (least cover ${c.clearance.minCoverM} m); crossfall: ${c.crossfall.violations} over the limit at ${c.crossfall.limited} places (worst ${c.crossfall.worstPct} percent); ties: ${c.ties.ends} map edge ends, ${c.ties.moved} moved by a clearance (largest ${c.ties.maxOffM} m)`);
      opts.log(`[elevation] structures: ${st.structures.length} (${Object.entries(rec.structureCounts).map(([k, n]) => `${n} ${k}`).join(', ')}), ${rec.structureM} m of road on or in them, ${rec.abutments} ends (${rec.openEnds.mapEdge} at the map edge, ${rec.openEnds.underGround} dead ends under the ground, ${rec.openEnds.floating} hanging in the air); two runs differ by at most ${twoRuns} m; hash ${hash}`);
      for (const x of st.structures.slice().sort((p, q) => q.structureM - p.structureM).slice(0, 8)) opts.log(`[elevation]   ${x.id} ${x.kind} ${x.name || '(no name)'}: structureM ${x.structureM}, sunk ${x.sunk}, up to ${x.maxAboveM} m above and ${x.maxBelowM} m under the ground`);
      opts.log(`[elevation] wrote ${heights} and ${pictures.join(', ')}`);
      check([
        { id: 'ELEV-01.no_steps', ok: c.steps.maxMismatchM < 0.01, detail: `largest height mismatch where strips meet: ${c.steps.maxMismatchM} m (${c.steps.joints} joints)` },
        { id: 'ELEV-02.grades_and_curves', ok: c.grade.violations + c.curves.violations === 0 && c.steps.steepestJunctionPct <= 5.0001, detail: `${c.grade.violations} grades over the class limit, ${c.curves.violations} vertical curves under the class limit, steepest junction surface ${c.steps.steepestJunctionPct} percent` },
        { id: 'ELEV-03.clearances', ok: c.clearance.violations === 0, detail: c.clearance.violations === 0 ? `every one of ${c.clearance.roadCrossings} road crossings, ${c.clearance.junctionCrossings} junction crossings, ${c.clearance.roadOverRail + c.clearance.roadUnderRail} railway crossings and ${c.clearance.waterCrossings} decks over water has its clearance` : `${c.clearance.violations} clearances short: ${c.findings.filter((x) => x.kind === 'clearance').slice(0, 3).map((x) => `${x.strip} ${x.value} m (${x.why})`).join(', ')}` },
        { id: 'ELEV-04.solved', ok: s.converged && res.unmet.length === 0 && c.crossfall.violations === 0, detail: `the solve ${s.converged ? 'converged' : 'did not converge'} in ${s.rounds} rounds, ${res.unmet.length} limits given up, ${c.crossfall.violations} crossfalls over the limit` },
        { id: 'ELEV-05.same_twice', ok: twoRuns <= 1e-6, detail: `two solves of the same lane model differ by at most ${twoRuns} m` },
      ]);
    } else if (step === 'mesh') {
      if (!laneBuild || !elevated) throw new Error('the mesh step needs the lanes and the elevation step before it');
      const proj = projector(plan.origin);
      const offset = blockFrame(districts, plan.def.block).offset;
      const input = meshInput(laneBuild, elevated.junctionHeights, elevated.kinds);
      // built twice: the mesh must not depend on anything but the lane model and the heights
      const mesh = buildRoadMesh(input);
      meshed = { input, mesh };
      const hash = meshHash(mesh);
      const again = meshHash(buildRoadMesh(input));
      const tc = clock.now();
      const c = checkRoadMesh(input, mesh);
      const checksMs = Math.round(clock.now() - tc);
      const ring = outlineRing(plan.outline.coords, plan.origin);
      const tiles: string[] = [];
      const pictures: string[] = [];
      const genDir = opts.benchDir ?? path.join('game', 'bench', 'roads', 'gen');
      for (const v of MESH_SITES) {
        const at = proj.toWorld(v.lat, v.lon);
        if (!pointInRing(at, ring)) continue;
        const site = siteTile(input, mesh, { id: v.id, name: v.name, x: at.x, z: at.z, halfM: v.halfM, eye: v.eye });
        const w = writeSiteTile(opts.root, genDir, site);
        tiles.push(w.tile, w.poses);
        const box = { minX: at.x - v.halfM, maxX: at.x + v.halfM, minZ: at.z - v.halfM, maxZ: at.z + v.halfM };
        const marks = {
          setFaces: mesh.junctions.setFaces,
          polys: mesh.structures.piers.map((p) => ({ ring: p.ring, fill: '#f2c14e' })),
          lines: mesh.stops.lines.map((l) => ({ a: l.a, b: l.b, stroke: '#ffffff', width: 0.3 })),
        };
        pictures.push(...(await writePicture(opts.root, `harness/reports/map/mesh_${plan.id}_${v.id}.png`, meshSvg(mesh.fs, box, `${v.name}: road mesh faces, north up (${plan.id}). Junction surfaces outlined blue (as planned) or red (made or cut by the polygon set); yellow: piers; white: stop lines`, marks, input.strips.length), 2400)));
        opts.log(`[mesh] site ${v.id}: ${site.triangles} triangles, ${w.bytes} bytes, poses ${site.meta.poses.map((p) => p.name).join(', ')}`);
      }
      const rec = meshRecord(input, mesh, c, checksMs, offset, hash, { siteTiles: tiles, pictures });
      report.mesh = rec;
      report.gates['overlappingRoadFaces'] = rec.gates.overlappingRoadFaces;
      report.gates['openBoundaryEdges'] = rec.gates.openBoundaryEdges;
      report.gates['unjoinedEnds'] = rec.gates.unjoinedEnds;
      report.gates['floatingEnds'] = rec.gates.floatingEnds;
      report.gates['railingsAtGrade'] = rec.gates.railingsAtGrade;
      report.gates['piersInLane'] = rec.gates.piersInLane;
      const n = rec.counts;
      opts.log(`[mesh] built in ${(rec.buildMs / 1000).toFixed(2)} s (${Object.entries(rec.ms).filter(([k]) => k !== 'total').map(([k, v]) => `${k} ${v}`).join(', ')} ms), checks ${(checksMs / 1000).toFixed(2)} s: ${n.faces} faces over ${n.vertices} vertices (${n.laneQuads} lane quads), ${n.triangles} triangles; hash ${hash}`);
      opts.log(`[mesh] junctions: ${n.junctions} (${n.j1} as planned, ${n.j2} from lane path corridors by the polygon set); ${n.clippedFaces} faces of ${n.clippedJunctions} junctions cut back off a neighbour (${n.clippedAreaM2} m2); raised corners ${n.bands} (${n.crossedBands} crossed and redrawn, ${n.droppedBands} left out); ${rec.oversize.length} surfaces over 3,000 m2`);
      opts.log(`[mesh] overlap: ${c.overlap.pairsOver} pairs over ${PAIR_LIMIT_M2} m2 at ${c.overlap.junctionsOver} of ${c.overlap.junctions} junctions (${c.overlap.pairsTested} pairs tested, largest ${c.overlap.maxPairM2} m2, a junction on itself ${c.overlap.maxSelfM2} m2); strip on strip ${c.overlap.stripPairs.pairs} pairs, ${c.overlap.stripPairs.areaM2} m2${c.overlap.stripPairs.worst[0] ? ` (largest ${c.overlap.stripPairs.worst[0].a} on ${c.overlap.stripPairs.worst[0].b}: ${c.overlap.stripPairs.worst[0].areaM2} m2)` : ''}; total under more than one face ${c.overlap.totalM2} m2 (ground level ${c.overlap.groundM2} m2)`);
      opts.log(`[mesh] watertight: open boundary edges ${c.watertight.openBoundaryEdges} (unclosed ${c.watertight.unclosed}, used twice ${c.watertight.doubled}, T joints left ${c.watertight.tJointsLeft}; ${c.watertight.tJointsRepaired} repaired), ${c.watertight.freeEdges} free edges in ${c.watertight.loops} loops (${c.watertight.outerLoops} around road, ${c.watertight.blockLoops} around blocks, ${c.watertight.sliverLoops} hairlines of ${c.watertight.sliverM2} m2)`);
      opts.log(`[mesh] ends: ${c.ends.stripEnds} strip ends, ${c.ends.joined} joined, explained ${Object.entries(c.ends.explained).map(([k, v]) => `${k} ${v}`).join(', ')}; unjoined ${c.ends.unjoined}${c.ends.unjoinedList.length ? ` (${c.ends.unjoinedList.slice(0, 6).map((e) => `${e.strip} ${e.end}`).join(', ')})` : ''}; floating ${c.ends.floating}${c.ends.floatingList.length ? ` (${c.ends.floatingList.map((e) => `${e.strip} ${e.end} ${e.kind} ${e.aboveGroundM} m up`).join(', ')})` : ''}`);
      opts.log(`[mesh] structures: ${c.railings.segments} edge segments (${Object.entries(c.railings.byKind).map(([k, v]) => `${k} ${v}`).join(', ')}), ${c.railings.parapets} with a parapet, ${c.railings.atGrade} of ${c.railings.parapetTriangles} parapet triangles at grade away from a structure; piers ${c.piers.piers} (${c.piers.moved} places passed over, longest span ${c.piers.maxSpanM} m), in a lane below: ${c.piers.inLane}; deck joints ${c.piers.joints}`);
      opts.log(`[mesh] kerbs: ${c.kerbs.sampled} kerb faces sampled, ${c.kerbs.minM} to ${c.kerbs.maxM} m, ${c.kerbs.off} off 0.15 m by over 0.01 m (beside a surface the polygon set made: ${c.kerbs.beside.off} of ${c.kerbs.beside.sampled}); lane UV ${c.uv.ok ? 'ok' : 'FAILED'}: ${c.uv.lanes} lane quads, ${c.uv.corners} corners, bad u ${c.uv.badU}, bad v ${c.uv.badV}, border mismatches ${c.uv.borderMismatch}, joint mismatches ${c.uv.jointMismatch} of ${c.uv.jointPairs}; stop lines ${c.stopLines.lines} on ${c.stopLines.armsThatStop} arms that stop, missing ${c.stopLines.missing}, crossings ${c.stopLines.crossings}`);
      opts.log(`[mesh] wrote ${[...tiles, ...pictures].join(', ')}`);
      check([
        { id: 'MESH-01.no_overlap_at_junctions', ok: c.overlap.pairsOver === 0, detail: c.overlap.pairsOver === 0 ? `no junction face shares more than ${PAIR_LIMIT_M2} m2 with a strip or another junction (${c.overlap.pairsTested} pairs, largest ${c.overlap.maxPairM2} m2)` : `${c.overlap.pairsOver} pairs over ${PAIR_LIMIT_M2} m2: ${c.overlap.worst.slice(0, 3).map((w) => `${w.a} on ${w.b} ${w.areaM2} m2`).join(', ')}` },
        { id: 'MESH-02.watertight', ok: c.watertight.openBoundaryEdges === 0, detail: `${c.watertight.openBoundaryEdges} open boundary edges (${c.watertight.unclosed} unclosed, ${c.watertight.doubled} used twice, ${c.watertight.tJointsLeft} T joints left)` },
        { id: 'MESH-03.structures', ok: c.railings.atGrade === 0 && c.piers.inLane === 0, detail: `${c.railings.atGrade} parapet triangles at grade away from a structure, ${c.piers.inLane} piers in a lane of another level` },
        { id: 'MESH-04.kerbs_uv_stop_lines', ok: c.kerbs.off === 0 && c.uv.ok && c.stopLines.missing === 0, detail: `${c.kerbs.off} of ${c.kerbs.sampled} kerbs off 0.15 m, lane UV ${c.uv.ok ? 'ok' : 'failed'}, ${c.stopLines.missing} of ${c.stopLines.armsThatStop} stop lines missing` },
        { id: 'MESH-05.same_twice', ok: hash === again, detail: hash === again ? `the same hash twice (${hash})` : `two builds of one input differ: ${hash} and ${again}` },
      ]);
    } else if (step === 'terrain') {
      if (!meshed || !repaired || !groundModel) throw new Error('the terrain step needs the ground, the repair and the mesh step before it');
      const proj = projector(plan.origin);
      const offset = blockFrame(districts, plan.def.block).offset;
      const model = groundModel;
      const { input: mi, mesh } = meshed;
      const input: TerrainInput = {
        fs: mesh.fs, edges: mesh.edges, grid: mesh.grid, strips: mi.strips, kinds: mi.kinds, outline: repaired.outline, footprints: repaired.footprints.map((f) => f.ring),
        water: repaired.features.water.map((w) => ({ id: w.id, name: w.name, rings: w.rings })), open: repaired.features.open.map((o) => o.rings), ground: (x, z) => model.at(x, z), offset,
      };
      // built twice: the ground must not depend on anything but the road mesh, the map and the ground model
      const ground = buildGround(input);
      grounded = ground;
      const hash = groundHash(ground);
      const again = groundHash(buildGround(input));
      const tc = clock.now();
      const c = checkGround(ground);
      const checksMs = Math.round(clock.now() - tc);
      const files: string[] = [];
      const genDir = opts.benchDir ?? path.join('game', 'bench', 'roads', 'gen');
      for (const v of GROUND_SITES) {
        const at = proj.toWorld(v.lat, v.lon);
        if (!pointInRing(at, repaired.outline)) continue;
        const box = { minX: at.x - v.halfM, maxX: at.x + v.halfM, minZ: at.z - v.halfM, maxZ: at.z + v.halfM };
        // the site tiles of the road bench scene again, now on the production ground, with the poses that look at it
        const site = siteTile(mi, mesh, { id: v.id, name: v.name, x: at.x, z: at.z, halfM: v.halfM, eye: v.eye }, groundInBox(ground, box));
        const o = site.meta.origin;
        for (const p of site.meta.poses) if (p.kind === 'eye') p.shot = `ground_${v.id}_eye`;
        for (const p of groundPoses(ground, { id: v.id, x: at.x, z: at.z, halfM: v.halfM })) site.meta.poses.push({ ...p, pos: [round(p.pos[0] - o[0]), round(p.pos[1] - o[1]), round(p.pos[2] - o[2])], target: [round(p.target[0] - o[0]), round(p.target[1] - o[1]), round(p.target[2] - o[2])] });
        const w = writeSiteTile(opts.root, genDir, site);
        files.push(w.tile, w.poses, ...(await writePicture(opts.root, `harness/reports/map/ground_${plan.id}_${v.id}.png`, groundSvg(ground, box, `${v.name}: ground triangles, north up (${plan.id}). Grey: ground, green: open land, sand: building footprints, blue: water; dark: the road mesh`), 2400)));
        opts.log(`[terrain] site ${v.id}: ${site.triangles} triangles, ${w.bytes} bytes, poses ${site.meta.poses.map((p) => p.name).join(', ')}`);
      }
      const rec = terrainRecord(ground, c, checksMs, hash, { files });
      report.terrain = rec;
      for (const [k, n] of Object.entries(rec.gates)) report.gates[k] = n;
      for (const l of terrainLog(rec)) opts.log(`[terrain] ${l}`);
      check(terrainInvariants(rec, again));
    } else if (step === 'tiles') {
      if (!laneBuild || !meshed || !grounded || !repaired) throw new Error('the tiles step needs the lanes, mesh and terrain steps before it');
      const res = runTileStep({
        root: opts.root, out: report.tiles.out ?? path.join(plan.def.dataDir, 'tiles'), stage: plan.id, block: plan.def.block, origin: plan.origin, offset: blockFrame(districts, plan.def.block).offset,
        outline: repaired.outline, lanes: laneBuild, meshed, ground: grounded, repaired, places: layout.input.places, only: report.tiles.only, log: opts.log,
      });
      report.tiles = { ...report.tiles, written: res.written, record: res.record };
      check(res.invariants);
    }
  }
  finish();
  opts.log(`[bake] health report: ${path.relative(opts.root, healthFile)}`);
  return report;
}

const round = (v: number): number => Math.round(v * 100) / 100;

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
