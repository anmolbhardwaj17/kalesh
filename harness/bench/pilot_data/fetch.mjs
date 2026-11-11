#!/usr/bin/env node
// Pilot data fetch (P0-018, ARCH_OPTIONS.md "Bench tasks"): downloads and pins the sources of the pilot districts.
//
//   node harness/bench/pilot_data/fetch.mjs                 every step that has no pinned file yet
//   node harness/bench/pilot_data/fetch.mjs --only osm,glo30   only these steps
//   node harness/bench/pilot_data/fetch.mjs --force          fetch again even when the file is there
//   steps: osm overture glo30 fabdem gedtm ms google wikidata asi licences
//
// Everything lands in the gitignored data/pilot/ folder and is pinned in data/SOURCES.json (URL, date, licence,
// credit line, bytes, sha256). A source that cannot be reached after three tries is listed under `unreachable` and
// the run goes on. Boxes come from harness/bench/pilot_areas.json. No project or personal detail is sent: the
// client name is a plain string. The readers of the bake sources (GEDTM30 window, GLO-30 tile, Wikidata box query,
// the Overture release list) live in tools/bake/sources/readers.ts since P1-007 and are shared with the production
// bake driver (npm run bake); the steps here keep only the bench extras (per-district OSM boxes, Overture segments,
// FABDEM, Microsoft and Google footprints, the ASI page, the licence pages).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { LICENCES } from './licences.mjs';
import { GEDTM_URL, OVERPASS, SPARQL, glo30Url, latestOvertureRelease, readGedtm, readGlo30, readWikidata } from '../../../tools/bake/sources/readers.ts';
import { realNet } from '../../../tools/bake/sources/net.ts';
import {
  PILOT, TODAY, USER_AGENT, download, fetchRetry, inBox, loadSources, pilotAreas, pin, readJson, rel, sha256, sleep, unionBox, unreachable, writeJson,
} from './lib.mjs';

const args = process.argv.slice(2);
const only = args.includes('--only') ? String(args[args.indexOf('--only') + 1] || '').split(',').filter(Boolean) : null;
const force = args.includes('--force');
const areas = pilotAreas();
const union = unionBox(areas);
const sources = loadSources();
const lic = (id) => {
  const l = LICENCES.find((x) => x.id === id);
  return { licence: l.licence, licenceUrl: l.licenceUrl, credit: l.credit };
};
const log = (m) => console.log(m);
const have = (id, file) => !force && sources.files[id] && fs.existsSync(file);
const net = realNet();

// ------------------------------------------------------------------ OSM (Overpass, by box)

async function stepOsm() {
  for (const a of areas) {
    const id = `osm_${a.id}`;
    const file = path.join(PILOT, 'osm', `${a.id}.json`);
    if (have(id, file)) continue;
    const b = `${a.bbox.south},${a.bbox.west},${a.bbox.north},${a.bbox.east}`;
    // every node and way in the box, plus multipolygon relations that carry buildings and landmark areas;
    // then the nodes of ways that leave the box. No route or boundary relations: they pull in half the country.
    const q = `[out:json][timeout:170];(node(${b});way(${b});rel["type"="multipolygon"]["building"](${b});rel["type"="multipolygon"]["historic"](${b});rel["type"="multipolygon"]["leisure"](${b});rel["type"="multipolygon"]["tourism"](${b});rel["type"="multipolygon"]["landuse"](${b}););out body;>;out skel qt;`;
    try {
      const res = await fetchRetry(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: q }) }, 3, 240000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const j = JSON.parse(text);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      const p = pin(sources, id, file, { url: OVERPASS, query: q, ...lic('osm'), osmBase: j.osm3s?.timestamp_osm_base || null, note: `Overpass box query of ${a.name}; osmBase is the date of the OSM data` });
      log(`osm ${a.id}: ${j.elements.length} elements, ${p.bytes} bytes, OSM data of ${p.osmBase}`);
      await sleep(4000);
    } catch (e) {
      unreachable(sources, id, OVERPASS, e);
      log(`osm ${a.id}: UNREACHABLE ${e.message}`);
    }
  }
}

// ------------------------------------------------------------------ Overture (DuckDB over the public S3 release)

async function stepOverture() {
  const files = { overture_buildings: path.join(PILOT, 'overture', 'buildings.json'), overture_segments: path.join(PILOT, 'overture', 'segments.json') };
  if (have('overture_buildings', files.overture_buildings) && have('overture_segments', files.overture_segments)) return;
  let release = null;
  try {
    release = await latestOvertureRelease(net);
    const { DuckDBInstance } = await import('@duckdb/node-api');
    const db = await DuckDBInstance.create(':memory:');
    const con = await db.connect();
    await con.run("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';");
    fs.mkdirSync(path.join(PILOT, 'overture'), { recursive: true });
    const boxes = areas.map((a) => `(bbox.xmin < ${a.bbox.east} AND bbox.xmax > ${a.bbox.west} AND bbox.ymin < ${a.bbox.north} AND bbox.ymax > ${a.bbox.south})`).join(' OR ');
    const where = `bbox.xmin < ${union.east} AND bbox.xmax > ${union.west} AND bbox.ymin < ${union.north} AND bbox.ymax > ${union.south} AND (${boxes})`;
    for (const [id, theme, type] of [['overture_buildings', 'buildings', 'building'], ['overture_segments', 'transportation', 'segment']]) {
      const t0 = Date.now();
      const src = `s3://overturemaps-us-west-2/release/${release}/theme=${theme}/type=${type}/*`;
      await con.run(`COPY (SELECT * EXCLUDE (geometry), ST_AsGeoJSON(geometry) AS geojson FROM read_parquet('${src}', hive_partitioning=1) WHERE ${where}) TO '${files[id]}' (FORMAT JSON, ARRAY true);`);
      const p = pin(sources, id, files[id], { url: src, release, ...lic(theme === 'buildings' ? 'overture_buildings' : 'overture_transportation'), note: `DuckDB (httpfs, spatial) read of the public release, rows whose bbox meets a pilot box, geometry as GeoJSON text` });
      log(`overture ${type}: ${p.bytes} bytes in ${Math.round((Date.now() - t0) / 1000)} s (release ${release})`);
    }
  } catch (e) {
    unreachable(sources, 'overture', `s3://overturemaps-us-west-2/release/${release || '?'}/`, e);
    log(`overture: UNREACHABLE ${e.message}`);
  }
}

// ------------------------------------------------------------------ ground height sources

async function stepGlo30() {
  const file = path.join(PILOT, 'dem', 'glo30_N28_E077.tif');
  if (have('glo30', file)) return;
  try {
    const got = await readGlo30({ net, file, box: null, tile: 'N28_E077', log });
    const p = pin(sources, 'glo30', file, { url: got.url, ...(got.extra ?? {}), ...lic('glo30'), note: got.note });
    log(`glo30: ${p.bytes} bytes`);
  } catch (e) {
    unreachable(sources, 'glo30', glo30Url('N28_E077'), e);
    log(`glo30: UNREACHABLE ${e.message}`);
  }
}

const FABDEM_ZIP = 'https://data.bris.ac.uk/datasets/s5hqmjcdj8yo2ibzi9b4ew3sn/N20E070-N30E080_FABDEM_V1-2.zip';
const FABDEM_ENTRY = 'N28E077_FABDEM_V1-2.tif';

async function range(url, from, to) {
  const res = await fetchRetry(url, { headers: { Range: `bytes=${from}-${to}` } }, 3, 600000);
  if (res.status !== 206) throw new Error(`no byte range support (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/** Reads one entry out of a remote zip with byte range requests: the end record, the directory, then the entry. */
async function remoteZipEntry(url, name) {
  const head = await fetchRetry(url, { method: 'HEAD' });
  const size = Number(head.headers.get('content-length'));
  const tail = await range(url, Math.max(0, size - 131072), size - 1);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip end record not found');
  let cdSize = tail.readUInt32LE(eocd + 12);
  let cdOffset = tail.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) throw new Error('zip64 locator not found');
    const z64 = await range(url, Number(tail.readBigUInt64LE(loc + 8)), Number(tail.readBigUInt64LE(loc + 8)) + 55);
    cdSize = Number(z64.readBigUInt64LE(40));
    cdOffset = Number(z64.readBigUInt64LE(48));
  }
  const cd = await range(url, cdOffset, cdOffset + cdSize - 1);
  let at = 0;
  const names = [];
  while (at + 46 <= cd.length && cd.readUInt32LE(at) === 0x02014b50) {
    const method = cd.readUInt16LE(at + 10);
    let csize = cd.readUInt32LE(at + 20);
    let usize = cd.readUInt32LE(at + 24);
    const nlen = cd.readUInt16LE(at + 28);
    const elen = cd.readUInt16LE(at + 30);
    const clen = cd.readUInt16LE(at + 32);
    let offset = cd.readUInt32LE(at + 42);
    const entry = cd.subarray(at + 46, at + 46 + nlen).toString('utf8');
    // zip64 extra field holds the sizes and the offset that did not fit
    let ex = at + 46 + nlen;
    const exEnd = ex + elen;
    while (ex + 4 <= exEnd) {
      const tag = cd.readUInt16LE(ex);
      const len = cd.readUInt16LE(ex + 2);
      if (tag === 1) {
        let q = ex + 4;
        if (usize === 0xffffffff) { usize = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (offset === 0xffffffff) { offset = Number(cd.readBigUInt64LE(q)); }
      }
      ex += 4 + len;
    }
    names.push(entry);
    if (entry.endsWith(name)) {
      const lh = await range(url, offset, offset + 29);
      const start = offset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      const raw = await range(url, start, start + csize - 1);
      const data = method === 0 ? raw : zlib.inflateRawSync(raw);
      if (data.length !== usize) throw new Error(`zip entry size ${data.length}, expected ${usize}`);
      return { data, entry, zipBytes: size, zipLastModified: head.headers.get('last-modified'), entries: null };
    }
    at += 46 + nlen + elen + clen;
  }
  throw new Error(`zip entry ${name} not found (${names.length} entries, e.g. ${names.slice(0, 3).join(', ')})`);
}

async function stepFabdem() {
  const file = path.join(PILOT, 'dem', 'fabdem_N28E077.tif');
  if (have('fabdem', file)) return;
  try {
    const e = await remoteZipEntry(FABDEM_ZIP, FABDEM_ENTRY);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, e.data);
    const p = pin(sources, 'fabdem', file, { url: FABDEM_ZIP, remote: { contentLength: e.zipBytes, lastModified: e.zipLastModified }, ...lic('fabdem'), note: `the entry ${e.entry} read out of the 10 degree zip with byte range requests. Comparison only: never shipped, never baked into tiles` });
    log(`fabdem: ${p.bytes} bytes (${e.entry})`);
  } catch (e) {
    unreachable(sources, 'fabdem', FABDEM_ZIP, e);
    log(`fabdem: UNREACHABLE ${e.message}`);
  }
}

/** GEDTM30 is one global cloud optimised GeoTIFF of many GB: only the pilot window is read, with range requests. */
async function stepGedtm() {
  const file = path.join(PILOT, 'dem', 'gedtm30_pilot_window.json');
  if (have('gedtm30', file)) return;
  try {
    const pad = 0.01;
    const got = await readGedtm({ net, file, box: { south: union.south - pad, west: union.west - pad, north: union.north + pad, east: union.east + pad }, log });
    const p = pin(sources, 'gedtm30', file, { url: got.url, ...lic('gedtm30'), note: got.note });
    log(`gedtm30: ${p.bytes} bytes`);
  } catch (e) {
    unreachable(sources, 'gedtm30', GEDTM_URL, e);
    log(`gedtm30: UNREACHABLE ${e.message}`);
  }
}

// ------------------------------------------------------------------ building footprints for our own merge (BS2)

const MS_LINKS = 'https://minedbuildings.z5.web.core.windows.net/global-buildings/dataset-links.csv';

/** Bing quadkey of the tile that holds a point at a zoom level. */
export function quadkey(lat, lon, zoom) {
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const s = Math.sin((lat * Math.PI) / 180);
  const y = Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n);
  let key = '';
  for (let i = zoom; i > 0; i--) {
    const mask = 1 << (i - 1);
    key += String((x & mask ? 1 : 0) + (y & mask ? 2 : 0));
  }
  return key;
}

async function stepMs() {
  const out = path.join(PILOT, 'buildings', 'ms_pilot.geojsonl');
  if (have('ms_footprints_pilot', out)) return;
  try {
    const linksFile = path.join(PILOT, 'buildings', 'ms_dataset_links.csv');
    await download(MS_LINKS, linksFile);
    pin(sources, 'ms_dataset_links', linksFile, { url: MS_LINKS, ...lic('ms_footprints'), note: 'index of the Microsoft footprint files by quadkey' });
    const keys = new Set([quadkey(union.south, union.west, 9), quadkey(union.south, union.east, 9), quadkey(union.north, union.west, 9), quadkey(union.north, union.east, 9)]);
    const rows = fs.readFileSync(linksFile, 'utf8').split('\n').map((l) => l.split(',')).filter((r) => keys.has(r[1]));
    if (!rows.length) throw new Error(`no row for quadkeys ${[...keys].join(', ')}`);
    const lines = [];
    for (const r of rows) {
      const url = r[2];
      const gz = path.join(PILOT, 'buildings', `ms_${r[1]}_${r[0]}.csv.gz`);
      const head = await download(url, gz);
      pin(sources, `ms_footprints_${r[1]}_${r[0]}`, gz, { url, remote: head, ...lic('ms_footprints'), note: `Microsoft footprints, quadkey ${r[1]} (${r[0]}), GeoJSON lines` });
      for (const line of zlib.gunzipSync(fs.readFileSync(gz)).toString('utf8').split('\n')) {
        if (!line) continue;
        const f = JSON.parse(line);
        const ring = f.geometry?.coordinates?.[0];
        if (!ring) continue;
        if (areas.some((a) => inBox(a.bbox, ring[0][1], ring[0][0]))) lines.push(line);
      }
    }
    fs.writeFileSync(out, lines.join('\n') + '\n');
    const p = pin(sources, 'ms_footprints_pilot', out, { url: MS_LINKS, ...lic('ms_footprints'), note: `the footprints of the quadkey files whose first vertex is inside a pilot box (${lines.length} footprints)` });
    log(`ms: ${lines.length} footprints in the pilot boxes, ${p.bytes} bytes`);
  } catch (e) {
    unreachable(sources, 'ms_footprints', MS_LINKS, e);
    log(`ms: UNREACHABLE ${e.message}`);
  }
}

// Delhi is in S2 level 4 cell 391. The file is about 7 GB of gzip text for all of north India; it is streamed once,
// hashed on the way, and only the rows inside the pilot boxes are kept.
const GOOGLE_URL = 'https://storage.googleapis.com/open-buildings-data/v3/polygons_s2_level_4_gzip/391_buildings.csv.gz';

async function stepGoogle() {
  const out = path.join(PILOT, 'buildings', 'google_open_buildings_pilot.csv');
  if (have('google_open_buildings_pilot', out)) return;
  let last = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(GOOGLE_URL, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length'));
      const hash = crypto.createHash('sha256');
      const gunzip = zlib.createGunzip();
      const kept = [];
      let header = null;
      let rest = '';
      let rows = 0;
      gunzip.setEncoding('utf8');
      gunzip.on('data', (text) => {
        const parts = (rest + text).split('\n');
        rest = parts.pop();
        for (const line of parts) {
          if (!header) { header = line; continue; }
          rows++;
          const c1 = line.indexOf(',');
          const c2 = line.indexOf(',', c1 + 1);
          const lat = Number(line.slice(0, c1));
          if (lat < union.south || lat > union.north) continue;
          const lon = Number(line.slice(c1 + 1, c2));
          if (lon < union.west || lon > union.east) continue;
          if (areas.some((a) => inBox(a.bbox, lat, lon))) kept.push(line);
        }
      });
      const done = new Promise((resolve, reject) => { gunzip.on('end', resolve); gunzip.on('error', reject); });
      let got = 0;
      let next = 0;
      const t0 = Date.now();
      for await (const chunk of res.body) {
        hash.update(chunk);
        got += chunk.length;
        if (!gunzip.write(chunk)) await new Promise((r) => gunzip.once('drain', r));
        if (got >= next) {
          log(`google: ${(got / 2 ** 30).toFixed(2)} of ${(total / 2 ** 30).toFixed(2)} GB, ${kept.length} rows kept, ${Math.round((Date.now() - t0) / 1000)} s`);
          next = got + 500 * 2 ** 20;
        }
      }
      gunzip.end();
      await done;
      if (got !== total) throw new Error(`stream ended at ${got} of ${total} bytes`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, [header, ...kept].join('\n') + '\n');
      const p = pin(sources, 'google_open_buildings_pilot', out, { url: GOOGLE_URL, remote: { contentLength: total, sha256: hash.digest('hex'), lastModified: res.headers.get('last-modified'), rows }, ...lic('google_open_buildings'), note: `rows of the S2 cell 391 file inside the pilot boxes (${kept.length} of ${rows}); the remote file was streamed once and hashed (remote.sha256), not kept` });
      log(`google: ${kept.length} footprints in the pilot boxes, ${p.bytes} bytes`);
      return;
    } catch (e) {
      last = e;
      log(`google: try ${attempt + 1} failed: ${e.message}`);
      await sleep(5000);
    }
  }
  unreachable(sources, 'google_open_buildings', GOOGLE_URL, last);
}

// ------------------------------------------------------------------ landmarks

async function sparql(query) {
  const res = await fetchRetry(`${SPARQL}?format=json&query=${encodeURIComponent(query)}`, { headers: { Accept: 'application/sparql-results+json' } }, 3, 90000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).results.bindings;
}

async function stepWikidata() {
  const file = path.join(PILOT, 'landmarks', 'wikidata.json');
  if (have('wikidata_pilot', file)) return;
  try {
    const out = { _doc: 'Wikidata items with a coordinate inside each pilot box (wikibase:box), and every item with an ASI monument id (P1371) that starts with N-DL (Delhi circle).', fetched: new Date().toISOString(), boxes: {}, asiDelhi: [] };
    for (const a of areas) {
      const tmp = path.join(PILOT, 'landmarks', `.wikidata_${a.id}.json`);
      await readWikidata({ net, file: tmp, box: a.bbox, log });
      out.boxes[a.id] = JSON.parse(fs.readFileSync(tmp, 'utf8')).rows;
      fs.rmSync(tmp);
      log(`wikidata ${a.id}: ${out.boxes[a.id].length} rows`);
      await sleep(1500);
    }
    out.asiDelhi = await sparql(`SELECT ?item ?itemLabel ?coord ?asi ?sitelinks WHERE { ?item wdt:P1371 ?asi . FILTER(STRSTARTS(?asi, "N-DL")) OPTIONAL { ?item wdt:P625 ?coord } ?item wikibase:sitelinks ?sitelinks . SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`);
    writeJson(file, out, false);
    const l = LICENCES.find((x) => x.id === 'wikidata');
    pin(sources, 'wikidata_pilot', file, { url: SPARQL, licence: l.licence, licenceUrl: l.licenceUrl, credit: l.credit, note: `SPARQL: items with P625 inside each pilot box, and ${out.asiDelhi.length} rows with an ASI id N-DL-*` });
    log(`wikidata: ${out.asiDelhi.length} rows with an ASI id of the Delhi circle`);
  } catch (e) {
    unreachable(sources, 'wikidata', SPARQL, e);
    log(`wikidata: UNREACHABLE ${e.message}`);
  }
}

const ASI_URLS = ['https://asi.nic.in/alphabetical-list-of-monuments-delhi/', 'https://asidelhicircle.in/protected-monuments/'];

async function stepAsi() {
  const file = path.join(PILOT, 'landmarks', 'asi_delhi_list.html');
  if (have('asi_delhi_list', file)) return;
  const errors = [];
  for (const url of ASI_URLS) {
    try {
      const res = await fetchRetry(url, {}, 3, 45000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      const l = LICENCES.find((x) => x.id === 'asi_list');
      pin(sources, 'asi_delhi_list', file, { url, licence: l.licence, licenceUrl: l.licenceUrl, credit: l.credit, note: 'the list page as served; only names and protection status are read from it' });
      log(`asi: ${text.length} characters from ${url}`);
      return;
    } catch (e) {
      errors.push(`${url}: ${e.message}`);
    }
  }
  unreachable(sources, 'asi_delhi_list', ASI_URLS[0], errors.join(' | '));
  log(`asi: UNREACHABLE ${errors.join(' | ')}`);
}

// ------------------------------------------------------------------ licence pages

async function stepLicences() {
  const file = path.join(PILOT, 'licence_checks.json');
  const prev = readJson(file, { checks: {} });
  const out = { _doc: 'One check per licence page of harness/bench/pilot_data/licences.mjs: the page was fetched, the phrases looked for, and the page hashed.', checks: force ? {} : prev.checks };
  for (const l of LICENCES) {
    if (out.checks[l.id]?.httpStatus === 200 && out.checks[l.id].url === l.licenceUrl && out.checks[l.id].phraseFound !== false && !force) continue;
    const c = { url: l.licenceUrl, dateChecked: TODAY, httpStatus: null, phraseFound: null, phrases: l.phrases, sha256: null };
    try {
      const res = await fetchRetry(l.licenceUrl, { headers: { Accept: 'text/html,application/json,*/*', ...(l.ua ? { 'User-Agent': l.ua } : {}) } }, 3, 120000);
      c.httpStatus = res.status;
      const body = Buffer.from(await res.arrayBuffer());
      c.sha256 = sha256(body);
      c.bytes = body.length;
      c.contentType = res.headers.get('content-type');
      const text = body.toString('utf8').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
      const found = l.phrases.filter((p) => text.toLowerCase().includes(p.toLowerCase()));
      c.phraseFound = l.phrases.length ? found.length > 0 : null;
      c.found = found;
      const first = found[0];
      if (first) {
        const i = text.toLowerCase().indexOf(first.toLowerCase());
        c.quote = text.slice(Math.max(0, i - 160), i + first.length + 200).trim();
      }
    } catch (e) {
      c.error = String(e.message).slice(0, 200);
    }
    out.checks[l.id] = c;
    log(`licence ${l.id}: HTTP ${c.httpStatus ?? 'none'} phrase ${c.phraseFound}${c.error ? ` (${c.error})` : ''}`);
  }
  writeJson(file, out);
}

const STEPS = { osm: stepOsm, glo30: stepGlo30, fabdem: stepFabdem, gedtm: stepGedtm, wikidata: stepWikidata, asi: stepAsi, licences: stepLicences, ms: stepMs, overture: stepOverture, google: stepGoogle };

for (const [name, fn] of Object.entries(STEPS)) {
  if (only && !only.includes(name)) continue;
  const t0 = Date.now();
  log(`[fetch] ${name}`);
  await fn();
  log(`[fetch] ${name} done in ${Math.round((Date.now() - t0) / 1000)} s`);
}
log(`pinned ${Object.keys(sources.files).length} files in ${rel(path.join(PILOT, '..', 'SOURCES.json'))}; unreachable: ${Object.keys(sources.unreachable).join(', ') || 'none'}`);
process.exit(0);
