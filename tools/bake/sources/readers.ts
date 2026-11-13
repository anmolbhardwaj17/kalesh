// Source readers of the bake (P1-007, moved from the Phase 0 bench driver harness/bench/pilot_data/fetch.mjs): each
// fetches one source for a box and writes one file. OSM by Overpass, Overture buildings through DuckDB, a GEDTM30
// window through geotiff range requests, the Copernicus GLO-30 tile, Wikidata by SPARQL. FABDEM is never read.
// Every request goes through `net` (tools/bake/sources/net.ts).
import fs from 'node:fs';
import path from 'node:path';
import type { GeoBox } from '../layout/outline.ts';
import type { SourceKind } from '../pins.ts';
import { isOffline, okOrThrow, withRetry } from './net.ts';
import type { Net } from './net.ts';
import { writeAtomic } from './pinfile.ts';

/** What a reader tells the pin list about the file it wrote. */
export interface Fetched {
  url: string;
  note: string;
  extra?: Record<string, unknown>;
}

export interface ReaderArgs {
  net: Net;
  /** Absolute path of the file to write. */
  file: string;
  box: GeoBox | null;
  /** Name of the GLO-30 tile ("N28_E077") for the tile reader. */
  tile?: string;
  log: (line: string) => void;
}

export type Reader = (a: ReaderArgs) => Promise<Fetched>;

const needBox = (a: ReaderArgs): GeoBox => {
  if (!a.box) throw new Error(`${path.dirname(a.file)}: this source needs a box`);
  return a.box;
};

// ------------------------------------------------------------------ OSM (Overpass)

export const OVERPASS = 'https://overpass-api.de/api/interpreter';
/** Public Overpass mirrors, tried in order when the main server answers 504 or 429 three times (busy, not down). */
export const OVERPASS_MIRRORS = [OVERPASS, 'https://overpass.private.coffee/api/interpreter'];

/**
 * Every node and way in the box with the nodes of ways that leave it, then the multipolygon relations that touch the
 * box (members only, no recursion: a river or a park relation would pull in its whole length). No route or boundary
 * relations: they pull in half the country. Overpass answers 406 to curl and browser client names (knowledge file).
 */
export function overpassQuery(b: GeoBox): string {
  const bb = `${b.south},${b.west},${b.north},${b.east}`;
  return `[out:json][timeout:900][maxsize:1073741824];(node(${bb});way(${bb}););out body;>;out skel qt;rel["type"="multipolygon"](${bb});out body;`;
}

export const readOsm: Reader = async (a) => {
  const q = overpassQuery(needBox(a));
  let text = '';
  let server = '';
  const errors: string[] = [];
  for (const url of OVERPASS_MIRRORS) {
    try {
      text = await withRetry(`overpass ${url}`, async () => (await okOrThrow(await a.net.request(url, { method: 'POST', form: { data: q }, timeoutMs: 1_200_000 }), url)).text(), 3, 20_000, a.net.pause);
      server = url;
      break;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      if (isOffline(e)) throw e;
    }
  }
  if (!server) throw new Error(errors.join(' | '));
  const j = JSON.parse(text) as { elements?: unknown[]; osm3s?: { timestamp_osm_base?: string }; remark?: string };
  if (!Array.isArray(j.elements) || j.elements.length === 0) throw new Error(`overpass returned no elements${j.remark ? `: ${j.remark}` : ''}`);
  if (j.remark && /error|runtime/i.test(j.remark)) throw new Error(`overpass: ${j.remark}`);
  writeAtomic(a.file, text);
  a.log(`osm: ${j.elements.length} elements, OSM data of ${j.osm3s?.timestamp_osm_base ?? 'unknown'}`);
  return { url: server, note: 'one Overpass box query over the stage box (outline plus margin); osmBase is the date of the OSM data', extra: { query: q, osmBase: j.osm3s?.timestamp_osm_base ?? null, elements: j.elements.length } };
};

/**
 * The turn data of the same OSM box (P1-032): every turn restriction relation that touches the box (its members are
 * ids of ways and nodes in the main extract) and the highway ways that carry a turn:lanes tag, with their node ids.
 * A query of its own, so the main extract (osm.json) keeps its pin.
 */
export function overpassTurnsQuery(b: GeoBox): string {
  const bb = `${b.south},${b.west},${b.north},${b.east}`;
  return `[out:json][timeout:300];(rel["type"="restriction"](${bb});way["highway"]["turn:lanes"](${bb});way["highway"]["turn:lanes:forward"](${bb});way["highway"]["turn:lanes:backward"](${bb});way["highway"]["turn:lanes:both_ways"](${bb}););out body;`;
}

export const readOsmTurns: Reader = async (a) => {
  const q = overpassTurnsQuery(needBox(a));
  let text = '';
  let server = '';
  const errors: string[] = [];
  for (const url of OVERPASS_MIRRORS) {
    try {
      text = await withRetry(`overpass turns ${url}`, async () => (await okOrThrow(await a.net.request(url, { method: 'POST', form: { data: q }, timeoutMs: 300_000 }), url)).text(), 3, 20_000, a.net.pause);
      JSON.parse(text);
      server = url;
      break;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      if (isOffline(e)) throw e;
    }
  }
  if (!server) throw new Error(errors.join(' | '));
  const j = JSON.parse(text) as { elements?: { type: string; tags?: Record<string, string> }[]; osm3s?: { timestamp_osm_base?: string }; remark?: string };
  if (!Array.isArray(j.elements)) throw new Error(`overpass turns: no elements${j.remark ? `: ${j.remark}` : ''}`);
  if (j.remark && /error|runtime/i.test(j.remark)) throw new Error(`overpass turns: ${j.remark}`);
  writeAtomic(a.file, text);
  const relations = j.elements.filter((e) => e.type === 'relation').length;
  const ways = j.elements.filter((e) => e.type === 'way').length;
  a.log(`osm turns: ${relations} restriction relations, ${ways} ways with turn lanes, OSM data of ${j.osm3s?.timestamp_osm_base ?? 'unknown'}`);
  return { url: server, note: 'one Overpass box query over the stage box: turn restriction relations and highway ways with turn:lanes tags (ids refer to the osm pin of the same stage)', extra: { query: q, osmBase: j.osm3s?.timestamp_osm_base ?? null, relations, ways } };
};

// ------------------------------------------------------------------ Overture buildings (DuckDB)

const OVERTURE_BUCKET = 'https://overturemaps-us-west-2.s3.amazonaws.com';

/** The newest Overture release folder name (they sort by date). */
export async function latestOvertureRelease(net: Net): Promise<string> {
  const url = `${OVERTURE_BUCKET}/?prefix=release/&delimiter=/`;
  const text = await withRetry('overture releases', async () => (await okOrThrow(await net.request(url), url)).text(), 3, 3000, net.pause);
  const all = [...text.matchAll(/<Prefix>release\/([^<\/]+)\/<\/Prefix>/g)].map((m) => m[1] as string).sort();
  const last = all[all.length - 1];
  if (!last) throw new Error('no Overture release listed');
  return last;
}

export function overtureSql(release: string, b: GeoBox): string {
  const src = `s3://overturemaps-us-west-2/release/${release}/theme=buildings/type=building/*`;
  const where = `bbox.xmin < ${b.east} AND bbox.xmax > ${b.west} AND bbox.ymin < ${b.north} AND bbox.ymax > ${b.south}`;
  // ORDER BY id: the same release and box give the same bytes
  return `COPY (SELECT * EXCLUDE (geometry), ST_AsGeoJSON(geometry) AS geojson FROM read_parquet('${src}', hive_partitioning=1) WHERE ${where} ORDER BY id) TO '$OUT' (FORMAT JSON, ARRAY true);`;
}

export const readOvertureBuildings: Reader = async (a) => {
  const release = await latestOvertureRelease(a.net);
  const sql = overtureSql(release, needBox(a));
  const part = `${a.file}.part`;
  fs.mkdirSync(path.dirname(a.file), { recursive: true });
  await withRetry('overture buildings', () => a.net.duckdb([sql], part), 3, 10_000, a.net.pause);
  writeAtomicRename(part, a.file);
  a.log(`overture buildings: release ${release}`);
  return { url: `s3://overturemaps-us-west-2/release/${release}/theme=buildings/type=building/`, note: 'DuckDB (httpfs, spatial) read of the public release: rows whose bbox meets the stage box, geometry as GeoJSON text, ordered by id', extra: { release, sql } };
};

// ------------------------------------------------------------------ GEDTM30 window (geotiff over HTTP ranges)

export const GEDTM_URL = 'https://s3.opengeohub.org/global/dtm/v1.2/gedtm_rf_m_30m_s_20060101_20151231_go_epsg.4326.3855_v1.2.tif';

export const readGedtm: Reader = async (a) => {
  const w = await withRetry('gedtm30', () => a.net.tiffWindow(GEDTM_URL, needBox(a)), 3, 10_000, a.net.pause);
  const out = {
    _doc: 'Window of GEDTM30 v1.2 over the stage box, read from the global cloud optimised GeoTIFF with range requests. values are the raw cell values (row 0 is the north row); metres = value * scale + offset. Read by tools/bake/sources/ground.ts, smoothed over 60 m by tools/bake/heights.ts.',
    url: GEDTM_URL, west: w.west, north: w.north, dLon: w.dLon, dLat: w.dLat, width: w.width, height: w.height,
    scale: w.scale, offset: w.offset, noData: w.noData, pixelIsPoint: w.pixelIsPoint, gdalMetadata: w.meta, values: w.values,
  };
  writeAtomic(a.file, JSON.stringify(out) + '\n');
  a.log(`gedtm30: window ${w.width} x ${w.height} cells, scale ${w.scale}`);
  return { url: GEDTM_URL, note: `window of ${w.width} x ${w.height} cells cut from the global file with HTTP range requests; sha256 is of the saved window, url names the global file` };
};

// ------------------------------------------------------------------ Copernicus GLO-30 tile

export const glo30Url = (tile: string): string => {
  const name = `Copernicus_DSM_COG_10_${tile.replace('_', '_00_')}_00_DEM`;
  return `https://copernicus-dem-30m.s3.amazonaws.com/${name}/${name}.tif`;
};

export const readGlo30: Reader = async (a) => {
  if (!a.tile) throw new Error('glo30: no tile name');
  const url = glo30Url(a.tile);
  const res = await withRetry('glo30', async () => okOrThrow(await a.net.request(url, { timeoutMs: 900_000 }), url), 3, 3000, a.net.pause);
  const bytes = new Uint8Array(await res.arrayBuffer());
  writeAtomic(a.file, bytes);
  a.log(`glo30: tile ${a.tile}, ${bytes.length} bytes`);
  return { url, note: `Copernicus DEM GLO-30 Public, the 1 degree tile ${a.tile} (a surface model: roofs and trees are in it; the bake filters it, tools/bake/heights.ts)`, extra: { remote: { etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') } } };
};

// ------------------------------------------------------------------ Wikidata (SPARQL)

export const SPARQL = 'https://query.wikidata.org/sparql';

export function wikidataQuery(b: GeoBox): string {
  return `SELECT ?item ?itemLabel ?hi ?coord ?sitelinks ?asi ?inception ?height ?instLabel ?heritageLabel ?commons WHERE {
  SERVICE wikibase:box { ?item wdt:P625 ?coord . bd:serviceParam wikibase:cornerSouthWest "Point(${b.west} ${b.south})"^^geo:wktLiteral ; wikibase:cornerNorthEast "Point(${b.east} ${b.north})"^^geo:wktLiteral . }
  ?item wikibase:sitelinks ?sitelinks .
  OPTIONAL { ?item wdt:P1371 ?asi } OPTIONAL { ?item wdt:P571 ?inception } OPTIONAL { ?item wdt:P2048 ?height }
  OPTIONAL { ?item wdt:P31 ?inst } OPTIONAL { ?item wdt:P1435 ?heritage } OPTIONAL { ?item wdt:P373 ?commons }
  OPTIONAL { ?item rdfs:label ?hi FILTER(LANG(?hi) = "hi") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} ORDER BY ?item ?inst ?heritage`;
}

export const readWikidata: Reader = async (a) => {
  const q = wikidataQuery(needBox(a));
  const url = `${SPARQL}?format=json&query=${encodeURIComponent(q)}`;
  const text = await withRetry('wikidata', async () => (await okOrThrow(await a.net.request(url, { headers: { Accept: 'application/sparql-results+json' }, timeoutMs: 120_000 }), SPARQL)).text(), 3, 3000, a.net.pause);
  const rows = (JSON.parse(text) as { results?: { bindings?: unknown[] } }).results?.bindings;
  if (!Array.isArray(rows)) throw new Error('wikidata: no results.bindings');
  writeAtomic(a.file, JSON.stringify({ _doc: 'Wikidata items with a coordinate (P625) inside the stage box (wikibase:box), with ASI id, inception, height, class, heritage status, Commons category and Hindi label.', query: q, rows }) + '\n');
  a.log(`wikidata: ${rows.length} rows`);
  return { url: SPARQL, note: 'SPARQL: items with P625 inside the stage box', extra: { rows: rows.length } };
};

/** The main URL of each source, for the `unreachable` record of the pin list. */
export const SOURCE_URL: Readonly<Record<SourceKind, string>> = {
  osm: OVERPASS,
  osm_turns: OVERPASS,
  overture_buildings: `${OVERTURE_BUCKET}/release/`,
  gedtm30: GEDTM_URL,
  glo30: 'https://copernicus-dem-30m.s3.amazonaws.com/',
  wikidata: SPARQL,
};

export const READERS: Readonly<Record<SourceKind, Reader>> = {
  osm: readOsm,
  osm_turns: readOsmTurns,
  overture_buildings: readOvertureBuildings,
  gedtm30: readGedtm,
  glo30: readGlo30,
  wikidata: readWikidata,
};

function writeAtomicRename(part: string, file: string): void {
  if (!fs.existsSync(part)) throw new Error(`${part} was not written`);
  fs.renameSync(part, file);
}
