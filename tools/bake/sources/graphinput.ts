// Reads a stage's pinned OSM and Overture building files for the block graph (P1-009) and writes the graph and its
// north-up picture. The graph itself is pure (tools/bake/graph/build.ts).
import fs from 'node:fs';
import path from 'node:path';
import type { GraphInput, TurnLaneRef } from '../graph/build.ts';
import type { OvertureRow } from '../graph/footprints.ts';
import { EMPTY_UNDERGROUND_LIST } from '../graph/underground.ts';
import type { UndergroundList } from '../graph/underground.ts';
import type { StagePlan } from '../layout/stages.ts';
import type { OsmElement } from '../osm.ts';
import { loadSources } from './pinfile.ts';

/** The graph input of a stage, from the files its pins name (or the stage's default file names). Throws when one is missing. */
export function readGraphInput(root: string, plan: StagePlan): GraphInput {
  const pins = loadSources(path.join(root, 'data', 'SOURCES.json'));
  const fileOf = (kind: string): string => {
    const s = plan.sources.find((x) => x.kind === kind);
    if (!s) throw new Error(`stage ${plan.id} reads no ${kind} source`);
    const f = path.resolve(root, pins.files[s.id]?.file ?? s.file);
    if (!fs.existsSync(f)) throw new Error(`${kind} file ${path.relative(root, f)} is missing: run the sources step first`);
    return f;
  };
  const osm = JSON.parse(fs.readFileSync(fileOf('osm'), 'utf8')) as { elements: OsmElement[] };
  const overture = JSON.parse(fs.readFileSync(fileOf('overture_buildings'), 'utf8')) as OvertureRow[];
  const turns = plan.sources.some((x) => x.kind === 'osm_turns') ? (JSON.parse(fs.readFileSync(fileOf('osm_turns'), 'utf8')) as { elements: OsmElement[] }).elements : [];
  return { block: plan.def.block, stage: plan.id, origin: plan.origin, outline: plan.outline.coords, elements: osm.elements, overture, underground: readUndergroundList(root), turnElements: turns, turnLaneRefs: readTurnLaneRefs(root) };
}

/** harness/data/turn_lanes.json (P1-032): reference turn lanes. Empty when the file is missing; throws on a bad entry. */
export function readTurnLaneRefs(root: string): TurnLaneRef[] {
  const file = path.join(root, 'harness', 'data', 'turn_lanes.json');
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { lanes?: TurnLaneRef[] };
  const list = raw.lanes ?? [];
  for (const e of list) {
    if (typeof e.way !== 'string' || !/^way\/\d+$/.test(e.way) || !e.tags || !Object.keys(e.tags).every((k) => k.startsWith('turn:lanes')) || !['satellite', 'photo'].includes(e.source) || typeof e.ref !== 'string' || !e.ref) {
      throw new Error(`harness/data/turn_lanes.json: entry ${JSON.stringify(e)} needs a way ("way/<id>"), turn:lanes tags only, a source (satellite or photo) and a ref`);
    }
  }
  return list;
}

/** harness/data/underground.json: the underground list (P1-041). Empty lists when the file is missing; throws on a bad entry. */
export function readUndergroundList(root: string): UndergroundList {
  const file = path.join(root, 'harness', 'data', 'underground.json');
  if (!fs.existsSync(file)) return EMPTY_UNDERGROUND_LIST;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<UndergroundList>;
  const list: UndergroundList = { underground: raw.underground ?? [], surface: raw.surface ?? [] };
  for (const e of [...list.underground, ...list.surface]) {
    if (typeof e.id !== 'string' || !/^(way|relation|overture)\//.test(e.id) || typeof e.why !== 'string' || !e.why) throw new Error(`harness/data/underground.json: entry ${JSON.stringify(e)} needs an id (way/, relation/ or overture/) and a why`);
  }
  return list;
}

/** Writes the graph JSON (a build product under the stage's data folder) and returns its repo-relative path. */
export function writeGraph(root: string, plan: StagePlan, json: string): string {
  const file = path.join(root, plan.def.dataDir, 'graph.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, json);
  return path.relative(root, file);
}

/** Writes an SVG picture and, when sharp loads, a PNG beside it. Returns the files written (repo-relative). */
export async function writePicture(root: string, file: string, svg: string, widthPx: number): Promise<string[]> {
  const svgFile = path.join(root, file.replace(/\.png$/, '.svg'));
  fs.mkdirSync(path.dirname(svgFile), { recursive: true });
  fs.writeFileSync(svgFile, svg);
  const out = [path.relative(root, svgFile)];
  try {
    const sharp = (await import('sharp')).default as unknown as (input: Uint8Array, opts: { limitInputPixels: boolean }) => { resize(w: number): { png(): { toFile(f: string): Promise<unknown> } } };
    const enc = new (globalThis as unknown as { TextEncoder: new () => { encode(s: string): Uint8Array } }).TextEncoder();
    await sharp(enc.encode(svg), { limitInputPixels: false }).resize(widthPx).png().toFile(path.join(root, file));
    out.push(file);
  } catch {
    // sharp is a dev dependency: without it the SVG alone is written
  }
  return out;
}
