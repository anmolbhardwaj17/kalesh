// Shared helpers of the pilot data bench drivers (P0-018): paths, the pin list data/SOURCES.json, downloads with
// three tries, checksums. The reusable bake logic is typed code in tools/bake/; these drivers only do file and
// network work around it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const DATA = path.join(ROOT, 'data');
export const PILOT = path.join(DATA, 'pilot');
export const REPORTS = path.join(ROOT, 'harness', 'reports', 'arch');
export const SOURCES_FILE = path.join(DATA, 'SOURCES.json');
/** A plain client name: no project or personal details go to outside services. */
export const USER_AGENT = 'map-bake-fetch/1.0';
export const TODAY = new Date().toISOString().slice(0, 10);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const round = (v, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
export const readJson = (file, fallback = null) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback);
export function writeJson(file, value, pretty = true) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, pretty ? 2 : 0) + '\n');
}
export const rel = (file) => path.relative(ROOT, file);

export function sha256File(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1 << 20);
  let n;
  while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  fs.closeSync(fd);
  return h.digest('hex');
}
export const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

export function pilotAreas() {
  return readJson(path.join(ROOT, 'harness', 'bench', 'pilot_areas.json')).areas;
}

/** The box around every pilot area. */
export function unionBox(areas = pilotAreas()) {
  return {
    south: Math.min(...areas.map((a) => a.bbox.south)), west: Math.min(...areas.map((a) => a.bbox.west)),
    north: Math.max(...areas.map((a) => a.bbox.north)), east: Math.max(...areas.map((a) => a.bbox.east)),
  };
}
export const inBox = (b, lat, lon) => lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;

/** fetch with up to `tries` attempts and a pause between them. Throws the last error. */
export async function fetchRetry(url, opts = {}, tries = 3, timeoutMs = 120000) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { ...opts, headers: { 'User-Agent': USER_AGENT, ...(opts.headers || {}) }, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep(3000 * (i + 1));
    }
  }
  throw new Error(`${url}: ${last?.message || last} (after ${tries} tries)`);
}

/** Downloads a URL to a file (streamed) with three tries. Returns the response headers that pin the remote file. */
export async function download(url, file, tries = 3, timeoutMs = 900000) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.part`;
      const out = fs.createWriteStream(tmp);
      for await (const chunk of res.body) if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      await new Promise((r) => out.end(r));
      fs.renameSync(tmp, file);
      return { etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'), contentLength: Number(res.headers.get('content-length')) || null };
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep(3000 * (i + 1));
    }
  }
  throw new Error(`${url}: ${last?.message || last} (after ${tries} tries)`);
}

/** The pin list: one entry per downloaded file. */
export function loadSources() {
  return readJson(SOURCES_FILE, { _doc: 'Pin list of every source data download (written by harness/bench/pilot_data/fetch.mjs). The files live in the gitignored data/ folder; this list is versioned. sha256 and bytes are of the local file. A file cut out of a larger remote file names the remote in url and how it was cut in note.', files: {}, unreachable: {} });
}
export function saveSources(s) {
  const files = {};
  for (const k of Object.keys(s.files).sort()) files[k] = s.files[k];
  writeJson(SOURCES_FILE, { ...s, files });
}
/** Adds or replaces the pin of one file. `file` is absolute; licence fields come from the licence table. The list is
 * read from disk again first, so two fetch runs side by side (the long Google stream and the rest) do not undo each other. */
export function pin(sources, id, file, info) {
  const entry = { file: rel(file), bytes: fs.statSync(file).size, sha256: sha256File(file), date: TODAY, ...info };
  const disk = loadSources();
  disk.files[id] = entry;
  delete disk.unreachable[id];
  saveSources(disk);
  Object.assign(sources, disk);
  return entry;
}
export function unreachable(sources, id, url, error) {
  const disk = loadSources();
  disk.unreachable[id] = { url, date: TODAY, error: String(error?.message || error).slice(0, 300) };
  saveSources(disk);
  Object.assign(sources, disk);
}
