// Files and network of the landmark registry build (P2-005): reads the stage's pinned OSM and Wikidata files, the
// owner list, the edits, the areas and the underground list; fetches the Wikidata items an OSM tag or the owner list
// names that the stage box query did not return, once, into a cache under the gitignored data folder (so later
// builds are offline and give the same output); and writes the registry files. The pure build is
// tools/bake/landmarks/registry.ts. Run by tools/bake/landmarks/build.mjs, on its own, without a whole bake.
import fs from 'node:fs';
import path from 'node:path';
import { projector } from '../../geo/projection.ts';
import { buildIndex, parseAreaFiles, resolveAt } from '../areas/profiles.ts';
import type { UndergroundList } from '../graph/underground.ts';
import { blockFrame } from '../layout/placement.ts';
import type { LayoutFile } from '../layout/placement.ts';
import { stagePlan } from '../layout/stages.ts';
import type { DistrictsWithStages } from '../layout/stages.ts';
import type { OsmElement } from '../osm.ts';
import { LICENCES } from '../pins.ts';
import { osmLandmarks, seenRoads } from '../landmarks/osm.ts';
import { LANDMARK_DIR, MARKERS_FILE, buildRegistry } from '../landmarks/registry.ts';
import type { RegistryInput, RegistryResult } from '../landmarks/registry.ts';
import type { InfraVariant, LandmarkList, OverridesFile } from '../landmarks/types.ts';
import { itemsFromCache, itemsFromRows, reduceEntity } from '../landmarks/wikidata.ts';
import type { EntityCache, SparqlRow } from '../landmarks/wikidata.ts';
import { isOffline, withRetry } from './net.ts';
import type { Net } from './net.ts';
import { loadSources, saveSources, sha256File, writeAtomic } from './pinfile.ts';

export const LIST_FILE = 'harness/data/landmark_list.json';
export const OVERRIDES_FILE = 'harness/data/landmarks.overrides.json';
export const VARIANT_MAP = 'harness/design/reference/infrastructure/variant_map.json';
export const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const CACHE_DOC =
  'Wikidata items the landmark registry needs that the stage box query (wikidata.json) did not return: items an OSM wikidata tag or the owner list names. One wbgetentities answer per item, reduced by tools/bake/landmarks/wikidata.ts reduceEntity; labels holds the English labels of their class (P31) and heritage status (P1435) ids. Written once by tools/bake/sources/landmarksio.ts; later builds read it and make no request.';

export interface RegistryIo {
  /** Repo root (absolute). */
  root: string;
  stage: string;
  /** The network, or null for an offline build (the cache and the OSM tags only). */
  net: Net | null;
  today: string;
  log: (line: string) => void;
}

const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir).sort()) {
    const f = path.join(dir, name);
    if (fs.statSync(f).isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
}

const chunks = <T>(list: readonly T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
};

/**
 * Fetches the items of `wanted` that are not in the cache yet (40 ids a request, a pause between requests), then the
 * labels of their class and status ids. Returns the ids that could not be fetched and why. Never throws: a registry
 * build without Wikidata still runs on the cache and the OSM tags.
 */
export async function fillEntityCache(cache: EntityCache, wanted: readonly string[], io: Pick<RegistryIo, 'net' | 'log'>): Promise<{ fetched: string[]; notFetched: string[]; error: string | null }> {
  const need = wanted.filter((q) => !cache.items[q]).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  const noLabel = (): string[] => [...new Set(Object.values(cache.items).flatMap((i) => [...i.instanceIds, ...i.heritageIds]))].filter((q) => cache.labels[q] === undefined).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  if (need.length === 0 && noLabel().length === 0) return { fetched: [], notFetched: [], error: null };
  const net = io.net;
  if (!net) return { fetched: [], notFetched: need, error: need.length ? 'offline build: no request made' : null };
  const pause = net.pause ?? ((ms: number) => new Promise<void>((r) => (globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown }).setTimeout(r, ms)));
  const get = async (ids: readonly string[], props: string): Promise<Record<string, unknown>> => {
    const url = `${WIKIDATA_API}?action=wbgetentities&ids=${ids.join('%7C')}&props=${props}&languages=en%7Chi&format=json`;
    const text = await withRetry('wikidata entities', async () => {
      const res = await net.request(url, { headers: { Accept: 'application/json' }, timeoutMs: 60_000 });
      if (!res.ok) throw new Error(`${WIKIDATA_API}: HTTP ${res.status}`);
      const body = await res.text();
      if (!body.startsWith('{')) throw new Error(`${WIKIDATA_API}: ${body.slice(0, 80).replace(/\s+/g, ' ')}`);
      return body;
    }, 4, 8000, pause);
    return (JSON.parse(text) as { entities?: Record<string, unknown> }).entities ?? {};
  };
  const fetched: string[] = [];
  let error: string | null = null;
  try {
    for (const part of chunks(need, 40)) {
      const ents = await get(part, 'labels%7Cclaims%7Csitelinks');
      for (const q of part) {
        cache.items[q] = reduceEntity(q, ents[q]);
        fetched.push(q);
      }
      await pause(1500);
    }
  } catch (e) {
    error = isOffline(e) ? 'offline build: no request made' : String(e instanceof Error ? e.message : e).slice(0, 300);
  }
  // labels of the class and status ids (best effort: an id with no label is left out of the class list)
  try {
    for (const part of chunks(noLabel(), 40)) {
      const ents = await get(part, 'labels');
      for (const q of part) cache.labels[q] = (ents[q] as { labels?: Record<string, { value?: string }> } | undefined)?.labels?.['en']?.value ?? '';
      await pause(1500);
    }
  } catch (e) {
    error = error ?? (isOffline(e) ? 'offline build: no request made' : String(e instanceof Error ? e.message : e).slice(0, 300));
  }
  if (fetched.length) io.log(`wikidata: fetched ${fetched.length} items into the cache`);
  return { fetched, notFetched: need.filter((q) => !cache.items[q]), error };
}

function saveCache(root: string, stage: string, file: string, cache: EntityCache, today: string): void {
  const items: EntityCache['items'] = {};
  for (const q of Object.keys(cache.items).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) items[q] = cache.items[q] as EntityCache['items'][string];
  const labels: Record<string, string> = {};
  for (const q of Object.keys(cache.labels).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) labels[q] = cache.labels[q] as string;
  writeAtomic(file, JSON.stringify({ _doc: CACHE_DOC, items, labels }, null, 1) + '\n');
  const sourcesFile = path.join(root, 'data', 'SOURCES.json');
  const pins = loadSources(sourcesFile);
  const lic = LICENCES.wikidata;
  pins.files[`${stage}_wikidata_entities`] = {
    file: path.relative(root, file), bytes: fs.statSync(file).size, sha256: sha256File(file), date: today, url: WIKIDATA_API, licence: lic.licence, licenceUrl: lic.licenceUrl, credit: lic.credit,
    note: `wbgetentities: the ${Object.keys(items).length} items an OSM wikidata tag or the landmark owner list names that the stage box query did not return, reduced to the fields the landmark registry reads`, stage,
  };
  saveSources(sourcesFile, pins);
}

export interface RegistryRead {
  input: RegistryInput;
  /** What the Wikidata step did, for the report. */
  wikidata: { boxItems: number; cached: number; fetched: number; notFetched: string[]; error: string | null };
  osmSkipped: { id: string; name: string; why: string }[];
}

/** Reads every input of the registry build for a stage; fetches missing Wikidata items into the cache first. */
export async function readRegistryInput(io: RegistryIo): Promise<RegistryRead> {
  const data = (...p: string[]): string => path.join(io.root, 'harness', 'data', ...p);
  const districts = readJson<DistrictsWithStages & LayoutFile & { districts?: { id: string; block: string; outline?: string }[]; planned?: { id: string; block?: string; outline?: { ring?: [number, number][] } }[] }>(data('districts.json'));
  const def = (districts.stages ?? {})[io.stage];
  if (!def || typeof def === 'string') throw new Error(`no stage "${io.stage}" in harness/data/districts.json`);
  const plan = stagePlan(districts, io.stage, fs.readFileSync(data(def.outline), 'utf8'));
  const frame = blockFrame(districts, def.block);
  const dir = path.join(io.root, def.dataDir);
  const osmFile = path.join(dir, 'osm.json');
  if (!fs.existsSync(osmFile)) throw new Error(`${path.relative(io.root, osmFile)} is missing: run npm run bake -- ${io.stage} --stage sources`);
  const osm = readJson<{ osm3s?: { timestamp_osm_base?: string }; elements: OsmElement[] }>(osmFile);

  const list = readJson<LandmarkList>(path.join(io.root, LIST_FILE));
  const overrides = readJson<OverridesFile>(path.join(io.root, OVERRIDES_FILE));
  const include = new Set<string>();
  for (const l of list.landmarks) if (l.ids.osm) include.add(l.ids.osm);
  for (const e of overrides.edits) {
    if (e.target.osm) include.add(e.target.osm);
    if (e.set?.footprint?.source === 'osm' && e.set.footprint.ref) include.add(e.set.footprint.ref);
  }
  const { landmarks, skipped } = osmLandmarks(osm.elements, include);

  // Wikidata: the pinned box query, then the cache of single items (filled once)
  const boxFile = path.join(dir, 'wikidata.json');
  const boxItems = fs.existsSync(boxFile) ? itemsFromRows(readJson<{ rows: SparqlRow[] }>(boxFile).rows) : [];
  if (!fs.existsSync(boxFile)) io.log(`wikidata: ${path.relative(io.root, boxFile)} is missing, using the entity cache and the OSM tags only`);
  const inBox = new Set(boxItems.map((i) => i.qid));
  const cacheFile = path.join(dir, 'wikidata_entities.json');
  const cache: EntityCache = fs.existsSync(cacheFile) ? readJson<EntityCache>(cacheFile) : { items: {}, labels: {} };
  cache.items = cache.items ?? {};
  cache.labels = cache.labels ?? {};
  const wanted = [...new Set([...landmarks.map((l) => l.wikidata), ...list.landmarks.map((l) => l.ids.wikidata ?? null)].filter((q): q is string => !!q && !inBox.has(q)))];
  const before = Object.keys(cache.items).length + Object.keys(cache.labels).length;
  const got = await fillEntityCache(cache, wanted, io);
  if (Object.keys(cache.items).length + Object.keys(cache.labels).length !== before) saveCache(io.root, io.stage, cacheFile, cache, io.today);
  if (got.error) io.log(`wikidata: not reachable (${got.error}); ${got.notFetched.length} items are in no cache, their entries are flagged`);
  const cachedItems = itemsFromCache(cache).filter((i) => !inBox.has(i.qid) && wanted.includes(i.qid));

  // areas, hero roads, underground list, focus districts
  const areaFiles: Record<string, string> = {};
  for (const f of walk(data('areas'))) areaFiles[path.relative(io.root, f).split(path.sep).join('/')] = fs.readFileSync(f, 'utf8');
  const frameProj = projector(plan.origin);
  const proj = (lat: number, lon: number) => frameProj.toWorld(lat, lon);
  const index = buildIndex(parseAreaFiles(areaFiles), (lon, lat) => proj(lat, lon));
  const heroList = readJson<{ roads: { osmNames?: string[]; osmWays?: number[] }[] }>(data('hero_list.json'));
  const hero = { names: heroList.roads.flatMap((r) => r.osmNames ?? []), ways: heroList.roads.flatMap((r) => r.osmWays ?? []) };
  const underground = readJson<UndergroundList>(data('underground.json'));
  const variantFile = path.join(io.root, VARIANT_MAP);
  const infrastructure = fs.existsSync(variantFile) ? (readJson<{ stations?: InfraVariant[] }>(variantFile).stations ?? []).filter((s) => typeof s.id === 'string' && typeof s.variant === 'string') : [];
  const focus: { id: string; coords: [number, number][] }[] = [];
  for (const d of districts.districts ?? []) {
    if (d.block !== def.block || !d.outline || !fs.existsSync(data(d.outline))) continue;
    const g = readJson<{ features: { geometry: { coordinates: [number, number][][] } }[] }>(data(d.outline));
    const ring = g.features[0]?.geometry.coordinates[0];
    if (ring) focus.push({ id: d.id, coords: ring });
  }
  for (const d of districts.planned ?? []) if ((d.block ?? def.block) === def.block && d.outline?.ring && !focus.some((f) => f.id === d.id)) focus.push({ id: d.id, coords: d.outline.ring });

  const input: RegistryInput = {
    stage: io.stage, block: def.block, origin: plan.origin, originName: (districts.blocks.find((b) => b.id === def.block) as { frameOrigin: { name?: string } }).frameOrigin.name ?? def.block, offset: frame.offset,
    outline: plan.outline.coords, districts: focus, osm: landmarks, osmBase: osm.osm3s?.timestamp_osm_base ?? 'unknown', wikidata: [...boxItems, ...cachedItems], notFetched: got.notFetched,
    roads: seenRoads(osm.elements, proj, hero), areaAt: (x, z) => resolveAt(index, x, z), underground, infrastructure, list, overrides,
  };
  return { input, wikidata: { boxItems: boxItems.length, cached: cachedItems.length, fetched: got.fetched.length, notFetched: got.notFetched, error: got.error }, osmSkipped: skipped };
}

export interface RegistryWrite {
  written: string[];
  removed: string[];
  unchanged: number;
  issuesFile: string;
  reportFile: string;
}

/**
 * Writes the registry: one file per hero and signature in harness/data/landmarks/, landmarks_markers.json, and (under
 * the gitignored reports) the registry's issues.json and a summary. A generated landmark file the build no longer
 * makes is removed; a file without the `_generated` line is never touched.
 */
export function writeRegistry(root: string, res: RegistryResult, report: Record<string, unknown>): RegistryWrite {
  const written: string[] = [];
  let unchanged = 0;
  for (const rel of Object.keys(res.files).sort()) {
    const abs = path.join(root, rel);
    const text = res.files[rel] as string;
    if (fs.existsSync(abs) && fs.readFileSync(abs, 'utf8') === text) {
      unchanged++;
      continue;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
    written.push(rel);
  }
  const removed: string[] = [];
  const dir = path.join(root, LANDMARK_DIR);
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
    const rel = `${LANDMARK_DIR}/${name}`;
    if (!name.endsWith('.json') || res.files[rel] !== undefined) continue;
    if (!/^\{\s*"_generated"/.test(fs.readFileSync(path.join(dir, name), 'utf8'))) continue;
    fs.rmSync(path.join(dir, name));
    removed.push(rel);
  }
  const outDir = path.join(root, 'harness', 'reports', 'map', 'landmarks');
  fs.mkdirSync(outDir, { recursive: true });
  const issuesFile = path.join(outDir, 'issues.json');
  fs.writeFileSync(issuesFile, res.issuesText);
  const reportFile = path.join(outDir, 'registry.json');
  fs.writeFileSync(reportFile, JSON.stringify({ ...report, hash: res.hash, stats: res.stats, problems: res.problems, rejected: res.rejected }, null, 2) + '\n');
  return { written, removed, unchanged, issuesFile: path.relative(root, issuesFile), reportFile: path.relative(root, reportFile) };
}

/** The whole registry build of a stage: read, fetch what the cache lacks, build. Writes nothing. */
export async function runRegistry(io: RegistryIo): Promise<{ read: RegistryRead; result: RegistryResult }> {
  const read = await readRegistryInput(io);
  return { read, result: buildRegistry(read.input) };
}

export { MARKERS_FILE };
