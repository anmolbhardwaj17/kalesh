// The warm start of a partial bake (P1-017, P1-050): the lane conflicts a whole bake handed back to the repair (rule
// R-LANE-06), kept by the inputs that made them. A partial bake starts its lane feedback from them only when its own
// inputs are the same (the raw graph, the override patches, the repair inputs, the source pins and the bake code);
// otherwise it runs the whole feedback, which gives the whole bake's result too, only slower. Before P1-050 the file
// held the conflicts of whichever whole bake ran last: the test suite's variant bakes (another override set) left
// theirs, and a partial bake after them differed from the whole bake by a millimetre (test order changed a bake).
// The file keeps the newest WARM_KEEP entries; a lost or torn write only costs the next partial bake its warm start.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { LaneConflict } from '../roads/surfaces.ts';

export const WARM_KEEP = 6;

interface WarmFile {
  _doc: string;
  /** Newest last. */
  entries: { key: string; conflicts: LaneConflict[] }[];
}

const DOC = 'Lane conflicts whole bakes handed back to the repair (rule R-LANE-06), by the hash of the bake inputs that made them; a partial bake with the same inputs starts from them (P1-017, P1-050). Written by tools/bake/sources/warmstart.ts.';

let codeHash: string | null = null;

/** The hash of the bake code (tools/bake and tools/geo, test files left out), once per process. */
function bakeCode(root: string): string {
  if (codeHash) return codeHash;
  const h = crypto.createHash('sha256');
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|mjs|json)$/.test(name) && !/\.test\.(ts|mjs)$/.test(name)) h.update(path.relative(root, p)).update('\0').update(fs.readFileSync(p, 'utf8')).update('\0');
    }
  };
  walk(path.join(root, 'tools', 'bake'));
  walk(path.join(root, 'tools', 'geo'));
  codeHash = h.digest('hex');
  return codeHash;
}

/** The key of one whole bake's warm start: the bake code plus every input part given (JSON). */
export function warmKey(root: string, parts: readonly unknown[]): string {
  const h = crypto.createHash('sha256').update(bakeCode(root));
  for (const p of parts) h.update('\0').update(JSON.stringify(p) ?? 'undefined');
  return h.digest('hex').slice(0, 24);
}

function readFile(file: string): WarmFile['entries'] {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<WarmFile>;
    return Array.isArray(j.entries) ? j.entries.filter((e) => typeof e?.key === 'string' && Array.isArray(e.conflicts)) : [];
  } catch {
    return [];
  }
}

/** The conflicts a whole bake with this key left, or [] (no warm start). */
export function readWarm(file: string, key: string): LaneConflict[] {
  return readFile(file).find((e) => e.key === key)?.conflicts ?? [];
}

/** Keeps this whole bake's conflicts under its key (the newest WARM_KEEP keys stay). Written whole, then renamed. */
export function writeWarm(file: string, key: string, conflicts: readonly LaneConflict[]): void {
  const entries = readFile(file).filter((e) => e.key !== key);
  entries.push({ key, conflicts: [...conflicts] });
  const out: WarmFile = { _doc: DOC, entries: entries.slice(-WARM_KEEP) };
  // two writers of different keys never share a temp file; two of one key write the same bytes
  const tmp = `${file}.${key.slice(0, 12)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(out) + '\n');
  fs.renameSync(tmp, file);
}
