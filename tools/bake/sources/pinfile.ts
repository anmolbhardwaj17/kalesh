// Reading and writing the pin list data/SOURCES.json and hashing pinned files (P1-007). The pure checks are in
// tools/bake/pins.ts.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Pin, SourcesFile } from '../pins.ts';

const DOC =
  'Pin list of every source data download. Written by the bake driver (tools/bake/main.ts, stage "sources") and, for the Phase 0 bench files, by harness/bench/pilot_data/fetch.mjs. The files live in the gitignored data/ folder; this list is versioned. sha256 and bytes are of the local file. A file cut out of a larger remote file names the remote in url and how it was cut in note; box is the cut in degrees. Every entry carries its licence and credit line (tools/bake/pins.test.ts fails on one without).';

export function sha256File(file: string): string {
  const h = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = new Uint8Array(1 << 20);
  let n: number;
  while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  fs.closeSync(fd);
  return h.digest('hex');
}

export function loadSources(file: string): SourcesFile {
  if (!fs.existsSync(file)) return { _doc: DOC, files: {}, unreachable: {} };
  const s = JSON.parse(fs.readFileSync(file, 'utf8')) as SourcesFile;
  return { ...s, files: s.files ?? {}, unreachable: s.unreachable ?? {} };
}

/** Writes the list with its entries sorted by id (stable diffs). */
export function saveSources(file: string, s: SourcesFile): void {
  const files: Record<string, Pin> = {};
  for (const k of Object.keys(s.files).sort()) files[k] = s.files[k] as Pin;
  const unreachable: SourcesFile['unreachable'] = {};
  for (const k of Object.keys(s.unreachable).sort()) unreachable[k] = s.unreachable[k] as SourcesFile['unreachable'][string];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ _doc: DOC, files, unreachable }, null, 2) + '\n');
}

/** Writes a file through a `.part` file, so a run that dies half way never leaves a file that looks complete. */
export function writeAtomic(file: string, data: string | Uint8Array): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.part`, data);
  fs.renameSync(`${file}.part`, file);
}
