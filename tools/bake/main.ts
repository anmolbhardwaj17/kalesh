// The bake driver (P1-007, docs/ARCHITECTURE.md `bake/main.ts`, TECH.md "World pipeline (offline bake)"). It alone,
// with tools/bake/sources/, touches files and the network; every other file under tools/bake/ is pure functions
// (tools/bake/purity.test.ts). Usage in tools/bake/cli.ts; run through `npm run bake -- pilot`.
//
// Before any step: rule R-STITCH on the layout (tools/bake/layout/gate.ts: the placement method, translation only,
// the centre pair gate, far blocks, block gaps, the map extent), with the pair table written into the health report.
// Steps so far: sources (fetch or reuse every pinned file and print its hash), ground (GEDTM30 smoothed over 60 m,
// filtered GLO-30 as the fallback), graph (the block graph of tools/bake/graph/, written to <dataDir>/graph.json with
// a north-up picture in harness/reports/map/), tiles (written by a later task). Invariants run after each step; a failed one
// stops the bake before tiles are written. harness/reports/map/health.json is written at the end of every run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projector } from '../geo/projection.ts';
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
import { BakeStop, emptyHealth, recordInvariants } from './report/health.ts';
import type { HealthReport } from './report/health.ts';
import { buildBlockGraph } from './graph/build.ts';
import { checkGraph, graphCounts, graphHash, graphInvariants } from './graph/checks.ts';
import { graphSvg } from './graph/render.ts';
import { readGedtmFile, readGlo30File } from './sources/ground.ts';
import { readGraphInput, writeGraph, writePicture } from './sources/graphinput.ts';
import { OfflineError, realNet } from './sources/net.ts';
import type { Net } from './sources/net.ts';
import { loadSources } from './sources/pinfile.ts';
import { runSourcesStage } from './sources/stage.ts';
import type { SourceResult } from './sources/stage.ts';

interface Proc {
  argv: string[];
  exitCode?: number;
}
const proc = (globalThis as unknown as { process: Proc }).process;
const out = (globalThis as unknown as { console: { log(line: string): void } }).console;

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_OUT = 'game/world/tiles';

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
  report.tiles = { written: 0, out: args.out ?? DEFAULT_OUT, only: args.tiles ? args.tiles.map((t) => `${t.x}_${t.z}`) : null };
  const healthFile = opts.healthFile ?? path.join(opts.root, 'harness', 'reports', 'map', 'health.json');
  const finish = (): void => {
    fs.mkdirSync(path.dirname(healthFile), { recursive: true });
    fs.writeFileSync(healthFile, JSON.stringify(report, null, 2) + '\n');
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
      report.ground = { source: g.source, method: g.method, cols: g.cols, rows: g.rows, cell: g.cell, minM: round(g.stats.min), maxM: round(g.stats.max), meanM: round(g.stats.mean), samples: g.stats.samples, holes: g.stats.holes };
      opts.log(`[ground] ${g.method}: ${g.cols} x ${g.rows} values, ${round(g.stats.min)} to ${round(g.stats.max)} m, ${g.stats.holes} holes (${Date.now() - t0} ms)`);
      check(groundInvariants(g));
    } else if (step === 'graph') {
      const input = readGraphInput(opts.root, plan);
      const t0 = Date.now();
      const g = buildBlockGraph(input);
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
    } else if (step === 'tiles') {
      opts.log(`[tiles] not built yet: the tile writer lands with the production road, terrain and tile tasks (would write to ${report.tiles.out})`);
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
