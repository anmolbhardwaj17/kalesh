// Bake stage "sources" (P1-007): fetches or reuses every pinned file of a bake stage and prints its hash. A file is
// reused when its pin is there, the file is there with the pinned sha256, and the pinned box still holds the stage
// box; then no request is made. A source that cannot be reached after three tries is listed under `unreachable` in
// data/SOURCES.json and the run goes on; a local file whose hash no longer matches its pin is reported and never
// overwritten without --force (the invariants stop the bake on it).
import fs from 'node:fs';
import path from 'node:path';
import { boxHolds } from '../layout/outline.ts';
import type { StagePlan, StageSource } from '../layout/stages.ts';
import { glo30Tile } from '../layout/stages.ts';
import { LICENCES } from '../pins.ts';
import type { Pin, SourceKind } from '../pins.ts';
import { isOffline } from './net.ts';
import type { Net } from './net.ts';
import { loadSources, saveSources, sha256File } from './pinfile.ts';
import { READERS, SOURCE_URL } from './readers.ts';
import type { Reader } from './readers.ts';

export type SourceAction = 'reused' | 'fetched' | 'unreachable' | 'mismatch';

export interface SourceResult {
  id: string;
  kind: SourceKind;
  action: SourceAction;
  /** Repo-relative path of the file in use. */
  file: string;
  sha256: string | null;
  bytes: number | null;
  error?: string;
}

export interface SourcesCtx {
  /** Repo root (absolute). Pins hold paths relative to it. */
  root: string;
  /** Absolute path of the pin list (data/SOURCES.json under root). */
  sourcesFile: string;
  net: Net;
  /** Date written into new pins (YYYY-MM-DD). */
  today: string;
  log: (line: string) => void;
  /** Fetch again even when a good pinned file is there. */
  force?: boolean;
  /** Readers by source kind (tests swap them; the default is the real set). */
  readers?: Readonly<Record<SourceKind, Reader>>;
}

/** Why a pinned file cannot be reused for this stage source, or null when it can (the hash is checked after). */
export function reuseBlocker(pin: Pin | undefined, src: StageSource, plan: StagePlan, exists: boolean): string | null {
  if (!pin) return 'not pinned';
  if (!exists) return `pinned file ${pin.file} is missing`;
  if (src.box) {
    if (!pin.box) return 'the pin has no box';
    if (!boxHolds(pin.box, src.box)) return 'the pinned box does not hold the stage box (outline or margin changed)';
  } else if (src.kind === 'glo30' && !pin.file.includes(glo30Tile(plan.box))) {
    return `the pinned tile is not ${glo30Tile(plan.box)}`;
  }
  return null;
}

const line = (r: SourceResult): string =>
  `${r.action.padEnd(11)} ${r.id.padEnd(28)} sha256 ${r.sha256 ?? '-'.repeat(64)} ${String(r.bytes ?? '-').padStart(10)} bytes  ${r.file}${r.error ? `  (${r.error})` : ''}`;

export async function runSourcesStage(plan: StagePlan, ctx: SourcesCtx): Promise<SourceResult[]> {
  const readers = ctx.readers ?? READERS;
  const out: SourceResult[] = [];
  for (const src of plan.sources) {
    const pins = loadSources(ctx.sourcesFile);
    const pin = pins.files[src.id];
    const pinnedAbs = pin ? path.resolve(ctx.root, pin.file) : '';
    const blocker = reuseBlocker(pin, src, plan, !!pin && fs.existsSync(pinnedAbs));
    if (pin && !blocker && !ctx.force) {
      const sha = sha256File(pinnedAbs);
      const r: SourceResult = sha === pin.sha256
        ? { id: src.id, kind: src.kind, action: 'reused', file: pin.file, sha256: sha, bytes: pin.bytes }
        : { id: src.id, kind: src.kind, action: 'mismatch', file: pin.file, sha256: sha, bytes: fs.statSync(pinnedAbs).size, error: `pinned sha256 ${pin.sha256.slice(0, 12)}..., run with --force to fetch again` };
      ctx.log(line(r));
      out.push(r);
      continue;
    }
    const abs = path.resolve(ctx.root, src.file);
    ctx.log(`fetching    ${src.id} (${ctx.force ? 'forced' : blocker})`);
    try {
      const got = await readers[src.kind]({ net: ctx.net, file: abs, box: src.box, tile: src.kind === 'glo30' ? glo30Tile(plan.box) : undefined, log: (m) => ctx.log(`            ${m}`) });
      const lic = LICENCES[src.kind];
      const entry: Pin = {
        file: path.relative(ctx.root, abs), bytes: fs.statSync(abs).size, sha256: sha256File(abs), date: ctx.today, url: got.url,
        licence: lic.licence, licenceUrl: lic.licenceUrl, credit: lic.credit, note: got.note, stage: plan.id, ...(src.box ? { box: src.box } : {}), ...(got.extra ?? {}),
      };
      const disk = loadSources(ctx.sourcesFile); // read again: never undo another writer's pins
      disk.files[src.id] = entry;
      delete disk.unreachable[src.id];
      saveSources(ctx.sourcesFile, disk);
      const r: SourceResult = { id: src.id, kind: src.kind, action: 'fetched', file: entry.file, sha256: entry.sha256, bytes: entry.bytes };
      ctx.log(line(r));
      out.push(r);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e).slice(0, 300);
      if (!isOffline(e)) {
        const disk = loadSources(ctx.sourcesFile);
        disk.unreachable[src.id] = { url: SOURCE_URL[src.kind], date: ctx.today, error: msg };
        saveSources(ctx.sourcesFile, disk);
      }
      const r: SourceResult = { id: src.id, kind: src.kind, action: 'unreachable', file: src.file, sha256: null, bytes: null, error: msg };
      ctx.log(line(r));
      out.push(r);
    }
  }
  return out;
}
